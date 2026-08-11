import { Module } from "@nestjs/common";
import { OperationController } from "./operation.controller";
import { OperationProcessor } from "./operation.processor";
import { OperationService } from "./operation.service";

@Module({ controllers: [OperationController], providers: [OperationService, OperationProcessor], exports: [OperationService] })
export class OperationModule {}
