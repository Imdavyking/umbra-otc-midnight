#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const cliDir = path.join(root, "packages", "cli");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Wallet balance (Midnight Preview)

Usage: npm run balance

Syncs the wallet from WALLET_SEED in the repo-root .env, prints the
unshielded tNIGHT address, tNIGHT balance and DUST balance, then exits.
Nothing is submitted. Requires a built CLI (npm run build in packages/cli).`);
  process.exit(0);
}

if (!fs.existsSync(path.join(root, ".env"))) {
  console.error(
    "❌ .env not found in the repo root (needs WALLET_SEED and PRIVATE_STATE_PASSWORD).",
  );
  process.exit(1);
}
if (!fs.existsSync(path.join(cliDir, "dist", "launcher", "preview.js"))) {
  console.error(
    "❌ CLI not built. Run: corepack yarn workspace @umbra-otc/cli build",
  );
  process.exit(1);
}

console.log("🌙 Syncing wallet on Preview (can take a few minutes)...\n");
const child = spawn("node", ["dist/launcher/preview.js"], {
  cwd: cliDir,
  stdio: "inherit",
  env: { ...process.env, BALANCE_ONLY: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
