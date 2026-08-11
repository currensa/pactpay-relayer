import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { RelayerError } from "./errors";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message: string | string[] = "Internal relayer error";

    if (exception instanceof RelayerError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const detail = typeof body === "object" && body !== null ? body as { message?: string | string[] } : {};
      code = status === 429 ? "RATE_LIMITED" : status === 400 ? "VALIDATION_FAILED" : "HTTP_ERROR";
      message = detail.message ?? exception.message;
    } else {
      this.logger.error(`${request.method} ${request.url}: ${exception instanceof Error ? exception.stack : String(exception)}`);
    }

    response.status(status).json({ error: { code, message }, timestamp: new Date().toISOString(), path: request.url });
  }
}
