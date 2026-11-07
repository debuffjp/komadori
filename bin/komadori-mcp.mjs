#!/usr/bin/env node
// komadori as an MCP server on stdio: render, look and diff. Add it to a client with
//   npx komadori-mcp
// Nothing but JSON-RPC goes to stdout. Needs Chrome, and ffmpeg only if a render asks for a clip.
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { createMcp } from "../src/mcp.mjs";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const mcp = createMcp({ version: pkg.version });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

let pending = 0;
let closed = false;
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  pending++;
  try {
    const reply = await mcp.handle(msg);
    if (reply) send(reply);
  } catch (e) {
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } });
  } finally {
    pending--;
    if (closed && !pending) process.exit(0);
  }
});
rl.on("close", () => {
  closed = true;
  if (!pending) process.exit(0);
});
