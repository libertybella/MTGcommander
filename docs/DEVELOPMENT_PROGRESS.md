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

**Current Phase:** Phase 2 — Core Game-State Model
**Current Checkpoint:** Checkpoint 2 — Game State Exists Without UI
**Overall Status:** ⚠️ Needs Review

### Current Objective

Checkpoint 2 data model is implemented and verified. Waiting for review before Phase 3 (zone movement).

### Last Completed Milestone

Phase 2: serializable GameState in `@mtgcommander/engine` with 2–4 player factories and JSON round-trip tests. No rules engine.

### Next Milestone

Phase 3 — Zone Engine, only after Checkpoint 2 is approved.

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

* ⬜ Library.
* ⬜ Hand.
* ⬜ Battlefield.
* ⬜ Graveyard.
* ⬜ Exile.
* ⬜ Command Zone.
* ⬜ Stack.
* ⬜ Zone movement.
* ⬜ Card identity/integrity tests.
* ⬜ Checkpoint 3 — Zone Integrity.

## Phase 4 — Turn Engine

* ⬜ Turn order.
* ⬜ Untap.
* ⬜ Upkeep.
* ⬜ Draw.
* ⬜ Main phases.
* ⬜ Combat phases.
* ⬜ End step.
* ⬜ Cleanup.
* ⬜ Automated multi-turn simulation.
* ⬜ Checkpoint 4 — Turn Structure.

## Phase 5 — Priority & Stack

* ⬜ Priority.
* ⬜ Pass priority.
* ⬜ Stack objects.
* ⬜ Spell casting.
* ⬜ Resolution.
* ⬜ Responses.
* ⬜ Counterspell test.
* ⬜ Checkpoint 5 — Stack.

## Phase 6 — Mana

* ⬜ Mana pool.
* ⬜ Colored mana.
* ⬜ Generic mana.
* ⬜ Tap/untap.
* ⬜ Mana production.
* ⬜ Mana costs.
* ⬜ Illegal payment rejection.
* ⬜ Checkpoint 6 — Mana.

## Phase 7 — Combat

* ⬜ Attackers.
* ⬜ Blockers.
* ⬜ Combat damage.
* ⬜ Lethal damage.
* ⬜ Creature death.
* ⬜ Player damage.
* ⬜ Multiple attackers/blockers.
* ⬜ Checkpoint 7 — Combat.

## Phase 8 — Commander

* ⬜ 40 life.
* ⬜ Commander zone.
* ⬜ Commander tax.
* ⬜ Commander cast tracking.
* ⬜ Commander damage.
* ⬜ Commander-specific UI.
* ⬜ Checkpoint 8 — Commander Initialization.

## Phase 9 — Deck Import

* ⬜ Decklist text import.
* ⬜ Card data lookup.
* ⬜ 100-card validation.
* ⬜ Commander validation.
* ⬜ Singleton validation.
* ⬜ Color identity validation.
* ⬜ Save deck.
* ⬜ Reload deck.
* ⬜ Checkpoint 9 — Real Deck Import.

## Phase 10 — Battlefield UI

* ⬜ Player panels.
* ⬜ Battlefield.
* ⬜ Hand.
* ⬜ Graveyard.
* ⬜ Exile.
* ⬜ Command zone.
* ⬜ Stack.
* ⬜ Priority display.
* ⬜ Card selection.
* ⬜ Checkpoint 10 — UI Mirrors Engine.

## Phase 11 — Two-Client Realtime

* ⬜ Create room.
* ⬜ Join room.
* ⬜ Synchronize game state.
* ⬜ Synchronize actions.
* ⬜ Reconnect.
* ⬜ Checkpoint 11 — Two Computers.

## Phase 12 — Four-Player Multiplayer

* ⬜ Four-player room.
* ⬜ Four identities.
* ⬜ Public information.
* ⬜ Hidden information.
* ⬜ Four-player turns.
* ⬜ Four-player priority.
* ⬜ Four-player combat.
* ⬜ Concession.
* ⬜ Checkpoint 12 — Four Real Players.

## Phase 13 — Card Ability Architecture

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
* ⬜ Checkpoint 13 — Reusable Card Mechanics.

## Phase 14 — Keywords

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
* ⬜ Checkpoint 14 — Keyword System.

## Phase 15 — Continuous Effects

* ⬜ Base characteristics.
* ⬜ Counters.
* ⬜ Static effects.
* ⬜ Temporary modifiers.
* ⬜ Derived characteristics.
* ⬜ Checkpoint 15 — Derived State.

