import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { solidityPackedKeccak256 } from "ethers";
import { RelayerError } from "../common/errors";
import { DatabaseService } from "../database/database.service";
import type { OperationRecord } from "../database/types";
import type { RelayedOperation } from "../config/types";

export type NewRelayedOperation = {
  operation: RelayedOperation;
  quoteId: string;
  chainId: number;
  gravArc: string;
  calldata: string;
  nullifierHash: string;
  nonce: bigint;
  reservationKey: string;
};

@Injectable()
export class OperationService {
  constructor(private readonly database: DatabaseService) {}

  create(input: NewRelayedOperation): { operation: OperationRecord; created: boolean } {
    const requestHash = solidityPackedKeccak256(["uint256", "address", "bytes"], [input.chainId, input.gravArc, input.calldata]);
    return this.database.createOperationFromQuote({
      id: randomUUID(), quoteId: input.quoteId, chainId: input.chainId, requestHash,
      operation: input.operation, reservationKey: input.reservationKey,
      nullifierHash: input.nullifierHash, withdrawNonce: input.nonce.toString(), calldata: input.calldata,
    });
  }

  get(id: string): OperationRecord {
    const operation = this.database.getOperation(id);
    if (!operation) throw new RelayerError("OPERATION_NOT_FOUND", "Operation was not found", 404);
    return operation;
  }

  public(operation: OperationRecord) {
    return {
      id: operation.id,
      operation: operation.operation,
      chainId: operation.chainId,
      state: operation.state,
      transactionHash: operation.txHash,
      blockNumber: operation.blockNumber,
      error: operation.errorCode ? { code: operation.errorCode, message: operation.errorMessage } : null,
      createdAt: new Date(operation.createdAt).toISOString(),
      updatedAt: new Date(operation.updatedAt).toISOString(),
      submittedAt: operation.submittedAt ? new Date(operation.submittedAt).toISOString() : null,
      confirmedAt: operation.confirmedAt ? new Date(operation.confirmedAt).toISOString() : null,
    };
  }
}
