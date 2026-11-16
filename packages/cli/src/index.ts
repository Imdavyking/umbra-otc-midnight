// import { webcrypto } from "crypto";
// import { WebSocket } from "ws"
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { stdin as input, stdout as output } from "node:process";

import { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { createInterface, Interface } from "node:readline/promises";
import { Logger } from "pino";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { type Config, StandaloneConfig } from "./config.js";
import {
  getLedgerNetworkId,
  getZswapNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import * as Rx from "rxjs";
import { type Wallet } from "@midnight-ntwrk/wallet-api";
import type {
  StartedDockerComposeEnvironment,
  DockerComposeEnvironment,
} from "testcontainers";
import { type Resource, WalletBuilder } from "@midnight-ntwrk/wallet";
import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import {
  nativeToken,
  Transaction,
  type CoinInfo,
  type TransactionId,
} from "@midnight-ntwrk/ledger";
import {
  type MidnightProvider,
  type WalletProvider,
  type UnbalancedTransaction,
  createBalancedTx,
  type BalancedTransaction,
} from "@midnight-ntwrk/midnight-js-types";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import * as fs from "node:fs";
import { streamToString } from "testcontainers/build/common/streams.js";
import { webcrypto } from "node:crypto";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve("..", "..", ".env") });

import {

  HtlcAPI,

  HtlcPrivateStateId,
  utils,
  
  type HtlcProviders,
} from "@umbra-otc/api";

export type ContractName = "otc" | "pool" | "htlc";
type MakeProviders = (name: ContractName) => any;

const ask = async (rli: Interface, q: string) => (await rli.question(q)).trim();

const DEPLOY_OR_JOIN_QUESTION = `
    You can do one of the following:
    1. Deploy a new contract
    2. Join an existing one
    3. Back
`;

/** Shared deploy-or-join prompt for all three contracts. */
const resolveContract = async <A extends { deployedContractAddress: string }>(
  rli: Interface,
  logger: Logger,
  deploy: () => Promise<A>,
  join: (address: string) => Promise<A>
): Promise<A | null> => {
  while (true) {
    const choice = await ask(rli, DEPLOY_OR_JOIN_QUESTION);
    if (choice === "3") return null;
    if (choice === "1" || choice === "2") {
      const api =
        choice === "1"
          ? await deploy()
          : await join(await ask(rli, "What is the contract address (in hex)? "));
      logger.info(
        `${choice === "1" ? "Deployed" : "Joined"} contract at address: ${
          api.deployedContractAddress
        }`
      );
      return api;
    }
  }
};

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
      2
    )}`
  );

const afterTx = async (wallet: Wallet, logger: Logger, what: string) => {
  logger.info(`${what} submitted. Waiting for wallet to sync...`);
  await waitForWalletSyncAfterOperation(wallet, logger);
  await displayComprehensiveWalletState(wallet, undefined, logger);
};

// ─── OTC ─────────────────────────────────────────────────────────────────────

const OTC_QUESTION = `
OTC sealed-bid auction:
  1. Show state
  2. Show my trader leaf (operator whitelists this)
  3. [operator] Add trader (leaf hex)
  4. [operator] Open round
  5. Commit order
  6. [operator] Close commit phase
  7. Reveal my order
  8. Show suggested clearing level
  9. [operator] Clear round
 10. Claim fill
 11. Back

Which would you like to do? `;



// ─── Pool ────────────────────────────────────────────────────────────────────

const POOL_QUESTION = `
Private pool:
  1. Show state
  2. Deposit one denomination (creates a note)
  3. Withdraw active note to an address
  4. Import a note (JSON)
  5. Show active note (back it up!)
  6. Back

