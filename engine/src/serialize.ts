import { deriveCharacteristics } from "./characteristics";
import type {
  ActivatedAbility,
  BoundChooseCardSource,
  CardEffect,
  Color,
  ContinuousEffect,
  ContinuousEffectData,
  EffectSelector,
  CardIdSelector,
  CardInstanceId,
  CardTrigger,
  ChooseCardSource,
  ChosenTarget,
  DestroyAllScope,
  EnterTappedUnless,
  GameAction,
  GameEffect,
  GameEvent,
  GameLogEntry,
  GameState,
  LookDestination,
  ManualOverrideChange,
  Keyword,
  ManaAbility,
  ManaColor,
  ManaPool,
  MulliganState,
  OpeningRollState,
  PendingPrompt,
  PlayerId,
  PlayerSelector,
  PlayerState,
  ReplacementEffect,
  SearchDestination,
  SearchFilter,
  SpellMode,
  StaticAbility,
  TargetRequirement,
  TokenTemplate,
  TriggerCandidate,
  ZoneName,
  ZoneReveal,
} from "./types";

const KEYWORDS = new Set<Keyword>([
  "flying",
  "reach",
  "haste",
  "vigilance",
  "trample",
  "deathtouch",
  "lifelink",
  "first_strike",
  "double_strike",
  "menace",
  "hexproof",
  "shroud",
  "indestructible",
  "flash",
  "defender",
  "fear",
  "intimidate",
  "horsemanship",
  "shadow",
  "skulk",
]);

const MANA_KEYS = ["W", "U", "B", "R", "G", "C"] as const;
const COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;

/**
 * Colors stored inside a serialized definition's characteristics, if any.
 * Old snapshots have no characteristics at all; both cases re-derive from
 * typeLine/manaCost, with stored colors as the explicit override.
 */
function parseStoredColors(raw: unknown): Color[] | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const colors = (raw as { colors?: unknown }).colors;
  if (!Array.isArray(colors)) {
    return undefined;
  }
  const valid = colors.filter(
    (entry): entry is Color =>
      typeof entry === "string" && (COLOR_KEYS as readonly string[]).includes(entry),
  );
  return valid;
}
const ZONE_KEYS = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
  "stack",
  "removed",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function parseMana(value: unknown, label: string): ManaPool {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const mana = emptyManaFromUnknown();
  for (const key of MANA_KEYS) {
    mana[key] = expectNumber(value[key], `${label}.${key}`);
  }
  return mana;
}

