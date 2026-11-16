import { map, type Observable } from "rxjs";
import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-js";
import { htlc, type HtlcPrivateState } from "@umbra-otc/contract";
import type { Logger } from "pino";
import * as utils from "./utils.js";
import {
  HtlcPrivateStateId,
  type DerivedHtlcState,
  type HtlcProviders,
} from "./common-types.js";

const EMPTY: HtlcPrivateState = {};

/**
 * Pairs the generated contract with its compile output.
 * @param zkAssetsPath the folder `compact compile` wrote (contains contract/, keys/, zkir/, compiler/),
 *        e.g. packages/contracts/src/managed/htlc (Node) — keep it exactly as compiled.
 */
export function makeHtlcCompiledContract(zkAssetsPath: string) {
  return CompiledContract.make(
    "umbra-htlc",
    htlc.Contract<HtlcPrivateState>,
  ).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(zkAssetsPath),
  );
}
export type HtlcCompiledContract = ReturnType<typeof makeHtlcCompiledContract>;

// Types are inferred from Midnight.js so this file does not depend on its generic names.
async function deployHtlc(
  providers: HtlcProviders,
  compiledContract: HtlcCompiledContract,
) {
  return deployContract(providers, {
    compiledContract,
    privateStateId: HtlcPrivateStateId,
    initialPrivateState: EMPTY,
  });
}
async function findHtlc(
  providers: HtlcProviders,
  compiledContract: HtlcCompiledContract,
  contractAddress: string,
) {
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract,
    privateStateId: HtlcPrivateStateId,
    initialPrivateState: EMPTY,
  });
}
type DeployedHtlc =
  Awaited<ReturnType<typeof deployHtlc>> | Awaited<ReturnType<typeof findHtlc>>;

/**
 * Midnight.js 5 returns contract state as era-tagged, serialized data (see the 5.0.0
 * release notes: "state reads return records whose states are serialized").
 * This is the ONE place that turns it into the generated `ledger()` view. If `tsc` or the
 * first run complains here, adjust only this function.
 */
function decodeLedger(raw: unknown): htlc.Ledger {
  const rec = raw as { data?: unknown; state?: { data?: unknown } } | undefined;
  const data = rec?.data ?? rec?.state?.data;
  if (!data)
    throw new Error(
      "Unexpected contract state shape from the public data provider",
    );
  return htlc.ledger(data as Parameters<typeof htlc.ledger>[0]);
}

function derive(l: htlc.Ledger): DerivedHtlcState {
  return {
    locks: utils.entries(l.locks).map(([hashlock, lk]) => {
      const preimage = l.revealed.member(hashlock)
        ? l.revealed.lookup(hashlock)
        : null;
      return {
        hashlock,
        claimant: lk.claimant.bytes,
        refundTo: lk.refund_to.bytes,
        amount: lk.amount,
        expiry: lk.expiry,
        preimage,
        refunded: preimage === null && !l.lock_coins.member(hashlock),
      };
    }),
  };
}

export class HtlcAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state: Observable<DerivedHtlcState>;

  private constructor(
    private readonly providers: HtlcProviders,
    readonly deployed: DeployedHtlc,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployed.deployTxData.public.contractAddress;
    // Midnight.js 5 emits { value, blockHeight, blockHash }.
    this.state = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: "all" })
      .pipe(
        map((s) => derive(decodeLedger((s as { value?: unknown }).value ?? s))),
      );
  }

  static async deploy(
    providers: HtlcProviders,
    compiledContract: HtlcCompiledContract,
    logger?: Logger,
  ): Promise<HtlcAPI> {
    logger?.info("Deploying HTLC contract");
    return new HtlcAPI(
      providers,
      await deployHtlc(providers, compiledContract),
      logger,
    );
  }

  static async join(
    providers: HtlcProviders,
    compiledContract: HtlcCompiledContract,
    contractAddress: string,
    logger?: Logger,
  ): Promise<HtlcAPI> {
    return new HtlcAPI(
      providers,
      await findHtlc(providers, compiledContract, contractAddress),
      logger,
    );
  }

  /** New secret + its hashlock. Share only the hashlock with the counterparty. */
  static newSecret(): { preimageHex: string; hashlockHex: string } {
    const preimage = utils.randomNonceBytes(32);
    return {
      preimageHex: utils.uint8ArrayToHex(preimage),
      hashlockHex: utils.uint8ArrayToHex(
        htlc.pureCircuits.hashlock_of(preimage),
      ),
    };
  }

  /**
   * Escrow `amount` of the shielded token `colorHex` under `hashlockHex`.
   * `expiry` is unix seconds and must be in the future. The wallet funds the coin.
   */
  async lock(args: {
    amount: bigint;
    colorHex: string;
    hashlockHex: string;
    claimantCoinPublicKeyHex: string;
    refundCoinPublicKeyHex: string;
    expiry: bigint;
  }) {
    if (args.amount <= 0n) throw new Error("Amount must be positive");
    // A fresh output coin; the wallet balances the transaction with its own coins.
    const coin = {
      nonce: utils.randomNonceBytes(32),
      color: utils.hexBytes(args.colorHex, 32),
      value: args.amount,
    };
    this.logger?.info("Locking funds");
    return this.deployed.callTx.lock(
      coin,
      utils.hexBytes(args.hashlockHex, 32),
      { bytes: utils.hexBytes(args.claimantCoinPublicKeyHex, 32) },
      { bytes: utils.hexBytes(args.refundCoinPublicKeyHex, 32) },
      args.expiry,
    );
  }

  /** Reveals the secret on-chain and pays the claimant. Submit from the claimant's wallet. */
  async claim(preimageHex: string) {
    return this.deployed.callTx.claim(utils.hexBytes(preimageHex, 32));
  }

  /** After expiry, returns the coin to refund_to. Submit from the refund wallet. */
  async refund(hashlockHex: string) {
    return this.deployed.callTx.refund(utils.hexBytes(hashlockHex, 32));
  }
}