Which would you like to do? `;

const poolLoop = async (
  wallet: Wallet & Resource,
  providers: PoolProviders,
  rli: Interface,
  logger: Logger
) => {
  const api = await resolveContract(
    rli,
    logger,
    async () =>
      PoolAPI.deploy(
        providers,
        await ask(rli, "Coin color to accept (32-byte hex): "),
        BigInt(await ask(rli, "Fixed deposit amount: ")),
        logger
      ),
    (a) => PoolAPI.join(providers, a, logger)
  );
  if (!api) return;
  while (true) {
    const choice = await ask(rli, POOL_QUESTION);
    try {
      switch (choice) {
        case "1":
          show(logger, "Pool state", await Rx.firstValueFrom(api.state));
          break;
        case "2": {
          const { noteJson } = await api.deposit();
          logger.info(`NOTE (save this, it controls the funds): ${noteJson}`);
          await afterTx(wallet, logger, "deposit");
          break;
        }
        case "3":
          await api.withdraw(
            await ask(rli, "Recipient coin public key (32-byte hex): ")
          );
          await afterTx(wallet, logger, "withdraw");
          break;
        case "4":
          await api.loadNote(await ask(rli, "Note JSON: "));
          logger.info("Note imported and set active");
          break;
        case "5":
          logger.info(`Active note: ${await api.activeNoteJson()}`);
          break;
        case "6":
          return;
        default:
          logger.error(`Invalid choice: ${choice}`);
      }
    } catch (e) {
      logger.error(`Action failed: ${e instanceof Error ? e.message : e}`);
    }
  }
};

// ─── HTLC ────────────────────────────────────────────────────────────────────

const HTLC_QUESTION = `
HTLC swap leg:
  1. Show locks
  2. Generate a new secret + hashlock
  3. Lock funds
  4. Claim with secret
  5. Refund after expiry
  6. Back

Which would you like to do? `;

const htlcLoop = async (
  wallet: Wallet & Resource,
  providers: HtlcProviders,
  rli: Interface,
  logger: Logger
) => {
  const api = await resolveContract(
    rli,
    logger,
    () => HtlcAPI.deploy(providers, logger),
    (a) => HtlcAPI.join(providers, a, logger)
  );
  if (!api) return;
  while (true) {
    const choice = await ask(rli, HTLC_QUESTION);
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
            hashlockHex: await ask(rli, "Hashlock (hex): "),
            claimantCoinPublicKeyHex: await ask(rli, "Claimant coin public key (hex): "),
            refundCoinPublicKeyHex: await ask(rli, "Refund coin public key (hex): "),
            expiry: BigInt(await ask(rli, "Expiry (unix seconds): ")),
          });
          await afterTx(wallet, logger, "lock");
          break;
        case "4":
          await api.claim(await ask(rli, "Preimage (hex): "));
          await afterTx(wallet, logger, "claim");
          break;
        case "5":
          await api.refund(await ask(rli, "Hashlock (hex): "));
          await afterTx(wallet, logger, "refund");
          break;
        case "6":
          return;
        default:
          logger.error(`Invalid choice: ${choice}`);
      }
    } catch (e) {
      logger.error(`Action failed: ${e instanceof Error ? e.message : e}`);
    }
  }
};

// ─── Top-level menu ──────────────────────────────────────────────────────────

const MAIN_QUESTION = `
Which contract do you want to use?
  1. OTC sealed-bid auction
  2. Private pool (deposit / withdraw)
  3. HTLC swap
  4. Show wallet state
  5. Exit

Choose: `;

const circuit_main_loop = async (
  wallet: Wallet & Resource,
  makeProviders: MakeProviders,
  rli: Interface,
  logger: Logger
): Promise<void> => {
  while (true) {
    const choice = await ask(rli, MAIN_QUESTION);
    switch (choice) {
      case "1":
        await otcLoop(wallet, makeProviders("otc"), rli, logger);
        break;
      case "2":
        await poolLoop(wallet, makeProviders("pool"), rli, logger);
        break;
      case "3":
        await htlcLoop(wallet, makeProviders("htlc"), rli, logger);
        break;
      case "4":
        await displayComprehensiveWalletState(wallet, undefined, logger);
        break;
      case "5":
        logger.info("Exiting.......");
        return;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

// Re-exported so config.ts and scripts can reference the store names.
export { OtcPrivateStateId, PoolPrivateStateId, HtlcPrivateStateId };

export const createWalletAndMidnightProvider = async (
  wallet: Wallet
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(wallet.state());
  return {
    coinPublicKey: state.coinPublicKey,
    encryptionPublicKey: state.encryptionPublicKey,
    balanceTx(
      tx: UnbalancedTransaction,
      newCoins: CoinInfo[]
    ): Promise<BalancedTransaction> {
      return wallet
        .balanceTransaction(
          ZswapTransaction.deserialize(
            tx.serialize(getLedgerNetworkId()),
            getZswapNetworkId()
          ),
          newCoins
        )
        .then((tx) => wallet.proveTransaction(tx))
        .then((zswapTx) =>
          Transaction.deserialize(
            zswapTx.serialize(getZswapNetworkId()),
            getLedgerNetworkId()
          )
        )
        .then(createBalancedTx);
    },
    submitTx(tx: BalancedTransaction): Promise<TransactionId> {
      return wallet.submitTransaction(tx);
    },
  };
};

export const waitForSync = (wallet: Wallet, logger: Logger) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`
        );
      }),
      Rx.filter((state) => {
        // Let's allow progress only if wallet is synced fully
        return state.syncProgress !== undefined && state.syncProgress.synced;
      })
    )
  );

