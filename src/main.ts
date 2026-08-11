import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ConfigurationService } from "./config/configuration.service";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const configuration = app.get(ConfigurationService).value;
  app.useBodyParser("json", { limit: configuration.maxRequestBytes });
  app.set("trust proxy", configuration.trustProxy);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: false }));
  app.useGlobalFilters(new HttpExceptionFilter());
  if (configuration.corsOrigins.length > 0) app.enableCors({ origin: configuration.corsOrigins, methods: ["GET", "POST"] });
  app.enableShutdownHooks();
  await app.listen(configuration.port, configuration.host);
  Logger.log(`PactPay relayer listening on http://${configuration.host}:${configuration.port}`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.stack : String(error), "Bootstrap");
  process.exitCode = 1;
});
