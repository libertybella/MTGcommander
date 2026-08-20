import { cloneGameState } from "./clone";
import { emptyManaPool } from "./createGame";
import type {
  CardInstanceId,
  GameState,
  ManaColor,
  ManaPool,
  PlayerId,
  PlayerState,
} from "./types";

export const MANA_COLORS: ManaColor[] = ["W", "U", "B", "R", "G", "C"];

export type HybridPip = { a: ManaColor; b: ManaColor };

export type ParsedManaCost = ManaPool & {
  generic: number;
  hybrid: HybridPip[];
  /** Number of {X} symbols; the caster announces X (CR 601.2b). */
  xCount: number;
  /** Phyrexian pips: each pays one mana of the color or 2 life (CR 107.4f). */
  phyrexian: Exclude<ManaColor, "C">[];
};

export const COLOR_PIPS: Exclude<ManaColor, "C">[] = ["W", "U", "B", "R", "G"];

export function emptyParsedManaCost(): ParsedManaCost {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0, hybrid: [], xCount: 0, phyrexian: [] };
}

function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  return player;
}

function assertNonNegativeIntegers(delta: Partial<ManaPool>, label: string): void {
  for (const color of MANA_COLORS) {
    const amount = delta[color];
    if (amount === undefined) {
      continue;
    }
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(`Invalid ${label} amount for ${color}`);
    }
  }
}

export function addToPool(pool: ManaPool, addition: Partial<ManaPool>): ManaPool {
  assertNonNegativeIntegers(addition, "mana");
  const next = { ...pool };
  for (const color of MANA_COLORS) {
    next[color] += addition[color] ?? 0;
  }
  return next;
}

export function parseManaCost(cost: string): ParsedManaCost {
  const trimmed = cost.trim();
  const parsed = emptyParsedManaCost();
  if (trimmed.length === 0) {
    return parsed;
  }

  const symbolPattern = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match = symbolPattern.exec(trimmed);
  while (match) {
    if (match.index !== lastIndex) {
      throw new Error(`Invalid mana cost ${cost}`);
    }
    lastIndex = symbolPattern.lastIndex;
    const symbol = match[1];
    if (!symbol) {
      throw new Error(`Invalid mana cost ${cost}`);
    }
    if (/^\d+$/.test(symbol)) {
      parsed.generic += Number(symbol);
    } else if (symbol === "X") {
      parsed.xCount += 1;
    } else if (
      symbol === "W" ||
      symbol === "U" ||
      symbol === "B" ||
      symbol === "R" ||
      symbol === "G" ||
      symbol === "C"
    ) {
      parsed[symbol] += 1;
    } else if (/^[WUBRG]\/P$/.test(symbol)) {
      parsed.phyrexian.push(symbol[0] as Exclude<ManaColor, "C">);
    } else if (/^[WUBRGC]\/[WUBRGC]$/.test(symbol)) {
      const [a, b] = symbol.split("/") as [ManaColor, ManaColor];
      parsed.hybrid.push({ a, b });
    } else {
      throw new Error(`Unsupported mana symbol {${symbol}}`);
    }
    match = symbolPattern.exec(trimmed);
  }

  if (lastIndex !== trimmed.length) {
    throw new Error(`Invalid mana cost ${cost}`);
  }
  return parsed;
}

function afterPips(pool: ManaPool, parsed: ParsedManaCost): ManaPool | null {
  const next = { ...pool };
  for (const color of MANA_COLORS) {
    if (next[color] < parsed[color]) {
      return null;
    }
    next[color] -= parsed[color];
  }
  for (const pip of parsed.hybrid) {
    const prefer = next[pip.a] >= next[pip.b] ? pip.a : pip.b;
    const other = prefer === pip.a ? pip.b : pip.a;
    if (next[prefer] > 0) {
      next[prefer] -= 1;
    } else if (next[other] > 0) {
      next[other] -= 1;
    } else {
      return null;
    }
  }
  return next;
}