function emptyManaFromUnknown(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function parsePlayer(value: unknown): PlayerState {
  if (!isRecord(value)) {
    throw new Error("Invalid player");
  }
  if (!isRecord(value.zones)) {
    throw new Error("Invalid player zones");
  }
  if (!isRecord(value.commander)) {
    throw new Error("Invalid commander state");
  }
  if (!isRecord(value.commander.damageReceived)) {
    throw new Error("Invalid commander damage");
  }

  const damageReceived: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value.commander.damageReceived)) {
    damageReceived[key] = expectNumber(amount, `commander.damageReceived.${key}`);
  }

  const zones = {
    library: expectStringArray(value.zones.library, "zones.library"),
    hand: expectStringArray(value.zones.hand, "zones.hand"),
    battlefield: expectStringArray(value.zones.battlefield, "zones.battlefield"),
    graveyard: expectStringArray(value.zones.graveyard, "zones.graveyard"),
    exile: expectStringArray(value.zones.exile, "zones.exile"),
    command: expectStringArray(value.zones.command, "zones.command"),
    removed:
      value.zones.removed === undefined
        ? []
        : expectStringArray(value.zones.removed, "zones.removed"),
  };

  return {
    id: expectString(value.id, "player.id"),
    displayName: expectString(value.displayName, "player.displayName"),
    life: expectNumber(value.life, "player.life"),
    mana: parseMana(value.mana, "player.mana"),
    zones,
    commander: {
      commanderIds: expectStringArray(
        value.commander.commanderIds,
        "commander.commanderIds",
      ),
      tax: expectNumber(value.commander.tax, "commander.tax"),
      damageReceived,
    },
    lost: value.lost === true,
    landsPlayedThisTurn:
      value.landsPlayedThisTurn === undefined
        ? 0
        : expectNumber(value.landsPlayedThisTurn, "player.landsPlayedThisTurn"),
    attackedThisTurn: value.attackedThisTurn === true,
    failedToDraw: value.failedToDraw === true,
  };
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function parseGameState(json: string): GameState {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) {
    throw new Error("GameState JSON must be an object");
  }
  if (!Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 4) {
    throw new Error("GameState must have 2–4 players");
  }
  if (!isRecord(raw.turn) || !isRecord(raw.cards) || !isRecord(raw.definitions)) {
    throw new Error("GameState is missing turn, cards, or definitions");
  }
  if (!Array.isArray(raw.stack)) {
    throw new Error("Invalid stack");
  }

  const players = raw.players.map(parsePlayer);
  const playerIds = new Set(players.map((p) => p.id));
  if (playerIds.size !== players.length) {
    throw new Error("Player IDs must be unique");
  }

  const cards: GameState["cards"] = {};
  for (const [id, card] of Object.entries(raw.cards)) {
    if (!isRecord(card)) {
      throw new Error(`Invalid card ${id}`);
    }
    const instanceId = expectString(card.id, "card.id");
    if (instanceId !== id) {
      throw new Error("Card instance key must match card.id");
    }
    const zone = expectString(card.zone, "card.zone");
    if (!ZONE_KEYS.includes(zone as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid zone ${zone}`);
    }
    cards[id] = {
      id: instanceId,
      definitionId: expectString(card.definitionId, "card.definitionId"),
      ownerId: expectString(card.ownerId, "card.ownerId"),
      controllerId: expectString(card.controllerId, "card.controllerId"),
      zone: zone as (typeof ZONE_KEYS)[number],
      tapped: card.tapped === undefined ? false : card.tapped === true,
      damageMarked:
        card.damageMarked === undefined ? 0 : expectNumber(card.damageMarked, "card.damageMarked"),
      attacking: card.attacking === true,
      blockingAttackerId:
        card.blockingAttackerId === undefined || card.blockingAttackerId === null
          ? null
          : expectString(card.blockingAttackerId, "card.blockingAttackerId"),
      summoningSick: card.summoningSick === true,
      counters: parseCounters(card.counters, `card.${id}.counters`),
      classLevel:
        card.classLevel === undefined ? 0 : expectNumber(card.classLevel, "card.classLevel"),
      timestamp:
        card.timestamp === undefined ? 0 : expectNumber(card.timestamp, "card.timestamp"),
      isToken: card.isToken === true,
      deathtouched: card.deathtouched === true,
      attachedTo:
        card.attachedTo === undefined || card.attachedTo === null
          ? null
          : expectString(card.attachedTo, "card.attachedTo"),
      loyaltyActivatedThisTurn: card.loyaltyActivatedThisTurn === true,
      faceDown: card.faceDown === true,
      chosenCreatureType:
        card.chosenCreatureType === undefined || card.chosenCreatureType === null
          ? null
          : expectString(card.chosenCreatureType, "card.chosenCreatureType"),
    };
  }

  const definitions: GameState["definitions"] = {};
  for (const [id, def] of Object.entries(raw.definitions)) {
    if (!isRecord(def)) {
      throw new Error(`Invalid definition ${id}`);
    }
    const definitionId = expectString(def.id, "definition.id");
    if (definitionId !== id) {
      throw new Error("Definition key must match definition.id");
    }
    const manaCost = expectString(def.manaCost, "definition.manaCost", true);
    const typeLine = expectString(def.typeLine, "definition.typeLine");
    definitions[id] = {
      id: definitionId,
      name: expectString(def.name, "definition.name"),
      manaCost,
      typeLine,
      characteristics: deriveCharacteristics(typeLine, manaCost, parseStoredColors(def.characteristics)),
      oracleText: expectString(def.oracleText, "definition.oracleText", true),
      power: def.power === undefined || def.power === null ? null : expectNumber(def.power, "definition.power"),
      toughness:
        def.toughness === undefined || def.toughness === null
          ? null
          : expectNumber(def.toughness, "definition.toughness"),
      effects: parseCardEffects(def.effects, `definition.${id}.effects`),
      targetRequirements: parseTargetRequirements(
        def.targetRequirements,
        `definition.${id}.targetRequirements`,
      ),
      keywords: parseKeywords(def.keywords, `definition.${id}.keywords`),
      triggers: parseTriggers(def.triggers, `definition.${id}.triggers`),
      replacements: parseReplacements(def.replacements, `definition.${id}.replacements`),
      staticAbilities: parseStaticAbilities(
        def.staticAbilities,
        def.staticModifiers,
        `definition.${id}.staticAbilities`,
      ),
      produces: parseProduces(def.produces, `definition.${id}.produces`),
      producesAnyColor: def.producesAnyColor === true,
      producesOptions: parseManaOptions(def.producesOptions, `definition.${id}.producesOptions`),
      manaAbilities: parseManaAbilities(def.manaAbilities, `definition.${id}.manaAbilities`),
      activated: parseActivatedAbilities(def.activated, `definition.${id}.activated`),
      imageUrl:
        def.imageUrl === undefined ? "" : expectString(def.imageUrl, "definition.imageUrl", true),
      ...(def.ward === undefined ? {} : { ward: expectNumber(def.ward, "definition.ward") }),
      ...(def.noMaxHandSize === true ? { noMaxHandSize: true } : {}),
      ...(def.extraLandDrops === undefined
        ? {}
        : { extraLandDrops: expectNumber(def.extraLandDrops, `definition.${id}.extraLandDrops`) }),
      ...(def.cantBeCountered === true ? { cantBeCountered: true } : {}),
      ...(def.freeIfCommander === true ? { freeIfCommander: true } : {}),
      ...(def.changeling === true ? { changeling: true } : {}),
      ...(def.storm === true ? { storm: true } : {}),
      ...(def.doesntUntap === true ? { doesntUntap: true } : {}),
      ...(def.grantsFlash === true ? { grantsFlash: true } : {}),
      ...(def.extraDrawStepDraws === true ? { extraDrawStepDraws: true } : {}),
      ...(def.affinityArtifacts === true ? { affinityArtifacts: true } : {}),
      ...(def.affinityAllCreatures === true ? { affinityAllCreatures: true } : {}),
      ...(def.flashback === undefined
        ? {}
        : {
            flashback: (() => {
              if (!isRecord(def.flashback)) {
                throw new Error(`Invalid definition.${id}.flashback`);
              }
              return {
                manaCost: expectString(
                  def.flashback.manaCost,
                  `definition.${id}.flashback.manaCost`,
                ),
                ...(def.flashback.life === undefined
                  ? {}
                  : { life: expectNumber(def.flashback.life, `definition.${id}.flashback.life`) }),
              };
            })(),
          }),
      ...(def.topOfLibrary === undefined
        ? {}
        : {
            topOfLibrary: (() => {
              if (!isRecord(def.topOfLibrary)) {
                throw new Error(`Invalid definition.${id}.topOfLibrary`);
              }
              const grant = def.topOfLibrary;
              return {
                ...(grant.look === true ? { look: true } : {}),
                ...(grant.playLands === true ? { playLands: true } : {}),
                ...(grant.castAll === true ? { castAll: true } : {}),
                ...(grant.castTypesAny === undefined
                  ? {}
                  : {
                      castTypesAny: (() => {
                        if (!Array.isArray(grant.castTypesAny)) {
                          throw new Error(`Invalid definition.${id}.topOfLibrary.castTypesAny`);
                        }
                        return grant.castTypesAny.map((entry, index) =>
                          expectString(entry, `definition.${id}.topOfLibrary.castTypesAny[${index}]`),
                        );
                      })(),
                    }),
              };
            })(),
          }),
      ...(def.chooseCreatureTypeOnEnter === true ? { chooseCreatureTypeOnEnter: true } : {}),
      ...(def.entersWithXCounters === true ? { entersWithXCounters: true } : {}),
      ...(def.additionalCost === undefined
        ? {}
        : {
            additionalCost: (() => {
              if (!isRecord(def.additionalCost)) {
                throw new Error(`Invalid definition.${id}.additionalCost`);
              }
              const sacrifice = def.additionalCost.sacrifice;
              if (
                sacrifice !== undefined &&
                sacrifice !== "creature" &&
                sacrifice !== "artifact" &&
                sacrifice !== "creature_or_artifact" &&
                sacrifice !== "land"
              ) {
                throw new Error(`Invalid definition.${id}.additionalCost.sacrifice`);
              }
              return {
                ...(sacrifice === undefined ? {} : { sacrifice }),
                ...(def.additionalCost.discard === undefined
                  ? {}
                  : {
                      discard: expectNumber(
                        def.additionalCost.discard,
                        `definition.${id}.additionalCost.discard`,
                      ),
                    }),
                ...(def.additionalCost.life === undefined
                  ? {}
                  : {
                      life: expectNumber(
                        def.additionalCost.life,
                        `definition.${id}.additionalCost.life`,
                      ),
                    }),
              };
            })(),
          }),
      ...(def.attackTax === undefined
        ? {}
        : {
            attackTax: (() => {
              if (!isRecord(def.attackTax)) {
                throw new Error(`Invalid definition.${id}.attackTax`);
              }
              return {
                ...(def.attackTax.generic === undefined
                  ? {}
                  : {
                      generic: expectNumber(
                        def.attackTax.generic,
                        `definition.${id}.attackTax.generic`,
                      ),
                    }),
                ...(def.attackTax.perEnchantment === true ? { perEnchantment: true } : {}),
                ...(def.attackTax.lifePer === undefined
                  ? {}
                  : {
                      lifePer: expectNumber(
                        def.attackTax.lifePer,
                        `definition.${id}.attackTax.lifePer`,
                      ),
                    }),
              };
            })(),
          }),
      ...(def.playLandsFromGraveyard === true ? { playLandsFromGraveyard: true } : {}),
      ...(def.leyline === true ? { leyline: true } : {}),
      ...(def.untapDuringEachUntap === "creatures" || def.untapDuringEachUntap === "permanents"
        ? { untapDuringEachUntap: def.untapDuringEachUntap }
        : {}),
      ...(def.dynamicPt === undefined
        ? {}
        : {
            dynamicPt: (() => {
              if (!isRecord(def.dynamicPt)) {
                throw new Error(`Invalid definition.${id}.dynamicPt`);
              }
              const count = expectString(def.dynamicPt.count, `definition.${id}.dynamicPt.count`);
              if (
                count !== "lands_you_control" &&
                count !== "creatures_you_control" &&
                count !== "artifacts_you_control" &&
                count !== "cards_in_your_hand" &&
                count !== "cards_in_your_graveyard"
              ) {
                throw new Error(`Invalid definition.${id}.dynamicPt.count`);
              }
              return { count };
            })(),
          }),
      ...(def.costReductions === undefined
        ? {}
        : {
            costReductions: (() => {
              if (!Array.isArray(def.costReductions)) {
                throw new Error(`Invalid definition.${id}.costReductions`);
              }
              return def.costReductions.map((entry, index) => {
                if (!isRecord(entry) || !isRecord(entry.filter)) {
                  throw new Error(`Invalid definition.${id}.costReductions[${index}]`);
                }
                const generic = expectNumber(
                  entry.generic,
                  `definition.${id}.costReductions[${index}].generic`,
                );
                const types = parseStringList(
                  entry.filter.types,
                  `definition.${id}.costReductions[${index}].filter.types`,
                );
                const typesAny = parseStringList(
                  entry.filter.typesAny,
                  `definition.${id}.costReductions[${index}].filter.typesAny`,
                );
                const colors = (entry.filter.colors === undefined
                  ? []
                  : (() => {
                      if (!Array.isArray(entry.filter.colors)) {
                        throw new Error(`Invalid definition.${id}.costReductions[${index}].filter.colors`);
                      }
                      return entry.filter.colors.map((color, colorIndex) => {
                        const value = expectString(
                          color,
                          `definition.${id}.costReductions[${index}].filter.colors[${colorIndex}]`,
                        );
                        if (!(COLOR_KEYS as readonly string[]).includes(value)) {
                          throw new Error(
                            `Invalid definition.${id}.costReductions[${index}].filter.colors[${colorIndex}]`,
                          );
                        }
                        return value as Color;
                      });
                    })());
                const subtypesAny = parseStringList(
                  entry.filter.subtypesAny,
                  `definition.${id}.costReductions[${index}].filter.subtypesAny`,
                );
                return {
                  generic,
                  filter: {
                    ...(types.length > 0 ? { types } : {}),
                    ...(typesAny.length > 0 ? { typesAny } : {}),
                    ...(subtypesAny.length > 0 ? { subtypesAny } : {}),
                    ...(colors.length > 0 ? { colors } : {}),
                  },
                };
              });
            })(),
          }),
      ...(def.protectionFrom === undefined
        ? {}
        : {
            protectionFrom: (() => {
              if (!Array.isArray(def.protectionFrom)) {
                throw new Error(`Invalid definition.${id}.protectionFrom`);
              }
              return def.protectionFrom.map((entry, index) => {
                const color = expectString(entry, `definition.${id}.protectionFrom[${index}]`);
                if (!(COLOR_KEYS as readonly string[]).includes(color)) {
                  throw new Error(`Invalid definition.${id}.protectionFrom[${index}]`);
                }
                return color as Color;
              });
            })(),
          }),
      ...(def.modes === undefined
        ? {}
        : { modes: parseSpellModes(def.modes, `definition.${id}.modes`) }),
      ...(def.modeChoice === undefined
        ? {}
        : {
            modeChoice: (() => {
              if (!isRecord(def.modeChoice)) {
                throw new Error(`Invalid definition.${id}.modeChoice`);
              }
              return {
                min: expectNumber(def.modeChoice.min, `definition.${id}.modeChoice.min`),
                max: expectNumber(def.modeChoice.max, `definition.${id}.modeChoice.max`),
              };
            })(),
          }),
      ...(def.enchant === "creature" ? { enchant: "creature" as const } : {}),
      ...(def.loyalty === undefined
        ? {}
        : { loyalty: expectNumber(def.loyalty, `definition.${id}.loyalty`) }),
      ...(def.loyaltyAbilities === undefined
        ? {}
        : {
            loyaltyAbilities: (() => {
              if (!Array.isArray(def.loyaltyAbilities)) {
                throw new Error(`Invalid definition.${id}.loyaltyAbilities`);
              }
              return def.loyaltyAbilities.map((entry, index) => {
                if (!isRecord(entry)) {
                  throw new Error(`Invalid definition.${id}.loyaltyAbilities[${index}]`);
                }
                return {
                  cost: expectNumber(entry.cost, `definition.${id}.loyaltyAbilities[${index}].cost`),
                  effects: parseCardEffects(
                    entry.effects,
                    `definition.${id}.loyaltyAbilities[${index}].effects`,
                  ),
                  targetRequirements: parseTargetRequirements(
                    entry.targetRequirements,
                    `definition.${id}.loyaltyAbilities[${index}].targetRequirements`,
                  ),
                };
              });
            })(),
          }),
      ...(def.otherFaceId === undefined
        ? {}
        : { otherFaceId: expectString(def.otherFaceId, "definition.otherFaceId") }),
      ...(def.layout === undefined || def.layout === "normal"
        ? {}
        : { layout: parseCardLayout(def.layout, "definition.layout") }),
    };
  }

  const cardIds = Object.keys(cards);
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Card instance IDs must be unique");
  }

  const stack = raw.stack.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid stack object ${index}`);
    }
    const kindRaw = expectString(entry.kind, "stack.kind");
    if (kindRaw !== "spell" && kindRaw !== "ability") {
      throw new Error("Invalid stack object kind");
    }
    const kind: "spell" | "ability" = kindRaw;
    const sourceId = entry.sourceId;
    if (sourceId !== null && typeof sourceId !== "string") {
      throw new Error("Invalid stack sourceId");
    }
    const triggerIndex = entry.triggerIndex;
    const activatedIndex = entry.activatedIndex;
    return {
      id: expectString(entry.id, "stack.id"),
      controllerId: expectString(entry.controllerId, "stack.controllerId"),
      sourceId,
      kind,
      targets: parseChosenTargets(entry.targets, `stack[${index}].targets`),
      ...(triggerIndex === undefined
        ? {}
        : { triggerIndex: expectNumber(triggerIndex, `stack[${index}].triggerIndex`) }),
      ...(activatedIndex === undefined
        ? {}
        : { activatedIndex: expectNumber(activatedIndex, `stack[${index}].activatedIndex`) }),
      ...(entry.subjectCardId === undefined
        ? {}
        : { subjectCardId: expectString(entry.subjectCardId, `stack[${index}].subjectCardId`) }),
      ...(entry.subjectPlayerId === undefined
        ? {}
        : { subjectPlayerId: expectString(entry.subjectPlayerId, `stack[${index}].subjectPlayerId`) }),
      ...(entry.subjectAmount === undefined
        ? {}
        : { subjectAmount: expectNumber(entry.subjectAmount, `stack[${index}].subjectAmount`) }),
      ...(entry.sacrificedPower === undefined
        ? {}
        : {
            sacrificedPower: expectNumber(entry.sacrificedPower, `stack[${index}].sacrificedPower`),
          }),
      ...(entry.modeIndex === undefined
        ? {}
        : { modeIndex: expectNumber(entry.modeIndex, `stack[${index}].modeIndex`) }),
      ...(entry.isCopy === true ? { isCopy: true } : {}),
      ...(entry.fromGraveyard === true ? { fromGraveyard: true } : {}),
      ...(entry.modeIndexes === undefined
        ? {}
        : {
            modeIndexes: (() => {
              if (!Array.isArray(entry.modeIndexes)) {
                throw new Error(`Invalid stack[${index}].modeIndexes`);
              }
              return entry.modeIndexes.map((value, i) =>
                expectNumber(value, `stack[${index}].modeIndexes[${i}]`),
              );
            })(),
          }),
      ...(entry.loyaltyIndex === undefined
        ? {}
        : { loyaltyIndex: expectNumber(entry.loyaltyIndex, `stack[${index}].loyaltyIndex`) }),
      ...(entry.xValue === undefined
        ? {}
        : { xValue: expectNumber(entry.xValue, `stack[${index}].xValue`) }),
      ...(entry.division === undefined
        ? {}
        : {
            division: (() => {
              if (!Array.isArray(entry.division)) {
                throw new Error(`Invalid stack[${index}].division`);
              }
              return entry.division.map((part, partIndex) =>
                expectNumber(part, `stack[${index}].division[${partIndex}]`),
              );
            })(),
          }),
    };
  });

  const phase = expectString(raw.turn.phase, "turn.phase");
  const step = expectString(raw.turn.step, "turn.step");

  return {
    id: expectString(raw.id, "game.id"),
    players,
    turn: {
      number: expectNumber(raw.turn.number, "turn.number"),
      activePlayerId: expectString(raw.turn.activePlayerId, "turn.activePlayerId"),
      phase: phase as GameState["turn"]["phase"],
      step: step as GameState["turn"]["step"],
    },
    stack,
    cards,
    definitions,
    combat: parseCombat(raw.combat),
    priorityPlayerId: expectString(
      raw.priorityPlayerId ?? raw.turn.activePlayerId,
      "priorityPlayerId",
    ),
    passesSinceAction: expectNumber(raw.passesSinceAction ?? 0, "passesSinceAction"),
    winnerId:
      raw.winnerId === undefined || raw.winnerId === null
        ? null
        : expectString(raw.winnerId, "winnerId"),
    log: parseLog(raw.log),
    mulligan: parseMulligan(raw.mulligan, playerIds),
    openingRoll: parseOpeningRoll(raw.openingRoll, playerIds),
    firstPlayerId: parseFirstPlayerId(raw.firstPlayerId, players),
    prompts: parsePrompts(raw.prompts, playerIds),
    reveals: parseReveals(raw.reveals, playerIds),
    activeEffects: parseActiveEffects(raw.activeEffects),
    nextTimestamp:
      raw.nextTimestamp === undefined ? 1 : expectNumber(raw.nextTimestamp, "nextTimestamp"),
    oncePerTurnFired: parseStringList(raw.oncePerTurnFired, "oncePerTurnFired"),
    pendingExtraCombats:
      raw.pendingExtraCombats === undefined
        ? 0
        : expectNumber(raw.pendingExtraCombats, "pendingExtraCombats"),
    spellsCastThisTurn:
      raw.spellsCastThisTurn === undefined
        ? 0
        : expectNumber(raw.spellsCastThisTurn, "spellsCastThisTurn"),
    preventCombatDamage: raw.preventCombatDamage === true,
    delayedEndStep:
      raw.delayedEndStep === undefined
        ? []
        : (() => {
            if (!Array.isArray(raw.delayedEndStep)) {
              throw new Error("Invalid delayedEndStep");
            }
            return raw.delayedEndStep.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid delayedEndStep[${index}]`);
              }
              const action = expectString(entry.action, `delayedEndStep[${index}].action`);
              if (action !== "sacrifice" && action !== "exile") {
                throw new Error(`Invalid delayedEndStep[${index}].action`);
              }
              return {
                cardId: expectString(entry.cardId, `delayedEndStep[${index}].cardId`),
                action,
              };
            });
          })(),
    ...(raw.diesReturnUntilEot === undefined
      ? {}
      : {
          diesReturnUntilEot: (() => {
            if (!Array.isArray(raw.diesReturnUntilEot)) {
              throw new Error("Invalid diesReturnUntilEot");
            }
            return raw.diesReturnUntilEot.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid diesReturnUntilEot[${index}]`);
              }
              return {
                cardId: expectString(entry.cardId, `diesReturnUntilEot[${index}].cardId`),
                ...(entry.counter === true ? { counter: true } : {}),
                ...(entry.treasure === true ? { treasure: true } : {}),
              };
            });
          })(),
        }),
  };
}

