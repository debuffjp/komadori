// Does the spryte cheat sheet, and komadori's tools, help an agent write a correct scene? Runs each task under
// three arms and records whether the result passes a hidden check, and how many tokens, turns and renders it took.
//
//   node bench/eval/run.mjs --spryte <debuff checkout> [--tasks cut-off-title] [--arms A,B,C] [--runs 3]
//        [--model sonnet] [--budget 2] [--timeout 15] [--agent claude|fake:solve|fake:noop] [--work dir]
//
// Arms: A = cheat sheet + komadori tools, B = cheat sheet, the agent can't render, C = the API reference
// only, the agent can't render. `--agent claude` spends real money (one `claude -p` per run, capped by --budget).
// The fake agents cost nothing: they apply the task's reference fix (solve) or nothing (noop), to test the checks.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findColor, lumaStats, ringLuma } from "../../src/image.mjs";
import { render } from "../../src/render.mjs";
import { parseTranscript } from "./transcript.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const KNOWN = new Set(["spryte", "tasks", "arms", "runs", "model", "budget", "timeout", "agent", "work", "rescore"]);
const unknown = args.find((a) => a.startsWith("--") && !KNOWN.has(a.slice(2)));
if (unknown) {
  console.error(`Unknown option ${unknown}. Nothing was run.`);
  process.exit(2);
}
const spryte = opt("spryte", process.env.SPRYTE_CHECKOUT);
// No default: the default used to be claude, which spends money, and a mistyped command ran 13 agent runs.
const agentKind = opt("agent", opt("rescore", "") ? "none" : "");
const model = opt("model", "sonnet");
const budget = opt("budget", "2");
const timeoutMs = Number(opt("timeout", 15)) * 60_000;
const runs = Number(opt("runs", 3));
const arms = opt("arms", "A,B,C").split(",");
const work = resolve(opt("work", join(tmpdir(), "komadori-eval")));
const taskIds = opt("tasks", readdirSync(join(here, "tasks")).join(",")).split(",");
if (!spryte || !existsSync(join(spryte, "packages/spryte/dist/index.js"))) {
  console.error("--spryte must point at a debuff checkout with packages/spryte built (npm run build -w spryte).");
  process.exit(2);
}
if (!["claude", "fake:solve", "fake:noop", "none"].includes(agentKind)) {
  console.error("--agent is required and must be claude (spends money), fake:solve or fake:noop. Nothing was run.");
  process.exit(2);
}
const win = process.platform === "win32";

const sheet = readFileSync(join(spryte, "packages/spryte/docs/agent-cheatsheet.md"), "utf8");
const ARMS = {
  A: {
    claudeMd: `${sheet}\n\n## Looking at your scene\n\nThe komadori tools (render, look, diff) run the page in Chrome and show you frames. The page exposes window.__frame().\n`,
    mcp: true,
    tools: ["Read", "Edit", "Write", "Glob", "Grep", "mcp__komadori"],
  },
  B: { claudeMd: sheet, mcp: false, tools: ["Read", "Edit", "Write", "Glob", "Grep"] },
  C: {
    claudeMd: "The spryte renderer's API reference is in spryte/api.md.\n",
    apiDoc: true,
    mcp: false,
    tools: ["Read", "Edit", "Write", "Glob", "Grep"],
  },
};

function claude(runDir, prompt, arm) {
  const home = join(work, "claude-home");
  mkdirSync(home, { recursive: true });
  const cred = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".credentials.json");
  if (existsSync(cred)) cpSync(cred, join(home, ".credentials.json"));
  const a = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--strict-mcp-config",
    ...(ARMS[arm].mcp ? ["--mcp-config", ".mcp.json"] : []),
    "--setting-sources",
    "project,local",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    ARMS[arm].tools.join(","),
    "--max-budget-usd",
    budget,
    "--no-session-persistence",
  ];
  return new Promise((done) => {
    const child = spawn("claude", a, { cwd: runDir, env: { ...process.env, CLAUDE_CONFIG_DIR: home }, shell: false, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const timer = setTimeout(() => (win ? spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]) : child.kill("SIGKILL")), timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      done({ status, stdout });
    });
    child.stdin.end(prompt);
  });
}

