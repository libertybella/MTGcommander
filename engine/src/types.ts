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
  enchant?: "creature";
  /** Planeswalker printed starting loyalty. */
  loyalty?: number;
  /** Planeswalker loyalty abilities: cost may be negative. */
  loyaltyAbilities?: LoyaltyAbility[];
  /** "Choose one —" spells: cast picks exactly one mode (CR 700.2). */
  modes?: SpellMode[];
  /** "Choose two —" / "Choose one or more —": how many modes the cast picks. */
  modeChoice?: { min: number; max: number };
  /** "You have no maximum hand size" while this permanent is on the battlefield. */
  noMaxHandSize?: boolean;
  /** Additional land drops granted each of the controller's turns (Exploration). */
  extraLandDrops?: number;
  /** "This spell can't be countered" (Abrupt Decay). */
  cantBeCountered?: boolean;
  /**
   * "If you control a commander, you may cast this spell without paying its
   * mana cost" (the free-spell cycle). Documented approximation: the free
   * alternative cost is auto-taken whenever the condition holds.
   */
  freeIfCommander?: boolean;
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
  /** "You may cast spells as though they had flash" (Vedalken Orrery). */
  grantsFlash?: boolean;
  /** Howling Mine: each player draws an extra card in their draw step. */
  extraDrawStepDraws?: boolean;
  /** Affinity for artifacts: generic cost shrinks per artifact you control. */
  affinityArtifacts?: boolean;
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
  /** "~ enters with X +1/+1 counters on it" (hydras); X from the announced cost. */
  entersWithXCounters?: boolean;
  /** "As an additional cost to cast this spell, …" (Deadly Dispute). */
  additionalCost?: AdditionalCastCost;
  /** "You may play lands from your graveyard" (Crucible of Worlds). */
  playLandsFromGraveyard?: boolean;
  /** Star P/T: base power and toughness are each this count (CR 613.3a). */
  dynamicPt?: { count: DynamicCount };
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
  /** True after this player declared at least one attacker this turn. */
  attackedThisTurn: boolean;
  /** Set when a draw is attempted from an empty library. SBA then eliminates. */
  failedToDraw: boolean;
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
  delayedEndStep: Array<{ cardId: CardInstanceId; action: "sacrifice" | "exile" }>;
  /** Spells cast by anyone this turn — Storm's copy count (CR 702.40). */
  spellsCastThisTurn: number;
  /** Fog: no combat damage is dealt for the rest of this turn. */
  preventCombatDamage: boolean;
};

export type ZoneReveal = {
  viewerId: PlayerId;
  cardIds: CardInstanceId[];
};

export type LookDestination = "hand" | "library_bottom" | "exile";

/** What a library search may fetch (all listed names must match, lowercase). */
export type SearchFilter = {
  supertypes?: string[];
  types?: string[];
  subtypes?: string[];
  /** "a Plains, Island, Swamp, or Mountain card": any listed subtype matches. */
  subtypesAny?: string[];
  /** "an instant or sorcery card": any listed type matches. */
  typesAny?: string[];
};

export type SearchDestination = "hand" | "battlefield" | "graveyard" | "library_top";

export type CardFilter = "any" | "creature" | "land" | "nonland" | "noncreature_nonland";

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
    }
  | { kind: "tap"; cardId: CardInstanceId }
  | { kind: "untap"; cardId: CardInstanceId }
  | { kind: "add_mana"; playerId: PlayerId; mana: Partial<ManaPool> }
  | {
      kind: "create_token";
      ownerId: PlayerId;
      name: string;
      typeLine: string;
      power?: number | null;
      toughness?: number | null;
    }
  | { kind: "mill"; playerId: PlayerId; count: number }
  | { kind: "discard"; playerId: PlayerId; count: number }
  | { kind: "discard_unless_attacked"; playerId: PlayerId; count: number }
  | { kind: "amass"; playerId: PlayerId; amount: number; subtype?: string }
  | { kind: "reveal_zone"; fromPlayerId: PlayerId; toPlayerId: PlayerId; zone: "hand" }
  | {
      kind: "choose_card";
      chooserId: PlayerId;
      sources: BoundChooseCardSource[];
      thenEffects: CardEffect[];
      sourceId: CardInstanceId | null;
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerId;
      count: number;
      destinations: LookDestination[];
    }
  | { kind: "sacrifice"; cardId: CardInstanceId }
  | { kind: "add_counter"; cardId: CardInstanceId; counter: string; amount: number }
  | { kind: "counter_spell"; stackObjectId: StackObjectId }
  | { kind: "counter_unless_pays"; stackObjectId: StackObjectId; cost: string }
  | { kind: "copy_spell"; stackObjectId: StackObjectId; controllerId: PlayerId }
  | { kind: "extra_combat" }
  | { kind: "untap_all"; playerId: PlayerId; what: "creature" | "land" }
  | { kind: "untap_lands_up_to"; playerId: PlayerId; count: number }
  | { kind: "fog" }
  | { kind: "proliferate"; playerId: PlayerId }
  | {
      kind: "restrict_until_eot";
      cardId: CardInstanceId;
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
    }
  | { kind: "set_class_level"; cardId: CardInstanceId; level: number }
  | { kind: "pt_until_eot"; cardId: CardInstanceId; power: number; toughness: number }
  | { kind: "keyword_until_eot"; cardId: CardInstanceId; keyword: Keyword }
  | { kind: "team_pt_until_eot"; playerId: PlayerId; power: number; toughness: number }
  | { kind: "team_keyword_until_eot"; playerId: PlayerId; keyword: Keyword }
  | {
      kind: "search_library";
      playerId: PlayerId;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
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
    }
  | { kind: "manifest"; playerId: PlayerId; count: number }
  | {
      kind: "counter_on_controlled_creatures";
      playerId: PlayerId;
      counter: string;
      amount: number;
    }
  /** Board wipes: destroy every battlefield permanent of the scope at once. */
  | { kind: "destroy_all"; what: DestroyAllScope; maxManaValue?: number }
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
  /** Bojuka Bog: every card in the player's graveyard is exiled. */
  | { kind: "exile_graveyard"; playerId: PlayerId };

