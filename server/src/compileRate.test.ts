import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileOracleCard, type OracleCard } from "@mtgcommander/engine";
import { cardOverrideFor } from "./cardOverrides";
import { oracleCardFromScryfall } from "./scryfall";

/**
 * The Stage 6 coverage metric: compile the vendored sample of real cards
 * (60 EDHREC-tier staples fetched from Scryfall) and report the rate.
 * Set COMPILE_BULK=<path to a Scryfall bulk JSON> to sweep a full dump —
 * the report prints, and only the vendored floor is asserted.
 *
 * A card counts as:
 *  - full: no compile notes (or a registry override exists)
 *  - partial: compiles something but leaves notes
 *  - none: nothing usable compiled (no effects/triggers/statics/mana)
 */
type Rate = { full: string[]; partial: string[]; none: string[] };

function classify(cards: OracleCard[]): Rate {
  const rate: Rate = { full: [], partial: [], none: [] };
  for (const card of cards) {
    if (cardOverrideFor(card)) {
      rate.full.push(card.name);
      continue;
    }
    const compiled = compileOracleCard(card);
    const definition = compiled.definition;
    const compiledSomething =
      definition.effects.length > 0 ||
      definition.triggers.length > 0 ||
      definition.staticAbilities.length > 0 ||
      definition.activated.length > 0 ||
      definition.manaAbilities.length > 0 ||
      definition.replacements.length > 0 ||
      (definition.modes?.length ?? 0) > 0 ||
      (definition.loyaltyAbilities?.length ?? 0) > 0 ||
      definition.keywords.length > 0 ||
      Boolean(definition.ward) ||
      Boolean(definition.protectionFrom) ||
      Object.keys(definition.produces).length > 0 ||
      definition.producesAnyColor ||
      definition.producesOptions.length > 0 ||
      // Vanilla creatures and plain lands have nothing to compile.
      (definition.oracleText.trim() === "" &&
        (definition.characteristics.types.includes("creature") ||
          definition.characteristics.types.includes("land")));
    if (compiled.notes.length === 0) {
      rate.full.push(card.name);
    } else if (compiledSomething) {
      rate.partial.push(card.name);
    } else {
      rate.none.push(card.name);
    }
  }
  return rate;
}

function loadSample(): OracleCard[] {
  const raw = JSON.parse(
    readFileSync(resolve(__dirname, "../fixtures/oracle-sample.json"), "utf8"),
  ) as { cards: unknown[] };
  return raw.cards.map((card) => oracleCardFromScryfall(card));
}

describe("Stage 6: compile-rate metric", () => {
  it("reports the sample rate and holds the floor", () => {
    const cards = loadSample();
    expect(cards.length).toBeGreaterThanOrEqual(60);
    const rate = classify(cards);
    const total = cards.length;
    const fullPct = Math.round((rate.full.length / total) * 100);
    console.log(
      `[compile-rate] sample: ${rate.full.length}/${total} full (${fullPct}%), ` +
        `${rate.partial.length} partial, ${rate.none.length} none`,
    );
    if (rate.none.length > 0) {
      console.log(`[compile-rate] none: ${rate.none.join(", ")}`);
    }
    if (rate.partial.length > 0) {
      console.log(`[compile-rate] partial: ${rate.partial.join(", ")}`);
    }
    // The floor only rises: raise it when new patterns land.
    expect(fullPct).toBeGreaterThanOrEqual(80);
    expect(rate.none.length).toBeLessThanOrEqual(3);
  });

  it("sweeps a full bulk file when COMPILE_BULK is set", () => {
    const bulkPath = process.env.COMPILE_BULK;
    if (!bulkPath) {
      return;
    }
    const raw = JSON.parse(readFileSync(bulkPath, "utf8")) as unknown[];
    const cards = raw
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => {
        try {
          return oracleCardFromScryfall(entry);
        } catch {
          return null;
        }
      })
      .filter((card): card is OracleCard => card !== null);
    const rate = classify(cards);
    const total = cards.length;
    console.log(
      `[compile-rate] bulk: ${rate.full.length}/${total} full ` +
        `(${((rate.full.length / total) * 100).toFixed(1)}%), ` +
        `${rate.partial.length} partial, ${rate.none.length} none`,
    );
  });
});
