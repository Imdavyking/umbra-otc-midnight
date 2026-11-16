#!/usr/bin/env node
// Checks that WALLET_ADDRESS in .env is the kind of address the Midnight faucet accepts,
// then tells you where to request tNIGHT. Needs only Node and dotenv (no wallet SDK).
//
// The faucet is a web page with a captcha, so the request itself has to be made in a browser.
// Most failed faucet requests come from pasting the wrong address type; this catches that first.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const FAUCETS = {
  preview: "https://faucet.preview.midnight.network",
  preprod: "https://faucet.preprod.midnight.network",
};

const network = (process.env.NETWORK_ID ?? "preview").trim().toLowerCase();
const address = (process.env.WALLET_ADDRESS ?? "").trim();

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

console.log("🌙 Midnight faucet helper");
console.log(`🌐 Network: ${network}`);

if (network === "undeployed") {
  fail(
    'The local "undeployed" network has no faucet. Fund your wallet from the genesis wallet ' +
      "of your local network instead.",
  );
}
if (network === "mainnet") {
  fail("Mainnet has no faucet; NIGHT has real value there.");
}
if (!(network in FAUCETS)) {
  fail(`Unknown NETWORK_ID "${network}". Use preview or preprod (in .env).`);
}
if (!address) {
  fail(
    "WALLET_ADDRESS is not set in .env. Add your unshielded address (mn_addr_...).",
  );
}

// The faucet only accepts unshielded addresses for the matching network.
const expectedPrefix = `mn_addr_${network}1`;

if (address.startsWith("mn_shield-addr_")) {
  fail(
    "That is a SHIELDED address. The faucet rejects it. " +
      `Use your unshielded address, which starts with ${expectedPrefix}`,
  );
}
if (address.startsWith("addr_") || address.startsWith("addr1")) {
  fail(
    "That looks like a Cardano address. Use the Midnight tab in Lace, choose Receive, " +
      `and copy the unshielded address (${expectedPrefix}...).`,
  );
}
if (!address.startsWith(expectedPrefix)) {
  fail(
    `Address does not start with ${expectedPrefix}. It must be an unshielded address for ` +
      `${network}. Shielded and DUST addresses are rejected by the faucet.`,
  );
}

console.log(`✅ Address looks valid for ${network}`);
console.log(`📍 ${address}\n`);
console.log("Next steps:");
console.log(`  1. Open ${FAUCETS[network]}`);
console.log(
  '  2. Paste the address above, complete the captcha, press "Request tokens"',
);
console.log("  3. Wait a couple of minutes for tNIGHT to arrive");
console.log(
  '  4. Register the tNIGHT for DUST generation (Lace: "Generate tDUST"), since',
);
console.log("     every transaction, including deploys, is paid in DUST");
if (network === "preprod") {
  console.log(
    "\n⚠️  Preprod runs ledger 8. A contract compiled with toolchain 0.36 (ledger 9) will not " +
      "deploy there. Use preview.",
  );
}
