import { Injectable } from "@nestjs/common";
import { ZERO_ADDRESS } from "../chain/address";
import { RelayerError } from "../common/errors";
import { ConfigurationService } from "../config/configuration.service";
import { OperationService } from "../operations/operation.service";
import { QuoteService } from "../quotes/quote.service";
import { parseWithdrawalCalldata } from "./calldata";
import type { SubmitWithdrawDto } from "./dto";

@Injectable()
export class WithdrawService {
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly quotes: QuoteService,
    private readonly operations: OperationService,
  ) {}

  submit(input: SubmitWithdrawDto) {
    const chain = this.configuration.chain(input.chainId);
    const quote = this.quotes.get(input.quoteId);
    if (quote.operation !== "withdraw" || quote.chainId !== input.chainId || quote.gravArc !== chain.gravArc) throw new RelayerError("QUOTE_MISMATCH", "Quote does not authorize a withdrawal on this chain and GravArc contract", 409);
    const withdrawal = parseWithdrawalCalldata(input.calldata, chain.family, this.configuration.value.maxRequestBytes);
    if (withdrawal.recipient === ZERO_ADDRESS) throw new RelayerError("RECIPIENT_INVALID", "Withdrawal recipient cannot be zero", 422);
    if (withdrawal.token !== quote.token || withdrawal.expectedAmount.toString() !== quote.amount || withdrawal.tier !== quote.tier) {
      throw new RelayerError("QUOTE_MISMATCH", "Withdrawal token, amount, or tier does not match the quote", 409);
    }
    if (withdrawal.fee.toString() !== quote.fee || withdrawal.relayer !== quote.relayer) {
      throw new RelayerError("QUOTE_MISMATCH", "Withdrawal fee or relayer does not match the quote", 409);
    }
    if (withdrawal.fee >= withdrawal.expectedAmount) throw new RelayerError("FEE_EXCEEDS_AMOUNT", "Withdrawal fee must be less than its amount", 422);
    return this.operations.create({
      quoteId: quote.id, chainId: chain.chainId, gravArc: chain.gravArc, calldata: input.calldata.toLowerCase(),
      operation: "withdraw", nullifierHash: withdrawal.nullifierHash, nonce: withdrawal.nonce,
      reservationKey: `${withdrawal.nullifierHash}:${withdrawal.nonce}`,
    });
  }
}
