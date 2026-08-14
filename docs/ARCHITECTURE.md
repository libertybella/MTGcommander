# BizzyMTG Commander — Architecture

This document records **architectural principles** and the **V1 architecture decision**.

**Related documents**

- Product scope: [`PROJECT_SPEC.md`](./PROJECT_SPEC.md)
- Tracker: [`DEVELOPMENT_PROGRESS.md`](./DEVELOPMENT_PROGRESS.md)

---

## V1 Architecture Decision (2026-08-13)

Ross will host private games on his PC. Friends may install software. V1 must stay free. The engine must stay movable to a cloud host later. No accounts. Do not use the sibling Electron deck builder as a foundation.

### Chosen V1 shape

```text
Friends' PCs                         Ross's PC (authoritative host)
┌─────────────────────┐              ┌──────────────────────────────┐
│ Electron shell      │              │ Node game server             │
│  + React/Vite UI    │  WebSocket   │  + TypeScript game engine    │
│  (Join)             │◄────────────►│                              │
└─────────────────────┘              └──────────────────────────────┘
                                              ▲
                                     Same Electron app
                                     can also Join locally
                                     and start Host
```

### Chosen technologies

| Layer | V1 choice | Why |
| --- | --- | --- |
| Language | TypeScript | One language for engine, server, and UI; strong tests |
| Game engine | Pure TypeScript module (`engine/`) | No React, DOM, Electron, or Node networking inside the rules |
| Authority host | Node.js process on Ross’s PC (`server/`) | Free; same process can later run on a VPS |
| Realtime | WebSockets | Bidirectional; fits priority/stack; same protocol if we move to cloud |
| Client UI | React + Vite (`client/`) | UI as a projection; can later be opened in a browser if we want |
| Installable app | Electron wrapping the Vite client | Friends install one app; Host or Join |
| Auth | None | Display name + room code only |
| Persistence | In-memory game state for V1 | No database, no Supabase |
| Deck import | Plain-text lists + Moxfield links | Archidekt / Arena export later |
| Card data | Cached Scryfall `OracleCard`s compiled to `CardDefinition`; synthetic fixtures remain for engine tests | Engine must not call live APIs during an action |
| Accounts / cloud DB / Next.js / Supabase | **Not used in V1** | Wrong fit for a free PC-hosted private game |

### How friends connect (free)

The server listens on Ross’s PC (for example `ws://<host>:port`).

V1 does **not** include paid cloud game hosting. Friends reach the host by one of:

1. **Same network / LAN** (simplest).
2. **Tailscale** (recommended for friends in other houses; free for personal use; everyone installs Tailscale and joins Ross’s network).
3. **Manual port forwarding** (optional; depends on the ISP).

The game protocol should only need a host address, a room code, and a display name. It must not assume Tailscale specifically.

### What we explicitly did not choose

- **Next.js** — extra web-hosting machinery; does not help a PC-hosted game server.
- **Supabase** — accounts and hosted Postgres are out of V1.
- **Browser-only V1** — possible later (the React client can be reused); not required now because friends will install an app and we are not paying for a public URL.
- **Copying the sibling BizzyMTG Electron deck builder** — separate project; do not import or fork it.

### Portability rule

`engine/` must remain runnable in tests with no Electron and no WebSockets.

`server/` is the only process allowed to apply `GameAction`s to authoritative `GameState`.

If we later move hosting to the cloud, we keep `engine/` and `server/`, and optionally drop Electron in favor of the same React client in a browser.

---

## Current Repository State

`mtgCommander` is an independent project. The engine, a local `GameHost` in `server/`, and a React battlefield UI exist. The host is the only caller of `applyAction`. Scryfall oracle cards cache locally and compile into definitions. Moxfield URLs and pasted Commander lists can seat a 2-, 3-, or 4-player table. Local hotseat is optional. London mulligans run before the first turn. Electron can host a WebSocket table (port 8787, room code); friends join with a display name. Unjoined seats still auto-pass.

The sibling Electron deck builder is **out of scope**. This project must not import or depend on it.

---

## Intended Folder Layout

```text
mtgCommander/
  docs/
  engine/          Pure TypeScript rules + GameState; Vitest
  server/          GameHost + optional WebSocket GameServer (one room per host process)
  client/          React + Vite UI (projection of host.viewFor only)
  electron/        Thin desktop shell: start local table, host WS, or join
```

A small npm workspace (or equivalent) is appropriate so `engine` can be imported by `server` and tests without pulling in React.

Do not create additional product folders until a later phase needs them.

---

## Game Engine Independence

The Magic rules/game engine must be independent of the UI.

It should be possible to run the engine in automated tests without a browser.

The engine must not depend on:

- React
- DOM
- Electron
- browser APIs
- WebSockets
- file-system or network I/O

The engine is plain, testable logic. Clients display results. They do not become the rules.

---

## Server Authority

Ross’s PC runs the authoritative Node server for V1.

Clients request actions.

The engine determines whether those actions are legal and applies them.

Clients must not directly modify authoritative:

- life totals
- mana
- card locations
- turn order
- priority
- stack
- combat
- commander damage
- triggered abilities
- game legality
- card effects

---

## UI Projection

The UI displays game state and requests actions.

The UI should not contain the core Magic rules.

The UI should primarily:

1. Display game state (a player-specific view).
2. Accept player input.
3. Send requested game actions.
4. Display the resulting authoritative view.

---

## Card Definition vs Card Instance

Distinguish between:

```text
CardDefinition
```

and:

```text
CardInstance
```

A card definition describes what a card is.

A card instance represents a particular copy of that card inside a specific game.

Example:

```text
CardDefinition
    name: Sol Ring
    manaCost: {1}
    type: Artifact
    ...

CardInstance
    id: unique-game-instance-id
    definitionId: sol-ring
    ownerId: player-id
    zone: battlefield
```

Two Forests in the same game are two instances of one definition.

---

## Hidden Information

Players must not receive information they are not legally supposed to know.

The complete authoritative `GameState` must not be sent to every client.

Each player receives a player-specific view. For example:

- A player can see their own hand.
- Opponents see hand size, not card identities.
- Libraries are hidden except for public information.

The server filters views. The client must not be trusted to hide cards.

---

## V1 Rules Coverage (quality bar)

The engine should handle fundamentals:

- Turns and phases
- Priority
- Stack
- Mana
- Casting spells
- Creatures
- Combat
- Life totals
- Commander damage
- Commander zone
- Major zones (library, hand, battlefield, graveyard, exile, command, stack)

Unsupported cards and obscure interactions use a **manual override**. We do not attempt every Magic card in V1.

Long-term goal is Arena-like polish. We build toward that incrementally. First games may look simpler than Arena.

---

## Reusable Mechanics

Eventually support reusable mechanics such as:

```text
DRAW
DAMAGE
GAIN_LIFE
LOSE_LIFE
MOVE_ZONE
CREATE_TOKEN
ADD_COUNTER
REMOVE_COUNTER
TAP
UNTAP
SACRIFICE
DISCARD
SEARCH_LIBRARY
SHUFFLE
TARGET
```

rather than implementing every card as a unique hard-coded program.

Do not build this catalog before GameState, zones, turns, and the stack exist.

---

## What We Will Not Introduce in V1 Foundation

- Next.js
- Supabase
- Player accounts / authentication
- Paid cloud game hosting
- Kubernetes / microservices
- A 3D tabletop
- Shared code with the sibling deck builder
- GameState implementation before Phase 1 baseline exists

Keep the architecture clean, testable, and understandable.