function parseActiveEffects(value: unknown): ContinuousEffect[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid activeEffects");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid activeEffects[${index}]`);
    }
    if (entry.duration !== "until_end_of_turn") {
      throw new Error(`Invalid activeEffects[${index}].duration`);
    }
    return {
      id: expectString(entry.id, `activeEffects[${index}].id`),
      sourceId:
        entry.sourceId === undefined || entry.sourceId === null
          ? null
          : expectString(entry.sourceId, `activeEffects[${index}].sourceId`),
      affected: expectStringArray(entry.affected, `activeEffects[${index}].affected`),
      effect: parseContinuousEffectData(entry.effect, `activeEffects[${index}].effect`),
      duration: "until_end_of_turn",
      timestamp: expectNumber(entry.timestamp, `activeEffects[${index}].timestamp`),
    };
  });
}

function parseFirstPlayerId(value: unknown, players: GameState["players"]): PlayerId {
  const fallback = players[0]?.id;
  if (!fallback) {
    throw new Error("Game has no players");
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  const playerId = expectString(value, "firstPlayerId");
  if (!players.some((player) => player.id === playerId)) {
    throw new Error("firstPlayerId must be a player");
  }
  return playerId;
}

function parsePrompts(value: unknown, playerIds: Set<string>): PendingPrompt[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid prompts");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid prompts[${index}]`);
    }
    const kind = expectString(entry.kind, `prompts[${index}].kind`);
    const playerId = expectString(entry.playerId, `prompts[${index}].playerId`);
    if (!playerIds.has(playerId)) {
      throw new Error(`prompts[${index}].playerId must be a player`);
    }
    if (kind === "may_pay_life_or_enter_tapped") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
        amount: expectNumber(entry.amount, `prompts[${index}].amount`),
      };
    }
    if (kind === "choose_creature_type") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
      };
    }
    if (kind === "order_triggers") {
      return {
        kind,
        playerId,
        entries: parseTriggerCandidates(entry.entries, `prompts[${index}].entries`),
        remaining: parseTriggerGroups(entry.remaining, `prompts[${index}].remaining`, playerIds),
      };
    }
    if (kind === "pay_or_counter") {
      const reason = expectString(entry.reason, `prompts[${index}].reason`);
      if (reason !== "unless_pays" && reason !== "ward") {
        throw new Error(`Invalid prompts[${index}].reason`);
      }
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        cost: expectString(entry.cost, `prompts[${index}].cost`),
        stackObjectId: expectString(entry.stackObjectId, `prompts[${index}].stackObjectId`),
        reason,
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind === "pay_or_effect") {
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        cost: expectString(entry.cost, `prompts[${index}].cost`),
        thenEffects: parseGameEffects(entry.thenEffects, `prompts[${index}].thenEffects`),
        sourceId:
          entry.sourceId === undefined || entry.sourceId === null
            ? null
            : expectString(entry.sourceId, `prompts[${index}].sourceId`),
        ...(entry.whenPaid === true ? { whenPaid: true } : {}),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind === "scry" || kind === "surveil" || kind === "choose_discard") {
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        count: expectNumber(entry.count, `prompts[${index}].count`),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind === "look_and_assign") {
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        count: expectNumber(entry.count, `prompts[${index}].count`),
        destinations: parseLookDestinations(entry.destinations, `prompts[${index}].destinations`),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind === "search_library") {
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        filter: parseSearchFilter(entry.filter, `prompts[${index}].filter`),
        destination: parseSearchDestination(entry.destination, `prompts[${index}].destination`),
        count: expectNumber(entry.count, `prompts[${index}].count`),
        ...(entry.entersTapped === true ? { entersTapped: true } : {}),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind === "choose_card") {
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        sources: parseBoundChooseSources(entry.sources, `prompts[${index}].sources`, playerIds),
        thenEffects: parseCardEffects(entry.thenEffects, `prompts[${index}].thenEffects`),
        sourceId:
          entry.sourceId === undefined || entry.sourceId === null
            ? null
            : expectString(entry.sourceId, `prompts[${index}].sourceId`),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind !== "choose_targets") {
      throw new Error(`Invalid prompts[${index}].kind`);
    }
    const origin = expectString(entry.origin, `prompts[${index}].origin`);
    if (origin !== "trigger") {
      throw new Error(`Invalid prompts[${index}].origin`);
    }
    return {
      kind,
      playerId,
      sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
      origin,
      triggerIndex: expectNumber(entry.triggerIndex, `prompts[${index}].triggerIndex`),
      requirements: parseTargetRequirements(entry.requirements, `prompts[${index}].requirements`),
      ...(entry.subjectCardId === undefined
        ? {}
        : { subjectCardId: expectString(entry.subjectCardId, `prompts[${index}].subjectCardId`) }),
      ...(entry.subjectPlayerId === undefined
        ? {}
        : {
            subjectPlayerId: expectString(entry.subjectPlayerId, `prompts[${index}].subjectPlayerId`),
          }),
      ...(entry.subjectAmount === undefined
        ? {}
        : { subjectAmount: expectNumber(entry.subjectAmount, `prompts[${index}].subjectAmount`) }),
    };
  });
}

function parseTriggerCandidates(value: unknown, label: string): TriggerCandidate[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return {
      cardId: expectString(entry.cardId, `${label}[${index}].cardId`),
      triggerIndex: expectNumber(entry.triggerIndex, `${label}[${index}].triggerIndex`),
      ...(entry.subjectCardId === undefined
        ? {}
        : { subjectCardId: expectString(entry.subjectCardId, `${label}[${index}].subjectCardId`) }),
      ...(entry.subjectPlayerId === undefined
        ? {}
        : {
            subjectPlayerId: expectString(entry.subjectPlayerId, `${label}[${index}].subjectPlayerId`),
          }),
      ...(entry.subjectAmount === undefined
        ? {}
        : {
            subjectAmount: expectNumber(entry.subjectAmount, `${label}[${index}].subjectAmount`),
          }),
    };
  });
}

function parseTriggerGroups(
  value: unknown,
  label: string,
  playerIds: Set<string>,
): { playerId: PlayerId; entries: TriggerCandidate[] }[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const playerId = expectString(entry.playerId, `${label}[${index}].playerId`);
    if (!playerIds.has(playerId)) {
      throw new Error(`${label}[${index}].playerId must be a player`);
    }
    return {
      playerId,
      entries: parseTriggerCandidates(entry.entries, `${label}[${index}].entries`),
    };
  });
}

function parseSearchFilter(value: unknown, label: string): SearchFilter {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const supertypes = parseStringList(value.supertypes, `${label}.supertypes`);
  const types = parseStringList(value.types, `${label}.types`);
  const subtypes = parseStringList(value.subtypes, `${label}.subtypes`);
  const subtypesAny = parseStringList(value.subtypesAny, `${label}.subtypesAny`);
  const typesAny = parseStringList(value.typesAny, `${label}.typesAny`);
  return {
    ...(supertypes.length > 0 ? { supertypes } : {}),
    ...(types.length > 0 ? { types } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
    ...(subtypesAny.length > 0 ? { subtypesAny } : {}),
    ...(typesAny.length > 0 ? { typesAny } : {}),
  };
}

function parseSearchDestination(value: unknown, label: string): SearchDestination {
  const destination = expectString(value, label);
  if (
    destination !== "hand" &&
    destination !== "battlefield" &&
    destination !== "graveyard" &&
    destination !== "library_top"
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return destination;
}

function parseLookDestinations(value: unknown, label: string): LookDestination[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    const destination = expectString(entry, `${label}[${index}]`);
    if (destination !== "hand" && destination !== "library_bottom" && destination !== "exile") {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return destination;
  });
}

function parseDestroyAllScope(value: unknown, label: string): DestroyAllScope {
  const scope = expectString(value, label);
  if (
    scope !== "creatures" &&
    scope !== "artifacts" &&
    scope !== "enchantments" &&
    scope !== "planeswalkers" &&
    scope !== "nonland"
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return scope;
}

function parseCardFilter(
  value: unknown,
  label: string,
): "any" | "creature" | "land" | "nonland" | "noncreature_nonland" {
  const filter = expectString(value, label);
  if (
    filter !== "any" &&
    filter !== "creature" &&
    filter !== "land" &&
    filter !== "nonland" &&
    filter !== "noncreature_nonland"
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return filter;
}

function parseChooseCardSources(value: unknown, label: string): ChooseCardSource[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const zone = expectString(entry.zone, `${label}[${index}].zone`);
    if (zone !== "hand" && zone !== "graveyard" && zone !== "battlefield") {
      throw new Error(`Invalid ${label}[${index}].zone`);
    }
    return {
      playerId: parsePlayerSelector(entry.playerId, `${label}[${index}].playerId`),
      zone,
      filter: parseCardFilter(entry.filter, `${label}[${index}].filter`),
    };
  });
}

function parseBoundChooseSources(
  value: unknown,
  label: string,
  playerIds: Set<string>,
): BoundChooseCardSource[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const playerId = expectString(entry.playerId, `${label}[${index}].playerId`);
    if (!playerIds.has(playerId)) {
      throw new Error(`${label}[${index}].playerId must be a player`);
    }
    const zone = expectString(entry.zone, `${label}[${index}].zone`);
    if (zone !== "hand" && zone !== "graveyard" && zone !== "battlefield") {
      throw new Error(`Invalid ${label}[${index}].zone`);
    }
    return {
      playerId,
      zone,
      filter: parseCardFilter(entry.filter, `${label}[${index}].filter`),
    };
  });
}

