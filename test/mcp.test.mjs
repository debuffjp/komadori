// The MCP server, driven by the official SDK's client over stdio: if that client can use it, it speaks MCP.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const server = fileURLToPath(new URL("../bin/komadori-mcp.mjs", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
let client;

before(async () => {
  client = new Client({ name: "komadori-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], stderr: "pipe" }));
});
after(async () => {
  await client?.close();
});

const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
const textOf = (r) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const images = (r) => r.content.filter((c) => c.type === "image");
const render = (name, extra = {}) => call("render", { target: fixture(name), frames: 30, samples: 6, size: "640x360", ...extra });

describe("komadori-mcp", () => {
  test("announces itself and lists render, look and diff", async () => {
    assert.equal(client.getServerVersion().name, "komadori");
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["diff", "look", "render"]);
    for (const t of tools) assert.equal(t.inputSchema.type, "object");
  });

  test("look and diff say what to do first when there is no render", async () => {
    const l = await call("look");
    assert.equal(l.isError, true);
    assert.match(textOf(l), /call render first/);
    const d = await call("diff");
    assert.equal(d.isError, true);
    assert.match(textOf(d), /two renders/);
  });

  test("render returns the checks and a contact sheet image", async () => {
    const r = await render("variant", { query: "v=a" });
    assert.notEqual(r.isError, true, textOf(r));
    assert.match(textOf(r), /No check failed/);
    assert.match(textOf(r), /GPU renderer: /);
    assert.match(textOf(r), /384 px wide.*call look/s, "the result should tell the agent to zoom before judging detail");
    assert.equal(images(r).length, 1);
    assert.equal(images(r)[0].mimeType, "image/png");
    assert.ok(images(r)[0].data.length > 1000);
  });

  test("a failing scene is reported as a failed check, not a tool error", async () => {
    const r = await render("blank");
    assert.notEqual(r.isError, true);
    assert.match(textOf(r), /A check failed/);
    assert.match(textOf(r), /single flat colour/);
  });

  test("a page that can't render is a tool error that says why", async () => {
    const r = await render("noframe", { wait: 1500 });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /never exposed window\.__frame/);
  });

  test("bad input is a tool error, not a crash", async () => {
    const r = await call("render", { target: fixture("moving"), frames: 0 });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /whole numbers/);
    const u = await client.callTool({ name: "nope", arguments: {} }).then(
      () => "no error",
      (e) => e.message,
    );
    assert.match(u, /Unknown tool/);
  });

  test("look returns a frame, and a zoomed crop is the size asked for", async () => {
    await render("variant", { query: "v=a" });
    const full = await call("look", { frame: 29 });
    assert.match(textOf(full), /Frame 29/);
    assert.match(textOf(full), /shown at 640x360/);
    const crop = await call("look", { frame: 29, x: 420, y: 200, w: 100, h: 100, zoom: 3 });
    assert.match(textOf(crop), /region x=420 y=200 w=100 h=100, shown at 300x300/);
    assert.equal(images(crop).length, 1);
    const near = await call("look", { frame: 14 });
    assert.match(textOf(near), /nearest sampled to 14/);
  });

  test("diff finds where a change landed, and sees no change in a repeat", async () => {
    await render("variant", { query: "v=a" });
    await render("variant", { query: "v=b" });
    const d = await call("diff", { frame: 29 });
    assert.notEqual(d.isError, true, textOf(d));
    assert.match(textOf(d), /pixels changed/);
    const m = textOf(d).match(/changed region x=(\d+) y=(\d+) w=(\d+) h=(\d+)/);
    assert.ok(m, textOf(d));
    const [x, y, w, h] = m.slice(1).map(Number);
    // The block moved from x 420..520 to 460..560 at y 200..300, so the change sits in that area.
    assert.ok(x >= 415 && x <= 425 && y >= 195 && y <= 205 && w >= 135 && w <= 145 && h >= 95 && h <= 105, `box ${x},${y} ${w}x${h}`);
    assert.equal(images(d).length, 1);

    await render("variant", { query: "v=b" });
    const same = await call("diff", { frame: 29 });
    assert.match(textOf(same), /no visible change/);
  });

  test("diff refuses frames of different sizes with a clear message", async () => {
    await render("variant", { query: "v=a", size: "640x360" });
    await render("variant", { query: "v=a", size: "800x450" });
    const d = await call("diff", { frame: 29 });
    assert.equal(d.isError, true);
    assert.match(textOf(d), /different sizes/);
  });
});
