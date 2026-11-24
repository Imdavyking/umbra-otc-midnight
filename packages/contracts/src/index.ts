import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-js";
import path from "node:path";

export {
  Contract,
  ledger,
  pureCircuits,
  type Witnesses,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits
} from "./managed/htlc/contract/index.js";
import { Contract } from "./managed/htlc/contract/index.js";
import { witnesses } from "./witnesses.js";
export * from "./witnesses.js";

const currentDir = path.resolve(new URL(import.meta.url).pathname, "..");
export const zkConfigPath = path.resolve(currentDir, "managed", "htlc");

export const CompiledHtlcContract = CompiledContract.make("HTLC", Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath)
);

export * as htlc from "./managed/htlc/contract/index.js";

// export * from "./witnesses.js";
