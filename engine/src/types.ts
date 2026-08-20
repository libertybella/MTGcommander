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
  /** "Choose one —" spells: cast picks exactly one mode (CR 700.2). */
  modes?: SpellMode[];
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
  /** Index into the source definition's `activated` for stacked abilities. */
  activatedIndex?: number;
  /** Chosen mode index for modal spells. */
  modeIndex?: number;
  /** Announced X for {X} costs. */
  xValue?: number;
  /** Damage split for divided-damage spells; aligns with `targets`. */
  division?: number[];
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
};

export type SearchDestination = "hand" | "battlefield" | "graveyard";

export type CardFilter = "any" | "nonland" | "noncreature_nonland";

export type ChooseCardSource = {
  playerId: PlayerSelector;
  zone: "hand" | "graveyard";
  filter: CardFilter;
};

export type BoundChooseCardSource = {
  playerId: PlayerId;
  zone: "hand" | "graveyard";
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
  | { kind: "draw"; playerId: PlayerId; count: number }
  | { kind: "scry"; playerId: PlayerId; count: number }
  | { kind: "surveil"; playerId: PlayerId; count: number }
  | {
      kind: "move_card";
      cardId: CardInstanceId;
      toZone: Exclude<ZoneName, "stack">;
      libraryPosition?: "top" | "bottom";
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
  | { kind: "set_class_level"; cardId: CardInstanceId; level: number }
  | { kind: "pt_until_eot"; cardId: CardInstanceId; power: number; toughness: number }
  | { kind: "keyword_until_eot"; cardId: CardInstanceId; keyword: Keyword }
  | { kind: "team_pt_until_eot"; playerId: PlayerId; power: number; toughness: number }
  | {
      kind: "search_library";
      playerId: PlayerId;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
    };

export type EffectTarget =
  | { type: "player"; playerId: PlayerId }
  | { type: "creature"; cardId: CardInstanceId };

export type TargetKind =
  | "player"
  | "opponent"
  | "creature"
  | "nonartifact_creature"
  | "player_or_creature"
  | "spell"
  | "creature_spell"
  | "noncreature_spell";

export type TargetRequirement = {
  kind: TargetKind;
  /** "any number of targets": 1..N chosen targets all matching this kind. */
  variable?: boolean;
};

/** One bullet of a modal spell. Targets are chosen for the picked mode only. */
export type SpellMode = {
  label: string;
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
export type RelativePlayer = "controller" | "next_opponent" | "each_opponent";
export type PlayerSelector = PlayerId | RelativePlayer | ChosenTargetRef;

export type CardEffectTarget =
  | { type: "player"; playerId: PlayerSelector }
  | { type: "creature"; cardId: CardInstanceId }
  | ChosenTargetRef;

/**
 * Definition-stored effect data. Bound to concrete GameEffect values on resolve.
 */
export type CardEffect =
  | { kind: "gain_life"; playerId: PlayerSelector; amount: number }
  | { kind: "lose_life"; playerId: PlayerSelector; amount: number }
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
  | { kind: "draw"; playerId: PlayerSelector; count: number }
  | { kind: "scry"; playerId: PlayerSelector; count: number }
  | { kind: "surveil"; playerId: PlayerSelector; count: number }
  | {
      kind: "move_card";
      cardId: CardIdSelector;
      toZone: Exclude<ZoneName, "stack">;
      libraryPosition?: "top" | "bottom";
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
  | { kind: "set_class_level"; cardId: CardIdSelector; level: number }
  | { kind: "pt_until_eot"; cardId: CardIdSelector; power: number; toughness: number }
  | { kind: "keyword_until_eot"; cardId: CardIdSelector; keyword: Keyword }
  | { kind: "team_pt_until_eot"; playerId: PlayerSelector; power: number; toughness: number }
  | {
      kind: "search_library";
      playerId: PlayerSelector;
      filter: SearchFilter;
      destination: SearchDestination;
      count: number;
      entersTapped?: boolean;
    };

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
  | "end_step";

export type CardTrigger = {
  event: TriggerEvent;
  /**
   * Which objects' events fire this trigger (enter_battlefield, dies,
   * attacks). Default "self". "controlled" watches the trigger source's
   * controller's objects; "any" watches everyone's. upkeep/end_step fire at
   * the beginning of the controller's own step and ignore `watch`.
   */
  watch?: "self" | "controlled" | "any";
  /** "another creature": the event subject may not be the source itself. */
  excludeSelf?: boolean;
  /** Filter on the event subject's computed characteristics (landfall). */
  subjectFilter?: { types?: string[]; subtypes?: string[] };
  effects: CardEffect[];
  /** Chosen when the trigger is put on the stack. Empty or omitted means untargeted. */
  targetRequirements?: TargetRequirement[];
};

/** A change the trigger system reacts to. Dispatched synchronously in batches. */
export type EngineEvent =
  | { kind: "enters"; cardId: CardInstanceId }
  | { kind: "dies"; cardId: CardInstanceId; controllerId: PlayerId }
  | { kind: "attacks"; cardId: CardInstanceId }
  | { kind: "step_begins"; step: Step };

/** One triggered ability waiting to be put on the stack. */
export type TriggerCandidate = {
  cardId: CardInstanceId;
  triggerIndex: number;
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
    }
  | {
      kind: "may_pay_life_or_enter_tapped";
      playerId: PlayerId;
      sourceId: CardInstanceId;
      amount: number;
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

export type EnterTappedUnless =
  | { kind: "other_lands"; count: number }
  | { kind: "legendary_creature" }
  | { kind: "controlled_types"; types: string[] }
  | { kind: "basic_lands"; count: number };

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
  /** Class level-up is a sorcery-speed class ability. */
  timing?: "any" | "sorcery";
};

export type ReplacementEffect =
  | { kind: "replace_draw"; instead: "skip" }
  | { kind: "enters_tapped" }
  | { kind: "enters_tapped_unless"; unless: EnterTappedUnless }
  | { kind: "enters_tapped_if"; if: EnterTappedUnless }
  | { kind: "may_pay_life_or_enter_tapped"; amount: number }
  /** Rest in Peace: cards and tokens headed to a graveyard are exiled instead. */
  | { kind: "graveyard_to_exile" };

export type ManaAbility = {
  produces: Partial<ManaPool>;
  producesOptions: ManaColor[];
  producesAnyColor: boolean;
  damageToController: number;
};

/**
 * Whom a continuous effect applies to. Matching runs against *computed*
 * characteristics (an effect that makes everything a Sliver feeds Sliver
 * lords), and only battlefield objects are ever affected. All listed names
 * must be present (lowercase).
 */
export type EffectSelector = {
  scope: "self" | "controlled" | "all";
  types?: string[];
  subtypes?: string[];
};

/** What a continuous effect does, in CR 613 layer order (derived from kind). */
export type ContinuousEffectData =
  | { kind: "add_types"; types: string[]; subtypes: string[] } // layer 4
  | { kind: "set_colors"; colors: Color[] } // layer 5
  | { kind: "grant_keyword"; keyword: Keyword } // layer 6
  | { kind: "remove_all_abilities" } // layer 6
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
      /** Announced X for {X} costs (CR 601.2b). */
      xValue?: number;
      /** Damage split for divided-damage spells; aligns with `targets`. */
      division?: number[];
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
  | { kind: "keep_hand"; playerId: PlayerId }
  | { kind: "mulligan"; playerId: PlayerId }
  | { kind: "bottom_cards"; playerId: PlayerId; cardIds: CardInstanceId[] }
  | { kind: "manual_override"; playerId: PlayerId; change: ManualOverrideChange }
  | { kind: "undo"; playerId: PlayerId }
  | { kind: "roll_die"; playerId: PlayerId; sides: number }
  | { kind: "opening_roll"; playerId: PlayerId }
  | { kind: "advance_step"; playerId: PlayerId }
  | { kind: "advance_turn"; playerId: PlayerId }
  | { kind: "choose_targets"; playerId: PlayerId; targets: ChosenTarget[] }
  | { kind: "resolve_order_triggers"; playerId: PlayerId; order: number[] }
  | { kind: "choose_enter_replacement"; playerId: PlayerId; pay: boolean }
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
