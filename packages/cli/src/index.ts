import { Buffer } from "node:buffer";
import { stdin as input, stdout as output } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { WebSocket } from "ws";
import dotenv from "dotenv";
import * as Rx from "rxjs";
import type { Logger } from "pino";

import {
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  PublicKey,
  NoOpTransactionHistoryStorage,
  DustAddress,
  MidnightBech32m,
} from "@midnightntwrk/wallet-sdk";
import { WalletSeeds } from "@midnightntwrk/wallet-sdk-hd";
import {
  WalletTransaction,
  ProtocolVersion,
} from "@midnightntwrk/wallet-sdk-abstractions";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/v9";
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";

import {
  HtlcAPI,
  makeHtlcCompiledContract,
  HtlcPrivateStateId,
  utils,
  type HtlcProviders,
} from "@umbra-otc/api";
import { type Config, envPath } from "./config.js";

// The wallet SDK expects a global WebSocket on Node.
(globalThis as any).WebSocket = WebSocket;
dotenv.config({ path: envPath });

export { HtlcPrivateStateId };

// ─── helpers ─────────────────────────────────────────────────────────────────

const ask = async (rli: Interface, q: string) => (await rli.question(q)).trim();

const show = (logger: Logger, label: string, value: unknown) =>
  logger.info(
    `${label}: ${JSON.stringify(
      value,
      (_k, v) =>
        typeof v === "bigint"
          ? v.toString()
          : v instanceof Uint8Array
            ? utils.uint8ArrayToHex(v)
            : v,
      2,
    )}`,
  );

const formatNight = (raw: bigint) =>
  `${raw / 1_000_000n}.${(raw % 1_000_000n).toString().padStart(6, "0")}`;
const formatDust = (raw: bigint) =>
  `${raw / 1_000_000_000_000_000n}.${(raw % 1_000_000_000_000_000n).toString().padStart(15, "0")}`;

// ─── Blockfrost endpoints (Preview) ──────────────────────────────────────────
// Set BLOCKFROST_PROJECT_ID in .env to route the node RPC and the indexer through
// Blockfrost, the same endpoints Lace uses. Without it, config.ts is used as-is.
// The key is never logged.

const withBlockfrost = (config: Config, logger: Logger): Config => {
  const projectId = (process.env.BLOCKFROST_PROJECT_ID ?? "").trim();
  if (!projectId) return config;

  if (!config.networkId.toLowerCase().includes("preview")) {
    logger.warn(
      `BLOCKFROST_PROJECT_ID is set but networkId is '${config.networkId}', not preview. Ignoring it.`,
    );
    return config;
  }

  const query = `?project_id=${encodeURIComponent(projectId)}`;
  logger.info("Using Blockfrost Preview endpoints");
  return {
    ...config,
    node: `https://rpc.midnight-preview.blockfrost.io/${query}`,
    indexer: `https://midnight-preview.blockfrost.io/api/v0${query}`,
    indexerWS: `wss://midnight-preview.blockfrost.io/api/v0/ws${query}`,
  };
};

// ─── wallet (wallet SDK 2) ───────────────────────────────────────────────────

interface WalletContext {
  wallet: WalletFacade;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  networkId: string;
}

export const buildWallet = async (
  config: Config,
  seedHex: string,
): Promise<WalletContext> => {
  const seeds = WalletSeeds.fromMasterSeed(Buffer.from(seedHex, "hex"));

  // SDK 2.x: createKeystore takes { kind, secret }
  const unshieldedKeystore = createKeystore(
    { kind: "schnorr", secret: seeds.unshielded },
    config.networkId,
  );

  const indexerClientConnection = {
    indexerHttpUrl: config.indexer,
    indexerWsUrl: config.indexerWS,
  };
  const shieldedConfig = {
    networkId: config.networkId,
    indexerClientConnection,
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, "ws")),
  };
  const unshieldedConfig = {
    networkId: config.networkId,
    indexerClientConnection,
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };
  const dustConfig = {
    ...shieldedConfig,
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSeed(seeds.shielded),
    unshielded: (cfg: any) =>
      UnshieldedWallet(cfg).startWithPublicKey(
        PublicKey.fromKeyStore(unshieldedKeystore),
      ),
    dust: (cfg: any) => DustWallet(cfg).startWithSeed(seeds.dust),
  });
  // If this errors because the wallets are already started, delete this line.
  await wallet.start(seeds);
  return { wallet, unshieldedKeystore, networkId: config.networkId };
};

