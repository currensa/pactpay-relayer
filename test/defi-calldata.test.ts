import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, concat, getBytes, keccak256 } from "ethers";
import { DEFI_ROUTER_ABI, GRAVARC_DEPOSIT_ABI } from "../src/chain/abi";
import { parseDefiCalldata } from "../src/defi/calldata";
import { DefiService } from "../src/defi/defi.service";
import type { ConfigurationService } from "../src/config/configuration.service";
import type { QuoteService } from "../src/quotes/quote.service";
import type { OperationService } from "../src/operations/operation.service";
import { evmChain } from "./helpers";

const protocol = "0x1111111111111111111111111111111111111111";
const inputToken = "0x2222222222222222222222222222222222222222";
const defiRouter = "0x3333333333333333333333333333333333333333";
const pureRouter = "0x5555555555555555555555555555555555555555";
const outputToken = "0x6666666666666666666666666666666666666666";
const swapRouter02 = "0x7777777777777777777777777777777777777777";
const factory = "0x8888888888888888888888888888888888888888";
const quoterV2 = "0x9999999999999999999999999999999999999999";
const weth9 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const publicRecipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const excessRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";
const permit2Address = "0xdddddddddddddddddddddddddddddddddddddddd";
const erc20 = new Interface(["function approve(address spender,uint256 amount)"]);
const uniswap = new Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
]);
const gravArcDeposit = new Interface(GRAVARC_DEPOSIT_ABI);
const sweeper = new Interface(["function sweepRemaining(address token,address recipient)"]);
const coder = AbiCoder.defaultAbiCoder();

function calldata(calls = [{ target: protocol, value: 0n, data: "0x1234" }], token = inputToken) {
  const hashes = calls.map((call) => keccak256(coder.encode(["address", "uint256", "bytes"], [call.target, call.value, call.data])));
  const commitment = `0x${keccak256(coder.encode(["uint256", "bytes32"], [10n, keccak256(concat(hashes.map((hash) => getBytes(hash))))])).slice(-40)}`;
  return new Interface(DEFI_ROUTER_ABI).encodeFunctionData("defiRouting", [{
    pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n], nullifierHash: `0x${"aa".repeat(32)}`,
    recipient: commitment, claimedAmount: 0n, token, tier: 8, depositRoot: 9n,
    expectedAmount: 110n, fee: 110n, relayer: defiRouter, nonce: 2n,
  }, { defiFee: 10n, defiCalls: calls }]);
}

test("validates proof-bound DeFi calldata and derives the routed amount", () => {
  const chain = {
    ...evmChain(), defiRouter, pureRouter, allowedTokens: [inputToken],
    defiProtocols: [{ name: "MockSwap", type: "mock-swap", address: protocol, helpContracts: {} }],
  };
  const result = parseDefiCalldata(calldata(), chain, 65_536);
  assert.equal(result.defiAmount, 100n);
  assert.equal(result.defiFee, 10n);
  assert.equal(result.reservationKey, `${result.nullifierHash}:2`);
});

test("rejects DeFi calldata when the protocol target is not allowlisted", () => {
  const chain = { ...evmChain(), defiRouter, pureRouter, allowedTokens: [inputToken], defiProtocols: [] };
  assert.throws(() => parseDefiCalldata(calldata(), chain, 65_536), /outside the configured allowlist/);
});

test("rejects private re-deposit calls on TRON", () => {
  const base = evmChain();
  const resources = { "8": 100, "16": 100, "32": 100, "64": 100, "128": 100 };
  const chain = {
    ...base,
    family: "tron" as const,
    defiRouter,
    pureRouter,
    allowedTokens: [inputToken],
    defiProtocols: [{ name: "SunSwap V4", type: "sunswap-v4", address: protocol, helpContracts: {} }],
    energyByTier: resources,
    bandwidthByTier: resources,
    refundEnergyByTier: resources,
    refundBandwidthByTier: resources,
    defiEnergyByTier: resources,
    defiBandwidthByTier: resources,
    maxEnergy: 10_000,
    maxFeeSun: 10_000,
    feeLimitMultiplierBps: 10_000,
  };
  assert.throws(() => parseDefiCalldata(calldata([
    { target: protocol, value: 0n, data: "0x1234" },
    { target: base.gravArc, value: 0n, data: "0x5678" },
  ]), chain, 65_536), /Private re-deposit is not supported on TRON/);
});

