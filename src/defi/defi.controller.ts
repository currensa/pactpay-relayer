import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { displayAddress } from "../chain/address";
import { ConfigurationService } from "../config/configuration.service";
import { OperationService } from "../operations/operation.service";
import { CreateDefiQuoteDto } from "../quotes/dto";
import { QuoteService } from "../quotes/quote.service";
import { DefiService } from "./defi.service";
import { SubmitDefiDto } from "./dto";

@Controller("v1/defi")
export class DefiController {
  constructor(private readonly defi: DefiService, private readonly quotes: QuoteService, private readonly configuration: ConfigurationService, private readonly operations: OperationService) {}
  @Post("quote") @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async quote(@Body() input: CreateDefiQuoteDto) {
    const quote = await this.quotes.createDefi(input); const chain = this.configuration.chain(quote.chainId);
    return {
      id: quote.id, operation: quote.operation, chainId: quote.chainId, gravArc: chain.gravArc,
      defiRouter: quote.gravArc, defiRouterDisplay: displayAddress(quote.gravArc, chain.family),
      relayer: quote.relayer, relayerDisplay: displayAddress(quote.relayer, chain.family),
      token: quote.token, amount: quote.amount, tier: quote.tier, networkFee: quote.networkFee,
      serviceFee: quote.serviceFee, fee: quote.fee, serviceFeeBps: this.configuration.value.serviceFeeBps,
      expiresAt: new Date(quote.expiresAt).toISOString(),
    };
  }
  @Post() @HttpCode(HttpStatus.ACCEPTED) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Body() input: SubmitDefiDto) {
    const result = this.defi.submit(input); return { ...this.operations.public(result.operation), idempotent: !result.created };
  }
}
