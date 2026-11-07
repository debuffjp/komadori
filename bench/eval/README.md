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

## Results

**2026-11-07, sonnet, `cut-off-title`, 3 runs per arm (9 runs, $1.06 in all, about 4 minutes).** Every run passed the hidden check, in every arm. So this task does not separate the arms: it hit a ceiling.

| Arm | Passed | Median turns | Median cost | Median renders |
| --- | --- | --- | --- | --- |
| A: sheet + komadori tools | 3/3 | 16 | $0.161 | 4 |
| B: sheet only | 3/3 | 6 | $0.084 | 0 |
| C: API reference only | 3/3 | 6 | $0.104 | 0 |

The agents that couldn't render didn't guess a font size. They called spryte's `draw.measure` to size the title at load time (B found it in the cheat sheet, C in the API reference), so the answer was computable without looking. On this task, then, the komadori tools only added cost: arm A took about 2.7 times the turns of B and about twice the money, with the same result. Three runs per cell show a direction at best, and here the direction is that a task with a computable answer doesn't need to see. It says nothing about tasks where looking is the only way to know. The next tasks have to be ones like that: stripes, overlap, a colour that looks wrong, a draw-order or blend bug that the code doesn't make obvious.

## The second task

| Task | What the agent is asked | The hidden check |
| --- | --- | --- |
| `washed-out-title` | A bright light drifts behind a white title and washes it out for part of the loop: make the title readable, don't change how it looks, and keep the light as bright and as roaming as it is | Render a full 240-frame loop and look at 16 frames: the background around the letters stays dark enough (90th percentile of luma, 135 or less, about 3.6:1 contrast), the white title is intact, and the light still lights up a large area below it (about 70% of the original's 16,000 pixels) |

The answer isn't in the code in a form you can read off. The light's path is a loop built from sines, so when and where it crosses the title takes either a hand simulation or a look: in the unfixed scene frames 48 to 112 are bad and the rest are fine. The reference fix moves the loop down 90 px and passes at 119, so it clears the 135 limit with a margin of 16. Dimming the light or putting a dark plate behind the title is ruled out by the prompt and the check.
