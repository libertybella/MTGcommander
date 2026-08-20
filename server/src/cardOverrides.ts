import {
  createCardDefinition,
  definitionIdForOracle,
  normalizeCardName,
  type CardDefinition,
  type OracleCard,
} from "@mtgcommander/engine";

/**
 * Hand-authored card definitions for the long tail the sentence compiler
 * cannot parse (Stage 6). Entries are DATA in the same schema the compiler
 * emits — card-specific code paths stay banned. Keyed by normalized card
 * name; the definition id still derives from the oracle id so imports and
 * caches line up.
 *
 * Add a card here when: the compiler notes it, its behavior fits the
 * existing effect vocabulary, and a test in cardOverrides.test.ts proves
 * the definition.
 */
type OverrideBuilder = (card: OracleCard) => CardDefinition;

const OVERRIDES = new Map<string, OverrideBuilder>([
  [
    // "Target player draws two cards and loses 2 life" compiles, but the
    // plain draw-only templating does not — a minimal registry example.
    normalizeCardName("Divination"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        effects: [{ kind: "draw", playerId: "controller", count: 2 }],
      }),
  ],
  [
    normalizeCardName("Night's Whisper"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        effects: [
          { kind: "draw", playerId: "controller", count: 2 },
          { kind: "lose_life", playerId: "controller", amount: 2 },
        ],
      }),
  ],
  [
    // ETB: fetch a basic land tapped (fail-to-find covers the "may");
    // dies: draw a card (the "may" is auto-taken — declining is a corner case).
    normalizeCardName("Solemn Simulacrum"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        power: 2,
        toughness: 2,
        triggers: [
          {
            event: "enter_battlefield",
            effects: [
              {
                kind: "search_library",
                playerId: "controller",
                filter: { supertypes: ["basic"], types: ["land"] },
                destination: "battlefield",
                count: 1,
                entersTapped: true,
              },
            ],
            targetRequirements: [],
          },
          {
            event: "dies",
            effects: [{ kind: "draw", playerId: "controller", count: 1 }],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    normalizeCardName("Phyrexian Arena"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        triggers: [
          {
            event: "upkeep",
            effects: [
              { kind: "draw", playerId: "controller", count: 1 },
              { kind: "lose_life", playerId: "controller", amount: 1 },
            ],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    // "this creature or another creature you control dies" — watch controlled,
    // self included.
    normalizeCardName("Zulaport Cutthroat"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        power: 1,
        toughness: 1,
        triggers: [
          {
            event: "dies",
            watch: "controlled",
            subjectFilter: { types: ["creature"] },
            effects: [
              { kind: "lose_life", playerId: "each_opponent", amount: 1 },
              { kind: "gain_life", playerId: "controller", amount: 1 },
            ],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    // ETB: pick any card from your graveyard back to hand ("target" becomes
    // a resolution-time choice in this schema).
    normalizeCardName("Eternal Witness"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        power: 2,
        toughness: 1,
        triggers: [
          {
            event: "enter_battlefield",
            effects: [
              {
                kind: "choose_card",
                chooserId: "controller",
                sources: [{ playerId: "controller", zone: "graveyard", filter: "any" }],
                thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "hand" }],
              },
            ],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    // Draw three, then two sequential hand picks go back on top ("any order"
    // is the order you pick them).
    normalizeCardName("Brainstorm"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        effects: [
          { kind: "draw", playerId: "controller", count: 3 },
          {
            kind: "choose_card",
            chooserId: "controller",
            sources: [{ playerId: "controller", zone: "hand", filter: "any" }],
            thenEffects: [
              {
                kind: "move_card",
                cardId: "chosen_card",
                toZone: "library",
                libraryPosition: "top",
              },
            ],
          },
          {
            kind: "choose_card",
            chooserId: "controller",
            sources: [{ playerId: "controller", zone: "hand", filter: "any" }],
            thenEffects: [
              {
                kind: "move_card",
                cardId: "chosen_card",
                toZone: "library",
                libraryPosition: "top",
              },
            ],
          },
        ],
      }),
  ],
  [
    // "deals 1 damage to each opponent" whenever your creature enters.
    normalizeCardName("Impact Tremors"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        triggers: [
          {
            event: "enter_battlefield",
            watch: "controlled",
            excludeSelf: true,
            subjectFilter: { types: ["creature"] },
            effects: [
              {
                kind: "deal_damage",
                sourceId: "self",
                target: { type: "player", playerId: "each_opponent" },
                amount: 1,
              },
            ],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    // Documented approximation: the printed "may" is auto-taken, matching
    // its sibling Soul Warden which compiles from text.
    normalizeCardName("Soul's Attendant"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        power: 1,
        toughness: 1,
        triggers: [
          {
            event: "enter_battlefield",
            watch: "any",
            excludeSelf: true,
            subjectFilter: { types: ["creature"] },
            effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    // "{2}, {T}, Sacrifice this artifact: Search your library for a land
    // card, put it into your hand, then shuffle."
    normalizeCardName("Expedition Map"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        activated: [
          {
            tap: true,
            manaCost: "{2}",
            sacrificeSelf: true,
            effects: [
              {
                kind: "search_library",
                playerId: "controller",
                filter: { types: ["land"] },
                destination: "hand",
                count: 1,
              },
            ],
            targetRequirements: [],
          },
        ],
      }),
  ],
  [
    // Search an artifact to hand (the reveal is public-information dressing
    // the fetch-to-hand flow does not need).
    normalizeCardName("Fabricate"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: { types: ["artifact"] },
            destination: "hand",
            count: 1,
          },
        ],
      }),
  ],
  [
    // Documented approximation: taps for any color instead of "any color a
    // land an opponent controls could produce" (strictly more permissive).
    normalizeCardName("Fellwar Stone"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        producesAnyColor: true,
      }),
  ],
  [
    // Same approximation as Fellwar Stone.
    normalizeCardName("Exotic Orchard"),
    (card) =>
      createCardDefinition({
        id: definitionIdForOracle(card),
        name: card.name,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        oracleText: card.oracleText,
        imageUrl: card.imageUrl ?? "",
        producesAnyColor: true,
      }),
  ],
]);

/** The hand-authored definition for this card, if one exists. */
export function cardOverrideFor(card: OracleCard): CardDefinition | null {
  const builder = OVERRIDES.get(normalizeCardName(card.name));
  return builder ? builder(card) : null;
}

export function overriddenCardNames(): string[] {
  return [...OVERRIDES.keys()];
}
