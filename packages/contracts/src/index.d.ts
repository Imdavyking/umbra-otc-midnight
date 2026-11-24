import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-js";
export { Contract, ledger, pureCircuits, type Witnesses, type Ledger, type ImpureCircuits, type PureCircuits } from "./managed/htlc/contract/index.js";
import { Contract } from "./managed/htlc/contract/index.js";
export * from "./witnesses.js";
export declare const zkConfigPath: string;
export declare const CompiledHtlcContract: CompiledContract.CompiledContract<Contract<any, any>, any, never>;
export * as htlc from "./managed/htlc/contract/index.js";
