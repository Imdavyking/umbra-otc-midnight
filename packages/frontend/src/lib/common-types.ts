import type { HtlcAPI } from "@umbra-otc/api";
import type {
  DAppConnectorWalletAPI,
  ServiceUriConfig,
} from "@midnight-ntwrk/dapp-connector-api";

/** Everything a provider set needs except the per-contract private-state store. */
export type BaseProviders = Omit<HtlcAPI, "privateStateProvider">;

export interface WalletAndProvider {
  readonly wallet: DAppConnectorWalletAPI;
  readonly uris: ServiceUriConfig;
  readonly providers: BaseProviders;
}

export interface WalletAPI {
  wallet: DAppConnectorWalletAPI;
  coinPublicKey: string;
  encryptionPublicKey: string;
  uris: ServiceUriConfig;
}

export type ContractKind = "otc" | "pool" | "htlc";

export type ApiFor<K extends ContractKind> = K extends "htlc" ? HtlcAPI : never;

export interface ContractSlot<K extends ContractKind> {
  status: "idle" | "joining" | "joined" | "failed";
  api?: ApiFor<K>;
  error?: string;
}
