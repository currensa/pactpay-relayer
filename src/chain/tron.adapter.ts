import { TronWeb } from "tronweb";
import { SimulationRejectedError } from "../common/errors";
import type { CircuitTier, RelayedOperation, TronChainConfig } from "../config/types";
import { canonicalAddress, displayAddress } from "./address";
import type { ChainAdapter, SignedTransaction, SimulationResult, TransactionStatus } from "./types";

type TronWrapper = { result?: { result?: boolean; message?: string }; energy_required?: number; transaction?: unknown };

function reason(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try { return TronWeb.toUtf8(value); } catch { return fallback; }
}

export class TronChainAdapter implements ChainAdapter {
  readonly tronWeb: TronWeb;
  readonly relayerCanonical: string;
  readonly relayerDisplay: string;
  private readonly privateKey: string;

  constructor(readonly config: TronChainConfig, privateKey: string, tronProApiKey?: string) {
    this.privateKey = privateKey.replace(/^0x/, "");
    this.tronWeb = new TronWeb({
      fullHost: config.rpcUrl,
      privateKey: this.privateKey,
      ...(tronProApiKey ? { headers: { "TRON-PRO-API-KEY": tronProApiKey } } : {}),
    });
    const address = TronWeb.address.fromPrivateKey(this.privateKey);
    if (!address) throw new Error("Could not derive TRON relayer address");
    this.relayerCanonical = canonicalAddress(address, "tron");
    this.relayerDisplay = displayAddress(address, "tron");
  }

  async checkConnection(): Promise<void> { await this.tronWeb.trx.getCurrentBlock(); }

  private async resourcePrices(): Promise<{ energy: bigint; bandwidth: bigint }> {
    const parameters = await this.tronWeb.trx.getChainParameters();
    const energy = parameters.find((item) => item.key === "getEnergyFee")?.value ?? 100;
    const bandwidth = parameters.find((item) => item.key === "getTransactionFee")?.value ?? 1000;
    return { energy: BigInt(energy), bandwidth: BigInt(bandwidth) };
  }

  async estimateNativeNetworkCosts(operation: RelayedOperation, tiers: CircuitTier[]): Promise<Map<CircuitTier, bigint>> {
    const prices = await this.resourcePrices();
    const energyByTier = operation === "refund" ? this.config.refundEnergyByTier : this.config.energyByTier;
    const bandwidthByTier = operation === "refund" ? this.config.refundBandwidthByTier : this.config.bandwidthByTier;
    return new Map(tiers.map((tier) => {
      const raw = BigInt(energyByTier[String(tier)]!) * prices.energy
        + BigInt(bandwidthByTier[String(tier)]!) * prices.bandwidth;
      return [tier, (raw * BigInt(this.config.feeLimitMultiplierBps) + 9_999n) / 10_000n];
    }));
  }

  private input(calldata: string): string { return calldata.replace(/^0x/, ""); }

  async simulate(calldata: string, operation: RelayedOperation): Promise<SimulationResult> {
    const contract = displayAddress(this.config.gravArc, "tron");
    const options = { input: this.input(calldata), callValue: 0, feeLimit: this.config.maxFeeSun };
    try {
      const constant = await this.tronWeb.transactionBuilder.triggerConstantContract(contract, "", options, [], this.relayerDisplay) as TronWrapper;
      if (!constant.result?.result) throw new SimulationRejectedError(reason(constant.result?.message, "TRON constant execution rejected the operation"));
      const estimate = await this.tronWeb.transactionBuilder.estimateEnergy(contract, "", options, [], this.relayerDisplay) as TronWrapper;
      if (!estimate.result?.result || !Number.isSafeInteger(estimate.energy_required)) {
        throw new SimulationRejectedError(reason(estimate.result?.message, "TRON energy estimation rejected the operation"));
      }
      const energy = BigInt(estimate.energy_required!);
      if (energy > BigInt(this.config.maxEnergy)) throw new SimulationRejectedError(`Estimated energy ${energy} exceeds configured maximum ${this.config.maxEnergy}`);
      const prices = await this.resourcePrices();
      const bandwidthEstimates = operation === "refund" ? this.config.refundBandwidthByTier : this.config.bandwidthByTier;
      const bandwidth = BigInt(Math.max(...Object.values(bandwidthEstimates)));
      const cost = energy * prices.energy + bandwidth * prices.bandwidth;
      const feeLimit = (cost * BigInt(this.config.feeLimitMultiplierBps) + 9_999n) / 10_000n;
      const transactionLimit = feeLimit > BigInt(this.config.maxFeeSun) ? BigInt(this.config.maxFeeSun) : feeLimit;
      return { executionUnits: energy, transactionLimit, nativeCost: transactionLimit };
    } catch (error) {
      if (error instanceof SimulationRejectedError) throw error;
      throw error;
    }
  }

  async simulatedNativeCost(simulation: SimulationResult): Promise<bigint> { return simulation.nativeCost; }

  async sign(calldata: string, simulation: SimulationResult): Promise<SignedTransaction> {
    const contract = displayAddress(this.config.gravArc, "tron");
    const feeLimit = Number(simulation.transactionLimit);
    const built = await this.tronWeb.transactionBuilder.triggerSmartContract(
      contract, "", { input: this.input(calldata), callValue: 0, feeLimit }, [], this.relayerDisplay,
    ) as TronWrapper;
    if (!built.result?.result || !built.transaction) throw new Error(reason(built.result?.message, "Could not build TRON relayer transaction"));
    const transaction = built.transaction as Parameters<typeof this.tronWeb.transactionBuilder.extendExpiration>[0];
    const extended = await this.tronWeb.transactionBuilder.extendExpiration(transaction, 5 * 60);
    const signed = await this.tronWeb.trx.signTransaction(extended, this.privateKey) as unknown as Record<string, unknown>;
    const hash = String(signed.txID ?? "");
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Could not derive signed TRON transaction hash");
    return { hash, payload: JSON.stringify(signed) };
  }

  async broadcast(transaction: SignedTransaction): Promise<void> {
    const payload = JSON.parse(transaction.payload) as Parameters<typeof this.tronWeb.trx.sendRawTransaction>[0];
    const response = await this.tronWeb.trx.sendRawTransaction(payload);
    if (!response.result) {
      const info = await this.tronWeb.trx.getTransaction(transaction.hash).catch(() => undefined);
      if (!info || Object.keys(info).length === 0) throw new Error(reason(response.message, `TRON broadcast failed: ${response.code ?? "unknown"}`));
    }
  }

  async transactionStatus(hash: string): Promise<TransactionStatus> {
    const info = await this.tronWeb.trx.getTransactionInfo(hash.replace(/^0x/, ""));
    if (!info || Object.keys(info).length === 0) return { state: "pending" };
    if (info.result === "FAILED" || info.receipt?.result === "OUT_OF_ENERGY" || info.receipt?.result === "REVERT") {
      return { state: "failed", blockNumber: info.blockNumber, reason: reason(info.resMessage, info.receipt?.result ?? "TRON transaction failed") };
    }
    const block = await this.tronWeb.trx.getCurrentBlock();
    const current = Number(block.block_header?.raw_data?.number ?? info.blockNumber);
    return { state: "confirmed", blockNumber: info.blockNumber ?? 0, confirmations: Math.max(1, current - (info.blockNumber ?? current) + 1) };
  }

  close(): void { /* TronWeb has no persistent provider teardown API. */ }
}
