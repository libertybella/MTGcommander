import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileOracleCard, type OracleCard } from "@mtgcommander/engine";
import { cardOverrideFor } from "./cardOverrides";
import {
  DEFAULT_RANK_EXPONENT,
  bandBreakdown,
  weightedCoverage,
  type RankedCard,
} from "./compileRank";
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
    // The floor only rises: raise it when new patterns land. At 95% actual.
    expect(fullPct).toBeGreaterThanOrEqual(90);
    expect(rate.none.length).toBeLessThanOrEqual(3);
  });

  it("sweeps a full bulk file when COMPILE_BULK is set", () => {
    const bulkPath = process.env.COMPILE_BULK;
    if (!bulkPath) {
      return;
    }
    const text = readFileSync(bulkPath, "utf8");
    // Accept both a JSON array and Scryfall's JSONL bulk format.
    const entries: unknown[] = text.trimStart().startsWith("[")
      ? (JSON.parse(text) as unknown[])
      : text
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as unknown);
    let cards = entries
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => {
        try {
          return oracleCardFromScryfall(entry);
        } catch {
          return null;
        }
      })
      .filter((card): card is OracleCard => card !== null);
    // COMPILE_LIST narrows the sweep to a JSON array of card names — the
    // EDHREC-top-N gate uses this.
    const listPath = process.env.COMPILE_LIST;
    if (listPath) {
      const wanted = new Set(
        (JSON.parse(readFileSync(listPath, "utf8")) as string[]).map((name) =>
          name.toLowerCase(),
        ),
      );
      cards = cards.filter((card) => wanted.has(card.name.toLowerCase()));
    }
    const rate = classify(cards);
    const total = cards.length;
    console.log(
      `[compile-rate] ${listPath ? "list" : "bulk"}: ${rate.full.length}/${total} full ` +
        `(${((rate.full.length / total) * 100).toFixed(1)}%), ` +
        `${rate.partial.length} partial, ${rate.none.length} none`,
    );
    if (listPath) {
      // Rank-weighted view. The unweighted count above prices a card played
      // in 1% of decks exactly like Sol Ring, so it is a poor guide to
      // whether a real game works; this is the number the work follows.
      const order = JSON.parse(readFileSync(listPath, "utf8")) as string[];
      const fullNames = new Set(rate.full.map((name) => name.toLowerCase()));
      const swept = new Set(cards.map((card) => card.name.toLowerCase()));
      const ranked: RankedCard[] = order.map((name, index) => ({
        name,
        rank: index + 1,
        // A name can sweep more than one printing; every one of them has to
        // compile, because a deck may hold any of them.
        full: swept.has(name.toLowerCase()) && fullNames.has(name.toLowerCase()),
        present: swept.has(name.toLowerCase()),
      }));
      const exponent = Number(process.env.COMPILE_RANK_EXPONENT ?? DEFAULT_RANK_EXPONENT);
      const coverage = weightedCoverage(ranked, exponent);
      console.log(
        `[compile-rate] play-weighted (a=${exponent}): ${(coverage.fraction * 100).toFixed(1)}% of deck slots, ` +
          `~${coverage.brokenPerDeck.toFixed(1)} broken cards per 100-card deck`,
      );
      for (const band of bandBreakdown(ranked, [100, 200, 500, 1000, 2000])) {
        const pct = band.total === 0 ? 0 : (band.full / band.total) * 100;
        console.log(
          `[compile-rate] top ${String(band.limit).padStart(4)}: ${String(band.full).padStart(4)}/${String(band.total).padStart(4)} ` +
            `(${pct.toFixed(1)}%)  ${band.failing.length} failing`,
        );
      }
      const missing = ranked.filter((card) => !card.present).map((card) => card.name);
      if (missing.length > 0) {
        console.log(`[compile-rate] not in bulk: ${missing.join(" | ")}`);
      }
      const [top500] = bandBreakdown(ranked, [500]);
      if (top500.failing.length > 0) {
        console.log(`[compile-rate] top-500 work list: ${top500.failing.join(" | ")}`);
      }
      const missLimit = Number(process.env.COMPILE_MISS_LIMIT ?? 60);
      const allFailing = bandBreakdown(ranked, [order.length])[0].failing;
      console.log(
        `[compile-rate] top misses: ${allFailing.slice(0, missLimit).join(" | ")}`,
      );
    }
    // COMPILE_ANALYZE=1 clusters compile notes across the swept cards so
    // pattern sprints can target the biggest wins first.
    if (process.env.COMPILE_ANALYZE) {
      const noteCounts = new Map<string, { count: number; sample: string }>();
      for (const card of cards) {
        if (cardOverrideFor(card)) {
          continue;
        }
        for (const note of compileOracleCard(card).notes) {
          const tail = note.includes("not compiled: ")
            ? note.slice(note.indexOf("not compiled: ") + "not compiled: ".length)
            : note;
          for (const fragment of tail.split("; ")) {
            const shape = fragment
              .replace(new RegExp(card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "~")
              .replace(/\{[^}]+\}/g, "{M}")
              .replace(/\b\d+\b/g, "N")
              .trim()
              .toLowerCase()
              .slice(0, 80);
            if (!shape) {
              continue;
            }
            const entry = noteCounts.get(shape);
            if (entry) {
              entry.count += 1;
            } else {
              noteCounts.set(shape, { count: 1, sample: fragment.slice(0, 100) });
            }
          }
        }
      }
      const top = [...noteCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 80);
      for (const [, { count, sample }] of top) {
        console.log(`[analyze] ${count}× ${sample}`);
      }
      const lineCounts = new Map<string, { count: number; sample: string }>();
      for (const card of cards) {
        if (cardOverrideFor(card)) {
          continue;
        }
        const notes = compileOracleCard(card).notes;
        for (const note of notes) {
          const match = /"([^"]*)"/.exec(note);
          if (!match) {
            continue;
          }
          const shape = match[1]
            .replace(new RegExp(card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "~")
            .replace(/\{[^}]+\}/g, "{M}")
            .replace(/\d+/g, "N")
            .slice(0, 90);
          const entry = lineCounts.get(shape);
          if (entry) {
            entry.count += 1;
          } else {
            lineCounts.set(shape, { count: 1, sample: match[1].slice(0, 110) });
          }
        }
      }
      const topLines = [...lineCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 50);
      for (const [, { count, sample }] of topLines) {
        console.log(`[analyze-line] ${count}× ${sample}`);
      }
    }
  });
});
