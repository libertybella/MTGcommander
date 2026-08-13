# BizzyMTG Commander — Project Specification

This document freezes V1 product scope. It is not an implementation plan and it does not select a technology stack.

**Related documents**

- Architecture principles: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Day-to-day tracker: [`DEVELOPMENT_PROGRESS.md`](./DEVELOPMENT_PROGRESS.md)

---

## Project Name

BizzyMTG Commander

---

## Purpose

Build an unofficial, Arena-like multiplayer Commander client for Magic: The Gathering.

The primary use case is allowing real-life friends to remotely play Commander together using their existing decks.

The long-term goal is to allow 2–4 real players to:

- Create private games.
- Invite friends.
- Import Commander decks.
- Play Commander using a rules-aware digital game engine.
- See a synchronized battlefield.
- Use priority and the stack.
- Track life and commander damage.
- Handle combat.
- Eventually support a large portion of Magic's card mechanics.
- Eventually provide an experience that feels much closer to MTG Arena than Cockatrice or Tabletop Simulator.

We are developing this incrementally with explicit checkpoints.

---

## Core Problem

Magic: The Gathering Arena does not currently provide the multiplayer Commander experience we want.

Existing alternatives such as Cockatrice and Tabletop Simulator solve parts of the problem but do not provide the polished, rules-aware, Arena-like experience we want.

---

## Target Users

Initially:

> A small group of real-life Commander players who want to play their existing decks remotely through a polished digital interface.

V1 is for friends in a private room, not a public player base.

---

## Target User Experience

The first complete loop we are aiming for (not yet implemented):

1. A host creates a private game.
2. Friends join that game.
3. Each player imports or selects a 100-card Commander deck.
4. The game starts with 40 life, commanders in the command zone, and shuffled libraries.
5. Players take turns with a recognizable Magic turn structure.
6. Players can draw, play lands, produce basic mana, cast basic spells, attack, block, and track commander damage.
7. Hidden information is respected (hands and libraries are not fully visible to opponents).
8. The game can end by concession or by a supported win condition (life or commander damage).
9. Unsupported interactions can be resolved with a manual override rather than breaking the game.

Until this loop exists, we do not expand into matchmaking, cosmetics, or public rooms.

**V1 join/host model (decided):** Ross hosts the authoritative game server on his PC. Friends install a desktop client, enter a display name and room code, and connect. No accounts. Connection over LAN or a free overlay network such as Tailscale. See `ARCHITECTURE.md`.

---

## V1 Goals

V1 should eventually support:

- 2–4 players.
- Private games.
- Room creation.
- Friend joining.
- Commander deck import.
- 40 starting life.
- Commander zone.
- Commander tax.
- Commander damage.
- Library.
- Hand.
- Battlefield.
- Graveyard.
- Exile.
- Stack.
- Turn structure.
- Priority.
- Basic mana.
- Basic spell casting.
- Basic combat.
- Realtime multiplayer.
- Server-authoritative game state.
- Hidden-information protection.
- Reusable card mechanics.
- Manual override for unsupported interactions.
- Deck import from **plain-text decklists** and **Moxfield links**.
- PC-hosted authority on Ross’s machine (free; no cloud required).

---

## V1 Non-Goals

Do **not** initially target:

- A complete Magic Arena replacement.
- Ranked matchmaking.
- Competitive matchmaking.
- An in-game economy.
- Card packs.
- Cosmetics.
- A mobile application.
- A 3D tabletop environment.
- AI opponents.
- Every Magic card.
- Perfect implementation of every Magic rules interaction.
- Large-scale public deployment.

These items must not drive premature architecture.

---

## Important Project Boundary

> The existing `BizzyMTG` Electron deck-builder application is a separate project. `mtgCommander` must not depend on it during initial development.

These two applications are independent:

```text
projects/BizzyMTG/BizzyMTG
└── Existing Electron deck builder
    └── SEPARATE PROJECT — do not modify, import, or link

projects/BizzyMTG/mtgCommander
└── New multiplayer Commander client
    └── CURRENT PROJECT
```

Do not import, link, or share code with the deck builder during V1.

Future integration may be considered later, but it is not part of V1 architecture.

---

## Legal / Product Notes

This is an unofficial fan project. It is not affiliated with Wizards of the Coast.

IP/legal review is a later productization item and must happen before any public release.

---

## V1 Product Decisions (2026-08-13)

| Topic | Decision |
| --- | --- |
| Join | Friends install a desktop client. Browser can be revisited later. |
| Authority | Ross’s PC hosts the server. Engine stays separate so a future cloud move is possible. |
| Accounts | None. Display name + room code. |
| First-game quality | Engine handles fundamentals (turns, priority, stack, mana, casting, creatures, combat, life, commander). Unsupported interactions use manual override. |
| Deck import | Plain-text lists and Moxfield links. Archidekt / Arena export later. |
| Cost | Keep V1 free. No paid hosting. |
| Pace | Nights and weekends. No hard deadline. |
| Sibling deck builder | Completely separate. No shared code in V1. |

Exact first representative card pool is still open (needed before Phase 19, not before GameState).

Stack details are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
