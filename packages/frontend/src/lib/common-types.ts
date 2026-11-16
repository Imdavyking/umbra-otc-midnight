import type { MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import type { ConnectedAPI } from "@midnightntwrk/dapp-connector-api";

export type ContractKind = "htlc";

// Everything except the per-contract private state store
export type BaseProviders = Omit<MidnightProviders, "privateStateProvider">;

// `uris` is gone: the wallet now owns the prover/indexer config
export type WalletAndProvider = {
  wallet: ConnectedAPI;
  providers: BaseProviders;
};


import type { HtlcAPI } from "@umbra-otc/api";

export type ApiFor<K extends ContractKind> = K extends "htlc" ? HtlcAPI : never;

export type ContractSlot<K extends ContractKind> =
  | { status: "idle" }
  | { status: "joining" }
  | { status: "joined"; api: ApiFor<K> }
  | { status: "failed"; error: string };