const sunRouter = new Interface(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const sunPermit2 = new Interface(["function approve(address token,address spender,uint160 amount,uint48 expiration)"]);
const actionSwapType = "tuple(tuple(address currency0,address currency1,address hooks,uint24 fee,bytes32 parameters) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)";

function sunSwapCalls(options: {
  inputToken?: string;
  amount?: bigint;
  minimumOutput?: bigint;
  recipient?: string;
  deadline?: bigint;
  commands?: string;
} = {}) {
  const tokenIn = options.inputToken ?? inputToken;
  const amount = options.amount ?? 100n;
  const minimumOutput = options.minimumOutput ?? 90n;
  const deadline = options.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 1800);
  const native = tokenIn === "0x0000000000000000000000000000000000000000";
  const actionInputs = [
    coder.encode(["address", "uint256", "bool"], [tokenIn, amount, !native]),
    coder.encode([actionSwapType], [{
      poolKey: { currency0: tokenIn, currency1: outputToken, hooks: "0x0000000000000000000000000000000000000000", fee: 3000, parameters: `0x${"00".repeat(32)}` },
      zeroForOne: true, amountIn: 0n, amountOutMinimum: minimumOutput,
      hookData: "0x0000000000000000000000000000000000000000",
    }]),
    coder.encode(["address", "address", "uint256"], [outputToken, "0x0000000000000000000000000000000000000002", 0n]),
    coder.encode(["address", "address", "uint256"], [tokenIn, "0x0000000000000000000000000000000000000002", 0n]),
  ];
  const inputs = [
    coder.encode(["bytes", "bytes[]"], ["0x0b060e0e", actionInputs]),
    coder.encode(["address", "address", "uint160"], [outputToken, options.recipient ?? publicRecipient, minimumOutput]),
  ];
  const execute = {
    target: protocol,
    value: native ? amount : 0n,
    data: sunRouter.encodeFunctionData("execute", [options.commands ?? "0x1204", inputs, deadline]),
  };
  if (native) return [execute];
  return [
    { target: tokenIn, value: 0n, data: erc20.encodeFunctionData("approve", [permit2Address, amount]) },
    { target: permit2Address, value: 0n, data: sunPermit2.encodeFunctionData("approve", [tokenIn, protocol, amount, deadline]) },
    execute,
    { target: permit2Address, value: 0n, data: sunPermit2.encodeFunctionData("approve", [tokenIn, protocol, 0n, 0n]) },
    { target: tokenIn, value: 0n, data: erc20.encodeFunctionData("approve", [permit2Address, 0n]) },
  ];
}

function sunSwapChain() {
  const resources = { "8": 100, "16": 100, "32": 100, "64": 100, "128": 100 };
  return {
    ...evmChain(), family: "tron" as const, defiRouter, pureRouter,
    allowedTokens: ["0x0000000000000000000000000000000000000000", inputToken, outputToken],
    defiProtocols: [{
      name: "SunSwap V4", type: "sunswap-v4", address: protocol,
      helpContracts: { universalRouter: protocol, permit2: permit2Address, poolManager: factory, quoter: quoterV2 },
    }],
    energyByTier: resources, bandwidthByTier: resources,
    refundEnergyByTier: resources, refundBandwidthByTier: resources,
    defiEnergyByTier: resources, defiBandwidthByTier: resources,
    maxEnergy: 10_000, maxFeeSun: 10_000, feeLimitMultiplierBps: 10_000,
  };
}

test("validates isolated SunSwap V4 ERC-20 and native routes", () => {
  const erc20Result = parseDefiCalldata(calldata(sunSwapCalls()), sunSwapChain(), 65_536);
  assert.equal(erc20Result.defiAmount, 100n);
  const native = "0x0000000000000000000000000000000000000000";
  const nativeResult = parseDefiCalldata(calldata(sunSwapCalls({ inputToken: native }), native), sunSwapChain(), 65_536);
  assert.equal(nativeResult.token, native);
});

test("rejects tampered SunSwap V4 commands, amounts, recipients, and deadlines", () => {
  assert.throws(
    () => parseDefiCalldata(calldata(sunSwapCalls({ commands: "0x1205" })), sunSwapChain(), 65_536),
    /one V4 swap and one output sweep/,
  );
  assert.throws(
    () => parseDefiCalldata(calldata(sunSwapCalls({ amount: 99n })), sunSwapChain(), 65_536),
    /token approval/,
  );
  assert.throws(
    () => parseDefiCalldata(calldata(sunSwapCalls({ recipient: "0x0000000000000000000000000000000000000000" })), sunSwapChain(), 65_536),
    /output sweep is invalid/,
  );
  assert.throws(
    () => parseDefiCalldata(calldata(sunSwapCalls({ deadline: BigInt(Math.floor(Date.now() / 1000) - 1) })), sunSwapChain(), 65_536),
    /deadline is expired/,
  );
});

