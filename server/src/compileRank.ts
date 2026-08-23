/**
 * Play-weighted coverage for a rank-ordered card list.
 *
 * The raw compile rate counts a card played in 1% of decks exactly as much
 * as Sol Ring, which made the headline number a poor guide to whether a real
 * game works. EDHREC inclusion falls off roughly as a power law in rank:
 * the #1 card sits in ~80% of decks and the #2000 card in ~1%, and
 * 2000 ** a = 80 solves to a ~= 0.58. That is the default here — an anchored
 * estimate, not a measurement, so it is overridable and reported alongside
 * the unweighted count rather than replacing it.
 */
export const DEFAULT_RANK_EXPONENT = 0.58;

/** One list entry. `rank` is 1-based: rank 1 is the most-played card. */
export type RankedCard = {
  name: string;
  rank: number;
  /** True only for a clean compile. A partial is a failure — it plays wrong. */
  full: boolean;
  /** False when the list names a card the bulk dump does not contain. */
  present: boolean;
};

export function rankWeight(rank: number, exponent = DEFAULT_RANK_EXPONENT): number {
  if (rank < 1 || !Number.isFinite(rank)) {
    throw new Error(`rank must be a positive integer, got ${rank}`);
  }
  return Math.pow(rank, -exponent);
}

export type Coverage = {
  /** Share of deck slots filled by a card that compiles cleanly. */
  fraction: number;
  /** The same figure read as cards in a 100-card deck that would play wrong. */
  brokenPerDeck: number;
};

/**
 * Weighted share of deck slots served, modelling a deck as slots drawn from
 * the list with probability proportional to `rankWeight`. An empty list is
 * full coverage rather than a division by zero: nothing is broken.
 */
export function weightedCoverage(
  cards: readonly RankedCard[],
  exponent = DEFAULT_RANK_EXPONENT,
): Coverage {
  let total = 0;
  let served = 0;
  for (const card of cards) {
    const weight = rankWeight(card.rank, exponent);
    total += weight;
    if (card.full) {
      served += weight;
    }
  }
  const fraction = total === 0 ? 1 : served / total;
  return { fraction, brokenPerDeck: 100 * (1 - fraction) };
}

export type Band = {
  /** Inclusive upper rank of the band, e.g. 500 for "the top 500". */
  limit: number;
  total: number;
  full: number;
  /** Names that do not compile cleanly, in rank order — the work list. */
  failing: string[];
};

/**
 * Cumulative bands ("the top 100", "the top 500"), which is how the work gets
 * prioritised: a fix inside the top 500 is worth many in the tail.
 */
export function bandBreakdown(
  cards: readonly RankedCard[],
  limits: readonly number[],
): Band[] {
  const byRank = [...cards].sort((a, b) => a.rank - b.rank);
  return limits.map((limit) => {
    const band = byRank.filter((card) => card.rank <= limit);
    return {
      limit,
      total: band.length,
      full: band.filter((card) => card.full).length,
      failing: band.filter((card) => !card.full).map((card) => card.name),
    };
  });
}
