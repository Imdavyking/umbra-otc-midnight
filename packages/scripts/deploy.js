#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load <root>/.env (WALLET_SEED etc.) so the launcher inherits it
try {
  process.loadEnvFile(path.resolve(__dirname, "..", "..", ".env"));
} catch {}

const COMPACT_TOOLCHAIN = "+0.36.1"; // Compact 0.36.x → language 0.28, runtime 0.21 (ledger 9)
const MIN_NODE = [22, 12];

/**
 * HTLC deploy helper for Midnight (ledger 9):
 *  1. checks the environment (Linux/WSL, Node >= 22.12, `compact` installed)
 *  2. compiles packages/contracts/src/htlc.compact with the Compact CLI
 *  3. verifies the compile output, then builds the contracts, api and cli packages
 *  4. runs the CLI launcher (packages/cli/dist/launcher/preview.js) to deploy / join
 *
 * Only the HTLC contract is compiled. otc.compact and pool.compact are ignored.
 */
class MidnightDeployer {
  constructor(
    deployMode = "new",
    { skipCompile = false, address = "", network = "preview" } = {},
  ) {
    this.projectRoot = path.resolve(__dirname, "..", "..");
    this.contractsDir = path.join(this.projectRoot, "packages", "contracts");
    this.cliDir = path.join(this.projectRoot, "packages", "cli");
    this.deployMode = deployMode; // 'new' or 'join'
    this.skipCompile = skipCompile;
    this.address = address; // contract address for 'join'
    this.network = network; // local | preview | preprod | custom
  }

