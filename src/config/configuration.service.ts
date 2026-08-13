import { Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { canonicalAddress, ZERO_ADDRESS } from "../chain/address";
import type { ChainConfig, CircuitTier, RelayerConfig, TokenConfig } from "./types";

const TIERS: CircuitTier[] = [8, 16, 32, 64, 128];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value as number;
}

function tierMap(value: unknown, label: string): Record<string, number> {
  const row = object(value, label);
  const result: Record<string, number> = {};
  for (const tier of TIERS) result[String(tier)] = integer(row[String(tier)], `${label}.${tier}`, 1);
  return result;
}

function scaledTierMap(value: unknown, fallback: Record<string, number>, label: string): Record<string, number> {
  if (value !== undefined) return tierMap(value, label);
  return Object.fromEntries(Object.entries(fallback).map(([tier, amount]) => [tier, amount * 2]));
}

function httpRpc(publicChain: Record<string, unknown>, label: string): string {
  const wallet = publicChain.wallet === undefined ? {} : object(publicChain.wallet, `${label}.wallet`);
  const walletUrls = Array.isArray(wallet.rpcUrls) ? wallet.rpcUrls : [];
  const candidates = [...walletUrls, publicChain.rpcUrl];
  const rpcUrl = candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  if (typeof rpcUrl !== "string") throw new Error(`${label} must provide an HTTP(S) RPC in wallet.rpcUrls or rpcUrl`);
  return rpcUrl;
}

function publicTokens(publicChain: Record<string, unknown>, family: "evm" | "tron", label: string): Map<string, { symbol: string }> {
  const values = publicChain.erc20Tokens ?? [];
  if (!Array.isArray(values)) throw new Error(`${label}.erc20Tokens must be an array`);
  const result = new Map<string, { symbol: string }>();
  values.forEach((value, index) => {
    const tokenLabel = `${label}.erc20Tokens[${index}]`;
    const row = object(value, tokenLabel);
    const address = canonicalAddress(string(row.address, `${tokenLabel}.address`), family);
    if (result.has(address)) throw new Error(`${label}.erc20Tokens contains duplicate address ${address}`);
    result.set(address, { symbol: string(row.symbol, `${tokenLabel}.symbol`) });
  });
  return result;
}

function parsePricedToken(
  value: unknown,
  family: "evm" | "tron",
  allowed: Map<string, { symbol: string }>,
  label: string,
): TokenConfig {
  const row = object(value, label);
  const address = canonicalAddress(string(row.address, `${label}.address`), family);
  const token = allowed.get(address);
  if (!token) throw new Error(`${label}.address is not listed in the public chain configuration`);
  return {
    symbol: token.symbol,
    address,
    decimals: integer(row.decimals, `${label}.decimals`, 0),
    priceAssetId: string(row.priceAssetId, `${label}.priceAssetId`),
  };
}

function parseChain(
  value: unknown,
  index: number,
  publicConfiguration: Record<string, unknown>,
): ChainConfig {
  const label = `relayer configuration.chains[${index}]`;
  const row = object(value, label);
  const chainId = integer(row.chainId, `${label}.chainId`, 1);
  const publicLabel = `chain configuration.${chainId}`;
  const publicChain = object(publicConfiguration[String(chainId)], publicLabel);
  const family = string(publicChain.family, `${publicLabel}.family`);
  if (family !== "evm" && family !== "tron") throw new Error(`${publicLabel}.family must be evm or tron`);

  const wallet = object(publicChain.wallet, `${publicLabel}.wallet`);
  const native = object(wallet.nativeCurrency, `${publicLabel}.wallet.nativeCurrency`);
  const nativeDecimals = integer(native.decimals, `${publicLabel}.wallet.nativeCurrency.decimals`, 0);
  const allowedTokens = publicTokens(publicChain, family, publicLabel);
  const pricing = row.tokenPricing ?? [];
  if (!Array.isArray(pricing)) throw new Error(`${label}.tokenPricing must be an array`);
  const pricedTokens = pricing.map((token, tokenIndex) => parsePricedToken(token, family, allowedTokens, `${label}.tokenPricing[${tokenIndex}]`));
  if (new Set(pricedTokens.map((token) => token.address)).size !== pricedTokens.length) throw new Error(`${label}.tokenPricing contains duplicate token addresses`);
  const nativePriceAssetId = pricedTokens.length === 0 ? undefined : string(row.nativePriceAssetId, `${label}.nativePriceAssetId`);

  const base = {
    chainId,
    name: string(publicChain.chainName, `${publicLabel}.chainName`),
    family,
    rpcUrl: httpRpc(publicChain, publicLabel),
    gravArc: canonicalAddress(string(publicChain.GravArc, `${publicLabel}.GravArc`), family),
    privateKeyEnv: string(row.privateKeyEnv, `${label}.privateKeyEnv`),
    confirmations: integer(row.confirmations, `${label}.confirmations`, 1),
    nativeSymbol: string(native.symbol, `${publicLabel}.wallet.nativeCurrency.symbol`),
    nativeDecimals,
    ...(nativePriceAssetId ? { nativePriceAssetId } : {}),
    tokens: [{
      symbol: string(native.symbol, `${publicLabel}.wallet.nativeCurrency.symbol`),
      address: ZERO_ADDRESS,
      decimals: nativeDecimals,
    }, ...pricedTokens],
  };
  if (family === "evm") {
    const gasByTier = tierMap(row.gasByTier, `${label}.gasByTier`);
    return {
    ...base,
    family,
    gasByTier,
    refundGasByTier: scaledTierMap(row.refundGasByTier, gasByTier, `${label}.refundGasByTier`),
    maxGas: integer(row.maxGas, `${label}.maxGas`, 1),
    gasLimitMultiplierBps: integer(row.gasLimitMultiplierBps ?? 12_000, `${label}.gasLimitMultiplierBps`, 10_000),
    };
  }
  const energyByTier = tierMap(row.energyByTier, `${label}.energyByTier`);
  const bandwidthByTier = tierMap(row.bandwidthByTier, `${label}.bandwidthByTier`);
  return {
    ...base,
    family,
    energyByTier,
    bandwidthByTier,
    refundEnergyByTier: scaledTierMap(row.refundEnergyByTier, energyByTier, `${label}.refundEnergyByTier`),
    refundBandwidthByTier: scaledTierMap(row.refundBandwidthByTier, bandwidthByTier, `${label}.refundBandwidthByTier`),
    maxEnergy: integer(row.maxEnergy, `${label}.maxEnergy`, 1),
    maxFeeSun: integer(row.maxFeeSun, `${label}.maxFeeSun`, 1),
    feeLimitMultiplierBps: integer(row.feeLimitMultiplierBps ?? 12_000, `${label}.feeLimitMultiplierBps`, 10_000),
  };
}

