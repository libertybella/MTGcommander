import { cloneGameState } from "./clone";
import { shuffleInPlace } from "./shuffle";
import { isCommander, isCreature } from "./cardTypes";
import { abilitiesRemoved } from "./characteristicsEngine";
import { createCardDefinition, createCardInstance } from "./createGame";
import { creaturePower, queueEnterReplacementChoicesInPlace, wouldEnterTapped } from "./derived";
import { tokenPresetFor } from "./tokens";
import { dispatchEventsInPlace, queueEnterBattlefieldTriggersInPlace } from "./triggers";
import type {
  CardInstance,
  CardInstanceId,
  EngineEvent,
  GameState,
  PlayerState,
  PlayerZones,
  ZoneName,
} from "./types";

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
  if (toZone === "graveyard" && graveyardReplacedByExile(state)) {
    // Rest in Peace (CR 614.6): the object never reaches the graveyard, so
    // dies triggers do not fire.
    return "exile";
  }
  return toZone;
}

function graveyardReplacedByExile(state: GameState): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
      return false;
    }
    return (state.definitions[card.definitionId]?.replacements ?? []).some(
      (replacement) => replacement.kind === "graveyard_to_exile",
    );
  });
}

export type MoveCardOptions = {
  /** Library only: index 0 is the top. Defaults to top when moving onto the
   * library; "shuffled" shuffles the whole library after inserting. */
  libraryPosition?: "top" | "bottom" | "shuffled";
  /**
   * Collect dies events here instead of dispatching them immediately.
   * State-based sweeps use this so simultaneous deaths reach watchers as
   * one batch (CR 603.10a look-back — the Blood Artist ruling).
   */
  collectDies?: EngineEvent[];
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
  // Elenda: "X is its power" reads the computed power the moment before
  // death — captured here while the object is still on the battlefield.
  const diedPower =
    fromZone === "battlefield" && isCreature(state, cardId)
      ? creaturePower(state, cardId)
      : undefined;
  // The Ozolith: +1/+1 counters at the moment of leaving (any exit).
  const leftCounters = fromZone === "battlefield" ? card.counters["p1p1"] ?? 0 : 0;
  insertIntoZone(owner, destination, cardId, options.libraryPosition ?? "top");
  card.zone = destination;
  applyZoneChangeFlags(state, card, destination);
  state.log.push({ kind: "zone_change", cardId, from: fromZone, to: destination });
  if (destination === "battlefield") {
    queueEnterReplacementChoicesInPlace(state, cardId);
    queueEnterBattlefieldTriggersInPlace(state, cardId);
  }
  if (fromZone === "battlefield" && leftCounters > 0) {
    dispatchEventsInPlace(state, [
      { kind: "leaves_battlefield", cardId, controllerId: diedControllerId, amount: leftCounters },
    ]);
  }
  if (fromZone === "battlefield" && destination === "graveyard") {
    const event: EngineEvent = {
      kind: "dies",
      cardId,
      controllerId: diedControllerId,
      ...(diedPower !== undefined ? { powerAtDeath: diedPower } : {}),
    };
    if (options.collectDies) {
      options.collectDies.push(event);
    } else {
      dispatchEventsInPlace(state, [event]);
      processDiesReturnsInPlace(state, [event]);
    }
  }
}

/**
 * Feign Death-class until-EOT grants: a listed creature that just died
 * returns to the battlefield tapped, with its optional +1/+1 counter or
 * Treasure rider. Called after the dies events dispatch, so Blood
 * Artist-class watchers and the card's own dies triggers still fire.
 * The return skips the stack — a documented silent approximation.
 */
