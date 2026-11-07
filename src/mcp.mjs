// A small MCP server over stdio: newline-delimited JSON-RPC 2.0 with the three calls a tools-only server needs
// (initialize, tools/list, tools/call) plus ping. Hand-written so komadori keeps zero MCP dependencies; the tests
// run it against the official SDK client to prove it speaks the protocol.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, crop } from "./image.mjs";
import { render, UsageError } from "./render.mjs";

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "render",
    description:
      "Step a page frame by frame in Chrome (it must expose window.__frame()), check the frames, and return the checks and a contact sheet of sampled frames. Keep frames modest (120 default): a long render can outlast the client's timeout.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "A built folder (with index.html) or an http(s) URL" },
        query: { type: "string", description: 'Appended to the URL, e.g. "capture=1" for a page with a stepped mode' },
        frames: { type: "integer", minimum: 1, description: "Frames to step (default 120)" },
        samples: { type: "integer", minimum: 1, description: "Frames kept for the checks, the sheet and look (default 20)" },
        size: { type: "string", description: "Viewport WxH (default 1280x720)" },
        wait: { type: "integer", minimum: 1, description: "Milliseconds to wait for window.__frame to appear (default 30000)" },
        mp4: { type: "string", description: "Also write a clip to this path" },
        capture: { type: "string", enum: ["screenshot", "canvas"], description: "How the clip is made: canvas is much faster but holds only the canvas" },
      },
      required: ["target"],
    },
  },
  {
    name: "look",
    description:
      "One sampled frame of the last render at full size, optionally cut to a region and zoomed. Region is in the frame's own pixels. Use it after render to check detail the contact sheet loses: text, stripes, edges.",
    inputSchema: {
      type: "object",
      properties: {
        frame: { type: "integer", description: "A frame number; the nearest sampled frame is used (default: the last)" },
        x: { type: "integer" },
        y: { type: "integer" },
        w: { type: "integer" },
        h: { type: "integer" },
        zoom: { type: "number", description: "Scale factor (default 1, capped so the image is at most 1800 px)" },
      },
    },
  },
  {
    name: "diff",
    description:
      "Compare a sampled frame of the last render with the same frame of the render before it (same size and frame list), to see what a change did. Returns how much changed, where, and an image of before, after and the difference.",
    inputSchema: { type: "object", properties: { frame: { type: "integer", description: "A frame number; the nearest sampled frame is used (default: the last)" } } },
  },
];

const text = (t) => ({ type: "text", text: t });
const image = (png) => ({ type: "image", data: png, mimeType: "image/png" });
const nearest = (shots, wanted) => (wanted === undefined ? shots[shots.length - 1] : shots.reduce((m, s) => (Math.abs(s.i - wanted) < Math.abs(m.i - wanted) ? s : m)));

/**
 * @param {{ version: string }} info
 * @returns {{ handle: (message: object) => Promise<object | null> }}
 */
export function createMcp({ version }) {
  /** The last two renders: look uses the newest, diff compares the two. */
  const renders = [];
  let busy = false;

  async function renderTool(a) {
    if (busy) return { isError: true, content: [text("A render is already running. Wait for it to finish.")] };
    busy = true;
    const lines = [];
    try {
      const out = await mkdtemp(join(tmpdir(), "komadori-mcp-"));
      const result = await render(
        { target: a.target, query: a.query, frames: a.frames, samples: a.samples, size: a.size, wait: a.wait, mp4: a.mp4, capture: a.capture, out },
        { log: (l) => lines.push(l), error: (l) => lines.push(l) },
      );
      if (result.report && result.shots) {
        renders.unshift({ report: result.report, shots: result.shots });
        renders.length = Math.min(renders.length, 2);
      }
      const head = result.code === 2 ? "The render could not run." : result.code === 1 ? "A check failed." : "No check failed.";
      const content = [text(`${head}\n${lines.join("\n")}`)];
      if (result.sheet) content.push(image(result.sheet));
      return { isError: result.code === 2, content };
    } catch (e) {
      return { isError: true, content: [text(e instanceof UsageError ? e.message : `render failed: ${e.message}`)] };
    } finally {
      busy = false;
    }
  }

  async function lookTool(a) {
    const last = renders[0];
    if (!last?.shots.length) return { isError: true, content: [text("No render yet: call render first.")] };
    const shot = nearest(last.shots, a.frame);
    const hasRegion = [a.x, a.y, a.w, a.h].some((v) => v !== undefined);
    const got = await crop(shot.png, hasRegion ? { x: a.x, y: a.y, w: a.w, h: a.h } : undefined, a.zoom);
    const sampled = last.shots.map((s) => s.i).join(", ");
    return {
      content: [
        text(`Frame ${shot.i}${a.frame !== undefined && a.frame !== shot.i ? ` (nearest sampled to ${a.frame})` : ""}, region x=${got.region.x} y=${got.region.y} w=${got.region.w} h=${got.region.h}, shown at ${got.width}x${got.height}. Sampled frames: ${sampled}.`),
        image(got.png),
      ],
    };
  }

  async function diffTool(a) {
    if (renders.length < 2) return { isError: true, content: [text("diff needs two renders: change something, then call render again.")] };
    const [now, before] = renders;
    const shot = nearest(now.shots, a.frame);
    const old = before.shots.find((s) => s.i === shot.i);
    if (!old) return { isError: true, content: [text(`The earlier render has no frame ${shot.i}. Render with the same frames and samples to compare. Its sampled frames: ${before.shots.map((s) => s.i).join(", ")}.`)] };
    try {
      const d = await compare(old.png, shot.png);
      const where = d.box ? `changed region x=${d.box.x} y=${d.box.y} w=${d.box.w} h=${d.box.h}` : "no pixel changed by more than a small threshold";
      return {
        content: [
          text(`Frame ${shot.i}: ${d.same ? "no visible change" : `${(d.changed * 100).toFixed(2)}% of pixels changed`}, mean difference ${d.mean.toFixed(2)}/255, ${where}. Image: before, after, difference.`),
          image(d.png),
        ],
      };
    } catch (e) {
      return { isError: true, content: [text(e.message)] };
    }
  }

  const tools = { render: renderTool, look: lookTool, diff: diffTool };

  return {
    async handle(msg) {
      const isRequest = msg && msg.id !== undefined && msg.method;
      if (!isRequest) return null; // notifications and stray responses get no reply
      const ok = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
      const fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
      switch (msg.method) {
        case "initialize": {
          const asked = msg.params?.protocolVersion;
          return ok({
            protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
            capabilities: { tools: {} },
            serverInfo: { name: "komadori", version },
            instructions:
              "komadori steps a browser scene frame by frame. Call render on a built page that exposes window.__frame(), read the checks and the contact sheet, then look at frames in detail. After a change, call render again and diff.",
          });
        }
        case "ping":
          return ok({});
        case "tools/list":
          return ok({ tools: TOOLS });
        case "tools/call": {
          const run = tools[msg.params?.name];
          if (!run) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
          return ok(await run(msg.params.arguments ?? {}));
        }
        default:
          return fail(-32601, `Method not found: ${msg.method}`);
      }
    },
  };
}
