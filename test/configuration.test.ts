import assert from "node:assert/strict";
import test from "node:test";
import { parseConfiguration } from "../src/config/configuration.service";

const token = "0x2222222222222222222222222222222222222222";

function publicConfiguration() {
  return {
    "12345": {
      chainName: "Test chain",
      family: "evm",
      rpcUrl: "wss://scanner.example",
      GravArc: "0x4444444444444444444444444444444444444444",
      erc20Tokens: [{ symbol: "USDC", name: "USD Coin", address: token }],
      wallet: {
        rpcUrls: ["https://wallet.example"],
        nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 },
      },
    },
  };
}

function relayerConfiguration(address = token) {
  return {
    chains: [{
      chainId: 12345,
      privateKeyEnv: "TEST_KEY",
      confirmations: 2,
      gasByTier: { "8": 100, "16": 110, "32": 120, "64": 130, "128": 140 },
      maxGas: 1000,
      nativePriceAssetId: "test-native",
      tokenPricing: [{ address, decimals: 6, priceAssetId: "usd-coin" }],
    }],
  };
}

test("merges public chain information with relayer policy", () => {
  const result = parseConfiguration(publicConfiguration(), relayerConfiguration());
  const chain = result.chains[0]!;
  assert.equal(chain.name, "Test chain");
  assert.equal(chain.rpcUrl, "https://wallet.example");
  assert.equal(chain.gravArc, "0x4444444444444444444444444444444444444444");
  assert.equal(chain.confirmations, 2);
  assert.equal(chain.nativePriceAssetId, "test-native");
  assert.deepEqual(chain.tokens.map((entry) => [entry.symbol, entry.priceAssetId]), [["TEST", undefined], ["USDC", "usd-coin"]]);
});

test("rejects pricing for a token outside the public allowlist", () => {
  assert.throws(
    () => parseConfiguration(publicConfiguration(), relayerConfiguration("0x3333333333333333333333333333333333333333")),
    /not listed in the public chain configuration/,
  );
});
