# BizzyMTG Commander Development Progress

This file is the living development tracker for the entire project.

It must be updated as development progresses.

Statuses:

```text
⬜ Not Started
🟡 In Progress
🟢 Complete
🔴 Blocked
⚠️ Needs Review
```

A checkbox becomes 🟢 Complete only when the work has been implemented **and** verified. Writing documentation or generating code is not enough for later implementation phases.

---

## Project Status

**Current Phase:** Comprehensive Plan, Stage 0 complete (Checkpoint 37)
**Current Checkpoint:** Checkpoint 37 — Foundations (branch `comprehensive-plan`)
**Overall Status:** 🟡 In Progress

### Current Objective

Comprehensive Plan Stage 1: Arena-model priority — per-seat stops, full control, auto-yield on `hasMeaningfulAction`, APNAP trigger ordering.

### Last Completed Milestone

Checkpoint 37: structured characteristics on every definition, refreshing oracle cache (v4), `legalActions` enumerator, host-owned shortcut policy, scenario builder, CR 702 coverage checklist, and a state-integrity fuzzer.

### Next Milestone

M2 "Real priority": flash at end step through a stop across two clients; no auto-pass leaks in stops-only mode. Private alpha (M1) can ship from any checkpoint.

---

## Important Project Boundary

```text
BizzyMTG
└── Existing Electron deck builder
    └── SEPARATE PROJECT

BizzyMTG/mtgCommander
└── New multiplayer Commander client
    └── CURRENT PROJECT
```

These projects are independent.

Do not modify, import, link, or share code with the sibling deck builder during V1.

---

# Master Progress

## Phase 0 — Project Definition

* 🟢 Define V1.
* 🟢 Define V1 non-goals.
* 🟢 Define target user experience.
* 🟢 Evaluate application architecture.
* 🟢 Evaluate web vs desktop architecture.
* 🟢 Evaluate realtime architecture.
* 🟢 Decide initial technology stack.
* 🟢 Checkpoint 0 — Project Architecture Approved.

## Phase 1 — Project Foundation

* 🟢 Initialize repository.
* 🟢 Configure development environment.
* 🟢 Configure TypeScript.
* 🟢 Configure linting.
* 🟢 Configure testing.
* 🟢 Create initial application.
* 🟢 Create development scripts.
* 🟢 Checkpoint 1 — Project Baseline.

## Phase 2 — Core Game-State Model

* 🟢 GameState.
* 🟢 PlayerState.
* 🟢 CardDefinition.
* 🟢 CardInstance.
* 🟢 Zone model.
* 🟢 Turn model.
* 🟢 ManaPool.
* 🟢 Stack.
* 🟢 CommanderState.
* 🟢 GameAction.
* 🟢 GameEvent.
* 🟢 Serialization tests.
* 🟢 Checkpoint 2 — Game State Exists Without UI.

## Phase 3 — Zone Engine

* 🟢 Library.
* 🟢 Hand.
* 🟢 Battlefield.
* 🟢 Graveyard.
* 🟢 Exile.
* 🟢 Command Zone.
* 🟢 Stack.
* 🟢 Zone movement.
* 🟢 Card identity/integrity tests.
* 🟢 Checkpoint 3 — Zone Integrity.

## Phase 4 — Turn Engine

* 🟢 Turn order.
* 🟢 Untap.
* 🟢 Upkeep.
* 🟢 Draw.
* 🟢 Main phases.
* 🟢 Combat phases.
* 🟢 End step.
* 🟢 Cleanup.
* 🟢 Automated multi-turn simulation.
* 🟢 Checkpoint 4 — Turn Structure.

## Phase 5 — Priority & Stack

* 🟢 Priority.
* 🟢 Pass priority.
* 🟢 Stack objects.
* 🟢 Spell casting.
* 🟢 Resolution.
* 🟢 Responses.
* 🟢 Counterspell test.
* 🟢 Checkpoint 5 — Stack.

## Phase 6 — Mana

* 🟢 Mana pool.
* 🟢 Colored mana.
* 🟢 Generic mana.
* 🟢 Tap/untap.
* 🟢 Mana production.
* 🟢 Mana costs.
* 🟢 Illegal payment rejection.
* 🟢 Checkpoint 6 — Mana.

## Phase 7 — Game Actions / Basic Spell Casting

* 🟢 Pass priority as a game action.
* 🟢 Cast a basic spell from hand.
* 🟢 Mana payment on cast.
* 🟢 Stack object creation.
* 🟢 Spell resolution by card type.
* 🟢 Illegal-action rejection without mutating GameState.
* 🟢 Action serialization.
* 🟢 Checkpoint 7 — Game Actions.

## Phase 8 — Basic Card Effects

* 🟢 Gain life.
* 🟢 Lose life.
* 🟢 Deal damage.
* 🟢 Draw.
* 🟢 Move a card between zones.
* 🟢 Tap / untap.
* 🟢 Add mana.
* 🟢 Basic token.
* 🟢 Checkpoint 8 — Basic Effects.

## Phase 9 — Combat

* 🟢 Attackers.
* 🟢 Blockers.
* 🟢 Combat damage.
* 🟢 Lethal damage.
* 🟢 Creature death.
* 🟢 Player damage.
* 🟢 Multiple attackers/blockers.
* 🟢 Commander combat damage.
* 🟢 Checkpoint 9 — Combat.

## Phase 10 — Commander

* 🟢 40 life.
* 🟢 Commander zone.
* 🟢 Commander tax.
* 🟢 Commander cast tracking.
* 🟢 Commander damage.
* 🟢 21 commander damage loss.
* 🟢 Checkpoint 10 — Commander.

## Phase 11 — Card Definitions & Effect Execution

* 🟢 CardDefinition effects as data.
* 🟢 Multiple instances sharing one definition.
* 🟢 Bind controller-relative effects on resolve.
* 🟢 Instant/sorcery effect execution.
* 🟢 Creature resolves to battlefield.
* 🟢 Synthetic test cards.
* 🟢 Effect serialization (no functions).
* 🟢 Checkpoint 11 — Card Definitions & Effects.

## Phase 12 — Playable Loop

* 🟢 Play a land as a special action (not a spell).
* 🟢 One land play per player per turn.
* 🟢 Draw step draws a card.
* 🟢 0 life causes a player to lose.
* 🟢 Concede.
* 🟢 Skip lost players in turns, priority, and combat.
* 🟢 Player elimination is a leave-the-game transition (owned cards removed; controlled unowned permanents exiled).
* 🟢 0 life, commander-damage loss, and concede share one elimination path.
* 🟢 Synthetic basic land test fixture only (no real-card database).
* 🟢 Checkpoint 12 — Playable Loop.
* 🟢 Checkpoint 12b — Player Elimination.

Battlefield UI was previously listed as Phase 12. It remains later, after targeting and this playable loop.

## Phase 13 — Targeting

* 🟢 Choose targets when a spell is cast and placed on the stack.
* 🟢 Store chosen targets on the stack object.
* 🟢 Check target legality at cast.
* 🟢 Check target legality again on resolve.
* 🟢 Fizzle when no targets remain legal.
* 🟢 Player, creature, and player-or-creature requirements.
* 🟢 Synthetic targeted test cards only.
* 🟢 Checkpoint 13 — Targeting.

Two-client realtime was previously listed as Phase 13. It remains later. Battlefield UI also remains later.

## Phase 14 — Four-Player Engine & Hidden Information

Rooms and WebSockets were previously listed as Phase 14. They remain later. This phase is engine-only: four identities, turns, priority, combat, concession, and hidden information.

* 🟢 Four player identities in GameState.
* 🟢 Public information (battlefield, graveyard, exile, command, stack, life, commander damage).
* 🟢 Hidden information (opponent hands and libraries redact identity).
* 🟢 Four-player turns.
* 🟢 Four-player priority.
* 🟢 Four-player combat (attack different opponents).
* 🟢 Concession among four players.
* 🟢 Checkpoint 14 — Four-Player Engine.

Four-player rooms / four real networked players remain later.

## Phase 15 — Card Ability Architecture

* 🟢 Event log (`GameState.log` zone changes).
* ⬜ Trigger system (Phase 18).
* 🟢 Effect system (mill, discard, sacrifice, counters added to existing effects).
* ⬜ Choice system.
* 🟢 Draw.
* 🟢 Damage.
* 🟢 Life gain/loss.
* 🟢 Zone movement.
* 🟢 Sacrifice.
* 🟢 Discard.
* 🟢 Mill.
* 🟢 Counters.
* 🟢 Tokens.
* ⬜ Search.
* 🟢 Targeting (Phase 13).
* 🟢 Checkpoint 15 — Reusable Card Mechanics.

## Phase 16 — Keywords

* 🟢 Flying.
* 🟢 Reach.
* 🟢 Haste.
* 🟢 Vigilance.
* 🟢 Trample.
* 🟢 Deathtouch.
* 🟢 Lifelink.
* 🟢 First strike.
* 🟢 Double strike.
* 🟢 Menace.
* 🟢 Hexproof.
* 🟢 Indestructible.
* ⬜ Ward.
* 🟢 Flash.
* 🟢 Defender.
* 🟢 Checkpoint 16 — Keyword System.

## Phase 17 — Continuous Effects

* 🟢 Base characteristics.
* 🟢 Counters (`p1p1`).
* 🟢 Static effects (V1 P/T `self` and `controlled_creatures`).
* ⬜ Temporary modifiers.
* 🟢 Derived characteristics.
* 🟢 Checkpoint 17 — Derived State.

## Phase 18 — Triggered Abilities

* 🟢 Event detection (zone change onto battlefield).
* 🟢 Trigger creation (`enter_battlefield` on definitions).
* 🟢 Stack insertion (kind `ability`).
* ⬜ Choices.
* ⬜ Simultaneous triggers (AP order).
* ⬜ Trigger ordering.
* 🟢 Checkpoint 18 — Trigger System.

## Phase 19 — Replacement Effects

* 🟢 Replacement-effect model (definition `replacements`).
* 🟢 Event modification (skip draw).
* 🟢 Draw replacement.
* ⬜ Damage replacement.
* ⬜ Multiple replacements.
* 🟢 Checkpoint 19 — Replacement Effects.

## Phase 20 — Advanced Rules

* 🟢 Rules coverage document.
* ⬜ Advanced continuous effects.
* ⬜ Layers.
* ⬜ Copy effects.
* 🟢 State-based actions (0 toughness in addition to 0 life and 21 commander damage).
* ⬜ Advanced targeting.
* 🟢 Checkpoint 20 — Rules Coverage.

## Phase 21 — 20-Card Engine

* 🟢 Representative card pool (20 synthetic definitions).
* 🟢 Test deck (`startCatalogGame` / `seatCatalogDecks`).
* 🟢 Complete game (pool actions through a winner).
* 🟢 Unsupported interaction log.
* 🟢 Checkpoint 21 — 20-Card Magic.

