import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ConfigurationService } from "../config/configuration.service";
import { RelayerError } from "../common/errors";
import type { NewOperation, NewQuote, OperationRecord, OperationState, QuoteRecord } from "./types";

function quote(row: Record<string, unknown>): QuoteRecord {
  return {
    id: String(row.id), operation: String(row.operation) as QuoteRecord["operation"], chainId: Number(row.chain_id), gravArc: String(row.grav_arc), relayer: String(row.relayer),
    token: String(row.token), amount: String(row.amount), tier: Number(row.tier), networkFee: String(row.network_fee),
    serviceFee: String(row.service_fee), fee: String(row.fee), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    usedAt: row.used_at === null ? null : Number(row.used_at),
  };
}

function operation(row: Record<string, unknown>): OperationRecord {
  return {
    id: String(row.id), operation: String(row.operation) as OperationRecord["operation"], quoteId: String(row.quote_id), chainId: Number(row.chain_id), requestHash: String(row.request_hash),
    reservationKey: String(row.reservation_key),
    nullifierHash: String(row.nullifier_hash), withdrawNonce: String(row.withdraw_nonce), state: String(row.state) as OperationState,
    calldata: String(row.calldata), signedPayload: row.signed_payload === null ? null : String(row.signed_payload),
    txHash: row.tx_hash === null ? null : String(row.tx_hash), blockNumber: row.block_number === null ? null : Number(row.block_number),
    errorCode: row.error_code === null ? null : String(row.error_code), errorMessage: row.error_message === null ? null : String(row.error_message),
    attempts: Number(row.attempts), nextAttemptAt: Number(row.next_attempt_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    submittedAt: row.submitted_at === null ? null : Number(row.submitted_at), confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
  };
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly path: string;
  private readonly db: Database.Database;

  constructor(private readonly configuration: ConfigurationService) {
    this.path = resolve(configuration.value.databasePath);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    this.db = new Database(this.path);
    try { chmodSync(this.path, 0o600); } catch { /* best effort on non-POSIX systems */ }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
    this.recoverInterrupted();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL DEFAULT 'withdraw' CHECK(operation IN ('withdraw','refund')),
        chain_id INTEGER NOT NULL,
        grav_arc TEXT NOT NULL,
        relayer TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        tier INTEGER NOT NULL,
        network_fee TEXT NOT NULL,
        service_fee TEXT NOT NULL,
        fee TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS quotes_expiry_idx ON quotes(expires_at);

      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL DEFAULT 'withdraw' CHECK(operation IN ('withdraw','refund')),
        quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
        chain_id INTEGER NOT NULL,
        request_hash TEXT NOT NULL UNIQUE,
        reservation_key TEXT NOT NULL DEFAULT '',
        nullifier_hash TEXT NOT NULL,
        withdraw_nonce TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','simulating','signed','submitted','confirmed','failed')),
        calldata TEXT NOT NULL,
        signed_payload TEXT,
        tx_hash TEXT,
        block_number INTEGER,
        error_code TEXT,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        submitted_at INTEGER,
        confirmed_at INTEGER,
        UNIQUE(chain_id, nullifier_hash, withdraw_nonce)
      );
      CREATE INDEX IF NOT EXISTS operations_work_idx ON operations(chain_id, state, next_attempt_at, created_at);
      CREATE INDEX IF NOT EXISTS operations_tx_idx ON operations(tx_hash);
    `);
    const quoteColumns = new Set((this.db.prepare("PRAGMA table_info(quotes)").all() as Array<{ name: string }>).map((entry) => entry.name));
    if (!quoteColumns.has("operation")) this.db.exec("ALTER TABLE quotes ADD COLUMN operation TEXT NOT NULL DEFAULT 'withdraw'");
    const operationColumns = new Set((this.db.prepare("PRAGMA table_info(operations)").all() as Array<{ name: string }>).map((entry) => entry.name));
    if (!operationColumns.has("operation")) this.db.exec("ALTER TABLE operations ADD COLUMN operation TEXT NOT NULL DEFAULT 'withdraw'");
    if (!operationColumns.has("reservation_key")) {
      this.db.exec("ALTER TABLE operations ADD COLUMN reservation_key TEXT NOT NULL DEFAULT ''");
      this.db.exec("UPDATE operations SET reservation_key = nullifier_hash || ':' || withdraw_nonce WHERE reservation_key = ''");
    }
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS operations_reservation_idx ON operations(chain_id, operation, reservation_key)");
  }

  private recoverInterrupted(): void {
    const now = Date.now();
    this.db.prepare("UPDATE operations SET state = 'queued', updated_at = ?, next_attempt_at = ? WHERE state = 'simulating' AND signed_payload IS NULL").run(now, now);
  }

  onModuleDestroy(): void { this.db.close(); }

  insertQuote(value: NewQuote): QuoteRecord {
    this.db.prepare(`INSERT INTO quotes
      (id, operation, chain_id, grav_arc, relayer, token, amount, tier, network_fee, service_fee, fee, created_at, expires_at, used_at)
      VALUES (@id, @operation, @chainId, @gravArc, @relayer, @token, @amount, @tier, @networkFee, @serviceFee, @fee, @createdAt, @expiresAt, NULL)`
    ).run(value);
    return this.getQuote(value.id)!;
  }

  getQuote(id: string): QuoteRecord | undefined {
    const row = this.db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? quote(row) : undefined;
  }

  private retryable(operation: OperationRecord): boolean {
    return operation.state === "failed" && operation.signedPayload === null && operation.txHash === null;
  }

  private reuseFailedOperation(current: OperationRecord, value: NewOperation, now: number): OperationRecord {
    if (!this.retryable(current)) throw new Error(`Operation ${current.id} is not safely reusable`);
    this.db.prepare("UPDATE quotes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, value.quoteId);
    this.db.prepare(`UPDATE operations SET
      operation = @operation, quote_id = @quoteId, chain_id = @chainId, request_hash = @requestHash,
      reservation_key = @reservationKey, nullifier_hash = @nullifierHash, withdraw_nonce = @withdrawNonce,
      state = 'queued', calldata = @calldata, signed_payload = NULL, tx_hash = NULL, block_number = NULL,
      error_code = NULL, error_message = NULL, attempts = 0, next_attempt_at = @now,
      updated_at = @now, submitted_at = NULL, confirmed_at = NULL
      WHERE id = @id`).run({ ...value, id: current.id, now });
    return this.getOperation(current.id)!;
  }

  createOperationFromQuote(value: NewOperation, now = Date.now()): { operation: OperationRecord; created: boolean } {
    return this.db.transaction(() => {
      const existingRow = this.db.prepare("SELECT * FROM operations WHERE request_hash = ?").get(value.requestHash) as Record<string, unknown> | undefined;
      const existing = existingRow ? operation(existingRow) : undefined;
      if (existing?.quoteId === value.quoteId || (existing && !this.retryable(existing))) {
        return { operation: existing, created: false };
      }
      const storedQuote = this.db.prepare("SELECT * FROM quotes WHERE id = ?").get(value.quoteId) as Record<string, unknown> | undefined;
      if (!storedQuote) throw new RelayerError("QUOTE_NOT_FOUND", "Quote was not found", 404);
      const parsedQuote = quote(storedQuote);
      if (parsedQuote.usedAt !== null) throw new RelayerError("QUOTE_USED", "Quote has already been used", 409);
      if (parsedQuote.expiresAt <= now) throw new RelayerError("QUOTE_EXPIRED", "Quote has expired", 409);
      const activeCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM operations WHERE chain_id = ? AND state IN ('queued','simulating','signed','submitted')").get(value.chainId) as { count: number }).count);
      if (activeCount >= this.configuration.value.maxQueuedPerChain) throw new RelayerError("QUEUE_FULL", "The relayer queue is full for this chain", 503);
      if (parsedQuote.operation !== value.operation) throw new RelayerError("QUOTE_MISMATCH", "Quote does not authorize this operation type", 409);
      const conflictRow = this.db.prepare("SELECT * FROM operations WHERE chain_id = ? AND operation = ? AND reservation_key = ?").get(value.chainId, value.operation, value.reservationKey) as Record<string, unknown> | undefined;
      const conflict = conflictRow ? operation(conflictRow) : undefined;
      const reusable = existing ?? (conflict && this.retryable(conflict) ? conflict : undefined);
      if (reusable) return { operation: this.reuseFailedOperation(reusable, value, now), created: true };
      if (conflict) throw new RelayerError("OPERATION_RESERVED", `This ${value.operation} is already reserved by operation ${conflict.id}`, 409);
      this.db.prepare("UPDATE quotes SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now, value.quoteId);
      this.db.prepare(`INSERT INTO operations
        (id, operation, quote_id, chain_id, request_hash, reservation_key, nullifier_hash, withdraw_nonce, state, calldata, signed_payload, tx_hash,
         block_number, error_code, error_message, attempts, next_attempt_at, created_at, updated_at, submitted_at, confirmed_at)
        VALUES (@id, @operation, @quoteId, @chainId, @requestHash, @reservationKey, @nullifierHash, @withdrawNonce, 'queued', @calldata, NULL, NULL,
          NULL, NULL, NULL, 0, @now, @now, @now, NULL, NULL)`
      ).run({ ...value, now });
      return { operation: this.getOperation(value.id)!, created: true };
    })();
  }

  getOperation(id: string): OperationRecord | undefined {
    const row = this.db.prepare("SELECT * FROM operations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? operation(row) : undefined;
  }

  nextOperation(chainId: number, now = Date.now()): OperationRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM operations
      WHERE chain_id = ? AND state IN ('signed','queued') AND next_attempt_at <= ?
      ORDER BY CASE state WHEN 'signed' THEN 0 ELSE 1 END, next_attempt_at, created_at LIMIT 1`
    ).get(chainId, now) as Record<string, unknown> | undefined;
    return row ? operation(row) : undefined;
  }

  nextSubmittedOperation(chainId: number, now = Date.now()): OperationRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM operations
      WHERE chain_id = ? AND state = 'submitted' AND next_attempt_at <= ?
      ORDER BY next_attempt_at, created_at LIMIT 1`
    ).get(chainId, now) as Record<string, unknown> | undefined;
    return row ? operation(row) : undefined;
  }

  transition(id: string, from: OperationState[], to: OperationState, fields: Partial<Pick<OperationRecord, "signedPayload" | "txHash" | "blockNumber" | "errorCode" | "errorMessage" | "submittedAt" | "confirmedAt">> = {}): OperationRecord {
    const current = this.getOperation(id);
    if (!current) throw new RelayerError("OPERATION_NOT_FOUND", "Operation was not found", 404);
    if (!from.includes(current.state)) throw new Error(`Operation ${id} cannot transition from ${current.state} to ${to}`);
    const now = Date.now();
    this.db.prepare(`UPDATE operations SET state = @state, signed_payload = @signedPayload, tx_hash = @txHash,
      block_number = @blockNumber, error_code = @errorCode, error_message = @errorMessage,
      submitted_at = @submittedAt, confirmed_at = @confirmedAt, updated_at = @now, next_attempt_at = @now
      WHERE id = @id`).run({
      id, state: to, signedPayload: fields.signedPayload ?? current.signedPayload, txHash: fields.txHash ?? current.txHash,
      blockNumber: fields.blockNumber ?? current.blockNumber, errorCode: fields.errorCode ?? null, errorMessage: fields.errorMessage ?? null,
      submittedAt: fields.submittedAt ?? current.submittedAt, confirmedAt: fields.confirmedAt ?? current.confirmedAt, now,
    });
    return this.getOperation(id)!;
  }

  retry(id: string, state: OperationState, error: Error): OperationRecord {
    const current = this.getOperation(id);
    if (!current) throw new RelayerError("OPERATION_NOT_FOUND", "Operation was not found", 404);
    const attempts = current.attempts + 1;
    const now = Date.now();
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
    this.db.prepare(`UPDATE operations SET state = ?, attempts = ?, next_attempt_at = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`)
      .run(state, attempts, now + delay, "RPC_RETRY", error.message.slice(0, 500), now, id);
    return this.getOperation(id)!;
  }

  defer(id: string, delayMs: number): OperationRecord {
    const now = Date.now();
    this.db.prepare("UPDATE operations SET next_attempt_at = ?, updated_at = ? WHERE id = ?").run(now + delayMs, now, id);
    const result = this.getOperation(id);
    if (!result) throw new RelayerError("OPERATION_NOT_FOUND", "Operation was not found", 404);
    return result;
  }

  cleanup(now = Date.now()): void {
    this.db.prepare("DELETE FROM quotes WHERE used_at IS NULL AND expires_at < ?").run(now - 86_400_000);
  }
}
