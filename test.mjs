import WebSocket from "ws";
// wss://rpc.midnight-preview.blockfrost.io/?project_id=nightpreviewqfFw5hxjcfZXx6JnqFxWxAMwy1o530Rg
const ws = new WebSocket(
  "wss://rpc.midnight-preview.blockfrost.io/?project_id=nightpreviewqfFw5hxjcfZXx6JnqFxWxAMwy1o530Rg"
);
ws.on("open", () => {
  console.log("OPEN");
  ws.send(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "system_chain", params: [] }),
  );
});
ws.on("message", (m) => {
  console.log("REPLY", String(m).slice(0, 200));
  ws.close();
});
ws.on("unexpected-response", (_q, r) => {
  let body = "";
  r.on("data", (d) => (body += d));
  r.on("end", () => {
    console.log("HTTP", r.statusCode, r.statusMessage);
    console.log("BODY", body.slice(0, 300));
    process.exit(1);
  });
});
ws.on("close", (c, r) => {
  console.log("CLOSE", c, String(r));
  process.exit(0);
});
ws.on("error", (e) => {
  console.log("ERROR", e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(1);
}, 10000);