## Phase 16 — Triggered Abilities

* ⬜ Event detection.
* ⬜ Trigger creation.
* ⬜ Stack insertion.
* ⬜ Choices.
* ⬜ Simultaneous triggers.
* ⬜ Trigger ordering.
* ⬜ Checkpoint 16 — Trigger System.

## Phase 17 — Replacement Effects

* ⬜ Replacement-effect model.
* ⬜ Event modification.
* ⬜ Draw replacement.
* ⬜ Damage replacement.
* ⬜ Multiple replacements.
* ⬜ Checkpoint 17 — Replacement Effects.

## Phase 18 — Advanced Rules

* ⬜ Rules coverage document.
* ⬜ Advanced continuous effects.
* ⬜ Layers.
* ⬜ Copy effects.
* ⬜ State-based actions.
* ⬜ Advanced targeting.
* ⬜ Checkpoint 18 — Rules Coverage.

## Phase 19 — 20-Card Engine

* ⬜ Representative card pool.
* ⬜ Test deck.
* ⬜ Complete game.
* ⬜ Unsupported interaction log.
* ⬜ Checkpoint 19 — 20-Card Magic.

## Phase 20 — Arena-Like UX

* ⬜ Card animations.
* ⬜ Card zoom.
* ⬜ Stack visualization.
* ⬜ Priority indicator.
* ⬜ Combat UI.
* ⬜ Target highlighting.
* ⬜ Mana display.
* ⬜ Game log.
* ⬜ Checkpoint 20 — UX Validation.

## Phase 21 — Persistence & Reconnect

* ⬜ Persist game metadata.
* ⬜ Persist/recover state.
* ⬜ Reconnect player.
* ⬜ Restore player view.
* ⬜ Browser refresh recovery.
* ⬜ Checkpoint 21 — Reconnect.

## Phase 22 — Security

* ⬜ Server validation.
* ⬜ Illegal-action rejection.
* ⬜ Life protection.
* ⬜ Mana protection.
* ⬜ Zone protection.
* ⬜ Hidden-card protection.
* ⬜ Malicious-client tests.
* ⬜ Checkpoint 22 — Security.

## Phase 23 — Hidden Information

* ⬜ Private hand view.
* ⬜ Hidden library.
* ⬜ Hidden face-down cards.
* ⬜ Player-specific game view.
* ⬜ Checkpoint 23 — Information Security.

## Phase 24 — Card Database

* ⬜ Card schema.
* ⬜ Data ingestion.
* ⬜ Local cache.
* ⬜ Card search.
* ⬜ Data updates.
* ⬜ Error handling.
* ⬜ Checkpoint 24 — Card Database.

## Phase 25 — Rules Expansion

* ⬜ Rules coverage matrix.
* ⬜ Mechanics expansion.
* ⬜ Regression tests.
* ⬜ Multiplayer regression tests.
* ⬜ Unsupported interaction documentation.
* ⬜ Checkpoint 25 — Rules Expansion.

## Phase 26 — Real Commander Decks

* ⬜ Ross's real deck.
* ⬜ Friend's deck.
* ⬜ Repeated games.
* ⬜ Unsupported-card tracking.
* ⬜ Engine fixes.
* ⬜ Checkpoint 26 — Real Deck Validation.

## Phase 27 — Game Log / Replay

* ⬜ Game events.
* ⬜ Readable game log.
* ⬜ Event IDs.
* ⬜ Reproduction data.
* ⬜ Replay foundation.
* ⬜ Checkpoint 27 — Reproducible Games.

## Phase 28 — Performance

* ⬜ CPU measurement.
* ⬜ Memory measurement.
* ⬜ Network measurement.
* ⬜ Payload measurement.
* ⬜ Concurrent-game test.
* ⬜ Checkpoint 28 — Reliability.

## Phase 29 — Private Alpha

* ⬜ Invite testers.
* ⬜ Complete games.
* ⬜ Bug tracking.
* ⬜ UX feedback.
* ⬜ Desync tracking.
* ⬜ Unsupported-card tracking.
* ⬜ Checkpoint 29 — Private Alpha.

## Phase 30 — Productization

* ⬜ Product identity.
* ⬜ IP/legal review.
* ⬜ Hosting/security review.
* ⬜ Distribution strategy.
* ⬜ Documentation.
* ⬜ Checkpoint 30 — Release Decision.

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

