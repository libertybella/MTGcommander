import { characteristicsOf, isCreature, isLand, isPlaneswalker } from "./cardTypes";
import { COMMANDER_DAMAGE_TO_LOSE, POISON_COUNTERS_TO_LOSE } from "./cardTypes";
import { cantLoseGame, creatureToughness, permanentsControlledBy } from "./derived";
import { hasKeyword } from "./keywords";
import { eliminatePlayerInPlace } from "./elimination";
import { isLiving, livingPlayerCount, nextLivingPlayerId, winnerId } from "./players";
import { dispatchEventsInPlace } from "./triggers";
import { moveCardInPlace, processDiesReturnsInPlace } from "./zones";
import type { CardDefinition, CardInstanceId, EngineEvent, GameState } from "./types";

/**
 * "Enchant <thing>" as a host test (CR 704.5m). A TOTAL record rather than
 * the ternary chain this used to be: the chain fell through to "is it a
 * creature" for anything it did not name, so a new restriction would have
 * silently made every Aura a creature Aura for state-based purposes.
 */
const AURA_HOSTS: Record<
  NonNullable<CardDefinition["enchant"]>,
  (state: GameState, cardId: CardInstanceId, auraControllerId: string) => boolean
> = {
  creature: (state, cardId) => isCreature(state, cardId),
  land: (state, cardId) => isLand(state, cardId),
  creature_or_planeswalker_own: (state, cardId) =>
    isCreature(state, cardId) || isPlaneswalker(state, cardId),
  creature_land_or_planeswalker: (state, cardId) =>
    isCreature(state, cardId) || isLand(state, cardId) || isPlaneswalker(state, cardId),
  // Song of the Dryads: anything on the battlefield is a permanent, and the
  // caller has already checked the zone.
  permanent: () => true,
  artifact_own: (state, cardId, auraControllerId) =>
    characteristicsOf(state, cardId).types.includes("artifact") &&
    state.cards[cardId]?.controllerId === auraControllerId,
};

function shouldLose(state: GameState, player: GameState["players"][number]): boolean {
  // Platinum Angel vetoes the loss itself, not the cause: the player stays
  // at zero life or with lethal commander damage and simply does not lose,
  // so removing the Angel loses the game immediately.
  if (cantLoseGame(state, player.id)) {
    return false;
  }
  if (player.failedToDraw) {
    return true;
  }
  if (player.life <= 0) {
    return true;
  }
  // CR 104.3c. Ten is ten however they arrived, and unlike life there is no
  // gaining them back.
  if (player.poisonCounters >= POISON_COUNTERS_TO_LOSE) {
    return true;
  }
  return Object.values(player.commander.damageReceived).some(
    (amount) => amount >= COMMANDER_DAMAGE_TO_LOSE,
  );
}

function destroyZeroToughnessInPlace(state: GameState, collectDies: EngineEvent[]): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.phasedOut || !isCreature(state, card.id)) {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (definition?.toughness === null || definition?.toughness === undefined) {
      continue;
    }
    if (creatureToughness(state, card.id) > 0) {
      continue;
    }
    // A 0/0 clone with its enter-as-copy choice still pending is mid-entry:
    // the real card would enter as the copy and never exist at 0 toughness,
    // so the sweep waits for the prompt to resolve.
    if (
      state.prompts.some(
        (prompt) => prompt.kind === "enter_as_copy" && prompt.sourceId === card.id,
      )
    ) {
      continue;
    }
    moveCardInPlace(state, card.id, "graveyard", { collectDies });
    changed = true;
  }
  return changed;
}

/**
 * CR 701.7 — DESTROY a permanent, as opposed to any other trip to the
 * graveyard. Every destruction in the engine goes through here, because the
 * two things that stop one are easy to write in one place and easy to forget
 * everywhere else: for a long time the sweeps checked indestructible and
 * "Destroy target creature" did not, so a Blightsteel Colossus died to Beast
 * Within.
 *
 * A sacrifice, a bounce, a tuck and a 0-toughness state-based death are NOT
 * destructions and must not call this — none of them are stopped by
 * indestructible, and CR 704.5f puts a 0-toughness creature into the
 * graveyard without ever using the word.
 *
 * Returns whether the permanent actually died.
 */
