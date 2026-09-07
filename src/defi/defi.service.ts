import { Injectable } from "@nestjs/common";
import { canonicalAddress } from "../chain/address";
import { RelayerError } from "../common/errors";
import { ConfigurationService } from "../config/configuration.service";
import { OperationService } from "../operations/operation.service";
import { QuoteService } from "../quotes/quote.service";
import { parseDefiCalldata } from "./calldata";
import type { SubmitDefiDto } from "./dto";

@Injectable()
export class DefiService {
  constructor(private readonly configuration: ConfigurationService, private readonly quotes: QuoteService, private readonly operations: OperationService) {}
  submit(input: SubmitDefiDto) {
    const chain = this.configuration.chain(input.chainId);
    if (!chain.defiRouter) throw new RelayerError("DEFI_UNAVAILABLE", "DeFi relay is not configured for this chain", 422);
    const quote = this.quotes.get(input.quoteId);
    const value = parseDefiCalldata(input.calldata, chain, this.configuration.value.maxRequestBytes);
    if (quote.operation !== "defi" || quote.chainId !== chain.chainId || quote.gravArc !== chain.defiRouter
      || value.token !== quote.token || value.tier !== quote.tier || value.defiAmount.toString() !== quote.amount) {
      throw new RelayerError("QUOTE_MISMATCH", "DeFi calldata does not match the quote", 409);
    }
    if (value.defiFee.toString() !== quote.fee) throw new RelayerError("QUOTE_MISMATCH", "DeFi relayer fee does not match the quote", 409);
    return this.operations.create({
      operation: "defi", quoteId: quote.id, chainId: chain.chainId, gravArc: chain.defiRouter,
      calldata: input.calldata.toLowerCase(), reservationKey: value.reservationKey,
      nullifierHash: value.nullifierHash, nonce: value.nonce,
    });
  }
}
