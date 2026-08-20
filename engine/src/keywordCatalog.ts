import type { Keyword } from "./types";

/**
 * The keyword abilities of CR 702, by name. This list is the layer-2 coverage
 * denominator: docs/KEYWORD_COVERAGE.md is generated from it and a test keeps
 * the two in sync. Update it when a new set adds a keyword to the CR.
 */
export const CR702_KEYWORD_ABILITIES: string[] = [
  "deathtouch", "defender", "double strike", "enchant", "equip", "first strike",
  "flash", "flying", "haste", "hexproof", "indestructible", "intimidate",
  "landwalk", "lifelink", "protection", "reach", "shroud", "trample",
  "vigilance", "ward", "banding", "rampage", "cumulative upkeep", "flanking",
  "phasing", "buyback", "shadow", "cycling", "echo", "horsemanship", "fading",
  "kicker", "flashback", "madness", "fear", "morph", "amplify", "provoke",
  "storm", "affinity", "entwine", "modular", "sunburst", "bushido",
  "soulshift", "splice", "offering", "ninjutsu", "epic", "convoke", "dredge",
  "transmute", "bloodthirst", "haunt", "replicate", "forecast", "graft",
  "recover", "ripple", "split second", "suspend", "vanishing", "absorb",
  "aura swap", "delve", "fortify", "frenzy", "gravestorm", "poisonous",
  "transfigure", "champion", "changeling", "evoke", "hideaway", "prowl",
  "reinforce", "conspire", "persist", "wither", "retrace", "devour",
  "exalted", "unearth", "cascade", "annihilator", "level up", "rebound",
  "totem armor", "infect", "battle cry", "living weapon", "undying",
  "miracle", "soulbond", "overload", "scavenge", "unleash", "cipher",
  "evolve", "extort", "fuse", "bestow", "tribute", "dethrone",
  "hidden agenda", "outlast", "prowess", "dash", "exploit", "menace",
  "renown", "awaken", "devoid", "ingest", "myriad", "surge", "skulk",
  "emerge", "escalate", "melee", "crew", "fabricate", "partner",
  "undaunted", "improvise", "aftermath", "embalm", "eternalize", "afflict",
  "ascend", "assist", "jump-start", "mentor", "afterlife", "riot",
  "spectacle", "escape", "companion", "mutate", "encore", "boast",
  "foretell", "demonstrate", "daybound", "nightbound", "disturb", "decayed",
  "cleave", "training", "compleated", "reconfigure", "blitz", "casualty",
  "enlist", "read ahead", "ravenous", "squad", "prototype", "living metal",
  "more than meets the eye", "for mirrodin!", "toxic", "backup", "bargain",
  "craft", "disguise", "plot", "saddle", "offspring", "impending", "gift",
  "exhaust", "harmonize", "mobilize", "station", "warp",
];

/**
 * Engine keywords mapped onto CR 702 names. Everything in the Keyword union
 * must appear here; the coverage report divides this by the full list.
 */
export const IMPLEMENTED_KEYWORDS: Record<Keyword, string> = {
  flying: "flying",
  reach: "reach",
  haste: "haste",
  vigilance: "vigilance",
  trample: "trample",
  deathtouch: "deathtouch",
  lifelink: "lifelink",
  first_strike: "first strike",
  double_strike: "double strike",
  menace: "menace",
  hexproof: "hexproof",
  shroud: "shroud",
  indestructible: "indestructible",
  flash: "flash",
  defender: "defender",
  fear: "fear",
  intimidate: "intimidate",
  horsemanship: "horsemanship",
  shadow: "shadow",
  skulk: "skulk",
};

/**
 * Parameterized keywords implemented as definition fields rather than
 * Keyword union members (ward: number, protectionFrom: Color[]).
 */
export const EXTRA_IMPLEMENTED: string[] = ["ward", "protection"];

export type KeywordCoverage = {
  implemented: string[];
  missing: string[];
  total: number;
};

export function keywordCoverage(): KeywordCoverage {
  const implemented = new Set([...Object.values(IMPLEMENTED_KEYWORDS), ...EXTRA_IMPLEMENTED]);
  return {
    implemented: CR702_KEYWORD_ABILITIES.filter((name) => implemented.has(name)),
    missing: CR702_KEYWORD_ABILITIES.filter((name) => !implemented.has(name)),
    total: CR702_KEYWORD_ABILITIES.length,
  };
}

/** Markdown checklist rendered into docs/KEYWORD_COVERAGE.md. */
export function keywordCoverageMarkdown(): string {
  const coverage = keywordCoverage();
  const lines: string[] = [
    "# Keyword Ability Coverage (CR 702)",
    "",
    "Generated from `engine/src/keywordCatalog.ts` — do not edit by hand.",
    "Regenerate with: `UPDATE_COVERAGE=1 npx vitest run engine/src/keywordCatalog.test.ts`",
    "",
    `**${coverage.implemented.length} of ${coverage.total}** keyword abilities implemented.`,
    "",
    "## Implemented",
    "",
    ...coverage.implemented.map((name) => `- [x] ${name}`),
    "",
    "## Not yet implemented",
    "",
    ...coverage.missing.map((name) => `- [ ] ${name}`),
    "",
  ];
  return lines.join("\n");
}
