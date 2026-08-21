# Session handoff brief

Operational knowledge for any agent taking over the M6 compile-rate
grind — written at checkpoint-71 as the original flywheel session wound
down. The binding rules live in [../AGENTS.md](../AGENTS.md); the wave
loop lives in [../CONTRIBUTING.md](../CONTRIBUTING.md); who-is-working-
on-what lives in [CLAIMS.md](CLAIMS.md). This file is the tribal
knowledge that isn't obvious from those: exact commands, traps, and
the current state of play. Read all four before writing code.

## State of play (checkpoint-71, 2026-08-21)

- Branch `comprehensive-plan`, tags through `checkpoint-71-gifts`.
- 865 tests green; top-2,000 compile rate **46.9% (943/2,009)**,
  60-card sample 93% (CI floor 85%).
- The goal gate is **M6: ≥95% of the EDHREC top-2,000 fully
  compiling**. Liberty's standing directive: grind waves toward ~50%,
  then stop cleanly.
- **Never push to GitHub without Liberty's explicit yes.** Nothing has
  been pushed; the remote flow (Ross et al.) starts only when she says
  so.

## The wave rhythm

One wave ≈ one claimed cluster ≈ 4–6 card flips. The loop:

1. **Claim** the cluster in [CLAIMS.md](CLAIMS.md) and commit just that
   file (`Claim: <cluster> (<owner>)`) BEFORE writing code.
2. **Probe**: write a scratch `server/src/tmpProbe.test.ts` that
   compiles the candidate cards and prints `result.notes`. Run it from
   the REPO ROOT: `npx vitest run server/src/tmpProbe.test.ts`
   (running from `server/` finds no tests — the vitest config lives at
   the root). A card's single note joins ALL its uncompiled sentences
   with `"; "` — a "one-away" card can hide three missing features.
   **Delete every `tmp*.test.ts` before running the suite or
   committing** — they are `.test.ts` files and WILL run in the suite
   (one got committed once; it inflates counts and breaks the tier).
3. **Verify oracle text** against the real bulk file — never trust
   memory for card text:
   `C:\Users\Ryan\AppData\Local\Temp\oracle-bulk.jsonl` (Scryfall
   bulk), `C:\Users\Ryan\AppData\Local\Temp\edhrec-top2000.json` (the
   measured list).
4. **Implement** across all four mapper layers (see below).
5. **Test**: append a `wave NNN` describe block to
   `engine/src/rulesSprint.test.ts` (compile assertions + runtime
   assertions).