Still synthetic only. No Scryfall, Moxfield, or Battlefield UI.

## Phase 22 — Battlefield UI

Arena-like polish (animations, zoom, target highlighting) was previously listed as Phase 22. That polish remains later. This phase is a functional projection of the existing engine.

* 🟢 Start the Phase 21 synthetic test game from the client.
* 🟢 Opponent and player areas (life, battlefield, zone counts, commander).
* 🟢 Hand, mana, turn/step, priority, stack count.
* 🟢 Supported actions via the host (`play land`, `tap_for_mana`, `cast`, `pass`, `concede`, attack/block declarations).
* 🟢 Game-over display.
* ⬜ Card animations.
* ⬜ Card zoom.
* 🟢 Checkpoint 22 — Battlefield UI.

Phase 22 originally called `applyAction` from the client. Phases 23–24 moved authority into `GameHost`. Networking and rooms remain later.

## Phase 23 — Persistence & Reconnect

Rooms/WebSocket reconnect were previously listed as Phase 23. They remain later. This phase is local persist/resume of the in-process host.

* 🟢 Persist game metadata (viewer, seated players, snapshot version).
* 🟢 Persist/recover authoritative GameState (`serializeGameState`).
* 🟢 Restore the seated viewer after reload (local, not a network reconnect).
* 🟢 Restore the player view from the recovered host.
* 🟢 Browser refresh recovery (localStorage).
* 🟢 Checkpoint 23 — Persistence.

## Phase 24 — Security

Networked rooms were previously listed as Phase 24. They remain later. This phase is an in-process `GameHost` that is the only caller of `applyAction`.

* 🟢 Host validation (`submit` as the seated actor only).
* 🟢 Illegal-action rejection without mutating authority.
* 🟢 Life protection (view mutations do not change host life).
* 🟢 Mana protection (view mutations do not change host mana).
* 🟢 Zone protection (authority is cloned per view; illegal actions do not move cards).
* 🟢 Hidden-card protection (`viewFor` uses `redactForViewer`).
* 🟢 Malicious-client tests (spoofed `playerId`, illegal cast, mutated view).
* 🟢 Checkpoint 24 — Security.

Unseated players auto-pass so a local hotseat can advance. That is not a second client.

## Phase 25 — Hidden Information

Engine `redactForViewer` already existed in Phase 14. This phase wires that projection into the UI through the host.

* 🟢 Private hand view (your cards named; opponent hand is Unknown Card).
* 🟢 Hidden library (opponent library identity redacted).
* ⬜ Hidden face-down cards (morph/manifest are not in the engine).
* 🟢 Player-specific game view (`host.viewFor(viewerId)`).
* 🟢 Checkpoint 25 — Information Security.

## Phase 26 — Empty-Library Loss

Card database / Scryfall was previously listed as Phase 26. That is now Checkpoint 30. This phase is the missing draw SBA.

* 🟢 Failed draw from an empty library (`failedToDraw`).
* 🟢 Draw step and `draw` effects share that path.
* 🟢 Skip-draw replacements still do not count as a failed draw.
* 🟢 Mill does not cause library-out loss.
* 🟢 Checkpoint 26 — Empty-Library Loss.

## Phase 27 — Stack Targeting

Rules expansion was previously listed as Phase 27. This phase is targeting spells on the stack.

* 🟢 Target kind `spell`.
* 🟢 Cast-time and resolve-time legality for stack objects.
* 🟢 `counter_spell` effect (Test Counter).
* 🟢 Countered spells go to the graveyard (commanders still return to the command zone).
* 🟢 UI can choose a stack object as a target.
* 🟢 Checkpoint 27 — Stack Targeting.

## Phase 28 — Readable Game Log

Real Commander decks were previously listed as Phase 28. That is now Checkpoint 30. This phase surfaces the existing zone log plus life changes.

* 🟢 Zone-change log (already in the engine).
* 🟢 Life-change log entries.
* 🟢 Battlefield log strip uses the player view (hidden cards stay Unknown Card).
* ⬜ Event IDs / replay / reproduction dumps.
* 🟢 Checkpoint 28 — Game Log.

## Phase 29 — Four-Player Battlefield

Replay/performance were previously later. This phase projects 2–4 players in the UI. Unseated opponents still auto-pass.

* 🟢 Opponent areas for every non-viewer player.
* 🟢 Attack a chosen defender when more than one opponent is alive.
* 🟢 Start 2-player or 4-player synthetic tables.
* 🟢 Checkpoint 29 — Four-Player Battlefield.

## Phase 30 — Card Database & Moxfield Import

Performance was previously listed as Phase 30. That remains later. This phase caches Scryfall oracle data and seats Moxfield or pasted Commander lists.

* 🟢 Scryfall-shaped `OracleCard` compile into `CardDefinition` (keywords, printed P/T, simple `{T}: Add {M}`).
* 🟢 Local oracle cache (`mtgcommander.oracle.v1`) with substring search.
* 🟢 Fetch missing names via Scryfall collection (75/batch) plus named fuzzy leftovers.
* 🟢 Moxfield public URL/ID fetch (Electron IPC; unofficial API).
* 🟢 Pasted Commander / Arena-style text lists.
* 🟢 Seat compiled decks into `GameHost` (`startDefinitionGame` shuffles).
* 🟢 Unsupported oracle text is noted; those cards still sit in the deck.
* 🟢 Synthetic 2-player / 4-player start buttons remain.
* 🟢 Checkpoint 30 — Card Database & Moxfield.

## Phase 31 — 2–4 Player Tables & Local Hotseat

Private Alpha was previously listed as Phase 31. That remains later. This phase seats 2, 3, or 4 players for synthetic and imported tables, and lets one PC play hotseat.

* 🟢 Synthetic start for 2, 3, and 4 players.
* 🟢 Imported tables take 2–4 compiled decks (empty opponent URLs mirror you).
* 🟢 Default names: You / Opponent, or You / Opponent 1–3.
* 🟢 Local hotseat seats every player; `setViewer` switches the shown hand.
* 🟢 Unchecked hotseat still auto-passes unseated opponents (solo practice).
* 🟢 Checkpoint 31 — 2–4 Player Tables & Hotseat.

## Phase 32 — London Mulligan

* 🟢 Draw 7, then keep or mulligan in turn order.
* 🟢 Taking a mulligan shuffles the hand, draws 7, then puts counted cards on the bottom.
* 🟢 3–4 player first mulligan is free (CR 103.5c). 2-player first mulligan counts as 1.
* 🟢 Unseated opponents auto-keep. Other actions are blocked until everyone has kept.
* 🟢 Checkpoint 32 — London Mulligan.

## Phase 33 — WebSockets

Rooms were previously later. This phase is a PC-hosted table friends can join.

* 🟢 `GameServer` listens on port 8787 with a room code.
* 🟢 Join with display name; empty seats are claimed in order and become seated.
* 🟢 Each client receives `viewFor` that player; actions go through `GameHost.submit`.
* 🟢 Electron **Open table for friends**; start screen **Join table**.
* 🟢 Unjoined seats still auto-pass. No accounts.
* 🟢 Checkpoint 33 — WebSockets.

## Phase 34 — Activated Abilities

Private Alpha was previously listed as Phase 34. That remains later. This phase is non-mana activated abilities on the stack.

* 🟢 `activate_ability` game action (priority, controller, battlefield).
* 🟢 Costs: `{T}` and/or a simple mana cost. Creatures with `{T}` respect summoning sickness.
* 🟢 Abilities use the stack (`kind: "ability"`, `activatedIndex`). Mana tapping stays `tap_for_mana`.
* 🟢 Choose-on-activate targeting; fizzle if no legal target remains.
* 🟢 Synthetic Test Oracle (`{T}: Draw a card`).
* 🟢 Oracle compile of a lone `{T}: Draw a card.` line. Other oracle abilities stay notes.
* 🟢 Battlefield click activates; lands still tap for mana first.
* 🟢 Checkpoint 34 — Activated Abilities.

## Phase 35 — Oracle Pattern Compiler

Private Alpha was previously listed as Phase 35. That remains later. This phase compiles known oracle sentences into existing engine effects.

* 🟢 Instant/sorcery patterns: damage to any target / creature, gain/lose life, draw, mill, destroy/exile/bounce creature, counter spell, add mana, simple tokens.
* 🟢 `{T}: Add {M}`, `{T}: Add {G} or {U}`, `{T}: Add one mana of any color` (identity not enforced).
* 🟢 `{cost}, {T}:` activated abilities using those same effect patterns.
* 🟢 `When ~ enters, …` untargeted ETBs.
* 🟢 `Creatures you control get +N/+N`.
* 🟢 Hybrid `{R/W}` pips auto-pay either color. Phyrexian and `{X}` stay unpayable.
* 🟢 Dual lands tap for one chosen color, not both.
* 🟢 Leftover sentences become compile notes.
* 🟢 Checkpoint 35 — Oracle Pattern Compiler.

## Phase 36 — Manual Override

Private Alpha was previously listed as Phase 36. That remains later. This phase is the V1 table-agreement action for unsupported cards.

* 🟢 `manual_override` game action (no priority; blocked during mulligan and after game over).
* 🟢 Adjust life, draw, mill, add one mana, tap/untap, move a public card between owner zones.
* 🟢 Reject hidden opponent hand/library cards; illegal overrides leave GameState unchanged.
* 🟢 Public `override` log entry so the table can see the correction.
* 🟢 Battlefield Override panel for a seated player.
* 🟢 Checkpoint 36 — Manual Override.

## Phase 37 — Private Alpha

* ⬜ Invite testers (friends who can reach the host PC).
* ⬜ Host/join instructions (LAN or Tailscale, port 8787, room code, display name).
* ⬜ Every seat actually joined (unjoined seats still auto-pass).
* ⬜ Import real decks and play complete games.
* ⬜ Use override for uncompiled cards and log what needed it.
* ⬜ Bug tracking (issues or a shared note).
* ⬜ UX feedback (host/join, mulligan, targeting, override).
* ⬜ Desync tracking (if a client view disagrees with the host).
* ⬜ Checkpoint 37 — Private Alpha.

## Phase 38 — Productization

* ⬜ Product identity.
* ⬜ IP/legal review.
* ⬜ Hosting/security review.
* ⬜ Distribution strategy.
* ⬜ Documentation.
* ⬜ Checkpoint 38 — Release Decision.

---

# Development Tracker Rules

Whenever a meaningful task is completed:

1. Update the relevant checkbox.
2. Update the current phase.
3. Update the current checkpoint.
4. Update the overall status.
5. Add a development-log entry.
6. Record tests that were run.
7. Record known limitations.
8. Record the next task.

Do not mark a checkbox complete simply because code was written.

---

# Development Log

## 2026-08-20 — Stages 3–7: events, choices, permanents, coverage, hardening

### Objective

Complete the Comprehensive Plan's engineering stages: the event bus and completed SBAs (3), costs/choices/search/targeting (4), every permanent type (5), the coverage flywheel (6), and table hardening with Arena conveniences (7).

