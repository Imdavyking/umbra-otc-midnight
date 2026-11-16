import useMidnightWallet from "../hookes/useMidnightWallet";

import {
  HtlcAPI,
  HtlcPrivateStateId,
  makeHtlcCompiledContract,
  type HtlcProviders,
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
import type { ContractSlot } from "../lib/common-types";
import { errMsg, store } from "../lib/utils";
import { ENV_ADDRESSES } from "../utils/constants";

export interface DeploymentProvider {
  htlc: ContractSlot<"htlc">;
  addressOf: () => string | undefined;
  join: (address?: string) => Promise<void>;
}

export const DeployedContractContext = createContext<DeploymentProvider | null>(
  null,
);

const KEY = "umbra-otc:address:htlc";
const idle = { status: "idle" } as const;

const DeployedContractProvider = ({
  children,
  logger,
}: PropsWithChildren<{ logger?: Logger }>) => {
  const wallet = useMidnightWallet();
  const [htlc, setHtlc] = useState<ContractSlot<"htlc">>(idle);

  const addressOf = useCallback(
    () => store.get(KEY) || ENV_ADDRESSES.htlc || undefined,
    [],
  );

  const join = useCallback(
    async (address?: string) => {
      const base = wallet?.walletState.providers;
      if (!wallet?.walletState.hasConnected || !base) return;
      const addr = (address ?? addressOf())?.trim();
      if (!addr)
        return setHtlc({
          status: "failed",
          error: "No contract address configured",
        });
      if (address) store.set(KEY, addr);

      setHtlc({ status: "joining" });
      const htlcCompiledContract = makeHtlcCompiledContract(
        window.location.origin,
      );

      try {
        const api = await HtlcAPI.join(
          withPrivateState<HtlcProviders>(base, HtlcPrivateStateId),
          htlcCompiledContract, // from @umbra-otc/api, or built there
          addr,
          logger as never,
        );
        setHtlc({ status: "joined", api } as never);
        logger?.info(`Joined htlc contract ${addr}`);
      } catch (e) {
        logger?.error(`Failed to join htlc: ${errMsg(e)}`);
        setHtlc({ status: "failed", error: errMsg(e) });
      }
    },
    [
      wallet?.walletState.hasConnected,
      wallet?.walletState.providers,
      addressOf,
      logger,
    ],
  );

  // Auto-join once the wallet is connected; drop the API on disconnect.
  useEffect(() => {
    if (!wallet?.walletState.hasConnected) return setHtlc(idle);
    if (htlc.status === "idle" && addressOf()) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.walletState.hasConnected]);

  return (
    <DeployedContractContext.Provider value={{ htlc, addressOf, join }}>
      {children}
    </DeployedContractContext.Provider>
  );
};

export const useDeployedContract = (): DeploymentProvider => {
  const ctx = useContext(DeployedContractContext);
  if (!ctx)
    throw new Error(
      "useDeployedContract must be used within a DeployedContractProvider",
    );
  return ctx;
};

export default DeployedContractProvider;
