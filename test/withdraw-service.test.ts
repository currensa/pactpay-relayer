import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Interface } from "ethers";
import { GRAVARC_WITHDRAW_ABI } from "../src/chain/abi";
import type { ChainService } from "../src/chain/chain.service";
import type { ChainAdapter } from "../src/chain/types";
import { DatabaseService } from "../src/database/database.service";
import { OperationService } from "../src/operations/operation.service";
import { PricingService } from "../src/pricing/pricing.service";
import { QuoteService } from "../src/quotes/quote.service";
import { WithdrawService } from "../src/withdraw/withdraw.service";
import { configuration, evmChain, zero } from "./helpers";

test("locks the floating fee and returns the same operation for an exact retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pactpay-relayer-"));
  const config = configuration(join(directory, "relayer.db"));
  const database = new DatabaseService(config);
  const chain = evmChain();
  const relayer = "0x2222222222222222222222222222222222222222";
  const adapter = {
    config: chain,
    relayerCanonical: relayer,
    relayerDisplay: relayer,
    estimateNativeNetworkCosts: async () => new Map([[8, 100n]]),
  } as unknown as ChainAdapter;
  const chains = { get: () => adapter } as unknown as ChainService;
  const quotes = new QuoteService(config, chains, database, new PricingService(config));
  const quote = await quotes.create({ chainId: chain.chainId, token: zero, amount: "1000000", tier: 8 });
  assert.equal(quote.networkFee, "100");
  assert.equal(quote.serviceFee, "1000");
  assert.equal(quote.fee, "1100");

  const calldata = new Interface(GRAVARC_WITHDRAW_ABI).encodeFunctionData("withdraw", [{
    pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n],
    nullifierHash: `0x${"aa".repeat(32)}`, recipient: "0x1111111111111111111111111111111111111111",
    claimedAmount: 0n, token: zero, tier: 8, depositRoot: 9n,
    expectedAmount: 1_000_000n, fee: 1_100n, relayer, nonce: 0n,
  }]);
  const withdrawals = new WithdrawService(config, quotes, new OperationService(database));
  const first = withdrawals.submit({ chainId: chain.chainId, quoteId: quote.id, calldata });
  const repeated = withdrawals.submit({ chainId: chain.chainId, quoteId: quote.id, calldata });
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.operation.id, first.operation.id);

  database.onModuleDestroy();
  await rm(directory, { recursive: true, force: true });
});