function uniswapProtocol() {
  return {
    name: "Uniswap V3",
    type: "uniswap-v3",
    address: swapRouter02,
    helpContracts: { factory, quoterV2, swapRouter02, weth9 },
  };
}

function uniswapCalls(options: { recipient?: string; amountIn?: bigint; deadline?: bigint; privateRedeposit?: boolean } = {}) {
  const recipient = options.recipient ?? publicRecipient;
  const swap = uniswap.encodeFunctionData("exactInputSingle", [[
    inputToken, outputToken, 500n, recipient, options.amountIn ?? 100n, 90n, 0n,
  ]]);
  const calls = [
    { target: inputToken, value: 0n, data: erc20.encodeFunctionData("approve", [swapRouter02, 100n]) },
    { target: swapRouter02, value: 0n, data: uniswap.encodeFunctionData("multicall", [
      options.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 1800), [swap],
    ]) },
    { target: inputToken, value: 0n, data: erc20.encodeFunctionData("approve", [swapRouter02, 0n]) },
  ];
  if (options.privateRedeposit) {
    calls.push(
      { target: outputToken, value: 0n, data: erc20.encodeFunctionData("approve", [evmChain().gravArc, 80n]) },
      { target: evmChain().gravArc, value: 0n, data: gravArcDeposit.encodeFunctionData("deposit", [[
        [1n, 2n], [[3n, 4n], [5n, 6n]], [7n, 8n], 9n, 10n, 80n, outputToken, 8n,
      ]]) },
      { target: pureRouter, value: 0n, data: sweeper.encodeFunctionData("sweepRemaining", [outputToken, excessRecipient]) },
    );
  }
  return calls;
}

function uniswapChain() {
  return {
    ...evmChain(),
    defiRouter,
    pureRouter,
    allowedTokens: [inputToken, outputToken],
    defiProtocols: [uniswapProtocol()],
  };
}

test("validates nested Uniswap V3 public-output calldata", () => {
  const result = parseDefiCalldata(calldata(uniswapCalls()), uniswapChain(), 65_536);
  assert.equal(result.token, inputToken);
  assert.equal(result.defiAmount, 100n);
  assert.equal(result.privateRedeposit, false);
  assert.equal(result.redepositTier, null);
});

test("validates Uniswap V3 fixed private re-deposit and excess sweep", () => {
  const calls = uniswapCalls({ recipient: pureRouter, privateRedeposit: true });
  const result = parseDefiCalldata(calldata(calls), uniswapChain(), 65_536);
  assert.equal(result.defiAmount, 100n);
  assert.equal(result.privateRedeposit, true);
  assert.equal(result.redepositTier, 8);
});

test("does not authorize private re-deposit calldata with a public-output quote", () => {
  const chain = uniswapChain();
  const calls = uniswapCalls({ recipient: pureRouter, privateRedeposit: true });
  const quote = {
    id: "quote", operation: "defi", chainId: chain.chainId, gravArc: defiRouter, relayer: publicRecipient,
    token: inputToken, amount: "100", tier: 8, privateRedeposit: false, redepositTier: null,
    networkFee: "9", serviceFee: "1", fee: "10", createdAt: Date.now(), expiresAt: Date.now() + 60_000, usedAt: null,
  };
  const service = new DefiService(
    { chain: () => chain, value: { maxRequestBytes: 65_536 } } as unknown as ConfigurationService,
    { get: () => quote } as unknown as QuoteService,
    { create: () => { throw new Error("must not create"); } } as unknown as OperationService,
  );
  assert.throws(
    () => service.submit({ chainId: chain.chainId, quoteId: quote.id, calldata: calldata(calls) }),
    /output mode or private re-deposit tier/,
  );
});

test("rejects tampered or expired nested Uniswap V3 calldata", () => {
  assert.throws(
    () => parseDefiCalldata(calldata(uniswapCalls({ amountIn: 99n })), uniswapChain(), 65_536),
    /exact-input parameters are invalid/,
  );
  assert.throws(
    () => parseDefiCalldata(calldata(uniswapCalls({ deadline: BigInt(Math.floor(Date.now() / 1000) - 1) })), uniswapChain(), 65_536),
    /deadline is expired/,
  );
  assert.throws(
    () => parseDefiCalldata(calldata(uniswapCalls({ recipient: pureRouter })), uniswapChain(), 65_536),
    /six calls/,
  );
});