/** What a "Destroy all …" wipe hits. */
export type DestroyAllScope = "creatures" | "artifacts" | "enchantments" | "planeswalkers" | "nonland";

/** What a characteristic-defining P/T counts, relative to the controller. */
export type DynamicCount =
  | "lands_you_control"
  | "creatures_you_control"
  | "artifacts_you_control"
  | "cards_in_your_hand"
  | "cards_in_your_graveyard";

/** "As an additional cost to cast this spell, …" — paid at cast time. */
export type AdditionalCastCost = {
  /** Sacrifice one permanent of this scope. */
  sacrifice?: "creature" | "artifact" | "creature_or_artifact" | "land";
  /** Discard this many cards. */
  discard?: number;
  /** Pay this much life. */
  life?: number;
};

/** A static generic-cost discount on spells the controller casts. */
export type CostReduction = {
  generic: number;
  /** Empty filter means every spell. types all required; typesAny needs one; colors any overlap. */
  filter: { types?: string[]; typesAny?: string[]; subtypesAny?: string[]; colors?: Color[] };
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
  | "nonartifact_creature"
  | "player_or_creature"
  | "spell"
  | "creature_spell"
  | "noncreature_spell"
  | "instant_or_sorcery_spell";

export type TargetRequirement = {
  kind: TargetKind;
  /** "any number of targets": 1..N chosen targets all matching this kind. */
  variable?: boolean;
  /** "target nonblack creature": these colors are illegal. */
  excludeColors?: Color[];
  /** "you don't control" (Cyclonic Rift) / "you control" (Ephemerate). */
  control?: "own" | "not_own";
  /** "with mana value N or less" (Abrupt Decay). */
  maxManaValue?: number;
  /** "with mana value N or greater" (Despark). */
  minManaValue?: number;
  /** "another target …": the effect's own source is not a legal target. */
  excludeSource?: boolean;
};

/** One bullet of a modal spell. Targets are chosen for the picked mode only. */
export type SpellMode = {
  label: string;
  /** Kicker-style modes: extra mana paid when this mode is chosen. */
  extraCost?: string;
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
/** "That player": the trigger event's subject player, or the subject card's controller. */
export type SubjectPlayerRef = { type: "subject_player" };
export type PlayerSelector =
  | PlayerId
  | RelativePlayer
  | ChosenTargetRef
  | ChosenControllerRef
  | SubjectPlayerRef;

export type CardEffectTarget =
  | { type: "player"; playerId: PlayerSelector }
  | { type: "creature"; cardId: CardInstanceId }
  | ChosenTargetRef;

/**
 * Definition-stored effect data. Bound to concrete GameEffect values on resolve.
 */
export type CardEffect =
  | { kind: "gain_life"; playerId: PlayerSelector; amount: number | "subject_amount" }
  | { kind: "lose_life"; playerId: PlayerSelector; amount: number | "subject_amount" }
  | {
      kind: "deal_damage";
      sourceId: CardInstanceId | "self" | null;
      target: CardEffectTarget;
      amount: number | "x";
    }
  | {
      /** X damage divided as the caster chose among the spell's targets. */
      kind: "divided_damage";
      sourceId: CardInstanceId | "self" | null;
      amount: number | "x";
    }
  | { kind: "draw"; playerId: PlayerSelector; count: number; optional?: boolean }
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
    }
  | { kind: "tap"; cardId: CardIdSelector }
  | { kind: "untap"; cardId: CardIdSelector }
  | { kind: "add_mana"; playerId: PlayerSelector; mana: Partial<ManaPool> }
  | {
      kind: "create_token";
      ownerId: PlayerSelector;
      name: string;
      typeLine: string;
      power?: number | null;
      toughness?: number | null;
    }
  | { kind: "mill"; playerId: PlayerSelector; count: number }
  | { kind: "discard"; playerId: PlayerSelector; count: number }
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
    }
  | {
      kind: "look_and_assign";
      playerId: PlayerSelector;
      count: number;
      destinations: LookDestination[];
    }
  | { kind: "sacrifice"; cardId: CardIdSelector }
  | { kind: "add_counter"; cardId: CardIdSelector; counter: string; amount: number }
  | { kind: "counter_spell"; target: ChosenTargetRef }
  | { kind: "counter_unless_pays"; target: ChosenTargetRef; cost: string }
  | { kind: "copy_spell"; target: ChosenTargetRef }
  | { kind: "extra_combat" }
  | { kind: "untap_all"; playerId: PlayerSelector; what: "creature" | "land" }
  | { kind: "untap_lands_up_to"; playerId: PlayerSelector; count: number }
  | { kind: "fog" }
  | { kind: "proliferate"; playerId: PlayerSelector }
  | {
      kind: "restrict_until_eot";
      cardId: CardIdSelector;
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
    }
  /** "copy that spell" in a cast trigger — the subject spell, not a target. */
  | { kind: "copy_subject_spell" }
  /** "counter that spell" in a cast trigger — the subject spell, not a target. */
  | { kind: "counter_subject_spell" }
  | { kind: "set_class_level"; cardId: CardIdSelector; level: number }
  | { kind: "pt_until_eot"; cardId: CardIdSelector; power: number; toughness: number }
  | { kind: "keyword_until_eot"; cardId: CardIdSelector; keyword: Keyword }
  | { kind: "team_pt_until_eot"; playerId: PlayerSelector; power: number; toughness: number }
  | { kind: "team_keyword_until_eot"; playerId: PlayerSelector; keyword: Keyword }
  | {
      kind: "search_library";
      playerId: PlayerSelector;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
    }
  | { kind: "attach"; cardId: CardIdSelector; toId: ChosenTargetRef | CardInstanceId }
  | { kind: "transform"; cardId: CardIdSelector }
  | {
      kind: "copy_token";
      ownerId: PlayerSelector;
      ofCardId: ChosenTargetRef | CardInstanceId;
      /** "create five of those tokens" (kicked Rite of Replication). */
      count?: number;
      /** "It gains haste" / delayed end-step riders (Jaxis-class shells). */
      gainsHaste?: boolean;
      atEndStep?: "sacrifice" | "exile";
    }
  | { kind: "manifest"; playerId: PlayerSelector; count: number }
  | {
      kind: "counter_on_controlled_creatures";
      playerId: PlayerSelector;
      counter: string;
      amount: number;
    }
  | { kind: "destroy_all"; what: DestroyAllScope; maxManaValue?: number }
  | { kind: "unless_pays"; playerId: PlayerSelector; cost: string; effects: CardEffect[] }
  | { kind: "may_pay"; playerId: PlayerSelector; cost: string; effects: CardEffect[] }
  | {
      kind: "damage_all";
      sourceId: CardInstanceId | "self" | null;
      amount: number | "x";
      includePlayers?: boolean;
    }
  | { kind: "flicker"; cardId: CardIdSelector }
  | { kind: "exile_graveyard"; playerId: PlayerSelector };

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
  | "attacks"
  | "upkeep"
  | "end_step"
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
  | "opponent_draws";

