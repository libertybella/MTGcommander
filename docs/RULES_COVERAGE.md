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
- **Damage-to-player triggers**: a `combat_damage_to_player` event fires per strike (Bident of Thassa saboteur heads), and a `deals_damage_to_player` event fires on any damage — combat strikes and noncombat `deal_damage` alike. Auras can watch their host via the `attached` trigger scope, and "to an opponent" heads exclude the watcher's controller (Curiosity compiles fully).
- **Spell-or-permanent bounce and life exchange**: the `spell_or_permanent` target kind unions the stack and the battlefield — a bounced spell leaves the stack for its owner's hand (Venser, Shaper Savant). "Exchange target opponent's life total with ~'s toughness" swaps via real gain/loss (doublers and life triggers apply) and rewrites the source's base toughness through a cloned definition (Tree of Perdition).
- **Titans and reservoirs**: graveyard targets honor mana-value caps and "Whenever ~ enters or attacks" heads emit sibling triggers (Sun Titan), team pumps accept "+X/+X where X is the number of creatures you control" read at bind (Craterhoof Behemoth), life gains scale by spells cast this turn (Aetherflux Reservoir), destroyed permanents can pay their controller fixed life (Nature's Claim), and "attacks each combat if able" is enforced at attacker declaration — an able must-attacker can't stay home (Toski).
- **Idols and swarms**: per-player token-creation and draw tallies track the turn — "Activate only if you created a token this turn" gates activation (Idol of Oblivion) and "Whenever an opponent draws their second card each turn" fires exactly on the second draw, with multi-card draws dispatching one event per card (Faerie Mastermind). "Permanents your opponents control lose hexproof and indestructible until end of turn" is a layer-6 keyword strip that spares the activator's own board (Shadowspear), and Scute Swarm's landfall token upgrades itself to a copy of the source at six lands, counted when the trigger resolves.
- **Drums and tenders**: mana abilities gain three cost/production shapes — "Tap an untapped creature you control" as an activation cost (the chosen creature taps and fires becomes-tapped watchers, no summoning-sickness check per CR 601.2g — Springleaf Drum), "any color among legendary creatures and planeswalkers you control" limiting the color picker to what the board offers (Mox Amber, unusable on an empty board), and "for each color among permanents you control" bursting one of each (Bloom Tender). "Untap target Forest/land" compiles with land-subtype targets (Arbor Elf, Voyaging Satyr). None of the three costed shapes feed auto-tap or potential mana.
- **Pacts and tops**: "each other player sacrifices a creature of their choice" rides the edict chooser (Grave Pact), a player_sacrifices event fires from every sacrifice for any-target pingers (Mayhem Devil), look-and-assign gains a library-top destination so "put them back in any order" is a real reorder — later placements land on top — and "Draw a card, then put ~ on top of its owner's library" self-perches (Sensei's Divining Top). "Protection from the color of your choice" opens a color prompt at resolution and applies an until-EOT layer-6 grant (Mother of Runes). Fixed en route: the serializer's trigger-event allow-list had silently fallen behind the union (it rejected becomes_tapped and opponent_draws_second definitions on reload) — it now mirrors types.ts.
- **Orchards and cutthroats**: anyColorAmong grows two board-scan scopes — "any color that a land an opponent controls could produce" (Exotic Orchard, Fellwar Stone) and "any type that a land you control could produce" with colorless included (Reflecting Pool); the scan reads each land's ungated ability list and skips board-aware abilities rather than resolving them (Pool looking at Pool — documented approximation avoiding recursion). "Whenever ~ or another creature you control dies" heads accept the normalized tilde (Zulaport Cutthroat, Butcher of Malakir), "each opponent loses 1 life and you gain 1 life" is a flat drain pair, and ETB triggers peel "if an opponent controls more lands than you" intervening-ifs (Knight of the White Orchid, Loyal Warhound).
- **Masks and swords**: "Whenever equipped creature deals combat damage to a player" watches the host through the attached scope — a bystander's strike stays silent (Mask of Memory, the Swords). "you may draw two cards. If you do, discard a card." fuses to a loot with the draw taken unconditionally (documented approximation of the "may"), "create a token that's a copy of this Equipment" self-copies (Bloodforged Battle-Axe), "+2/+2 and has protection from red and from blue" compiles to paired attached statics with a layer-6 protection grant (Sword of Fire and Ice), and "that player discards a card and you untap all lands you control" reads the damaged player as the subject (Sword of Feast and Famine).
- **Constellations and welcomes**: "Whenever an enchantment you control enters" and the self-or-another variant compile as controlled-enchantment ETB watches — an enchantment creature's own arrival counts (Setessan Champion, Archon of Sun's Grace, Eidolon of Blossoms, Doomwake Giant), with the "Constellation —" ability word stripped like Landfall. "Whenever one or more other creatures you control with power 2 or less enter" is a once-per-batch head with a computed-power ceiling (subjectFilter.maxPower), and "This ability triggers only once each turn" rides it (Welcoming Vampire, Enduring Innocence's middle line).
- **Shrines and ruined fields**: mana abilities can scale to devotion — "Choose a color. Add an amount of mana of that color equal to your devotion to that color." reads CR 700.5 pips at tap time behind its {2} pool cost (Nykthos), "Destroy target planeswalker" lands on a dedicated planeswalker target kind (Casualties of War's one-or-more modal compiles whole), "Destroy target nonbasic land an opponent controls" carries the control filter, and "Each player searches their library for a basic land card" expands per player through the each-player search path (Field of Ruin, Demolition Field's rider).
- **Apes and altisaurs**: fights are real (CR 701.12) — both powers read before either damage marks, deathtouch and protection apply per side, and "up to one target" slots skip when unfilled (Kogla, Apex Altisaur, Prey Upon). A damaged event now fires from noncombat damage, combat marking, and fights, matched by Enrage heads ("Whenever ~ is dealt damage"). Creature targets honor requiredSubtypes ("Return target Human you control" — Kogla), "~ gains <keyword> until end of turn" self-grants compile, and "defending player controls" destroy targets widen to any opponent's — a documented approximation.
- **Bites and freed hosts**: "Target creature you control deals damage equal to its power to target creature you don't control" is a one-way bite — the source is the chosen creature and its power reads at bind; the trample-excess rider is not implemented (documented approximation — Ram Through). "It fights target creature you don't control" after a buff sentence fuses into one clause so the buff lands before the fight (Epic Confrontation), "You may play those cards this turn" joins the impulse fuser (Sword of Forge and Frontier), and auras can tap or untap their host through a host card selector (Freed from the Real).
- **Gods and recruiters**: "As long as your devotion to <color> is less than N, ~ isn't a creature" is a devotion-gated type filter applied to the battlefield object before the layer passes — a documented simplification of the all-zones ruling (the Theros gods wake at threshold). Tutors honor toughness caps (SearchFilter.maxToughness — Recruiter of the Guard), "Your opponents can't cast noncreature spells this turn" is a creature-exempting cast lock cleared at cleanup (Ranger-Captain of Eos), and combat-trigger counters scale to the source's power read at bind, with "That creature gains haste" riding the single target (Ouroboroid, Halana and Alena). "Tap another target creature", own-creature unblockability, and up-to-one-other flickers round out the Thassa pair.
- **Shapeshifters and mirrors**: "You may have ~ enter as a copy of …" compiles across six scopes (any creature, your creature, another of yours, creature-or-planeswalker of yours, any nonland permanent, any artifact or creature) — the choice is prompted just after entry rather than applied as a CR 614.13 replacement (documented approximation), the copy points at the original's current definition, and only the copied card's own ETB triggers fire so Soul Warden-style watchers don't double-count. State-based actions spare a 0/0 clone while its copy choice is pending. "except" riders are consumed when recognized: the extra +1/+1 counter lands (Spark Double), Mockingbird's spent-mana cap binds X-plus-pips at resolution and gates the picker, and cosmetic riders — added types, granted keywords and quoted abilities, myriad, name changes, Sakashima's kept abilities — drop silently (documented). "The 'legend rule' doesn't apply to permanents you control" is an accurate no-op: the engine never applies CR 704.5j (Sakashima of a Thousand Faces). Token-copy spells accept the same rider tails (Irenicus's Vile Duplication). Clone, Phantasmal Image, Glasspool Mimic, Auton Soldier, Phyrexian Metamorph, and Clever Impersonator all compile whole.
- **Signets and mimics**: "Add one mana of any color in your commander's color identity" is real — the color picker reads the controller's commanders at tap time, identity computed from cost pips plus rules-text mana symbols (color indicators and back faces not consulted — documented; Command Tower, Arcane Signet, Commander's Sphere lose their long-standing any-color approximation note). "~ is the chosen type in addition to its other types" folds the entry choice into the computed subtypes so lords, tribal counts, and chosen-type watchers all see it, "Other creatures you control of the chosen type get +1/+1" is the excludeSelf variant of the chosen-type anthem (Adaptive Automaton), and "Each other creature you control of the chosen type enters with an additional +1/+1 counter on it" lands via an ETB watch rather than a CR 614.1c replacement — a documented approximation (Metallic Mimic). Roaming Throne's first two lines now compile; its trigger doubling stays deferred with Panharmonicon.
- **Mentors and kindred calls**: Prowess lowers to its full rules text — a controlled noncreature-cast watch pumping +1/+1 until end of turn — and "with prowess" on a created token is dropped (the token's own trigger is not representable — documented; Monastery Mentor's Monks arrive plain). "Choose a creature type." on a resolving spell is auto-picked as the caster's most common creature type at bind (ties alphabetical, changelings uncounted — a documented approximation like populate's auto-pick): Distant Melody draws per controlled permanent of the type, Kindred Dominance's board wipe spares it (destroy_all exceptSubtype), Crippling Fear's -3/-3 sweep spares it (all_pt_until_eot), and Raise the Palisade bounces everything else (bounce_each_creature).
- **Panharmonic echoes**: "that ability triggers an additional time" is real trigger doubling — each matching doubler on the battlefield adds one queued copy, expanded in the simultaneous-trigger funnel so identical copies pass through APNAP ordering (a doubled ability opens the usual order prompt). Cause-keyed doublers read the candidate's causing event — an entering artifact or creature (Panharmonicon), any entering permanent (Yarok), a dying creature (Teysa Karlov, Drivnod), an attacking creature (Isshin) — while source-keyed doublers filter the doubled ability's source and also double turn-based triggers: another creature of the chosen type (Roaming Throne), a Shaman or another Wizard (Harmonic Prodigy, whose excludeSelf covering both halves is a documented micro-approximation). "This ability triggers only once each turn" naturally suppresses the extra copy via the once-per-turn latch. Teysa's "Creature tokens you control have vigilance and lifelink" compiles to paired token-only keyword grants.
- **Glimmers and banners**: the Enduring cycle's "When ~ dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment." is a real return — the dead card comes back pointed at a cloned definition whose type line drops Creature (power/toughness null), so the intervening-if terminates naturally: the returned object was never a creature and a second death is final (Enduring Vitality, Innocence, Tenacity, Curiosity). Chosen-color machinery joins chosen-type: "Creatures you control of the chosen color get +X/+Y" is a chosenColor static selector, "{T}: Add one mana of the chosen color" reads the source's entry choice with no color argument (Heraldic Banner), and "Whenever a land's ability causes you to add one or more mana of the chosen color, add an additional one mana of that color" pays the bonus inside the land's tap, per CR 605.1b (Caged Sun).
- **Echoes and last rites**: "Whenever you tap a land for mana, add one mana of any type that land produced" echoes inside the tap, auto-picking the addition's biggest type — a documented auto-pick (Mirari's Wake, Vorinclex, Voice of Hunger), and Vorinclex's other half freezes an opponent's tapped land through exactly one of its controller's untap steps (a one-shot skipNextUntap flag, honored and cleared in the untap sweep). The impulse-dig fuser accepts "Reveal the top N…" heads and a "Put the rest into your graveyard" tail (dig_top restTo — Grisly Salvage). Dies events now carry the creature's computed power captured the moment before death, and "When ~ dies, create X 1/1 … tokens, where X is its power" reads it through the trigger's subject amount — counters included (Elenda, the Dusk Rose; Elenda's Hierophant).
- **Emblems and mixtures**: "You get an emblem with …" builds a battlefield object of type Emblem carrying the quoted statics — emblems are not CR 114 objects here, so mass removal is taught to spare the type (a documented approximation; Elspeth, Sun's Champion's ultimate). Her −3 is a computed-power sweep (destroy_all minPower). Transmute lowers to a hand activation — discard this card, tutor a card with the same mana value (SearchFilter.exactManaValue; the sorcery-timing restriction is not enforced, documented — Muddle the Mixture, whose counter also gains the instant-or-sorcery-spell target). "Roll a d20. You create a number of Treasure tokens equal to the result." fuses to a real random roll feeding the token path, doublers included (Ancient Copper Dragon). Instant/sorcery graveyard recursion lands on its own target kind (Archaeomancer), "you may gain 1 life" is auto-taken (Soul's Attendant), and Ponder's "You may shuffle" is auto-declined — the reorder just chosen stands (documented).
- **Germs and rebounds**: Living weapon lowers to its rules text — an ETB that creates the 0/0 black Phyrexian Germ and attaches the Equipment, with a boostless Germ dying to the next state-based sweep exactly as printed (Nettlecyst; Kaldra Compleat's grant line stays open). Attached buffs can scale live: "+1/+1 for each artifact and/or enchantment you control" multiplies in layer 7c by a count read from the static's controller each computation (modify_pt.per — an and/or card counts once). Rebound is real per CR 702.87: a rebound instant or sorcery cast from anywhere but the graveyard resolves to exile instead (copies excluded), and at its caster's next upkeep the exile-playable grant offers the free cast for that turn — an unused offer stays exiled for good. "~ enters tapped unless you control a basic land" joins the enters-tapped conditions (Ba Sing Se, Fire Nation Palace — their keyword actions stay open).
- **Triggers learn to choose**: "When ~ enters/dies, choose one —" and Landfall-modal blocks compile whole — the head keeps its trigger event and the bullets become modes (CardTrigger.modes). When such a trigger would stack, its controller gets a choose-trigger-mode prompt; a targeted mode then pauses for its targets (the choose-targets prompt and the stacked ability both carry the mode index), and resolution reads the chosen mode's effects in place of the empty top-level ones (Aether Channeler, Felidar Retreat, Retreat to Coralhelm). Multi-sentence bullets concatenate their clauses (one targeted clause per mode). "You may tap or untap target creature" is an up-to-one target whose effect toggles the current state — a documented approximation of the choice — and "Those creatures gain vigilance until end of turn" after a team-counter sentence grants to the controller's team.
- **Dragons pick their partings**: the dies-modal dragons complete the modal-trigger cluster. "Until the end of your next turn, you may play those cards" is a real extended impulse — the exile-playable grant carries a countdown decremented only at the caster's own cleanups, so it survives opponents' turns and expires exactly at the end of the caster's next one (Atsushi). "Put target non-Dragon creature card from a graveyard onto the battlefield under your control" adds excluded-subtype target filters, with the "You lose 2 life" rider in the same mode (Junji), and "Each opponent discards two cards and loses 2 life" compiles as a discard-drain pair. "Exile another target creature you own. Return it to the battlefield under your control at the beginning of the next end step." fuses into a delayed flicker — the card waits in exile and the end-step sweep returns it under the effect controller (Charming Prince; targets can now require ownership). Legend short names in modal heads normalize ("When Atsushi dies").
- **The spell pays itself**: "This spell costs {X} less to cast, where X is …" compiles for three live counts — total mana value of noncreature artifacts you control (Metalwork Colossus), total mana value of historic permanents (artifact, legendary, or Saga per CR 700.4a — Excalibur), and the greatest power among creatures you control (The Great Henge, The Skullspore Nexus) — applied to the generic portion at both cast validation and legal-action enumeration, floor zero. "Equip legendary creature {2}" restricts the equip target, "put a +1/+1 counter on it and draw a card" lands the counter on the entering trigger subject (Henge's engine line), and "Double target creature's power until end of turn" reads the target's power at bind (+P/+0). Still open: Colossus's graveyard activation (two-fodder sacrifice cost) and Skullspore's dies-batch token (batch total power).
- **Evolution notices its betters**: Evolve lowers to its rules text — a controlled-creature ETB watch whose subject must outclass the watcher in power OR toughness, both read computed when the trigger checks (CR 702.100c). A counter_added event now fires from effect-driven counter placements (enter-with-counters setups don't — documented), so "Whenever a +1/+1 counter is put on this creature, you may draw a card" chains off evolve's own counter (Fathom Mage). "Whenever an opponent casts a noncreature spell with mana value less than this creature's power" caps the cast subject against the watcher's live power (Pollywog Prodigy).
- **Nothing goes to waste**: a discards event fires from every discard path — effect discards, chosen discards, cast-cost and activation-cost discards, and each card of a windfall wheel — carrying the discarded card and its player. "Whenever an opponent discards a creature/land card" heads watch it with card-type subject filters, "Whenever you discard …" is the controlled variant (Bone Miser), and the comma-carrying "noncreature, nonland card" head gets a pre-split special case like Sram's. The mana head's "add {B}{B}" rides the existing triggered add-mana path (Waste Not). Tergrid stays open (sacrifice-or-discard subject capture).
- **Abilities learn to choose too**: "{2}, Sacrifice ~: Choose one —" activation blocks compile whole — the cost keeps its activation shape and the bullets become ActivatedAbility.modes; the activation action carries the mode index, targets validate against the chosen mode, and resolution reads its effects (Insidious Fungus, Cankerbloom; multi-sentence bullets strip a leading "Then"). The client offers the mode list before targeting; the fuzzer picks modes at random. "Exile any number of target creatures you control. Return those cards to the battlefield under their owner's control at the beginning of the next end step." fuses into a mass delayed blink over variable targets — each card waits in exile and comes home to its OWNER at the end-step sweep (Eerie Interlude).
- **Thrones, rage, and second winds**: Dethrone lowers to its rules text via an attacking-most-life trigger condition that reads the subject attacker's defender against the table's highest life (Scourge of the Throne, whose first-attack-each-turn alpha strike also compiles). "if it's the first combat phase of the turn" is a real intervening-if backed by a per-turn combat-phase counter (Karlach), "untap all attacking creatures" untaps anyone's attackers, and a standalone "They gain first strike until end of turn" after an attack trigger extends that trigger with a grant to all attackers. Delirium statics gate on four or more card types among the controller's graveyard (StaticAbility.requiresDelirium) — Dragon's Rage Channeler's "attacks each combat if able" half is dropped, a documented approximation. "you lose 1 life and amass Zombies 1" upkeep bodies and power-floored token-tribal attack heads round out Dreadhorde Invasion.
- **Wayfarers and witnesses**: activations can gate on being behind on lands ("Activate only if an opponent controls more lands than you" — Weathered Wayfarer, whose any-land-to-hand tutor also lands). Adapt lowers to its rules text — counters only land on a counterless creature, and the placement feeds counter_added watchers, so Evolution Witness's batch head ("one or more +1/+1 counters are put on ~") chains its graveyard return. Colorless subject filters cover cast and enter watches, and the Eldrazi Spawn token preset supplies "Sacrifice this token: Add {C}" so the quoted grant compiles (Glaring Fleshraker). Searches can count from the greatest power among your creatures (Traverse the Outlands), and Gingerbrute's evasion drops the hasty-blocker exception — unblockable this turn, a documented approximation.
- **The gift batch**: the gift mechanic (CR 702.174) compiles to a promise/decline mode pair chosen on cast — mode 0 declines, mode 1 leads with the reward ("they draw a card" / "a tapped 1/1 Fish", entering tapped via create_token.entersTapped) resolving before the spell's other effects, riding the existing SpellMode cast flow end to end (client mode picker, bot, fuzzer). Two documented approximations: the recipient is always the next opponent rather than a chosen one, and Dawn's Truce's "You and …" player-hexproof half is dropped. Riders branch three ways: "If the gift was promised, instead …" swaps effects AND target requirements per mode (Long River's Pull counters any spell, Into the Flood Maw bounces any nonland permanent — "an opponent controls" now reads as a control filter), "… also gain …" appends grants (Dawn's Truce), and Parting Gust's unpromised half compiles to exile_return_end_step with toOwner and withCounter — the exiled card comes home to its OWNER with a +1/+1 counter at the end-step sweep. "target nontoken creature" is a real target filter (TargetRequirement.nontoken).
- **Supply lines**: "When ~ enters or dies" expands to one enter trigger and one dies trigger carrying the same clause (Stitcher's Supplier). "Add one mana of any color" compiles as a resolved effect whose color is auto-picked at bind — first commander-identity color, else {G} — a documented approximation of the free choice (Lotus Cobra's landfall). "Put target card from a graveyard on top of its owner's library" rides a new any-graveyard any-card target kind (Noxious Revival; its {G/P} cost pays as plain {G}, the Phyrexian option still open). Gamble's blind tutor compiles with a discard_random effect (Math.random, tests mock) — the random discard applies before the search prompt completes, so the tutored card is never the one discarded, a documented approximation of Gamble's famous risk. Ghostly Flicker's "two target artifacts, creatures, and/or lands you control" is a new battlefield target kind feeding two immediate flicker effects.
- **Wheels and edicts**: windfall effects take a fixed drawCount ("Each player discards their hand, then draws seven cards" — Wheel of Fortune). The Nettlecyst per-artifact/enchantment buff accepts "Enchanted creature" hosts (All That Glitters). "you may pay {1}. If you do, draw a card." fuses into a may_pay trigger body, and the singular little-creature watch head ("Whenever another creature you control with power 2 or less enters") joins Welcoming Vampire's batched form (Mentor of the Meek). copy_each_token snapshots the player's tokens and copies each once (Second Harvest — copies don't copy copies). Blasphemous Edict lands whole: CardDefinition.altCostIfCreatures auto-takes the cheap alternative cost whenever the battlefield creature count holds (documented approximation, freeIfCommander's pattern), and multi-count edicts repeat the per-player sacrifice choice sequentially — a documented approximation of the simultaneous thirteen.
- **Nexus of types**: a layer-4 all_creature_types static makes controlled creatures every creature type (Maskwood Nexus — the off-battlefield half of its sentence pair is consumed as covered by the battlefield static, a documented approximation; its Shapeshifter token gets real changeling via a token preset). "Lands you control are every basic land type" is a layer-4 add_types static whose intrinsic mana follows the existing Urborg machinery (Dryad of the Ilysian Grove). Top-of-library grants gain castColorless ("artifact spells and colorless spells" — Mystic Forge, whose {T}, Pay 1 life exile rides a new exile_top effect) and castChosenType (creature spells of the granting card's chosen type, read live — Realmwalker). subjectFilter.powerAboveBase compares computed power against printed base for Kutzil's pumped-attacker batch head.
- **Altars and rituals**: mana abilities can count controlled enchantments (Sanctum Weaver). Sacrifice-cost activations capture the fodder's power on activation and mill effects can read it ("mills cards equal to the sacrificed creature's power" — Altar of Dementia, riding Fling's sacrificedPower stack slot into the ability-resolution bind). Victimize compiles whole with its resolution sacrifice modeled as a cast-time additional cost (Fling's pattern, documented) feeding two tapped graveyard returns. Culling Ritual's sweep counts its kills into mana — destroy_all.addManaPerDestroyedOptions auto-picks the color (first commander-identity match, else first listed, documented). Edict choices accept "creature or planeswalker" (new CardFilter), and "Each player who can't discards a card" attaches to the just-compiled edict as choose_card.cantDiscards — the fallback discard is still the player's own choice (Plaguecrafter).
- **Death and taxes on the stack**: living_death swaps everyone's graveyard creatures with their board in one sweep (exile → mass sacrifice → mass return, Living Death). Tribute to the World Tree's conditional branch compiles to two complementary-filter triggers over computed power (≥3 draws, ≤2 grows). Necropotence lands whole: "Skip your draw step" is a replace_draw skip, "Whenever you discard a card" watches with no type filter and exiles the subject from the graveyard, and the Pay-1-life activation fuses to exile_top_to_hand — the card waits in exile and reaches hand at the next end-step sweep (face-down and "your" end step are documented approximations). Bolt Bend's conditional discount compiles to a proxy — {3} less while an opponent has a spell or ability on the stack (documented) — and the "Change the target" wordings join Deflecting Swat's retarget machinery with the single-target restriction dropped (documented; Redirect Lightning's flashback already parsed).
- **Keys, banners, and the Ozolith**: a leaves_battlefield event fires from every battlefield exit that carries +1/+1 counters (amount = the p1p1 total — other counter kinds don't transfer, The Ozolith's documented approximation), feeding an add_counter "subject_amount" absorb; its combat trigger moves the whole bank to a target via move_all_counters. Banner of Kinship's type choice banks enterCountersPerChosenType counters when the choose_creature_type prompt resolves, and modify_pt.perSourceCounter multiplies the team pump by the SOURCE's counters. Cloud Key picks a CARD type — auto-picked as the most common type among the controller's hand, else creature (documented) — feeding a CostReduction chosenCardType filter. Forgotten Ancient's cast watch lands ("you may put a +1/+1 counter" auto-taken) with its upkeep counter-redistribution auto-declined (counters stay put, documented). Puresteel Paladin's metalcraft grant makes controlled equips {0} via freeEquipIfArtifacts checked at activation cost in both actions and legal-action enumeration, beside an Equipment-subtype arrival watch.
- **Mines, clues, and greater goods**: investigate compiles to its Clue token (the preset supplies "{2}, Sacrifice: Draw"), and "Whenever you sacrifice a <subtype>" watches token sacrifices with a subject filter (nontoken members of the subtype are a documented gap — Tireless Tracker). The generic tutor accepts "reveal it/them," (Idyllic Tutor, Open the Armory's Aura-or-Equipment any-of). "Whenever an artifact you control enters" joins the arrival watches (Reckless Fireweaver). untap_all learns "nonland" (Dramatic Reversal) — and the serializer's bound untap_all parser finally learned "attacking" (a wave-132 latent gap). Greater Good draws the sacrificed fodder's power then discards three (draw count "sacrificed_power"; the discard picks the hand's first cards, the looting clause's precedent). Howling Mine lands with its untapped gate honored for the whole extra-draw class at the draw step (a documented approximation for gateless printings). Return to Nature's graveyard bullet rides the wave-135 any-graveyard target kind.
- **Missteps and magistrates**: spell targets take mana-value filters ("Counter target spell with mana value 1" — Mental Misstep, whose {U/P} pays as plain {U}, documented). deal_damage learns "subject_power" — the trigger subject's computed power at bind (Warstorm Surge, "any target"). Capped creature tutors accept printed power (Imperial Recruiter). The "~" normalization covers "this Aura"/"this Equipment", unlocking Kenrith's Transformation's rewrite variant (removal leading, plus a set_colors static). Drannith Magistrate's lock lands whole: opponentsCastOnlyFromHand blocks command-zone, graveyard, exile, and library-top casts at validateCast and in legal-action enumeration — where the top-of-library cast check was also upgraded to castableFromTop, fixing a wave-137 latent gap (castColorless/castChosenType were legal but never enumerated for the bot).
- **Reversals and reflections**: enter-as-copy gains an any-artifact scope (Sculpting Steel). Narset's Reversal compiles whole (copy the spell, then bounce the original off the stack). Imp's Mischief's toll reads the retargeted spell's mana value (lose_life target_mana_value now handles stack targets). Goreclaw lands both halves: cost reductions take a printed-power floor (CostReduction.filter.minPower) and team pumps take a computed-power floor (team_pt/team_keyword minPower). Reflections of Littjara rides the existing chosenSubtype subject filter on a chosen-type cast watch feeding copy_subject_spell. Archaeomancer's Map compiles via the reveal-tutor variant plus an opponent-land arrival head whose "that player controls more lands than you" reads as the Land Tax condition.
- **Skeletons, swine, and welcomes** (the 50% crossing): the tutor reveal-group accepts "that card/those cards" (Eladamri's Call). Batched cheap-creature watches take a mana-value cap (Tocasia's Welcome, once per batch AND per turn), and self-or-another enter watches take a color (Ayara, whose "Sacrifice another black creature" cost is a real color-checked sacrifice scope). Curse of the Swine exiles a variable target set and hands each controller its pig (exile_targets_into_tokens — the X cap on target count is "any number", documented). Springbloom Druid's "you may sacrifice a land. If you do, …" fuses into may_sacrifice — the take and the land pick are auto, documented. Activated abilities work from the graveyard (zone "graveyard" + a legal-action enumeration loop — Reassembling Skeleton), and Kaya's Ghostform lands whole: "Enchant creature or planeswalker you control" is a new enchant kind, with the dies-watch return under the aura controller's control (the is-put-into-exile half dropped, documented).
- **Verges, gates, and marching orders**: "Activate only if you control …" grew from a single bare-word match into a real `ControlledGate` — an OR of subtypes satisfied by different permanents (the ten-land Verge cycle's "a Plains or a Swamp"), a legendary-creature clause (Rivendell), and a current-power clause reading the layer engine so counters and pumps count (Bonders' Enclave). Minas Tirith gates on a per-player tally of creatures declared as attackers this turn, summed across extra combats and cleared at untap; attackers that later leave the battlefield still count, matching the card. The gate matcher itself had been hand-copied into four modules and had already drifted — the `subtypesAny` clause silently passed for *any* permanent in the mana-ability copy — so all four now delegate to one implementation parameterised by its trait source (computed for gameplay, printed for the layer engine, which must not recurse into its own output). The createGame and serialize mappers likewise collapsed from three copies each to one helper.
- **Anthems, armors, and archdruids**: static grant lines are parsed as a subject/predicate grammar rather than a handful of fixed shapes. Subjects compose freely — "Other", a possessor ("you control" / "your opponents control", the latter a new `opponents` selector scope), colour, `Legendary`/`Nonlegendary`/`Nontoken`/`Commander` adjectives, "…tokens", trailing "of the chosen type" and "with +1/+1 counters on them" (stripped before the possessor, since they sit outside it), and a head noun that may be a card type, a tribal subtype, or bare "permanents". Predicates take several conjuncts, so "get +1/+1 and have vigilance" becomes two abilities over one selector; keyword lists ("flying, first strike, vigilance, trample, haste, and protection from black and from red") and combat restrictions ("can't be blocked") parse, as does a pump scaling by a live count ("gets +1/+1 for each enchantment you control"). A predicate with any unrecognised conjunct compiles to nothing at all rather than silently dropping half the card. Not yet covered, and still noted: granted ward (Flowering of the White Tree), protection from a card type (Spirit Mantle), granted activated abilities (Bootleggers' Stash), and subjects that include the player (Shalai).
- **Overruns, safekeeping, and last stands**: until-end-of-turn grants get the same subject/predicate treatment as the static ones. The duration may lead or trail the sentence; subjects are the team (yours or your opponents'), a referential "it"/"that creature"/"~", or a target — creature, creature you control, permanent you control, artifact or creature, attacking creature — each bringing its own target requirement; predicates chain pumps and keyword lists ("gets +3/+3 and gains trample, hexproof, and indestructible"). The narrow single-effect shapes still own their exact sentences; this runs last and catches only what they cannot express. Approximations, both documented: "**other** creatures you control" includes the source, because the team effects address a player rather than a card set (it matters only when the source is itself an affected creature — End-Raze Forerunners); and "+X/+X" is not compiled at all, since the until-EOT effects cannot yet carry an announced X (Tyvar's Stand, Kessig Wolf Run). A predicate with any unrecognised conjunct compiles to nothing rather than half the card — Triumph of the Hordes drops entirely on "infect", which stays a documented gap.
- **Swords, boots, and hammers**: the three narrow "Equipped/Enchanted creature …" branches are gone; the general static-grant grammar covers every shape they did, and handles the Oxford comma they choked on (Sword of Vengeance's "first strike, vigilance, trample, and haste" left a literal "and haste", so the card silently fell to leftover). Ward becomes grantable: a layer-6 `grant_ward` effect feeds a computed `ward`, which the pay-or-counter prompt now reads instead of the printed field — the highest ward wins rather than stacking, since CR 702.21c would have each ability trigger separately and one prompt cannot express that (documented). Grants can also take a keyword away ("loses flying"), and a subject may be singular ("Each creature you control with a +1/+1 counter on it"). "~ gets …" is deliberately not a subject of this grammar: self-scaling pumps have their own `bonusPt` handling further down the sentence chain, and claiming it here shadowed Storm-Kiln Artist.
- **Drains, deaths, and arrivals**: enters/dies trigger heads get one grammar over their noun phrases, tried only after every specific head declines. It reads the "~ or another" / "another" / "a" lead (only the bare "another" excludes the source), an optional "you control" possessor, a "nontoken" qualifier, and a head noun that may be a card type, a creature subtype, two types joined by "or", or bare "permanent" for no restriction. "…is put into a graveyard from the battlefield" is simply the `dies` event under older templating, whatever the card type. The drain body compiles for every subject that carries it — target player, target opponent, that player, they, each opponent — and the lifegain is a flat amount, not the total lost: "each opponent loses 1 life and you gain 1 life" gains exactly 1 at a four-player table, which is why it cannot reuse `drain_opponents`. Still open here: "a token you control leaves the battlefield" (the `leaves_battlefield` event only fires for permanents carrying counters), "you sacrifice an <artifact>" (the existing head is token-only), exile-from-battlefield watches, and general "A and B" bodies.
- **Conjunctions and referents**: a clause whose halves are each understood now compiles as a whole. `compileCompoundClause` splits at a top-level ", then" / "and then" / "and", compiles each part, and renumbers the later parts' chosen-target indexes onto the tail of the combined requirement list. It is the very last thing tried and self-validating — a split is accepted only when *every* part compiles cleanly on its own, so an "and" that is really part of one phrase simply fails to split and falls through ("and/or" is refused outright). Parts shrink strictly, so a three-part body works by the tail re-entering the same path. Alongside it, "it" resolves to the object the trigger watched rather than the source ("put a +1/+1 counter on it", "untap it"), and self-damage reaches "you" and "each player", not only "each opponent".
- **Upkeeps, win conditions, and ability words**: step triggers learn whose step they watch — `eachPlayersStep` makes "At the beginning of **each** end step" fire on every player's turn, where before only the controller's own step existed. "each **opponent's** step" is deliberately still a miss: approximating it as every player's step would fire it on the controller's own turn, and Archfiend of Depravity making its own controller sacrifice is a wrong game rather than a rough one. Four intervening-if conditions join the CR 603.4 chain (life threshold, controlled-subtype count, controlled-subtype zero, exact hand size), counts are read by `parseCount` rather than a hand-listed set of number words (so "thirty" works as well as "ten"), and "You win the game" is a real effect expressed as CR 104.2a — everyone else loses — reusing the shape Laboratory Maniac already had. Ability words are stripped generically now: CR 207.2c gives them no rules meaning, so any capitalised phrase before an em dash comes off a trigger head, not just the four that were listed.
- **Conditions, graveyards, and wider targets**: "As long as …, <grant>" compiles. Which machinery it needs depends on what the condition is about: a condition on the *controller* becomes a gate on the static ability (`requiresLife` — Serra Ascendant), while a condition on the *affected object* is just a narrower selector and needs no gate at all (Champion's Helm is "attached AND legendary"). That second case exposed a real bug: the `attached` scope returned as soon as it matched the host, so every other clause on an attached selector was silently inert; it now falls through to the refinements. Graveyard targets gain a land kind (Titania), and destroy/exile targets gain the two three-type sets (Acidic Slime's artifact-enchantment-or-land, Fracture's artifact-enchantment-or-planeswalker).
- **Subtype sweeps and batched arrivals**: a mass destroy can be narrowed *to* a subtype as well as spared *from* one, so both halves of Crux of Fate compile. Adding the printed spare exposed a silent gap: the compiler was emitting `exceptSubtype` on the unbound effect, where only the auto-chosen `exceptChosenType` existed, and the binder dropped it without complaint — the wave's own runtime test is what caught it. Trigger heads read the plural batch form ("Whenever one or more artifacts you control enter/die"), which fires once for the whole simultaneous batch rather than once per permanent, and until-end-of-turn pumps reach an all-scope subject ("All creatures get -1/-1"). Keyword grants deliberately refuse that subject: there is no all-scope keyword effect, and addressing nobody would be worse than a clean miss. Modal cards remain a per-card grind rather than a family — the survivors each fail on a *different* bullet.
- **Landscapes and graveyard hate**: a search descriptor keeps its leading article and supertype across an any-of list — "a basic Swamp, Forest, or Island card" is a basic-land search over three subtypes, not a search for something called "a basic swamp" — which compiled the entire five-land Landscape cycle from one fix. `exile_graveyard` joins the each-player expansion, so "Exile each opponent's graveyard" is one clause that becomes one exile per opponent; without that it bound to nobody and silently did nothing, because the binder throws on an unexpanded each-player selector only for effects that reach it.
- **Reclamations, dispels, and ultimatums**: a mass land return brings every land card out of the effect controller's *own* graveyard, tapped, which three cards share (Splendid Reclamation, Aftermath Analyst, Lumra). Counterspells can name instants without sorceries (Dispel), a sweep can spare the caster's own board (Ruinous Ultimatum), and "Look at target player's hand" reuses the existing hand-reveal rather than inventing a peek. With these the 60-card staple sample reached 95%, so the CI floor rose from 85 to 90.
- **Flash windows and spell bounce**: a one-turn flash grant is state on the game rather than a static on a permanent — `flashThisTurn` lists the players whose window is open, is cleared at cleanup like every other until-end-of-turn effect, and is read by the same `hasFlashGrant` that Vedalken Orrery uses, so casting-window logic did not need a second path. Bouncing a spell off the stack no longer requires the "or permanent" half (Reprieve).
- **Free casting from hand**: "you may cast a spell with mana value N or less from your hand without paying its mana cost" is modelled as a *permission with a use count* rather than as a prompt — the same shape `exilePlayable` already used for impulse exiles. That choice matters: the existing cast action serves it, so no new answer path was needed in the client, the bot, or the fuzzer, which is normally the expensive half of adding a choice. A grant covers a spell whose mana value is inside its cap, is matched narrowest-cap-first so a broad grant is not spent where a tight one would have done, is consumed by exactly one cast, and expires at cleanup if unused. The legal-action enumeration reads the same helper, so a granted spell shows as castable with no mana available at all. Electrodominance reads the announced X at bind time.
- **Omniscience and foretelling**: the free-cast permission gains a static form. A permanent can grant it continuously and uncapped (Omniscience), or once each turn with a cap read live off its own counters (As Foretold, whose cap grows as time counters accrue). The once-per-turn latch is stored per player rather than per permanent — a documented simplification: a second As Foretold would not grant a second cast that turn. The one-shot grants from the previous wave and these static ones are checked at the same two places, so no third path through the cast logic appeared.
- **Draw variants**: draws can count the announced X, which the effect could not express before — so a targeted X draw, "draw X cards, then discard a card", a shared draw with one opponent, and a symmetric draw-then-discard all compile. Each is a pair of existing effects with a different player selector; what was missing was the X, not the machinery.
- **Thriving lands and wider clones**: an enter-the-battlefield colour choice can exclude a colour, which is what the whole Thriving cycle needed. The exclusion is honoured in four places, not one — the resolver rejects the excluded colour, and the client hides it, the bot avoids it, and the fuzzer filters it out, because an answerer that picks an illegal colour turns a compile win into a runtime error. Clone scopes widen to lands, Equipment, and artifact-or-enchantment, and a copy can arrive tapped (Vesuva), which is a property of the copier rather than of what it copied.
- **Either-or additional costs**: "sacrifice an artifact **or** discard a card" is two whole costs of which one is paid. The branch is read from the cast action’s own fields — a sacrifice id means the sacrifice branch, discard ids the discard branch — so no prompt and no new action field were needed; when nothing distinguishes them the first affordable branch is auto-taken, and that is documented. Legal-action enumeration is satisfied by any one payable branch. An either-or line compiles only when *both* halves are understood, which is why Redirect Lightning is still a clean miss: its "or pay {2}" is mana, and this cost shape charges permanents, cards, and life.
- **Narrowed mana echoes**: "whenever you tap … for mana, add an additional …" stops being a single boolean. The rule now carries an optional subtype gate, an any-permanent flag, a fixed colour to add, and a gate on what the tap actually produced — so Mirari's Wake (any land, matching type), Crypt Ghast (Swamps only, always black) and Forsaken Monument (any permanent, only when it made colourless) are the same mechanism rather than three. The echo runs outside the land gate now, which is what lets a colourless-producing artifact trigger it.
- **Comma-less legend short names**: a legend refers to itself by its short name, which the compiler took to be the part before a comma. Names shaped "X of the Y" or "X the Y" have no comma and were never shortened, so their own trigger heads went unrecognised. Both shapes are now shortened, and nothing else is: a plain multi-word name like Lightning Greaves has no short form, and treating its first word as one would rewrite unrelated text. Normalising Sakashima also revealed a rider that had been matching the raw name, which now accepts the normalised form too.
- **Spend this mana only**: restricted mana (CR 106.6) lives in its own pool on the player, tagged with what it may pay for and with the permanent that produced it — Cavern of Souls needs the producer, because its filter reads that land's own chosen creature type. Payments take a purpose describing the spell or the ability's source; a payment with no purpose (an attack tax, a ward tax) admits nothing restricted, which is the safe default. Restricted mana is spent before unrestricted mana whenever it is legal to: it cannot be saved for anything else, so spending it first never costs the player an option. A changeling satisfies any chosen-type restriction (CR 702.73a). The clause is compiled only for phrasings the engine can actually enforce — anything else leaves the card uncompiled rather than making mana that quietly pays for anything. Dropped and documented: the "and that spell can't be countered" rider on Cavern and Delighted Halfling, which would need the spend tracked onto the spell itself.
- **Phyrexian costs and keyword counters**: an activation cost may contain Phyrexian pips. The payment path already charged 2 life for them — only the cost *parser* was refusing, which is why the Dominus cycle looked like missing machinery and was really one over-strict guard. Alongside it: a sacrifice cost can ask for two or three, with the activation naming one and the rest auto-taken cheapest-first (documented), and "two **other**" gets its own scope so the source is never its own fodder. Counters that share a keyword's name now grant it (CR 122.1e) — an indestructible counter really survives the lethal-damage sweep, not just the keyword query.
- **Beacons and brass**: `becomes_tapped` events fire from mana taps, tap-cost activations, and attack taps ("Whenever this land becomes tapped, it deals 1 damage to you" — City of Brass; Magda-style tribal tap heads parse too), Command Beacon moves the commander from the command zone to hand, Path to Exile's tapped basic-land consolation rides the chosen controller's search, ETB self-attaches target legendary creatures you control (Mithril Coat), equipped-attacks heads watch the host (Sword of the Animist), and artifact-card graveyard returns compile (Buried Ruin).
- **Plowshares and clamps**: "Its controller gains life equal to its power" reads the exiled creature's power before the exile applies (Swords to Plowshares — the 60-card sample rises to 90%), dies events remember what was attached so "Whenever equipped creature dies" fires after the detach (Skullclamp), bare "Equipped creature has haste and shroud" grants compile (Lightning Greaves, Swiftfoot Boots), a countered spell's controller can be paid via the chosen-spell controller selector (An Offer You Can't Refuse), "You may play an additional land this turn" grants a one-shot drop expiring with the turn (Explore), and ETB triggers peel "if you control a creature with power 4 or greater" intervening-ifs (Garruk's Uprising).
- **Maniacs and mazes**: the empty-library draw becomes a win — every other player loses per CR 104.2a — while a Laboratory Maniac-style replacement is live. "target attacking creature" is a target filter, and "Prevent all combat damage that would be dealt to and dealt by that creature this turn" shields the chosen creature both directions until cleanup (Maze of Ith).
- **Mobilize and soultraders**: Mobilize N compiles to its full rules text — an attack trigger creating N tapped-and-attacking Warrior tokens that sacrifice themselves at the next end step — and "Your opponents can't cast spells during your turn" is a cast-only lock beside the Abolisher's (Voice of Victory, Kutzil's first line). "Pay 1 life, Sacrifice another creature:" activation costs parse, with the source's own body refused as fodder (Warren Soultrader).
- **Clocks, anarchists, ascensions**: the other-untap-step static covers artifacts (Unwinding Clock), color-pair spell discounts compile ("that's red or green" — Goblin Anarchomancer), static abilities can be gated on the source's own counters ("seven or more quest counters" — Beastmaster Ascension), Fabricate compiles as its counter half — always taken, a documented approximation — and "another creature or artifact you control is put into a graveyard from the battlefield" is a dies head with any-of types (Marionette Apprentice).
- **Wurms, bonds, dark realms**: "Creatures your opponents control get -2/-2 until end of turn" expands the team debuff over each opponent, "Whenever a creature an opponent controls dies, that player loses 2 life" reads the dying creature's controller as the subject (Massacre Wurm), trigger subject filters accept "with power 3 or greater" against computed power (Elemental Bond), and "Put all creature cards from all graveyards onto the battlefield under your control" is a mass reanimation with control stealing (Rise of the Dark Realms).
- **Deflecting Swat**: "You may choose new targets for target spell" is a real retarget — the resolver opens a choose-targets prompt bounded by the spell's own (mode-aware) requirements and swaps the stack entry's targets in place. Abilities on the stack can't be targeted, so "spell or ability" compiles to spells only — a documented approximation. The commander-free alternative cost rides the existing freeIfCommander machinery.
- **Sentinels and moxen**: per-player noncreature-cast tallies power "Whenever an opponent casts their first noncreature spell each turn", with the Rhystic-style tax reading "{X}, where X is this creature's power" from the watcher's computed power at trigger time (Esper Sentinel). Mana abilities can carry count gates — "Activate only if you control three or more artifacts" — and ability-word prefixes like "Metalcraft —" are stripped from activation lines (Mox Opal).
- **Marauders, ignitions, obedience**: edicts accept "a nontoken creature of their choice" (Accursed Marauder), "deals damage equal to its power to each other creature and each opponent" reads the chosen creature's power at resolution and spares its source (Chandra's Ignition), Extort compiles to its full rules text — a cast trigger with an optional {W/B} payment draining each opponent for one — and "Artifacts and creatures your opponents control enter tapped" extends the Authority static to artifacts (Blind Obedience).
- **Incubators and growth**: "Creature spells of the chosen type cost {2} less" reads the source's as-enters chosen type (applied to the controller's own spells only — a documented approximation; Urza's Incubator, Herald's Horn), end-step flickers accept "return that card under your control" (Conjurer's Closet), and "At the beginning of each combat" fires for every player's combat, with "double the power and toughness of each creature you control" pushed as additive until-EOT modifiers read from computed stats at resolution (Unnatural Growth).
- **Bedevils and avengers**: "target artifact, creature, or planeswalker" is a three-way target kind (Bedevil), "Each creature deals 1 damage to its controller" pings each controller directly (Rakdos Charm), per-controlled token creation covers "create a 0/1 Plant for each land" with the landfall "+1/+1 on each Plant you control" scoping counters by subtype and controller (Avenger of Zendikar), and "Whenever you cast an Aura, Equipment, or Vehicle spell" matches any-of subtypes (Sram, Senior Edificer).
- **Silence and blasts**: "Your opponents can't cast spells this turn" sets a cast lock cleared at cleanup, enforced at cast validation and legal-action enumeration (Silence). "target blue spell" / "target blue permanent" are color-restricted targets; Pyroblast's "if it's blue" wording compiles to the same restricted shape — a documented approximation whose outcomes match in practice (Red Elemental Blast, Pyroblast).
- **Magecraft and crawlers**: spell copies dispatch a `copies_spell` event, and "Whenever you cast or copy an instant or sorcery spell" triggers carry `alsoOnCopy` so the copy half really fires (Archmage Emeritus, Storm-Kiln Artist). "+1/+0 for each artifact you control" is a `bonusPt` self-buff computed with the star-P/T counts, "Whenever you draw a card" is a real trigger head (Psychosis Crawler), and "Return all attacking creatures to their owner's hand" filters the mass bounce to attackers (Aetherize).
- **Abolishers and rhythms**: "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments" gates cast validation, activation validation, and legal-action enumeration (mana abilities stay usable — a documented approximation; Grand Abolisher). "Creature spells you control can't be countered" joins the can't-be-countered check (Rhythm of the Wild), and riot compiles as a haste grant to nontoken creatures — the aggressive half of the choice, always taken, a documented approximation.
- **Graveyard traffic and name checks**: zone moves now dispatch `put_in_graveyard_from_elsewhere` (arrivals from any zone but the battlefield) and `leaves_graveyard` events, so Syr Konrad's triple head compiles as three sibling triggers, with "{1}{B}: Each player mills a card" as its activation. "if it doesn't have the same name as another creature you control or a creature card in your graveyard" is a subject-aware intervening-if (Guardian Project).
- **Devotion and revelations**: "X is your devotion to black" counts colored pips among the controller's permanents' mana costs (a hybrid symbol counts toward each of its colors — CR 700.5) and feeds the fused drain effect (Gray Merchant of Asphodel). "Draw a card for each creature you control" and ferocious "You gain N life for each creature you control with power 4 or greater" read the board at bind (Shamanic Revelation).
- **Warps, drains, and taxes**: Chaos Warp shuffles the target into its owner's library and reveals their top card (a permanent card lands — `reveal_top_put_permanent` with the new chosen-owner selector), "Each opponent loses X life. You gain life equal to the life lost this way." fuses into one drain effect (real loss events per opponent, one real gain — Exsanguinate), and "if an opponent controls more lands than you" is a trigger condition gating Land Tax's up-to-three-basics search.
- **Counter bonuses**: "that many plus one +1/+1 counters" is a `bonus_counters` replacement — every counter batch routes through one helper computing (amount + bonuses) × doublers, the controller's optimal CR 616.1 ordering (Hardened Scales, Kami of Whispered Hopes). "{T}: Add X mana of any one color, where X is this creature's power" reads computed power — counters included — at tap (Kami).
- **Land auras**: "Enchant land" / "Enchant Forest" attach to lands (target subtype restrictions via `requiredSubtypes`; the aura-legality SBA accepts land hosts for land auras), "As this Aura enters, choose a color" prompts on entry (stored per card, five-color picker in the client), and "Whenever enchanted land is tapped for mana, its controller adds an additional {G} / one mana of the chosen color" pays out inside the mana action — a triggered mana ability that never uses the stack, CR 605.1b (Wild Growth, Utopia Sprawl).
- **Consuls, plunderers, provisioners**: "Creatures your opponents control enter tapped" is a battlefield-wide static read as arriving creatures resolve their tapped state (Authority of the Consuls), "Whenever another creature you control dies" and "Whenever a creature an opponent controls enters" are real trigger heads, and "create a Food token or a Treasure token" auto-picks the Treasure — the mana half is the flexible one — as a documented approximation (Tireless Provisioner).
- **Reanimation and deluges**: `graveyard_creature_card` targets a creature card in ANY graveyard, and battlefield-bound `move_card` effects can arrive "under your control" (the card stays in its owner's zone list; control moves via `controllerId` — Reanimate, with "You lose life equal to that card's mana value" read from the chosen target at bind). "As an additional cost to cast this spell, pay X life" makes the announced X the life paid and the spell's `x` value (Toxic Deluge's "All creatures get -X/-X until end of turn" sweeps every creature on the battlefield).
- **Commander wills**: "Choose one. If you control a commander as you cast this spell, you may choose both instead." compiles to a mode choice whose maximum widens while the caster controls a commander (checked at cast validation). Oxford keyword lists ("flying, vigilance, and double strike") grant per keyword, "protection from each color" is a real layer-6 grant (blocks targeting, color-matched damage, and blocks), "Add {R} for each card in target opponent's hand" reads the chosen hand at resolution, and multi-card impulses ("Exile the top three cards… You may play them this turn") fuse inside modal bullets (Jeska's Will, Akroma's Will).
- **Modal staples**: "target player or planeswalker" is a real target kind (damage to a planeswalker removes loyalty — CR 120.3c — and the zero-loyalty SBA finishes it), "Permanents you control gain …" widens team keyword grants past creatures, "Non-X creatures you control" filters team pumps, and "Draw cards equal to the greatest power among non-X creatures you control" reads the board when the effect binds (Boros Charm, Return of the Wildspeaker).
- **Counter-scaled attacking tokens**: attack-batch triggers can filter on non-subtypes ("one or more non-Gnome creatures"), and `create_token` can count copies from the source's counters at apply time (`perSourceCounters` — the just-added counter is included) and drop the tokens tapped and attacking, joined to the first declared attack's defender (Anim Pakal, Thousandth Moon).
- **Fetch untap riders and own-permanent destruction**: "Then if you control four or more lands, untap that land" rides fetch searches (`untapIfLands` on the search, checked as the fetched land enters — Fabled Passage), "Destroy target permanent you own" compiles (Staff of Compleation; ownership approximated as control), and "Untap ~" self-untaps.
- **Free multi-player impulses**: `exile_top_play` expands over each player and can mark its exiles `freeCast` — Etali, Primal Storm exiles everyone's top card and its controller casts them for nothing, taking control of the spells.
- **Boseiju**: the three-way `artifact_enchantment_or_nonbasic_land` target kind, the basic-land-type consolation search rider ("That player may search their library for a land card with a basic land type…"), and rider attachment to channel abilities' targets — Boseiju, Who Endures compiles fully.
- **Ascend**: the SBA sweep grants a player the city's blessing permanently once they control ten or more permanents while an Ascend permanent is on the battlefield, and combat restrictions can lift with the blessing ("can't attack or block unless you have the city's blessing" — Wayward Swordtooth). Ascend on instants/sorceries is not yet modeled.
- **Dash**: compiled as a kicker-style mode when the dash cost is the printed cost plus generic — the dashed permanent enters without summoning sickness and returns to its owner's hand at the next end step (`delayedEndStep` "hand" action). Ragavan, Nimble Pilferer compiles fully.
- **Impulse exiles**: `exile_top_play` exiles the top of a library and lists the cards in `exilePlayable` — the effect's controller may cast or play them from exile for the rest of the turn, paying costs as normal (cleared at cleanup). Sacrifice costs accept the `treasure` subtype scope. Professional Face-Breaker compiles fully; Ragavan's trigger body compiles (dash remains).
- **Turn tallies**: the engine tracks creatures that died this turn (Mahadi's per-death Treasures via `perDiedCreatures` token counts) and per-player spells cast this turn (`casts_second_spell` triggers fire exactly on each player's second cast — Lotho). Both reset when a new turn begins.
- **Tithe pairs and per-controlled tokens**: the pay-or-consequence trigger pair accepts current templating ("If the player doesn't, …" — Smothering Tithe compiles), and `create_token` supports `perControlled` counts ("For each land you control, create a Treasure token" — Brass's Bounty; doubling applies on top).
- **Once-per-batch triggers**: "Whenever one or more creatures you control deal combat damage to a player" fires once per simultaneous event batch (`oncePerBatch`), not once per creature.
- **Impulse digs**: the three-sentence "Look at the top N… / You may reveal a X card from among them… / Put the rest on the bottom in a random order" family fuses into a `dig_top` effect (search filters gain `nonTypes`/`nonSubtypes`). Approximation (silent, like proliferate): the pick is auto-taken — the first filter match goes to the destination. Silundi Vision and Kinnan's activation compile.
- **Channel discounts and copy retargeting**: activated abilities can carry a `legendaryDiscount` ({1} less per controlled legendary creature — the Kamigawa channel lands; Otawara compiles fully with its four-type bounce). "You may choose new targets for the copy" compiles as a no-op — copies keep the original's targets, matching the storm approximation.
- **Choose-two wipes**: `destroy_all` supports a minimum mana value ("with mana value 4 or greater"), completing Austere Command's four-bullet choose-two mode set.
- **Intervening-if trigger conditions**: triggers can carry a `condition` checked when they would be queued — `greatest_artifact_mana_value` (Padeem, Consul of Innovation) and `controls_count` ("if you control four or more lands"). Approximation: CR 603.4 also re-checks on resolution; this table checks once at trigger time.
- **Color and X-capped tutors**: search filters support colors and a mana-value cap; "with mana value X or less" binds the announced X into the filter at resolution (Green Sun's Zenith).
- **First-attack latches and tuck riders**: "Whenever ~ attacks for the first time each turn" maps to the once-per-turn trigger latch, the extra-combat rider now attaches to the last trigger when no activated ability precedes it (Aurelia, the Warleader), "each player draws a card and loses 1 life" compiles (Stormfist Crusader), and "put it on the bottom of its owner's library" tucks the dying card (Murderous Rider).
- **Optional "up to N" target slots**: trailing target requirements can be `optional` — the chooser may stop early, chosen targets must be distinct while optionals are present, unfilled slots simply skip their effects at resolution, and the client auto-submits when the next optional slot has no distinct choice left (Drakuseth, Maw of Flames).
- **Host-rewriting auras**: Darksteel Mutation compiles as four attached statics — ability removal, added artifact/Insect types (approximation: added, not set — the host keeps its printed types), base 0/1, and indestructible — in correct layer order.
- **Damage lifegain riders and filtered mass bounce**: "You gain life equal to the damage dealt this way" folds into the preceding trigger's damage effects (`gainLife` on `deal_damage` — Creeping Bloodsucker; gains go through normal life-gain doubling and events); `bounce_each_creature` with an `unlessCounter` filter lands Wave Goodbye.
- **Graveyard statics and tribal-count damage**: static abilities can declare `fromGraveyard` and a `requiresControlled` gate (checked against printed characteristics) — Brawn's trample anthem works from the graveyard while a Forest is controlled. `deal_damage` supports `{ subtypeCount }` amounts and tribal self-or-another enter heads compile (Scourge of Valkas).
- **Token mana grants and gated graveyard casts**: static selectors support `tokenOnly` ("Tokens you control have '{T}: Add {G}'" — Jaheira, with fixed-pip grants alongside the any-color Cryptolith Rite form), and `castFromGraveyard` definitions (Gravecrawler) cast normally from the graveyard while the controller controls a matching permanent — the creature resolves to the battlefield, no exile rider.
- **Token-status subject filters and search watchers**: trigger subject filters support `nonToken` ("another nontoken creature" — Ogre Slumlord, Metastatic Evangel) and `tokenOnly` ("a creature token you control" — Curiosity Crafter); a `searches_library` event fires whenever a player finishes a search, found or not ("Whenever an opponent searches their library" — Archivist of Oghma). "You may create …" token effects are auto-taken (documented).
- **Sacrifice-cost mana abilities**: Phyrexian Altar-class tapless mana abilities (`costSacrifice` + `noTap`) sacrifice a chosen controlled permanent (`costSacrificeId` on `tap_for_mana`), never auto-tap, add nothing to potential mana, and are offered only while fodder exists. Client activation is not yet wired for these — use floating-mana overrides at the table if needed.
- **Offspring**: compiled like kicker — a second mode with the offspring cost as its extra cost whose effects append a `copy_token` of the spell itself with base power/toughness overridden to 1/1 (Starscape Cleric, Agate Instigator). The copy is created as the spell resolves, just before the original enters.
- **Becomes-untapped events**: every untap path (untap effects, mass untaps, the untap step including Drumbellower-class extras) dispatches an `untapped` event when a permanent actually flips; "Whenever a permanent becomes untapped, that permanent's controller mills a card" compiles (Mesmeric Orb).
- **Creature-count damage**: `damage_all` supports amount "creature_count" — X counted at resolution (Chain Reaction).
- **Overload**: an overloaded spell compiles as a second mode whose `overload_each` effect enumerates, at resolution, every object the normal mode could target and applies the effects to each (Vandalblast, Cyclonic Rift). The overload cost is expressed as the mode's extra generic cost over the printed cost.
- **−1/−1 counters**: layer 7d nets +1/+1 against −1/−1 counters, so `counter_on_each_creature` (Black Sun's Zenith puts X on every battlefield creature) kills through the normal zero-toughness sweep. Counter doubling applies per affected permanent's controller (CR-correct for Doubling Season).
- **Untap-during-each-untap statics**: Drumbellower (creatures) and Seedborn Muse (permanents) untap their controller's cards during every other player's untap step.
- **Color-and-type spell discounts**: "White creature spells you cast cost {1} less" (Oketra's Monument) — the reduction filter combines colors and types.
- **Leylines**: `leyline` definitions in an opening hand begin the game on the battlefield, deployed automatically the moment every player has kept (the "may" is auto-taken — a documented approximation).
- **Basic-land search riders**: "Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle" rides the previous destroy target in both spell bodies (Assassin's Trophy) and activated abilities (Ghost Quarter) via a `chosen_controller` search.
- **Token create/sacrifice events**: `creates_token` fires per token created (create_token, token copies, populate, inline Treasures) and `sacrifices` fires from every sacrifice path (effects, fetch-land costs, mana-ability costs, activation sacrifice costs) with a `wasToken` flag — "Whenever you create or sacrifice a token" (Mirkwood Bats) compiles as sibling triggers.
- **Land and commander targets**: `land` (with `nonbasicOnly` — Wasteland/Strip Mine) and `commander` (Witch's Clinic) target kinds; "you gain life equal to that creature's toughness" reads the trigger subject's computed toughness (Trostani).
- **Token keywords and populate**: created tokens can carry evergreen keywords ("…creature token with flying" — Utvara Hellkite), tribal attack heads compile ("Whenever a Dragon you control attacks"), and Populate copies the controller's creature token. Approximation (silent, like proliferate): populate auto-picks the highest-power token rather than prompting.
- **Windfall wheels**: a `windfall` effect discards every living player's hand, then each draws cards equal to the greatest number discarded (draw doubling applies to the refill, per CR).
- **Filtered creature targets**: target requirements support `maxPower` ("with power 2 or less" — Escape Tunnel) and `legendaryOnly` ("target legendary creature" — Shizo); both check computed characteristics at validation time.
- **Pillow-fort attack taxes**: Propaganda / Ghostly Prison / Windborn Muse (`{2}` per attacker), Sphere of Safety (X = the defender's enchantment count, per tax permanent), and Norn's Annex compile via a per-defender `attackTax` static totaled at declare-attackers and paid from the attacker's floating mana pool (float with `tap_for_mana` first — the engine rejects unpayable declarations) plus life. Approximation: Norn's Annex's {W/P} always takes its 2-life half, never white mana.
- **Sacrifice-a-permanent activation costs**: "Sacrifice a creature/artifact/land:" cost heads compile (Viscera Seer, Zuran Orb, Ashnod's Altar); the activation chooses a controlled permanent (`costSacrificeId`), paid on activation — self-sacrifice is legal, and the client reuses the cast-side sacrifice picker. Altars that add mana resolve via the stack rather than as true mana abilities — a documented approximation.
- **Fling**: the sacrificed creature's power is captured when the cast cost is paid (`sacrificedPower` on the stack object) and "deals damage equal to the sacrificed creature's power to any target" reads it at resolution.
- **Until-EOT dies-return grants**: Feign Death / Undying Malice / Supernatural Stamina / Fake Your Own Death compile — a `grant_dies_return` effect lists the creature in `diesReturnUntilEot` (cleared at cleanup); when it dies the return happens right after the dies triggers dispatch, tapped, with the optional +1/+1 counter or Treasure. Approximations (silent): the return skips the stack, and the Treasure ignores token doubling.
- **Draw doubling**: `double_draws_except_first` replacements (Teferi's Ageless Insight, Alhammarret's Archive) double each draw for the controller — 2^n for n doublers — except the turn-based first card of the controller's own draw step (extra Howling Mine-class draw-step draws do double).
- **Destroyed-creature token riders**: "Its controller creates a 3/3 green Ape creature token" (Pongify, Rapid Hybridization) rides the previous sentence's creature target via a `chosen_controller` token owner. "It can't be regenerated" is a truthful no-op — the engine has no regeneration.
- **"That much" life triggers**: `gains_life` and `loses_life` events carry the amount, and trigger effects may use `amount: "subject_amount"` to read it — Sanguine Bond ("Whenever you gain life, target opponent loses that much life") and Exquisite Blood ("Whenever an opponent loses life, you gain that much life") compile fully. Life loss fires from `lose_life` effects, noncombat damage, combat damage, and mass-damage sweeps; the subject is threaded through targeted-trigger pauses (`choose_targets` prompts now carry the event subject). Life *payments* (shocklands, flashback life) do not yet dispatch the event — a documented approximation.
- **Documented approximation — optional draws**: "you may draw a card" is auto-taken and declined only when the library is too small to survive it.
- **Costed and gated mana abilities**: mana abilities can carry a mana activation cost paid from the pool (Springleaf Drum — never auto-tapped, excluded from potential mana) and "Activate only if you control a Swamp" gates (checked through the shared subtype matcher). Spirit Guides activate from hand with an exile-self cost. Fog sets a per-turn combat-damage prevention flag cleared at cleanup. "You may destroy/exile target X" compiles as the mandatory form (documented auto-take — trigger targeting already skips with no legal target).
- **Spree** (CR 702.169): each "+ {cost} — effect" line compiles to a mode carrying its `extraCost`; casting picks one or more modes and pays every chosen mode's cost, riding the multi-mode machinery end to end. All-or-nothing: a Spree card with any unparseable bullet stays uncompiled rather than hiding options.
- **Storm** (CR 702.40): a per-turn cast counter drives copy creation as the storm spell is cast — one `isCopy` stack object per earlier spell this turn, resolving through the CR 707.10 copy machinery. Documented approximations: the copies appear immediately rather than via a stacked (responding-to-able) trigger, and they keep the original's targets.
- **Kicker** (CR 702.33): modeled as two spell modes — the kicked mode carries an `extraCost` charged at announce, its own effect list, and its own targets ("exile target nonland permanent instead"), riding the existing modal-cast UI, fuzzer, and resolution. "Create five of those tokens" multiplies the base copy effect. Multikicker stays uncompiled.
- **Multi-sentence ability bodies**: oracle sentences on the same printed line extend the preceding activated ability — clause sentences append (target indexes shifted), and subject riders "It gains haste" / "Sacrifice (Exile) it at the beginning of the next end step" fold into token-copy and battlefield-move effects. Delayed end-step one-shots process as the end step begins (haste is modeled as no summoning sickness).
- **Proliferate** (CR 702.24): documented approximation — the proliferating player auto-picks every permanent they control with counters (skipping -1/-1 counters), leaving opponents' permanents and players untouched; counter doublers apply.
- **Extra combat phases** (Aggravated Assault, Seize the Day): an `extra_combat` effect banks a combat that fires as the postcombat main phase ends — the turn re-enters combat (fresh combat state) and flows into another main phase naturally. Documented approximation: the extra combat is always taken after the postcombat main regardless of which main the effect resolved in — the total combat count matches the printed card. Unused extra combats reset at the next untap.
- **Token and counter doubling** (CR 614.1c): `double_tokens` (Anointed Procession) and `double_counters` (Doubling Season's counter half, Branching Evolution's creature-only +1/+1 form) replacements stack multiplicatively per doubler; applied at token creation (including token copies) and every counter-adding effect path. ETB "enters with X counters" stamping is not yet doubled.
- **Flashback** (CR 702.34): instants and sorceries with a mana (plus optional pay-life) flashback cost cast from the graveyard for that cost and exile as they leave the stack — on resolution and when countered. The client shows flashback-castable graveyard cards beside the hand. Sacrifice-cost flashback (Dread Return) stays uncompiled.
- **Top-of-library grants** (Oracle of Mul Daya, Elven Chorus): a `topOfLibrary` definition grant merges across battlefield permanents — look at the top card any time (shown face-up to the controller in the client), play lands from the top, and cast spells from the top with optional type filters; legality, payment, and the stack all treat the top card like a hand card while a grant is active.
- **Changeling** (CR 702.73): a `changeling` definition flag makes the card every creature type in every zone, honored through the shared `cardMatchesSubtype` helper (tribal statics, trigger subject filters, chosen-type watchers, search filters, activation gates); ability removal (Humility) cancels it on the battlefield. A noncreature-subtype exclusion list keeps changelings from matching land/artifact/enchantment subtypes.
- **Filter lands** (Mystic Gate cycle, registry overrides): tap for {C} or either color directly. Documented approximation: the printed ability filters mana (pay one hybrid, get two) for the same net gain of one; the hybrid activation cost is not yet expressible in the mana system.
- **Free-spell cycle** ("If you control a commander, you may cast this spell without paying its mana cost"): the whole mana cost is skipped when any commander is on the battlefield under the caster's control. Documented approximation: the free alternative cost is auto-taken — paying the printed cost instead has no upside this table models.
- **Reveal lands** ("you may reveal a Plains or Island card from your hand; if you don't, enters tapped"): the reveal "may" is auto-taken whenever the hand holds a card with a matching type or subtype (nonbasic duals count, per the printed rule).
- **Spell copies (CR 707.10)**: "Copy target instant or sorcery spell" and cast-trigger "copy that spell" push an `isCopy` stack object that resolves normally, then ceases to exist without moving the source card; countering a copy likewise removes only the copy. Documented approximations: "You may choose new targets for the copy" is auto-declined (the copy keeps the original's targets — a legal choice for that "may"), and permanent-spell subjects are not copied (a real copy would become a token, CR 707.10c, which the table does not model yet). "Counter that spell" cast triggers (Jin-Gitaxias) counter the subject spell directly.

- **Subtype sacrifice costs** ("Sacrifice a Desert", "Sacrifice a Goblin", "Sacrifice a Food"): the scope becomes `permanent` and a lowercase `sacrificeSubtype` (`costSacrificeSubtype` on mana abilities) carries the whole filter, honored through the shared `cardMatchesSubtype` helper — so a changeling is legal Goblin fodder and Humility takes that back. The subtype must be capitalized in the oracle text, which is what keeps "Sacrifice a token" (Fountainport) uncompiled rather than compiling to a free sacrifice.

- **Granted quoted triggers on attachments** (Diamond Pick-Axe, Power Fist, The Reaver Cleaver): `Equipped creature gets +1/+1 and has "Whenever this creature attacks, …"` splits into the buff sentence and the quoted trigger, rewritten so the Equipment itself watches its host — exactly what the `Whenever equipped creature …` heads already mean, and the same game as granting the trigger to the creature. Aura wording ("enchanted creature") shares those heads. Quoted ACTIVATED abilities (Paradise Mantle) are deliberately refused: the same rewrite would leave the ability on the Equipment, which would then tap itself instead of the creature.

- **Target noun phrases as a grammar**: `parseSimpleTargetPhrase` reads "up to one" / "another" / possessor / "legendary" / "nonbasic" / "non-\<Subtype\>" / head noun off a plain targeting phrase, and `parseGraveyardTargetPhrase` does the same for "target \<type\> card with mana value N or less from your graveyard". Blink, targeted untap, and graveyard recursion now share them, so a new wording is a card rather than a branch. Anything the grammar does not recognise returns null — an unparsed qualifier is a clean miss, never a silently widened target. Returning to the battlefield is restricted to card kinds that are certainly permanents.

- **Draw-step and first-main-phase triggers**: the turn dispatches `step_begins` for the draw step (after the turn-based draw, per CR 504) and for the precombat main, so "At the beginning of your draw step" (Mana Vault) and "At the beginning of your first main phase" (Black Market, Hulking Raptor) are events rather than misses. "each player's" fires on everyone's turn, "your" only on the controller's. A `self_tapped` intervening "if" reads the watcher itself, which is what makes Mana Vault's pain conditional on staying tapped.

- **Cast triggers as one grammar**: "Whenever \<you | an opponent | a player | each player\> casts a \<descriptor\> spell" is parsed rather than enumerated — the watcher comes from the subject and the subject filter from the descriptor (a card type, a type list, "noncreature", "colorless", "historic", or a creature type that changelings match). Historic is artifact, legendary, or Saga (CR 702). An unrecognised descriptor returns null, so the head stays a clean miss instead of watching every spell.
- **"Put into a graveyard from the battlefield"** normalizes to "dies" for the card itself (CR 700.4 makes them the same event), so Rancor and Ichor Wellspring read through the trigger heads that already existed.

- **X-count token creation**: "Create X 1/1 white Warrior creature tokens" reads the announced X (an X of zero makes none), and "…, where X is the number of Goblins you control" counts controlled permanents through the shared subtype matcher. The token's printed card types survive — "Soldier artifact creature" becomes an Artifact Creature token, "Forest Dryad land creature" a Land Creature — and a two-colour printing parses like a one-colour one.

- **Damage-modifying replacements** (CR 616 — Fiery Emancipation, Torbran, Gratuitous Violence, Twinflame Tyrant): a `damageReplacement` on a battlefield permanent multiplies or adds to damage, gated on the source's controller, its colors, whether it is a creature, and whether the target is an opponent or theirs. One helper runs at every place damage is actually applied — targeted damage, sweeps (creatures and players), and combat — so combat damage, commander damage, and lifelink all agree on the modified number, and a "that much damage" rider reads it. Documented approximation: multiplications apply before additions and holders apply in timestamp order, where CR 616.1 lets the affected player choose; with one holder the two agree.

- **Mana multipliers** (Mana Reflection, Nyxbloom Ancient): "If you tap a permanent for mana, it produces twice as much of that mana instead" multiplies the addition before it reaches the pool. Only abilities that actually tap qualify, and several holders multiply together — which is what CR 616 gives whatever order the player picks.
- **Cost taxes** (Grand Arbiter, Defense Grid, Helm of Awakening): a tax is a cost reduction with the sign flipped, so there is no second machinery for making spells cost more. A reduction carries a scope — the holder's own spells (the default, and what every earlier discount meant), opponents' spells, or everyone's — and Defense Grid's "except during its controller's turn" rider. The cast path still floors the total at zero.

- **Sweeps as a noun-phrase grammar**: `parseSweepPhrase` reads qualifiers off "all \<phrase\>" from both ends — tap state, possessor, "with no counters on them", "that aren't enchanted", "that aren't legendary", power and mana-value bounds, and "with power greater than target creature's power" (the bar is read from the chosen target at bind, so a sweep with no legal target does nothing rather than everything). A type list ("all artifacts, creatures, and enchantments") sweeps as one batch rather than three, and "Destroy all X and all Y" compiles to two sweeps. Exiling sweeps move to exile, where indestructible correctly does not save.

- **Alternative cast costs** ("You may … rather than pay this spell's mana cost" — Force of Will, Misdirection, Snuff Out, the Flare cycle): the cost halves ("pay N life", "exile a blue card from your hand", "sacrifice a nontoken red creature", and Snuff Out's "if you control a Swamp" gate) are read one at a time and the whole sentence is refused if any half is unrecognised. Documented approximation: the alternative is taken **only when the printed mana cost cannot be paid**, and the cards it needs are auto-picked cheapest-first — so it only ever enables a cast that was impossible, never replaces a line the caster would have preferred. Castability reflects it, so the spell shows up with no mana available at all.

- **Activation costs that are not mana**: counters off the source (Walking Ballista, Dragon's Hoard, Mikaeus), counters *on* it (Devoted Druid), a discard of a named card type (Fauna Shaman), a mill (Millikin), an exile from your own graveyard (Mines of Moria), and counted sacrifices without "other" (Sai). One helper decides whether all the non-mana halves can be paid, and both the activation path and legal-action enumeration run it — so an ability is never offered that the payment would then refuse. Cards are auto-picked cheapest-first (documented). A counter put on as a **cost** skips doubling and counter-added watchers, which is correct: paying a cost is not an effect. `parseAbilityCost` refuses any cost text containing an unmatched Remove / Discard / Mill clause, so a cost never quietly costs nothing.

- **"For each …" as one count table**: `DYNAMIC_COUNTS` names what a clause counts — permanents by type, cards in a zone, creature cards in the graveyard, colours among your permanents, colourless creatures, creatures carrying a counter, and Auras or Equipment attached to the source itself. Star P/T, self-scaling buffs, and count-scaled draws and lifegain all read it, so a new count is a row rather than a branch. Every row admits both wordings, since printed text uses the singular after "for each" and the plural after "the number of". Attachment counts take the source's id; everything else counts the controller's board or zones.

- **Until-end-of-turn effects carry an X.** "+X/+X until end of turn" was previously a documented drop, since those effects held only fixed numbers. They now read the announced X on the spell that made them, or a printed "where X is …" tail — the greatest power among your creatures (Overwhelming Stampede) or how many you control (Moonshaker Cavalry, whose tail is printed *after* the duration and is moved back before the clause splits). Team pumps also take a creature-type filter, through the shared subtype matcher so a changeling qualifies. Documented narrowing: "All Zombies gain menace" (Lord of the Accursed) reaches only the controller's, because a team effect addresses a player.

- **Graveyard card to the library top** (Academy Ruins, Hall of Heliod's Generosity, Mortuary Mire, Volrath's Stronghold): the same graveyard noun-phrase grammar the recursion clause uses, aimed at a different destination. `own_graveyard_enchantment_card` joins the target kinds.
- **A filtered card put from hand onto the battlefield** (Stoneforge Mystic, Terrain Generator, Monster Manual): a `choose_card` from the controller's own hand, so the "may" *is* the choice — declining is choosing nothing. The chooser's filter list gained Equipment and basic land, and the tapped rider survives to the move.

- **Conditional mana upgrades** (the Urza lands, Ilysian Caryatid): "… If you control X, add \<more\> instead" is a rider on the mana ability the previous sentence made. Every named permanent must be there — the Urza lands need two different ones, so the condition is a list of gates rather than one. A named permanent's words are split the way a printed type line is split (whitespace only), so "Power-Plant" stays the single subtype it is on the card. The colour-choice form upgrades the count and leaves the choice alone.

- **Counter placement as a grammar**: "Put \<counters\> on \<subject\>" reads the counter list and the subject separately, so "a +1/+1 counter, a reach counter, and a deathtouch counter on target creature" needs neither a new branch nor a new effect. The subject accepts the source, the trigger's subject, any plain target phrase, or everyone's creatures on one side of the table. A counter name the list cannot read fails the whole clause rather than placing nothing.

- **The target noun phrase, read once**: until-end-of-turn grants used to
  match five exact target wordings of their own; they now read the same phrase
  parser everything else uses, so "another target creature" (Heliod),
  "target legendary creature" and "target creature you don't control" all
  arrive without a branch each. That phrase gained a trailing-qualifier loop —
  mana value, power, and the possessor, in any order — and the adjectives
  "attacking" and "multicolored". A printed P/T modifier is now read as two
  independent terms, each a signed number or a signed X, which is what admits
  "+X/+0" and "-X/-X" instead of only the symmetric "+X/+X". A negated X paired
  with a "where X is …" tail is refused: nothing prints it and the count would
  have to be negated on a guess.

  Two filters that existed but did not apply were fixed alongside it.
  `legalChoicesForRequirement` listed every creature for a "creature"
  requirement while `isChosenTargetLegal` enforced its qualifiers, so a control
  or mana-value filter was honoured when checking a choice and inert when
  offering one. And the unbound `pt_until_eot` parser accepted only numbers and
  "target_power", so the announced-X pump the type had allowed since the X-pump
  wave failed to deserialize.

  Still open here: "gets -1/-1 until end of turn **for each** Swamp you
  control" (Defile) — the grant carries no scale factor, and a basic-land
  count is not in the dynamic-count table. That is a to-do, not a decision.

- **Control is a real field**: `gain_control` moves one permanent, and
  `gain_control_all` moves everything of a type — optionally only what one
  named player controls, which is how "all artifacts **that player** controls"
  reads the trigger's own subject rather than the whole table. `restore_control`
  is the inverse (Homeward Path). A permanent that changes hands does not move
  between zone lists: those are keyed by owner, and control lives on the card.
  It becomes summoning-sick for its new controller (CR 613.7 — which is why
  the printed cards that want it to attack grant haste themselves) and leaves
  combat (CR 506.4), so a stolen attacker is not left attacking for the player
  who just lost it. "Until end of turn" control records who to hand the card
  back to; stealing the same permanent twice in one turn keeps the FIRST
  record, so it goes home rather than to the previous thief.

  This exposed a bug class rather than a single bug. Every "what does this
  player control" site read that player's own battlefield list and then
  filtered by controller — which is a subset of the real set, silently
  dropping anything controlled but not owned. Correct while nothing could
  change control, wrong the moment something could. Ascend's ten-permanent
  count, the attack tax, sacrifice fodder in `legalActions`, populate and
  the Army lookup all now go through one `permanentsControlledBy` helper.

  Not compiled: Insurrection. "Untap all creatures and gain control of them"
  needs "them" to name the set the previous clause just touched, and the
  following "They gain haste" needs the same back-reference. Nothing here
  carries a back-reference to a set, and binding it to the wrong set would be
  worse than leaving the card uncompiled.

- **The token descriptor as a grammar**: "thirteen tapped 2/2 black Zombie
  creature tokens", "a 3/3 colorless Phyrexian Wurm artifact creature token
  with deathtouch and a 3/3 … with lifelink", "a 0/1 red Kobold creature token
  named Kobolds of ~" all read through one parser instead of a branch per
  printed wording. Subtypes are told from card types by capitalisation — oracle
  text prints subtypes capitalised and card types in lower case — so no type
  table is needed to divide "Phyrexian Wurm artifact creature". Two tokens in
  one clause split at the "and" that is followed by a count word, which is what
  keeps "blue and red" and "tapped and attacking" in one piece. A trailing
  count tail ("for each creature you control", "for each +1/+1 counter on ~",
  "equal to its power") becomes one scaled effect rather than N copies, and
  "a number of … tokens" with no such tail is refused rather than silently
  made into one token. Tokens now carry their printed colours: a token has no
  mana cost to derive them from, so the words are the only source, and without
  them a "blue and red Elemental" was colourless to every colour filter.

  Two things this turned up. A clause that chose no targets of its own is no
  longer renumbered when clauses merge — its chosen references point back at
  what an earlier clause targeted ("Exile target artifact or creature. Its
  controller creates …"), and shifting them walked them off the end of the
  merged list, where they bound to nobody and the effect did nothing while the
  card still reported a clean compile. And a token whose name quotes its own
  card ("Kobolds of ~") gets the placeholder undone at bind time, which is the
  first point the source is known.

  Known laxity, deliberately left: the older token shapes still sit below this
  grammar to supply what it cannot express (a count read off the board,
  quoted granted abilities). Their subtype match is loose enough to accept any
  unknown word as a subtype, so a descriptor this grammar refuses can still be
  caught by them. Collapsing the remainder into the grammar would close that.

- **The trigger head reads its subject**: the head grammar knew two verbs
  ("enters", "dies") and one possessor ("you control"); every other event was
  a branch spelling out one exact wording. The verb is now a table —
  attacks, becomes tapped/untapped, deals combat damage to a player, deals
  damage to a player, leaves the battlefield — and the subject noun phrase is
  one shared parser: possessor ("you control" / "an opponent controls"),
  attached subjects ("equipped creature", "enchanted creature"), leading
  adjectives (nontoken, token, legendary) and trailing qualifiers ("with
  flying", "without flying", "with mana value 3 or greater"). Order is
  load-bearing: "a creature you control with flying" puts the keyword OUTSIDE
  the possessor, so reading the possessor first leaves a phrase no head noun
  matches. "…to an opponent" sets the damaged-player check rather than
  becoming its own event. A qualifier the grammar cannot read fails the head
  instead of widening the trigger to every creature.

  Sacrifice heads now name who sacrificed separately from what was
  sacrificed, which turned up an inert branch: the `player_sacrifices`
  dispatch returned true for ANY sacrifice by ANY player, ignoring `watch`,
  `excludeSelf` and `subjectFilter` outright. It only ever carried Mayhem
  Devil's unrestricted head, so nothing had exposed it — but the moment a head
  could say "you sacrifice an artifact", it would have fired on everything.
  "Whenever you sacrifice a Clue" (Tireless Tracker) now reads through this
  path rather than the token-sacrifice event, which is the more faithful
  reading: the printed card does not say "token".

  "…deals combat damage to a player or planeswalker" compiles as the player
  event. Combat damage cannot yet be redirected to a planeswalker, so the
  planeswalker half has nothing to fire on — a documented narrowing.

- **Counter subjects and attaching**: counter placement gained two subjects
  the grammar could already have carried — "equipped creature" / "enchanted
  creature" (the permanent this one is attached to) and "each \<Subtype\> you
  control", which is the same team effect as "each creature you control"
  narrowed by one field. Attaching is now a clause: "you may attach ~ to it"
  and "you may attach that Equipment to target creature you control" read
  their subject and their host separately, with the "may" auto-taken like the
  other may-clauses here.

  The attach effect's host was passed through verbatim whenever it was a
  string, so a named selector — "self", "subject_card", "host" — would have
  been treated as a literal card id and the attachment would have gone
  nowhere. It goes through the same binder as every other card reference now.

  A note on picking clusters: the damage clauses were the obvious next
  collapse — eighteen branches, more than the token family that paid out
  eight. They were not worth it. Counting branches is only half the test; the
  other half is whether the miss list still wants what they cover, and the
  damage branches had already caught nearly every printed recipient. Two gaps
  remained, against eighteen branches.

- **Subjects that are nouns, not adjectives**: the trigger head's adjective
  loop ate "token" in "a token you control", leaving nothing for the head noun
  to match — so the subject parsed as no subject at all. Each leading
  adjective now requires a word after it, and a bare "token" head becomes a
  permanent filtered to tokens. "Modified" joined the adjectives as a real
  CR 701.48 check (an Aura or Equipment attached, or any counter — not only
  +1/+1). A colour is a spell descriptor in its own right ("a red spell").
  And the second-spell count takes an opponents-only narrowing, so Monologue
  Tax does not pay its own controller.

- **Ability words and the conditions behind them**: an ability word (CR
  207.2c) is italic flavour with no rules meaning, and the condition it names
  is spelled out in the text that follows — so the word is stripped and the
  text read normally. Deliberately a LIST and not a shape: boast, channel,
  imprint and strive also print before an em dash and do carry rules, and
  stripping those would widen the ability rather than reveal it.

  What the words were hiding is one clause shape: "\<effect\> instead if
  \<condition\>", "If \<condition\>, [instead] \<effect\>", and the additive
  "\<effect\> … if \<condition\>". "Instead" replaces what the card has said so
  far; without it the rider is an extra effect the condition gates. Both
  compile to one `if_condition` effect whose branch is chosen when the effects
  bind — for a spell, its resolution, which is when the printed card checks.
  The condition vocabulary is shared with trigger heads' intervening "if",
  and the serializer's copy of it was extracted so the two cannot drift.

  The condition parser is also what keeps the additive form honest: without a
  condition it recognises, a sentence containing the word "if" is refused
  rather than applied unconditionally.

  Still open: "exile **that creature**" and "return **that card**" — a
  back-reference to what an earlier clause targeted. Dispatch and Stitch
  Together each stop there, and it is the same gap Insurrection and Origin of
  Metalbending stop at.

- **Back-references and narrowed flash**: "exile that creature", "return that
  card to the battlefield" — a clause whose subject is what an EARLIER clause
  targeted rather than a target of its own. Read only once the card has
  declared a target, because index 0 would otherwise bind to nobody and the
  effect would quietly do nothing; with no target to refer to, the sentence
  stays a clean miss. It works through an "instead" rider too, which is what
  Stitch Together needs.

  Flash grants can now name which spells they cover ("You may cast artifact
  spells as though they had flash"). `hasFlashGrant` takes the spell being
  cast: an unrestricted grant answers for anything, a narrowed one only for a
  spell it covers, and a caller naming no card gets the unrestricted grants
  only. The legal-action hoist stays as a fast path for the unrestricted case.

  Worth recording how the narrowed grant nearly shipped broken. The compiler
  branch made the cards report **fully compiled** — and the rate went up —
  while `oracle.ts` never copied the new field onto the definition, so the
  grant did nothing at the table. The compile-rate metric cannot see that
  class of bug by construction; only the test caught it. That is the fourth
  mapper layer, and it has now bitten in the same place more than once.

- **One condition vocabulary, three consumers**: trigger heads' intervening
  "if", "Activate only if …", and ability-word riders each spelled their
  conditions out separately — the trigger one as a ~120-line chain of a branch
  per wording. They now share `parseEffectCondition`, so a wording added for
  one serves all three, and `ActivatedAbility.requiresCondition` carries the
  general gate (checked at activation AND at legal-action enumeration, or the
  ability would be offered and then refused).

  New conditions the miss list asked for: an opponent's own count ("if an
  opponent controls three or more creatures" — ANY single opponent, not the
  table's total), creature cards in your graveyard, "you attacked this turn",
  "you've drawn more than one card this turn", a coloured permanent, and
  "at least five OTHER Mountains", where excluding the source is the whole
  point — counting itself would meet the bar one Mountain early.

  "You may have ~ deal 3 damage to any target" rewrites to the ordinary damage
  clause with the "may" auto-taken, the same documented approximation the
  other may-clauses use. Both Valakut and Kederekt Parasite stopped there, and
  the one-away report had truncated the phrase out of view — a reminder to
  read the printed card, not the report line.

- **Paying with something other than mana**: convoke (CR 702.51), improvise
  (702.126) and delve (702.66) all reduce a printed cost by spending a
  different resource — tapping creatures, tapping artifacts, exiling your own
  graveyard — so they share one helper. Convoke can cover a coloured pip, and
  does so BEFORE generic ones: a creature tapped for convoke pays one generic
  or one mana of its own colour, so spending a matching creature on a generic
  pip can strand a coloured one it was the only answer to. Improvise and delve
  cover generic only.

  The cost is reduced only as far as it takes to make it payable from the mana
  actually available, so nothing is tapped or exiled that the caster did not
  need. That auto-policy stands in for a choice the cast action has no field
  for, and is a documented approximation: a caster who would rather tap a
  creature than spend mana cannot say so.

  Both places that ask "can this be cast" needed it. Legal-action enumeration
  works from POTENTIAL mana rather than a real pool, so it asks the optimistic
  question and uses a separate ceiling-based variant — a spell must never be
  offered that the payment path would then refuse, nor hidden when it could be
  paid. The granted forms ("Nonartifact spells you cast have improvise") read
  the same helper.

- **Modal bullets that carry more than one sentence**: a bullet used to have
  to be exactly one sentence. Each sentence now compiles on its own and they
  join, with later sentences' chosen indexes renumbered onto the tail of the
  BULLET's own target list — bounded to the bullet, because a mode's targets
  are chosen for that mode alone. A back-reference inside a bullet ("It gains
  indestructible until end of turn") rebinds to what the bullet's earlier
  sentence targeted: the grant parser reads "It" as the trigger's subject,
  which is right in a trigger body and wrong here.

  Alongside: a mass tap, a loot and a token aimed at a chosen player, and two
  edict filters (a creature token, a planeswalker). Two things that would have
  shipped wrong and did not: `tap_all` was not in the each-opponent expander,
  so "your opponents control" would have thrown at bind rather than tapping
  anyone; and the edict's planeswalker check matched a BARE "planeswalker"
  as well as "creature or planeswalker", which would have widened an edict
  that names only planeswalkers to take creatures too.

  Note the printed word order in "sacrifices a creature **token**" — noun then
  noun, not an adjective in front like "nontoken creature". Reading it as an
  adjective is what the first attempt did, and it matched nothing.

- **An activated ability may announce X**: `{X}` in an activation cost is
  announced the way a spell's is, and `{X}{X}` (Treasure Vault) charges it
  twice. The announced value threads through the stack entry to the resolution
  context, so a body that reads "X" gets the same number the cost charged —
  Kessig Wolf Run's "+X/+0" and Barad-dûr's "Amass Orcs X" both read it there.
  An X of zero amasses nothing rather than falling back to the default one.

  Two guards, both asserted: an ability with `{X}` refuses to activate without
  an announcement, and one WITHOUT `{X}` refuses an announcement it has no use
  for — otherwise a stray value would be silently ignored.

  The fuzzer announces zero rather than a random value. Legal-action
  enumeration only promises the BASE cost is affordable, so anything above
  zero could exceed the mana that made the action legal, and the harness would
  be rejecting an action it had just chosen.

  This one needed the ability rebuilt field-by-field in the compiler as well
  as the usual mapper layers — `xCost` reached the parser, typechecked, and
  did not appear on the definition, because that construction lists its fields
  explicitly. The same shape as the other four-layer drops.

- **Replacements on token creation** (CR 614): three printed shapes, one
  family. "Those tokens plus an additional \<token\>" adds one extra PER BATCH,
  not per token — Xorn on a three-Treasure creation makes four, not six.
  "That many \<token\> are created instead" swaps the whole template (Divine
  Visitation). And Academy Manufactor turns a Clue, Food or Treasure into one
  of each. Each names which tokens it touches, so the filter is shared.

  A replacement does not apply to what it itself creates (CR 614.5). Without
  that, Xorn's extra Treasure would be a Treasure creation and loop forever;
  Peregrin Took's extra Food, which matches every token, would loop on the
  first one. The recursion guard is asserted rather than assumed.

  Alongside: a counted plural subtype sacrifice cost ("Sacrifice three
  Foods"). Both halves already existed — `sacrificeSubtype` and
  `sacrificeCount` — but the cost/body splitter did not recognise the phrase
  as a cost at all, so it never reached the parser that would have read it.

- **Variables and gates on costs that were already built**: five small gaps,
  every one of them a wording that existing machinery could already carry.
  The sweep effect accepted a negated X all along and the grant refused to
  hand it one, and "each creature" was not an alias for "all creatures".
  Cost reductions gained a `condition` from the shared vocabulary, so Bolt
  Bend's "if you control a creature with power 4 or greater" needed no shape
  of its own. The tap-a-creature cost gained a legendary variant, and the
  ability that uses it has no `{T}` of its own — the creature tap IS the whole
  cost, which the mana-ability branch had required. "Sacrifice a land" as an
  effect is the same choose-a-permanent shape an edict uses.

  The recurring shape across all five: the capability existed and the reading
  did not. That is worth checking before building anything — a refused
  wording is cheaper to diagnose than a missing feature is to add.

- **Excluded types, Class levels, and a filter that was inert for a dozen
  target kinds**: "noncreature artifact or noncreature enchantment" repeats
  the adjective on each half, so it is lifted off both and the head noun reads
  the plain union it already knew. That needed `excludedTypes` on a target —
  and adding it exposed the real problem.

  The whole permanent-target family (artifact, enchantment, artifact or
  enchantment, nonland permanent, planeswalker, commander and the rest)
  recursed into the permanent check with a BARE `{kind:"permanent"}`
  requirement, so it never saw its own qualifiers. `excludedTypes`,
  `legendaryOnly`, `multicolored`, both power bounds, `nontoken` and both
  subtype filters were all inert across every one of those kinds. Same shape
  as the wave-171 `permanent` fix, an order of magnitude wider.

  The destroy/exile clause now reads the shared target phrase instead of a
  twelve-noun list of its own, so every qualifier that parser knows arrives
  there too — and the three head nouns only that list had are now in the
  shared table where everything else can use them.

  Alongside: "When this Class becomes level N" as a real trigger (fired by the
  level gain, matched to the Class that gained it rather than a twin beside
  it), and life lost off the shared count table, which gain-life and draw
  already scaled by.

- **That player, that many, and a token as fodder**: a trigger body may name
  the player the trigger watched and the amount it watched ("that player mills
  that many cards"). Only mill reads "that many" — a draw or discard of it has
  no printed number here, and picking one would be a guess, so those are
  refused. A missing amount mills nothing rather than milling zero-in-name.

  A counted sacrifice as an EFFECT ("sacrifice two lands") is two separate
  picks, not one pick of two — and it lives in the clause compiler, because a
  trigger body is where the card that needed it says it. "Sacrifice a token"
  became a real fodder scope on the shared matcher, so every caller got it at
  once; it had been deliberately refused since wave 169 precisely so the
  sacrifice would not compile to nothing, and that refusal test now guards an
  unnameable scope instead.

- **Conditions and counters that look back at a target**: "If it's a Spirit,
  put a +1/+1 counter on it" reads both halves against what an earlier clause
  targeted — the condition tests that permanent's subtype, and "on it" is the
  same target rather than a second one. The referent is the trigger's subject
  in a trigger body and the first chosen target on a spell; with neither, the
  condition FAILS rather than passing by default, so a card with nothing to
  refer to does not quietly take the branch.

  "Double the number of +1/+1 counters on each creature you control" doubles
  what is on the board now — a one-shot, not a replacement on counters yet to
  be placed. Doubling nothing stays nothing rather than rounding up to one.

- **Entering with counters, and life the trigger watched**: a permanent may
  enter with a FIXED count of counters, alongside the announced-X form that
  already existed. It is applied where the permanent arrives — beside the
  loyalty a planeswalker enters with — rather than as an effect afterwards,
  because CR 121.6 means they were never not there: a 0/0 that enters with
  four is a 4/4 and must not meet the state-based sweep on the way in.

  "Whenever you lose life" joins the opponent-scoped event that existed, and
  "draw that many cards" reads the amount the trigger watched. The two life
  events stay distinct, which is the case worth asserting — the wrong one
  firing looks like a working card.

  "You may have that player lose 1 life" takes the same auto-taken "may" as
  the damage form; the verb conjugates where "deal" did not, which is the only
  reason it needed a second reading.

- **Sweeps that spare a type, and a gate on a mana ability**: "all
  nonartifact creatures" reads the excluded card type as a sweep qualifier.
  "Nonland" is deliberately absent from both this and the target-phrase
  version, because "nonland permanent" is already its own head noun in each —
  claiming it there rewrites a shape that works, which is what the first
  attempt did in both places.

  "Activate only if …" now also rides a MANA ability, which lives in a
  separate list from the activated ones — the gate had been attaching only to
  the latter and falling through for Shrine of the Forsaken Gods. And the
  counter-added trigger head reads the active voice ("whenever you put one or
  more +1/+1 counters on ~") beside the passive one it already knew.

- **Grants that reach the whole table**: an extra land drop given to EVERY
  player (Rites of Flourishing) is counted from the whole battlefield rather
  than one player's side of it — the difference from Exploration is the only
  thing that makes it a separate field. Thalia's static taps an opponent's
  nonbasic lands beside their creatures, and spares a basic, which is the
  whole word.

  Alongside: "you may mill three cards" takes the auto-taken may, and the
  cost splitter learned the two-type "sacrifice another creature or artifact"
  — the scope it maps onto already existed, and only the reading was missing.

- **The last stretch to sixty-five**: the self-return clause names the hand as
  well as the battlefield (Metalwork Colossus), exiling the source is a cost
  the way sacrificing it already was (Nyx Weaver), and modular is the two
  halves that already existed — enter with N counters, hand them on when it
  dies. "Double the power of target creature" is the same effect as "double
  target creature's power" with the noun phrase moved.

  One real bug surfaced from a stale assertion rather than a card: a counted
  sacrifice carried the PLURAL scope name ("artifacts"), which no fodder
  matcher would ever match. Only "creatures" had been folded to its singular,
  so "Sacrifice two artifacts" typechecked through an `as` cast and would have
  found no fodder at the table. Every card-type plural folds now.

### Granted abilities (the layer-6 primitive)

A static ability can hand a triggered or activated ability to a whole set of
other permanents: `grant_trigger` and `grant_activated` are layer-6 continuous
effects, and the granted ability lands on `ComputedCard.grantedTriggers` /
`grantedActivated`. Before this, the only way to express "equipped creature
has &lt;ability&gt;" was wave 170's trick of rewriting a quoted trigger onto the
Equipment's own `watch: "attached"` — which works only for an ability the
attachment itself carries, never for a grant to a set.

Three rules make it behave:

- **The ability belongs to the affected permanent**, not the granting source.
  It fires from that permanent, "~" in its body is that permanent, its
  controller is that permanent's controller, and a granted `{T}` cost taps
  that permanent.
- **One address space.** `triggersOf` and `activatedOf` return the printed
  list followed by the granted one, so an index past the printed length names
  a grant and no candidate, stack object or prompt needs a discriminator.
  Every site that resolves an index reads those helpers.
- **The stack snapshots the grant.** An ability on the stack exists
  independently of its source (CR 113.7a); a grant does not. Destroying the
  granting permanent in response would otherwise leave the ability resolving
  to nothing — after its cost was already paid.

Documented limits:

- A granted **dies**-trigger does not fire. A dying object's own printed
  dies-triggers look back from the graveyard (CR 603.10a), but the grant is
  read from the live board, where the creature no longer is. Real last-known
  information would keep it; until it exists the compiler must refuse that
  shape rather than compile a dead one.
- A granted ability that only produces mana belongs in `grant_mana_ability`
  (Cryptolith Rite's path), not `grant_activated` — a mana ability must never
  use the stack.

### Keywords a permanent can't have or gain (wave 238)

`remove_keywords` strips a keyword and a later grant re-adds it by
timestamp — correct for Shadowspear (CR 613.7) and wrong for Archetype of
Imagination, whose "can't have or gain" outranks any later grant rather
than racing it.

`lock_keywords` is therefore a set of its own on the computed card, and it
is applied AFTER every layer-6 instance has run rather than in place: a
grant later in the same layer would otherwise win. `remove_all_abilities`
clears the lock along with everything else.

### Phasing (wave 247)

CR 702.26. A phased-out permanent is a FLAG on the instance, never a zone
change — and that is the whole design:

- no leave-the-battlefield trigger fires, because it does not leave;
- Auras and Equipment stay attached;
- counters stay on it;
- it is the same object when it returns, not a new one.

It is treated as though it did not exist: not counted by
`permanentsControlledBy`, not a legal target, unable to attack or block,
invisible to state-based actions, and both inert and untouched in the
layer engine — it contributes no static abilities and receives none.

It phases in at the start of its CONTROLLER's untap step, so a permanent
phased out on an opponent's turn waits for its own.

"Any number of target …" uses `TargetRequirement.variable`, which already
meant 1..N chosen targets matching one requirement — so it needed no new
target shape, only a form of the effect that takes every chosen target
rather than fixed slots (`phase_out.allChosen`). Choosing none binds to
nothing rather than to everything.

### Connive (wave 243)

Connive N (CR 702.148) is a draw, a discard, and a +1/+1 counter for each
NONLAND card discarded that way. The first two were already ordinary
effects; the third rides the discard as `conniveCounterOn`, because its
count is only known once the discard has happened — the same rule as a
sweep that gains life per creature destroyed.

Counters are per nonland CARD, not one for having discarded at all, and a
land discarded this way earns nothing (CR 702.148c). Both are asserted.

Deliberate approximation, inherited rather than introduced: `applyDiscard`
takes from the front of hand rather than prompting, so connive does not
choose which card to pitch. That matters more for connive than for most
discards and is worth revisiting when the discard prompt is generalised.

### Two more amounts for life loss (wave 242)

- **`source_power`** is the power of the ability's own SOURCE (Marionette
  Master), which is a different number from `subject_amount` ("that much"
  — what the event carried) and from `target_power`.
- **`own_life_lost_this_turn`** is the BOUND player's own losses (Wound
  Reflection). It resolves after the each-opponent expansion has picked a
  player, so each opponent loses their own number rather than one shared
  total — binding the amount before the expansion is the failure this
  shape exists to avoid, and there is a test with two opponents on
  different totals.

`lifeLostByPlayerThisTurn` mirrors the gained tally from wave 224 and is
kept for the same reason: it is not the change in a life total, and
gaining the life back does not undo having lost it. Both ride their
EVENT rather than each site that moves a life total.

### Hexproof on a player (wave 240)

A player is not a permanent and has no computed characteristics, so
player hexproof is a definition flag (`controllerHexproof`) rather than a
granted keyword. `isLegalPlayerTarget` now takes the caster and refuses a
hexproofed player only when the caster is someone else — hexproof stops
opponents and nothing else, and a blanket check would lock the controller
out of their own spells.

Shalai's compound subject splits three ways: the player half sets the
flag, and the two permanent halves are ordinary static grants that keep
their own selectors. Only hexproof is read for the player half — most
keywords mean nothing on a player, and granting one silently would be
worse than leaving the line uncompiled.

### Vetoing a loss (wave 235)

`CardDefinition.cantLoseGame` is **one** flag for both halves of Platinum
Angel ("You can't lose the game and your opponents can't win the game"),
because this engine expresses winning as everyone else losing (CR 104.2a —
the `win_game` effect eliminates the other players). A controller who
cannot lose already has opponents who cannot win; a second flag would be a
second name for one rule.

The veto is on LOSING, not on its cause: the player stays at zero life or
with lethal commander damage and simply does not lose, so removing the
permanent loses the game immediately. It is read through
`abilitiesRemoved`, so a silenced Angel stops working — otherwise the card
would be unanswerable.

### Power and toughness on a static selector (wave 232)

`EffectSelector` gained `maxPower` ("with power 2 or less") and
`maxPowerOrToughness` ("with power or toughness 1 or less", Tetsuko). The
second is ONE field rather than two maxima, because either half being
small enough qualifies the creature — a pair of separate maxima reads as
an AND and would match almost nothing.

The selector runs during layer 6, and layer 7d (the +1/+1 and -1/-1
counter net) has not been applied to the computed values yet. It
therefore adds the counter net itself, through the same helper layer 7d
uses, so a creature with a +1/+1 counter is read at its real size rather
than its printed one. **Documented limit:** power changes coming from
ANOTHER static are seen or not depending on instance order — the CR 613.8
dependency gap this engine already declares. Counters are the common case
and are exact.

### Two more target shapes, and one generalisation (wave 229)

- **`creature_enchantment_or_planeswalker`** is a `TargetKind`, because it
  names a union of card types (Get Lost).
- **`attackingOrBlockingOnly`** is a FLAG on the requirement, because it
  restricts state rather than type (Razorgrass Ambush, Eiganjo). It is
  separate from `attackingOnly` rather than a widening of it: Maze of Ith
  must keep refusing blockers. Blocking is not a field on the card — the
  blocker list is keyed by attacker, so the question is whether the card
  appears anywhere in it, and an absent combat means nothing qualifies.

The larger change is that "deals N damage to target …" no longer carries
its own two-entry noun list. It routes the phrase through the shared
target-phrase parser, so every shape that parser already understood works
for damage — "target artifact", "target nonland permanent", "target
attacking creature" — none of which needed a damage rule of their own.
The two original spellings are matched first and still win, so nothing
they compiled to has changed.

### Sacrificing a permanent of your own choice (wave 227)

"Each opponent sacrifices a creature" compiled; "YOU sacrifice another
permanent" did not. The `choose_card` machinery was already there — a
chooser, sources with a zone and a filter, and `thenEffects` that
sacrifice what was picked — so this is a second reader of it with the
controller as chooser, not a second way to sacrifice.

- **`ChooseCardSource.excludeSelf`** reads the word "another". It is a
  flag in the definition and a concrete `excludeCardId` once bound,
  because the definition cannot know which instance it will be. Without a
  source there is nothing to be other than, so the exclusion is simply
  absent rather than guessed.
- **`CardFilter` gained `artifact`**, which the sacrifice grammar needs
  and which "nonland" was never a substitute for.

"Permanent" maps to the `any` filter on the battlefield, which is what a
permanent already means in that zone.

### Maximum hand size as a number (wave 226)

`maxHandSizeOf` returned 7 or null and nothing in between, because the
only shape the engine knew was "you have no maximum hand size". It now
also applies `CardDefinition.handSizeEffect` — a scope (the controller,
or their opponents), a mode (set, or reduce by), and an amount:

- "Each opponent's maximum hand size is reduced by seven" (Jin-Gitaxias)
- "Your maximum hand size is twenty" (Twenty-Toed Toad)

Three orderings are deliberate. A removed maximum beats any numeric
change, because there is nothing left to reduce. Sets apply before
reduces, so a set does not overwrite a reduction that should stack on top
of it. And the result floors at zero — Jin-Gitaxias against the default
seven is exactly zero, and the cleanup step must never be handed a
negative discard count.

### Damage that spends the trigger's amount (wave 225)

"It deals that much damage to …" pays out whatever the trigger carried —
the damage just dealt (Kediss), or the size of the batch that fired it
(Ingenious Artillerist). `deal_damage.amount` accepts `subject_amount`,
and `expandEachOpponent` already fanned player-targeted damage out per
opponent, so the scopes come free once the amount exists.

- **`each_other_opponent`** is Kediss: every opponent EXCEPT the one the
  trigger was already about. `each_opponent` would hit the just-damaged
  player a second time, which is why this shape was a documented refusal
  until now. With no subject there is no "other", so it expands to nobody
  rather than falling back to everybody.
- **`subjectFilter.commanderOnly`** reads "a commander you control". A
  commander is a role its owner's chosen card holds, not a card type, so
  it is a flag beside the type and is read off the player's commander
  list. It shares the name `EffectSelector.commanderOnly` already used, so
  one idea does not acquire two words.

Fixed in passing, and older than this wave: the state parser attached a
trigger's `subjectFilter` only when one of TEN named fields was present,
while the filter has grown to about twenty-five. A trigger filtered solely
on `legendary`, `attacking`, `modified`, `historic`, `colorless` or
`commanderOnly` therefore lost its entire filter on a round trip and
afterwards fired for **every** subject — a legendary-creature trigger
firing for each Bear once a game was saved and loaded. It now attaches the
filter whenever it has any field at all, which cannot go stale.

### Intervening-if conditions (wave 224)

The `if` between a trigger's head and its body (CR 603.4) is checked twice:
once when the trigger would go on the stack and again as it resolves. Three
more questions it can now ask:

- **`self_counter_count`** — "if this creature has fewer than three +1/+1
  counters on it" (Runaway Steam-Kin), and the "N or more" spelling
  (Simic Ascendancy's growth counters). Read on the trigger's SOURCE, like
  `self_no_counter`, not on the controller's board and not on whatever the
  body targets. The bound is exclusive: three counters fails "fewer than
  three", which is what stops the Steam-Kin at three rather than four.
- **`gained_life_this_turn`** — "if you gained 3 or more life this turn"
  (The Gaffer). This is a tally, not a life total: CR 118.3 makes the
  amount gained the replaced amount, so a doubler's extra half counts, and
  losing the life afterwards does not undo having gained it. It is
  accumulated off the `gains_life` EVENT rather than at each site that
  raises a life total, so lifelink and a resolved spell are counted by the
  same line.
- **`created_token_this_turn`** — "if you created a token this turn"
  (Bennie Bracks). Reads the existing per-player `createdTokenThisTurn`
  list, and asks whether the CONTROLLER is in it — an opponent's Treasure
  must not satisfy it.
- **Connive X** — Spymaster's Vault: "Target creature you control connives
  X, where X is the number of creatures that died this turn." The same
  three clauses as the plain form (CR 702.148: draw X, discard X, a +1/+1
  counter per NONLAND card discarded), with two differences that are the
  card: the count is read off the died-this-turn tally, and the counters
  land on the TARGET rather than on the source.

  The count is read at BIND, unlike the counter tallies in wave 328 — the
  discard beside it does not change how many creatures have died, so there
  is nothing to wait for. Connive 0 binds to nothing at all, which is what
  drawing and discarding zero comes to.

- **`targetsYouOrYours`** — Siren Stormtamer: "target spell or ability THAT
  TARGETS you or a creature you control". A constraint on what the stack
  object is itself aiming at, read off its own targets — not on the object.
  It is most of the card: without it the Siren counters anything at all,
  which is a far better card than the printed one. An UNTARGETED spell is
  refused too, with a test for it.

  The plain "Counter target spell or ability" landed at the same time; the
  target KIND already existed and only the sentence was missing.

- **`payLifeForColor`** — K'rrik, Son of Yawgmoth: "For each {B} in a cost,
  you may pay 2 life rather than pay that mana." That is Phyrexian mana
  (CR 107.4f) applied to every pip of one colour, so the pips are MOVED
  into the Phyrexian list and the payment machinery that already existed
  does the rest.

  Applied at BOTH cost sites, because the card says "in a cost" rather
  than "to cast a spell" — an activation pays life the same way, with a
  test saying so. **Documented approximation**: "you MAY pay 2 life" is a
  choice, and the auto-choice prefers the mana when it is available, which
  is exactly what the engine already does for a printed Phyrexian pip.

- **`opponentsEnterTriggersSuppressed`** — Elesh Norn's second half:
  "Permanents entering don't cause abilities of permanents your opponents
  control to trigger." A SUPPRESSION, not a replacement: checked where
  trigger candidates are filtered, so the ability never exists at all and
  there is nothing on the stack to counter or answer. It is a static
  ability like any other, so Humility switches it off.

- **A cost reduction naming TWO colours** — Nightscape Familiar's "Blue
  spells and red spells you cast". The reduction's colour list was already
  ANY-of (Goblin Anarchomancer's "white or green" relies on it), so only
  the sentence form was missing.

- **A graveyard target named by SUBTYPE** — Haven of the Spirit Dragon:
  "target Dragon creature card OR Ugin planeswalker card". Both halves name
  a subtype, and there is no Dragon planeswalker or Ugin creature to tell
  them apart, so the two collapse into ONE any-of filter over `card`
  rather than a disjunction across two target kinds.

  The filter is enforced, not merely recorded: a Bear and a Jace in the
  same graveyard are both refused, and a Dragon in an OPPONENT's graveyard
  stays refused — the subtype list must not loosen the zone.

- **Regeneration (CR 701.15)** — a SHIELD, not a heal. Nothing happens when
  it resolves; the NEXT destruction this turn is replaced instead, and the
  shield costs the permanent a tap and its place in combat when it is
  spent. A COUNT rather than a flag: two regenerates save it twice.

  It was cheap only because wave 322 made destruction a single chokepoint.
  One shield covers targeted removal, a wrath and lethal combat damage
  alike, with no second code path — and it correctly does NOT save the
  permanent from exile or a sacrifice, because neither is a destruction.

  Tried BEFORE totem armor: CR 616.1 lets the controller choose between two
  replacements, and the documented auto-pick is the shield that was paid
  for this turn over the Aura that was standing there anyway.

- **`requiredSubtypesAny`** — Swarmyard's "target Insect, Rat, Spider, or
  Squirrel". ANY of them qualifies, where `requiredSubtypes` demands all of
  them at once, which no creature could satisfy.

- **A choice that names what to KEEP** — Liliana, Dreadhorde General's -9:
  "Each opponent chooses a permanent they control of each permanent type
  and sacrifices THE REST." That inverts every other "of their choice"
  sacrifice here, where the choice names what dies.

  One `choose_card` per permanent type (CR 110.4a lists six), each followed
  by `sacrifice_others_of_type`, which reads the keeper off the choice and
  takes everything ELSE of that type. A player who controls none of a type
  is asked nothing and loses nothing there.

  The list is read at APPLY, so a permanent that arrived between the choice
  and the sacrifice is included — which is what "the rest" means. An
  artifact creature answers to BOTH passes: keeping it as your creature
  does not also save it from the artifact one.

  `CardFilter` gained `enchantment` and `battle` so all six types could be
  named. The total record added in wave 334 caught both omissions as type
  errors on the first compile, which is exactly what it is for.

- **A VARIABLE requirement with constraints across the whole chosen set** —
  Agadeem's Awakening: "any number of target creature cards that each have
  a DIFFERENT mana value X OR LESS".

  Both qualifiers read the SET, not any one card, so they ride the
  requirement and are checked where the set is in hand. Both are the card:
  "X or less" bounds the pool by the mana actually spent, and "each a
  different mana value" is what stops the spell emptying a graveyard full
  of one-drops.

- **`"all_chosen"`** — a variable requirement is satisfied by ANY NUMBER of
  targets, and an effect naming `chosen 0` touches only the first of them.
  That would have been a card returning one creature and scoring as a full
  compile. The selector expands to one effect per chosen target where the
  batch is bound, beside the each-player expansion that was already there.

- **`look_top_card`** — Mishra's Bauble. A LOOK, not a reveal: only the
  effect's controller sees the card, which is the whole point of aiming it
  at an opponent. It moves nothing, and an empty library is not an error —
  "look at the top card" when there is none simply does nothing.

  The delayed draw that is the rest of the card was already understood; the
  look was the only gap.

- **Arcane Lighthouse: losing a keyword is not enough if it can be given
  back.** The removal already existed as Shadowspear's
  `opponents_lose_keywords_until_eot`; this narrows it to CREATURES (where
  Shadowspear names permanents — a whole board's worth of difference) and
  adds the LOCK that "and can't HAVE hexproof or shroud" is printed for.

  The two keyword lists must AGREE. A card that removed one set and locked
  another is something this shape cannot say, so it is a clean miss rather
  than a guess.

  Worth recording honestly: in this engine the removal already beats the
  grants on the board on timestamp, so the wave's test asserts what the
  lock actually RECORDS rather than a layer-ordering claim the fixture
  could not demonstrate.

- **`CardInstance.addedSubtypes`** — Portal to Phyrexia: "It's a Phyrexian
  in addition to its other types." A characteristic the PERMANENT keeps for
  as long as it is on the battlefield, so it rides the instance rather than
  an `activeEffects` entry — that list only knows durations that END, and
  this one does not.

  "In addition to" is the whole of it: the type is added and nothing the
  card already was is lost, including Metallic Mimic's chosen type, which
  now shares the same computed list.

  The rider is FUSED onto the reanimate sentence. Written as its own clause
  it landed in `definition.effects` — which a PERMANENT never runs — and the
  card compiled with zero notes while the type was never added. That is the
  wave 317-319 trap, and this wave walked straight into it before its own
  test caught it.

- **"IT" IS THE TRIGGER'S SUBJECT, NOT THE WATCHER.** The dies-return
  clause bound `self` — the SOURCE — for both "When ~ dies, return it" and
  "Whenever a creature you control dies, return it". Under the first head
  those are the same card and the reading is harmless; under the second the
  card would have returned ITSELF every time a creature died, compiling
  clean and returning the wrong thing.

  `it` now binds `subject_card` and `~` still binds the source, because
  that is what the word says. Under a self head the subject IS the source,
  so persist-shaped cards are untouched — three existing assertions moved
  from one selector name to the other with no behaviour change.

  The counter in that clause was hardcoded to `+1/+1` and is now read,
  which is the only reason a FLYING counter can appear there at all
  (CR 122.1e: a flying counter grants flying, and that is what stops
  Luminous Broodmoth returning the same creature for ever).

- **A cast head reads the mana-value qualifier the ENTERS head already
  knew.** "Whenever another creature you control WITH MANA VALUE 3 OR
  GREATER enters" parsed; "whenever you cast a spell with mana value 5 or
  greater" did not. A parser asymmetry, not a missing feature — the
  descriptor before "spell" is a PREFIX and the qualifier a SUFFIX, and
  only the prefix was being read.

  That one gap is why **Up the Beanstalk** would not compile at all. The
  wave-264 dual-head splitter was already correct and already wanted to
  split it; it declined only because the second head would not parse. With
  the qualifier read, the card becomes what CR 603.1 says it is: one
  printed line, TWO triggered abilities sharing a body.

- **A permanent that blinks ITSELF** — Nezahal. The existing delayed blink
  reads a chosen target; Nezahal has none, so `exile_return_end_step` gained
  a `self` form that reads the source instead. The targeted form keeps its
  target, with a test on Charming Prince saying so — conflating the two
  would have dropped the target silently.

  `returnsTapped` is the whole drawback: without it the card blinks back
  ready to block, which is a strictly better permanent than the printed
  one. It rides the pending return as well as the effect, or a table
  reopened mid-blink brings the card back untapped.

- **`targetingLifeTax`** — Terror of the Peaks: "Spells your opponents cast
  that TARGET this permanent cost an additional 3 life to cast." A COST,
  not a ward trigger. It is paid as the spell is cast, there is no prompt
  and nothing to decline, and a caster who cannot pay it cannot cast the
  spell at all (CR 119.4). That is what makes the card hard to remove
  rather than merely annoying to remove.

  Summed across targets, because two taxing permanents both charge and one
  spell may aim at both — and silenced by `abilitiesRemoved`, since the tax
  is a static ability like any other.

- **Terror's damage body** differs from Warstorm Surge's in the DEALER
  only: "IT deals … ITS power" makes the entering creature both, while
  "~ deals … THAT CREATURE's power" keeps the source on the permanent with
  the trigger. A second clause beside the first, with a test pinning
  Warstorm Surge unchanged.

- **`subject_not_put_by_watcher`** — Kodama of the East Tree's "if it
  wasn't put onto the battlefield with THIS ability". The intervening `if`
  IS the loop guard: without it, one permanent entering chains the whole
  hand onto the battlefield, which is a far stronger card than the printed
  one.

  The mark names WHICH ability did it, not merely that some ability did, so
  a second Kodama still triggers off the first one's put — which is what
  the printed cards do. It is instance state and crosses the wire, or a
  reopened table lets the chain restart.

- **`ChooseCardSource.maxManaValueOfSubject`** — "with equal or lesser mana
  value": the cap is the mana value of the permanent whose entry triggered
  this, so it resolves at bind. **`CardFilter` gained `permanent`**, and
  its parser became a TOTAL RECORD rather than a chain of `!==` — the chain
  had already fallen a member behind the union, so the definition compiled
  clean and then refused to load.

- **A free hand-cast capped by `subject_amount`** — Buster Sword: "cast a
  spell from your hand with mana value less than or equal to THAT DAMAGE".
  The grant, the cap and the payment path all already existed; only the
  cap's SOURCE was new, and it reads where every other `subject_amount`
  does. Added as a second pattern beside the printed-number and announced-X
  forms rather than a widening of either, so no card that already compiles
  could move.

- **Myriad (CR 702.115)** — Blade of Selves. Read as a KEYWORD in the
  declare-attackers step rather than compiled as a printed trigger,
  because the card GRANTS it: a trigger on the definition would never
  reach an equipped creature that has no myriad of its own. Thirteenth CR
  702 keyword.

  The copies are made from the DECLARED ATTACKERS SNAPSHOT, not from the
  live attack list. The copies have myriad too, so reading a growing list
  would spawn tokens without end — there is a test pinning the count.

- **`delayedEndCombat`** — exile at END OF COMBAT, which the engine had no
  hook for. The difference from the existing end-STEP delay is the card:
  tokens that survived into the postcombat main phase would each become
  value for a sacrifice outlet that the printed card never offers.

- **Harmonize (CR 702.184)** — Nature's Rhythm. Two keywords the engine
  already had, welded together: cast it from your GRAVEYARD for the
  harmonize cost, which is flashback (exile rider and all), and tap
  creatures to help pay it, which is convoke.

  `harmonizeConvoke` is a separate flag from `convoke` because the convoke
  half belongs to the GRAVEYARD cast alone. Setting `convoke` outright
  would have made the printed hand cast three mana cheaper than the card
  says — a compile-clean, plays-wrong card. There is a test for both
  halves: creatures pay the graveyard cast and are refused on the hand one.

- **`turnManaEchoes`** — High Tide. This is the rule a permanent already
  carried as `landTapEcho`, with no permanent to carry it, so it lives on
  the GAME for the turn and is swept at cleanup beside the other
  until-end-of-turn effects.

  It watches EVERY player's taps, not one controller's — "whenever A
  PLAYER taps an Island" — and that difference is most of why the card is
  played. The permanent case keeps its controller filter, with a test
  saying so. Two copies stack rather than collapsing into a flag, which is
  the entire storm deck.

  The echo parser is now ONE function shared by the definition field, the
  effect that installs a turn-scoped echo, and the game-state list they
  live in, rather than the same four optional fields written out at each
  site.

- **A MODE MAY NAME MORE THAN ONE TARGET.** The three bullet assemblers
  refused a second targeted sentence outright, with a comment saying a
  second one "would skew chosen indexes" — and `shiftChosen`, the tool that
  fixes exactly that, was already renumbering follow-on clauses elsewhere
  in the same file. A composition gap, not a missing feature.

  Three cases, and telling them apart is the whole of it: a clause with no
  targets of its own refers BACK to an earlier one and keeps its indexes; a
  clause with its own targets is shifted past those already claimed; and a
  clause that does both — `chosenBase` — already numbers from the merged
  list and is shifted by the REMAINDER, or it walks past its own target.

- **`landsToBattlefieldTapped`** — Archdruid's Charm: "Put it onto the
  battlefield tapped if it's a LAND card. Otherwise, put it into your
  hand." The destination is decided per CARD found, not once for the
  search. The three sentences that say this are FUSED rather than each
  compiled: left as a standalone no-op, "Otherwise, put it into your hand"
  would silently swallow the same sentence on a card with no search in
  front of it.

- **A counter tally read at APPLY, not at bind** — Descent into Avernus.
  Its trigger adds two counters and then reads them twice in the same
  batch, so a bind-time reading is two short **every time**, which on this
  card is the entire escalation.

  Both readers now defer: `deal_damage.amountFromCounters` carries the
  lookup instead of a number, and `create_token`'s printed zero survives
  binding when a dynamic source will supply the count. That second one was
  a real trap — the bind refuses a zero count as "no tokens", which is
  right for Secure the Wastes with X=0 and wrong for a card that prints no
  count at all. A zero a dynamic source will replace is "not known yet".

- **`choose_from_hand`** — "Put ANY NUMBER of cards from your hand …"
  (Valakut Awakening, Last March of the Ents). A **sibling** of
  `choose_discard`, not a widening of it: that prompt sits on the cleanup
  path and on every discard cost, and the one time a battle-tested path was
  widened in place here it broke a working card the same hour.

  "Any number" includes NONE, which is why it cannot be `choose_discard`
  with a count — there is no number to satisfy, the prompt is pushed even
  with an empty hand, and Valakut choosing nothing still draws its
  plus-one. The client builds the choice by clicking (toggling, so a
  misclick is undoable) and sends nothing until it is confirmed; the
  headless auto-answer takes none, the only choice that is always legal.

  The draw rides the PROMPT rather than sitting beside it as a second
  effect: "draw that many" is how many the player chooses, and a sibling
  effect would have bound its count before the choice was made. Duplicates
  are refused — the same card bottomed once and counted twice would draw a
  card nobody paid for.

- **A loyalty ability's SECOND SENTENCE now stays inside the ability.** The
  rest of the printed LINE belongs to the ability, not to the card. Without
  this, Elspeth's "Those creatures gain flying" landed in
  `definition.effects` — which a PERMANENT never runs — and the card
  compiled with zero notes while doing half of what it says. The same
  defect as the trigger riders in waves 317-319, one layer over, and a
  general fix rather than a fuser per card.

- **"Until your next turn"** as a continuous-effect duration. It ends as
  that player's next turn BEGINS, and the turn-NUMBER guard is what makes
  one created during their own turn last a full cycle rather than expiring
  the instant it resolved — the same shape `playerShields` already used, so
  the two now sit side by side in the untap step.

  Both guards cross the wire. The serializer hard-coded the old duration
  and would have REJECTED a saved game holding one; without `forPlayerId`
  and `createdOnTurn` a reopened table would sweep the grant at the next
  untap step no matter whose turn it was.

- **`animate_until_eot`** — Mutavault, Destiny Spinner and the manland
  cycle. Three layers behind one word: the creature type is ADDED (layer
  4), the power and toughness are SET (layer 7b), the colours are set
  (layer 5), and the keywords are granted (layer 6).

  Adding rather than replacing the card type is what makes **"It's still a
  land"** true, so that sentence is consumed as a no-op rather than
  compiled — there is nothing for it to do. The land also keeps its mana
  ability while animated, with a test saying so.

  Setting rather than modifying the power matters because a land has no
  printed power to modify. The test proves it on a 5/5, which is the only
  subject that can tell the two apart.

  One pattern reads the duration at either end of the sentence — Mutavault
  trails it, the enemy-colour manlands front it — and one run of words is
  sorted by what each word IS rather than by where it sits, so "1/1
  Phyrexian Blinkmoth artifact creature" yields two creature types and one
  card type without a clause per shape. A sentence with no duration at all
  is refused: guessing that an animation is permanent is worse than a
  clean miss.

- **Cascade (CR 702.85) and discover N (CR 702.163)** are ONE effect, not
  two. Both exile from the top of the library until a nonland card with a
  small enough mana value turns up, then bottom the rest; they differ only
  in where the ceiling comes from and in what may be done with the card
  found. `cascade` is a COUNT, because Maelstrom Wanderer cascades twice
  and Apex Devastator four times and each is its own walk.

  **Documented approximation.** The rules cast the found card during the
  resolution; this engine has no cast-during-resolution path, so the card
  is exiled and granted a free cast for the turn through the same
  `exilePlayable` permission Dauthi Voidwalker already uses. Cascade runs
  at CAST time rather than at resolution, which is what preserves the
  printed ordering — the window opens while the cascading spell is still
  on the stack, so the cascaded spell can be cast and resolve first.

  When the found card could not legally be cast in that window anyway — a
  sorcery discovered on an end step, which is exactly Chimil — and the card
  allows it, the HAND branch is taken instead. Without that, Chimil's
  end-step discover would exile a sorcery forever rather than drawing it.

- **`inSorceryWindow`** moved from `legalActions` to `derived`, because the
  discover path needs the same question answered and two copies of a rule
  that small is how the two drift apart.

- **`wardLife`** — Ward—Pay N life (CR 702.21b), Hexing Squelcher. Kept
  apart from `ward` rather than folded into one number, because the two are
  paid from different pools and one number could not say which. A permanent
  carrying both taxes TWICE, which is what CR 702.21c says and what the
  printed cards do.

  The prompt reuses the `life` field `pay_or_effect` already had, and the
  resolver branch that reads it. Teaching the fuzz answerer and the client
  button about it also fixed a pre-existing hole in the SYLVAN LIBRARY path:
  both asked `canPayManaCost` about a life prompt, got yes for a zero mana
  cost, and then either threw or rendered a button reading "Pay ".

- **`spellsCantBeCountered: { types? }`** — Chimil's unnarrowed "Spells you
  control can't be countered", Rhythm of the Wild's creature spells, Destiny
  Spinner's creature and enchantment spells. This REPLACES the old
  `creatureSpellsCantBeCountered` boolean: the wordings differ only in which
  card types they name, and a boolean per wording is a list waiting to fall
  behind. No types named means every spell.

- **Destruction is now a distinct thing from a trip to the graveyard.**
  `destroyPermanentInPlace` (CR 701.7) is the single chokepoint every
  destruction goes through, and it is where indestructible and totem armor
  live.

  This started as a **live correctness bug**: the SWEEPS checked
  indestructible and the targeted form did not, so "Destroy target
  permanent" killed a Darksteel Colossus. Anything that compiled to
  `move_card` -> graveyard simply moved the card.

  The flag is set by ONE pass over each compiled sentence rather than at
  the twenty-odd clauses that read the word "destroy" — those are a
  hand-written list, and this defect is what a hand-written list looks like
  once it falls behind. A bounce, a tuck, an exile and a sacrifice are
  untouched: none of them is a destruction, and All Is Dust is exactly the
  card that depends on the difference.

- **Totem armor** (CR 702.87) — Bear Umbra, printed as "Umbra armor". On
  the AURA, not on what it enchants. Because the destruction chokepoint is
  singular, one Umbra eats a targeted Murder and a Wrath and a lethal
  combat-damage sweep without three code paths. Indestructible is checked
  FIRST, so a creature that was never going to be destroyed does not spend
  the Umbra (CR 702.87b). The engine's twelfth CR 702 keyword.

- **`ActivatedAbility.sacrificeCountFromX`** — Grim Hireling's "Sacrifice X
  Treasures". The {X} is in the SACRIFICE, not in the mana cost, so `xCost`
  stays zero while the activation still has to announce a value. X of zero
  is refused: it would sacrifice nothing and shrink nothing, and the
  sacrifice cost has no way to name no victim.

  The check that the board holds enough fodder and the payment that eats it
  now read the same two helpers, so they cannot disagree about the number.
  Folding them together fixed a latent bug in the older counted form: the
  auto-taken victims ignored `sacrificeSubtype`, so "Sacrifice three Foods"
  would have eaten two permanents that were not Foods.

- **`ManaAbility.costDiscardHand`** — Lion's Eye Diamond. The whole hand, so
  there is nothing to choose and nothing to prompt for. "Activate only as an
  instant" is consumed as a no-op: on paper it forbids activating mid-cast,
  which is the whole puzzle of the card, and here mana abilities are only
  ever activated at priority, so there is no window to forbid.

- **`manaAbilityIsCosted`** — one predicate replacing four hand-written
  copies of `costMana || costSacrifice || costTapCreature`. A chain like
  that is a list, and the copy that gets missed silently spends the cost:
  the auto-tapper would have discarded a Lion's Eye Diamond's hand to buy
  mana nobody asked for.

- **The serializer's mana sacrifice scopes** are now a total record rather
  than a `===` chain. The chain had fallen two members behind the union, so
  a Bolas's Citadel- or Fountainport-shaped mana ability lost its cost
  crossing the wire and came back **free**.

- **`DamageReplacement.noncombatOnly`** — Solphim. The combat step passes
  `isCombat` and every other damage site leaves it out, so a replacement
  carrying this flag simply never fires in combat. That restriction is most
  of what stops the card doubling every swing, and Torbran (which DOES double
  combat damage) is unchanged, with a test saying so.

- **A counted discard cost** — "Discard two cards" beside "Discard a card".
  **The cost SPLITTER had its own copy of the discard pattern**, so widening
  only the reader left the splitter refusing the cost and the ability
  compiling to nothing. Both now build from shared fragments.

- **`sacrifice_unless_sacrifice`** — The Gitrog Monster. The pay-or-effect
  prompt speaks mana and life, not permanents, so the choice is auto-taken:
  feed it a land if there is one, otherwise let it go. A documented
  approximation, and the one a player makes nearly always — the land
  sacrifice is the engine the card is played for. The land is picked
  cheapest-first, like every other auto-picked fodder here.

  Its second trigger reads `graveyard_from_elsewhere`, not `dies`: "put into
  your graveyard FROM ANYWHERE" catches a milled land, which is most of how
  the card is used.

- **A look with more than one hand slot** — Dig Through Time. The
  destination list is a MULTISET, so "two of them into your hand and the rest
  on the bottom" is two hand slots and five bottom ones; nothing about the
  mechanism changes with the count, and the one-slot forms (Impulse,
  Anticipate) are the same run-compiler.

  The three-sentence dig fuser also now accepts "in ANY order" beside "in a
  random order", and "the bottom" without "of your library" — the same
  instruction to an engine with no ordering prompt for the remainder.

- **`landsEnterUntapped`** — Spelunking: the mirror of the enters-tapped
  statics. It CANCELS a replacement rather than adding one, so it is asked
  last and wins, and it is scoped to the arriving land's own controller.

  Its lifegain rider is fused into the choice it reads (`fusePutLandRiderInPlace`),
  the third time in three waves a rider sentence had to be joined to the
  clause it belongs to rather than left as a top-level effect.

- **`ActivatedAbility.timing: "your_turn"`** — Wishclaw Talisman. NOT
  sorcery timing: it may be activated in combat, or with the stack full, as
  long as it is your turn. Handing the artifact over at instant speed on
  somebody else's turn is the whole reason the card is playable, and reading
  it as sorcery timing would quietly take that away.

  "AN opponent gains control" is a choice the activation has no field for,
  so the next opponent in turn order is taken — a documented auto-pick, and
  in a two-player game the only opponent there is.

- **The play-permission list reaches a GRAVEYARD too** — Emry grants what
  Dauthi Voidwalker grants, from a different zone, so every reader of
  `exilePlayable` now accepts exile or graveyard. The field keeps its name
  because it is serialized and a rename would strand saved tables; the
  comment says what it actually holds.

  Emry TARGETS its card where the Voidwalker prompts for one, so
  `grant_play_chosen` falls back to the first chosen target when no prompt
  choice was recorded. The prompt path still wins where both exist, and
  there is a test for that direction.

- **`draw.countFromDynamicPlus`** — Sea Gate Restoration: "cards equal to
  the number of cards in your hand PLUS ONE". The bonus is added after the
  count, so an empty hand still draws one.

- **`grant_no_max_hand_size` / `GameState.noMaxHandSizePlayers`** — "for
  the rest of the game" is a player-level grant with no permanent behind it,
  unlike `CardDefinition.noMaxHandSize`, which lasts only while its card is
  out. Nothing sweeps it at cleanup, which is the difference from the flash
  grant it sits beside.

- **`gain_life.amount: "target_toughness"`** — Noxious Gearhulk, read at
  BIND. Effects bind as a batch, so the toughness is taken while the creature
  is still there; a dead creature has none to read. Computed, so counters
  count.

  The rider is FUSED onto the destroy it follows (`fuseDestroyLifegainInPlace`).
  Left as its own sentence it becomes a top-level effect on a permanent card,
  which is not a place effects run — the same trap Kappa Cannoneer's rider
  fell into in wave 211, and this wave's own test caught it.

- **`StaticAbility.requiresYourTurn`** — Razorkin Needlehead: "has first
  strike DURING YOUR TURN". A static gated on the turn, not a keyword the
  permanent simply has — it goes away the moment the turn passes, which is
  the whole card. Read beside the static's other gates, so the keyword comes
  and goes rather than being granted once.

- **`controls_commander`** — the Lieutenant condition. Any of the
  controller's OWN commanders being on the battlefield satisfies it, so a
  partner pair needs only one of the two out, and an opponent's commander
  never counts.

- **"if you control an artifact"** — the bare singular, with no count word
  at all, which the existing "N or more" reading could not see.

- **The batch combat-damage head takes one more type** — "one or more
  ARTIFACT creatures you control" is the same head with a wider filter, not a
  second branch, and the plain creature form is untouched.

- **Split second (CR 702.61)** — while the spell is on the stack, no player
  may cast a spell or activate a non-mana ability, the spell's own caster
  included. Read off the STACK rather than latched on the game, because the
  lock ends the moment the spell leaves — countered, resolved or fizzled —
  and a flag would have to be cleared at every one of those exits.

  Checked in the cast validator, the activation validator, and
  `abilityUsable`, so nothing is OFFERED that the action path then refuses.
  Mana abilities come through `producerUsableNow` and are deliberately left
  alone, which is the whole exception.

- **The edict now aims at a target as well as a subject** — Sudden Edict
  names "target player"; Sheoldred names the trigger's subject. Same edict,
  and the referent is the only difference between them.

- **`attackers_against_you_at_least`** — Mangara. Planeswalkers are not
  separate defenders in this engine (every attack names a PLAYER), so "you
  and/or planeswalkers you control" is exactly "you": the two readings agree
  rather than one approximating the other. `oncePerBatch` makes it fire once
  per declaration, not once per attacker.

- **`TargetRequirement.manaValueBelowSubject`** — Scrap Trawler: "with
  LESSER mana value" than the artifact that just died. Resolved to a concrete
  `maxManaValue` where the trigger asks for targets, the only place the
  subject is known — and resolved BEFORE the legality check, because asking
  whether a legal target exists against the unresolved requirement would
  queue a trigger the prompt then has no answer for (CR 603.3d).

  Scrap Trawler's head is one watch, not two: the Trawler is itself an
  artifact, so "~ dies or another artifact you control is put into a
  graveyard" is "an artifact you control dies", itself included. There is no
  `excludeSelf`, which is the whole reason it chains off its own death.

- **"When the TWELFTH hour counter is put on ~"** — Midnight Clock. The
  same `counter_added` event Fathom Mage watches, with an intervening `if`
  on how many are now there. A count, not a distinct twelfth-counter event,
  which is also why a charge counter arriving at hour thirteen does nothing:
  the subject filter still has to match.

- **`shuffle_zones_into_library`** — the cards go back in as ONE batch and
  the library is shuffled once afterwards. Moving them one at a time would be
  no more random; not shuffling at all would leave the graveyard sitting on
  top in order, which is exactly what the printed word rules out.

- **`TargetRequirement.tokenTargetOnly`** — Caretaker's Talent: "target
  TOKEN you control". The mirror of `nonTokenOnly` from wave 310.

- **Flare of Fortitude** — read entirely onto machinery already present:
  `grant_player_shield` with `lifeLocked`, plus two `team_keyword_until_eot`
  grants at `scope: "permanents"`. That scope is wider than the creature team
  every other grant here means — the artifacts and lands are shielded too,
  which is most of what the card does against a sweeper.

- **Unbreakable Formation's addendum** — an `if_condition` on
  `own_main_phase`. "Those creatures" are re-read as the controller's
  creatures rather than remembered from the previous clause: it is the same
  set, because nothing can die between two clauses of one resolution.

- **`draw.countPerOpponent`** — Cut a Deal. Every living opponent drew, so
  "each opponent who drew a card this way" is how many there are, counted at
  bind, after their draws resolved. An eliminated player drew nothing.

- **`plays_land` — a land PLAYED is not a land that entered.** A fetched or
  reanimated land enters and was never played, and the printed wording draws
  that line deliberately. Dispatched from the one site a land is played from;
  the land is the subject and the player who played it is the subject player,
  so "that player" reads correctly.

  **This retires wave 211's refusal.** City of Traitors was left as a
  deliberate miss there with the note that "when you PLAY another land" is
  not "when another land enters", and approximating it would sacrifice the
  City to a fetched land. Landfall still reads the entry, so Lotus Cobra and
  City of Traitors now watch different events — which is the whole point.

  `excludeSelf` carries "another land": the City playing itself is not
  another land.

- **`team_set_pt_until_eot`** — Mirror Entity. A SET power and toughness
  (layer 7b), not a bonus, so a 7/7 SHRINKS to X/X — which is the whole
  reason the card is a finisher and not an anthem. The affected set locks in
  when the ability resolves (CR 611.2c), so a creature that arrives
  afterwards is not made X/X. `allCreatureTypes` rides the same effect.

- **`TargetRequirement.manaValueEqualsX`** — The Mycosynth Gardens: "with
  mana value X" is EXACTLY the announced X, not a cap. Resolved into a
  matching min/max pair in `putActivatedAbilityOnStack`, which is the only
  place the announced value is known — `isChosenTargetLegal` is called from a
  dozen sites that have no idea what was announced. Read as a cap, the
  Gardens would happily copy a Mox for X=2.

- **`EnterTappedUnless.turn_at_most`** — Starting Town: "unless it's your
  first, second, or third turn of the game". Read against the round counter,
  which advances once per seat cycle — round N is every player's Nth turn, so
  the two agree without a per-player tally.

- **`double_opponent_life_loss_on_your_turn`** — Bloodletter of Aclazotz.
  Both halves are restrictions: the controller's own life is untouched, and
  an opponent's own turn is safe.

  It replaces the LOSS, not the damage, which is how one rule reaches a
  drain, a Phyrexian payment and a combat strike alike. `lifeLossAfterReplacements`
  is called from BOTH places a player's life goes down — the `lose_life`
  effect and the combat-damage step, which decrements directly — because a
  doubler honoured in only one of them would be off by half the game. The
  DAMAGE figure stays as dealt (lifelink and "was dealt N damage" read that)
  while the life actually lost is the replaced one.

- **`ManaUpgrade.sameTypeCount`** — Incubation Druid: "add three mana of
  THAT type instead". Distinct from `anyColor`, which offers a fresh choice;
  here the choice was already made and only the amount changes. Reading it as
  `anyColor` would let the Druid make three of a colour it cannot produce.

- **`remove_from_combat`** — Reconnaissance. CR 506.4: out of combat but
  still on the battlefield. Not a tap and not a bounce — the creature deals
  and receives no combat damage, and any "whenever this attacks" trigger that
  already fired stays fired, which is the whole card.

- **`types_until_eot`** — Liquimetal Torque. Layer 4, so "in addition to its
  other types" really is in addition: the target becomes an artifact
  CREATURE, not an artifact, which is the difference between a Shatter
  finding a target and a Shatter finding a blank.

- **"on each of up to two target creatures"** — Rishkar. Two optional slots
  and one counter APIECE, which is not the same shape as "distribute two
  counters among" (The Earth Crystal, wave 301): that one divides a fixed
  pool, this one repeats a fixed amount.

- **`create_token.countFromSourcePower`** — Krenko, Tin Street Kingpin. Read
  when the tokens are created, not when the effect binds. Effects bind as a
  BATCH, so the sibling `add_counter` has not run at bind time and a
  bind-time reading would be one Goblin short on every attack.

- **`move_card.exileIfLeaves`** — Whip of Erebos: "If it would leave the
  battlefield, exile it instead of putting it anywhere else." Instance state
  on the arriving permanent, spent the moment it fires, so a second whipping
  gets a fresh shield and a card that reached exile some other way does not
  keep one. Without it the Whip is a repeatable reanimator: sacrifice the
  creature in response to the end-step exile and it is back in the graveyard
  for next time.

  **This retires wave 209's documented gap.** Unearth prints the same rider
  and had it recorded as unmodelled; it now carries the shield too, and that
  wave's test is inverted rather than deleted.

- **`untapDuringEachUntap: "self"`** — Bender's Waterskin is the
  one-permanent form of the Seedborn Muse static, so the sweep over the
  controller's board narrows to the source rather than growing a second
  mechanism.

- **`abilityHaste`** — Thousand-Year Elixir: "activate abilities of
  creatures you control as though those creatures had haste". ABILITIES
  only. Compiling it as a haste GRANT would also let a summoning-sick
  creature attack, which is a different and much better card.

  The summoning-sickness question is asked in four places — the activation
  validator, the mana-tap validator, and two legal-action enumerators — and
  they all now call one `canActivateTapAbility`. A grant honoured in three of
  them would either hide an ability the player may use or offer one the
  payment path then refuses. The ATTACK enumerator deliberately keeps its own
  haste check.

- **`taps_for_mana`** — Forbidden Orchard. Distinct from `becomes_tapped`,
  which also fires when a permanent taps to attack or an opponent taps it,
  and neither of those is "you tap it for mana". Both events fire from the
  one mana tap, so City of Brass is untouched.

- **The serializer's TriggerEvent guard is now a total record too.** It had
  already been a hand-written comparison chain that fell behind (rejecting
  `becomes_tapped` and `opponent_draws_second` on reload) and was then a
  `satisfies TriggerEvent[]` array — which checks that every entry is valid
  but not that every member is present. Third guard of this shape fixed in
  three waves.

- **An ability on the stack is a targetable object** (CR 113.7) — two target
  kinds, `spell_or_ability` (Spellskite) and `triggered_ability_you_control`
  (Strionic Resonator). The second refuses an activated or loyalty ability:
  those carry an index of their own, and a TRIGGER is what is left.

  Wave 305 left Spellskite alone rather than narrowing it to spells, because
  half the reason the card sees play is stopping targeted ABILITIES. This is
  the primitive it was waiting for.

- **`stackObjectRequirements`** — the target requirements of any object on
  the stack, spell or ability, modes included. The resolver reads the same
  shapes inline (it also needs the ability object to bind effects from); this
  exists so `retarget` asks EXACTLY the question resolution asks. A redirect
  that computed requirements differently could point a spell at something the
  resolver then refuses — and report success.

- **`copy_spell` copies an ability** — everything that says WHICH ability
  this is rides along: the trigger or activated index, the granted snapshot
  (a copy outlives its source exactly as the original does), and the
  triggering subject card, player and amount. A copy that dropped those would
  resolve "that creature" and "that much" to nothing.

  Magecraft is NOT fired by an ability copy: only a spell is cast or copied
  in that sense.

- **The serializer's TargetKind guard is now a total record.** It was a
  forty-line chain of `kind !== "…"` comparisons — the same drift shape as
  the keyword lists, with the same failure mode: a card compiles with no
  notes and its definition then cannot LOAD. Omitting a member is a tsc error
  now, and this wave's own round-trip test caught the omission first.

- **`creatures_sharing_a_type_with_it`** — Coat of Arms, and its
  `attacking_` sibling for Shared Animosity. Counted against the AFFECTED
  object, the way `auras_attached_to_it` is: "it" is what the ability
  touches, not the permanent the ability came from. Changelings are every
  creature type (CR 702.73), so one on either side of the comparison shares
  with anything that has a creature type at all.

  **`pt_until_eot`'s `per` count was measured against the SOURCE**, which is
  wrong for every "with it" count and was invisible while the only counts
  used there were controller-wide. Shared Animosity would have asked how
  many creatures share a creature type with an ENCHANTMENT — always none —
  and pumped every attacker by +0/+0, compiling perfectly cleanly.

- **`retarget.toCardId`** — Hydroelectric Specimen: "change the target … to
  THIS CREATURE". The new target is named by the card, so unlike Deflecting
  Swat there is nothing to prompt for. It takes the first requirement slot it
  legally fits; fitting none, the spell keeps its targets rather than being
  pointed somewhere illegal and reporting success.

- **`TargetRequirement.singleTargetOnly`** — "with a single target". A spell
  pointing at two things cannot be redirected, and one pointing at nothing
  has no target to change.

  Spellskite was probed and deliberately left: it says "target spell OR
  ABILITY", and no target kind in this engine reaches an ability on the
  stack. Narrowing it to spells would compile clean and play wrong — half
  the reason the card sees play is stopping targeted ABILITIES. Strionic
  Resonator and Return the Favor want the same missing primitive.

- **Hideaway's activation, and the gates it names** — the hideaway half was
  already here (`hideawayFromSource` records the exiled card ON the
  permanent, because "the exiled card" has no other referent). What was
  missing was the activation that plays it back and the conditions it gates
  on. Three joined the shared condition vocabulary, which trigger heads and
  activation gates both speak:

  - `attacked_with_creatures_this_turn` — Windbrisk Heights. The same
    question `ActivatedAbility.requiresAttackersThisTurn` asks for Minas
    Tirith, in condition form, because a gate synthesized from a printed
    "if" clause can only speak that language.
  - `opponent_damaged_this_turn` — Spinerock Knoll. DAMAGE, kept apart from
    `lifeLostByPlayerThisTurn`: a player who paid life for a painland lost
    life and was dealt nothing, and the printed gate asks the second
    question. ANY ONE opponent has to clear the bar — two opponents on four
    damage each is not seven damage to an opponent.
  - `library_at_most` — Shelldock Isle. "A library" is any library at the
    table, the controller's own included, which is how the card is normally
    turned on.

  A gate that cannot be READ is refused outright and the whole ability stays
  uncompiled. Dropping it would leave the ability activatable whenever, which
  is a wrong game rather than a missing one.

- **`GameState.damageToPlayerThisTurn`** — a per-player tally fed from the
  `deals_damage_to_player` event, which now carries an amount. One event-side
  tally rather than one per damage site, the same principle the life tallies
  already use: combat damage, a burn spell and a mass-damage effect are all
  counted once, in one place.

- **`look_and_assign.exilePlayableThisTurn`** — Expressive Iteration. An
  impulse window on whichever card the look sent to exile. Distinct from
  hideaway, which records the card on a PERMANENT for a later activation;
  this is the caster's own window and expires with the turn. The rider is
  refused when the look has no exile destination, so it never reads nothing.

- **Landwalk (CR 702.14)** — six Keyword union members (plainswalk,
  islandwalk, swampwalk, mountainwalk, forestwalk, nonbasic landwalk) rather
  than one parameterised field, so grants, keyword lines, searches and the
  layer engine all reach it through machinery that already existed:
  Trailblazer's Boots grants one with the same `grant_keyword` an anthem
  uses. `keywordCoverage` folds them back into the single CR 702.14 ability
  they are.

  Asked of the DEFENDING PLAYER's lands, not of the blocker — an Island
  anywhere under that player stops every one of their blockers, including the
  ones that are not lands. Subtypes are read through `cardMatchesSubtype`, so
  an Urborg'd Island is a Swamp, which is exactly why the printed wording is
  a type and not a name.

  **Three more hand-written copies of the keyword list went with it.**
  `KEYWORD_LINE` (which sentences ARE a keyword line), `KEYWORD_GRANTS` (the
  grant grammar) and the serializer's `KEYWORDS` are all derived from
  `IMPLEMENTED_KEYWORDS` now, joining `KEYWORD_BY_LABEL` from wave 300. The
  serializer one was the expensive kind: a definition holding a keyword
  missing from it compiles with no notes and then cannot LOAD.

- **`blockPowerGate`** — Champion of Lambholt and Delney: a blocking
  restriction decided by POWER. Neither `cantBlock` (the blocker may still
  block someone else's attackers) nor `cantBeBlocked` (only SOME blockers are
  stopped) can say it alone, so it is a static read at block declaration.
  Power is computed on both sides, so a counter on the Champion moves the
  wall.

- **`triggerDoubling` widened twice** — `cause: "casts"` for Veyran, and
  `source.maxPower` for Delney, whose restriction is on the ABILITY'S SOURCE
  rather than on what caused it.

  Veyran's "or copying" is dropped: a copy is put on the stack and never
  cast, so this engine has no cast event for it. A doubler firing on copies
  it cannot see would be worse than one that honestly misses them.

- **`opponentsStepOnly`** — Sheoldred: "At the beginning of each OPPONENT'S
  upkeep". Neither "your" nor "each", and the step's player now rides on the
  `step_begins` event as the trigger's SUBJECT, so "that player sacrifices a
  creature" names the one whose upkeep it is rather than all of them. The
  edict itself is the `choose_card` machinery the printed edicts already use,
  aimed at `{ type: "subject_player" }`.

- **`create_token.perSourceCounters` from a dies-trigger** — Chasm Skulker:
  "X Squid tokens, where X is the number of +1/+1 counters on ~". Readable at
  all because counters ride the card object through a zone change in this
  engine, where CR 400.7 would make the graveyard card a new object with
  none.

- **Evoke (CR 702.74)** — an alternative MANA cost taken in the same one
  direction every other alternative cost here is: only when the printed cost
  is out of reach. Nobody throws away a Mulldrifter they could have kept.

  `CardInstance.evoked` is set while the card is a spell on the stack and
  read once as it enters, so a Mulldrifter later reanimated keeps its body.

  Documented simplification: the sacrifice happens as the permanent finishes
  entering rather than as a separate triggered ability, so nothing can
  respond between the two — the same shape the Saga sacrifice uses. The
  enter triggers are queued FIRST, so the two cards are on the stack before
  the body goes, which is the whole card.

- **Echo (CR 702.29)** — compiled down onto the upkeep trigger it already
  is, the way cumulative upkeep is, and paying goes through the same
  pay-or-sacrifice prompt. `CardInstance.echoDue` is armed on entry and
  cleared the moment the upkeep asks, which is what makes "since the
  beginning of your last upkeep" answerable without a per-permanent upkeep
  history. Cleared whether or not the cost is paid: an unpaid echo loses the
  permanent and a paid one is settled for good.

  Documented gap: the debt is armed on ENTRY only, so a permanent that
  changes control does not re-arm its echo. That is the rarer half of the
  keyword. Only the mana form is read — "Echo—Sacrifice a creature" needs a
  cost the prompt cannot express, the same line cumulative upkeep draws.

- **Escalate (CR 702.120)** — the cost again for EACH mode beyond the
  first. A per-mode `extraCost` cannot say it: which mode is "the first"
  depends on what the caster picked, so charging every mode would tax the
  first one too.

- **`flashback.sacrificeCreatures`** — Dread Return and Cabal Therapy:
  "Flashback—Sacrifice three creatures", a cost with no mana half at all.
  Fodder is auto-picked WEAKEST-first, the documented approximation
  `altCastPayment` already makes; the card is in the graveyard, so it can
  never be its own fodder.

  **The load guard caught the empty mana half.** `expectString` rejects an
  empty string by default, so both cards compiled with no notes and then
  could not LOAD — and Cabal Therapy was not even on the list this wave set
  out to fix. That is the second time this guard has found a card the
  compile metric scored as working.

- **`AdditionalCastCost.mana`** — Redirect Lightning: "pay 5 life or pay
  {2}". The branch is added to the spell's cost rather than paid separately,
  so one payment covers both halves.

  The mana branch is preferred when payable, which departs from the
  documented "first affordable branch": nobody pays 5 life holding two spare
  mana, and life is the scarcer resource at this table size. Legal-action
  enumeration checks the branch against the spell's own cost PLUS the extra,
  because a branch payable alone is not payable at all — a spell must never
  be offered that the payment path would then refuse.

- **One battlefield-entry hook.** Both zone-change paths now call a single
  `onEnterBattlefieldInPlace` rather than repeating the queue calls. That is
  where the evoke sacrifice and the echo debt live, and where they would
  otherwise have been added to one path and forgotten on the other.

- **Counter replacements read a type SCOPE** — `double_counters` and
  `bonus_counters` each carried a lone `creaturesOnly` boolean, which is why
  nothing but "a creature" or "a permanent" could be said. Both now also
  take `typesAny`, and one shared `counterReplacementScope` reads the printed
  phrase for both. Ozolith, the Shattered Spire covers "an artifact or
  creature you control"; an enchantment is left alone, because the printed
  list is closed.

  Innkeeper's Talent's level 3 doubles EVERY kind of counter on every
  permanent. Its "or player" half is read and DROPPED: nothing in this
  engine puts a counter on a player, so the omission is silent rather than
  wrong — not an approximation, a gap with nothing behind it yet.

- **`EffectSelector.withAnyCounter`** — "Permanents you control with
  counters on them have ward {1}". `withCounter` names a kind; this asks
  whether there is any counter at all, and reads the counter VALUES rather
  than the keys, so a zeroed entry left behind by a removal does not keep
  the ward alive.

- **`move_counter`** — Nesting Grounds: one counter, from one chosen
  permanent to another. Two independent target slots, because the donor is
  restricted to what you control and the receiver is not.

  Which counter moves is not printed. It is auto-picked at bind, +1/+1 first
  and otherwise the first kind the donor carries — a documented stand-in for
  a choice the action has no field for. A bare donor moves nothing and does
  not fail the activation, since the printed ability has no "if you do".

  The ARRIVAL goes through the same placement path everything else does, so
  Doubling Season turns one counter moved into two arrived, which is the
  printed ruling. The removal is a plain decrement: taking a counter off is
  not an engine event.

- **`distribute_counters`** — The Earth Crystal: "Distribute two +1/+1
  counters among one or two target creatures you control." The count of
  COUNTERS and the count of SLOTS are different numbers and are read
  separately; every slot after the first is optional, because "one or two"
  permits one. The division is auto-split one-per-target and the remainder
  front-loaded — documented, since CR 601.2d wants the player to choose it
  and there is no field for that choice.

- **`counter_on_each_creature.colors` / `.enteredThisTurn`** — Oran-Rief,
  the Vastwood. Colour is read COMPUTED, so a creature made green by a
  static qualifies. Neither rider restricts the creature to one controller:
  an opponent's green creature that came down this turn gets a counter too,
  which is what the card says.

- **`TurnState.startTimestamp`** — what "entered this turn" is measured
  against: the value `nextTimestamp` held when the turn began. A permanent
  entered this turn exactly when its own timestamp is at least that.

  Derived rather than stamped per card deliberately. A card's timestamp is
  written at battlefield entry and nowhere else, but there are six such
  entry sites — four of them token paths — and a per-card flag would have
  been silently missed by the seventh one somebody adds. It is stamped in
  `assignNextPlayerTurn`, the one place a turn begins, extra turns included.
  `turn.number` could not carry this: it counts ROUNDS, not turns.

- **`counter_added` learned to watch a board** — Terrasymbiosis. The event
  existed for Fathom Mage, which watches ITSELF, so "self" stays the default
  and a board-watching head has to say `watch: "controlled"`. The event now
  carries the batch AMOUNT (after doublers and bonuses), which is what "draw
  that many cards" reads through the existing `subject_amount`. "Do this
  only once each turn" is the same `oncePerTurn` latch Morbid Opportunist
  uses, and both spellings now reach it.

- **Sagas (CR 714)** — `definition.saga.chapters`, indexed from chapter I. A
  lore counter goes on as the Saga enters, and again after its controller's
  draw step — modelled at the start of precombat main, which is the same
  moment, since nothing happens between the two but priority. The chapter
  matching the new count fires; a count past the last chapter does nothing.

  Documented simplification: the sacrifice happens as the final chapter
  finishes resolving rather than when the ability leaves the stack, so a
  response to the last chapter cannot save the Saga. Nothing in this engine
  reads the difference.

  A chapter that does not read fails the WHOLE Saga rather than leaving a
  gap. A Saga that sacrifices itself after a chapter it could not perform is
  worse than one that honestly misses.

- **`CardInstance.grantedActivatedAbilities` / `.grantedManaAbilities`** —
  "This Saga gains …". Instance state rather than a layer static, because
  the grant comes from a resolved chapter and has to outlive it: chapter
  II's ability is still there on chapter III. The quoted text goes through
  the shared `compileQuotedAbility`, which already tells a granted MANA
  ability from an activated one — chapter I's `{T}: Add {C}` must never use
  the stack.

- **`SearchFilter.manaCostIn`** — Urza's Saga chapter III searches for an
  artifact "with mana cost {0} or {1}": the printed COST, not the mana
  value. A {W} artifact has mana value 1 and is not what the card asks for,
  and there is a test for exactly that.

- **`create_token.bonusPt`** — the Construct's "+1/+1 for each artifact you
  control" belongs to the TOKEN, so it rides onto the definition each copy
  is made from. A lone Construct is 1/1, counting itself.

  The sentence splitter now shields periods inside SINGLE-quoted abilities
  too, which is how a token carries its own rules text. Only a span that
  looks like a whole quoted ability is shielded, so an ordinary apostrophe
  is left alone.
- **`openingHandStart`** — Gemstone Caverns. Begins the game on the
  battlefield with a counter, for a player who is NOT going first, at the
  cost of a card from hand. It rides the same start-of-game moment the
  leylines already use, just after mulligans finish, and the "may" is
  auto-taken the same way. The card leaves the hand FIRST, so it cannot pay
  its own cost; the exiled card is picked cheapest-first.

- **`ManaUpgrade.selfCounter`** — the same "add X instead" rider the Urza
  lands use, gated on the SOURCE's own counters rather than on what its
  controller has out. And the upgrade now GRANTS the colour choice when the
  base ability had none: Gemstone Caverns taps for {C}, so no colour was
  ever picked and the old path had nothing to rescale — it would have added
  colourless mana with a luck counter sitting on it.

  `createGame`'s mana mapper rebuilt `upgrade` field by field and dropped
  `selfCounter`, which would have made the upgrade unconditional: any colour
  always, counter or not. The sixth mapper-layer drop of this push.
- **Escape (CR 702.139)** — Underworld Breach. `grantsEscape` is a
  DEFINITION field on the granting permanent, not a layer static: the cards
  it reaches are in a graveyard, and the layer engine only sees the
  battlefield. The cost is the printed mana cost PLUS the exile, not instead
  of it, so it rides beside the payment rather than through `altCost`.

  The exiled cards are AUTO-PICKED cheapest-first, the same documented
  approximation `altCastPayment` already makes — a player exiling for escape
  reaches for spent lands and cantrips first. With too few other cards in
  the graveyard the escape is simply not available.

  Both zone gates had to learn it. `validateCast` decides and pays; but
  `putSpellOnStack` keeps its OWN reading of which zones a spell may be cast
  from, and without the same check there the spell was paid for and then
  refused the stack.

- **"Sacrifice ~." as a bare effect**, and **"At the beginning of THE end
  step"** as a trigger head. Both were general gaps: the head table took
  only your/each/each player's, and the self-sacrifice line had nowhere to
  land at all. "The end step" is the current turn's, whoever is taking it,
  so it reads as every player's — Underworld Breach goes away at the next
  end step, not only at its controller's, and that is a turn cycle of
  difference.
- **`choose_card.optional` + `thenEffectsIfNone`** — Braids, Arisen
  Nightmare, whose three sentences are one triggered ability. BOTH choices
  are real: auto-taking the controller's would sacrifice a permanent every
  end step whether they wanted it or not, and auto-taking an opponent's
  would decide the punisher for them, which is the entire card. A null
  answer declines, and the action type carries it so the decline is
  sendable; a choice that is not optional still refuses null.

  An opponent with nothing that shares a card type is punished too. They
  have not declined, they COULDN'T — and "for each opponent who doesn't"
  is still them.

- **`ChooseCardSource.sharesTypeWithChosen`** — resolved to a concrete type
  list when the effect BINDS, because by prompt time the card it shares a
  type with is already in a graveyard.

- **`choose_card` prompts now carry the ABILITY's controller.** The answer
  handler bound `thenEffects` against the CHOOSER, so "you draw a card"
  while an opponent is choosing would have handed the opponent the card.

  Fixed alongside: the resume-effect parser rebuilt choose-card sources
  inline and dropped every narrowing flag, so a RESUMED choice came back
  offering the whole zone — Sylvan Library would have let a card held since
  last turn be given back, and Dauthi Voidwalker would have offered an
  opponent's every exiled card.
- **`add_mana.untilEndOfTurn` / `PlayerState.persistentMana`** — Birgi.
  "Until end of turn, you don't lose this mana as steps and phases end"
  (CR 500.4). A tally is kept beside the pool, not in it, so ordinary mana
  is untouched; emptying keeps the SMALLER of the tally and what is actually
  left, which is what stops spent mana reappearing at every step boundary.
  That reads the expiring mana as spent first — a documented approximation,
  and the order a player would choose anyway. The tally clears at cleanup.

- **Birgi's "boast twice" is an ACCURATE no-op**, not a swallowed ability.
  Boast (CR 702.142) is not implemented, so no permanent in this engine can
  boast even once and raising the limit to twice changes nothing that can
  happen. Recorded here because it stops being accurate the day boast lands.

  Harnfel, the back face, already compiled whole: a discard-cost activation
  into `exile_top_play`.
- **`opponents_graveyard_to_void_exile`** — Dauthi Voidwalker. A card headed
  for an OPPONENT's graveyard is exiled with a void counter instead. Scoped
  by the card's OWNER, unlike Rest in Peace, which applies to the whole
  table — hitting your own graveyard too would be a different and much worse
  card. The counter is stamped only when this replacement is what redirected
  the move, so an ordinary exile stays bare, and it is how the ability below
  finds the card again.

- **`ChooseCardSource` in exile, with `hasVoidCounter`** — and an
  each-player SOURCE now spreads into one bound source per player, pooling
  every opponent's exile into a single choice. An each-player CHOOSER means
  one choice per player, which is a different thing; only the chooser was
  expanded before. `grant_play_chosen` then makes the chosen card playable
  this turn for free — the impulse grants already there only reach cards the
  same effect just exiled.

- **Five evasion keywords were being dropped in silence.** `KEYWORD_BY_LABEL`
  in `oracle.ts` was a hand-written THIRD copy of the keyword list, and it
  had drifted: fear, intimidate, horsemanship, shadow and skulk were all
  implemented in combat and present in the compiler's two tables, and
  missing from the one that reads printed labels. Every creature printed
  with one lost it and became ordinarily blockable — Dauthi Voidwalker is a
  3/2 that is unblockable in practice, which is the whole reason it sees
  play. The table is now DERIVED from `IMPLEMENTED_KEYWORDS`, so it cannot
  drift again.
- **`CardInstance.drawnOnTurn`** — Sylvan Library asks WHICH cards were
  drawn this turn, and a per-turn tally cannot answer that. Stamped inside
  the draw loop so every path that draws records it. A card held since last
  turn is not offered: it is the better card to give back, and offering it
  would turn the drawback into a bonus.

- **`ChooseCardSource.excludePreviousChoice`** — the two choices run in
  sequence, and the second must not name the first again. Paying the life
  leaves that card in hand, still drawn this turn, still legal — without the
  exclusion a player could pay for one card twice and keep both extras.
  Bound against `context.chosenCardId`, onto the `excludeCardId` the bound
  source already had.

- **`unless_pays.life`** — a cost paid from life rather than mana, and the
  first of those in a mid-resolution prompt. The mana half is then empty,
  which `expectString` rejects by default: caught by the load guard as a
  definition that compiled clean and could not be LOADED, exactly the class
  the guard was added for.

  All three sentences are ONE triggered ability, so the run builds the
  trigger rather than going through `commitClause` — parked as top-level
  effects on an enchantment, none of it would ever run.
- **`dynamicPt.powerOnly`** — Adeline. Her POWER counts creatures while her
  toughness stays the printed 4. The existing star-P/T clause reads "power
  and toughness are each equal to…" and set both; applying the count to
  toughness rewrites a number the card never touches. A second pattern
  beside it, not a widened one — the two phrasings mean different things.

- **`create_token.attackingEachOpponent`** — Adeline's attack trigger. One
  token per opponent, each tapped and attacking THAT opponent. The count and
  the defender are both per-opponent: a plain count sharing
  `entersTappedAttacking`'s single defender would send the whole squad at
  one player, and in a four-player game that difference is most of the card.
  Token doubling cycles through the opponents so the extras are spread
  rather than piled.

  "Or a planeswalker they control" is not offered: the token attacks the
  player. A documented approximation of a choice.

  `createGame`'s definition mapper rebuilt `dynamicPt` field by field and
  dropped `powerOnly` — the fifth time a mapper layer has silently lost a
  new field in this push, and the reason every wave now asserts through the
  mappers rather than at the compiler alone.
- **`copySelfWhenCastFromGraveyard`** — Sevinne's Reclamation. A definition
  flag rather than an effect, because the spell has already been popped off
  the stack by the time its own effects bind: there is no "this spell" left
  for an effect to name. The copy is pushed during resolution, from the
  resolving object.

  The copy takes FRESH targets, not the original's. Keeping them would aim
  it at the permanent this very resolution just returned to the battlefield,
  where it is no longer a legal graveyard target — the card would compile,
  resolve, and reliably do nothing, which is the failure this project cares
  most about. The choice is auto-taken, the same documented approximation
  `draw.optional` carries; with nothing else legal, no copy is made at all.

  The copy does not carry `fromGraveyard`: it was never cast, and the flag
  would have it copy itself until the graveyard ran out.
- **`reanimateOnEnter`** — Animate Dead. An Aura cast on a creature card in
  a GRAVEYARD. The card is put onto the battlefield under the spell's
  controller and the Aura attaches to it, both during RESOLUTION rather than
  in an enter trigger — a loose Aura is destroyed by a state-based action,
  and a trigger would leave exactly that gap. `enchant` stays `"creature"`,
  because that is what it ends up attached to and what the loose-Aura sweep
  reads; the graveyard is where the TARGET lives, not the host.

  The printed text is a legacy contortion — the Aura rewrites its own
  enchant clause mid-resolution — and is matched whole, because no part of
  it means anything alone.

- **A permanent may watch ITSELF leave the battlefield.** Two gaps stood
  between Animate Dead's last line and it ever running:

  - `leaves_battlefield` was only DISPATCHED when the permanent carried
    +1/+1 counters. That gate was The Ozolith's ("if it had counters on
    it"), but it lived on the event, so every counterless departure was
    invisible to every trigger. The event now fires on any battlefield exit
    and the counter test sits in the matcher, with the trigger that asks it.
  - The matcher forced `watch: "controlled"`, and the look-back that lets a
    departed permanent see its own event covered `dies` only. Both now admit
    `watch: "self"`, deduped by card so a permanent that DIED — which
    dispatches both events — does not fire its trigger twice.

  `CardInstance.reanimatedCardId` records what was animated, kept apart from
  `attachedTo` because that link is torn down as the permanent leaves and
  the trigger has to name the creature after it has gone.
- **Definitions that compile but cannot LOAD** — a whole class, now guarded.
  `server/src/definitionLoads.test.ts` round-trips every compiled definition
  through `serializeGameState`/`parseGameState`, over the vendored sample
  always and over the full bulk file when `COMPILE_BULK` is set.

  The serializer's parsers are hand-written and had drifted NARROWER than
  the types they parse. 39 printed cards compiled with no notes and produced
  definitions that would not load, so a saved table holding one could not be
  reopened. Nine were in the top 2000 and two of those inside the top 500 —
  Mystic Sanctuary (#169) and Faeburrow Elder (#498) — both counted as fully
  compiling the whole time, because the compile metric reads notes and a
  definition that never loads produces none.

  Four drifts, all closed:

  - `dynamicPt.count` and `bonusPt.per` each carried their own hand-written
    subset of `DynamicCount` — eight and five of the twenty-four. They now
    share `DYNAMIC_COUNTS_BY_NAME`, a `Record<DynamicCount, true>`, so a new
    union member is a COMPILE error here rather than a save that will not
    open.
  - `EnterTappedUnless.controlled_subtype` was in the union and emitted by
    the compiler but never parsed, which took all five Eldraine castle lands.
  - `damage_all.amount` did not parse `"creature_count"` (Chain Reaction).
  - `team_pt_until_eot` took only `"creature_count"`, not `"greatest_power"`
    or `"x"` — closed in the wave before this one, and the reason this sweep
    exists at all.
- **`search_library.alsoGraveyard`** — Finale of Devastation. "Your library
  AND/OR graveyard" is one pool the search picks from. The shuffle then
  happens only when the card did not come from the graveyard; finding
  nothing still shuffles, because you looked. A documented reading — the
  engine cannot know whether a player who took a graveyard card also looked
  at their library. The empty-library bail now checks the graveyard too, or
  the whole search would be skipped on the board where this card is best.

- **`announced_x_at_least`** — "If X is 10 or more". The announced X lives
  in the binding context, not on the board, so `if_condition` settles this
  condition before consulting `triggerConditionHolds`, which has no X to
  read. That function returns false for it explicitly: without a branch it
  fell through to the artifact-mana-value check at its end, which answers a
  different question and can say yes.

  **A load failure this exposed:** the `team_pt_until_eot` parser accepted
  only `creature_count`, though the type has always allowed `greatest_power`
  and `x`. Four cards — Overwhelming Stampede, Pathbreaker Ibex, Tyvar the
  Pummeler, and Finale itself — compiled with no notes and produced
  definitions that could not be LOADED. The compile metric reads notes, so
  it counted three of them as working.
- **`enterAsCopy.untilEot` / `.grantHaste`** — Cursed Mirror. The copy
  lasts one turn and then the PRINTED card comes back, through the same
  `temporaryCopies` revert Mirage Mirror uses; the restore id is recorded
  before the swap, so what returns is the mana rock and not the creature.

  "Except it has haste" is NOT one of the cosmetic granted keywords the
  Clone rider parser is allowed to drop. A mana rock that becomes a
  creature and then cannot attack until next turn is a different card. The
  grant clones the copied definition, so the creature it copied — and every
  other copy of that creature — stays hasteless.

  A second pattern rather than a widened Clone one: Cursed Mirror prints a
  different sentence ("As ~ enters, you may have it BECOME a copy…"), and
  its two riders are real where the Clone family's are cosmetic.

  Fixed alongside: the `enter_as_copy` PROMPT serializer carried none of
  `entersTapped`, `untilEot`, or `grantHaste`. A game saved with the choice
  still open came back with Vesuva's copy untapped — a live drop that
  predates this card. The prompt is state, not scaffolding.
- **A look clause that spans SENTENCES** — Thassa's Oracle, and every
  Impulse-style ETB. A trigger body is parsed as ONE sentence, but a look
  and its assignment print as two on a single line. `foldLookRun` hands the
  pair compiler a synthetic list starting at the body itself, stopping at
  the printed line break where a separate ability begins. A partial read is
  refused: a look with no assignment discards what it saw.

- **`countFromDevotion` / `upToOneOnTop`** — Thassa's Oracle. X is devotion
  to blue, so neither the count nor the number of destination slots exists
  before the effect binds. The slots are one `library_top` plus a
  `library_bottom` for EVERY card — exactly `count` bottom slots would force
  a card onto top, and the card says "up to one". The unused `count` is 0,
  so losing the flag yields no look rather than a look of invented size.

- **`win_game.ifDevotionAtLeastLibrary`** — the same X, evaluated at bind
  beside the look, because on the card it is one number and not two. The
  comparison is `>=`, and an EMPTY library wins with nothing to look at —
  that is the whole card, not an edge case.

  Both `win_game` (bind and serializer) had to be split out of the grouped
  case they shared with `lose_game`: the group returned `{kind, playerId}`
  and would have dropped the condition in silence. The serializer also
  accepts the empty `destinations` list, which it rejected — that made the
  DEFINITION fail to load, a card that never reaches the table at all.
- **"One or two target creatures can't block this turn"** — Untimely
  Malfunction. The COUNT is a clause-level shape, not a noun-phrase one: a
  phrase is a single requirement and cannot say "one or two". So the clause
  emits two slots and the head decides how many are required — "two" needs
  both, "one or two" needs the first, "up to two" needs neither — which is
  the same trailing-optional shape "Exile up to two target" already uses.
  Targeting rejects zero, rejects three, and rejects the same creature
  twice; an untargeted creature is left able to block, which is the whole
  difference between this and a one-sided blocking ban.

  Untimely Malfunction's other two modes already compiled: "Destroy target
  artifact" and the `retarget` of a spell with a single target. A modal card
  only counts when EVERY bullet reads, so the card was failing on this one.
- **`countFromGreatestControlledPower`** — Selvala, Heart of the Wilds. The
  GREATEST power among creatures you control: not the source's own
  (`countFromPower`) and not their sum, which are the two neighbouring
  readings and both wrong. Opponents' creatures are not counted.

  "In any combination of colors" is NOT offered: the tap picks one colour
  and adds X of it. A documented approximation of a free split, and a real
  loss of fixing on a card that exists to fix.

- **`subject_power_greatest`** — Selvala's trigger. Strictly greater than
  EACH other creature on the battlefield, so a tie fails — a tie passing
  would fire the trigger on every mirrored board. Compared against every
  creature, not only the controller's.

- **A trailing intervening "if"** (CR 603.4). Selvala prints the condition
  AFTER the body; the existing peel only read a leading one. Peeled only
  when the condition READS, so an unreadable one stays attached and the
  trigger is a miss rather than one that fires unconditionally.
- **Exert** (CR 701.39) — Arena of Glory. The permanent taps as usual and
  then does not untap during its controller's NEXT untap step, which is
  the `skipNextUntap` flag Vorinclex already set. The skip is the whole
  mechanic: without it the ability is a free tap for two red every turn.

  The regex first written for it was `/\bExert ~\b/`, which can never
  match — `~` is a non-word character, so the trailing boundary needs a
  word character next and the next character is a colon. The generic
  costed-mana-ability branch then swallowed the ability and produced an
  exert-FREE version; that branch now refuses an exert cost outright.

- **A mana rider that reaches the spell** — Arena of Glory's "it gains
  haste" means the spell its mana paid for. `drainManaRiders` binds with
  the cast card as the subject, so `subject_card` resolves to it — the
  spell is already on the stack by the time the riders drain.
- **`may_sacrifice` of ANOTHER creature** — Disciple of Freyalise. The
  fodder is picked when the effect BINDS, not when it applies, because the
  inner effects read its power and are bound in the same breath — picking
  again at apply could sacrifice one creature and pay out for another. The
  chosen card rides on the bound effect so the two can never disagree.

  Biggest power first. The pick is an auto-choice either way, and this
  shape only ever appears on cards that pay you for what you sacrificed.
  With nothing else on the battlefield the "may" DECLINES rather than
  eating the source, which would take the trigger with it.
- **An overload cost in different colours** — Damn ({1}{B}{B} printed,
  Overload {2}{W}{W}). The existing overload path models the cost as the
  printed one plus a generic EXTRA, which cannot express a different
  colour — treated as an extra, a mono-black caster could overload a white
  spell by paying black. `SpellMode.replacesCost` swaps the whole cost
  instead, and it is folded into the cost expression so it is in force
  before the commander tax and before any payability check. Checked after,
  the spell is refused for mana it was never going to spend.

  Cyclonic Rift and the rest keep the cheaper extra-cost shape: same
  colours, so nothing about them moves.

- **"It can't be regenerated"** (CR 701.15d) is `denyRegeneration` on the
  destruction it was printed beside — on the `move_card` for the targeted
  form and on the `destroy_all` for a sweep, never on the card. "Destroyed
  THIS WAY" reaches one ability: the top-level reader stops at the printed
  LINE it was on, and the modal, activated-body and loyalty-body readers
  stop at their own bullet or ability. It turns the shield off for that
  one destruction without spending it, and it answers regeneration only —
  indestructible and totem armor are unaffected. The clause compiled to
  nothing until wave 351, which was exact until wave 344 gave regeneration
  a shield to deny and left the wraths losing to it.
- **"Can't be regenerated THIS TURN"** — the damage-based form (Incinerate,
  Disintegrate, Flamebreak) is a lasting effect on the creature rather than
  a rider on a destruction, and is **not** implemented. 18 printings, none
  in the top 2,000.
- **Paying life for the top of your library** — Bolas's Citadel.
  `TopOfLibraryGrant.payLifeInsteadOfMana` replaces the cost OUTRIGHT, the
  same way flashback does, and rides the same life-payment path. A cost
  that had merely been reduced would still refuse a caster with no mana.
- **A cast tally by name, for the game** — Approach of the Second Sun.
  `spellsCastByNameThisGame` is the one per-state tally that never resets,
  and it counts the current cast, so "another spell named this" is two.
  `CardInstance.castFromZone` records where a spell was cast from, on the
  card rather than the stack entry, because the question is asked while the
  spell resolves and the entry is already gone.
- **A numeric library position** — `LibraryPosition` accepts `{ fromTop: n }`,
  one-based; a library shorter than that takes the card on the bottom.
- **Exert** (CR 701.39) — Combat Celebrant. One flag answers both halves:
  it gates "hasn't been exerted this turn" and it makes the creature miss
  its controller's next untap step, which is also the step that clears it.
  Exerting is auto-taken.
- **"Permanents that had a counter put on them this way"** — Ripples of
  Potential. That set exists only inside the proliferate that made it, so
  the phase-out is a rider on the same effect rather than a separate one
  reading state left behind. "Any number" is auto-taken: everything it fed
  phases out. A -1/-1 counter is not fed, so its permanent does not phase.
- **Exiling a spell** (CR 701.11) — Mindbreak Trap. `exile_spell` removes a
  spell from the stack WITHOUT countering it, so "can't be countered" does
  not stop it; that is deliberately not `counter_spell` with `exileInstead`,
  which does check. "Any number of target spells" is a variable requirement
  expanded per chosen spell.
- **A free cast gated on an opponent's spell count** — Mindbreak Trap.
  `altCost.opponentSpellsThisTurn` asks about any ONE opponent, not the
  table's combined total.
- **A fog for one player, and the damage it prevented** — Inkshield.
  `combatDamageShields` prevents at the damage site rather than
  short-circuiting the whole step, so it can be scoped to one player and can
  count what it stopped. Prevented damage was never dealt: no life loss, no
  poison, no lifelink, no commander damage, no damage events. The token
  rider is paid once after both strike steps, so two attackers held off by
  one shield make one pile.
- **"Half its power, round up" and "if it dies this way"** — Saw in Half.
  The halving resolves at BIND (effects bind as a batch, so that is the last
  moment the creature is on the battlefield to measure) and the death check
  at APPLY (the first moment the answer exists). Indestructible, regeneration
  and totem armor each mean no copies at all.
- **Token multipliers beyond doubling** — Ojer Taq. `double_tokens` carries
  a `multiplier` and an optional `creaturesOnly` scope; multipliers compound
  (CR 614.1c), so a tripler beside a doubler is six. The shared factor asks
  the caller whether the token being made is a creature, because a Treasure
  is not.
- **"Return it transformed"** — Ojer Taq. `move_card.transformed` brings the
  card back on its other face as it arrives, so nothing sees the front face
  enter. With no other face it returns as itself.
- **A search sized by an additional cost** — Eldritch Evolution.
  `SearchFilter.maxManaValuePlusSacrificed` is the printed offset; the rest
  comes from `sacrificedManaValue`, captured when the sacrifice cost was
  paid and carried on the stack, because by bind time the creature is in a
  graveyard and nothing remembers which one it was. Kept separate from
  Fling's `sacrificedPower`: power must be read before death (a pump ends
  with it), mana value need not be.
- **"Shuffle it into its owner's library instead"** — Blightsteel Colossus,
  Progenitus, Darksteel Colossus. A replacement on the CARD, so it applies
  from every zone (countered on the stack, discarded from hand), and the
  first redirect that targets the library rather than exile — it overrides
  the default insert position, because shuffling in is not putting on top.
  The card never reaches a graveyard, so no dies-watcher sees it and there
  is no window to respond in; that is the difference from Kozilek's trigger.
  For a commander, the command-zone redirect wins (CR 903.9a is a choice,
  and this engine makes it one way).
- **Infect** (CR 702.90) and **poison counters** (CR 104.3c). Damage from an
  infect source gives a player poison counters instead of costing life, and
  gives a creature -1/-1 counters instead of marked damage — so it kills
  through a lifegain fog and a survivor stays shrunk. Lifelink still gains
  and the damage events still carry the amount: the damage happened, only
  what it did changed. Ten poison counters lose the game at any life total.
  Nothing in this engine removes a poison counter yet.
- **The hand-authored override registry is EMPTY.** The mechanism is kept
  for the next card the compiler genuinely cannot read; the test asserts the
  map holds nothing, so an addition is a deliberate act.
  An override shadows the compiler completely, and the compile-rate metric
  counts an overridden card as full by construction — so a stale entry is
  invisible in two places at once and nothing expires on its own. Of the 21
  retired in wave 363, fourteen were approximations that played a stronger
  card than the printed one: Exotic Orchard and Fellwar Stone tapping for
  any colour rather than what an opponent's lands could make, nine filter
  lands tapping for coloured mana without paying the filter, Solemn
  Simulacrum's optional death-draw made mandatory, Eternal Witness's
  targeted return made an untargeted choice. Each was honest when written
  and wrong by the time it was removed.
- **"If you do, …" after a "you may"** — the rider joins the trigger or
  activated ability it follows, rather than stranding in `definition.effects`
  where a permanent never runs it. A documented approximation: optional
  effects are auto-taken, so the antecedent always holds. A "may" the engine
  declines for its own reasons (a draw that would deck you) still runs the
  rider.
- **A win counted on shared names** — Mechanized Production.
  `win_game.ifSameNameCount` counts the largest group of same-named
  permanents of a type the player controls, and is evaluated at APPLY: the
  token the same ability just created is one of the eight, and effects bind
  as a batch. Eight artifacts across two names does not win.
- **"Repeat the following process X times"** — Torment of Hailfire.
  `repeat_x_times` expands at bind, where the announced X lives, binding the
  inner effects once per repetition so an each-opponent choice inside is
  made afresh each time. A process that needs targets is refused: the
  repetitions would all aim at one set chosen once.
- **A punisher choice across two zones** — Torment of Hailfire. "Loses N life
  unless that player sacrifices a nonland permanent OR discards a card" is
  one `choose_card` over a pool spanning the battlefield and the hand, with
  the life loss as `thenEffectsIfNone`. The chosen card leaves by
  `sacrifice_or_discard_chosen`, which reads its zone at apply and fires the
  matching event — a sacrifice and a discard are not the same thing to the
  watchers, even though both end in the graveyard.
- **"Put into a graveyard from anywhere"** — Kozilek, Ulamog. A distinct
  event from `dies` (battlefield only) and from Syr Konrad's
  `put_in_graveyard_from_elsewhere` (everything but the battlefield), because
  it is the superset of both and the other two mean what they say. It is
  dispatched from the stack-exit path as well as the player-zone one, so a
  COUNTERED spell fires it — which is the case these cards are printed for.
  The watcher is the card itself, already in the graveyard, so it rides the
  graveyard pass; "its OWNER shuffles" uses a `source_owner` selector,
  because `controllerId` survives a zone change and a stolen permanent
  still goes home to its owner's library.
- **Annihilator N** (CR 702.85) — lowered to its rules text: an attack
  trigger emitting N single `choose_card` sacrifices, chosen by the
  `defending_player`. That selector is read off the combat record at bind
  rather than from the event, which carries only the attacker; at four
  players the defender is a choice the attacker already made. N single
  choices rather than one choice of N: they happen in one resolution, so
  deaths still batch for dies-watchers, and a defender with fewer than N
  permanents loses all of them.
- **"When you cast this spell"** (CR 603.2c) — `CardTrigger.onSelfCast`. The
  watcher is the object being cast, which sits on the stack, so it gets its
  own dispatcher pass beside the battlefield and graveyard ones. The trigger
  goes on the stack above the spell and resolves first; a targeted one
  pauses for its targets before stacking, with the spell waiting underneath.
  The flag gates the zone in both directions, so the ability does not also
  fire from the battlefield.
- **A static that SETS types** (layer 4) — Imprisoned in the Moon, Song of
  the Dryads. `set_types` replaces the printed types and subtypes where
  `add_types` adds to them; "loses all other card types" is the whole of
  both cards. Aura host legality (CR 704.5m) reads a total record of enchant
  restrictions, so an Aura whose own effect changes what its host IS stays
  attached — Imprisoned in the Moon enchants "creature, land, or
  planeswalker" precisely so it survives turning its host into a land.
- **Transform** as an effect — Growing Rites of Itlimoc, Ojer Taq. "Transform
  this permanent" swaps the instance to its `otherFaceId`, from a trigger
  body or an activation. The apply path predates any clause reaching it.
- **Abilities that work from the graveyard** (CR 113.6d) — Bloodghast,
  Silversmote Ghoul. `CardTrigger.fromGraveyard` gates the watcher's zone in
  both directions: a card in the graveyard fires only the triggers that say
  they work there, and those fire only from there. The flag is derived — a
  trigger that returns its own card to the battlefield can be watching from
  nowhere else — with `dies` and `leaves_battlefield` excluded, because
  persist and undying are battlefield triggers reading last-known
  information (CR 603.10a) through the dispatcher's separate look-back pass.
  The printed "you may" on a self-return is a documented AUTO-TAKE: the
  engine always returns the card. Declining is a real choice on paper — a
  card kept back for delirium — and is not modelled.
- **A land that puts itself onto the battlefield** — Talon Gates of Madara.
  `ActivatedAbility.zone: "hand"` was already honored by `legalActions` and
  `applyAction`; this is the first printed card compiling into it. The
  ability is not a land drop, so it does not spend the turn's land, and it
  is offered from hand only.
- **A card type filter on a graveyard target** — Deathrite Shaman.
  `TargetRequirement.requiredTypesAny` is an ANY-of list of card types read
  from the printed characteristics, and it sits beside `requiredSubtypesAny`
  rather than adding more `own_graveyard_*_card` union members (there are
  already eight, each handled by hand). The compiler reads the type words
  from a table, so an unrecognised qualifier declines the phrase instead of
  compiling the unfiltered target. Deathrite's first ability targets, so it
  is not a mana ability (CR 605.1a) and uses the stack like the other two.
- **Coven gating a top-of-library grant** (CR 702.145) — Augur of Autumn.
  `hasCoven` counts DISTINCT powers among the creatures you control, not
  creatures: three 2/2s do not turn it on, and the powers are read live
  through `creaturePower`, so a +1/+1 counter can switch the grant on
  without anything else changing. The flag is `castRequiresCoven` rather
  than a whole-record `requiresCoven` because Augur prints three grants
  into one `TopOfLibraryGrant` and only the casting is gated — her look
  at the top card and her land drop off the top are ungated abilities
  that must keep working with coven off.

  CR 119.4: life may be paid down to zero but never past it, so the guard
  is `life < cost` — not the `life <= cost` the flashback rule uses, which
  would wrongly refuse the exact-life cast. `legalActions` asks the same
  question, or the spell is never offered at all.

- **`nonland_permanent` as a sacrifice scope** — Bolas's Citadel's own
  ability. Falling through to the card-type checks would have made it match
  nothing. Three scopes were missing from the SERIALIZER's hand-written
  chain (`another_creature_or_artifact`, `token`, and this one), which made
  any definition using them fail to LOAD rather than merely parse wrong.
- **`becomes_target`** — Goldspan Dragon. Dispatched from `putSpellOnStack`
  for each DISTINCT permanent the spell targets: a spell that names the
  same creature twice still targeted it once for this purpose. Only the
  targeted permanent watches it — a shared event would make every Dragon on
  the table trigger off every spell.

  Spells only, as the card says. An ability targeting it is a different
  trigger and is not dispatched here.

- **A granted mana ability may sacrifice its source** — Goldspan Dragon
  grants Treasures a BETTER mana ability, and a Treasure's ability
  sacrifices it. `sacrificeSelf` is a shape `ManaAbility` already carried;
  refusing it in the quoted-ability compiler was the only thing stopping
  the grant. A Treasure that taps without sacrificing is an infinite mana
  engine, so the flag is not cosmetic. Costs the mana ability still cannot
  carry (a life payment) are refused as before, rather than granted free.
- **Modal triggers that take more or fewer than one** — Black Market
  Connections, Hullbreaker Horror. `CardTrigger.modeChoice` carries the
  bounds; absent means exactly one, which is what every modal trigger
  written before these asked for. Several chosen modes ride the stack
  object together in `modeIndexes` and resolve in order as ONE ability, so
  their effects concatenate rather than the first one winning.

  "Up to one" with none chosen stacks nothing at all, which is what the
  phrase means. The bot and the fuzzer both respect the bounds — answering
  a "choose one or more" trigger with a single mode would be refused and
  freeze the game.

  Bullet mode NAMES are flavour (CR 207.2c) and are stripped: "Sell
  Contraband" is not something the engine can do, and leaving it in the
  clause would make the whole mode a miss.

  `modeChoice` was dropped by the trigger mapper on the way into the
  definition, which is the four-layers trap: the compiler produced it
  correctly and the definition never saw it.

- **A spell target you do not control** — Hullbreaker Horror. The `spell`
  requirement now honours `control`. Parsed onto the requirement and then
  ignored, the filter read as decoration and the Horror could bounce its
  own spell.
- **`discard_land_or_graveyard`** — Mox Diamond. Modelled the way the shock
  lands already are: the permanent enters and the choice is prompted just
  after, rather than as a true CR 614 replacement. Declining moves it to
  the graveyard. Documented, and silent in play — nothing can respond
  between the two.

  Saying yes with no land in hand lands in the SAME place as saying no. A
  yes that quietly kept the Mox would make it free whenever you are out of
  lands, which is a much better card. The land is auto-picked cheapest
  first, the same approximation `discardCost` already uses.

  Mox Diamond prints its replacement as three sentences — the offer, and
  one for each answer. The last two say exactly what the replacement
  already means, so they are dropped: compiled separately they would be
  top-level effects on an artifact card ("put ~ onto the battlefield") that
  never run, and the card would score while doing nothing at all.
- **A free spell only on someone else's turn** — Force of Negation.
  `AlternativeCastCost.onlyOnOpponentsTurn` is checked in `altCastPayment`,
  where the payment is offered, rather than left to the player's honesty: a
  free counterspell you could also fire on your own turn is a different,
  better card. The gate is peeled off the front of the sentence and only
  when what follows parses as an ordinary alternative cost.

- **A countered spell that exiles instead** — Force of Negation.
  `counter_spell.exileInstead` joins the flashback rule already in
  `applyCounterSpell` (CR 702.34a). The destination matters to everything
  that reads a graveyard afterwards, so the negative case is tested too.

  The rider is a SENTENCE of its own that modifies the counter before it.
  Compiled separately it would be an effect with nothing to act on, and the
  countered spell would quietly reach the graveyard anyway — so it folds
  onto the last `counter_spell` on the same printed line.
- **Hideaway** (CR 702.75) — Mosswort Bridge. The ETB is the existing
  look-and-assign prompt with one exile slot and the rest bottoming, plus a
  link: `hideawaySourceId` records the exiled card on the permanent that
  hid it, in the same `imprintedCardIds` list Chrome Mox uses. Without the
  link the ability that plays it later cannot say WHICH exiled card is "the
  exiled card", and would offer every exiled card in the game.

  `play_hidden_card` grants the source's own hidden cards as playable, free.
  It reads the SOURCE, so two Bridges never offer each other's.

  `controls_total_power_at_least` is the SUM across your creatures, not the
  greatest single power — a different question and a much easier one to
  meet. Two 4/4s is 8, not 10.

  The gate rides the ABILITY, not the effect. Mosswort Bridge prints its
  condition inside the effect sentence rather than as a separate "Activate
  only if" line, so `SimpleClause.activationGate` carries it up to
  `requiresCondition` — an unmet condition then offers nothing, instead of
  offering an activation that resolves to nothing. A condition the parser
  cannot read is REFUSED rather than dropped: dropping it would make the
  ability activatable whenever, which is a wrong game rather than an
  uncompiled one.
- **`look_top_take_matching`** — Herald's Horn. Look at the top card and
  take it if it matches. The two printed sentences are fused before
  compiling, because the second names the card the first looked at: alone,
  the look would discard what it saw and the condition would have no
  referent.

  The filter's subtype is filled from the SOURCE's as-enters chosen type at
  bind. No type chosen matches NOTHING — read as "any type" a Horn placed
  without its choice would hand over the top card of the library every
  upkeep. The "you may" is auto-taken, the same documented approximation
  `draw.optional` already carries: a free card is never worth declining.
- **Imprint** — Chrome Mox. `CardInstance.imprintedCardIds` records the
  cards exiled WITH a permanent, which its own abilities then read. Exiling
  with a plain `move_card` would lose the link and leave the Mox producing
  nothing, so `imprint` is its own effect: it exiles and records in one go,
  and refuses without a source rather than exiling into the void.

  The colour choice is a new `anyColorAmong` scope, `"imprinted"`, which
  needed the SOURCE threaded through `manaTapOptionsFor` and
  `manaChoiceColors` — the controller alone cannot say which Mox is
  tapping, and two Moxen with different imprints would produce the same
  colours. An unimprinted Mox has an empty set and the existing mana gate
  refuses the tap, which is exactly what the card does; a colourless
  imprint is legal and equally dead, since colourless is not a colour
  (CR 107.4c).

  The ability word "Imprint —" is flavour (CR 207.2c) and is stepped over.
  The hand filter `nonartifact_nonland` is new; a filter missing from the
  matcher reads as "everything qualifies", so it is tested against a land
  and an artifact directly.
- **Multikicker** (CR 702.32) — Everflowing Chalice. Kickable any number of
  times, which the two-mode shape Kicker uses cannot express. Modelled by
  rewriting the CAST COST to carry one `{X}` per generic pip of the kicker
  cost, so the announced X IS "how many times it was kicked" and the
  existing announcement machinery does the rest.

  The mana VALUE is unchanged: `{X}` is 0 anywhere but the stack (CR
  202.3b), so a Chalice on the battlefield is still mana value 0 and every
  effect that reads it is unaffected. A kicker cost with coloured pips is
  REFUSED — an `{X}` cannot express it, and the model would undercharge,
  which is a cheaper card than the one printed.

  `entersWithXCounterKind` carries the counter kind, because "a charge
  counter for each time it was kicked" is the hydra shape with a different
  counter. The shared site hardcoded `p1p1`; +1/+1 counters on a Chalice
  are invisible to everything that reads charge counters, and it is not a
  creature. A test asserts hydras still get theirs.
- **`own_graveyard_creature_or_planeswalker_card`** — Takenuma, Abandoned
  Mire. The graveyard target family is listed BY HAND in three places: the
  legality gate, the enumeration, and the parser's allow-list. A kind
  missing from the first reads as legal-by-default, missing from the second
  is silently unofferable, and missing from the third makes the whole
  definition fail to load. All three are covered by tests here.

  Takenuma writes "a creature or planeswalker card", not "target". The
  engine has no untargeted graveyard chooser, and reading it as a target
  moves the choice from resolution to announcement — for a Channel ability
  those are the same moment, and nothing in a graveyard has hexproof. A
  documented approximation, and one that still refuses a noun phrase it
  cannot read: "a Goblin or Dwarf card" stays a miss.
- **Dual trigger heads** (CR 603.1) — "When ~ enters AND whenever …, BODY"
  is TWO triggered abilities sharing one body. The ETB branch matched
  `(?: and whenever [^,]+)?` and threw the second half away, so 5 cards in
  the bulk dump compiled CLEAN while doing half of what they say — a
  correctness bug the compile metric scored as a success.

  `expandDualTriggerHeadInPlace` now splits the sentence into two, each
  carrying the whole body, and only when BOTH halves read as heads on their
  own. `parseTriggerHead` refuses anything still containing "and whenever",
  so a pair it could not split stays an honest miss instead of coming
  through half-read. Three cards now compile with both triggers; the rest
  became misses, which is the right direction — the raw count went flat and
  the play-weighted number still rose.

- **A trailing "Then …" belongs inside the trigger** — Orcish Bowmasters.
  Parked as its own sentence it becomes a top-level effect on a creature
  card, where nothing ever runs it. Fused BEFORE the head split, so a dual
  head carries the whole body into both of its triggers.

- **`opponent_draws_except_first`** — Orcish Bowmasters. The `draws` event
  now carries `firstInDrawStep`, set only for the FIRST card of the
  turn-based draw-step batch — a Howling Mine's extra draw in the same step
  is not exempt. Without the exemption the Bowmasters ping on the draw step
  too, which is a strictly stronger card than the one printed.
- **A copy of the EQUIPPED creature, and a token that isn't legendary** —
  Helm of the Host. The `host` selector already read `attachedTo`, which is
  the field an Aura's "enchanted creature" resolves through and an
  Equipment attaches by too — but `copy_token` bound its `ofCardId` with its
  own string check, so "host" would have been taken as a literal card id and
  copied nothing. An unattached Equipment now refuses at bind.

  `parseCopyExceptRiders` READ "except the token isn't legendary" and threw
  it away, so every card printing that rider made a LEGENDARY token and the
  legend rule destroyed one of the pair the instant it arrived — for Helm of
  the Host that is the entire card doing nothing. The rider now reaches the
  token through `copy_token.notLegendary`, which strips the supertype on the
  cloned definition (never the shared one). A test asserts the negative:
  without the flag, one of the pair still dies.

  A trailing subject rider now folds into a begin-combat trigger body the
  way it already did for activated abilities. "That token gains haste." has
  no target and no "until end of turn", so the branch that handles Halana
  and Alena did not read it, and left alone it became a top-level effect on
  a permanent card — where nothing ever runs it.
- **`controlled_subtype` enters-tapped clause** — Mystic Sanctuary. "Unless
  you control three or more OTHER Islands": `excludeSelf` is load-bearing,
  because the land asking is an Island itself and counting it would let two
  others satisfy a three-Island clause.

- **`self_untapped`** — the mirror of `self_tapped`. "When ~ enters
  UNTAPPED" is the ordinary battlefield-entry event with an intervening
  condition, not a new event, so a Sanctuary that entered tapped queues
  nothing. A permanent that has already left is not an untapped one either.

- **`countFromChosenTypeCreatures`** — Three Tree City. The same
  "Choose a color" shell Nykthos uses, over a different count: creatures you
  control of the type chosen as the land entered. Added as a SECOND sentence
  beside the devotion form rather than widening it, so no card that compiled
  before can move. No chosen type counts NOTHING, not everything.

- **A grant reached across the sentence between it and its target** —
  Malakir Rebirth. "Choose target creature. You lose 2 life. Until end of
  turn, that creature gains …": the grant already compiles when the target
  is written into it, so the pair fuses across the intervening sentence
  rather than teaching the grant parser a second name for its subject. The
  "Choose target creature" sentence is then DROPPED — left in place it
  compiles to a second target requirement the grant never uses, and the
  caster would be asked to choose twice.
- **Player-level shields** — Teferi's Protection, The One Ring.
  `GameState.playerShields` holds "until your next turn" protection from
  everything and a locked life total. That duration is one `activeEffects`
  cannot express: it sweeps at cleanup, and this has to outlive every
  opponent's whole turn. The sweep runs at untap and is guarded on the turn
  NUMBER, so a shield made during its holder's own turn lasts a full cycle
  instead of expiring at the very next untap.

  Protection on a player is not hexproof: CR 702.16e makes no exception for
  the protected player's own spells, which is why Teferi's Protection locks
  its caster out of their own targeted effects. There is deliberately no
  caster check in `isLegalPlayerTarget` for it. And "your life total can't
  change" blocks GAINS as well as losses — a gain is a change, and no event
  fires either way, so a gains-life watcher sees nothing.

- **Counters on the source as a count** — The One Ring. "For each burden
  counter on ~" cannot be a `DynamicCount`: that table is a string union
  with nowhere to put a counter NAME, so the key rides on the effect.

  The draw form resolves at APPLY time, not at bind. The Ring puts a counter
  on and then draws per counter in ONE effect list, and effects bind as a
  batch — a bind-time count reads the board from before the counter landed,
  so the first activation would draw nothing and every one after it would be
  a card short. A test asserts the 1, 2, 3 ladder.

  Two pre-existing silent drops came out with it: the `draw` and `lose_life`
  parsers both ignored `perDynamicCount`, so Inspiring Call's and Castle
  Locthwain's scaling came back from a round trip as a flat 1.
- **Commander colour identity** (CR 903.4) — `commanderIdentity.ts`. Lifted
  out of `manaOptions.ts` into its own module because the CR 613 layer
  engine needs it too, and `manaOptions` already imports the layer engine —
  leaving it there would have made the arrow point both ways. It depends on
  nothing but state and types, deliberately: the colour list is written out
  rather than imported from `mana.ts`, which reaches back into the engine.

  Commander's Plate grants "protection from each color that's NOT in your
  commander's color identity", resolved in the layer engine against the
  GRANTING permanent's controller. "Your commander" is the Equipment's
  controller, not the equipped creature's, and those come apart the moment
  control of the creature changes. A commanderless player has no identity,
  so every colour is outside it and the Plate is a five-colour shield —
  which is what the card says.

  War Room pays life equal to that count, so it cannot ride the fixed
  `lifeCost`: `abilityLifeCost` is read both where the activation is
  checked and where it is paid, so the two can never disagree.

  Two silent drops came out with it, neither visible to the compile metric.
  `mergeProtection` listed its fields by hand, so a new `ProtectionFrom`
  field merged away to nothing and the whole quality became unreadable —
  it now destructures against `Record<string, never>`, the same guard
  `copyProtection` already had. And the parsed activation cost is carried
  into the ability at THREE separate construction sites; reaching only one
  made War Room compile clean and cost nothing, which is worse than not
  compiling. A test asserts the life cost survives the compiler.
- **Cumulative upkeep** (CR 702.24) — Mystic Remora. One effect,
  `cumulative_upkeep`, rather than an `add_counter` beside an `unless_pays`:
  the age counter has to be ON before the cost is counted, and effects bind
  as a BATCH, so a sibling `unless_pays` would bind against the old count
  and undercharge by one every upkeep — the first one free, and every one
  after it a turn behind. The apply path adds the counter, re-reads it, then
  raises the pay-or-sacrifice, so the cost climbs {1}, {1}{1}, {1}{1}{1}.

  Only the mana form is read. The pay-a-cost printings ("Cumulative
  upkeep—Sacrifice a creature") need a cost the pay-or-sacrifice prompt
  cannot express, and are left uncompiled rather than approximated.
  11 cumulative-upkeep cards compile fully corpus-wide.
- **Mana riders** — Path of Ancestry. `ManaAbility.rider` tags produced mana
  with an effect that fires when it is SPENT on a matching purpose. This is
  not a restriction: the mana pays for whatever its owner likes, and rides
  the tagged `restrictedMana` pool purely so the spend can be watched. A new
  `unrestricted` flag on `ManaRestriction` says so, and is checked before
  the purpose gate — a tag that refused an unknown purpose would strand the
  mana everywhere the purpose is not computed.

  The commander clause ("shares a creature type with your commander") is
  read where state is in hand, in `manaRiderFires`, rather than inside the
  purpose test. An empty commander type set matches NOTHING: read as
  "matches everything" it would scry off every creature spell in the game.
  Changelings share every type and so always match.

  One rider fires per mana actually spent, not per pool entry — two tagged
  mana on one spell are two triggers (CR 603.2). The payment path records
  them on `pendingManaRiders` instead of applying them, because effects.ts
  imports mana.ts and the arrow does not go back; the cast site drains the
  list once the spell is on the stack, so the rider resolves above the spell
  its mana paid for. The activated-ability path drains too — no cast-watching
  rider can fire there, but a future one that can must not sit in the pool
  forever.
- **`controls_lands_with_different_names`** — Field of the Dead. Distinct
  NAMES among controlled lands, not a count of lands: seven copies of one
  Wastes is one name, and reading it as a land count would hand out a
  Zombie every time a basic landed. A copy carries the copied name on its
  cloned definition, so it counts as the thing it copied.

- **A qualified spell-or-permanent target** — Sink into Stupor. The
  `spell_or_permanent` requirement checked its permanent half by recursing
  with a BARE `{kind:"permanent"}`, which drops every qualifier the outer
  requirement carries, and left the spell half unfiltered entirely. So
  "target spell or nonland permanent AN OPPONENT CONTROLS" would accept
  your own spell, your own creature, and an opponent's land. Both halves
  now apply `control` and the characteristic filters, and the enumeration
  narrows by the same rule — an unfiltered offer reads to a player as a
  target that does nothing.

- **A Channel body that says "It"** — Eiganjo, Seat of the Empire. In a
  Channel ability "it" is the card being discarded, so the body is rewritten
  to the source before compiling. The rewrite is scoped to the Channel
  parser: in a TRIGGER body "it" usually means the watched object, and a
  global rewrite would silently redirect the damage.

- **Not done: a leading "Then" as its own sentence.** Orcish Bowmasters
  ends "…deals 1 damage to that player. Then amass Orcs 1." Stepping over
  the "Then" makes the card compile clean and play WRONG twice over: the
  amass lands as a top-level effect on a creature card, where nothing runs
  it, and the dual trigger head ("When ~ enters AND whenever an opponent
  draws…") already drops its second half silently. Left failing on purpose
  — an honest miss beats a card that scores and does nothing.
- **Delayed triggered abilities** (CR 603.7) — `GameState.delayedTriggers`.
  "At the beginning of your next upkeep, …" is not a trigger on a permanent;
  it is created by a spell as it resolves and fires once. Its effects are
  BOUND at creation, for the same reason `StackObject.grantedTrigger` is
  snapshotted: what they refer to ("that spell", "its controller") has
  usually stopped existing by the time the step arrives.

  `whose` separates two phrasings that look alike and are not. "Your next
  upkeep" (Pact of Negation) waits for the controller's own turn; "the next
  turn's upkeep" (Arcane Denial) fires on whoever is active — four-handed,
  three turns apart. Each entry is removed BEFORE its effects run, so an
  effect that parks another for the same step waits a full cycle instead of
  re-firing in the window that just opened, and a parking whose controller
  has left the game is dropped rather than resolved for nobody.

  Two deliberate simplifications, both silent in play. They apply as the
  step begins rather than using the stack, exactly as the `delayedEndStep`
  sibling does, so there is no window to respond to one. And a body that
  would need its own targets is REFUSED at compile time rather than
  targeted now for a board that has not happened yet.

- **`lose_game`** — the mirror of `win_game`, and the first effect to say it
  directly rather than through damage or an empty library. It honours
  "you can't lose the game" the same way `win_game` already did, since that
  veto is the same one seen from the other side.
- **`library_empty`** — "Then if your library has no cards in it, you win
  the game" (Jace, Wielder of Mysteries). The CONTROLLER's library, and an
  absent player reads false: a condition that answered true for nobody
  would hand out a win nobody earned. It reaches the existing `if_condition`
  gate, so the win sits INSIDE the branch — parked beside the draw it would
  fire every time, which is a card that always wins.

  A leading "Then" is sequencing, not a condition, and the rider parser now
  steps over it. The condition parser still gates the match, so the wider
  pattern cannot claim a sentence whose "if" it is unable to read.
- **Land-keyed trigger doubling** — Ancient Greenwarden. `triggerDoubling`
  already carried `cause` and `causeTypesAny`; the grammar's cause list did
  not include `land`, and Greenwarden is the one printing that ends
  "…an additional time INSTEAD". The word changes nothing — it is a
  replacement either way — so it is optional rather than a second pattern.

  The cause branch was rewritten so "permanent" is the unrestricted case and
  every other word becomes its own `causeTypesAny`, which is why adding a
  cause is now a word in an alternation rather than a branch.
- **`enteredFromCast`** — "When this enters, IF YOU CAST IT" (Zacama; The
  One Ring wants it too and is still blocked elsewhere). True only for a
  permanent that arrived by resolving as a SPELL — reanimation and blink do
  not come through the stack as spells, and excluding them is the whole
  point of the printed condition.

  The flag rides the zone move as an option rather than being stamped after
  it, because the enter-the-battlefield triggers are queued INSIDE that call
  and an intervening `if` is checked as the trigger goes on the stack. It is
  cleared on every battlefield entry and set again only by the entry that
  came off the stack, so it cannot survive a trip through the graveyard.

  The ETB head now takes any condition the shared vocabulary can read, the
  same peel the combat head got. The two hardcoded peels that predate that
  vocabulary stay in front of it, and a condition the vocabulary cannot read
  is left attached to the body rather than dropped.
- **`creaturesDontUntap`** — "Creatures don't untap during their
  controllers' untap steps" (Intruder Alarm). Global and SYMMETRIC: it
  stops every player's creatures including the Alarm controller's own,
  which is what makes the card a lock rather than an advantage, so the
  query is not scoped to the untapping player. Read once per untap step —
  an Alarm leaving mid-sweep must not untap half the board — and through
  the same `abilitiesRemoved` check every printed static goes through, so a
  Humility'd Alarm locks nothing. Creatures only: artifacts and lands untap
  as usual, and there is a test for that, since a lock that stopped
  everything would pass every other assertion.
- **Board-wide untap and steal** — "Untap all creatures and gain control
  of them until end of turn" (Insurrection). Both effects existed; neither
  phrase parsed. The unscoped "all creatures" is EVERY player's, which is
  the point of the card — it unlocks the board it is about to take — and it
  is one word from the scoped "you control" form, so there is a test holding
  those apart. `gain_control_all` with no `fromId` covers the whole table.

  This turned up a latent asymmetry: `tap_all` was in the each-player
  expansion list and `untap_all` was not, so an each-player untap THREW at
  bind rather than expanding. The compile-rate metric could not have seen
  it — the card compiles clean and would have crashed on resolution.
- **"fights another target creature"** (Brash Taunter) — not the same as
  "a creature you don't control": the Taunter may fight one of yours, and
  the only thing ruled out is itself. That rides on the target requirement
  as `excludeSource`, so the restriction lives where the target is chosen.
- **"…in addition to its other types"** — "is an Assassin" (Brotherhood
  Regalia), "are Forest lands" (Ashaya, Soul of the Wild). `add_types`
  has existed at layer 4 since the mutation Auras; what was missing was a
  way to REACH it from the general static-grant grammar, so the two cards
  that say it plainly could not compile.

  A grant predicate may be a COMMA list rather than an "and" list ("has
  ward {2}, is an Assassin …, and can't be blocked"). The comma-aware
  split is a SECOND attempt, run only after the plain one fails, not a
  widening of it — a comma inside a part reads fine in the cases you
  thought of and wrongly in one you did not.

  A subtype is a PROPER NOUN in oracle text, and that is load-bearing: a
  lowercase word which is not a card type is a quantifier, not a subtype.
  Without the check, "Lands you control are every basic land type in
  addition to their other types" parsed here before reaching its own rule
  and granted the subtypes "every", "basic", and "type" — a clean compile
  that plays as nonsense, which is worse than a compile note.
- **`AdditionalCastCost.sacrificeColor`** — "sacrifice a GREEN creature"
  (Natural Order). A narrowing of the existing `sacrifice` scope, never a
  cost of its own, so it is read everywhere that scope is: the cast
  validation, the bot's affordability check, and the fuzzer's own choice of
  fodder. The colour is the permanent's CURRENT one, through the layer
  engine — a creature painted green by a static pays the cost.
- **Superlatives** — "a creature or planeswalker with the greatest mana
  value among creatures and planeswalkers they control" (Soul Shatter,
  Flare of Malice) and "the greatest toughness among creatures you
  control" (Last March of the Ents, still blocked on its second half).
  `ChooseCardSource.greatestManaValue` is a RESTRICTION on the choice, not
  a filter on what counts: the chooser still picks, but only among the
  cards tied for the highest mana value in that source's own matching set.
  It is narrowed PER SOURCE, so each opponent measures their own board — a
  table-wide maximum would offer only the biggest permanent in the game
  and let every other player off entirely. Ties all survive; "the greatest
  mana value" is a value, not a card.

  The superlative scope must name the same nouns the edict does, compared
  as SETS ("a creature OR planeswalker" against "among creatureS AND
  planeswalkerS"). A mismatch is refused rather than approximated.
  `countFromGreatestPower` gained a `stat` discriminator instead of being
  renamed, so no stored state needs migrating — read it as "count from the
  greatest <stat>", where an absent stat means power.
- **`SearchFilter.anyOf`** — "an artifact or Dragon card" (Magda), "basic
  land cards and/or Gate cards" (Circuitous Route), "an instant card or a
  card with flash" (Waterlogged Teachings). `typesAny` and `subtypesAny`
  each live on ONE axis, so a list mixing a card type with a subtype had
  no spelling at all. `anyOf` is a disjunction of whole filters, one level
  deep; the fields beside it narrow every branch rather than adding one,
  which is how "an instant or sorcery card with mana value 2 or less"
  (Spellseeker) puts a single cap over two branches. `SearchFilter.keyword`
  reads PRINTED keywords — a card in the library is not on the battlefield,
  so the layer engine has nothing to say about it.

  The reach comes from a second search sentence that runs only after the
  existing one declines, so every card already compiling through the
  battle-tested pattern keeps its path. Its noun-phrase parser peels a
  shared "with mana value N or less" tail BEFORE splitting on "or" —
  otherwise "2 or less" reads as another branch — and a per-branch keyword
  after. Six cards moved on this: Spellseeker, Magda, Circuitous Route,
  Waterlogged Teachings, Moonsilver Key, and Myriad Landscape.
- **`cards_drawn_this_turn`** — "for each card you've drawn this turn"
  (Fists of Flame), "where X is the number of cards you've drawn this turn
  minus one" (Proft's Eidetic Memory). A TALLY off the draw event, not a
  hand count: a card drawn and then discarded still counted, and a card
  put into hand another way never did. It is the same number the
  `drew_cards_this_turn` trigger condition has always read — only the
  ability to read it as a NUMBER is new. `pt_until_eot` already carried a
  `per`; `add_counter` gained the `perDynamicCount` multiplier its
  draw/gain_life siblings had, plus a `dynamicOffset` for the "minus one"
  tail. An offset total of zero or less places no counters at all.

  The combat trigger head ("At the beginning of combat on your turn") has
  its own branch, for Halana and Alena's haste rider, and so had never
  reached the shared intervening-`if` peel every other phase head uses —
  the condition was not unsupported, it was unreachable. The peel now runs
  there too, and only when the condition is one the shared vocabulary can
  READ: an unreadable one stays attached to the body, which is how The
  Ozolith's "if ~ has counters on it" compiles. Dropping a condition would
  make the trigger fire unconditionally — a wrong game rather than an
  uncompiled one.
- **`EffectSelector.nonTypes`** — "each nonland permanent you control"
  (Leyline of the Guildpact). An EXCLUSION, which is the only way to say
  "permanent, but not a land": `types` is a whitelist and "permanent"
  is not a card type, so the subject had no spelling before this. The
  static-grant grammar reaches it through two other widenings — the
  subject/predicate split accepts `is`/`are` alongside get/have/lose,
  and `all colors` is a predicate over the layer-5 `set_colors` that
  already existed for Kenrith's Transformation.

The "Each <noun>" normalization pluralises the HEAD noun rather than the
first word: "Each nonland permanent you control" is "nonland permanents",
not "nonlands permanent". One-word subjects were the only ones this had
ever been asked about, so the bug was invisible until a subject arrived
with an adjective in front of it.

Deliberate approximation: `gained_life_this_turn` resets with the turn, so
life gained during another player's turn is visible only until that turn
ends. Every printed card of this shape asks about the current turn.

## The card pipeline (Stage 6)

- Real cards compile from Scryfall oracle text by shared sentence patterns; a hand-authored registry (`server/src/cardOverrides.ts`, data in the same schema) beats the compiler for the long tail. Never a named-card code path.
- The compile-rate metric runs in CI against a vendored 60-card staple fixture (floor: 80% full-compile, ≤3 uncompiled; currently 82%). `COMPILE_BULK=<path>` sweeps a full Scryfall bulk file.
- A rulings corpus (`engine/src/rulings.test.ts`) converts actual Gatherer rulings into scenario tests; its first entry exposed and fixed the simultaneous-death batching gap.
- "…for each &lt;noun&gt;" / "…equal to the number of &lt;noun&gt;" read one shared table (`DYNAMIC_COUNTS`), so a new counted noun is a row rather than a branch — static grants, self-discounts, scaled draws and scaled lifegain all parse through it. Counts naming "it" ("for each Aura attached to it") read the object the ability AFFECTS, which is the source only when the ability is its own: on an Equipment the buff lands on the equipped creature and counts that creature's attachments.
- Goad (CR 701.38) is enforced at declaration: a goaded creature must attack, and must attack a player other than its goader unless no other legal defender exists. Goaders are tracked per creature as a list, each entry expiring on that goader's own turn. "Attacks this turn if able" with no defender clause (Bident of Thassa) is a separate, weaker requirement.
- `GameHost.getOverrideStats()` counts manual overrides per game — the sprint queue for the compiler.
- The oracle cache (v4) stamps fetch times, refreshes cards older than 30 days (Oracle errata reaches the compiler), falls back to stale copies offline, and ingests Scryfall bulk files.

## The table (Stages 1 & 7)

- WebSocket tables issue **seat tokens** on first claim; rejoining a claimed seat requires the token, auto-assignment skips claimed seats, **spectators** join seatless with all hidden zones redacted, and a mismatched engine version is refused cleanly.
- Clickable phase ladder for stops, full control, and yield mode; the order-triggers and pay-or-counter prompts render in the client; state-based fast-forwards (`advance_step`/`advance_turn`) are logged as table overrides naming discarded stack objects.
- **The Ring tempts you** (CR 701.52) in all four tiers, derived onto the Ring-bearer by the layer engine rather than held on a permanent, so the emblem follows the bearer and a later bearer inherits every tier already earned. Choosing the bearer is an auto-take (keep yours, else the greatest power).
- **What mana was spent to cast a card** is recorded per colour as the cost is paid (measured by diffing the pool, not read off the cost string) and read once as the permanent enters. Adamant gates its enters-with counter on it; "if no mana was spent to cast it" reads it off the triggering spell.
- A seeded random-game fuzzer asserts zone integrity and serialize round-trips after every action (CI: 6 games; 500-game burn-ins gate checkpoint tags — they have caught two real livelocks and the trigger-batching bug).

## Documented gaps (intentional, in plan order)

- CR 613.8 dependency; copies of permanent spells and of activated/triggered abilities (instant/sorcery spell copies are in); timestamps for auras vs. their hosts.
- CR 616 replacement-ordering choice; damage prevention/redirection shields; token-doubling replacements (Anointed Procession).
- Casting face-down (morph); adventures/split cards; sagas; day/night automation (transform exists as an effect).
- Damage-assignment order is blocker-list order; attack requirements ("must attack") and cost-to-attack effects.
- Landwalk and other parameterized evasion; poison/infect; damage-dealt triggers (Curiosity).
- Old-templating X spells (original Fireball's surcharge); commander color identity is not enforced.
- Loyalty abilities are once per turn per walker; combat damage cannot yet be redirected to planeswalkers.
- Manual override remains for everything above — its per-game usage count is the coverage metric.
