export type PlayerId = string;
export type CardInstanceId = string;
export type CardDefinitionId = string;
export type StackObjectId = string;
export type GameId = string;

export type Color = "W" | "U" | "B" | "R" | "G";
export type ManaColor = Color | "C";

export type ManaPool = {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
};

/**
 * Where a card lands when it goes to a library. Approach of the Second Sun
 * is the one card that names a NUMBER — "seventh from the top", one-based.
 */
export type LibraryPosition = "top" | "bottom" | "shuffled" | { fromTop: number };

export type ZoneName =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command"
  | "stack"
  | "removed";

export type Phase =
  | "beginning"
  | "precombatMain"
  | "combat"
  | "postcombatMain"
  | "ending";

export type Step =
  | "untap"
  | "upkeep"
  | "draw"
  | "precombatMain"
  | "beginCombat"
  | "declareAttackers"
  | "declareBlockers"
  | "combatDamage"
  | "endCombat"
  | "postcombatMain"
  | "end"
  | "cleanup";

export type TurnState = {
  number: number;
  activePlayerId: PlayerId;
  phase: Phase;
  step: Step;
  /**
   * Oran-Rief, the Vastwood: "each green creature that entered this turn".
   * The value `nextTimestamp` held when this turn began — a permanent
   * entered this turn exactly when `card.timestamp >= startTimestamp`.
   *
   * Derived rather than stamped per card on purpose: a card's timestamp is
   * written at battlefield entry and nowhere else, but there are six such
   * entry sites (four of them token paths), and a per-card flag would be
   * silently missed by the seventh one somebody adds.
   */
  startTimestamp: number;
};

export type PlayerZones = {
  library: CardInstanceId[];
  hand: CardInstanceId[];
  battlefield: CardInstanceId[];
  graveyard: CardInstanceId[];
  exile: CardInstanceId[];
  command: CardInstanceId[];
  /** Owned objects that have left the game with an eliminated player. */
  removed: CardInstanceId[];
};

/**
 * Structured, printed characteristics parsed from the type line and mana cost.
 * All names are lowercase. Base/printed data only: continuous effects that
 * change characteristics at runtime layer on top of these values.
 */
export type CardCharacteristics = {
  supertypes: string[];
  types: string[];
  subtypes: string[];
  colors: Color[];
  manaValue: number;
};

export type CardDefinition = {
  id: CardDefinitionId;
  name: string;
  manaCost: string;
  typeLine: string;
  /** Parsed from typeLine/manaCost at construction; colors may be explicit. */
  characteristics: CardCharacteristics;
  oracleText: string;
  power: number | null;
  toughness: number | null;
  /** Serializable on-resolve effects. Not executable functions. */
  effects: CardEffect[];
  /** Targets that must be chosen when the spell is cast. Empty means untargeted. */
  targetRequirements: TargetRequirement[];
  keywords: Keyword[];
  /** ETB and similar definition triggers. Bound on the event, not on spell resolve. */
  triggers: CardTrigger[];
  replacements: ReplacementEffect[];
  staticAbilities: StaticAbility[];
  /** Mana this permanent adds when tapped for mana. Empty means it cannot. */
  produces: Partial<ManaPool>;
  /** `{T}: Add one mana of any color` (WUBRG). */
  producesAnyColor: boolean;
  /** `{T}: Add {G} or {W}` — tap for one of these. */
  producesOptions: ManaColor[];
  /** Distinct `{T}: Add` mana abilities. Empty means use produces / producesOptions. */
  manaAbilities: ManaAbility[];
  /** Non-mana activated abilities. Mana tapping still uses `produces` / `manaAbilities`. */
  activated: ActivatedAbility[];
  /** Ward {N}: opponents targeting this pay N generic or the spell is countered. */
  ward?: number;
  /**
   * Ward paid in LIFE rather than mana (CR 702.21b) — Hexing Squelcher's
   * "Ward—Pay 2 life". Kept apart from `ward` because the two are paid from
   * different pools and a single number could not say which; a permanent
   * with both taxes twice, which is what the printed cards do.
   */
  wardLife?: number;
  /**
   * Protection (CR 702.16): can't be targeted, damaged, enchanted/equipped,
   * or blocked by sources this matches.
   */
  protectionFrom?: ProtectionFrom;
  /**
   * Knight of Grace: "Hexproof from black". NOT protection from black —
   * it stops opponents' black spells and abilities TARGETING this
   * permanent and nothing else, so a black creature still blocks it, a
   * black spell still kills it, and a black Aura still lands on it.
   */
  hexproofFrom?: Color[];
  /** Aura: cast targeting a creature; enters attached (CR 303.4). */
  /**
   * The Aura's "Enchant …" line. Imprisoned in the Moon is
   * `creature_land_or_planeswalker`; every member has to be readable as a
   * host test, which `AURA_HOSTS` in status.ts makes a total record so a
   * new member cannot be added without one.
   */
  enchant?:
    | "creature"
    | "land"
    | "creature_or_planeswalker_own"
    | "creature_land_or_planeswalker"
    | "permanent"
    | "artifact_own"
    /** Curses. The host is a PLAYER, which is not a permanent and never
     * leaves — see `attachedToPlayer`. */
    | "player";
  /**
   * Animate Dead: the Aura is cast on a creature card in a GRAVEYARD, and
   * that card is put onto the battlefield under this spell's controller
   * before the Aura attaches to it. Done during resolution rather than in
   * an enter trigger, because a loose Aura dies to a state-based action and
   * the gap between the two would be exactly that.
   */
  reanimateOnEnter?: boolean;
  /**
   * Necromancy: "If you cast it any time a sorcery couldn't have been cast,
   * the controller of the permanent it becomes sacrifices it at the
   * beginning of the next cleanup step." The only thing that stops the card
   * being strictly better than Animate Dead, and the only reason anyone
   * casts it at instant speed on purpose.
   */
  sacrificeIfCastAtInstantSpeed?: boolean;
  /**
   * Sevinne's Reclamation: "If this spell was cast from a graveyard, you
   * may copy this spell and may choose a new target for the copy." The
   * spell has already left the stack by the time its effects bind, so the
   * copy is pushed during resolution rather than by an effect.
   */
  copySelfWhenCastFromGraveyard?: boolean;
  /** "As this Aura enters, choose a color" (Utopia Sprawl). */
  /** "As this enters, choose a color". The Thriving lands exclude their own
   * colour, so the choice is a real restriction rather than free. */
  chooseColorOnEnter?: boolean;
  chooseColorExcludes?: Color;
  /** Wild Growth / Utopia Sprawl: when the enchanted land taps for mana, its
   * controller adds this much extra ("chosen" reads the aura's chosenColor). */
  enchantedTappedBonus?: { color: Color | "chosen"; amount: number };
  /** Planeswalker printed starting loyalty. */
  loyalty?: number;
  /** Planeswalker loyalty abilities: cost may be negative. */
  loyaltyAbilities?: LoyaltyAbility[];
  /** "Choose one —" spells: cast picks exactly one mode (CR 700.2). */
  modes?: SpellMode[];
  /** "Choose two —" / "Choose one or more —": how many modes the cast picks.
   * maxIfCommander: "you may choose both instead" while you control a
   * commander (Jeska's Will, Akroma's Will). */
  modeChoice?: { min: number; max: number; maxIfCommander?: number };
  /** "You have no maximum hand size" while this permanent is on the battlefield. */
  noMaxHandSize?: boolean;
  /**
   * Jin-Gitaxias: "Each opponent's maximum hand size is reduced by seven."
   * Twenty-Toed Toad: "Your maximum hand size is twenty."
   *
   * `mode` is explicit rather than implied by which of two optional
   * numbers is present: "set to N" and "reduce by N" are different
   * questions, and a shape where both or neither could be given would
   * make two nonsense states representable.
   */
  handSizeEffect?: {
    scope: "controller" | "opponents";
    mode: "set" | "reduce";
    amount: number;
  };
  /**
   * Cascade (CR 702.85) — how many times. A count, not a boolean: Maelstrom
   * Wanderer cascades twice and Apex Devastator four times, and each is its
   * own separate walk down the library.
   */
  cascade?: number;
  /** Additional land drops granted each of the controller's turns (Exploration). */
  extraLandDrops?: number;
  /** Rites of Flourishing: the same grant, but to EVERY player rather than
   * only the permanent's controller. */
  extraLandDropsForAll?: number;
  /** "This spell can't be countered" (Abrupt Decay). */
  cantBeCountered?: boolean;
  /** Fiery Emancipation, Torbran, Gratuitous Violence, Twinflame Tyrant:
   * "If a \<source\> you control would deal damage to \<target\>, it deals
   * \<modified\> damage instead." One replacement applies wherever damage is
   * applied — noncombat, sweeps, and combat alike. */
  damageReplacement?: DamageReplacement;
  /** Mana Reflection, Nyxbloom Ancient: "If you tap a permanent for mana, it
   * produces twice as much of that mana instead." */
  manaTapMultiplier?: number;
  /** "You may … rather than pay this spell's mana cost." */
  altCost?: AlternativeCastCost;
  /**
   * "Spells you control can't be countered" (Chimil), and its narrowed
   * forms: Rhythm of the Wild's creature spells, Destiny Spinner's creature
   * and enchantment spells. An empty/absent `types` means EVERY spell the
   * controller casts; otherwise the spell must have one of these card types.
   *
   * One field rather than one boolean per wording — the narrowings differ
   * only in which types they name, and a boolean apiece is a list waiting
   * to fall behind.
   */
  spellsCantBeCountered?: { types?: string[] };
  /**
   * Terror of the Peaks: "Spells your opponents cast that TARGET this
   * permanent cost an additional N life to cast." A cost increase paid in
   * life, not a ward trigger — it is paid as the spell is cast and there
   * is nothing to decline, which is why the card is hard to remove rather
   * than merely annoying to remove.
   */
  targetingLifeTax?: number;
  /**
   * Elesh Norn, Mother of Machines: "Permanents entering don't cause
   * abilities of permanents your opponents control to trigger." A
   * SUPPRESSION rather than a replacement — the ability never triggers at
   * all, so there is nothing on the stack to answer.
   */
  opponentsEnterTriggersSuppressed?: boolean;
  /**
   * K'rrik, Son of Yawgmoth: "For each {B} in a cost, you may pay 2 life
   * rather than pay that mana." Exactly Phyrexian mana (CR 107.4f), applied
   * to every pip of this colour in every cost its controller pays — so the
   * pips are moved into the Phyrexian list and the machinery that already
   * exists does the rest.
   */
  payLifeForColor?: Color;
  /** Grand Abolisher: on this permanent's controller's turn, opponents can't
   * cast spells or activate artifact/creature/enchantment abilities. */
  opponentsLockedDuringYourTurn?: boolean;
  /** Voice of Victory / Kutzil: the cast-only half of the Abolisher lock. */
  opponentsCantCastDuringYourTurn?: boolean;
  /**
   * Champion of Lambholt, Delney: a blocking restriction decided by POWER.
   * Neither `cantBlock` (the blocker may still block someone else's
   * attackers) nor `cantBeBlocked` (only SOME blockers are stopped) can say
   * this on its own, so it is a static read at block declaration.
   *
   * Reads as: a creature this permanent's controller controls that matches
   * `attackerMaxPower` cannot be blocked by a creature matching the blocker
   * half. Power is COMPUTED on both sides, so a pump changes the answer.
   */
  blockPowerGate?: {
    /** Delney: only the controller's creatures with power this low or less
     * are protected. Omitted means every creature they control. */
    attackerMaxPower?: number;
    /** Delney: blockers with power at least this are stopped. */
    blockerMinPower?: number;
    /** Champion of Lambholt: blockers with power BELOW this permanent's own
     * are stopped — a live comparison, not a fixed number, which is the
     * whole card. */
    blockerBelowSourcePower?: boolean;
  };
  /** Toski: this creature attacks each combat if able. */
  mustAttack?: boolean;
  /** Narset, Parter of Veils: "each opponent can't draw more than one card
   * each turn" — a cap on the OPPONENTS' draws, counted per turn. */
  opponentsDrawCap?: number;
  /**
   * Deafening Silence: "Each player can't cast more than one noncreature
   * spell each turn." Unlike `opponentsDrawCap` this binds EACH player,
   * the controller included — the printed text says each player and the
   * card is played for the symmetry.
   */
  noncreatureSpellCap?: number;
  /**
   * Platinum Angel: "You can't lose the game and your opponents can't win
   * the game."
   *
   * ONE flag for both halves, because this engine expresses winning as
   * everyone else losing (CR 104.2a, and the `win_game` effect does
   * exactly that). A controller who cannot lose is therefore already a
   * controller whose opponents cannot win — a second flag would be a
   * second name for the same rule.
   */
  cantLoseGame?: boolean;
  /** Intruder Alarm: "Creatures don't untap during their controllers'
   * untap steps." Global and symmetric — it stops EVERY player's
   * creatures, including the controller's own, which is what makes the
   * card a lock rather than an advantage. */
  creaturesDontUntap?: boolean;
  /**
   * Shalai: "You … have hexproof." Hexproof on a PLAYER, which is a
   * different object from hexproof on a permanent — it stops opponents
   * choosing that player as a target, and stops nothing else.
   */
  controllerHexproof?: boolean;
  /**
   * Trouble in Pairs, Stranglehold: "if an OPPONENT would begin an extra
   * turn, that player skips that turn instead."
   *
   * A STATIC on the permanent rather than a one-shot effect, because it is
   * true for as long as the permanent is there — and a permanent's
   * `effects` never run at all, so compiling it as one would have been a
   * card that looks clean and denies nothing.
   */
  opponentsSkipExtraTurns?: boolean;
  /**
   * Crawlspace: "No more than two creatures can attack you each combat."
   * The cap protects this permanent's CONTROLLER — the printed text says
   * "you" — so it is read off the defending player's own battlefield.
   */
  attackLimitPerCombat?: number;
  /**
   * Brave the Sands: "Each creature you control can block an additional
   * creature each combat." A static that raises the allowance of the
   * CONTROLLER's creatures, so it is counted off the blocking player's own
   * permanents and stacks if they control two of them.
   */
  extraBlocksGranted?: number;
  /** Theros gods: not a creature while devotion to the color is below the
   * threshold (applied before the layer passes — a documented simplification). */
  notCreatureBelowDevotion?: { color: Color; threshold: number };
  /**
   * "If you control a commander, you may cast this spell without paying its
   * mana cost" (the free-spell cycle). Documented approximation: the free
   * alternative cost is auto-taken whenever the condition holds.
   */
  freeIfCommander?: boolean;
  /**
   * Blasphemous Edict: "You may pay {B} rather than pay this spell's mana
   * cost if there are thirteen or more creatures on the battlefield."
   * Auto-taken whenever the count holds (documented approximation, like
   * freeIfCommander).
   */
  altCostIfCreatures?: { cost: string; count: number };
  /**
   * Changeling (CR 702.73): this card is every creature type, in every zone.
   * Honored via cardMatchesSubtype; removed with other abilities (Humility).
   */
  changeling?: boolean;
  /**
   * "You may look at the top card of your library any time" and friends
   * (Oracle of Mul Daya, Elven Chorus). Grants apply to the controller while
   * this permanent is on the battlefield with its abilities intact.
   */
  topOfLibrary?: TopOfLibraryGrant;
  /**
   * Flashback (CR 702.34): castable from the graveyard for this cost, then
   * exiled as it leaves the stack.
   */
  flashback?: {
    manaCost: string;
    life?: number;
    /** Dread Return: "Flashback—Sacrifice three creatures." The whole cost,
     * with no mana at all. Fodder is auto-picked weakest-first, the same
     * documented approximation `altCastPayment` makes. */
    sacrificeCreatures?: number;
  };
  /**
   * Evoke (CR 702.74): an alternative mana cost, and the permanent is
   * sacrificed as it enters. Taken only when the printed cost is out of
   * reach, the same one-way rule `altCost` follows — a caster who can pay
   * for the body gets the body.
   */
  evoke?: { manaCost: string };
  /**
   * Retrace (CR 702.81): cast this from your graveyard by discarding a land
   * card in addition to paying its other costs.
   *
   * NOT a flashback variant, and the difference is the whole card on
   * Raven's Crime: a retraced spell goes back to the GRAVEYARD when it
   * resolves, so it can be cast again for another land, where flashback
   * exiles it after one use.
   */
  retrace?: boolean;
  /**
   * Splice onto Arcane (CR 702.47): as an Arcane spell is cast, this may
   * be REVEALED from hand and its splice cost paid to add its effects to
   * that spell.
   *
   * Revealed, not cast. The card stays in hand, so countering the spell
   * does not touch it and it can be spliced again next turn — which is the
   * whole reason these cards see play.
   */
  spliceOntoArcane?: { manaCost: string };
  /**
   * Dredge N (CR 702.52): if you would draw a card, you may instead mill N
   * and return this card from your graveyard to your hand.
   *
   * A REPLACEMENT, which is why this waited for the prompt machinery.
   * Dredging every draw automatically plays a materially different card —
   * a Life from the Loam player dredges when they want lands and draws
   * when they want cards — and never dredging makes the keyword
   * decoration.
   */
  dredge?: number;
  /**
   * Six, Deeproot Historian: a permanent granting retrace to cards in its
   * controller's graveyard. Looked up rather than read off the card being
   * cast, the same way `grantsEscape` is.
   */
  grantsRetrace?: {
    /** Six: "nonland permanent cards"; Deeproot Historian names subtypes. */
    filter: SearchFilter;
    /** Six: "during your turn". */
    onlyYourTurn?: boolean;
  };
  /**
   * Echo (CR 702.29): at the controller's first upkeep after this came
   * under their control, sacrifice it unless they pay this cost. Only the
   * mana form is read; "Echo—Sacrifice a creature" would need a cost the
   * pay-or-sacrifice prompt cannot express.
   */
  echo?: { manaCost: string };
  /**
   * Escalate (CR 702.120): this much more for EACH mode chosen beyond the
   * first. A per-mode `extraCost` cannot say it — which mode is "the
   * first" depends on what the caster picked.
   */
  escalate?: string;
  /**
   * Split second (CR 702.61): while this spell is on the stack, players
   * can't cast spells or activate abilities that aren't mana abilities.
   * A property of the SPELL on the stack, so it is read off whatever is
   * there rather than stored on the game.
   */
  splitSecond?: boolean;
  /**
   * Storm (CR 702.40): casting this copies it once per spell cast before it
   * this turn. Documented approximation: copies are created immediately on
   * cast (not via a stacked trigger) and keep the original's targets.
   */
  storm?: boolean;
  /** "~ doesn't untap during your untap step." */
  doesntUntap?: boolean;
  /** Toxic N (CR 702.180): combat damage this creature deals to a player
   * also gives that player N poison counters, on top of the life lost. */
  toxic?: number;
  /** Winter Orb / Static Orb: while THIS permanent is untapped, no player may
   * untap more than `max` permanents of `scope` during their untap step. A
   * global, symmetric restriction. Which permanents stay tapped is the
   * player's choice on the printed card; the engine auto-picks (untaps the
   * first `max` it meets), a documented approximation that is never more
   * permissive than an optimal choice — the COUNT is identical either way. */
  untapRestriction?: { max: number; scope: "land" | "permanent" };
  /** Drumbellower / Seedborn Muse: the controller's creatures (or all their
   * permanents) also untap during each other player's untap step.
   * Bender's Waterskin is the one-permanent form: only the source itself. */
  untapDuringEachUntap?: "creatures" | "permanents" | "artifacts" | "self";
  /**
   * Thousand-Year Elixir: "You may activate abilities of creatures you
   * control as though those creatures had haste." ABILITIES only — a
   * summoning-sick creature still cannot attack, which is the whole
   * difference between this and handing out haste.
   */
  abilityHaste?: boolean;
  /** Authority of the Consuls: opponents' creatures enter tapped. */
  opponentCreaturesEnterTapped?: boolean;
  /** Thalia, Heretic Cathar: the same static, for nonbasic lands. */
  opponentNonbasicLandsEnterTapped?: boolean;
  /** Blind Obedience: opponents' artifacts enter tapped too. */
  opponentArtifactsEnterTapped?: boolean;
  /**
   * Spelunking: "Lands you control enter untapped." The mirror of the
   * statics above — it CANCELS an enters-tapped replacement rather than
   * adding one, so it is checked after them and wins.
   */
  landsEnterUntapped?: boolean;
  /**
   * Totem armor / umbra armor (CR 702.87) — Bear Umbra. On the AURA, not on
   * what it enchants: "if enchanted permanent would be destroyed, instead
   * remove all damage from it and destroy this Aura." Read by
   * `destroyPermanentInPlace`, which is the single place a destruction can
   * be replaced, so it applies to a Wrath and to lethal damage alike.
   */
  totemArmor?: boolean;
  /** "You may cast spells as though they had flash" (Vedalken Orrery). */
  /** Convoke (CR 702.51): tap creatures to help pay. */
  convoke?: boolean;
  /**
   * Harmonize (CR 702.184) — Nature's Rhythm. Two keywords the engine
   * already has, welded together: cast this from your GRAVEYARD for the
   * harmonize cost (which is `flashback`, exile rider and all), and tap
   * creatures to help pay it (which is convoke).
   *
   * A separate flag from `convoke` because the convoke half applies ONLY
   * to the graveyard cast. Setting `convoke` outright would quietly make
   * the printed hand cast cheaper than the card says.
   */
  harmonizeConvoke?: boolean;
  /** Improvise (CR 702.126): tap artifacts to help pay the generic cost. */
  improvise?: boolean;
  /** Delve (CR 702.66): exile cards from your graveyard to help pay. */
  delve?: boolean;
  /** Inspiring Statuary, Dazzling Theater: the same keyword granted to the
   * spells this permanent's controller casts. */
  grantsCostKeyword?: { keyword: "convoke" | "improvise"; types?: string[]; nonTypes?: string[] };
  grantsFlash?: boolean;
  /**
   * Opposition Agent: "You control your opponents while they're searching
   * their libraries", and everything they find is exiled and playable by
   * you. One flag rather than two, because the second printed sentence is
   * what the first one does — there is no card that takes control of the
   * search without taking the cards.
   */
  controlsOpponentSearches?: boolean;
  /** Sigarda's Aid, Shimmer Myr: the grant covers only some spells. Kept
   * narrower than a full subject filter because derived.ts cannot reach the
   * trigger matcher without closing an import cycle. */
  /** Valley Floodcaller: "noncreature spells" is a type the spell must NOT
   * have, where `types` lists ones it must. */
  grantsFlashFor?: { types?: string[]; subtypesAny?: string[]; nonTypes?: string[] };
  /** Omniscience: the controller casts from hand without paying mana costs.
   * As Foretold adds a per-turn limit and a counter-derived cap. */
  castFreeFromHand?: {
    /** As Foretold: cap = this many of the named counter on the source. */
    capFromCounter?: string;
    /** As Foretold: only the first such cast each turn. */
    oncePerTurn?: boolean;
  };
  /** Howling Mine: each player draws an extra card in their draw step. */
  extraDrawStepDraws?: boolean;
  /** Affinity for artifacts: generic cost shrinks per artifact you control. */
  affinityArtifacts?: boolean;
  /** "This spell costs {X} less to cast, where X is …" (Metalwork Colossus,
   * The Great Henge): the generic portion shrinks by a live count. */
  selfDiscount?: {
    /** "opponent_stack_3": Bolt Bend — {3} less while an opponent has a
     * spell or ability on the stack (a documented proxy for "if it targets
     * a spell or ability an opponent controls"). */
    per?:
      | "noncreature_artifacts_total_mv"
      | "historic_total_mv"
      | "greatest_creature_power"
      /** Ghalta — the SUM, not the greatest. */
      | "total_creature_power"
      | "opponent_stack_3";
    /**
     * Embercleave: "costs {1} less to cast for each attacking creature you
     * control" — `generic` off the cost per thing counted, using the same
     * counted-noun table every other live count reads.
     */
    perDynamicCount?: { generic: number; count: DynamicCount };
  };
  /** "costs {1} less for each creature on the battlefield" (anyone's). */
  affinityAllCreatures?: boolean;
  /**
   * "Artifact spells you cast cost {1} less to cast" (medallions, Foundry
   * Inspector). Applies to the controller's spells while on the battlefield;
   * only the generic portion shrinks, never below zero.
   */
  costReductions?: CostReduction[];
  /** "As ~ enters, choose a creature type." Prompts on battlefield entry. */
  chooseCreatureTypeOnEnter?: boolean;
  /** Cloud Key: pick a card type on enter — auto-picked as the most common
   * card type among the controller's hand, else "creature" (documented). */
  chooseCardTypeOnEnter?: boolean;
  /** Banner of Kinship: after the enter type choice resolves, this many
   * named counters land per controlled creature of the chosen type. */
  enterCountersPerChosenType?: string;
  /** Puresteel Paladin: controlled Equipment equip for {0} while the
   * controller has at least this many artifacts. */
  freeEquipIfArtifacts?: number;
  /** Drannith Magistrate: opponents may only cast from their hands. */
  opponentsCastOnlyFromHand?: boolean;
  /** "~ is the chosen type in addition to its other types" (Metallic Mimic). */
  selfIsChosenType?: boolean;
  /** Caged Sun: a land tap that adds the chosen color adds one more of it. */
  landChosenColorBonus?: boolean;
  /**
   * Mirari's Wake / Vorinclex: the controller's land taps add one more mana
   * of a type the land produced (auto-picked — documented). The empty object
   * is that plain case; the fields narrow which taps echo and what they add,
   * so Crypt Ghast (Swamps only, always {B}) and Forsaken Monument (any
   * permanent, only when it made {C}) are the same mechanism.
   */
  landTapEcho?: {
    /** Only lands with this subtype echo. */
    subtype?: string;
    /** Any permanent, not only lands. */
    anyPermanent?: boolean;
    /** Add this colour rather than matching what was produced. */
    addColor?: ManaColor;
    /** Only echo when the tap produced this colour. */
    requiresProduced?: ManaColor;
  };
  /** Rebound (CR 702.87): resolving from hand exiles the card; at the
   * caster's next upkeep it may be cast from exile for free. */
  rebound?: boolean;
  /** Vorinclex, Voice of Hunger: a land an opponent taps for mana skips
   * its controller's next untap step. */
  opponentLandTapsSkipUntap?: boolean;
  /**
   * "…that ability triggers an additional time" (CR 614.1c-adjacent trigger
   * doubling). Each matching doubler on the battlefield adds one extra copy
   * of the queued trigger. The doubled ability's source must be a permanent
   * the doubler's controller controls (true of every printed doubler).
   */
  triggerDoubling?: {
    /** Restrict by the causing event (Panharmonicon "enters", Teysa Karlov
     * "dies", Isshin "attacks", Veyran "casts"). Omitted: any trigger
     * (Roaming Throne). */
    cause?: "enters" | "dies" | "attacks" | "casts";
    /** The causing subject must have one of these types (Panharmonicon:
     * artifact or creature; Drivnod: creature). */
    causeTypesAny?: string[];
    /** Restrict the doubled ability's source (Harmonic Prodigy: a Shaman or
     * another Wizard; Roaming Throne: another creature of the chosen type). */
    source?: {
      types?: string[];
      subtypesAny?: string[];
      chosenSubtype?: boolean;
      excludeSelf?: boolean;
      /** Delney: "a creature you control with power 2 or less". Computed
       * power, so a pump takes the ability back out of range. */
      maxPower?: number;
    };
  };
  /** "~ enters with X +1/+1 counters on it" (hydras); X from the announced cost. */
  entersWithXCounters?: boolean;
  /**
   * Everflowing Chalice: the X counters are CHARGE counters, not +1/+1.
   * Absent means +1/+1, which is what every card written before
   * multikicker arrived was asking for.
   */
  entersWithXCounterKind?: string;
  /** Kalonian Hydra: "~ enters with four +1/+1 counters on it" — a fixed
   * count, unlike the announced-X form above. */
  entersWithCounters?: {
    counter: string;
    count: number;
    /** Adamant: the counter arrives only if the spell was paid for in the
     * named colour. Gated here rather than as an enters trigger, because
     * CR 121.6 says the counter was never not there. */
    ifManaSpent?: { atLeast: number; color?: Color };
  };
  /**
   * Clone family: "You may have ~ enter as a copy of …". Documented
   * approximation: the choice is prompted just after entry (not applied as a
   * CR 614.13 replacement), and cosmetic "except" riders (added types,
   * granted keywords, name changes) are dropped. The copied definition's
   * enter-the-battlefield triggers fire when the copy is chosen.
   */
  enterAsCopy?: {
    scope: EnterAsCopyScope;
    /** Spark Double: the copy enters with this many extra +1/+1 counters. */
    extraCounters?: number;
    /** Mockingbird: only copy creatures with mana value ≤ the mana spent to
     * cast this (bound to the announced X + printed pips at resolution). */
    maxManaValueBySpent?: boolean;
    /** Vesuva: the copy arrives tapped. */
    entersTapped?: boolean;
    /**
     * Cursed Mirror: the copy lasts only until end of turn, after which
     * the printed card comes back. Recorded in `temporaryCopies`, the same
     * revert Mirage Mirror uses.
     */
    untilEot?: boolean;
    /**
     * Cursed Mirror: "except it has haste". NOT one of the cosmetic
     * granted keywords dropped above — a mana rock that becomes a creature
     * and cannot attack until next turn is a different card.
     */
    grantHaste?: boolean;
  };
  /** "As an additional cost to cast this spell, …" (Deadly Dispute). */
  additionalCost?: AdditionalCastCost;
  /**
   * Bargain (CR 702.166): "You may sacrifice an artifact, enchantment, or
   * token as you cast this spell." OPTIONAL, which is why it is not an
   * `additionalCost` — that one is owed, and this one is offered.
   */
  bargain?: boolean;
  /**
   * Bestow (CR 702.103): an alternative cost that casts this creature as an
   * Aura enchanting a creature. It is an Aura for as long as it stays
   * attached and becomes a creature again the moment its host leaves — a
   * per-INSTANCE type change, which is why nothing here says `enchant`.
   */
  bestow?: { manaCost: string };
  /**
   * Pillow forts: creatures can't attack this permanent's controller unless
   * their controller pays, per attacking creature, `generic` mana (Propaganda),
   * X = the defender's enchantment count (Sphere of Safety), and/or `lifePer`
   * life (Norn's Annex {W/P}, approximated as its life half). Paid from the
   * attacker's floating pool when attackers are declared.
   */
  attackTax?: { generic?: number; perEnchantment?: boolean; lifePer?: number };
  /**
   * Underworld Breach: every NONLAND card in this permanent's controller's
   * graveyard has escape (CR 702.139), for its mana cost plus exiling this
   * many OTHER cards from that graveyard. A definition field rather than a
   * layer static, because the cards it reaches are in a graveyard and the
   * layer engine only sees the battlefield.
   */
  grantsEscape?: { exileOther: number };
  /** "You may play lands from your graveyard" (Crucible of Worlds). */
  playLandsFromGraveyard?: boolean;
  /**
   * Leylines: if in the opening hand, begins the game on the battlefield.
   * Deployed automatically when mulligans finish (the "may" is auto-taken).
   */
  /**
   * Sagas (CR 714). `chapters[0]` is chapter I. A lore counter goes on as
   * the Saga enters and again after its controller's draw step, and the
   * chapter matching the new count fires. After the final chapter it is
   * sacrificed.
   *
   * Documented simplification: the sacrifice happens as the final chapter
   * finishes resolving rather than when the ability leaves the stack, so a
   * response to the last chapter cannot save the Saga. Nothing in this
   * engine reads the difference.
   */
  saga?: { chapters: CardEffect[][] };
  leyline?: boolean;
  /**
   * Gemstone Caverns: if in the opening hand and its owner is NOT the
   * starting player, it begins the game on the battlefield with a counter,
   * and its owner exiles a card from hand. The same auto-taken "may" the
   * leylines above use, and the same start-of-game moment.
   */
  openingHandStart?: { counter: string; exileFromHand: number };
  /** Gravecrawler: castable from the graveyard while the controller controls
   * a matching permanent. Resolves normally (a creature enters play). */
  castFromGraveyard?: { types?: string[]; subtypes?: string[] };
  /** Squee, the Immortal: castable from EXILE (and, with castFromGraveyard,
   * from the graveyard) with no gate — whoever exiled it, it comes back. */
  castFromExile?: boolean;
  /** Ascend: while this is on the battlefield, controlling ten or more
   * permanents grants the city's blessing (checked in the SBA sweep). */
  ascend?: boolean;
  /** Star P/T: base power and toughness are each this count (CR 613.3a). */
  /**
   * A characteristic-defining power/toughness (CR 613.3a). `powerOnly` is
   * Adeline, whose toughness is the printed 4 while her power counts
   * creatures — without it the count would overwrite both.
   */
  dynamicPt?: { count: DynamicCount; powerOnly?: boolean };
  /** Storm-Kiln Artist: "+1/+0 for each artifact you control". */
  bonusPt?: { power: number; toughness: number; per: DynamicCount };
  /** Scryfall card image, if known. Empty for synthetic / hidden cards. */
  imageUrl: string;
  /** Linked opposite face for modal DFCs and transforming cards. */
  otherFaceId?: CardDefinitionId;
  layout?: "normal" | "modal_dfc" | "transform";
};