export type CardTrigger = {
  event: TriggerEvent;
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
    typesAny?: string[];
    nonTypes?: string[];
    /** The subject must have the watcher's chosen creature type. */
    chosenSubtype?: boolean;
  };
  effects: CardEffect[];
  /** Chosen when the trigger is put on the stack. Empty or omitted means untargeted. */
  targetRequirements?: TargetRequirement[];
  /** "This ability triggers only once each turn" (Morbid Opportunist). */
  oncePerTurn?: boolean;
};

/** A change the trigger system reacts to. Dispatched synchronously in batches. */
export type EngineEvent =
  | { kind: "enters"; cardId: CardInstanceId }
  | { kind: "dies"; cardId: CardInstanceId; controllerId: PlayerId }
  | { kind: "attacks"; cardId: CardInstanceId }
  | { kind: "step_begins"; step: Step }
  | { kind: "gains_life"; playerId: PlayerId; amount: number }
  /** Life lost to damage or a lose-life effect (not payments). */
  | { kind: "loses_life"; playerId: PlayerId; amount: number }
  | { kind: "casts"; cardId: CardInstanceId; controllerId: PlayerId }
  | { kind: "combat_damage_to_player"; cardId: CardInstanceId; playerId: PlayerId }
  /** Any damage (combat or not) a permanent deals to a player. */
  | { kind: "deals_damage_to_player"; cardId: CardInstanceId; playerId: PlayerId }
  | { kind: "draws"; playerId: PlayerId };

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
      origin: "trigger";
      triggerIndex: number;
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