  /** Run a command and return a promise */
  runCommand(command, args, cwd, description, env = {}) {
    return new Promise((resolve, reject) => {
      console.log(`\n🔄 ${description}...`);
      console.log(`📍 Running: ${command} ${args.join(" ")}`);
      console.log(`📁 Working directory: ${cwd}`);

      const child = spawn(command, args, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: { ...process.env, ...env },
      });

      child.on("close", (code) => {
        if (code === 0) {
          console.log(`✅ ${description} completed successfully`);
          resolve();
        } else {
          console.error(`❌ ${description} failed with code ${code}`);
          reject(new Error(`${description} failed`));
        }
      });

      child.on("error", (error) => {
        console.error(`❌ ${description} error:`, error.message);
        reject(error);
      });
    });
  }

  /** Check the environment. Returns a list of problems (empty = OK). */
  checkPrerequisites() {
    console.log("🔍 Checking prerequisites...\n");
    const problems = [];

    // The Compact compiler is a Linux/macOS binary; it does not run in Windows shells.
    if (process.platform === "win32") {
      problems.push(
        "This is a native Windows shell. The Compact compiler only runs on Linux/macOS: open the Ubuntu (WSL) terminal and run this script from there.",
      );
    }

    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
      problems.push(
        `Node.js ${MIN_NODE.join(".")}+ is required (found ${process.versions.node}). Midnight.js 5 packages are ESM-only.`,
      );
    }

    const htlcSource = path.join(this.contractsDir, "src", "htlc.compact");
    if (!fs.existsSync(htlcSource)) {
      problems.push(`Missing ${htlcSource}`);
    } else {
      console.log("✅ Found contract: packages/contracts/src/htlc.compact");
    }

    if (!this.skipCompile && process.platform !== "win32") {
      const r = spawnSync("compact", ["--version"], { encoding: "utf8" });
      if (r.error || r.status !== 0) {
        problems.push(
          "The `compact` CLI was not found on PATH. Install it, then run `compact update 0.36` (see the Midnight docs: Compact developer tools).",
        );
      } else {
        console.log(`✅ compact CLI: ${r.stdout.trim()}`);
      }
    }

    if (this.deployMode === "join") {
      const addr = this.address || process.env.HTLC_ADDRESS;
      if (!addr) {
        problems.push(
          "Join mode needs a contract address: --address=<addr> or HTLC_ADDRESS=<addr>.",
        );
      }
    }

    return problems;
  }

  /** Check the files the build and the ZK config providers need. */
  verifyArtifacts() {
    const out = path.join(this.contractsDir, "src", "managed", "htlc");
    const required = [path.join("contract", "index.js"), "keys", "zkir"];
    const missing = required.filter((p) => !fs.existsSync(path.join(out, p)));
    if (missing.length > 0) {
      throw new Error(
        `Compile output incomplete in ${out}: missing ${missing.join(", ")}. ` +
          "Compile without --skip-zk flags so keys/ and zkir/ are generated.",
      );
    }
    // Midnight.js 5 checks artifacts against compiler/contract-manifest.json by default.
    if (!fs.existsSync(path.join(out, "compiler", "contract-manifest.json"))) {
      console.warn(
        '⚠️  compiler/contract-manifest.json not found. Midnight.js 5 refuses artifacts without it unless the ZK config provider uses verify: "require-if-present".',
      );
    }
    console.log("✅ HTLC compile output looks complete");
  }

  /** Dry run - show what would be executed */
  async dryRun() {
    console.log("🔍 DRY RUN - Commands that would be executed:\n");
    if (!this.skipCompile) {
      console.log(
        `1️⃣ compact compile ${COMPACT_TOOLCHAIN} src/htlc.compact src/managed/htlc`,
      );
      console.log("   📁 Working directory:", this.contractsDir, "\n");
    }
    console.log("2️⃣ corepack yarn workspace @umbra-otc/contract build");
    console.log("3️⃣ corepack yarn workspace @umbra-otc/api build");
    console.log("   corepack yarn workspace @umbra-otc/cli build");
    console.log("   📁 Working directory:", this.projectRoot, "\n");
    console.log(
      `4️⃣ node dist/launcher/preview.js ${this.deployMode}   (MIDNIGHT_NETWORK=${this.network})`,
    );
    console.log("   📁 Working directory:", this.cliDir, "\n");
    console.log("💡 Run without --dry-run to execute these commands");
  }

  /** Main workflow */
  async deploy() {
    try {
      const modeText =
        this.deployMode === "join"
          ? "Joining Existing HTLC"
          : "Deploying New HTLC";
      console.log(`🚀 Starting Midnight ${modeText} on ${this.network}...\n`);

      const problems = this.checkPrerequisites();
      if (problems.length > 0) {
        console.error("\n❌ Cannot continue:");
        for (const p of problems) console.error(`   - ${p}`);
        process.exit(1);
      }
      console.log("✅ All prerequisites met\n");

      console.log("📋 Steps:");
      console.log("   1. 🔨 Compile htlc.compact");
      console.log("   2. 🔎 Verify the compile output");
      console.log("   3. 📦 Build contracts + api + cli packages");
      console.log("   4. 🎯 Launch the CLI (deploy / join)\n");

      // Step 1: compile only the HTLC contract
      if (this.skipCompile) {
        console.log("⏭️  Skipping compile (--skip-compile)");
      } else {
        await this.runCommand(
          "compact",
          [
            "compile",
            COMPACT_TOOLCHAIN,
            "src/htlc.compact",
            "src/managed/htlc",
          ],
          this.contractsDir,
          "Compiling htlc.compact",
        );
      }

      // Step 2: verify the output
      this.verifyArtifacts();

      // Step 3: build only what the HTLC flow needs (no turbo: it would also run the
      // legacy compact tasks for otc/pool)
      await this.runCommand(
        "corepack",
        ["yarn", "workspace", "@umbra-otc/contract", "build"],
        this.projectRoot,
        "Building @umbra-otc/contract",
      );
      await this.runCommand(
        "corepack",
        ["yarn", "workspace", "@umbra-otc/api", "build"],
        this.projectRoot,
        "Building @umbra-otc/api",
      );
      await this.runCommand(
        "corepack",
        ["yarn", "workspace", "@umbra-otc/cli", "build"],
        this.projectRoot,
        "Building @umbra-otc/cli",
      );

      // Step 4: the CLI launcher
      const launcher = path.join(this.cliDir, "dist", "launcher", "preview.js");
      if (!fs.existsSync(launcher)) {
        console.log("\n✅ Contract compiled and packages built.");
        console.log(
          "⚠️  packages/cli/dist/launcher/preview.js was not produced by the build.",
        );
        console.log(
          "   Check that packages/cli/src/launcher/preview.ts exists and that the",
        );
        console.log(
          "   cli tsconfig compiles src/ to dist/ (rootDir: src, outDir: dist).",
        );
        return;
      }

      const env = {
        MIDNIGHT_NETWORK: this.network,
        // The launcher writes its public deploy log here.
        HTLC_LOG_DIR: path.join(this.projectRoot, "deploy"),
      };
      if (this.deployMode === "join") {
        env.HTLC_ADDRESS = this.address || process.env.HTLC_ADDRESS;
      }

      console.log(
        "\nℹ️  The launcher syncs the wallet first. On a public network that can take a long time,",
      );
      console.log(
        "   and a new wallet pauses until you fund it from the faucet it prints.",
      );

      await this.runCommand(
        "node",
        [launcher, this.deployMode],
        this.cliDir,
        `Running HTLC launcher (${this.deployMode})`,
        env,
      );

      console.log(`\n🎉 ${modeText} completed successfully!`);
      console.log(
        `📄 Public log: ${path.join(this.projectRoot, "deploy", `${this.network}-log.jsonl`)}`,
      );
    } catch (error) {
      console.error("\n❌ Deployment failed:", error.message);
      console.error("\n🔧 Troubleshooting:");
      console.error(
        "   - Run this from the Ubuntu (WSL) terminal, not Git Bash/PowerShell",
      );
      console.error(
        "   - `compact --version` works and `compact list --installed` shows 0.36.x",
      );
      console.error(
        "   - Node >= 22.12 is active (`node --version`) and `corepack enable` was run",
      );
      console.error(
        "   - `corepack yarn install` completed in the project root",
      );
      console.error(
        "   - Your wallet has funds AND DUST on the target network",
      );
      console.error(
        "   - WALLET_SEED is set in .env / your shell, or a new seed is created in ~/.umbra-otc/<network>.json\n",
      );
      process.exit(1);
    }
  }

  /** Display help information */
  showHelp() {
    console.log(`
🌙 Midnight HTLC Deployment Tool (ledger 9)

Usage:
  npm run deploy                         Compile, build and deploy a new HTLC
  npm run deploy:new                     Same as above
  npm run deploy:join -- --address=<a>   Attach to an existing HTLC
  npm run deploy -- --skip-compile       Reuse the existing compile output
  npm run deploy -- --network=<name>     local | preview (default) | preprod | custom
  npm run deploy -- --dry-run            Show what would be executed
  npm run deploy -- --help               Show this help message

What this does:
  1. Compiles packages/contracts/src/htlc.compact with the Compact CLI (${COMPACT_TOOLCHAIN})
  2. Verifies the compile output (contract/, keys/, zkir/)
  3. Builds the contracts, api and cli packages
  4. Runs packages/cli/dist/launcher/preview.js to deploy/join

Requirements:
  - Linux, macOS or WSL (the Compact compiler does not run in Windows shells)
  - Node.js ${MIN_NODE.join(".")}+ and \`corepack enable\`
  - The \`compact\` CLI with toolchain 0.36 installed (\`compact update 0.36\`)
  - A proof server reachable at MIDNIGHT_PROOF_SERVER (default http://127.0.0.1:6300)
  - A wallet with funds and DUST on the target network

Environment variables:
  - WALLET_SEED: hex wallet seed (copy .env.example to .env). If unset, a seed is
    created and stored in ~/.umbra-otc/<network>.json
  - HTLC_DEPLOY_ARGS: JSON array of constructor args for a new deploy
  - HTLC_ADDRESS: contract address for join (or use --address=)
  - MIDNIGHT_NETWORK: same as --network
  (COMPACT_HOME is no longer used.)
`);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const flagValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

let deployMode = "new";
if (args.includes("--join")) deployMode = "join";
else if (args.includes("--new")) deployMode = "new";

const deployer = new MidnightDeployer(deployMode, {
  skipCompile: args.includes("--skip-compile"),
  address: flagValue("address") ?? "",
  network: flagValue("network") ?? process.env.MIDNIGHT_NETWORK ?? "preview",
});

if (args.includes("--help") || args.includes("-h")) {
  deployer.showHelp();
  process.exit(0);
}

if (args.includes("--dry-run")) {
  await deployer.dryRun();
  process.exit(0);
}

deployer.deploy().catch(console.error);
