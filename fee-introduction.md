# Relayer Fee Introduction

The relayer charges the operation token for submitting a transaction on the
user's behalf. Every quote separates the charge into:

- `networkFee`: the relayer's reserved network-cost allowance.
- `serviceFee`: the relayer service charge.
- `fee`: `networkFee + serviceFee`, which is bound to the proof and paid to the
  relayer on-chain.

API amounts are integer token base units. User-facing clients are responsible
for formatting them with the token's configured decimals.

## Network fee

The initial quote is produced before the client has generated the complete
proof and transaction calldata. It therefore uses the operation- and
tier-specific estimates in `relayer.config.json`.

For EVM chains, the relayer combines the configured gas estimate with the
current RPC gas price. For TRON, it combines configured Energy and Bandwidth
with the current chain resource prices. The chain's configured safety
multiplier is then applied.

Native-token network fees use a 1:1 conversion. For another supported token,
the relayer converts the native cost with CoinGecko prices, rounds upward, and
applies `priceSafetyMarginBps`. Quotes fail when required pricing is missing or
stale.

The quoted network fee is a fixed charge, not a later reimbursement of the
transaction receipt. Immediately before signing, the relayer simulates the
complete calldata and calculates a current padded network limit. It rejects the
operation if that limit costs more than the locked `networkFee`. A lower
simulation or final receipt does not reduce the user's fee.

The network itself charges only the resources actually consumed, up to the
signed transaction limit. On TRON, available staked or delegated resources can
reduce the TRX burned, but those resources still have an economic cost to the
relayer.

## Service fee

`serviceFeeBps` controls the service rate. The current value is `10` basis
points, or 0.1%. Calculations use integer base units and round upward.

For withdraw and refund:

```text
serviceFee = ceil(operationAmount * serviceFeeBps / 10,000)
fee        = networkFee + serviceFee
netAmount  = operationAmount - fee
```

For DeFi, the request amount is a gross private-withdrawal budget. The relayer
first reserves the network fee and finds the largest routed swap amount whose
service fee still fits inside that budget:

```text
swapAmount = floor((withdrawalBudget - networkFee) * 10,000
                   / (10,000 + serviceFeeBps))
serviceFee = ceil(swapAmount * serviceFeeBps / 10,000)
fee        = networkFee + serviceFee
```

Consequently, the current DeFi service fee is 0.1% of the routed swap amount,
not 0.1% of the gross withdrawal budget. Any base-unit rounding remainder is
not withdrawn and remains privately available.

## Operation settlement

- Withdraw: the recipient receives the gross withdrawal amount minus `fee`.
- Refund: the refunder receives the gross refund amount minus `fee`.
- DeFi: the configured protocol receives `swapAmount`, and the relayer receives
  `fee`.

The fee is locked into a short-lived, one-time quote. Because the proof binds
the exact fee and relayer address, changing it after simulation or confirmation
would require generating another proof. The current implementation therefore
does not perform receipt-based refunds or fee reconciliation.

## Safety limits

The relayer rejects quotes when the operation cannot cover the fee or when the
total fee exceeds `maxTotalFeeBps` of the applicable operation budget. It also
rejects execution when exact simulation exceeds the configured maximum gas or
Energy, or when its current padded cost exceeds the locked network fee.

Resource tables should be calibrated from successful confirmed transactions.
Withdrawal and TRON DeFi execution are nearly tier-independent, while refund
costs grow with the receiver tier because the contract processes more
nullifiers and public signals.
