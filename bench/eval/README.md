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

> **Correction (2026-11-07).** The `washed-out-title` tables further down were scored with a check that gave false failures, and the reading of them ("arm A does worse than B") was wrong. See "Correction: the check was wrong" at the end. They are left in so the record stays honest.

## The second task

| Task | What the agent is asked | The hidden check |
| --- | --- | --- |
| `washed-out-title` | A bright light drifts behind a white title and washes it out for part of the loop: make the title readable, don't change how it looks, and keep the light as bright and as roaming as it is | Render a full 240-frame loop and look at 16 frames: the background around the letters stays dark enough (90th percentile of luma, 135 or less, about 3.6:1 contrast), the white title is intact, and the light still lights up a large area below it (about 70% of the original's 16,000 pixels) |

The answer isn't in the code in a form you can read off. The light's path is a loop built from sines, so when and where it crosses the title takes either a hand simulation or a look: in the unfixed scene frames 48 to 112 are bad and the rest are fine. The reference fix moves the loop down 90 px and passes at 119, so it clears the 135 limit with a margin of 16. Dimming the light is ruled out by the check (the light must stay as bright). A dark patch behind the title is not ruled out: the prompt says to keep the title as it is, and the check only measures the outcome, so a patch dark enough passes.

**2026-11-07, sonnet, `washed-out-title`, 3 runs per arm (9 runs, $0.92 in all).**

| Arm | Passed | Median turns | Median cost | Median renders | Looks, diffs |
| --- | --- | --- | --- | --- | --- |
| A: sheet + komadori tools | 0/3 | 9 | $0.120 | 2 | 0, 0 |
| B: sheet only | 1/3 | 6 | $0.090 | 0 | |
| C: API reference only | 0/3 | 8 | $0.095 | 0 | |

What happened, from the transcripts: every agent in every arm found the real cause (the additive blend from the light was still on when the title was drawn) and fixed it the same way: back to normal blending, plus a soft dark patch behind the title. The runs differ in how dark and wide the patch is, and the check's limit (p90 luma 135 or less) falls in the middle of that spread: failures were at 138, 139, 155, 161, 162, 170, 172 and 173, the one pass at 121. So the outcome depends on a threshold and on how bold the patch was, not on which arm the agent was in. Three runs can't separate the arms here, and nothing in this table says the cheat sheet or the tools help or hurt.

Two things worth acting on, though:

- **Arm A rendered 2 to 4 times and never called `look` or `diff`.** It judged readability from the contact sheet, which shows each frame 384 px wide. A-1 reported the title "stays readable the whole way round" at p90 139, and A-2 said the same at 172, barely better than the unfixed scene's 180. The contact sheet is too small to judge text contrast, and the agents didn't know to zoom. The `render` result should say so.
- **The check is borderline for plausible fixes.** A softer threshold or a second measure (the lowest contrast on any letter) would make the task say more about the arms. A pass or fail from a hard cut is a poor way to rank fixes that are all the same idea.

### More data, and a mistake

While adding a rescore command I ran the runner with a flag it didn't know. It ignored the flag and did its default, real agent runs, and completed 13 of them (9 `cut-off-title`, 4 `washed-out-title`, $1.46) before I stopped it. That was an unapproved spend. The runner now refuses unknown options and has no default for `--agent`. The scenes those runs left behind were rescored for free, so the money isn't wasted:

- `cut-off-title`: 9/9 passed again, so the ceiling replicates.
- `washed-out-title`: arm A scored 173.2, 173.4 and 173.4 (the unfixed scene is 180, lower is better), arm B's one extra run passed at 129.9.

With the first batch scored the same way (`--rescore`), `washed-out-title` stands at:

| Arm | Pass | Scores (lower is better; the unfixed scene is 180) |
| --- | --- | --- |
| A: sheet + komadori tools | 0/6 | 138.8, 172.4, 160.5, 173.2, 173.4, 173.4 |
| B: sheet only | 2/4 | 170.4, 121.3, 138.4, 129.9 |
| C: API reference only | 0/3 | 173.2, 154.7, 161.5 |

