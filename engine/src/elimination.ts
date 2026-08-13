import { cloneGameState } from "./clone";
import { emptyManaPool } from "./createGame";
import { isLiving, winnerId } from "./players";
import {
  enterOwnerZoneInPlace,
  findCardZone,
  moveCardInPlace,
} from "./zones";
import type { CardInstanceId, GameState, PlayerId } from "./types";

function resetControllerToOwner(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (card) {
    card.controllerId = card.ownerId;
  }
}

function removeStackObjectsForSource(state: GameState, cardId: CardInstanceId): void {
  state.stack = state.stack.filter((entry) => entry.sourceId !== cardId);
}

/** Owned objects leave the game. Stack cards enter the owner's removed zone. */
function leaveTheGameInPlace(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (!card) {
    return;
  }
  if (card.zone === "removed") {
    return;
  }
  if (card.zone === "stack") {
    removeStackObjectsForSource(state, cardId);
    enterOwnerZoneInPlace(state, cardId, "removed");
    resetControllerToOwner(state, cardId);
    return;
  }
  moveCardInPlace(state, cardId, "removed");
  resetControllerToOwner(state, cardId);
}

/**
 * Objects the leaving player controls but does not own are exiled
 * (commanders still follow the existing command-zone replacement).
 */
function exileUnownedControlledInPlace(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (!card) {
    return;
  }
  if (card.zone === "stack") {
    removeStackObjectsForSource(state, cardId);
    enterOwnerZoneInPlace(state, cardId, "exile");
    resetControllerToOwner(state, cardId);
    return;
  }
  if (!findCardZone(state, cardId)) {
    return;
  }
  moveCardInPlace(state, cardId, "exile");
  resetControllerToOwner(state, cardId);
}

function cleanCombatInPlace(state: GameState): void {
  if (!state.combat) {
    return;
  }
  state.combat.attacks = state.combat.attacks.filter((attack) => {
    const attacker = state.cards[attack.attackerId];
    return attacker?.zone === "battlefield" && isLiving(state, attack.defenderId);
  });
  const validAttackers = new Set(state.combat.attacks.map((attack) => attack.attackerId));
  const blockers: Record<string, string[]> = {};
  for (const [attackerId, list] of Object.entries(state.combat.blockers)) {
    if (!validAttackers.has(attackerId)) {
      continue;
    }
    blockers[attackerId] = list.filter((id) => state.cards[id]?.zone === "battlefield");
  }
  state.combat.blockers = blockers;
  state.combat.declaredBlockersFor = state.combat.declaredBlockersFor.filter((id) =>
    isLiving(state, id),
  );
}

/**
 * Commander multiplayer leave-the-game transition (CR 800.4, without triggers).
 * Idempotent: already-eliminated players are left unchanged.
 */
export function eliminatePlayerInPlace(state: GameState, playerId: PlayerId): void {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (player.lost) {
    return;
  }
  player.lost = true;
  player.mana = emptyManaPool();

  const ownedIds = Object.values(state.cards)
    .filter((card) => card.ownerId === playerId)
    .map((card) => card.id);
  const controlledUnownedIds = Object.values(state.cards)
    .filter((card) => card.controllerId === playerId && card.ownerId !== playerId)
    .map((card) => card.id);

  for (const cardId of ownedIds) {
    leaveTheGameInPlace(state, cardId);
  }
  for (const cardId of controlledUnownedIds) {
    exileUnownedControlledInPlace(state, cardId);
  }

  state.stack = state.stack.filter((entry) => entry.controllerId !== playerId);
  cleanCombatInPlace(state);
  state.winnerId = winnerId(state);
}

export function eliminatePlayer(state: GameState, playerId: PlayerId): GameState {
  const next = cloneGameState(state);
  eliminatePlayerInPlace(next, playerId);
  return next;
}