export function processDiesReturnsInPlace(state: GameState, died: EngineEvent[]): void {
  const grants = state.diesReturnUntilEot;
  if (!grants || grants.length === 0) {
    return;
  }
  for (const event of died) {
    if (event.kind !== "dies") {
      continue;
    }
    const index = grants.findIndex((grant) => grant.cardId === event.cardId);
    if (index < 0) {
      continue;
    }
    const [grant] = grants.splice(index, 1);
    const card = state.cards[event.cardId];
    // "Return it" tracks the object into the graveyard only (CR 400.7):
    // if a replacement exiled it or it moved on, there is nothing to return.
    if (!grant || !card || card.zone !== "graveyard") {
      continue;
    }
    moveCardInPlace(state, event.cardId, "battlefield");
    card.tapped = true;
    if (grant.counter) {
      card.counters["p1p1"] = (card.counters["p1p1"] ?? 0) + 1;
    }
    if (grant.treasure) {
      const preset = tokenPresetFor("Artifact — Treasure Token");
      const definition = createCardDefinition({
        name: "Treasure",
        typeLine: "Artifact — Treasure Token",
        power: null,
        toughness: null,
        ...(preset?.manaAbilities ? { manaAbilities: preset.manaAbilities } : {}),
        ...(preset?.activated ? { activated: preset.activated } : {}),
      });
      state.definitions[definition.id] = definition;
      const owner = state.players.find((player) => player.id === card.controllerId);
      if (owner) {
        const token = createCardInstance({
          definitionId: definition.id,
          ownerId: owner.id,
          zone: "battlefield",
          isToken: true,
        });
        state.cards[token.id] = token;
        token.timestamp = state.nextTimestamp;
        state.nextTimestamp += 1;
        owner.zones.battlefield.push(token.id);
        queueEnterBattlefieldTriggersInPlace(state, token.id);
        dispatchEventsInPlace(state, [{ kind: "creates_token", playerId: owner.id }]);
      }
    }
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
    const definition = state.definitions[card.definitionId];
    const subtypes = definition?.characteristics.subtypes ?? [];
    if (subtypes.includes("class") && card.classLevel < 1) {
      card.classLevel = 1;
    }
    if (definition?.loyalty && definition.loyalty > 0 && !card.counters["loyalty"]) {
      card.counters["loyalty"] = definition.loyalty;
    }
    // "Enters with four +1/+1 counters on it" — placed here rather than as an
    // add_counter effect, so it is on the permanent the moment anything looks
    // (CR 121.6: they were never not there).
    const entering = definition?.entersWithCounters;
    if (entering) {
      card.counters[entering.counter] =
        (card.counters[entering.counter] ?? 0) + entering.count;
    }
  } else {
    card.damageMarked = 0;
    card.tapped = false;
    card.classLevel = 0;
    card.attachedTo = null;
    card.loyaltyActivatedThisTurn = false;
    card.faceDown = false;
    delete card.counters["loyalty"];
    // Anything attached to this permanent comes loose.
    for (const other of Object.values(state.cards)) {
      if (other.attachedTo === card.id) {
        other.attachedTo = null;
      }
    }
  }
}

function insertIntoZone(
  player: PlayerState,
  zone: keyof PlayerZones,
  cardId: CardInstanceId,
  libraryPosition: "top" | "bottom" | "shuffled",
): void {
  if (zone === "library") {
    if (libraryPosition === "bottom") {
      player.zones.library.push(cardId);
    } else {
      player.zones.library.unshift(cardId);
    }
    if (libraryPosition === "shuffled") {
      shuffleInPlace(player.zones.library);
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
  // Skullclamp: remember what was attached before the zone change detaches it.
  const wasAttachedIds =
    located.zone === "battlefield"
      ? Object.values(state.cards)
          .filter((other) => other.attachedTo === cardId)
          .map((other) => other.id)
      : [];
  // Elenda: computed power the moment before death.
  const diedPower =
    located.zone === "battlefield" && isCreature(state, cardId)
      ? creaturePower(state, cardId)
      : undefined;
  // The Ozolith: +1/+1 counters at the moment of leaving (any exit).
  const leftCounters = located.zone === "battlefield" ? card.counters["p1p1"] ?? 0 : 0;
  removeFromZone(occupant, located.zone, cardId);
  insertIntoZone(owner, destination, cardId, options.libraryPosition ?? "top");
  card.zone = destination;
  applyZoneChangeFlags(state, card, destination);
  state.log.push({ kind: "zone_change", cardId, from: located.zone, to: destination });
  if (destination === "battlefield") {
    queueEnterReplacementChoicesInPlace(state, cardId);
    queueEnterBattlefieldTriggersInPlace(state, cardId);
  }
  if (located.zone === "battlefield" && leftCounters > 0) {
    dispatchEventsInPlace(state, [
      { kind: "leaves_battlefield", cardId, controllerId: diedControllerId, amount: leftCounters },
    ]);
  }
  if (located.zone === "battlefield" && destination === "graveyard") {
    const event: EngineEvent = {
      kind: "dies",
      cardId,
      controllerId: diedControllerId,
      ...(wasAttachedIds.length > 0 ? { wasAttachedIds } : {}),
      ...(diedPower !== undefined ? { powerAtDeath: diedPower } : {}),
    };
    if (options.collectDies) {
      options.collectDies.push(event);
    } else {
      dispatchEventsInPlace(state, [event]);
      processDiesReturnsInPlace(state, [event]);
    }
  }
  // Syr Konrad's graveyard traffic: arrivals from anywhere but the
  // battlefield, and departures from any graveyard.
  if (located.zone !== "battlefield" && destination === "graveyard") {
    dispatchEventsInPlace(state, [{ kind: "put_in_graveyard_from_elsewhere", cardId }]);
  }
  if (located.zone === "graveyard" && destination !== "graveyard") {
    dispatchEventsInPlace(state, [{ kind: "leaves_graveyard", cardId, ownerId: owner.id }]);
  }

  if (countCardPlacements(state, cardId) !== 1) {
    throw new Error(`Zone integrity failed for ${cardId}`);
  }
}
