// The eval harness, tested without spending anything: fake agents stand in for `claude`, so these check that the
// hidden check tells a fixed scene from an unfixed one and that transcripts are read correctly.
// The fake-agent tests need a debuff checkout with spryte built: SPRYTE_CHECKOUT=<path>.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../bench/eval/run.mjs";

const runner = fileURLToPath(new URL("../bench/eval/run.mjs", import.meta.url));
const spryte = process.env.SPRYTE_CHECKOUT;
const haveSpryte = spryte && existsSync(join(spryte, "packages/spryte/dist/index.js"));
const scratch = mkdtempSync(join(tmpdir(), "komadori-eval-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function fake(kind, task) {
  return spawnSync(process.execPath, [runner, "--spryte", spryte, "--agent", kind, "--tasks", task, "--arms", "B", "--runs", "1", "--work", join(scratch, `${task}-${kind.replace(":", "-")}`)], {
    encoding: "utf8",
    timeout: 180_000,
  });
}

describe("eval harness", () => {
  test("reads tokens, turns, cost and tool use from a stream-json transcript", () => {
    const lines = [
      { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__komadori__render" }, { type: "text", text: "x" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__komadori__render" }, { type: "tool_use", name: "Edit" }] } },
      { type: "result", num_turns: 4, total_cost_usd: 0.1234, result: "done", usage: { input_tokens: 3, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 700 } },
    ];
    const t = parseTranscript(lines.map((l) => JSON.stringify(l)).join("\n"));
    assert.equal(t.turns, 4);
    assert.equal(t.cost, 0.1234);
    assert.deepEqual(t.tokens, { input: 3, output: 500, cacheRead: 9000, cacheWrite: 700 });
    assert.deepEqual(t.tools, { mcp__komadori__render: 2, Edit: 1 });
    assert.equal(t.final, "done");
  });

  test("ignores lines that aren't JSON and transcripts with no result", () => {
    const t = parseTranscript("not json\n\n{\"type\":\"assistant\",\"message\":{\"content\":[]}}\n");
    assert.equal(t.turns, 0);
    assert.equal(t.cost, 0);
  });

  for (const task of ["cut-off-title", "washed-out-title"]) {
    test(`an agent that changes nothing fails the ${task} check`, { skip: haveSpryte ? false : "set SPRYTE_CHECKOUT" }, () => {
      const r = fake("fake:noop", task);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`${task} arm B run 1: FAIL`));
      const results = JSON.parse(readFileSync(/results: (.*)/.exec(r.stdout)[1], "utf8"));
      assert.equal(results.results[0].pass, false);
    });

    test(`the reference fix passes the ${task} check`, { skip: haveSpryte ? false : "set SPRYTE_CHECKOUT" }, () => {
      const r = fake("fake:solve", task);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`${task} arm B run 1: PASS`));
    });
  }

  test("refuses to run without a spryte checkout", () => {
    const r = spawnSync(process.execPath, [runner, "--spryte", join(scratch, "nowhere"), "--agent", "fake:noop"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--spryte must point/);
  });
});
