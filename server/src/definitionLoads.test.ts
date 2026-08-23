import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileOracleCard, createCardDefinition, createGameState } from "@mtgcommander/engine";
import { parseGameState, serializeGameState } from "../../engine/src/serialize";
import { oracleCardFromScryfall } from "./scryfall";
import type { OracleCard } from "@mtgcommander/engine";

/**
 * A definition that compiles is not yet a definition that WORKS. The
 * serializer's parsers are hand-written and can be narrower than the types
 * they parse — when that happens the card compiles with no notes, the
 * compile-rate metric counts it as working, and the definition then fails to
 * LOAD, so the card never reaches a table at all.
 *
 * That is not a hypothetical. `team_pt_until_eot` accepted only
 * `creature_count` while the type had always allowed `greatest_power` and
 * `x`, and Overwhelming Stampede, Pathbreaker Ibex and Tyvar the Pummeler all
 * scored as clean compiles while being unloadable. The metric reads notes and
 * had no way to see it.
 *
 * So: every compiled definition must survive a round trip through the wire.
 */
function loadFailure(card: OracleCard): string | null {
  let compiled;
  try {
    compiled = compileOracleCard(card);
  } catch (error) {
    return `compile threw: ${(error as Error).message}`;
  }
  try {
    const game = createGameState({ playerCount: 2 });
    const definition = createCardDefinition(compiled.definition);
    game.definitions[definition.id] = definition;
    const round = parseGameState(serializeGameState(game));
    if (!round.definitions[definition.id]) {
      return "definition vanished on the wire";
    }
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

describe("every compiled definition survives the wire", () => {
  it("holds for the vendored sample", () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, "../fixtures/oracle-sample.json"), "utf8"),
    ) as { cards: unknown[] };
    const cards = raw.cards.map((card) => oracleCardFromScryfall(card));
    const failures = cards
      .map((card) => ({ name: card.name, why: loadFailure(card) }))
      .filter((entry) => entry.why !== null)
      .map((entry) => `${entry.name}: ${entry.why}`);
    expect(failures).toEqual([]);
  });

  it("holds across a full bulk file when COMPILE_BULK is set", () => {
    const bulkPath = process.env.COMPILE_BULK;
    if (!bulkPath) {
      return;
    }
    const text = readFileSync(bulkPath, "utf8");
    const entries: unknown[] = text.trimStart().startsWith("[")
      ? (JSON.parse(text) as unknown[])
      : text
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as unknown);
    const failures: string[] = [];
    for (const raw of entries) {
      let card: OracleCard;
      try {
        card = oracleCardFromScryfall(raw);
      } catch {
        continue;
      }
      const why = loadFailure(card);
      if (why !== null) {
        failures.push(`${card.name}: ${why}`);
      }
    }
    for (const failure of failures.slice(0, 40)) {
      console.log(`[load-fail] ${failure}`);
    }
    console.log(`[load-fail] total: ${failures.length}`);
    expect(failures).toEqual([]);
    // A full bulk sweep compiles and round-trips every printed card.
  }, 120000);
});