export const waitForSyncProgress = async (wallet: Wallet, logger: Logger) =>
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`
        );
      }),
      Rx.filter((state) => {
        // Let's allow progress only if syncProgress is defined
        return state.syncProgress !== undefined;
      })
    )
  );

export const waitForFunds = (wallet: Wallet, logger: Logger) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`
        );
      }),
      Rx.filter((state) => {
        // Let's allow progress only if wallet is synced
        return state.syncProgress?.synced === true;
      }),
      Rx.map((s) => s.balances[nativeToken()] ?? 0n),
      Rx.filter((balance) => balance > 0n)
    )
  );

export const isAnotherChain = async (
  wallet: Wallet,
  offset: number,
  logger: Logger
) => {
  await waitForSyncProgress(wallet, logger);
  // Here wallet does not expose the offset block it is synced to, that is why this workaround
  const walletOffset = Number(JSON.parse(await wallet.serializeState()).offset);
  if (walletOffset < offset - 1) {
    logger.info(
      `Your offset offset is: ${walletOffset} restored offset: ${offset} so it is another chain`
    );
    return true;
  } else {
    logger.info(
      `Your offset offset is: ${walletOffset} restored offset: ${offset} ok`
    );
    return false;
  }
};

export const waitForTokenBalance = (
  wallet: Wallet,
  tokenType: string,
  minimumAmount: bigint,
  logger: Logger,
  timeoutMs: number = 30000
): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(2_000),
      Rx.tap((state) => {
        const balance = state.balances[tokenType] ?? 0n;
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for ${tokenType} balance. Current: ${balance}, Target: ${minimumAmount}, Backend lag: ${sourceGap}, Wallet lag: ${applyGap}`
        );
      }),
      Rx.filter((state) => {
        const balance = state.balances[tokenType] ?? 0n;
        return state.syncProgress?.synced === true && balance >= minimumAmount;
      }),
      Rx.map((state) => state.balances[tokenType] ?? 0n),
      Rx.timeout(timeoutMs)
    )
  );

// Enhanced function to wait for wallet sync after operations
export const waitForWalletSyncAfterOperation = async (
  wallet: Wallet,
  logger: Logger,
  timeoutMs: number = 30000
): Promise<void> => {
  try {
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(1_000),
        Rx.tap((state) => {
          const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
          const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
          logger.info(
            `Syncing after operation. Backend lag: ${sourceGap}, Wallet lag: ${applyGap}`
          );
        }),
        Rx.filter((state) => {
          return state.syncProgress?.synced === true;
        }),
        Rx.timeout(timeoutMs)
      )
    );
    logger.info("Wallet sync completed after operation");
  } catch (error) {
    logger.warn(`Wallet sync timeout after ${timeoutMs}ms`);
  }
};

// Function to display comprehensive wallet state including all token types
const displayComprehensiveWalletState = async (
  wallet: Wallet,
  currentContractState: unknown,
  logger: Logger
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state());

  logger.info("=== WALLET STATE ===");
  logger.info(`Address: ${state.address}`);
  logger.info(
    `Sync Status: ${state.syncProgress?.synced ? "SYNCED" : "SYNCING"}`
  );

  if (state.syncProgress) {
    logger.info(`Apply Gap: ${state.syncProgress.lag.applyGap}`);
    logger.info(`Source Gap: ${state.syncProgress.lag.sourceGap}`);
  }

  logger.info("=== TOKEN BALANCES ===");
  Object.entries(state.balances).forEach(([tokenType, balance]) => {
    if (tokenType === nativeToken()) {
      logger.info(`Native Token (tDUST): ${balance}`);
    } else {
      logger.info(`Token ${tokenType}: ${balance}`);
    }
  });

  logger.info(`Transaction History Count: ${state.transactionHistory.length}`);
  logger.info("===================");
};

export const buildEnhancedWalletAndWaitForFunds = async (
  config: Config,
  seed: string,
  filename: string,
  logger: Logger
): Promise<Wallet & Resource> => {
  // ... (keep existing wallet building logic)
  const wallet = await buildWalletAndWaitForFunds(
    config,
    seed,
    filename,
    logger
  );

  // Set up continuous state monitoring
  const stateSubscription = wallet
    .state()
    .pipe(Rx.throttleTime(60_000))
    .subscribe({
      next: (state) => {
        logger.info("Wallet state changed - balances updated");
        Object.entries(state.balances).forEach(([tokenType, balance]) => {
          if (balance > 0n) {
            logger.info(`${tokenType}: ${balance}`);
          }
        });
      },
    });

  // Store subscription reference for cleanup
  (wallet as any).__stateSubscription = stateSubscription;

  return wallet;
};

export const buildWalletAndWaitForFunds = async (
  { indexer, indexerWS, node, proofServer }: Config,
  seed: string,
  filename: string,
  logger: Logger
): Promise<Wallet & Resource> => {
  const directoryPath = process.env.SYNC_CACHE;
  let wallet: Wallet & Resource;
  if (directoryPath !== undefined) {
    if (fs.existsSync(`${directoryPath}/${filename}`)) {
      logger.info(
        `Attempting to restore state from ${directoryPath}/${filename}`
      );
      try {
        const serializedStream = fs.createReadStream(
          `${directoryPath}/${filename}`,
          "utf-8"
        );
        const serialized = await streamToString(serializedStream);
        serializedStream.on("finish", () => {
          serializedStream.close();
        });
        wallet = await WalletBuilder.restore(
          indexer,
          indexerWS,
          proofServer,
          node,
          seed,
          serialized,
          "info"
        );
        wallet.start();
        const stateObject = JSON.parse(serialized);
        if (
          (await isAnotherChain(wallet, Number(stateObject.offset), logger)) ===
          true
        ) {
          logger.warn("The chain was reset, building wallet from scratch");
          wallet = await WalletBuilder.build(
            indexer,
            indexerWS,
            proofServer,
            node,
            seed,
            getZswapNetworkId(),
            "info"
          );
          wallet.start();
        } else {
          const newState = await waitForSync(wallet, logger);
          // allow for situations when there's no new index in the network between runs
          if (newState.syncProgress?.synced) {
            logger.info("Wallet was able to sync from restored state");
          } else {
            logger.info(`Offset: ${stateObject.offset}`);
            logger.info(
              `SyncProgress.lag.applyGap: ${newState.syncProgress?.lag.applyGap}`
            );
            logger.info(
              `SyncProgress.lag.sourceGap: ${newState.syncProgress?.lag.sourceGap}`
            );
            logger.warn(
              "Wallet was not able to sync from restored state, building wallet from scratch"
            );
            wallet = await WalletBuilder.build(
              indexer,
              indexerWS,
              proofServer,
              node,
              seed,
              getZswapNetworkId(),
              "info"
            );
            wallet.start();
          }
        }
      } catch (error: unknown) {
        if (typeof error === "string") {
          logger.error(error);
        } else if (error instanceof Error) {
          logger.error(error.message);
        } else {
          logger.error(error);
        }
        logger.warn(
          "Wallet was not able to restore using the stored state, building wallet from scratch"
        );
        wallet = await WalletBuilder.build(
          indexer,
          indexerWS,
          proofServer,
          node,
          seed,
          getZswapNetworkId(),
          "info"
        );
        wallet.start();
      }
    } else {
      logger.info("Wallet save file not found, building wallet from scratch");
      wallet = await WalletBuilder.build(
        indexer,
        indexerWS,
        proofServer,
        node,
        seed,
        getZswapNetworkId(),
        "info"
      );
      wallet.start();
    }
  } else {
    logger.info(
      "File path for save file not found, building wallet from scratch"
    );
    wallet = await WalletBuilder.build(
      indexer,
      indexerWS,
      proofServer,
      node,
      seed,
      getZswapNetworkId(),
      "info"
    );
    wallet.start();
  }

  const state = await Rx.firstValueFrom(wallet.state());
  logger.info(`Your wallet seed is: ${seed}`);
  logger.info(`Your wallet address is: ${state.address}`);
  let balance = state.balances[nativeToken()];
  if (balance === undefined || balance === 0n) {
    logger.info(`Your wallet balance is: 0`);
    logger.info(`Waiting to receive tokens...`);
    balance = await waitForFunds(wallet, logger);
  }
  logger.info(`Your wallet balance is: ${balance}`);
  return wallet;
};

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
};

// Generate a random see and create the wallet with that.
export const buildFreshWallet = async (
  config: Config,
  logger: Logger
): Promise<Wallet & Resource> =>
  await buildWalletAndWaitForFunds(config, toHex(randomBytes(32)), "", logger);

// Prompt for a seed and create the wallet with that.
const buildWalletFromSeed = async (
  config: Config,
  rli: Interface,
  logger: Logger
): Promise<Wallet & Resource> => {
  const seed = await rli.question("Enter your wallet seed: ");
  return await buildWalletAndWaitForFunds(config, seed, "", logger);
};

/* ***********************************************************************
 * This seed gives access to tokens minted in the genesis block of a local development node - only
 * used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";

const WALLET_LOOP_QUESTION = `
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `;

const buildWallet = async (
  config: Config,
  rli: Interface,
  logger: Logger
): Promise<(Wallet & Resource) | null> => {
  if (config instanceof StandaloneConfig) {
    return await buildWalletAndWaitForFunds(
      config,
      GENESIS_MINT_WALLET_SEED,
      "",
      logger
    );
  }

  const seed = process.env.WALLET_SEED;
  if (seed !== undefined) {
    logger.info(`Using seed from environment variable: ${seed}`);
    return await buildWalletAndWaitForFunds(config, seed, "", logger);
  }
  while (true) {
    const choice = await rli.question(WALLET_LOOP_QUESTION);
    switch (choice) {
      case "1":
        return await buildFreshWallet(config, logger);
      case "2":
        return await buildWalletFromSeed(config, rli, logger);
      case "3":
        logger.info("Exiting...");
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

const mapContainerPort = (
  env: StartedDockerComposeEnvironment,
  url: string,
  containerName: string
) => {
  const mappedUrl = new URL(url);
  const container = env.getContainer(containerName);

  mappedUrl.port = String(container.getFirstMappedPort());

  return mappedUrl.toString().replace(/\/+$/, "");
};

export const run = async (
  config: Config,
  logger: Logger,
  dockerEnv?: DockerComposeEnvironment
): Promise<void> => {
  const rli = createInterface({ input, output, terminal: true });
  let env;
  if (dockerEnv !== undefined) {
    env = await dockerEnv.up();

    if (config instanceof StandaloneConfig) {
      config.indexer = mapContainerPort(env, config.indexer, "umbra-otc-indexer");
      config.indexerWS = mapContainerPort(
        env,
        config.indexerWS,
        "umbra-otc-indexer"
      );
      config.node = mapContainerPort(env, config.node, "umbra-otc-node");
      config.proofServer = mapContainerPort(
        env,
        config.proofServer,
        "umbra-otc-proof-server"
      );
    }
  }
  const wallet = await buildWallet(config, rli, logger);
  try {
    if (wallet !== null) {
      const walletAndMidnightProvider =
        await createWalletAndMidnightProvider(wallet);
      // One provider set per contract: each has its own private-state store and ZK key folder.
      const makeProviders = (name: ContractName) => ({
        privateStateProvider: levelPrivateStateProvider<string>({
          privateStateStoreName: `${config.privateStateStoreName}-${name}`,
        }),
        publicDataProvider: indexerPublicDataProvider(
          config.indexer,
          config.indexerWS
        ),
        zkConfigProvider: new NodeZkConfigProvider<never>(
          path.join(config.zkConfigPath, name)
        ),
        proofProvider: httpClientProofProvider(config.proofServer),
        walletProvider: walletAndMidnightProvider,
        midnightProvider: walletAndMidnightProvider,
      });
      await circuit_main_loop(wallet, makeProviders, rli, logger);
    }
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Found error '${e.message}'`);
      logger.info("Exiting...");
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
    } finally {
      try {
        if (wallet !== null) {
          await wallet.close();
        }
      } catch (e) {
      } finally {
        try {
          if (env !== undefined) {
            await env.down();
            logger.info("Goodbye");
            process.exit(0);
          }
        } catch (e) {}
      }
    }
  }
};