export function parseConfiguration(publicValue: unknown, relayerValue: unknown): RelayerConfig {
  const publicRow = object(publicValue, "chain configuration");
  const row = object(relayerValue, "relayer configuration");
  if (!Array.isArray(row.chains) || row.chains.length === 0) throw new Error("relayer configuration.chains must be a non-empty array");
  const chains = row.chains.map((chain, index) => parseChain(chain, index, publicRow));
  if (new Set(chains.map((chain) => chain.chainId)).size !== chains.length) throw new Error("Relayer chain IDs must be unique");
  return {
    host: typeof row.host === "string" ? row.host : "0.0.0.0",
    port: integer(row.port ?? 3100, "relayer configuration.port", 1),
    databasePath: string(row.databasePath ?? "./data/relayer.db", "relayer configuration.databasePath"),
    quoteTtlSeconds: integer(row.quoteTtlSeconds ?? 120, "relayer configuration.quoteTtlSeconds", 10),
    pricingMaxAgeSeconds: integer(row.pricingMaxAgeSeconds ?? 3600, "relayer configuration.pricingMaxAgeSeconds", 1),
    priceCacheSeconds: integer(row.priceCacheSeconds ?? 30, "relayer configuration.priceCacheSeconds", 1),
    priceRequestTimeoutMs: integer(row.priceRequestTimeoutMs ?? 5000, "relayer configuration.priceRequestTimeoutMs", 100),
    priceSafetyMarginBps: integer(row.priceSafetyMarginBps ?? 10_500, "relayer configuration.priceSafetyMarginBps", 10_000),
    serviceFeeBps: integer(row.serviceFeeBps ?? 10, "relayer configuration.serviceFeeBps", 10),
    maxTotalFeeBps: integer(row.maxTotalFeeBps ?? 5000, "relayer configuration.maxTotalFeeBps", 1),
    maxRequestBytes: integer(row.maxRequestBytes ?? 65_536, "relayer configuration.maxRequestBytes", 1024),
    maxQueuedPerChain: integer(row.maxQueuedPerChain ?? 100, "relayer configuration.maxQueuedPerChain", 1),
    globalRateLimitPerMinute: integer(row.globalRateLimitPerMinute ?? 1000, "relayer configuration.globalRateLimitPerMinute", 1),
    trustProxy: typeof row.trustProxy === "boolean" || Number.isSafeInteger(row.trustProxy) ? row.trustProxy as boolean | number : false,
    corsOrigins: Array.isArray(row.corsOrigins) && row.corsOrigins.every((entry) => typeof entry === "string") ? row.corsOrigins : [],
    chains,
  };
}

@Injectable()
export class ConfigurationService {
  readonly value: RelayerConfig;
  readonly publicPath: string;
  readonly relayerPath: string;

  constructor() {
    loadDotEnv();
    this.relayerPath = resolve("./relayer.config.json");
    const relayerValue = JSON.parse(readFileSync(this.relayerPath, "utf8")) as unknown;
    const relayerRow = object(relayerValue, "relayer configuration");
    this.publicPath = resolve(string(relayerRow.publicConfigPath ?? "./config.json", "relayer configuration.publicConfigPath"));
    const publicValue = JSON.parse(readFileSync(this.publicPath, "utf8")) as unknown;
    this.value = parseConfiguration(publicValue, relayerValue);
  }

  chain(chainId: number): ChainConfig {
    const chain = this.value.chains.find((entry) => entry.chainId === chainId);
    if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
    return chain;
  }

  privateKey(chain: ChainConfig): string {
    const value = process.env[chain.privateKeyEnv];
    if (!value || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${chain.privateKeyEnv} must contain a 32-byte private key`);
    return value.startsWith("0x") ? value : `0x${value}`;
  }
}
