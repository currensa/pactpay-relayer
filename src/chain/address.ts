import { getAddress, isAddress } from "ethers";
import { TronWeb } from "tronweb";
import type { ChainFamily } from "../config/types";

const CANONICAL = /^0x[0-9a-fA-F]{40}$/;
const TRON_HEX = /^(?:0x)?41[0-9a-fA-F]{40}$/;

export function canonicalAddress(value: string, family: ChainFamily): string {
  if (family === "evm") {
    if (!isAddress(value)) throw new Error(`Invalid EVM address: ${value}`);
    return getAddress(value).toLowerCase();
  }
  if (CANONICAL.test(value)) return value.toLowerCase();
  let hex: string;
  if (TRON_HEX.test(value)) hex = value.replace(/^0x/i, "");
  else {
    try { hex = TronWeb.address.toHex(value); }
    catch { throw new Error(`Invalid TRON address: ${value}`); }
  }
  if (!/^41[0-9a-fA-F]{40}$/.test(hex)) throw new Error(`Invalid TRON address: ${value}`);
  return `0x${hex.slice(2).toLowerCase()}`;
}

export function displayAddress(value: string, family: ChainFamily): string {
  const canonical = canonicalAddress(value, family);
  if (family === "evm") return getAddress(canonical);
  return TronWeb.address.fromHex(`41${canonical.slice(2)}`);
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