export function canPayManaCost(
  pool: ManaPool,
  cost: string | ParsedManaCost,
  life = Number.POSITIVE_INFINITY,
): boolean {
  const parsed = typeof cost === "string" ? parseManaCost(cost) : cost;
  const remaining = afterPips(pool, parsed);
  if (!remaining) {
    return false;
  }
  let lifeNeeded = 0;
  for (const color of parsed.phyrexian) {
    if (remaining[color] > 0) {
      remaining[color] -= 1;
    } else {
      lifeNeeded += 2;
    }
  }
  if (lifeNeeded > life) {
    return false;
  }
  const leftover = MANA_COLORS.reduce((sum, color) => sum + remaining[color], 0);
  return leftover >= parsed.generic;
}

function spendFromPool(
  pool: ManaPool,
  parsed: ParsedManaCost,
  life = Number.POSITIVE_INFINITY,
): { pool: ManaPool; lifePaid: number } {
  if (!canPayManaCost(pool, parsed, life)) {
    throw new Error("Cannot pay mana cost");
  }
  const next = afterPips(pool, parsed);
  if (!next) {
    throw new Error("Cannot pay mana cost");
  }
  let lifePaid = 0;
  for (const color of parsed.phyrexian) {
    if (next[color] > 0) {
      next[color] -= 1;
    } else {
      lifePaid += 2;
    }
  }
  let generic = parsed.generic;
  const spendOrder: ManaColor[] = ["C", "W", "U", "B", "R", "G"];
  for (const color of spendOrder) {
    const used = Math.min(next[color], generic);
    next[color] -= used;
    generic -= used;
  }
  return { pool: next, lifePaid };
}

export function addMana(
  state: GameState,
  playerId: PlayerId,
  addition: Partial<ManaPool>,
): GameState {
  assertNonNegativeIntegers(addition, "added mana");
  const next = cloneGameState(state);
  const player = requirePlayer(next, playerId);
  player.mana = addToPool(player.mana, addition);
  return next;
}

export function removeMana(
  state: GameState,
  playerId: PlayerId,
  removal: Partial<ManaPool>,
): GameState {
  assertNonNegativeIntegers(removal, "removed mana");
  const next = cloneGameState(state);
  const player = requirePlayer(next, playerId);
  for (const color of MANA_COLORS) {
    const amount = removal[color] ?? 0;
    if (player.mana[color] < amount) {
      throw new Error(`Not enough ${color} mana`);
    }
    player.mana[color] -= amount;
  }
  return next;
}

export function emptyManaPoolsInPlace(state: GameState): void {
  for (const player of state.players) {
    player.mana = emptyManaPool();
  }
}

export function emptyManaPools(state: GameState): GameState {
  const next = cloneGameState(state);
  emptyManaPoolsInPlace(next);
  return next;
}

export function payManaCost(
  state: GameState,
  playerId: PlayerId,
  cost: string | ParsedManaCost,
): GameState {
  const next = cloneGameState(state);
  const player = requirePlayer(next, playerId);
  const parsed = typeof cost === "string" ? parseManaCost(cost) : cost;
  const paid = spendFromPool(player.mana, parsed, player.life);
  player.mana = paid.pool;
  if (paid.lifePaid > 0) {
    player.life -= paid.lifePaid;
    next.log.push({ kind: "life_change", playerId, delta: -paid.lifePaid });
  }
  return next;
}

export function tapCard(state: GameState, cardId: CardInstanceId): GameState {
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} must be on the battlefield to tap`);
  }
  if (card.tapped) {
    throw new Error(`Card ${cardId} is already tapped`);
  }
  card.tapped = true;
  return next;
}

export function untapCard(state: GameState, cardId: CardInstanceId): GameState {
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} must be on the battlefield to untap`);
  }
  if (!card.tapped) {
    throw new Error(`Card ${cardId} is already untapped`);
  }
  card.tapped = false;
  return next;
}

/**
 * Tap a battlefield permanent and add mana to its controller's pool.
 * The produced amount is supplied by the caller; card abilities are out of scope.
 */
export function tapForMana(
  state: GameState,
  cardId: CardInstanceId,
  addition: Partial<ManaPool>,
): GameState {
  const tapped = tapCard(state, cardId);
  const card = tapped.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  return addMana(tapped, card.controllerId, addition);
}
