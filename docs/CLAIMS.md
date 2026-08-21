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
| Gift mechanic | B | open | | | | 4 cards |
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
| One-away grinding (rotating buckets) | F | open | | | 2026-08-21 | Wave 132 bucket done (4 flips + strays: Dreadhorde, Karlach, Scourge, DRC — 928/2,009 = 46.2%). Next buckets open for anyone |

## Done

| Cluster | Owner | Merged | Notes |
| --- | --- | --- | --- |
| Waves 1–122 (pre-parallelization) | claude + Liberty | through 767b206 | 15.6% → 44.3% (889/2,009), 833 tests, checkpoints 1–68 |
