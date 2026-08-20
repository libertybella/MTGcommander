import { cloneGameState } from "./clone";
import type { CardDefinition, GameState, PlayerId, PlayerZones, ZoneName } from "./types";

export const HIDDEN_DEFINITION_ID = "def-hidden";

const HIDDEN_ZONES: (keyof PlayerZones)[] = ["hand", "library"];

export function isHiddenFromViewer(zone: ZoneName, ownerId: PlayerId, viewerId: PlayerId): boolean {
  return ownerId !== viewerId && (HIDDEN_ZONES as readonly string[]).includes(zone);
}

function hiddenDefinition(): CardDefinition {
  return {
    id: HIDDEN_DEFINITION_ID,
    name: "Unknown Card",
    manaCost: "",
    typeLine: "",
    characteristics: { supertypes: [], types: [], subtypes: [], colors: [], manaValue: 0 },
    oracleText: "",
    power: null,
    toughness: null,
    effects: [],
    targetRequirements: [],
    keywords: [],
    triggers: [],
    replacements: [],
    staticModifiers: [],
    produces: {},
    producesAnyColor: false,
    producesOptions: [],
    manaAbilities: [],
    activated: [],
    imageUrl: "",
  };
}

/**
 * Public projection for a viewer. Opponent hands and libraries keep their
 * counts and instance IDs but hide card identity. Battlefield, graveyard,
 * exile, command, stack, life, and commander damage stay public.
 */
export function redactForViewer(state: GameState, viewerId: PlayerId): GameState {
  if (!state.players.some((player) => player.id === viewerId)) {
    throw new Error(`Unknown player ${viewerId}`);
  }
  const revealed = new Set(
    state.reveals.filter((entry) => entry.viewerId === viewerId).flatMap((entry) => entry.cardIds),
  );
  const next = cloneGameState(state);
  next.definitions[HIDDEN_DEFINITION_ID] = hiddenDefinition();
  for (const player of next.players) {
    if (player.id === viewerId) {
      continue;
    }
    for (const zone of HIDDEN_ZONES) {
      for (const cardId of player.zones[zone]) {
        if (revealed.has(cardId)) {
          continue;
        }
        const card = next.cards[cardId];
        if (card) {
          card.definitionId = HIDDEN_DEFINITION_ID;
        }
      }
    }
  }
  return next;
}
