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
   * Protection from these colors (CR 702.16): can't be targeted, damaged,
   * or blocked by sources of the listed colors.
   */
  protectionFrom?: Color[];
  /** Aura: cast targeting a creature; enters attached (CR 303.4). */
  enchant?: "creature" | "land" | "creature_or_planeswalker_own";
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
  /** Additional land drops granted each of the controller's turns (Exploration). */
  extraLandDrops?: number;
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
  /** Rhythm of the Wild: the controller's creature spells can't be countered. */
  creatureSpellsCantBeCountered?: boolean;
  /** Grand Abolisher: on this permanent's controller's turn, opponents can't
   * cast spells or activate artifact/creature/enchantment abilities. */
  opponentsLockedDuringYourTurn?: boolean;
  /** Voice of Victory / Kutzil: the cast-only half of the Abolisher lock. */
  opponentsCantCastDuringYourTurn?: boolean;
  /** Toski: this creature attacks each combat if able. */
  mustAttack?: boolean;
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
   * exiled as it leaves the stack. Only mana (plus optional life) costs are
   * expressible; sacrifice-cost flashback stays uncompiled.
   */
  flashback?: { manaCost: string; life?: number };
  /**
   * Storm (CR 702.40): casting this copies it once per spell cast before it
   * this turn. Documented approximation: copies are created immediately on
   * cast (not via a stacked trigger) and keep the original's targets.
   */
  storm?: boolean;
  /** "~ doesn't untap during your untap step." */
  doesntUntap?: boolean;
  /** Drumbellower / Seedborn Muse: the controller's creatures (or all their
   * permanents) also untap during each other player's untap step. */
  untapDuringEachUntap?: "creatures" | "permanents" | "artifacts";
  /** Authority of the Consuls: opponents' creatures enter tapped. */
  opponentCreaturesEnterTapped?: boolean;
  /** Blind Obedience: opponents' artifacts enter tapped too. */
  opponentArtifactsEnterTapped?: boolean;
  /** "You may cast spells as though they had flash" (Vedalken Orrery). */
  grantsFlash?: boolean;
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
    per:
      | "noncreature_artifacts_total_mv"
      | "historic_total_mv"
      | "greatest_creature_power"
      | "opponent_stack_3";
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
     * "dies", Isshin "attacks"). Omitted: any trigger (Roaming Throne). */
    cause?: "enters" | "dies" | "attacks";
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
    };
  };
  /** "~ enters with X +1/+1 counters on it" (hydras); X from the announced cost. */
  entersWithXCounters?: boolean;
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
  };
  /** "As an additional cost to cast this spell, …" (Deadly Dispute). */
  additionalCost?: AdditionalCastCost;
  /**
   * Pillow forts: creatures can't attack this permanent's controller unless
   * their controller pays, per attacking creature, `generic` mana (Propaganda),
   * X = the defender's enchantment count (Sphere of Safety), and/or `lifePer`
   * life (Norn's Annex {W/P}, approximated as its life half). Paid from the
   * attacker's floating pool when attackers are declared.
   */
  attackTax?: { generic?: number; perEnchantment?: boolean; lifePer?: number };
  /** "You may play lands from your graveyard" (Crucible of Worlds). */
  playLandsFromGraveyard?: boolean;
  /**
   * Leylines: if in the opening hand, begins the game on the battlefield.
   * Deployed automatically when mulligans finish (the "may" is auto-taken).
   */
  leyline?: boolean;
  /** Gravecrawler: castable from the graveyard while the controller controls
   * a matching permanent. Resolves normally (a creature enters play). */
  castFromGraveyard?: { types?: string[]; subtypes?: string[] };
  /** Ascend: while this is on the battlefield, controlling ten or more
   * permanents grants the city's blessing (checked in the SBA sweep). */
  ascend?: boolean;
  /** Star P/T: base power and toughness are each this count (CR 613.3a). */
  dynamicPt?: { count: DynamicCount };
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
  blockingAttackerId: CardInstanceId | null;
  summoningSick: boolean;
  counters: Record<string, number>;
  /** 0 means not a Class. Class enchantments enter at 1. */
  classLevel: number;
  /** CR 613.7 ordering: stamped when this object entered the battlefield. */
  timestamp: number;
  /** Tokens cease to exist outside the battlefield (CR 704.5d). */
  isToken: boolean;
  /** Damaged by a deathtouch source this turn (CR 704.5h). */
  deathtouched: boolean;
  /** Auras and Equipment: what this permanent is attached to. */
  attachedTo: CardInstanceId | null;
  /** One loyalty ability per turn per planeswalker (CR 606.3-ish V1). */
  loyaltyActivatedThisTurn: boolean;
  /** Manifested: a face-down 2/2 with no name, types, or abilities (CR 708). */
  faceDown: boolean;
  /** "As ~ enters, choose a creature type" (Kindred Discovery). Lowercase. */
  chosenCreatureType: string | null;
  /** Cloud Key: the auto-picked card type (documented approximation). */
  chosenCardType?: string | null;
  /** "As this Aura enters, choose a color" (Utopia Sprawl). */
  chosenColor: Color | null;
  /** Vorinclex, Voice of Hunger froze this permanent: it skips its
   * controller's next untap step, then the flag clears. */
  skipNextUntap?: boolean;
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
  /** How many creatures this player declared as attackers this turn, summed
   * across combat phases (Minas Tirith's "attacked with two or more"). */
  attackersThisTurn?: number;
  /** Set when a draw is attempted from an empty library. SBA then eliminates. */
  failedToDraw: boolean;
  /** Ascend (CR 702.131): once ten or more permanents are controlled while an
   * Ascend source is on the battlefield, the blessing is kept for the game. */
  cityBlessing?: boolean;
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
  /** Damage split for divided-damage spells; aligns with `targets`. */
  division?: number[];
  /**
   * A copy of a spell (CR 707.10): it resolves like the original but is not a
   * card — on resolution or countering it ceases to exist instead of moving
   * the source card anywhere.
   */
  isCopy?: boolean;
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
   * Extra combat phases owed this turn (Aggravated Assault, Seize the Day).
   * Consumed as the postcombat main phase ends: the turn re-enters combat,
   * which naturally flows into another main phase.
   */
  pendingExtraCombats: number;
  /**
   * One-shot delayed actions: "Sacrifice/Exile it at the beginning of the
   * next end step" (temporary tokens and reanimation shells). Processed as
   * the end step begins; entries whose card already left are dropped.
   */
  delayedEndStep: Array<{
    cardId: CardInstanceId;
    action: "sacrifice" | "exile" | "hand" | "battlefield";
    /** Parting Gust: the returned card picks up this counter. */
    withCounter?: string;
    /** action "battlefield" (Charming Prince): who gets the returned card. */
    controllerId?: PlayerId;
  }>;
  /** Spells cast by anyone this turn — Storm's copy count (CR 702.40). */
  spellsCastThisTurn: number;
  /** Per-player casts this turn (Lotho's second-spell watch). */
  spellsCastByPlayerThisTurn?: Record<PlayerId, number>;
  /** Esper Sentinel: per-player noncreature casts this turn. */
  noncreatureSpellsCastByPlayerThisTurn?: Record<PlayerId, number>;
  /** Idol of Oblivion: players who created a token this turn. */
  createdTokenThisTurn?: PlayerId[];
  /** Faerie Mastermind: per-player draws this turn. */
  drawsByPlayerThisTurn?: Record<PlayerId, number>;
  /** Creatures that died this turn (Mahadi's Treasure count). */
  creaturesDiedThisTurn?: number;
  /** Silence: everyone but this player is locked out of casting until end of
   * turn. Cleared at cleanup. */
  castLockUntilEot?: PlayerId;
  /** Ranger-Captain of Eos: everyone but this player is locked out of
   * casting NONCREATURE spells until end of turn. Cleared at cleanup. */
  noncreatureCastLockUntilEot?: PlayerId;
  /**
   * Impulse exiles (Ragavan, Professional Face-Breaker): cards in exile that
   * the listed player may cast or play this turn, paying costs as normal.
   * Cleared at cleanup.
   */
  exilePlayable?: Array<{
    cardId: CardInstanceId;
    casterId: PlayerId;
    freeCast?: boolean;
    /** Atsushi: "until the end of your next turn" — survives cleanups,
     * decremented at the caster's own cleanups, dropped at 0. Entries
     * without it clear at every cleanup as before. */
    remainingOwnCleanups?: number;
  }>;
  /** Rebound: cards waiting in exile to be offered free at the caster's
   * next upkeep. */
  pendingRebounds?: Array<{ cardId: CardInstanceId; casterId: PlayerId }>;
  /** Combat phases begun this turn (Karlach's first-combat condition). */
  combatPhasesThisTurn?: number;
  /** Fog: no combat damage is dealt for the rest of this turn. */
  preventCombatDamage: boolean;
  /** Maze of Ith: creatures whose combat damage (dealt and received) is
   * prevented this turn. Cleared at cleanup. */
  preventCombatFor?: CardInstanceId[];
  /** As Foretold: players who already used their once-per-turn free cast.
   * Cleared at untap alongside the other per-turn tallies. */
  freeCastUsedThisTurn?: PlayerId[];
  /** Emergence Zone / Borne Upon a Wind: players who may cast at instant
   * speed for the rest of this turn. Cleared at cleanup. The permanent form
   * (Vedalken Orrery) is `CardDefinition.grantsFlash` instead. */
  flashThisTurn?: PlayerId[];
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
  /** "with mana value N or less". */
  maxManaValue?: number;
  /** "with mana value X or less": resolved to maxManaValue from the announced
   * X when the effect binds (Green Sun's Zenith). */
  maxManaValueX?: boolean;
  /** "with toughness 2 or less" (Recruiter of the Guard). Printed toughness. */
  maxToughness?: number;
  /** "with power 2 or less" (Imperial Recruiter). Printed power. */
  maxPower?: number;
  /** Transmute: "with the same mana value as this card". */
  exactManaValue?: number;
};

