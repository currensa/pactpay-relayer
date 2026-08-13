import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { displayAddress } from "../chain/address";
import { ConfigurationService } from "../config/configuration.service";
import { CreateWithdrawQuoteDto } from "./dto";
import { QuoteService } from "./quote.service";

@Controller("v1/withdraw")
export class QuoteController {
  constructor(private readonly quotes: QuoteService, private readonly configuration: ConfigurationService) {}

  @Post("quote")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(@Body() input: CreateWithdrawQuoteDto) {
    const quote = await this.quotes.createWithdraw(input);
    const chain = this.configuration.chain(quote.chainId);
    return {
      id: quote.id,
      operation: quote.operation,
      chainId: quote.chainId,
      gravArc: quote.gravArc,
      gravArcDisplay: displayAddress(quote.gravArc, chain.family),
      relayer: quote.relayer,
      relayerDisplay: displayAddress(quote.relayer, chain.family),
      token: quote.token,
      amount: quote.amount,
      tier: quote.tier,
      networkFee: quote.networkFee,
      serviceFee: quote.serviceFee,
      fee: quote.fee,
      serviceFeeBps: this.configuration.value.serviceFeeBps,
      expiresAt: new Date(quote.expiresAt).toISOString(),
    };
  }
}
