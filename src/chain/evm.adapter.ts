import { JsonRpcProvider, Transaction, Wallet, getAddress } from "ethers";
import { SimulationRejectedError } from "../common/errors";
import type { CircuitTier, EvmChainConfig, RelayedOperation } from "../config/types";
import { canonicalAddress } from "./address";
import type { ChainAdapter, SignedTransaction, SimulationResult, TransactionStatus } from "./types";

function rejected(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "CALL_EXCEPTION" || code === "ACTION_REJECTED";
}

function message(error: unknown): string {
  const candidate = error as { shortMessage?: unknown; reason?: unknown; message?: unknown };
  if (typeof candidate.reason === "string") return candidate.reason;
  if (typeof candidate.shortMessage === "string") return candidate.shortMessage;
  if (typeof candidate.message === "string") return candidate.message;
  return String(error);
}

export class EvmChainAdapter implements ChainAdapter {
  readonly provider: JsonRpcProvider;
  readonly wallet: Wallet;
  readonly relayerCanonical: string;
  readonly relayerDisplay: string;

  constructor(readonly config: EvmChainConfig, privateKey: string) {
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
    this.wallet = new Wallet(privateKey, this.provider);
    this.relayerCanonical = canonicalAddress(this.wallet.address, "evm");
    this.relayerDisplay = getAddress(this.wallet.address);
  }

  async checkConnection(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(this.config.chainId)) throw new Error(`RPC chain ID ${network.chainId} does not match ${this.config.chainId}`);
    await this.provider.getBlockNumber();
  }

  async estimateNativeNetworkCosts(operation: RelayedOperation, tiers: CircuitTier[]): Promise<Map<CircuitTier, bigint>> {
    const fees = await this.provider.getFeeData();
    const gasPrice = fees.maxFeePerGas ?? fees.gasPrice;
    if (gasPrice === null) throw new Error(`Chain ${this.config.chainId} did not return a gas price`);
    const estimates = operation === "refund" ? this.config.refundGasByTier : this.config.gasByTier;
    return new Map(tiers.map((tier) => [tier,
      (BigInt(estimates[String(tier)]!) * BigInt(this.config.gasLimitMultiplierBps) + 9_999n) / 10_000n * gasPrice,
    ]));
  }

  async simulate(calldata: string, _operation: RelayedOperation, _tier: CircuitTier): Promise<SimulationResult> {
    const request = { from: this.relayerDisplay, to: getAddress(this.config.gravArc), data: calldata, value: 0n };
    try {
      await this.provider.send("eth_call", [{
        from: request.from,
        to: request.to,
        data: request.data,
        value: "0x0",
      }, "pending"]);
      const gas = await this.provider.estimateGas(request);
      if (gas > BigInt(this.config.maxGas)) throw new SimulationRejectedError(`Estimated gas ${gas} exceeds configured maximum ${this.config.maxGas}`);
      const limit = (gas * BigInt(this.config.gasLimitMultiplierBps) + 9_999n) / 10_000n;
      const fees = await this.provider.getFeeData();
      const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
      if (feePerGas === null) throw new Error(`Chain ${this.config.chainId} did not return a gas price`);
      return {
        executionUnits: gas,
        transactionLimit: limit,
        nativeCost: limit * feePerGas,
        signingData: fees.maxFeePerGas !== null && fees.maxPriorityFeePerGas !== null
          ? { maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() }
          : { gasPrice: feePerGas.toString() },
      };
    } catch (error) {
      if (error instanceof SimulationRejectedError) throw error;
      if (rejected(error)) throw new SimulationRejectedError(message(error));
      throw error;
    }
  }

  async simulatedNativeCost(simulation: SimulationResult): Promise<bigint> { return simulation.nativeCost; }

  async sign(calldata: string, simulation: SimulationResult): Promise<SignedTransaction> {
    const nonce = await this.provider.getTransactionCount(this.wallet.address, "pending");
    const maxFeePerGas = simulation.signingData?.maxFeePerGas;
    const maxPriorityFeePerGas = simulation.signingData?.maxPriorityFeePerGas;
    const gasPrice = simulation.signingData?.gasPrice;
    if ((!maxFeePerGas || !maxPriorityFeePerGas) && !gasPrice) throw new Error("Simulation has no locked EVM fee data");
    const transaction = {
      chainId: this.config.chainId,
      nonce,
      to: getAddress(this.config.gravArc),
      data: calldata,
      value: 0n,
      gasLimit: simulation.transactionLimit,
      ...(maxFeePerGas && maxPriorityFeePerGas
        ? { type: 2, maxFeePerGas: BigInt(maxFeePerGas), maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas) }
        : { gasPrice: BigInt(gasPrice!) }),
    };
    const payload = await this.wallet.signTransaction(transaction);
    const hash = Transaction.from(payload).hash;
    if (!hash) throw new Error("Could not derive signed EVM transaction hash");
    return { hash, payload };
  }

  async broadcast(transaction: SignedTransaction): Promise<void> {
    try {
      const response = await this.provider.broadcastTransaction(transaction.payload);
      if (response.hash.toLowerCase() !== transaction.hash.toLowerCase()) throw new Error("Broadcast transaction hash mismatch");
    } catch (error) {
      const existing = await this.provider.getTransaction(transaction.hash).catch(() => null);
      if (!existing) throw error;
    }
  }

  async transactionStatus(hash: string): Promise<TransactionStatus> {
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt) return { state: "pending" };
    if (receipt.status !== 1) return { state: "failed", blockNumber: receipt.blockNumber, reason: "Transaction reverted" };
    const current = await this.provider.getBlockNumber();
    return { state: "confirmed", blockNumber: receipt.blockNumber, confirmations: Math.max(1, current - receipt.blockNumber + 1) };
  }

  close(): void { this.provider.destroy(); }
}
