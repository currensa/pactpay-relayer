import type { ConfigurationService } from "../src/config/configuration.service";
import type { ChainConfig, RelayerConfig } from "../src/config/types";

export const zero = "0x0000000000000000000000000000000000000000";

export function evmChain(): ChainConfig {
  return {
    chainId: 12345, name: "Test", family: "evm", rpcUrl: "http://127.0.0.1:1",
    gravArc: "0x4444444444444444444444444444444444444444", privateKeyEnv: "TEST_KEY",
    confirmations: 1, nativeSymbol: "TEST", nativeDecimals: 6,
    gasByTier: { "8": 100, "16": 100, "32": 100, "64": 100, "128": 100 },
    maxGas: 1000, gasLimitMultiplierBps: 10_000,
    tokens: [{ symbol: "TEST", address: zero, decimals: 6 }],
  };
}

export function configuration(databasePath: string, chain = evmChain()): ConfigurationService {
  const value: RelayerConfig = {
    host: "127.0.0.1", port: 3100, databasePath, quoteTtlSeconds: 120,
    pricingMaxAgeSeconds: 3600, priceCacheSeconds: 30, priceRequestTimeoutMs: 5000,
    priceSafetyMarginBps: 10_500, serviceFeeBps: 10, maxTotalFeeBps: 5000,
    maxRequestBytes: 65_536, maxQueuedPerChain: 100, globalRateLimitPerMinute: 1000,
    trustProxy: false, corsOrigins: [], chains: [chain],
  };
  return { value, chain: (chainId: number) => {
    if (chainId !== chain.chainId) throw new Error("Unsupported chain");
    return chain;
  } } as unknown as ConfigurationService;
}
