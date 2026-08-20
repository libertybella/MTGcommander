import { cloneGameState } from "./clone";
import { isCommander } from "./cardTypes";
import { queueEnterReplacementChoicesInPlace, wouldEnterTapped } from "./derived";
import { dispatchEventsInPlace, queueEnterBattlefieldTriggersInPlace } from "./triggers";
import type { CardInstance, CardInstanceId, GameState, PlayerState, PlayerZones, ZoneName } from "./types";

export const PLAYER_ZONES: (keyof PlayerZones)[] = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
  "removed",
];

export function isPlayerZone(zone: ZoneName): zone is keyof PlayerZones {
  return (PLAYER_ZONES as readonly string[]).includes(zone);
}

function commanderAwareDestination(
  state: GameState,
  cardId: CardInstanceId,
  toZone: keyof PlayerZones,
): keyof PlayerZones {
  if ((toZone === "graveyard" || toZone === "exile") && isCommander(state, cardId)) {
    return "command";
  }
  return toZone;
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
  const next = cloneGameState(state);
  enterOwnerZoneInPlace(next, cardId, toZone, options);
  return next;
}

export function enterOwnerZoneInPlace(
  state: GameState,
  cardId: CardInstanceId,
  toZone: ZoneName,
  options: MoveCardOptions = {},
): void {
  if (!isPlayerZone(toZone)) {
    throw new Error(`Cannot enter zone ${toZone}`);
  }
  const destination = commanderAwareDestination(state, cardId, toZone);
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (findCardZone(state, cardId)) {
    throw new Error(`Card ${cardId} is already in a player zone`);
  }
  const owner = state.players.find((p) => p.id === card.ownerId);
  if (!owner) {
    throw new Error(`Card ${cardId} owner is missing`);
  }
  const fromZone = card.zone;
  const diedControllerId = card.controllerId;
  insertIntoZone(owner, destination, cardId, options.libraryPosition ?? "top");
  card.zone = destination;
  applyZoneChangeFlags(state, card, destination);
  state.log.push({ kind: "zone_change", cardId, from: fromZone, to: destination });
  if (destination === "battlefield") {
    queueEnterReplacementChoicesInPlace(state, cardId);
    queueEnterBattlefieldTriggersInPlace(state, cardId);
  }
  if (fromZone === "battlefield" && destination === "graveyard") {
    dispatchEventsInPlace(state, [{ kind: "dies", cardId, controllerId: diedControllerId }]);
  }
}

function applyZoneChangeFlags(
  state: GameState,
  card: CardInstance,
  toZone: keyof PlayerZones,
): void {
  card.attacking = false;
  card.blockingAttackerId = null;
  if (toZone === "battlefield") {
    card.summoningSick = true;
    card.damageMarked = 0;
    card.tapped = wouldEnterTapped(state, card.id);
    card.timestamp = state.nextTimestamp;
    state.nextTimestamp += 1;
    const subtypes = state.definitions[card.definitionId]?.characteristics.subtypes ?? [];
    if (subtypes.includes("class") && card.classLevel < 1) {
      card.classLevel = 1;
    }
  } else {
    card.damageMarked = 0;
    card.tapped = false;
    card.classLevel = 0;
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
  const next = cloneGameState(state);
  moveCardInPlace(next, cardId, toZone, options);
  return next;
}

export function moveCardInPlace(
  state: GameState,
  cardId: CardInstanceId,
  toZone: ZoneName,
  options: MoveCardOptions = {},
): void {
  if (!isPlayerZone(toZone)) {
    throw new Error(`Cannot move to zone ${toZone}`);
  }

  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }

  const located = findCardZone(state, cardId);
  if (!located) {
    throw new Error(`Card ${cardId} is not in any player zone`);
  }
  if (located.zone !== card.zone) {
    throw new Error(`Card ${cardId} zone data is inconsistent`);
  }

  const owner = state.players.find((p) => p.id === card.ownerId);
  const occupant = state.players.find((p) => p.id === located.playerId);
  if (!owner || !occupant) {
    throw new Error(`Card ${cardId} owner/zone player is missing`);
  }
  if (occupant.id !== owner.id) {
    throw new Error(`Card ${cardId} is not in its owner's zones`);
  }

  const destination = commanderAwareDestination(state, cardId, toZone);
  if (located.zone === destination) {
    if (destination === "library" && options.libraryPosition) {
      removeFromZone(occupant, located.zone, cardId);
      insertIntoZone(owner, destination, cardId, options.libraryPosition);
      if (countCardPlacements(state, cardId) !== 1) {
        throw new Error(`Zone integrity failed for ${cardId}`);
      }
    }
    return;
  }

  const diedControllerId = card.controllerId;
  removeFromZone(occupant, located.zone, cardId);
  insertIntoZone(owner, destination, cardId, options.libraryPosition ?? "top");
  card.zone = destination;
  applyZoneChangeFlags(state, card, destination);
  state.log.push({ kind: "zone_change", cardId, from: located.zone, to: destination });
  if (destination === "battlefield") {
    queueEnterReplacementChoicesInPlace(state, cardId);
    queueEnterBattlefieldTriggersInPlace(state, cardId);
  }
  if (located.zone === "battlefield" && destination === "graveyard") {
    dispatchEventsInPlace(state, [{ kind: "dies", cardId, controllerId: diedControllerId }]);
  }

  if (countCardPlacements(state, cardId) !== 1) {
    throw new Error(`Zone integrity failed for ${cardId}`);
  }
}
