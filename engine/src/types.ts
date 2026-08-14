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

export type CardDefinition = {
  id: CardDefinitionId;
  name: string;
  manaCost: string;
  typeLine: string;
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
  staticModifiers: StaticModifier[];
  /** Mana this permanent adds when tapped for mana. Empty means it cannot. */
  produces: Partial<ManaPool>;
  /** `{T}: Add one mana of any color` (WUBRG). */
  producesAnyColor: boolean;
  /** `{T}: Add {G} or {W}` — tap for one of these. */
  producesOptions: ManaColor[];
  /** Non-mana activated abilities. Mana tapping still uses `produces`. */
  activated: ActivatedAbility[];
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
  | { kind: "sacrifice"; cardId: CardInstanceId }
  | { kind: "add_counter"; cardId: CardInstanceId; counter: string; amount: number }
  | { kind: "counter_spell"; stackObjectId: StackObjectId };

export type EffectTarget =
  | { type: "player"; playerId: PlayerId }
  | { type: "creature"; cardId: CardInstanceId };

export type TargetKind = "player" | "creature" | "player_or_creature" | "spell";

export type TargetRequirement = {
  kind: TargetKind;
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
      amount: number;
    }
  | { kind: "draw"; playerId: PlayerSelector; count: number }
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
  | { kind: "sacrifice"; cardId: CardIdSelector }
  | { kind: "add_counter"; cardId: CardIdSelector; counter: string; amount: number }
  | { kind: "counter_spell"; target: ChosenTargetRef };

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
  | "indestructible"
  | "flash"
  | "defender";

export type CardTrigger = {
  event: "enter_battlefield";
  effects: CardEffect[];
};

export type ActivatedAbility = {
  /** True when the cost includes {T}. */
  tap: boolean;
  /** Extra mana to pay. Empty string means no mana cost. */
  manaCost: string;
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
};

export type ReplacementEffect = {
  kind: "replace_draw";
  instead: "skip";
};

export type StaticModifier = {
  kind: "pt";
  selector: "self" | "controlled_creatures";
  power: number;
  toughness: number;
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
    };

/** Table-agreed correction. Not a comprehensive-rules action. */
export type ManualOverrideChange =
  | { type: "adjust_life"; targetPlayerId: PlayerId; delta: number }
  | { type: "draw"; targetPlayerId: PlayerId; count: number }
  | { type: "mill"; targetPlayerId: PlayerId; count: number }
  | { type: "add_mana"; targetPlayerId: PlayerId; color: ManaColor }
  | { type: "move_card"; cardId: CardInstanceId; toZone: keyof PlayerZones }
  | { type: "set_tapped"; cardId: CardInstanceId; tapped: boolean };

export type GameAction =
  | { kind: "pass_priority"; playerId: PlayerId }
  | { kind: "cast_spell"; playerId: PlayerId; cardId: CardInstanceId; targets?: ChosenTarget[] }
  | { kind: "play_land"; playerId: PlayerId; cardId: CardInstanceId }
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
  | { kind: "tap_for_mana"; playerId: PlayerId; cardId: CardInstanceId; color?: ManaColor }
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
  | { kind: "manual_override"; playerId: PlayerId; change: ManualOverrideChange };

export type GameEvent =
  | { kind: "game_created"; gameId: GameId }
  | { kind: "priority_passed"; playerId: PlayerId }
  | { kind: "player_conceded"; playerId: PlayerId };
