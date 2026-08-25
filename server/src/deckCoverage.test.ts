import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileOracleCard, type OracleCard } from "@mtgcommander/engine";
import { cardOverrideFor } from "./cardOverrides";
import { oracleCardFromScryfall } from "./scryfall";

/**
 * Deck-level coverage. The rank-weighted metric in compileRate.test.ts prices
 * a card by how often it is played; this one asks the only question a player
 * actually asks: does THIS deck run? A deck with one broken card is a deck
 * you cannot sit down and play, so a deck scores 0 or 1 and nothing between.
 *
 * COMPILE_BULK=<scryfall bulk>  COMPILE_DECKS=<edhrec-top100-decks.json>
 */
type DeckCard = { name: string; qty: number; type: string };
type Deck = {
  rank: number;
  commander: string;
  slug: string;
  num_decks: number;
  commanders: string[];
  cards: DeckCard[];
};

const key = (name: string) => name.toLowerCase().trim();
// A split/DFC card is listed by EDHREC under either its full name or its
// front face; index both so a miss is a real miss.
function keysFor(name: string): string[] {
  const full = key(name);
  const front = full.split(" // ")[0]!;
  return front === full ? [full] : [full, front];
}

function loadBulk(path: string): Map<string, OracleCard> {
  const text = readFileSync(path, "utf8");
  const entries: unknown[] = text.trimStart().startsWith("[")
    ? (JSON.parse(text) as unknown[])
    : text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown);
  const byName = new Map<string, OracleCard>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    let card: OracleCard;
    try {
      card = oracleCardFromScryfall(entry);
    } catch {
      continue;
    }
    for (const name of keysFor(card.name)) {
      // Several printings per card, some with empty oracle text: keep the
      // longest, which is the one that actually says what the card does.
      const seen = byName.get(name);
      if (!seen || card.oracleText.length > seen.oracleText.length) {
        byName.set(name, card);
      }
    }
  }
  return byName;
}

describe("deck-level coverage", () => {
  it("reports how many of the top 100 decks run end to end", () => {
    const bulkPath = process.env.COMPILE_BULK;
    const decksPath = process.env.COMPILE_DECKS;
    if (!bulkPath || !decksPath) {
      return;
    }
    const bulk = loadBulk(bulkPath);
    const decks = JSON.parse(readFileSync(decksPath, "utf8")) as Deck[];

    // Compile each distinct card once; a deck is a bag of references to it.
    const universe = new Map<string, DeckCard>();
    for (const deck of decks) {
      for (const card of deck.cards) {
        universe.set(key(card.name), card);
      }
      for (const name of deck.commanders) {
        universe.set(key(name), { name, qty: 1, type: "Commander" });
      }
    }
    const compiles = new Map<string, boolean>();
    const absent: string[] = [];
    for (const [name, entry] of universe) {
      const card = bulk.get(name);
      if (!card) {
        absent.push(entry.name);
        compiles.set(name, false);
        continue;
      }
      compiles.set(name, cardOverrideFor(card) ? true : compileOracleCard(card).notes.length === 0);
    }

    const broken = [...compiles.entries()].filter(([, ok]) => !ok).map(([name]) => name);
    console.log(
      `[deck-coverage] universe: ${universe.size} distinct cards across ${decks.length} decks, ` +
        `${universe.size - broken.length} compile (${(((universe.size - broken.length) / universe.size) * 100).toFixed(1)}%), ` +
        `${broken.length} broken${absent.length ? `, ${absent.length} not in bulk` : ""}`,
    );

    // Per-deck breakage, counted in SLOTS: a 4-of broken land costs four.
    const scored = decks
      .map((deck) => {
        const misses: string[] = [];
        let slots = 0;
        for (const card of deck.cards) {
          if (!compiles.get(key(card.name))) {
            misses.push(card.name);
            slots += card.qty;
          }
        }
        for (const name of deck.commanders) {
          if (!compiles.get(key(name))) {
            misses.push(`${name} (commander)`);
            slots += 1;
          }
        }
        return { deck, misses, slots };
      })
      .sort((a, b) => a.slots - b.slots);

    const playable = scored.filter((entry) => entry.slots === 0);
    const slotCounts = scored.map((entry) => entry.slots);
    const median = slotCounts[Math.floor(slotCounts.length / 2)]!;
    const mean = slotCounts.reduce((sum, n) => sum + n, 0) / slotCounts.length;
    console.log(
      `[deck-coverage] decks that run end to end: ${playable.length}/${decks.length}  ` +
        `broken slots per deck: best ${slotCounts[0]}, median ${median}, mean ${mean.toFixed(1)}, worst ${slotCounts.at(-1)}`,
    );
    console.log(
      `[deck-coverage] closest decks: ` +
        scored
          .slice(0, 8)
          .map((entry) => `${entry.deck.commander} (${entry.slots})`)
          .join(" | "),
    );

    // The work queue: a broken card is worth exactly the number of decks it
    // blocks, not its EDHREC rank.
    const blocks = new Map<string, number>();
    for (const entry of scored) {
      for (const miss of entry.misses) {
        const name = key(miss.replace(" (commander)", ""));
        blocks.set(name, (blocks.get(name) ?? 0) + 1);
      }
    }
    const queue = [...blocks.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `[deck-coverage] blocks the most decks: ` +
        queue
          .slice(0, 40)
          .map(([name, count]) => `${universe.get(name)?.name ?? name} (${count})`)
          .join(" | "),
    );

    // How far does the queue have to run before real decks come out whole?
    const fixed = new Set<string>();
    const marks = [1, 5, 10, 25, 50, 100, 200, 400];
    const lines: string[] = [];
    let cursor = 0;
    for (const mark of marks) {
      while (cursor < mark && cursor < queue.length) {
        fixed.add(queue[cursor]![0]);
        cursor += 1;
      }
      const whole = scored.filter((entry) =>
        entry.misses.every((miss) => fixed.has(key(miss.replace(" (commander)", "")))),
      ).length;
      lines.push(`${cursor} cards -> ${whole} decks`);
      if (cursor >= queue.length) {
        break;
      }
    }
    console.log(`[deck-coverage] cumulative: ${lines.join(" | ")}`);

    if (absent.length > 0) {
      console.log(`[deck-coverage] not in bulk: ${absent.slice(0, 30).join(" | ")}`);
    }

    const dumpPath = process.env.COMPILE_DECK_DUMP;
    if (dumpPath) {
      writeFileSync(
        dumpPath,
        JSON.stringify(
          {
            compiles: Object.fromEntries(
              [...universe].map(([name, entry]) => [entry.name, compiles.get(name) === true]),
            ),
            // Why each broken card is broken, so a stretch can be planned by
            // the shape of the work and not just its size.
            notes: Object.fromEntries(
              [...universe]
                .filter(([name]) => compiles.get(name) !== true)
                .map(([name, entry]) => {
                  const card = bulk.get(name);
                  return [
                    entry.name,
                    {
                      type: card?.typeLine ?? "(absent)",
                      notes: card ? compileOracleCard(card).notes : ["not in bulk"],
                    },
                  ];
                }),
            ),
            decks: scored.map((entry) => ({
              commander: entry.deck.commander,
              rank: entry.deck.rank,
              slots: entry.slots,
              misses: entry.misses,
            })),
          },
          null,
          1,
        ),
        "utf8",
      );
    }
    expect(universe.size).toBeGreaterThan(500);
  });
});
