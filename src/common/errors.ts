export class RelayerError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "RelayerError";
  }
}

export class SimulationRejectedError extends RelayerError {
  constructor(message: string) {
    super("SIMULATION_REJECTED", message, 422);
    this.name = "SimulationRejectedError";
  }
}

export class TransientRpcError extends RelayerError {
  constructor(message: string) {
    super("RPC_TEMPORARY", message, 503);
    this.name = "TransientRpcError";
  }
}
