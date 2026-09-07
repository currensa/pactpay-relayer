import { AbiCoder, Interface, concat, getBytes, keccak256 } from "ethers";
import { canonicalAddress } from "../chain/address";
import { DEFI_ROUTER_ABI } from "../chain/abi";
import { RelayerError } from "../common/errors";
import type { ChainConfig, CircuitTier } from "../config/types";

const iface = new Interface(DEFI_ROUTER_ABI);
const coder = AbiCoder.defaultAbiCoder();
const tiers = new Set([8, 16, 32, 64, 128]);

export type ParsedDefi = {
  nullifierHash: string;
  nonce: bigint;
  token: string;
  tier: CircuitTier;
  expectedAmount: bigint;
  defiAmount: bigint;
  defiFee: bigint;
  reservationKey: string;
};

export function parseDefiCalldata(calldata: string, chain: ChainConfig, maxBytes: number): ParsedDefi {
  if (!/^0x[0-9a-fA-F]+$/.test(calldata) || calldata.length % 2 !== 0) throw new RelayerError("CALLDATA_INVALID", "Calldata must be even-length hexadecimal");
  if ((calldata.length - 2) / 2 > maxBytes) throw new RelayerError("CALLDATA_TOO_LARGE", "Calldata exceeds the configured size limit", 413);
  let parsed;
  try { parsed = iface.parseTransaction({ data: calldata }); }
  catch { throw new RelayerError("CALLDATA_INVALID", "Calldata is not a valid DeFi routing call"); }
  if (!parsed || parsed.name !== "defiRouting" || parsed.args.length !== 2) throw new RelayerError("METHOD_UNSUPPORTED", "Only PactPrivacyDefiRouter.defiRouting calldata is accepted", 422);
  if (!chain.defiRouter || !chain.pureRouter) throw new RelayerError("DEFI_UNAVAILABLE", "DeFi relay is not configured for this chain", 422);
  const withdrawal = parsed.args[0] as Record<string, unknown>;
  const defi = parsed.args[1] as Record<string, unknown>;
  const tier = Number(withdrawal.tier);
  if (!tiers.has(tier)) throw new RelayerError("TIER_UNSUPPORTED", "DeFi withdrawal tier is unsupported", 422);
  const nullifierHash = String(withdrawal.nullifierHash).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(nullifierHash)) throw new RelayerError("NULLIFIER_INVALID", "DeFi nullifier hash is invalid");
  try {
    const expectedAmount = BigInt(String(withdrawal.expectedAmount));
    const withdrawFee = BigInt(String(withdrawal.fee));
    const defiFee = BigInt(String(defi.defiFee));
    const nonce = BigInt(String(withdrawal.nonce));
    if (withdrawFee !== expectedAmount || defiFee >= expectedAmount) throw new RelayerError("DEFI_AMOUNT_INVALID", "DeFi withdrawal amount or fee binding is invalid", 422);
    if (canonicalAddress(String(withdrawal.relayer), chain.family) !== chain.defiRouter) throw new RelayerError("RELAYER_MISMATCH", "Withdrawal proof is not bound to the configured DeFi router", 409);
    const calls = Array.from(defi.defiCalls as ArrayLike<Record<string, unknown>>).map((call) => ({
      target: canonicalAddress(String(call.target), chain.family), value: BigInt(String(call.value)), data: String(call.data).toLowerCase(),
    }));
    if (calls.length === 0 || calls.length > 16) throw new RelayerError("DEFI_CALLS_INVALID", "DeFi call count is invalid", 422);
    const allowed = new Set([
      chain.gravArc, chain.pureRouter,
      ...chain.allowedTokens,
      ...chain.defiProtocols.flatMap((protocol) => [protocol.address, ...protocol.helpContracts]),
    ]);
    if (calls.some((call) => !allowed.has(call.target) || !/^0x[0-9a-f]*$/.test(call.data))) {
      throw new RelayerError("DEFI_TARGET_UNSUPPORTED", "DeFi calldata contains a target outside the configured allowlist", 422);
    }
    if (!calls.some((call) => chain.defiProtocols.some((protocol) => protocol.address === call.target))) {
      throw new RelayerError("DEFI_PROTOCOL_MISSING", "DeFi calldata does not call a configured protocol", 422);
    }
    if (chain.family === "tron" && calls.some((call) => call.target === chain.gravArc)) {
      throw new RelayerError("TRON_REDEPOSIT_UNSUPPORTED", "Private re-deposit is not supported on TRON", 422);
    }
    const callHashes = calls.map((call) => keccak256(coder.encode(["address", "uint256", "bytes"], [call.target, call.value, call.data])));
    const callsHash = keccak256(concat(callHashes.map((hash) => getBytes(hash))));
    const commitment = `0x${keccak256(coder.encode(["uint256", "bytes32"], [defiFee, callsHash])).slice(-40)}`;
    if (canonicalAddress(String(withdrawal.recipient), chain.family) !== commitment) throw new RelayerError("DEFI_COMMITMENT_MISMATCH", "DeFi call commitment is invalid", 409);
    return {
      nullifierHash, nonce, token: canonicalAddress(String(withdrawal.token), chain.family), tier: tier as CircuitTier,
      expectedAmount, defiAmount: expectedAmount - defiFee, defiFee,
      reservationKey: `${nullifierHash}:${nonce}`,
    };
  } catch (error) {
    if (error instanceof RelayerError) throw error;
    throw new RelayerError("CALLDATA_INVALID", "DeFi routing parameters are invalid");
  }
}
