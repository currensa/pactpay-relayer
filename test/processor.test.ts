import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ChainService } from "../src/chain/chain.service";
import type { ChainAdapter, SignedTransaction, SimulationResult, TransactionStatus } from "../src/chain/types";
import { SimulationRejectedError } from "../src/common/errors";
import { DatabaseService } from "../src/database/database.service";
import { OperationProcessor } from "../src/operations/operation.processor";
import { PricingService } from "../src/pricing/pricing.service";
import { configuration, evmChain, zero } from "./helpers";

test("persists a signed payload before broadcast and confirms through polling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pactpay-relayer-"));
  const config = configuration(join(directory, "relayer.db"));
  const database = new DatabaseService(config);
  const chain = evmChain();
  let broadcasted = 0;
  let status: TransactionStatus = { state: "pending" };
  const adapter: ChainAdapter = {
    config: chain,
    relayerCanonical: "0x2222222222222222222222222222222222222222",
    relayerDisplay: "0x2222222222222222222222222222222222222222",
    checkConnection: async () => undefined,
    estimateNativeNetworkCosts: async () => new Map([[8, 100n]]),
    simulate: async (): Promise<SimulationResult> => ({ executionUnits: 100n, transactionLimit: 100n, nativeCost: 100n }),
    simulatedNativeCost: async () => 100n,
    sign: async (): Promise<SignedTransaction> => ({ hash: `0x${"55".repeat(32)}`, payload: "signed-raw" }),
    broadcast: async () => { broadcasted += 1; },
    transactionStatus: async () => status,
    close: () => undefined,
  };
  const chains = { get: () => adapter } as unknown as ChainService;
  const now = Date.now();
  database.insertQuote({
    id: "quote-3", operation: "withdraw", chainId: chain.chainId, gravArc: chain.gravArc,
    relayer: adapter.relayerCanonical, token: zero, amount: "1000000", tier: 8,
    networkFee: "100", serviceFee: "1000", fee: "1100", createdAt: now, expiresAt: now + 10,
  });
  database.createOperationFromQuote({
    id: "operation-3", operation: "withdraw", reservationKey: `0x${"77".repeat(32)}:0`, quoteId: "quote-3", chainId: chain.chainId, requestHash: `0x${"66".repeat(32)}`,
    nullifierHash: `0x${"77".repeat(32)}`, withdrawNonce: "0", calldata: "0x1234",
  });
  const processor = new OperationProcessor(config, database, chains, new PricingService(config));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await processor.tick();
  const submitted = database.getOperation("operation-3")!;
  assert.equal(submitted.state, "submitted");
  assert.equal(submitted.signedPayload, "signed-raw");
  assert.equal(broadcasted, 1);

  database.insertQuote({
    id: "quote-3b", operation: "withdraw", chainId: chain.chainId, gravArc: chain.gravArc,
    relayer: adapter.relayerCanonical, token: zero, amount: "1000000", tier: 8,
    networkFee: "100", serviceFee: "1000", fee: "1100", createdAt: Date.now(), expiresAt: Date.now() + 60_000,
  });
  database.createOperationFromQuote({
    id: "operation-3b", operation: "withdraw", reservationKey: `0x${"79".repeat(32)}:0`, quoteId: "quote-3b",
    chainId: chain.chainId, requestHash: `0x${"68".repeat(32)}`,
    nullifierHash: `0x${"79".repeat(32)}`, withdrawNonce: "0", calldata: "0x5678",
  });
  await processor.tick();
  assert.equal(database.getOperation("operation-3")?.state, "submitted");
  assert.equal(database.getOperation("operation-3b")?.state, "submitted");
  assert.equal(broadcasted, 2);

  status = { state: "confirmed", blockNumber: 10, confirmations: 1 };
  database.defer("operation-3", 0);
  await processor.tick();
  assert.equal(database.getOperation("operation-3")?.state, "confirmed");
  database.onModuleDestroy();
  await rm(directory, { recursive: true, force: true });
});

test("never signs or broadcasts a simulation-rejected proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pactpay-relayer-"));
  const config = configuration(join(directory, "relayer.db"));
  const database = new DatabaseService(config);
  const chain = evmChain();
  let signed = false;
  let broadcasted = false;
  const adapter = {
    config: chain,
    relayerCanonical: "0x2222222222222222222222222222222222222222",
    relayerDisplay: "0x2222222222222222222222222222222222222222",
    simulate: async () => { throw new SimulationRejectedError("Invalid proof"); },
    sign: async () => { signed = true; throw new Error("must not sign"); },
    broadcast: async () => { broadcasted = true; },
  } as unknown as ChainAdapter;
  const chains = { get: () => adapter } as unknown as ChainService;
  const now = Date.now();
  database.insertQuote({
    id: "quote-4", operation: "withdraw", chainId: chain.chainId, gravArc: chain.gravArc,
    relayer: adapter.relayerCanonical, token: zero, amount: "1000000", tier: 8,
    networkFee: "100", serviceFee: "1000", fee: "1100", createdAt: now, expiresAt: now + 60_000,
  });
  database.createOperationFromQuote({
    id: "operation-4", operation: "withdraw", reservationKey: `0x${"99".repeat(32)}:0`, quoteId: "quote-4", chainId: chain.chainId, requestHash: `0x${"88".repeat(32)}`,
    nullifierHash: `0x${"99".repeat(32)}`, withdrawNonce: "0", calldata: "0x1234",
  });
  await new OperationProcessor(config, database, chains, new PricingService(config)).tick();
  const result = database.getOperation("operation-4")!;
  assert.equal(result.state, "failed");
  assert.equal(result.errorCode, "SIMULATION_REJECTED");
  assert.equal(signed, false);
  assert.equal(broadcasted, false);
  database.onModuleDestroy();
  await rm(directory, { recursive: true, force: true });
});
