import { Injectable } from "@nestjs/common";
import { ZERO_ADDRESS } from "../chain/address";
import { basisPointsCeil, nativeCostInToken } from "../chain/price";
import { RelayerError } from "../common/errors";
import { ConfigurationService } from "../config/configuration.service";
import type { ChainConfig, TokenConfig } from "../config/types";

type UsdPrice = { value: number; updatedAt: number; cachedAt: number };
type CoinGeckoRow = { usd?: unknown; last_updated_at?: unknown };

export type TokenConversion = {
  nativePerToken: string;
  updatedAt: number;
};

const COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";

function decimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new RelayerError("PRICE_INVALID", "Market price conversion is invalid", 503);
  const result = value.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
  if (result === "0") throw new RelayerError("PRICE_INVALID", "Market price conversion is below supported precision", 503);
  return result;
}

@Injectable()
export class PricingService {
  private readonly cache = new Map<string, UsdPrice>();
  private inFlight: Promise<Map<string, UsdPrice>> | null = null;

  constructor(private readonly configuration: ConfigurationService) {}

  private fresh(assetId: string, now: number): UsdPrice | undefined {
    const price = this.cache.get(assetId);
    return price && now - price.cachedAt <= this.configuration.value.priceCacheSeconds * 1000 ? price : undefined;
  }

  private configuredAssetIds(): string[] {
    return [...new Set(this.configuration.value.chains.flatMap(chain => [
      ...(chain.nativePriceAssetId ? [chain.nativePriceAssetId] : []),
      ...chain.tokens.flatMap(token => token.priceAssetId ? [token.priceAssetId] : []),
    ]))].sort();
  }

  private async fetchPrices(assetIds: string[]): Promise<Map<string, UsdPrice>> {
    const ids = [...new Set(assetIds)].sort();
    const now = Date.now();
    const cached = ids.map((id) => [id, this.fresh(id, now)] as const);
    if (cached.every(([, value]) => value !== undefined)) return new Map(cached as Array<readonly [string, UsdPrice]>);

    if (!this.inFlight) {
      const request = this.request([...new Set([...this.configuredAssetIds(), ...ids])].sort());
      this.inFlight = request;
      request.finally(() => { if (this.inFlight === request) this.inFlight = null; }).catch(() => undefined);
    }
    await this.inFlight;
    const refreshed = ids.map((id) => [id, this.fresh(id, Date.now())] as const);
    if (refreshed.some(([, value]) => value === undefined)) {
      throw new RelayerError("PRICE_UNAVAILABLE", "CoinGecko pricing response omitted a requested asset", 503);
    }
    return new Map(refreshed as Array<readonly [string, UsdPrice]>);
  }

  private async request(ids: string[]): Promise<Map<string, UsdPrice>> {
    const url = new URL(COINGECKO_PRICE_URL);
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_last_updated_at", "true");
    url.searchParams.set("precision", "full");
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "pactpay-relayer/0.1" },
        signal: AbortSignal.timeout(this.configuration.value.priceRequestTimeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as Record<string, CoinGeckoRow>;
      const cachedAt = Date.now();
      const result = new Map<string, UsdPrice>();
      for (const id of ids) {
        const row = body[id];
        const value = row?.usd;
        const updatedAtSeconds = row?.last_updated_at;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0
          || typeof updatedAtSeconds !== "number" || !Number.isSafeInteger(updatedAtSeconds)) {
          throw new Error(`No valid USD price for ${id}`);
        }
        const price = { value, updatedAt: updatedAtSeconds * 1000, cachedAt };
        this.cache.set(id, price);
        result.set(id, price);
      }
      return result;
    } catch (error) {
      if (error instanceof RelayerError) throw error;
      throw new RelayerError("PRICE_UNAVAILABLE", `CoinGecko pricing is unavailable: ${error instanceof Error ? error.message : String(error)}`, 503);
    }
  }

  async conversion(chain: ChainConfig, token: TokenConfig, now = Date.now()): Promise<TokenConversion> {
    if (token.address === ZERO_ADDRESS) return { nativePerToken: "1", updatedAt: now };
    if (token.testOnlyNativePerToken) {
      return { nativePerToken: token.testOnlyNativePerToken, updatedAt: now };
    }
    if (!chain.nativePriceAssetId || !token.priceAssetId) throw new RelayerError("PRICE_UNAVAILABLE", `Pricing is not configured for ${token.symbol}`, 503);
    const prices = await this.fetchPrices([chain.nativePriceAssetId, token.priceAssetId]);
    const native = prices.get(chain.nativePriceAssetId)!;
    const pricedToken = prices.get(token.priceAssetId)!;
    const updatedAt = Math.min(native.updatedAt, pricedToken.updatedAt);
    if (updatedAt > now + 60_000 || now - updatedAt > this.configuration.value.pricingMaxAgeSeconds * 1000) {
      throw new RelayerError("PRICE_STALE", `CoinGecko pricing for ${token.symbol} is stale`, 503);
    }
    return { nativePerToken: decimal(pricedToken.value / native.value), updatedAt };
  }

  async networkCostInToken(chain: ChainConfig, token: TokenConfig, nativeCost: bigint): Promise<{ amount: bigint; updatedAt: number }> {
    const conversion = await this.conversion(chain, token);
    const converted = nativeCostInToken(nativeCost, chain.nativeDecimals, token.decimals, conversion.nativePerToken);
    return {
      amount: token.address === ZERO_ADDRESS ? converted : basisPointsCeil(converted, this.configuration.value.priceSafetyMarginBps),
      updatedAt: conversion.updatedAt,
    };
  }
}
