import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigurationService } from "../config/configuration.service";
import type { ChainAdapter } from "./types";
import { EvmChainAdapter } from "./evm.adapter";
import { TronChainAdapter } from "./tron.adapter";

@Injectable()
export class ChainService implements OnModuleInit, OnModuleDestroy {
  private readonly adapters = new Map<number, ChainAdapter>();

  constructor(private readonly configuration: ConfigurationService) {
    for (const chain of configuration.value.chains) {
      const key = configuration.privateKey(chain);
      const adapter = chain.family === "evm"
        ? new EvmChainAdapter(chain, key)
        : new TronChainAdapter(chain, key, process.env.TRON_PRO_API_KEY);
      this.adapters.set(chain.chainId, adapter);
    }
  }

  async onModuleInit(): Promise<void> {
    await Promise.all(this.list().map((adapter) => adapter.checkConnection()));
  }

  onModuleDestroy(): void { for (const adapter of this.adapters.values()) adapter.close(); }

  get(chainId: number): ChainAdapter {
    const adapter = this.adapters.get(chainId);
    if (!adapter) throw new Error(`Unsupported chain: ${chainId}`);
    return adapter;
  }

  list(): ChainAdapter[] { return [...this.adapters.values()]; }
}
