import { createCardDefinition } from "./createGame";
import { parseManaCost } from "./mana";
import {
  compileOracleText,
  stripReminderText,
} from "./oraclePatterns";
import type { ActivatedAbility, CardDefinition, Color, Keyword, ManaPool } from "./types";

function explicitColors(raw: string[] | undefined): Color[] | undefined {
  if (!raw) {
    return undefined;
  }
  const colors = raw.filter((entry): entry is Color => ["W", "U", "B", "R", "G"].includes(entry));
  return colors;
}

export type OracleFace = {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  imageUrl?: string;
  /** Scryfall face colors (color indicator aware), e.g. ["U"]. */
  colors?: string[];
};

export type OracleCard = {
  oracleId: string;
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  /** Scryfall-style keyword names, e.g. "Flying". */
  printedKeywords: string[];
  /** Scryfall `image_uris.normal` when fetched. */
  imageUrl?: string;
  /** Scryfall card colors (color indicator aware), e.g. ["W", "U"]. */
  colors?: string[];
  /** Planeswalker starting loyalty ("3"). */
  loyalty?: string | null;
  layout?: string;
  faces?: OracleFace[];
};

export type OracleCompileResult = {
  definition: CardDefinition;
  otherDefinition?: CardDefinition;
  notes: string[];
};

const KEYWORD_BY_LABEL: Record<string, Keyword> = {
  flying: "flying",
  reach: "reach",
  haste: "haste",
  vigilance: "vigilance",
  trample: "trample",
  deathtouch: "deathtouch",
  lifelink: "lifelink",
  "first strike": "first_strike",
  "double strike": "double_strike",
  menace: "menace",
  hexproof: "hexproof",
  shroud: "shroud",
  indestructible: "indestructible",
  flash: "flash",
  defender: "defender",
};

export function normalizeCardName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function definitionIdForOracle(card: OracleCard): string {
  return `oracle:${card.oracleId}`;
}

export { stripReminderText };

