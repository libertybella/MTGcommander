import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { isCreature } from "./cardTypes";
import { hasKeyword } from "./keywords";
import { legalActions } from "./legalActions";
import { manaAbilitiesOf, manaTapOptionsFor } from "./manaOptions";
import { isMulliganOpen } from "./mulligan";
import { isOpeningRoll, openingRollPending } from "./openingRoll";
import { isLiving, livingPlayerCount } from "./players";
import { POOL_ID } from "./pool";
import { currentPrompt, legalIdsForChooseSources, lookedAtCardIds } from "./prompt";
import { parseGameState, serializeGameState } from "./serialize";
import { startCatalogGame } from "./setup";
import { isGameOver } from "./status";
import { legalChoicesForRequirement } from "./targeting";
import { countCardPlacements, PLAYER_ZONES } from "./zones";
import type {
  ChosenTarget,
  GameAction,
  GameState,
  PlayerId,
  TargetRequirement,
} from "./types";

/**
 * State-integrity fuzzer (Stage 0.5). Seeded random legal actions drive full
 * games; after every action the state must keep zone integrity, and it must
 * survive a serialize/parse round trip. Failures here are engine bugs, not
 * test flakes: the seed in the failure message reproduces the run.
 *
 * Scale with FUZZ_SEEDS (default 6) and FUZZ_ACTIONS per game (default 400).
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randomSubset<T>(rng: () => number, items: T[], probability: number): T[] {
  return items.filter(() => rng() < probability);
}

const POOL_IDS = Object.values(POOL_ID);

function buildGame(rng: () => number): GameState {
  const playerCount = pick(rng, [2, 3, 4] as const);
  const decks = Array.from({ length: playerCount }, () => ({
    commanderDefinitionId: pick(rng, [POOL_ID.dragon, POOL_ID.angel, POOL_ID.lord]),
    libraryDefinitionIds: Array.from({ length: 24 }, () => pick(rng, POOL_IDS)),
  }));
  return startCatalogGame({
    playerCount,
    decks,
    openingHandSize: 7,
    skipMulligan: false,
    skipOpeningRoll: false,
  });
}

function randomTargets(
  state: GameState,
  requirements: TargetRequirement[],
  playerId: PlayerId,
  rng: () => number,
): ChosenTarget[] | null {
  const chosen: ChosenTarget[] = [];
  for (const requirement of requirements) {
    const options = legalChoicesForRequirement(state, requirement, playerId);
    if (options.length === 0) {
      return null;
    }
    chosen.push(pick(rng, options));
  }
  return chosen;
}

/** The next action a table in this state would accept, chosen at random. */
function nextAction(state: GameState, rng: () => number): GameAction | null {
  if (isGameOver(state)) {
    return null;
  }
  if (isOpeningRoll(state) && state.openingRoll) {
    const pending = state.players.find(
      (player) => !player.lost && openingRollPending(state, player.id),
    );
    return pending ? { kind: "opening_roll", playerId: pending.id } : null;
  }
  if (isMulliganOpen(state) && state.mulligan) {
    const playerId = state.mulligan.decidingPlayerId;
    const player = state.players.find((entry) => entry.id === playerId)!;
    if (state.mulligan.pendingBottom > 0) {
      const hand = [...player.zones.hand];
      const cardIds: string[] = [];
      for (let i = 0; i < state.mulligan.pendingBottom; i += 1) {
        const index = Math.floor(rng() * hand.length);
        cardIds.push(...hand.splice(index, 1));
      }
      return { kind: "bottom_cards", playerId, cardIds };
    }
    const taken = state.mulligan.taken[playerId] ?? 0;
    if (taken < 2 && rng() < 0.25) {
      return { kind: "mulligan", playerId };
    }
    return { kind: "keep_hand", playerId };
  }
  const prompt = currentPrompt(state);
  if (prompt) {
    const playerId = prompt.playerId;
    switch (prompt.kind) {
      case "choose_targets": {
        const targets = randomTargets(state, prompt.requirements, playerId, rng);
        return { kind: "choose_targets", playerId, targets: targets ?? [] };
      }
      case "may_pay_life_or_enter_tapped":
        return { kind: "choose_enter_replacement", playerId, pay: rng() < 0.5 };
      case "scry": {
        const looked = lookedAtCardIds(state, prompt);
        return { kind: "resolve_scry", playerId, bottomIds: randomSubset(rng, looked, 0.4) };
      }
      case "surveil": {
        const looked = lookedAtCardIds(state, prompt);
        return { kind: "resolve_surveil", playerId, graveyardIds: randomSubset(rng, looked, 0.4) };
      }
      case "choose_discard": {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const hand = [...player.zones.hand];
        const cardIds: string[] = [];
        for (let i = 0; i < prompt.count && hand.length > 0; i += 1) {
          const index = Math.floor(rng() * hand.length);
          cardIds.push(...hand.splice(index, 1));
        }
        return { kind: "resolve_discard", playerId, cardIds };
      }
      case "choose_card": {
        const legal = legalIdsForChooseSources(state, prompt.sources);
        if (legal.length === 0) {
          return null;
        }
        return { kind: "resolve_choose_card", playerId, cardId: pick(rng, legal) };
      }
      case "look_and_assign": {
        const looked = lookedAtCardIds(state, prompt);
        return {
          kind: "resolve_look_assign",
          playerId,
          assignments: looked.map((cardId, index) => ({
            cardId,
            destination:
              prompt.destinations[index] ?? pick(rng, [...prompt.destinations]) ?? "hand",
          })),
        };
      }
      default:
        return null;
    }
  }

  const playerId = state.priorityPlayerId;
  if (!isLiving(state, playerId)) {
    return null;
  }

  if (state.turn.step === "declareAttackers" && playerId === state.turn.activePlayerId && !state.combat?.attackersDeclared) {
    const defenders = state.players.filter(
      (player) => player.id !== playerId && isLiving(state, player.id),
    );
    const attackers = Object.values(state.cards).filter(
      (card) =>
        card.controllerId === playerId &&
        card.zone === "battlefield" &&
        isCreature(state, card.id) &&
        !card.tapped &&
        (!card.summoningSick || hasKeyword(state, card.id, "haste")) &&
        !hasKeyword(state, card.id, "defender"),
    );
    const attacks = randomSubset(rng, attackers, 0.5).map((card) => ({
      attackerId: card.id,
      defenderId: pick(rng, defenders).id,
    }));
    return { kind: "declare_attackers", playerId, attacks };
  }

  const actions = legalActions(state, playerId).filter((action) => action.kind !== "declare_blockers");
  if (actions.length === 0 || rng() < 0.35) {
    return { kind: "pass_priority", playerId };
  }
  const action = pick(rng, actions);
  switch (action.kind) {
    case "play_land":
      return { kind: "play_land", playerId, cardId: action.cardId, faceIndex: action.faceIndex };
    case "cast_spell": {
      const card = state.cards[action.cardId]!;
      let definition = state.definitions[card.definitionId]!;
      if (action.faceIndex === 1 && definition.otherFaceId) {
        definition = state.definitions[definition.otherFaceId]!;
      }
      const targets = randomTargets(state, definition.targetRequirements, playerId, rng);
      if (targets === null) {
        return { kind: "pass_priority", playerId };
      }
      return {
        kind: "cast_spell",
        playerId,
        cardId: action.cardId,
        targets,
        faceIndex: action.faceIndex,
      };
    }
    case "activate_ability": {
      const card = state.cards[action.cardId]!;
      const ability = state.definitions[card.definitionId]!.activated[action.abilityIndex]!;
      const targets = randomTargets(state, ability.targetRequirements, playerId, rng);
      if (targets === null) {
        return { kind: "pass_priority", playerId };
      }
      return {
        kind: "activate_ability",
        playerId,
        cardId: action.cardId,
        abilityIndex: action.abilityIndex,
        targets,
      };
    }
    case "mana": {
      const card = state.cards[action.cardId]!;
      const abilities = manaAbilitiesOf(state.definitions[card.definitionId]!);
      const manaIndex = Math.floor(rng() * abilities.length);
      const options = manaTapOptionsFor(abilities[manaIndex]!);
      return {
        kind: "tap_for_mana",
        playerId,
        cardId: action.cardId,
        manaIndex,
        ...(options ? { color: pick(rng, options) } : {}),
      };
    }
    default:
      return { kind: "pass_priority", playerId };
  }
}

