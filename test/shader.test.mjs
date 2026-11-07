// Shader failures: a shader that doesn't compile is reported with the author's line, the compiler's words and the
// line itself, whether the page lets the error throw or swallows it.
// The spryte test needs a debuff checkout with spryte built: SPRYTE_CHECKOUT=<path>.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { describeShaderFailures } from "../src/render.mjs";

const cli = fileURLToPath(new URL("../bin/komadori.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/shader", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "komadori-shader-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function run(target, query) {
  const out = join(scratch, `out-${Math.random().toString(36).slice(2, 8)}`);
  const r = spawnSync(process.execPath, [cli, target, "--query", query, "--frames", "6", "--samples", "3", "--size", "640x360", "--out", out], { encoding: "utf8", timeout: 120_000 });
  const file = join(out, "report.json");
  return { ...r, report: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined };
}

describe("a shader that fails to compile", () => {
  test("a valid shader has no shader errors", () => {
    const r = run(fixture, "bug=none");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.report.shaderErrors, []);
  });

  test("an undeclared name is reported at its line, with the source line", () => {
    const r = run(fixture, "bug=undeclared");
    assert.equal(r.status, 1);
    const f = r.report.failures.join("\n");
    assert.match(f, /shader failed to compile \(fragment\) at line 3: 'wobble' : undeclared identifier/);
    assert.match(f, /return vec4\(uv\.x, wobble \* k, uv\.y, 1\.0\);/);
    assert.equal(r.report.shaderErrors[0].line, 3);
    assert.equal(r.report.shaderErrors[0].stage, "fragment");
    assert.ok(!/custom shader failed to compile:\s*$/m.test(f), "the thrown message's first line alone should not be all there is");
  });

  test("a type mismatch is reported at the line that has it", () => {
    const r = run(fixture, "bug=type");
    assert.equal(r.status, 1);
    assert.match(r.report.failures.join("\n"), /at line 2: .*float k = vec2\(0\.5, 0\.5\);/);
  });

  test("a missing semicolon points at the line before the one the compiler blames", () => {
    const r = run(fixture, "bug=semicolon");
    assert.equal(r.status, 1);
    const f = r.report.failures.join("\n");
    assert.match(f, /at line 3: 'return' : syntax error/);
    assert.match(f, /often on the line before: float k = 0\.5/);
  });

  test("a page that catches the error itself still fails, with the shader first", () => {
    const r = run(fixture, "bug=undeclared&mode=swallow");
    assert.equal(r.status, 1);
    assert.match(r.report.failures[0], /shader failed to compile.*wobble/);
    assert.match(r.report.failures.join("\n"), /single flat colour/);
  });

  test("a spryte scene reports the line of its own source", { skip: process.env.SPRYTE_CHECKOUT && existsSync(join(process.env.SPRYTE_CHECKOUT, "packages/spryte/dist/index.js")) ? false : "set SPRYTE_CHECKOUT" }, () => {
    const dir = join(scratch, "spryte-scene");
    mkdirSync(dir, { recursive: true });
    cpSync(join(process.env.SPRYTE_CHECKOUT, "packages/spryte/dist"), join(dir, "spryte"), { recursive: true });
    writeFileSync(join(dir, "index.html"), '<!doctype html><canvas id="c" width="320" height="180"></canvas><script type="module" src="./scene.js"></script>');
    writeFileSync(
      join(dir, "scene.js"),
      [
        'import { createRenderer } from "./spryte/index.js";',
        'const draw = createRenderer(document.getElementById("c"));',
        "const glow = draw.createShader(`",
        "  vec4 effect(vec4 color, vec2 uv) {",
        "    float d = distance(frameUv(), vec2(0.5, 0.5));",
        "    return vec4(1.0, 0.5, 0.2, 1.0) * brightness;",
        "  }`);",
        "let n = 0;",
        "window.__frame = () => { n++; draw.begin('#000', 320, 180, 1); draw.withShader(glow, () => draw.rect(0, 0, 320, 180, '#fff')); draw.end(); };",
      ].join("\n"),
    );
    const r = run(dir, "x=1");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    // The shader source starts on the template's first line break, so "return ..." is line 4 of the author's source.
    const f = r.report.failures.join("\n");
    assert.match(f, /shader failed to compile \(fragment\) at line 4: 'brightness' : undeclared identifier/);
    assert.match(f, /return vec4\(1\.0, 0\.5, 0\.2, 1\.0\) \* brightness;/);
  });
});

describe("describeShaderFailures", () => {
  test("reads the mesa log format, and uses the raw line when there is no #line", () => {
    const [d] = describeShaderFailures([{ kind: "compile", stage: "fragment", log: "0:3(5): error: `wobble' undeclared", source: "a\nb\nc c\nd" }]);
    assert.equal(d.line, 3);
    assert.equal(d.text, "c c");
    assert.match(d.message, /wobble/);
  });

  test("counts lines from the last #line directive", () => {
    const source = "#version 300 es\nprecision mediump float;\n#line 1\nvec4 effect() {\n  return bad;\n}";
    const [d] = describeShaderFailures([{ kind: "compile", stage: "fragment", log: "ERROR: 0:2: 'bad' : undeclared identifier", source }]);
    assert.equal(d.line, 2);
    assert.equal(d.text, "return bad;");
  });

  test("keeps a link failure, drops repeats, and copes with an odd log", () => {
    const raw = [
      { kind: "link", log: "Vertex shader output not consumed", source: "" },
      { kind: "link", log: "Vertex shader output not consumed", source: "" },
      { kind: "compile", stage: "vertex", log: "something unexpected", source: "x" },
    ];
    const d = describeShaderFailures(raw);
    assert.equal(d.length, 2);
    assert.match(d[0].summary, /failed to link: Vertex shader output not consumed/);
    assert.equal(d[1].line, null);
    assert.deepEqual(describeShaderFailures(undefined), []);
  });
});
