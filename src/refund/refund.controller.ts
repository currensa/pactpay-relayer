import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { displayAddress } from "../chain/address";
import { ConfigurationService } from "../config/configuration.service";
import { OperationService } from "../operations/operation.service";
import { CreateRefundQuoteDto } from "../quotes/dto";
import { QuoteService } from "../quotes/quote.service";
import { SubmitRefundDto } from "./dto";
import { RefundService } from "./refund.service";

@Controller("v1/refund")
export class RefundController {
  constructor(
    private readonly refunds: RefundService,
    private readonly quotes: QuoteService,
    private readonly configuration: ConfigurationService,
    private readonly operations: OperationService,
  ) {}

  @Post("quote")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async quote(@Body() input: CreateRefundQuoteDto) {
    const quote = await this.quotes.createRefund(input);
    const chain = this.configuration.chain(quote.chainId);
    return {
      id: quote.id, operation: quote.operation, chainId: quote.chainId,
      gravArc: quote.gravArc, gravArcDisplay: displayAddress(quote.gravArc, chain.family),
      relayer: quote.relayer, relayerDisplay: displayAddress(quote.relayer, chain.family),
      token: quote.token, amount: quote.amount, tier: quote.tier,
      networkFee: quote.networkFee, serviceFee: quote.serviceFee, fee: quote.fee,
      serviceFeeBps: this.configuration.value.serviceFeeBps,
      expiresAt: new Date(quote.expiresAt).toISOString(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Body() input: SubmitRefundDto) {
    const result = this.refunds.submit(input);
    return { ...this.operations.public(result.operation), idempotent: !result.created };
  }
}