/** Make sure the wallet has tNIGHT, has registered it, and holds some DUST. */
export const ensureFunded = async (ctx: WalletContext, logger: Logger) => {
  const { wallet, unshieldedKeystore } = ctx;
  const address = String(unshieldedKeystore.getBech32Address());
  logger.info(`Unshielded address (send tNIGHT here): ${address}`);

  logger.info("Syncing wallet (this can take a few minutes)...");
  let state = await wallet.waitForSyncedState();

  const dustNow = () => state.dust.balance(new Date());
  if (dustNow() > 0n) {
    logger.info(`DUST balance: ${formatDust(dustNow())}`);
    return;
  }

  const night = () =>
    state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  if (night() === 0n) {
    logger.info(
      "No tNIGHT yet. Request some from the faucet for the address above...",
    );
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(10_000),
        Rx.filter(
          (s) =>
            (s.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n) > 0n,
        ),
      ),
    );
    state = await wallet.waitForSyncedState();
  }
  logger.info(`tNIGHT balance: ${formatNight(night())}`);

  const unregistered = state.unshielded.availableCoins.filter(
    (c: any) => c.meta?.registeredForDustGeneration !== true,
  );
  // Debug: shows the real coin metadata so the registered-flag name can be verified.
  if (unregistered[0]) show(logger, "first unregistered coin", unregistered[0]);
  if (unregistered.length > 0) {
    logger.info("Registering tNIGHT for DUST generation...");
    const target = String(
      DustAddress.encodePublicKey(ctx.networkId, state.dust.publicKey),
    );
    const dustReceiver = MidnightBech32m.parse(target).decode(
      DustAddress,
      ctx.networkId,
    );
    const { fee } = await wallet.estimateRegistration(unregistered);
    await wallet.waitForGeneratedDust(unregistered, fee);
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      unregistered,
      unshieldedKeystore.getPublicKey(),
      // SignSegment must return a Promise
      async (payload: Uint8Array) => unshieldedKeystore.signData(payload),
      dustReceiver,
    );
    await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
  }

  logger.info("Waiting for DUST to accrue...");
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
    ),
  );
  state = await Rx.firstValueFrom(wallet.state());
  logger.info(`DUST balance: ${formatDust(dustNow())}`);
};

// ─── providers (midnight-js 5) ───────────────────────────────────────────────

// If balance/submit fails at runtime with a version / foreign-handle error,
// try ProtocolVersion.V9NativeForkVersion instead.
const V9 = ProtocolVersion.MaxSupportedVersion;

const makeProviders = async (
  config: Config,
  ctx: WalletContext,
): Promise<HtlcProviders> => {
  const { wallet } = ctx;
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const walletProvider = createLedger9WalletProvider({
    balanceTx: async (tx, ttl) => {
      const unbound = WalletTransaction.adopt(
        "Unbound",
        tx.deserialize({ v9: ledger.Transaction }),
        V9,
      );
      const recipe = await wallet.balanceUnboundTransaction(unbound as any, {
        ttl: ttl ?? new Date(Date.now() + 30 * 60_000),
      });
      return wallet.finalizeRecipe(recipe as any) as any;
    },
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () =>
      state.shielded.encryptionPublicKey.toHexString(),
  });

  const midnightProvider = createLedger9MidnightProvider(async (tx) => {
    const finalized = WalletTransaction.adopt(
      "Finalized",
      tx.deserialize({ v9: ledger.Transaction }),
      V9,
    );
    return (await wallet.submitTransaction(finalized as any)) as any;
  });

  const password = process.env.PRIVATE_STATE_PASSWORD ?? "";
  if (password.length < 16) {
    throw new Error(
      "Set PRIVATE_STATE_PASSWORD (16+ characters) in .env: it encrypts the private-state store.",
    );
  }

  const zkConfigProvider = new NodeZkConfigProvider<string>(
    config.zkConfigPath,
  );

  return {
    privateStateProvider: levelPrivateStateProvider<string>({
      privateStateStoreName: config.privateStateStoreName,
      accountId: walletProvider.getCoinPublicKey(),
      privateStoragePasswordProvider: async () => password,
    }),
    publicDataProvider: indexerPublicDataProvider(
      config.indexer,
      config.indexerWS,
    ),
    zkConfigProvider,
    // TODO(verify): httpClientProofProvider takes an options object in v5; check the
    // HttpClientProofProviderOptions type for the exact field names.
    proofProvider: httpClientProofProvider({
      url: config.proofServer,
      zkConfigProvider,
    } as any),
    walletProvider,
    midnightProvider,
    config: { networkId: config.networkId, ttlSeconds: 600 },
  } as unknown as HtlcProviders;
};

// ─── HTLC menu ───────────────────────────────────────────────────────────────

const DEPLOY_OR_JOIN = `
You can do one of the following:
  1. Deploy a new HTLC contract
  2. Join an existing one
  3. Exit
Choose: `;

