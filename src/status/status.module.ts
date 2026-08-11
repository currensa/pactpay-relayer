import { Module } from "@nestjs/common";
import { QuoteModule } from "../quotes/quote.module";
import { StatusController } from "./status.controller";
import { StatusService } from "./status.service";

@Module({ imports: [QuoteModule], controllers: [StatusController], providers: [StatusService] })
export class StatusModule {}
