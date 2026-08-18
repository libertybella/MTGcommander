# BizzyMTG Commander

Unofficial PC-hosted multiplayer **Commander** client for Magic: The Gathering.

Friends join a private table on the host PC, import real decks, and play with a rules-aware engine. Unsupported cards are handled with a **table override** instead of breaking the game.

This is **not** Wizards of the Coast software. It is also **not** the sibling BizzyMTG deck-builder app.

**Repo:** [github.com/RossTurner85/MTGcommander](https://github.com/RossTurner85/MTGcommander)

---

## Status (August 2026)

| | |
| --- | --- |
| **Phase** | Playable imported Commander tables (oracle compile + override) |
| **Next** | Private alpha (invite friends, play complete games) |
| **Tests** | 331 passing |
| **Installer** | Not yet. Run from source with Electron. |

---

## Quick start

Needs Node 20+.

```text
npm install
npm test
npm run dev
```

Dev UI is on **http://localhost:5175**. Electron should open a window titled **BizzyMTG Commander**.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron |
| `npm test` | Vitest |
| `npm run typecheck` | TypeScript |
| `npm run lint` | oxlint |
| `npm run build` | Production client + Electron bundles |

---

## How a game works

1. **Host** starts a 2–4 player table (synthetic test decks, or import Moxfield / pasted Commander lists).
2. Optional: check **hotseat** to play every seat at one PC.
3. **Open table for friends** in Electron. Host listens on port **8787** with a room code.
4. Friends **Join table** with host IP, port `8787`, room code, and a display name.
5. London mulligan, then play: lands, mana, spells, combat, commander damage, concede.
6. If a card’s text is not compiled, use **Override** (life, draw, mill, mana, tap/untap, move a public card). Everyone sees it in the log.

Friends reach the host by **LAN** or **Tailscale**. There are no accounts.

**Important:** unjoined seats auto-pass. For a real 4-player game, all four seats must actually join (or use hotseat).

Moxfield URLs fetch in Electron. A plain browser tab should **paste the export** (CORS).

---

## What already works

- 2–4 player Commander: 40 life, command zone, tax, 21 commander damage
- Turns, priority, stack, one land per turn
- Combat, keywords (flying, trample, deathtouch, hexproof, etc.)
- Hidden opponent hands and libraries
- London mulligan
- Real-card import (Scryfall cache + Moxfield / text)
- Simple oracle compile: damage, taps, ETBs, begin-combat amass, Duress-style discard, Channel, modal DFCs (both faces)
- Activated abilities on the stack (mana taps and Channel stay off-stack)
- WebSocket host/join
- Manual override for the rest (in hotseat, options apply to the acting player)

---

## What testers should expect to override

These are **not** compiled yet. Use the Override panel:

- Until-end-of-turn pumps, modal spells, search, Phyrexian, `{X}`
- Equipment, auras, planeswalkers / loyalty
- Ring tempts, attack-trigger amass, “play the exiled card this turn”
- Ward, protection, layers, copy, face-down cards
- Countering abilities on the stack

Compile notes show at import. Uncompiled cards still sit in the deck.

---

## Before private alpha

Do these before inviting friends:

1. Smoke a host/join game yourself (Electron host + a second client).
2. Join **every** seat, or they will auto-pass.
3. Give testers: Tailscale/LAN, port **8787**, room code, how to import a deck, how to Override.
4. Keep a bug list (GitHub Issues is fine). Track which cards needed override.

**Not required for this alpha:** installer, animations, full English parser, accounts, cloud hosting, legal/productization.

---

## Layout

```text
engine/     Pure TypeScript rules. No React, Electron, or network.
server/     Only caller of applyAction. GameHost + WebSocket table.
client/     React + Vite battlefield (port 5175).
electron/   Desktop shell. Hosts the table on the PC.
docs/       Spec, architecture, tracker, rules coverage.
```

---

## Docs

| File | What it is |
| --- | --- |
| [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) | V1 product scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | PC-hosted architecture |
| [docs/DEVELOPMENT_PROGRESS.md](docs/DEVELOPMENT_PROGRESS.md) | Living tracker and log |
| [docs/RULES_COVERAGE.md](docs/RULES_COVERAGE.md) | What the engine does / does not do |
| [docs/UNSUPPORTED_INTERACTIONS.md](docs/UNSUPPORTED_INTERACTIONS.md) | Gaps testers will hit |

---

## Checkpoints

Git tags on `main`. Do not move old tags.

| Tag | Milestone |
| --- | --- |
| `checkpoint-01-project-foundation` … `checkpoint-31-player-tables` | Engine, UI, import, hotseat |
| `checkpoint-32-london-mulligan` | London mulligan |
| `checkpoint-33-websockets` | Host/join table |
| `checkpoint-34-activated-abilities` | Stacked activated abilities |
| `checkpoint-35-oracle-compiler` | Pattern compiler for real oracle text |
| `checkpoint-36-manual-override` | Table override |

Next numbered phases: **37 Private Alpha**, **38 Productization**.