export type SearchDestination = "hand" | "battlefield" | "graveyard" | "library_top";

export type CardFilter =
  | "any"
  | "creature"
  | "nontoken_creature"
  /** Plaguecrafter: "a creature or planeswalker of their choice". */
  | "creature_or_planeswalker"
  | "land"
  | "nonland"
  | "noncreature_nonland";

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
  zone: "hand" | "graveyard" | "battlefield";
  filter: CardFilter;
};

export type BoundChooseCardSource = {
  playerId: PlayerId;
  zone: "hand" | "graveyard" | "battlefield";
  filter: CardFilter;
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
  | {
      kind: "deal_damage";
      sourceId: CardInstanceId | null;
      target: EffectTarget;
      amount: number;
      gainLife?: boolean;
    }
  | {
      kind: "draw";
      playerId: PlayerId;
      count: number;
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
      libraryPosition?: "top" | "bottom" | "shuffled";
      entersTapped?: boolean;
      gainsHaste?: boolean;
      atEndStep?: "sacrifice" | "exile";
      /** Battlefield arrivals: the arriving card is controlled by this player. */
      controllerId?: PlayerId;
    }
  | { kind: "tap"; cardId: CardInstanceId }
  | { kind: "untap"; cardId: CardInstanceId }
  /** "You may tap or untap target creature": toggles the current state — a
   * documented approximation of the choice (Retreat to Coralhelm). */
  | { kind: "tap_or_untap"; cardId: CardInstanceId }
  | { kind: "add_mana"; playerId: PlayerId; mana: Partial<ManaPool> }
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
      entersTappedAttacking?: boolean;
      /** "a tapped 1/1 blue Fish" (the gift mechanic). */
      entersTapped?: boolean;
    }
  | { kind: "mill"; playerId: PlayerId; count: number }
  | { kind: "discard"; playerId: PlayerId; count: number }
  /** Gamble: "discard a card at random". */
  | { kind: "discard_random"; playerId: PlayerId; count: number }
  | { kind: "discard_unless_attacked"; playerId: PlayerId; count: number }
  | { kind: "amass"; playerId: PlayerId; amount: number; subtype?: string }
  | { kind: "reveal_zone"; fromPlayerId: PlayerId; toPlayerId: PlayerId; zone: "hand" }
  | {
      kind: "choose_card";
      chooserId: PlayerId;
      sources: BoundChooseCardSource[];
      thenEffects: CardEffect[];
      sourceId: CardInstanceId | null;
      /** Plaguecrafter: with no legal choice, discard this many instead. */
      cantDiscards?: number;
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerId;
      count: number;
      destinations: LookDestination[];
    }
  | { kind: "sacrifice"; cardId: CardInstanceId }
  | { kind: "add_counter"; cardId: CardInstanceId; counter: string; amount: number }
  /** The Ozolith's combat trigger: every counter hops to the target. */
  | { kind: "move_all_counters"; fromId: CardInstanceId; toId: CardInstanceId }
  | { kind: "counter_spell"; stackObjectId: StackObjectId }
  | {
      kind: "bounce_spell_or_permanent";
      cardId?: CardInstanceId;
      stackObjectId?: StackObjectId;
    }
  | { kind: "exchange_life_toughness"; playerId: PlayerId; sourceId: CardInstanceId }
  | { kind: "counter_unless_pays"; stackObjectId: StackObjectId; cost: string }
  | { kind: "copy_spell"; stackObjectId: StackObjectId; controllerId: PlayerId }
  | { kind: "extra_combat" }
  | { kind: "untap_all"; playerId: PlayerId; what: "creature" | "land" | "attacking" | "nonland" }
  /** Karlach: "They gain first strike until end of turn" on all attackers. */
  | { kind: "attackers_gain_keyword_until_eot"; keyword: Keyword }
  | { kind: "untap_lands_up_to"; playerId: PlayerId; count: number }
  | { kind: "fog" }
  /** Mystic Forge: exile the top card(s) of the player's library. */
  | { kind: "exile_top"; playerId: PlayerId; count: number }
  /** Necropotence: exile the top card; it comes to hand at the next end
   * step (the face-down detail and "your" end step are documented
   * approximations). */
  | { kind: "exile_top_to_hand"; playerId: PlayerId }
  /** Living Death: everyone swaps graveyard creatures with board creatures. */
  | { kind: "living_death" }
  /** Springbloom Druid: the sacrifice is auto-taken with the first
   * controlled land (documented approximations) and gates the effects. */
  | { kind: "may_sacrifice"; controllerId: PlayerId; what: "land"; effects: GameEffect[] }
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
    }
  /** Charming Prince: exile now, return at the next end step. */
  | {
      kind: "exile_return_end_step";
      cardId: CardInstanceId;
      controllerId: PlayerId;
      /** Parting Gust: the returned card picks up this counter. */
      withCounter?: string;
    }
  /** Eerie Interlude: each card returns under its owner's control. */
  | { kind: "exile_return_end_step_all"; cardIds: CardInstanceId[] }
  /** Adapt (CR 701.46): N +1/+1 counters if it has none. */
  | { kind: "adapt"; cardId: CardInstanceId; amount: number }
  | { kind: "populate"; playerId: PlayerId }
  | { kind: "proliferate"; playerId: PlayerId }
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
  | {
      kind: "team_pt_until_eot";
      playerId: PlayerId;
      power: number;
      toughness: number;
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    }
  | {
      kind: "team_keyword_until_eot";
      playerId: PlayerId;
      keyword: Keyword;
      scope?: "permanents";
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    }
  | { kind: "team_protection_until_eot"; playerId: PlayerId; colors: Color[] }
  | {
      kind: "all_pt_until_eot";
      power: number;
      toughness: number;
      /** Crippling Fear: spare creatures of this subtype. */
      exceptSubtype?: string;
    }
  | { kind: "reveal_top_put_permanent"; playerId: PlayerId }
  | { kind: "drain_opponents"; playerId: PlayerId; amount: number }
  | { kind: "silence"; playerId: PlayerId }
  | { kind: "silence_noncreature"; playerId: PlayerId }
  | { kind: "each_creature_damages_controller"; amount: number }
  | { kind: "double_team_pt_until_eot"; playerId: PlayerId }
  | { kind: "power_nova"; sourceId: CardInstanceId; amount: number }
  | { kind: "retarget"; stackObjectId: StackObjectId; controllerId: PlayerId }
  | { kind: "mass_reanimate"; playerId: PlayerId }
  /** Splendid Reclamation: every land card in YOUR graveyard returns tapped. */
  | { kind: "return_all_lands"; playerId: PlayerId }
  | { kind: "prevent_combat_for"; cardId: CardInstanceId }
  | { kind: "extra_land_drop"; playerId: PlayerId }
  /** "You win the game": every other player loses (CR 104.2a). */
  | { kind: "win_game"; playerId: PlayerId }
  /** Emergence Zone: the player may cast at instant speed this turn. */
  | { kind: "grant_flash_this_turn"; playerId: PlayerId }
  /** Rishkar's Expertise: one free cast from hand, capped by mana value. */
  | { kind: "grant_free_cast_from_hand"; playerId: PlayerId; maxManaValue?: number; count: number }
  | { kind: "commander_to_hand"; playerId: PlayerId }
  | { kind: "opponents_lose_keywords_until_eot"; playerId: PlayerId; keywords: Keyword[] }
  | {
      kind: "search_library";
      playerId: PlayerId;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
      untapIfLands?: number;
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
      setPt?: { power: number; toughness: number };
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
      /** Ruinous Ultimatum: only permanents this player does NOT control. */
      opponentsOf?: PlayerId;
      /** Culling Ritual: this player gets one mana of this color per
       * permanent destroyed by the sweep. */
      addManaPerDestroyed?: ManaColor;
      manaTo?: PlayerId;
    }
  /** Rhystic Study: the payer chooses to pay or the effects happen. */
  | { kind: "unless_pays"; playerId: PlayerId; cost: string; effects: GameEffect[] }
  /** "You may pay {N}. If you do, …" — paying causes the effects. */
  | { kind: "may_pay"; playerId: PlayerId; cost: string; effects: GameEffect[] }
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
export type DestroyAllScope = "creatures" | "artifacts" | "enchantments" | "planeswalkers" | "nonland";