export type CardInstance = {
  id: CardInstanceId;
  definitionId: CardDefinitionId;
  ownerId: PlayerId;
  controllerId: PlayerId;
  zone: ZoneName;
  tapped: boolean;
  damageMarked: number;
  attacking: boolean;
  /**
   * Moraug: "for each time IT has attacked this turn" — a COUNT on the
   * card, not the player's `attackedThisTurn` boolean, because extra
   * combats let the same creature attack more than once and the whole card
   * is that number. Cleared when a new turn begins.
   */
  timesAttackedThisTurn?: number;
  blockingAttackerId: CardInstanceId | null;
  summoningSick: boolean;
  /**
   * Exert (CR 701.39). One flag answering two questions: "has it been
   * exerted this turn", which gates the attack, and "it doesn't untap
   * during your next untap step", which is what exerting costs. Cleared by
   * that untap step, which is also the step it makes the creature miss.
   */
  exertedThisTurn?: boolean;
  /**
   * Approach of the Second Sun: the zone this card was last cast FROM.
   * Kept on the instance rather than the stack object, because the
   * question is asked while the spell resolves and the stack entry is
   * already gone by then.
   */
  castFromZone?: ZoneName;
  /**
   * What mana was actually spent to cast this card, per colour, recorded as
   * the cost is paid because nothing downstream can reconstruct it: an
   * alternative cost, a cascade, "without paying its mana cost" and a plain
   * {0} cost all spend nothing and none of them look alike afterwards.
   *
   * Read once and cleared, the way `evoked` is — a permanent that reaches
   * the battlefield without being cast has no record, so adamant gives a
   * reanimated Ardenvale Paladin nothing.
   */
  manaSpentToCast?: ManaPool;
  /**
   * Bargain (CR 702.166): the optional additional cost was paid for this
   * cast. Rides the instance while the card is a spell, exactly as
   * `manaSpentToCast` does — the stack entry is gone by the time anything
   * asks, and a card that resolves and is cast again later was not
   * bargained then.
   */
  bargainedThisCast?: boolean;
  /**
   * Bestow: this permanent was cast for its bestow cost, so while it is
   * attached it is an Aura and not a creature. Cleared when its host
   * leaves, which is the moment it becomes a creature.
   */
  bestowed?: boolean;
  /**
   * Necromancy: this cast happened when a sorcery could not have been, so
   * the permanent it becomes is sacrificed at the next cleanup. Set while
   * it is a spell and read once it is a permanent, which is why it rides
   * the instance rather than the stack entry.
   */
  sacrificeAtNextCleanup?: boolean;
  /**
   * Opal Palace: counters this card is owed AS it enters, recorded while
   * it is still a spell. Read once and cleared, like `manaSpentToCast` —
   * they have to be on the permanent the moment anything looks (CR 121.6),
   * which is why they are not simply added after it arrives.
   */
  bonusEnterCounters?: number;
  counters: Record<string, number>;
  /**
   * CR 702.26: a phased-out permanent is treated as though it did not
   * exist, but it does NOT change zones. That is why this is a flag and
   * not a move: no leave-the-battlefield trigger fires, Auras and
   * Equipment stay attached, counters stay on, and the object is not a new
   * object when it comes back. It phases in at the start of its
   * controller's untap step.
   */
  /**
   * Zacama / The One Ring: "When this enters, IF YOU CAST IT, ...". True only
   * for a permanent that arrived by resolving as a spell — a reanimated or
   * blinked-in copy of the same card reads false, which is exactly the
   * distinction the printed condition draws.
   *
   * Cleared on EVERY battlefield entry and set again by the one entry that
   * came off the stack, so it cannot survive a trip through the graveyard.
   */
  enteredFromCast?: boolean;
  phasedOut?: boolean;
  /** 0 means not a Class. Class enchantments enter at 1. */
  classLevel: number;
  /** CR 613.7 ordering: stamped when this object entered the battlefield. */
  timestamp: number;
  /** Tokens cease to exist outside the battlefield (CR 704.5d). */
  isToken: boolean;
  /**
   * Kodama of the East Tree: the permanent was put onto the battlefield BY
   * this ability, so it must not trigger it again. Without the mark, one
   * permanent entering chains the player's whole hand onto the battlefield
   * — a far stronger card than the printed one.
   */
  /**
   * Portal to Phyrexia: "It's a Phyrexian in addition to its other types."
   * A characteristic the PERMANENT carries for as long as it is on the
   * battlefield, so it rides the instance rather than an `activeEffects`
   * entry — that list only knows durations that end.
   */
  addedSubtypes?: string[];
  /**
   * Regeneration shields (CR 701.15). A COUNT, not a flag: two regenerates
   * this turn save the permanent twice, and each one is spent by a single
   * destruction. Cleared at cleanup with everything else that lasts "this
   * turn".
   */
  regenerationShields?: number;
  putByAbilityOf?: CardInstanceId;
  /** Damaged by a deathtouch source this turn (CR 704.5h). */
  deathtouched: boolean;
  /** Auras and Equipment: what this permanent is attached to. */
  attachedTo: CardInstanceId | null;
  /**
   * Curses: the player this Aura enchants. A separate field from
   * `attachedTo` on purpose — that one holds a card id and is torn down on
   * a zone change, and a player has no zone to change. Sharing one slot
   * would make every "is my host still legal" check ambiguous.
   */
  attachedToPlayer?: PlayerId;
  /**
   * Animate Dead: the creature this permanent put onto the battlefield.
   * Kept apart from `attachedTo` because that link is torn down as the
   * permanent leaves, and the leave trigger has to know what to sacrifice
   * AFTER it has gone.
   */
  reanimatedCardId?: CardInstanceId;
  /**
   * Urza's Saga: abilities the permanent was GIVEN ("this Saga gains …").
   * Instance state rather than a layer static, because the grant comes from
   * a resolved chapter and has to outlive it — chapter II's ability is
   * still there on chapter III.
   */
  grantedActivatedAbilities?: ActivatedAbility[];
  /** The same, for granted MANA abilities, which never use the stack. */
  grantedManaAbilities?: ManaAbility[];
  /**
   * Sylvan Library: the turn this card was DRAWN, so "cards in your hand
   * drawn this turn" can name them. A tally of how many were drawn cannot:
   * the card asks which ones.
   */
  drawnOnTurn?: number;
  /**
   * Imprint (CR 702.16 flavour, mechanically CR 610.3): cards exiled
   * WITH this permanent, which its own abilities then read. Chrome Mox
   * takes its colours from here. Kept as a list because Panoptic Mirror
   * and friends imprint repeatedly.
   */
  imprintedCardIds?: CardInstanceId[];
  /** One loyalty ability per turn per planeswalker (CR 606.3-ish V1). */
  loyaltyActivatedThisTurn: boolean;
  /** Manifested: a face-down 2/2 with no name, types, or abilities (CR 708). */
  faceDown: boolean;
  /** "As ~ enters, choose a creature type" (Kindred Discovery). Lowercase. */
  chosenCreatureType: string | null;
  /** Gideon's Intervention: the card name this permanent was told to watch. */
  chosenCardName?: string;
  /** Cloud Key: the auto-picked card type (documented approximation). */
  chosenCardType?: string | null;
  /** "As this Aura enters, choose a color" (Utopia Sprawl). */
  chosenColor: Color | null;
  /** Vorinclex, Voice of Hunger froze this permanent: it skips its
   * controller's next untap step, then the flag clears. */
  skipNextUntap?: boolean;
  /**
   * CR 701.38. Every player who has goaded this creature. Goad lasts "until
   * your next turn", so an entry clears when that player's turn begins — one
   * entry per goader, because two opponents goading it means it may attack
   * neither of them.
   */
  goadedBy?: PlayerId[];
  /** Bident of Thassa: "attacks this turn if able", with no say in whom. */
  mustAttackThisTurn?: boolean;
  /**
   * Whip of Erebos: "If it would leave the battlefield, exile it instead of
   * putting it anywhere else." Instance state, because the shield belongs to
   * this arrival of this card and not to the card. Without it the Whip is a
   * repeatable reanimator: sacrifice the creature in response to the
   * end-step exile and it is back in the graveyard for next time.
   */
  exileIfLeaves?: boolean;
  /**
   * Cast for an evoke cost (CR 702.74b): sacrificed as it enters. Set while
   * the card is a spell on the stack and cleared the moment it is read, so a
   * Mulldrifter later reanimated is not sacrificed for a cost nobody paid.
   */
  evoked?: boolean;
  /**
   * Echo (CR 702.29) is owed at the next upkeep. Set as a permanent with
   * echo enters and cleared when the upkeep trigger reads it, which is what
   * makes "since the beginning of your last upkeep" answerable without a
   * per-permanent upkeep history.
   *
   * Set on ENTRY only, so a permanent that changes control does not re-arm
   * its echo — a documented gap, and the rarer half of the keyword.
   */
  echoDue?: boolean;
};

export type CommanderState = {
  commanderIds: CardInstanceId[];
  /** Extra generic mana currently required to cast from the command zone. */
  tax: number;
  /** Combat damage this player has received from each commander instance. */
  damageReceived: Record<CardInstanceId, number>;
};

export type PlayerState = {
  id: PlayerId;
  displayName: string;
  life: number;
  mana: ManaPool;
  zones: PlayerZones;
  commander: CommanderState;
  lost: boolean;
  /**
   * Poison counters (CR 122.1a). Ten of them lose the game (CR 104.3c),
   * and unlike life they only ever go up here — nothing in this engine
   * removes one yet.
   */
  poisonCounters: number;
  /**
   * The Ring (CR 701.52). How many times this player has been tempted; the
   * emblem's four abilities switch on cumulatively at 1, 2, 3 and 4, and
   * further tempts add nothing but a fresh Ring-bearer choice.
   */
  ringTempts?: number;
  /**
   * The creature carrying the Ring. Every one of the emblem's abilities is
   * about this creature, so it is a designation on the PLAYER rather than
   * a mark on the card — the Ring survives the bearer dying, and the next
   * tempt simply names a new one.
   */
  ringBearerId?: CardInstanceId;
  /** Lands played this turn. Resets on that player's untap. */
  landsPlayedThisTurn: number;
  /** Explore: one-shot extra land drops granted this turn. Reset with the
   * land count. */
  extraLandDropsThisTurn?: number;
  /** True after this player declared at least one attacker this turn. */
  attackedThisTurn: boolean;
  /** "Spend this mana only to …": mana that can only pay for matching
   * spells and abilities. Emptied alongside the main pool. */
  restrictedMana?: RestrictedMana[];
  /**
   * Birgi: "Until end of turn, you don't lose this mana as steps and
   * phases end." A tally of mana granted this turn that survives CR 500.4,
   * cleared at cleanup. Emptying keeps the SMALLER of the tally and what is
   * actually left, so mana already spent does not come back — a documented
   * approximation that spends the expiring mana first, which is what a
   * player would do anyway.
   */
  persistentMana?: Partial<ManaPool>;
  /** How many creatures this player declared as attackers this turn, summed
   * across combat phases (Minas Tirith's "attacked with two or more"). */
  attackersThisTurn?: number;
  /** Set when a draw is attempted from an empty library. SBA then eliminates. */
  failedToDraw: boolean;
  /** Ascend (CR 702.131): once ten or more permanents are controlled while an
   * Ascend source is on the battlefield, the blessing is kept for the game. */
  cityBlessing?: boolean;
};

/**
 * A delayed triggered ability (CR 603.7) created by a resolving spell or
 * ability: "At the beginning of your next upkeep, …".
 *
 * Its effects are already BOUND, because what they refer to ("that
 * spell", "its controller") is usually gone by the time it fires — the
 * same reason `StackObject.grantedTrigger` is snapshotted rather than
 * re-read at resolution.
 */
export type DelayedTrigger = {
  /** Whose ability it is: it acts for this player and makes their choices. */
  controllerId: PlayerId;
  step: "upkeep" | "first_main_phase";
  /**
   * "your next upkeep" waits for the controller's own turn; "the next
   * turn's upkeep" fires on whoever's turn comes next. Four-handed those
   * are three turns apart, so the distinction is not cosmetic.
   */
  whose: "controller" | "any";
  effects: GameEffect[];
  sourceId: CardInstanceId | null;
};

export type StackObject = {
  id: StackObjectId;
  controllerId: PlayerId;
  sourceId: CardInstanceId | null;
  kind: "spell" | "ability";
  /** Chosen when the object was put on the stack. */
  targets: ChosenTarget[];
  /** Index into the source definition's `triggers` for stacked abilities. */
  triggerIndex?: number;
  /**
   * A granted trigger (Kaldra Compleat) copied onto the stack object as it
   * was queued. Once on the stack an ability exists independently of its
   * source (CR 113.7a), and a grant does NOT: the Equipment can fall off, or
   * the granting permanent leave, before the ability resolves. Reading the
   * grant again at resolution would silently resolve nothing.
   */
  grantedTrigger?: CardTrigger;
  /** A granted activated ability, snapshotted for the same reason. */
  grantedActivated?: ActivatedAbility;
  /** The triggering event's subject card ("that creature", "that spell"). */
  subjectCardId?: CardInstanceId;
  /** The triggering event's subject player ("that player"). */
  subjectPlayerId?: PlayerId;
  /** The triggering event's amount ("that much" life). */
  subjectAmount?: number;
  /** Index into the source definition's `activated` for stacked abilities. */
  activatedIndex?: number;
  /** Chosen mode index for modal spells. */
  modeIndex?: number;
  /** Multi-mode spells ("Choose two —"): chosen modes in resolution order. */
  modeIndexes?: number[];
  /** Index into the source definition's `loyaltyAbilities`. */
  loyaltyIndex?: number;
  /** Announced X for {X} costs. */
  xValue?: number;
  /** Fling: the power of the creature sacrificed as a cast cost. */
  sacrificedPower?: number;
  /**
   * Eldritch Evolution: the sacrificed creature's MANA VALUE, kept apart
   * from its power above because the two are captured for different
   * reasons. Power has to be read before the creature dies, since a pump
   * ends with it; mana value is the same in the graveyard, and is carried
   * only because by bind time nothing remembers WHICH creature it was.
   */
  sacrificedManaValue?: number;
  /** Splice onto Arcane: the cards whose effects joined this spell. They
   * are in their owner's HAND, not on the stack. */
  splicedFrom?: CardInstanceId[];
  /** Damage split for divided-damage spells; aligns with `targets`. */
  division?: number[];
  /**
   * A copy of a spell (CR 707.10): it resolves like the original but is not a
   * card — on resolution or countering it ceases to exist instead of moving
   * the source card anywhere.
   */
  isCopy?: boolean;
  /** Mistrise Village: the "next spell you cast" grant, spent at cast. */
  cantBeCountered?: boolean;
  /**
   * Cast via flashback (CR 702.34a): the card is exiled instead of going
   * anywhere else as it leaves the stack.
   */
  fromGraveyard?: boolean;
};

export type CombatAttack = {
  attackerId: CardInstanceId;
  defenderId: PlayerId;
};

export type CombatState = {
  attacks: CombatAttack[];
  /** attackerId -> blockerIds in damage-assignment order */
  blockers: Record<CardInstanceId, CardInstanceId[]>;
  attackersDeclared: boolean;
  declaredBlockersFor: PlayerId[];
};

export type MulliganState = {
  decidingPlayerId: PlayerId;
  taken: Record<PlayerId, number>;
  kept: Record<PlayerId, boolean>;
  pendingBottom: number;
  startingHandSize: number;
};

export type OpeningRollState = {
  rolls: Record<PlayerId, number>;
  startingHandSize: number;
};

export type GameState = {
  id: GameId;
  players: PlayerState[];
  turn: TurnState;
  stack: StackObject[];
  cards: Record<CardInstanceId, CardInstance>;
  definitions: Record<CardDefinitionId, CardDefinition>;
  combat: CombatState | null;
  priorityPlayerId: PlayerId;
  passesSinceAction: number;
  /** Sole remaining living player, if any. */
  winnerId: PlayerId | null;
  /** Append-only zone-change log for future trigger systems. */
  log: GameLogEntry[];
  /** Null after every living player has kept an opening hand. */
  mulligan: MulliganState | null;
  /** Null after the opening d20 has chosen the first player. */
  openingRoll: OpeningRollState | null;
  /** Player who started the game; the turn number increases when play returns here. */
  firstPlayerId: PlayerId;
  /** FIFO special choices. Index 0 is the current pause; empty means play continues. */
  prompts: PendingPrompt[];
  /** Hidden-zone cards currently shown to a viewer (hand reveal). */
  reveals: ZoneReveal[];
  /** Resolved until-end-of-turn effects; swept during cleanup. */
  activeEffects: ContinuousEffect[];
  /** Monotonic CR 613.7 timestamp counter (battlefield entries, effects). */
  nextTimestamp: number;
  /** `${cardId}:${triggerIndex}` keys for once-per-turn triggers already fired. */
  oncePerTurnFired: string[];
  /**
   * Which modes each once-per-turn modal trigger has already taken this
   * turn, keyed `${cardId}:${triggerIndex}`. Cleared with the turn.
   */
  modesChosenThisTurn?: Record<string, number[]>;
  /**
   * Extra combat phases owed this turn (Aggravated Assault, Seize the Day).
   * Consumed as the postcombat main phase ends: the turn re-enters combat,
   * which naturally flows into another main phase.
   */
  pendingExtraCombats: number;
  /**
   * Extra turns owed, in the order they will be taken (CR 505.6a). Queued
   * rather than taken immediately: "an extra turn after this one" means
   * the current turn finishes first, and two Time Warps in one turn give
   * two turns in a row rather than nesting.
   */
  pendingExtraTurns?: PlayerId[];
  /**
   * Stranglehold, Trouble in Pairs: players whose extra turns are skipped.
   * A DENIAL, so it is read as the turn would begin — the turn is still
   * queued and then thrown away, which is what the cards say.
   */
  extraTurnsDenied?: PlayerId[];
  /**
   * One-shot delayed actions: "Sacrifice/Exile it at the beginning of the
   * next end step" (temporary tokens and reanimation shells). Processed as
   * the end step begins; entries whose card already left are dropped.
   */
  delayedEndStep: Array<{
    cardId: CardInstanceId;
    action: "sacrifice" | "exile" | "hand" | "battlefield";
    /** Nezahal: the card comes back TAPPED, which is the whole drawback. */
    returnsTapped?: boolean;
    /** Parting Gust: the returned card picks up this counter. */
    withCounter?: string;
    /** action "battlefield" (Charming Prince): who gets the returned card. */
    controllerId?: PlayerId;
  }>;
  /**
   * Delayed triggered abilities waiting on a future step. Distinct from
   * `delayedEndStep`, which is a fixed four-action shorthand keyed to one
   * card; these carry arbitrary bound effects and their own controller.
   *
   * Simplification: they apply as the step begins rather than going on
   * the stack, exactly as `delayedEndStep` does, so there is no window to
   * respond to one. Documented in RULES_COVERAGE.
   */
  delayedTriggers: DelayedTrigger[];
  /**
   * Mana riders that just fired, waiting for the caster to run them. The
   * payment path cannot apply effects itself — effects.ts imports mana.ts,
   * so the arrow does not go back — and the cast site drains this the
   * moment the cost is paid.
   */
  pendingManaRiders?: Array<{
    controllerId: PlayerId;
    sourceId: CardInstanceId;
    effects: CardEffect[];
  }>;
  /**
   * Player-level shields that last "until your next turn" — Teferi's
   * Protection, The One Ring. A duration `activeEffects` cannot express:
   * that list sweeps at cleanup, and this has to survive every
   * opponent's whole turn and expire at the start of the holder's next.
   */
  playerShields?: Array<{
    playerId: PlayerId;
    /** CR 702.16 read on a player: it cannot be targeted or damaged. */
    protectionFromEverything?: boolean;
    /**
     * Veil of Summer: "You … gain hexproof from blue and from black until
     * end of turn." Read on a player it stops an opponent's spell of that
     * colour TARGETING them, and nothing else.
     */
    hexproofFromColors?: Color[];
    /**
     * This shield ends at CLEANUP rather than at the start of the holder's
     * next turn. Teferi's Protection wants the long life; a plain "until
     * end of turn" shield would be a whole extra turn cycle of it.
     */
    untilEndOfTurn?: boolean;
    /** Teferi's Protection: "your life total can't change" — both ways. */
    lifeLocked?: boolean;
    /**
     * The turn it was made on. It expires at the START of this player's
     * NEXT turn, so one made during their own turn lasts a full cycle
     * rather than ending the moment it was cast.
     */
    createdOnTurn: number;
  }>;
  /**
   * High Tide: "Until end of turn, whenever a player taps an Island for
   * mana, that player adds an additional {U}." The same rule a permanent
   * carries as `landTapEcho`, but with no permanent to carry it — and it
   * watches EVERY player rather than one controller. Swept at cleanup.
   */
  turnManaEchoes?: NonNullable<CardDefinition["landTapEcho"]>[];
  /**
   * Myriad's tokens are exiled at END OF COMBAT, not at the end step. The
   * difference is the card: at the end step they would survive the
   * postcombat main phase, where a sacrifice outlet turns each of them
   * into value the printed card never offers.
   */
  delayedEndCombat?: Array<{
    cardId: CardInstanceId;
    /**
     * Myriad exiles its tokens; the Ring's third tier SACRIFICES the
     * blocker, which is a different event to everything watching. One list
     * with an action, rather than two lists that would have to be swept in
     * a defined order.
     */
    action: "exile" | "sacrifice";
  }>;
  /** Spells cast by anyone this turn — Storm's copy count (CR 702.40). */
  spellsCastThisTurn: number;
  /** Per-player casts this turn (Lotho's second-spell watch). */
  spellsCastByPlayerThisTurn?: Record<PlayerId, number>;
  /**
   * Approach of the Second Sun: per-player casts BY NAME, for the whole
   * GAME rather than the turn — the only tally on this state that never
   * resets, because the card asks about the whole game.
   */
  /**
   * The cards the most recent mill put into a graveyard, in the order they
   * went. "You may put a land card from among them into your hand" reads
   * this — a referent rather than a fold, because Ripples of Undeath puts
   * an optional payment between the mill and the take and the take happens
   * when that PROMPT is answered.
   */
  lastMilledCardIds?: CardInstanceId[];
  /**
   * Beseech the Mirror: "the exiled card" is the one the search just found,
   * and by the time the follow-up runs the search is a resolved prompt with
   * nothing left to point at. Recorded the same way the milled list is, and
   * for the same reason.
   */
  lastSearchedCardIds?: CardInstanceId[];
  /**
   * The card name most recently named by a "choose a card name" prompt.
   * On the state rather than in a bind context because the prompt is
   * answered across a client round trip, and because the effects that read
   * it were BOUND before it existed — `applyEffects` parks them on the
   * prompt and resumes them, so the name has to be read at apply.
   */
  lastChosenCardName?: string;
  /**
   * Which COLOURS each player has cast a spell in this turn. The tallies
   * beside it count spells; Veil of Summer and the Traps ask what colour
   * they were, and a count cannot be made to answer that afterwards.
   * Reset with the other per-turn tallies.
   */
  spellColorsCastByPlayerThisTurn?: Record<PlayerId, Color[]>;
  /**
   * "Spells you control can't be countered this turn." A turn-long grant,
   * where the shield beside it on a stack object is spent on one spell.
   * Cleared at cleanup with the rest of the turn.
   */
  spellsUncounterableThisTurn?: PlayerId[];
  spellsCastByNameThisGame?: Record<PlayerId, Record<string, number>>;
  /** Esper Sentinel: per-player noncreature casts this turn. */
  noncreatureSpellsCastByPlayerThisTurn?: Record<PlayerId, number>;
  /** Idol of Oblivion: players who created a token this turn. */
  createdTokenThisTurn?: PlayerId[];
  /** Faerie Mastermind: per-player draws this turn. */
  drawsByPlayerThisTurn?: Record<PlayerId, number>;
  /**
   * The Gaffer: per-player life GAINED this turn, which is not the same as
   * the change in life total — losing 5 and gaining 3 leaves you lower but
   * still counts as having gained 3. Tallied off the `gains_life` event so
   * every path that gains life is counted once, lifelink included.
   */
  lifeGainedByPlayerThisTurn?: Record<PlayerId, number>;
  /**
   * Wound Reflection: per-player life LOST this turn, the mirror of the
   * tally above and kept for the same reason — it is not the change in a
   * life total, and gaining life back does not undo having lost it.
   */
  lifeLostByPlayerThisTurn?: Record<PlayerId, number>;
  /**
   * Spinerock Knoll: damage dealt to each player this turn. Kept apart from
   * `lifeLostByPlayerThisTurn` because they are different questions — a
   * player who paid life for a painland lost life and was dealt nothing.
   * Cleared with the other per-turn tallies at untap.
   */
  damageToPlayerThisTurn?: Record<PlayerId, number>;
  /** Creatures that died this turn (Mahadi's Treasure count). */
  creaturesDiedThisTurn?: number;
  /** Silence: everyone but this player is locked out of casting until end of
   * turn. Cleared at cleanup. */
  castLockUntilEot?: PlayerId;
  /** Ranger-Captain of Eos: everyone but this player is locked out of
   * casting NONCREATURE spells until end of turn. Cleared at cleanup. */
  noncreatureCastLockUntilEot?: PlayerId;
  /**
   * Conduit of Worlds: players who may not cast any more spells this turn.
   * The inverse of `castLockUntilEot`, which locks everyone EXCEPT one —
   * this locks the listed players themselves. Cleared at cleanup.
   */
  selfCastLockUntilEot?: PlayerId[];
  /**
   * Impulse exiles (Ragavan, Professional Face-Breaker): cards in exile that
   * the listed player may cast or play this turn, paying costs as normal.
   * Cleared at cleanup.
   */
  /**
   * Cards a player may PLAY from where they currently are, for a limited
   * time. Named for the impulse exiles it started as, but Emry grants the
   * same permission to a card in a GRAVEYARD — so every reader accepts both
   * zones. The name is kept because it is a serialized field and a rename
   * would strand saved tables.
   */
  exilePlayable?: Array<{
    cardId: CardInstanceId;
    casterId: PlayerId;
    freeCast?: boolean;
    /** Atsushi: "until the end of your next turn" — survives cleanups,
     * decremented at the caster's own cleanups, dropped at 0. Entries
     * without it clear at every cleanup as before. */
    remainingOwnCleanups?: number;
    /**
     * Conduit of Worlds: casting THIS card locks its caster out of further
     * spells this turn. The lock rides the grant rather than the ability,
     * because "if you do" means declining the cast costs nothing.
     */
    locksCastingAfter?: boolean;
    /**
     * Opposition Agent: "for as long as they remain exiled" — the grant
     * outlives the turn, so cleanup leaves it alone. It ends when the card
     * does, by leaving exile.
     */
    whileExiled?: boolean;
    /**
     * Opposition Agent: "you may spend mana as though it were mana of any
     * color to cast them". Applied by turning the parsed cost's coloured
     * pips generic for that one cast, which is what the sentence means and
     * costs the mana core nothing.
     */
    anyColorMana?: boolean;
  }>;
  /** Rebound: cards waiting in exile to be offered free at the caster's
   * next upkeep. */
  pendingRebounds?: Array<{ cardId: CardInstanceId; casterId: PlayerId }>;
  /**
   * Moraug: added combats that will untap the active player's creatures as
   * they begin. A COUNT beside `pendingExtraCombats` rather than a flag on
   * each queued combat, because the queue is itself only a count — two
   * landfalls owe two untaps.
   */
  pendingExtraCombatUntaps?: number;
  /**
   * Promise of Loyalty: "can't attack you or planeswalkers you control for
   * as long as it has a vow counter on it". The sorcery is gone, so the
   * rule has no permanent to live on; it is keyed to a COUNTER and a
   * player, and it ends when the counter comes off rather than at any
   * point in the turn — which is why it is not an `activeEffects` entry.
   */
  counterAttackBans?: Array<{ counter: string; protectedPlayerId: PlayerId }>;
  /** Combat phases begun this turn (Karlach's first-combat condition). */
  combatPhasesThisTurn?: number;
  /** Fog: no combat damage is dealt for the rest of this turn. */
  preventCombatDamage: boolean;
  /**
   * Inkshield: "prevent all combat damage that would be dealt to YOU this
   * turn". A per-player shield rather than the table-wide flag above, and it
   * counts what it stopped — the tokens are made off exactly that number, so
   * the tally IS the card. Cleared at cleanup with the rest of the per-turn
   * state.
   */
  combatDamageShields?: Array<{
    playerId: PlayerId;
    prevented: number;
    /** The token made per point prevented, applied once combat damage is done. */
    tokenPerDamage?: Extract<GameEffect, { kind: "create_token" }>;
  }>;
  /** Maze of Ith: creatures whose combat damage (dealt and received) is
   * prevented this turn. Cleared at cleanup. */
  preventCombatFor?: CardInstanceId[];
  /** As Foretold: players who already used their once-per-turn free cast.
   * Cleared at untap alongside the other per-turn tallies. */
  freeCastUsedThisTurn?: PlayerId[];
  /**
   * Sea Gate Restoration: "You have no maximum hand size FOR THE REST OF THE
   * GAME." A player-level grant with no source on the battlefield to read,
   * unlike `CardDefinition.noMaxHandSize`, which lasts only while its
   * permanent is out.
   */
  noMaxHandSizePlayers?: PlayerId[];
  /** Emergence Zone / Borne Upon a Wind: players who may cast at instant
   * speed for the rest of this turn. Cleared at cleanup. The permanent form
   * (Vedalken Orrery) is `CardDefinition.grantsFlash` instead. */
  flashThisTurn?: PlayerId[];
  /**
   * Permanents whose control was taken for the turn (Insurrection), with the
   * controller to hand them back to at cleanup. A second steal of the same
   * permanent keeps the ORIGINAL entry, so the card returns to whoever held it
   * before any of this turn's thefts rather than to the previous thief.
   */
  temporaryControl?: { cardId: CardInstanceId; returnToId: PlayerId }[];
  /** Mirage Mirror: permanents copying something only until end of turn, with
   * the definition to put back. */
  temporaryCopies?: { cardId: CardInstanceId; restoreDefinitionId: CardDefinitionId }[];
  /**
   * "The next spell you cast this turn …" (Mistrise Village, Archway of
   * Innovation). A permission with a use count rather than a prompt: it is
   * spent by the next cast and expires with the turn. Modelled the same way
   * as `freeCastFromHand`, which is the shape that keeps a new "choice" from
   * needing client, bot and fuzz answer paths.
   */
  nextSpellGrants?: { playerId: PlayerId; improvise?: boolean; cantBeCountered?: boolean }[];
  /**
   * Rishkar's Expertise / Electrodominance: "you may cast a spell with mana
   * value N or less from your hand without paying its mana cost". Modelled as
   * a PERMISSION with a use count rather than a prompt, the same way
   * `exilePlayable` works — so the existing cast action serves it and no new
   * answer path is needed in the client, the bot, or the fuzzer. Each grant
   * is consumed by one matching cast; leftovers clear at cleanup.
   */
  freeCastFromHand?: Array<{
    casterId: PlayerId;
    /** Omitted means any mana value (Omniscience-style). */
    maxManaValue?: number;
    remaining: number;
  }>;
  /**
   * Feign Death-class until-EOT grants: if the listed creature dies this
   * turn, it returns to the battlefield tapped (optionally with a +1/+1
   * counter or a Treasure for its controller). Cleared at cleanup.
   */
  diesReturnUntilEot?: Array<{
    cardId: CardInstanceId;
    counter?: boolean;
    treasure?: boolean;
  }>;
};

export type ZoneReveal = {
  viewerId: PlayerId;
  cardIds: CardInstanceId[];
};

export type LookDestination = "hand" | "library_bottom" | "library_top" | "exile";

