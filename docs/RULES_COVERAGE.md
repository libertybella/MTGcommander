# Rules Coverage (Engine through Checkpoint 45)

What the engine implements and what it intentionally does not. Tests are tagged with CR rule numbers; `docs/KEYWORD_COVERAGE.md` tracks the CR 702 keyword list. This is not a complete CR translation.

## The machinery (Comprehensive Plan stages 0–5)

- **Characteristics are computed, never stored.** Every definition carries parsed supertypes/types/subtypes/colors/manaValue (CR 205/203); battlefield queries run through a CR 613 layer engine (`characteristicsEngine.ts`) applying layers 4 (types), 5 (colors), 6 (ability grants/removals/combat restrictions), 7b/7c (P/T set/modify) and 7d (+1/+1 counters) in timestamp order. Humility silences keywords, statics, triggers, mana, and activated abilities; anthem-vs-Humility resolves by layer regardless of arrival order. CR 613.8 dependency is **not** implemented.
- **Until-end-of-turn effects** live in `GameState.activeEffects` with affected sets locked at resolution (CR 611.2c) and are swept during cleanup (CR 514.2).
- **Priority is the MTGO/Arena model.** Per-seat stops (my turn / opponents' turns), `stops-only` vs `smart` yield (smart pauses only when `legalActions` says the seat could act — note this leaks "I have nothing"; stops-only is the default), and full control. Seat stops shrink the digital step-skip policy. APNAP simultaneous-trigger ordering with an `order_triggers` choice (CR 101.4, 603.3b).
- **An event bus** dispatches enters, dies, attacks, step-begins, and gains-life events to watching triggers with scopes (self/controlled/any), subject filters, and exclude-self. Simultaneous SBA deaths dispatch as one batch, so dies-watchers that died together still see each other (CR 603.10a — the Blood Artist ruling).
- **State-based actions** (CR 704): 0 life / commander damage / failed draw eliminate; 0 toughness and lethal or deathtouch damage destroy in the sweep (a pump can save a damaged creature); the legend rule keeps the newest copy (controller choice is a documented simplification); loose Auras die and Equipment detaches; zero-loyalty planeswalkers die; tokens cease to exist after their dies-triggers fire.
- **Replacements**: skip-draw, enters-tapped families (including slow-land "two or fewer other lands" and crowd-land "two or more opponents" conditions), shock-land life prompts, and Rest in Peace-style graveyard→exile (which suppresses dies triggers and applies to its own demise). Full CR 616 multi-replacement ordering choice is **not** implemented.
- **Casting**: modal "Choose one —" spells (one mode, per-mode targets), announced {X} (stored on the stack, readable by effects), divided damage validated to total X with illegal targets losing their share (CR 608.2b), Phyrexian pips paying mana or 2 life (CR 107.4f), hybrid pips, commander tax, flash timing.
- **Targeting**: creatures/players/opponents/spells/creature- and noncreature-spells/own creatures/any permanent, variable "any number of targets", color exclusions ("nonblack"), shroud, hexproof, protection-from-colors (targeting + damage prevention + blocking), and ward {N} as a pay-or-countered pause. Targets recheck at resolution; empty means fizzle.
- **Search** (CR 701.19): filtered library searches (supertype/type/subtype, any-of lists) to battlefield (tapped) / hand / graveyard with fail-to-find, shuffling on resolution; Cultivate-style split destinations; sacrifice-cost fetch lands resolving without a priority round.
- **Permanent types**: Auras enter attached and fizzle to the graveyard without a target; Equipment compiles "Equip {N}" into a sorcery-speed attach and survives its host; planeswalkers enter with loyalty, activate one loyalty ability per turn at sorcery speed, and die at zero; token copies share the printed definition (so lords pump them); transform flips to the linked face; manifest puts the top card down as a hidden 2/2 that turns up for its creature cost mid-combat (CR 708).
- **Combat**: attack/damage two-step for first/double strike, trample, deathtouch (as an SBA), lifelink, evasion (flying/reach, menace, fear, intimidate, horsemanship, shadow, skulk), protection, can't-attack/block/be-blocked restrictions, commander damage.
- **Keywords implemented**: 20 of the CR 702 list as engine keywords, plus parameterized ward and protection — see `docs/KEYWORD_COVERAGE.md`.
- **Mana**: pools, hybrid, Phyrexian, {X}, multi-mana any-one-color abilities (Gilded Lotus), pain lands, color pickers, and an Arena-style auto-tapper (`autoTapPlan`) the client uses before casts and activations.
- **Turn structure extras**: the cleanup step discards down to maximum hand size (CR 514.1), suspended by "no maximum hand size" permanents; land-drop allowance sums "additional land" statics (Exploration); "Activate only as a sorcery" riders and "This spell can't be countered" are honored; Karoo bounce lands prompt for the land to return.
- **Cast triggers**: a `casts` event fires when a spell hits the stack (Guttersnipe, Rhystic Study) with you/opponent/any scopes and creature / noncreature / instant-or-sorcery / artifact / enchantment filters.
- **Board wipes and wide removal**: `destroy_all` sweeps with batched simultaneous dies (indestructible respected); artifact / enchantment / either / nonland-permanent / creature-or-planeswalker target kinds.
- **Cost-reduction statics** (CR 601.2f): medallions and type-filtered discounts shrink the generic portion after commander tax, in both legality checks and payment.
- **Predefined tokens**: Treasure (sacrifice-on-tap any-color mana; never auto-tapped), Clue, and Food carry their printed abilities however they are created.
- **Once-per-turn triggers** ("triggers only once each turn") latch per turn; cycling compiles to the from-hand discard-and-draw ability (CR 702.29).
- **"As enters, choose a creature type"** prompts on entry; chosen-type filters work in trigger subjects (Kindred Discovery's enters-or-attacks) and static selectors (Vanquisher's Banner).

## The card pipeline (Stage 6)

- Real cards compile from Scryfall oracle text by shared sentence patterns; a hand-authored registry (`server/src/cardOverrides.ts`, data in the same schema) beats the compiler for the long tail. Never a named-card code path.
- The compile-rate metric runs in CI against a vendored 60-card staple fixture (floor: 80% full-compile, ≤3 uncompiled; currently 82%). `COMPILE_BULK=<path>` sweeps a full Scryfall bulk file.
- A rulings corpus (`engine/src/rulings.test.ts`) converts actual Gatherer rulings into scenario tests; its first entry exposed and fixed the simultaneous-death batching gap.
- `GameHost.getOverrideStats()` counts manual overrides per game — the sprint queue for the compiler.
- The oracle cache (v4) stamps fetch times, refreshes cards older than 30 days (Oracle errata reaches the compiler), falls back to stale copies offline, and ingests Scryfall bulk files.

## The table (Stages 1 & 7)

- WebSocket tables issue **seat tokens** on first claim; rejoining a claimed seat requires the token, auto-assignment skips claimed seats, **spectators** join seatless with all hidden zones redacted, and a mismatched engine version is refused cleanly.
- Clickable phase ladder for stops, full control, and yield mode; the order-triggers and pay-or-counter prompts render in the client; state-based fast-forwards (`advance_step`/`advance_turn`) are logged as table overrides naming discarded stack objects.
- A seeded random-game fuzzer asserts zone integrity and serialize round-trips after every action (CI: 6 games; 500-game burn-ins gate checkpoint tags — they have caught two real livelocks and the trigger-batching bug).

## Documented gaps (intentional, in plan order)

- CR 613.8 dependency; copy effects beyond token copies; timestamps for auras vs. their hosts.
- CR 616 replacement-ordering choice; damage prevention/redirection shields; token-doubling replacements (Anointed Procession).
- Casting face-down (morph); adventures/split cards; sagas; day/night automation (transform exists as an effect).
- Damage-assignment order is blocker-list order; attack requirements ("must attack") and cost-to-attack effects.
- Landwalk and other parameterized evasion; poison/infect; damage-dealt triggers (Curiosity).
- Old-templating X spells (original Fireball's surcharge); commander color identity is not enforced.
- Loyalty abilities are once per turn per walker; combat damage cannot yet be redirected to planeswalkers.
- Manual override remains for everything above — its per-game usage count is the coverage metric.
