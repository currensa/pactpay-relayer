import { Module } from "@nestjs/common";
import { OperationModule } from "../operations/operation.module";
import { QuoteModule } from "../quotes/quote.module";
import { WithdrawController } from "./withdraw.controller";
import { WithdrawService } from "./withdraw.service";

@Module({ imports: [QuoteModule, OperationModule], controllers: [WithdrawController], providers: [WithdrawService] })
export class WithdrawModule {}
