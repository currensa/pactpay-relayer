import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseService } from "../src/database/database.service";
import { configuration } from "./helpers";

test("consumes quotes atomically and reserves one nullifier nonce", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pactpay-relayer-"));
  const database = new DatabaseService(configuration(join(directory, "relayer.db")));
  const now = Date.now();
  database.insertQuote({
    id: "quote-1", operation: "withdraw", chainId: 12345, gravArc: "0x4444444444444444444444444444444444444444",
    relayer: "0x2222222222222222222222222222222222222222", token: "0x0000000000000000000000000000000000000000",
    amount: "1000000", tier: 8, networkFee: "100", serviceFee: "1000", fee: "1100", createdAt: now, expiresAt: now + 60_000,
  });
  const first = database.createOperationFromQuote({
    id: "operation-1", operation: "withdraw", reservationKey: `0x${"22".repeat(32)}:0`, quoteId: "quote-1", chainId: 12345, requestHash: `0x${"11".repeat(32)}`,
    nullifierHash: `0x${"22".repeat(32)}`, withdrawNonce: "0", calldata: "0x1234",
  });
  assert.equal(first.created, true);
  assert.ok(database.getQuote("quote-1")?.usedAt);
  const repeated = database.createOperationFromQuote({
    id: "operation-2", operation: "withdraw", reservationKey: `0x${"22".repeat(32)}:0`, quoteId: "quote-1", chainId: 12345, requestHash: `0x${"11".repeat(32)}`,
    nullifierHash: `0x${"22".repeat(32)}`, withdrawNonce: "0", calldata: "0x1234",
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.operation.id, "operation-1");
  database.onModuleDestroy();
  await rm(directory, { recursive: true, force: true });
});

test("recovers an interrupted pre-signing operation as queued", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pactpay-relayer-"));
  const path = join(directory, "relayer.db");
  const config = configuration(path);
  let database = new DatabaseService(config);
  const now = Date.now();
  database.insertQuote({
    id: "quote-2", operation: "withdraw", chainId: 12345, gravArc: "0x4444444444444444444444444444444444444444",
    relayer: "0x2222222222222222222222222222222222222222", token: "0x0000000000000000000000000000000000000000",
    amount: "1000000", tier: 8, networkFee: "100", serviceFee: "1000", fee: "1100", createdAt: now, expiresAt: now + 60_000,
  });
  database.createOperationFromQuote({
    id: "operation-2", operation: "withdraw", reservationKey: `0x${"44".repeat(32)}:0`, quoteId: "quote-2", chainId: 12345, requestHash: `0x${"33".repeat(32)}`,
    nullifierHash: `0x${"44".repeat(32)}`, withdrawNonce: "0", calldata: "0x1234",
  });
  database.transition("operation-2", ["queued"], "simulating");
  database.onModuleDestroy();
  database = new DatabaseService(config);
  assert.equal(database.getOperation("operation-2")?.state, "queued");
  database.onModuleDestroy();
  await rm(directory, { recursive: true, force: true });
});
