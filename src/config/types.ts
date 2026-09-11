export type ChainFamily = "evm" | "tron";
export type CircuitTier = 8 | 16 | 32 | 64 | 128;
export type RelayedOperation = "withdraw" | "refund" | "defi";

export type DefiProtocolConfig = {
  name: string;
  type: string;
  address: string;
  helpContracts: Record<string, string>;
};

export type TokenConfig = {
  symbol: string;
  address: string;
  decimals: number;
  /** CoinGecko asset ID. Native tokens omit this because no conversion is needed. */
  priceAssetId?: string;
};

export type BaseChainConfig = {
  chainId: number;
  name: string;
  family: ChainFamily;
  rpcUrl: string;
  gravArc: string;
  pureRouter?: string;
  defiRouter?: string;
  defiProtocols: DefiProtocolConfig[];
  privateKeyEnv: string;
  confirmations: number;
  nativeSymbol: string;
  nativeDecimals: number;
  nativePriceAssetId?: string;
  tokens: TokenConfig[];
  allowedTokens: string[];
};

export type EvmChainConfig = BaseChainConfig & {
  family: "evm";
  gasByTier: Record<string, number>;
  refundGasByTier: Record<string, number>;
  defiGasByTier: Record<string, number>;
  /** Additional gas reserved when a DeFi route privately deposits its output. */
  defiRedepositGasByTier: Record<string, number>;
  maxGas: number;
  gasLimitMultiplierBps: number;
};

export type TronChainConfig = BaseChainConfig & {
  family: "tron";
  energyByTier: Record<string, number>;
  bandwidthByTier: Record<string, number>;
  refundEnergyByTier: Record<string, number>;
  refundBandwidthByTier: Record<string, number>;
  defiEnergyByTier: Record<string, number>;
  defiBandwidthByTier: Record<string, number>;
  maxEnergy: number;
  maxFeeSun: number;
  feeLimitMultiplierBps: number;
};

export type ChainConfig = EvmChainConfig | TronChainConfig;

export type RelayerConfig = {
  host: string;
  port: number;
  databasePath: string;
  quoteTtlSeconds: number;
  pricingMaxAgeSeconds: number;
  priceCacheSeconds: number;
  priceRequestTimeoutMs: number;
  priceSafetyMarginBps: number;
  serviceFeeBps: number;
  maxTotalFeeBps: number;
  maxRequestBytes: number;
  maxQueuedPerChain: number;
  globalRateLimitPerMinute: number;
  trustProxy: boolean | number;
  corsOrigins: string[];
  chains: ChainConfig[];
};
