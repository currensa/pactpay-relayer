import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { OperationService } from "./operation.service";

@Controller("v1/operations")
export class OperationController {
  constructor(private readonly operations: OperationService) {}

  @Get(":id")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  get(@Param("id", new ParseUUIDPipe()) id: string) { return this.operations.public(this.operations.get(id)); }
}
