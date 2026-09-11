import type { DefiProtocolConfig } from "../../config/types";
import { validateSunSwapV4Calls, validateSunSwapV4Config } from "./sunswap-v4";
import type { ProtocolCallValidation } from "./types";
import { validateUniswapV3Calls, validateUniswapV3Config } from "./uniswap-v3";

type Validator = (request: ProtocolCallValidation) => void;
type ConfigValidator = (protocol: DefiProtocolConfig, family: "evm" | "tron", label: string) => void;
type ProtocolDefinition = { validateCalls?: Validator; validateConfig?: ConfigValidator };

const protocols: Record<string, ProtocolDefinition> = {
  "mock-swap": {},
  "sunswap-v4": { validateCalls: validateSunSwapV4Calls, validateConfig: validateSunSwapV4Config },
  "uniswap-v3": {
    validateConfig: validateUniswapV3Config,
    validateCalls: ({ calls, chain, protocol, inputToken, defiAmount }) => (
      validateUniswapV3Calls(calls, chain, protocol, inputToken, defiAmount)
    ),
  },
};

export function validateProtocolCalls(request: ProtocolCallValidation): void {
  protocols[request.protocol.type]?.validateCalls?.(request);
}

export function validateProtocolConfig(protocol: DefiProtocolConfig, family: "evm" | "tron", label: string): void {
  const definition = protocols[protocol.type];
  if (!definition) throw new Error(`${label}.type is unsupported: ${protocol.type}`);
  definition.validateConfig?.(protocol, family, label);
}
