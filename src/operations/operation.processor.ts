import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { ChainService } from "../chain/chain.service";
import type { SignedTransaction } from "../chain/types";
import { SimulationRejectedError } from "../common/errors";
import { ConfigurationService } from "../config/configuration.service";
import { DatabaseService } from "../database/database.service";
import type { OperationRecord, OperationState } from "../database/types";
import { PricingService } from "../pricing/pricing.service";

@Injectable()
export class OperationProcessor {
  private readonly logger = new Logger(OperationProcessor.name);
  private readonly busy = new Set<number>();

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly database: DatabaseService,
    private readonly chains: ChainService,
    private readonly pricing: PricingService,
  ) {}

  @Interval(1_000)
  async tick(): Promise<void> {
    await Promise.all(this.configuration.value.chains.map(async (chain) => {
      if (this.busy.has(chain.chainId)) return;
      const operation = this.database.nextOperation(chain.chainId);
      const submitted = this.database.nextSubmittedOperation(chain.chainId);
      if (!operation && !submitted) return;
      this.busy.add(chain.chainId);
      try {
        // Progress one signing lane and one confirmation lane independently.
        // A slow/missing receipt must not starve an accepted queued operation.
        for (const candidate of [operation, submitted]) {
          if (!candidate) continue;
          try { await this.process(candidate); }
          catch (error) { this.logger.error(`Operation ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`); }
        }
      }
      finally { this.busy.delete(chain.chainId); }
    }));
  }

  @Interval(3_600_000)
  cleanup(): void { this.database.cleanup(); }

  private signed(operation: OperationRecord): SignedTransaction {
    if (!operation.signedPayload || !operation.txHash) throw new Error(`Operation ${operation.id} has no persisted signed transaction`);
    return { hash: operation.txHash, payload: operation.signedPayload };
  }

  private async process(operation: OperationRecord): Promise<void> {
    const adapter = this.chains.get(operation.chainId);
    try {
      if (operation.state === "submitted") {
        const status = await adapter.transactionStatus(operation.txHash!);
        if (status.state === "pending") { this.database.defer(operation.id, 3_000); return; }
        if (status.state === "failed") {
          this.database.transition(operation.id, ["submitted"], "failed", { blockNumber: status.blockNumber ?? null, errorCode: "TRANSACTION_FAILED", errorMessage: status.reason });
          return;
        }
        if (status.confirmations < adapter.config.confirmations) { this.database.defer(operation.id, 3_000); return; }
        this.database.transition(operation.id, ["submitted"], "confirmed", { blockNumber: status.blockNumber, confirmedAt: Date.now() });
        return;
      }

      if (operation.state === "signed") {
        await adapter.broadcast(this.signed(operation));
        this.database.transition(operation.id, ["signed"], "submitted", { submittedAt: operation.submittedAt ?? Date.now() });
        return;
      }

      if (operation.state !== "queued") return;
      operation = this.database.transition(operation.id, ["queued"], "simulating");
      const quote = this.database.getQuote(operation.quoteId);
      if (!quote) throw new SimulationRejectedError("The operation quote is unavailable");
      // Expiry controls admission in createOperationFromQuote. Once accepted,
      // an operation owns its quote and may wait in the durable queue. The
      // current network cost is still revalidated below before signing.
      const simulation = await adapter.simulate(operation.calldata, operation.operation);
      const token = adapter.config.tokens.find((entry) => entry.address === quote.token);
      if (!token) throw new SimulationRejectedError("The quoted token is no longer supported");
      const currentNativeCost = await adapter.simulatedNativeCost(simulation);
      const currentTokenCost = await this.pricing.networkCostInToken(adapter.config, token, currentNativeCost);
      if (currentTokenCost.amount > BigInt(quote.networkFee)) {
        throw new SimulationRejectedError("Network cost increased above the locked quote; request a new quote");
      }
      const transaction = await adapter.sign(operation.calldata, simulation);
      operation = this.database.transition(operation.id, ["simulating"], "signed", { signedPayload: transaction.payload, txHash: transaction.hash });
      await adapter.broadcast(transaction);
      this.database.transition(operation.id, ["signed"], "submitted", { submittedAt: Date.now() });
    } catch (error) {
      const current = this.database.getOperation(operation.id);
      if (!current || current.state === "confirmed" || current.state === "failed") throw error;
      if (error instanceof SimulationRejectedError && current.state === "simulating") {
        this.database.transition(current.id, ["simulating"], "failed", { errorCode: error.code, errorMessage: error.message });
        return;
      }
      const retryState: OperationState = current.state === "simulating" ? "queued" : current.state;
      this.database.retry(current.id, retryState, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
