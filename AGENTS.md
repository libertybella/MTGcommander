# Agent onboarding — BizzyMTG Commander M6 grind

You are joining a multi-participant effort (humans and AI agents working
simultaneously). This file is the full context you need before touching
anything. Humans: it's written for you too.

## What this project is

A PC-hosted multiplayer Commander (MTG) client with a rules-aware engine.
Real decks import via Scryfall; an oracle-text **compiler**
(`engine/src/oraclePatterns.ts`) turns card text into engine data
(`CardDefinition`). Cards it can't fully compile still play via a manual
table override — so the metric that matters is how few of those there are.

## The active goal (M6)

**≥95% of the EDHREC top-2,000 cards compile fully** (zero compiler
notes). Current: **44.3% (889/2,009)**, from 15.6% two days ago. Progress
happens in **waves**: pick a cluster of cards missing the same mechanic,
implement it end-to-end, prove it with the test tier, commit. The full
loop, commands, and traps: **[CONTRIBUTING.md](CONTRIBUTING.md)** — read
it in full before your first wave; it will save you from the four known
silent-failure layers.

## How parallel work is organized

- The remaining work is partitioned into six machinery streams:
  **[docs/WORKSTREAMS.md](docs/WORKSTREAMS.md)**.
- Who is doing what right now: **[docs/CLAIMS.md](docs/CLAIMS.md)** — the
  claims board. Its protocol is binding: **claim before coding, one
  cluster at a time, first commit wins, release stale claims after 7
  days.**
- Integration branch: `comprehensive-plan`. One wave per short-lived
  feature branch; rebase onto integration; merge when the tier is green
  (CI runs it: `.github/workflows/ci.yml`). Long-lived branches rot —
  every wave appends to the same clause/parser/test files.

## Rules of engagement (conflict avoidance)

1. **Stay inside your claimed cluster.** Do not refactor, reorder, or
   "clean up" shared files beyond what your cluster needs — especially
   `types.ts`, `serialize.ts`, `oraclePatterns.ts`, `createGame.ts`,
   `rulesSprint.test.ts`. Additive edits only: append clauses, append
   parser cases, append union members, append one test block. Additive
   edits from two branches merge trivially; reorganizations poison every
   open branch.
2. **Never weaken an existing test or approximation without a claims-board
   note.** If your mechanic needs to change shared machinery another
   stream depends on (trigger dispatch, the layer engine, mana payment),
   say so in your cluster's Notes row *before* doing it, so overlapping
   claims can coordinate.
3. **The tier is non-negotiable** before any merge: typecheck ×3, oxlint,
   full vitest, and the 200-game fuzz burn (`FUZZ_SEEDS=200` — without the
   env var you ran 8 games, not 200). CI enforces the same.
4. **Compile rate only goes up.** If your wave lowers the measured rate or
   the 60-card sample, something regressed — find it before merging.
5. **Approximations must be silent and documented**: a code comment at the
   site plus an entry in `docs/RULES_COVERAGE.md` (one entry per wave,
   newest first after the previous newest).
6. **Scratch probes** (`tmp*.test.ts`) never get committed — they run in
   the suite and corrupt the test count.
7. **Same-machine parallelism**: use git worktrees, run `npm install` in
   each, and never junction/symlink `node_modules` across them (worktree
   removal once followed the junction and deleted real sources).
8. **Commits**: single imperative sentence + short body with machinery,
   cards, new rate, and test count. AI agents append their co-author
   trailer.

## Where the state lives

| Question | Answer |
| --- | --- |
| What's claimed / done? | `docs/CLAIMS.md` |
| What does each cluster need? | `docs/WORKSTREAMS.md` |
| How do I run/measure anything? | `CONTRIBUTING.md` |
| What does the engine already do? | `docs/RULES_COVERAGE.md` |
| Project architecture | `docs/ARCHITECTURE.md`, `README.md` |
| Checkpoint history | README table + git tags (`checkpoint-NN-*`) |

Milestone cadence: every ~5 waves the integration branch gets a
checkpoint tag gated by an 800-game burn, plus README/tracker refreshes.
Whoever lands the 5th wave since the last tag runs it (see CONTRIBUTING).