/** What a characteristic-defining P/T counts, relative to the controller. */
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
  | "auras_and_equipment_attached_to_it";

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
  /** The spell or ability's source must have all of these card types. */
  types?: string[];
  /** …and this creature subtype, taken from the producer's chosen type. */
  chosenSubtype?: boolean;
  /** …and this literal subtype (Eldrazi Temple). */
  subtype?: string;
  /** …and be legendary (Delighted Halfling). */
  legendary?: boolean;
  /** …and have no colours (Eldrazi Temple). */
  colorless?: boolean;
  /** May it also pay for activated abilities of matching permanents? */
  allowsAbilities?: boolean;
};

/** Restricted mana in a player's pool, tagged with what it may pay for. */
export type RestrictedMana = {
  color: ManaColor;
  amount: number;
  restriction: ManaRestriction;
  /** The permanent that produced it, for `chosenSubtype` lookups. */
  sourceId: CardInstanceId;
};

export type AdditionalCastCost = {
  /** Sacrifice one permanent of this scope. */
  sacrifice?: "creature" | "artifact" | "creature_or_artifact" | "land";
  /** Discard this many cards. */
  discard?: number;
  /** Pay this much life. */
  life?: number;
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
  | "nonland_permanent"
  | "noncreature_nonland_permanent"
  /** A card in the caster's own graveyard (Regrowth / Zombify recursion). */
  | "own_graveyard_card"
  | "own_graveyard_creature_card"
  | "own_graveyard_permanent_card"
  | "own_graveyard_artifact_card"
  /** Titania: "target land card in your graveyard". */
  | "own_graveyard_land_card"
  | "own_graveyard_instant_or_sorcery_card"
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
  /** Venser, Shaper Savant. */
  | "spell_or_permanent";

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
  /** "with mana value N or greater" (Despark). */
  minManaValue?: number;
  /** "with power N or less" (Escape Tunnel). */
  maxPower?: number;
  /** "target nonbasic land" (Wasteland). */
  nonbasicOnly?: boolean;
  /** "target legendary creature" (Shizo). */
  legendaryOnly?: boolean;
  /** "Enchant Forest": the target must have every listed subtype. */
  requiredSubtypes?: string[];
  /** "target blue spell" / "target blue permanent" (Red Elemental Blast). */
  requiredColors?: Color[];
  /** "target attacking creature" (Maze of Ith). */
  attackingOnly?: boolean;
  /** "another target …": the effect's own source is not a legal target. */
  excludeSource?: boolean;
  /** "target non-Dragon creature card" (Junji): none of these subtypes. */
  excludedSubtypes?: string[];
  /** "target creature you own" (Charming Prince): owner must be the caster. */
  owner?: "own";
  /** "target nontoken creature" (Parting Gust). */
  nontoken?: boolean;
};

