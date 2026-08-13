import { cloneGameState } from "./clone";
import type { CardInstanceId, GameState, PlayerState, ZoneName } from "./types";

export const PLAYER_ZONES: ZoneName[] = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
];

export type MoveCardOptions = {
  /** Library only: index 0 is the top. Defaults to top when moving onto the library. */
  libraryPosition?: "top" | "bottom";
};

function playerHasCard(player: PlayerState, cardId: CardInstanceId): ZoneName | null {
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
): { playerId: string; zone: ZoneName } | null {
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

function removeFromZone(player: PlayerState, zone: ZoneName, cardId: CardInstanceId): void {
  const list = player.zones[zone];
  const index = list.indexOf(cardId);
  if (index === -1) {
    throw new Error(`Card ${cardId} is not in ${zone}`);
  }
  list.splice(index, 1);
}

function insertIntoZone(
  player: PlayerState,
  zone: ZoneName,
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
  if (!PLAYER_ZONES.includes(toZone)) {
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

  if (countCardPlacements(next, cardId) !== 1) {
    throw new Error(`Zone integrity failed for ${cardId}`);
  }

  return next;
}