export function destroyPermanentInPlace(
  state: GameState,
  cardId: CardInstanceId,
  collectDies: EngineEvent[],
  options: { denyRegeneration?: boolean } = {},
): boolean {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return false;
  }
  // Indestructible is checked BEFORE totem armor: a permanent that is never
  // destroyed never reaches the replacement, so the Umbra is not consumed
  // (CR 702.87b).
  if (hasKeyword(state, cardId, "indestructible")) {
    return false;
  }
  /**
   * Regeneration (CR 701.15). A replacement for the destruction: the shield
   * is spent, all damage comes off, the permanent taps, and it leaves
   * combat. Tried BEFORE totem armor because the shield was paid for this
   * turn specifically and the Umbra is a standing effect — CR 616.1 lets
   * the controller choose between two replacements, and this is the
   * documented auto-pick.
   */
  const shields = card.regenerationShields ?? 0;
  // "It can't be regenerated" (CR 701.15d) turns the shield off for THIS
  // destruction without spending it: the creature keeps whatever it paid
  // for, and the next destruction is still replaced. Totem armor is not
  // regeneration and still applies below.
  if (shields > 0 && options.denyRegeneration !== true) {
    card.regenerationShields = shields - 1;
    card.damageMarked = 0;
    card.deathtouched = false;
    card.tapped = true;
    // "Remove it from combat": it stops attacking, and the combat record
    // drops it so no damage is assigned to or by it.
    card.attacking = false;
    if (state.combat) {
      state.combat.attacks = state.combat.attacks.filter(
        (attack) => attack.attackerId !== cardId,
      );
      for (const [attackerId, blockers] of Object.entries(state.combat.blockers)) {
        state.combat.blockers[attackerId] = blockers.filter((id) => id !== cardId);
      }
    }
    return false;
  }
  // Totem armor (CR 702.87a): the Aura dies instead and the damage comes
  // off. Auras are checked oldest-first so that with two Umbras on one
  // creature the second one is still there for the next destruction.
  const umbra = Object.values(state.cards)
    .filter(
      (entry) =>
        entry.zone === "battlefield" &&
        entry.attachedTo === cardId &&
        state.definitions[entry.definitionId]?.totemArmor === true,
    )
    .sort((a, b) => a.timestamp - b.timestamp)[0];
  if (umbra) {
    card.damageMarked = 0;
    card.deathtouched = false;
    moveCardInPlace(state, umbra.id, "graveyard", { collectDies });
    return false;
  }
  moveCardInPlace(state, cardId, "graveyard", { collectDies });
  return true;
}

/** CR 704.5g/h: lethal marked damage, or any deathtouch damage, destroys. */
function destroyLethalDamageInPlace(state: GameState, collectDies: EngineEvent[]): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.phasedOut || !isCreature(state, card.id)) {
      continue;
    }
    const toughness = creatureToughness(state, card.id);
    const lethal =
      (toughness > 0 && card.damageMarked >= toughness) ||
      (card.deathtouched && card.damageMarked > 0);
    if (!lethal) {
      continue;
    }
    if (destroyPermanentInPlace(state, card.id, collectDies)) {
      changed = true;
    } else if (state.cards[card.id]?.damageMarked === 0) {
      // Totem armor took the hit: the damage is gone, so the sweep has to
      // run again rather than seeing the same lethal creature forever.
      changed = true;
    }
  }
  return changed;
}

/**
 * CR 704.5j, simplified: with two same-named legendary permanents under one
 * controller, the newest stays and the rest go to the graveyard. (The CR
 * lets the controller choose; the auto-pick is logged via zone changes and
 * a choice prompt arrives with the Stage 4 decision framework.)
 */
function legendRuleInPlace(state: GameState, collectDies: EngineEvent[]): boolean {
  const groups = new Map<string, string[]>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (!definition || !definition.characteristics.supertypes.includes("legendary")) {
      continue;
    }
    const key = `${card.controllerId}::${definition.name}`;
    groups.set(key, [...(groups.get(key) ?? []), card.id]);
  }
  let changed = false;
  for (const cardIds of groups.values()) {
    if (cardIds.length < 2) {
      continue;
    }
    const keep = cardIds.reduce((best, id) =>
      (state.cards[id]?.timestamp ?? 0) > (state.cards[best]?.timestamp ?? 0) ? id : best,
    );
    for (const cardId of cardIds) {
      if (cardId !== keep && state.cards[cardId]?.zone === "battlefield") {
        moveCardInPlace(state, cardId, "graveyard", { collectDies });
        changed = true;
      }
    }
  }
  return changed;
}