function parseReveals(value: unknown, playerIds: Set<string>): ZoneReveal[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid reveals");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid reveals[${index}]`);
    }
    const viewerId = expectString(entry.viewerId, `reveals[${index}].viewerId`);
    if (!playerIds.has(viewerId)) {
      throw new Error(`reveals[${index}].viewerId must be a player`);
    }
    return {
      viewerId,
      cardIds: expectStringArray(entry.cardIds, `reveals[${index}].cardIds`) as CardInstanceId[],
    };
  });
}

function parseTokenTemplate(value: unknown, label: string): TokenTemplate {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return {
    name: expectString(value.name, `${label}.name`),
    typeLine: expectString(value.typeLine, `${label}.typeLine`),
    power: value.power === undefined || value.power === null ? null : expectNumber(value.power, `${label}.power`),
    toughness:
      value.toughness === undefined || value.toughness === null
        ? null
        : expectNumber(value.toughness, `${label}.toughness`),
  };
}

function parseMulligan(value: unknown, playerIds: Set<string>): MulliganState | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid mulligan");
  }
  const decidingPlayerId = expectString(value.decidingPlayerId, "mulligan.decidingPlayerId");
  if (!playerIds.has(decidingPlayerId)) {
    throw new Error("mulligan.decidingPlayerId must be a player");
  }
  if (!isRecord(value.taken) || !isRecord(value.kept)) {
    throw new Error("Invalid mulligan taken/kept");
  }
  const taken: Record<PlayerId, number> = {};
  const kept: Record<PlayerId, boolean> = {};
  for (const playerId of playerIds) {
    taken[playerId] = expectNumber(value.taken[playerId] ?? 0, `mulligan.taken.${playerId}`);
    kept[playerId] = value.kept[playerId] === true;
  }
  return {
    decidingPlayerId,
    taken,
    kept,
    pendingBottom: expectNumber(value.pendingBottom ?? 0, "mulligan.pendingBottom"),
    startingHandSize: expectNumber(value.startingHandSize ?? 7, "mulligan.startingHandSize"),
  };
}

function parseOpeningRoll(value: unknown, playerIds: Set<string>): OpeningRollState | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid openingRoll");
  }
  if (!isRecord(value.rolls)) {
    throw new Error("Invalid openingRoll.rolls");
  }
  const rolls: Record<PlayerId, number> = {};
  for (const [playerId, result] of Object.entries(value.rolls)) {
    if (!playerIds.has(playerId)) {
      throw new Error("openingRoll.rolls has an unknown player");
    }
    rolls[playerId] = expectNumber(result, `openingRoll.rolls.${playerId}`);
  }
  return {
    rolls,
    startingHandSize: expectNumber(value.startingHandSize ?? 7, "openingRoll.startingHandSize"),
  };
}

