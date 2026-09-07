import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ChainModule } from "./chain/chain.module";
import { GlobalRateGuard } from "./common/global-rate.guard";
import { ConfigurationModule } from "./config/configuration.module";
import { DatabaseModule } from "./database/database.module";
import { OperationModule } from "./operations/operation.module";
import { PricingModule } from "./pricing/pricing.module";
import { QuoteModule } from "./quotes/quote.module";
import { StatusModule } from "./status/status.module";
import { WithdrawModule } from "./withdraw/withdraw.module";
import { RefundModule } from "./refund/refund.module";
import { DefiModule } from "./defi/defi.module";

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    ChainModule,
    PricingModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    QuoteModule,
    OperationModule,
    WithdrawModule,
    RefundModule,
    DefiModule,
    StatusModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: GlobalRateGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
