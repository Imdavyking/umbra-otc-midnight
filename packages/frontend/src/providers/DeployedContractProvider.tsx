import useMidnightWallet from "../hookes/useMidnightWallet";
import {
  HtlcAPI,
  HtlcPrivateStateId,
  OtcAPI,
  OtcPrivateStateId,
  PoolAPI,
  PoolPrivateStateId,
  type HtlcProviders,
  type OtcProviders,
  type PoolProviders,
} from "@umbra-otc/api";
import type { Logger } from "pino";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import { withPrivateState } from "../lib/actions";
import type { ApiFor, ContractKind, ContractSlot } from "../lib/common-types";
import { errMsg, store } from "../lib/utils";
import { ENV_ADDRESSES } from "../utils/constants";

export interface DeploymentProvider {
  otc: ContractSlot<"otc">;
  pool: ContractSlot<"pool">;
  htlc: ContractSlot<"htlc">;
  /** Address in use for a contract: user-entered (remembered) or from .env */
  addressOf: (k: ContractKind) => string | undefined;
  /** Join a contract, optionally with a new address (remembered in this browser). */
  join: (k: ContractKind, address?: string) => Promise<void>;
}

export const DeployedContractContext = createContext<DeploymentProvider | null>(null);

const KEY = (k: ContractKind) => `umbra-otc:address:${k}`;
const idle = { status: "idle" } as const;

const DeployedContractProvider = ({
  children,
  logger,
}: PropsWithChildren<{ logger?: Logger }>) => {
  const wallet = useMidnightWallet();
  const [otc, setOtc] = useState<ContractSlot<"otc">>(idle);
  const [pool, setPool] = useState<ContractSlot<"pool">>(idle);
  const [htlc, setHtlc] = useState<ContractSlot<"htlc">>(idle);

  const addressOf = useCallback(
    (k: ContractKind) => store.get(KEY(k)) || ENV_ADDRESSES[k] || undefined,
    []
  );

  const join = useCallback(
    async (k: ContractKind, address?: string) => {
      const base = wallet?.walletState.providers;
      if (!wallet?.walletState.hasConnected || !base) return;
      const addr = (address ?? addressOf(k))?.trim();
      const set = { otc: setOtc, pool: setPool, htlc: setHtlc }[k] as (
        s: ContractSlot<typeof k>
      ) => void;
      if (!addr) return set({ status: "failed", error: "No contract address configured" });
      if (address) store.set(KEY(k), addr);

      set({ status: "joining" });
      try {
        let api: ApiFor<typeof k>;
        if (k === "otc") {
          api = await OtcAPI.join(
            withPrivateState<OtcProviders>(base, OtcPrivateStateId),
            addr,
            logger as never
          );
        } else if (k === "pool") {
          api = await PoolAPI.join(
            withPrivateState<PoolProviders>(base, PoolPrivateStateId),
            addr,
            logger as never
          );
        } else {
          api = await HtlcAPI.join(
            withPrivateState<HtlcProviders>(base, HtlcPrivateStateId),
            addr,
            logger as never
          );
        }
        set({ status: "joined", api } as never);
        logger?.info(`Joined ${k} contract ${addr}`);
      } catch (e) {
        logger?.error(`Failed to join ${k}: ${errMsg(e)}`);
        set({ status: "failed", error: errMsg(e) });
      }
    },
    [wallet?.walletState.hasConnected, wallet?.walletState.providers, addressOf, logger]
  );

  // Auto-join every configured contract once the wallet is connected.
  useEffect(() => {
    if (!wallet?.walletState.hasConnected) return;
    (["otc", "pool", "htlc"] as ContractKind[]).forEach((k) => {
      const slot = { otc, pool, htlc }[k];
      if (slot.status === "idle" && addressOf(k)) void join(k);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.walletState.hasConnected]);

  // Drop APIs when the wallet disconnects.
  useEffect(() => {
    if (!wallet?.walletState.hasConnected) {
      setOtc(idle);
      setPool(idle);
      setHtlc(idle);
    }
  }, [wallet?.walletState.hasConnected]);

  return (
    <DeployedContractContext.Provider value={{ otc, pool, htlc, addressOf, join }}>
      {children}
    </DeployedContractContext.Provider>
  );
};

export const useDeployedContract = (): DeploymentProvider => {
  const ctx = useContext(DeployedContractContext);
  if (!ctx) throw new Error("useDeployedContract must be used within a DeployedContractProvider");
  return ctx;
};

export default DeployedContractProvider;