### Work Completed

- **Stage 3**: event bus (enters/dies/attacks/step-begins/gains-life) with watch scopes, subject filters, excludeSelf; completed SBAs (lethal+deathtouch in the sweep, legend rule, token cessation, aura/equipment legality, loyalty-zero); Rest in Peace graveyard→exile replacement; SBA deaths batch-dispatch with CR 603.10a look-back. The 500-game burn caught and fixed a declare-blockers livelock with a populated stack.
- **Stage 4**: search+shuffle with filters and fail-to-find, sacrifice-cost fetches, Spell Pierce unless-pays and ward pay-or-counter pauses (payment may tap producers mid-pause), modal Choose-one spells, announced {X} with divided damage (CR 608.2b), protection from colors threaded through targeting/damage/blocking, Phyrexian mana.
- **Stage 5**: auras (enter attached, fizzle, die loose), Equip compiling to sorcery-speed attach, attached-scope statics, planeswalkers (loyalty counters, once-per-turn abilities, zero-loyalty SBA), token copies, transform, manifest with hidden face-down 2/2s and mid-combat turn-up, first-strike/deathtouch ordering proven.
- **Stage 6**: vendored 60-real-staple fixture + CI compile-rate metric (60%→82% full in one sprint: color anthems, restrictions, nonblack targets, Gilded Lotus amounts, any-of search, Cultivate splits, Beast Within with chosen-controller tokens, gain-life triggers, mass counters, pay-life costs); hand-authored card registry; rulings corpus from real Gatherer rulings (first entry exposed the trigger-batching gap); override telemetry on GameHost; cache v4 refresh + bulk ingest.
- **Stage 7**: seat tokens (claimed seats need their token; auto-assign skips them), spectators with fully-redacted views, engine version handshake, and the Arena auto-tapper (`autoTapPlan`) wired into every client cast/activation.

### Tests Run

- `npm test` — PASS (490 tests), typecheck, lint — PASS at every commit.
- Compile rate: 82% full / 60 staples (floor 80% enforced in CI).
- 500-game fuzz burn-ins gate each checkpoint tag; final burn results recorded below at tagging.

### Decisions Made

- Loyalty combat redirection, sagas, morph casting, CR 616 ordering, and damage-dealt triggers stay documented gaps (see RULES_COVERAGE.md) with Override as the fallback.
- `stops-only` yield is the default because smart yield leaks "no responses".
- Installer packaging (electron-builder) deferred: run-from-source remains the alpha path; tracked for productization.

### Checkpoint

- Tags: `checkpoint-43-coverage-flywheel`, `checkpoint-44-table-hardening` (after the final burn).

### Next Task

Private alpha at will — every checkpoint is a playable table. Remaining engineering: the documented-gaps list, ordered by override telemetry.

## 2026-08-20 — Stages 1 & 2: Arena priority and the CR 613 layer engine

### Objective

Comprehensive Plan Stages 1 and 2: the MTGO/Arena priority model (stops, yield, full control, APNAP), then continuous effects with real layers so characteristics are computed, never stored.

### Work Completed

- APNAP simultaneous-trigger ordering (CR 101.4, 603.3b): `order_triggers` prompt + `resolve_order_triggers` action; unseated seats auto-order; UI offers resolve-first choices.
- `SeatPreferences` on GameHost — per-seat stops (my turn / their turn), `stops-only` vs `smart` yield, full control — replacing the hard-coded empty-stack auto-pass. Seat stops shrink the step-skip policy. WS `preferences` message; clickable phase ladder in the client. Defaults reproduce old behavior; an end-step stop enables flash on an opponent's turn (verified over two real sockets).
- CR 613 layer engine (`characteristicsEngine.ts`): `staticAbilities` ({selector, effect}) replace P/T-only staticModifiers; layers 4 (types), 5 (colors), 6 (grants/remove-all), 7b/7c/7d (P/T + counters) applied by battlefield timestamp. `hasKeyword`, P/T, and `characteristicsOf` read computed values.
- Until-end-of-turn effects: `activeEffects` on GameState with locked affected sets (CR 611.2c), swept at cleanup (CR 514.2). New effects: `pt_until_eot`, `keyword_until_eot`, `team_pt_until_eot`; compiler patterns for Giant Growth-style pumps, targeted keyword grants, team pumps, and tribal keyword-grant statics ("All Slivers have shroud").
- Humility semantics: `remove_all_abilities` silences keywords, statics, triggers, mana abilities, and activated abilities; layer ordering (not arrival order) resolves Humility + anthem.
- Keywords 14 → 20: shroud (targeting), fear, intimidate, horsemanship, shadow, skulk (a shared `blockRestriction` reads computed characteristics, so granted evasion works).

### Tests Run

- `npm test` — PASS (424 tests), typecheck, lint — PASS
- The Sliver test: Crystalline Sliver's printed oracle text compiles and protects future/opponent Slivers until it leaves.
- 500-game fuzz burn-in in progress at commit time; tags applied after it passes.

### Decisions Made

- Characteristics recompute per query (no memoization yet): in-place mutators would stale a per-state cache; Stage 7 owns the optimization with profiling.
- CR 613.8 dependency is not implemented; layer order + timestamps cover the targeted interactions. Noted as a known gap.
- Landwalk and parameterized keywords (protection, ward) wait for the Stage 4 targeting work and a parameterized-keyword schema.

### Files Changed

- Stage 1: `engine/src/triggers.ts`, `prompt.ts`, `types.ts`, `serialize.ts`, `actions.ts`, `server/src/session.ts`, `realtime.ts`, `client/src/ui/PhaseLadder.tsx`, `stopPrefs.ts`, `Battlefield.tsx`, `App.tsx`, tests.
- Stage 2: `engine/src/characteristicsEngine.ts`, `types.ts`, `createGame.ts`, `zones.ts`, `effects.ts`, `turn.ts`, `keywords.ts`, `derived.ts`, `cardTypes.ts`, `combat.ts`, `targeting.ts`, `oraclePatterns.ts`, `serialize.ts`, `pool.ts`, `keywordCatalog.ts`, `layers.test.ts`, `evasion.test.ts`, `oracle.test.ts`.

### Checkpoint

- Tags after burn-in: `checkpoint-38-priority-stops`, `checkpoint-39-layer-engine`.

### Next Task

Stage 3: event bus, generalized triggers, replacement system, complete SBAs.

## 2026-08-20 — Stage 0 foundations (Comprehensive Plan)

### Objective

Lay the groundwork for full Comprehensive Rules machinery per the Comprehensive Plan: structured characteristics, an oracle cache that refreshes, a legal-action enumerator, host-owned shortcut policy, and test infrastructure (scenario builder, CR 702 coverage checklist, state-integrity fuzzer).

### Work Completed

- `CardDefinition.characteristics` — parsed supertypes/types/subtypes/colors/manaValue (CR 205/203). Type predicates, Army lookup, and basic-land checks read structured data instead of matching `typeLine` strings. Scryfall colors flow through import; old snapshots re-derive on parse.
- Oracle cache v4 (`mtgcommander.oracle.v4`, migrating v3 in place): per-card fetch stamps, 30-day staleness refresh with offline fallback to the stale copy, `ingestBulk` for Scryfall bulk downloads with `updated_at` recording.
- `legalActions(state, playerId)` + `hasMeaningfulAction`: advisory enumerator composing the existing validators (casting with timing/tax/targets, land drops, activated abilities, mana taps, combat declarations). Potential mana counts untapped producers with exact bipartite matching, biased to never under-report a payable cost.
- `ShortcutPolicy` is now an explicit `applyAction` option owned by `GameHost`; `advance_step`/`advance_turn` log as table fast-forwards naming discarded stack objects.
- Test infrastructure: `engine/src/scenario.ts` builder, CR 702 keyword catalog + generated `docs/KEYWORD_COVERAGE.md` (guarded by test, `UPDATE_COVERAGE=1` regenerates), and a seeded random-game fuzzer asserting zone integrity and serialize round-trips after every action.

### Tests Run

