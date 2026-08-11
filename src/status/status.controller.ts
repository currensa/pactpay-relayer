import { Controller, Get } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { StatusService } from "./status.service";

@Controller()
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get("status")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status() { return this.statusService.status(); }
}
