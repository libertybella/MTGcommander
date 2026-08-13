import { cloneGameState } from "./clone";
import type { CardInstance, CardInstanceId, GameState, PlayerState, PlayerZones, ZoneName } from "./types";

export const PLAYER_ZONES: (keyof PlayerZones)[] = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
];

export function isPlayerZone(zone: ZoneName): zone is keyof PlayerZones {
  return (PLAYER_ZONES as readonly string[]).includes(zone);
}

export type MoveCardOptions = {
  /** Library only: index 0 is the top. Defaults to top when moving onto the library. */
  libraryPosition?: "top" | "bottom";
};

function playerHasCard(player: PlayerState, cardId: CardInstanceId): keyof PlayerZones | null {
  for (const zone of PLAYER_ZONES) {
    if (player.zones[zone].includes(cardId)) {
      return zone;
    }
  }
  return null;
}

export function findCardZone(
  state: GameState,
  cardId: CardInstanceId,
): { playerId: string; zone: keyof PlayerZones } | null {
  for (const player of state.players) {
    const zone = playerHasCard(player, cardId);
    if (zone) {
      return { playerId: player.id, zone };
    }
  }
  return null;
}

export function countCardPlacements(state: GameState, cardId: CardInstanceId): number {
  let count = 0;
  for (const player of state.players) {
    for (const zone of PLAYER_ZONES) {
      count += player.zones[zone].filter((id) => id === cardId).length;
    }
  }
  return count;
}

function removeFromZone(
  player: PlayerState,
  zone: keyof PlayerZones,
  cardId: CardInstanceId,
): void {
  const list = player.zones[zone];
  const index = list.indexOf(cardId);
  if (index === -1) {
    throw new Error(`Card ${cardId} is not in ${zone}`);
  }
  list.splice(index, 1);
}

export function removeCardFromCurrentZone(state: GameState, cardId: CardInstanceId): GameState {
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const located = findCardZone(next, cardId);
  if (!located) {
    throw new Error(`Card ${cardId} is not in any player zone`);
  }
  const occupant = next.players.find((p) => p.id === located.playerId);
  if (!occupant) {
    throw new Error(`Card ${cardId} zone player is missing`);
  }
  removeFromZone(occupant, located.zone, cardId);
  return next;
}

export function enterOwnerZone(
  state: GameState,
  cardId: CardInstanceId,
  toZone: ZoneName,
  options: MoveCardOptions = {},
): GameState {
  if (!isPlayerZone(toZone)) {
    throw new Error(`Cannot enter zone ${toZone}`);
  }
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (findCardZone(next, cardId)) {
    throw new Error(`Card ${cardId} is already in a player zone`);
  }
  const owner = next.players.find((p) => p.id === card.ownerId);
  if (!owner) {
    throw new Error(`Card ${cardId} owner is missing`);
  }
  insertIntoZone(owner, toZone, cardId, options.libraryPosition ?? "top");
  card.zone = toZone;
  applyZoneChangeFlags(card, toZone);
  return next;
}

function applyZoneChangeFlags(card: CardInstance, toZone: keyof PlayerZones): void {
  card.attacking = false;
  card.blockingAttackerId = null;
  if (toZone === "battlefield") {
    card.summoningSick = true;
    card.damageMarked = 0;
  } else {
    card.damageMarked = 0;
  }
}

function insertIntoZone(
  player: PlayerState,
  zone: keyof PlayerZones,
  cardId: CardInstanceId,
  libraryPosition: "top" | "bottom",
): void {
  if (zone === "library") {
    if (libraryPosition === "top") {
      player.zones.library.unshift(cardId);
    } else {
      player.zones.library.push(cardId);
    }
    return;
  }
  player.zones[zone].push(cardId);
}

/**
 * Move a card between player zones. Does not change owner or controller.
 * The stack is out of scope for Phase 3.
 */
export function moveCard(
  state: GameState,
  cardId: CardInstanceId,
  toZone: ZoneName,
  options: MoveCardOptions = {},
): GameState {
  if (!isPlayerZone(toZone)) {
    throw new Error(`Cannot move to zone ${toZone}`);
  }

  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }

  const located = findCardZone(next, cardId);
  if (!located) {
    throw new Error(`Card ${cardId} is not in any player zone`);
  }
  if (located.zone !== card.zone) {
    throw new Error(`Card ${cardId} zone data is inconsistent`);
  }

  const owner = next.players.find((p) => p.id === card.ownerId);
  const occupant = next.players.find((p) => p.id === located.playerId);
  if (!owner || !occupant) {
    throw new Error(`Card ${cardId} owner/zone player is missing`);
  }
  if (occupant.id !== owner.id) {
    throw new Error(`Card ${cardId} is not in its owner's zones`);
  }

  if (located.zone === toZone) {
    return next;
  }

  removeFromZone(occupant, located.zone, cardId);
  insertIntoZone(owner, toZone, cardId, options.libraryPosition ?? "top");
  card.zone = toZone;
  applyZoneChangeFlags(card, toZone);

  if (countCardPlacements(next, cardId) !== 1) {
    throw new Error(`Zone integrity failed for ${cardId}`);
  }

  return next;
}
