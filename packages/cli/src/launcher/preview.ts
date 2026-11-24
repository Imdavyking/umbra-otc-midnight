// packages/cli/src/launcher/preview.ts  ->  built to packages/cli/dist/launcher/preview.js
//
// HTLC launcher for Midnight (ledger 9), launched by the deploy script:
//   node dist/launcher/preview.js new     deploy a new HTLC contract
//   node dist/launcher/preview.js join    attach to an existing one (HTLC_ADDRESS=<addr>)
//
// Env:
//   MIDNIGHT_NETWORK   local | preview (default) | preprod | custom
//   WALLET_SEED        hex seed. If unset, a seed is created and kept in HTLC_STATE
//   HTLC_STATE         secrets file, default ~/.umbra-otc/<network>.json (mode 600, outside the repo)
//   HTLC_ADDRESS       contract address for `join`
//   HTLC_DEPLOY_ARGS   JSON array of constructor args for `new` (default []).
//                      Strings like "123n" become bigint, "0xab12.." become Uint8Array.
//   HTLC_LOG_DIR       where the public deploy log goes (default ./deploy)
//
// Only public data (address, tx ids, block heights) is written to <HTLC_LOG_DIR>/<network>-log.jsonl.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { pino } from "pino";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { type EnvironmentConfiguration } from "@midnight-ntwrk/testkit-js";
import { getConfig } from "./config.js";
import {
  MidnightWalletProvider,
  syncWallet,
  waitForNightThenDust,
} from "./wallet.js";
import { buildProviders, ledgerState } from "./providers.js";
import {
  CompiledHtlcContract,
  ledger,
  zkConfigPath,
} from '@umbra-otc/contract';

// @ts-expect-error WebSocket global for the indexer's GraphQL subscriptions in Node
globalThis.WebSocket = WebSocket;

const NET = process.env["MIDNIGHT_NETWORK"] ?? "preview";
process.env["MIDNIGHT_NETWORK"] = NET; // getConfig() reads it

const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  transport: { target: "pino-pretty" },
});
const config = getConfig();
setNetworkId(config.networkId);

const STATE =
  process.env["HTLC_STATE"] ??
  path.join(os.homedir(), ".umbra-otc", `${NET}.json`);
const LOG_DIR = path.resolve(
  process.env["HTLC_LOG_DIR"] ?? path.join(process.cwd(), "deploy"),
);
const PRIVATE_STATE_ID = "htlc";

type State = { seed?: string; contract?: string };

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const load = (): State => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8")) as State;
  } catch {
    return {};
  }
};
const save = (s: State) => {
  fs.mkdirSync(path.dirname(STATE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
};

const publicLog = (entry: Record<string, unknown>) => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = JSON.stringify(
    { at: new Date().toISOString(), network: NET, ...entry },
    (_k, v) =>
      typeof v === "bigint"
        ? v.toString()
        : v instanceof Uint8Array
          ? hex(v)
          : v,
  );
  fs.appendFileSync(path.join(LOG_DIR, `${NET}-log.jsonl`), `${line}\n`);
  console.log(`PUBLIC ${line}`);
};

const envConfig: EnvironmentConfiguration = {
  walletNetworkId: config.networkId,
  networkId: config.networkId,
  indexer: config.indexer,
  indexerWS: config.indexerWS,
  node: config.node,
  nodeWS: config.nodeWS,
  faucet: config.faucet,
  proofServer: config.proofServer,
};

function resolveSeed(s: State): string {
  const fromEnv = process.env["WALLET_SEED"]?.trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]+$/.test(fromEnv) || fromEnv.length % 2 !== 0) {
      throw new Error(
        "WALLET_SEED must be a hex string of even length (no 0x prefix).",
      );
    }
    return fromEnv;
  }
  if (!s.seed) {
    s.seed = randomBytes(32).toString("hex");
    save(s);
    console.log(`New wallet seed created and stored in ${STATE}`);
  }
  return s.seed;
}

async function openWallet(s: State): Promise<MidnightWalletProvider> {
  const wallet = await MidnightWalletProvider.build(logger, envConfig, {
    kind: "seed",
    value: resolveSeed(s),
  });
  await wallet.start();
  console.log(
    `WALLET_ADDRESS ${String(wallet.unshieldedKeystore.getBech32Address())}`,
  );
  // Syncs from genesis: seconds on local, up to an hour+ on public networks.
  await syncWallet(logger, wallet.wallet, 60 * 60_000);
  // Returns at once if already funded; otherwise prints the faucet address and waits.
  await waitForNightThenDust(
    logger,
    wallet.wallet,
    wallet.unshieldedKeystore,
    envConfig,
    config.faucet,
    {
      label: "htlc",
    },
  );
  return wallet;
}

function parseDeployArgs(): unknown[] {
  const raw = process.env["HTLC_DEPLOY_ARGS"];
  if (!raw) return [];
  const parsed = JSON.parse(raw, (_k, v) => {
    if (typeof v === "string" && /^-?\d+n$/.test(v))
      return BigInt(v.slice(0, -1));
    if (typeof v === "string" && /^0x([0-9a-fA-F]{2})+$/.test(v))
      return new Uint8Array(Buffer.from(v.slice(2), "hex"));
    return v;
  });
  if (!Array.isArray(parsed))
    throw new Error("HTLC_DEPLOY_ARGS must be a JSON array.");
  return parsed;
}

async function readContract(address: string) {
  const pdp = indexerPublicDataProvider(config.indexer, config.indexerWS);
  return ledger(ledgerState(await pdp.queryContractState(address)));
}

const printLedger = (l: unknown) =>
  console.log(
    JSON.stringify(
      l,
      (_k, v) =>
        typeof v === "bigint"
          ? v.toString()
          : v instanceof Uint8Array
            ? hex(v)
            : v,
      2,
    ),
  );

const mode = (process.argv[2] ?? "new").replace(/^--/, "");
const s = load();
let wallet: MidnightWalletProvider | undefined;

try {
  switch (mode) {
    case "new": {
      wallet = await openWallet(s);
      const p = buildProviders(wallet, zkConfigPath, config);
      const args = parseDeployArgs();
      const t0 = Date.now();
      logger.info("Deploying HTLC contract (proving can take a minute)...");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deployed: any = await deployContract(
        p as any,
        {
          compiledContract: CompiledHtlcContract,
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: {},
          args,
        } as any,
      );
      const pub = deployed.deployTxData.public;
      s.contract = pub.contractAddress;
      save(s);
      publicLog({
        step: "deploy",
        contract: pub.contractAddress,
        txId: pub.txId,
        txHash: pub.txHash,
        block: pub.blockHeight,
        ms: Date.now() - t0,
      });
      console.log(`CONTRACT ${pub.contractAddress}`);
      break;
    }
    case "join": {
      const address = process.env["HTLC_ADDRESS"]?.trim() || s.contract;
      if (!address)
        throw new Error(
          "No contract address: set HTLC_ADDRESS or pass --address=<addr> to the deploy script.",
        );
      // Read-only check: the contract exists on this network and decodes as ledger 9.
      const l = await readContract(address);
      s.contract = address;
      save(s);
      publicLog({ step: "join", contract: address });
      printLedger(l);
      console.log(`CONTRACT ${address}`);
      break;
    }
    default:
      throw new Error(`Unknown mode '${mode}'. Use: new | join`);
  }
} catch (e) {
  console.error("ERROR", e);
  process.exitCode = 1;
} finally {
  if (wallet) await wallet.stop().catch(() => undefined);
}
process.exit(process.exitCode ?? 0);
