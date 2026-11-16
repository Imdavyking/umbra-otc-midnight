import { useState, type ReactNode } from "react";
import useMidnightWallet from "../hookes/useMidnightWallet";
import { useDeployedContract } from "../providers/DeployedContractProvider";
import type { ApiFor, ContractKind, ContractSlot } from "../lib/common-types";

/**
 * Renders children only once the wallet is connected and the contract is joined.
 * Otherwise shows what is missing (connect wallet / enter address / error).
 */
export default function ContractGate<K extends ContractKind>({
  kind,
  title,
  children,
}: {
  kind: K;
  title: string;
  children: (api: ApiFor<K>) => ReactNode;
}) {
  const wallet = useMidnightWallet();
  const dep = useDeployedContract();
  const [addr, setAddr] = useState(dep.addressOf(kind) ?? "");
  const slot = dep[kind] as ContractSlot<K>;

  if (!wallet?.walletState.hasConnected) {
    return <Notice title={title}>Connect your Lace wallet to continue.</Notice>;
  }
  if (slot.status === "joined" && slot.api) return <>{children(slot.api)}</>;

  return (
    <Notice title={title}>
      <p className="mb-3 text-gray-600">
        {slot.status === "joining"
          ? "Joining contract…"
          : slot.error
          ? `Could not join: ${slot.error}`
          : "Enter the deployed contract address to join."}
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
          placeholder="Contract address (hex)"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
        <button
          disabled={!addr.trim() || slot.status === "joining"}
          onClick={() => dep.join(kind, addr)}
          className="px-5 py-2 rounded-lg bg-indigo-700 text-white font-semibold disabled:opacity-50"
        >
          Join
        </button>
      </div>
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="max-w-xl mx-auto mt-16 p-6 border rounded-2xl shadow-sm bg-white">
      <h2 className="text-2xl font-bold mb-3">{title}</h2>
      {children}
    </div>
  );
}
