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
  LibraryPosition,
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
  // Whip of Erebos: the shield belongs to the permanent, and only bites on
  // the way OFF the battlefield — which is the only place the flag is ever
  // set. It outranks the graveyard replacements below: both send the card to
  // exile anyway, so the order is unobservable, but the reason differs.
  if (
    toZone !== "exile" &&
    state.cards[cardId]?.exileIfLeaves === true &&
    state.cards[cardId]?.zone === "battlefield"
  ) {
    return "exile";
  }
  if (toZone === "graveyard" && graveyardReplacedByExile(state)) {
    // Rest in Peace (CR 614.6): the object never reaches the graveyard, so
    // dies triggers do not fire.
    return "exile";
  }
  // Blightsteel Colossus: THIS card, and only this card, goes back into the
  // library instead. Checked after the commander redirect, which outranks it
  // for a commander that would die — CR 903.9a is a choice, and this engine
  // makes it one way and says so.
  if (toZone === "graveyard" && shufflesIntoLibraryInstead(state, cardId)) {
    return "library";
  }
  if (toZone === "graveyard" && voidExileApplies(state, cardId)) {
    // Dauthi Voidwalker: an OPPONENT's card only. Scoped by owner, unlike
    // Rest in Peace, which is the whole difference between the two.
    return "exile";
  }
  return toZone;
}

/**
 * Dauthi Voidwalker: is this card owned by an opponent of someone who has
 * the void-exile replacement on the battlefield? The controller's own cards
 * go to their graveyard as normal.
 */
export function voidExileApplies(state: GameState, cardId: CardInstanceId): boolean {
  const ownerId = state.cards[cardId]?.ownerId;
  if (!ownerId) {
    return false;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
      return false;
    }
    if (card.controllerId === ownerId) {
      return false;
    }
    return (state.definitions[card.definitionId]?.replacements ?? []).some(
      (replacement) => replacement.kind === "opponents_graveyard_to_void_exile",
    );
  });
}

/**
 * Blightsteel Colossus: the replacement lives on the card being moved, not
 * on a permanent watching the table, so it applies from every zone — the
 * battlefield, the stack, the library, the hand.
 */
