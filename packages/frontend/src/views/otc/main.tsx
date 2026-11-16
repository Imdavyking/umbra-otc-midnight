import { useState } from "react";
import type { OtcAPI } from "@umbra-otc/api";
import ContractGate from "../../components/ContractGate";
import { ActionButton, Card, Field, Mono, copy } from "../../components/ui";
import useObservable from "../../hookes/useObservable";
import { toHex, short } from "../../lib/utils";

const PHASE_HELP: Record<string, string> = {
  Idle: "No round open. The operator opens a round to start.",
  Commit: "Submit a sealed order. Nobody can see the book.",
  Reveal: "Open your committed order. Unrevealed orders are forfeited.",
  Cleared: "Round cleared at one uniform price. Claim your fill.",
};

function OtcDesk({ api }: { api: OtcAPI }) {
  const { value: s } = useObservable(api.state);
  const [leaf, setLeaf] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [level, setLevel] = useState("15");
  const [base, setBase] = useState("");
  const [tick, setTick] = useState("");
  const [newTrader, setNewTrader] = useState("");
  const [suggest, setSuggest] = useState<string>("");

  const price = (l: number) => (s ? (s.basePrice + BigInt(l) * s.tick).toString() : "—");

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">OTC sealed-bid auction</h1>
        <p className="text-gray-600 mt-1">
          Commit hidden orders, reveal, and the whole batch clears at one price. Your
          identity is never on-chain.
        </p>
      </header>

      <Card title="Round status">
        {!s ? (
          <p className="text-gray-500">Loading state…</p>
        ) : (
          <>
            <p>
              Round <b>#{s.round.toString()}</b> · phase <b>{s.phase}</b> ·{" "}
              {s.committed} committed · {s.revealed.length} revealed
            </p>
            <p className="text-sm text-gray-600">{PHASE_HELP[s.phase]}</p>
            <p className="text-sm">
              Price at level L = {s.basePrice.toString()} + L × {s.tick.toString()}
            </p>
            {s.clearing && (
              <p className="text-sm bg-green-50 border border-green-200 rounded-lg p-3">
                Cleared at level <b>{s.clearing.level}</b> (price{" "}
                <b>{price(s.clearing.level)}</b>), matched volume{" "}
                <b>{s.clearing.volume.toString()}</b>
              </p>
            )}
          </>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Trader">
          <div className="flex gap-2 items-center">
            <ActionButton
              variant="ghost"
              run={async () => setLeaf(await api.myTraderLeaf())}
              done="Leaf ready"
            >
              Show my trader leaf
            </ActionButton>
            {leaf && (
              <button className="text-sm text-indigo-700" onClick={() => copy(leaf)}>
                copy
              </button>
            )}
          </div>
          {leaf && <Mono>{leaf}</Mono>}
          <p className="text-xs text-gray-500">
            Send this to the operator to be whitelisted before you can trade.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map((x) => (
              <button
                key={x}
                onClick={() => setSide(x)}
                className={`py-2 rounded-lg border font-semibold uppercase text-sm ${
                  side === x ? "bg-indigo-700 text-white" : "bg-white"
                }`}
              >
                {x}
              </button>
            ))}
          </div>
          <Field label="Amount (smallest units)" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
          <Field label={`Price level (1–30) → price ${price(Number(level) || 0)}`} inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value.trim())} />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={s?.phase !== "Commit" || !/^\d+$/.test(amount)}
              run={() => api.commitOrder({ side, amount: BigInt(amount), level: Number(level) })}
              done="Order committed"
            >
              Commit sealed order
            </ActionButton>
            <ActionButton disabled={s?.phase !== "Reveal"} run={() => api.revealOrder()} done="Order revealed">
              Reveal
            </ActionButton>
            <ActionButton disabled={s?.phase !== "Cleared"} run={() => api.claimFill()} done="Fill recorded">
              Claim fill
            </ActionButton>
          </div>
        </Card>

        <Card title="Operator">
          <Field label="Add trader (leaf hex)" value={newTrader} onChange={(e) => setNewTrader(e.target.value.trim())} />
          <ActionButton disabled={!newTrader} run={() => api.addTrader(newTrader)} done="Trader added">
            Add trader
          </ActionButton>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Base price" inputMode="numeric" value={base} onChange={(e) => setBase(e.target.value.trim())} />
            <Field label="Tick" inputMode="numeric" value={tick} onChange={(e) => setTick(e.target.value.trim())} />
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={!/^\d+$/.test(base) || !/^\d+$/.test(tick)}
              run={() => api.openRound(BigInt(base), BigInt(tick))}
              done="Round opened"
            >
              Open round
            </ActionButton>
            <ActionButton run={() => api.closeCommits()} done="Commit phase closed">
              Close commits
            </ActionButton>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <ActionButton
              variant="ghost"
              run={async () => {
                const c = await api.suggestClearLevel();
                setSuggest(c ? `level ${c.level}, volume ${c.volume}` : "no crossing orders");
              }}
              done="Computed"
            >
              Suggest clearing level
            </ActionButton>
            <span className="text-sm">{suggest}</span>
          </div>
          <ActionButton disabled={s?.phase !== "Reveal"} run={() => api.clearRound()} done="Round cleared">
            Clear round
          </ActionButton>
        </Card>
      </div>

      <Card title="Revealed orders (anonymous tags)">
        {!s?.revealed.length ? (
          <p className="text-sm text-gray-500">Nothing revealed yet.</p>
        ) : (
          <ul className="text-sm divide-y">
            {s.revealed.map((o) => (
              <li key={toHex(o.tag)} className="py-2 flex justify-between gap-3">
                <Mono>{short(toHex(o.tag), 6)}</Mono>
                <span>
                  {o.side} {o.amount.toString()} @ level {o.level} ({price(o.level)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function OtcPage() {
  return (
    <ContractGate kind="otc" title="OTC sealed-bid auction">
      {(api) => <OtcDesk api={api} />}
    </ContractGate>
  );
}