/** One bullet of a modal spell. Targets are chosen for the picked mode only. */
export type SpellMode = {
  label: string;
  /** Kicker-style modes: extra mana paid when this mode is chosen. */
  extraCost?: string;
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

export type CardIdSelector = CardInstanceId | ChosenTargetRef;

/**
 * Relative player used in untargeted CardDefinition effects.
 * Targeted spells use ChosenTargetRef instead of next_opponent.
 */
export type RelativePlayer = "controller" | "next_opponent" | "each_opponent" | "each_player";
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
      kind: "gain_life";
      playerId: PlayerSelector;
      /** target_power: the first chosen target's computed power at bind
       * (Swords to Plowshares — read before the exile applies). */
      amount: number | "subject_amount" | "subject_toughness" | "target_power";
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
      amount: number | "subject_amount" | "target_mana_value";
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
      amount:
        | number
        | "x"
        | "sacrificed_power"
        | "chosen_power"
        | "subject_power"
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
      count: number | "sacrificed_power" | "x";
      optional?: boolean;
      /** Return of the Wildspeaker: draw the greatest power among the
       * controller's creatures instead, computed when the effect binds. */
      countFromGreatestPower?: { nonSubtypes?: string[] };
      /** Distant Melody: draw per controlled permanent of the auto-chosen
       * type instead, computed when the effect binds. */
      countFromChosenTypePermanents?: boolean;
      /** Shamanic Revelation: one card per controlled creature at bind. */
      countPerControlled?: "creature";
      /** Inspiring Call: multiply the count by a shared dynamic count at bind. */
      perDynamicCount?: DynamicCount;
    }
  | { kind: "scry"; playerId: PlayerSelector; count: number }
  | { kind: "surveil"; playerId: PlayerSelector; count: number }
  | {
      kind: "move_card";
      cardId: CardIdSelector;
      toZone: Exclude<ZoneName, "stack">;
      libraryPosition?: "top" | "bottom" | "shuffled";
      /** Battlefield arrivals only: the card enters tapped. */
      entersTapped?: boolean;
      /** Battlefield arrivals: "It gains haste" riders. */
      gainsHaste?: boolean;
      /** "Sacrifice/Exile it at the beginning of the next end step." */
      atEndStep?: "sacrifice" | "exile";
      /** "onto the battlefield under your control" (Reanimate). */
      underControlOf?: "controller";
    }
  | { kind: "tap"; cardId: CardIdSelector }
  | { kind: "untap"; cardId: CardIdSelector }
  | { kind: "tap_or_untap"; cardId: CardIdSelector }
  | {
      kind: "add_mana";
      playerId: PlayerSelector;
      mana: Partial<ManaPool>;
      /** Jeska's Will: multiply the mana by the chosen player's hand size. */
      perChosenPlayerHand?: boolean;
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
      count?: number | "x";
      /** Brass's Bounty: one token per controlled permanent of this type. */
      perControlled?: "land" | "creature" | "artifact";
      /** Krenko, Myrel: "where X is the number of Goblins you control". */
      perControlledSubtype?: string;
      /** Mahadi: one token per creature that died this turn. */
      perDiedCreatures?: boolean;
      /** Elenda: X tokens where X is the dying subject's power, carried on
       * the dies event and bound from the trigger context. */
      countFromSubjectAmount?: boolean;
      /** Anim Pakal: one token per named counter on the source, counted when
       * the effect applies (after earlier effects in the same batch). */
      perSourceCounters?: string;
      /** "tapped and attacking": joins the current combat against the first
       * declared defender (a documented approximation). */
      entersTappedAttacking?: boolean;
      /** "a tapped 1/1 blue Fish" (the gift mechanic). */
      entersTapped?: boolean;
      /** Mobilize: "Sacrifice them at the beginning of the next end step." */
      atEndStep?: "sacrifice" | "exile";
      /** Scute Swarm: with this many lands, the token is a copy of the
       * source instead of the printed token. */
      copySelfIfLandsAtLeast?: number;
    }
  /** count "sacrificed_power": Altar of Dementia reads the sacrificed
   * cost-creature's power, captured on activation. */
  | { kind: "mill"; playerId: PlayerSelector; count: number | "sacrificed_power" }
  | { kind: "discard"; playerId: PlayerSelector; count: number }
  /** Gamble: "discard a card at random". */
  | { kind: "discard_random"; playerId: PlayerSelector; count: number }
  | { kind: "discard_unless_attacked"; playerId: PlayerSelector; count: number }
  | { kind: "amass"; playerId: PlayerSelector; amount: number; subtype?: string }
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
      /** Plaguecrafter: with no legal choice, discard this many instead. */
      cantDiscards?: number;
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerSelector;
      count: number;
      destinations: LookDestination[];
    }
  | { kind: "sacrifice"; cardId: CardIdSelector }
  /** amount "source_power": the source creature's power, read at bind
   * (Halana and Alena). */
  /** amount "subject_amount": The Ozolith absorbs the leave event's
   * +1/+1-counter total. */
  | {
      kind: "add_counter";
      cardId: CardIdSelector;
      counter: string;
      amount: number | "source_power" | "subject_amount";
    }
  /** The Ozolith's combat trigger: every counter hops to the target. */
  | { kind: "move_all_counters"; cardId: CardIdSelector; target: ChosenTargetRef }
  | { kind: "counter_spell"; target: ChosenTargetRef }
  | { kind: "counter_unless_pays"; target: ChosenTargetRef; cost: string }
  /** Venser: bounce a spell (off the stack) or a permanent to its owner's hand. */
  | { kind: "bounce_spell_or_permanent"; target: ChosenTargetRef }
  /** Tree of Perdition: swap the target's life with the source's toughness. */
  | { kind: "exchange_life_toughness"; playerId: PlayerSelector }
  | { kind: "copy_spell"; target: ChosenTargetRef }
  | { kind: "extra_combat" }
  | {
      kind: "untap_all";
      playerId: PlayerSelector;
      what: "creature" | "land" | "attacking" | "nonland";
    }
  | { kind: "attackers_gain_keyword_until_eot"; keyword: Keyword }
  | { kind: "untap_lands_up_to"; playerId: PlayerSelector; count: number }
  | { kind: "fog" }
  /** Mystic Forge: exile the top card(s) of the player's library. */
  | { kind: "exile_top"; playerId: PlayerSelector; count: number }
  /** Necropotence: exile the top card; to hand at the next end step. */
  | { kind: "exile_top_to_hand"; playerId: PlayerSelector }
  /** Living Death: everyone swaps graveyard creatures with board creatures. */
  | { kind: "living_death" }
  /** Springbloom Druid: auto-taken land sacrifice gating the effects. */
  | { kind: "may_sacrifice"; what: "land"; effects: CardEffect[] }
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
      count: number;
      freeCast?: boolean;
      /** Atsushi: playable "until the end of your next turn". */
      untilEndOfNextTurn?: boolean;
    }
  /** Charming Prince: exile the target; it returns to the battlefield under
   * the effect controller's control at the beginning of the next end step. */
  | {
      kind: "exile_return_end_step";
      target: ChosenTargetRef;
      /** Parting Gust: the card comes back under its OWNER's control. */
      toOwner?: boolean;
      withCounter?: string;
    }
  /** Eerie Interlude: every chosen creature blinks out and returns to its
   * OWNER's battlefield at the next end step. */
  | { kind: "exile_return_end_step_all" }
  /** Adapt (Evolution Witness). */
  | { kind: "adapt"; cardId: CardIdSelector; amount: number }
  | { kind: "populate"; playerId: PlayerSelector }
  | { kind: "proliferate"; playerId: PlayerSelector }
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
      power: number | "target_power";
      toughness: number;
    }
  | { kind: "keyword_until_eot"; cardId: CardIdSelector; keyword: Keyword }
  | {
      kind: "team_pt_until_eot";
      playerId: PlayerSelector;
      /** creature_count: X = the controller's creatures at bind (Craterhoof). */
      power: number | "creature_count";
      toughness: number | "creature_count";
      /** "Non-Human creatures you control" (Return of the Wildspeaker). */
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    } // (unbound team_pt_until_eot)
  | {
      kind: "team_keyword_until_eot";
      playerId: PlayerSelector;
      keyword: Keyword;
      /** "Permanents you control gain …" (Boros Charm). */
      scope?: "permanents";
      nonSubtypes?: string[];
      /** Goreclaw: only creatures with computed power at least this. */
      minPower?: number;
    }
  /** "Creatures you control gain protection from each color" (Akroma's Will). */
  | { kind: "team_protection_until_eot"; playerId: PlayerSelector; colors: Color[] }
  /** "All creatures get -X/-X until end of turn" (Toxic Deluge). */
  | {
      kind: "all_pt_until_eot";
      power: number | "-x";
      toughness: number | "-x";
      /** Crippling Fear: the auto-chosen type is spared. */
      exceptChosenType?: boolean;
    }
  /** Chaos Warp's back half: reveal the top card; a permanent card lands. */
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
  | { kind: "retarget"; target: ChosenTargetRef }
  /** Rise of the Dark Realms: every graveyard creature card, under you. */
  | { kind: "mass_reanimate"; playerId: PlayerSelector }
  /** Splendid Reclamation: every land card in YOUR graveyard returns tapped. */
  | { kind: "return_all_lands"; playerId: PlayerSelector }
  /** Maze of Ith: shield the chosen creature from combat damage this turn. */
  | { kind: "prevent_combat_for"; cardId: ChosenTargetRef }
  /** Explore: one extra land drop this turn. */
  | { kind: "extra_land_drop"; playerId: PlayerSelector }
  /** "You win the game": every other player loses (CR 104.2a). */
  | { kind: "win_game"; playerId: PlayerSelector }
  /** Emergence Zone: the player may cast at instant speed this turn. */
  | { kind: "grant_flash_this_turn"; playerId: PlayerSelector }
  /** Command Beacon: the commander moves from the command zone to hand. */
  /** Rishkar's Expertise: one free cast from hand, capped by mana value.
   * "X or less" (Electrodominance) reads the announced X at bind. */
  | {
      kind: "grant_free_cast_from_hand";
      playerId: PlayerSelector;
      maxManaValue?: number | "x";
      count: number;
    }
  | { kind: "commander_to_hand"; playerId: PlayerSelector }
  /** Shadowspear: opponents' permanents drop the listed keywords this turn. */
  | { kind: "opponents_lose_keywords_until_eot"; keywords: Keyword[] }
  | {
      kind: "search_library";
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
    }
  | { kind: "attach"; cardId: CardIdSelector; toId: ChosenTargetRef | CardInstanceId }
  | { kind: "transform"; cardId: CardIdSelector }
  | {
      kind: "copy_token";
      ownerId: PlayerSelector;
      ofCardId: ChosenTargetRef | CardInstanceId | "self";
      /** "create five of those tokens" (kicked Rite of Replication). */
      count?: number;
      /** "It gains haste" / delayed end-step riders (Jaxis-class shells). */
      gainsHaste?: boolean;
      atEndStep?: "sacrifice" | "exile";
      /** Offspring: the copy's base power and toughness are overridden (1/1). */
      setPt?: { power: number; toughness: number };
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
      /** Ruinous Ultimatum: only permanents the caster does NOT control. */
      opponentsOnly?: boolean;
      /** Culling Ritual: the caster gets one mana per destroyed permanent —
       * the color is auto-picked at bind from these options (first
       * commander-identity match, else the first listed; documented). */
      addManaPerDestroyedOptions?: ManaColor[];
    }
  | {
      kind: "unless_pays";
      playerId: PlayerSelector;
      cost: string;
      /** Esper Sentinel: the cost is {X}, X = the source's power at bind. */
      costFromPower?: boolean;
      effects: CardEffect[];
    }
  | { kind: "may_pay"; playerId: PlayerSelector; cost: string; effects: CardEffect[] }
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
  | "skulk";