/** What a library search may fetch (all listed names must match, lowercase). */
export type SearchFilter = {
  supertypes?: string[];
  types?: string[];
  subtypes?: string[];
  /** "a Plains, Island, Swamp, or Mountain card": any listed subtype matches. */
  subtypesAny?: string[];
  /** "an instant or sorcery card": any listed type matches. */
  typesAny?: string[];
  /** "a green creature card": every listed color must be present. */
  colors?: Color[];
  /** "a noncreature, nonland card": none of these types may be present. */
  nonTypes?: string[];
  /** "a non-Human creature card": none of these subtypes may be present. */
  nonSubtypes?: string[];
  /**
   * Urza's Saga: "an artifact card with mana cost {0} or {1}". The printed
   * COST, not the mana value — a {W} artifact has mana value 1 and is not
   * what this asks for.
   */
  manaCostIn?: string[];
  /** "with mana value N or less". */
  maxManaValue?: number;
  /** Demonic Consultation: "a card with the chosen name". A FLAG, resolved
   * at apply against the name that was just chosen — at bind time the
   * prompt that names it has not been answered. */
  nameIsChosen?: boolean;
  /** "with mana value X or less": resolved to maxManaValue from the announced
   * X when the effect binds (Green Sun's Zenith). */
  maxManaValueX?: boolean;
  /**
   * Loot, Exuberant Explorer: "with mana value less than or equal to the
   * number of lands you control". A BOARD count rather than a printed
   * number or an announced X, resolved to `maxManaValue` at bind — the
   * same moment the other two caps resolve, and before any sibling effect
   * in the batch can change the board out from under it.
   */
  maxManaValueFrom?: DynamicCount;
  /**
   * Eldritch Evolution: "mana value X or less, where X is N plus the
   * sacrificed creature's mana value". The number here is that N; the rest
   * comes from the cost that was already paid.
   */
  maxManaValuePlusSacrificed?: number;
  /** "with toughness 2 or less" (Recruiter of the Guard). Printed toughness. */
  maxToughness?: number;
  /** "with power 2 or less" (Imperial Recruiter). Printed power. */
  maxPower?: number;
  /** Transmute: "with the same mana value as this card". */
  exactManaValue?: number;
  /** "a card with flash" (Waterlogged Teachings). Printed keywords only —
   * a card in the library has no granted ones. */
  keyword?: Keyword;
  /**
   * "an artifact or Dragon card", "basic land cards and/or Gate cards" —
   * a disjunction whose branches sit on DIFFERENT axes, which neither
   * `typesAny` (one axis: types) nor `subtypesAny` (one axis: subtypes)
   * can express. A card matches if it matches ANY branch, and the fields
   * beside `anyOf` still apply to all of them, so "an instant or sorcery
   * card with mana value 2 or less" is a disjunction under a shared cap.
   *
   * One level deep by construction: nothing builds a branch that has its
   * own `anyOf`, and the matcher does not recurse past the first.
   */
  anyOf?: SearchFilter[];
};

export type SearchDestination =
  | "hand"
  | "battlefield"
  | "graveyard"
  /** Beseech the Mirror: the find is exiled and a later effect decides
   * where it goes from there. */
  | "exile"
  | "library_top";

export type CardFilter =
  | "any"
  | "creature"
  | "nontoken_creature"
  /** Plaguecrafter: "a creature or planeswalker of their choice". */
  | "creature_or_planeswalker"
  | "land"
  | "nonland"
  | "noncreature_nonland"
  /** Stoneforge Mystic: "an Equipment card from your hand". */
  | "equipment"
  /** Terrain Generator: "a basic land card from your hand". */
  | "basic_land"
  /** Sheoldred's Edict: "a creature token of their choice". */
  | "token_creature"
  /** Sheoldred's Edict: "a planeswalker of their choice". */
  | "planeswalker"
  /** Jarad-class: "sacrifice an artifact". */
  | "artifact"
  /** Chrome Mox: "a nonartifact, nonland card from your hand". */
  | "nonartifact_nonland"
  /** Kodama of the East Tree: "a permanent card from your hand". */
  | "permanent"
  /** Liliana's -9 asks for one of EACH permanent type, so all six exist. */
  | "enchantment"
  /** Isochron Scepter: "an instant card … from your hand". */
  | "instant"
  | "battle";

/** What a Clone-style permanent may enter as a copy of. */
export type EnterAsCopyScope =
  | "any_creature"
  | "your_creature"
  | "another_your_creature"
  | "your_creature_or_planeswalker"
  | "any_nonland_permanent"
  | "any_artifact_or_creature"
  /** Sculpting Steel. */
  | "any_artifact"
  /** Vesuva. */
  | "any_land"
  /** Masterwork of Ingenuity. */
  | "any_equipment"
  /** Mirrormade. */
  | "any_artifact_or_enchantment";

export type ChooseCardSource = {
  playerId: PlayerSelector;
  zone: "hand" | "graveyard" | "battlefield" | "exile";
  filter: CardFilter;
  /**
   * Braids: "a permanent that shares a card type with it". Resolved to a
   * concrete type list when the effect binds, against the card chosen
   * just before — by prompt time that card is already in a graveyard.
   */
  sharesTypeWithChosen?: boolean;
  /** Dauthi Voidwalker: only exiled cards carrying a void counter. */
  hasVoidCounter?: boolean;
  /**
   * Kodama of the East Tree: "with equal or lesser mana value" — the cap is
   * the mana value of the permanent whose entry triggered this, so it is
   * resolved when the effect binds rather than printed.
   */
  maxManaValueOfSubject?: boolean;
  /** Sylvan Library: only cards drawn THIS turn are eligible. */
  drawnThisTurn?: boolean;
  /** Isochron Scepter: "…with mana value 2 or less". A printed cap, unlike
   * `maxManaValueOfSubject` which is read off a trigger's subject. */
  maxManaValue?: number;
  /**
   * "…from among them": only the cards the most recent mill put here. Kept
   * as a FLAG rather than resolved to ids at bind time, because effects
   * bind as a batch — at bind time the mill in the same batch has not run
   * and the list still holds the previous one's cards.
   */
  milledThisWay?: boolean;
  /**
   * Sylvan Library chooses two cards, one after the other. Without this the
   * second choice could name the first again — paying life leaves that card
   * in hand, still drawn this turn, still legal.
   */
  excludePreviousChoice?: boolean;
  /** Korvold: "sacrifice ANOTHER permanent" — the source may not choose
   * itself. Bound to a concrete id when the effect binds, because the
   * definition does not know which instance it will be. */
  excludeSelf?: boolean;
  /**
   * Soul Shatter: "…with the greatest mana value among creatures and
   * planeswalkers they control". A RESTRICTION on the choice, not a
   * filter on what counts — the chooser still picks, but only from the
   * cards tied for the highest mana value in this source's own matching
   * set. Narrowed per source, so each opponent measures their own board
   * rather than everyone measuring the table's biggest permanent.
   */
  greatestManaValue?: boolean;
};

export type BoundChooseCardSource = {
  playerId: PlayerId;
  zone: "hand" | "graveyard" | "battlefield" | "exile";
  filter: CardFilter;
  /** The bound half of `ChooseCardSource.sharesTypeWithChosen`. */
  sharesTypes?: string[];
  /** The bound half of `ChooseCardSource.hasVoidCounter`. */
  hasVoidCounter?: boolean;
  /** The bound half of `ChooseCardSource.drawnThisTurn`. */
  drawnThisTurn?: boolean;
  /** The bound half of `ChooseCardSource.milledThisWay`, still a flag. */
  milledThisWay?: boolean;
  /** The bound half of `ChooseCardSource.excludeSelf`. */
  excludeCardId?: CardInstanceId;
  /** The bound half of `ChooseCardSource.greatestManaValue`. */
  greatestManaValue?: boolean;
  /** Kodama: the bound cap, resolved from the subject's mana value. */
  maxManaValue?: number;
};

export type TokenTemplate = {
  name: string;
  typeLine: string;
  power: number | null;
  toughness: number | null;
};

export type GameEffect =
  | { kind: "gain_life"; playerId: PlayerId; amount: number }
  | { kind: "lose_life"; playerId: PlayerId; amount: number }
  | { kind: "add_poison"; playerId: PlayerId; amount: number }
  | {
      kind: "deal_damage";
      sourceId: CardInstanceId | null;
      target: EffectTarget;
      amount: number;
      /**
       * Descent into Avernus: the amount is a counter tally on `cardId`,
       * read when the damage is DEALT rather than when the effect binds.
       * Its sibling `add_counter` has not run at bind time — effects bind
       * as a batch — so a bind-time reading is always two short.
       */
      amountFromCounters?: { cardId: CardInstanceId; counter: string };
      /** The bound half of "milled_mana_value", still a flag: the mill that
       * makes the set is a sibling in the same batch. */
      amountFromMilled?: boolean;
      gainLife?: boolean;
    }
  | {
      kind: "draw";
      playerId: PlayerId;
      count: number;
      /**
       * The One Ring: read the count off this source's counters when the
       * draw APPLIES, not when it binds. The sibling `add_counter` in the
       * same list has not run yet at bind time, so a bind-time count is
       * always one behind.
       */
      countFromCounterOnSource?: { sourceId: CardInstanceId; counter: string };
      /** "You may draw": auto-taken, but skipped when the library is too small. */
      optional?: boolean;
      /** The turn-based draw-step batch: its first card is exempt from
       * draw doubling ("except the first one you draw in each of your
       * draw steps"). */
      turnDraw?: boolean;
    }
  | { kind: "scry"; playerId: PlayerId; count: number }
  | { kind: "surveil"; playerId: PlayerId; count: number }
  | {
      kind: "move_card";
      cardId: CardInstanceId;
      toZone: Exclude<ZoneName, "stack">;
      libraryPosition?: LibraryPosition;
      entersTapped?: boolean;
      gainsHaste?: boolean;
      atEndStep?: "sacrifice" | "exile";
      /**
       * Whip of Erebos: "If it would leave the battlefield, exile it instead
       * of putting it anywhere else." A shield ON the arriving permanent, so
       * a sacrifice or a bounce cannot bank the card for later — without it
       * the Whip is a repeatable reanimator instead of a one-shot.
       */
      exileIfLeaves?: boolean;
      /**
       * This move is a DESTRUCTION (CR 701.7), not just a trip to the
       * graveyard. Indestructible stops it and totem armor replaces it;
       * a bounce, a tuck, a sacrifice and an exile all leave it off. The
       * word in the oracle text is what sets it.
       */
      destroy?: boolean;
      /**
       * "It can't be regenerated" (CR 701.15d). Rides the destruction it
       * belongs to rather than the card, because "destroyed THIS WAY"
       * scopes to one ability, and it never spends a shield it denies.
       */
      denyRegeneration?: boolean;
      /**
       * Ojer Taq: "return it to the battlefield tapped and TRANSFORMED".
       * The card arrives on its other face, which is a different thing from
       * transforming it afterwards — nothing sees the front face enter.
       */
      transformed?: boolean;
      /** Kodama: mark the arriving permanent as put by THIS ability. */
      putByAbilityOf?: CardInstanceId;
      /** Battlefield arrivals: the arriving card is controlled by this player. */
      controllerId?: PlayerId;
      /** "…to the battlefield with a -1/-1 counter on it" (Persist). */
      withCounter?: { counter: string; amount: number };
    }
  /**
   * Mirage Mirror / Thespian's Stage: this permanent becomes a copy of
   * another object. `keepAbilities` is Thespian's Stage keeping the ability
   * that did the copying, which is the only reason it can do it twice.
   */
  | {
      kind: "become_copy";
      cardId: CardInstanceId;
      ofCardId: CardInstanceId;
      untilEot?: boolean;
      keepAbilities?: boolean;
    }
  /**
   * Midnight Clock: "shuffle your hand and graveyard into your library".
   * Not a series of `move_card`s — the cards go in as one batch and the
   * library is shuffled ONCE afterwards, which is what makes the result a
   * genuinely random order rather than a stack of the graveyard on top.
   */
  | {
      kind: "shuffle_zones_into_library";
      playerId: PlayerId;
      zones: ("hand" | "graveyard")[];
    }
  | { kind: "tap"; cardId: CardInstanceId }
  | { kind: "untap"; cardId: CardInstanceId }
  /**
   * Reconnaissance: the creature stops attacking but stays on the
   * battlefield. Not a tap, not a bounce — it is removed from combat
   * (CR 506.4), so it deals and receives no combat damage and any
   * "whenever this attacks" trigger that already fired stays fired.
   */
  | { kind: "remove_from_combat"; cardId: CardInstanceId }
  /**
   * Liquimetal Torque: "becomes an artifact IN ADDITION to its other types
   * until end of turn". Layer 4, so it stacks with what the permanent
   * already is rather than replacing it.
   */
  | { kind: "types_until_eot"; cardId: CardInstanceId; types: string[] }
  /** "You may tap or untap target creature": toggles the current state — a
   * documented approximation of the choice (Retreat to Coralhelm). */
  | { kind: "tap_or_untap"; cardId: CardInstanceId }
  | {
      kind: "add_mana";
      playerId: PlayerId;
      mana: Partial<ManaPool>;
      /** Birgi: this mana survives steps and phases ending, until cleanup. */
      untilEndOfTurn?: boolean;
    }
  | {
      kind: "create_token";
      ownerId: PlayerId;
      name: string;
      typeLine: string;
      power?: number | null;
      toughness?: number | null;
      keywords?: Keyword[];
      /** Bound from perControlled; total tokens before doubling. */
      count?: number;
      /** Mobilize: end-step cleanup for the created tokens. */
      atEndStep?: "sacrifice" | "exile";
      /** Anim Pakal: count the source's counters when the effect applies. */
      countFromCounters?: { cardId: CardInstanceId; counter: string };
      /**
       * Krenko, Tin Street Kingpin: the count is the SOURCE's power, read
       * when the tokens are created rather than when the effect binds. Its
       * sibling `add_counter` has not run at bind time — effects bind as a
       * batch — so a bind-time reading is always one short.
       */
      countFromPowerOf?: CardInstanceId;
      /**
       * Urza's Saga's Construct: "this token gets +1/+1 for each artifact
       * you control". The static belongs to the TOKEN, so it rides the
       * definition the token is made from.
       */
      bonusPt?: { power: number; toughness: number; per: DynamicCount };
      /** Adeline: one token per opponent, each attacking that opponent. */
      attackingEachOpponent?: boolean;
      entersTappedAttacking?: boolean;
      /** "a tapped 1/1 blue Fish" (the gift mechanic). */
      entersTapped?: boolean;
      /** "a 4/4 blue and red Elemental" — a token has no mana cost to derive
       * its colours from, so the printed words are the only source. */
      colors?: Color[];
    }
  | { kind: "mill"; playerId: PlayerId; count: number }
  | {
      kind: "discard";
      playerId: PlayerId;
      count: number;
      conniveCounterOn?: CardInstanceId;
    }
  /** Gamble: "discard a card at random". */
  | { kind: "discard_random"; playerId: PlayerId; count: number }
  | { kind: "discard_unless_attacked"; playerId: PlayerId; count: number }
  | { kind: "amass"; playerId: PlayerId; amount: number; subtype?: string }
  | { kind: "reveal_zone"; fromPlayerId: PlayerId; toPlayerId: PlayerId; zone: "hand" }
  /**
   * Mishra's Bauble: "Look at the top card of target player's library."
   * A LOOK, not a reveal — only `viewerId` sees it, which is the whole
   * point of aiming it at an opponent.
   */
  | { kind: "look_top_card"; playerId: PlayerId; viewerId: PlayerId }
  | {
      kind: "choose_card";
      chooserId: PlayerId;
      sources: BoundChooseCardSource[];
      thenEffects: CardEffect[];
      sourceId: CardInstanceId | null;
      optional?: boolean;
      thenEffectsIfNone?: CardEffect[];
      /** Braids: the ABILITY's controller, which is not the chooser. */
      controllerId?: PlayerId;
      /** Plaguecrafter: with no legal choice, discard this many instead. */
      cantDiscards?: number;
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerId;
      count: number;
      destinations: LookDestination[];
      /** Hideaway: record the exiled card on this permanent. */
      hideawaySourceId?: CardInstanceId;
      /** Expressive Iteration: the exiled card is playable this turn. */
      exilePlayableThisTurn?: boolean;
    }
  | { kind: "sacrifice"; cardId: CardInstanceId }
  /**
   * Torment of Hailfire: the chosen card came from a pool spanning the
   * battlefield AND the hand, so how it leaves depends on where it was.
   * Read at APPLY, because the choice happens between bind and here.
   */
  | { kind: "sacrifice_or_discard_chosen"; cardId: CardInstanceId }
  /** Chrome Mox: exile `cardId` and record it on `sourceId`. */
  | { kind: "imprint"; cardId: CardInstanceId; sourceId: CardInstanceId }
  | {
      kind: "play_hidden_card";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      free?: boolean;
    }
  /** Urza's Saga, with the permanent already bound. */
  | { kind: "grant_self_activated"; cardId: CardInstanceId; ability: ActivatedAbility }
  | { kind: "grant_self_mana"; cardId: CardInstanceId; ability: ManaAbility }
  /** Dauthi Voidwalker, with the chosen card already bound. */
  | {
      kind: "grant_play_chosen";
      playerId: PlayerId;
      cardId: CardInstanceId;
      free?: boolean;
    }
  /** Herald's Horn, with the filter already resolved. */
  | {
      kind: "look_top_take_matching";
      playerId: PlayerId;
      filter: SearchFilter;
    }
  | { kind: "phase_out"; cardIds: CardInstanceId[] }
  | { kind: "add_counter"; cardId: CardInstanceId; counter: string; amount: number }
  /**
   * Vanishing (CR 702.62): take a counter off, and if that was the last one,
   * sacrifice the permanent. One effect rather than a removal plus a separate
   * "when the last is removed" trigger, because the trigger has no event to
   * watch — counter removal is not an engine event.
   */
  | {
      kind: "remove_counter";
      cardId: CardInstanceId;
      counter: string;
      amount: number;
      sacrificeWhenEmpty?: boolean;
    }
  /** The Ozolith's combat trigger: every counter hops to the target. */
  | { kind: "move_all_counters"; fromId: CardInstanceId; toId: CardInstanceId }
  /**
   * Nesting Grounds: "Move A counter from target permanent you control onto
   * a second target permanent" — one counter, of a kind the source picks,
   * between two independently chosen permanents.
   *
   * `counter` is resolved at bind from what the donor actually carries
   * (documented auto-pick: +1/+1 first, then whatever else is there, since a
   * player moving a counter almost always means the growth one). Moving
   * nothing when the donor is bare is correct — the printed ability has no
   * "if you do" rider to fail.
   */
  | {
      kind: "move_counter";
      fromId: CardInstanceId;
      toId: CardInstanceId;
      counter: string;
    }
  /**
   * The Earth Crystal: "Distribute two +1/+1 counters among one or two
   * target creatures you control." Distinct from N separate add_counters
   * because the DIVISION is chosen as the ability is put on the stack
   * (CR 601.2d) and each chosen target must get at least one.
   */
  | {
      kind: "distribute_counters";
      counter: string;
      /** One entry per counter placed; repeats mean two on one permanent. */
      cardIds: CardInstanceId[];
    }
  /** Bristly Bill: "Double the number of +1/+1 counters on each creature you
   * control" — a one-shot doubling of what is already there, not a
   * replacement on future counters. */
  | { kind: "double_counters_on_team"; playerId: PlayerId; counter: string }
  /** Mossborn Hydra: the doubling lands on one permanent, not a team. */
  | { kind: "double_counters_on"; cardId: CardInstanceId; counter: string }
  | { kind: "double_all_counters"; cardIds: CardInstanceId[] }
  | {
      /**
       * Tibalt's Trickery: the whole second half of the card, as one
       * effect. Everything it says about "that spell" — whose it is, what
       * it is called — is read at BIND, because effects bind as a batch
       * and by the time this applies the sibling counter has already put
       * the spell in a graveyard, where it has neither a controller nor a
       * stack entry left to read.
       */
      kind: "mill_and_dig_free";
      /** The countered spell's controller: they mill, they dig, they cast. */
      playerId: PlayerId;
      /** The countered spell's name, which the find must NOT share. */
      excludedName: string;
    }
  | {
      kind: "counter_spell";
      stackObjectId: StackObjectId;
      /**
       * Force of Negation: the countered spell is EXILED instead of going
       * to its owner's graveyard, which matters to everything that reads
       * a graveyard afterwards.
       */
      exileInstead?: boolean;
    }
  | {
      kind: "bounce_spell_or_permanent";
      cardId?: CardInstanceId;
      stackObjectId?: StackObjectId;
    }
  | { kind: "exchange_life_toughness"; playerId: PlayerId; sourceId: CardInstanceId }
  | { kind: "counter_unless_pays"; stackObjectId: StackObjectId; cost: string }
  | { kind: "copy_spell"; stackObjectId: StackObjectId; controllerId: PlayerId }
  /** Mindbreak Trap — see the definition form for why this is not a counter. */
  | { kind: "exile_spell"; stackObjectId: StackObjectId }
  /**
   * Beseech the Mirror's payoff, as one effect because it is one decision
   * about one card: whatever the search just exiled either becomes free to
   * cast — if the spell was bargained and the card is cheap enough — or
   * goes to its searcher's hand.
   *
   * The permission is a GRANT rather than a prompt, the shape this engine
   * uses wherever a "may cast" would otherwise need client, bot and fuzz
   * answer paths. Documented approximation: a granted card that is never
   * cast stays in exile instead of reaching hand at the end of the
   * resolution, which is strictly worse for its controller than the
   * printed card and never better.
   */
  | {
      kind: "searched_free_or_hand";
      playerId: PlayerId;
      maxManaValue: number;
      /** Read at BIND, while the card is still a spell carrying the flag. */
      bargained: boolean;
    }
  | {
      kind: "extra_combat";
      /**
       * Moraug: "At the beginning of that combat, untap all creatures you
       * control." The untap belongs to the added combat, not to the trigger
       * that made it — untapping when the trigger resolves would let the
       * controller tap for mana in the main phase afterwards and still
       * attack with everything, which is stronger than the printed card.
       */
      untapAtBeginning?: boolean;
    }
  | {
      kind: "untap_all";
      playerId: PlayerId;
      /** Valley Floodcaller: only these subtypes. */
      subtypes?: string[];
      what: "creature" | "land" | "attacking" | "nonland";
      /** Combat Celebrant: "all OTHER creatures you control". */
      excludeSource?: boolean;
      sourceId?: CardInstanceId;
    }
  /** Combat Celebrant: mark the source exerted (CR 701.39). */
  | { kind: "exert"; cardId: CardInstanceId }
  /** The Ring tempts you — see the definition form. */
  | { kind: "ring_tempts"; playerId: PlayerId }
  /**
   * The Ring's third tier: "that creature's controller sacrifices it at
   * end of combat." The blocker is the trigger's SUBJECT, so it is bound
   * from there rather than named here.
   */
  | { kind: "sacrifice_blocker_at_end_of_combat"; cardId: CardInstanceId }
  /** Cryptic Command: "Tap all creatures your opponents control." */
  | { kind: "tap_all"; playerId: PlayerId; what: "creature" | "land" }
  /**
   * CR 701.38: goad a creature. `byPlayerId` is the goading player — it is
   * what the creature may not attack, and whose next turn ends the effect.
   */
  | { kind: "goad"; cardId: CardInstanceId; byPlayerId: PlayerId }
  /** Disrupt Decorum / Kardur: goad every creature `byPlayerId` does not control. */
  | { kind: "goad_all"; byPlayerId: PlayerId }
  /** Bident of Thassa: those creatures must attack, but may pick anyone. */
  | { kind: "must_attack_all"; byPlayerId: PlayerId }
  /** "Gain control of target …" (Archmage's Charm). */
  | {
      kind: "gain_control";
      cardId: CardInstanceId;
      controllerId: PlayerId;
      /** "…until end of turn" (Insurrection): handed back at cleanup. */
      untilEot?: boolean;
    }
  /** "Gain control of all artifacts that player controls" (Hellkite Tyrant),
   * "…all creatures" (Insurrection). */
  | {
      kind: "gain_control_all";
      controllerId: PlayerId;
      what: ControlAllScope;
      /** Only permanents this player currently controls; omitted means all. */
      fromId?: PlayerId;
      untilEot?: boolean;
    }
  /** Homeward Path: "Each player gains control of all creatures they own." */
  | { kind: "restore_control"; what: ControlAllScope }
  /** Karlach: "They gain first strike until end of turn" on all attackers. */
  | { kind: "attackers_gain_keyword_until_eot"; keyword: Keyword }
  | { kind: "untap_lands_up_to"; playerId: PlayerId; count: number }
  /**
   * Inkshield: the shield belongs to ONE player, and counts what it stopped
   * so the token rider can read it. Absent means the table-wide fog every
   * other card prints.
   */
  | {
      kind: "fog";
      forPlayerId?: PlayerId;
      tokenPerDamage?: Extract<GameEffect, { kind: "create_token" }>;
    }
  /** Mystic Forge: exile the top card(s) of the player's library. */
  | { kind: "exile_top"; playerId: PlayerId; count: number }
  /**
   * "Choose a card name." Any name at all, not a name from the chooser's
   * library: naming a card that is NOT in your deck is exactly how Demonic
   * Consultation exiles the whole library, and offering only findable
   * names would delete the line the card is played for.
   */
  | { kind: "choose_card_name"; playerId: PlayerId; sourceId?: CardInstanceId }
  /**
   * Fact or Fiction. Two decisions belonging to two DIFFERENT players: an
   * opponent divides the revealed cards into two piles, and the controller
   * then takes one of them. The whole card is the tension between those
   * two, so neither may be auto-taken by the other.
   */
  /**
   * Tempting offer (CR 702.x has no number; it is an ability word). You do
   * a thing, each opponent may do the same thing FOR THEMSELVES, and for
   * each who did you do it again.
   *
   * The action is carried UNBOUND, because rebinding it to a different
   * player is the entire mechanic — a bound copy would have every opponent
   * searching the controller's library.
   */
  | {
      kind: "tempting_offer";
      playerId: PlayerId;
      action: CardEffect[];
    }
  | {
      kind: "tap_own_for_x";
      playerId: PlayerId;
      sourceId: CardInstanceId | null;
      subtype: string;
      rider: CardEffect[];
    }
  | {
      kind: "punisher_choice";
      chooserId: PlayerId;
      controllerId: PlayerId;
      sourceId: CardInstanceId | null;
      ifTaken: CardEffect[];
      ifDeclined: CardEffect[];
    }
  | { kind: "exile_until_taken"; playerId: PlayerId }
  | { kind: "extra_turn"; playerId: PlayerId }
  | { kind: "commander_cast_counters"; cardId: CardInstanceId }
  | {
      kind: "grant_cast_this_turn";
      cardId: CardInstanceId;
      playerId: PlayerId;
      locksCastingAfter?: boolean;
    }
  | { kind: "cast_free_copy"; cardId: CardInstanceId; playerId: PlayerId }
  | { kind: "deny_extra_turns"; playerId: PlayerId }
  | {
      kind: "divide_into_piles";
      playerId: PlayerId;
      dividerId: PlayerId;
      count: number;
      /** Where the pile the controller takes goes. */
      taken: "hand" | "graveyard";
      /** Where the pile they leave goes. */
      left: "hand" | "graveyard";
    }
  /** Necropotence: exile the top card; it comes to hand at the next end
   * step (the face-down detail and "your" end step are documented
   * approximations). */
  | { kind: "exile_top_to_hand"; playerId: PlayerId }
  /** Living Death: everyone swaps graveyard creatures with board creatures. */
  | { kind: "living_death" }
  /** Springbloom Druid: the sacrifice is auto-taken with the first
   * controlled land (documented approximations) and gates the effects. */
  | {
      kind: "may_sacrifice";
      controllerId: PlayerId;
      what: "land" | "another_creature";
      /**
       * The fodder, picked when the effect BOUND. Disciple of Freyalise
       * reads the sacrificed creature's power, and the inner effects are
       * bound at the same moment — picking again at apply could choose a
       * different creature than the one the numbers came from.
       */
      cardId?: CardInstanceId;
      effects: GameEffect[];
    }
  /** Curse of the Swine: exile each, its controller gets the token. */
  | {
      kind: "exile_targets_into_tokens";
      cardIds: CardInstanceId[];
      token: { name: string; typeLine: string; power: number; toughness: number };
    }
  | { kind: "windfall"; drawCount?: number }
  /** Second Harvest: one copy of every token the player controls. */
  | { kind: "copy_each_token"; playerId: PlayerId }
  /** Wave Goodbye: bounce every creature missing the listed counter. */
  | {
      kind: "bounce_each_creature";
      unlessCounter?: string;
      onlyAttacking?: boolean;
      /** Raise the Palisade: spare creatures of this subtype. */
      exceptSubtype?: string;
    }
  /** Impulse digs: look at the top N, auto-take the first filter match to the
   * destination, rest to the bottom in random order. */
  | {
      kind: "dig_top";
      playerId: PlayerId;
      count: number;
      filter: SearchFilter;
      destination: "hand" | "battlefield" | "battlefield_tapped";
      /** Where the unpicked cards go (default: library bottom). */
      restTo?: "bottom" | "graveyard";
    }
  /** Populate: copy the controller's best creature token (auto-picked). */
  | {
      kind: "exile_top_play";
      playerId: PlayerId;
      casterId: PlayerId;
      untilEndOfNextTurn?: boolean;
      count: number;
      freeCast?: boolean;
      /** Etali, Primal Conqueror: dig until a NONLAND card is exiled rather
       * than taking a fixed count. The lands passed on the way are exiled
       * too but stay uncastable — the card grants "the nonland cards". */
      untilNonland?: boolean;
    }
  /** Charming Prince: exile now, return at the next end step. */
  | {
      kind: "exile_return_end_step";
      cardId: CardInstanceId;
      controllerId: PlayerId;
      /** Parting Gust: the returned card picks up this counter. */
      withCounter?: string;
      /** Nezahal: "Return it to the battlefield TAPPED". */
      returnsTapped?: boolean;
    }
  /** Eerie Interlude: each card returns under its owner's control. */
  | { kind: "exile_return_end_step_all"; cardIds: CardInstanceId[] }
  /** Adapt (CR 701.46): N +1/+1 counters if it has none. */
  | { kind: "adapt"; cardId: CardInstanceId; amount: number }
  | { kind: "populate"; playerId: PlayerId }
  /**
   * Ripples of Potential: "then choose any number of permanents you control
   * that had a counter put on them THIS WAY. Those permanents phase out."
   * That set exists for one instant, inside the proliferate that made it,
   * and no sibling effect can see it — so the phase-out rides the same
   * effect rather than reading a sibling's leavings off the state.
   *
   * "Any number" is a documented AUTO-TAKE, like the proliferate's own
   * choice above it: every permanent it touched phases out.
   */
  | { kind: "proliferate"; playerId: PlayerId; thenPhaseOutTouched?: boolean }
  | {
      kind: "restrict_until_eot";
      cardId: CardInstanceId;
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
    }
  | { kind: "grant_dies_return"; cardId: CardInstanceId; counter?: boolean; treasure?: boolean }
  | { kind: "set_class_level"; cardId: CardInstanceId; level: number }
  | { kind: "pt_until_eot"; cardId: CardInstanceId; power: number; toughness: number }
  | { kind: "keyword_until_eot"; cardId: CardInstanceId; keyword: Keyword }
  /**
   * Mutavault, Destiny Spinner, Nissa: a permanent BECOMES a creature until
   * end of turn. Three continuous effects in one word — the creature type
   * is ADDED (layer 4), so "it's still a land" is true without anyone
   * saying so; the power and toughness are SET (layer 7b), because a land
   * has none to modify; and the keywords are granted (layer 6).
   */
  | {
      kind: "animate_until_eot";
      cardId: CardInstanceId;
      power: number;
      toughness: number;
      /** "an Elemental creature" — creature types, not card types. */
      subtypes?: string[];
      /** "a 1/1 Blinkmoth ARTIFACT creature" — card types beyond creature. */
      types?: string[];
      /** "a 2/1 BLUE Faerie creature" — a land has no colour of its own. */
      colors?: Color[];
      /** Mutavault: "with all creature types". */
      allCreatureTypes?: boolean;
      keywords?: Keyword[];
    }
  | {
      kind: "team_set_pt_until_eot";
      playerId: PlayerId;
      power: number;
      toughness: number;
      /** Mirror Entity: "…and gain all creature types". */
      allCreatureTypes?: boolean;
    }
  | {
      kind: "team_pt_until_eot";
      playerId: PlayerId;
      power: number;
      toughness: number;
      /** Lathliss: "Dragons you control get +1/+0". */
      subtypes?: string[];
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    }
  | {
      kind: "team_keyword_until_eot";
      playerId: PlayerId;
      keyword: Keyword;
      /** Elspeth, Teferi: the grant lasts until this player's NEXT turn. */
      untilYourNextTurn?: boolean;
      scope?: "permanents";
      /** Lord of the Accursed: "All Zombies gain menace". */
      subtypes?: string[];
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    }
  | { kind: "team_protection_until_eot"; playerId: PlayerId; colors: Color[] }
  /** "Target creature gains protection from red until end of turn." */
  | { kind: "protection_until_eot"; cardId: CardInstanceId; colors: Color[] }
  | { kind: "hexproof_from_until_eot"; cardId: CardInstanceId; colors: Color[] }
  /** Veil of Summer: the player AND their permanents, in one effect —
   * both halves of one sentence, so neither can be dropped alone. */
  | {
      kind: "team_hexproof_from_until_eot";
      playerId: PlayerId;
      colors: Color[];
      includePlayer?: boolean;
    }
  | { kind: "spells_uncounterable_this_turn"; playerId: PlayerId }
  | {
      kind: "all_pt_until_eot";
      power: number;
      toughness: number;
      /** Crippling Fear: spare creatures of this subtype. */
      exceptSubtype?: string;
    }
  /**
   * Sundering Eruption: "creatures without flying can't block this turn" —
   * every creature on the battlefield, filtered by a keyword it lacks.
   */
  | {
      kind: "all_restrict_until_eot";
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
      withoutKeyword?: Keyword;
      withKeyword?: Keyword;
    }
  | {
      kind: "grant_next_spell";
      playerId: PlayerId;
      improvise?: boolean;
      cantBeCountered?: boolean;
    }
  | { kind: "reveal_top_put_permanent"; playerId: PlayerId }
  | { kind: "drain_opponents"; playerId: PlayerId; amount: number }
  | { kind: "silence"; playerId: PlayerId }
  | { kind: "silence_noncreature"; playerId: PlayerId }
  | { kind: "each_creature_damages_controller"; amount: number }
  | { kind: "double_team_pt_until_eot"; playerId: PlayerId }
  | { kind: "power_nova"; sourceId: CardInstanceId; amount: number }
  | {
      kind: "retarget";
      stackObjectId: StackObjectId;
      controllerId: PlayerId;
      /**
       * Hydroelectric Specimen: "change the target … TO THIS CREATURE". The
       * new target is named by the card, so there is nothing to prompt for —
       * and the redirect is refused outright when this object is not a legal
       * target for the slot, rather than silently leaving the spell pointed
       * where it was and reporting success.
       */
      toCardId?: CardInstanceId;
    }
  /**
   * Discover N (CR 702.163) and cascade (CR 702.85), which are the same
   * walk: exile from the top of the library until a NONLAND card with a
   * small enough mana value turns up, then the rest go to the bottom in a
   * random order.
   *
   * The two differ only in the bound `maxManaValue` and in what may be done
   * with the card found, so they are one effect rather than two.
   */
  | {
      kind: "discover";
      playerId: PlayerId;
      /** Inclusive. Cascade binds this to the source's mana value minus one. */
      maxManaValue: number;
      /**
       * Discover may take the card to hand instead of casting it; cascade
       * may not. See the apply path for which branch is taken and why.
       */
      toHandAllowed?: boolean;
    }
  /**
   * "Reveal cards from the top of your library until you reveal a creature
   * card. Put that card onto the battlefield and the rest on the bottom of
   * your library in a random order."
   *
   * The same walk `discover` does, with the stop generalised from cascade's
   * hard-wired "nonland card cheap enough" to a `SearchFilter` — which is
   * what brings the mana-value caps along without a second field — and both
   * destinations spelled out, because the cards disagree about them: the
   * rest go to the bottom, or to the graveyard, or into exile.
   *
   * Running out of library is not a failure. Everything revealed goes to
   * `rest` and nothing is found, which is what the printed cards say.
   */
  | {
      kind: "dig_until";
      playerId: PlayerId;
      filter: SearchFilter;
      found: "hand" | "battlefield" | "battlefield_tapped" | "graveyard" | "exile";
      rest: "library_bottom_random" | "library_bottom" | "graveyard" | "exile";
      /** "You MAY put that card onto the battlefield" (Hei Bai). */
      optional?: boolean;
    }
  /** Push the "any number of cards from your hand" prompt. */
  | {
      kind: "choose_from_hand";
      playerId: PlayerId;
      destination: "library_bottom" | "battlefield";
      types?: string[];
      thenDrawPlus?: number;
    }
  /** High Tide: a mana echo that lives for the turn, not on a permanent. */
  | {
      kind: "add_turn_mana_echo";
      echo: NonNullable<CardDefinition["landTapEcho"]>;
    }
  /** Portal to Phyrexia: the reanimated card gains a creature type. */
  | { kind: "add_subtypes"; cardId: CardInstanceId; subtypes: string[] }
  /**
   * Breach the Multiverse: "each creature you control becomes a Phyrexian
   * in addition to its other types". A whole board rather than one
   * permanent, and like `add_subtypes` it rides the instances — the spell
   * is gone, so there is nothing left to carry a continuous effect.
   */
  | { kind: "add_subtypes_all"; playerId: PlayerId; what: "creature"; subtypes: string[] }
  /** Regenerate (CR 701.15): a shield against the next destruction. */
  | { kind: "regenerate"; cardIds: CardInstanceId[] }
  /**
   * Liliana's -9: "chooses a permanent they control of each permanent type
   * and sacrifices THE REST". The choice names what to KEEP, which is the
   * inverse of every other "of their choice" sacrifice here, so the
   * keeper rides the effect and everything else of that type goes.
   */
  | {
      kind: "ban_attacks_while_counter";
      counter: string;
      playerId: PlayerId;
    }
  | {
      kind: "sacrifice_others_of_type";
      playerId: PlayerId;
      cardType: string;
      /** The one the player chose to keep; null when they control none. */
      keepId: CardInstanceId | null;
    }
  | { kind: "mass_reanimate"; playerId: PlayerId }
  /** Splendid Reclamation: every land card in YOUR graveyard returns tapped. */
  | { kind: "return_all_lands"; playerId: PlayerId }
  | { kind: "prevent_combat_for"; cardId: CardInstanceId }
  | { kind: "extra_land_drop"; playerId: PlayerId }
  /** "You win the game": every other player loses (CR 104.2a). */
  | {
      kind: "win_game";
      playerId: PlayerId;
      /**
       * Mechanized Production: "if you control eight or more artifacts with
       * the same name as one another". Carried to APPLY rather than settled
       * at bind, because the token this very ability creates is one of the
       * eight — effects bind as a batch, so a bind-time count is always one
       * short.
       */
      ifSameNameCount?: { type: string; atLeast: number };
    }
  /** "You lose the game" (Pact of Negation's unpaid upkeep). */
  | { kind: "lose_game"; playerId: PlayerId }
  /** Teferi's Protection, The One Ring: a shield until your next turn. */
  | {
      kind: "grant_player_shield";
      playerId: PlayerId;
      protectionFromEverything?: boolean;
      lifeLocked?: boolean;
    }
  /** Park a delayed triggered ability on a future step (CR 603.7). */
  | {
      kind: "delayed_trigger";
      controllerId: PlayerId;
      step: "upkeep" | "first_main_phase";
      whose: "controller" | "any";
      effects: GameEffect[];
      sourceId: CardInstanceId | null;
    }
  /** Emergence Zone: the player may cast at instant speed this turn. */
  | { kind: "grant_flash_this_turn"; playerId: PlayerId }
  /** Sea Gate Restoration: no maximum hand size, for the rest of the game. */
  | { kind: "grant_no_max_hand_size"; playerId: PlayerId }
  /** Rishkar's Expertise: one free cast from hand, capped by mana value. */
  | { kind: "grant_free_cast_from_hand"; playerId: PlayerId; maxManaValue?: number; count: number }
  | { kind: "commander_to_hand"; playerId: PlayerId }
  | {
      kind: "opponents_lose_keywords_until_eot";
      playerId: PlayerId;
      keywords: Keyword[];
      /** Arcane Lighthouse: CREATURES, where Shadowspear says permanents. */
      creaturesOnly?: boolean;
      /** Arcane Lighthouse: "…and can't HAVE hexproof or shroud". */
      alsoLock?: boolean;
    }
  | {
      kind: "search_library";
      playerId: PlayerId;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
      untapIfLands?: number;
      /** Archdruid's Charm: a land found this way goes to the battlefield
       * tapped, and everything else takes `destination`. */
      landsToBattlefieldTapped?: boolean;
      /** Finale of Devastation: the graveyard is part of the pool. */
      alsoGraveyard?: boolean;
    }
  | { kind: "attach"; cardId: CardInstanceId; toId: CardInstanceId }
  | { kind: "transform"; cardId: CardInstanceId }
  | {
      kind: "copy_token";
      ownerId: PlayerId;
      ofCardId: CardInstanceId;
      count?: number;
      gainsHaste?: boolean;
      atEndStep?: "sacrifice" | "exile";
      /** Myriad: the token enters tapped and attacking THIS player. */
      attackingPlayerId?: PlayerId;
      /** Myriad: exiled when combat ends, not at the end step. */
      atEndCombat?: "exile";
      setPt?: { power: number; toughness: number };
      /**
       * Saw in Half: make the copies only if the creature really died —
       * checked here, at apply, because a destruction can be replaced.
       */
      onlyIfDied?: boolean;
      /** Eternalize: the copy is black and a Zombie on top of its own types. */
      setColors?: Color[];
      addSubtypes?: string[];
      /** Helm of the Host: "except the token isn't legendary". */
      notLegendary?: boolean;
    }
  | { kind: "manifest"; playerId: PlayerId; count: number }
  | {
      kind: "counter_on_controlled_creatures";
      playerId: PlayerId;
      counter: string;
      amount: number;
    }
  | {
      kind: "counter_on_each_creature";
      counter: string;
      amount: number;
      /** Avenger of Zendikar: only the listed subtype under this controller. */
      subtype?: string;
      controllerId?: PlayerId;
      /** Archfiend of Ifnir: everyone EXCEPT this player. */
      opponentsOf?: PlayerId;
      /** Oran-Rief, the Vastwood: "each GREEN creature". Read computed, so a
       * creature made green by a static qualifies. */
      colors?: Color[];
      /** Oran-Rief: "…that entered this turn". Compared against
       * `turn.startTimestamp`, so tokens made this turn count too. */
      enteredThisTurn?: boolean;
    }
  | {
      kind: "overload_each";
      controllerId: PlayerId;
      sourceId: CardInstanceId | null;
      requirement: TargetRequirement;
      effects: CardEffect[];
    }
  /** Board wipes: destroy every battlefield permanent of the scope at once. */
  | {
      kind: "destroy_all";
      what: DestroyAllScope;
      /** Nevinyrral's Disk: any of these types, swept as one batch. */
      typesAny?: string[];
      /** Split Up: only tapped, or only untapped, permanents. */
      tapState?: "tapped" | "untapped";
      /** Damning Verdict: "with no counters on them". */
      withoutCounters?: boolean;
      /** Winds of Rath: "that aren't enchanted". */
      notEnchanted?: boolean;
      /** Urza's Ruinous Blast: "that aren't legendary". */
      notLegendary?: boolean;
      /** Hour of Reckoning: "nontoken" — the tokens survive. */
      nontoken?: boolean;
      /** All Is Dust: "that are one or more colors" — colourless survives. */
      coloredOnly?: boolean;
      /** All Is Dust: a SACRIFICE, so indestructible does not save. */
      asSacrifice?: boolean;
      /** Damnation: "They can't be regenerated" — shields do not apply. */
      denyRegeneration?: boolean;
      /** Urza's Ruinous Blast exiles rather than destroying. */
      toZone?: "exile";
      maxManaValue?: number;
      minManaValue?: number;
      /** Elspeth: only creatures with computed power at least this. */
      minPower?: number;
      /** Kindred Dominance: spare permanents of this subtype. */
      exceptSubtype?: string;
      /** Crux of Fate: destroy ONLY permanents of this subtype. */
      onlySubtype?: string;
      /** Organic Extinction: a card type the swept permanent must NOT have. */
      exceptTypes?: string[];
      /** Ruinous Ultimatum: only permanents this player does NOT control. */
      opponentsOf?: PlayerId;
      /** Culling Ritual: this player gets one mana of this color per
       * permanent destroyed by the sweep. */
      addManaPerDestroyed?: ManaColor;
      manaTo?: PlayerId;
      /** Fumigate: life for each permanent the sweep took. */
      gainLifePerDestroyed?: number;
      lifeTo?: PlayerId;
      /** Bane of Progress: a counter on the source per permanent taken. */
      counterPerDestroyed?: { cardId: CardInstanceId; counter: string; amount: number };
    }
  /** Rhystic Study: the payer chooses to pay or the effects happen. */
  | {
      kind: "unless_pays";
      playerId: PlayerId;
      cost: string;
      /** Sylvan Library: "pay 4 life or …". Paid from life, not mana. */
      life?: number;
      effects: GameEffect[];
    }
  /** Cumulative upkeep (CR 702.24), bound to its permanent. */
  | {
      kind: "cumulative_upkeep";
      playerId: PlayerId;
      cardId: CardInstanceId;
      cost: string;
    }
  /** Echo (CR 702.29): the same pay-or-sacrifice, owed exactly once. */
  | {
      kind: "echo";
      playerId: PlayerId;
      cardId: CardInstanceId;
      cost: string;
    }
  /**
   * The Gitrog Monster: "sacrifice ~ unless you sacrifice a land". The
   * pay-or-effect prompt speaks mana and life, not permanents, so the choice
   * is auto-taken: feed it a land if there is one, otherwise let it go.
   *
   * A documented approximation, and the one a player makes nearly always —
   * the land sacrifice is the ENGINE the card is played for. The land is
   * picked cheapest-first, like every other auto-picked fodder here.
   */
  | {
      kind: "sacrifice_unless_sacrifice";
      playerId: PlayerId;
      cardId: CardInstanceId;
      scope: "land";
    }
  /** "You may pay {N}. If you do, …" — paying causes the effects. */
  /** `cost` may be empty and `life` set, or both — Ripples of Undeath asks
   * for "{1} and 3 life", which is one optional cost with two halves. */
  | {
      kind: "may_pay";
      playerId: PlayerId;
      cost: string;
      life?: number;
      effects: GameEffect[];
      /**
       * Springheart Nantuko: "if this permanent is attached to a creature
       * you control" — resolved at BIND, where the source is known, into
       * whether the offer happens at all. With no host there is no offer,
       * and not offering is one of the two ways not to pay, so the
       * else-branch still runs.
       */
      hostMissing?: boolean;
      /**
       * "If you didn't create a token this way…" — one branch covering
       * both ways not to: declining, and having nothing to attach to.
       */
      elseEffects?: GameEffect[];
    }
  /** Blasphemous Act: damage every creature (and optionally player) at once. */
  | {
      kind: "damage_all";
      sourceId: CardInstanceId | null;
      amount: number;
      includePlayers?: boolean;
    }
  /** Ephemerate: exile a permanent and return it immediately (re-enters fresh). */
  | { kind: "flicker"; cardId: CardInstanceId }
  /** Enduring cycle: a dead creature-enchantment returns as a pure
   * enchantment (a cloned definition without the creature type). */
  | { kind: "return_self_as_enchantment"; cardId: CardInstanceId }
  /** Elspeth's ultimate: a permanent-less static carrier owned by a player.
   * Modeled as an indestructible-by-scope battlefield object (documented). */
  | { kind: "create_emblem"; ownerId: PlayerId; statics: StaticAbility[] }
  /** Living weapon: create a 0/0 black Phyrexian Germ, attach source to it. */
  | { kind: "germ_attach"; cardId: CardInstanceId }
  /** Ancient Copper Dragon: roll a die, create that many Treasures. */
  | { kind: "roll_die_treasures"; playerId: PlayerId; sides: number }
  /** Bojuka Bog: every card in the player's graveyard is exiled. */
  | { kind: "exile_graveyard"; playerId: PlayerId }
  /** Mother of Runes: the chooser picks a protection color at resolution. */
  | { kind: "grant_protection_choice"; cardId: CardInstanceId; playerId: PlayerId }
  /** CR 701.12: each deals damage equal to its power to the other. */
  | { kind: "fight"; cardId: CardInstanceId; otherId: CardInstanceId };

