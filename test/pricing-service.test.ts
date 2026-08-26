import assert from "node:assert/strict";
import test from "node:test";
import { PricingService } from "../src/pricing/pricing.service";
import { configuration, evmChain } from "./helpers";

test("fetches, caches, and conservatively converts CoinGecko USD prices", async () => {
  const chain = evmChain();
  chain.nativePriceAssetId = "test-native";
  const token = {
    symbol: "USDC",
    address: "0x2222222222222222222222222222222222222222",
    decimals: 6,
    priceAssetId: "usd-coin",
  };
  chain.tokens.push(token);
  const secondToken = {
    symbol: "JST",
    address: "0x3333333333333333333333333333333333333333",
    decimals: 6,
    priceAssetId: "just",
  };
  chain.tokens.push(secondToken);
  const config = configuration(":memory:", chain);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    const updated = Math.floor(Date.now() / 1000);
    return new Response(JSON.stringify({
      "test-native": { usd: 0.5, last_updated_at: updated },
      "usd-coin": { usd: 1, last_updated_at: updated },
      "just": { usd: 0.25, last_updated_at: updated },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const pricing = new PricingService(config);
    const [first, other] = await Promise.all([
      pricing.networkCostInToken(chain, token, 10n ** 6n),
      pricing.networkCostInToken(chain, secondToken, 10n ** 6n),
    ]);
    const second = await pricing.networkCostInToken(chain, token, 10n ** 6n);
    assert.equal(first.amount, 525_000n);
    assert.equal(other.amount, 2_100_000n);
    assert.equal(second.amount, 525_000n);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects stale CoinGecko prices", async () => {
  const chain = evmChain();
  chain.nativePriceAssetId = "test-native";
  const token = {
    symbol: "USDC",
    address: "0x2222222222222222222222222222222222222222",
    decimals: 6,
    priceAssetId: "usd-coin",
  };
  chain.tokens.push(token);
  const config = configuration(":memory:", chain);
  config.value.pricingMaxAgeSeconds = 10;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const updated = Math.floor(Date.now() / 1000) - 60;
    return new Response(JSON.stringify({
      "test-native": { usd: 0.5, last_updated_at: updated },
      "usd-coin": { usd: 1, last_updated_at: updated },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await assert.rejects(() => new PricingService(config).conversion(chain, token), /stale/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