function parseChosenTarget(value: unknown, label: string): ChosenTarget {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const type = expectString(value.type, `${label}.type`);
  if (type === "player") {
    return { type, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (type === "creature") {
    return { type, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (type === "spell") {
    return {
      type,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
    };
  }
  throw new Error(`Invalid ${label}.type`);
}

function parseChosenTargets(value: unknown, label: string): ChosenTarget[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseChosenTarget(entry, `${label}[${index}]`));
}

function parseTargetRequirement(value: unknown, label: string): TargetRequirement {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  if (
    kind !== "player" &&
    kind !== "opponent" &&
    kind !== "creature" &&
    kind !== "own_creature" &&
    kind !== "permanent" &&
    kind !== "creature_or_planeswalker" &&
    kind !== "artifact" &&
    kind !== "enchantment" &&
    kind !== "artifact_or_enchantment" &&
    kind !== "creature_or_artifact" &&
    kind !== "creature_or_enchantment" &&
    kind !== "nonland_permanent" &&
    kind !== "noncreature_nonland_permanent" &&
    kind !== "own_graveyard_card" &&
    kind !== "own_graveyard_creature_card" &&
    kind !== "own_graveyard_permanent_card" &&
    kind !== "own_graveyard_artifact_card" &&
    kind !== "nonartifact_creature" &&
    kind !== "player_or_creature" &&
    kind !== "spell" &&
    kind !== "creature_spell" &&
    kind !== "noncreature_spell" &&
    kind !== "instant_or_sorcery_spell" &&
    kind !== "land" &&
    kind !== "commander"
  ) {
    throw new Error(`Invalid ${label}.kind`);
  }
  const control = value.control;
  if (control !== undefined && control !== "own" && control !== "not_own") {
    throw new Error(`Invalid ${label}.control`);
  }
  const excludeColors =
    value.excludeColors === undefined
      ? []
      : (() => {
          if (!Array.isArray(value.excludeColors)) {
            throw new Error(`Invalid ${label}.excludeColors`);
          }
          return value.excludeColors.map((entry, index) => {
            const color = expectString(entry, `${label}.excludeColors[${index}]`);
            if (!(COLOR_KEYS as readonly string[]).includes(color)) {
              throw new Error(`Invalid ${label}.excludeColors[${index}]`);
            }
            return color as Color;
          });
        })();
  return {
    kind,
    ...(value.variable === true ? { variable: true } : {}),
    ...(excludeColors.length > 0 ? { excludeColors } : {}),
    ...(control === undefined ? {} : { control }),
    ...(value.maxManaValue === undefined
      ? {}
      : { maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`) }),
    ...(value.minManaValue === undefined
      ? {}
      : { minManaValue: expectNumber(value.minManaValue, `${label}.minManaValue`) }),
    ...(value.maxPower === undefined
      ? {}
      : { maxPower: expectNumber(value.maxPower, `${label}.maxPower`) }),
    ...(value.legendaryOnly === true ? { legendaryOnly: true } : {}),
    ...(value.nonbasicOnly === true ? { nonbasicOnly: true } : {}),
    ...(value.excludeSource === true ? { excludeSource: true } : {}),
  };
}

function parseTargetRequirements(value: unknown, label: string): TargetRequirement[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseTargetRequirement(entry, `${label}[${index}]`));
}

function parseCardIdSelector(value: unknown, label: string): CardIdSelector {
  if (typeof value === "string") {
    return expectString(value, label);
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  if (expectString(value.type, `${label}.type`) !== "chosen") {
    throw new Error(`Invalid ${label}.type`);
  }
  const index = expectNumber(value.index, `${label}.index`);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid ${label}.index`);
  }
  return { type: "chosen", index };
}

function parsePlayerSelector(value: unknown, label: string): PlayerSelector {
  if (typeof value === "string") {
    return expectString(value, label);
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const type = expectString(value.type, `${label}.type`);
  if (type === "subject_player") {
    return { type };
  }
  if (type !== "chosen" && type !== "chosen_controller") {
    throw new Error(`Invalid ${label}.type`);
  }
  const index = expectNumber(value.index, `${label}.index`);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid ${label}.index`);
  }
  return { type, index };
}

function parsePartialMana(value: unknown, label: string): Partial<ManaPool> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const mana: Partial<ManaPool> = {};
  for (const key of MANA_KEYS) {
    if (value[key] !== undefined) {
      mana[key] = expectNumber(value[key], `${label}.${key}`);
    }
  }
  return mana;
}

function parseCardEffect(value: unknown, label: string): CardEffect {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  switch (kind) {
    case "gain_life":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount:
          value.amount === "subject_amount" || value.amount === "subject_toughness"
            ? value.amount
            : expectNumber(value.amount, `${label}.amount`),
      };
    case "lose_life":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount:
          value.amount === "subject_amount"
            ? "subject_amount"
            : expectNumber(value.amount, `${label}.amount`),
      };
    case "draw":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        ...(value.optional === true ? { optional: true } : {}),
      };
    case "scry":
    case "surveil":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "discard_unless_attacked":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "amass":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount: expectNumber(value.amount, `${label}.amount`),
        ...(value.subtype === undefined
          ? {}
          : { subtype: expectString(value.subtype, `${label}.subtype`) }),
      };
    case "look_and_assign":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        destinations: parseLookDestinations(value.destinations, `${label}.destinations`),
      };
    case "reveal_zone":
      return {
        kind,
        fromPlayerId: parsePlayerSelector(value.fromPlayerId, `${label}.fromPlayerId`),
        toPlayerId: parsePlayerSelector(value.toPlayerId, `${label}.toPlayerId`),
        zone: "hand",
      };
    case "choose_card":
      return {
        kind,
        chooserId: parsePlayerSelector(value.chooserId, `${label}.chooserId`),
        sources: parseChooseCardSources(value.sources, `${label}.sources`),
        thenEffects: parseCardEffects(value.thenEffects, `${label}.thenEffects`),
      };
    case "add_mana":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        mana: parsePartialMana(value.mana, `${label}.mana`),
      };
    case "deal_damage": {
      if (!isRecord(value.target)) {
        throw new Error(`Invalid ${label}.target`);
      }
      const targetType = expectString(value.target.type, `${label}.target.type`);
      const sourceId = value.sourceId;
      if (sourceId !== null && sourceId !== "self" && typeof sourceId !== "string") {
        throw new Error(`Invalid ${label}.sourceId`);
      }
      const amount =
        value.amount === "x"
          ? ("x" as const)
          : value.amount === "sacrificed_power"
            ? ("sacrificed_power" as const)
            : expectNumber(value.amount, `${label}.amount`);
      if (targetType === "player") {
        return {
          kind,
          amount,
          sourceId,
          target: {
            type: "player",
            playerId: parsePlayerSelector(value.target.playerId, `${label}.target.playerId`),
          },
        };
      }
      if (targetType === "creature") {
        return {
          kind,
          amount,
          sourceId,
          target: {
            type: "creature",
            cardId: expectString(value.target.cardId, `${label}.target.cardId`),
          },
        };
      }
      if (targetType === "chosen") {
        const index = expectNumber(value.target.index, `${label}.target.index`);
        if (!Number.isInteger(index) || index < 0) {
          throw new Error(`Invalid ${label}.target.index`);
        }
        return {
          kind,
          amount,
          sourceId,
          target: { type: "chosen", index },
        };
      }
      throw new Error(`Invalid ${label}.target.type`);
    }
    case "divided_damage": {
      const sourceId = value.sourceId;
      if (sourceId !== null && sourceId !== "self" && typeof sourceId !== "string") {
        throw new Error(`Invalid ${label}.sourceId`);
      }
      return {
        kind,
        sourceId,
        amount:
          value.amount === "x" ? ("x" as const) : expectNumber(value.amount, `${label}.amount`),
      };
    }
    case "create_token":
      return {
        kind,
        ownerId: parsePlayerSelector(value.ownerId, `${label}.ownerId`),
        name: expectString(value.name, `${label}.name`),
        typeLine: expectString(value.typeLine, `${label}.typeLine`),
        power: value.power === undefined || value.power === null ? null : expectNumber(value.power, `${label}.power`),
        toughness:
          value.toughness === undefined || value.toughness === null
            ? null
            : expectNumber(value.toughness, `${label}.toughness`),
        ...(value.keywords === undefined
          ? {}
          : { keywords: parseKeywords(value.keywords, `${label}.keywords`) }),
      };
    case "move_card": {
      const toZone = expectString(value.toZone, `${label}.toZone`);
      if (toZone === "stack" || !ZONE_KEYS.includes(toZone as (typeof ZONE_KEYS)[number])) {
        throw new Error(`Invalid ${label}.toZone`);
      }
      const libraryPosition = value.libraryPosition;
      if (libraryPosition !== undefined && libraryPosition !== "top" && libraryPosition !== "bottom" && libraryPosition !== "shuffled") {
        throw new Error(`Invalid ${label}.libraryPosition`);
      }
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        toZone: toZone as Exclude<ZoneName, "stack">,
        libraryPosition,
        ...(value.entersTapped === true ? { entersTapped: true } : {}),
        ...(value.gainsHaste === true ? { gainsHaste: true } : {}),
        ...(value.atEndStep === "sacrifice" || value.atEndStep === "exile"
          ? { atEndStep: value.atEndStep }
          : {}),
      };
    }
    case "tap":
    case "untap":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "mill":
    case "discard":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "sacrifice":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "add_counter":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        counter: expectString(value.counter, `${label}.counter`),
        amount: expectNumber(value.amount, `${label}.amount`),
      };
    case "copy_subject_spell":
    case "counter_subject_spell":
    case "extra_combat":
    case "fog":
    case "windfall":
      return { kind };
    case "untap_all": {
      const what = expectString(value.what, `${label}.what`);
      if (what !== "creature" && what !== "land") {
        throw new Error(`Invalid ${label}.what`);
      }
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`), what };
    }
    case "proliferate":
    case "populate":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "untap_lands_up_to":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "restrict_until_eot":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        ...(value.cantAttack === true ? { cantAttack: true } : {}),
        ...(value.cantBlock === true ? { cantBlock: true } : {}),
        ...(value.cantBeBlocked === true ? { cantBeBlocked: true } : {}),
      };
    case "counter_spell":
    case "copy_spell": {
      if (!isRecord(value.target)) {
        throw new Error(`Invalid ${label}.target`);
      }
      const targetType = expectString(value.target.type, `${label}.target.type`);
      if (targetType !== "chosen") {
        throw new Error(`Invalid ${label}.target.type`);
      }
      const index = expectNumber(value.target.index, `${label}.target.index`);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid ${label}.target.index`);
      }
      return { kind, target: { type: "chosen", index } };
    }
    case "counter_unless_pays": {
      if (!isRecord(value.target)) {
        throw new Error(`Invalid ${label}.target`);
      }
      const targetType = expectString(value.target.type, `${label}.target.type`);
      if (targetType !== "chosen") {
        throw new Error(`Invalid ${label}.target.type`);
      }
      const index = expectNumber(value.target.index, `${label}.target.index`);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid ${label}.target.index`);
      }
      return {
        kind,
        target: { type: "chosen", index },
        cost: expectString(value.cost, `${label}.cost`),
      };
    }
    case "set_class_level":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        level: expectNumber(value.level, `${label}.level`),
      };
    case "grant_dies_return":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        ...(value.counter === true ? { counter: true } : {}),
        ...(value.treasure === true ? { treasure: true } : {}),
      };
    case "pt_until_eot":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        power: expectNumber(value.power, `${label}.power`),
        toughness: expectNumber(value.toughness, `${label}.toughness`),
      };
    case "keyword_until_eot": {
      const keyword = expectString(value.keyword, `${label}.keyword`);
      if (!KEYWORDS.has(keyword as Keyword)) {
        throw new Error(`Invalid ${label}.keyword`);
      }
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        keyword: keyword as Keyword,
      };
    }
    case "team_pt_until_eot":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        power: expectNumber(value.power, `${label}.power`),
        toughness: expectNumber(value.toughness, `${label}.toughness`),
      };
    case "team_keyword_until_eot": {
      const keyword = expectString(value.keyword, `${label}.keyword`);
      if (!KEYWORDS.has(keyword as Keyword)) {
        throw new Error(`Invalid ${label}.keyword`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        keyword: keyword as Keyword,
      };
    }
    case "search_library":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        filter: parseSearchFilter(value.filter, `${label}.filter`),
        destination: parseSearchDestination(value.destination, `${label}.destination`),
        count: expectNumber(value.count, `${label}.count`),
        ...(value.entersTapped === true ? { entersTapped: true } : {}),
      };
    case "attach":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        toId:
          typeof value.toId === "string"
            ? value.toId
            : (parseCardIdSelector(value.toId, `${label}.toId`) as { type: "chosen"; index: number }),
      };
    case "transform":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "copy_token":
      return {
        kind,
        ownerId: parsePlayerSelector(value.ownerId, `${label}.ownerId`),
        ofCardId:
          typeof value.ofCardId === "string"
            ? value.ofCardId
            : (parseCardIdSelector(value.ofCardId, `${label}.ofCardId`) as {
                type: "chosen";
                index: number;
              }),
        ...(value.count === undefined
          ? {}
          : { count: expectNumber(value.count, `${label}.count`) }),
        ...(value.gainsHaste === true ? { gainsHaste: true } : {}),
        ...(value.atEndStep === "sacrifice" || value.atEndStep === "exile"
          ? { atEndStep: value.atEndStep }
          : {}),
        ...(isRecord(value.setPt)
          ? {
              setPt: {
                power: expectNumber(value.setPt.power, `${label}.setPt.power`),
                toughness: expectNumber(value.setPt.toughness, `${label}.setPt.toughness`),
              },
            }
          : {}),
      };
    case "manifest":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "counter_on_controlled_creatures":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        counter: expectString(value.counter, `${label}.counter`),
        amount: expectNumber(value.amount, `${label}.amount`),
      };
    case "counter_on_each_creature":
      return {
        kind,
        counter: expectString(value.counter, `${label}.counter`),
        amount:
          value.amount === "x" ? ("x" as const) : expectNumber(value.amount, `${label}.amount`),
      };
    case "overload_each":
      return {
        kind,
        requirement: parseTargetRequirement(value.requirement, `${label}.requirement`),
        effects: parseCardEffects(value.effects, `${label}.effects`),
      };
    case "destroy_all":
      return {
        kind,
        what: parseDestroyAllScope(value.what, `${label}.what`),
        ...(value.maxManaValue === undefined
          ? {}
          : { maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`) }),
      };
    case "unless_pays":
    case "may_pay":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        cost: expectString(value.cost, `${label}.cost`),
        effects: parseCardEffects(value.effects, `${label}.effects`),
      };
    case "damage_all":
      return {
        kind,
        sourceId:
          value.sourceId === null
            ? null
            : value.sourceId === "self"
              ? "self"
              : expectString(value.sourceId, `${label}.sourceId`),
        amount: value.amount === "x" ? "x" : expectNumber(value.amount, `${label}.amount`),
        ...(value.includePlayers === true ? { includePlayers: true } : {}),
      };
    case "flicker":
      return { kind, cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) };
    case "exile_graveyard":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    default:
      throw new Error(`Unknown effect kind ${kind}`);
  }
}

function parseCounters(value: unknown, label: string): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const counters: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    counters[key] = expectNumber(amount, `${label}.${key}`);
  }
  return counters;
}

function parseCardLayout(value: unknown, label: string): "modal_dfc" | "transform" {
  const layout = expectString(value, label);
  if (layout !== "modal_dfc" && layout !== "transform") {
    throw new Error(`Invalid ${label}`);
  }
  return layout;
}

function parseKeywords(value: unknown, label: string): Keyword[] {
  if (value === undefined) {
    return [];
  }
  const keywords = expectStringArray(value, label);
  for (const keyword of keywords) {
    if (!KEYWORDS.has(keyword as Keyword)) {
      throw new Error(`Invalid ${label} keyword ${keyword}`);
    }
  }
  return keywords as Keyword[];
}

function parseActivatedAbilities(value: unknown, label: string): ActivatedAbility[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return {
      tap: entry.tap === true,
      manaCost: expectString(entry.manaCost, `${label}[${index}].manaCost`, true),
      effects: parseCardEffects(entry.effects, `${label}[${index}].effects`),
      targetRequirements: parseTargetRequirements(
        entry.targetRequirements,
        `${label}[${index}].targetRequirements`,
      ),
      ...(entry.zone === "hand" ? { zone: "hand" as const } : {}),
      ...(entry.discard === true ? { discard: true } : {}),
      ...(entry.sacrificeSelf === true ? { sacrificeSelf: true } : {}),
      ...(entry.sacrificeCost === undefined
        ? {}
        : {
            sacrificeCost: (() => {
              const scope = expectString(entry.sacrificeCost, `${label}[${index}].sacrificeCost`);
              if (
                scope !== "creature" &&
                scope !== "artifact" &&
                scope !== "creature_or_artifact" &&
                scope !== "land"
              ) {
                throw new Error(`Invalid ${label}[${index}].sacrificeCost`);
              }
              return scope;
            })(),
          }),
      ...(entry.exileSelf === true ? { exileSelf: true } : {}),
      ...(entry.lifeCost === undefined
        ? {}
        : { lifeCost: expectNumber(entry.lifeCost, `${label}[${index}].lifeCost`) }),
      ...(entry.timing === "sorcery" ? { timing: "sorcery" as const } : {}),
      ...(entry.requiresControlled === undefined
        ? {}
        : {
            requiresControlled: (() => {
              if (!isRecord(entry.requiresControlled)) {
                throw new Error(`Invalid ${label}[${index}].requiresControlled`);
              }
              const types = parseStringList(entry.requiresControlled.types, `${label}[${index}].requiresControlled.types`);
              const subtypes = parseStringList(entry.requiresControlled.subtypes, `${label}[${index}].requiresControlled.subtypes`);
              return {
                ...(types.length > 0 ? { types } : {}),
                ...(subtypes.length > 0 ? { subtypes } : {}),
              };
            })(),
          }),
    };
  });
}

function parseSpellModes(value: unknown, label: string): SpellMode[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return {
      label: expectString(entry.label, `${label}[${index}].label`),
      ...(entry.extraCost === undefined
        ? {}
        : { extraCost: expectString(entry.extraCost, `${label}[${index}].extraCost`) }),
      effects: parseCardEffects(entry.effects, `${label}[${index}].effects`),
      targetRequirements: parseTargetRequirements(
        entry.targetRequirements,
        `${label}[${index}].targetRequirements`,
      ),
    };
  });
}

function parseTriggers(value: unknown, label: string): CardTrigger[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const event = expectString(entry.event, `${label}[${index}].event`);
    if (
      event !== "enter_battlefield" &&
      event !== "begin_combat" &&
      event !== "dies" &&
      event !== "attacks" &&
      event !== "upkeep" &&
      event !== "end_step" &&
      event !== "you_gain_life" &&
      event !== "opponent_loses_life" &&
      event !== "opponent_draws" &&
      event !== "you_create_token" &&
      event !== "you_sacrifice_token" &&
      event !== "becomes_untapped" &&
      event !== "opponent_searches" &&
      event !== "cast_spell" &&
      event !== "deals_combat_damage_to_player" &&
      event !== "deals_damage_to_player"
    ) {
      throw new Error(`Invalid ${label}[${index}].event`);
    }
    const watch = entry.watch;
    if (
      watch !== undefined &&
      watch !== "self" &&
      watch !== "controlled" &&
      watch !== "opponents" &&
      watch !== "any" &&
      watch !== "attached"
    ) {
      throw new Error(`Invalid ${label}[${index}].watch`);
    }
    const subjectFilter =
      entry.subjectFilter === undefined
        ? undefined
        : (() => {
            if (!isRecord(entry.subjectFilter)) {
              throw new Error(`Invalid ${label}[${index}].subjectFilter`);
            }
            const types = parseStringList(entry.subjectFilter.types, `${label}[${index}].subjectFilter.types`);
            const subtypes = parseStringList(
              entry.subjectFilter.subtypes,
              `${label}[${index}].subjectFilter.subtypes`,
            );
            const typesAny = parseStringList(
              entry.subjectFilter.typesAny,
              `${label}[${index}].subjectFilter.typesAny`,
            );
            const nonTypes = parseStringList(
              entry.subjectFilter.nonTypes,
              `${label}[${index}].subjectFilter.nonTypes`,
            );
            return {
              ...(types.length > 0 ? { types } : {}),
              ...(subtypes.length > 0 ? { subtypes } : {}),
              ...(typesAny.length > 0 ? { typesAny } : {}),
              ...(nonTypes.length > 0 ? { nonTypes } : {}),
              ...(entry.subjectFilter.chosenSubtype === true ? { chosenSubtype: true } : {}),
              ...(entry.subjectFilter.nonToken === true ? { nonToken: true } : {}),
              ...(entry.subjectFilter.tokenOnly === true ? { tokenOnly: true } : {}),
            };
          })();
    return {
      event,
      ...(watch === undefined ? {} : { watch }),
      ...(entry.excludeSelf === true ? { excludeSelf: true } : {}),
      ...(entry.oncePerTurn === true ? { oncePerTurn: true } : {}),
      ...(entry.subjectPlayerOpponent === true ? { subjectPlayerOpponent: true } : {}),
      ...(entry.attacksAlone === true ? { attacksAlone: true } : {}),
      ...(subjectFilter &&
      (subjectFilter.types ||
        subjectFilter.subtypes ||
        subjectFilter.typesAny ||
        subjectFilter.nonTypes ||
        subjectFilter.chosenSubtype ||
        subjectFilter.nonToken ||
        subjectFilter.tokenOnly)
        ? { subjectFilter }
        : {}),
      effects: parseCardEffects(entry.effects, `${label}[${index}].effects`),
      targetRequirements: parseTargetRequirements(
        entry.targetRequirements,
        `${label}[${index}].targetRequirements`,
      ),
    };
  });
}

function parseReplacements(value: unknown, label: string): ReplacementEffect[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    const kind = expectString(entry.kind, `${label}[${index}].kind`);
    if (
      kind === "enters_tapped" ||
      kind === "graveyard_to_exile" ||
      kind === "double_tokens" ||
      kind === "double_life_gain" ||
      kind === "double_draws_except_first"
    ) {
      return { kind };
    }
    if (kind === "double_counters") {
      return {
        kind,
        ...(entry.counter === undefined
          ? {}
          : { counter: expectString(entry.counter, `${label}[${index}].counter`) }),
        ...(entry.creaturesOnly === true ? { creaturesOnly: true } : {}),
      };
    }
    if (kind === "may_pay_life_or_enter_tapped") {
      return {
        kind,
        amount: expectNumber(entry.amount, `${label}[${index}].amount`),
      };
    }
    if (kind === "enters_tapped_unless") {
      return {
        kind,
        unless: parseEnterTappedUnless(entry.unless, `${label}[${index}].unless`),
      };
    }
    if (kind === "enters_tapped_if") {
      return {
        kind,
        if: parseEnterTappedUnless(entry.if, `${label}[${index}].if`),
      };
    }
    const instead = expectString(entry.instead, `${label}[${index}].instead`);
    if (kind !== "replace_draw" || instead !== "skip") {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return { kind, instead };
  });
}

function parseEnterTappedUnless(value: unknown, label: string): EnterTappedUnless {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  if (kind === "other_lands") {
    const count = expectNumber(value.count, `${label}.count`);
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Invalid ${label}.count`);
    }
    return { kind, count };
  }
  if (kind === "basic_lands" || kind === "other_lands_at_most" || kind === "opponents") {
    const count = expectNumber(value.count, `${label}.count`);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid ${label}.count`);
    }
    return { kind, count };
  }
  if (kind === "legendary_creature") {
    return { kind };
  }
  if (kind === "controlled_types" || kind === "hand_reveals_types") {
    if (!Array.isArray(value.types) || value.types.length === 0) {
      throw new Error(`Invalid ${label}.types`);
    }
    return {
      kind,
      types: value.types.map((entry, index) => expectString(entry, `${label}.types[${index}]`)),
    };
  }
  throw new Error(`Invalid ${label}.kind`);
}

function parseStringList(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => expectString(entry, `${label}[${index}]`).toLowerCase());
}

function parseEffectSelector(value: unknown, label: string): EffectSelector {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const scope = expectString(value.scope, `${label}.scope`);
  if (scope !== "self" && scope !== "controlled" && scope !== "all" && scope !== "attached") {
    throw new Error(`Invalid ${label}.scope`);
  }
  const excludeSelf = value.excludeSelf === true;
  const types = parseStringList(value.types, `${label}.types`);
  const subtypes = parseStringList(value.subtypes, `${label}.subtypes`);
  const colors =
    value.colors === undefined
      ? []
      : (() => {
          if (!Array.isArray(value.colors)) {
            throw new Error(`Invalid ${label}.colors`);
          }
          return value.colors.map((entry, index) => {
            const color = expectString(entry, `${label}.colors[${index}]`);
            if (!(COLOR_KEYS as readonly string[]).includes(color)) {
              throw new Error(`Invalid ${label}.colors[${index}]`);
            }
            return color as Color;
          });
        })();
  return {
    scope,
    ...(types.length > 0 ? { types } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
    ...(colors.length > 0 ? { colors } : {}),
    ...(value.chosenSubtype === true ? { chosenSubtype: true } : {}),
    ...(excludeSelf ? { excludeSelf: true } : {}),
  };
}

function parseContinuousEffectData(value: unknown, label: string): ContinuousEffectData {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  if (kind === "add_types") {
    return {
      kind,
      types: parseStringList(value.types, `${label}.types`),
      subtypes: parseStringList(value.subtypes, `${label}.subtypes`),
    };
  }
  if (kind === "set_colors") {
    if (!Array.isArray(value.colors)) {
      throw new Error(`Invalid ${label}.colors`);
    }
    return {
      kind,
      colors: value.colors.map((entry, index) => {
        const color = expectString(entry, `${label}.colors[${index}]`);
        if (!(COLOR_KEYS as readonly string[]).includes(color)) {
          throw new Error(`Invalid ${label}.colors[${index}]`);
        }
        return color as Color;
      }),
    };
  }
  if (kind === "grant_keyword") {
    const keyword = expectString(value.keyword, `${label}.keyword`);
    if (!KEYWORDS.has(keyword as Keyword)) {
      throw new Error(`Invalid ${label}.keyword`);
    }
    return { kind, keyword: keyword as Keyword };
  }
  if (kind === "grant_mana_ability") {
    const parsed = parseManaAbilities([value.ability], `${label}.ability`);
    if (!parsed[0]) {
      throw new Error(`Invalid ${label}.ability`);
    }
    return { kind, ability: parsed[0] };
  }
  if (kind === "remove_all_abilities") {
    return { kind };
  }
  if (kind === "restrict") {
    return {
      kind,
      ...(value.cantAttack === true ? { cantAttack: true } : {}),
      ...(value.cantBlock === true ? { cantBlock: true } : {}),
      ...(value.cantBeBlocked === true ? { cantBeBlocked: true } : {}),
    };
  }
  if (kind === "set_pt" || kind === "modify_pt") {
    return {
      kind,
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
    };
  }
  throw new Error(`Invalid ${label}.kind`);
}

/**
 * Static abilities: current shape, plus legacy `staticModifiers` entries
 * ({kind:"pt", selector:"self"|"controlled_creatures"}) from old snapshots.
 */
function parseStaticAbilities(
  value: unknown,
  legacy: unknown,
  label: string,
): StaticAbility[] {
  const abilities: StaticAbility[] = [];
  if (value !== undefined) {
    if (!Array.isArray(value)) {
      throw new Error(`Invalid ${label}`);
    }
    for (const [index, entry] of value.entries()) {
      if (!isRecord(entry)) {
        throw new Error(`Invalid ${label}[${index}]`);
      }
      abilities.push({
        selector: parseEffectSelector(entry.selector, `${label}[${index}].selector`),
        effect: parseContinuousEffectData(entry.effect, `${label}[${index}].effect`),
      });
    }
  }
  if (legacy !== undefined && Array.isArray(legacy)) {
    for (const [index, entry] of legacy.entries()) {
      if (!isRecord(entry) || entry.kind !== "pt") {
        continue;
      }
      const selector = entry.selector;
      abilities.push({
        selector:
          selector === "controlled_creatures"
            ? { scope: "controlled", types: ["creature"] }
            : { scope: "self" },
        effect: {
          kind: "modify_pt",
          power: expectNumber(entry.power, `${label}[${index}].power`),
          toughness: expectNumber(entry.toughness, `${label}[${index}].toughness`),
        },
      });
    }
  }
  return abilities;
}

function parseProduces(value: unknown, label: string): Partial<ManaPool> {
  if (value === undefined) {
    return {};
  }
  return parsePartialMana(value, label);
}

function parseManaColor(value: unknown, label: string): ManaColor {
  const color = expectString(value, label);
  if (!MANA_KEYS.includes(color as (typeof MANA_KEYS)[number])) {
    throw new Error(`Invalid ${label}`);
  }
  return color as ManaColor;
}

function parseManaOptions(value: unknown, label: string): ManaColor[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseManaColor(entry, `${label}[${index}]`));
}

function parseManaAbilities(value: unknown, label: string): ManaAbility[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid ${label}[${index}]`);
    }
    return {
      produces: parseProduces(entry.produces, `${label}[${index}].produces`),
      producesOptions: parseManaOptions(entry.producesOptions, `${label}[${index}].producesOptions`),
      producesAnyColor: entry.producesAnyColor === true,
      damageToController:
        entry.damageToController === undefined
          ? 0
          : expectNumber(entry.damageToController, `${label}[${index}].damageToController`),
      ...(entry.count === undefined
        ? {}
        : { count: expectNumber(entry.count, `${label}[${index}].count`) }),
      ...(entry.sacrificeSelf === true ? { sacrificeSelf: true } : {}),
      ...(entry.costMana === undefined
        ? {}
        : { costMana: expectString(entry.costMana, `${label}[${index}].costMana`) }),
      ...(entry.costSacrifice === "creature" ||
      entry.costSacrifice === "artifact" ||
      entry.costSacrifice === "creature_or_artifact" ||
      entry.costSacrifice === "land"
        ? { costSacrifice: entry.costSacrifice }
        : {}),
      ...(entry.noTap === true ? { noTap: true } : {}),
      ...(entry.requiresControlled === undefined
        ? {}
        : {
            requiresControlled: (() => {
              if (!isRecord(entry.requiresControlled)) {
                throw new Error(`Invalid ${label}[${index}].requiresControlled`);
              }
              const types = parseStringList(
                entry.requiresControlled.types,
                `${label}[${index}].requiresControlled.types`,
              );
              const subtypes = parseStringList(
                entry.requiresControlled.subtypes,
                `${label}[${index}].requiresControlled.subtypes`,
              );
              return {
                ...(types.length > 0 ? { types } : {}),
                ...(subtypes.length > 0 ? { subtypes } : {}),
              };
            })(),
          }),
    };
  });
}