- `npm test` — PASS (387 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- Extended fuzz burn-in (500 seeded games × up to 400 actions) — PASS

### Decisions Made

- Characteristics are derived at construction/parse, never hand-maintained; explicit colors (back faces, indicators) survive round trips inside stored characteristics.
- `legalActions` is advisory (auto-yield/UI); `applyAction` remains the only legality authority.
- The engine keeps digital shortcuts but only as host-supplied policy; Stage 1 stops shrink the skip set.
- Fuzzer CI scale is 6 seeds × 400 actions; 500-game burn-ins gate milestones.

### Files Changed

- `engine/src/characteristics.ts` (+tests), `engine/src/types.ts`, `engine/src/createGame.ts`, `engine/src/cardTypes.ts`, `engine/src/serialize.ts`, `engine/src/effects.ts`, `engine/src/derived.ts`, `engine/src/visibility.ts`, `engine/src/oracle.ts`, `engine/src/index.ts`
- `engine/src/legalActions.ts` (+tests), `engine/src/turn.ts`, `engine/src/actions.ts`, `engine/src/shortcutPolicy.test.ts`
- `engine/src/scenario.ts`, `engine/src/keywordCatalog.ts` (+test), `engine/src/fuzz.test.ts`, `docs/KEYWORD_COVERAGE.md`
- `server/src/cards.ts`, `server/src/cacheRefresh.test.ts`, `server/src/session.ts`, `server/src/scryfall.ts`, `server/src/index.ts`

### Checkpoint

- PASS (local verification). Tag: `checkpoint-37-foundations` on branch `comprehensive-plan`.
- Existing tags were not moved or rewritten.

### Next Task

Stage 1 of the Comprehensive Plan: per-seat stops, full control, auto-yield, APNAP trigger ordering.

## 2026-08-14 — Manual override

### Objective

Let seated players submit a table-agreed correction through `applyAction` so unsupported cards can still finish a game. Friends see the change. Do not parse remaining English oracle.

### Work Completed

- Tagged checkpoints 34 and 35 on `f1f6262` (`checkpoint-34-activated-abilities`, `checkpoint-35-oracle-compiler`). Existing tags were not moved.
- Added `manual_override` with a small change union: life, draw, mill, add mana, tap/untap, move a public card.
- Override does not need priority (like concede). It is blocked during mulligan and after the game is over.
- Hidden opponent hand/library cards cannot be moved. Stack and `removed` are not valid destinations.
- Public log kind `override`. Battlefield Override panel for a seated player.

### Tests Run

- `npm test` — PASS (239 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Life -1 on the opponent works from the Override panel and shows in the log. Engine rejects hidden library moves and overrides during mulligan or after game over without mutating GameState.

### Decisions Made

- Discriminated override changes, not arbitrary GameState mutation.
- Phase 36 is Manual Override. Private Alpha is Phase 37. Productization is Phase 38.
- Override does not require priority so you can fix the table on someone else's turn.

### Files Changed

- `engine/src/types.ts`, `engine/src/override.ts`, `engine/src/override.test.ts`, `engine/src/actions.ts`, `engine/src/serialize.ts`, `engine/src/index.ts`
- `client/src/ui/Battlefield.tsx`, `client/src/App.test.tsx`, `client/src/index.css`
- `docs/DEVELOPMENT_PROGRESS.md`, `docs/RULES_COVERAGE.md`, `docs/UNSUPPORTED_INTERACTIONS.md`, `docs/ARCHITECTURE.md`

### Checkpoint

- PASS. Tag: `checkpoint-36-manual-override`

### Next Task

Verify tests, then stop. Do not start private alpha invites or a full English parser.

---

## 2026-08-13 — Project boundary correction and mtgCommander docs

### Objective

Separate `mtgCommander` from the sibling Electron deck builder. Remove audit docs that were created in the wrong project. Establish scope and architecture-principle documentation in the correct empty repository. Do not implement a game engine or choose a stack.

### Work Completed

- Confirmed `mtgCommander` is the current project and is independent of the deck builder.
- Confirmed the three audit docs no longer exist in the sibling deck-builder folder (`BizzyMTG/docs/` is gone; no `PROJECT_SPEC.md` / `ARCHITECTURE.md` / `DEVELOPMENT_PROGRESS.md` remain there).
- Created `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/DEVELOPMENT_PROGRESS.md` inside `mtgCommander`.
- Documented V1 goals, non-goals, user experience, and the project boundary.
- Documented architecture principles without selecting a technology stack.
- Did not initialize Git in the parent deck-builder project.
- Did not initialize Git in `mtgCommander` in this step (Phase 1 item; no application yet). Location is clear if Git is initialized later: this folder only.

### Tests Run

- None. There is no application or test runner in `mtgCommander` yet.

### Results

- `mtgCommander` contains project documentation only.
- No game engine, multiplayer, auth, or application stack exists.
- Technology stack is not decided.
- Ready for architecture discussion.

### Problems Encountered

- The previous audit had treated the sibling Electron deck builder as this project. That assumption is reversed.
- Workspace-root switch to `mtgCommander` failed in the tooling (`Cannot create migration handle for unknown agent`). Files were written by absolute path into `mtgCommander` anyway.
- The three misplaced deck-builder docs were already absent when deletion was retried (not found). Sibling application source was not modified.

### Decisions Made

- `mtgCommander` is the only active project for this work.
- The sibling deck builder is a separate application and must not be linked or imported.
- Technology stack is explicitly **not decided**.
- Game engine, realtime, and application scaffolding wait until architecture is approved.

### Files Changed

**Sibling deck builder (correction only):**

- Confirmed removed / already gone: `projects/BizzyMTG/BizzyMTG/docs/PROJECT_SPEC.md`
- Confirmed removed / already gone: `projects/BizzyMTG/BizzyMTG/docs/ARCHITECTURE.md`
- Confirmed removed / already gone: `projects/BizzyMTG/BizzyMTG/docs/DEVELOPMENT_PROGRESS.md`

No deck-builder source, `package.json`, or Electron files were modified.

**mtgCommander (current project):**

- `docs/PROJECT_SPEC.md` (created)
- `docs/ARCHITECTURE.md` (created)
- `docs/DEVELOPMENT_PROGRESS.md` (created)

### Checkpoint

- NEEDS REVIEW

```text
CHECKPOINT 0 — PROJECT BOUNDARY

Parent BizzyMTG project untouched: PASS
mtgCommander is the active project: PASS
Documentation is in mtgCommander: PASS
No game engine implemented: PASS
No multiplayer implemented: PASS
No technology stack prematurely selected: PASS
Ready for architecture discussion: YES
```

Git was not initialized in either folder. When Git is started, it must be created in `mtgCommander` only.

### Next Task

Hold an architecture discussion covering web vs desktop, where the authoritative engine should run, and realtime options. Do not scaffold an app or implement GameState until a stack is explicitly chosen.

---

## 2026-08-13 — V1 architecture decision (PC-hosted)

### Objective

Turn Ross’s product answers into a written V1 architecture and stack proposal. Do not implement the engine or application.

### Work Completed

- Recorded host/join, no-accounts, quality bar, deck import, and free-PC-host constraints in `PROJECT_SPEC.md`.
- Chose a V1 stack in `ARCHITECTURE.md`: TypeScript engine, Node WebSocket server on the host PC, React/Vite UI, Electron installer. No Next.js, no Supabase, no sibling deck-builder coupling.
- Documented LAN / Tailscale / port-forward as free ways for friends to reach the host.
- Did not create `engine/`, `server/`, `client/`, or Electron files.
- Did not initialize Git.

### Tests Run

- None. No application yet.

### Results

- Architecture is specified and waiting on Checkpoint 0 approval.
- Ready for Phase 1 foundation after a yes.

### Problems Encountered

- None.

### Decisions Made

- Authority: Ross’s PC.
- Clients: installable Electron app (React/Vite UI inside).
- Realtime: WebSockets.
- Auth: display name + room code.
- Quality bar: fundamentals in engine; manual override for the rest.
- Deck import: plain text + Moxfield.
- Keep V1 free; cloud hosting is a later option, not a requirement.

### Files Changed

- `docs/ARCHITECTURE.md`
- `docs/PROJECT_SPEC.md`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- NEEDS REVIEW

```text
CHECKPOINT 0 — PROJECT ARCHITECTURE

Status: NEEDS REVIEW (waiting for explicit approval)

PC-hosted authority: YES
No accounts in V1: YES
Engine independent of UI: YES
Stack proposed: TypeScript + Node WS server + React/Vite + Electron
Next.js / Supabase: NOT used
Sibling deck builder: NOT used
Ready for Phase 1 foundation: YES, after approval
```

### Next Task

If this architecture is approved: Phase 1 — initialize Git in `mtgCommander` only, add TypeScript / lint / Vitest, and create empty `engine/`, `server/`, `client/`, and `electron/` workspace folders. Do not implement GameState in that step.

---

## 2026-08-13 — Checkpoint 1 project foundation

### Objective

Establish a working `mtgCommander` foundation: Git, TypeScript, lint, tests, package boundaries, and a minimal app. Do not implement GameState or networking.

### Work Completed

- Initialized Git in `mtgCommander` only (not the parent folder, not the sibling deck builder).
- Created npm workspaces: `@mtgcommander/engine`, `@mtgcommander/server`, `@mtgcommander/client`.
- Added `electron/` as a thin desktop shell (preload bridge only).
- Configured TypeScript, oxlint, and Vitest.
- Added scripts: `dev`, `build`, `test`, `typecheck`, `lint`.
- Engine exports `getEngineInfo()` only.
- Server imports the engine via `getServerInfo()` and does not listen on a port.
- Client is a Phase 1 placeholder screen (no battlefield).

### Tests Run

- `npm test` — PASS (2 tests: engine, server)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS (client + electron main/preload)
- `npm run dev` — PASS (Vite `http://localhost:5175/` HTTP 200, Electron process started)

### Results

- Foundation is runnable.
- Engine does not import React/Electron.
- Server depends on engine and has no WebSocket listener.
- Ready for review. Phase 2 is not started.

### Problems Encountered

- First typecheck failed because `server/tsconfig.json` used `paths` + `rootDir`, which pulled engine sources outside `server/src`. Fixed by dropping `rootDir`/`paths` and resolving `@mtgcommander/engine` through the workspace package.
- `npm install` reported 2 high-severity audit findings (not force-fixed).

### Decisions Made

- npm workspaces (not a copied deck-builder repo).
- oxlint + Vitest + Vite 7 + React 19 + Electron.
- Dev server port **5175** so it does not collide with the sibling deck builder on 5174.
- No README added beyond `/docs`.
- GameState still belongs to Phase 2.

### Files Changed

- Created workspace config, packages, Electron shell, gitignore, and lockfile.
- Updated `docs/ARCHITECTURE.md` and `docs/DEVELOPMENT_PROGRESS.md`.

### Checkpoint

- PASS (local verification). Tag: `checkpoint-01-project-foundation`

```text
CHECKPOINT 1 — PROJECT BASELINE

Status: PASS (awaiting human review before Phase 2)

Git initialized in mtgCommander only: PASS
Typecheck: PASS
Lint: PASS
Tests: PASS
Build: PASS
Dev app starts: PASS
GameState implemented: NO
Networking implemented: NO
```

### Next Task

Stop. Do not start Phase 2 until Checkpoint 1 is approved.

---

## 2026-08-13 — Fix Electron launch from client workspace

### Objective

Fix the “Error launching app / Unable to find Electron app at …\client” dialog that appeared during Phase 1 `npm run dev`.

### Work Completed

- Pointed Electron startup at the repo root so it loads `dist-electron/main.js`.
- Added `client/package.json` `"main"` as a fallback for workspace cwd.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS
- `npm run dev` — PASS. Electron window title **BizzyMTG Commander** (process 26052), Vite HTTP 200 on port 5175.

### Results

- The desktop window launches. This is a follow-up commit after `checkpoint-01-project-foundation`; that tag was not moved.

### Problems Encountered

- `vite-plugin-electron` defaulted to `electron .` with cwd `client/`, which has no Electron main entry.

### Decisions Made

- Keep the workspace layout; do not move Electron into the client package.
- Do not retag Checkpoint 1.

### Files Changed

- `client/vite.config.ts`
- `client/package.json`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS (Phase 1 launch fix; Checkpoint 1 tag unchanged)

### Next Task

Phase 2 — GameState data model only.

---

## 2026-08-13 — Checkpoint 2 game-state data model

### Objective

Add a UI-free, serializable Commander GameState model. Data only — no zone movement, stack resolution, or networking.

### Work Completed

- Added engine types: GameState, PlayerState, CardDefinition, CardInstance, zones, turn/phase/step, ManaPool, stack, CommanderState, GameAction, GameEvent.
- Added `createGameState` for 2–4 players (40 life, empty zones).
- Added JSON serialize/parse for GameState, GameAction, and GameEvent.
- Added Vitest coverage for creation, unique IDs, zones, turn, mana, commander fields, actions/events, and round-trip equality.
- Engine package still has no React/Electron/DOM/network imports.

### Tests Run

- `npm test` — PASS (13 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- A GameState can be created and reconstructed from JSON without a UI.
- Checkpoint tag: `checkpoint-02-game-state`

### Problems Encountered

- First round-trip failed because empty `oracleText` was rejected. Parser now allows empty manaCost/oracleText strings.

### Decisions Made

- Commander tax is a number on `CommanderState`; damage is `damageReceived` keyed by commander instance ID.
- GameAction/GameEvent are small discriminated unions (`pass_priority` / `concede`, plus created/passed/conceded events). More kinds later when those systems exist.
- Did not move the Checkpoint 1 tag; Electron launch fix is a separate commit on `main`.

### Files Changed

- `engine/src/types.ts`
- `engine/src/ids.ts`
- `engine/src/info.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/index.ts`
- `engine/src/index.test.ts`
- `engine/src/gameState.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS (awaiting human review before Phase 3)

```text
CHECKPOINT 2 — GAME STATE EXISTS WITHOUT UI

Status: PASS

Tests: PASS
Typecheck: PASS
Lint: PASS
Build: PASS
Engine independent of React/Electron: PASS
Rules engine / zone movement: NOT implemented
```

### Next Task

Stop. Do not start Phase 3 until Checkpoint 2 is approved.

---

## 2026-08-13 — Checkpoint 3 zone engine

### Objective

Move cards between the six player zones with immutable updates and one-place integrity. Stack movement is out of scope.

### Work Completed

- Added `moveCard` returning a new GameState.
- Library index 0 is the top.
- Ownership/controller do not change on move.
- Tests for all six zones, invalid moves, unrelated-card isolation, immutability, and JSON round-trip.

### Tests Run

- `npm test` — PASS (22 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Zone integrity holds. Stack remains a separate `StackObject[]`.

### Problems Encountered

- None.

### Decisions Made

- Destination is always the owner's zone list.
- Same-zone move is a no-op clone.
- Phase 3 Stack checklist item left incomplete until Phase 5.

### Files Changed

- `engine/src/clone.ts`
- `engine/src/zones.ts`
- `engine/src/zones.test.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Phase 4 — turn/phase/step progression.

---

## 2026-08-13 — Checkpoint 4 turn system

### Objective

Advance turns through CR-like phases and steps, including multi-player wrap.

### Work Completed

- Added `advanceStep` / `advanceSteps` and `TURN_SEQUENCE`.
- Untap step untaps the active player's battlefield permanents (`CardInstance.tapped`).
- Draw step is visited but does not move cards.
- Tests for full step walk, 2- and 4-player wrap, multi-turn simulation, and untap.

### Tests Run

- `npm test` — PASS (28 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Turn skeleton works without combat or drawing.

### Problems Encountered

- None.

### Decisions Made

- Turn number increments on every player’s new turn.
- No automatic draw; that stays a later action using `moveCard`.

### Files Changed

- `engine/src/turn.ts`
- `engine/src/turn.test.ts`
- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Phase 5 — priority and stack.

---

## 2026-08-13 — Checkpoint 5 priority and stack

### Objective

Represent priority and the stack as engine behavior: pass priority around the table, put spells on the stack from hand, and resolve the top object in LIFO order.

### Work Completed

- Added `priorityPlayerId` and `passesSinceAction` to GameState.
- Added `putSpellOnStack`, `passPriority`, and `resolveTopOfStack`.
- Spells leave hand and exist only on the stack until they resolve.
- Instants/sorceries resolve to the owner's graveyard; other spells resolve to the battlefield.
- After all players pass with a nonempty stack, the top object resolves and priority returns to the active player.
- After all players pass with an empty stack, priority returns to the active player without advancing the step.
- `ZoneName` includes `"stack"`; player zone lists still do not contain a stack array.
- Tests cover passing, illegal passes, LIFO/counterspell order, creature resolution, empty-stack wrap, and serialization.

### Tests Run

- `npm test` — PASS (40 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Stack is a separate `StackObject[]`. Cards on the stack are not in any player zone.

### Problems Encountered

- Typecheck failed because `PLAYER_ZONES` was typed as `ZoneName[]`, which includes `"stack"`, and was used to index `PlayerZones`. Fixed by typing player zones separately and adding `isPlayerZone`.

### Decisions Made

- Minimal cast: the card must be in hand; mana payment is Phase 6.
- Putting a spell on the stack resets pass count and gives priority to the spell's controller.
- Full pass with an empty stack does not auto-advance the step.
- Destination after resolve is owner's zone (graveyard or battlefield).

### Files Changed

- `engine/src/stack.ts`
- `engine/src/stack.test.ts`
- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/zones.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Phase 6 — mana.

---

## 2026-08-13 — Checkpoint 6 mana

### Objective

Turn the Phase 2 ManaPool data model into engine behavior: add/remove mana, pay simple costs, tap for mana, and empty unused mana when a step ends.

### Work Completed

- Added `addMana`, `removeMana`, `emptyManaPools`, `parseManaCost`, `canPayManaCost`, and `payManaCost`.
- Added `tapCard`, `untapCard`, and `tapForMana`.
- `advanceStep` empties all players' mana pools as the current step ends (CR 500.4).
- Generic costs can be paid with any remaining mana after colored/colorless requirements.
- Tests cover colors, colorless, illegal removal, illegal payment, tap/untap, production, step-end emptying, and serialization.

### Tests Run

- `npm test` — PASS (58 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Mana pools are independently tracked per player. Payment is available as a standalone engine operation and is not wired into spell casting.

### Problems Encountered

- None.

### Decisions Made

- `tapForMana` takes the produced amount from the caller; lands do not infer their mana from type lines yet.
- Hybrid, Phyrexian, and `{X}` symbols are rejected as unsupported.
- Generic leftover is spent in order C, W, U, B, R, G.
- `payManaCost` is not hooked into `putSpellOnStack` (full casting stays later).
- Unused mana empties on every `advanceStep`, including turn wrap.

### Files Changed

- `engine/src/mana.ts`
- `engine/src/mana.test.ts`
- `engine/src/turn.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Stop. Do not start Phase 7 until Checkpoint 6 is reviewed.

---

## 2026-08-13 — Checkpoint 7 game actions

### Objective

Connect zones, priority, stack, mana, and turns behind an authoritative `applyAction` entry point for passing and basic spell casting.

### Work Completed

- Added `cast_spell` to GameAction and `applyAction` / `applyActions`.
- Casting checks priority, hand membership, timing, and mana, then pays with the existing mana system and uses the existing stack.
- Instants/sorceries resolve to the owner's graveyard; other spells resolve to the battlefield.
- Illegal actions throw and leave the original GameState unchanged.
- A complete pass cycle on an empty stack advances the step at the action layer; `passPriority` itself is unchanged.

### Tests Run

- `npm test` — PASS (71 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Players can pass and cast through one engine API. Failed casts do not spend mana or move cards.

### Problems Encountered

- None.

### Decisions Made

- Non-instant spells require the active player, a main phase, and an empty stack.
- Lands cannot be cast as spells.
- Targeting is rejected until a later phase.
- Concede remains parsed but is not implemented.

### Files Changed

- `engine/src/actions.ts`
- `engine/src/actions.test.ts`
- `engine/src/cardTypes.ts`
- `engine/src/stack.ts`
- `engine/src/types.ts`
- `engine/src/serialize.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Phase 8 — basic card effects.

---

## 2026-08-13 — Checkpoint 8 basic effects

### Objective

Establish reusable card-effect primitives that change GameState without the UI owning rules.

### Work Completed

- Added `GameEffect` and `applyEffect` for gain/lose life, damage, draw, zone moves, tap/untap, add mana, and basic tokens.
- Card definitions now carry optional power/toughness. Card instances track `damageMarked`.
- Lethal creature damage moves the card to the graveyard via the zone engine.
- Draw moves library index 0 to hand and rejects overdraw without partial draws.

### Tests Run

- `npm test` — PASS (83 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Effects modify only intended state, preserve instance IDs and zone integrity, and serialize.

### Problems Encountered

- Duplicate type re-exports failed typecheck; fixed by exporting `GameEffect` once from `index.ts`.

### Decisions Made

- Effects are data plus `applyEffect`, not per-card hard-coding.
- Player damage is life loss. Commander-damage tracking waits for combat.
- Tokens are real CardInstance + CardDefinition objects on the battlefield.

### Files Changed

- `engine/src/effects.ts`
- `engine/src/effects.test.ts`
- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Phase 9 — combat.

---

## 2026-08-13 — Checkpoint 9 combat

### Objective

Support a basic Commander combat sequence on the existing turn, zone, and priority systems.

### Work Completed

- Added declare_attackers and declare_blockers game actions.
- Attackers must be untapped, non-sick creatures the active player controls.
- Blockers must be untapped creatures the defending player controls.
- Combat damage is dealt when the combat damage step begins.
- Lethal damage moves creatures to the graveyard.
- Unblocked commanders add to that player's commander.damageReceived.
- Combat flags clear at end of combat; marked damage clears at cleanup.

### Tests Run

- `npm test` — PASS (92 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Basic combat works for unblocked, blocked, multiple attackers/blockers, illegal declarations, and cleanup.

### Problems Encountered

- Unblocked-combat tests originally under-counted passes through declare blockers. Tests now walk to the named step.

### Decisions Made

- Passing as the pending defending player in declare blockers is an empty block declaration.
- Multiple blockers use lethal-then-overflow damage assignment in declaration order. No trample.
- Summoning sickness is set on battlefield entry and cleared on the controller's untap.
- Combat keywords are not implemented.

### Files Changed

- `engine/src/combat.ts`
- `engine/src/combat.test.ts`
- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/zones.ts`
- `engine/src/turn.ts`
- `engine/src/actions.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Phase 10 — commander rules.

---

## 2026-08-13 — Checkpoint 10 commander

### Objective

Implement fundamental Commander rules: command zone, tax, casting, return, damage tracking, and the 21-damage loss condition.

### Work Completed

- Commanders can be cast from the command zone through `applyAction`.
- Casts from the command zone pay printed cost plus current tax, then tax increases by 2.
- A commander that would go to the graveyard or exile returns to the command zone instead.
- Commander combat damage is tracked by CardInstance ID.
- 21 or more damage from a single commander instance sets `player.lost`.
- 40 life remains the starting total.

### Tests Run

- `npm test` — PASS (98 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Commander identity is the instance ID, not the card name. Serialization preserves tax, damage, and loss.

### Problems Encountered

- None after moving `isCommander` into `cardTypes` so zones can redirect without a circular import.

### Decisions Made

- Owner always returns the commander to the command zone (no replacement choice yet).
- Tax increments when the commander is put on the stack from the command zone, even before it resolves.
- Partner/background/companion are not implemented.
- Life-total loss (0 life) is not implemented; only the 21 commander-damage condition is.

### Files Changed

- `engine/src/commander.test.ts`
- `engine/src/cardTypes.ts`
- `engine/src/actions.ts`
- `engine/src/stack.ts`
- `engine/src/zones.ts`
- `engine/src/combat.ts`
- `engine/src/mana.ts`
- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Stop. Do not start Phase 11 until Checkpoint 10 is reviewed.

---

## 2026-08-13 — Checkpoint 11 card definitions and effect execution

### Objective

Let CardDefinitions carry serializable effects and execute them through the existing GameEffect system when a spell resolves.

### Work Completed

- Added `CardEffect` data on `CardDefinition` (not functions).
- Relative player refs `controller` and `next_opponent` bind to concrete player IDs on resolve. `next_opponent` is a test stand-in, not a targeting system.
- `resolveTopOfStack` binds definition effects, runs `applyEffects`, then moves the spell to graveyard or battlefield.
- Added synthetic test cards (shock, gift, drain, study, ritual, recruit, bear, blank instant).
- Round-trip serialization includes definition effects.

### Tests Run

- `npm test` — PASS (106 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS
- Engine remains free of React/Electron imports.

### Results

- Multiple CardInstances can share one definition. Resolving a defined spell changes GameState via GameEffect, then the card goes to the correct zone.

### Problems Encountered

- `resolveTopOfStack` used `const next` and then reassigned after applying effects. Changed to `let`.

### Decisions Made

- CardDefinition stores `CardEffect[]`; resolve binds them to `GameEffect[]` and reuses `applyEffect`. No second executor.
- Tap/untap/move tests use an explicit instance ID in the definition. That is not a targeting system.
- Deck import was previously listed as Phase 11; this checkpoint uses Phase 11 for card-definition execution instead. Deck import remains future work.

### Files Changed

- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/effects.ts`
- `engine/src/stack.ts`
- `engine/src/serialize.ts`
- `engine/src/catalog.ts`
- `engine/src/cardEffects.test.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Stop. Do not start Phase 12 until Checkpoint 11 is reviewed.

---

## 2026-08-13 — Checkpoint 12 playable-loop engine gaps

### Objective

Close the missing fundamental gameplay pieces so the existing engine is much closer to a complete basic game loop before Battlefield UI.

### Work Completed

- Added `play_land` as a special action: active player, main phase, empty stack, priority, land in hand, one land per turn. The land moves to the battlefield and does not use the stack.
- Draw step draws the top library card for the active player, including on turn 1.
- Life at or below 0 marks a player as lost. Concede is implemented and does not require priority.
- Lost players are skipped in turn order and priority. Attackers cannot target a lost player. A sole survivor is recorded as `winnerId`.
- Added a synthetic `testForest` fixture only. No Scryfall, Moxfield, deck import, or card database.

### Tests Run

- `npm test` — PASS (122 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS
- Engine remains free of React/Electron imports.

### Results

- The engine can play a land, draw, concede, and lose at 0 life. Targeting, Battlefield UI, and deck import were not started.

### Problems Encountered

- The Phase 11 Study-spell test put a library card in before advancing to main. The draw step now draws that card, so the library card is placed after the turn draw.

### Decisions Made

- Land play is a special action, not a spell. Casting a land as a spell is still rejected.
- Targeting remains future work and must be choose-on-cast (not choose-on-resolution).
- Drawing from an empty library during the draw step does not yet cause a loss (no throw; the step is skipped). Spell draws from an empty library still throw.
- Synthetic cards only. A basic land fixture is allowed; real-card integration is later.
- Battlefield UI was previously listed as Phase 12; this checkpoint uses Phase 12 for playable-loop gaps instead.

### Files Changed

- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/players.ts`
- `engine/src/status.ts`
- `engine/src/turn.ts`
- `engine/src/turn.test.ts`
- `engine/src/actions.ts`
- `engine/src/stack.ts`
- `engine/src/combat.ts`
- `engine/src/effects.ts`
- `engine/src/serialize.ts`
- `engine/src/catalog.ts`
- `engine/src/index.ts`
- `engine/src/playableLoop.test.ts`
- `engine/src/cardEffects.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Stop. Do not start targeting, Battlefield UI, deck import, or real-card integration yet.

---

## 2026-08-13 — Checkpoint 13 targeting

### Objective

Add normal Magic targeting: choose targets when a spell is cast and placed on the stack, then check legality again when it resolves.

### Work Completed

- Added `targetRequirements` on CardDefinition and `targets` on stack objects and `cast_spell`.
- Cast-time validation: count must match, every target must be legal (living player, or creature on the battlefield). Untargeted spells reject extra targets.
- Resolve-time check: if no required targets remain legal, effects are skipped (fizzle) and the instant/sorcery still goes to the graveyard.
- Test Shock is now a targeted "any target" damage spell. Test Terror is a targeted destroy-creature fixture.
- `next_opponent` remains only for untargeted relative effects, not as a targeting substitute.

### Tests Run

- `npm test` — PASS (129 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS
- Engine remains free of React/Electron imports.

### Results

- Targets are chosen on cast, stored on the stack, and rechecked on resolve. Battlefield UI, deck import, and real-card integration were not started.

### Problems Encountered

- Existing Shock tests cast without targets. They now pass an explicit player target.

### Decisions Made

- Choose-on-cast, not choose-on-resolution.
- Hexproof, shroud, protection, and targeting spells on the stack are not in this phase.
- Two-client realtime was previously listed as Phase 13; this checkpoint uses Phase 13 for targeting instead.

### Files Changed

- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/targeting.ts`
- `engine/src/targeting.test.ts`
- `engine/src/actions.ts`
- `engine/src/actions.test.ts`
- `engine/src/stack.ts`
- `engine/src/effects.ts`
- `engine/src/serialize.ts`
- `engine/src/catalog.ts`
- `engine/src/index.ts`
- `engine/src/cardEffects.test.ts`
- `engine/src/gameState.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS

### Next Task

Stop. Do not start Battlefield UI, deck import, or real-card integration yet.

---

## 2026-08-13 — Player elimination as a leave-the-game transition

### Objective

Treat player elimination as a Commander multiplayer game-state transition, not only a `lost` flag. Life loss, commander-damage loss, and concede must share one path.

### Work Completed

- Added `eliminatePlayerInPlace`: mark the player lost, empty their mana, move owned objects to a new owner `removed` zone (left the game), exile objects they control but do not own (controller returns to owner), drop their stack objects, and clean combat.
- 0 life and 21 commander damage call that transition from state-based actions. Concede calls the same function.
- Remaining living players stay in turn order and priority. One remaining player sets `winnerId` and `isGameOver`.
- Did not implement leave-the-game triggered abilities.

### Tests Run

- `npm test` — PASS (138 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Eliminated players no longer participate. Their owned cards are out of the game. Stolen permanents they controlled are exiled under the owner, not taken with them.

### Decisions Made

- `removed` is a player zone in the existing zone model so owned objects still have a serializable location after leaving the game. It is not exile.
- Commanders among stolen permanents still follow the existing command-zone replacement when they would be exiled.
- `lost` remains the participation flag; the transition is what actually changes zones.

### Files Changed

- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/zones.ts`
- `engine/src/zones.test.ts`
- `engine/src/serialize.ts`
- `engine/src/elimination.ts`
- `engine/src/elimination.test.ts`
- `engine/src/status.ts`
- `engine/src/actions.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-12b-player-elimination`
- Existing tags were not moved or rewritten, including `checkpoint-12-playable-loop` and `checkpoint-13-targeting`.

### Next Task

Stop. Do not continue until Checkpoint 12b is reviewed. Do not start Battlefield UI, deck import, or real-card integration yet.

---

## 2026-08-13 — Four-player engine and hidden information

### Objective

Prove four-player Commander identities, turns, priority, combat, and concession in the engine, plus a viewer projection that hides opponent hands and libraries. Not rooms or WebSockets.

### Work Completed

- Four-player GameState already existed; added tests for identities, turn order, priority, attacking two opponents, and one concession among four.
- Added `redactForViewer`: opponent hand and library cards keep instance IDs and zone counts but use a hidden definition. Battlefield, graveyard, exile, command, stack, life, and commander damage stay public.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- A four-player engine game can walk turns and combat without networking. Hidden information is a pure projection of GameState.

### Decisions Made

- Phase 14 is engine-only. Four-player rooms remain later.
- Existing tags were not moved, including `checkpoint-13-targeting` and `checkpoint-12b-player-elimination`.

### Files Changed

- `engine/src/visibility.ts`
- `engine/src/fourPlayer.test.ts`
- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/index.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-14-four-player-engine`

### Next Task

Phase 15 — mill, discard, sacrifice, counters, and a zone-change event log.

---

## 2026-08-13 — Card ability architecture

### Objective

Add reusable engine effects for mill, discard, sacrifice, and counters, plus an append-only zone-change log.

### Work Completed

- `mill` moves that many cards from library to graveyard, or fewer if the library is short.
- `discard` moves that many cards from the front of hand to graveyard, or fewer if the hand is short.
- `sacrifice` moves a battlefield card to graveyard.
- `add_counter` increments a named counter on a card instance.
- Zone moves append `GameState.log` entries.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Ability effects are data on definitions/effects, not functions. No general choice system yet.

### Files Changed

- `engine/src/effects.ts`
- `engine/src/zones.ts`
- `engine/src/serialize.ts`
- `engine/src/abilities.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-15-card-ability-architecture`

### Next Task

Phase 16 — keywords.

---

## 2026-08-13 — Keywords

### Objective

Store keywords on card definitions and apply the V1 combat/timing/targeting set.

### Work Completed

- Flying/reach, menace, defender, haste, vigilance, trample, deathtouch, lifelink, first strike, double strike (two damage passes), indestructible, flash, hexproof.
- Ward is not implemented.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Combat uses a first-strike pass then a normal pass. Hexproof is checked against the caster at targeting time.

### Files Changed

- `engine/src/keywords.ts`
- `engine/src/keywords.test.ts`
- `engine/src/combat.ts`
- `engine/src/targeting.ts`
- `engine/src/actions.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-16-keywords`

### Next Task

Phase 17 — derived power and toughness.

---

## 2026-08-13 — Derived characteristics

### Objective

Compute creature power and toughness from printed values, +1/+1 counters, and simple static modifiers.

### Work Completed

- `creaturePower` / `creatureToughness` use definition P/T, `p1p1` counters, and `staticModifiers` with selectors `self` and `controlled_creatures`.
- Combat and lethal damage use derived toughness.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- This is not CR 613 layers. Temporary modifiers, copy, and timestamps remain later.

### Files Changed

- `engine/src/derived.ts`
- `engine/src/derived.test.ts`
- `engine/src/combat.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-17-derived-state`

### Next Task

Phase 18 — ETB triggers.

---

## 2026-08-13 — Enter-the-battlefield triggers

### Objective

When a permanent enters the battlefield, queue definition `enter_battlefield` triggers as stack abilities.

### Work Completed

- Zone moves onto the battlefield and token creation call `queueEnterBattlefieldTriggersInPlace`.
- Resolving an `ability` stack object runs that trigger’s effects and does not move the source card.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- V1 has no trigger target choices and no AP ordering for simultaneous triggers.

### Files Changed

- `engine/src/triggers.ts`
- `engine/src/triggers.test.ts`
- `engine/src/zones.ts`
- `engine/src/stack.ts`
- `engine/src/effects.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-18-triggered-abilities`

### Next Task

Phase 19 — draw replacement.

---

## 2026-08-13 — Draw replacement

### Objective

Skip draws while a player controls a permanent with `replace_draw` / `skip`.

### Work Completed

- Turn-step draws and `draw` effects check `wouldSkipDraw` and skip instead of moving a card.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Damage replacement and multiple interacting replacements remain later.

### Files Changed

- `engine/src/derived.ts`
- `engine/src/effects.ts`
- `engine/src/turn.ts`
- `engine/src/replacement.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-19-replacement-effects`

### Next Task

Phase 20 — extra SBAs and a rules coverage document.

---

## 2026-08-13 — Rules coverage and 0-toughness SBAs

### Objective

Record what the engine implements, expand state-based actions for 0 toughness, and stop.

### Work Completed

- Creatures with a printed toughness whose derived toughness is 0 go to the graveyard, including indestructible.
- Added `docs/RULES_COVERAGE.md` for implemented rules and documented gaps (layers, copy, ward, networking, UI, deck import).

### Tests Run

- `npm test` — PASS (164 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Engine V1 through Phase 20 is checkpointed. Battlefield UI, deck import, real cards, and networking remain later.

### Files Changed

- `engine/src/status.ts`
- `engine/src/sba.test.ts`
- `docs/RULES_COVERAGE.md`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-20-rules-coverage`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start Battlefield UI, deck import, real-card integration, or networking yet.

---

## 2026-08-13 — 20-card synthetic engine

### Objective

Seat a representative 20-card synthetic pool, build test decks, play a complete engine game to a winner, and log unsupported interactions. Stay off real-card databases and UI.

### Work Completed

- Added 20 uniquely named `Test …` definitions covering basics, a commander, creatures with keywords/ETB/anthem, and instants/sorceries already supported by the engine.
- `startCatalogGame` seats commanders, libraries, and opening hands from pool IDs. It does not shuffle or import Moxfield lists.
- Added `tap_for_mana` so lands with `produces` can pay costs through `applyAction`.
- A scripted complete game from the pool reaches a winner (0 life).
- Added `docs/UNSUPPORTED_INTERACTIONS.md`.

### Tests Run

- `npm test` — PASS (170 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Two players can play a full loop using only pool cards and game actions: land, tap for mana, cast, combat, elimination.

### Decisions Made

- Pool cards keep synthetic names. No Scryfall or real oracle text.
- `produces` on the definition drives tap-for-mana. Other activated abilities remain later.
- Complete-game tests may set `startingLife` so the loop can finish without a 40-life slog.

### Files Changed

- `engine/src/types.ts`
- `engine/src/createGame.ts`
- `engine/src/serialize.ts`
- `engine/src/actions.ts`
- `engine/src/visibility.ts`
- `engine/src/pool.ts`
- `engine/src/setup.ts`
- `engine/src/twentyCard.test.ts`
- `engine/src/index.ts`
- `docs/UNSUPPORTED_INTERACTIONS.md`
- `docs/RULES_COVERAGE.md`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-21-20-card-engine`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start Battlefield UI, deck import, real-card integration, or networking yet.

---

## 2026-08-13 — Battlefield UI for the synthetic test game

### Objective

Make the Phase 21 synthetic catalog game visible and playable in the client as a projection of GameState. Keep `applyAction` authoritative. No real cards, no networking.

### Work Completed

- Client starts a two-player synthetic table via `startCatalogGame`.
- Battlefield shows opponent and local player areas: life, permanents, tapped state, hand, zone counts, mana, turn/step, priority, stack, and game-over.
- UI actions (play land, tap_for_mana, cast with targeting, pass, concede, declare attackers/blockers) call `applyAction` and replace state with the engine result.
- Illegal actions surface the engine error and do not mutate the previous GameState.

### Tests Run

- `npm test` — PASS (175 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- The application can start the synthetic game and take supported actions from the battlefield view.

### Decisions Made

- Local in-process `applyAction` until networking exists. The server remains the intended future authority.
- Pass priority always uses `state.priorityPlayerId` so opponent priority can be advanced without a second client.
- Opponent does not independently play cards; their hand stays counted, not shown.

### Files Changed

- `client/src/App.tsx`
- `client/src/App.test.tsx`
- `client/src/index.css`
- `client/src/ui/Battlefield.tsx`
- `client/src/game/syntheticTable.ts`
- `client/src/game/dispatch.ts`
- `client/src/game/dispatch.test.ts`
- `client/package.json`
- `vitest.config.ts`
- `docs/DEVELOPMENT_PROGRESS.md`
- `docs/UNSUPPORTED_INTERACTIONS.md`
- `docs/RULES_COVERAGE.md`

### Checkpoint

- PASS. Tag: `checkpoint-22-battlefield-ui`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start deck import, real-card integration, networking, or Phase 23 yet.

---

## 2026-08-13 — Local table persistence and resume

### Objective

Persist authoritative GameState so a browser refresh can restore the seated viewer's table. No WebSockets.

### Work Completed

- Added `serializeAuthority` on `GameHost` and localStorage snapshot helpers (`saveTable` / `loadTable` / `clearTable`).
- The client restores a saved table on remount and can start a new synthetic game.
- Snapshots store viewer id, seated players, version, and full unredacted GameState JSON.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Playing a land, then saving and loading, restores the battlefield and step. Concede then remount shows game-over.

### Decisions Made

- Persist authority, not the redacted view.
- Storage key `mtgcommander.table.v1`. Corrupt snapshots are ignored.
- Network reconnect / rooms remain later.

### Files Changed

- `server/src/session.ts`
- `server/src/persist.ts`
- `server/src/session.test.ts`
- `server/src/index.ts`
- `client/src/App.tsx`
- `client/src/App.test.tsx`
- `docs/DEVELOPMENT_PROGRESS.md`

### Checkpoint

- PASS. Tag: `checkpoint-23-persistence`
- Existing tags were not moved or rewritten.

### Next Task

Phase 24 — host action checks (same `GameHost` module).

---

## 2026-08-13 — In-process GameHost action checks

### Objective

Make `GameHost` the only caller of `applyAction`. Clients submit `GameAction`s as themselves. Illegal and spoofed actions must not change authority.

### Work Completed

- `submit(actorId, action)` rejects `action.playerId !== actorId` and unseated actors.
- Illegal engine actions return `{ ok: false }` and leave serialized authority unchanged.
- Mutating `viewFor` cannot change host life or mana.
- Unseated players auto-pass so a local table can advance without a second client.
- The UI no longer calls `applyAction` or pass-as-whoever-has-priority.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Spoofed pass, illegal Shock cast, and mutated views leave the host unchanged.

### Decisions Made

- In-process host, not a network server. WebSockets remain later.
- Pass always uses `viewerId`. Opponent priority is flushed by the host.

### Files Changed

- `server/src/session.ts`
- `server/src/session.test.ts`
- `client/src/App.tsx`
- `client/src/ui/Battlefield.tsx`
- `client/src/game/dispatch.ts` (removed)
- `client/src/game/dispatch.test.ts` (removed)
- `client/package.json`
- `docs/DEVELOPMENT_PROGRESS.md`
- `docs/ARCHITECTURE.md`
- `docs/UNSUPPORTED_INTERACTIONS.md`

### Checkpoint

- PASS. Tag: `checkpoint-24-security`
- Existing tags were not moved or rewritten.

### Next Task

Phase 25 — show redacted opponent hands in the UI.

---

## 2026-08-13 — Hidden information in the battlefield UI

### Objective

Show the player-specific projection from `redactForViewer` in the battlefield, so opponent hands are Unknown Card backs instead of named cards or a count-only row.

### Work Completed

- `App` renders `host.viewFor(viewerId)`, never raw authority.
- Opponent hand tiles use `HIDDEN_DEFINITION_ID` / Unknown Card.
- Opponent library identity stays redacted in the host view.

### Tests Run

- `npm test` — PASS (181 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Your hand shows Test Shock. The opponent hand shows seven Unknown Card tiles. Face-down battlefield cards are still not a thing (no morph).

### Decisions Made

- Engine `redactForViewer` from Phase 14 is the single hidden-info path. The client must not hide cards itself.
- Morph/manifest remain unimplemented.

### Files Changed

- `client/src/ui/Battlefield.tsx`
- `client/src/index.css`
- `client/src/App.test.tsx`
- `server/src/session.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`
- `docs/RULES_COVERAGE.md`
- `docs/UNSUPPORTED_INTERACTIONS.md`

### Checkpoint

- PASS. Tag: `checkpoint-25-hidden-information`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start deck import, real-card integration, networking, or Phase 26.

---

## 2026-08-13 — Empty-library loss

### Objective

A player who would draw from an empty library loses the game. Draw-step and spell draws share one path. Mill and skipped draws do not lose.

### Work Completed

- Added `failedToDraw` on PlayerState. `draw` effects set it when the library is empty instead of throwing.
- State-based actions eliminate that player.
- Skip-draw replacements still skip without setting the flag.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Checkpoint

- PASS. Tag: `checkpoint-26-empty-library-loss`

### Next Task

Phase 27 — stack targeting.

---

## 2026-08-13 — Stack targeting and Test Counter

### Objective

Let spells target other spells on the stack. Add a synthetic counterspell.

### Work Completed

- Target kind `spell` and ChosenTarget `{ type: "spell", stackObjectId }`.
- `counter_spell` removes the stack object and puts its source into the graveyard (commanders still bounce to the command zone).
- Test Counter in the synthetic pool. The battlefield can click a stack object when targeting a spell.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Checkpoint

- PASS. Tag: `checkpoint-27-stack-targeting`

### Next Task

Phase 28 — readable game log.

---

## 2026-08-13 — Readable game log

### Objective

Show public events on the battlefield without leaking hidden card names.

### Work Completed

- Life-change log entries on gain/lose life.
- Battlefield log strip of the last zone and life events, using the redacted view.

### Tests Run

- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Checkpoint

- PASS. Tag: `checkpoint-28-game-log`

### Next Task

Phase 29 — four-player battlefield layout.

---

## 2026-08-13 — Four-player battlefield UI

### Objective

Project every opponent, not only the first other player. Keep unseated players auto-passing.

### Work Completed

- Opponent areas for all non-viewer players.
- Attack picker when more than one opponent is alive.
- Start 2-player or 4-player synthetic tables.

### Tests Run

- `npm test` — PASS (185 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Checkpoint

- PASS. Tag: `checkpoint-29-four-player-ui`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Needs input: real cards/Scryfall/Moxfield, WebSockets, London mulligan, or activated abilities.

---

## 2026-08-13 — Card database and Moxfield import

### Objective

Load real Magic cards from a cached Scryfall oracle snapshot and seat Commander decks from a Moxfield URL or a pasted text list. Keep the engine free of network I/O. Keep synthetic start buttons.

### Work Completed

- Added `OracleCard` compile: known keywords, printed P/T, and a single simple `{T}: Add {M}` line. Instant/sorcery effects are not auto-compiled.
- Added Commander text-list parsing (Commander/Deck/Sideboard headers; strip `(SET) 123`) and Moxfield public-id parsing.
- `startDefinitionGame` seats compiled definitions and shuffles by default. `startCatalogGame` still uses the synthetic pool and does not shuffle.
- Server `CardDatabase` caches oracle cards, searches locally, and resolves missing names through Scryfall. Unit tests mock fetch (no live network).
- Moxfield v3 `boards` and v2 top-level maps both parse. Electron `net.fetch` allowlists `api.scryfall.com`, `api2.moxfield.com`, and `api.moxfield.com`.
- Start screen: Moxfield URL, optional opponent URL (empty mirrors your deck), pasted list, and compile notes on the table.

### Tests Run

- `npm test` — PASS (203 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- A pasted Atraxa / Sol Ring / Forest list starts a 2-player table from cached oracle data. A Moxfield URL works in Electron; a plain Vite tab should paste the export because of CORS.

### Decisions Made

- Compile, do not parse all oracle text. Uncompiled cards still sit in the deck and show notes.
- Hybrid / Phyrexian / `{X}` costs are noted as unpayable.
- Engine stays network-free. I/O lives in `server/` and Electron IPC.
- Do not ship Scryfall bulk JSON in git.
- Performance, WebSockets, mulligans, and activated abilities remain later.

### Files Changed

- `engine/src/oracle.ts`, `engine/src/oracle.test.ts`
- `engine/src/decklist.ts`, `engine/src/decklist.test.ts`
- `engine/src/shuffle.ts`, `engine/src/setup.ts`, `engine/src/index.ts`
- `server/src/http.ts`, `server/src/scryfall.ts`, `server/src/cards.ts`, `server/src/cards.test.ts`
- `server/src/moxfield.ts`, `server/src/importDeck.ts`, `server/src/index.ts`
- `electron/main.ts`, `electron/preload.ts`
- `client/src/App.tsx`, `client/src/App.test.tsx`, `client/src/index.css`
- `client/src/game/cardDatabase.ts`, `client/src/game/storage.ts`, `client/src/vite-env.d.ts`
- `docs/DEVELOPMENT_PROGRESS.md`, `docs/RULES_COVERAGE.md`, `docs/UNSUPPORTED_INTERACTIONS.md`, `docs/ARCHITECTURE.md`

### Checkpoint

- PASS. Tag: `checkpoint-30-card-database`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start networking, mulligans, activated abilities, or a full oracle-text parser.

---

## 2026-08-13 — 2–4 player tables and local hotseat

### Objective

Seat 2, 3, or 4 players for synthetic and imported games. Make extra seats playable at one PC via hotseat instead of only auto-passing.

### Work Completed

- Default names: 2-player You / Opponent; 3–4 player You / Opponent 1–3.
- Synthetic start buttons for 2, 3, and 4 players.
- Imported tables take 2–4 compiled decks. Empty opponent Moxfield URLs still mirror your deck.
- `GameHost.start(..., { hotseat: true })` seats every player. `setViewer` switches the local hand. Unchecked hotseat still auto-passes unseated opponents.
- Seat switcher on the table when more than one player is seated.

### Tests Run

- `npm test` — PASS (210 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- A 3-player imported table shows two opponent areas. Hotseat pass leaves priority on the next player instead of flushing the table.

### Decisions Made

- Solo practice stays the default (only the viewer is seated). Hotseat is an explicit checkbox.
- Hidden information still uses `viewFor` after a seat switch; you see that player's hand, not everyone's.
- Networking, London mulligan, and activated abilities remain later.

### Files Changed

- `engine/src/setup.ts`, `engine/src/index.ts`, `engine/src/gameState.test.ts`, `engine/src/decklist.test.ts`
- `server/src/importDeck.ts`, `server/src/cards.test.ts`, `server/src/session.ts`, `server/src/session.test.ts`
- `client/src/game/syntheticTable.ts`, `client/src/App.tsx`, `client/src/App.test.tsx`, `client/src/index.css`
- `docs/DEVELOPMENT_PROGRESS.md`, `docs/RULES_COVERAGE.md`, `docs/UNSUPPORTED_INTERACTIONS.md`, `docs/ARCHITECTURE.md`

### Checkpoint

- PASS. Tag: `checkpoint-31-player-tables`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start networking, mulligans, activated abilities, or a full oracle-text parser.

---

## 2026-08-13 — London mulligan and WebSocket host/join

### Objective

Add the London mulligan before the first turn, then let friends join a PC-hosted table over WebSockets.

### Work Completed

- `keep_hand`, `mulligan`, and `bottom_cards` game actions. Taking a mulligan shuffles, draws 7, then bottoms counted cards. 3–4 player first mulligan is free.
- Unseated opponents auto-keep. Playing lands/spells is blocked until mulligans finish.
- `GameServer` on port 8787 with a room code. Joiners claim empty seats and receive `viewFor` themselves.
- Electron **Open table for friends** moves authority into the main process. Start screen **Join table** uses host address, port, room code, and display name.

### Tests Run

- `npm test` — PASS (220 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- A 2-player London mulligan bottoms 1 card. A second WebSocket client joins by room code and sees Unknown Card for the host hand.

### Decisions Made

- Sequential keep/mulligan in turn order, not simultaneous declaration.
- Engine tests skip mulligans by default (`skipMulligan: true`). The client does not.
- `ws` stays out of the engine and out of the Vite renderer bundle (`@mtgcommander/server/realtime`).
- Unjoined seats still auto-pass. No accounts, no cloud host.

### Files Changed

- `engine/src/mulligan.ts`, `engine/src/mulligan.test.ts`, `engine/src/types.ts`, `engine/src/actions.ts`, `engine/src/setup.ts`, `engine/src/serialize.ts`, `engine/src/createGame.ts`, `engine/src/index.ts`
- `server/src/session.ts`, `server/src/realtime.ts`, `server/src/realtime.test.ts`, `server/src/importDeck.ts`, `server/package.json`
- `client/src/App.tsx`, `client/src/App.test.tsx`, `client/src/ui/Battlefield.tsx`, `client/src/game/remoteTable.ts`, `client/src/game/syntheticTable.ts`
- `electron/main.ts`, `electron/preload.ts`, `client/vite.config.ts`
- `docs/DEVELOPMENT_PROGRESS.md`, `docs/RULES_COVERAGE.md`, `docs/UNSUPPORTED_INTERACTIONS.md`, `docs/ARCHITECTURE.md`

### Checkpoint

- PASS. Tags: `checkpoint-32-london-mulligan`, `checkpoint-33-websockets`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start activated abilities or a full oracle-text parser.

---

## 2026-08-13 — Activated abilities

### Objective

Let permanents activate non-mana abilities through `applyAction`. Keep `tap_for_mana` for lands. Do not parse general oracle text.

### Work Completed

- `CardDefinition.activated` plus `activate_ability` (tap and/or mana cost). Abilities go on the stack with `activatedIndex` and resolve through existing `CardEffect`s.
- Creatures cannot pay a `{T}` cost while summoning sick unless they have haste. Illegal activations leave GameState unchanged.
- Targeted activations choose on activate and fizzle if no target remains legal. The source stays on the battlefield.
- Synthetic Test Oracle in the pool and opening synthetic hand. Clicking it on the battlefield draws a card after the stack resolves.
- Oracle compile of a single `{T}: Draw a card.` sentence only.

### Tests Run

- `npm test` — PASS (229 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Test Oracle taps, stacks an ability, and draws on resolve. Lands still tap for mana without using the stack.

### Decisions Made

- Mana abilities stay `produces` + `tap_for_mana` (no stack). Other activated abilities use the stack.
- V1 UI activates ability index 0. Cards that both produce mana and have another ability still tap for mana on click.
- `{2}, {T}: Draw a card` and until-end-of-turn pumps are not compiled.
- Private alpha remains later.

### Files Changed

- `engine/src/types.ts`, `engine/src/createGame.ts`, `engine/src/serialize.ts`, `engine/src/stack.ts`, `engine/src/actions.ts`, `engine/src/visibility.ts`, `engine/src/index.ts`
- `engine/src/pool.ts`, `engine/src/oracle.ts`, `engine/src/oracle.test.ts`, `engine/src/activated.test.ts`, `engine/src/twentyCard.test.ts`
- `client/src/ui/Battlefield.tsx`, `client/src/game/syntheticTable.ts`, `client/src/App.test.tsx`
- `docs/DEVELOPMENT_PROGRESS.md`, `docs/RULES_COVERAGE.md`, `docs/UNSUPPORTED_INTERACTIONS.md`, `docs/ARCHITECTURE.md`

### Checkpoint

- PASS (local verification). Tag when requested: `checkpoint-34-activated-abilities`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start a full oracle-text parser, temporary modifiers, or private alpha.

---

## 2026-08-13 — Oracle pattern compiler

### Objective

Compile more real-card oracle text into existing engine data using known sentence patterns. Do not parse general English.

### Work Completed

- Sentence compiler for damage, life, draw, mill, destroy/exile/bounce, counter, ritual mana, simple tokens, untargeted ETBs, and +N/+N anthems.
- `{T}: Add {M}`, `{T}: Add {G} or {U}`, and `{T}: Add one mana of any color`. Command Tower color identity is not enforced.
- `{N}, {T}:` activated abilities using those same effects.
- Hybrid `{R/W}` pips pay either color. Dual lands tap for one chosen color instead of both.
- Battlefield color picker for any-color and or-choice lands.
- Unrecognized sentences stay as compile notes.

### Tests Run

- `npm test` — PASS (233 tests)
- `npm run typecheck` — PASS
- `npm run lint` — PASS
- `npm run build` — PASS

### Results

- Lightning Bolt deals 3 to any target. Command Tower asks for a color. Breeding Pool is G or U, not both. Jayemdae Tome `{4}, {T}: Draw a card` activates.

### Decisions Made

- Pattern match, do not NLP. Leftovers are notes, not guesses.
- Any-color lands ignore commander identity for now (noted).
- Until-end-of-turn, modal, search, Phyrexian, and `{X}` remain uncompiled.
- Private alpha remains later.

### Files Changed

- `engine/src/oraclePatterns.ts`, `engine/src/oracle.ts`, `engine/src/oracle.test.ts`, `engine/src/mana.ts`, `engine/src/mana.test.ts`, `engine/src/manaOptions.ts`
- `engine/src/types.ts`, `engine/src/createGame.ts`, `engine/src/serialize.ts`, `engine/src/actions.ts`, `engine/src/effects.ts`, `engine/src/visibility.ts`, `engine/src/index.ts`
- `client/src/ui/Battlefield.tsx`, `client/src/App.test.tsx`, `server/src/cards.test.ts`
- `docs/DEVELOPMENT_PROGRESS.md`, `docs/RULES_COVERAGE.md`, `docs/UNSUPPORTED_INTERACTIONS.md`, `docs/ARCHITECTURE.md`

### Checkpoint

- PASS (local verification). Tag when requested: `checkpoint-35-oracle-compiler`
- Existing tags were not moved or rewritten.

### Next Task

Stop. Do not start a full English parser, temporary modifiers, or private alpha.
