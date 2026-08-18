import { applyEffect } from "./effects";
import { isLiving, requireLiving } from "./players";
import { isOpeningRoll } from "./openingRoll";
import { isGameOver } from "./status";
import { isMulliganOpen } from "./mulligan";
import { isHiddenFromViewer } from "./visibility";
import { findCardZone } from "./zones";
import type {
  CardInstanceId,
  GameState,
  ManualOverrideChange,
  PlayerId,
  PlayerZones,
  ZoneName,
} from "./types";

const MOVE_ZONES: (keyof PlayerZones)[] = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
];

function playerName(state: GameState, playerId: PlayerId): string {
  return state.players.find((player) => player.id === playerId)?.displayName ?? playerId;
}

function cardName(state: GameState, cardId: CardInstanceId): string {
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  return definition?.name ?? cardId;
}

function requireOverrideActor(state: GameState, playerId: PlayerId): void {
  requireLiving(state, playerId);
  if (isGameOver(state)) {
    throw new Error("The game is already over");
  }
  if (isOpeningRoll(state)) {
    throw new Error("Roll for first player first");
  }
  if (isMulliganOpen(state)) {
    throw new Error("Finish mulligans before taking that action");
  }
}

function requireLivingTarget(state: GameState, playerId: PlayerId): void {
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (!isLiving(state, playerId)) {
    throw new Error("That player has already lost");
  }
}

function requireSelfTarget(actorId: PlayerId, targetPlayerId: PlayerId): void {
  if (actorId !== targetPlayerId) {
    throw new Error("You can only change your own board");
  }
}

function assertPublicCard(state: GameState, actorId: PlayerId, cardId: CardInstanceId): ZoneName {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone === "stack") {
    throw new Error("Cannot override a card on the stack");
  }
  const located = findCardZone(state, cardId);
  if (!located) {
    throw new Error(`Card ${cardId} is not in a player zone`);
  }
  if (isHiddenFromViewer(located.zone, card.ownerId, actorId)) {
    throw new Error("Cannot override a hidden card");
  }
  return located.zone;
}

function assertOwnPublicCard(state: GameState, actorId: PlayerId, cardId: CardInstanceId): ZoneName {
  const zone = assertPublicCard(state, actorId, cardId);
  const located = findCardZone(state, cardId);
  if (!located || located.playerId !== actorId) {
    throw new Error("You can only change your own cards");
  }
  return zone;
}

function applyChange(
  state: GameState,
  actorId: PlayerId,
  change: ManualOverrideChange,
): { next: GameState; summary: string } {
  switch (change.type) {
    case "adjust_life": {
      requireSelfTarget(actorId, change.targetPlayerId);
      requireLivingTarget(state, change.targetPlayerId);
      if (!Number.isInteger(change.delta) || change.delta === 0) {
        throw new Error("Life override must be a non-zero integer");
      }
      const next =
        change.delta > 0
          ? applyEffect(state, {
              kind: "gain_life",
              playerId: change.targetPlayerId,
              amount: change.delta,
            })
          : applyEffect(state, {
              kind: "lose_life",
              playerId: change.targetPlayerId,
              amount: -change.delta,
            });
      const delta = change.delta > 0 ? `+${change.delta}` : `${change.delta}`;
      return { next, summary: `${playerName(state, change.targetPlayerId)} life ${delta}` };
    }
    case "draw": {
      requireSelfTarget(actorId, change.targetPlayerId);
      requireLivingTarget(state, change.targetPlayerId);
      const next = applyEffect(state, {
        kind: "draw",
        playerId: change.targetPlayerId,
        count: change.count,
      });
      return {
        next,
        summary: `${playerName(state, change.targetPlayerId)} draws ${change.count}`,
      };
    }
    case "mill": {
      requireSelfTarget(actorId, change.targetPlayerId);
      requireLivingTarget(state, change.targetPlayerId);
      const next = applyEffect(state, {
        kind: "mill",
        playerId: change.targetPlayerId,
        count: change.count,
      });
      return {
        next,
        summary: `${playerName(state, change.targetPlayerId)} mills ${change.count}`,
      };
    }
    case "add_mana": {
      requireSelfTarget(actorId, change.targetPlayerId);
      requireLivingTarget(state, change.targetPlayerId);
      const next = applyEffect(state, {
        kind: "add_mana",
        playerId: change.targetPlayerId,
        mana: { [change.color]: 1 },
      });
      return {
        next,
        summary: `${playerName(state, change.targetPlayerId)} mana +${change.color}`,
      };
    }
    case "move_card": {
      const from = assertOwnPublicCard(state, actorId, change.cardId);
      if (!MOVE_ZONES.includes(change.toZone)) {
        throw new Error(`Cannot move a card to ${change.toZone}`);
      }
      if (from === change.toZone) {
        throw new Error("Card is already in that zone");
      }
      const next = applyEffect(state, {
        kind: "move_card",
        cardId: change.cardId,
        toZone: change.toZone,
      });
      return {
        next,
        summary: `${cardName(state, change.cardId)} ${from} → ${change.toZone}`,
      };
    }
    case "set_tapped": {
      assertOwnPublicCard(state, actorId, change.cardId);
      const next = applyEffect(state, {
        kind: change.tapped ? "tap" : "untap",
        cardId: change.cardId,
      });
      return {
        next,
        summary: `${cardName(state, change.cardId)} ${change.tapped ? "tapped" : "untapped"}`,
      };
    }
    case "discard_hand": {
      const player = state.players.find((entry) => entry.id === actorId);
      const count = player?.zones.hand.length ?? 0;
      if (count === 0) {
        throw new Error("Hand is empty");
      }
      const next = applyEffect(state, { kind: "discard", playerId: actorId, count });
      return { next, summary: `${playerName(state, actorId)} discards hand (${count})` };
    }
    case "create_token": {
      const next = applyEffect(state, {
        kind: "create_token",
        ownerId: actorId,
        name: change.template.name,
        typeLine: change.template.typeLine,
        power: change.template.power,
        toughness: change.template.toughness,
      });
      return { next, summary: `${playerName(state, actorId)} creates ${change.template.name}` };
    }
    default: {
      const exhaustive: never = change;
      throw new Error(`Unknown override ${(exhaustive as ManualOverrideChange).type}`);
    }
  }
}

/**
 * Self-only table correction. Does not require priority. Illegal changes throw
 * and leave the original GameState unchanged (via applyAction).
 */
export function applyManualOverride(
  state: GameState,
  playerId: PlayerId,
  change: ManualOverrideChange,
): GameState {
  requireOverrideActor(state, playerId);
  const { next, summary } = applyChange(state, playerId, change);
  next.log.push({ kind: "override", playerId, summary });
  return next;
}
