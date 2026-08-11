import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { OperationService } from "../operations/operation.service";
import { SubmitWithdrawDto } from "./dto";
import { WithdrawService } from "./withdraw.service";

@Controller("v1/withdraw")
export class WithdrawController {
  constructor(private readonly withdrawals: WithdrawService, private readonly operations: OperationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  submit(@Body() input: SubmitWithdrawDto) {
    const result = this.withdrawals.submit(input);
    return { ...this.operations.public(result.operation), idempotent: !result.created };
  }
}
