import assert from "node:assert/strict";
import test from "node:test";
import { TronChainAdapter } from "../src/chain/tron.adapter";
import type { TronChainConfig } from "../src/config/types";
import { zero } from "./helpers";

const tiers = { "8": 100, "16": 100, "32": 100, "64": 100, "128": 100 };
const bandwidth = { "8": 100, "16": 200, "32": 500, "64": 1_000, "128": 5_000 };

function chain(): TronChainConfig {
  return {
    chainId: 3448148188, name: "Nile", family: "tron", rpcUrl: "https://nile.trongrid.io",
    gravArc: "0x0943dcbaa39ee8548fc1865b22614fbbfbdc3d95", privateKeyEnv: "TEST_KEY", defiProtocols: [],
    confirmations: 1, nativeSymbol: "TRX", nativeDecimals: 6, tokens: [{ symbol: "TRX", address: zero, decimals: 6 }], allowedTokens: [zero],
    energyByTier: tiers, bandwidthByTier: bandwidth, refundEnergyByTier: tiers, refundBandwidthByTier: bandwidth,
    defiEnergyByTier: tiers, defiBandwidthByTier: bandwidth,
    maxEnergy: 3_000_000, maxFeeSun: 1_000_000_000, feeLimitMultiplierBps: 12_000,
  };
}

test("uses successful constant-call energy without executing the proof a second time", async () => {
  const adapter = new TronChainAdapter(chain(), "01".padStart(64, "0"));
  let estimateCalled = false;
  adapter.tronWeb.transactionBuilder.triggerConstantContract = async () => ({
    result: { result: true }, energy_used: 334_565,
  }) as never;
  adapter.tronWeb.transactionBuilder.estimateEnergy = async () => {
    estimateCalled = true;
    throw new Error("estimateEnergy should not be called");
  };
  adapter.tronWeb.trx.getChainParameters = async () => [
    { key: "getEnergyFee", value: 100 }, { key: "getTransactionFee", value: 1_000 },
  ] as never;

  const result = await adapter.simulate("0x1234", "withdraw", 8);

  assert.equal(result.executionUnits, 334_565n);
  assert.equal(result.transactionLimit, 40_267_800n);
  assert.equal(estimateCalled, false);
});