function parseLog(value: unknown): GameLogEntry[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid log");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid log[${index}]`);
    }
    const kind = expectString(entry.kind, `log[${index}].kind`);
    if (kind === "life_change") {
      return {
        kind,
        playerId: expectString(entry.playerId, `log[${index}].playerId`),
        delta: expectNumber(entry.delta, `log[${index}].delta`),
      };
    }
    if (kind === "override") {
      return {
        kind,
        playerId: expectString(entry.playerId, `log[${index}].playerId`),
        summary: expectString(entry.summary, `log[${index}].summary`),
      };
    }
    if (kind === "die_roll") {
      return {
        kind,
        playerId: expectString(entry.playerId, `log[${index}].playerId`),
        sides: expectNumber(entry.sides, `log[${index}].sides`),
        result: expectNumber(entry.result, `log[${index}].result`),
      };
    }
    if (kind === "opening_tie") {
      return {
        kind,
        playerIds: expectStringArray(entry.playerIds, `log[${index}].playerIds`),
      };
    }
    if (kind === "first_player") {
      return {
        kind,
        playerId: expectString(entry.playerId, `log[${index}].playerId`),
      };
    }
    if (kind === "creature_type_chosen") {
      return {
        kind,
        cardId: expectString(entry.cardId, `log[${index}].cardId`),
        creatureType: expectString(entry.creatureType, `log[${index}].creatureType`),
      };
    }
    if (kind !== "zone_change") {
      throw new Error(`Invalid log[${index}].kind`);
    }
    const from = expectString(entry.from, `log[${index}].from`);
    const to = expectString(entry.to, `log[${index}].to`);
    if (!ZONE_KEYS.includes(from as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid log[${index}].from`);
    }
    if (!ZONE_KEYS.includes(to as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid log[${index}].to`);
    }
    return {
      kind,
      cardId: expectString(entry.cardId, `log[${index}].cardId`),
      from: from as ZoneName,
      to: to as ZoneName,
    };
  });
}

