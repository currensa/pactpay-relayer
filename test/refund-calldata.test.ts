import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { GRAVARC_REFUND_ABI } from "../src/chain/abi";
import { parseRefundCalldata } from "../src/refund/calldata";

const relayer = "0x2222222222222222222222222222222222222222";
const refunder = "0x1111111111111111111111111111111111111111";
const token = "0x3333333333333333333333333333333333333333";

function calldata(nullifiers = Array.from({ length: 8 }, (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`)): string {
  return new Interface(GRAVARC_REFUND_ABI).encodeFunctionData("refund", [{
    pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n], depositRoot: 9n,
    nullifierHash: nullifiers, token, refundAmount: 1_000_000n, fee: 2_000n,
    relayer, refunder, tier: 8,
  }]);
}

test("decodes a tier-sized GravArc refund and derives a stable reservation", () => {
  const result = parseRefundCalldata(calldata(), "evm", 65_536);
  assert.equal(result.refunder, refunder);
  assert.equal(result.relayer, relayer);
  assert.equal(result.token, token);
  assert.equal(result.refundAmount, 1_000_000n);
  assert.equal(result.nullifierHashes.length, 8);
  assert.match(result.reservationKey, /^0x[0-9a-f]{64}$/);
  assert.equal(parseRefundCalldata(calldata(), "evm", 65_536).reservationKey, result.reservationKey);
});

test("rejects malformed, oversized, or duplicate refund nullifiers", () => {
  assert.throws(() => parseRefundCalldata("0x1234", "evm", 65_536), /GravArc(?:\.| )refund/);
  assert.throws(() => parseRefundCalldata(calldata(), "evm", 8), /size limit/);
  const duplicate = Array.from({ length: 8 }, () => `0x${"11".repeat(32)}`);
  assert.throws(() => parseRefundCalldata(calldata(duplicate), "evm", 65_536), /must be unique/);
});
