# Cluster claims board

The single source of truth for **who is working on what**, so no work is
duplicated and no branches collide. Lives on the integration branch
(`comprehensive-plan`); git serializes claims.

## The claim protocol

1. **Before writing any code**, pull the latest integration branch and
   check this table. Never start a cluster that is `claimed` or
   `in-progress` by someone else.
2. **To claim**: edit *only your row* (status, owner, branch, date), commit
   just this file with the message `Claim: <cluster> (<owner>)`, and push
   to the integration branch immediately. If the push is rejected, pull —
   someone may have claimed first; first commit wins, re-pick if you lost.
3. **One in-progress cluster per owner.** Finish (or release) before
   claiming the next.
4. **To finish**: your wave-merge commit also flips the row to `done` with
   the flip count and new compile rate in Notes.
5. **To release**: set the row back to `open` (say why in Notes). A claim
   with no commits on its branch for **7 days** may be released by anyone.
6. Agents identify as `claude/<session-or-task>`, humans by name. The
   Owner column is who to ping, so make it reachable (GitHub handle once
   the repo flow is live).
7. Rows are append-friendly: add newly discovered clusters under their
   stream with status `open`. Don't delete done rows — they are the
   history.

Full rules of engagement: [../AGENTS.md](../AGENTS.md). Machinery detail
per cluster: [WORKSTREAMS.md](WORKSTREAMS.md).

## Status board

Statuses: `open` · `claimed` · `in-progress` · `done` · `blocked`

| Cluster | Stream | Status | Owner | Branch | Updated | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Land-tap echo + Elenda + Grisly Salvage (Mirari's Wake, Vorinclex, Elenda ×2, Grisly Salvage) | E/F | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 123 merged: 5 flips, 894/2,009 (44.5%), 836 tests |
| Convoke + improvise | A | open | | | | Shared tap-to-pay machinery; see WORKSTREAMS caveats |
| Spree mode bodies | A | open | | | | |
| Hideaway trio | A | open | | | | Needs 3 per-turn tallies |
| Multikicker | A | open | | | | |
| Rebound | A | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Merged in wave 125 |
| Evolve (+ second lines) | A | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 129 merged: 2 flips (Fathom Mage, Pollywog Prodigy), counter_added event added — 917/2,009 (45.6%) |
| Living weapon | A | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 125 merged with rebound + tapped-unless-basic: 3 flips (Nettlecyst, Ephemerate, Quantum Misalignment), 905/2,009 (45.0%). Kaldra needs granted-trigger statics |
| Small keywords (dethrone, split second, compleated, delirium, cascade ×2) | A | open | | | | One card each |
| Station cycle | A | open | | | | Fringe cards; lowest priority |
| Modal trigger prompt + modal dies/enters cards | B | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Waves 126–127 merged: choose_trigger_mode machinery + 6 flips (Aether Channeler, Felidar Retreat, Retreat to Coralhelm, Atsushi, Junji, Charming Prince) — 911/2,009 (45.3%). Insidious Fungus/Cankerbloom (sac-modal ACTIVATED abilities) remain open under stream B |
| Sac-modal activated abilities + Eerie Interlude | B/D | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 131 merged: ActivatedAbility.modes + mass delayed blink, 3 flips (Insidious Fungus, Cankerbloom, Eerie Interlude) — 921/2,009 (45.8%) |
| Confluences (choose-with-repeats) | B | open | | | | |
| Opponent-chooses (Fact or Fiction) | B | open | | | | |
| Gift mechanic | B | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 134 merged: promise/decline mode pairs, 4 flips (Parting Gust, Into the Flood Maw, Dawn's Truce, Long River's Pull) — 938/2,009 (46.7%) |
| Academy Manufactor | C | open | | | | Token-creation replacement |
| Sylvan Library | C | open | | | | Draw-step replacement |
| Waste Not | C | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 130 merged: discards event + watchers, 2 flips (Waste Not, Bone Miser) — 918/2,009 (45.7%). Tergrid remains open |
| Mana persistence (Electro, Ashling) | C | open | | | | |
| Enters-tapped-unless-basic | C | open | | | | 2 lands |
| Sagas | D | open | | | | Urza's Saga is the #1 top-2,000 miss |
| Phasing (Clever Concealment, Eerie Interlude) | D | open | | | | |
| Extended impulse durations | D | open | | | | Shared with stream B (Atsushi) |
| Dynamic self-discounts (Colossus/Henge quartet) | E | done | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 128 merged: all four discounts compile; Great Henge + Excalibur flip (914/2,009 = 45.5%). Colossus still needs a graveyard sac-2 activation, Skullspore a dies-batch-total token — both rows below |
| Phyrexian mana payment | E | open | | | | Unblocks Drivnod's activated ability |
| Bolas's Citadel | E | open | | | | |
| One-away grinding (rotating buckets) | F | in-progress | claude/2daf8b18 | comprehensive-plan | 2026-08-21 | Wave 141 bucket: probing Greater Good, Howling Mine, Open the Armory, Idyllic Tutor, Dramatic Reversal, Reckless Fireweaver, Return to Nature, Tireless Tracker. Wave 140 bucket done (6 flips: Cloud Key, Banner of Kinship, Forgotten Ancient, The Ozolith, Puresteel Paladin + one pattern-share — 969/2,009 = 48.2%). Wave 139 bucket done (5 flips: Living Death, Tribute to the World Tree, Necropotence, Bolt Bend, Redirect Lightning — 963/2,009 = 47.9%). Probed but deferred: Dig Through Time (delve), Wishclaw Talisman (control handoff), Trouble in Pairs (extra-turn replacement), Underworld Breach (escape), Archdruid's Charm (conditional-destination tutor), Return the Favor (copy+retarget). Wave 138 bucket done (5 flips: Sanctum Weaver, Altar of Dementia, Victimize, Culling Ritual, Plaguecrafter — 959/2,009 = 47.7%). Probed but deferred: Banner of Kinship (per-counter team pump), Cloud Key (chosen card type), Torment of Hailfire (X-repeat). Wave 137 bucket done (5 flips: Dryad of the Ilysian Grove, Mystic Forge, Realmwalker, Maskwood Nexus, Kutzil — 954/2,009 = 47.5%). Probed but deferred: Puresteel Paladin (gated equip {0}), The Ozolith (counter transfer), Braids (opponent sac-or-suffer chain), Dauthi Voidwalker (graveyard replacement). Wave 136 bucket done (6 flips: Wheel of Fortune, All That Glitters, Mentor of the Meek, Second Harvest, Blasphemous Edict + one pattern-share — 949/2,009 = 47.2%). Probed but deferred: Cloud Key (chosen card type), Banner of Kinship (per-counter team pump), Torment of Hailfire (X-repeat opponent choices), Culling Ritual (mana per destroyed). Wave 135 bucket done (5 flips: Stitcher's Supplier, Lotus Cobra, Noxious Revival, Gamble, Ghostly Flicker — 943/2,009 = 46.9%). Probed but deferred: Victimize (resolution-cost sac), Plaguecrafter (each-player sac choice), Second Harvest (per-token copies), Forgotten Ancient (counter redistribution) |

## Done

| Cluster | Owner | Merged | Notes |
| --- | --- | --- | --- |
| Waves 1–122 (pre-parallelization) | claude + Liberty | through 767b206 | 15.6% → 44.3% (889/2,009), 833 tests, checkpoints 1–68 |