export function shufflesIntoLibraryInstead(
  state: GameState,
  cardId: CardInstanceId,
): boolean {
  const card = state.cards[cardId];
  if (!card) {
    return false;
  }
  // On the battlefield the ability can be silenced; anywhere else it cannot.
  if (card.zone === "battlefield" && abilitiesRemoved(state, cardId)) {
    return false;
  }
  return (state.definitions[card.definitionId]?.replacements ?? []).some(
    (replacement) => replacement.kind === "self_to_library_shuffled",
  );
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
  libraryPosition?: LibraryPosition;
  /**
   * Collect dies events here instead of dispatching them immediately.
   * State-based sweeps use this so simultaneous deaths reach watchers as
   * one batch (CR 603.10a look-back — the Blood Artist ruling).
   */
  collectDies?: EngineEvent[];
  /**
   * The permanent is arriving by resolving as a SPELL ("if you cast it").
   * Carried through the move rather than stamped afterwards, because the
   * enter-the-battlefield triggers are queued inside this call and an
   * intervening `if` is checked as the trigger goes on the stack.
   */
  fromCast?: boolean;
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
  insertIntoZone(
    owner,
    destination,
    cardId,
    // "Shuffle it into its owner's library" — not onto the top of it, which
    // is where a redirected move would otherwise land.
    destination === "library" && shufflesIntoLibraryInstead(state, cardId)
      ? "shuffled"
      : options.libraryPosition ?? "top",
  );
  card.zone = destination;
  applyZoneChangeFlags(state, card, destination, options.fromCast);
  // Dauthi Voidwalker: the card is exiled WITH a void counter, and the
  // counter is how the ability later finds it. Stamped only when the void
  // replacement is what redirected it, so an ordinary exile stays bare.
  if (destination === "exile" && toZone === "graveyard" && voidExileApplies(state, cardId)) {
    card.counters["void"] = (card.counters["void"] ?? 0) + 1;
  }
  state.log.push({ kind: "zone_change", cardId, from: fromZone, to: destination });
  if (destination === "battlefield") {
    onEnterBattlefieldInPlace(state, cardId);
  }
  // Every battlefield exit dispatches this, not only one that carried
  // counters. The Ozolith wanted the counters, so the gate used to live
  // here; but "when ~ leaves the battlefield" is a real trigger on cards
  // that have no counters at all, and gating the EVENT made those
  // unfirable. The counter test now sits in the matcher, where it belongs
  // to the trigger that asks it.
  if (fromZone === "battlefield") {
    dispatchEventsInPlace(state, [
      { kind: "leaves_battlefield", cardId, controllerId: diedControllerId, amount: leftCounters },
    ]);
  }
  // The other half of "from ANYWHERE": this function is the path a card
  // takes when it leaves the STACK — countered, or fizzled — and the one
  // in `moveCardInPlace` never sees that. The two are disjoint (this one
  // refuses a card already in a player zone), so no card is told twice.
  //
  // It rides `collectDies` when the caller is batching, for the same reason
  // `dies` does: a wipe dispatches every death as ONE batch (CR 603.10a),
  // and dispatching mid-sweep would fire the watchers a permanent at a time.
  if (destination === "graveyard") {
    const arrival: EngineEvent = { kind: "put_into_graveyard", cardId };
    if (options.collectDies) {
      options.collectDies.push(arrival);
    } else {
      dispatchEventsInPlace(state, [arrival]);
    }
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

/**
 * Everything a permanent's arrival owes, in ONE place. Both zone-change
 * paths call this rather than repeating the queue calls, which is also where
 * an evoke sacrifice or an echo debt would otherwise be added to one path
 * and forgotten on the other.
 */
function onEnterBattlefieldInPlace(state: GameState, cardId: CardInstanceId): void {
  queueEnterReplacementChoicesInPlace(state, cardId);
  queueEnterBattlefieldTriggersInPlace(state, cardId);
  const card = state.cards[cardId];
  if (!card) {
    return;
  }
  // Echo (CR 702.29): the debt is armed on ENTRY, so the next upkeep trigger
  // has something to read. Armed before the evoke sacrifice below, because
  // an evoked permanent never sees an upkeep and the order must not matter.
  if (state.definitions[card.definitionId]?.echo) {
    card.echoDue = true;
  }
  // Evoke (CR 702.74b): "it's sacrificed when it enters". The flag is read
  // once and cleared, so a Mulldrifter later reanimated keeps its body.
  //
  // Documented simplification: the sacrifice happens as the permanent
  // finishes entering rather than as a separate triggered ability, so
  // nothing can respond between the two — the same shape the Saga sacrifice
  // already uses. The enter triggers are queued FIRST, so Mulldrifter's two
  // cards are on the stack before the body goes, which is the whole card.
  if (card.evoked) {
    delete card.evoked;
    moveCardInPlace(state, cardId, "graveyard");
  }
}

function applyZoneChangeFlags(
  state: GameState,
  card: CardInstance,
  toZone: keyof PlayerZones,
  fromCast?: boolean,
): void {
  card.attacking = false;
  card.blockingAttackerId = null;
  if (toZone !== "battlefield") {
    // The shield is spent the moment it fires: a card whipped back a second
    // time gets a second shield, and one that reached exile some other way
    // must not keep it.
    delete card.exileIfLeaves;
  }
  if (toZone === "battlefield") {
    card.summoningSick = true;
    card.damageMarked = 0;
    // Cleared on every entry; the caster's entry sets it again below. A
    // permanent that died and came back is not one you cast.
    delete card.enteredFromCast;
    if (fromCast) {
      card.enteredFromCast = true;
    }
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
  libraryPosition: LibraryPosition,
): void {
  if (zone === "library") {
    // Approach of the Second Sun: "seventh from the top". One-based, and a
    // library shorter than that simply takes it on the bottom — which is
    // where seventh-from-the-top is when you have six cards.
    if (typeof libraryPosition === "object") {
      const index = Math.max(0, libraryPosition.fromTop - 1);
      player.zones.library.splice(Math.min(index, player.zones.library.length), 0, cardId);
      return;
    }
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
  insertIntoZone(
    owner,
    destination,
    cardId,
    // "Shuffle it into its owner's library" — not onto the top of it, which
    // is where a redirected move would otherwise land.
    destination === "library" && shufflesIntoLibraryInstead(state, cardId)
      ? "shuffled"
      : options.libraryPosition ?? "top",
  );
  card.zone = destination;
  applyZoneChangeFlags(state, card, destination, options.fromCast);
  // Dauthi Voidwalker: the card is exiled WITH a void counter, and the
  // counter is how the ability later finds it. Stamped only when the void
  // replacement is what redirected it, so an ordinary exile stays bare.
  if (destination === "exile" && toZone === "graveyard" && voidExileApplies(state, cardId)) {
    card.counters["void"] = (card.counters["void"] ?? 0) + 1;
  }
  state.log.push({ kind: "zone_change", cardId, from: located.zone, to: destination });
  if (destination === "battlefield") {
    onEnterBattlefieldInPlace(state, cardId);
  }
  // Every battlefield exit dispatches this, not only one that carried
  // counters. The Ozolith wanted the counters, so the gate used to live
  // here; but "when ~ leaves the battlefield" is a real trigger on cards
  // that have no counters at all, and gating the EVENT made those
  // unfirable. The counter test now sits in the matcher, where it belongs
  // to the trigger that asks it.
  if (located.zone === "battlefield") {
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
  // Kozilek, Ulamog: "from ANYWHERE" is the superset of that one and of
  // `dies` — the battlefield included. Kept as its own event rather than
  // widening Syr Konrad's, which means the other thing on purpose. Batched
  // with the deaths when the caller is collecting them.
  if (located.zone !== "graveyard" && destination === "graveyard") {
    const arrival: EngineEvent = { kind: "put_into_graveyard", cardId };
    if (options.collectDies) {
      options.collectDies.push(arrival);
    } else {
      dispatchEventsInPlace(state, [arrival]);
    }
  }
  if (located.zone === "graveyard" && destination !== "graveyard") {
    dispatchEventsInPlace(state, [{ kind: "leaves_graveyard", cardId, ownerId: owner.id }]);
  }

  if (countCardPlacements(state, cardId) !== 1) {
    throw new Error(`Zone integrity failed for ${cardId}`);
  }
}
