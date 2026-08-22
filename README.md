# BizzyMTG Commander

Unofficial PC-hosted multiplayer **Commander** client for Magic: The Gathering.

Friends join a private table on the host PC, import real decks, and play with a rules-aware engine. Unsupported cards are handled with a **table override** instead of breaking the game.

This is **not** Wizards of the Coast software. It is also **not** the sibling BizzyMTG deck-builder app.

**Repo:** [github.com/RossTurner85/MTGcommander](https://github.com/RossTurner85/MTGcommander)

---

## Status (August 2026)

| | |
| --- | --- |
| **Phase** | Comprehensive Rules machinery (layers, events, choices, permanents) + coverage flywheel |
| **Next** | Private alpha (invite friends, play complete games) |
| **Tests** | 914 passing; a 10,000-game random-action fuzz marathon gates checkpoint-45, 200-game burns gate every wave and 800+ burns gate every checkpoint tag |
| **Compile rate** | 93% of a 60-card real-staple sample compiles fully (CI floor 85%); 54.1% of the EDHREC top-2,000, up from 15.6% at the start of the 2026-08-20 flywheel run |
| **Installer** | `npm run dist` builds a one-click Windows installer (`release/BizzyMTG Commander Setup 0.1.0.exe`). |

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
| `npm run dist` | Windows NSIS installer in `release/` |

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
- Turns, priority with MTGO/Arena-style stops, yield modes, and full control (phase ladder in the UI)
- The stack, APNAP trigger ordering, an event bus (enters/dies/attacks/upkeep/gain-life triggers)
- A CR 613 layer engine: computed characteristics, granted keywords, Humility, until-end-of-turn effects
- Combat with 20 keywords plus ward and protection; first/double strike; evasion; restrictions
- Auras, Equipment, planeswalkers, token copies, transform, manifest (hidden face-down 2/2s)
- Modal spells, {X} with divided damage, Phyrexian mana, library search with shuffle
- Full state-based actions (legend rule, token cessation, lethal damage in the sweep)
- Hidden opponent hands and libraries; spectators; seat tokens for safe rejoins
- London mulligan; real-card import (refreshing Scryfall cache + Moxfield / text)
- Auto-tap for casting; WebSocket host/join with an engine version handshake
- Manual override for the documented gaps (usage is counted — it is the coverage metric)

---

## What testers should expect to override

Most of the old list now compiles (pumps, modal spells, search, `{X}`,
Phyrexian, equipment, auras, planeswalkers, ward, protection, face-down).
Still Override territory — see [docs/RULES_COVERAGE.md](docs/RULES_COVERAGE.md)
for the full list:

- Ring tempts, “play the exiled card this turn”, sagas, morph casting
- Damage prevention shields; trigger doubling (Panharmonicon, Roaming Throne)
- Old-templating X spells, landwalk; countering abilities on the stack
- Redirecting combat damage to planeswalkers
- (No longer on this list: Rhystic taxes, cycling, board wipes, tutors-to-top, Treasures, additional cast costs, saboteur draws, spell copies, token doubling, Curiosity triggers, flashback, storm, kicker, pillow-fort taxes, sacrifice costs, Clone-style permanent copies)

Compile notes show at import. Uncompiled cards still sit in the deck.

---

## Before private alpha

Do these before inviting friends:

1. Smoke a host/join game yourself (Electron host + a second client).
2. Join **every** seat, or they will auto-pass.
3. Give testers: Tailscale/LAN, port **8787**, room code, how to import a deck, how to Override.
4. Keep a bug list (GitHub Issues is fine). Track which cards needed override.

**Not required for this alpha:** animations, full English parser, accounts, cloud hosting, legal/productization. (An installer exists now — `npm run dist` — but running from source is fine too.)

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
| [NOTES.txt](NOTES.txt) | Plain-English thought process for collaborators |
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
| `checkpoint-37-foundations` | Structured characteristics, legal actions, fuzzer |
| `checkpoint-38-priority-stops` | Stops, yield modes, full control, APNAP |
| `checkpoint-39-layer-engine` | CR 613 layers, until-EOT effects, evasion |
| `checkpoint-40-event-bus` | Trigger events, completed SBAs, replacements |
| `checkpoint-41-choices-and-costs` | Search, modal, {X}, ward, protection |
| `checkpoint-42-permanent-types` | Auras, equipment, planeswalkers, manifest |
| `checkpoint-43-coverage-flywheel` | Compile-rate CI, registry, rulings corpus |
| `checkpoint-44-table-hardening` | Seat tokens, spectators, auto-tap |
| `checkpoint-45-measured-flywheel` | Installer, measured M6 gate, 10k-game marathon, sharded fuzzer |
| `checkpoint-46-coverage-machinery` | Cast/combat-damage triggers, cost reductions, token presets, cycling, chosen types |
| `checkpoint-47-tax-and-recursion` | Rhystic-style taxes, additional cast costs, top-tutors, graveyard recursion, mass damage |
| `checkpoint-48-computed-mana` | Granted mana abilities, Urborg land types, star P/T, flicker, may-pay effects |
| `checkpoint-49-spell-copies` | Spell copies on the stack (CR 707.10), subject-spell copy/counter cast triggers |
| `checkpoint-50-top-of-library` | Play/cast from the library top (Oracle of Mul Daya), changeling, free-spell cycle, reveal lands, filter lands |
| `checkpoint-51-damage-triggers` | Flashback, token/counter doubling, extra combats, proliferate, Curiosity any-damage triggers |
| `checkpoint-52-storm-and-kicker` | Storm, kicker as extra-cost modes, multi-sentence ability bodies, delayed end-step riders, fetch-sac lands |
| `checkpoint-53-thirty-percent` | Spree, one-away batches (exalted, affinity, flash grants, tribal anthems, gated/costed mana), 30% top-2,000 |
| `checkpoint-54-pillow-forts` | Attack taxes, sacrifice activation costs, Fling, Feign Death grants, "that much" life triggers, draw doubling |
| `checkpoint-55-leylines` | Leylines, windfalls, populate, token events, land/commander targets, basic-land search riders, 33% top-2,000 |
| `checkpoint-56-altars` | Overload, Offspring, Phyrexian Altar, −1/−1 counters, Mesmeric Orb untap events, Seedborn untap statics |
| `checkpoint-57-mutations` | Darksteel Mutation, Brawn graveyard statics, Gravecrawler, Jaheira, search watchers, tribal-count damage |
| `checkpoint-58-commands` | Austere Command, Padeem intervening-ifs, Green Sun's Zenith, Drakuseth up-to targets, Aurelia, 700 cards |
| `checkpoint-59-tallies` | Smothering Tithe, impulse digs, Otawara channels, batch triggers, turn tallies (Mahadi, Lotho), 35% |
| `checkpoint-60-primal` | Impulse exiles (Ragavan, Face-Breaker, Etali), dash, ascend, Boseiju, Wayward Swordtooth |
| `checkpoint-61-wills` | Anim Pakal, Boros Charm, Return of the Wildspeaker, Jeska's/Akroma's Will choose-both, planeswalker damage, protection grants, 36% |
| `checkpoint-62-taxes` | Reanimate, Toxic Deluge, Authority of the Consuls, land auras (Wild Growth/Utopia Sprawl), Hardened Scales, Chaos Warp, Exsanguinate, Land Tax |
| `checkpoint-63-magecraft` | Gray Merchant devotion, Syr Konrad, Guardian Project, Grand Abolisher, Rhythm of the Wild, Magecraft (Archmage/Storm-Kiln), Silence, REB/Pyroblast, 37.4% |
| `checkpoint-64-swat` | Bedevil, Rakdos Charm, Avenger of Zendikar, Sram, Urza's Incubator, Extort, Esper Sentinel, Mox Opal, Deflecting Swat retargeting, 38.3% |
| `checkpoint-65-plowshares` | Massacre Wurm, Rise of the Dark Realms, Beastmaster, Mobilize, Lab Maniac, Maze of Ith, Swords to Plowshares, Skullclamp, sample 90%, 39.5% |
| `checkpoint-66-divination` | Sun Titan, Craterhoof, Idol of Oblivion, Scute Swarm, Faerie Mastermind, Shadowspear, Springleaf Drum, Mox Amber, Bloom Tender, Sensei's Top, Mother of Runes, Grave Pact, Mayhem Devil, 41.0% |
| `checkpoint-67-fights` | Exotic Orchard, Reflecting Pool, Zulaport, the Swords cycle, Constellation, Welcoming Vampire, Nykthos, Casualties of War, Field of Ruin, Kogla, Apex Altisaur, real fights + Enrage, 42.2% |
| `checkpoint-68-clones` | Enter-as-copy clones (Spark Double, Phantasmal Image, Sakashima), Command Tower real color identity, Metallic Mimic chosen types, Prowess, Monastery Mentor, Kindred Dominance auto-typed sweeps, sample 93%, 43.7% |
| `checkpoint-69-rebounds` | Trigger doubling (Panharmonicon, Teysa), Enduring cycle returns, Caged Sun, Mirari's Wake, Elenda, Elspeth emblems, d20 Treasures, transmute, living weapon, rebound — plus the parallel-work layer (AGENTS.md, claims board, CI), 45.0% |
| `checkpoint-70-choices` | Modal triggers (Aether Channeler, Felidar Retreat, Atsushi, Junji, Charming Prince), self-discounts (Great Henge, Excalibur), evolve (Fathom Mage), discard watchers (Waste Not, Bone Miser), 45.7% |
| `checkpoint-71-gifts` | Modal activated abilities (Insidious Fungus, Eerie Interlude), dethrone + delirium + first-combat gates (Scourge of the Throne, Karlach), gated tutors + adapt (Weathered Wayfarer, Evolution Witness), the gift mechanic as promise/decline modes (Parting Gust, Into the Flood Maw), dual enters-or-dies triggers (Stitcher's Supplier), Lotus Cobra, Gamble, Ghostly Flicker, 46.9% |
| `checkpoint-72-ozolith` | Wheels and cheap edicts (Wheel of Fortune, Blasphemous Edict), every-type statics (Maskwood Nexus, Dryad of the Ilysian Grove, Mystic Forge, Realmwalker), fodder-powered mills (Altar of Dementia, Victimize, Culling Ritual, Plaguecrafter), board swaps and stack taxes (Living Death, Necropotence, Bolt Bend), surviving counters (The Ozolith, Banner of Kinship, Cloud Key, Puresteel Paladin), 48.2% |
| `checkpoint-73-halfway` | **Half the meta compiles.** Clue investigations (Tireless Tracker, Howling Mine, Greater Good), hand-only locks (Drannith Magistrate, Mental Misstep, Warstorm Surge, Kenrith's Transformation), reversals (Sculpting Steel, Narset's Reversal, Imp's Mischief, Goreclaw, Reflections of Littjara), and the crossing batch (Eladamri's Call, Ayara, Curse of the Swine, Reassembling Skeleton, Kaya's Ghostform), 50.1% — the session's handoff point |
| `checkpoint-74-grammars` | **The wave that stopped writing regexes.** Four hand-written copies of the "you control …" gate collapse into one, and the Verge land cycle plus Rivendell, Bonders' Enclave and Minas Tirith come with it. Then three grammars replace piles of fixed shapes: static grants (Akroma's Memorial, Elesh Norn, Avacyn, Intangible Virtue, Bastion Protector, Ethereal Armor), until-end-of-turn grants (Overrun, Overprotect, Tamiyo's Safekeeping, End-Raze Forerunners), and enters/dies trigger subjects (Kambal, Sheoldred, Cruel Celebrant, Marwyn, Starfield Mystic) — with granted ward (Lavaspur Boots, Winged Boots) and the drain body along the way, 52.7% |

| `checkpoint-75-grammars-ii` | **Five more grammars, and the bugs they flushed out.** Compound bodies split at a top-level conjunction when every half compiles (Undead Augur, Midnight Reaper); step triggers learn whose step they watch, with win conditions and generic ability-word stripping (Felidar Sovereign, Revel in Riches, Ophiomancer, Knuckles); "As long as …" splits into controller-gates and selector refinements (Serra Ascendant, Champion's Helm); subtype sweeps narrow as well as spare (Crux of Fate); and one search-descriptor fix compiled the whole Landscape cycle. Three latent bugs surfaced along the way — an `attached` selector that ignored every refinement, a `destroy_all` field the binder silently dropped, and a graveyard exile that bound to nobody, 54.1% |

These live on the `comprehensive-plan` branch (see docs/DEVELOPMENT_PROGRESS.md); merge to `main` at will — every checkpoint is a playable table. Next: **Private Alpha**, then productization.
