import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigurationService } from "../config/configuration.service";
import { RelayerError } from "./errors";

@Injectable()
export class GlobalRateGuard implements CanActivate {
  private windowStartedAt = Date.now();
  private count = 0;

  constructor(private readonly configuration: ConfigurationService) {}

  canActivate(_context: ExecutionContext): boolean {
    const now = Date.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.count = 0;
    }
    this.count += 1;
    if (this.count > this.configuration.value.globalRateLimitPerMinute) {
      throw new RelayerError("GLOBAL_RATE_LIMITED", "The relayer is temporarily at capacity", 429);
    }
    return true;
  }
}
