import type {
  CardEffect,
  CardIdSelector,
  CardTrigger,
  ChosenTarget,
  GameAction,
  GameEvent,
  GameLogEntry,
  GameState,
  Keyword,
  ManaPool,
  PlayerState,
  ReplacementEffect,
  StaticModifier,
  TargetRequirement,
  ZoneName,
} from "./types";

const KEYWORDS = new Set<Keyword>([
  "flying",
  "reach",
  "haste",
  "vigilance",
  "trample",
  "deathtouch",
  "lifelink",
  "first_strike",
  "double_strike",
  "menace",
  "hexproof",
  "indestructible",
  "flash",
  "defender",
]);

const MANA_KEYS = ["W", "U", "B", "R", "G", "C"] as const;
const ZONE_KEYS = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
  "stack",
  "removed",
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
    removed:
      value.zones.removed === undefined
        ? []
        : expectStringArray(value.zones.removed, "zones.removed"),
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
    lost: value.lost === true,
    landsPlayedThisTurn:
      value.landsPlayedThisTurn === undefined
        ? 0
        : expectNumber(value.landsPlayedThisTurn, "player.landsPlayedThisTurn"),
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
      attacking: card.attacking === true,
      blockingAttackerId:
        card.blockingAttackerId === undefined || card.blockingAttackerId === null
          ? null
          : expectString(card.blockingAttackerId, "card.blockingAttackerId"),
      summoningSick: card.summoningSick === true,
      counters: parseCounters(card.counters, `card.${id}.counters`),
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
      effects: parseCardEffects(def.effects, `definition.${id}.effects`),
      targetRequirements: parseTargetRequirements(
        def.targetRequirements,
        `definition.${id}.targetRequirements`,
      ),
      keywords: parseKeywords(def.keywords, `definition.${id}.keywords`),
      triggers: parseTriggers(def.triggers, `definition.${id}.triggers`),
      replacements: parseReplacements(def.replacements, `definition.${id}.replacements`),
      staticModifiers: parseStaticModifiers(
        def.staticModifiers,
        `definition.${id}.staticModifiers`,
      ),
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
    const triggerIndex = entry.triggerIndex;
    return {
      id: expectString(entry.id, "stack.id"),
      controllerId: expectString(entry.controllerId, "stack.controllerId"),
      sourceId,
      kind,
      targets: parseChosenTargets(entry.targets, `stack[${index}].targets`),
      ...(triggerIndex === undefined
        ? {}
        : { triggerIndex: expectNumber(triggerIndex, `stack[${index}].triggerIndex`) }),
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
    combat: parseCombat(raw.combat),
    priorityPlayerId: expectString(
      raw.priorityPlayerId ?? raw.turn.activePlayerId,
      "priorityPlayerId",
    ),
    passesSinceAction: expectNumber(raw.passesSinceAction ?? 0, "passesSinceAction"),
    winnerId:
      raw.winnerId === undefined || raw.winnerId === null
        ? null
        : expectString(raw.winnerId, "winnerId"),
    log: parseLog(raw.log),
  };
}