/** What a "Destroy all …" wipe hits. */
export type DestroyAllScope =
  | "creatures"
  | "artifacts"
  | "enchantments"
  | "planeswalkers"
  | "nonland"
  /** All Is Dust: lands included. */
  | "permanents";

/** What a characteristic-defining P/T counts, relative to the controller. */
/** What a mass control change moves. */
export type ControlAllScope = "creatures" | "artifacts" | "permanents";

export type DynamicCount =
  | "lands_you_control"
  | "creatures_you_control"
  | "artifacts_you_control"
  | "enchantments_you_control"
  | "artifacts_and_enchantments_you_control"
  | "cards_in_your_hand"
  | "cards_in_your_graveyard"
  /** Wight of the Reliquary. */
  | "creature_cards_in_your_graveyard"
  /** Faeburrow Elder: colours among permanents you control, not permanents. */
  | "colors_among_permanents_you_control"
  /** Tomb of the Spirit Dragon. */
  | "colorless_creatures_you_control"
  /** Inspiring Call. */
  | "creatures_you_control_with_a_counter"
  /** Kor Spiritdancer — counted on the source, not the controller. */
  | "auras_attached_to_it"
  /** Thran Power Suit. */
  | "auras_and_equipment_attached_to_it"
  /** Strength of the Harvest: "and/or", so a card that is both counts once. */
  | "creatures_and_enchantments_you_control"
  /** Sage's Reverie — your Auras, wherever they are attached. */
  | "auras_you_control_attached_to_a_creature"
  | "legendary_creatures_you_control"
  /** Embercleave. */
  | "attacking_creatures_you_control"
  | "permanents_you_control"
  /** Defile: a basic land TYPE, not a name — a Swamp is anything with the
   * subtype, so Urborg's handiwork counts. */
  | "plains_you_control"
  | "islands_you_control"
  | "swamps_you_control"
  | "mountains_you_control"
  | "forests_you_control"
  /** Fists of Flame. A TALLY, not a hand count: cards drawn and then
   * discarded still counted, and the draw that is part of the same spell
   * has already happened by the time the count is read. */
  /** Moraug: attacks made by the AFFECTED card this turn — the layer
   * engine passes that card as the source, which is what lets one static
   * give a different bonus to each creature. */
  | "times_it_has_attacked_this_turn"
  | "cards_drawn_this_turn"
  /**
   * Coat of Arms: "each OTHER creature on the battlefield that shares at
   * least one creature type with it". Counted against the AFFECTED object,
   * the way `auras_attached_to_it` is — "it" is what the ability touches,
   * not the permanent the ability came from.
   *
   * Changelings are every creature type (CR 702.73), so one on either side
   * of the comparison shares with anything that has a creature type at all.
   */
  | "creatures_sharing_a_type_with_it"
  /** Shared Animosity: the same count, narrowed to the ones attacking. */
  | "attacking_creatures_sharing_a_type_with_it"
  /**
   * Earthshaker Dreadmaw: "for each (other) <subtype> you control" — a
   * parameterized creature-subtype count. The one object member of this
   * union; `excludeSelf` drops the source (the "other" in "other Dinosaur").
   */
  | { kind: "controlled_subtype"; subtype: string; excludeSelf?: boolean };

/** "As an additional cost to cast this spell, …" — paid at cast time. */
/**
 * "Spend this mana only to …" (CR 106.6). Mana produced under a restriction
 * sits in its own pool and can only pay for things this filter admits.
 *
 * `chosenSubtype` reads the producing permanent's as-enters creature-type
 * choice (Cavern of Souls), which is why the restriction records the source
 * that made the mana rather than a fixed subtype.
 */
export type ManaRestriction = {
  /**
   * Path of Ancestry: this tag does not restrict anything — the mana pays
   * for whatever its owner likes. It rides the tagged pool only so that a
   * rider can watch it being spent, so it must admit every purpose, and
   * even an unknown one.
   */
  unrestricted?: boolean;
  /**
   * Path of Ancestry: "…that shares a creature type with your commander".
   * Read against the commanders, so it is evaluated where state is in
   * hand rather than inside the purpose test.
   */
  sharesCreatureTypeWithCommander?: boolean;
  /** The spell or ability's source must have all of these card types. */
  types?: string[];
  /** …and this creature subtype, taken from the producer's chosen type. */
  chosenSubtype?: boolean;
  /** …and this literal subtype (Eldrazi Temple). */
  subtype?: string;
  /**
   * Throne of Eldraine: "…only to cast MONOCOLORED spells of that color".
   * Two conditions in one phrase and both are about the spell's colours
   * rather than its types — exactly one colour, and that colour the one
   * the producer chose as it entered.
   */
  monocoloredChosenColor?: boolean;
  /** …and be legendary (Delighted Halfling). */
  legendary?: boolean;
  /** Opal Palace: "…to cast your commander". Only ever a rider condition,
   * never a restriction — the Palace's mana pays for anything. */
  commanderSpell?: boolean;
  /** …and have no colours (Eldrazi Temple). */
  colorless?: boolean;
  /** May it also pay for activated abilities of matching permanents? */
  allowsAbilities?: boolean;
};

/**
 * Path of Ancestry: an effect that fires when this mana is SPENT on a
 * matching purpose. Distinct from a restriction — the mana pays for
 * anything; `when` only decides whether the rider fires.
 */
export type ManaRider = {
  when: ManaRestriction;
  effects: CardEffect[];
};

/** Restricted mana in a player's pool, tagged with what it may pay for. */
export type RestrictedMana = {
  color: ManaColor;
  amount: number;
  restriction: ManaRestriction;
  /** The permanent that produced it, for `chosenSubtype` lookups. */
  sourceId: CardInstanceId;
  /** Path of Ancestry: "When that mana is spent to cast …". */
  rider?: ManaRider;
};

export type AdditionalCastCost = {
  /** Sacrifice one permanent of this scope. */
  sacrifice?: "creature" | "artifact" | "creature_or_artifact" | "land";
  /** Natural Order: "sacrifice a GREEN creature". A narrowing of
   * `sacrifice`, never a cost on its own — it is read only where that
   * scope is, and the colour is the permanent's CURRENT one, so a
   * creature made green by a static pays the cost. */
  sacrificeColor?: Color;
  /** Discard this many cards. */
  discard?: number;
  /** Pay this much life. */
  life?: number;
  /** Redirect Lightning: "pay 5 life OR pay {2}" — a mana branch, which only
   * ever appears inside `alternatives`. Added to the spell's cost. */
  mana?: string;
  /** "Pay X life" — the announced X feeds the spell's "x" amounts (Toxic Deluge). */
  lifeX?: boolean;
  /**
   * "…sacrifice an artifact OR discard a card": exactly one branch is paid.
   * The caster's choice is read from what the cast action supplied — a
   * sacrifice id picks the sacrifice branch, discard ids the discard branch,
   * neither the remaining one — so no extra prompt or action field is needed.
   * When nothing distinguishes them, the first affordable branch is taken and
   * that is a documented auto-pick.
   */
  alternatives?: AdditionalCastCost[];
};

/** A static generic-cost discount on spells the controller casts. */
export type CostReduction = {
  /** Generic mana off the cost. NEGATIVE is a tax (Grand Arbiter, Defense
   * Grid) — the caller floors the total at zero either way. */
  generic: number;
  /** Whose spells this touches, from the holder's side. Defaults to "you";
   * "opponents" is the tax shape, "all" the symmetric one (Helm of Awakening). */
  scope?: "you" | "opponents" | "all";
  /** Defense Grid: "except during its controller's turn". */
  notDuringControllersTurn?: boolean;
  /** Bolt Bend: "…less to cast IF you control a creature with power 4 or
   * greater". The same condition vocabulary trigger heads and activation
   * gates use. */
  condition?: TriggerCondition;
  /** Empty filter means every spell. types all required; typesAny needs one; colors any overlap.
   * chosenSubtype: the spell must have the source's chosen creature type. */
  filter: {
    types?: string[];
    typesAny?: string[];
    subtypesAny?: string[];
    colors?: Color[];
    chosenSubtype?: boolean;
    /** Cloud Key: the spell must have the source's chosen CARD type. */
    chosenCardType?: boolean;
    /** Goreclaw: the creature spell's printed power must be at least this. */
    minPower?: number;
  };
};

export type EffectTarget =
  | { type: "player"; playerId: PlayerId }
  | { type: "creature"; cardId: CardInstanceId };

export type TargetKind =
  | "player"
  | "opponent"
  | "creature"
  | "own_creature"
  | "permanent"
  | "creature_or_planeswalker"
  | "artifact"
  | "enchantment"
  | "artifact_or_enchantment"
  | "creature_or_artifact"
  | "creature_or_enchantment"
  | "creature_enchantment_or_planeswalker"
  | "creature_enchantment_or_planeswalker"
  | "nonland_permanent"
  | "noncreature_nonland_permanent"
  /** A card in the caster's own graveyard (Regrowth / Zombify recursion). */
  | "own_graveyard_card"
  | "own_graveyard_creature_card"
  | "own_graveyard_permanent_card"
  | "own_graveyard_artifact_card"
  /** Hall of Heliod's Generosity. */
  | "own_graveyard_enchantment_card"
  /** Titania: "target land card in your graveyard". */
  | "own_graveyard_land_card"
  | "own_graveyard_instant_or_sorcery_card"
  /** Takenuma: "a creature or planeswalker card in your graveyard". */
  | "own_graveyard_creature_or_planeswalker_card"
  /** Takenuma: "a creature or planeswalker card in your graveyard". */
  | "own_graveyard_creature_or_planeswalker_card"
  /** A creature card in ANY graveyard (Reanimate). */
  | "graveyard_creature_card"
  /** Any card in ANY graveyard (Noxious Revival). */
  | "graveyard_card"
  /** "two target artifacts, creatures, and/or lands" (Ghostly Flicker). */
  | "artifact_creature_or_land"
  | "nonartifact_creature"
  | "land"
  /** Boseiju, Who Endures. */
  | "artifact_enchantment_or_nonbasic_land"
  /** Acidic Slime: "target artifact, enchantment, or land". */
  | "artifact_enchantment_or_land"
  /** Mirage Mirror: every permanent type it can turn into. */
  | "artifact_creature_enchantment_or_land"
  /** Strix Serenade. */
  | "artifact_creature_or_planeswalker_spell"
  /** Fracture: "target artifact, enchantment, or planeswalker". */
  | "artifact_enchantment_or_planeswalker"
  /** Bedevil. */
  | "artifact_creature_or_planeswalker"
  /** Casualties of War's fifth bullet. */
  | "planeswalker"
  /** A commander creature on the battlefield (Witch's Clinic). */
  | "commander"
  | "player_or_creature"
  /** "target player or planeswalker" (Boros Charm). */
  | "player_or_planeswalker"
  | "spell"
  | "creature_spell"
  | "noncreature_spell"
  /** Dispel: instants only. */
  | "instant_spell"
  | "instant_or_sorcery_spell"
  /** Swan Song. */
  | "enchantment_instant_or_sorcery_spell"
  /** Venser, Shaper Savant. */
  | "spell_or_permanent"
  /**
   * Spellskite: "target spell or ability". An ability on the stack is an
   * object like any other (CR 113.7), and half the reason Spellskite sees
   * play is stopping targeted ABILITIES — a kind narrowed to spells would
   * compile clean and play wrong.
   */
  | "spell_or_ability"
  /** Strionic Resonator: "target triggered ability you control". */
  | "triggered_ability_you_control"
  /**
   * Return the Favor: "target instant spell, sorcery spell, activated
   * ability, or triggered ability". `spell_or_ability` is one step too
   * wide — it would let the copy take a creature spell, which the card
   * does not offer.
   */
  | "instant_sorcery_or_ability";

export type TargetRequirement = {
  kind: TargetKind;
  /** "any number of targets": 1..N chosen targets all matching this kind. */
  variable?: boolean;
  /** "up to two other targets": this trailing slot may be left unfilled;
   * chosen targets must be distinct when optional slots are present. */
  optional?: boolean;
  /** "target nonblack creature": these colors are illegal. */
  excludeColors?: Color[];
  /** "you don't control" (Cyclonic Rift) / "you control" (Ephemerate). */
  control?: "own" | "not_own";
  /** "with mana value N or less" (Abrupt Decay). */
  maxManaValue?: number;
  /**
   * Agadeem's Awakening: "mana value X or less", where X is the value
   * announced for the spell. A separate flag from `maxManaValue` because
   * the bound is not known until the spell is cast.
   */
  maxManaValueX?: boolean;
  /**
   * Ruthless Technomancer: "with power X or less", where X is the announced
   * value (here the number of artifacts sacrificed as the cost). Checked
   * against xValue at target validation, the same place maxManaValueX is.
   */
  maxPowerX?: boolean;
  /**
   * Agadeem's Awakening: "that each have a DIFFERENT mana value". A
   * constraint ACROSS the chosen targets rather than on any one of them,
   * so it is checked where the whole set is in hand — and it is most of
   * the card, since without it the spell returns a graveyard full of
   * one-drops.
   */
  distinctManaValues?: boolean;
  /** "with mana value N or greater" (Despark). */
  minManaValue?: number;
  /** "with power N or less" (Escape Tunnel). */
  maxPower?: number;
  /** "with power N or greater" (Herd Heirloom). */
  minPower?: number;
  /** "target multicolored spell" / "…permanent" (Null Elemental Blast): two
   * or more colors. Distinct from `requiredColors`, which names them. */
  multicolored?: boolean;
  /** "target nonbasic land" (Wasteland). */
  nonbasicOnly?: boolean;
  /** Caretaker's Talent: "target token you control". */
  tokenTargetOnly?: boolean;
  /**
   * Scrap Trawler: "with LESSER mana value" — lesser than the artifact that
   * just died, which is the trigger's subject. Resolved to a concrete
   * `maxManaValue` where the trigger asks for targets, the only place that
   * subject is known.
   */
  manaValueBelowSubject?: boolean;
  /**
   * The Mycosynth Gardens: "with mana value X" — EXACTLY the announced X,
   * not a cap. Resolved into a matching min/max pair where the ability goes
   * on the stack, which is the only place the announced value is known.
   */
  manaValueEqualsX?: boolean;
  /** "target nontoken artifact you control" (The Mycosynth Gardens). */
  nonTokenOnly?: boolean;
  /** "target legendary creature" (Shizo). */
  legendaryOnly?: boolean;
  /** Commander's Plate: "Equip commander" — only YOUR commander. */
  commanderOnly?: boolean;
  /** "Enchant Forest": the target must have every listed subtype. */
  /**
   * Swarmyard: "target Insect, Rat, Spider, or Squirrel" — ANY of these
   * subtypes matches, where `requiredSubtypes` demands all of them.
   */
  requiredSubtypesAny?: string[];
  /**
   * Deathrite Shaman: "target LAND card from a graveyard", "target INSTANT
   * OR SORCERY card". ANY of these card types matches. A filter rather than
   * another `..._card` union member, because the graveyard family already
   * spells eight of those out and each one has to be handled by hand.
   */
  requiredTypesAny?: string[];
  /**
   * Siren Stormtamer: "target spell or ability THAT TARGETS YOU OR A
   * CREATURE YOU CONTROL". A constraint on the stack object's own targets,
   * not on the object itself — and the whole card, since without it the
   * Siren counters anything at all.
   */
  targetsYouOrYours?: boolean;
  requiredSubtypes?: string[];
  /** "target blue spell" / "target blue permanent" (Red Elemental Blast). */
  requiredColors?: Color[];
  /** "target attacking creature" (Maze of Ith). */
  attackingOnly?: boolean;
  /** "target attacking or blocking creature" (Razorgrass Ambush). A
   * separate flag rather than a widening of `attackingOnly`, because Maze
   * of Ith must keep refusing blockers. */
  attackingOrBlockingOnly?: boolean;
  /**
   * Hydroelectric Specimen: "target instant or sorcery spell WITH A SINGLE
   * TARGET". A spell pointing at two things cannot be redirected by it, and
   * one pointing at nothing has no target to change.
   */
  singleTargetOnly?: boolean;
  /** "another target …": the effect's own source is not a legal target. */
  excludeSource?: boolean;
  /** "target non-Dragon creature card" (Junji): none of these subtypes. */
  excludedSubtypes?: string[];
  /** "target noncreature artifact" (Haywire Mite): none of these card types. */
  excludedTypes?: string[];
  /** "target creature you own" (Charming Prince): owner must be the caster. */
  owner?: "own";
  /** "target nontoken creature" (Parting Gust). */
  nontoken?: boolean;
  /** "target nonlegendary creature card" (Persist). */
  nonlegendaryOnly?: boolean;
};

/** One bullet of a modal spell. Targets are chosen for the picked mode only. */
export type SpellMode = {
  label: string;
  /** Kicker-style modes: extra mana paid when this mode is chosen. */
  extraCost?: string;
  /**
   * Damn: an overload cost whose coloured pips differ from the printed
   * ones ({1}{B}{B} printed, Overload {2}{W}{W}). It REPLACES the cost
   * rather than adding to it — an extra cost cannot express a different
   * colour, and treating it as one would let a mono-black caster
   * overload a white spell.
   */
  replacesCost?: string;
  /** Dash: the permanent enters hasty and bounces at the next end step. */
  dash?: boolean;
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
};

