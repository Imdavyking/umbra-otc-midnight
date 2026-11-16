import { useState } from "react";
import { HtlcAPI } from "@umbra-otc/api";
import ContractGate from "../../components/ContractGate";
import { ActionButton, Card, Field, Mono, copy } from "../../components/ui";
import useMidnightWallet from "../../hookes/useMidnightWallet";
import useObservable from "../../hookes/useObservable";
import { toHex, short } from "../../lib/utils";

function HtlcPanel({ api }: { api: HtlcAPI }) {
  const wallet = useMidnightWallet();
  const me = wallet?.walletState.coinPublicKey ?? "";
  const { value: s } = useObservable(api.state);

  const [secret, setSecret] = useState<{ preimageHex: string; hashlockHex: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [hashlock, setHashlock] = useState("");
  const [claimant, setClaimant] = useState("");
  const [hours, setHours] = useState("24");
  const [preimage, setPreimage] = useState("");

  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">HTLC swap</h1>
        <p className="text-gray-600 mt-1">
          Hash-time-locked escrow. Lock here, the counterparty locks the other asset with the same
          hash, and revealing the secret settles both sides.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="1. Secret">
          <ActionButton variant="ghost" run={async () => setSecret(HtlcAPI.newSecret())} done="Secret generated">
            Generate secret + hashlock
          </ActionButton>
          {secret && (
            <div className="space-y-2 text-sm">
              <div>
                <b>Hashlock</b> (share) <button className="text-indigo-700" onClick={() => copy(secret.hashlockHex)}>copy</button>
                <br />
                <Mono>{secret.hashlockHex}</Mono>
              </div>
              <div>
                <b>Preimage</b> (keep secret until claiming){" "}
                <button className="text-indigo-700" onClick={() => copy(secret.preimageHex)}>copy</button>
                <br />
                <Mono>{secret.preimageHex}</Mono>
              </div>
            </div>
          )}
        </Card>

        <Card title="2. Lock funds">
          <Field label="Amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
          <Field
            label="Hashlock (hex)"
            value={hashlock}
            placeholder={secret?.hashlockHex}
            onChange={(e) => setHashlock(e.target.value.trim())}
          />
          <Field label="Claimant coin public key (hex)" value={claimant} onChange={(e) => setClaimant(e.target.value.trim())} />
          <Field label="Expires in (hours)" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.trim())} />
          <ActionButton
            disabled={!/^\d+$/.test(amount) || !(hashlock || secret) || !claimant || !me}
            run={() =>
              api.lock({
                amount: BigInt(amount),
                hashlockHex: hashlock || secret!.hashlockHex,
                claimantCoinPublicKeyHex: claimant,
                refundCoinPublicKeyHex: me,
                expiry: BigInt(nowSec + Number(hours) * 3600),
              })
            }
            done="Funds locked"
          >
            Lock
          </ActionButton>
          <p className="text-xs text-gray-500">Refunds go to your connected wallet after expiry.</p>
        </Card>
      </div>

      <Card title="3. Claim">
        <Field label="Preimage (hex)" value={preimage} onChange={(e) => setPreimage(e.target.value.trim())} />
        <ActionButton disabled={!preimage} run={() => api.claim(preimage)} done="Claimed. Secret is now public.">
          Claim with secret
        </ActionButton>
      </Card>

      <Card title="Locks">
        {!s?.locks.length ? (
          <p className="text-sm text-gray-500">No locks yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {s.locks.map((l) => {
              const h = toHex(l.hashlock);
              const expired = Number(l.expiry) <= nowSec;
              return (
                <li key={h} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Mono>{short(h, 8)}</Mono>
                    <div className="text-gray-600">
                      {l.amount.toString()} · expires {new Date(Number(l.expiry) * 1000).toLocaleString()}
                      {l.preimage && <> · claimed (secret <Mono>{toHex(l.preimage)}</Mono>)</>}
                    </div>
                  </div>
                  {!l.preimage && (
                    <div className="flex gap-2">
                      <ActionButton variant="ghost" run={() => api.claim(preimage)} disabled={!preimage || expired} done="Claimed">
                        Claim
                      </ActionButton>
                      <ActionButton variant="ghost" run={() => api.refund(h)} disabled={!expired} done="Refunded">
                        Refund
                      </ActionButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function HtlcPage() {
  return (
    <ContractGate kind="htlc" title="HTLC swap">
      {(api) => <HtlcPanel api={api} />}
    </ContractGate>
  );
}