function parseChosenTarget(value: unknown, label: string): ChosenTarget {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const type = expectString(value.type, `${label}.type`);
  if (type === "player") {
    return { type, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (type === "creature") {
    return { type, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  throw new Error(`Invalid ${label}.type`);
}

function parseChosenTargets(value: unknown, label: string): ChosenTarget[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseChosenTarget(entry, `${label}[${index}]`));
}

function parseTargetRequirement(value: unknown, label: string): TargetRequirement {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  if (kind !== "player" && kind !== "creature" && kind !== "player_or_creature") {
    throw new Error(`Invalid ${label}.kind`);
  }
  return { kind };
}

function parseTargetRequirements(value: unknown, label: string): TargetRequirement[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseTargetRequirement(entry, `${label}[${index}]`));
}

function parseCardIdSelector(value: unknown, label: string): CardIdSelector {
  if (typeof value === "string") {
    return expectString(value, label);
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  if (expectString(value.type, `${label}.type`) !== "chosen") {
    throw new Error(`Invalid ${label}.type`);
  }
  const index = expectNumber(value.index, `${label}.index`);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid ${label}.index`);
  }
  return { type: "chosen", index };
}

function parsePlayerSelector(value: unknown, label: string): string {
  return expectString(value, label);
}

function parsePartialMana(value: unknown, label: string): Partial<ManaPool> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const mana: Partial<ManaPool> = {};
  for (const key of MANA_KEYS) {
    if (value[key] !== undefined) {
      mana[key] = expectNumber(value[key], `${label}.${key}`);
    }
  }
  return mana;
}

function parseCardEffect(value: unknown, label: string): CardEffect {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  switch (kind) {
    case "gain_life":
    case "lose_life":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount: expectNumber(value.amount, `${label}.amount`),
      };
    case "draw":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "add_mana":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        mana: parsePartialMana(value.mana, `${label}.mana`),
      };
    case "deal_damage": {
      if (!isRecord(value.target)) {
        throw new Error(`Invalid ${label}.target`);
      }
      const targetType = expectString(value.target.type, `${label}.target.type`);
      const sourceId = value.sourceId;
      if (sourceId !== null && sourceId !== "self" && typeof sourceId !== "string") {
        throw new Error(`Invalid ${label}.sourceId`);
      }
      if (targetType === "player") {
        return {
          kind,
          amount: expectNumber(value.amount, `${label}.amount`),
          sourceId,
          target: {
            type: "player",
            playerId: parsePlayerSelector(value.target.playerId, `${label}.target.playerId`),
          },
        };
      }
      if (targetType === "creature") {
        return {
          kind,
          amount: expectNumber(value.amount, `${label}.amount`),
          sourceId,
          target: {
            type: "creature",
            cardId: expectString(value.target.cardId, `${label}.target.cardId`),
          },
        };
      }
      if (targetType === "chosen") {
        const index = expectNumber(value.target.index, `${label}.target.index`);
        if (!Number.isInteger(index) || index < 0) {
          throw new Error(`Invalid ${label}.target.index`);
        }
        return {
          kind,
          amount: expectNumber(value.amount, `${label}.amount`),
          sourceId,
          target: { type: "chosen", index },
        };
      }
      throw new Error(`Invalid ${label}.target.type`);
    }
    case "create_token":
      return {
        kind,
        ownerId: parsePlayerSelector(value.ownerId, `${label}.ownerId`),
        name: expectString(value.name, `${label}.name`),
        typeLine: expectString(value.typeLine, `${label}.typeLine`),
        power: value.power === undefined || value.power === null ? null : expectNumber(value.power, `${label}.power`),
        toughness:
          value.toughness === undefined || value.toughness === null
            ? null
            : expectNumber(value.toughness, `${label}.toughness`),
      };
    case "move_card": {
      const toZone = expectString(value.toZone, `${label}.toZone`);
      if (toZone === "stack" || !ZONE_KEYS.includes(toZone as (typeof ZONE_KEYS)[number])) {
        throw new Error(`Invalid ${label}.toZone`);
      }
      const libraryPosition = value.libraryPosition;
      if (libraryPosition !== undefined && libraryPosition !== "top" && libraryPosition !== "bottom") {
        throw new Error(`Invalid ${label}.libraryPosition`);
      }
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        toZone: toZone as Exclude<ZoneName, "stack">,
        libraryPosition,
      };
    }
    case "tap":
    case "untap":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "mill":
    case "discard":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "sacrifice":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "add_counter":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        counter: expectString(value.counter, `${label}.counter`),
        amount: expectNumber(value.amount, `${label}.amount`),
      };
    default:
      throw new Error(`Unknown effect kind ${kind}`);
  }
}

function parseCounters(value: unknown, label: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const counters: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    counters[key] = expectNumber(amount, `${label}.${key}`);
  }
  return counters;
}

function parseKeywords(value: unknown, label: string): Keyword[] {
  if (value === undefined) {
    return [];
  }
  const keywords = expectStringArray(value, label);
  for (const keyword of keywords) {
    if (!KEYWORDS.has(keyword as Keyword)) {
      throw new Error(`Invalid ${label} keyword ${keyword}`);
    }
  }
  return keywords as Keyword[];
}

function parseTriggers(value: unknown, label: string): CardTrigger[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const event = expectString(entry.event, `${label}[${index}].event`);
    if (event !== "enter_battlefield") {
      throw new Error(`Invalid ${label}[${index}].event`);
    }
    return {
      event,
      effects: parseCardEffects(entry.effects, `${label}[${index}].effects`),
    };
  });
}

function parseReplacements(value: unknown, label: string): ReplacementEffect[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const kind = expectString(entry.kind, `${label}[${index}].kind`);
    const instead = expectString(entry.instead, `${label}[${index}].instead`);
    if (kind !== "replace_draw" || instead !== "skip") {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return { kind, instead };
  });
}

function parseStaticModifiers(value: unknown, label: string): StaticModifier[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const kind = expectString(entry.kind, `${label}[${index}].kind`);
    const selector = expectString(entry.selector, `${label}[${index}].selector`);
    if (kind !== "pt" || (selector !== "self" && selector !== "controlled_creatures")) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return {
      kind,
      selector,
      power: expectNumber(entry.power, `${label}[${index}].power`),
      toughness: expectNumber(entry.toughness, `${label}[${index}].toughness`),
    };
  });
}

function parseLog(value: unknown): GameLogEntry[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid log");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid log[${index}]`);
    }
    const kind = expectString(entry.kind, `log[${index}].kind`);
    if (kind !== "zone_change") {
      throw new Error(`Invalid log[${index}].kind`);
    }
    const from = expectString(entry.from, `log[${index}].from`);
    const to = expectString(entry.to, `log[${index}].to`);
    if (!ZONE_KEYS.includes(from as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid log[${index}].from`);
    }
    if (!ZONE_KEYS.includes(to as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid log[${index}].to`);
    }
    return {
      kind,
      cardId: expectString(entry.cardId, `log[${index}].cardId`),
      from: from as ZoneName,
      to: to as ZoneName,
    };
  });
}