export type ActivatedAbility = {
  /** True when the cost includes {T}. */
  tap: boolean;
  /** Extra mana to pay. Empty string means no mana cost. */
  manaCost: string;
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
  /** Defaults to battlefield. Channel is activated from hand. */
  zone?: "battlefield" | "hand";
  /** True when the cost includes discarding this card (Channel). */
  discard?: boolean;
  /** True when the cost includes sacrificing this permanent (fetch lands). */
  sacrificeSelf?: boolean;
  /** Spirit Guides: exiling this card (from hand) is part of the cost. */
  exileSelf?: boolean;
  /** Life paid as part of the cost (Doom Whisperer). */
  lifeCost?: number;
  /** Class level-up is a sorcery-speed class ability. */
  timing?: "any" | "sorcery";
  /** "Activate only if you control a Swamp" — a controlled type/subtype gate. */
  requiresControlled?: { types?: string[]; subtypes?: string[] };
};

export type ReplacementEffect =
  | { kind: "replace_draw"; instead: "skip" }
  | { kind: "enters_tapped" }
  | { kind: "enters_tapped_unless"; unless: EnterTappedUnless }
  | { kind: "enters_tapped_if"; if: EnterTappedUnless }
  | { kind: "may_pay_life_or_enter_tapped"; amount: number }
  /** Rest in Peace: cards and tokens headed to a graveyard are exiled instead. */
  | { kind: "graveyard_to_exile" }
  /** Anointed Procession / Doubling Season: tokens created under the
   * controller's control are doubled. */
  | { kind: "double_tokens" }
  /** Doubling Season / Branching Evolution: counters put on permanents the
   * controller controls are doubled; optional counter/creature restriction. */
  | { kind: "double_counters"; counter?: string; creaturesOnly?: boolean }
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
  /** "Activate only if you control a Swamp" on a mana ability. */
  requiresControlled?: { types?: string[]; subtypes?: string[] };
};

/**
 * Whom a continuous effect applies to. Matching runs against *computed*
 * characteristics (an effect that makes everything a Sliver feeds Sliver
 * lords), and only battlefield objects are ever affected. All listed names
 * must be present (lowercase).
 */
export type EffectSelector = {
  /** "attached": the permanent this source is attached to (auras, equipment). */
  scope: "self" | "controlled" | "all" | "attached";
  types?: string[];
  subtypes?: string[];
  /** Any listed color must be present ("White creatures you control"). */
  colors?: Color[];
  /** The target must have the source's chosen creature type (Vanquisher's Banner). */
  chosenSubtype?: boolean;
  /** "Other Elves you control": the source itself is not affected. */
  excludeSelf?: boolean;
};

/** What a continuous effect does, in CR 613 layer order (derived from kind). */
export type ContinuousEffectData =
  | { kind: "add_types"; types: string[]; subtypes: string[] } // layer 4
  | { kind: "set_colors"; colors: Color[] } // layer 5
  | { kind: "grant_keyword"; keyword: Keyword } // layer 6
  /** layer 6: Cryptolith Rite grants a mana ability to matching permanents. */
  | { kind: "grant_mana_ability"; ability: ManaAbility }
  | { kind: "remove_all_abilities" } // layer 6
  | {
      // layer 6: combat restrictions (Pacifism, Whispersilk Cloak).
      kind: "restrict";
      cantAttack?: boolean;
      cantBlock?: boolean;
      cantBeBlocked?: boolean;
    }
  | { kind: "set_pt"; power: number; toughness: number } // layer 7b
  | { kind: "modify_pt"; power: number; toughness: number }; // layer 7c

/** A static ability printed on a card: applies while its source is on the battlefield. */
export type StaticAbility = {
  selector: EffectSelector;
  effect: ContinuousEffectData;
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
  | { kind: "tap_for_mana"; playerId: PlayerId; cardId: CardInstanceId; color?: ManaColor; manaIndex?: number }
  | {
      kind: "activate_ability";
      playerId: PlayerId;
      cardId: CardInstanceId;
      abilityIndex: number;
      targets?: ChosenTarget[];
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
  | { kind: "resolve_scry"; playerId: PlayerId; bottomIds: CardInstanceId[] }
  | { kind: "resolve_surveil"; playerId: PlayerId; graveyardIds: CardInstanceId[] }
  | { kind: "resolve_discard"; playerId: PlayerId; cardIds: CardInstanceId[] }
  | { kind: "resolve_choose_card"; playerId: PlayerId; cardId: CardInstanceId }
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
