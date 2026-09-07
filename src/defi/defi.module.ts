import { Module } from "@nestjs/common";
import { OperationModule } from "../operations/operation.module";
import { QuoteModule } from "../quotes/quote.module";
import { DefiController } from "./defi.controller";
import { DefiService } from "./defi.service";

@Module({ imports: [QuoteModule, OperationModule], controllers: [DefiController], providers: [DefiService] })
export class DefiModule {}