function parseStat(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

export function keywordsFromOracle(card: OracleCard): Keyword[] {
  const found = new Set<Keyword>();
  for (const label of card.printedKeywords) {
    const mapped = KEYWORD_BY_LABEL[label.trim().toLowerCase()];
    if (mapped) {
      found.add(mapped);
    }
  }
  const firstLine = stripReminderText(card.oracleText).split("\n")[0] ?? "";
  for (const [label, keyword] of Object.entries(KEYWORD_BY_LABEL)) {
    const pattern = new RegExp(`\\b${label.replace(" ", "[- ]")}\\b`, "i");
    if (pattern.test(firstLine)) {
      found.add(keyword);
    }
  }
  return [...found];
}

export function inferProduces(card: OracleCard): Partial<ManaPool> {
  return compileOracleText(card).produces;
}

export function inferTapDraw(card: OracleCard): ActivatedAbility[] {
  return compileOracleText(card).activated;
}

function manaCostIsPayable(manaCost: string): boolean {
  if (manaCost.trim() === "") {
    return true;
  }
  try {
    parseManaCost(manaCost);
    return true;
  } catch {
    return false;
  }
}

function cardLayout(layout: string | undefined): CardDefinition["layout"] {
  if (layout === "modal_dfc") {
    return "modal_dfc";
  }
  if (layout === "transform" || layout === "meld" || layout === "double_faced_token") {
    return "transform";
  }
  return undefined;
}

function compileOneFace(card: OracleCard, definitionId: string): OracleCompileResult {
  const notes: string[] = [];
  const typeLine = card.typeLine.toLowerCase();
  const keywords = keywordsFromOracle(card);
  const power = parseStat(card.power);
  const toughness = parseStat(card.toughness);
  const compiled = compileOracleText(card, keywords);

  notes.push(...compiled.notes);

  if (!manaCostIsPayable(card.manaCost)) {
    notes.push("Mana cost cannot be paid (Phyrexian).");
  }

  if (compiled.leftover.length > 0) {
    notes.push(`Some oracle text is not compiled: ${compiled.leftover.join("; ")}.`);
  }

  if (
    typeLine.includes("creature") &&
    (power === null || toughness === null) &&
    !compiled.dynamicPt
  ) {
    notes.push("Printed power/toughness is not a simple number; combat uses 0.");
  }

  const definition = createCardDefinition({
    id: definitionId,
    name: card.name.includes(" // ") ? (card.name.split(" // ")[0] ?? card.name) : card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    colors: explicitColors(card.colors),
    oracleText: card.oracleText,
    power: power ?? (typeLine.includes("creature") ? 0 : null),
    toughness: toughness ?? (typeLine.includes("creature") ? 0 : null),
    keywords,
    effects: compiled.effects,
    targetRequirements: compiled.targetRequirements,
    triggers: compiled.triggers,
    replacements: compiled.replacements,
    staticAbilities: compiled.staticAbilities,
    produces: compiled.produces,
    producesAnyColor: compiled.producesAnyColor,
    producesOptions: compiled.producesOptions,
    manaAbilities: compiled.manaAbilities,
    activated: compiled.activated,
    ...(compiled.ward ? { ward: compiled.ward } : {}),
    ...(compiled.modes ? { modes: compiled.modes } : {}),
    ...(compiled.protectionFrom && Object.keys(compiled.protectionFrom).length > 0
      ? { protectionFrom: compiled.protectionFrom }
      : {}),
    ...(compiled.enchant ? { enchant: compiled.enchant } : {}),
    ...(compiled.noMaxHandSize ? { noMaxHandSize: true } : {}),
    ...(compiled.handSizeEffect ? { handSizeEffect: compiled.handSizeEffect } : {}),
    ...(compiled.opponentsDrawCap === undefined
      ? {}
      : { opponentsDrawCap: compiled.opponentsDrawCap }),
    ...(compiled.noncreatureSpellCap === undefined
      ? {}
      : { noncreatureSpellCap: compiled.noncreatureSpellCap }),
    ...(compiled.cantLoseGame ? { cantLoseGame: true } : {}),
    ...(compiled.controllerHexproof ? { controllerHexproof: true } : {}),
    ...(compiled.attackLimitPerCombat === undefined
      ? {}
      : { attackLimitPerCombat: compiled.attackLimitPerCombat }),
    ...(compiled.extraBlocksGranted === undefined
      ? {}
      : { extraBlocksGranted: compiled.extraBlocksGranted }),
    ...(compiled.damageReplacement ? { damageReplacement: compiled.damageReplacement } : {}),
    ...(compiled.manaTapMultiplier ? { manaTapMultiplier: compiled.manaTapMultiplier } : {}),
    ...(compiled.altCost ? { altCost: compiled.altCost } : {}),
    ...(compiled.extraLandDrops ? { extraLandDrops: compiled.extraLandDrops } : {}),
    ...(compiled.extraLandDropsForAll
      ? { extraLandDropsForAll: compiled.extraLandDropsForAll }
      : {}),
    ...(compiled.opponentNonbasicLandsEnterTapped
      ? { opponentNonbasicLandsEnterTapped: true }
      : {}),
    ...(compiled.cantBeCountered ? { cantBeCountered: true } : {}),
    ...(compiled.creatureSpellsCantBeCountered ? { creatureSpellsCantBeCountered: true } : {}),
    ...(compiled.opponentsLockedDuringYourTurn ? { opponentsLockedDuringYourTurn: true } : {}),
    ...(compiled.opponentsCantCastDuringYourTurn ? { opponentsCantCastDuringYourTurn: true } : {}),
    ...(compiled.mustAttack ? { mustAttack: true } : {}),
    ...(compiled.notCreatureBelowDevotion
      ? { notCreatureBelowDevotion: { ...compiled.notCreatureBelowDevotion } }
      : {}),
    ...(compiled.freeIfCommander ? { freeIfCommander: true } : {}),
    ...(compiled.altCostIfCreatures
      ? { altCostIfCreatures: { ...compiled.altCostIfCreatures } }
      : {}),
    ...(compiled.changeling ? { changeling: true } : {}),
    ...(compiled.topOfLibrary ? { topOfLibrary: { ...compiled.topOfLibrary } } : {}),
    ...(compiled.flashback ? { flashback: { ...compiled.flashback } } : {}),
    ...(compiled.storm ? { storm: true } : {}),
    ...(compiled.doesntUntap ? { doesntUntap: true } : {}),
    ...(compiled.convoke ? { convoke: true } : {}),
    ...(compiled.improvise ? { improvise: true } : {}),
    ...(compiled.delve ? { delve: true } : {}),
    ...(compiled.grantsCostKeyword ? { grantsCostKeyword: compiled.grantsCostKeyword } : {}),
    ...(compiled.grantsFlash ? { grantsFlash: true } : {}),
    ...(compiled.grantsFlashFor ? { grantsFlashFor: compiled.grantsFlashFor } : {}),
    ...(compiled.castFreeFromHand ? { castFreeFromHand: compiled.castFreeFromHand } : {}),
    ...(compiled.attackTax ? { attackTax: { ...compiled.attackTax } } : {}),
    ...(compiled.leyline ? { leyline: true } : {}),
    ...(compiled.castFromGraveyard ? { castFromGraveyard: { ...compiled.castFromGraveyard } } : {}),
    ...(compiled.ascend ? { ascend: true } : {}),
    ...(compiled.untapDuringEachUntap
      ? { untapDuringEachUntap: compiled.untapDuringEachUntap }
      : {}),
    ...(compiled.opponentCreaturesEnterTapped ? { opponentCreaturesEnterTapped: true } : {}),
    ...(compiled.opponentArtifactsEnterTapped ? { opponentArtifactsEnterTapped: true } : {}),
    ...(compiled.extraDrawStepDraws ? { extraDrawStepDraws: true } : {}),
    ...(compiled.affinityArtifacts ? { affinityArtifacts: true } : {}),
    ...(compiled.affinityAllCreatures ? { affinityAllCreatures: true } : {}),
    ...(compiled.selfDiscount ? { selfDiscount: { ...compiled.selfDiscount } } : {}),
    ...(compiled.costReductions && compiled.costReductions.length > 0
      ? { costReductions: compiled.costReductions }
      : {}),
    ...(compiled.chooseCreatureTypeOnEnter ? { chooseCreatureTypeOnEnter: true } : {}),
    ...(compiled.chooseCardTypeOnEnter ? { chooseCardTypeOnEnter: true } : {}),
    ...(compiled.enterCountersPerChosenType
      ? { enterCountersPerChosenType: compiled.enterCountersPerChosenType }
      : {}),
    ...(compiled.freeEquipIfArtifacts ? { freeEquipIfArtifacts: compiled.freeEquipIfArtifacts } : {}),
    ...(compiled.opponentsCastOnlyFromHand ? { opponentsCastOnlyFromHand: true } : {}),
    ...(compiled.selfIsChosenType ? { selfIsChosenType: true } : {}),
    ...(compiled.triggerDoubling ? { triggerDoubling: { ...compiled.triggerDoubling } } : {}),
    ...(compiled.landChosenColorBonus ? { landChosenColorBonus: true } : {}),
    ...(compiled.landTapEcho ? { landTapEcho: { ...compiled.landTapEcho } } : {}),
    ...(compiled.opponentLandTapsSkipUntap ? { opponentLandTapsSkipUntap: true } : {}),
    ...(compiled.rebound ? { rebound: true } : {}),
    ...(compiled.chooseColorOnEnter ? { chooseColorOnEnter: true } : {}),
    ...(compiled.chooseColorExcludes ? { chooseColorExcludes: compiled.chooseColorExcludes } : {}),
    ...(compiled.enchantedTappedBonus
      ? { enchantedTappedBonus: compiled.enchantedTappedBonus }
      : {}),
    ...(compiled.entersWithXCounters ? { entersWithXCounters: true } : {}),
    ...(compiled.entersWithCounters ? { entersWithCounters: compiled.entersWithCounters } : {}),
    ...(compiled.enterAsCopy ? { enterAsCopy: { ...compiled.enterAsCopy } } : {}),
    ...(compiled.playLandsFromGraveyard ? { playLandsFromGraveyard: true } : {}),
    ...(compiled.additionalCost ? { additionalCost: compiled.additionalCost } : {}),
    ...(compiled.dynamicPt ? { dynamicPt: compiled.dynamicPt } : {}),
    ...(compiled.bonusPt ? { bonusPt: compiled.bonusPt } : {}),
    ...(compiled.modeChoice ? { modeChoice: compiled.modeChoice } : {}),
    ...(compiled.loyaltyAbilities && compiled.loyaltyAbilities.length > 0
      ? { loyaltyAbilities: compiled.loyaltyAbilities }
      : {}),
    ...(parseStat(card.loyalty ?? null) ? { loyalty: parseStat(card.loyalty ?? null) ?? 0 } : {}),
    imageUrl: card.imageUrl ?? "",
    layout: cardLayout(card.layout),
  });

  return { definition, notes };
}

/**
 * Compile Scryfall-shaped oracle data into an engine CardDefinition.
 * Matches known sentence patterns; leftover text is recorded as notes.
 */
export function compileOracleCard(card: OracleCard): OracleCompileResult {
  const frontFace = card.faces?.[0];
  const frontSource: OracleCard = frontFace
    ? {
        ...card,
        name: frontFace.name,
        manaCost: frontFace.manaCost,
        typeLine: frontFace.typeLine,
        oracleText: frontFace.oracleText,
        power: frontFace.power,
        toughness: frontFace.toughness,
        imageUrl: frontFace.imageUrl || card.imageUrl,
        colors: frontFace.colors ?? card.colors,
      }
    : card;
  const front = compileOneFace(frontSource, definitionIdForOracle(card));
  const backFace = card.faces?.[1];
  const layout = cardLayout(card.layout);
  if (!backFace || !layout) {
    return front;
  }
  const backCard: OracleCard = {
    oracleId: `${card.oracleId}:back`,
    name: backFace.name,
    manaCost: backFace.manaCost,
    typeLine: backFace.typeLine,
    oracleText: backFace.oracleText,
    power: backFace.power,
    toughness: backFace.toughness,
    printedKeywords: card.printedKeywords,
    imageUrl: backFace.imageUrl ?? "",
    ...(backFace.colors ? { colors: backFace.colors } : {}),
    layout: card.layout,
  };
  const back = compileOneFace(backCard, `${definitionIdForOracle(card)}:back`);
  front.definition.otherFaceId = back.definition.id;
  back.definition.otherFaceId = front.definition.id;
  if (layout) {
    front.definition.layout = layout;
    back.definition.layout = layout;
  }
  return {
    definition: front.definition,
    otherDefinition: back.definition,
    notes: [...front.notes, ...back.notes.map((note) => `${back.definition.name}: ${note}`)],
  };
}
