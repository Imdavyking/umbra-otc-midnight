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
 * Blockfrost (the same endpoints Lace uses) for the Preview network.
 *
 *   BLOCKFROST_PROJECT_ID   your project id, in the repo-root .env
 *   BLOCKFROST_SERVICES     which services go through Blockfrost, comma separated:
 *                             "node,indexer"  (default when the key is set)
 *                             "node"          Blockfrost node RPC + official indexer
 *                             "indexer"       official node RPC + Blockfrost indexer
 *                             "none"          everything on the official endpoints
 *
 * Splitting them lets you find out which service is the one that misbehaves.
 */
const blockfrostKey = (process.env.BLOCKFROST_PROJECT_ID ?? "").trim();
const bfServices = new Set(
  (process.env.BLOCKFROST_SERVICES ?? "node,indexer")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
const bfNode = blockfrostKey !== "" && bfServices.has("node");
const bfIndexer = blockfrostKey !== "" && bfServices.has("indexer");
const bfQuery = `?project_id=${encodeURIComponent(blockfrostKey)}`;

console.log(
  `[config] preview node: ${bfNode ? "Blockfrost" : "official"}, indexer: ${bfIndexer ? "Blockfrost" : "official"}`,
);

export class PreviewConfig implements Config {
  networkId = "preview";
  privateStateStoreName = "umbra-otc-htlc";
  logDir = logPath("preview");
  zkConfigPath = zkConfigPath;
  indexer = "https://indexer.preview.midnight.network/api/v4/graphql";
  indexerWS = "wss://indexer.preview.midnight.network/api/v4/graphql/ws";
  node = "https://rpc.preview.midnight.network";
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
