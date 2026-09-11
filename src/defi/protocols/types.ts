import type { ChainConfig, DefiProtocolConfig } from "../../config/types";

export type DefiCall = { target: string; value: bigint; data: string };

export type ProtocolCallValidation = {
  calls: DefiCall[];
  chain: ChainConfig;
  protocol: DefiProtocolConfig;
  inputToken: string;
  defiAmount: bigint;
};

