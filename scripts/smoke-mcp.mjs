/**
 * Local smoke test for the MCP server.
 * Drives the Streamable HTTP transport handshake and lists tools.
 *
 * Usage: BEARER=... node scripts/smoke-mcp.mjs
 */
import { readFileSync } from "node:fs";

const url = "http://127.0.0.1:8787/mcp";

let bearer = process.env.BEARER;
if (!bearer) {
  const dev = readFileSync(".dev.vars", "utf8");
  const m = dev.match(/MCP_BEARER_TOKEN=(\S+)/);
  if (!m) throw new Error("MCP_BEARER_TOKEN not found in .dev.vars");
  bearer = m[1];
}

async function rpc(body, sessionId) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${bearer}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const sid = res.headers.get("mcp-session-id");
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  let parsed = text;
  if (ct.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    if (dataLine) parsed = JSON.parse(dataLine.slice(6));
  } else if (ct.includes("application/json")) {
    try {
      parsed = JSON.parse(text);
    } catch {}
  }

  return { status: res.status, sessionId: sid, ct, body: parsed };
}

console.log("→ initialize");
const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.1" },
  },
});
console.log("  status:", init.status, "session:", init.sessionId);
console.log("  body:", JSON.stringify(init.body, null, 2).slice(0, 500));

if (!init.sessionId) {
  console.error("\n❌ No session ID returned. Aborting.");
  process.exit(1);
}

console.log("\n→ notifications/initialized");
await rpc(
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  init.sessionId,
);

console.log("\n→ tools/list");
const tools = await rpc(
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  init.sessionId,
);
console.log("  status:", tools.status);
const toolList = tools.body?.result?.tools ?? [];
console.log("  tool count:", toolList.length);
for (const t of toolList) {
  console.log(`   • ${t.name} — ${t.description?.slice(0, 80)}`);
}

console.log("\n→ tools/call list_sites (expected to FAIL with Google OAuth error since SA is fake)");
const call = await rpc(
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_sites", arguments: {} },
  },
  init.sessionId,
);
console.log("  status:", call.status);
const errMsg =
  call.body?.result?.content?.[0]?.text ??
  call.body?.error?.message ??
  JSON.stringify(call.body).slice(0, 300);
console.log("  result:", errMsg.slice(0, 400));