function parseCardEffects(value: unknown, label: string): CardEffect[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseCardEffect(entry, `${label}[${index}]`));
}

function parseGameEffects(value: unknown, label: string): GameEffect[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry, index) => parseGameEffect(entry, `${label}[${index}]`));
}

function parseGameEffect(value: unknown, label: string): GameEffect {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const kind = expectString(value.kind, `${label}.kind`);
  if (kind === "draw") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
      ...(value.optional === true ? { optional: true } : {}),
      ...(value.turnDraw === true ? { turnDraw: true } : {}),
    };
  }
  if (kind === "scry" || kind === "surveil" || kind === "mill" || kind === "discard") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
    };
  }
  if (kind === "gain_life" || kind === "lose_life") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "add_mana") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      mana: parsePartialMana(value.mana, `${label}.mana`),
    };
  }
  if (kind === "pt_until_eot") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
    };
  }
  if (kind === "keyword_until_eot") {
    const keyword = expectString(value.keyword, `${label}.keyword`);
    if (!KEYWORDS.has(keyword as Keyword)) {
      throw new Error(`Invalid ${label}.keyword`);
    }
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      keyword: keyword as Keyword,
    };
  }
  if (kind === "team_pt_until_eot") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
    };
  }
  if (kind === "team_keyword_until_eot") {
    const keyword = expectString(value.keyword, `${label}.keyword`);
    if (!KEYWORDS.has(keyword as Keyword)) {
      throw new Error(`Invalid ${label}.keyword`);
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      keyword: keyword as Keyword,
    };
  }
  if (kind === "search_library") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      filter: parseSearchFilter(value.filter, `${label}.filter`),
      destination: parseSearchDestination(value.destination, `${label}.destination`),
      count: expectNumber(value.count, `${label}.count`),
      ...(value.entersTapped === true ? { entersTapped: true } : {}),
    };
  }
  if (kind === "attach") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      toId: expectString(value.toId, `${label}.toId`),
    };
  }
  if (kind === "transform") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "copy_token") {
    return {
      kind,
      ownerId: expectString(value.ownerId, `${label}.ownerId`),
      ofCardId: expectString(value.ofCardId, `${label}.ofCardId`),
      ...(value.count === undefined
        ? {}
        : { count: expectNumber(value.count, `${label}.count`) }),
      ...(value.gainsHaste === true ? { gainsHaste: true } : {}),
      ...(value.atEndStep === "sacrifice" || value.atEndStep === "exile"
        ? { atEndStep: value.atEndStep }
        : {}),
      ...(isRecord(value.setPt)
        ? {
            setPt: {
              power: expectNumber(value.setPt.power, `${label}.setPt.power`),
              toughness: expectNumber(value.setPt.toughness, `${label}.setPt.toughness`),
            },
          }
        : {}),
    };
  }
  if (kind === "manifest") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
    };
  }
  if (kind === "counter_on_controlled_creatures") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      counter: expectString(value.counter, `${label}.counter`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "counter_on_each_creature") {
    return {
      kind,
      counter: expectString(value.counter, `${label}.counter`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "overload_each") {
    return {
      kind,
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      sourceId:
        value.sourceId === null ? null : expectString(value.sourceId, `${label}.sourceId`),
      requirement: parseTargetRequirement(value.requirement, `${label}.requirement`),
      effects: parseCardEffects(value.effects, `${label}.effects`),
    };
  }
  if (kind === "destroy_all") {
    return {
      kind,
      what: parseDestroyAllScope(value.what, `${label}.what`),
      ...(value.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`) }),
    };
  }
  if (kind === "unless_pays" || kind === "may_pay") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cost: expectString(value.cost, `${label}.cost`),
      effects: parseGameEffects(value.effects, `${label}.effects`),
    };
  }
  if (kind === "damage_all") {
    return {
      kind,
      sourceId: value.sourceId === null ? null : expectString(value.sourceId, `${label}.sourceId`),
      amount: expectNumber(value.amount, `${label}.amount`),
      ...(value.includePlayers === true ? { includePlayers: true } : {}),
    };
  }
  if (kind === "flicker") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "exile_graveyard") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "move_card") {
    const toZone = expectString(value.toZone, `${label}.toZone`);
    if (toZone === "stack" || !ZONE_KEYS.includes(toZone as (typeof ZONE_KEYS)[number])) {
      throw new Error(`Invalid ${label}.toZone`);
    }
    const libraryPosition = value.libraryPosition;
    if (libraryPosition !== undefined && libraryPosition !== "top" && libraryPosition !== "bottom" && libraryPosition !== "shuffled") {
      throw new Error(`Invalid ${label}.libraryPosition`);
    }
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      toZone: toZone as Exclude<ZoneName, "stack">,
      ...(libraryPosition === undefined ? {} : { libraryPosition }),
      ...(value.entersTapped === true ? { entersTapped: true } : {}),
      ...(value.gainsHaste === true ? { gainsHaste: true } : {}),
      ...(value.atEndStep === "sacrifice" || value.atEndStep === "exile"
        ? { atEndStep: value.atEndStep }
        : {}),
    };
  }
  if (kind === "tap" || kind === "untap" || kind === "sacrifice") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "add_counter") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      counter: expectString(value.counter, `${label}.counter`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "set_class_level") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      level: expectNumber(value.level, `${label}.level`),
    };
  }
  if (kind === "grant_dies_return") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      ...(value.counter === true ? { counter: true } : {}),
      ...(value.treasure === true ? { treasure: true } : {}),
    };
  }
  if (kind === "counter_spell") {
    return { kind, stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`) };
  }
  if (kind === "copy_spell") {
    return {
      kind,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
    };
  }
  if (kind === "extra_combat" || kind === "fog" || kind === "windfall") {
    return { kind };
  }
  if (kind === "untap_all") {
    const what = expectString(value.what, `${label}.what`);
    if (what !== "creature" && what !== "land") {
      throw new Error(`Invalid ${label}.what`);
    }
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`), what };
  }
  if (kind === "proliferate" || kind === "populate") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "untap_lands_up_to") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
    };
  }
  if (kind === "restrict_until_eot") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      ...(value.cantAttack === true ? { cantAttack: true } : {}),
      ...(value.cantBlock === true ? { cantBlock: true } : {}),
      ...(value.cantBeBlocked === true ? { cantBeBlocked: true } : {}),
    };
  }
  if (kind === "counter_unless_pays") {
    return {
      kind,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
      cost: expectString(value.cost, `${label}.cost`),
    };
  }
  if (kind === "discard_unless_attacked") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
    };
  }
  if (kind === "amass") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      amount: expectNumber(value.amount, `${label}.amount`),
      ...(value.subtype === undefined
        ? {}
        : { subtype: expectString(value.subtype, `${label}.subtype`) }),
    };
  }
  if (kind === "create_token") {
    return {
      kind,
      ownerId: expectString(value.ownerId, `${label}.ownerId`),
      name: expectString(value.name, `${label}.name`),
      typeLine: expectString(value.typeLine, `${label}.typeLine`),
      power:
        value.power === undefined || value.power === null
          ? null
          : expectNumber(value.power, `${label}.power`),
      toughness:
        value.toughness === undefined || value.toughness === null
          ? null
          : expectNumber(value.toughness, `${label}.toughness`),
      ...(value.keywords === undefined
        ? {}
        : { keywords: parseKeywords(value.keywords, `${label}.keywords`) }),
    };
  }
  if (kind === "deal_damage") {
    const target = value.target;
    if (!isRecord(target)) {
      throw new Error(`Invalid ${label}.target`);
    }
    const targetType = expectString(target.type, `${label}.target.type`);
    if (targetType !== "player" && targetType !== "creature") {
      throw new Error(`Invalid ${label}.target.type`);
    }
    return {
      kind,
      sourceId:
        value.sourceId === null || value.sourceId === undefined
          ? null
          : expectString(value.sourceId, `${label}.sourceId`),
      amount: expectNumber(value.amount, `${label}.amount`),
      target:
        targetType === "player"
          ? { type: "player", playerId: expectString(target.playerId, `${label}.target.playerId`) }
          : { type: "creature", cardId: expectString(target.cardId, `${label}.target.cardId`) },
    };
  }
  if (kind === "reveal_zone") {
    if (value.zone !== "hand") {
      throw new Error(`Invalid ${label}.zone`);
    }
    return {
      kind,
      fromPlayerId: expectString(value.fromPlayerId, `${label}.fromPlayerId`),
      toPlayerId: expectString(value.toPlayerId, `${label}.toPlayerId`),
      zone: "hand",
    };
  }
  if (kind === "choose_card") {
    if (!Array.isArray(value.sources)) {
      throw new Error(`Invalid ${label}.sources`);
    }
    return {
      kind,
      chooserId: expectString(value.chooserId, `${label}.chooserId`),
      sources: value.sources.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Invalid ${label}.sources[${index}]`);
        }
        const zone = expectString(entry.zone, `${label}.sources[${index}].zone`);
        if (zone !== "hand" && zone !== "graveyard" && zone !== "battlefield") {
          throw new Error(`Invalid ${label}.sources[${index}].zone`);
        }
        return {
          playerId: expectString(entry.playerId, `${label}.sources[${index}].playerId`),
          zone,
          filter: parseCardFilter(entry.filter, `${label}.sources[${index}].filter`),
        };
      }),
      thenEffects: parseCardEffects(value.thenEffects, `${label}.thenEffects`),
      sourceId:
        value.sourceId === undefined || value.sourceId === null
          ? null
          : expectString(value.sourceId, `${label}.sourceId`),
    };
  }
  if (kind === "look_and_assign") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
      destinations: parseLookDestinations(value.destinations, `${label}.destinations`),
    };
  }
  throw new Error(`Unsupported resume effect ${kind}`);
}

