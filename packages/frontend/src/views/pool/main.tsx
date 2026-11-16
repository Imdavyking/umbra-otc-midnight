import { useState } from "react";
import type { PoolAPI } from "@umbra-otc/api";
import ContractGate from "../../components/ContractGate";
import { ActionButton, Card, Field, Mono, copy } from "../../components/ui";
import useMidnightWallet from "../../hookes/useMidnightWallet";
import useObservable from "../../hookes/useObservable";

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function PoolPanel({ api }: { api: PoolAPI }) {
  const wallet = useMidnightWallet();
  const { value: s } = useObservable(api.state);
  const [note, setNote] = useState("");
  const [recipient, setRecipient] = useState(wallet?.walletState.coinPublicKey ?? "");
  const [importJson, setImportJson] = useState("");

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Private pool</h1>
        <p className="text-gray-600 mt-1">
          Deposit a fixed amount, then withdraw to any address. Nothing on-chain links the two.
        </p>
      </header>

      <Card title="Pool">
        {s ? (
          <p className="text-sm">
            Denomination <b>{s.denom.toString()}</b> · {s.deposits.toString()} deposits ·{" "}
            {s.withdrawals.toString()} withdrawals (anonymity set ≈{" "}
            {(s.deposits - s.withdrawals).toString()})
          </p>
        ) : (
          <p className="text-gray-500">Loading…</p>
        )}
      </Card>

      <Card title="Deposit">
        <ActionButton
          run={async () => setNote((await api.deposit()).noteJson)}
          done="Deposited. Save your note!"
        >
          Deposit one denomination
        </ActionButton>
        {note && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-amber-900">
              Back up this note now. It is the only key to your funds.
            </p>
            <Mono>{note}</Mono>
            <div className="flex gap-3">
              <button className="text-sm text-indigo-700" onClick={() => copy(note)}>copy</button>
              <button className="text-sm text-indigo-700" onClick={() => download("umbra-note.json", note)}>
                download
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Withdraw">
        <Field
          label="Recipient coin public key (hex)"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
        />
        <ActionButton disabled={!recipient} run={() => api.withdraw(recipient)} done="Withdrawn">
          Withdraw active note
        </ActionButton>
        <p className="text-xs text-gray-500">
          Use a fresh address for stronger privacy. The proof is bound to this recipient.
        </p>
      </Card>

      <Card title="Import a note">
        <Field label="Note JSON" value={importJson} onChange={(e) => setImportJson(e.target.value)} />
        <ActionButton disabled={!importJson} run={() => api.loadNote(importJson)} done="Note set active">
          Use this note
        </ActionButton>
      </Card>
    </div>
  );
}

export default function PoolPage() {
  return (
    <ContractGate kind="pool" title="Private pool">
      {(api) => <PoolPanel api={api} />}
    </ContractGate>
  );
}
