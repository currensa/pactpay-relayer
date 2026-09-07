import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { canonicalAddress, ZERO_ADDRESS } from "../chain/address";
import { basisPointsCeil } from "../chain/price";
import { ChainService } from "../chain/chain.service";
import { RelayerError } from "../common/errors";
import { ConfigurationService } from "../config/configuration.service";
import type { CircuitTier, RelayedOperation, TokenConfig } from "../config/types";
import { DatabaseService } from "../database/database.service";
import type { QuoteRecord } from "../database/types";
import { PricingService } from "../pricing/pricing.service";
import type { CreateQuoteDto } from "./dto";

@Injectable()
export class QuoteService {
  private readonly estimateCache = new Map<string, { expiresAt: number; value: Promise<Map<CircuitTier, bigint>> }>();

  constructor(
    private readonly configuration: ConfigurationService,
    private readonly chains: ChainService,
    private readonly database: DatabaseService,
    private readonly pricing: PricingService,
  ) {}

  private networkEstimates(operation: RelayedOperation, chainId: number): Promise<Map<CircuitTier, bigint>> {
    const now = Date.now();
    const key = `${operation}:${chainId}`;
    const cached = this.estimateCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const tiers: CircuitTier[] = [8, 16, 32, 64, 128];
    const value = this.chains.get(chainId).estimateNativeNetworkCosts(operation, tiers);
    this.estimateCache.set(key, { expiresAt: now + 10_000, value });
    value.catch(() => { if (this.estimateCache.get(key)?.value === value) this.estimateCache.delete(key); });
    return value;
  }

  token(chainId: number, value: string): TokenConfig {
    const chain = this.configuration.chain(chainId);
    let address: string;
    try { address = canonicalAddress(value, chain.family); }
    catch { throw new RelayerError("TOKEN_INVALID", "Token address is invalid"); }
    const token = chain.tokens.find((entry) => entry.address === address);
    if (!token) throw new RelayerError("TOKEN_UNSUPPORTED", "Token is not supported by this relayer", 422);
    return token;
  }

  private totalFee(amount: bigint, networkFee: bigint, feeLimitAmount = amount): { networkFee: bigint; serviceFee: bigint; fee: bigint } {
    const serviceFee = basisPointsCeil(amount, this.configuration.value.serviceFeeBps);
    const fee = networkFee + serviceFee;
    if (fee >= feeLimitAmount) throw new RelayerError("FEE_EXCEEDS_AMOUNT", "Estimated relayer fee is not less than the operation amount", 422);
    if (fee * 10_000n > feeLimitAmount * BigInt(this.configuration.value.maxTotalFeeBps)) {
      throw new RelayerError("FEE_LIMIT_EXCEEDED", "Estimated relayer fee exceeds the configured maximum percentage", 422);
    }
    return { networkFee, serviceFee, fee };
  }

  async createFor(operation: RelayedOperation, input: CreateQuoteDto): Promise<QuoteRecord> {
    const chain = this.configuration.chain(input.chainId);
    const token = this.token(input.chainId, input.token);
    let amount = BigInt(input.amount);
    const requestedAmount = amount;
    const tier = input.tier as CircuitTier;
    const estimates = await this.networkEstimates(operation, input.chainId);
    const networkNative = estimates.get(tier);
    if (networkNative === undefined) throw new Error(`No network estimate for tier ${tier}`);
    const networkFee = await this.pricing.networkCostInToken(chain, token, networkNative);
    if (operation === "defi") {
      amount = (amount - networkFee.amount) * 10_000n / (10_000n + BigInt(this.configuration.value.serviceFeeBps));
      if (amount <= 0n) throw new RelayerError("FEE_EXCEEDS_AMOUNT", "Remaining allocation cannot cover the DeFi fee", 422);
    }
    const fees = this.totalFee(amount, networkFee.amount, operation === "defi" ? requestedAmount : amount);
    const now = Date.now();
    if (operation === "defi" && (!chain.defiRouter || !chain.pureRouter || chain.defiProtocols.length === 0)) {
      throw new RelayerError("DEFI_UNAVAILABLE", "DeFi relay is not configured for this chain", 422);
    }
    return this.database.insertQuote({
      id: randomUUID(), operation, chainId: input.chainId, gravArc: operation === "defi" ? chain.defiRouter! : chain.gravArc,
      relayer: this.chains.get(input.chainId).relayerCanonical, token: token.address,
      amount: amount.toString(), tier, networkFee: fees.networkFee.toString(), serviceFee: fees.serviceFee.toString(),
      fee: fees.fee.toString(), createdAt: now, expiresAt: now + this.configuration.value.quoteTtlSeconds * 1000,
    });
  }

  create(input: CreateQuoteDto): Promise<QuoteRecord> { return this.createFor("withdraw", input); }
  createWithdraw(input: CreateQuoteDto): Promise<QuoteRecord> { return this.createFor("withdraw", input); }
  createRefund(input: CreateQuoteDto): Promise<QuoteRecord> { return this.createFor("refund", input); }
  createDefi(input: CreateQuoteDto): Promise<QuoteRecord> { return this.createFor("defi", input); }

  get(id: string): QuoteRecord {
    const value = this.database.getQuote(id);
    if (!value) throw new RelayerError("QUOTE_NOT_FOUND", "Quote was not found", 404);
    return value;
  }

  async estimates(operation: RelayedOperation, chainId: number): Promise<Array<{ token: TokenConfig; available: boolean; reason?: string; networkFeeByTier?: Record<string, string> }>> {
    const chain = this.configuration.chain(chainId);
    const tiers: CircuitTier[] = [8, 16, 32, 64, 128];
    const native = await this.networkEstimates(operation, chainId);
    return Promise.all(chain.tokens.map(async (token) => {
      try {
        const converted = await Promise.all(tiers.map(async (tier) => [
          String(tier), await this.pricing.networkCostInToken(chain, token, native.get(tier)!),
        ] as const));
        return {
          token,
          available: true,
          pricingUpdatedAt: new Date(Math.min(...converted.map(([, value]) => value.updatedAt))).toISOString(),
          networkFeeByTier: Object.fromEntries(converted.map(([tier, value]) => [tier, value.amount.toString()])),
        };
      } catch (error) {
        return { token, available: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }));
  }
}
