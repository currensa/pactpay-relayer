import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Interface } from "ethers";
import { GRAVARC_REFUND_ABI } from "../src/chain/abi";
import type { ChainService } from "../src/chain/chain.service";
import type { ChainAdapter } from "../src/chain/types";
import { DatabaseService } from "../src/database/database.service";
import { OperationService } from "../src/operations/operation.service";
import { PricingService } from "../src/pricing/pricing.service";
import { QuoteService } from "../src/quotes/quote.service";
import { RefundService } from "../src/refund/refund.service";
import { configuration, evmChain, zero } from "./helpers";

test("locks a refund fee and returns the same operation for an exact retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pactpay-relayer-"));
  const config = configuration(join(directory, "relayer.db"));
  const database = new DatabaseService(config);
  const chain = evmChain();
  const relayer = "0x2222222222222222222222222222222222222222";
  const adapter = {
    config: chain, relayerCanonical: relayer, relayerDisplay: relayer,
    estimateNativeNetworkCosts: async () => new Map([[8, 200n]]),
  } as unknown as ChainAdapter;
  const chains = { get: () => adapter } as unknown as ChainService;
  const quotes = new QuoteService(config, chains, database, new PricingService(config));
  const quote = await quotes.createRefund({ chainId: chain.chainId, token: zero, amount: "1000000", tier: 8 });
  assert.equal(quote.operation, "refund");
  assert.equal(quote.networkFee, "200");
  assert.equal(quote.serviceFee, "1000");
  assert.equal(quote.fee, "1200");

  const nullifiers = Array.from({ length: 8 }, (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`);
  const calldata = new Interface(GRAVARC_REFUND_ABI).encodeFunctionData("refund", [{
    pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n], depositRoot: 9n,
    nullifierHash: nullifiers, token: zero, refundAmount: 1_000_000n, fee: 1_200n,
    relayer, refunder: "0x1111111111111111111111111111111111111111", tier: 8,
  }]);
  const refunds = new RefundService(config, quotes, new OperationService(database));
  const first = refunds.submit({ chainId: chain.chainId, quoteId: quote.id, calldata });
  const repeated = refunds.submit({ chainId: chain.chainId, quoteId: quote.id, calldata });
  assert.equal(first.created, true);
  assert.equal(first.operation.operation, "refund");
  assert.equal(repeated.created, false);
  assert.equal(repeated.operation.id, first.operation.id);

  const withdrawQuote = await quotes.createWithdraw({ chainId: chain.chainId, token: zero, amount: "1000000", tier: 8 });
  assert.throws(
    () => refunds.submit({ chainId: chain.chainId, quoteId: withdrawQuote.id, calldata }),
    /does not authorize a refund/,
  );
  database.onModuleDestroy();
  await rm(directory, { recursive: true, force: true });
});
