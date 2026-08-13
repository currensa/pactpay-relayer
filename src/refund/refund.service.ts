import { Injectable } from "@nestjs/common";
import { ZERO_ADDRESS } from "../chain/address";
import { RelayerError } from "../common/errors";
import { ConfigurationService } from "../config/configuration.service";
import { OperationService } from "../operations/operation.service";
import { QuoteService } from "../quotes/quote.service";
import { parseRefundCalldata } from "./calldata";
import type { SubmitRefundDto } from "./dto";

@Injectable()
export class RefundService {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly quotes: QuoteService,
    private readonly operations: OperationService,
  ) {}

  submit(input: SubmitRefundDto) {
    const chain = this.configuration.chain(input.chainId);
    const quote = this.quotes.get(input.quoteId);
    if (quote.operation !== "refund" || quote.chainId !== input.chainId || quote.gravArc !== chain.gravArc) {
      throw new RelayerError("QUOTE_MISMATCH", "Quote does not authorize a refund on this chain and GravArc contract", 409);
    }
    const refund = parseRefundCalldata(input.calldata, chain.family, this.configuration.value.maxRequestBytes);
    if (refund.refunder === ZERO_ADDRESS) throw new RelayerError("REFUNDER_INVALID", "Refund recipient cannot be zero", 422);
    if (refund.token !== quote.token || refund.refundAmount.toString() !== quote.amount || refund.tier !== quote.tier) {
      throw new RelayerError("QUOTE_MISMATCH", "Refund token, amount, or tier does not match the quote", 409);
    }
    if (refund.fee.toString() !== quote.fee || refund.relayer !== quote.relayer) {
      throw new RelayerError("QUOTE_MISMATCH", "Refund fee or relayer does not match the quote", 409);
    }
    if (refund.refundAmount === 0n || refund.fee >= refund.refundAmount) throw new RelayerError("FEE_EXCEEDS_AMOUNT", "Refund fee must be less than its amount", 422);
    if (refund.fee * 1000n < refund.refundAmount) throw new RelayerError("FEE_TOO_LOW", "Refund fee does not satisfy the contract minimum", 422);
    return this.operations.create({
      operation: "refund", quoteId: quote.id, chainId: chain.chainId, gravArc: chain.gravArc,
      calldata: input.calldata.toLowerCase(), reservationKey: refund.reservationKey,
      nullifierHash: refund.reservationKey, nonce: 0n,
    });
  }
}