function parseCombat(value: unknown): GameState["combat"] {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid combat");
  }
  if (!Array.isArray(value.attacks) || !isRecord(value.blockers)) {
    throw new Error("Invalid combat attacks/blockers");
  }
  const attacks = value.attacks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid combat attack ${index}`);
    }
    return {
      attackerId: expectString(entry.attackerId, "combat.attackerId"),
      defenderId: expectString(entry.defenderId, "combat.defenderId"),
    };
  });
  const blockers: Record<string, string[]> = {};
  for (const [attackerId, list] of Object.entries(value.blockers)) {
    blockers[attackerId] = expectStringArray(list, `combat.blockers.${attackerId}`);
  }
  return {
    attacks,
    blockers,
    attackersDeclared: value.attackersDeclared === true,
    declaredBlockersFor: expectStringArray(
      value.declaredBlockersFor ?? [],
      "combat.declaredBlockersFor",
    ),
  };
}

export function serializeGameAction(action: GameAction): string {
  return JSON.stringify(action);
}

export function parseGameAction(json: string): GameAction {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) {
    throw new Error("Invalid GameAction");
  }
  const kind = expectString(raw.kind, "action.kind");
  const playerId = expectString(raw.playerId, "action.playerId");
  if (
    kind === "pass_priority" ||
    kind === "concede" ||
    kind === "keep_hand" ||
    kind === "mulligan" ||
    kind === "undo" ||
    kind === "opening_roll" ||
    kind === "advance_step" ||
    kind === "advance_turn"
  ) {
    return { kind, playerId };
  }
  if (kind === "roll_die") {
    return {
      kind,
      playerId,
      sides: raw.sides === undefined ? 20 : expectNumber(raw.sides, "action.sides"),
    };
  }
  if (kind === "play_land") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
      ...(raw.faceIndex === undefined
        ? {}
        : { faceIndex: expectNumber(raw.faceIndex, "action.faceIndex") }),
    };
  }
  if (kind === "cast_spell") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
      ...(raw.targets === undefined
        ? {}
        : { targets: parseChosenTargets(raw.targets, "action.targets") }),
      ...(raw.faceIndex === undefined
        ? {}
        : { faceIndex: expectNumber(raw.faceIndex, "action.faceIndex") }),
      ...(raw.modeIndex === undefined
        ? {}
        : { modeIndex: expectNumber(raw.modeIndex, "action.modeIndex") }),
      ...(raw.modeIndexes === undefined
        ? {}
        : {
            modeIndexes: (() => {
              if (!Array.isArray(raw.modeIndexes)) {
                throw new Error("Invalid action.modeIndexes");
              }
              return raw.modeIndexes.map((value, i) =>
                expectNumber(value, `action.modeIndexes[${i}]`),
              );
            })(),
          }),
      ...(raw.xValue === undefined
        ? {}
        : { xValue: expectNumber(raw.xValue, "action.xValue") }),
      ...(raw.division === undefined
        ? {}
        : {
            division: (() => {
              if (!Array.isArray(raw.division)) {
                throw new Error("Invalid action.division");
              }
              return raw.division.map((entry, index) =>
                expectNumber(entry, `action.division[${index}]`),
              );
            })(),
          }),
      ...(raw.costSacrificeId === undefined
        ? {}
        : { costSacrificeId: expectString(raw.costSacrificeId, "action.costSacrificeId") }),
      ...(raw.costDiscardIds === undefined
        ? {}
        : {
            costDiscardIds: (() => {
              if (!Array.isArray(raw.costDiscardIds)) {
                throw new Error("Invalid action.costDiscardIds");
              }
              return raw.costDiscardIds.map((entry, index) =>
                expectString(entry, `action.costDiscardIds[${index}]`),
              );
            })(),
          }),
    };
  }
  if (kind === "declare_attackers") {
    if (!Array.isArray(raw.attacks)) {
      throw new Error("Invalid declare_attackers attacks");
    }
    return {
      kind,
      playerId,
      attacks: raw.attacks.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Invalid attack ${index}`);
        }
        return {
          attackerId: expectString(entry.attackerId, "attack.attackerId"),
          defenderId: expectString(entry.defenderId, "attack.defenderId"),
        };
      }),
    };
  }
  if (kind === "declare_blockers") {
    if (!Array.isArray(raw.blocks)) {
      throw new Error("Invalid declare_blockers blocks");
    }
    return {
      kind,
      playerId,
      blocks: raw.blocks.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Invalid block ${index}`);
        }
        return {
          blockerId: expectString(entry.blockerId, "block.blockerId"),
          attackerId: expectString(entry.attackerId, "block.attackerId"),
        };
      }),
    };
  }
  if (kind === "tap_for_mana") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
      ...(raw.color === undefined
        ? {}
        : { color: parseManaColor(raw.color, "action.color") }),
      ...(raw.manaIndex === undefined
        ? {}
        : { manaIndex: expectNumber(raw.manaIndex, "action.manaIndex") }),
      ...(raw.costSacrificeId === undefined
        ? {}
        : { costSacrificeId: expectString(raw.costSacrificeId, "action.costSacrificeId") }),
    };
  }
  if (kind === "activate_ability" || kind === "activate_loyalty") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
      abilityIndex: expectNumber(raw.abilityIndex, "action.abilityIndex"),
      ...(raw.targets === undefined
        ? {}
        : { targets: parseChosenTargets(raw.targets, "action.targets") }),
      ...(raw.costSacrificeId === undefined
        ? {}
        : { costSacrificeId: expectString(raw.costSacrificeId, "action.costSacrificeId") }),
    };
  }
  if (kind === "choose_targets") {
    return {
      kind,
      playerId,
      targets: parseChosenTargets(raw.targets, "action.targets"),
    };
  }
  if (kind === "choose_enter_replacement") {
    return {
      kind,
      playerId,
      pay: raw.pay === true,
    };
  }
  if (kind === "resolve_creature_type") {
    return {
      kind,
      playerId,
      creatureType: expectString(raw.creatureType, "action.creatureType"),
    };
  }
  if (kind === "resolve_order_triggers") {
    if (!Array.isArray(raw.order)) {
      throw new Error("Invalid action.order");
    }
    return {
      kind,
      playerId,
      order: raw.order.map((entry, index) => expectNumber(entry, `action.order[${index}]`)),
    };
  }
  if (kind === "resolve_scry") {
    return {
      kind,
      playerId,
      bottomIds: expectStringArray(raw.bottomIds, "action.bottomIds") as CardInstanceId[],
    };
  }
  if (kind === "resolve_surveil") {
    return {
      kind,
      playerId,
      graveyardIds: expectStringArray(raw.graveyardIds, "action.graveyardIds") as CardInstanceId[],
    };
  }
  if (kind === "resolve_discard") {
    return {
      kind,
      playerId,
      cardIds: expectStringArray(raw.cardIds, "action.cardIds") as CardInstanceId[],
    };
  }
  if (kind === "resolve_choose_card") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
    };
  }
  if (kind === "turn_face_up") {
    return {
      kind,
      playerId,
      cardId: expectString(raw.cardId, "action.cardId"),
    };
  }
  if (kind === "resolve_search") {
    return {
      kind,
      playerId,
      cardIds: expectStringArray(raw.cardIds, "action.cardIds") as CardInstanceId[],
    };
  }
  if (kind === "resolve_pay") {
    const taps =
      raw.taps === undefined
        ? undefined
        : (() => {
            if (!Array.isArray(raw.taps)) {
              throw new Error("Invalid action.taps");
            }
            return raw.taps.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid action.taps[${index}]`);
              }
              return {
                cardId: expectString(entry.cardId, `action.taps[${index}].cardId`),
                ...(entry.color === undefined
                  ? {}
                  : { color: parseManaColor(entry.color, `action.taps[${index}].color`) }),
                ...(entry.manaIndex === undefined
                  ? {}
                  : { manaIndex: expectNumber(entry.manaIndex, `action.taps[${index}].manaIndex`) }),
              };
            });
          })();
    return {
      kind,
      playerId,
      pay: raw.pay === true,
      ...(taps ? { taps } : {}),
    };
  }
  if (kind === "resolve_look_assign") {
    if (!Array.isArray(raw.assignments)) {
      throw new Error("Invalid action.assignments");
    }
    return {
      kind,
      playerId,
      assignments: raw.assignments.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`Invalid action.assignments[${index}]`);
        }
        const destination = expectString(entry.destination, `action.assignments[${index}].destination`);
        if (destination !== "hand" && destination !== "library_bottom" && destination !== "exile") {
          throw new Error(`Invalid action.assignments[${index}].destination`);
        }
        return {
          cardId: expectString(entry.cardId, `action.assignments[${index}].cardId`),
          destination,
        };
      }),
    };
  }
  if (kind === "bottom_cards") {
    return {
      kind,
      playerId,
      cardIds: expectStringArray(raw.cardIds, "action.cardIds") as CardInstanceId[],
    };
  }
  if (kind === "manual_override") {
    return {
      kind,
      playerId,
      change: parseManualOverrideChange(raw.change, "action.change"),
    };
  }
  throw new Error(`Unknown GameAction kind ${kind}`);
}

const OVERRIDE_MOVE_ZONES = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
] as const;

function parseManualOverrideChange(value: unknown, label: string): ManualOverrideChange {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const type = expectString(value.type, `${label}.type`);
  if (type === "adjust_life") {
    return {
      type,
      targetPlayerId: expectString(value.targetPlayerId, `${label}.targetPlayerId`),
      delta: expectNumber(value.delta, `${label}.delta`),
    };
  }
  if (type === "draw" || type === "mill") {
    return {
      type,
      targetPlayerId: expectString(value.targetPlayerId, `${label}.targetPlayerId`),
      count: expectNumber(value.count, `${label}.count`),
    };
  }
  if (type === "add_mana") {
    return {
      type,
      targetPlayerId: expectString(value.targetPlayerId, `${label}.targetPlayerId`),
      color: parseManaColor(value.color, `${label}.color`),
    };
  }
  if (type === "move_card") {
    const toZone = expectString(value.toZone, `${label}.toZone`);
    if (!OVERRIDE_MOVE_ZONES.includes(toZone as (typeof OVERRIDE_MOVE_ZONES)[number])) {
      throw new Error(`Invalid ${label}.toZone`);
    }
    return {
      type,
      cardId: expectString(value.cardId, `${label}.cardId`),
      toZone: toZone as (typeof OVERRIDE_MOVE_ZONES)[number],
    };
  }
  if (type === "set_tapped") {
    if (typeof value.tapped !== "boolean") {
      throw new Error(`Invalid ${label}.tapped`);
    }
    return {
      type,
      cardId: expectString(value.cardId, `${label}.cardId`),
      tapped: value.tapped,
    };
  }
  if (type === "discard_hand") {
    return { type };
  }
  if (type === "create_token") {
    return { type, template: parseTokenTemplate(value.template, `${label}.template`) };
  }
  throw new Error(`Unknown override type ${type}`);
}

export function serializeGameEvent(event: GameEvent): string {
  return JSON.stringify(event);
}

export function parseGameEvent(json: string): GameEvent {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) {
    throw new Error("Invalid GameEvent");
  }
  const kind = expectString(raw.kind, "event.kind");
  if (kind === "game_created") {
    return { kind, gameId: expectString(raw.gameId, "event.gameId") };
  }
  if (kind === "priority_passed" || kind === "player_conceded") {
    return { kind, playerId: expectString(raw.playerId, "event.playerId") };
  }
  throw new Error(`Unknown GameEvent kind ${kind}`);
}
