import {
  filter,
  firstValueFrom,
  interval,
  map,
  take,
  timeout,
  throwError,
} from "rxjs";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { CostModel } from "@midnight-ntwrk/midnight-js-protocol/v9";
import semver from "semver";
import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnightntwrk/dapp-connector-api";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import {
  createLedger9MidnightProvider,
  createLedger9ProofProvider,
  createLedger9WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { Transaction } from "@midnight-ntwrk/midnight-js-protocol/v9";
import type { HtlcProviders } from "@umbra-otc/api";
import type { BaseProviders, WalletAndProvider } from "./common-types";

const NETWORK_ID = import.meta.env.VITE_NETWORK_ID ?? "preview";
const COMPATIBLE_CONNECTOR_API_VERSION = "4.x";

const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) =>
  Uint8Array.from(h.match(/.{1,2}/g)!.map((x) => parseInt(x, 16)));

const findLace = (): Promise<InitialAPI> =>
  firstValueFrom(
    interval(100).pipe(
      map(() => window.midnight?.mnLace),
      filter((api): api is InitialAPI => !!api),
      take(1),
      timeout({
        first: 2_000,
        with: () =>
          throwError(
            () =>
              new Error(
                "Could not find Midnight Lace wallet. Extension installed?",
              ),
          ),
      }),
    ),
  ).then((api) => {
    if (!semver.satisfies(api.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)) {
      throw new Error(
        `Incompatible Lace connector: require '${COMPATIBLE_CONNECTOR_API_VERSION}', got '${api.apiVersion}'.`,
      );
    }
    return api;
  });

export const initialWalletAndProviders =
  async (): Promise<WalletAndProvider> => {
    const lace = await findLace();
    const wallet: ConnectedAPI = await lace.connect(NETWORK_ID);
    const cfg = await wallet.getConfiguration();
    const addrs = await wallet.getShieldedAddresses();

    // ZK artifacts served from site root: /keys/<circuit>.prover, /zkir/<circuit>.bzkir

    const zkConfigProvider = new FetchZkConfigProvider<string>(
      window.location.origin,
      { fetchFunc: fetch.bind(window) },
    );

    const providers: BaseProviders = {
      zkConfigProvider,
      // Proving is delegated to the wallet, which fetches key material through our zkConfigProvider
      proofProvider: await dappConnectorProofProvider(
        wallet,
        zkConfigProvider,
        CostModel.initialCostModel(),
      ),
      publicDataProvider: indexerPublicDataProvider(
        cfg.indexerUri,
        cfg.indexerWsUri,
      ), // deprecated overload, still works
      walletProvider: createLedger9WalletProvider({
        balanceTx: async (tx, _ttl) => {
          const res = await wallet.balanceUnsealedTransaction(
            toHex(tx.serialize()),
          );
          return fromHex(res.tx);
        },
        getCoinPublicKey: () => addrs.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => addrs.shieldedEncryptionPublicKey,
      }),
      midnightProvider: createLedger9MidnightProvider(async (tx) => {
        const bytes = tx.serialize();
        await wallet.submitTransaction(toHex(bytes));
        const decoded = Transaction.deserialize(
          "signature",
          "proof",
          "binding",
          bytes,
        );
        return decoded.identifiers()[0];
      }),
      config: { networkId: NETWORK_ID, ttlSeconds: 600 },
    };

    return { wallet, providers };
  };

// Must be >= 16 chars. Replace with real UI / wallet-derived secret.
let cachedPassword: string | undefined;
const privateStoragePasswordProvider = async () =>
  (cachedPassword ??=
    window.prompt("Private-state password (16+ chars)") ?? "");

export const withPrivateState = <P = HtlcProviders>(
  base: BaseProviders,
  storeName: string,
): P =>
  ({
    ...base,
    privateStateProvider: levelPrivateStateProvider<string>({
      privateStateStoreName: storeName,
      accountId: base.walletProvider.getCoinPublicKey(),
      privateStoragePasswordProvider,
    }),
  }) as unknown as P;

export type { HtlcProviders };
