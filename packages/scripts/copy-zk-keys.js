#!/usr/bin/env node
/**
 * Merges the ZK proving keys and circuit IR of all three contracts (otc, pool, htlc)
 * into one folder layout the browser's FetchZkConfigProvider expects:
 *
 *   <target>/keys/<circuit>.{prover,verifier}
 *   <target>/zkir/<circuit>.bzkir
 *
 * Circuit names are unique across the contracts, so one shared folder is safe.
 * Usage: node copy-zk-keys.js [targetDir]    (default: packages/frontend/public)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const managedCandidates = [
  path.join(root, 'packages', 'contracts', 'dist', 'managed'),
  path.join(root, 'packages', 'contracts', 'src', 'managed'),
];
const managed = managedCandidates.find((p) => fs.existsSync(p));
const target = path.resolve(process.argv[2] ?? path.join(root, 'packages', 'frontend', 'public'));

if (!managed) {
  console.error('❌ No compiled contracts found. Run `yarn compact && yarn build` first.');
  process.exit(1);
}

const seen = new Map(); // filename -> contract, to detect collisions
let copied = 0;
for (const contract of fs.readdirSync(managed)) {
  for (const kind of ['keys', 'zkir']) {
    const src = path.join(managed, contract, kind);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(target, kind);
    fs.mkdirSync(dst, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      const key = `${kind}/${file}`;
      if (seen.has(key)) {
        console.error(`❌ Circuit name collision: ${key} exists in ${seen.get(key)} and ${contract}`);
        process.exit(1);
      }
      seen.set(key, contract);
      fs.copyFileSync(path.join(src, file), path.join(dst, file));
      copied++;
    }
  }
}
console.log(`✅ Copied ${copied} files from ${managed} to ${target}`);
