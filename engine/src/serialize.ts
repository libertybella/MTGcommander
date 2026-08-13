import type { GameAction, GameEvent, GameState, ManaPool, PlayerState } from "./types";

const MANA_KEYS = ["W", "U", "B", "R", "G", "C"] as const;
const ZONE_KEYS = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
  "stack",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function parseMana(value: unknown, label: string): ManaPool {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const mana = emptyManaFromUnknown();
  for (const key of MANA_KEYS) {
    mana[key] = expectNumber(value[key], `${label}.${key}`);
  }
  return mana;
}

function emptyManaFromUnknown(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function parsePlayer(value: unknown): PlayerState {
  if (!isRecord(value)) {
    throw new Error("Invalid player");
  }
  if (!isRecord(value.zones)) {
    throw new Error("Invalid player zones");
  }
  if (!isRecord(value.commander)) {
    throw new Error("Invalid commander state");
  }
  if (!isRecord(value.commander.damageReceived)) {
    throw new Error("Invalid commander damage");
  }

  const damageReceived: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value.commander.damageReceived)) {
    damageReceived[key] = expectNumber(amount, `commander.damageReceived.${key}`);
  }

  const zones = {
    library: expectStringArray(value.zones.library, "zones.library"),
    hand: expectStringArray(value.zones.hand, "zones.hand"),
    battlefield: expectStringArray(value.zones.battlefield, "zones.battlefield"),
    graveyard: expectStringArray(value.zones.graveyard, "zones.graveyard"),
    exile: expectStringArray(value.zones.exile, "zones.exile"),
    command: expectStringArray(value.zones.command, "zones.command"),
  };

  return {
    id: expectString(value.id, "player.id"),
    displayName: expectString(value.displayName, "player.displayName"),
    life: expectNumber(value.life, "player.life"),
    mana: parseMana(value.mana, "player.mana"),
    zones,
    commander: {
      commanderIds: expectStringArray(
        value.commander.commanderIds,
        "commander.commanderIds",
      ),
      tax: expectNumber(value.commander.tax, "commander.tax"),
      damageReceived,
    },
  };
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function parseGameState(json: string): GameState {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) {
    throw new Error("GameState JSON must be an object");
  }
  if (!Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 4) {
    throw new Error("GameState must have 2–4 players");
  }
  if (!isRecord(raw.turn) || !isRecord(raw.cards) || !isRecord(raw.definitions)) {
    throw new Error("GameState is missing turn, cards, or definitions");
  }
  if (!Array.isArray(raw.stack)) {
    throw new Error("Invalid stack");
  }

  const players = raw.players.map(parsePlayer);
  const playerIds = new Set(players.map((p) => p.id));
  if (playerIds.size !== players.length) {
    throw new Error("Player IDs must be unique");
  }

  const cards: GameState["cards"] = {};
  for (const [id, card] of Object.entries(raw.cards)) {
    if (!isRecord(card)) {
      throw new Error(`Invalid card ${id}`);
    }
    const instanceId = expectString(card.id, "card.id");
    if (instanceId !== id) {
      throw new Error("Card instance key must match card.id");
    }
    const zone = expectString(card.zone, "card.zone");
    if (!ZONE_KEYS.includes(zone as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid zone ${zone}`);
    }
    cards[id] = {
      id: instanceId,
      definitionId: expectString(card.definitionId, "card.definitionId"),
      ownerId: expectString(card.ownerId, "card.ownerId"),
      controllerId: expectString(card.controllerId, "card.controllerId"),
      zone: zone as (typeof ZONE_KEYS)[number],
      tapped: card.tapped === undefined ? false : card.tapped === true,
      damageMarked:
        card.damageMarked === undefined ? 0 : expectNumber(card.damageMarked, "card.damageMarked"),
    };
  }

  const definitions: GameState["definitions"] = {};
  for (const [id, def] of Object.entries(raw.definitions)) {
    if (!isRecord(def)) {
      throw new Error(`Invalid definition ${id}`);
    }
    const definitionId = expectString(def.id, "definition.id");
    if (definitionId !== id) {
      throw new Error("Definition key must match definition.id");
    }
    definitions[id] = {
      id: definitionId,
      name: expectString(def.name, "definition.name"),
      manaCost: expectString(def.manaCost, "definition.manaCost", true),
      typeLine: expectString(def.typeLine, "definition.typeLine"),
      oracleText: expectString(def.oracleText, "definition.oracleText", true),
      power: def.power === undefined || def.power === null ? null : expectNumber(def.power, "definition.power"),
      toughness:
        def.toughness === undefined || def.toughness === null
          ? null
          : expectNumber(def.toughness, "definition.toughness"),
    };
  }

  const cardIds = Object.keys(cards);
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Card instance IDs must be unique");
  }

  const stack = raw.stack.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid stack object ${index}`);
    }
    const kindRaw = expectString(entry.kind, "stack.kind");
    if (kindRaw !== "spell" && kindRaw !== "ability") {
      throw new Error("Invalid stack object kind");
    }
    const kind: "spell" | "ability" = kindRaw;
    const sourceId = entry.sourceId;
    if (sourceId !== null && typeof sourceId !== "string") {
      throw new Error("Invalid stack sourceId");
    }
    return {
      id: expectString(entry.id, "stack.id"),
      controllerId: expectString(entry.controllerId, "stack.controllerId"),
      sourceId,
      kind,
    };
  });

  const phase = expectString(raw.turn.phase, "turn.phase");
  const step = expectString(raw.turn.step, "turn.step");

  return {
    id: expectString(raw.id, "game.id"),
    players,
    turn: {
      number: expectNumber(raw.turn.number, "turn.number"),
      activePlayerId: expectString(raw.turn.activePlayerId, "turn.activePlayerId"),
      phase: phase as GameState["turn"]["phase"],
      step: step as GameState["turn"]["step"],
    },
    stack,
    cards,
    definitions,
    priorityPlayerId: expectString(
      raw.priorityPlayerId ?? raw.turn.activePlayerId,
      "priorityPlayerId",
    ),
    passesSinceAction: expectNumber(raw.passesSinceAction ?? 0, "passesSinceAction"),
  };
}

export function serializeGameAction(action: GameAction): string {
  return JSON.stringify(action);
}

export function parseGameAction(json: string): GameAction {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) {
    throw new Error("Invalid GameAction");
  }
  const kind = expectString(raw.kind, "action.kind");
  const playerId = expectString(raw.playerId, "action.playerId");
  if (kind === "pass_priority" || kind === "concede") {
    return { kind, playerId };
  }
  if (kind === "cast_spell") {
    if (raw.targets !== undefined) {
      throw new Error("Targets are not supported");
    }
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
    };
  }
  throw new Error(`Unknown GameAction kind ${kind}`);
}

export function serializeGameEvent(event: GameEvent): string {
  return JSON.stringify(event);
}

export function parseGameEvent(json: string): GameEvent {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) {
    throw new Error("Invalid GameEvent");
  }
  const kind = expectString(raw.kind, "event.kind");
  if (kind === "game_created") {
    return { kind, gameId: expectString(raw.gameId, "event.gameId") };
  }
  if (kind === "priority_passed" || kind === "player_conceded") {
    return { kind, playerId: expectString(raw.playerId, "event.playerId") };
  }
  throw new Error(`Unknown GameEvent kind ${kind}`);
}