export type TriggerEvent =
  | "enter_battlefield"
  | "begin_combat"
  | "dies"
  /** The Ozolith: a counter-carrying permanent left the battlefield. */
  | "leaves_battlefield"
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
  /** Any permanent tapped (City of Brass, Magda). Subject is the permanent. */
  | "becomes_tapped"
  /** An opponent drew their second card this turn (Faerie Mastermind). */
  | "opponent_draws_second"
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
  | "you_draw";

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
  /** Garruk's Uprising: "if you control a creature with power N or greater". */
  | { kind: "controls_power_at_least"; power: number }
  /** Karlach: "if it's the first combat phase of the turn". */
  | { kind: "first_combat_this_turn" }
  /** Mana Vault: "if this artifact is tapped". */
  | { kind: "self_tapped" }
  /** Dethrone / Scourge: the subject attacker's defender has the most life
   * (or is tied for most). */
  | { kind: "attacking_most_life" }
  /** Felidar Sovereign: "if you have 40 or more life". */
  | { kind: "life_at_least"; amount: number }
  /** Revel in Riches / Emeria: "if you control ten or more Treasures". */
  | { kind: "controls_subtype_count"; subtype: string; atLeast: number }
  /** Ophiomancer: "if you control no Snakes". */
  | { kind: "controls_no_subtype"; subtype: string }
  /** Triskaidekaphile: "if you have exactly thirteen cards in your hand". */
  | { kind: "hand_size_exactly"; count: number };

