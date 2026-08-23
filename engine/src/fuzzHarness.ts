import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { isCreature } from "./cardTypes";
import {
  activatedOf,
  cardMatchesSubtype,
  computedCard,
  triggersOf,
} from "./characteristicsEngine";
import { controlsCommander } from "./derived";
import { hasKeyword } from "./keywords";
import { legalActions, sacrificeColorMatches, sacrificeScopeMatches } from "./legalActions";
import { canPayManaCost } from "./mana";
import { manaAbilitiesFor, manaTapOptionsFor } from "./manaOptions";
import { isMulliganOpen } from "./mulligan";
import { isOpeningRoll, openingRollPending } from "./openingRoll";
import { isLiving, livingPlayerCount } from "./players";
import { POOL_ID } from "./pool";
import { currentPrompt, legalEnterCopyIds, legalIdsForChooseSources, legalSearchIds, lookedAtCardIds } from "./prompt";
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
  const hasOptional = requirements.some((requirement) => requirement.optional);
  for (const requirement of requirements) {
    let options = legalChoicesForRequirement(state, requirement, playerId);
    if (hasOptional) {
      // Optional slots demand distinct targets; drop what's already chosen.
      const taken = new Set(chosen.map((target) => JSON.stringify(target)));
      options = options.filter((option) => !taken.has(JSON.stringify(option)));
    }
    if (requirement.optional) {
      // "Up to": sometimes stop filling, and always stop when nothing's left.
      if (options.length === 0 || rng() < 0.4) {
        break;
      }
      chosen.push(pick(rng, options));
      continue;
    }
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
      case "order_triggers": {
        const order = prompt.entries.map((_, index) => index);
        for (let i = order.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rng() * (i + 1));
          [order[i], order[j]] = [order[j]!, order[i]!];
        }
        return { kind: "resolve_order_triggers", playerId, order };
      }
      case "choose_targets": {
        const targets = randomTargets(state, prompt.requirements, playerId, rng);
        return { kind: "choose_targets", playerId, targets: targets ?? [] };
      }
      case "may_pay_life_or_enter_tapped":
        return { kind: "choose_enter_replacement", playerId, pay: rng() < 0.5 };
      case "discard_land_or_graveyard":
        return {
          kind: "choose_discard_land_or_graveyard",
          playerId,
          discard: rng() < 0.5,
        };
      case "choose_creature_type":
        return {
          kind: "resolve_creature_type",
          playerId,
          creatureType: pick(rng, ["sliver", "goblin", "elf", "zombie", "dragon"]),
        };
      case "choose_color":
        return {
          kind: "resolve_color",
          playerId,
          color: pick(
            rng,
            (["W", "U", "B", "R", "G"] as const).filter(
              (option) => option !== prompt.excludeColor,
            ),
          ),
        };
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
      case "enter_as_copy": {
        const legal = legalEnterCopyIds(state, prompt);
        if (legal.length === 0 || rng() < 0.2) {
          return { kind: "resolve_enter_copy", playerId, cardId: null };
        }
        return { kind: "resolve_enter_copy", playerId, cardId: pick(rng, legal) };
      }
      case "choose_trigger_mode": {
        const source = state.cards[prompt.sourceId];
        const modes = source
          ? triggersOf(state, prompt.sourceId)[prompt.triggerIndex]?.modes ?? []
          : [];
        return {
          kind: "resolve_trigger_mode",
          playerId,
          modeIndex: Math.floor(rng() * Math.max(1, modes.length)),
        };
      }
      case "pay_or_counter":
      case "pay_or_effect": {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const payable = canPayManaCost(player.mana, prompt.cost);
        return { kind: "resolve_pay", playerId, pay: payable && rng() < 0.5 };
      }
      case "search_library": {
        const legal = legalSearchIds(state, prompt);
        const picked = randomSubset(rng, legal, 0.5).slice(0, prompt.count);
        return { kind: "resolve_search", playerId, cardIds: picked };
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
    // A creature under an attack requirement must be in the declaration, or
    // every declaration is illegal and the walk stalls here. Goad also narrows
    // whom it may attack, so its defender is picked from the non-goaders.
    const required = new Set(
      attackers
        .filter(
          (card) =>
            state.definitions[card.definitionId]?.mustAttack === true ||
            card.mustAttackThisTurn === true ||
            (computedCard(state, card.id)?.goadedBy ?? []).length > 0,
        )
        .map((card) => card.id),
    );
    const chosen = randomSubset(rng, attackers, 0.5);
    for (const card of attackers) {
      if (required.has(card.id) && !chosen.includes(card)) {
        chosen.push(card);
      }
    }
    const attacks = chosen.map((card) => {
      const goaders = computedCard(state, card.id)?.goadedBy ?? [];
      const allowed = defenders.filter((player) => !goaders.includes(player.id));
      return {
        attackerId: card.id,
        defenderId: pick(rng, allowed.length > 0 ? allowed : defenders).id,
      };
    });
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
      let modeIndex: number | undefined;
      let modeIndexes: number[] | undefined;
      let requirements = definition.targetRequirements;
      if (definition.modes && definition.modes.length > 0) {
        const castable = definition.modes
          .map((mode, index) => ({ mode, index }))
          .filter(
            ({ mode }) =>
              mode.targetRequirements.length === 0 ||
              randomTargets(state, mode.targetRequirements, playerId, rng) !== null,
          );
        if (definition.modeChoice) {
          const { min, maxIfCommander } = definition.modeChoice;
          const max =
            maxIfCommander !== undefined && controlsCommander(state, playerId)
              ? maxIfCommander
              : definition.modeChoice.max;
          if (castable.length < min) {
            return { kind: "pass_priority", playerId };
          }
          const wanted = Math.min(
            castable.length,
            min + Math.floor(rng() * (Math.min(max, castable.length) - min + 1)),
          );
          const pool = [...castable];
          const chosen: typeof castable = [];
          for (let i = 0; i < wanted; i += 1) {
            chosen.push(...pool.splice(Math.floor(rng() * pool.length), 1));
          }
          chosen.sort((a, b) => a.index - b.index);
          modeIndexes = chosen.map((entry) => entry.index);
          requirements = chosen.flatMap((entry) => entry.mode.targetRequirements);
        } else {
          if (castable.length === 0) {
            return { kind: "pass_priority", playerId };
          }
          const picked = pick(rng, castable);
          modeIndex = picked.index;
          requirements = picked.mode.targetRequirements;
        }
      }
      const targets = randomTargets(state, requirements, playerId, rng);
      if (targets === null) {
        return { kind: "pass_priority", playerId };
      }
      const additional = definition.additionalCost;
      let costSacrificeId: string | undefined;
      let costDiscardIds: string[] | undefined;
      if (additional?.sacrifice) {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const options = player.zones.battlefield.filter(
          (id) =>
            sacrificeScopeMatches(state, id, additional.sacrifice!) &&
            sacrificeColorMatches(state, id, additional.sacrificeColor),
        );
        if (options.length === 0) {
          return { kind: "pass_priority", playerId };
        }
        costSacrificeId = pick(rng, options);
      }
      if (additional?.discard) {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const hand = player.zones.hand.filter((id) => id !== action.cardId);
        if (hand.length < additional.discard) {
          return { kind: "pass_priority", playerId };
        }
        const chosen: string[] = [];
        const remaining = [...hand];
        for (let i = 0; i < additional.discard; i += 1) {
          const index = Math.floor(rng() * remaining.length);
          chosen.push(...remaining.splice(index, 1));
        }
        costDiscardIds = chosen;
      }
      let lifeXValue: number | undefined;
      if (additional?.lifeX) {
        const player = state.players.find((entry) => entry.id === playerId)!;
        lifeXValue = Math.floor(rng() * Math.max(1, Math.min(6, player.life)));
      }
      return {
        kind: "cast_spell",
        playerId,
        cardId: action.cardId,
        targets,
        faceIndex: action.faceIndex,
        ...(modeIndex !== undefined ? { modeIndex } : {}),
        ...(modeIndexes ? { modeIndexes } : {}),
        ...(costSacrificeId ? { costSacrificeId } : {}),
        ...(costDiscardIds ? { costDiscardIds } : {}),
        ...(lifeXValue !== undefined ? { xValue: lifeXValue } : {}),
      };
    }
    case "activate_ability": {
      const ability = activatedOf(state, action.cardId)[action.abilityIndex]!;
      // Sac-modal activations: pick a mode, then that mode's targets.
      let modeIndex: number | undefined;
      let requirements = ability.targetRequirements;
      if (ability.modes && ability.modes.length > 0) {
        modeIndex = Math.floor(rng() * ability.modes.length);
        requirements = ability.modes[modeIndex]!.targetRequirements ?? [];
      }
      const targets = randomTargets(state, requirements, playerId, rng);
      if (targets === null) {
        return { kind: "pass_priority", playerId };
      }
      let costSacrificeId: string | undefined;
      if (ability.sacrificeCost) {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const options = player.zones.battlefield.filter(
          (id) =>
            sacrificeScopeMatches(state, id, ability.sacrificeCost!, action.cardId) &&
            (ability.sacrificeSubtype === undefined ||
              cardMatchesSubtype(state, id, ability.sacrificeSubtype)),
        );
        if (options.length === 0) {
          return { kind: "pass_priority", playerId };
        }
        costSacrificeId = pick(rng, options);
      }
      return {
        kind: "activate_ability",
        playerId,
        cardId: action.cardId,
        abilityIndex: action.abilityIndex,
        targets,
        ...(modeIndex !== undefined ? { modeIndex } : {}),
        ...(costSacrificeId ? { costSacrificeId } : {}),
        // An ability with {X} in its cost must be told what X is. Legal-action
        // enumeration only promises the BASE cost is affordable, so anything
        // above zero could exceed the mana that made it legal — the harness
        // would then be rejecting an action it had just chosen.
        ...(ability?.xCost ? { xValue: 0 } : {}),
      };
    }
    case "mana": {
      const abilities = manaAbilitiesFor(state, action.cardId);
      const manaIndex = Math.floor(rng() * abilities.length);
      const ability = abilities[manaIndex]!;
      const options = manaTapOptionsFor(ability, state, playerId, action.cardId);
      if (options && options.length === 0) {
        return { kind: "pass_priority", playerId };
      }
      let costSacrificeId: string | undefined;
      if (ability.costSacrifice) {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const fodder = player.zones.battlefield.filter(
          (id) =>
            sacrificeScopeMatches(state, id, ability.costSacrifice!) &&
            (ability.costSacrificeSubtype === undefined ||
              cardMatchesSubtype(state, id, ability.costSacrificeSubtype)),
        );
        if (fodder.length === 0) {
          return { kind: "pass_priority", playerId };
        }
        costSacrificeId = pick(rng, fodder);
      }
      let costTapId: string | undefined;
      if (ability.costTapCreature) {
        const player = state.players.find((entry) => entry.id === playerId)!;
        const fodder = player.zones.battlefield.filter(
          (id) =>
            id !== action.cardId && !state.cards[id]?.tapped && isCreature(state, id),
        );
        if (fodder.length === 0) {
          return { kind: "pass_priority", playerId };
        }
        costTapId = pick(rng, fodder);
      }
      return {
        kind: "tap_for_mana",
        playerId,
        cardId: action.cardId,
        manaIndex,
        ...(options && options.length > 0 ? { color: pick(rng, options) } : {}),
        ...(costSacrificeId ? { costSacrificeId } : {}),
        ...(costTapId ? { costTapId } : {}),
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

/**
 * Register one shard of the fuzz suite. The suite is split across several
 * thin *.test.ts files so vitest's per-file workers run shards in parallel —
 * a 10,000-game burn saturates the machine from one `vitest run` instead of
 * needing an orchestration script. FUZZ_SEEDS is the TOTAL game count across
 * all shards (default 8: one quick game per shard in `npm test`);
 * FUZZ_SEED_OFFSET shifts the whole range; FUZZ_ACTIONS is per game. Shard k
 * takes the seeds where (seed - 1 - offset) % shardCount === k, so every
 * seed in the range runs exactly once across the shard files.
 */
export function registerFuzzShard(shard: number, shardCount: number): void {
  const SEEDS = Number(process.env.FUZZ_SEEDS ?? 8);
  const ACTIONS = Number(process.env.FUZZ_ACTIONS ?? 400);
  const SEED_OFFSET = Number(process.env.FUZZ_SEED_OFFSET ?? 0);

  describe(`state-integrity fuzzer (shard ${shard + 1}/${shardCount})`, () => {
    for (let seed = 1 + SEED_OFFSET; seed <= SEEDS + SEED_OFFSET; seed += 1) {
      if ((seed - 1 - SEED_OFFSET) % shardCount !== shard) {
        continue;
      }
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
          if (stuck === 24 && process.env.FUZZ_DEBUG) {
            console.log(
              "STUCK",
              JSON.stringify(
                {
                  action,
                  stack: state.stack,
                  prompts: state.prompts,
                  stackSources: state.stack.map((entry) =>
                    entry.sourceId ? state.cards[entry.sourceId]?.zone : null,
                  ),
                },
                null,
                1,
              ),
            );
          }
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
        // A game is ~1s solo; the generous cap absorbs parallel-burn CPU
        // contention so timeouts never masquerade as integrity failures.
      }, 120_000);
    }
  });
}