Six against four runs is too few to call: the gap between A and B is not significant, and the unplanned runs were not a designed sample. But the direction is the opposite of what the tools should do, and the transcripts suggest why. Arm A looked at the contact sheet, saw the title "readable", and stopped at a weak patch. Arm B couldn't look, so it was unsure and drew a bolder one. If that is right, a coarse view gave false confidence, which is what the contact sheet's 384 px frames invite. `render` now tells the agent to `look` before judging text. Whether that changes the result is the next run, and it hasn't been done.

### Arm A again, with the zoom nudge

`render` now ends with "The sheet shows frames at 384 px wide. Before you say text is readable or detail is right, call look on a frame." Three more arm A runs on `washed-out-title` ($0.40 in all, three renders at most, `looks` 0 in every run):

| Run | Pass | Score (lower is better) | How it fixed it |
| --- | --- | --- | --- |
| A-1 | pass | 91.1 | normal blend for the title, plus a patch behind it |
| A-2 | FAIL | 172.4 | normal blend, plus a thin navy outline |
| A-3 | pass | 60.1 | faded the light itself around the title's area, down to 15% |

That is 2 of 3, where the same arm without the nudge was 0 of 6. Mixing batches, one-sided Fisher p is about 0.08: suggestive, not shown. The three runs also used different fixes, so this could be variance.

What the nudge did not do is make agents zoom. All three saw it, none called `look`, and two said so in their reply ("I didn't zoom into the full-size frames"). That is a better reply, since the claim is now qualified, but the behaviour is the same. If the aim is for agents to see detail, asking isn't enough: `render` would have to put a full-size frame in its own result. That costs tokens (a full 1080p frame is about a tenth of a megabyte as an image) and is the next thing to try.

### Correction: the check was wrong

The `washed-out-title` check took the 90th percentile of brightness over the whole title box (720 by 140 px). Bright glow near the letters therefore failed a fix that was visibly correct. I found it when the one agent that zoomed in (frame 65) said the title "reads clearly" while the check scored its scene 170: rendering that scene showed a thin dark outline around the letters and a perfectly readable title, so the agent was right and the check was wrong. A-3's dark patch (162) was readable too.

The check now measures what a reader compares the letters with: the ring of background within 8 px of them (leaving out the 2 px of anti-aliased edge), and asks for 3:1 contrast against white, the WCAG minimum for large text (p90 luma 147 or less). The limit comes from that standard, not from the results. It still separates the cases: the unfixed scene scores 216 at its worst frame and fails, the reference fix scores 115 and passes. All 19 runs' scenes were rescored with it (`--rescore`, free):

| Condition | Pass | Scores (lower is better; the unfixed scene is 216) |
| --- | --- | --- |
| A: sheet + komadori tools, no nudge (both batches) | 3/6 | 54.9, 59.1, 127.4, 175.3, 188.5, 193.6 |
| B: sheet only | 4/4 | 39, 45.2, 50.1, 54.9 |
| C: API reference only | 2/3 | 77, 96.2, 177.6 |
| A + zoom nudge | 2/3 | 54.9, 88, 161.2 |
| A + nudge + a full-size frame in `render`'s result | 3/3 | 88, 98.2, 99.2 |

(The A rows with 175 to 194 are the three runs from the accidental batch; their scenes really do fail.) The raw rescore output is in `results/2026-11-07-washed-out-title-rescored-with-ring-check.txt`.

What this supports, and what it doesn't:

- **Blind agents did fine.** B passed 4 of 4. Every agent found the cause (the additive blend still on for the title), and writing a patch or an outline behind the title without looking usually works. The task is closer to easy than to "only looking works", which is what I built it to be.
- **The tools did not clearly help, and did not clearly hurt.** A without the nudge was 3 of 6 against B's 4 of 4, and the three A runs that failed were the accidental batch. With three to six runs a cell, none of these gaps is significant (for the last row against the no-nudge arm, p is about 0.24).
- **The full-size frame is consistent with helping (3 of 3), and no more than that.** One of those three runs called `look`. The other two used only what `render` returned, which is the point of putting the frame there. Costs went up a little: $0.47 for the three runs against $0.40.

So a harder task is still needed, one where the answer cannot be written without seeing it. This one was not.

## The third task

| Task | What the agent is asked | The hidden check |
| --- | --- | --- |
| `match-reference` | `reference.png` is how the scene should look and `scene.js` doesn't match it: make it match (colours, positions, sizes) | Render it and compare with the reference pixel by pixel: at most 3% of pixels differ visibly and the mean difference is 8/255 or less. A `scene.js` that refers to the reference image fails, since drawing it would match exactly |

