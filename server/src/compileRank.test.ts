import { describe, expect, it } from "vitest";
import {
  DEFAULT_RANK_EXPONENT,
  bandBreakdown,
  rankWeight,
  weightedCoverage,
  type RankedCard,
} from "./compileRank";

const card = (rank: number, full: boolean, name = `card${rank}`): RankedCard => ({
  name,
  rank,
  full,
  present: true,
});

describe("rank weighting", () => {
  it("anchors the exponent to the inclusion spread it was derived from", () => {
    // rank 1 sits in ~80% of decks, rank 2000 in ~1%: an 80x spread.
    const spread = rankWeight(1) / rankWeight(2000);
    expect(spread).toBeGreaterThan(70);
    expect(spread).toBeLessThan(90);
  });

  it("falls off with rank rather than treating every card alike", () => {
    expect(rankWeight(1)).toBeGreaterThan(rankWeight(10));
    expect(rankWeight(10)).toBeGreaterThan(rankWeight(1000));
    // A flat weighting would make this ratio 1, which is the bug being fixed.
    expect(rankWeight(1) / rankWeight(100)).toBeGreaterThan(5);
  });

  it("rejects a rank that is not 1-based", () => {
    expect(() => rankWeight(0)).toThrow(/positive integer/);
    expect(() => rankWeight(-3)).toThrow(/positive integer/);
    expect(() => rankWeight(Number.NaN)).toThrow(/positive integer/);
  });
});

describe("weighted coverage", () => {
  it("costs more for a popular failure than an unpopular one", () => {
    const popularBroken = weightedCoverage([card(1, false), card(2000, true)]);
    const tailBroken = weightedCoverage([card(1, true), card(2000, false)]);
    expect(popularBroken.fraction).toBeLessThan(tailBroken.fraction);
    // And the gap must be large: an unweighted metric would score both 50%,
    // which is exactly the reading that sent waves at the tail.
    expect(tailBroken.fraction - popularBroken.fraction).toBeGreaterThan(0.9);
  });

  it("reads out as broken cards in a 100-card deck", () => {
    const all = weightedCoverage([card(1, true), card(2, true)]);
    expect(all.fraction).toBe(1);
    expect(all.brokenPerDeck).toBe(0);
    const none = weightedCoverage([card(1, false), card(2, false)]);
    expect(none.fraction).toBe(0);
    expect(none.brokenPerDeck).toBe(100);
  });

  it("treats a partial as broken, because a partial plays wrong", () => {
    // A card that compiles three sentences of four is not 75% supported: the
    // fourth silently never runs, so the whole card is a failure here.
    const partial = weightedCoverage([card(1, false)]);
    expect(partial.fraction).toBe(0);
  });

  it("calls an empty list covered rather than dividing by zero", () => {
    expect(weightedCoverage([]).fraction).toBe(1);
    expect(weightedCoverage([]).brokenPerDeck).toBe(0);
  });

  it("honours an overridden exponent", () => {
    const cards = [card(1, true), card(1000, false)];
    const steep = weightedCoverage(cards, 1.5).fraction;
    const flat = weightedCoverage(cards, 0.1).fraction;
    // Steeper decay concentrates weight on rank 1, which here is the one
    // that works — so coverage must rise, not fall.
    expect(steep).toBeGreaterThan(flat);
    expect(DEFAULT_RANK_EXPONENT).toBeGreaterThan(0.1);
    expect(DEFAULT_RANK_EXPONENT).toBeLessThan(1.5);
  });
});

describe("band breakdown", () => {
  const cards = [
    card(1, true, "Sol Ring"),
    card(120, false, "The One Ring"),
    card(400, true, "Cultivate"),
    card(900, false, "Deep Tail"),
    card(1800, false, "Deeper Tail"),
  ];

  it("is cumulative, not disjoint", () => {
    const [top100, top500, top2000] = bandBreakdown(cards, [100, 500, 2000]);
    expect(top100.total).toBe(1);
    // The top 500 must CONTAIN the top 100, not exclude it — a disjoint
    // reading would report 2 here and misprice every band above the first.
    expect(top500.total).toBe(3);
    expect(top2000.total).toBe(5);
  });

  it("lists the failures in rank order as the work list", () => {
    const [top1000] = bandBreakdown(cards, [1000]);
    expect(top1000.failing).toEqual(["The One Ring", "Deep Tail"]);
    expect(top1000.full).toBe(2);
  });

  it("does not mutate the caller's array", () => {
    const input = [card(9, true), card(2, true)];
    bandBreakdown(input, [100]);
    expect(input.map((entry) => entry.rank)).toEqual([9, 2]);
  });
});
