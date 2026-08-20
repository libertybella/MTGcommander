import { isCreature } from "./cardTypes";
import { COMMANDER_DAMAGE_TO_LOSE } from "./cardTypes";
import { creatureToughness } from "./derived";
import { hasKeyword } from "./keywords";
import { eliminatePlayerInPlace } from "./elimination";
import { isLiving, livingPlayerCount, nextLivingPlayerId, winnerId } from "./players";
import { moveCardInPlace } from "./zones";
import type { GameState } from "./types";

function shouldLose(player: GameState["players"][number]): boolean {
  if (player.failedToDraw) {
    return true;
  }
  if (player.life <= 0) {
    return true;
  }
  return Object.values(player.commander.damageReceived).some(
    (amount) => amount >= COMMANDER_DAMAGE_TO_LOSE,
  );
}

function destroyZeroToughnessInPlace(state: GameState): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || !isCreature(state, card.id)) {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (definition?.toughness === null || definition?.toughness === undefined) {
      continue;
    }
    if (creatureToughness(state, card.id) > 0) {
      continue;
    }
    moveCardInPlace(state, card.id, "graveyard");
    changed = true;
  }
  return changed;
}

/** CR 704.5g/h: lethal marked damage, or any deathtouch damage, destroys. */
function destroyLethalDamageInPlace(state: GameState): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || !isCreature(state, card.id)) {
      continue;
    }
    if (hasKeyword(state, card.id, "indestructible")) {
      continue;
    }
    const toughness = creatureToughness(state, card.id);
    const lethal =
      (toughness > 0 && card.damageMarked >= toughness) ||
      (card.deathtouched && card.damageMarked > 0);
    if (!lethal) {
      continue;
    }
    moveCardInPlace(state, card.id, "graveyard");
    changed = true;
  }
  return changed;
}

/**
 * CR 704.5j, simplified: with two same-named legendary permanents under one
 * controller, the newest stays and the rest go to the graveyard. (The CR
 * lets the controller choose; the auto-pick is logged via zone changes and
 * a choice prompt arrives with the Stage 4 decision framework.)
 */
function legendRuleInPlace(state: GameState): boolean {
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
        moveCardInPlace(state, cardId, "graveyard");
        changed = true;
      }
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
      .filter((player) => !player.lost && shouldLose(player))
      .map((player) => player.id);
    for (const playerId of leaving) {
      eliminatePlayerInPlace(state, playerId);
      changed = true;
    }
    if (destroyZeroToughnessInPlace(state)) {
      changed = true;
    }
    if (destroyLethalDamageInPlace(state)) {
      changed = true;
    }
    if (legendRuleInPlace(state)) {
      changed = true;
    }
    if (tokenCessationInPlace(state)) {
      changed = true;
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