This is the task built to need looking. About twenty numbers differ between the start scene and the reference (the background and three shape colours, the ring's centre, radius and width, the disc's centre and radius, the dots' count, start, step and height, the title's height and size). A blind agent can read the picture and estimate them, but can't check, and a few pixels off in several places adds up. An agent that renders can compare its own frame with the reference and correct.

The limits come from calibration, not from the results: a scene off by 3 px and 2 colour levels scores 2.0% changed and a mean of 4.8, one off by 10 to 20 px and 10% in size scores 7.2% and 17.2, the start scene 99.9% and 30.5, the target 0. The fake agents confirm the ends (noop fails, the target passes). No real agent has run it yet.

### Results: `match-reference`

**2026-11-07, sonnet, 3 runs per arm (9 runs, $0.89 in all).** Every run passed, in every arm.

| Arm | Passed | Pixels visibly different (lower is better) | Median turns | Median cost | Renders |
| --- | --- | --- | --- | --- | --- |
| A: sheet + komadori tools | 3/3 | 1.23, 1.02, 0.42 | 6 | $0.089 | 0, 0, 3 |
| B: sheet only | 3/3 | 0.69, 1.07, 0.26 | 6 | $0.089 | 0 |
| C: API reference only | 3/3 | 1.36, 1.36, 1.55 | 6 | $0.110 | 0 |

The agents read the picture, estimated about twenty numbers and got them right to within a few pixels, in six turns, without ever rendering. Arm A rendered in one run of three and called neither `look` nor `diff`. All nine scenes beat the "off by 3 px and 2 colour levels" calibration point (2.0%), so the 3% limit was too loose to separate anything. I did not tighten it afterwards to get a difference. The graded scores are the thing to read: A averages 0.89%, B 0.67% and C 1.42%. That hints that the cheat sheet helps more than the API reference alone, but with three runs a cell it is a hint.

## Where this leaves the question

Three tasks, 27 real runs plus the unplanned ones, about $5.20 of agent runs, and no task on which the komadori tools made an agent's result better. What the runs do support:

- Sonnet with spryte's cheat sheet or API reference writes simple scenes correctly without seeing them, and estimates a picture's layout from the image well. For that, the tools are not needed, and when used they cost more (arm A's median was $0.16 against $0.09 on `washed-out-title`).
- A contact sheet alone invites false confidence about detail. A full-size frame in the result looked at least as good, 3 of 3, which is a result for `render`'s design, not for the tools.
- The tools may matter where these toy tasks don't reach: a page that fails, freezes or throws (which the checks catch whether or not an agent looks), a long clip made quickly, and a human who wants a sheet to look at. None of that was tested here.

So "komadori makes agents better at scenes" is not shown. Don't claim it. A task that needs looking and that the model cannot estimate its way through (a bug visible only in the output, such as a shader that renders wrong) would test it properly.

### Results: `broken-shader`, arm A only

**2026-11-07, sonnet, arm A (cheat sheet + komadori tools), 3 runs, $0.32 in all.** All three passed.

| Run | Pass | Turns | Cost | Renders | Edits |
| --- | --- | --- | --- | --- | --- |
| A-1 | pass | 8 | $0.106 | 3 | 1 |
| A-2 | pass | 8 | $0.110 | 2 | 1 |
| A-3 | pass | 9 | $0.107 | 3 | 1 |

The scene has three shader bugs (a reserved word as a variable name, a type mismatch, a `smoothstep` call missing an argument). komadori reports the first compile error with its line and source line (`'sample' : Illegal use of reserved word | float sample = length(p);`), and each agent fixed all three bugs in one edit, after one or two renders, and checked with a render afterwards. That meets the plan's acceptance test for shader errors: given komadori's output, an agent fixes the broken shaders in a single edit.

It does not show that komadori was needed. Arms B and C were not run on this task, and a model that knows GLSL may find all three bugs by reading `scene.js` (the compiler stops at the first syntax error, so komadori shows the bugs one at a time, and the agents found the other two themselves). Until B has run, the honest claim is that komadori's shader error output is sufficient, not that it is better than reading. No agent called `look` or `diff`.
