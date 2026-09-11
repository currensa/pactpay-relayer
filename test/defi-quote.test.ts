import assert from "node:assert/strict";
import test from "node:test";
import { QuoteService } from "../src/quotes/quote.service";
import { configuration, evmChain, zero } from "./helpers";
import type { ChainService } from "../src/chain/chain.service";
import type { DatabaseService } from "../src/database/database.service";
import type { PricingService } from "../src/pricing/pricing.service";
import type { QuoteRecord } from "../src/database/types";

test("DeFi total budgets reserve fees and maximize the routed amount", async () => {
  const chain = { ...evmChain(), defiRouter: zero, pureRouter: zero,
    defiProtocols: [{ name: "Mock", type: "mock-swap", address: zero, helpContracts: {} }] };
  const service = new QuoteService(configuration(":memory:", chain), {
    get: () => ({ relayerCanonical: zero, estimateNativeNetworkCosts: async () => new Map([[8, 100n]]) }),
  } as unknown as ChainService, {
    insertQuote: (quote: QuoteRecord) => quote,
  } as unknown as DatabaseService, {
    networkCostInToken: async () => ({ amount: 100n }),
  } as unknown as PricingService);
  for (const budget of [10000n, 10001n, 10002n, 100000000000000000000n]) {
    const quote = await service.createDefi({ chainId: chain.chainId, token: zero, amount: budget.toString(), tier: 8 });
    const routed = BigInt(quote.amount);
    assert.ok(routed + BigInt(quote.fee) <= budget);
    const next = routed + 1n;
    assert.ok(next + 100n + (next * 10n + 9999n) / 10000n > budget);
  }
  await assert.rejects(service.createDefi({ chainId: chain.chainId, token: zero, amount: "100", tier: 8 }), /cannot cover/);
  await assert.rejects(
    service.createDefi({ chainId: chain.chainId, token: zero, amount: "201", tier: 8 }),
    /maximum percentage/,
  );
  const boundary = await service.createDefi({ chainId: chain.chainId, token: zero, amount: "202", tier: 8 });
  assert.equal(boundary.amount, "101");
  assert.equal(boundary.fee, "101");
});

test("private re-deposit quotes add and bind the deposit-tier network cost", async () => {
  const chain = { ...evmChain(), defiRouter: zero, pureRouter: zero,
    defiProtocols: [{ name: "Mock", type: "mock-swap", address: zero, helpContracts: {} }] };
  const service = new QuoteService(configuration(":memory:", chain), {
    get: () => ({
      relayerCanonical: zero,
      estimateNativeNetworkCosts: async (_operation: string, _tiers: number[], redepositTier?: number) => (
        new Map([[8, redepositTier === undefined ? 100n : 200n]])
      ),
    }),
  } as unknown as ChainService, {
    insertQuote: (quote: QuoteRecord) => quote,
  } as unknown as DatabaseService, {
    networkCostInToken: async (_chain: unknown, _token: unknown, amount: bigint) => ({ amount }),
  } as unknown as PricingService);

  const publicQuote = await service.createDefi({ chainId: chain.chainId, token: zero, amount: "10000", tier: 8 });
  const privateQuote = await service.createDefi({
    chainId: chain.chainId, token: zero, amount: "10000", tier: 8, privateRedeposit: true, redepositTier: 8,
  });
  assert.equal(publicQuote.networkFee, "100");
  assert.equal(publicQuote.privateRedeposit, false);
  assert.equal(privateQuote.networkFee, "200");
  assert.equal(privateQuote.privateRedeposit, true);
  assert.equal(privateQuote.redepositTier, 8);
  assert.throws(
    () => service.createDefi({ chainId: chain.chainId, token: zero, amount: "10000", tier: 8, privateRedeposit: true }),
    /requires redepositTier/,
  );
});
