# 🌑 Umbra OTC – HTLC Swaps on Midnight

A zero-knowledge DApp built with **Midnight's Compact language** for atomic swaps. A hash-time-locked contract escrows a shielded coin until the counterparty reveals a secret; otherwise the coin is refunded after expiry. It targets the current Midnight stack (ledger 9).

---

## 🔐 HTLC swap

One contract per chain. The flow for a swap between Midnight and another chain:

1. **Alice** locks a coin on Midnight with `lock(coin, H(secret), bob, alice, expiry_A)`.
2. **Bob** locks the counter-asset on the other chain under the same hash, with a shorter expiry.
3. **Alice** claims on the other chain, which reveals the secret.
4. **Bob** claims on Midnight with the revealed secret and receives Alice's coin.
5. Either side can `refund()` after expiry.

Circuits:

- `lock()`: escrow one shielded coin under a hashlock, with a claimant, a refund address and an expiry (unix seconds)
- `claim(preimage)`: reveal the secret and pay the claimant. Anyone holding the secret may submit it; funds always go to the claimant
- `refund(hashlock)`: return the coin to the refund address after expiry
- `hashlock_of(preimage)`: pure circuit that computes the hashlock

Notes:

- Each lock escrows one whole coin and claim/refund spend exactly that coin, so the contract never creates a change coin.
- `persistentHash` is documented as using the SHA-256 compression algorithm. Before pairing this contract with a Bitcoin or EVM counterpart, check that `persistentHash<Bytes<32>>(x)` equals the counterpart's hash of the same 32 bytes.
- A claim or refund pays a shielded coin without a ciphertext, so the receiving wallet only learns about the coin when that same wallet submits the claim or refund transaction.

> See [`packages/contracts/src/htlc.compact`](./packages/contracts/src/htlc.compact)

---

## 🏗️ Packages

```
compact/               Compact compiler fetcher
packages/
  contracts/           htlc.compact and generated TypeScript bindings
  api/                 HtlcAPI (deploy, join, state, circuit calls)
  cli/                 Interactive CLI (wallet and providers)
  scripts/             Deploy, key generation, faucet helper, balance, ZK key copy
  frontend/            React + Vite app
```

---

## 🧩 Requirements

- **Linux, macOS or WSL.** The Compact compiler does not run in native Windows shells; use the Ubuntu (WSL) terminal.
- **Node.js ≥ 22.12.** Midnight.js 5 packages are ESM-only.
- **Yarn 4 via Corepack:** `corepack enable`, or prefix commands with `corepack yarn`.
- **Compact toolchain 0.36** (language 0.28): install the `compact` CLI, then `compact update 0.36`.
- **Docker** for the proof server.
- **A network:** Preview (ledger 9) or a local `undeployed` network. **Preprod is not supported**: it stays on ledger 8, and a contract compiled with toolchain 0.36 will not deploy there.
- [Lace Wallet](https://www.lace.io) for the frontend.

---

## 🛠️ Run it

```bash
# proof server (ledger 9)
docker run -d --name proof-server -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.0

corepack enable
cp .env.example .env          # set WALLET_SEED and NETWORK_ID=preview
corepack yarn install
```

### Compile and build

```bash
corepack yarn workspace @umbra-otc/contract compact    # compile htlc.compact with toolchain 0.36.1
corepack yarn workspace @umbra-otc/contract build
corepack yarn workspace @umbra-otc/api build
```

### Fund a wallet (Preview)

The faucet sends **tNIGHT to an unshielded address** (`mn_addr_preview1…`). It rejects shielded and DUST addresses. After the tNIGHT arrives, register it for DUST generation (in Lace: "Generate tDUST"), because every transaction, including a deploy, is paid in DUST.

```bash
cd packages/scripts
npm run faucet      # checks WALLET_ADDRESS and prints the Preview faucet link
```

The faucet itself is a web page with a captcha: <https://faucet.preview.midnight.network>

### Deploy

```bash
cd packages/scripts
npm run deploy -- --dry-run     # show what would run
npm run deploy                  # compile, verify output, build, then launch the CLI if it is built
```

`deploy` compiles `htlc.compact`, checks that `contract/`, `keys/` and `zkir/` exist, and builds `contract` and `api`. It then starts the CLI. If `packages/cli` has not been built for the ledger 9 stack, it stops after the build and says so.

### Frontend

```bash
corepack yarn zk-keys                   # copy ZK keys into packages/frontend/public
cd packages/frontend
cp .env.example .env                    # VITE_HTLC_ADDRESS
corepack yarn dev
```

If the address is not set in `.env`, the page lets you paste a contract address to join.

### Testing

```bash
corepack yarn workspace @umbra-otc/contract test            # vitest suite
corepack yarn workspace @umbra-otc/contract test:compile    # compile first, then run the suite
```

---

## 🧰 Tech stack

| Layer | Tech |
| --- | --- |
| Smart contract | Midnight Compact language 0.28 (toolchain 0.36) |
| SDK | Midnight.js 5, wallet SDK 2 (`@midnightntwrk/wallet-sdk`) |
| Wallet | Lace (frontend), wallet SDK (scripts and CLI) |
| Frontend | React + TailwindCSS + Vite |
| Chain | Midnight Preview (ledger 9) |

---

## 🚧 Status

- ✅ `htlc.compact` written for Compact 0.28 / toolchain 0.36
- ✅ `@umbra-otc/api` builds against Midnight.js 5
- ⚠️ Not yet run end to end: expect small fixes on the first compile and deploy
- ⏳ `packages/cli`, `generate-key` and `balance` still use the old wallet packages and the retired `testnet-02` endpoints; they need porting to wallet SDK 2
- ⏳ `packages/frontend` has not been checked against Midnight.js 5 yet
- **License**: MIT

---

## ⚠️ Troubleshooting

- **`Cannot find module '@midnight-ntwrk/midnight-js-protocol/v9/compact-js'`**: add `@midnight-ntwrk/midnight-js-protocol@5.0.0` to the workspace that needs it.
- **`compiledContract does not exist in type …`**: an old `@midnight-ntwrk/midnight-js-contracts` is installed. All `midnight-js-*` packages must be `5.0.0`. Check with `corepack yarn why @midnight-ntwrk/midnight-js-contracts`.
- **`NetworkId` is not exported**: `@midnight-ntwrk/midnight-js-network-id` and `setNetworkId()` are removed in Midnight.js 5. Pass `config: { networkId, ttlSeconds }` on the provider set and import `NetworkId` from `@midnight-ntwrk/midnight-js-types`.
- **Faucet says "Request failed" or rejects the address**: use the unshielded address (`mn_addr_preview1…`) from the Midnight tab in Lace, not a shielded, DUST or Cardano address.
- **Yarn version error**: run `corepack enable`, or use `corepack yarn <command>`.
- **Missing ZK keys in the browser**: compile and build first, then run `corepack yarn zk-keys`.
- **Overwriting `.env`**: `generate-key` replaces `WALLET_SEED`. Back up `.env` first, or you lose access to a funded wallet.
- **Vite + WASM top-level await**: add `vite-plugin-wasm` and use ESM imports.
- **Turbo caching**: run `npx turbo clean` if cached builds give stale output.