function checkIntegrity(state: GameState, context: string): void {
  for (const [cardId, card] of Object.entries(state.cards)) {
    const placements = countCardPlacements(state, cardId);
    if (card.zone === "stack") {
      expect(placements, `${context}: stack card ${cardId} still in a zone list`).toBe(0);
      expect(
        state.stack.some((entry) => entry.sourceId === cardId),
        `${context}: stack card ${cardId} not on the stack`,
      ).toBe(true);
    } else {
      expect(placements, `${context}: card ${cardId} placed ${placements} times`).toBe(1);
    }
  }
  for (const player of state.players) {
    for (const zone of PLAYER_ZONES) {
      for (const cardId of player.zones[zone]) {
        const card = state.cards[cardId];
        expect(card, `${context}: zone list has unknown card ${cardId}`).toBeTruthy();
        expect(card?.zone, `${context}: ${cardId} listed in ${zone}`).toBe(zone);
      }
    }
  }
}

function roundTrip(state: GameState, context: string): void {
  // Semantic equality: JSON key order is not part of the serialization
  // contract, but every value must survive parse and validation.
  const reparsed = parseGameState(serializeGameState(state));
  expect(reparsed, `${context}: serialize round trip drifted`).toEqual(state);
}

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 6);
const ACTIONS = Number(process.env.FUZZ_ACTIONS ?? 400);

describe("state-integrity fuzzer", () => {
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    it(`survives a random game (seed ${seed})`, () => {
      const rng = mulberry32(seed * 7919);
      let state = buildGame(rng);
      checkIntegrity(state, `seed ${seed} start`);
      let stuck = 0;
      for (let step = 0; step < ACTIONS; step += 1) {
        const action = nextAction(state, rng);
        if (!action) {
          break;
        }
        const context = `seed ${seed} step ${step} ${action.kind}`;
        try {
          state = applyAction(state, action);
          stuck = 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          expect(
            message.includes("mutated GameState"),
            `${context}: unexpected mutation guard: ${message}`,
          ).toBe(false);
          stuck += 1;
          expect(stuck, `${context}: engine rejected ${stuck} actions in a row: ${message}`).toBeLessThan(
            25,
          );
          continue;
        }
        checkIntegrity(state, context);
        if (step % 25 === 0) {
          roundTrip(state, context);
        }
      }
      roundTrip(state, `seed ${seed} end`);
      expect(livingPlayerCount(state)).toBeGreaterThanOrEqual(0);
    });
  }
});
