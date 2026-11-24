
// Returns the providers in an object which can be created for each user's individual tests
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
  type MidnightProviders,
  type ContractStateRead,
} from '@midnight-ntwrk/midnight-js-types';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';
import { type ImpureCircuits } from "../../../contracts/src/managed/htlc/contract/index.js";

// The set of callable circuit ids, derived from the compiled contract's
// generated types. This tracks whatever circuits your .compact exports, so you
// never have to edit this file when you add, remove, or rename a circuit.
export type HTLCCircuits = keyof ImpureCircuits<unknown>;

export type HTLCProviders = MidnightProviders<any>;

// How long a built transaction stays valid, in seconds (Midnight.js 5's
// `config.ttlSeconds`).
const TX_TTL_SECONDS = Number(process.env['MIDNIGHT_TX_TTL_SECONDS'] ?? 3600);

export function buildProviders(
  wallet: MidnightWalletProvider,
  zkConfigPath: string,
  config: NetworkConfig,
): HTLCProviders {
  const zkConfigProvider = new NodeZkConfigProvider<HTLCCircuits>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: process.env['SP_PRIVATE_STORE'] ?? `HTLC-${Date.now()}`,
      // this password has requirements (capital/special chars >= 3)
      privateStoragePasswordProvider: () => 'HTLC-Test-Password',
      accountId: wallet.getCoinPublicKey(),
    }),
    publicDataProvider: indexerPublicDataProvider(
      config.indexer,
      config.indexerWS,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      config.proofServer,
      zkConfigProvider,
    ),
    // Midnight.js 5 providers are tagged with the ledger eras they serve. The
    // wallet is ledger 9 only; these lift it into the tagged interfaces.
    walletProvider: createLedger9WalletProvider(wallet),
    midnightProvider: createLedger9MidnightProvider((tx) => wallet.submitTx(tx)),
    config: { networkId: config.networkId, ttlSeconds: TX_TTL_SECONDS },
  };
}

/**
 * The public ledger state of a contract read with queryContractState, for the
 * compiled `ledger()` to decode. Midnight.js 5 hands back the serialized state
 * tagged with the ledger era that wrote it; every contract here is deployed on
 * ledger 9, so only a ledger 9 decoder is given.
 */
export function ledgerState(read: ContractStateRead | null) {
  if (read === null) throw new Error('contract state not found');
  if (read.contractState.era !== 'v9') throw new Error('expected a ledger 9 contract state');
  return read.contractState.deserialize({ v9: ContractState }).data;
}
