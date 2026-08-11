import type { ChainConfig, CircuitTier } from "../config/types";

export type SimulationResult = {
  executionUnits: bigint;
  transactionLimit: bigint;
  nativeCost: bigint;
  signingData?: Record<string, string>;
};

export type SignedTransaction = {
  hash: string;
  payload: string;
};

export type TransactionStatus =
  | { state: "pending" }
  | { state: "confirmed"; blockNumber: number; confirmations: number }
  | { state: "failed"; blockNumber?: number; reason: string };

export interface ChainAdapter {
  readonly config: ChainConfig;
  readonly relayerCanonical: string;
  readonly relayerDisplay: string;
  checkConnection(): Promise<void>;
  estimateNativeNetworkCosts(tiers: CircuitTier[]): Promise<Map<CircuitTier, bigint>>;
  simulate(calldata: string): Promise<SimulationResult>;
  simulatedNativeCost(simulation: SimulationResult): Promise<bigint>;
  sign(calldata: string, simulation: SimulationResult): Promise<SignedTransaction>;
  broadcast(transaction: SignedTransaction): Promise<void>;
  transactionStatus(hash: string): Promise<TransactionStatus>;
  close(): void;
}