/** CR 704.5m/n: a loose or illegally attached Aura dies; Equipment detaches. */
function attachmentLegalityInPlace(state: GameState, collectDies: EngineEvent[]): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    const isAura = Boolean(definition?.enchant);
    const isEquipment = definition?.characteristics.subtypes.includes("equipment") ?? false;
    if (!isAura && !isEquipment) {
      continue;
    }
    const host = card.attachedTo ? state.cards[card.attachedTo] : undefined;
    const hostTest = definition?.enchant ? AURA_HOSTS[definition.enchant] : null;
    const hostLegal = Boolean(
      host &&
        host.zone === "battlefield" &&
        // Equipment has no `enchant` line and always wants a creature.
        (hostTest ? hostTest(state, host.id, card.controllerId) : isCreature(state, host.id)),
    );
    if (hostLegal) {
      continue;
    }
    if (isAura) {
      moveCardInPlace(state, card.id, "graveyard", { collectDies });
      changed = true;
    } else if (card.attachedTo) {
      card.attachedTo = null;
      changed = true;
    }
  }
  return changed;
}

/** CR 704.5i: a planeswalker with zero loyalty goes to the graveyard. */
function planeswalkerLoyaltyInPlace(state: GameState, collectDies: EngineEvent[]): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (!definition?.characteristics.types.includes("planeswalker")) {
      continue;
    }
    if ((card.counters["loyalty"] ?? 0) <= 0) {
      moveCardInPlace(state, card.id, "graveyard", { collectDies });
      changed = true;
    }
  }
  return changed;
}

/** CR 704.5d: a token anywhere but the battlefield ceases to exist. */
function tokenCessationInPlace(state: GameState): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (!card.isToken || card.zone === "battlefield" || card.zone === "removed" || card.zone === "stack") {
      continue;
    }
    moveCardInPlace(state, card.id, "removed");
    changed = true;
  }
  return changed;
}

/**
 * Apply current loss conditions: 0 life, 21 commander damage, and failing to
 * draw from an empty library use the same leave-the-game transition as concede.
 * Creatures with 0 toughness also die (including indestructible). Does not skip turns.
 */
export function applyStateBasedActionsInPlace(state: GameState): void {
  let changed = true;
  let guard = 0;
  while (changed && guard < 50) {
    guard += 1;
    changed = false;
    const leaving = state.players
      .filter((player) => !player.lost && shouldLose(state, player))
      .map((player) => player.id);
    for (const playerId of leaving) {
      eliminatePlayerInPlace(state, playerId);
      changed = true;
    }
    // Simultaneous deaths within one sweep dispatch as one batch so dies-
    // watchers that died together still see each other (CR 603.10a).
    const collectDies: EngineEvent[] = [];
    if (destroyZeroToughnessInPlace(state, collectDies)) {
      changed = true;
    }
    if (destroyLethalDamageInPlace(state, collectDies)) {
      changed = true;
    }
    if (legendRuleInPlace(state, collectDies)) {
      changed = true;
    }
    if (attachmentLegalityInPlace(state, collectDies)) {
      changed = true;
    }
    if (planeswalkerLoyaltyInPlace(state, collectDies)) {
      changed = true;
    }
    if (tokenCessationInPlace(state)) {
      changed = true;
    }
    if (collectDies.length > 0) {
      dispatchEventsInPlace(state, collectDies);
      processDiesReturnsInPlace(state, collectDies);
    }
  }
  // Ascend (CR 702.131): controlling ten or more permanents while an Ascend
  // source is on the battlefield grants the city's blessing for the game.
  for (const player of state.players) {
    if (player.lost || player.cityBlessing) {
      continue;
    }
    const permanents = permanentsControlledBy(state, player.id);
    if (permanents.length < 10) {
      continue;
    }
    const hasAscendSource = permanents.some(
      (cardId) => state.definitions[state.cards[cardId]?.definitionId ?? ""]?.ascend === true,
    );
    if (hasAscendSource) {
      player.cityBlessing = true;
    }
  }
  state.winnerId = winnerId(state);
}

export function isGameOver(state: GameState): boolean {
  return livingPlayerCount(state) <= 1;
}

/** If the priority player has lost, give priority to a living player. */
export function redirectPriorityIfLost(state: GameState): void {
  if (livingPlayerCount(state) === 0) {
    return;
  }
  if (isLiving(state, state.priorityPlayerId)) {
    return;
  }
  state.priorityPlayerId = isLiving(state, state.turn.activePlayerId)
    ? state.turn.activePlayerId
    : nextLivingPlayerId(state, state.priorityPlayerId);
  state.passesSinceAction = 0;
}
