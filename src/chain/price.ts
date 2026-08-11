export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

export function decimalFraction(value: string): { numerator: bigint; scale: bigint } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const [whole = "0", fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * scale + BigInt(fraction || "0");
  if (numerator <= 0n) throw new Error("Price ratio must be positive");
  return { numerator, scale };
}

/** Convert native base units into token base units, rounding up. */
export function nativeCostInToken(
  nativeCost: bigint,
  nativeDecimals: number,
  tokenDecimals: number,
  nativePerToken: string,
): bigint {
  const ratio = decimalFraction(nativePerToken);
  const numerator = nativeCost * (10n ** BigInt(tokenDecimals)) * ratio.scale;
  const denominator = (10n ** BigInt(nativeDecimals)) * ratio.numerator;
  return ceilDiv(numerator, denominator);
}

export function basisPointsCeil(amount: bigint, bps: number): bigint {
  return ceilDiv(amount * BigInt(bps), 10_000n);
}
