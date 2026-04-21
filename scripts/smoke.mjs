#!/usr/bin/env node
// Minimal smoke test: spawn the MCP server, do initialize → list tools → call a few.
// Usage: FASTPANEL_URL=... FASTPANEL_TOKEN=... node scripts/smoke.mjs

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn("node", ["dist/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});

const rl = createInterface({ input: child.stdout });
const pending = new Map();

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error("non-json line:", line);
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

let idSeq = 0;
function rpc(method, params) {
  const id = ++idSeq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const summarize = (resp, label) => {
  if (resp.error) {
    console.log(`❌ ${label}: ${resp.error.message}`);
    return;
  }
  const first = resp.result?.content?.[0]?.text ?? "";
  const preview = first.length > 400 ? first.slice(0, 400) + "…" : first;
  const isErr = resp.result?.isError ? "⚠ tool error" : "✓";
  console.log(`${isErr} ${label}:\n${preview}\n`);
};

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  console.log("initialize →", JSON.stringify(init.result?.serverInfo));
  notify("notifications/initialized", {});

  const tools = await rpc("tools/list", {});
  console.log(`\ntools/list → ${tools.result?.tools?.length ?? 0} tools:`);
  for (const t of tools.result?.tools ?? []) console.log(`  - ${t.name}`);
  console.log();

  summarize(await rpc("tools/call", { name: "users_list", arguments: {} }), "users_list");
  summarize(await rpc("tools/call", { name: "databases_list", arguments: {} }), "databases_list");
  summarize(await rpc("tools/call", { name: "sites_list", arguments: {} }), "sites_list");
  summarize(await rpc("tools/call", { name: "dns_domains_list", arguments: {} }), "dns_domains_list");
  summarize(await rpc("tools/call", { name: "system_load", arguments: {} }), "system_load");
  summarize(await rpc("tools/call", { name: "queue_list", arguments: {} }), "queue_list");
} finally {
  child.kill("SIGTERM");
}
