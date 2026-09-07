import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, concat, getBytes, keccak256 } from "ethers";
import { DEFI_ROUTER_ABI } from "../src/chain/abi";
import { parseDefiCalldata } from "../src/defi/calldata";
import { evmChain } from "./helpers";

const protocol = "0x1111111111111111111111111111111111111111";
const inputToken = "0x2222222222222222222222222222222222222222";
const defiRouter = "0x3333333333333333333333333333333333333333";
const pureRouter = "0x5555555555555555555555555555555555555555";

function calldata(calls = [{ target: protocol, value: 0n, data: "0x1234" }]) {
  const coder = AbiCoder.defaultAbiCoder();
  const hashes = calls.map((call) => keccak256(coder.encode(["address", "uint256", "bytes"], [call.target, call.value, call.data])));
  const commitment = `0x${keccak256(coder.encode(["uint256", "bytes32"], [10n, keccak256(concat(hashes.map((hash) => getBytes(hash))))])).slice(-40)}`;
  return new Interface(DEFI_ROUTER_ABI).encodeFunctionData("defiRouting", [{
    pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n], nullifierHash: `0x${"aa".repeat(32)}`,
    recipient: commitment, claimedAmount: 0n, token: inputToken, tier: 8, depositRoot: 9n,
    expectedAmount: 110n, fee: 110n, relayer: defiRouter, nonce: 2n,
  }, { defiFee: 10n, defiCalls: calls }]);
}

test("validates proof-bound DeFi calldata and derives the routed amount", () => {
  const chain = {
    ...evmChain(), defiRouter, pureRouter, allowedTokens: [inputToken],
    defiProtocols: [{ name: "MockSwap", type: "mock-swap", address: protocol, helpContracts: [] }],
  };
  const result = parseDefiCalldata(calldata(), chain, 65_536);
  assert.equal(result.defiAmount, 100n);
  assert.equal(result.defiFee, 10n);
  assert.equal(result.reservationKey, `${result.nullifierHash}:2`);
});

test("rejects DeFi calldata when the protocol target is not allowlisted", () => {
  const chain = { ...evmChain(), defiRouter, pureRouter, allowedTokens: [inputToken], defiProtocols: [] };
  assert.throws(() => parseDefiCalldata(calldata(), chain, 65_536), /outside the configured allowlist/);
});

test("rejects private re-deposit calls on TRON", () => {
  const base = evmChain();
  const resources = { "8": 100, "16": 100, "32": 100, "64": 100, "128": 100 };
  const chain = {
    ...base,
    family: "tron" as const,
    defiRouter,
    pureRouter,
    allowedTokens: [inputToken],
    defiProtocols: [{ name: "SunSwap V4", type: "sunswap-v4", address: protocol, helpContracts: [] }],
    energyByTier: resources,
    bandwidthByTier: resources,
    refundEnergyByTier: resources,
    refundBandwidthByTier: resources,
    defiEnergyByTier: resources,
    defiBandwidthByTier: resources,
    maxEnergy: 10_000,
    maxFeeSun: 10_000,
    feeLimitMultiplierBps: 10_000,
  };
  assert.throws(() => parseDefiCalldata(calldata([
    { target: protocol, value: 0n, data: "0x1234" },
    { target: base.gravArc, value: 0n, data: "0x5678" },
  ]), chain, 65_536), /Private re-deposit is not supported on TRON/);
});