/** A planeswalker loyalty ability ("+1:", "-3:"). */
export type LoyaltyAbility = {
  cost: number;
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
};

export type ChosenTarget =
  | { type: "player"; playerId: PlayerId }
  | { type: "creature"; cardId: CardInstanceId }
  | { type: "spell"; stackObjectId: StackObjectId };

export type ChosenTargetRef = { type: "chosen"; index: number };

/**
 * `"all_chosen"` is Agadeem's Awakening: a VARIABLE target requirement can
 * be satisfied by any number of cards, and an effect naming `chosen 0`
 * would move only the first of them. It expands to one effect per chosen
 * target where the batch is bound.
 */
export type CardIdSelector = CardInstanceId | ChosenTargetRef;

/**
 * Relative player used in untargeted CardDefinition effects.
 * Targeted spells use ChosenTargetRef instead of next_opponent.
 */
/**
 * `each_other_opponent` is Kediss: the opponents OTHER than the one the
 * trigger's subject event was about. It is a separate member rather than a
 * flag on `each_opponent`, because the two differ in whether they need a
 * subject at all — expanding it without one is a bug, not a default.
 */
export type RelativePlayer =
  | "controller"
  | "next_opponent"
  | "each_opponent"
  | "each_other_opponent"
  | "each_player"
  /**
   * Annihilator (CR 702.85): the player the source is attacking. The
   * `attacks` event carries only the attacker, so this is read off the
   * COMBAT RECORD at bind — which is also what makes it right in a
   * multiplayer game, where "the defending player" is one of three.
   */
  | "defending_player"
  /**
   * Kozilek: "its OWNER shuffles their graveyard". Owner, not controller —
   * a card stolen and then killed still shuffles into the library of the
   * player who brought it, and `controllerId` is not reset on a zone
   * change, so the two really do come apart.
   */
  | "source_owner"
  /** Curses: the player this Aura is attached to. Read off the SOURCE at
   * bind, which is why a Curse whose host has left the game binds to
   * nobody and its effects simply do not happen. */
  | "enchanted_player"
  /**
   * Curse of Opulence: "each opponent attacking that player does the same".
   * Only one player attacks in a combat, so this is that player — when
   * they are an opponent of the Curse's controller, and nobody when the
   * controller is the one attacking.
   */
  | "attacking_opponent";
/** The controller of the Nth chosen target (Beast Within). */
export type ChosenControllerRef = { type: "chosen_controller"; index: number };
/** The owner of the Nth chosen target (Chaos Warp). */
export type ChosenOwnerRef = { type: "chosen_owner"; index: number };
/** "That player": the trigger event's subject player, or the subject card's controller. */
export type SubjectPlayerRef = { type: "subject_player" };
export type PlayerSelector =
  | PlayerId
  | RelativePlayer
  | ChosenTargetRef
  | ChosenControllerRef
  | ChosenOwnerRef
  | SubjectPlayerRef;

export type CardEffectTarget =
  | { type: "player"; playerId: PlayerSelector }
  | { type: "creature"; cardId: CardInstanceId }
  | ChosenTargetRef;

/**
 * Definition-stored effect data. Bound to concrete GameEffect values on resolve.
 */
export type CardEffect =
  | {
      /**
       * CR 122 / 104.3c. Poison counters are not life: nothing gains them
       * back, no replacement effect in this engine touches them, and ten
       * of them end the game. The only way to get one before this was
       * infect combat damage, which is why 86 printed cards that hand them
       * out directly had nowhere to compile to.
       */
      kind: "add_poison";
      playerId: PlayerSelector;
      /** "That many" — the damage the trigger just carried (Etali, Primal
       * Sickness), read from the trigger subject at bind. */
      amount: number | "subject_amount";
    }
  | {
      kind: "gain_life";
      playerId: PlayerSelector;
      /** target_power: the first chosen target's computed power at bind
       * (Swords to Plowshares — read before the exile applies). */
      /** sacrificed_power: Disciple of Bolas — the fodder's power, read
       * before the sacrifice that is about to happen. */
      amount:
        | number
        | "subject_amount"
        | "subject_toughness"
        | "target_power"
        /** Noxious Gearhulk: the chosen target's toughness, read at bind —
         * before the destruction the sibling effect is about to do. */
        | "target_toughness"
        | "sacrificed_power";
      /** Shamanic Revelation's ferocious half: multiply the amount by the
       * controller's creatures matching the filter, at bind. */
      perControlledCreature?: { minPower?: number };
      /** Aetherflux Reservoir: multiply by the controller's casts this turn. */
      perSpellsCastThisTurn?: boolean;
      /** Venser's Journal: multiply by a shared dynamic count at bind. */
      perDynamicCount?: DynamicCount;
    }
  | {
      kind: "lose_life";
      playerId: PlayerSelector;
      /** target_mana_value: the first chosen target's mana value (Reanimate). */
      /** source_power: Marionette Master — the power of the ability's own
       * source, read at bind. */
      /** own_life_lost_this_turn: Wound Reflection — the life the BOUND
       * player has lost this turn, so an each-opponent expansion gives each
       * of them their own number rather than one shared total. */
      /** sacrificed_power: Jarad — the fodder's power, captured as the
       * activation cost is paid. */
      amount:
        | number
        | "subject_amount"
        | "target_mana_value"
        | "source_power"
        | "own_life_lost_this_turn"
        | "sacrificed_power";
      /** Castle Locthwain: "life equal to the number of cards in your hand" —
       * the same count table gain_life and draw already scale by. */
      perDynamicCount?: DynamicCount;
      /** The One Ring: "1 life for each burden counter on ~". */
      perCounterOnSource?: string;
    }
  | {
      kind: "deal_damage";
      /** A chosen ref makes the targeted creature itself the source
       * (Ram Through's bite). */
      sourceId: CardInstanceId | "self" | null | ChosenTargetRef;
      target: CardEffectTarget;
      /** subtypeCount: X = the controller's battlefield permanents with the
       * subtype (Scourge of Valkas). chosen_power: the bound source
       * creature's power, read at bind (Ram Through). */
      /** subject_power: Warstorm Surge — the trigger subject's power at bind. */
      /** subject_amount: "it deals THAT MUCH damage" — the amount the
       * trigger itself carried (the damage just dealt, or the size of the
       * batch that fired it). */
      amount:
        | number
        | "x"
        | "sacrificed_power"
        | "chosen_power"
        | "subject_power"
        | "subject_amount"
        /**
         * Descent into Avernus: "X damage … where X is the number of
         * descent counters on this enchantment". Read at APPLY, not at
         * bind: the same trigger puts two more counters on first, and the
         * damage is meant to see them.
         */
        | { sourceCounters: string }
        /** Combustible Gearhulk: the total mana value of the cards the
         * mill beside this one just made. Read at APPLY — its sibling has
         * not run when the batch binds. */
        | "milled_mana_value"
        | { subtypeCount: string };
      /** "You gain life equal to the damage dealt this way." */
      gainLife?: boolean;
    }
  | {
      /** X damage divided as the caster chose among the spell's targets. */
      kind: "divided_damage";
      sourceId: CardInstanceId | "self" | null;
      amount: number | "x";
    }
  | {
      kind: "draw";
      playerId: PlayerSelector;
      /** "sacrificed_power": Greater Good draws the fodder's power.
       * "x": Blue Sun's Zenith draws the announced X. */
      /** "subject_amount": Vilis draws the life the trigger watched lost. */
      count: number | "sacrificed_power" | "x" | "subject_amount";
      optional?: boolean;
      /** Return of the Wildspeaker: draw the greatest power among the
       * controller's creatures instead, computed when the effect binds.
       *
       * `stat` picks the axis; absent means "power", which is what every
       * card written before Last March of the Ents asked for. The field
       * keeps its name so no stored state needs migrating — read it as
       * "count from the greatest <stat>". */
      countFromGreatestPower?: { nonSubtypes?: string[]; stat?: "power" | "toughness" };
      /** Distant Melody: draw per controlled permanent of the auto-chosen
       * type instead, computed when the effect binds. */
      countFromChosenTypePermanents?: boolean;
      /** Shamanic Revelation: one card per controlled creature at bind. */
      countPerControlled?: "creature";
      /**
       * Spymaster's Vault: "X, where X is the number of creatures that
       * died this turn". Read at BIND — the tally is game state that the
       * discard beside it does not change.
       */
      countFromCreaturesDied?: boolean;
      /**
       * Cut a Deal: "a card for each opponent who drew a card this way" —
       * every living opponent drew, so the count is how many there are.
       * Read at bind, after the opponents' draws have resolved.
       */
      countPerOpponent?: boolean;
      /**
       * Sea Gate Restoration: "cards equal to the number of cards in your
       * hand PLUS ONE". The dynamic count sets the base and this is added
       * on top, after it, so an empty hand still draws one.
       */
      countFromDynamicPlus?: { count: DynamicCount; plus: number };
      /** Inspiring Call: multiply the count by a shared dynamic count at bind. */
      perDynamicCount?: DynamicCount;
      /**
       * The One Ring: "draw a card for each burden counter on ~". The
       * shared count table is a string union and cannot carry a counter
       * NAME, so the key rides here and is read off the source at bind.
       */
      countFromCounterOnSource?: string;
    }
  | { kind: "scry"; playerId: PlayerSelector; count: number }
  | { kind: "surveil"; playerId: PlayerSelector; count: number }
  | {
      kind: "move_card";
      cardId: CardIdSelector;
      toZone: Exclude<ZoneName, "stack">;
      libraryPosition?: LibraryPosition;
      /** Battlefield arrivals only: the card enters tapped. */
      entersTapped?: boolean;
      /** Battlefield arrivals: "It gains haste" riders. */
      gainsHaste?: boolean;
      /** "Sacrifice/Exile it at the beginning of the next end step." */
      atEndStep?: "sacrifice" | "exile";
      /** Whip of Erebos, unearth: "If it would leave the battlefield, exile
       * it instead of putting it anywhere else." */
      exileIfLeaves?: boolean;
      /**
       * This move is a DESTRUCTION (CR 701.7), not just a trip to the
       * graveyard. Indestructible stops it and totem armor replaces it;
       * a bounce, a tuck, a sacrifice and an exile all leave it off. The
       * word in the oracle text is what sets it.
       */
      destroy?: boolean;
      /**
       * "It can't be regenerated" (CR 701.15d). Rides the destruction it
       * belongs to rather than the card, because "destroyed THIS WAY"
       * scopes to one ability, and it never spends a shield it denies.
       */
      denyRegeneration?: boolean;
      /**
       * Ojer Taq: "return it to the battlefield tapped and TRANSFORMED".
       * The card arrives on its other face, which is a different thing from
       * transforming it afterwards — nothing sees the front face enter.
       */
      transformed?: boolean;
      /**
       * Kodama: mark the arriving permanent as put by this ability. A
       * BOOLEAN here and an id on the bound form — the definition does not
       * know which instance of Kodama will do it.
       */
      putByAbilityOf?: boolean;
      /** "onto the battlefield under your control" (Reanimate). */
      underControlOf?: "controller";
      /** "…to the battlefield with a -1/-1 counter on it" (Persist). */
      withCounter?: { counter: string; amount: number };
    }
  | {
      kind: "become_copy";
      cardId: CardIdSelector;
      target: ChosenTargetRef;
      untilEot?: boolean;
      keepAbilities?: boolean;
    }
  /** Midnight Clock: hand and graveyard back in, then one shuffle. */
  | {
      kind: "shuffle_zones_into_library";
      playerId: PlayerSelector;
      zones: ("hand" | "graveyard")[];
    }
  | { kind: "tap"; cardId: CardIdSelector }
  /** Reconnaissance: out of combat, still on the battlefield. */
  | { kind: "remove_from_combat"; cardId: CardIdSelector }
  /** Liquimetal Torque: added card types until end of turn. */
  | { kind: "types_until_eot"; cardId: CardIdSelector; types: string[] }
  | { kind: "untap"; cardId: CardIdSelector }
  | { kind: "tap_or_untap"; cardId: CardIdSelector }
  | {
      kind: "add_mana";
      playerId: PlayerSelector;
      mana: Partial<ManaPool>;
      /** Birgi: this mana survives steps and phases ending, until cleanup. */
      untilEndOfTurn?: boolean;
      /** Jeska's Will: multiply the mana by the chosen player's hand size. */
      perChosenPlayerHand?: boolean;
      /** Mana Drain: multiply by the TARGET SPELL's mana value, read as
       * the effect binds — by the time the delayed trigger fires the
       * spell is long gone from the stack. */
      perTargetManaValue?: boolean;
      /** Lotus Cobra: "add one mana of any color" — auto-picked at bind
       * (first commander-identity color, else {G}), a documented
       * approximation of the free choice. */
      anyColor?: number;
    }
  | {
      kind: "create_token";
      ownerId: PlayerSelector;
      name: string;
      typeLine: string;
      power?: number | null;
      toughness?: number | null;
      /** "…creature token with flying" (Utvara Hellkite). */
      keywords?: Keyword[];
      /** Secure the Wastes: "Create X … tokens" — the announced X. */
      /** Ruthless Technomancer: "a number of Treasure tokens equal to that
       * creature's power" — the sacrificed creature's power, read from the
       * may_sacrifice context that bound this effect. */
      count?: number | "x" | "sacrificed_power";
      /** Brass's Bounty: one token per controlled permanent of this type. */
      perControlled?: "land" | "creature" | "artifact";
      /** Krenko, Myrel: "where X is the number of Goblins you control". */
      perControlledSubtype?: string;
      /** Mahadi: one token per creature that died this turn. */
      perDiedCreatures?: boolean;
      /** Elenda: X tokens where X is the dying subject's power, carried on
       * the dies event and bound from the trigger context. */
      countFromSubjectAmount?: boolean;
      /** Krenko, Tin Street Kingpin: "equal to ~'s power", read at apply. */
      countFromSourcePower?: boolean;
      /** Anim Pakal: one token per named counter on the source, counted when
       * the effect applies (after earlier effects in the same batch). */
      perSourceCounters?: string;
      /**
       * Adeline: one token per opponent, each tapped and attacking THAT
       * opponent. Not a count with a shared defender — in a four-player
       * game that difference is the card.
       */
      /**
       * Urza's Saga's Construct: "this token gets +1/+1 for each artifact
       * you control". The static belongs to the TOKEN, so it rides the
       * definition the token is made from.
       */
      bonusPt?: { power: number; toughness: number; per: DynamicCount };
      attackingEachOpponent?: boolean;
      /** "tapped and attacking": joins the current combat against the first
       * declared defender (a documented approximation). */
      entersTappedAttacking?: boolean;
      /** "a tapped 1/1 blue Fish" (the gift mechanic). */
      entersTapped?: boolean;
      /** "a 4/4 blue and red Elemental" — a token has no mana cost to derive
       * its colours from, so the printed words are the only source. */
      colors?: Color[];
      /** Mobilize: "Sacrifice them at the beginning of the next end step." */
      atEndStep?: "sacrifice" | "exile";
      /** Scute Swarm: with this many lands, the token is a copy of the
       * source instead of the printed token. */
      copySelfIfLandsAtLeast?: number;
    }
  /** count "sacrificed_power": Altar of Dementia reads the sacrificed
   * cost-creature's power, captured on activation. */
  | {
      kind: "mill";
      playerId: PlayerSelector;
      /** subject_amount: "that many" — the life the trigger just saw lost. */
      count: number | "sacrificed_power" | "subject_amount";
    }
  /**
   * `conniveCounterOn` is the third clause of connive (CR 702.148): a
   * +1/+1 counter on that permanent for each NONLAND card discarded this
   * way. It rides the discard rather than following it, because the count
   * is only known once the discard has happened — the same rule as a sweep
   * that gains life per creature destroyed.
   */
  | {
      kind: "discard";
      playerId: PlayerSelector;
      count: number;
      conniveCounterOn?: CardIdSelector;
      /** Spymaster's Vault: connive X discards X, read the same way. */
      countFromCreaturesDied?: boolean;
    }
  /** Gamble: "discard a card at random". */
  | { kind: "discard_random"; playerId: PlayerSelector; count: number }
  | { kind: "discard_unless_attacked"; playerId: PlayerSelector; count: number }
  | { kind: "amass"; playerId: PlayerSelector; amount: number | "x"; subtype?: string }
  | {
      kind: "look_top_card";
      /** Whose library is looked at. */
      playerId: PlayerSelector;
      /** Who sees it — the effect's controller. */
      viewerId: PlayerSelector;
    }
  | {
      kind: "reveal_zone";
      fromPlayerId: PlayerSelector;
      toPlayerId: PlayerSelector;
      zone: "hand";
    }
  | {
      kind: "choose_card";
      chooserId: PlayerSelector;
      sources: ChooseCardSource[];
      thenEffects: CardEffect[];
      /** Braids: "you MAY sacrifice…" — the choice can be declined. */
      optional?: boolean;
      /**
       * Braids: what happens to an opponent who declines. Only meaningful
       * with `optional`; the punisher is the whole reason the choice is a
       * real one rather than an auto-take.
       */
      thenEffectsIfNone?: CardEffect[];
      /** Plaguecrafter: with no legal choice, discard this many instead. */
      cantDiscards?: number;
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerSelector;
      /** Ignored when `countFromDevotion` is set; the compiler emits 0
       * there, so dropping the flag yields no look rather than a
       * wrong-sized one. */
      count: number;
      destinations: LookDestination[];
      /**
       * Thassa's Oracle: X is the controller's devotion to this color.
       * Read as the effect BINDS, so the win check bound beside it sees
       * the same X — they are one number on the card, not two.
       */
      countFromDevotion?: Color;
      /**
       * "Put up to one of them on top of your library and the rest on the
       * bottom": one top slot plus a bottom slot for EVERY card, so the
       * top slot may go unused. Synthesized at bind, because with a
       * devotion-sized count the slots are not known before then.
       */
      upToOneOnTop?: boolean;
      /**
       * Hideaway (CR 702.75): the card sent to exile is remembered ON
       * the source, because the ability that plays it later has no other
       * way to say WHICH exiled card is "the exiled card".
       */
      hideawayFromSource?: boolean;
      /** Expressive Iteration: "You may play the exiled card this turn." */
      exilePlayableThisTurn?: boolean;
    }
  | { kind: "sacrifice"; cardId: CardIdSelector }
  /** Torment of Hailfire — see the bound form for why this is not `sacrifice`. */
  | { kind: "sacrifice_or_discard_chosen"; cardId: CardIdSelector }
  /**
   * Torment of Hailfire: "Repeat the following process X times." Expanded at
   * BIND, where the announced X lives — the inner effects are bound once per
   * repetition, so an each-opponent choice inside is made afresh each time.
   */
  | { kind: "repeat_x_times"; effects: CardEffect[] }
  /**
   * Chrome Mox: exile the chosen card and record it on the SOURCE, so
   * the source's own abilities can read it. Exiling it with a plain
   * move_card would lose the link and leave the Mox producing nothing.
   */
  | { kind: "imprint"; cardId: CardIdSelector }
  /**
   * Mosswort Bridge: play the card hidden away under this permanent,
   * free. The grant names the SOURCE's own exiled cards, so two Bridges
   * never offer each other's.
   */
  | { kind: "play_hidden_card"; free?: boolean }
  /** Urza's Saga: "This Saga gains '{2}, {T}: …'" — kept on the instance. */
  | { kind: "grant_self_activated"; ability: ActivatedAbility }
  /** The same for a mana ability, which must never use the stack. */
  | { kind: "grant_self_mana"; ability: ManaAbility }
  /**
   * Dauthi Voidwalker: the CHOSEN exiled card becomes playable this turn.
   * The impulse grants above only reach cards the same effect just exiled;
   * this one names a card that was already there.
   */
  | { kind: "grant_play_chosen"; playerId: PlayerSelector; free?: boolean }
  /**
   * Herald's Horn: "look at the top card of your library. If it's a
   * creature card of the chosen type, you may reveal it and put it into
   * your hand." The "may" is auto-taken, the same documented
   * approximation `draw.optional` already carries — a free card is
   * never worth declining.
   */
  | {
      kind: "look_top_take_matching";
      playerId: PlayerSelector;
      filter: SearchFilter;
      /** Fill `filter.subtypes` from the SOURCE's as-enters chosen type. */
      chosenSubtypeOfSource?: boolean;
    }
  /** CR 702.26: Slip Out the Back, Guardian of Faith, Clever Concealment.
   * `allChosen` is the variable-target form — every target the caster
   * picked, however many that was, rather than a fixed list of slots. */
  | {
      kind: "phase_out";
      cardIds: CardIdSelector[];
      allChosen?: boolean;
      /** Teferi's Protection: "ALL permanents you control phase out." */
      allControlled?: boolean;
    }
  /** amount "source_power": the source creature's power, read at bind
   * (Halana and Alena). */
  /** amount "subject_amount": The Ozolith absorbs the leave event's
   * +1/+1-counter total. */
  | {
      kind: "add_counter";
      cardId: CardIdSelector;
      counter: string;
      amount: number | "source_power" | "subject_amount";
      /** Proft's Eidetic Memory: "X counters, where X is the number of
       * <count>" — the same shared table draw and gain_life scale by,
       * multiplying `amount` at bind.
       *
       * `dynamicOffset` is the "minus one" tail. It is applied AFTER the
       * multiplication, and a total of zero or less places no counters at
       * all rather than a floor of one. */
      perDynamicCount?: DynamicCount;
      dynamicOffset?: number;
    }
  | {
      kind: "remove_counter";
      cardId: CardIdSelector;
      counter: string;
      amount: number;
      sacrificeWhenEmpty?: boolean;
    }
  /** The Ozolith's combat trigger: every counter hops to the target. */
  | { kind: "move_all_counters"; cardId: CardIdSelector; target: ChosenTargetRef }
  /** Nesting Grounds: one counter, from the first chosen permanent to the
   * second. Two independent target slots, so both are `ChosenTargetRef`. */
  | { kind: "move_counter"; from: ChosenTargetRef; to: ChosenTargetRef }
  /** The Earth Crystal: N counters divided among the chosen targets. The
   * division is auto-taken one-per-target and then front-loaded, which is
   * documented; the engine has no field for a player-chosen split. */
  | {
      kind: "distribute_counters";
      counter: string;
      amount: number;
      targets: ChosenTargetRef[];
    }
  | { kind: "double_counters_on_team"; playerId: PlayerSelector; counter: string }
  | { kind: "double_counters_on"; cardId: CardIdSelector; counter: string }
  /** Deepglow Skate: every KIND of counter at once, on every chosen
   * target. Distinct from `double_counters_on`, which names one kind. */
  | { kind: "double_all_counters"; cardIds: CardIdSelector[]; allChosen?: boolean }
  | {
      kind: "counter_spell";
      target: ChosenTargetRef;
      /** Force of Negation: "exile it instead". */
      exileInstead?: boolean;
    }
  /** Tibalt's Trickery — see the bound form for why it is one effect. */
  | { kind: "mill_and_dig_free"; target: ChosenTargetRef }
  | { kind: "counter_unless_pays"; target: ChosenTargetRef; cost: string }
  /** Venser: bounce a spell (off the stack) or a permanent to its owner's hand. */
  | { kind: "bounce_spell_or_permanent"; target: ChosenTargetRef }
  /** Tree of Perdition: swap the target's life with the source's toughness. */
  | { kind: "exchange_life_toughness"; playerId: PlayerSelector }
  | { kind: "copy_spell"; target: ChosenTargetRef }
  /** Beseech the Mirror — see the bound form. */
  | { kind: "searched_free_or_hand"; playerId: PlayerSelector; maxManaValue: number }
  /**
   * Mindbreak Trap: exiling a spell REMOVES it from the stack without
   * countering it (CR 701.11). Deliberately not `counter_spell` with
   * `exileInstead`: that path refuses a spell that can't be countered, and
   * beating those is the whole reason this card is played.
   */
  | { kind: "exile_spell"; target: ChosenTargetRef | "all_chosen" }
  | {
      kind: "extra_combat";
      /**
       * Moraug: "At the beginning of that combat, untap all creatures you
       * control." The untap belongs to the added combat, not to the trigger
       * that made it — untapping when the trigger resolves would let the
       * controller tap for mana in the main phase afterwards and still
       * attack with everything, which is stronger than the printed card.
       */
      untapAtBeginning?: boolean;
    }
  | {
      kind: "untap_all";
      playerId: PlayerSelector;
      what: "creature" | "land" | "attacking" | "nonland";
      /** Combat Celebrant: "all OTHER creatures you control". */
      excludeSource?: boolean;
      /** Valley Floodcaller: "Untap them" — only the subtypes the sentence
       * before it named, not every creature. */
      subtypes?: string[];
    }
  /** Combat Celebrant — see the bound form. */
  | { kind: "exert"; cardId: CardIdSelector }
  /** The Ring tempts you (CR 701.52): one more tempt, and a Ring-bearer. */
  | { kind: "ring_tempts"; playerId: PlayerSelector }
  /** The Ring's third tier — see the bound form. */
  | { kind: "sacrifice_blocker_at_end_of_combat" }
  | { kind: "tap_all"; playerId: PlayerSelector; what: "creature" | "land" }
  | { kind: "goad"; target: ChosenTargetRef }
  | { kind: "goad_all" }
  | { kind: "must_attack_all" }
  | {
      kind: "gain_control";
      cardId: CardIdSelector;
      playerId: PlayerSelector;
      untilEot?: boolean;
    }
  | {
      kind: "gain_control_all";
      playerId: PlayerSelector;
      what: ControlAllScope;
      /** "…that player controls" (Hellkite Tyrant reads the damaged player). */
      fromId?: PlayerSelector;
      untilEot?: boolean;
    }
  | { kind: "restore_control"; what: ControlAllScope }
  /**
   * Ability-word riders ("Threshold — Add {B}{B}{B}{B}{B} instead if …"):
   * whichever branch the condition picks is what binds. There is no bound
   * counterpart — the choice is made when the effects are bound, which for a
   * spell is its resolution.
   */
  | {
      kind: "if_condition";
      condition: TriggerCondition;
      then: CardEffect[];
      otherwise?: CardEffect[];
    }
  | { kind: "attackers_gain_keyword_until_eot"; keyword: Keyword }
  | { kind: "untap_lands_up_to"; playerId: PlayerSelector; count: number }
  /**
   * Inkshield: the shield belongs to ONE player, and counts what it stopped
   * so the token rider can read it. Absent means the table-wide fog every
   * other card prints.
   */
  | {
      kind: "fog";
      forPlayerId?: PlayerSelector;
      tokenPerDamage?: Extract<CardEffect, { kind: "create_token" }>;
    }
  /** Mystic Forge: exile the top card(s) of the player's library. */
  | { kind: "exile_top"; playerId: PlayerSelector; count: number }
  | { kind: "choose_card_name"; playerId: PlayerSelector; onSelf?: boolean }
  | { kind: "tempting_offer"; playerId: PlayerSelector; action: CardEffect[] }
  /**
   * The punisher choice (Combustible Gearhulk, Sin Prodder). An OPPONENT
   * picks which of two things happens, and both are real — that is the
   * whole card, so neither branch may be auto-taken by the controller.
   *
   * The branches are carried UNBOUND because "that player" in them is the
   * chooser, who is not known until the effect binds and whose identity
   * the branches must read as their trigger subject.
   */
  | {
      kind: "punisher_choice";
      chooserId: PlayerSelector;
      ifTaken: CardEffect[];
      ifDeclined: CardEffect[];
    }
  /**
   * Tainted Pact. Exile the top card; if its name matches one already
   * exiled this way the whole thing stops; otherwise the caster MAY take
   * it, and taking it stops too.
   *
   * A loop with a decision in it, which is why it needed the prompt
   * machinery: auto-taking the first legal card is materially wrong, since
   * the card is played to dig PAST what you do not want.
   */
  | { kind: "exile_until_taken"; playerId: PlayerSelector }
  /** "Take an extra turn after this one." */
  | { kind: "extra_turn"; playerId: PlayerSelector }
  /**
   * Opal Palace: the commander spell this mana paid for enters with a
   * counter for each time it has been cast from the command zone.
   */
  | { kind: "commander_cast_counters"; cardId: CardIdSelector }
  /**
   * Conduit of Worlds: "you may cast that card" — one named card in a
   * graveyard becomes castable this turn, paying its costs as normal.
   */
  | {
      kind: "grant_cast_this_turn";
      cardId: CardIdSelector;
      playerId: PlayerSelector;
      locksCastingAfter?: boolean;
    }
  /**
   * Isochron Scepter: copy a CARD that is not on the stack and cast the
   * copy for free. The card itself never moves — it stays imprinted, which
   * is the whole reason the Scepter is played.
   */
  | { kind: "cast_free_copy"; cardId: CardIdSelector; playerId: PlayerSelector }
  /** Trouble in Pairs, Stranglehold: that player's extra turns are skipped. */
  | { kind: "deny_extra_turns"; playerId: PlayerSelector }
  /**
   * Myr Battlesphere: "you may tap X untapped Myr you control. If you do,
   * this gets +X/+0 and deals X damage to the player it's attacking."
   *
   * X is chosen by the player and then FEEDS what follows, so the rider
   * cannot be bound before the choice — it is carried unbound and rebound
   * once the count is known, with `x` standing for however many were
   * tapped.
   */
  | {
      kind: "tap_own_for_x";
      playerId: PlayerSelector;
      subtype: string;
      rider: CardEffect[];
    }
  | {
      kind: "divide_into_piles";
      playerId: PlayerSelector;
      dividerId: PlayerSelector;
      count: number;
      taken: "hand" | "graveyard";
      left: "hand" | "graveyard";
    }
  /** Necropotence: exile the top card; to hand at the next end step. */
  | { kind: "exile_top_to_hand"; playerId: PlayerSelector }
  /** Living Death: everyone swaps graveyard creatures with board creatures. */
  | { kind: "living_death" }
  /** Springbloom Druid: auto-taken land sacrifice gating the effects. */
  /**
   * Springbloom Druid, Disciple of Freyalise. The take and the pick are
   * both auto — documented approximations of a free choice.
   */
  | {
      kind: "may_sacrifice";
      what: "land" | "another_creature";
      effects: CardEffect[];
    }
  /** Curse of the Swine: exile each target, its controller gets the token. */
  | {
      kind: "exile_targets_into_tokens";
      token: { name: string; typeLine: string; power: number; toughness: number };
    }
  /** Windfall: each player discards their hand, then draws the greatest
   * count — or a fixed count when drawCount is set (Wheel of Fortune). */
  | { kind: "windfall"; drawCount?: number }
  /** Second Harvest: one copy of every token the player controls. */
  | { kind: "copy_each_token"; playerId: PlayerSelector }
  | {
      kind: "bounce_each_creature";
      unlessCounter?: string;
      onlyAttacking?: boolean;
      /** Raise the Palisade: the auto-chosen type is spared. */
      exceptChosenType?: boolean;
    }
  | {
      kind: "dig_top";
      playerId: PlayerSelector;
      count: number;
      filter: SearchFilter;
      destination: "hand" | "battlefield" | "battlefield_tapped";
      /** Grisly Salvage: "Put the rest into your graveyard." */
      restTo?: "bottom" | "graveyard";
    }
  /** Impulse: exile the top of the player's library; the effect's controller
   * may cast or play those cards this turn (free when freeCast — Etali). */
  | {
      kind: "exile_top_play";
      playerId: PlayerSelector;
      /** Ignored when `untilNonland` is set: the dig decides how many. */
      count: number;
      freeCast?: boolean;
      /** Atsushi: playable "until the end of your next turn". */
      untilEndOfNextTurn?: boolean;
      /** Etali, Primal Conqueror — see the bound form. */
      untilNonland?: boolean;
    }
  /** Charming Prince: exile the target; it returns to the battlefield under
   * the effect controller's control at the beginning of the next end step. */
  | {
      kind: "exile_return_end_step";
      /** Absent when `self` is set: Nezahal blinks ITSELF, with no target. */
      target?: ChosenTargetRef;
      /** Nezahal: the source blinks, so there is nothing to target. */
      self?: boolean;
      /** Parting Gust: the card comes back under its OWNER's control. */
      toOwner?: boolean;
      withCounter?: string;
      /** Nezahal: "Return it to the battlefield TAPPED". */
      returnsTapped?: boolean;
    }
  /** Eerie Interlude: every chosen creature blinks out and returns to its
   * OWNER's battlefield at the next end step. */
  | { kind: "exile_return_end_step_all" }
  /** Adapt (Evolution Witness). */
  | { kind: "adapt"; cardId: CardIdSelector; amount: number }
  | { kind: "populate"; playerId: PlayerSelector }
  /** Ripples of Potential — see the bound form for why the two are one effect. */
  | { kind: "proliferate"; playerId: PlayerSelector; thenPhaseOutTouched?: boolean }
  | {
      kind: "restrict_until_eot";
      cardId: CardIdSelector;
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
    }
  /** Overload (CR 702.96): apply the effects to each object the normal mode
   * could have targeted, enumerated when the spell resolves. */
  | { kind: "overload_each"; requirement: TargetRequirement; effects: CardEffect[] }
  /** "copy that spell" in a cast trigger — the subject spell, not a target. */
  | { kind: "copy_subject_spell" }
  /** "counter that spell" in a cast trigger — the subject spell, not a target. */
  | { kind: "counter_subject_spell" }
  /** Feign Death: until end of turn, "when it dies, return it tapped". */
  | { kind: "grant_dies_return"; cardId: CardIdSelector; counter?: boolean; treasure?: boolean }
  | { kind: "set_class_level"; cardId: CardIdSelector; level: number }
  /** power "target_power": doubles — the bound card's power read at bind
   * (The Skullspore Nexus). */
  | {
      kind: "pt_until_eot";
      cardId: CardIdSelector;
      /** "x": the announced X on the spell that made this (Tyvar's Stand).
       * "minus_x": the same X, negated — "gets -X/-X" (Grim Hireling). */
      power: number | "target_power" | "x" | "minus_x";
      toughness: number | "x" | "minus_x";
      per?: DynamicCount;
    }
  | { kind: "keyword_until_eot"; cardId: CardIdSelector; keyword: Keyword }
  /**
   * Mutavault and Destiny Spinner. `ptFrom` is the "where X is …" tail,
   * read when the effect binds rather than printed, which is the only
   * reason the numbers below can be a fallback rather than the whole story.
   */
  | {
      kind: "animate_until_eot";
      cardId: CardIdSelector;
      power: number;
      toughness: number;
      ptFrom?: DynamicCount;
      subtypes?: string[];
      types?: string[];
      colors?: Color[];
      allCreatureTypes?: boolean;
      keywords?: Keyword[];
    }
  | {
      kind: "team_set_pt_until_eot";
      playerId: PlayerSelector;
      /** Mirror Entity: the announced X, read where the ability resolves. */
      power: number | "x";
      toughness: number | "x";
      allCreatureTypes?: boolean;
    }
  | {
      kind: "team_pt_until_eot";
      playerId: PlayerSelector;
      /** creature_count: X = the controller's creatures at bind (Craterhoof).
       * greatest_power: the largest power among them (Overwhelming Stampede).
       * x: the announced X on the spell that made this. */
      power: number | "creature_count" | "greatest_power" | "x";
      toughness: number | "creature_count" | "greatest_power" | "x";
      /** Lathliss: "Dragons you control get +1/+0". */
      subtypes?: string[];
      /** "Non-Human creatures you control" (Return of the Wildspeaker). */
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    } // (unbound team_pt_until_eot)
  | {
      kind: "team_keyword_until_eot";
      playerId: PlayerSelector;
      keyword: Keyword;
      /** Elspeth, Teferi: the grant lasts until this player's NEXT turn. */
      untilYourNextTurn?: boolean;
      /** "Permanents you control gain …" (Boros Charm). */
      scope?: "permanents";
      /** Lord of the Accursed: "All Zombies gain menace". */
      subtypes?: string[];
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    }
  /** "Creatures you control gain protection from each color" (Akroma's Will). */
  | { kind: "team_protection_until_eot"; playerId: PlayerSelector; colors: Color[] }
  | { kind: "protection_until_eot"; cardId: CardIdSelector; colors: Color[] }
  | { kind: "hexproof_from_until_eot"; cardId: CardIdSelector; colors: Color[] }
  | {
      kind: "team_hexproof_from_until_eot";
      playerId: PlayerSelector;
      colors: Color[];
      includePlayer?: boolean;
    }
  | { kind: "spells_uncounterable_this_turn"; playerId: PlayerSelector }
  | {
      kind: "dig_until";
      playerId: PlayerSelector;
      filter: SearchFilter;
      found: "hand" | "battlefield" | "battlefield_tapped" | "graveyard" | "exile";
      rest: "library_bottom_random" | "library_bottom" | "graveyard" | "exile";
      optional?: boolean;
    }
  /** "All creatures get -X/-X until end of turn" (Toxic Deluge). */
  | {
      kind: "all_pt_until_eot";
      power: number | "-x";
      toughness: number | "-x";
      /** Crippling Fear: the auto-chosen type is spared. */
      exceptChosenType?: boolean;
    }
  /** Chaos Warp's back half: reveal the top card; a permanent card lands. */
  /**
   * Sundering Eruption: "creatures without flying can't block this turn" —
   * every creature on the battlefield, filtered by a keyword it lacks.
   */
  | {
      kind: "all_restrict_until_eot";
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
      withoutKeyword?: Keyword;
      withKeyword?: Keyword;
    }
  | {
      kind: "all_restrict_until_eot";
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
      withoutKeyword?: Keyword;
      withKeyword?: Keyword;
    }
  | {
      kind: "grant_next_spell";
      playerId: PlayerSelector;
      improvise?: boolean;
      cantBeCountered?: boolean;
    }
  | { kind: "reveal_top_put_permanent"; playerId: PlayerSelector }
  /** Exsanguinate: each opponent loses N; you gain the total lost.
   * devotion: X = colored pips of that color among the controller's
   * permanents' mana costs (Gray Merchant of Asphodel, CR 700.5). */
  | {
      kind: "drain_opponents";
      playerId: PlayerSelector;
      amount: number | "x" | { devotion: Color };
    }
  /** Silence: opponents of this player can't cast spells this turn. */
  | { kind: "silence"; playerId: PlayerSelector }
  /** Ranger-Captain of Eos: the noncreature-only variant. */
  | { kind: "silence_noncreature"; playerId: PlayerSelector }
  /** Rakdos Charm: each creature pings its own controller. */
  | { kind: "each_creature_damages_controller"; amount: number }
  /** Unnatural Growth: double each controlled creature's P/T until EOT. */
  | { kind: "double_team_pt_until_eot"; playerId: PlayerSelector }
  /** Chandra's Ignition: the chosen creature hits every other creature and
   * each opponent for its power. */
  | { kind: "power_nova"; cardId: ChosenTargetRef }
  /** Deflecting Swat: the caster picks new targets for the chosen spell. */
  | {
      kind: "retarget";
      target: ChosenTargetRef;
      /** Hydroelectric Specimen: the new target is the SOURCE of this ability. */
      toSelf?: boolean;
    }
  /** Rise of the Dark Realms: every graveyard creature card, under you. */
  /**
   * Discover N, and cascade. `maxManaValue` is the printed N; "below_source"
   * is cascade reading the cascading spell's own mana value at bind.
   */
  | {
      kind: "discover";
      playerId: PlayerSelector;
      maxManaValue: number | "below_source";
      toHandAllowed?: boolean;
    }
  | {
      kind: "choose_from_hand";
      playerId: PlayerSelector;
      destination: "library_bottom" | "battlefield";
      types?: string[];
      thenDrawPlus?: number;
    }
  | {
      kind: "add_turn_mana_echo";
      echo: NonNullable<CardDefinition["landTapEcho"]>;
    }
  | { kind: "add_subtypes"; cardId: CardIdSelector; subtypes: string[] }
  /** Breach the Multiverse — see the bound form. */
  | { kind: "add_subtypes_all"; playerId: PlayerSelector; what: "creature"; subtypes: string[] }
  | {
      kind: "regenerate";
      cardId?: CardIdSelector;
      /** Golgari Charm: "regenerate EACH creature you control". */
      allControlled?: boolean;
    }
  | { kind: "sacrifice_others_of_type"; playerId: PlayerSelector; cardType: string }
  /** Promise of Loyalty — see `counterAttackBans` for why it is game-level. */
  | { kind: "ban_attacks_while_counter"; counter: string; playerId: PlayerSelector }
  | { kind: "mass_reanimate"; playerId: PlayerSelector }
  /** Splendid Reclamation: every land card in YOUR graveyard returns tapped. */
  | { kind: "return_all_lands"; playerId: PlayerSelector }
  /** Maze of Ith: shield the chosen creature from combat damage this turn. */
  | { kind: "prevent_combat_for"; cardId: ChosenTargetRef }
  /** Explore: one extra land drop this turn. */
  | { kind: "extra_land_drop"; playerId: PlayerSelector }
  /** "You win the game": every other player loses (CR 104.2a). */
  | {
      kind: "win_game";
      playerId: PlayerSelector;
      /** Mechanized Production — see the bound form for why it is not read here. */
      ifSameNameCount?: { type: string; atLeast: number };
      /**
       * Thassa's Oracle: "If X is greater than or equal to the number of
       * cards in your library, you win the game", X being devotion to this
       * color. Evaluated at BIND, beside the look that shares X — the look
       * only reorders the library, so its size is the same either way, but
       * binding both together is what guarantees one X and not two.
       */
      ifDevotionAtLeastLibrary?: Color;
    }
  | { kind: "lose_game"; playerId: PlayerSelector }
  | {
      kind: "grant_player_shield";
      playerId: PlayerSelector;
      protectionFromEverything?: boolean;
      lifeLocked?: boolean;
    }
  /**
   * "At the beginning of your next upkeep, …". The body is bound NOW,
   * as the spell resolves, not when the step arrives.
   */
  | {
      kind: "delayed_trigger";
      step: "upkeep" | "first_main_phase";
      whose: "controller" | "any";
      effects: CardEffect[];
    }
  /** Emergence Zone: the player may cast at instant speed this turn. */
  | { kind: "grant_flash_this_turn"; playerId: PlayerSelector }
  /** Sea Gate Restoration: no maximum hand size, for the rest of the game. */
  | { kind: "grant_no_max_hand_size"; playerId: PlayerSelector }
  /** Command Beacon: the commander moves from the command zone to hand. */
  /** Rishkar's Expertise: one free cast from hand, capped by mana value.
   * "X or less" (Electrodominance) reads the announced X at bind. */
  | {
      kind: "grant_free_cast_from_hand";
      playerId: PlayerSelector;
      /**
       * "subject_amount": Buster Sword's cap is THAT DAMAGE — the amount
       * the trigger itself carried, which is only known once the combat
       * damage has been dealt.
       */
      maxManaValue?: number | "x" | "subject_amount";
      count: number;
    }
  | { kind: "commander_to_hand"; playerId: PlayerSelector }
  /** Shadowspear: opponents' permanents drop the listed keywords this turn. */
  | {
      kind: "opponents_lose_keywords_until_eot";
      keywords: Keyword[];
      /** Arcane Lighthouse: CREATURES, where Shadowspear says permanents. */
      creaturesOnly?: boolean;
      /**
       * Arcane Lighthouse: "…and can't HAVE hexproof or shroud". Without the
       * lock, a static that grants hexproof re-grants it in the same layer
       * and the ability does nothing at all.
       */
      alsoLock?: boolean;
    }
  | {
      kind: "search_library";
      /** Archdruid's Charm: a land goes to the battlefield tapped instead. */
      landsToBattlefieldTapped?: boolean;
      playerId: PlayerSelector;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
      /** Fabled Passage: untap the fetched land when controlling this many. */
      untapIfLands?: number;
      /** Traverse the Outlands: count = greatest power among the
       * controller's creatures, read at bind. */
      countFromGreatestPower?: boolean;
      /**
       * Finale of Devastation: "search your library AND/OR graveyard".
       * The graveyard joins the pool the search picks from, and the shuffle
       * then happens only when the card did not come from there.
       */
      alsoGraveyard?: boolean;
    }
  | { kind: "attach"; cardId: CardIdSelector; toId: ChosenTargetRef | CardInstanceId }
  | { kind: "transform"; cardId: CardIdSelector }
  | {
      kind: "copy_token";
      ownerId: PlayerSelector;
      /**
       * `"host"` is the ATTACHED permanent — Helm of the Host's equipped
       * creature, Mechanized Production's enchanted artifact — read through
       * the same `attachedTo` field. The binder has always handled it; the
       * type did not say so, and `CardInstanceId` being a string is the
       * only reason that compiled.
       */
      ofCardId: ChosenTargetRef | CardInstanceId | "self" | "host";
      /** "create five of those tokens" (kicked Rite of Replication). */
      count?: number;
      /**
       * Saw in Half: "their power is half that creature's power … round up".
       * Resolved to a concrete `setPt` at BIND, which is the only moment it
       * can be — the sibling destruction has not run yet, so the creature is
       * still on the battlefield to be measured.
       */
      halvePtRoundUp?: boolean;
      /**
       * Saw in Half: "IF that creature dies this way". Checked at APPLY,
       * which is the only moment IT can be — indestructible, regeneration
       * and totem armor all stop the death, and the copies come only when
       * the creature really went.
       */
      onlyIfDied?: boolean;
      /** "It gains haste" / delayed end-step riders (Jaxis-class shells). */
      gainsHaste?: boolean;
      atEndStep?: "sacrifice" | "exile";
      /** Encore (CR 702.139): one attacking copy per opponent. */
      attackingEachOpponent?: boolean;
      /** Offspring: the copy's base power and toughness are overridden (1/1). */
      setPt?: { power: number; toughness: number };
      /** Eternalize: the copy is black and a Zombie on top of its own types. */
      setColors?: Color[];
      addSubtypes?: string[];
      /**
       * Helm of the Host: "except the token isn't legendary". Without it
       * the legend rule destroys one of the pair as soon as the copy
       * arrives, which is the whole point of the card.
       */
      notLegendary?: boolean;
    }
  | { kind: "manifest"; playerId: PlayerSelector; count: number }
  | {
      kind: "counter_on_controlled_creatures";
      playerId: PlayerSelector;
      counter: string;
      /** "source_power": the source creature's power at bind (Ouroboroid). */
      amount: number | "source_power";
    }
  /** Black Sun's Zenith: counters on every battlefield creature. */
  | {
      kind: "counter_on_each_creature";
      counter: string;
      amount: number | "x";
      subtype?: string;
      controlledOnly?: boolean;
      /** Archfiend of Ifnir: "each creature your opponents control". */
      opponentsOnly?: boolean;
      /** Oran-Rief, the Vastwood: "each green creature". */
      colors?: Color[];
      /** Oran-Rief: "…that entered this turn". */
      enteredThisTurn?: boolean;
    }
  | {
      kind: "destroy_all";
      what: DestroyAllScope;
      /** Nevinyrral's Disk: "all artifacts, creatures, and enchantments" —
       * any of these types, swept as one batch rather than three. */
      typesAny?: string[];
      /** Split Up: only tapped, or only untapped, permanents. */
      tapState?: "tapped" | "untapped";
      /** Damning Verdict: "with no counters on them". */
      withoutCounters?: boolean;
      /** Winds of Rath: "that aren't enchanted". */
      notEnchanted?: boolean;
      /** Urza's Ruinous Blast: "that aren't legendary". */
      notLegendary?: boolean;
      /** Hour of Reckoning: "nontoken" — the tokens survive. */
      nontoken?: boolean;
      /** All Is Dust: "that are one or more colors" — colourless survives. */
      coloredOnly?: boolean;
      /** All Is Dust: a SACRIFICE, so indestructible does not save. */
      asSacrifice?: boolean;
      /** Damnation: "They can't be regenerated" — shields do not apply. */
      denyRegeneration?: boolean;
      /** Urza's Ruinous Blast exiles rather than destroying. */
      toZone?: "exile";
      maxManaValue?: number;
      minManaValue?: number;
      /** Elspeth: only creatures with computed power at least this. */
      minPower?: number;
      /** Fell the Mighty: strictly above the chosen target's power, read at
       * bind. */
      minPowerAboveTarget?: number;
      /** Kindred Dominance: the auto-chosen type (most common among the
       * caster's creatures, bound at resolution) is spared. */
      exceptChosenType?: boolean;
      /** Crux of Fate: a named subtype is spared ("all non-Dragon
       * creatures") — the printed counterpart of exceptChosenType. */
      exceptSubtype?: string;
      /** Crux of Fate: destroy ONLY permanents of this subtype. */
      onlySubtype?: string;
      /** Organic Extinction: a card type the swept permanent must NOT have. */
      exceptTypes?: string[];
      /** Ruinous Ultimatum: only permanents the caster does NOT control. */
      opponentsOnly?: boolean;
      /** Culling Ritual: the caster gets one mana per destroyed permanent —
       * the color is auto-picked at bind from these options (first
       * commander-identity match, else the first listed; documented). */
      addManaPerDestroyedOptions?: ManaColor[];
      gainLifePerDestroyed?: number;
      counterPerDestroyed?: { cardId: CardIdSelector; counter: string; amount: number };
    }
  | {
      kind: "unless_pays";
      playerId: PlayerSelector;
      cost: string;
      /** Esper Sentinel: the cost is {X}, X = the source's power at bind. */
      costFromPower?: boolean;
      /** Sylvan Library: "pay 4 life or …". Paid from life, not mana. */
      life?: number;
      effects: CardEffect[];
    }
  /**
   * Cumulative upkeep (CR 702.24): put an age counter on the source, then
   * pay `cost` once per age counter on it or sacrifice it.
   *
   * One effect rather than an add_counter beside an unless_pays, because
   * the counter has to be ON before the cost is counted and effects bind
   * as a batch — a sibling unless_pays would bind against the old count
   * and undercharge by one every single upkeep.
   */
  | {
      kind: "cumulative_upkeep";
      playerId: PlayerSelector;
      cost: string;
    }
  /** Echo (CR 702.29), bound to the source the way cumulative upkeep is. */
  | {
      kind: "echo";
      playerId: PlayerSelector;
      cost: string;
    }
  /** The Gitrog Monster: feed it a land, or lose it. */
  | {
      kind: "sacrifice_unless_sacrifice";
      playerId: PlayerSelector;
      scope: "land";
    }
  | {
      kind: "may_pay";
      playerId: PlayerSelector;
      cost: string;
      life?: number;
      effects: CardEffect[];
      /** Springheart Nantuko — see the bound form. */
      requiresHostCreature?: boolean;
      elseEffects?: CardEffect[];
    }
  | {
      kind: "damage_all";
      sourceId: CardInstanceId | "self" | null;
      /** "creature_count": X = creatures on the battlefield (Chain Reaction). */
      amount: number | "x" | "creature_count";
      includePlayers?: boolean;
    }
  | { kind: "flicker"; cardId: CardIdSelector }
  /** Enduring cycle: "return it to the battlefield … It's an enchantment." */
  | { kind: "return_self_as_enchantment"; cardId: CardIdSelector }
  /** "You get an emblem with …" (Elspeth, Sun's Champion). */
  | { kind: "create_emblem"; ownerId: PlayerSelector; statics: StaticAbility[] }
  /** Living weapon (CR 702.92). */
  | { kind: "germ_attach"; cardId: CardIdSelector }
  /** "Roll a d20. You create a number of Treasure tokens equal to the result." */
  | { kind: "roll_die_treasures"; playerId: PlayerSelector; sides: number }
  | { kind: "exile_graveyard"; playerId: PlayerSelector }
  /** Mother of Runes: protection from a color of your choice until EOT. */
  | { kind: "grant_protection_choice"; target: ChosenTargetRef }
  /** "it fights up to one target creature you don't control" (Kogla). */
  | { kind: "fight"; cardId: CardIdSelector; withTarget: ChosenTargetRef };

