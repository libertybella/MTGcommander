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
 *
 * REMOVE IT AGAIN THE MOMENT THE COMPILER CAN READ THE CARD. An override
 * shadows the compiler completely, and the compile-rate metric counts an
 * overridden card as full by construction — so a stale entry is invisible
 * twice over, and nothing here expires on its own.
 *
 * Wave 363 retired twenty-one of twenty-two. Fourteen were APPROXIMATIONS
 * that had been documented as such when they were written, and every one
 * of them played a card stronger than the printed one: Exotic Orchard and
 * Fellwar Stone tapped for any colour unconditionally, nine filter lands
 * tapped for coloured mana without paying the filter, Solemn Simulacrum's
 * "you may draw" was mandatory, Eternal Witness's targeted return was an
 * untargeted choice. They were honest when written and wrong by the time
 * they were removed, because the compiler caught up and nothing told it.
 */
type OverrideBuilder = (card: OracleCard) => CardDefinition;

const OVERRIDES = new Map<string, OverrideBuilder>([
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
]);

/** The hand-authored definition for this card, if one exists. */
export function cardOverrideFor(card: OracleCard): CardDefinition | null {
  const builder = OVERRIDES.get(normalizeCardName(card.name));
  return builder ? builder(card) : null;
}

export function overriddenCardNames(): string[] {
  return [...OVERRIDES.keys()];
}
