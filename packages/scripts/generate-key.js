#!/usr/bin/env node
// Creates a wallet seed in .env (if none exists) and derives the UNSHIELDED address
// the Midnight faucet needs. Uses only the wallet SDK 2 key-derivation pieces
// (hd, unshielded keystore), not the wallet facade, so it does not sync or connect.
//
// Safety: an existing WALLET_SEED is never replaced. Other lines in .env are kept, and a
// copy of the old file is written to .env.bak before any change.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { HDWallet, Roles } from "@midnightntwrk/wallet-sdk/hd";
import { createKeystore } from "@midnightntwrk/wallet-sdk/unshielded";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", "..", ".env");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Usage: npm run generate-key

  - If .env has no WALLET_SEED, creates a random 32-byte seed and saves it.
  - If .env already has WALLET_SEED, keeps it and only (re)derives WALLET_ADDRESS.
  - Writes WALLET_ADDRESS (unshielded, e.g. mn_addr_preview1...) and NETWORK_ID to .env.
  - NETWORK_ID comes from .env (default: preview).

Then run: npm run faucet
Add .env and .env.bak to .gitignore: they contain your seed.
`);
  process.exit(0);
}

dotenv.config({ path: envPath });
const networkId = (process.env.NETWORK_ID ?? "preview").trim().toLowerCase();

/** Derive the key for one role, skipping to the next index if an index is not valid. */
function deriveRoleKey(account, role, index = 0) {
  if (index > 20)
    throw new Error("Could not derive a key for the requested role");
  const result = account.selectRole(role).deriveKeyAt(index);
  if (result.type === "keyDerived") return Buffer.from(result.key); // copy: survives clear()
  return deriveRoleKey(account, role, index + 1);
}

function unshieldedAddressFromSeed(seedHex, network) {
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("WALLET_SEED must be 64 hex characters (32 bytes)");
  }
  const created = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
  if (!created.hdWallet) {
    throw new Error(
      "HDWallet.fromSeed failed: " +
        JSON.stringify(created, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
    );
  }
  const account = created.hdWallet.selectAccount(0);
  const nightKey = deriveRoleKey(account, Roles.NightExternal);
  created.hdWallet.clear();

  // SDK 2.x: createKeystore takes { kind, secret }, not a bare key.
  const keystore = createKeystore(
    { kind: "schnorr", secret: nightKey },
    network,
  );
  return String(keystore.getBech32Address());
}

/** Set KEY=value lines in .env, keeping every other line. Backs up the old file first. */
function upsertEnv(file, updates) {
  const existed = fs.existsSync(file);
  if (existed) fs.copyFileSync(file, `${file}.bak`);
  const text = existed ? fs.readFileSync(file, "utf8") : "";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
}

try {
  console.log("🌙 Midnight wallet key generator");
  console.log(`🌐 Network: ${networkId}`);

  let seed = (process.env.WALLET_SEED ?? "").trim();
  const updates = { NETWORK_ID: networkId };
  if (seed) {
    console.log("🔐 Using the existing WALLET_SEED from .env (not replaced)");
  } else {
    seed = randomBytes(32).toString("hex");
    updates.WALLET_SEED = seed;
    console.log(
      "🔐 Generated a new seed. It will be saved to .env and not printed here.",
    );
  }

  const address = unshieldedAddressFromSeed(seed, networkId);
  updates.WALLET_ADDRESS = address;

  const expectedPrefix = `mn_addr_${networkId}1`;
  if (!address.startsWith(expectedPrefix)) {
    console.warn(
      `⚠️  Address does not start with ${expectedPrefix}; check NETWORK_ID.`,
    );
  }

  upsertEnv(envPath, updates);

  console.log(`\n📍 Unshielded address (for the faucet):\n   ${address}`);
  console.log("\n💾 Saved to .env (previous version kept as .env.bak).");
  console.log("   Back up WALLET_SEED somewhere safe: it cannot be recovered.");
  console.log("\nNext: npm run faucet");
} catch (error) {
  console.error("\n❌ Key generation failed:", error.stack ?? error.message);
  process.exit(1);
}
