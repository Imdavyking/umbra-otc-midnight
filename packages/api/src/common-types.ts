import type { MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import { htlc, type HtlcPrivateState } from "@umbra-otc/contract";

export const HtlcPrivateStateId = "umbraHtlcPrivateState" as const;

/** Names of the contract's state-changing circuits: "lock" | "claim" | "refund". */
export type HtlcCircuitKeys = Exclude<
  keyof htlc.ImpureCircuits<HtlcPrivateState>,
  number | symbol
>;

export type HtlcProviders = MidnightProviders<
  HtlcCircuitKeys,
  typeof HtlcPrivateStateId,
  HtlcPrivateState
>;

/** One escrowed swap leg, decoded from the contract's public ledger. */
export type DerivedHtlcLock = {
  hashlock: Uint8Array;
  claimant: Uint8Array; // coin public key, 32 bytes
  refundTo: Uint8Array; // coin public key, 32 bytes
  amount: bigint;
  expiry: bigint; // unix seconds
  preimage: Uint8Array | null; // set once claimed
  refunded: boolean; // escrowed coin gone without a revealed preimage
};

export type DerivedHtlcState = { locks: DerivedHtlcLock[] };
