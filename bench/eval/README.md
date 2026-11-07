# Does it help an agent?

komadori and spryte's cheat sheet claim to make an agent better at writing scenes. This measures it: the same task under three arms, with a hidden check that decides whether the result is right.

| Arm | The agent gets | Can render? |
| --- | --- | --- |
| A | the cheat sheet and the komadori tools (render, look, diff) | yes |
| B | the cheat sheet | no |
| C | the spryte API reference, and no cheat sheet | no |

Every arm can read and edit files. B and C can't run anything, so they have to reason from the docs. A can see what it drew. What each run records: whether the hidden check passed, turns, cost, tokens and how many renders, looks and diffs it used.

```bash
node bench/eval/run.mjs --spryte <debuff checkout, spryte built> --agent claude --runs 3
```

`--agent claude` spends real money: one `claude -p` per run, each capped by `--budget` (default $2). `--agent fake:solve` and `fake:noop` cost nothing: they apply the task's reference fix or nothing, and exist to test that the checks tell a fixed scene from a broken one (`npm test` runs them when `SPRYTE_CHECKOUT` is set).

## Tasks

| Task | What the agent is asked | The hidden check |
| --- | --- | --- |
| `cut-off-title` | A title is far too big for the canvas and is cut off at both sides: make it as large as fits, with 24 px each side | Render it, find the title's pixels: both margins at least 24 px and the title at least 85% as wide as the room allows. That is a font size within about 7% of the right one, so a blind guess often misses and a measured one doesn't |

More tasks go in `tasks/<id>/` with `prompt.md`, the start files, `check.mjs` (exporting `files` and a default `check({ dir, render, findColor })`) and `solution.js` (the reference fix, for testing the check).

## Reading the results

`results/<date>-<agent>-<model>.json` has every run. The table the runner prints gives, per task and arm, how many passed and the median turns, cost and renders. With three runs per cell this shows a direction, not a proof: report it as that, with the model and date.