export type CardTrigger = {
  event: TriggerEvent;
  /** Intervening "if" clause; the trigger is skipped while it fails. */
  condition?: TriggerCondition;
  /**
   * "…, choose one —" triggers (Aether Channeler, Felidar Retreat): the
   * controller picks a mode when the trigger would stack; the chosen mode's
   * effects and targets replace the (empty) top-level ones.
   */
  modes?: SpellMode[];
  /**
   * Which objects' events fire this trigger (enter_battlefield, dies,
   * attacks). Default "self". "controlled" watches the trigger source's
   * controller's objects; "any" watches everyone's. upkeep/end_step fire at
   * the beginning of the controller's own step and ignore `watch`.
   */
  watch?: "self" | "controlled" | "opponents" | "any" | "attached";
  /** "another creature": the event subject may not be the source itself. */
  excludeSelf?: boolean;
  /** "deals damage to an opponent": the damaged player must not be the
   * watcher's controller (Curiosity). */
  subjectPlayerOpponent?: boolean;
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
    /** Jhoira, Teshar: "a historic spell" — artifact, legendary, or Saga. */
    historic?: boolean;
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
  | { kind: "attacks"; cardId: CardInstanceId }
  /** A permanent left the battlefield carrying +1/+1 counters — only
   * dispatched when it had any; amount is the p1p1 total (The Ozolith's
   * documented approximation: other counter kinds don't transfer). */
  | {
      kind: "leaves_battlefield";
      cardId: CardInstanceId;
      controllerId: PlayerId;
      amount: number;
    }
  | { kind: "step_begins"; step: Step }
  | { kind: "gains_life"; playerId: PlayerId; amount: number }
  /** Life lost to damage or a lose-life effect (not payments). */
  | { kind: "loses_life"; playerId: PlayerId; amount: number }
  | { kind: "casts"; cardId: CardInstanceId; controllerId: PlayerId }
  /** `amount` feeds "that many"/"that much" bodies (Old Gnawbone, Kediss). */
  | { kind: "combat_damage_to_player"; cardId: CardInstanceId; playerId: PlayerId; amount: number }
  /** Any damage (combat or not) a permanent deals to a player. */
  | { kind: "deals_damage_to_player"; cardId: CardInstanceId; playerId: PlayerId }
  | { kind: "draws"; playerId: PlayerId }
  /** A token was created under this player's control. One event per token. */
  | { kind: "creates_token"; playerId: PlayerId }
  /** A permanent was sacrificed (cost or effect). */
  | { kind: "sacrifices"; cardId: CardInstanceId; controllerId: PlayerId; wasToken: boolean }
  /** A permanent went from tapped to untapped. */
  | { kind: "untapped"; cardId: CardInstanceId }
  /** A permanent went from untapped to tapped (City of Brass). */
  | { kind: "tapped"; cardId: CardInstanceId }
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
  | { kind: "counter_added"; cardId: CardInstanceId; counter: string }
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
  causeKind?: "enters" | "dies" | "attacks";
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
      origin: "trigger" | "retarget";
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
      kind: "choose_creature_type";
      playerId: PlayerId;
      sourceId: CardInstanceId;
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
    }
  | {
      /**
       * Rhystic Study: pay `cost` or `thenEffects` happen. With `whenPaid`,
       * the polarity flips: paying causes the effects ("If you do, …").
       */
      kind: "pay_or_effect";
      playerId: PlayerId;
      cost: string;
      thenEffects: GameEffect[];
      sourceId: CardInstanceId | null;
      whenPaid?: boolean;
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
  | {
      kind: "choose_card";
      playerId: PlayerId;
      sources: BoundChooseCardSource[];
      thenEffects: CardEffect[];
      sourceId: CardInstanceId | null;
      resumeEffects?: GameEffect[];
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerId;
      count: number;
      destinations: LookDestination[];
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
  /** Realmwalker: "creature spells of the chosen type", read from the
   * granting card's chosen creature type. */
  castChosenType?: boolean;
};

export type EnterTappedUnless =
  | { kind: "other_lands"; count: number }
  /** "unless you control N or fewer other lands" (slow lands inverted). */
  | { kind: "other_lands_at_most"; count: number }
  | { kind: "legendary_creature" }
  | { kind: "controlled_types"; types: string[] }
  | { kind: "basic_lands"; count: number }
  /** "unless you have N or more opponents" (Battlebond crowd lands). */
  | { kind: "opponents"; count: number }
  /**
   * "you may reveal a Plains or Island card from your hand. If you don't, ~
   * enters tapped" (SOI/STX reveal lands). Documented approximation: the
   * reveal "may" is auto-taken whenever the hand holds a matching card.
   */
  | { kind: "hand_reveals_types"; types: string[] };

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
    /** Any permanent you control — only ever paired with `sacrificeSubtype`,
     * because "Sacrifice a Goblin" names no card type. */
    | "permanent";
  /** Scavenger Grounds: "Sacrifice a Desert"; Skirk Prospector: "Sacrifice a
   * Goblin". The fodder must also have this subtype (lowercase). Rides
   * alongside `sacrificeCost` so the two filters compose instead of the
   * scope union growing a member per subtype. */
  sacrificeSubtype?: string;
  /** The Dominus cycle: "Sacrifice two other creatures" — how many. The
   * activation supplies one and the rest are auto-taken (documented). */
  sacrificeCount?: number;
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
  /** Spirit Guides: exiling this card (from hand) is part of the cost. */
  exileSelf?: boolean;
  /** Life paid as part of the cost (Doom Whisperer). */
  lifeCost?: number;
  /** Class level-up is a sorcery-speed class ability. */
  timing?: "any" | "sorcery";
  /** "Activate only if you control a Swamp" — a controlled type/subtype gate. */
  requiresControlled?: ControlledGate;
  /** Minas Tirith: "Activate only if you attacked with two or more creatures
   * this turn." */
  requiresAttackersThisTurn?: number;
  /** Idol of Oblivion: "Activate only if you created a token this turn." */
  requiresCreatedToken?: boolean;
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
  /** Rest in Peace: cards and tokens headed to a graveyard are exiled instead. */
  | { kind: "graveyard_to_exile" }
  /** Laboratory Maniac: the empty-library draw wins instead of losing. */
  | { kind: "empty_draw_wins" }
  /** Anointed Procession / Doubling Season: tokens created under the
   * controller's control are doubled. */
  | { kind: "double_tokens" }
  /** Doubling Season / Branching Evolution: counters put on permanents the
   * controller controls are doubled; optional counter/creature restriction. */
  | { kind: "double_counters"; counter?: string; creaturesOnly?: boolean }
  /** Hardened Scales-family: "that many plus one" (additive, applied before
   * doublers — the controller's optimal CR 616.1 ordering). */
  | { kind: "bonus_counters"; counter?: string; creaturesOnly?: boolean }
  /** Rhox Faithmender / Boon Reflection: life gained is doubled. */
  | { kind: "double_life_gain" }
  /** Teferi's Ageless Insight: draws are doubled, except the turn-based
   * first draw of the controller's own draw step. */
  | { kind: "double_draws_except_first" };

export type ManaAbility = {
  produces: Partial<ManaPool>;
  producesOptions: ManaColor[];
  producesAnyColor: boolean;
  damageToController: number;
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
    /** Skirk Prospector: "Sacrifice a Goblin" — always paired with
     * `costSacrificeSubtype`, which carries the whole filter. */
    | "permanent";
  /** Gilded Goose: "Sacrifice a Food". Lowercase subtype the fodder must have,
   * composing with `costSacrifice` rather than growing that union. */
  costSacrificeSubtype?: string;
  /** The ability has no {T} in its cost (usable while tapped, repeatable). */
  noTap?: boolean;
  /** Kami of Whispered Hopes: the amount is the creature's power at tap. */
  countFromPower?: boolean;
  /** Nykthos: the amount is the controller's devotion to the chosen color. */
  countFromDevotion?: boolean;
  /** Sanctum Weaver: the amount is the controller's enchantment count. */
  countFromEnchantments?: boolean;
  /** Springleaf Drum: tapping a chosen untapped controlled creature is part
   * of the cost. Never auto-tapped; adds nothing to potential mana. */
  costTapCreature?: boolean;
  /** The color choice is limited to what the board offers: colors among
   * controlled legendary creatures/planeswalkers (Mox Amber), colors an
   * opponent's land could produce (Exotic Orchard, Fellwar Stone), or types
   * — colorless included — your own lands could produce (Reflecting Pool).
   * Unusable when the set is empty. */
  anyColorAmong?: "legendary" | "opponent_lands" | "your_lands" | "commander_identity";
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
  /** "Commander creatures you control" (Bastion Protector). Matches a
   * commander in any zone-of-play sense the engine tracks: the card is one of
   * its owner's designated commanders. */
  commanderOnly?: boolean;
  /** "Creatures you control with +1/+1 counters on them" (Herald of Secret
   * Streams). */
  withCounter?: string;
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
  /** "Other Elves you control": the source itself is not affected. */
  excludeSelf?: boolean;
};

/** What a continuous effect does, in CR 613 layer order (derived from kind). */
export type ContinuousEffectData =
  | { kind: "add_types"; types: string[]; subtypes: string[] } // layer 4
  /** layer 4: Maskwood Nexus — the affected are every creature type. */
  | { kind: "all_creature_types" }
  | { kind: "set_colors"; colors: Color[] } // layer 5
  | { kind: "grant_keyword"; keyword: Keyword } // layer 6
  /** layer 6: "gain protection from each color" (Akroma's Will). */
  | { kind: "grant_protection"; colors: Color[] }
  /** layer 6: "has ward {2}" (Lavaspur Boots). The highest granted amount
   * wins over the printed one rather than stacking — CR 702.21c makes
   * multiple ward abilities trigger separately, which the pay-or-counter
   * prompt cannot yet express (documented). */
  | { kind: "grant_ward"; amount: number }
  /** layer 6: Cryptolith Rite grants a mana ability to matching permanents. */
  | { kind: "grant_mana_ability"; ability: ManaAbility }
  // (modify_pt lives in layer 7c; `per` scales it by a live count read from
  // the static source's controller — Nettlecyst.)
  | { kind: "remove_all_abilities" } // layer 6
  /** layer 6: Shadowspear strips the listed keywords. */
  | { kind: "remove_keywords"; keywords: Keyword[] }
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
  requiresDelirium?: boolean;
  /** Serra Ascendant: "As long as you have 30 or more life". */
  requiresLife?: number;
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
  duration: "until_end_of_turn";
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
      /** Permanent sacrificed for an additional cast cost (Deadly Dispute). */
      costSacrificeId?: CardInstanceId;
      /** Cards discarded for an additional cast cost. */
      costDiscardIds?: CardInstanceId[];
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
  | { kind: "resolve_creature_type"; playerId: PlayerId; creatureType: string }
  | { kind: "resolve_color"; playerId: PlayerId; color: Color }
  | { kind: "resolve_scry"; playerId: PlayerId; bottomIds: CardInstanceId[] }
  | { kind: "resolve_surveil"; playerId: PlayerId; graveyardIds: CardInstanceId[] }
  | { kind: "resolve_discard"; playerId: PlayerId; cardIds: CardInstanceId[] }
  | { kind: "resolve_choose_card"; playerId: PlayerId; cardId: CardInstanceId }
  | { kind: "resolve_enter_copy"; playerId: PlayerId; cardId: CardInstanceId | null }
  | { kind: "resolve_trigger_mode"; playerId: PlayerId; modeIndex: number }
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