async function one(taskId, arm, n) {
  const taskDir = join(here, "tasks", taskId);
  const task = await import(pathToFileURL(join(taskDir, "check.mjs")));
  const dir = join(work, `${taskId}-${arm}-${n}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of task.files) cpSync(join(taskDir, f), join(dir, f), { recursive: true });
  cpSync(join(spryte, "packages/spryte/dist"), join(dir, "spryte"), { recursive: true });
  if (ARMS[arm].apiDoc) cpSync(join(spryte, "packages/spryte/docs/api.md"), join(dir, "spryte/api.md"));
  writeFileSync(join(dir, "CLAUDE.md"), ARMS[arm].claudeMd);
  if (ARMS[arm].mcp)
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { komadori: { command: "node", args: [join(root, "bin/komadori-mcp.mjs")] } } }));
  const prompt = readFileSync(join(taskDir, "prompt.md"), "utf8");
  const started = Date.now();
  let seen = { turns: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: {} };
  let status = 0;
  if (agentKind === "fake:solve") spawnSync(process.execPath, [join(taskDir, "solution.js"), join(dir, "scene.js")]);
  else if (agentKind === "claude") {
    const r = await claude(dir, prompt, arm);
    writeFileSync(join(dir, ".eval-transcript.jsonl"), r.stdout);
    seen = parseTranscript(r.stdout);
    status = r.status;
  }
  const verdict = await task.default({ dir, render, findColor, lumaStats, ringLuma });
  const t = seen.tools;
  return {
    task: taskId,
    arm,
    run: n,
    pass: verdict.pass,
    detail: verdict.detail,
    score: verdict.score,
    turns: seen.turns,
    cost: Number(seen.cost.toFixed(4)),
    tokens: seen.tokens,
    renders: t.mcp__komadori__render ?? 0,
    looks: t.mcp__komadori__look ?? 0,
    diffs: t.mcp__komadori__diff ?? 0,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    status,
  };
}

/** Score the scenes an earlier run left in a work folder again. Runs no agent and costs nothing. */
async function rescore(folder) {
  for (const name of readdirSync(folder).sort()) {
    const m = /^(.+)-([ABC])-(\d+)$/.exec(name);
    if (!m || !existsSync(join(here, "tasks", m[1], "check.mjs"))) continue;
    const task = await import(pathToFileURL(join(here, "tasks", m[1], "check.mjs")));
    const v = await task.default({ dir: join(folder, name), render, findColor, lumaStats, ringLuma });
    console.log(`${name}: ${v.pass ? "PASS" : "FAIL"}${v.score === undefined ? "" : ` score ${v.score}`}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href && opt("rescore", "")) {
  await rescore(resolve(opt("rescore", "")));
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(work, { recursive: true });
  const results = [];
  for (const t of taskIds)
    for (const arm of arms)
      for (let n = 1; n <= runs; n++) {
        const r = await one(t, arm, n);
        results.push(r);
        console.log(`${t} arm ${arm} run ${n}: ${r.pass ? "PASS" : "FAIL"} (${r.detail}) turns ${r.turns}, $${r.cost}, renders ${r.renders}`);
      }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  console.log("\ntask / arm: passed, median turns, median cost, median renders");
  for (const t of taskIds)
    for (const arm of arms) {
      const rs = results.filter((r) => r.task === t && r.arm === arm);
      console.log(`${t} / ${arm}: ${rs.filter((r) => r.pass).length}/${rs.length}, ${median(rs.map((r) => r.turns))} turns, $${median(rs.map((r) => r.cost))}, ${median(rs.map((r) => r.renders))} renders`);
    }
  // Never overwrite an earlier run's results: two runs of the same tasks on one day used to share a name.
  const stem = `${new Date().toISOString().slice(0, 10)}-${agentKind.replace(":", "-")}-${model}-${taskIds.join("+")}-arms-${arms.join("")}`;
  let file = join(here, "results", `${stem}.json`);
  for (let n = 2; existsSync(file); n++) file = join(here, "results", `${stem}-${n}.json`);
  mkdirSync(join(here, "results"), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ date: new Date().toISOString(), agent: agentKind, model, budget, runs, results }, null, 2)}\n`);
  console.log(`results: ${file}`);
}
