export type QuoteRecord = {
  id: string;
  chainId: number;
  gravArc: string;
  relayer: string;
  token: string;
  amount: string;
  tier: number;
  networkFee: string;
  serviceFee: string;
  fee: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
};

export type OperationState = "queued" | "simulating" | "signed" | "submitted" | "confirmed" | "failed";

export type OperationRecord = {
  id: string;
  quoteId: string;
  chainId: number;
  requestHash: string;
  nullifierHash: string;
  withdrawNonce: string;
  state: OperationState;
  calldata: string;
  signedPayload: string | null;
  txHash: string | null;
  blockNumber: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
};

export type NewQuote = Omit<QuoteRecord, "usedAt">;
export type NewOperation = Pick<OperationRecord, "id" | "quoteId" | "chainId" | "requestHash" | "nullifierHash" | "withdrawNonce" | "calldata">;
