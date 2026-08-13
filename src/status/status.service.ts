import { Injectable } from "@nestjs/common";
import { displayAddress } from "../chain/address";
import { ChainService } from "../chain/chain.service";
import { ConfigurationService } from "../config/configuration.service";
import { QuoteService } from "../quotes/quote.service";

@Injectable()
export class StatusService {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly chains: ChainService,
    private readonly quotes: QuoteService,
  ) {}

  async status() {
    const estimatedAt = Date.now();
    const chains = await Promise.all(this.configuration.value.chains.map(async (chain) => {
      const adapter = this.chains.get(chain.chainId);
      try {
        const [withdrawEstimates, refundEstimates] = await Promise.all([
          this.quotes.estimates("withdraw", chain.chainId),
          this.quotes.estimates("refund", chain.chainId),
        ]);
        const refunds = new Map(refundEstimates.map((entry) => [entry.token.address, entry]));
        return {
          chainId: chain.chainId,
          name: chain.name,
          family: chain.family,
          gravArc: chain.gravArc,
          gravArcDisplay: displayAddress(chain.gravArc, chain.family),
          relayer: adapter.relayerCanonical,
          relayerDisplay: adapter.relayerDisplay,
          confirmations: chain.confirmations,
          tokens: withdrawEstimates.map(({ token, ...withdraw }) => ({
            symbol: token.symbol, address: token.address, addressDisplay: displayAddress(token.address, chain.family), decimals: token.decimals,
            ...withdraw,
            networkFeeByOperation: {
              withdraw: withdraw.available ? withdraw.networkFeeByTier : null,
              refund: refunds.get(token.address)?.available ? refunds.get(token.address)?.networkFeeByTier : null,
            },
          })),
          operations: {
            withdraw: { available: true, serviceFeeBps: this.configuration.value.serviceFeeBps, quoteTtlSeconds: this.configuration.value.quoteTtlSeconds },
            refund: { available: true, serviceFeeBps: this.configuration.value.serviceFeeBps, quoteTtlSeconds: this.configuration.value.quoteTtlSeconds },
            defi: { available: false, estimatedFee: null },
          },
        };
      } catch (error) {
        return {
          chainId: chain.chainId, name: chain.name, family: chain.family,
          gravArc: chain.gravArc, gravArcDisplay: displayAddress(chain.gravArc, chain.family),
          relayer: adapter.relayerCanonical, relayerDisplay: adapter.relayerDisplay,
          operations: { withdraw: { available: false }, refund: { available: false }, defi: { available: false } },
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    return {
      status: chains.some((chain) => !('error' in chain)) ? "ready" : "unavailable",
      estimatedAt: new Date(estimatedAt).toISOString(),
      estimateExpiresAt: new Date(estimatedAt + this.configuration.value.quoteTtlSeconds * 1000).toISOString(),
      chains,
    };
  }
}
