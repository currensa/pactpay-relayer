import { Interface } from "ethers";
import { RelayerError } from "../common/errors";
import { canonicalAddress } from "../chain/address";
import { GRAVARC_WITHDRAW_ABI } from "../chain/abi";
import type { ChainFamily, CircuitTier } from "../config/types";

const iface = new Interface(GRAVARC_WITHDRAW_ABI);
const TIERS = new Set<number>([8, 16, 32, 64, 128]);

export type ParsedWithdrawal = {
  nullifierHash: string;
  recipient: string;
  claimedAmount: bigint;
  token: string;
  tier: CircuitTier;
  depositRoot: bigint;
  expectedAmount: bigint;
  fee: bigint;
  relayer: string;
  nonce: bigint;
};

export function parseWithdrawalCalldata(calldata: string, family: ChainFamily, maxBytes: number): ParsedWithdrawal {
  if (!/^0x[0-9a-fA-F]+$/.test(calldata) || calldata.length % 2 !== 0) throw new RelayerError("CALLDATA_INVALID", "Calldata must be even-length hexadecimal");
  if ((calldata.length - 2) / 2 > maxBytes) throw new RelayerError("CALLDATA_TOO_LARGE", "Calldata exceeds the configured size limit", 413);
  let parsed;
  try { parsed = iface.parseTransaction({ data: calldata }); }
  catch { throw new RelayerError("CALLDATA_INVALID", "Calldata is not a valid GravArc withdrawal"); }
  if (!parsed || parsed.name !== "withdraw" || parsed.args.length !== 1) throw new RelayerError("METHOD_UNSUPPORTED", "Only GravArc.withdraw calldata is accepted", 422);
  const p = parsed.args[0] as Record<string, unknown>;
  const tier = Number(p.tier);
  if (!TIERS.has(tier)) throw new RelayerError("TIER_UNSUPPORTED", "Withdrawal tier is unsupported", 422);
  const nullifierHash = String(p.nullifierHash).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(nullifierHash)) throw new RelayerError("NULLIFIER_INVALID", "Withdrawal nullifier hash is invalid");
  try {
    return {
      nullifierHash,
      recipient: canonicalAddress(String(p.recipient), family),
      claimedAmount: BigInt(String(p.claimedAmount)),
      token: canonicalAddress(String(p.token), family),
      tier: tier as CircuitTier,
      depositRoot: BigInt(String(p.depositRoot)),
      expectedAmount: BigInt(String(p.expectedAmount)),
      fee: BigInt(String(p.fee)),
      relayer: canonicalAddress(String(p.relayer), family),
      nonce: BigInt(String(p.nonce)),
    };
  } catch (error) {
    if (error instanceof RelayerError) throw error;
    throw new RelayerError("CALLDATA_INVALID", "Withdrawal parameters are invalid");
  }
}
