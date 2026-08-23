import type { GameState, Color } from "./types";

/**
 * Colour identity (CR 903.4) lives in its own module because both the mana
 * layer and the CR 613 layer engine need it, and `manaOptions.ts` already
 * imports `characteristicsEngine.ts` — putting it there would make the
 * arrow point both ways.
 *
 * It depends on nothing but state and types, deliberately: the colour list
 * is written out here rather than imported from `mana.ts`, which reaches
 * `createGame.ts` and back into the layer engine.
 */
const IDENTITY_COLORS: Color[] = ["W", "U", "B", "R", "G"];

/**
 * The colours in a player's commanders' colour identity: their own colours
 * plus every colour pip printed in their rules text (CR 903.4). Ordered
 * WUBRG, and never colourless — {C} is not a colour identity.
 */
export function commanderIdentityColors(
  state: GameState,
  controllerId: string,
): Color[] {
  const found = new Set<string>();
  const player = state.players.find((entry) => entry.id === controllerId);
  for (const commanderId of player?.commander.commanderIds ?? []) {
    const definition = state.definitions[state.cards[commanderId]?.definitionId ?? ""];
    if (!definition) {
      continue;
    }
    for (const color of definition.characteristics.colors) {
      found.add(color);
    }
    for (const pip of definition.oracleText.matchAll(/\{([^}]+)\}/g)) {
      for (const part of (pip[1] ?? "").split("/")) {
        if (IDENTITY_COLORS.includes(part as Color)) {
          found.add(part);
        }
      }
    }
  }
  return IDENTITY_COLORS.filter((color) => found.has(color));
}

/**
 * War Room: the life an activation actually costs. A live count, so the
 * legality check and the payment must both read it here — reading the
 * fixed `lifeCost` in one and the count in the other would offer an
 * activation the payment then refuses, or charge for one it did not check.
 */
export function abilityLifeCost(
  state: GameState,
  playerId: string,
  ability: { lifeCost?: number; lifeCostFromCommanderColors?: boolean },
): number {
  if (ability.lifeCostFromCommanderColors) {
    return commanderIdentityColors(state, playerId).length;
  }
  return ability.lifeCost ?? 0;
}

/**
 * The colours a commander's identity does NOT contain — Commander's Plate.
 * A commanderless player is identity-less, so every colour is outside it,
 * which is what the card says and also what makes the Plate a five-colour
 * shield in a game with no commander.
 */
export function colorsOutsideCommanderIdentity(
  state: GameState,
  controllerId: string,
): Color[] {
  const inside = new Set(commanderIdentityColors(state, controllerId));
  return IDENTITY_COLORS.filter((color) => !inside.has(color));
}
