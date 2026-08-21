# Contributing to the M6 compile-rate grind

This documents the working loop that took the top-2,000 compile rate from
15.6% to 44%+, and the traps that repeatedly bit along the way. Read it
before your first wave. The work is organized into six parallel streams —
see [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md); claim a cluster before
starting it.

## The wave loop

One **wave** = one cluster of cards sharing a missing mechanic, implemented
end-to-end and committed. Typical yield: 4–9 newly fully-compiling cards.

1. **Claim a cluster** on [docs/CLAIMS.md](docs/CLAIMS.md) (protocol is in
   that file — claim before coding, one at a time), picking from your
   stream or a regenerated one-away report (below).
2. **Probe real oracle text first.** Never write a regex from memory of a
   card. Create a scratch `server/src/tmpProbe.test.ts` that loads the
   Scryfall bulk file, compiles the named cards via
   `oracleCardFromScryfall` → `compileOracleCard`, and prints
   `compiled.notes` (empty notes = fully compiled). The bulk file lives
   outside the repo (see Measurement below).
   **Warning:** a card's single note joins *all* leftover sentences with
   "; " — a "one-away" card can hide several uncompiled lines. Read the
   full note before committing to a cluster.
3. **Implement**: engine machinery + compiler clauses + serializer parsers
   + tests. See "The four mapper layers" — the most common silent failure.
4. **Delete scratch probes** (`tmp*.test.ts`) — they are real test files
   and will run in the suite, inflating counts, and once got committed by
   accident.
5. **Run the tier** (all must pass before committing):

   ```bash
   npx tsc -p engine --noEmit && npx tsc -p server --noEmit && npx tsc -p client --noEmit
   npx oxlint
   npx vitest run
   ```

   Then the 200-game fuzz burn (PowerShell shown; export the env var on
   other shells):

   ```powershell
   $env:FUZZ_SEEDS="200"; npx vitest run engine/src/fuzz.test.ts engine/src/fuzz.shard2.test.ts engine/src/fuzz.shard3.test.ts engine/src/fuzz.shard4.test.ts engine/src/fuzz.shard5.test.ts engine/src/fuzz.shard6.test.ts engine/src/fuzz.shard7.test.ts engine/src/fuzz.shard8.test.ts
   ```

   Without `FUZZ_SEEDS` the shards run 8 games total, not 200.
6. **Document**: add one entry to `docs/RULES_COVERAGE.md` (newest entry
   goes directly after the previous newest). Every deliberate
   simplification must be *silent in gameplay but documented* — in a code
   comment at the site and in the RULES_COVERAGE entry.
7. **Commit** with a single imperative sentence + a short body (what
   machinery, which cards, the new rate and test count).

## The four mapper layers (fields silently drop here)

A new `CardDefinition` / ability field must be threaded through **all
four**, or it compiles correctly and then silently vanishes:

1. **`engine/src/createGame.ts`** — `createCardDefinition` has an explicit
   `Pick<...>` key list *and* explicit spread lines; `manaAbilities`,
   `activated`, and `triggers` are mapped with explicit per-field spreads.
   Add your field to the list *and* the spread.
2. **`engine/src/serialize.ts`** — hand-written validating parsers for
   every field, both the CardEffect and GameEffect unions, prompts, and
   actions. Allow-lists rot: when you extend a union (trigger events,
   scopes), extend the matching parser Set/chain (`TRIGGER_EVENT_NAMES`
   uses `satisfies TriggerEvent[]` to catch drift — imitate that pattern).
3. **`engine/src/oracle.ts`** — the compiled→definition pass-through list
   in `compileOneFace`.
4. **`client/`** — new prompts and UI modes need Battlefield.tsx handling;
   new prompt kinds also need a bot answer in `server/src/session.ts` and
   a fuzzer answer in `engine/src/fuzzHarness.ts`.

## Measurement

The compile-rate metric runs inside the suite: the 60-card staple sample
(CI floor 85%) always runs. The full top-2,000 sweep needs two local
files and env vars:

```powershell
$env:COMPILE_BULK="<path to Scryfall oracle-cards bulk as .jsonl>"
$env:COMPILE_LIST="<path to edhrec-top2000.json (array of names)>"
npx vitest run server/src/compileRate.test.ts
```

Read the `[compile-rate] list:` line. The one-away report (highest-ROI
wave picker) is a scratch test that compiles the whole list and buckets
cards with exactly one note by the note's first snippet — copy the pattern
from git history (`tmpOneAway` in any recent wave's transcript) and
**delete it before committing**.

## Conventions and traps

- **Approximations**: auto-taken "may"s, auto-picked choices (populate,
  chosen-type), and dropped cosmetic riders are acceptable when silent and
  documented. Never leave a wrong behavior undocumented.
- **Compiler regexes**: oracle text is normalized — the card's own name
  becomes `~` (short legend names like "Sakashima" survive), reminder text
  is stripped, keyword lines are consumed by `isKeywordLine`. Anchor
  clauses with `^...$` and keep them in `compileSimpleClause` (effects) or
  the sentence loop in `compileOracleText` (definition flags, triggers).
  Note `let match` is declared mid-function — new clauses placed earlier
  must use their own const names (TS2448 otherwise).
- **Tests**: wave tests append to `engine/src/rulesSprint.test.ts` as one
  `describe("wave N: ...")` block. Runtime casts need
  `game.turn.phase = "precombatMain"`, `activePlayerId`,
  `priorityPlayerId`, and mana in the pool; tap abilities need
  `summoningSick = false`; bind contexts need `targetRequirements`
  alongside `targets`.
- **Fuzz**: seeds only cover action choices (`Math.random` still shuffles
  decks), so failures are probabilistic — reproduce with a burn, not a
  single seed. "Timeout calling onTaskUpdate" errors with all tests passed
  are vitest RPC noise, not failures (they still exit 1).
- **Counter names**: power/toughness counters are `"p1p1"` / `"m1m1"` on
  `card.counters`. Nothing else affects computed P/T.
- **Never junction `node_modules` into a git worktree** — worktree removal
  follows Windows junctions and npm workspace symlinks and once deleted
  real sources. Run `npm install` per worktree instead.
- **Hand-authored cards** go in `server/src/cardOverrides.ts` as data,
  never code.

## Branch & merge flow

- Integration branch: `comprehensive-plan` (merge to `main` at will —
  every checkpoint tag is a playable table).
- One wave per feature branch; rebase onto integration before merging;
  merge as soon as CI is green. Long-lived branches rot fast here because
  every wave appends to the same clause/parser/test files — conflicts are
  additive (keep both sides), but they compound with age.
- CI must be green: typecheck ×3, oxlint, full vitest (includes the
  sample-rate floor), and the 200-game fuzz burn. The full top-2,000
  measure is a local/nightly step until the bulk download is wired into a
  scheduled job.
