# M6 workstreams — parallelizing the compile-rate grind

Goal M6: **≥95% of the EDHREC top-2,000 compiles fully** (currently 44.3% =
889/2,009). The remaining ~1,120 cards partition by *machinery theme*, not by
percentage — a chunk's yield is only known once implemented, so these six
streams are the unit of parallel work. Each stream touches a mostly-distinct
engine surface, which keeps real merge conflicts rare; the shared append-only
files (`types.ts` unions, `serialize.ts` parsers, `oraclePatterns.ts`
clauses, `rulesSprint.test.ts`) conflict *mechanically* (both sides added
lines — keep both), not semantically.

Work flows as **short-lived branches** (one wave-sized unit each, days not
weeks) merged into the integration branch as soon as CI is green. Claim a
cluster before starting it (GitHub issue per cluster once the repo flow is
live). Read CONTRIBUTING.md first — it documents the traps.

Snapshot data: one-away report of 2026-08-21, 1,106 cards one note away,
516 compiling nothing yet.

## Stream A — Keyword lowering

Self-contained keyword mechanics, each unlocking a card cluster. Mostly
compiler + one contained engine feature per keyword.

- **Convoke** (6): Bennie Bracks, Hoarding Broodlord, Hour of Reckoning,
  City on Fire, Clever Concealment, Lethal Scheme. Cast-payment surgery:
  tap untapped creatures to cover the generic shortfall. Watch out — the
  cluster bundles extra hard lines (connive rider, phasing, damage
  tripling); only some members flip from convoke alone.
- **Spree** (4): Lively Dirge, Return the Favor, Smuggler's Surprise, Great
  Train Heist. (Spree exists as extra-cost modes; these need mode-body
  clauses.)
- **Hideaway** (3): Windbrisk Heights, Spinerock Knoll, Mosswort Bridge.
  ETB exile-face-down + condition-gated free play. Needs per-turn tallies
  (attackers this turn, opponent life lost this turn, total power).
- **Multikicker** (2): Everflowing Chalice, Comet Storm. Kick-count
  tracking on the cast; charge counters / X damage from the count.
- **Rebound** (2): Ephemerate, Quantum Misalignment. Resolve-to-exile,
  free recast at next upkeep.
- **Evolve** (2): Fathom Mage, Pollywog Prodigy. Enter-watch comparing
  subject power/toughness to the watcher — but both cards need second
  lines too (counter-added event; power-capped cast head).
- **Improvise** (2): Kappa Cannoneer, Organic Extinction. Artifact-tap
  cost help (convoke's artifact sibling — share the machinery).
- **Living weapon** (2): Nettlecyst, Kaldra Compleat. ETB Germ token +
  self-attach.
- **Dethrone, split second, compleated, cascade-doubling, delirium** (1
  each): Scourge of the Throne, Legolas's Quick Reflexes / Angel's Grace,
  Vraska Betrayal's Sting, Call Forth the Tempest, Dragon's Rage Channeler.
- **Station** (7): the Edge of Eternities cycle. Fringe cards; a large
  mechanic (charge-counter stations). Lowest priority in this stream.

## Stream B — Modal & choice machinery

One new engine surface (a choose-trigger-mode prompt, plus an
opponent-chooses prompt) unlocks several clusters.

- **Modal dies/enters triggers** (4+): Atsushi, Junji, Charming Prince,
  Aether Channeler, plus Landfall modal (Felidar Retreat, Retreat to
  Coralhelm) and dies-modal (Insidious Fungus, Cankerbloom sac-modal
  activations). Needs: choose_trigger_mode prompt; per-card effects
  (extended-duration impulse, nonSubtypes graveyard reanimate, delayed
  end-step battlefield return).
- **Confluences** (2): Fiery/Mystic Confluence — "choose three; you may
  choose the same mode more than once."
- **Opponent chooses** (1+): Fact or Fiction (opponent separates piles).
- **Gift** (4): Parting Gust, Into the Flood Maw, Dawn's Truce, Long
  River's Pull — a promise chosen at cast, granted to an opponent.

## Stream C — Replacement effects

The engine has replacement scaffolding (doublers, bonus counters,
enters-tapped); these extend it.

- **Academy Manufactor**: token-creation replacement (Clue/Food/Treasure
  trio). High EDHREC frequency.
- **Sylvan Library**: draw-step replacement with payment choice.
- **Damage tripling**: City on Fire (pairs with convoke in stream A).
- **Waste Not** (1): opponent-discard watchers (event exists?) + type-keyed
  effects.
- **"You don't lose unspent red mana"** (2): Electro, Ashling — pool
  persistence flags.
- **Enters-tapped-unless variants** (2): Ba Sing Se, Fire Nation Palace
  ("unless you control a basic land").

## Stream D — Zone & duration machinery

- **Extended impulse durations**: "until the end of your next turn"
  (Atsushi mode 1 — shared with stream B; exilePlayable entries need an
  expiry keyed to a player's turn).
- **Sagas**: the biggest documented gap (Urza's Saga is the #1 top-2,000
  miss). Chapter counters, per-chapter triggers, sacrifice at final
  chapter.
- **Phasing**: Clever Concealment (stream A overlap), Eerie Interlude
  (mass flicker-until-end-step), Teferi's Protection eventually.
- **Exile-matters**: One with the Multiverse, cast-from-exile grants.

## Stream E — Cost & mana machinery

- **Dynamic self-discounts** (4): Metalwork Colossus, Excalibur ("{X} less,
  X = total mv of artifacts you control"), The Great Henge, Skullspore
  Nexus ("X = greatest power").
- **Phyrexian mana payment**: unblocks Drivnod's activated ability, K'rrik
  eventually; currently "cannot be paid" only for pure-Phyrexian costs.
- **"Spend this mana only on…" restrictions**: Ancient Tomb-adjacent
  restricted pools.
- **Bolas's Citadel**: cast from library top paying life.
- **Vivi Ornitier / Westvale Abbey / Mycosynth Gardens** (1 each): odd
  activated-ability costs (X-combination mana, transform-on-activate,
  becomes-a-copy activation).

## Stream F — One-away clause grinding

Pure compiler pattern work: pick buckets off the one-away report, verify
real oracle text, add clauses, no or minimal engine machinery. Best lane
for onboarding; nearly conflict-free. Current examples: Ponder's "You may
shuffle", Soul's Attendant's "you may gain 1 life", Archaeomancer's
instant/sorcery graveyard return, Muddle the Mixture's counterspell,
Elspeth's −3, Veil of Summer's opponent-cast condition, Meren's experience
counters, d20 dragons (Copper first — Treasures = roll). Regenerate the
report each session:
`server/src/tmpOneAway.test.ts` pattern in CONTRIBUTING.md.

## Sequencing notes

- Streams are independent, but B unblocks parts of A (Lethal Scheme) and
  D unblocks parts of B (Atsushi). Fine to work them in any order —
  partial flips still shrink notes.
- The compile-rate CI check asserts the rate never *decreases*; two
  streams merging in either order both add their flips.
- Around ~80% expect a milestone review: the tail likely includes cards
  whose "documented approximation" boundaries need revisiting to count as
  fully compiled.