6. **Tier** (all must pass, in this order — it's fast):
   ```powershell
   npx tsc -p engine --noEmit; npx tsc -p server --noEmit; npx tsc -p client --noEmit
   npx oxlint
   npx vitest run
   $env:COMPILE_BULK="C:\Users\Ryan\AppData\Local\Temp\oracle-bulk.jsonl"; $env:COMPILE_LIST="C:\Users\Ryan\AppData\Local\Temp\edhrec-top2000.json"; npx vitest run server/src/compileRate.test.ts
   # read the "[compile-rate] list:" line — the rate only goes UP
   $env:FUZZ_SEEDS="200"; npx vitest run engine/src/fuzz
   ```
   `FUZZ_SEEDS` is the TOTAL game count across the 8 shard files —
   running them bare plays only 8 games and proves nothing.
7. **Document**: add a bullet to
   [RULES_COVERAGE.md](RULES_COVERAGE.md) directly after the newest
   entry. Every deliberate approximation must be named there (and in a
   code comment) — approximations are silent in-game but never
   undocumented.
8. **Commit** (author `Liberty Bella <liberty.j.bella@gmail.com>`,
   trailer `Co-Authored-By: <the model doing the work>`), flipping the
   claims row to `done` with the flip count and new rate in the same
   commit.

Every 5th wave is a **checkpoint**: run an 800-seed burn
(`$env:FUZZ_SEEDS="800"`, background it — takes ~4 min), then tag
`checkpoint-NN-<name>`, update the README factstrip + checkpoint
table, and refresh the plan artifact if you have access to it.

## The four mapper layers (the #1 silent-failure trap)

A new `CardDefinition` field must be threaded through FOUR places or
it silently drops somewhere between the compiler and the game:

1. **`engine/src/createGame.ts`** — the definition intake uses a
   `Pick` list plus EXPLICIT per-field spreads for `triggers`,
   `subjectFilter`, `manaAbilities`, `activated`, `staticAbilities`,
   and `modes`. A new field inside any of those objects must be added
   to the matching mapper by hand. This trap has bitten at least four
   times ("Target cannot be null" at runtime, or a feature that
   works in compile tests but not in games, is the symptom).
2. **`engine/src/serialize.ts`** — validating parsers with allow-list
   sets. New trigger events go in `TRIGGER_EVENT_NAMES`, new target
   kinds in the kind rejection chain, new effect fields in BOTH the
   unbound (`parseCardEffect`) and bound (game-effect) parsers, new
   prompt/action kinds in their parsers. If the serializer doesn't
   know a field, save/reload silently strips it.
3. **`engine/src/oracle.ts`** — the compiled→definition pass-through;
   top-level definition fields need explicit mapping here.
4. **Client/session/fuzz** — any NEW PROMPT kind needs: a UI answer
   path in `client/src/ui/Battlefield.tsx`, a bot answer in
   `server/src/session.ts`, and a fuzz answer in
   `engine/src/fuzzHarness.ts`. (Reusing existing machinery — e.g.
   `SpellMode` pairs for the gift mechanic — avoids all of layer 4;
   prefer that when a mechanic maps onto an existing choice shape.)

Plain `effects`/`targetRequirements` arrays pass through createGame
wholesale — only fields inside the explicitly-mapped objects need
layer 1.

## Engine conventions worth knowing

- Effects come in UNBOUND (definition, selectors) and BOUND (concrete
  ids) unions in `types.ts`; `bindCardEffects` in `effects.ts` maps
  one to the other; `applyEffects` applies bound ones.
- Targeted destroys are `move_card` toZone `"graveyard"` — there is no
  `destroy` effect kind. Library index 0 is the TOP.
- Cards keep the same instance id across zone changes; counters are
  NOT cleared on zone exit (existing convention — don't "fix" it
  mid-wave). `enterOwnerZone` throws if the card is already in a
  player zone — graveyard→battlefield returns use `moveCard`.
- Search prompts open at RESOLUTION, not cast. `sacrificeSelf` mana
  activations resolve immediately (fetch-land path).
- The player's commander lives at `player.commander.commanderIds`.
- SBA reads printed stats for graveyard cards — assert zone, not
  power, when testing kill-sweeps.
- Random choices (`roll_die_treasures`, `discard_random`) use
  `Math.random`; tests swap it out (`const o = Math.random;
  Math.random = () => 0.99; try { … } finally { Math.random = o; }`).
- Auto-picks are the standard approximation for free choices the bot
  can't reason about (chosen creature type = most common controlled;
  "any color" = first commander-identity color else G; gift recipient
  = next opponent). Always document them in RULES_COVERAGE.md.

## Windows/PowerShell pitfalls

- Compound commands mixing here-strings and `Remove-Item` can fail
  with "system path is blocked" — split into separate calls.
- Appending test blocks: write the block to a scratch file, then
  `Add-Content -Path engine\src\rulesSprint.test.ts -Value
  (Get-Content -Raw <scratch>)`. Bash heredocs with apostrophes
  mangle; don't fight them.
- `[IO.File]::Replace` fails ("path is empty") — use `Set-Content` to
  a .tmp then `Move-Item -Force`.
- NEVER junction `node_modules` into a git worktree — cleanup follows
  the junction and deletes real sources.
- Vitest "Timeout calling onTaskUpdate" unhandled errors during
  saturated 800-game burns are runner RPC noise; the tests-passed
  count is the signal (exit 1 with all tests passed = noise).

## Fuzz notes

- Seeds are only semi-deterministic (deck shuffles use `Math.random`);
  failures are probabilistic — reproduce with `FUZZ_DEBUG=1` (dumps
  state at stuck=24) and bigger burns, not by rerunning one seed.
- Each game has a 120s timeout; parallel over-subscription produces
  timeout failures masquerading as integrity failures.

## High-value open clusters (see CLAIMS.md for live status)

Stream-F one-away buckets remain the steadiest ~5 flips/wave (probe
the current top-miss list from the compile measure). Bigger machinery
still open, roughly by value: sagas (Urza's Saga is the #1 miss),
convoke/improvise (cast-payment surgery), Confluences
(choose-with-repeats), Fact or Fiction (opponent-chooses), Academy
Manufactor + Sylvan Library (replacement effects), multikicker,
hideaway trio, Meren experience counters, Tergrid, Victimize-style
resolution-cost sacrifices, Plaguecrafter-style each-player choices,
Second Harvest (per-token copies), phasing, Phyrexian mana payment
(unblocks Noxious Revival's {G/P} and Drivnod), station. Deliberately
deferred: Chrome Mox imprint, Thassa's Oracle, cumulative upkeep,
MDFCs, "Spend this mana only…" restrictions.