export type Keyword =
  | "flying"
  | "reach"
  | "haste"
  | "vigilance"
  | "trample"
  | "deathtouch"
  | "lifelink"
  | "first_strike"
  | "double_strike"
  | "menace"
  | "hexproof"
  | "shroud"
  | "indestructible"
  | "flash"
  | "defender"
  | "fear"
  | "intimidate"
  | "horsemanship"
  | "shadow"
  | "skulk"
  /**
   * Landwalk (CR 702.14): "can't be blocked as long as defending player
   * controls a <land>". One union member per printed variant rather than a
   * parameterised field, so grants, searches, keyword lines and the layer
   * engine all reach it through the machinery they already have — Trailblazer's
   * Boots grants one with the same `grant_keyword` an anthem uses.
   */
  | "plainswalk"
  | "islandwalk"
  | "swampwalk"
  | "mountainwalk"
  | "forestwalk"
  /** "nonbasic landwalk": any land without the basic supertype. */
  | "nonbasic_landwalk"
  /** Myriad (CR 702.115) — Blade of Selves grants it, so it is a keyword
   * the combat step reads rather than a printed trigger. */
  | "myriad"
  /**
   * Infect (CR 702.90): damage this source deals is not damage in the
   * ordinary sense. A player takes POISON COUNTERS instead of losing life,
   * and a creature takes -1/-1 COUNTERS instead of marked damage — which is
   * why an infect creature kills through a fog of lifegain and why its
   * damage does not wear off at cleanup.
   */
  | "infect";

export type TriggerEvent =
  | "enter_battlefield"
  | "begin_combat"
  | "dies"
  /** The Ozolith: a counter-carrying permanent left the battlefield. */
  | "leaves_battlefield"
  /**
   * Kozilek, Ulamog: "put into a graveyard FROM ANYWHERE" — the battlefield,
   * the stack (countered), the library (milled), the hand (discarded). A
   * superset of `dies`, and the difference is the whole point of the cards
   * that print it: answering one of them by countering or milling it is
   * exactly what the shuffle-back is there to undo.
   */
  | "put_into_graveyard"
  /** Call of the Ring: "whenever you choose a creature as your Ring-bearer". */
  | "chooses_ring_bearer"
  /** The Ring's third tier: "whenever your Ring-bearer becomes blocked". */
  | "becomes_blocked"
  /** Curses: "whenever enchanted player is attacked". */
  | "player_attacked"
  | "attacks"
  | "upkeep"
  | "end_step"
  /** Mana Vault, Teferi's Puzzle Box: "at the beginning of your draw step".
   * Queued after the turn-based draw, per CR 504. */
  | "draw_step"
  /** Black Market, Hulking Raptor: "at the beginning of your first main
   * phase" — the precombat main only. */
  | "first_main_phase"
  | "you_gain_life"
  /** An opponent lost life (Exquisite Blood). Subject is the losing player. */
  | "opponent_loses_life"
  /** Vilis: "Whenever you lose life". */
  | "you_lose_life"
  /** A spell was cast (Guttersnipe, Rhystic Study). Subject is the cast card. */
  | "cast_spell"
  /** Dealt combat damage to a player (Bident of Thassa). Subject is the dealer. */
  | "deals_combat_damage_to_player"
  /** Dealt any damage to a player (Curiosity). Subject is the dealer. */
  | "deals_damage_to_player"
  /** An opponent drew a card (Smothering Tithe). Subject is the drawing player. */
  | "opponent_draws"
  /** The controller created a token (Mirkwood Bats). */
  | "you_create_token"
  /** The controller sacrificed a token (Mirkwood Bats). */
  | "you_sacrifice_token"
  /** Any permanent untapped (Mesmeric Orb). Subject is the permanent. */
  | "becomes_untapped"
  /**
   * Burgeoning, City of Traitors: a land was PLAYED, which is not the same
   * as a land entering. A fetched or reanimated land enters and was never
   * played, and the printed wording draws that line deliberately — reading
   * "plays" as "enters" would sacrifice City of Traitors to a Fabled
   * Passage. Subject is the land; subject player is who played it.
   */
  | "plays_land"
  /** Any permanent tapped (City of Brass, Magda). Subject is the permanent. */
  | "becomes_tapped"
  /**
   * Forbidden Orchard: tapped FOR MANA specifically. Distinct from
   * `becomes_tapped`, which also fires when a permanent taps to attack or
   * is tapped by an opponent — neither of which is "you tap it for mana".
   */
  | "taps_for_mana"
  /** An opponent drew their second card this turn (Faerie Mastermind). */
  | "opponent_draws_second"
  /** Orcish Bowmasters: every opponent draw but their draw-step first. */
  | "opponent_draws_except_first"
  /** Goldspan Dragon: "whenever ~ becomes the target of a spell". */
  | "becomes_target"
  /** Any player sacrificed a permanent (Mayhem Devil). */
  | "player_sacrifices"
  /** A counter was put on this creature (Fathom Mage). */
  | "counter_added"
  /** A player discarded a card (Waste Not, Bone Miser). Subject is the card. */
  | "discards"
  /** This creature was dealt damage (Enrage — Apex Altisaur). */
  | "is_dealt_damage"
  /** An opponent searched their library (Archivist of Oghma). */
  | "opponent_searches"
  /** Any player cast their second spell this turn (Lotho). */
  | "casts_second_spell"
  /** An opponent cast their first noncreature spell this turn (Esper Sentinel). */
  | "opponent_casts_first_noncreature_spell"
  /** A card went to a graveyard from anywhere but the battlefield (Syr Konrad). */
  | "graveyard_from_elsewhere"
  /** A card left the watcher's controller's graveyard (Syr Konrad). */
  | "leaves_your_graveyard"
  /** The controller drew a card (Psychosis Crawler). */
  | "you_draw"
  /** "When this Class becomes level 2" — the level is on the trigger. */
  | "class_level";

/** An intervening-if condition, checked when the trigger would be queued.
 * Approximation: CR 603.4 also re-checks on resolution; this table checks
 * once at trigger time. */
export type TriggerCondition =
  /** Padeem: the controller has an artifact tied for the greatest mana value. */
  | { kind: "greatest_artifact_mana_value" }
  /** "if you control four or more lands". */
  | { kind: "controls_count"; what: "land" | "creature" | "artifact"; atLeast: number }
  /** Land Tax: "if an opponent controls more lands than you". */
  | { kind: "opponent_controls_more_lands" }
  /** Guardian Project: the subject's name matches no other controlled
   * creature and no creature card in the controller's graveyard. */
  | { kind: "subject_name_unique" }
  /**
   * Boromir, Nix, Roiling Vortex: "if no mana was spent to cast it". Reads
   * the SUBJECT spell's record, so an absent record is no mana — which is
   * what a copy, a cascade and a {0} cost all are.
   */
  | { kind: "no_mana_spent_to_cast" }
  /** Conduit of Worlds: "if you haven't cast a spell this turn". */
  | { kind: "no_spells_cast_this_turn" }
  /** Veil of Summer, Refraction Trap: "if an opponent has cast a blue or
   * black spell this turn". Any ONE opponent, in any of the colours. */
  | { kind: "opponent_cast_color_this_turn"; colors: Color[] }
  /** Opus and friends: "if at least four mana was spent to cast it", and
   * with a colour, adamant's "at least three white mana". */
  | { kind: "mana_spent_to_cast"; atLeast: number; color?: Color }
  /** Garruk's Uprising: "if you control a creature with power N or greater". */
  | { kind: "controls_power_at_least"; power: number }
  /**
   * Kodama of the East Tree: "if it wasn't put onto the battlefield with
   * THIS ability". The intervening `if` is the loop guard, and without it
   * the ability feeds itself.
   */
  | { kind: "subject_not_put_by_watcher" }
  /**
   * Mosswort Bridge: "creatures you control have TOTAL power 10 or
   * greater" — the sum, not the greatest, which is a different question
   * and a much easier one to meet.
   */
  | { kind: "controls_total_power_at_least"; power: number }
  /**
   * Finale of Devastation: "If X is 10 or more". The announced X, which
   * exists only while a spell resolves — a TRIGGER has no X, so this reads
   * false there rather than falling through to some other condition.
   */
  | { kind: "announced_x_at_least"; amount: number }
  /**
   * Selvala: the creature that just entered has power greater than EACH
   * other creature on the battlefield — a strict maximum, so a tie fails.
   */
  | { kind: "subject_power_greatest" }
  /** Karlach: "if it's the first combat phase of the turn". */
  | { kind: "first_combat_this_turn" }
  /**
   * Unbreakable Formation: "if you cast this spell during your main phase".
   *
   * Read when the spell RESOLVES, not when it was cast, and the two cannot
   * disagree: phases do not advance while the stack is non-empty, so a
   * spell cast in its controller's main phase resolves in that same main
   * phase. Recording the cast-time phase on the stack object would be more
   * words for the same answer.
   */
  | { kind: "own_main_phase" }
  /** Mana Vault: "if this artifact is tapped". */
  | { kind: "self_tapped" }
  /** Mystic Sanctuary: "When ~ enters UNTAPPED". */
  | { kind: "self_untapped" }
  /** Dethrone / Scourge: the subject attacker's defender has the most life
   * (or is tied for most). */
  | { kind: "attacking_most_life" }
  /** Felidar Sovereign: "if you have 40 or more life". */
  | { kind: "life_at_least"; amount: number }
  /** Revel in Riches / Emeria: "if you control ten or more Treasures".
   * `excludeSelf` reads "at least five OTHER Mountains" (Valakut). */
  | {
      /**
       * Field of the Dead: "seven or more lands with DIFFERENT NAMES".
       * Distinct names, not a count of lands — seven Wastes is one name.
       */
      kind: "controls_lands_with_different_names";
      atLeast: number;
    }
  | {
      kind: "controls_subtype_count";
      subtype: string;
      atLeast: number;
      excludeSelf?: boolean;
    }
  /** Kederekt Parasite: "if you control a red permanent". */
  | { kind: "controls_colored_permanent"; color: Color }
  /** Essence Flux: "if it's a Spirit" — the first chosen target's subtype. */
  | { kind: "chosen_has_subtype"; subtype: string }
  /** Ophiomancer: "if you control no Snakes". */
  | { kind: "controls_no_subtype"; subtype: string }
  /** Triskaidekaphile: "if you have exactly thirteen cards in your hand". */
  | { kind: "hand_size_exactly"; count: number }
  /** Threshold: "if there are seven or more cards in your graveyard". */
  /** Persist / undying: "if it had no -1/-1 counters on it". Read on the
   * source itself, and after it has already left the battlefield — counters
   * survive the move in this engine, which is what makes the intervening-if
   * answerable at all. */
  | { kind: "self_no_counter"; counter: string }
  /**
   * Combat Celebrant: "if this creature hasn't been exerted this turn".
   * The same flag the untap step spends, asked before it is set.
   */
  | { kind: "self_not_exerted_this_turn" }
  /**
   * Approach of the Second Sun: "if this spell was cast from your hand AND
   * you've cast another spell named this one this game". Both halves at
   * once, because neither is worth a condition on its own and the card
   * asks them together.
   */
  | { kind: "cast_from_hand_and_another_named_this_game" }
  /** Glint-Horn Buccaneer: "Activate only if this creature is attacking." */
  | { kind: "self_attacking" }
  | { kind: "graveyard_cards_at_least"; count: number }
  /** Delirium: "if there are four or more card types among cards in your
   * graveyard". */
  | { kind: "graveyard_card_types_at_least"; count: number }
  /** Morbid: "if a creature died this turn". */
  | { kind: "creature_died_this_turn" }
  /** Jadar-class: "if an opponent controls three or more creatures" — any
   * single opponent, not the table's total. */
  | {
      kind: "opponent_controls_count";
      what: "land" | "creature" | "artifact";
      atLeast: number;
    }
  /** "if you have four or more creature cards in your graveyard". */
  | { kind: "graveyard_creature_cards_at_least"; count: number }
  /** Raid: "if you attacked this turn". */
  | { kind: "attacked_this_turn" }
  /** "if you've drawn more than one card this turn". */
  | { kind: "drew_cards_this_turn"; moreThan: number }
  /** Jace, Wielder of Mysteries: "if your library has no cards in it".
   * The CONTROLLER's library — a rider on their own draw, not a question
   * about the table. */
  | { kind: "library_empty" }
  /** Zacama: "When this enters, IF YOU CAST IT, …". Read on the SOURCE. */
  | { kind: "entered_from_cast" }
  /** The Gaffer: "if you gained 3 or more life this turn". Counts life
   * actually gained, so a doubler's extra half counts — CR 118.3 makes the
   * replaced amount the amount gained. */
  | { kind: "gained_life_this_turn"; atLeast: number }
  /**
   * Bloodchief Ascension: "if an OPPONENT lost 2 or more life this turn" —
   * any one opponent, off the same per-player tally Wound Reflection keeps.
   * Not the change in a life total: losing 2 and gaining 2 back still
   * counts as having lost 2.
   */
  | { kind: "opponent_lost_life_this_turn"; atLeast: number }
  /** Bennie Bracks: "if you created a token this turn". */
  | { kind: "created_token_this_turn" }
  /**
   * Mangara: "if two or more of those creatures are attacking you and/or
   * planeswalkers you control". Planeswalkers are not separate defenders in
   * this engine — every attack names a PLAYER — so "you and/or your
   * planeswalkers" is exactly "you", and the two readings agree.
   */
  | { kind: "attackers_against_you_at_least"; count: number }
  /**
   * Lieutenant (Loyal Apprentice): "if you control your commander". Any of
   * the controller's own commanders being on the battlefield satisfies it —
   * a partner pair needs only one of the two out.
   */
  | { kind: "controls_commander" }
  /**
   * Windbrisk Heights: "you attacked with N or more creatures this turn".
   * The same question `ActivatedAbility.requiresAttackersThisTurn` asks for
   * Minas Tirith, in the shared condition vocabulary — an activation gate
   * synthesized from a printed "if" clause can only speak this language.
   */
  | { kind: "attacked_with_creatures_this_turn"; atLeast: number }
  /** Spinerock Knoll: "an opponent was dealt N or more damage this turn".
   * Any ONE opponent has to clear the bar; the totals are not summed. */
  | { kind: "opponent_damaged_this_turn"; atLeast: number }
  /** Shelldock Isle: "a library has N or fewer cards in it" — ANY library at
   * the table, the controller's own included. */
  | { kind: "library_at_most"; count: number }
  /**
   * Runaway Steam-Kin: "if this creature has fewer than three +1/+1
   * counters on it". Read on the SOURCE of the trigger, like
   * `self_no_counter`, not on whatever the clause targeted.
   *
   * `comparison` is spelled out rather than implied by which bound is
   * present: "fewer than three" and "three or more" are both common on
   * cards, and an optional-bounds shape would make "neither given" and
   * "both given" representable when they mean nothing.
   */
  | {
      kind: "self_counter_count";
      counter: string;
      comparison: "at_least" | "fewer_than";
      count: number;
    };

