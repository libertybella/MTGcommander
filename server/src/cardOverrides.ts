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
]);

/** The hand-authored definition for this card, if one exists. */
export function cardOverrideFor(card: OracleCard): CardDefinition | null {
  const builder = OVERRIDES.get(normalizeCardName(card.name));
  return builder ? builder(card) : null;
}

export function overriddenCardNames(): string[] {
  return [...OVERRIDES.keys()];
}
