// Manual node RPC tester: mimics what @polkadot/api does on startup.
//
//   cd packages/cli
//   node rpc-manual.mjs [options]
//
// Options (all optional):
//   --url wss://rpc.preview.midnight.network   endpoint (default shown)
//   --mode sequential|pipelined                sequential = one call after another (default)
//                                              pipelined  = all calls sent at once (what polkadot does)
//   --conns N                                  open N connections at the same time (default 1)
//   --no-deflate                               disable permessage-deflate compression
//   --method name                              extra single method to call (repeatable)
//   --timeout 90                               seconds before giving up (default 90)
//
// Examples:
//   node rpc-manual.mjs --mode pipelined
//   node rpc-manual.mjs --mode pipelined --conns 3
//   node rpc-manual.mjs --mode pipelined --conns 3 --no-deflate
//
// Prints: time of every event, reply sizes, and WHO closed the connection
// (us or the server) with the close code and reason.

import WebSocket from "ws";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const multi = (name) =>
  args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));

const URL_ = opt("url", "wss://rpc.preview.midnight.network");
const MODE = opt("mode", "sequential");
const CONNS = Number(opt("conns", "1"));
const TIMEOUT_S = Number(opt("timeout", "90"));
const DEFLATE = !flag("no-deflate");

// The calls polkadot makes during API/INIT, in order.
const calls = [
  ["rpc_methods", []],
  ["state_getRuntimeVersion", []],
  ["system_chain", []],
  ["system_properties", []],
  ["chain_getBlockHash", [0]],
  ["state_getMetadata", []],
  ["state_subscribeRuntimeVersion", []],
  ...multi("method").map((m) => [m, []]),
];

const t0 = Date.now();
const T = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`.padStart(7);

const one = (n) =>
  new Promise((resolve) => {
    const tag = `[conn ${n}]`;
    const log = (...a) => console.log(T(), tag, ...a);
    const ws = new WebSocket(URL_, { perMessageDeflate: DEFLATE });
    const pending = new Map();
    let weClosed = false;
    let next = 0;
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(`${tag} ${result}`);
    };

    const send = (i) => {
      const [method, params] = calls[i];
      pending.set(i + 1, { method, sentAt: Date.now() });
      log("->", method);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: i + 1, method, params }));
    };

    const timer = setTimeout(() => {
      const waiting = [...pending.values()].map((p) => p.method).join(", ");
      log(`TIMEOUT after ${TIMEOUT_S}s, still waiting for: ${waiting}`);
      weClosed = true;
      ws.terminate();
      finish(`TIMEOUT (waiting: ${waiting})`);
    }, TIMEOUT_S * 1000);

    ws.on("open", () => {
      log(`open (deflate=${DEFLATE}, mode=${MODE})`);
      if (MODE === "pipelined") calls.forEach((_, i) => send(i));
      else send(next++);
    });

    ws.on("message", (m) => {
      const s = String(m);
      let msg;
      try {
        msg = JSON.parse(s);
      } catch {
        log("<- non-JSON", s.slice(0, 80));
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        const ms = Date.now() - p.sentAt;
        log(
          "<-",
          p.method.padEnd(30),
          `${s.length} bytes in ${ms}ms`,
          msg.error ? `ERROR ${JSON.stringify(msg.error)}` : "",
        );
      } else {
        log("<- notification/other", s.slice(0, 80));
      }
      if (MODE === "sequential" && msg.id) {
        if (next < calls.length) send(next++);
        else if (pending.size === 0) {
          log("all calls done");
          weClosed = true;
          ws.close(1000);
        }
      } else if (MODE === "pipelined" && pending.size === 0) {
        log("all calls done");
        weClosed = true;
        ws.close(1000);
      }
    });

    ws.on("ping", () => log("server ping"));
    ws.on("pong", () => log("server pong"));
    ws.on("unexpected-response", (_q, r) => {
      log(`HTTP upgrade refused: ${r.statusCode} ${r.statusMessage}`);
      finish(`HTTP ${r.statusCode}`);
    });
    ws.on("error", (e) => log("ERROR", e.message));
    ws.on("close", (code, reason) => {
      const who = weClosed ? "closed by US" : "closed by SERVER/network";
      const waiting = [...pending.values()].map((p) => p.method).join(", ");
      log(`close code=${code} reason="${String(reason)}" (${who})${waiting ? `, unanswered: ${waiting}` : ""}`);
      finish(
        pending.size === 0 && weClosed
          ? "OK"
          : `closed ${code} ${who}${waiting ? ` (unanswered: ${waiting})` : ""}`,
      );
    });
  });

console.log(`url=${URL_} mode=${MODE} conns=${CONNS} deflate=${DEFLATE}`);
const results = await Promise.all(Array.from({ length: CONNS }, (_, n) => one(n + 1)));
console.log("\nRESULTS");
for (const r of results) console.log(" ", r);
console.log("total", T());
process.exit(0);
