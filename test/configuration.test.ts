import assert from "node:assert/strict";
import test from "node:test";
import { parseConfiguration } from "../src/config/configuration.service";
import { validateProtocolConfig } from "../src/defi/protocols";

const token = "0x2222222222222222222222222222222222222222";

function publicConfiguration() {
  return {
    "12345": {
      chainName: "Test chain",
      family: "evm",
      rpcUrl: "wss://scanner.example",
      GravArc: "0x4444444444444444444444444444444444444444",
      erc20Tokens: [{ symbol: "USDC", name: "USD Coin", address: token }],
      wallet: {
        rpcUrls: ["https://wallet.example"],
        nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 },
      },
    },
  };
}

function relayerConfiguration(address = token) {
  return {
    chains: [{
      chainId: 12345,
      privateKeyEnv: "TEST_KEY",
      confirmations: 2,
      gasByTier: { "8": 100, "16": 110, "32": 120, "64": 130, "128": 140 },
      maxGas: 1000,
      nativePriceAssetId: "test-native",
      tokenPricing: [{ address, decimals: 6, priceAssetId: "usd-coin" }],
    }],
  };
}

test("merges public chain information with relayer policy", () => {
  const result = parseConfiguration(publicConfiguration(), relayerConfiguration());
  const chain = result.chains[0]!;
  assert.equal(chain.name, "Test chain");
  assert.equal(chain.rpcUrl, "https://wallet.example");
  assert.equal(chain.gravArc, "0x4444444444444444444444444444444444444444");
  assert.equal(chain.confirmations, 2);
  assert.equal(chain.nativePriceAssetId, "test-native");
  if (chain.family !== "evm") throw new Error("Expected EVM configuration");
  assert.equal(chain.refundGasByTier["8"], 200);
  assert.deepEqual(chain.tokens.map((entry) => [entry.symbol, entry.priceAssetId]), [["TEST", undefined], ["USDC", "usd-coin"]]);
});

test("rejects pricing for a token outside the public allowlist", () => {
  assert.throws(
    () => parseConfiguration(publicConfiguration(), relayerConfiguration("0x3333333333333333333333333333333333333333")),
    /not listed in the public chain configuration/,
  );
});

test("preserves and validates named Uniswap V3 helper contracts", () => {
  const publicValue = publicConfiguration() as Record<string, Record<string, unknown>>;
  const router = "0x3333333333333333333333333333333333333333";
  publicValue["12345"]!.defiProtocols = [{
    name: "Uniswap V3",
    type: "uniswap-v3",
    address: router,
    "help-contracts": {
      factory: "0x5555555555555555555555555555555555555555",
      quoterV2: "0x6666666666666666666666666666666666666666",
      swapRouter02: router,
      weth9: "0x7777777777777777777777777777777777777777",
    },
  }];
  const chain = parseConfiguration(publicValue, relayerConfiguration()).chains[0]!;
  assert.deepEqual(chain.defiProtocols[0]!.helpContracts, {
    factory: "0x5555555555555555555555555555555555555555",
    quoterV2: "0x6666666666666666666666666666666666666666",
    swapRouter02: router,
    weth9: "0x7777777777777777777777777777777777777777",
  });

  const invalid = structuredClone(publicValue);
  const protocols = invalid["12345"]!.defiProtocols as Array<Record<string, unknown>>;
  (protocols[0]!["help-contracts"] as Record<string, string>).swapRouter02 =
    "0x8888888888888888888888888888888888888888";
  assert.throws(() => parseConfiguration(invalid, relayerConfiguration()), /must match/);
});

test("validates the SunSwap V4 family and named helper contracts", () => {
  const router = "0x3333333333333333333333333333333333333333";
  const protocol = {
    name: "SunSwap V4",
    type: "sunswap-v4",
    address: router,
    helpContracts: {
      universalRouter: router,
      permit2: "0x5555555555555555555555555555555555555555",
      poolManager: "0x6666666666666666666666666666666666666666",
      quoter: "0x7777777777777777777777777777777777777777",
    },
  };
  assert.doesNotThrow(() => validateProtocolConfig(protocol, "tron", "SunSwap"));
  assert.throws(() => validateProtocolConfig(protocol, "evm", "SunSwap"), /TRON family/);
  assert.throws(
    () => validateProtocolConfig({ ...protocol, helpContracts: { ...protocol.helpContracts, universalRouter: token } }, "tron", "SunSwap"),
    /must match/,
  );
});

test("validates Kuru's configured market and supports explicit test-only pricing", () => {
  const publicValue = publicConfiguration() as Record<string, Record<string, unknown>>;
  const router = "0x3333333333333333333333333333333333333333";
  publicValue["12345"]!.defiProtocols = [{
    name: "Kuru",
    type: "kuru",
    address: router,
    "help-contracts": {
      market: "0x5555555555555555555555555555555555555555",
      vault: "0x6666666666666666666666666666666666666666",
      marginAccount: "0x7777777777777777777777777777777777777777",
      baseToken: token,
      quoteToken: "0x8888888888888888888888888888888888888888",
    },
  }];
  const privateValue = relayerConfiguration();
  delete (privateValue.chains[0] as Record<string, unknown>).nativePriceAssetId;
  privateValue.chains[0]!.tokenPricing = [{ address: token, decimals: 6, testOnlyNativePerToken: "1" } as never];
  const chain = parseConfiguration(publicValue, privateValue).chains[0]!;
  assert.equal(chain.tokens[1]!.testOnlyNativePerToken, "1");
  assert.doesNotThrow(() => validateProtocolConfig(chain.defiProtocols[0]!, "evm", "Kuru"));
  assert.throws(
    () => validateProtocolConfig({ ...chain.defiProtocols[0]!, helpContracts: { ...chain.defiProtocols[0]!.helpContracts, quoteToken: token } }, "evm", "Kuru"),
    /must differ/,
  );
});
