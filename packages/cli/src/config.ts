import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export interface Config {
  /** Network id passed to the wallet SDK and the provider set ("preview" | "undeployed"). */
  readonly networkId: string;
  readonly privateStateStoreName: string;
  readonly logDir: string;
  /** Compiler output folder for htlc (contains contract/, keys/, zkir/, compiler/). */
  readonly zkConfigPath: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export const currentDir = path.dirname(fileURLToPath(import.meta.url));
/** Repo-root .env (cli/src or cli/dist -> cli -> packages -> root). */
export const envPath = path.resolve(currentDir, "..", "..", "..", ".env");

// Load .env here so the values are present before any config class is constructed,
// whatever order the launcher imports things in.
dotenv.config({ path: envPath });

const zkConfigPath = path.resolve(
  currentDir,
  "..",
  "..",
  "contracts",
  "src",
  "managed",
  "htlc",
);

const logPath = (name: string) =>
  path.resolve(
    currentDir,
    "..",
    "logs",
    name,
    `${new Date().toISOString()}.log`,
  );

/**
 * Blockfrost project id for the Preview network (the same endpoints Lace uses).
 * Set BLOCKFROST_PROJECT_ID in the repo-root .env. When it is empty, the official
 * Midnight Preview endpoints are used instead.
 */
const blockfrostKey = (process.env.BLOCKFROST_PROJECT_ID ?? "").trim();
console.log(`Using Blockfrost project id for Preview network: ${blockfrostKey}`);
const bfQuery = `?project_id=${encodeURIComponent(blockfrostKey)}`;
const useBlockfrost = blockfrostKey !== "";

export class PreviewConfig implements Config {
  networkId = "preview";
  privateStateStoreName = "umbra-otc-htlc";
  logDir = logPath("preview");
  zkConfigPath = zkConfigPath;
  indexer = useBlockfrost
    ? `https://midnight-preview.blockfrost.io/api/v0${bfQuery}`
    : "https://indexer.preview.midnight.network/api/v4/graphql";
  indexerWS = useBlockfrost
    ? `wss://midnight-preview.blockfrost.io/api/v0/ws${bfQuery}`
    : "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
  node = useBlockfrost
    ? `https://rpc.midnight-preview.blockfrost.io/${bfQuery}`
    : "https://rpc.preview.midnight.network";
  proofServer = "http://127.0.0.1:6300"; // always local
}

/** Local stack you start yourself (node + indexer + proof server). */
export class LocalConfig implements Config {
  networkId = "undeployed";
  privateStateStoreName = "umbra-otc-htlc-local";
  logDir = logPath("local");
  zkConfigPath = zkConfigPath;
  indexer = "http://127.0.0.1:8088/api/v4/graphql";
  indexerWS = "ws://127.0.0.1:8088/api/v4/graphql/ws";
  node = "http://127.0.0.1:9944";
  proofServer = "http://127.0.0.1:6300";
}