export type CardTrigger = {
  event: TriggerEvent;
  /** Intervening "if" clause; the trigger is skipped while it fails. */
  condition?: TriggerCondition;
  /**
   * "…, choose one —" triggers (Aether Channeler, Felidar Retreat): the
   * controller picks a mode when the trigger would stack; the chosen mode's
   * effects and targets replace the (empty) top-level ones.
   */
  /**
   * Black Market Connections ("choose one or more") and Hullbreaker Horror
   * ("choose up to one"). Absent means exactly one, which is what every
   * modal trigger written before these asked for.
   */
  modeChoice?: { min: number; max: number };
  /**
   * Gala Greeters, Monument to Endurance: "choose one that hasn't been
   * chosen this turn". The memory is keyed per SOURCE and per trigger
   * index, not per card — two copies of Gala Greeters each track their
   * own, and a permanent with two modal triggers tracks them apart.
   */
  modesOncePerTurn?: boolean;
  modes?: SpellMode[];
  /**
   * Which objects' events fire this trigger (enter_battlefield, dies,
   * attacks). Default "self". "controlled" watches the trigger source's
   * controller's objects; "any" watches everyone's. upkeep/end_step fire at
   * the beginning of the controller's own step and ignore `watch`.
   */
  watch?: "self" | "controlled" | "opponents" | "any" | "attached";
  /**
   * Bloodghast, Silversmote Ghoul: the ability works while this card is in
   * its owner's GRAVEYARD (CR 113.6d), which is the only place it can do
   * what it says. The dispatcher considers battlefield permanents and
   * nothing else, so without this the trigger compiles and never fires.
   */
  fromGraveyard?: boolean;
  /**
   * "When you cast this spell" (CR 603.2c): the trigger fires from the
   * STACK, on the object being cast, and goes on the stack above it so it
   * resolves first. Its own pass in the dispatcher, because the ordinary
   * passes walk the battlefield and the graveyard and a spell is in
   * neither.
   */
  onSelfCast?: boolean;
  /** "another creature": the event subject may not be the source itself. */
  excludeSelf?: boolean;
  /** "deals damage to an opponent": the damaged player must not be the
   * watcher's controller (Curiosity). */
  subjectPlayerOpponent?: boolean;
  /** No Mercy: "deals damage to YOU" — the mirror of the flag above. The
   * damaged player must be the watcher's controller, not merely someone. */
  subjectPlayerSelf?: boolean;
  /** Niv-Mizzet, Visionary: "deals NONCOMBAT damage" — the same
   * deals_damage_to_player event, minus the firings the combat step marks. */
  noncombatOnly?: boolean;
  /** Exalted: only when exactly one creature is attacking. */
  attacksAlone?: boolean;
  /**
   * Filter on the event subject's printed characteristics (landfall, cast
   * triggers). `types` must all be present, `typesAny` needs one of them
   * ("instant or sorcery"), `nonTypes` must all be absent ("noncreature").
   */
  subjectFilter?: {
    types?: string[];
    subtypes?: string[];
    /** "an Aura, Equipment, or Vehicle spell": any listed subtype (Sram). */
    subtypesAny?: string[];
    typesAny?: string[];
    nonTypes?: string[];
    /** The subject must have the watcher's chosen creature type. */
    chosenSubtype?: boolean;
    /** "another nontoken creature" (Ogre Slumlord). */
    nonToken?: boolean;
    /** "a creature token you control" (Curiosity Crafter). */
    tokenOnly?: boolean;
    /** "non-Gnome creatures" (Anim Pakal). */
    nonSubtypes?: string[];
    /** "with power 3 or greater" (Elemental Bond). Computed power. */
    minPower?: number;
    /** "with power 2 or less" (Welcoming Vampire). Computed power. */
    maxPower?: number;
    /** Evolve: the subject outclasses the watcher in power or toughness. */
    greaterPtThanWatcher?: boolean;
    /** Pollywog Prodigy: the cast subject's mana value undercuts the
     * watcher's power. */
    manaValueBelowWatcherPower?: boolean;
    /** Nether Traitor: "put into YOUR graveyard from the battlefield" — the
     * dying card must be owned by the watcher's controller, since a card
     * lands in its OWNER's graveyard. */
    ownedByYou?: boolean;
    /** counter_added triggers: only this counter name fires it. */
    counterName?: string;
    /** "a colorless spell" / "another colorless creature" (Glaring
     * Fleshraker): the subject must have no colors. */
    colorless?: boolean;
    /** Kutzil: computed power above the printed base power. */
    powerAboveBase?: boolean;
    /** Ayara: "another black creature" — every listed color must be present. */
    colors?: Color[];
    /** Tocasia's Welcome: "with mana value 3 or less". */
    maxManaValue?: number;
    /** "with mana value 3 or greater" (Sai). */
    minManaValue?: number;
    /** "a legendary creature you control" (Kytheon's ally trigger). */
    legendary?: boolean;
    /** Kediss: "a commander you control". Not a card type — a role the
     * player's chosen card holds — so it is a flag beside the type rather
     * than a type of its own, and it is read off the player's commander
     * list, not off the card. Named to match `EffectSelector.commanderOnly`,
     * so one idea does not acquire two words. */
    commanderOnly?: boolean;
    /** Kardur: "an attacking creature" — read off the instance, so it is
     * still true for the creature that just died in combat. */
    attacking?: boolean;
    /** Jhoira, Teshar: "a historic spell" — artifact, legendary, or Saga. */
    historic?: boolean;
    /** Amulet of Vigor: the permanent entered TAPPED. Read off the
     * instance, which is still tapped when the enter trigger matches. */
    enteredTapped?: boolean;
    /** "a creature you control with flying" (Dragon Tempest). Read computed,
     * so a granted keyword counts. */
    withKeyword?: Keyword;
    /** "a creature you control without flying" (Kudo). */
    withoutKeyword?: Keyword;
    /** CR 701.48: an Aura or Equipment attached to it, or a counter on it
     * (Kodama of the West Tree). */
    modified?: boolean;
  };
  effects: CardEffect[];
  /** Chosen when the trigger is put on the stack. Empty or omitted means untargeted. */
  targetRequirements?: TargetRequirement[];
  /** Magecraft: a cast_spell trigger that also fires on spell copies. */
  alsoOnCopy?: boolean;
  /** "This ability triggers only once each turn" (Morbid Opportunist). */
  oncePerTurn?: boolean;
  /** "Whenever one or more …": fire once per simultaneous event batch. */
  oncePerBatch?: boolean;
  /**
   * Sheoldred: "At the beginning of each OPPONENT'S upkeep". Fires only on a
   * turn the watcher's controller is not taking, and the step's player rides
   * along as the trigger's subject, so "that player" names the one opponent
   * whose upkeep it is rather than all of them.
   */
  opponentsStepOnly?: boolean;
  /** Curses: "at the beginning of ENCHANTED PLAYER'S upkeep" — the step
   * belongs to whoever this Aura is attached to, not to its controller. */
  enchantedPlayersStep?: boolean;
  /**
   * Trouble in Pairs: "whenever an opponent attacks YOU with two or more
   * creatures". Its presence also switches the `player_attacked` matcher
   * from the Curse reading (the enchanted player was attacked) to this one
   * (the watcher's controller was) — the two cards want different halves
   * of the same event, and an implicit rule would be guesswork.
   */
  minAttackers?: number;
  /** class_level triggers: which level reaching fires this. */
  classLevel?: number;
  /**
   * "At the beginning of EACH end step" / "each upkeep": the step trigger
   * fires on every player's turn, not only its controller's. Omitted means
   * the usual "your" reading.
   */
  eachPlayersStep?: boolean;
};

/** A change the trigger system reacts to. Dispatched synchronously in batches. */
export type EngineEvent =
  | { kind: "enters"; cardId: CardInstanceId }
  | {
      kind: "dies";
      cardId: CardInstanceId;
      controllerId: PlayerId;
      /** Equipment/auras attached before death (Skullclamp watches these). */
      wasAttachedIds?: CardInstanceId[];
      /** Computed power the moment before death (Elenda's token count). */
      powerAtDeath?: number;
    }
  /** `defenderId` is the player attacked, absent when a planeswalker or a
   * battle was. Curses read it; every older watcher ignores it. */
  | { kind: "attacks"; cardId: CardInstanceId; defenderId?: PlayerId }
  /** Curse of Opulence: one event per player attacked this combat, no
   * matter how many creatures came at them. A separate event from
   * `attacks`, which is one per CREATURE. */
  | {
      kind: "player_attacked";
      playerId: PlayerId;
      attackingPlayerId: PlayerId;
      /** How many creatures came at them, for "with two or more". */
      attackerCount: number;
    }
  /** A card reached a graveyard from any zone at all (Kozilek). */
  | { kind: "put_into_graveyard"; cardId: CardInstanceId }
  /** Call of the Ring: a player named a creature as their Ring-bearer. */
  | { kind: "chooses_ring_bearer"; playerId: PlayerId; cardId: CardInstanceId }
  /** The Ring's third tier: an attacker was blocked by this creature. */
  | { kind: "becomes_blocked"; cardId: CardInstanceId; blockerId: CardInstanceId }
  /** A permanent left the battlefield carrying +1/+1 counters — only
   * dispatched when it had any; amount is the p1p1 total (The Ozolith's
   * documented approximation: other counter kinds don't transfer). */
  | {
      kind: "leaves_battlefield";
      cardId: CardInstanceId;
      controllerId: PlayerId;
      amount: number;
    }
  | { kind: "step_begins"; step: Step; playerId: PlayerId }
  | { kind: "class_level"; cardId: CardInstanceId; level: number }
  | { kind: "gains_life"; playerId: PlayerId; amount: number }
  /** Life lost to damage or a lose-life effect (not payments). */
  | { kind: "loses_life"; playerId: PlayerId; amount: number }
  | { kind: "casts"; cardId: CardInstanceId; controllerId: PlayerId }
  /** `amount` feeds "that many"/"that much" bodies (Old Gnawbone, Kediss). */
  | { kind: "combat_damage_to_player"; cardId: CardInstanceId; playerId: PlayerId; amount: number }
  /** Any damage (combat or not) a permanent deals to a player. */
  | {
      kind: "deals_damage_to_player";
      cardId: CardInstanceId;
      playerId: PlayerId;
      /** Spinerock Knoll asks how MUCH, not merely whether. */
      amount: number;
      /** Set when this fires from the combat damage step, so a trigger that
       * only wants NONCOMBAT damage (Niv-Mizzet, Visionary) can pass it by.
       * Combat emits this event alongside `combat_damage_to_player`. */
      combat?: boolean;
    }
  | {
      kind: "draws";
      playerId: PlayerId;
      /**
       * Orcish Bowmasters: "except the FIRST one they draw in each of
       * their draw steps". True only for the first card of the
       * turn-based draw-step batch, so a Howling Mine's extra draw in
       * the same step still counts.
       */
      firstInDrawStep?: boolean;
    }
  /**
   * Goldspan Dragon: a permanent was chosen as a target of a SPELL. Only
   * spells — an ability targeting it is a different trigger, and the
   * card says spell.
   */
  | { kind: "becomes_target"; cardId: CardInstanceId; controllerId: PlayerId }
  /** A token was created under this player's control. One event per token. */
  | { kind: "creates_token"; playerId: PlayerId }
  /** A permanent was sacrificed (cost or effect). */
  | { kind: "sacrifices"; cardId: CardInstanceId; controllerId: PlayerId; wasToken: boolean }
  /** A permanent went from tapped to untapped. */
  | { kind: "untapped"; cardId: CardInstanceId }
  /** A permanent went from untapped to tapped (City of Brass). */
  | { kind: "tapped"; cardId: CardInstanceId }
  /** Burgeoning: a land was played (not merely put onto the battlefield). */
  | { kind: "plays_land"; cardId: CardInstanceId; playerId: PlayerId }
  /** Forbidden Orchard: the same tap, but specifically for mana. */
  | { kind: "tapped_for_mana"; cardId: CardInstanceId }
  /** A player searched their library (found or not). */
  | { kind: "searches_library"; playerId: PlayerId }
  /** A card arrived in a graveyard from a zone other than the battlefield. */
  | { kind: "put_in_graveyard_from_elsewhere"; cardId: CardInstanceId }
  /** A card left a graveyard; ownerId names whose graveyard it was. */
  | { kind: "leaves_graveyard"; cardId: CardInstanceId; ownerId: PlayerId }
  /** A spell copy hit the stack (Magecraft's "or copy" half). */
  | { kind: "copies_spell"; cardId: CardInstanceId; controllerId: PlayerId }
  /** A creature was dealt damage (Enrage — Apex Altisaur). */
  | { kind: "damaged"; cardId: CardInstanceId }
  /** A counter landed on a battlefield card (Fathom Mage). */
  | {
      kind: "counter_added";
      cardId: CardInstanceId;
      counter: string;
      /** How many landed in this batch — Terrasymbiosis draws that many.
       * The batch total AFTER doublers and bonuses, which is what the
       * printed "one or more counters" refers to. */
      amount: number;
    }
  /** A player discarded a card (Waste Not). Subject is the discarded card. */
  | { kind: "discards"; cardId: CardInstanceId; playerId: PlayerId };

/** One triggered ability waiting to be put on the stack. */
export type TriggerCandidate = {
  cardId: CardInstanceId;
  triggerIndex: number;
  /** The event subject: the card that entered/died/was cast, if any. */
  subjectCardId?: CardInstanceId;
  /** The event subject when it is a player (draws, gains life). */
  subjectPlayerId?: PlayerId;
  /** The event's amount ("that much" — life gained or lost). */
  subjectAmount?: number;
  /** What caused this trigger, when an event did — read by trigger doublers
   * (Panharmonicon wants "enters", Teysa Karlov "dies", Isshin "attacks"). */
  causeKind?: "enters" | "dies" | "attacks" | "casts";
};

/** A required player decision that is not priority (targets, later modes). */
export type PendingPrompt =
  | {
      /**
       * APNAP simultaneous-trigger ordering (CR 101.4, 603.3b): the player
       * orders their own triggers; `remaining` holds later players' groups,
       * processed after this choice resolves.
       */
      kind: "order_triggers";
      playerId: PlayerId;
      entries: TriggerCandidate[];
      remaining: { playerId: PlayerId; entries: TriggerCandidate[] }[];
    }
  | {
      kind: "choose_targets";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      /** trigger: a queued trigger needs targets before it stacks.
       * retarget: Deflecting Swat replaces a stack spell's targets. */
      /** free_copy: Isochron Scepter's copy of an imprinted card needs its
       * own targets, and the card being copied is not on the stack. */
      origin: "trigger" | "retarget" | "free_copy";
      /** free_copy: the card the copy is OF. It stays where it is. */
      copyOfCardId?: CardInstanceId;
      triggerIndex?: number;
      /** Modal trigger: the chosen mode whose targets these are. */
      modeIndex?: number;
      stackObjectId?: StackObjectId;
      requirements: TargetRequirement[];
      /** The trigger event's subject, carried through to the stack object. */
      subjectCardId?: CardInstanceId;
      subjectPlayerId?: PlayerId;
      subjectAmount?: number;
    }
  | {
      kind: "may_pay_life_or_enter_tapped";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      amount: number;
    }
  | {
      /** Mox Diamond: discard a land, or this goes to the graveyard. */
      kind: "discard_land_or_graveyard";
      playerId: PlayerId;
      sourceId: CardInstanceId;
    }
  | {
      kind: "choose_creature_type";
      playerId: PlayerId;
      sourceId: CardInstanceId;
    }
  /**
   * One opponent's turn to accept a tempting offer. The chain walks the
   * opponents one at a time; `accepted` is how many have said yes so far,
   * and the controller repeats their action that many times at the end.
   */
  /**
   * Tainted Pact, mid-loop: `cardId` is the card just exiled and offered,
   * and `exiledThisWay` is everything the loop has exiled so far — the
   * name check compares against that list, not against exile at large.
   */
  | {
      kind: "exile_until_taken";
      playerId: PlayerId;
      cardId: CardInstanceId;
      exiledThisWay: CardInstanceId[];
      resumeEffects?: GameEffect[];
    }
  /** The punisher choice: this player picks which branch happens. */
  | {
      kind: "punisher_choice";
      playerId: PlayerId;
      controllerId: PlayerId;
      sourceId: CardInstanceId | null;
      ifTaken: CardEffect[];
      ifDeclined: CardEffect[];
      resumeEffects?: GameEffect[];
    }
  /**
   * Dredge: a draw about to happen, and the cards in this player's
   * graveyard that could replace it. Answering with none takes the draw.
   */
  | {
      kind: "replace_draw_with_dredge";
      playerId: PlayerId;
      cardIds: CardInstanceId[];
      /** Draws still owed after this one, re-issued once it is answered. */
      remaining: number;
      turnDraw?: boolean;
      resumeEffects?: GameEffect[];
    }
  /** Myr Battlesphere: choose which of your untapped Myr to tap. The
   * answer is a set of cards, and its SIZE is the X the rider reads. */
  | {
      kind: "tap_own_for_x";
      playerId: PlayerId;
      sourceId: CardInstanceId | null;
      cardIds: CardInstanceId[];
      rider: CardEffect[];
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "tempting_offer";
      playerId: PlayerId;
      controllerId: PlayerId;
      remaining: PlayerId[];
      accepted: number;
      action: CardEffect[];
      resumeEffects?: GameEffect[];
    }
  /**
   * The divider's half. `cardIds` is everything revealed; the answer says
   * which of them form the first pile, and the rest are the second.
   */
  | {
      kind: "divide_piles";
      playerId: PlayerId;
      cardIds: CardInstanceId[];
      /** The controller, who picks a pile once these are drawn. */
      chooserId: PlayerId;
      taken: "hand" | "graveyard";
      left: "hand" | "graveyard";
      resumeEffects?: GameEffect[];
    }
  /** The controller's half: take the first pile or the second. */
  | {
      kind: "choose_pile";
      playerId: PlayerId;
      first: CardInstanceId[];
      second: CardInstanceId[];
      taken: "hand" | "graveyard";
      left: "hand" | "graveyard";
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "choose_card_name";
      playerId: PlayerId;
      /** Gideon's Intervention remembers the name on the permanent. */
      sourceId?: CardInstanceId;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "choose_color";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      /** Thriving lands: "choose a color other than blue". */
      excludeColor?: Color;
      /** Mother of Runes: the chosen color becomes an until-EOT protection
       * grant on this creature instead of a stored chosenColor. */
      grantProtectionTo?: CardInstanceId;
    }
  | {
      /** Modal trigger (Aether Channeler): pick which mode stacks. */
      kind: "choose_trigger_mode";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      triggerIndex: number;
      /** The modes this trigger has already taken this turn, which it may
       * not take again. Carried on the prompt so the client can grey them
       * and the resolver can refuse them without recomputing the key. */
      spentModes?: number[];
      /** Absent means exactly one. */
      modeChoice?: { min: number; max: number };
      subjectCardId?: CardInstanceId;
      subjectPlayerId?: PlayerId;
      subjectAmount?: number;
    }
  | {
      /** Clone family: pick a permanent for the just-entered card to copy,
       * or decline and keep it as itself. */
      kind: "enter_as_copy";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      scope: EnterAsCopyScope;
      extraCounters?: number;
      /** Mockingbird: only cards with mana value at most this are legal. */
      maxManaValue?: number;
      /** Vesuva: the copy arrives tapped. */
      entersTapped?: boolean;
      /** Cursed Mirror: the copy reverts at end of turn. */
      untilEot?: boolean;
      /** Cursed Mirror: "except it has haste". */
      grantHaste?: boolean;
    }
  | {
      /**
       * Rhystic Study: pay `cost` or `thenEffects` happen. With `whenPaid`,
       * the polarity flips: paying causes the effects ("If you do, …").
       */
      kind: "pay_or_effect";
      playerId: PlayerId;
      cost: string;
      /** Sylvan Library: "pay 4 life or …" — paid from life, not mana. */
      life?: number;
      thenEffects: GameEffect[];
      sourceId: CardInstanceId | null;
      whenPaid?: boolean;
      /**
       * Springheart Nantuko: "If you didn't create a token this way, create
       * a 1/1 green Insect." What happens when the payment is DECLINED,
       * beside `thenEffects` for when it is made — the two are different
       * things and the same prompt owes both.
       */
      elseEffects?: GameEffect[];
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "scry";
      playerId: PlayerId;
      count: number;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "surveil";
      playerId: PlayerId;
      count: number;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "choose_discard";
      playerId: PlayerId;
      count: number;
      resumeEffects?: GameEffect[];
    }
  /**
   * "Put ANY NUMBER of cards from your hand …" — Valakut Awakening, Last
   * March of the Ents. A SIBLING of `choose_discard` rather than a widening
   * of it: that prompt is on the cleanup path and on every discard cost,
   * and the one time a battle-tested path was widened in place here it
   * broke a working card the same hour.
   */
  | {
      kind: "choose_from_hand";
      playerId: PlayerId;
      /** Where the chosen cards go. */
      destination: "library_bottom" | "battlefield";
      /** Last March: "any number of CREATURE cards". */
      types?: string[];
      /**
       * Valakut: "then draw THAT MANY cards plus one" — the count is how
       * many were chosen, which is why the draw happens in the resolver
       * and not as a sibling effect.
       */
      thenDrawPlus?: number;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "choose_card";
      playerId: PlayerId;
      sources: BoundChooseCardSource[];
      thenEffects: CardEffect[];
      sourceId: CardInstanceId | null;
      optional?: boolean;
      thenEffectsIfNone?: CardEffect[];
      /**
       * Braids: the ABILITY's controller, which is not the chooser when an
       * opponent is choosing. "You draw a card" in the effects means this
       * player, and binding against the chooser would hand them the card.
       */
      controllerId?: PlayerId;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerId;
      count: number;
      destinations: LookDestination[];
      /** Hideaway: record the exiled card on this permanent. */
      hideawaySourceId?: CardInstanceId;
      /** Expressive Iteration: the card sent to exile may be played this
       * turn. Distinct from hideaway, which records it on a PERMANENT for a
       * later activation; this is the caster's own impulse window. */
      exilePlayableThisTurn?: boolean;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "search_library";
      playerId: PlayerId;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
      untapIfLands?: number;
      /**
       * Archdruid's Charm: "Put it onto the battlefield tapped if it's a
       * LAND card. Otherwise, put it into your hand." The destination
       * depends on what was found, so `destination` carries the otherwise
       * branch and this carries the land one.
       */
      landsToBattlefieldTapped?: boolean;
      /** Finale of Devastation: the graveyard is part of the pool. */
      alsoGraveyard?: boolean;
      /**
       * Opposition Agent: an opponent controls this search. `playerId`
       * above is already the hijacker, because a prompt is answered by
       * whoever controls the search; this records whose library is
       * actually being dug through, and that everything found is exiled.
       */
      hijackedFrom?: PlayerId;
      resumeEffects?: GameEffect[];
    }
  | {
      /** Pay `cost` or `stackObjectId` is countered (Spell Pierce, ward). */
      kind: "pay_or_counter";
      playerId: PlayerId;
      cost: string;
      stackObjectId: StackObjectId;
      /** Why the payment is due — shown in the UI. */
      reason: "unless_pays" | "ward";
      /**
       * Ward—Pay N life: the tax comes out of life, not mana, so `cost` is
       * empty and this is what is owed. The same field `pay_or_effect`
       * already uses, read by the same branch of the resolver.
       */
      life?: number;
      resumeEffects?: GameEffect[];
    };

export type TopOfLibraryGrant = {
  /** The controller may see the top card of their library at any time. */
  look?: boolean;
  /** "You may play lands from the top of your library." */
  playLands?: boolean;
  /** "You may … cast spells from the top of your library" (no type filter). */
  castAll?: boolean;
  /** "You may cast <type> spells from the top of your library." */
  castTypesAny?: string[];
  /** Mystic Forge: "…and colorless spells". */
  castColorless?: boolean;
  /** Glarb, Calamity's Augur: "cast spells with mana value 4 or greater".
   * Gates the CAST path only — lands (mana value 0) stay playable, matching
   * the "play lands AND cast spells with mana value N or greater" parse. */
  castMinManaValue?: number;
  /** Realmwalker: "creature spells of the chosen type", read from the
   * granting card's chosen creature type. */
  castChosenType?: boolean;
  /**
   * Bolas's Citadel: a spell cast this way pays LIFE equal to its mana
   * value instead of its mana cost. It replaces the cost outright, the
   * same way flashback does, rather than reducing it.
   */
  payLifeInsteadOfMana?: boolean;
  /**
   * Augur of Autumn: the CAST half of the grant is live only with COVEN
   * (CR 702.145) — three or more creatures you control with DIFFERENT
   * powers. Distinct counts, not a headcount: three 2/2s do not turn it
   * on. Named for the cast half alone because Augur's `look` and
   * `playLands` are separate, ungated abilities that share this record.
   */
  castRequiresCoven?: boolean;
};

export type EnterTappedUnless =
  | { kind: "other_lands"; count: number }
  /** "unless you control N or fewer other lands" (slow lands inverted). */
  | { kind: "other_lands_at_most"; count: number }
  | { kind: "legendary_creature" }
  | { kind: "controlled_types"; types: string[] }
  | { kind: "basic_lands"; count: number }
  /**
   * Mystic Sanctuary: "unless you control three or more OTHER Islands".
   * A count of a subtype, and `excludeSelf` matters — the land asking
   * the question is an Island itself, so counting it would let a lone
   * Sanctuary satisfy part of its own clause.
   */
  | {
      kind: "controlled_subtype";
      subtype: string;
      count: number;
      excludeSelf?: boolean;
    }
  /** "unless you have N or more opponents" (Battlebond crowd lands). */
  | { kind: "opponents"; count: number }
  /**
   * "you may reveal a Plains or Island card from your hand. If you don't, ~
   * enters tapped" (SOI/STX reveal lands). Documented approximation: the
   * reveal "may" is auto-taken whenever the hand holds a matching card.
   */
  | { kind: "hand_reveals_types"; types: string[] }
  /**
   * Starting Town: "unless it's your first, second, or third turn of the
   * game". Read against the round counter, which advances once per seat
   * cycle — so round N is every player's Nth turn, and the two agree.
   */
  | { kind: "turn_at_most"; count: number };

/**
 * "Activate only if you control …" / "…and you control a Forest": a gate on
 * the controller's battlefield, checked against printed characteristics.
 * `types`/`subtypes` must ALL be true of one permanent; `subtypesAny` is
 * satisfied by any one of them (the Verge land cycle's "a Plains or a
 * Swamp", where two different permanents may each supply half).
 */
/**
 * A damage-modifying replacement effect on a permanent. Multiplications apply
 * before additions and holders apply in timestamp order — a documented
 * approximation of CR 616.1, which lets the affected player order them.
 */
export type DamageReplacement = {
  /** "double that damage" → 2, "triple" → 3. */
  times?: number;
  /** Torbran: "that much damage plus 2". */
  plus?: number;
  /** Torbran: "a red source you control". Every listed color must be present. */
  sourceColors?: Color[];
  /** Gratuitous Violence: "a creature you control", not any source. */
  sourceMustBeCreature?: boolean;
  /** Torbran, Twinflame Tyrant: only damage aimed at an opponent or a
   * permanent an opponent controls. */
  opponentsOnly?: boolean;
  /**
   * Solphim: "NONCOMBAT damage". The combat step passes `combat: true` and
   * every other damage site leaves it out, so a replacement carrying this
   * flag simply never fires in combat.
   */
  noncombatOnly?: boolean;
};

/**
 * "You may \<cost\> rather than pay this spell's mana cost" (the Force of
 * Will / Flare cycle, Snuff Out, Misdirection). Documented approximation: the
 * alternative is taken only when the printed mana cost cannot be paid, and
 * the cards it needs are auto-picked cheapest-first — so it only ever enables
 * a cast that was impossible, never replaces a better line.
 */
export type AlternativeCastCost = {
  /** "pay 1 life" / "pay 4 life". */
  life?: number;
  /** "exile a blue card from your hand". */
  exileFromHand?: { count: number; colors?: Color[] };
  /** "sacrifice a nontoken red creature". */
  sacrificeCreature?: { colors?: Color[]; nontoken?: boolean };
  /** Snuff Out: "If you control a Swamp". */
  requires?: ControlledGate;
  /**
   * Force of Negation: "If it's NOT your turn". A free counterspell you
   * could also fire on your own turn is a different, better card.
   */
  onlyOnOpponentsTurn?: boolean;
  /**
   * Mindbreak Trap: "If an opponent cast three or more spells this turn."
   * ANY one opponent, off the per-player tally the engine already keeps —
   * a trap that fired on the table's combined total would go off far too
   * often in a four-player game.
   */
  opponentSpellsThisTurn?: number;
};

export type ControlledGate = {
  types?: string[];
  subtypes?: string[];
  /** Verge lands: "you control a Plains or a Swamp". */
  subtypesAny?: string[];
  /** Rivendell: "a legendary creature". */
  legendary?: boolean;
  /** Bonders' Enclave: "a creature with power 4 or greater". */
  minPower?: number;
  /** Topiary Stomper: "seven or more lands" — the gate counts rather than
   * asking whether any one permanent satisfies it. */
  atLeast?: number;
};

