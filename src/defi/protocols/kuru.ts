import { Interface } from "ethers";
import { GRAVARC_DEPOSIT_ABI } from "../../chain/abi";
import { canonicalAddress, ZERO_ADDRESS } from "../../chain/address";
import { RelayerError } from "../../common/errors";
import type { DefiProtocolConfig } from "../../config/types";
import type { DefiCall, ProtocolCallValidation } from "./types";

const MONAD_TESTNET_CHAIN_ID = 10143;
const erc20 = new Interface(["function approve(address spender,uint256 amount)"]);
const router = new Interface([
  "function anyToAnySwap(address[] marketAddresses,bool[] isBuy,bool[] nativeSend,address debitToken,address creditToken,uint256 amount,uint256 minAmountOut) payable returns (uint256 amountOut)",
]);
const gravArc = new Interface(GRAVARC_DEPOSIT_ABI);
const pureRouter = new Interface(["function sweepRemaining(address token,address recipient)"]);

function invalid(message: string): never {
  throw new RelayerError("KURU_CALLS_INVALID", message, 422);
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

function approval(call: DefiCall, token: string, spender: string, amount: bigint): void {
  if (call.target !== token || call.value !== 0n) invalid("Invalid Kuru token approval target or value");
  const decoded = parse(erc20, call.data, "approve");
  if (canonicalAddress(String(decoded.args[0]), "evm") !== spender || BigInt(decoded.args[1]) !== amount) {
    invalid("Invalid Kuru token approval");
  }
}

function sweep(call: DefiCall, pureRouterAddress: string, outputToken: string): void {
  if (call.target !== pureRouterAddress || call.value !== 0n) invalid("Invalid Kuru output sweep target or value");
  const decoded = parse(pureRouter, call.data, "sweepRemaining");
  if (canonicalAddress(String(decoded.args[0]), "evm") !== outputToken
    || canonicalAddress(String(decoded.args[1]), "evm") === ZERO_ADDRESS) {
    invalid("Invalid Kuru output sweep token or recipient");
  }
}

export function validateKuruConfig(protocol: DefiProtocolConfig, family: "evm" | "tron", label: string): void {
  if (family !== "evm") throw new Error(`${label} requires the EVM family`);
  for (const name of ["market", "vault", "marginAccount", "baseToken", "quoteToken"]) {
    if (!protocol.helpContracts[name] || protocol.helpContracts[name] === ZERO_ADDRESS) {
      throw new Error(`${label}.help-contracts.${name} is required`);
    }
  }
  if (protocol.helpContracts.baseToken === protocol.helpContracts.quoteToken) {
    throw new Error(`${label} baseToken and quoteToken must differ`);
  }
}

export function validateKuruCalls({ calls, chain, protocol, inputToken, defiAmount }: ProtocolCallValidation): void {
  if (chain.family !== "evm" || chain.chainId !== MONAD_TESTNET_CHAIN_ID) {
    invalid("Kuru is currently supported only on Monad Testnet");
  }
  if (!chain.pureRouter) invalid("PureRouter is unavailable");
  if (inputToken === ZERO_ADDRESS || defiAmount <= 0n) invalid("Kuru requires a positive ERC-20 input");
  if (calls.length !== 4 && calls.length !== 6) invalid("Kuru route must contain four or six calls");

  const market = protocol.helpContracts.market;
  const baseToken = protocol.helpContracts.baseToken;
  const quoteToken = protocol.helpContracts.quoteToken;
  if (!market || !baseToken || !quoteToken) invalid("Configured Kuru market or token pair is incomplete");

  approval(calls[0]!, inputToken, protocol.address, defiAmount);
  const swapCall = calls[1]!;
  if (swapCall.target !== protocol.address || swapCall.value !== 0n) invalid("Invalid Kuru Router target or value");
  const decoded = parse(router, swapCall.data, "anyToAnySwap");
  const markets = Array.from(decoded.args[0] as ArrayLike<string>).map((value) => canonicalAddress(value, "evm"));
  const directions = Array.from(decoded.args[1] as ArrayLike<boolean>);
  const nativeSend = Array.from(decoded.args[2] as ArrayLike<boolean>);
  const debitToken = canonicalAddress(String(decoded.args[3]), "evm");
  const outputToken = canonicalAddress(String(decoded.args[4]), "evm");
  const amount = BigInt(decoded.args[5]);
  const minimumOutput = BigInt(decoded.args[6]);
  if (markets.length !== 1 || markets[0] !== market || directions.length !== 1
    || nativeSend.length !== 1 || nativeSend[0] !== false) {
    invalid("Kuru route must use the configured market as one non-native hop");
  }
  const isBuy = directions[0] === true;
  const expectedInput = isBuy ? quoteToken : baseToken;
  const expectedOutput = isBuy ? baseToken : quoteToken;
  if (debitToken !== inputToken || inputToken !== expectedInput || outputToken !== expectedOutput
    || outputToken === inputToken || !chain.allowedTokens.includes(outputToken)) {
    invalid("Kuru token pair or direction is invalid");
  }
  if (amount !== defiAmount || minimumOutput <= 0n) invalid("Kuru exact-input amount or minimum output is invalid");
  approval(calls[2]!, inputToken, protocol.address, 0n);

  if (calls.length === 4) {
    sweep(calls[3]!, chain.pureRouter, outputToken);
    return;
  }

  const depositApproval = calls[3]!;
  if (depositApproval.target !== outputToken || depositApproval.value !== 0n) invalid("Invalid Kuru re-deposit approval target or value");
  const approvalData = parse(erc20, depositApproval.data, "approve");
  const depositAmount = BigInt(approvalData.args[1]);
  if (canonicalAddress(String(approvalData.args[0]), "evm") !== chain.gravArc
    || depositAmount <= 0n || depositAmount > minimumOutput) {
    invalid("Kuru re-deposit amount is not guaranteed by the committed minimum output");
  }
  const depositCall = calls[4]!;
  if (depositCall.target !== chain.gravArc || depositCall.value !== 0n) invalid("Invalid Kuru private re-deposit target or value");
  const depositData = parse(gravArc, depositCall.data, "deposit");
  const params = depositData.args[0] as Record<string, unknown>;
  if (canonicalAddress(String(params.token), "evm") !== outputToken
    || BigInt(String(params.totalAmount)) !== depositAmount) {
    invalid("Kuru private re-deposit token or amount does not match its approval");
  }
  sweep(calls[5]!, chain.pureRouter, outputToken);
}
