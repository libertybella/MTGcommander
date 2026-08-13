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

**Current Phase:** Phase 12 complete — awaiting review
**Current Checkpoint:** Checkpoint 12 — Playable Loop
**Overall Status:** 🟡 In Progress

### Current Objective

Stop. Do not start targeting, Battlefield UI, deck import, or real-card integration until Checkpoint 12 is reviewed.

### Last Completed Milestone

Phase 12: Playable-loop engine gaps — land play, draw step, 0 life, concede, and elimination handling.

### Next Milestone

Targeting (choose targets on cast, legality at cast and resolve). Battlefield UI and deck import remain later.

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
* 🟢 Synthetic basic land test fixture only (no real-card database).
* 🟢 Checkpoint 12 — Playable Loop.

Battlefield UI was previously listed as Phase 12. It remains later, after targeting and this playable loop.

## Phase 13 — Two-Client Realtime

* ⬜ Create room.
* ⬜ Join room.
* ⬜ Synchronize game state.
* ⬜ Synchronize actions.
* ⬜ Reconnect.
* ⬜ Checkpoint 13 — Two Computers.

## Phase 14 — Four-Player Multiplayer

* ⬜ Four-player room.
* ⬜ Four identities.
* ⬜ Public information.
* ⬜ Hidden information.
* ⬜ Four-player turns.
* ⬜ Four-player priority.
* ⬜ Four-player combat.
* ⬜ Concession.
* ⬜ Checkpoint 14 — Four Real Players.

## Phase 15 — Card Ability Architecture

* ⬜ Event system.
* ⬜ Trigger system.
* ⬜ Effect system.
* ⬜ Choice system.
* ⬜ Draw.
* ⬜ Damage.
* ⬜ Life gain/loss.
* ⬜ Zone movement.
* ⬜ Sacrifice.
* ⬜ Discard.
* ⬜ Mill.
* ⬜ Counters.
* ⬜ Tokens.
* ⬜ Search.
* ⬜ Targeting.
* ⬜ Checkpoint 15 — Reusable Card Mechanics.

## Phase 16 — Keywords

* ⬜ Flying.
* ⬜ Reach.
* ⬜ Haste.
* ⬜ Vigilance.
* ⬜ Trample.
* ⬜ Deathtouch.
* ⬜ Lifelink.
* ⬜ First strike.
* ⬜ Double strike.
* ⬜ Menace.
* ⬜ Hexproof.
* ⬜ Indestructible.
* ⬜ Ward.
* ⬜ Flash.
* ⬜ Defender.
* ⬜ Checkpoint 16 — Keyword System.

## Phase 17 — Continuous Effects

* ⬜ Base characteristics.
* ⬜ Counters.
* ⬜ Static effects.
* ⬜ Temporary modifiers.
* ⬜ Derived characteristics.
* ⬜ Checkpoint 17 — Derived State.

## Phase 18 — Triggered Abilities

* ⬜ Event detection.
* ⬜ Trigger creation.
* ⬜ Stack insertion.
* ⬜ Choices.
* ⬜ Simultaneous triggers.
* ⬜ Trigger ordering.
* ⬜ Checkpoint 18 — Trigger System.

## Phase 19 — Replacement Effects

* ⬜ Replacement-effect model.
* ⬜ Event modification.
* ⬜ Draw replacement.
* ⬜ Damage replacement.
* ⬜ Multiple replacements.
* ⬜ Checkpoint 19 — Replacement Effects.

## Phase 20 — Advanced Rules

* ⬜ Rules coverage document.
* ⬜ Advanced continuous effects.
* ⬜ Layers.
* ⬜ Copy effects.
* ⬜ State-based actions.
* ⬜ Advanced targeting.
* ⬜ Checkpoint 20 — Rules Coverage.

## Phase 21 — 20-Card Engine

* ⬜ Representative card pool.
* ⬜ Test deck.
* ⬜ Complete game.
* ⬜ Unsupported interaction log.
* ⬜ Checkpoint 21 — 20-Card Magic.

## Phase 22 — Arena-Like UX

* ⬜ Card animations.
* ⬜ Card zoom.
* ⬜ Stack visualization.
* ⬜ Priority indicator.
* ⬜ Combat UI.
* ⬜ Target highlighting.
* ⬜ Mana display.
* ⬜ Game log.
* ⬜ Checkpoint 22 — UX Validation.

## Phase 23 — Persistence & Reconnect

* ⬜ Persist game metadata.
* ⬜ Persist/recover state.
* ⬜ Reconnect player.
* ⬜ Restore player view.
* ⬜ Browser refresh recovery.
* ⬜ Checkpoint 23 — Reconnect.

## Phase 24 — Security

* ⬜ Server validation.
* ⬜ Illegal-action rejection.
* ⬜ Life protection.
* ⬜ Mana protection.
* ⬜ Zone protection.
* ⬜ Hidden-card protection.
* ⬜ Malicious-client tests.
* ⬜ Checkpoint 24 — Security.

## Phase 25 — Hidden Information

* ⬜ Private hand view.
* ⬜ Hidden library.
* ⬜ Hidden face-down cards.
* ⬜ Player-specific game view.
* ⬜ Checkpoint 25 — Information Security.

## Phase 26 — Card Database

* ⬜ Card schema.
* ⬜ Data ingestion.
* ⬜ Local cache.
* ⬜ Card search.
* ⬜ Data updates.
* ⬜ Error handling.
* ⬜ Checkpoint 26 — Card Database.

## Phase 27 — Rules Expansion

* ⬜ Rules coverage matrix.
* ⬜ Mechanics expansion.
* ⬜ Regression tests.
* ⬜ Multiplayer regression tests.
* ⬜ Unsupported interaction documentation.
* ⬜ Checkpoint 27 — Rules Expansion.

## Phase 28 — Real Commander Decks

* ⬜ Ross's real deck.
* ⬜ Friend's deck.
* ⬜ Repeated games.
* ⬜ Unsupported-card tracking.
* ⬜ Engine fixes.
* ⬜ Checkpoint 28 — Real Deck Validation.

## Phase 29 — Game Log / Replay

* ⬜ Game events.
* ⬜ Readable game log.
* ⬜ Event IDs.
* ⬜ Reproduction data.
* ⬜ Replay foundation.
* ⬜ Checkpoint 29 — Reproducible Games.

## Phase 30 — Performance

* ⬜ CPU measurement.
* ⬜ Memory measurement.
* ⬜ Network measurement.
* ⬜ Payload measurement.
* ⬜ Concurrent-game test.
* ⬜ Checkpoint 30 — Reliability.

## Phase 31 — Private Alpha

* ⬜ Invite testers.
* ⬜ Complete games.
* ⬜ Bug tracking.
* ⬜ UX feedback.
* ⬜ Desync tracking.
* ⬜ Unsupported-card tracking.
* ⬜ Checkpoint 31 — Private Alpha.

## Phase 32 — Productization

* ⬜ Product identity.
* ⬜ IP/legal review.
* ⬜ Hosting/security review.
* ⬜ Distribution strategy.
* ⬜ Documentation.
* ⬜ Checkpoint 32 — Release Decision.

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