export type ActivatedAbility = {
  /** True when the cost includes {T}. */
  tap: boolean;
  /** Extra mana to pay. Empty string means no mana cost. */
  manaCost: string;
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
  /** Defaults to battlefield. Channel activates from hand; Reassembling
   * Skeleton from the graveyard. */
  zone?: "battlefield" | "hand" | "graveyard";
  /** True when the cost includes discarding this card (Channel). */
  discard?: boolean;
  /** True when the cost includes sacrificing this permanent (fetch lands). */
  sacrificeSelf?: boolean;
  /** "Sacrifice a creature:" — the activation sacrifices a chosen controlled
   * permanent of this scope (Viscera Seer, Zuran Orb, Face-Breaker). */
  sacrificeCost?:
    | "creature"
    | "another_creature"
    /** Ayara: "Sacrifice another black creature". */
    | "another_black_creature"
    | "another_creature_or_artifact"
    | "artifact"
    | "creature_or_artifact"
    | "land"
    | "treasure"
    /** Bolas's Citadel: "Sacrifice ten nonland permanents". */
    | "nonland_permanent"
    /** Any permanent you control — only ever paired with `sacrificeSubtype`,
     * because "Sacrifice a Goblin" names no card type. */
    | "permanent"
    /** Fountainport: "Sacrifice a token" — any token, of any type. */
    | "token";
  /** Scavenger Grounds: "Sacrifice a Desert"; Skirk Prospector: "Sacrifice a
   * Goblin". The fodder must also have this subtype (lowercase). Rides
   * alongside `sacrificeCost` so the two filters compose instead of the
   * scope union growing a member per subtype. */
  sacrificeSubtype?: string;
  /** The Dominus cycle: "Sacrifice two other creatures" — how many. The
   * activation supplies one and the rest are auto-taken (documented). */
  sacrificeCount?: number;
  /**
   * Grim Hireling: "Sacrifice X Treasures". The count is the announced X,
   * so it cannot be a fixed `sacrificeCount` — and because the {X} is in
   * the SACRIFICE and not in the mana cost, `xCost` stays 0 while the
   * activation still has to announce a value. X of at least one is
   * required: a zero here would sacrifice nothing and do nothing, and the
   * sacrifice cost has no way to name no victim.
   */
  sacrificeCountFromX?: boolean;
  /** Walking Ballista, Dragon's Hoard, Mikaeus: counters come off the source
   * as part of the cost. */
  removeCounterCost?: { counter: string; count: number };
  /** Devoted Druid: a counter goes ON the source as part of the cost. */
  addCounterCost?: { counter: string; count: number };
  /** Fauna Shaman, Tortured Existence: "Discard a creature card". The card is
   * auto-picked cheapest-first — a documented approximation. */
  discardCost?: { count: number; types?: string[] };
  /** Millikin: "Mill a card". */
  millCost?: number;
  /** Mines of Moria, Drivnod: "Exile three cards from your graveyard". */
  exileFromGraveyardCost?: { count: number; types?: string[] };
  /**
   * Exert (CR 701.39) — Arena of Glory: the permanent taps as usual and
   * then does not untap during its controller's NEXT untap step. The
   * skip is the whole mechanic; without it this is a free tap ability.
   */
  exertSelf?: boolean;
  /** Spirit Guides: exiling this card (from hand) is part of the cost. */
  exileSelf?: boolean;
  /** Life paid as part of the cost (Doom Whisperer). */
  lifeCost?: number;
  /**
   * War Room: "Pay life equal to the number of colors in your commanders'
   * color identity". A live count, so it cannot be a fixed `lifeCost`;
   * read where the cost is checked and again where it is paid.
   */
  lifeCostFromCommanderColors?: boolean;
  /** How many {X} pips the activation cost carries — Treasure Vault's
   * "{X}{X}" charges the announced X twice (CR 601.2b applies to abilities
   * through CR 602.2b). */
  xCost?: number;
  /**
   * Class level-up is a sorcery-speed class ability. Wishclaw Talisman adds
   * "your_turn", which is NOT the same as sorcery timing — it may be
   * activated in combat, or with the stack full, as long as it is your turn.
   */
  timing?: "any" | "sorcery" | "your_turn";
  /**
   * Throne of Eldraine: "Spend only mana of the chosen color to activate
   * this ability." The generic in the printed cost becomes pips of that
   * colour when the ability is activated, which is what the sentence
   * means and leaves the mana core alone.
   */
  payWithChosenColorOnly?: boolean;
  /** "Activate only if you control a Swamp" — a controlled type/subtype gate. */
  requiresControlled?: ControlledGate;
  /** Minas Tirith: "Activate only if you attacked with two or more creatures
   * this turn." */
  requiresAttackersThisTurn?: number;
  /** Idol of Oblivion: "Activate only if you created a token this turn." */
  requiresCreatedToken?: boolean;
  /** "Activate only if <condition>" — the same vocabulary trigger heads use
   * for their intervening "if", so a wording added for one serves both. */
  requiresCondition?: TriggerCondition;
  /** Weathered Wayfarer: "Activate only if an opponent controls more lands
   * than you." */
  requiresOpponentMoreLands?: boolean;
  /** Kamigawa channel lands: {1} less per legendary creature you control. */
  legendaryDiscount?: boolean;
  /** "…: Choose one —" activations (Cankerbloom): the activation picks a
   * mode; its effects and targets replace the (empty) top-level ones. */
  modes?: SpellMode[];
};

export type ReplacementEffect =
  | { kind: "replace_draw"; instead: "skip" }
  | { kind: "enters_tapped" }
  | { kind: "enters_tapped_unless"; unless: EnterTappedUnless }
  | { kind: "enters_tapped_if"; if: EnterTappedUnless }
  | { kind: "may_pay_life_or_enter_tapped"; amount: number }
  /**
   * Mox Diamond: "If this would enter, you may discard a land card
   * instead. If you do, put it onto the battlefield. If you don't, put
   * it into its owner's graveyard."
   *
   * Modelled the way the shock lands already are: the permanent enters
   * and the choice is prompted just after, rather than as a true CR 614
   * replacement. Declining moves it to the graveyard. Documented, and
   * silent in play — nothing can respond between the two.
   */
  | { kind: "discard_land_or_graveyard" }
  /** Rest in Peace: cards and tokens headed to a graveyard are exiled instead. */
  | { kind: "graveyard_to_exile" }
  /**
   * Dauthi Voidwalker: a card headed for an OPPONENT's graveyard is exiled
   * with a void counter instead. Scoped by the card's owner rather than
   * applying to the whole table the way Rest in Peace does — the
   * controller's own graveyard is untouched, which is most of the card.
   */
  | { kind: "opponents_graveyard_to_void_exile" }
  /**
   * Blightsteel Colossus, Progenitus: THIS card, headed for a graveyard
   * from any zone, is shuffled into its owner's library instead. A
   * replacement rather than Kozilek's trigger, and the difference is the
   * whole point — the card never reaches the graveyard, so nothing that
   * watches a graveyard ever sees it and there is no window to respond in.
   */
  | { kind: "self_to_library_shuffled" }
  /**
   * Blightsteel Colossus, Progenitus: THIS card, headed for a graveyard
   * from any zone, is shuffled into its owner's library instead. A
   * replacement rather than Kozilek's trigger, and the difference is the
   * whole point — the card never reaches the graveyard, so nothing that
   * watches a graveyard ever sees it and there is no window to respond in.
   */
  | { kind: "self_to_library_shuffled" }
  /** Laboratory Maniac: the empty-library draw wins instead of losing. */
  | { kind: "empty_draw_wins" }
  /**
   * Anointed Procession / Doubling Season: tokens created under the
   * controller's control are doubled. Ojer Taq TRIPLES, and only creature
   * tokens — one shape rather than a second replacement kind, because
   * multiple multipliers multiply together either way (CR 614.1c).
   */
  | { kind: "double_tokens"; multiplier?: number; creaturesOnly?: boolean }
  /** Doubling Season / Branching Evolution: counters put on permanents the
   * controller controls are doubled; optional counter/creature restriction. */
  | {
      kind: "double_counters";
      counter?: string;
      creaturesOnly?: boolean;
      /** Innkeeper's Talent: "on a permanent or player you control". Any of
       * these card types qualifies, where `creaturesOnly` can only say the
       * one. The two never appear together. */
      typesAny?: string[];
    }
  /** Hardened Scales-family: "that many plus one" (additive, applied before
   * doublers — the controller's optimal CR 616.1 ordering). */
  | {
      kind: "bonus_counters";
      counter?: string;
      creaturesOnly?: boolean;
      /** Ozolith, the Shattered Spire: "on an artifact or creature you
       * control" — either type qualifies. */
      typesAny?: string[];
    }
  /** Rhox Faithmender / Boon Reflection: life gained is doubled. */
  | { kind: "double_life_gain" }
  /**
   * Bloodletter of Aclazotz: "If an OPPONENT would lose life DURING YOUR
   * TURN, they lose twice that much instead." Both halves are restrictions:
   * the controller's own life is untouched, and an opponent's own turn is
   * safe. Damage causes loss of life, so this reaches combat too.
   */
  | { kind: "double_opponent_life_loss_on_your_turn" }
  /** Teferi's Ageless Insight: draws are doubled, except the turn-based
   * first draw of the controller's own draw step. */
  | { kind: "double_draws_except_first" }
  /** Xorn, Stridehangar Automaton, Peregrin Took: "those tokens plus an
   * additional <token>". One extra per batch, not per token. */
  | { kind: "extra_token"; match?: TokenMatch; token: TokenSpec }
  /** Divine Visitation: "…that many <token> are created instead". */
  | { kind: "substitute_tokens"; match?: TokenMatch; token: TokenSpec }
  /** Academy Manufactor: creating any one of these makes one of each. */
  | { kind: "tokens_one_of_each"; subtypes: string[] };

/** Which created tokens a replacement applies to; omitted means all of them. */
export type TokenMatch = { types?: string[]; subtypesAny?: string[] };

/** A token a replacement creates or substitutes in. */
export type TokenSpec = TokenTemplate & { keywords?: Keyword[]; colors?: Color[] };

/**
 * The Urza lands, Ilysian Caryatid: "… If you control X, add <more> instead."
 * A conditional upgrade on what one tap makes. Every gate must hold, so the
 * Urza lands can require two different permanents.
 */
export type ManaUpgrade = {
  requires: ControlledGate[];
  /**
   * Gemstone Caverns: "If ~ has a luck counter on it, instead add one mana
   * of any color." The gate is on the SOURCE's own counters rather than on
   * what its controller has out, which is what `requires` reads.
   */
  selfCounter?: string;
  produces?: Partial<ManaPool>;
  /** Ilysian Caryatid: "add two mana of any one color instead". */
  anyColor?: number;
  /**
   * Incubation Druid: "add three mana of THAT type instead" — the same type
   * the base ability just picked, multiplied. Distinct from `anyColor`,
   * which offers a fresh choice; here the choice has already been made and
   * only the amount changes.
   */
  sameTypeCount?: number;
};

export type ManaAbility = {
  produces: Partial<ManaPool>;
  /** "If you control …, add <more> instead." */
  upgrade?: ManaUpgrade;
  producesOptions: ManaColor[];
  producesAnyColor: boolean;
  damageToController: number;
  /**
   * Pristine Talisman: "{T}: Add {C}. You gain 1 life." The life is part of
   * the mana ability, not a separate effect — parked in
   * `definition.effects` it would never run at all, because a permanent
   * spell resolves by entering the battlefield.
   */
  gainLifeToController?: number;
  /**
   * Mox Poison: "{T}: Add one mana of any color. You get two poison
   * counters." The same trap as `gainLifeToController` one field up — the
   * cost of the mana is part of the mana ability, and left as its own
   * sentence it lands in `definition.effects`, which a permanent never
   * runs. The card would compile with no notes and be a free Mox.
   */
  poisonToController?: number;
  /** Arena of Glory: exerting the land is part of the mana ability's cost. */
  exertSelf?: boolean;
  /** Path of Ancestry: a rider watching where this mana is spent. */
  rider?: ManaRider;
  /** Gilded Lotus: how much of the chosen color one tap adds (default 1). */
  count?: number;
  /** Treasure tokens: tapping for this mana also sacrifices the permanent. */
  sacrificeSelf?: boolean;
  /** Springleaf Drum-class: mana paid from the pool to activate. Costed
   * abilities are never auto-tapped and add nothing to potential mana. */
  costMana?: string;
  /** Phyrexian Altar: sacrificing a chosen controlled permanent is the cost.
   * Never auto-tapped; adds nothing to potential mana. */
  costSacrifice?:
    | "creature"
    | "artifact"
    | "creature_or_artifact"
    | "land"
    | "treasure"
    /** Bolas's Citadel: "Sacrifice ten nonland permanents". */
    | "nonland_permanent"
    /** Skirk Prospector: "Sacrifice a Goblin" — always paired with
     * `costSacrificeSubtype`, which carries the whole filter. */
    | "permanent"
    /** Fountainport: "Sacrifice a token". */
    | "token";
  /** Gilded Goose: "Sacrifice a Food". Lowercase subtype the fodder must have,
   * composing with `costSacrifice` rather than growing that union. */
  costSacrificeSubtype?: string;
  /**
   * Lion's Eye Diamond: "Discard your hand" is part of the cost. The whole
   * hand, not a chosen card, so there is nothing to prompt for — but it is
   * emphatically a cost, which is why `manaAbilityIsCosted` reports it and
   * the auto-tapper never reaches for it.
   */
  costDiscardHand?: boolean;
  /** The ability has no {T} in its cost (usable while tapped, repeatable). */
  noTap?: boolean;
  /** Kami of Whispered Hopes: the amount is the creature's power at tap. */
  countFromPower?: boolean;
  /** Nykthos: the amount is the controller's devotion to the chosen color. */
  countFromDevotion?: boolean;
  /**
   * Three Tree City: the amount is the number of creatures you control
   * of the type chosen as this permanent entered — the same chosen type
   * the rest of the card reads.
   */
  countFromChosenTypeCreatures?: boolean;
  /** Sanctum Weaver: the amount is the controller's enchantment count. */
  countFromEnchantments?: boolean;
  /**
   * Selvala: X is the GREATEST power among creatures you control, not
   * the source's own power (`countFromPower`) and not their sum.
   */
  countFromGreatestControlledPower?: boolean;
  /** Springleaf Drum: tapping a chosen untapped controlled creature is part
   * of the cost. Never auto-tapped; adds nothing to potential mana. */
  costTapCreature?: boolean;
  /** Relic of Legends: the creature tapped for the cost must be legendary. */
  costTapCreatureLegendary?: boolean;
  /**
   * Urza, Lord High Artificer: "Tap an untapped ARTIFACT you control: Add
   * {U}." The same cost one card type over. Every site reads it through
   * `manaAbilityTapCost` rather than testing the two flags itself — a
   * hand-written pair of tests is how one of them ends up unchecked, and
   * an unchecked tap cost is a mana ability that costs nothing.
   */
  costTapArtifact?: boolean;
  /** "Activate only if <condition>" on a mana ability (Shrine of the
   * Forsaken Gods) — the same vocabulary the activated form uses. */
  requiresCondition?: TriggerCondition;
  /** The color choice is limited to what the board offers: colors among
   * controlled legendary creatures/planeswalkers (Mox Amber), colors an
   * opponent's land could produce (Exotic Orchard, Fellwar Stone), or types
   * — colorless included — your own lands could produce (Reflecting Pool).
   * Unusable when the set is empty. */
  anyColorAmong?:
    | "legendary"
    /** Plaza of Heroes: legendary PERMANENTS, so a legendary artifact counts
     * where Mox Amber's narrower wording would not. */
    | "legendary_permanents"
    | "opponent_lands"
    | "your_lands"
    | "commander_identity"
    /** Chrome Mox: the colours of the cards imprinted on this source. */
    | "imprinted";
  /** Heraldic Banner: "{T}: Add one mana of the chosen color" — the source
   * card's chosenColor, picked as it entered. */
  producesChosenColor?: boolean;
  /** Bloom Tender: one mana of each color among permanents you control. */
  producesColorsAmong?: "permanents";
  /** "Activate only if you control a Swamp" on a mana ability. */
  requiresControlled?: ControlledGate;
  /** Mox Opal: "Activate only if you control three or more artifacts." */
  requiresCount?: { what: "artifact" | "creature" | "land"; atLeast: number };
  /** "Spend this mana only to …" — the mana this ability makes is tagged. */
  spendOnly?: ManaRestriction;
};

/**
 * Whom a continuous effect applies to. Matching runs against *computed*
 * characteristics (an effect that makes everything a Sliver feeds Sliver
 * lords), and only battlefield objects are ever affected. All listed names
 * must be present (lowercase).
 */
export type EffectSelector = {
  /** "attached": the permanent this source is attached to (auras, equipment).
   * "opponents": everything the source's controller does NOT control
   * (Elesh Norn's "Creatures your opponents control get -2/-2"). */
  scope: "self" | "controlled" | "all" | "attached" | "opponents";
  types?: string[];
  subtypes?: string[];
  /** "Legendary creatures you control" (Rising of the Day). */
  legendary?: boolean;
  /** "Nonlegendary creatures you control" (Flowering of the White Tree). */
  nonLegendary?: boolean;
  /** Leyline of the Guildpact: "each nonland permanent you control". None
   * of these card types may be present. */
  nonTypes?: string[];
  /** "Commander creatures you control" (Bastion Protector). Matches a
   * commander in any zone-of-play sense the engine tracks: the card is one of
   * its owner's designated commanders. */
  commanderOnly?: boolean;
  /** "Creatures you control with +1/+1 counters on them" (Herald of Secret
   * Streams). */
  withCounter?: string;
  /** Innkeeper's Talent: "Permanents you control with counters on them" —
   * any counter of any kind, where `withCounter` names one. */
  withAnyCounter?: boolean;
  /** Delney: "Creatures you control with power 2 or less". */
  maxPower?: number;
  /** Tetsuko: "with power OR toughness 1 or less". One field rather than
   * two, because either half being small enough qualifies the creature —
   * a pair of separate maxima would read as an AND. */
  maxPowerOrToughness?: number;
  /** "Tokens you control" (Jaheira). */
  tokenOnly?: boolean;
  /** "Nontoken creatures you control" (Rhythm of the Wild). */
  nonToken?: boolean;
  /** Any listed color must be present ("White creatures you control"). */
  colors?: Color[];
  /** The target must have the source's chosen creature type (Vanquisher's Banner). */
  chosenSubtype?: boolean;
  /** The target must have the source's chosen color (Caged Sun, Heraldic Banner). */
  chosenColor?: boolean;
  /** "creatures without flying" (Sundering Eruption). Read computed, so a
   * granted keyword counts. */
  withoutKeyword?: Keyword;
  withKeyword?: Keyword;
  /** "Other Elves you control": the source itself is not affected. */
  excludeSelf?: boolean;
};

/**
 * What a permanent has protection from (CR 702.16). Every field is a
 * separate quality and they OR together: a source matching any one of them
 * is stopped. Printed protection and layer-6 grants merge into one of these,
 * so a card with two protection abilities is not two different shapes.
 *
 * It replaced a bare `Color[]`, which could only say "protection from black"
 * — a third of the printed protection lines in the measured set name a card
 * type, a subtype, or a quality instead.
 */
export type ProtectionFrom = {
  colors?: Color[];
  /** "protection from creatures" / "from instants": card types. */
  types?: string[];
  /** "protection from Humans": a subtype (changelings qualify). */
  subtypes?: string[];
  /** Stonecoil Serpent: "protection from multicolored". */
  multicolored?: boolean;
  /** Giver of Runes: "protection from colorless". */
  colorless?: boolean;
  /**
   * Commander's Plate: "protection from each color that's NOT in your
   * commander's color identity". Resolved against the granting
   * permanent's controller in the layer engine, where state is in hand;
   * a commanderless player has no identity, so every colour is outside
   * it and the Plate is a five-colour shield.
   */
  colorsOutsideCommanderIdentity?: boolean;
  /** Teferi's Protection, The One Ring: stops every source. */
  everything?: boolean;
};

/** What a continuous effect does, in CR 613 layer order (derived from kind). */
export type ContinuousEffectData =
  | { kind: "add_types"; types: string[]; subtypes: string[] } // layer 4
  /**
   * Imprisoned in the Moon, Song of the Dryads: the permanent IS a land,
   * rather than being a land as well. Layer 4 like `add_types`, but it
   * REPLACES the printed types instead of adding to them — "and loses all
   * other card types" is the whole of both cards, and adding would leave a
   * creature that is also a land, still able to attack.
   */
  | { kind: "set_types"; types: string[]; subtypes?: string[] } // layer 4
  /** layer 4: Maskwood Nexus — the affected are every creature type. */
  | { kind: "all_creature_types" }
  | { kind: "set_colors"; colors: Color[] } // layer 5
  | { kind: "grant_keyword"; keyword: Keyword } // layer 6
  /** layer 6: "gain protection from each color" (Akroma's Will). */
  | { kind: "grant_protection"; from: ProtectionFrom }
  /** "gains hexproof from black until end of turn" — layer 6, beside the
   * protection grant it is deliberately not. */
  | { kind: "grant_hexproof_from"; colors: Color[] }
  /** layer 6: "has ward {2}" (Lavaspur Boots). The highest granted amount
   * wins over the printed one rather than stacking — CR 702.21c makes
   * multiple ward abilities trigger separately, which the pay-or-counter
   * prompt cannot yet express (documented). */
  | { kind: "grant_ward"; amount: number }
  /** Hexing Squelcher: "Other creatures you control have \"Ward—Pay 2 life.\"" */
  | { kind: "grant_ward_life"; amount: number }
  /** layer 6: Cryptolith Rite grants a mana ability to matching permanents. */
  | { kind: "grant_mana_ability"; ability: ManaAbility }
  /**
   * layer 6: "Equipped creature has myriad" (Blade of Selves), "Equipped
   * creature has 'Whenever this creature deals combat damage…'" (Kaldra
   * Compleat). The granted ability belongs to the AFFECTED permanent, not to
   * the granting source: it fires from that permanent, "~" in its body means
   * that permanent, and its controller is that permanent's controller. Wave
   * 170's older trick — rewriting a quoted trigger onto the Equipment's own
   * `watch: "attached"` — only works for an ability the attachment itself
   * carries, and cannot express a grant to a whole set.
   */
  | { kind: "grant_trigger"; trigger: CardTrigger }
  /**
   * layer 6: "Lands you control have '{T}: Create a Treasure token.'"
   * (Bootleggers' Stash), "Equipped creature has '{T}: Add one mana of any
   * color.'" (Paradise Mantle). Same ownership rule as `grant_trigger`:
   * the ability is the AFFECTED permanent's, so its cost taps that
   * permanent and "~" in its body is that permanent. A granted ability
   * that only produces mana is a mana ability and belongs in
   * `grant_mana_ability` instead — it must never use the stack.
   */
  | { kind: "grant_activated"; ability: ActivatedAbility }
  // (modify_pt lives in layer 7c; `per` scales it by a live count read from
  // the static source's controller — Nettlecyst.)
  /** layer 6: Shiny Impetus — "is goaded", for as long as the Aura is on. */
  | { kind: "goaded" }
  | { kind: "remove_all_abilities" } // layer 6
  /** layer 6: Shadowspear strips the listed keywords. */
  | { kind: "remove_keywords"; keywords: Keyword[] }
  /**
   * layer 6: Archetype of Imagination — the affected permanents not only
   * LOSE the keyword, they "can't have or gain" it.
   *
   * Distinct from `remove_keywords`, which a later grant re-adds by
   * timestamp (CR 613.7). That is right for Shadowspear and wrong here, so
   * a lock is a set of its own and is applied after every grant has run.
   */
  | { kind: "lock_keywords"; keywords: Keyword[] }
  | {
      // layer 6: combat restrictions (Pacifism, Whispersilk Cloak).
      kind: "restrict";
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
      /** Wayward Swordtooth: the restriction lifts once the source's
       * controller has the city's blessing. */
      unlessCityBlessing?: boolean;
    }
  | { kind: "set_pt"; power: number; toughness: number } // layer 7b
  | {
      kind: "modify_pt";
      power: number;
      toughness: number;
      per?: DynamicCount;
      /** Banner of Kinship: multiply by this named counter on the SOURCE. */
      perSourceCounter?: string;
    }; // layer 7c

/** A static ability printed on a card: applies while its source is on the battlefield. */
export type StaticAbility = {
  selector: EffectSelector;
  effect: ContinuousEffectData;
  /** Brawn: the ability works while this card is in its owner's graveyard. */
  fromGraveyard?: boolean;
  /** "…and you control a Forest": gate on the controller's battlefield
   * (checked against printed characteristics). */
  requiresControlled?: ControlledGate;
  /** Beastmaster Ascension: the ability is live only while the source
   * carries at least this many of the named counter. */
  requiresCounters?: { counter: string; atLeast: number };
  /** Delirium (Dragon's Rage Channeler): live only with four or more card
   * types among the controller's graveyard. */
  /** Topiary Stomper: the ability applies only while the board is BELOW this
   * gate — "can't attack unless you control seven or more lands". Stated as a
   * negation because the printed "unless" says when the ability stops. */
  requiresControlledBelow?: ControlledGate;
  requiresDelirium?: boolean;
  /** Serra Ascendant: "As long as you have 30 or more life". */
  requiresLife?: number;
  /**
   * Bloodghast: "as long as an OPPONENT has 10 or less life". The mirror of
   * `requiresLife` in both directions at once — someone else's life, and a
   * ceiling rather than a floor — so it is its own gate rather than a sign
   * flip on that one.
   */
  requiresOpponentLifeAtMost?: number;
  /**
   * Razorkin Needlehead: "has first strike DURING YOUR TURN". A static that
   * is only live while its controller is the active player — not a keyword
   * the permanent simply has, which is the whole card.
   */
  requiresYourTurn?: boolean;
};

/**
 * A continuous effect created by a resolved spell or ability ("until end of
 * turn"). The affected set locks in when the effect is created (CR 611.2c);
 * it exists independently of its source from then on.
 */
export type ContinuousEffect = {
  id: string;
  sourceId: CardInstanceId | null;
  affected: CardInstanceId[];
  effect: ContinuousEffectData;
  /**
   * "until end of turn" (CR 514.2, swept at cleanup) or "until your next
   * turn" (Elspeth, Teferi), which ends as `forPlayerId`'s next turn
   * BEGINS. The turn-number guard on the second is what makes one created
   * during that player's own turn last a full cycle rather than expiring
   * the instant it resolved — the same shape `playerShields` already uses.
   */
  duration: "until_end_of_turn" | "until_your_next_turn";
  /** Set only for "until your next turn": whose next turn ends it. */
  forPlayerId?: PlayerId;
  /** Set only for "until your next turn": the turn it was made on. */
  createdOnTurn?: number;
  timestamp: number;
};

export type GameLogEntry =
  | {
      kind: "zone_change";
      cardId: CardInstanceId;
      from: ZoneName;
      to: ZoneName;
    }
  | {
      kind: "life_change";
      playerId: PlayerId;
      delta: number;
    }
  | {
      // Ten of them lose the game and there is no gaining them back, so a
      // poison counter arriving unannounced is the one counter a player
      // most needs to see.
      kind: "poison_change";
      playerId: PlayerId;
      delta: number;
    }
  | {
      kind: "override";
      playerId: PlayerId;
      summary: string;
    }
  | {
      kind: "creature_type_chosen";
      cardId: CardInstanceId;
      creatureType: string;
    }
  | {
      kind: "die_roll";
      playerId: PlayerId;
      sides: number;
      result: number;
    }
  | {
      kind: "opening_tie";
      playerIds: PlayerId[];
    }
  | {
      kind: "first_player";
      playerId: PlayerId;
    };

/** Table-agreed correction. Not a comprehensive-rules action. */
export type ManualOverrideChange =
  | { type: "adjust_life"; targetPlayerId: PlayerId; delta: number }
  | { type: "draw"; targetPlayerId: PlayerId; count: number }
  | { type: "mill"; targetPlayerId: PlayerId; count: number }
  | { type: "add_mana"; targetPlayerId: PlayerId; color: ManaColor }
  | { type: "move_card"; cardId: CardInstanceId; toZone: keyof PlayerZones }
  | { type: "set_tapped"; cardId: CardInstanceId; tapped: boolean }
  | { type: "discard_hand" }
  | { type: "create_token"; template: TokenTemplate };

export type GameAction =
  | { kind: "pass_priority"; playerId: PlayerId }
  | {
      kind: "cast_spell";
      playerId: PlayerId;
      cardId: CardInstanceId;
      targets?: ChosenTarget[];
      faceIndex?: number;
      /** Required for modal spells: which bullet was chosen. */
      modeIndex?: number;
      /** Multi-mode spells: the chosen bullets in order. */
      modeIndexes?: number[];
      /** Announced X for {X} costs (CR 601.2b). */
      xValue?: number;
      /** Damage split for divided-damage spells; aligns with `targets`. */
      division?: number[];
      /**
       * Bestow (CR 702.103): cast this creature as an Aura for its bestow
       * cost. A choice at cast time, not an auto-take like evoke — the two
       * modes are both worth having, and for Springheart Nantuko they cost
       * exactly the same.
       */
      bestow?: boolean;
      /** Permanent sacrificed for an additional cast cost (Deadly Dispute). */
      costSacrificeId?: CardInstanceId;
      /** Cards discarded for an additional cast cost. */
      costDiscardIds?: CardInstanceId[];
      /** Splice onto Arcane: cards revealed from hand whose splice costs
       * are paid with this spell's own, and whose effects join it. */
      spliceCardIds?: CardInstanceId[];
    }
  | { kind: "play_land"; playerId: PlayerId; cardId: CardInstanceId; faceIndex?: number }
  | {
      kind: "declare_attackers";
      playerId: PlayerId;
      attacks: CombatAttack[];
    }
  | {
      kind: "declare_blockers";
      playerId: PlayerId;
      blocks: { blockerId: CardInstanceId; attackerId: CardInstanceId }[];
    }
  | { kind: "concede"; playerId: PlayerId }
  | {
      kind: "tap_for_mana";
      playerId: PlayerId;
      cardId: CardInstanceId;
      color?: ManaColor;
      manaIndex?: number;
      /** The permanent sacrificed to a costSacrifice mana ability. */
      costSacrificeId?: CardInstanceId;
      /** The creature tapped for a costTapCreature mana ability. */
      costTapId?: CardInstanceId;
    }
  | {
      kind: "activate_ability";
      playerId: PlayerId;
      cardId: CardInstanceId;
      abilityIndex: number;
      /** Announced X, for an ability whose cost carries {X}. */
      xValue?: number;
      targets?: ChosenTarget[];
      /** Modal activations: which "Choose one —" bullet. */
      modeIndex?: number;
      /** The permanent sacrificed to a sacrificeCost ability. */
      costSacrificeId?: CardInstanceId;
    }
  | {
      kind: "activate_loyalty";
      playerId: PlayerId;
      cardId: CardInstanceId;
      abilityIndex: number;
      targets?: ChosenTarget[];
    }
  | { kind: "keep_hand"; playerId: PlayerId }
  | { kind: "mulligan"; playerId: PlayerId }
  | { kind: "bottom_cards"; playerId: PlayerId; cardIds: CardInstanceId[] }
  | { kind: "manual_override"; playerId: PlayerId; change: ManualOverrideChange }
  | { kind: "turn_face_up"; playerId: PlayerId; cardId: CardInstanceId }
  | { kind: "undo"; playerId: PlayerId }
  | { kind: "roll_die"; playerId: PlayerId; sides: number }
  | { kind: "opening_roll"; playerId: PlayerId }
  | { kind: "advance_step"; playerId: PlayerId }
  | { kind: "advance_turn"; playerId: PlayerId }
  | { kind: "choose_targets"; playerId: PlayerId; targets: ChosenTarget[] }
  | { kind: "resolve_order_triggers"; playerId: PlayerId; order: number[] }
  | { kind: "choose_enter_replacement"; playerId: PlayerId; pay: boolean }
  /** Mox Diamond: discard a land, or it goes to the graveyard. */
  | { kind: "choose_discard_land_or_graveyard"; playerId: PlayerId; discard: boolean }
  | { kind: "resolve_creature_type"; playerId: PlayerId; creatureType: string }
  | { kind: "resolve_card_name"; playerId: PlayerId; cardName: string }
  | { kind: "resolve_divide_piles"; playerId: PlayerId; cardIds: CardInstanceId[] }
  | { kind: "resolve_choose_pile"; playerId: PlayerId; takeFirst: boolean }
  | { kind: "resolve_tempting_offer"; playerId: PlayerId; accept: boolean }
  | { kind: "resolve_tap_own_for_x"; playerId: PlayerId; cardIds: CardInstanceId[] }
  /** `cardId` null takes the draw; otherwise that card is dredged. */
  | { kind: "resolve_dredge"; playerId: PlayerId; cardId: CardInstanceId | null }
  | { kind: "resolve_punisher"; playerId: PlayerId; take: boolean }
  | { kind: "resolve_exile_until_taken"; playerId: PlayerId; take: boolean }
  | { kind: "resolve_color"; playerId: PlayerId; color: Color }
  | { kind: "resolve_scry"; playerId: PlayerId; bottomIds: CardInstanceId[] }
  | { kind: "resolve_surveil"; playerId: PlayerId; graveyardIds: CardInstanceId[] }
  | { kind: "resolve_discard"; playerId: PlayerId; cardIds: CardInstanceId[] }
  /** "Any number" — an EMPTY list is a legal answer, not a missing one. */
  | { kind: "resolve_choose_from_hand"; playerId: PlayerId; cardIds: CardInstanceId[] }
  /** Braids: a null card DECLINES, which an optional choice allows. */
  | { kind: "resolve_choose_card"; playerId: PlayerId; cardId: CardInstanceId | null }
  | { kind: "resolve_enter_copy"; playerId: PlayerId; cardId: CardInstanceId | null }
  | {
      kind: "resolve_trigger_mode";
      playerId: PlayerId;
      /** One mode, the original form. */
      modeIndex?: number;
      /** "Choose one or more" / "up to one": every mode picked, in order. */
      modeIndexes?: number[];
    }
  | {
      kind: "resolve_look_assign";
      playerId: PlayerId;
      assignments: { cardId: CardInstanceId; destination: LookDestination }[];
    }
  | { kind: "resolve_search"; playerId: PlayerId; cardIds: CardInstanceId[] }
  | {
      kind: "resolve_pay";
      playerId: PlayerId;
      pay: boolean;
      /** Mana producers to tap first, in order, with color choices. */
      taps?: { cardId: CardInstanceId; color?: ManaColor; manaIndex?: number }[];
    };

export type GameEvent =
  | { kind: "game_created"; gameId: GameId }
  | { kind: "priority_passed"; playerId: PlayerId }
  | { kind: "player_conceded"; playerId: PlayerId };
