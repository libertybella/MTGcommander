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
  | "stack";

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
};

export type CardDefinition = {
  id: CardDefinitionId;
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
};

export type CardInstance = {
  id: CardInstanceId;
  definitionId: CardDefinitionId;
  ownerId: PlayerId;
  controllerId: PlayerId;
  zone: ZoneName;
  tapped: boolean;
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
};

export type StackObject = {
  id: StackObjectId;
  controllerId: PlayerId;
  sourceId: CardInstanceId | null;
  kind: "spell" | "ability";
};

export type GameState = {
  id: GameId;
  players: PlayerState[];
  turn: TurnState;
  stack: StackObject[];
  cards: Record<CardInstanceId, CardInstance>;
  definitions: Record<CardDefinitionId, CardDefinition>;
  priorityPlayerId: PlayerId;
  passesSinceAction: number;
};

export type GameAction =
  | { kind: "pass_priority"; playerId: PlayerId }
  | { kind: "cast_spell"; playerId: PlayerId; cardId: CardInstanceId; targets?: unknown }
  | { kind: "concede"; playerId: PlayerId };

export type GameEvent =
  | { kind: "game_created"; gameId: GameId }
  | { kind: "priority_passed"; playerId: PlayerId }
  | { kind: "player_conceded"; playerId: PlayerId };
