import { Interface } from "ethers";
import { GRAVARC_DEPOSIT_ABI } from "../../chain/abi";
import { canonicalAddress, ZERO_ADDRESS } from "../../chain/address";
import { RelayerError } from "../../common/errors";
import type { ChainConfig, DefiProtocolConfig } from "../../config/types";
import type { DefiCall } from "./types";

const FEE_TIERS = new Set([100n, 500n, 3000n, 10000n]);
const MAX_DEADLINE_SECONDS = 60 * 60;
const erc20 = new Interface(["function approve(address spender,uint256 amount)"]);
const router = new Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
]);
const gravArc = new Interface(GRAVARC_DEPOSIT_ABI);
const pureRouter = new Interface(["function sweepRemaining(address token,address recipient)"]);

function invalid(message: string): never {
  throw new RelayerError("UNISWAP_CALLS_INVALID", message, 422);
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

function approve(call: DefiCall, token: string, spender: string, amount: bigint): void {
  if (call.target !== token || call.value !== 0n) invalid("Invalid Uniswap token approval target or value");
  const decoded = parse(erc20, call.data, "approve");
  if (canonicalAddress(String(decoded.args[0]), "evm") !== spender || BigInt(decoded.args[1]) !== amount) {
    invalid("Invalid Uniswap token approval");
  }
}

export function validateUniswapV3Config(protocol: DefiProtocolConfig, family: "evm" | "tron", label: string): void {
  if (family !== "evm") throw new Error(`${label} requires the EVM family`);
  for (const name of ["factory", "quoterV2", "swapRouter02", "weth9"]) {
    if (!protocol.helpContracts[name] || protocol.helpContracts[name] === ZERO_ADDRESS) {
      throw new Error(`${label}.help-contracts.${name} is required`);
    }
  }
  if (protocol.helpContracts.swapRouter02 !== protocol.address) {
    throw new Error(`${label}.address must match help-contracts.swapRouter02`);
  }
}

function privateRedeposit(calls: DefiCall[], chain: ChainConfig, outputToken: string): void {
  if (!chain.pureRouter) invalid("PureRouter is unavailable");
  if (calls.length !== 6) invalid("Uniswap private re-deposit must contain exactly six calls");
  const approval = calls[3]!;
  if (approval.target !== outputToken || approval.value !== 0n) invalid("Invalid re-deposit approval target or value");
  const approvalData = parse(erc20, approval.data, "approve");
  const depositAmount = BigInt(approvalData.args[1]);
  if (canonicalAddress(String(approvalData.args[0]), "evm") !== chain.gravArc || depositAmount <= 0n) {
    invalid("Invalid re-deposit approval");
  }

  const deposit = calls[4]!;
  if (deposit.target !== chain.gravArc || deposit.value !== 0n) invalid("Invalid private re-deposit call");
  const depositData = parse(gravArc, deposit.data, "deposit");
  const params = depositData.args[0] as Record<string, unknown>;
  if (canonicalAddress(String(params.token), "evm") !== outputToken
    || BigInt(String(params.totalAmount)) !== depositAmount) {
    invalid("Private re-deposit token or amount does not match its approval");
  }

  const sweep = calls[5]!;
  if (sweep.target !== chain.pureRouter || sweep.value !== 0n) invalid("Invalid Uniswap excess sweep call");
  const sweepData = parse(pureRouter, sweep.data, "sweepRemaining");
  if (canonicalAddress(String(sweepData.args[0]), "evm") !== outputToken
    || canonicalAddress(String(sweepData.args[1]), "evm") === ZERO_ADDRESS) {
    invalid("Invalid Uniswap excess token or recipient");
  }
}

export function validateUniswapV3Calls(
  calls: DefiCall[],
  chain: ChainConfig,
  protocol: DefiProtocolConfig,
  inputToken: string,
  defiAmount: bigint,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (chain.family !== "evm") invalid("Uniswap V3 is supported only on EVM chains");
  const swapRouter02 = protocol.helpContracts.swapRouter02;
  if (!swapRouter02 || swapRouter02 !== protocol.address) invalid("Configured SwapRouter02 address is invalid");
  if (inputToken === ZERO_ADDRESS || defiAmount <= 0n) invalid("Uniswap V3 requires a positive ERC-20 input");
  if (calls.length !== 3 && calls.length !== 6) invalid("Uniswap route must contain three or six calls");

  approve(calls[0]!, inputToken, swapRouter02, defiAmount);
  const swapCall = calls[1]!;
  if (swapCall.target !== swapRouter02 || swapCall.value !== 0n) invalid("Invalid SwapRouter02 call target or value");
  const multicall = parse(router, swapCall.data, "multicall");
  const deadline = BigInt(multicall.args[0]);
  if (deadline <= BigInt(nowSeconds) || deadline > BigInt(nowSeconds + MAX_DEADLINE_SECONDS)) {
    invalid("Uniswap transaction deadline is expired or too far in the future");
  }
  const nested = Array.from(multicall.args[1] as ArrayLike<string>);
  if (nested.length !== 1) invalid("Uniswap multicall must contain exactly one swap");
  const exactInput = parse(router, nested[0]!, "exactInputSingle");
  const params = exactInput.args[0] as Record<string, unknown>;
  const tokenIn = canonicalAddress(String(params.tokenIn), "evm");
  const tokenOut = canonicalAddress(String(params.tokenOut), "evm");
  const recipient = canonicalAddress(String(params.recipient), "evm");
  if (tokenIn !== inputToken || tokenOut === ZERO_ADDRESS || tokenOut === tokenIn
    || !chain.allowedTokens.includes(tokenOut)) {
    invalid("Uniswap swap token pair is invalid or unsupported");
  }
  if (BigInt(String(params.amountIn)) !== defiAmount || BigInt(String(params.amountOutMinimum)) <= 0n
    || BigInt(String(params.sqrtPriceLimitX96)) !== 0n || !FEE_TIERS.has(BigInt(String(params.fee)))) {
    invalid("Uniswap exact-input parameters are invalid");
  }
  approve(calls[2]!, inputToken, swapRouter02, 0n);

  if (recipient === chain.pureRouter) privateRedeposit(calls, chain, tokenOut);
  else {
    if (recipient === ZERO_ADDRESS) invalid("Uniswap public output recipient is invalid");
    if (calls.length !== 3) invalid("Public Uniswap output cannot include private re-deposit calls");
  }
}