const HTLC_MENU = `
HTLC swap leg:
  1. Show state
  2. Generate a new secret + hashlock
  3. Lock funds
  4. Claim with secret
  5. Refund after expiry
  6. Show wallet balances
  7. Exit

Which would you like to do? `;

const htlcLoop = async (
  ctx: WalletContext,
  providers: HtlcProviders,
  config: Config,
  rli: Interface,
  logger: Logger,
) => {
  const compiled = makeHtlcCompiledContract(config.zkConfigPath);

  let api: HtlcAPI | null = null;
  while (api === null) {
    const choice = await ask(rli, DEPLOY_OR_JOIN);
    if (choice === "3") return;
    try {
      if (choice === "1") {
        // TODO(verify): deploy signature (providers, compiledContract, logger)
        api = await (HtlcAPI as any).deploy(providers, compiled, logger);
      } else if (choice === "2") {
        const addr = await ask(rli, "Contract address (hex): ");
        api = await HtlcAPI.join(providers, compiled, addr, logger);
      }
    } catch (e) {
      logger.error(
        `Failed: ${e instanceof Error ? (e.stack ?? e.message) : e}`,
      );
    }
  }
  logger.info(`HTLC contract address: ${api.deployedContractAddress}`);
  logger.info(
    "Put this address in packages/frontend/.env as VITE_HTLC_ADDRESS.",
  );

  while (true) {
    const choice = await ask(rli, HTLC_MENU);
    try {
      switch (choice) {
        case "1":
          show(logger, "HTLC state", await Rx.firstValueFrom(api.state));
          break;
        case "2": {
          const s = HtlcAPI.newSecret();
          logger.info(`preimage (KEEP SECRET): ${s.preimageHex}`);
          logger.info(`hashlock (share): ${s.hashlockHex}`);
          break;
        }
        case "3":
          await api.lock({
            amount: BigInt(await ask(rli, "Amount: ")),
            colorHex: await ask(rli, "Coin color (hex): "),
            hashlockHex: await ask(rli, "Hashlock (hex): "),
            claimantCoinPublicKeyHex: await ask(
              rli,
              "Claimant coin public key (hex): ",
            ),
            refundCoinPublicKeyHex: await ask(
              rli,
              "Refund coin public key (hex): ",
            ),
            expiry: BigInt(await ask(rli, "Expiry (unix seconds): ")),
          });
          logger.info("lock submitted");
          break;
        case "4":
          await api.claim(await ask(rli, "Preimage (hex): "));
          logger.info("claim submitted");
          break;
        case "5":
          await api.refund(await ask(rli, "Hashlock (hex): "));
          logger.info("refund submitted");
          break;
        case "6": {
          const s = await Rx.firstValueFrom(ctx.wallet.state());
          logger.info(`DUST: ${formatDust(s.dust.balance(new Date()))}`);
          logger.info(
            `tNIGHT: ${formatNight(s.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n)}`,
          );
          break;
        }
        case "7":
          return;
        default:
          logger.error(`Invalid choice: ${choice}`);
      }
    } catch (e) {
      logger.error(`Action failed: ${e instanceof Error ? e.message : e}`);
    }
  }
};

// ─── entry point ─────────────────────────────────────────────────────────────

const checkProofServer = async (url: string) => {
  try {
    const res = await fetch(`${url}/health`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new Error(
      `Proof server not reachable at ${url}. Start it with:\n  docker run -d --name proof-server -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.0`,
    );
  }
};

const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  try {
    return JSON.stringify(cause, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    return String(cause);
  }
};

export const run = async (
  baseConfig: Config,
  logger: Logger,
): Promise<void> => {
  const config = withBlockfrost(baseConfig, logger);
  const rli = createInterface({ input, output, terminal: true });
  let ctx: WalletContext | undefined;
  let failed = false;
  try {
    const seed = (process.env.WALLET_SEED ?? "").trim();
    if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
      throw new Error(
        "WALLET_SEED must be 64 hex characters. Run `corepack yarn generate-key` in packages/scripts.",
      );
    }
    await checkProofServer(config.proofServer);
    ctx = await buildWallet(config, seed);
    await ensureFunded(ctx, logger);
    const providers = await makeProviders(config, ctx);
    await htlcLoop(ctx, providers, config, rli, logger);
  } catch (e) {
    failed = true;
    if (e instanceof Error) {
      logger.error(`Found error '${e.message}'`);
      if (e.cause !== undefined)
        logger.error(`cause: ${describeCause(e.cause)}`);
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    rli.close();
    try {
      await ctx?.wallet.stop();
    } catch {
      /* ignore */
    }
    logger.info("Goodbye");
    process.exit(failed ? 1 : 0);
  }
};
