// The MCP server on stdio: one JSON-RPC message per line in, one per line out. Nothing else may be written to stdout,
// or the client can't parse it. Both `komadori mcp` and the older `komadori-mcp` command start it from here.
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createMcp } from "./mcp.mjs";

/** Serve until stdin closes and every request in flight has been answered. */
export async function serve() {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const mcp = createMcp({ version: pkg.version });
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

  return new Promise((resolve) => {
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
        if (closed && !pending) resolve();
      }
    });
    rl.on("close", () => {
      closed = true;
      if (!pending) resolve();
    });
  });
}
