import { AbiCoder, Interface, getBytes } from "ethers";
import { canonicalAddress, ZERO_ADDRESS } from "../../chain/address";
import { RelayerError } from "../../common/errors";
import type { DefiProtocolConfig } from "../../config/types";
import type { ProtocolCallValidation, DefiCall } from "./types";

const MAX_DEADLINE_SECONDS = 60 * 60;
const V4_SWAP_COMMAND = 0x12;
const SWEEP_COMMAND = 0x04;
const SETTLE_ACTION = 0x0b;
const CL_SWAP_EXACT_IN_SINGLE_ACTION = 0x06;
const TAKE_ACTION = 0x0e;
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const erc20 = new Interface(["function approve(address spender,uint256 amount)"]);
const permit2 = new Interface(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const universalRouter = new Interface(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const coder = AbiCoder.defaultAbiCoder();
const swapType = "tuple(tuple(address currency0,address currency1,address hooks,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)";

function invalid(message: string): never {
  throw new RelayerError("SUNSWAP_CALLS_INVALID", message, 422);
}

function parse(iface: Interface, data: string, name: string) {
  try {
    const value = iface.parseTransaction({ data });
    if (!value || value.name !== name) invalid(`Expected ${name} calldata`);
    return value;
  } catch (error) {
    if (error instanceof RelayerError) throw error;
    return invalid(`Expected ${name} calldata`);
  }
}

function decode(types: readonly string[], data: string, label: string) {
  try { return coder.decode(types, data); }
  catch { return invalid(`Invalid SunSwap ${label} calldata`); }
}

function address(value: unknown): string {
  try { return canonicalAddress(String(value), "tron"); }
  catch { return invalid("SunSwap calldata contains an invalid address"); }
}

function requireZeroValue(call: DefiCall, label: string): void {
  if (call.value !== 0n) invalid(`${label} must not transfer native TRX`);
}

function validateTokenApproval(call: DefiCall, token: string, spender: string, amount: bigint): void {
  if (call.target !== token) invalid("Invalid SunSwap token approval target");
  requireZeroValue(call, "SunSwap token approval");
  const parsed = parse(erc20, call.data, "approve");
  if (address(parsed.args[0]) !== spender || BigInt(parsed.args[1]) !== amount) {
    invalid("Invalid SunSwap token approval");
  }
}

function validatePermit2Approval(
  call: DefiCall,
  permit2Address: string,
  token: string,
  router: string,
  amount: bigint,
  expiration: bigint,
): void {
  if (call.target !== permit2Address) invalid("Invalid SunSwap Permit2 target");
  requireZeroValue(call, "SunSwap Permit2 approval");
  const parsed = parse(permit2, call.data, "approve");
  if (address(parsed.args[0]) !== token || address(parsed.args[1]) !== router
    || BigInt(parsed.args[2]) !== amount || BigInt(parsed.args[3]) !== expiration) {
    invalid("Invalid SunSwap Permit2 approval");
  }
}

export function validateSunSwapV4Config(protocol: DefiProtocolConfig, family: "evm" | "tron", label: string): void {
  if (family !== "tron") throw new Error(`${label} requires the TRON family`);
  for (const name of ["universalRouter", "permit2", "poolManager", "quoter"]) {
    if (!protocol.helpContracts[name] || protocol.helpContracts[name] === ZERO_ADDRESS) {
      throw new Error(`${label}.help-contracts.${name} is required`);
    }
  }
  if (protocol.helpContracts.universalRouter !== protocol.address) {
    throw new Error(`${label}.address must match help-contracts.universalRouter`);
  }
}

export function validateSunSwapV4Calls(
  { calls, chain, protocol, inputToken, defiAmount }: ProtocolCallValidation,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (chain.family !== "tron") invalid("SunSwap V4 is supported only on TRON");
  const { universalRouter: router, permit2: permit2Address } = protocol.helpContracts;
  if (!router || !permit2Address || router !== protocol.address) {
    invalid("Configured SunSwap router or Permit2 address is invalid");
  }
  if (defiAmount <= 0n) invalid("SunSwap V4 requires a positive input amount");
  const nativeInput = inputToken === ZERO_ADDRESS;
  if (calls.length !== (nativeInput ? 1 : 5)) {
    invalid(`SunSwap ${nativeInput ? "native" : "ERC-20"} route has an invalid call count`);
  }

  const executeIndex = nativeInput ? 0 : 2;
  const executeCall = calls[executeIndex]!;
  if (executeCall.target !== router || executeCall.value !== (nativeInput ? defiAmount : 0n)) {
    invalid("Invalid SunSwap Universal Router target or native value");
  }
  const execution = parse(universalRouter, executeCall.data, "execute");
  const commands = Array.from(getBytes(String(execution.args[0])));
  const inputs = Array.from(execution.args[1] as ArrayLike<string>);
  const deadline = BigInt(execution.args[2]);
  if (deadline <= BigInt(nowSeconds) || deadline > BigInt(nowSeconds + MAX_DEADLINE_SECONDS)) {
    invalid("SunSwap transaction deadline is expired or too far in the future");
  }
  if (commands.length !== 2 || commands[0] !== V4_SWAP_COMMAND || commands[1] !== SWEEP_COMMAND
    || inputs.length !== 2) {
    invalid("SunSwap route must contain exactly one V4 swap and one output sweep");
  }

  if (!nativeInput) {
    validateTokenApproval(calls[0]!, inputToken, permit2Address, defiAmount);
    validatePermit2Approval(calls[1]!, permit2Address, inputToken, router, defiAmount, deadline);
    validatePermit2Approval(calls[3]!, permit2Address, inputToken, router, 0n, 0n);
    validateTokenApproval(calls[4]!, inputToken, permit2Address, 0n);
  }

  const [actionsData, actionInputsRaw] = decode(["bytes", "bytes[]"], inputs[0]!, "V4 action plan");
  const actions = Array.from(getBytes(String(actionsData)));
  const actionInputs = Array.from(actionInputsRaw as ArrayLike<string>);
  if (actions.length !== 4 || actions[0] !== SETTLE_ACTION || actions[1] !== CL_SWAP_EXACT_IN_SINGLE_ACTION
    || actions[2] !== TAKE_ACTION || actions[3] !== TAKE_ACTION || actionInputs.length !== 4) {
    invalid("SunSwap V4 action plan is not a direct exact-input swap");
  }

  const settle = decode(["address", "uint256", "bool"], actionInputs[0]!, "settle");
  if (address(settle[0]) !== inputToken || BigInt(settle[1]) !== defiAmount
    || Boolean(settle[2]) !== !nativeInput) {
    invalid("SunSwap settlement does not match the withdrawn input");
  }

  const swap = decode([swapType], actionInputs[1]!, "exact-input swap")[0] as Record<string, unknown>;
  const pool = swap.poolKey as Record<string, unknown>;
  const currency0 = address(pool.currency0);
  const currency1 = address(pool.currency1);
  const zeroForOne = Boolean(swap.zeroForOne);
  const outputToken = zeroForOne ? currency1 : currency0;
  if ((zeroForOne ? currency0 : currency1) !== inputToken || outputToken === inputToken
    || !chain.allowedTokens.includes(outputToken) || address(pool.hooks) !== ZERO_ADDRESS) {
    invalid("SunSwap pool token direction, output token, or hook is invalid");
  }
  const minimumOutput = BigInt(String(swap.amountOutMinimum));
  if (BigInt(String(swap.amountIn)) !== 0n || minimumOutput <= 0n
    || String(swap.hookData) !== ZERO_ADDRESS) {
    invalid("SunSwap exact-input parameters are invalid");
  }

  const takeOutput = decode(["address", "address", "uint256"], actionInputs[2]!, "output take");
  const takeInput = decode(["address", "address", "uint256"], actionInputs[3]!, "input take");
  if (address(takeOutput[0]) !== outputToken || address(takeOutput[1]) !== ADDRESS_THIS || BigInt(takeOutput[2]) !== 0n
    || address(takeInput[0]) !== inputToken || address(takeInput[1]) !== ADDRESS_THIS || BigInt(takeInput[2]) !== 0n) {
    invalid("SunSwap V4 take actions are invalid");
  }

  const sweep = decode(["address", "address", "uint160"], inputs[1]!, "output sweep");
  if (address(sweep[0]) !== outputToken || address(sweep[1]) === ZERO_ADDRESS
    || BigInt(sweep[2]) <= 0n || BigInt(sweep[2]) !== minimumOutput) {
    invalid("SunSwap output sweep is invalid");
  }
}
