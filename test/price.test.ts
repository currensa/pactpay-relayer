import assert from "node:assert/strict";
import test from "node:test";
import { basisPointsCeil, decimalFraction, nativeCostInToken } from "../src/chain/price";

test("converts native network cost into token base units without floating point", () => {
  assert.deepEqual(decimalFraction("0.5"), { numerator: 5n, scale: 10n });
  assert.equal(nativeCostInToken(1_000_000_000_000_000_000n, 18, 6, "0.5"), 2_000_000n);
  assert.equal(nativeCostInToken(1n, 18, 6, "0.5"), 1n);
});

test("rounds the 0.1 percent service fee up in base units", () => {
  assert.equal(basisPointsCeil(1_000_000n, 10), 1_000n);
  assert.equal(basisPointsCeil(1n, 10), 1n);
});
