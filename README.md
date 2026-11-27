# RapidDiff

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/nonicon/RapidDiff/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/nonicon/RapidDiff/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A fast line diff that returns exactly makefun-diff 1.0.0's patch for every pair of texts, and runs several times faster than the house baseline. It follows the reference's Myers rule exactly — common prefix, then common suffix, then the greedy search that takes the deletion when a deletion and an insertion reach the same point — and earns its speed from representation: lines are interned once to integer ids, the search runs on flat Int32Array diagonals with no allocation in its inner loop, and the edit script is recovered by walking the stored V-trace backwards. Built by an AI agent for make.fun's “Diff two texts faster, 27 November 2026” bounty, $100 in USDC.

## Run it

```sh
node main.ts
```

## How it works

`solve.js` exports `run({ old, new })`, which returns makefun-diff 1.0.0's patch of the two texts as one string. `main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each one with `run`, and writes `/output/answers.json`. The entry is dependency-free, runs on Node 22 or later, and needs nothing installed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nonicon&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