function parseCardEffects(value: unknown, label: string): CardEffect[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseCardEffect(entry, `${label}[${index}]`));
}

function parseCombat(value: unknown): GameState["combat"] {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid combat");
  }
  if (!Array.isArray(value.attacks) || !isRecord(value.blockers)) {
    throw new Error("Invalid combat attacks/blockers");
  }
  const attacks = value.attacks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid combat attack ${index}`);
    }
    return {
      attackerId: expectString(entry.attackerId, "combat.attackerId"),
      defenderId: expectString(entry.defenderId, "combat.defenderId"),
    };
  });
  const blockers: Record<string, string[]> = {};
  for (const [attackerId, list] of Object.entries(value.blockers)) {
    blockers[attackerId] = expectStringArray(list, `combat.blockers.${attackerId}`);
  }
  return {
    attacks,
    blockers,
    attackersDeclared: value.attackersDeclared === true,
    declaredBlockersFor: expectStringArray(
      value.declaredBlockersFor ?? [],
      "combat.declaredBlockersFor",
    ),
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
  if (kind === "play_land") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
    };
  }
  if (kind === "cast_spell") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
      ...(raw.targets === undefined
        ? {}
        : { targets: parseChosenTargets(raw.targets, "action.targets") }),
    };
  }
  if (kind === "declare_attackers") {
    if (!Array.isArray(raw.attacks)) {
      throw new Error("Invalid declare_attackers attacks");
    }
    return {
      kind,
      playerId,
      attacks: raw.attacks.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Invalid attack ${index}`);
        }
        return {
          attackerId: expectString(entry.attackerId, "attack.attackerId"),
          defenderId: expectString(entry.defenderId, "attack.defenderId"),
        };
      }),
    };
  }
  if (kind === "declare_blockers") {
    if (!Array.isArray(raw.blocks)) {
      throw new Error("Invalid declare_blockers blocks");
    }
    return {
      kind,
      playerId,
      blocks: raw.blocks.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Invalid block ${index}`);
        }
        return {
          blockerId: expectString(entry.blockerId, "block.blockerId"),
          attackerId: expectString(entry.attackerId, "block.attackerId"),
        };
      }),
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
