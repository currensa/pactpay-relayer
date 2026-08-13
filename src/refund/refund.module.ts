import { Module } from "@nestjs/common";
import { OperationModule } from "../operations/operation.module";
import { QuoteModule } from "../quotes/quote.module";
import { RefundController } from "./refund.controller";
import { RefundService } from "./refund.service";

@Module({ imports: [QuoteModule, OperationModule], controllers: [RefundController], providers: [RefundService] })
export class RefundModule {}
