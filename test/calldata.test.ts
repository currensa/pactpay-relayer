import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { GRAVARC_WITHDRAW_ABI } from "../src/chain/abi";
import { parseWithdrawalCalldata } from "../src/withdraw/calldata";

const receiver = "0x1111111111111111111111111111111111111111";
const relayer = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";

function calldata(): string {
  return new Interface(GRAVARC_WITHDRAW_ABI).encodeFunctionData("withdraw", [{
    pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n],
    nullifierHash: `0x${"ab".repeat(32)}`, recipient: receiver, claimedAmount: 9n,
    token, tier: 8, depositRoot: 10n, expectedAmount: 1_000_000n,
    fee: 2_000n, relayer, nonce: 3n,
  }]);
}

test("decodes only the supported GravArc withdrawal call", () => {
  const result = parseWithdrawalCalldata(calldata(), "evm", 65_536);
  assert.equal(result.recipient, receiver);
  assert.equal(result.relayer, relayer);
  assert.equal(result.token, token);
  assert.equal(result.expectedAmount, 1_000_000n);
  assert.equal(result.fee, 2_000n);
  assert.equal(result.nonce, 3n);
});

test("rejects malformed or oversized calldata before simulation", () => {
  assert.throws(() => parseWithdrawalCalldata("0x1234", "evm", 65_536), /GravArc\.withdraw/);
  assert.throws(() => parseWithdrawalCalldata(calldata(), "evm", 8), /size limit/);
});
