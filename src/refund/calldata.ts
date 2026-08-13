import { Interface, concat, keccak256 } from "ethers";
import { canonicalAddress } from "../chain/address";
import { GRAVARC_REFUND_ABI } from "../chain/abi";
import { RelayerError } from "../common/errors";
import type { ChainFamily, CircuitTier } from "../config/types";

const iface = new Interface(GRAVARC_REFUND_ABI);
const TIERS = new Set<number>([8, 16, 32, 64, 128]);

export type ParsedRefund = {
  depositRoot: bigint;
  nullifierHashes: string[];
  reservationKey: string;
  token: string;
  refundAmount: bigint;
  fee: bigint;
  relayer: string;
  refunder: string;
  tier: CircuitTier;
};

export function parseRefundCalldata(calldata: string, family: ChainFamily, maxBytes: number): ParsedRefund {
  if (!/^0x[0-9a-fA-F]+$/.test(calldata) || calldata.length % 2 !== 0) throw new RelayerError("CALLDATA_INVALID", "Calldata must be even-length hexadecimal");
  if ((calldata.length - 2) / 2 > maxBytes) throw new RelayerError("CALLDATA_TOO_LARGE", "Calldata exceeds the configured size limit", 413);
  let parsed;
  try { parsed = iface.parseTransaction({ data: calldata }); }
  catch { throw new RelayerError("CALLDATA_INVALID", "Calldata is not a valid GravArc refund"); }
  if (!parsed || parsed.name !== "refund" || parsed.args.length !== 1) throw new RelayerError("METHOD_UNSUPPORTED", "Only GravArc.refund calldata is accepted", 422);
  const p = parsed.args[0] as Record<string, unknown>;
  const tier = Number(p.tier);
  if (!TIERS.has(tier)) throw new RelayerError("TIER_UNSUPPORTED", "Refund tier is unsupported", 422);
  const nullifierHashes = Array.from(p.nullifierHash as ArrayLike<unknown>, (value) => String(value).toLowerCase());
  if (nullifierHashes.length !== tier || nullifierHashes.some((value) => !/^0x[0-9a-f]{64}$/.test(value))) {
    throw new RelayerError("NULLIFIER_INVALID", "Refund must contain exactly one valid nullifier hash per tier slot");
  }
  if (new Set(nullifierHashes).size !== nullifierHashes.length) throw new RelayerError("NULLIFIER_INVALID", "Refund nullifier hashes must be unique");
  try {
    return {
      depositRoot: BigInt(String(p.depositRoot)),
      nullifierHashes,
      reservationKey: keccak256(concat(nullifierHashes)),
      token: canonicalAddress(String(p.token), family),
      refundAmount: BigInt(String(p.refundAmount)),
      fee: BigInt(String(p.fee)),
      relayer: canonicalAddress(String(p.relayer), family),
      refunder: canonicalAddress(String(p.refunder), family),
      tier: tier as CircuitTier,
    };
  } catch (error) {
    if (error instanceof RelayerError) throw error;
    throw new RelayerError("CALLDATA_INVALID", "Refund parameters are invalid");
  }
}
