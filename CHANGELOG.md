# Changelog

## Unreleased

- Correction: `--capture canvas` is about 3x faster than a screenshot per frame, and 2.6-3.6x across four comparisons on two GPUs. The 0.1.0 notes and README said 3-3.6x, which left out the lowest run. The figures, every run and the script are in `bench/capture`.
- The package description and README now open with the clip time: 11-14 seconds for 10 seconds of 1080p video.

## 0.1.1

The README's MCP config was wrong. It said `npx -y komadori-mcp`, but `komadori-mcp` is a command inside the `komadori` package, not a package of its own, so that line returned a 404.

- The MCP server is now a subcommand, `komadori mcp`, so the config is `npx -y komadori mcp`.
- The `komadori-mcp` command still works, as a command inside the `komadori` package. There is no separate `komadori-mcp` package on npm, so `npx -y komadori-mcp` does not work. Use `npx -y komadori mcp`.
- The README is shorter. The detail moved to `docs/golden-frames.md` and `docs/spryte.md`.

## 0.1.0

The first release. Komadori steps a browser scene frame by frame, checks the frames and writes a contact sheet, a report and, if you ask, an mp4. It began as spryte's render tool and works with any page that exposes `window.__frame()`.

- Checks for a broken page, a shader that fails to compile (with the line of your own source, the compiler's message and the line itself), a blank or frozen scene, and content cut off at an edge.
- `--capture canvas` encodes the canvas in the page with WebCodecs: about 3 to 3.6 times faster clips than screenshots, with only the canvas in the picture.
- `komadori-mcp`: `render`, `look` and `diff` as MCP tools, with no MCP dependency.
- Golden frames: `komadori determinism`, `komadori approve` and `--golden`, with limits measured across a Radeon, an RTX and SwiftShader.
- `HIGH_GPU=1`, `CHROME=` and `SOFTWARE_GL=1` for choosing the renderer, and a report line naming the GPU used.

Known limits: tested on Windows with Chrome only; the first run of the CI workflow on Linux is still to come; the Mesa shader-log format is unit-tested but has not been run against a real Mesa driver. See `bench/eval/README.md` for what the agent evaluation did and did not show.
