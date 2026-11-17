import { WebSocket } from "ws";
import type { Logger } from "pino";
import type { Config } from "./config.js";

// Network tracing + a preflight check, so every call the CLI makes to the node RPC
// and the indexer shows up in the log (with the project key redacted).

const redact = (u: string) =>
  u.replace(/project_id=[^&\s]*/g, "project_id=***");

const snip = (v: unknown, n = 160): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}...` : s;
};

/**
 * With TRACE_NET=1, logs every WebSocket and fetch this process opens:
 *   [net] ws connect / open / close (with the close code), and http METHOD url -> status.
 * Must run after globalThis.WebSocket has been set to the `ws` class.
 * Note: @polkadot/api may use its own socket, which is not covered here (its own
 * "RPC-CORE ... disconnected" lines still print).
 */
export const installNetTrace = (): void => {
  if (process.env.TRACE_NET !== "1") return;

  const BaseWS: any = (globalThis as any).WebSocket;
  class TracedWebSocket extends BaseWS {
    constructor(address: any, ...rest: any[]) {
      super(address, ...rest);
      const where = redact(String(address));
      console.log(`[net] ws connect ${where}`);
      this.on("open", () => console.log(`[net] ws open    ${where}`));
      this.on("close", (code: number, reason: unknown) =>
        console.log(
          `[net] ws close   ${where} code=${code} reason=${String(reason) || "-"}`,
        ),
      );
      // Show GraphQL-level errors (e.g. "Unknown field ...", rate-limit messages).
      this.on("message", (data: unknown) => {
        const text = String(data);
        if (text.includes('"type":"error"') || text.includes('"errors"')) {
          console.log(
            `[net] ws error-msg ${where} ${redact(text).slice(0, 400)}`,
          );
        }
      });
    }
  }
  (globalThis as any).WebSocket = TracedWebSocket;

  const baseFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = redact(
      typeof input === "string" ? input : (input?.url ?? String(input)),
    );
    const method = init?.method ?? "GET";
    try {
      const res = await baseFetch(input, init);
      console.log(`[net] http ${method} ${url} -> ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || ct.includes("json")) {
        res
          .clone()
          .text()
          .then((t) => {
            if (!res.ok || t.includes('"errors"')) {
              console.log(`[net] http body ${url} ${redact(t).slice(0, 400)}`);
            }
          })
          .catch(() => {});
      }
      return res;
    } catch (e) {
      console.log(
        `[net] http ${method} ${url} -> FAILED ${e instanceof Error ? e.message : e}`,
      );
      throw e;
    }
  }) as typeof fetch;
};

type Outcome = { ok: true; result: unknown } | { ok: false; error: string };

/** One JSON-RPC call on its own connection. For subscriptions, waits for a notification. */
const rpcOnce = (
  url: string,
  method: string,
  waitNotificationMs = 0,
): Promise<Outcome> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url.replace(/^http/, "ws"));
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (o: Outcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      resolve(o);
    };
    timer = setTimeout(
      () => finish({ ok: false, error: "timeout after 10s" }),
      10_000,
    );
    ws.on("open", () =>
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] })),
    );
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return finish({
          ok: false,
          error: `non-JSON reply: ${snip(String(raw))}`,
        });
      }
      if (msg.error) return finish({ ok: false, error: snip(msg.error) });
      if (msg.id === 1) {
        if (waitNotificationMs > 0) {
          setTimeout(
            () =>
              finish({
                ok: true,
                result: `subscribed (${snip(msg.result)}), no notification within ${waitNotificationMs}ms`,
              }),
            waitNotificationMs,
          );
          return;
        }
        return finish({ ok: true, result: msg.result });
      }
      finish({ ok: true, result: `notification ${snip(msg.params?.result)}` });
    });
    ws.on("unexpected-response", (_q, r) =>
      finish({ ok: false, error: `HTTP ${r.statusCode} ${r.statusMessage}` }),
    );
    ws.on("error", (e) => finish({ ok: false, error: e.message }));
    ws.on("close", (code) =>
      finish({ ok: false, error: `closed (${code}) before a reply` }),
    );
  });

const probeIndexerHttp = async (url: string): Promise<string> => {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    return `HTTP ${res.status} ${snip(await res.text())}`;
  } catch (e) {
    return `FAILED ${e instanceof Error ? e.message : e}`;
  }
};

const probeIndexerWs = (url: string): Promise<string> =>
  new Promise((resolve) => {
    const ws = new WebSocket(url, "graphql-transport-ws");
    let timer: NodeJS.Timeout | undefined;
    const done = (s: string) => {
      if (timer) clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      resolve(s);
    };
    timer = setTimeout(() => done("timeout after 10s"), 10_000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "connection_init" })));
    ws.on("message", (m) => done(`reply ${snip(String(m))}`));
    ws.on("unexpected-response", (_q, r) =>
      done(`HTTP ${r.statusCode} ${r.statusMessage}`),
    );
    ws.on("error", (e) => done(`error ${e.message}`));
    ws.on("close", (code) => done(`closed (${code}) before a reply`));
  });

/**
 * Calls the node RPC first (system_chain, then the methods the wallet's polkadot
 * client uses), then probes the indexer HTTP and WebSocket endpoints. Only logs; it
 * never throws, so a failure here shows up in the log instead of stopping the run.
 */
export const preflight = async (
  config: Config,
  logger: Logger,
): Promise<void> => {
  logger.info(`preflight: node RPC     ${redact(config.node)}`);
  const methods: Array<[string, number]> = [
    ["system_chain", 0],
    ["system_properties", 0],
    ["state_getRuntimeVersion", 0],
    ["state_subscribeRuntimeVersion", 3000],
  ];
  for (const [method, wait] of methods) {
    logger.info(`preflight: -> ${method}`);
    const r = await rpcOnce(config.node, method, wait);
    if (r.ok) logger.info(`preflight: <- ${method} OK ${snip(r.result)}`);
    else logger.error(`preflight: <- ${method} FAILED ${r.error}`);
  }

  logger.info(`preflight: indexer HTTP ${redact(config.indexer)}`);
  logger.info(
    `preflight: <- indexer HTTP ${await probeIndexerHttp(config.indexer)}`,
  );

  logger.info(`preflight: indexer WS   ${redact(config.indexerWS)}`);
  logger.info(
    `preflight: <- indexer WS ${await probeIndexerWs(config.indexerWS)}`,
  );
};
