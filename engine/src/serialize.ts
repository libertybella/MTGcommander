import { deriveCharacteristics } from "./characteristics";
import { IMPLEMENTED_KEYWORDS } from "./keywordCatalog";
import type {
  CardDefinition,
  ProtectionFrom,
  ActivatedAbility,
  BoundChooseCardSource,
  CardEffect,
  CardFilter,
  Color,
  AdditionalCastCost,
  ContinuousEffect,
  ContinuousEffectData,
  ControlledGate,
  EffectSelector,
  CardIdSelector,
  CardInstanceId,
  CardTrigger,
  ChooseCardSource,
  ChosenTarget,
  ControlAllScope,
  TriggerCondition,
  DestroyAllScope,
  DynamicCount,
  EnterTappedUnless,
  GameAction,
  GameEffect,
  GameEvent,
  GameLogEntry,
  GameState,
  LibraryPosition,
  LookDestination,
  ManualOverrideChange,
  Keyword,
  ManaAbility,
  ManaColor,
  ManaRestriction,
  ManaRider,
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
  TargetKind,
  TargetRequirement,
  TokenTemplate,
  TriggerCandidate,
  TriggerEvent,
  ZoneName,
  ZoneReveal,
} from "./types";

/**
 * The keywords a saved state may name, DERIVED from the implemented
 * catalogue rather than listed again. `IMPLEMENTED_KEYWORDS` is a total
 * `Record<Keyword, string>`, so a new union member is a tsc error there and
 * this set follows for free.
 *
 * This was the sixth hand-written copy of the keyword list in the codebase,
 * and the drift it caused was the expensive kind: a definition holding a
 * keyword missing from here compiles with no notes and then cannot LOAD, so
 * a saved table containing it cannot be reopened.
 */
const KEYWORDS = new Set<Keyword>(Object.keys(IMPLEMENTED_KEYWORDS) as Keyword[]);

/**
 * The counted nouns a `modify_pt.per` may name. Written as a total record so
 * that adding a `DynamicCount` without listing it here is a tsc error: this
 * guard had drifted to seven of the union's thirteen, and a state holding Kor
 * Spiritdancer's `auras_attached_to_it` therefore failed to deserialize.
 */
const DYNAMIC_COUNT_KEYS: Record<Extract<DynamicCount, string>, true> = {
  times_it_has_attacked_this_turn: true,
  lands_you_control: true,
  creatures_you_control: true,
  artifacts_you_control: true,
  enchantments_you_control: true,
  artifacts_and_enchantments_you_control: true,
  cards_in_your_hand: true,
  cards_in_your_graveyard: true,
  creature_cards_in_your_graveyard: true,
  colors_among_permanents_you_control: true,
  colorless_creatures_you_control: true,
  creatures_you_control_with_a_counter: true,
  auras_attached_to_it: true,
  auras_and_equipment_attached_to_it: true,
  creatures_and_enchantments_you_control: true,
  auras_you_control_attached_to_a_creature: true,
  legendary_creatures_you_control: true,
  attacking_creatures_you_control: true,
  other_creatures_you_control: true,
  attacking_creatures: true,
  permanents_you_control: true,
  plains_you_control: true,
  islands_you_control: true,
  swamps_you_control: true,
  mountains_you_control: true,
  forests_you_control: true,
  cards_drawn_this_turn: true,
  creatures_sharing_a_type_with_it: true,
  attacking_creatures_sharing_a_type_with_it: true,
};

function isControlledSubtypeCount(
  value: unknown,
): value is Extract<DynamicCount, { kind: "controlled_subtype" }> {
  return (
    isRecord(value) &&
    value.kind === "controlled_subtype" &&
    typeof value.subtype === "string" &&
    (value.excludeSelf === undefined || typeof value.excludeSelf === "boolean")
  );
}

function isDynamicCount(value: unknown): value is DynamicCount {
  return (
    (typeof value === "string" && Object.hasOwn(DYNAMIC_COUNT_KEYS, value)) ||
    isControlledSubtypeCount(value)
  );
}

/** Rebuild a DynamicCount value, string or the one object form. */
function copyDynamicCount(value: Extract<DynamicCount, object>): DynamicCount {
  return {
    kind: "controlled_subtype",
    subtype: value.subtype,
    ...(value.excludeSelf ? { excludeSelf: true } : {}),
  };
}

const MANA_KEYS = ["W", "U", "B", "R", "G", "C"] as const;
const COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;

/**
 * An "as an additional cost" clause. Recursive by one level: an either-or
 * cost carries its branches in `alternatives`, and each branch is an ordinary
 * cost, so the same parser reads both.
 */
function parseAdditionalCost(value: unknown, label: string): AdditionalCastCost {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const sacrifice = value.sacrifice;
  if (
    sacrifice !== undefined &&
    sacrifice !== "creature" &&
    sacrifice !== "artifact" &&
    sacrifice !== "creature_or_artifact" &&
    sacrifice !== "land"
  ) {
    throw new Error(`Invalid ${label}.sacrifice`);
  }
  const sacrificeColor = value.sacrificeColor;
  if (
    sacrificeColor !== undefined &&
    !COLOR_KEYS.includes(sacrificeColor as (typeof COLOR_KEYS)[number])
  ) {
    throw new Error(`Invalid ${label}.sacrificeColor`);
  }
  return {
    ...(sacrifice === undefined ? {} : { sacrifice }),
    ...(sacrificeColor === undefined
      ? {}
      : { sacrificeColor: sacrificeColor as Color }),
    ...(value.discard === undefined
      ? {}
      : { discard: expectNumber(value.discard, `${label}.discard`) }),
    ...(value.life === undefined ? {} : { life: expectNumber(value.life, `${label}.life`) }),
    ...(value.mana === undefined ? {} : { mana: expectString(value.mana, `${label}.mana`) }),
    ...(value.lifeX === true ? { lifeX: true } : {}),
    ...(value.alternatives === undefined
      ? {}
      : {
          alternatives: (Array.isArray(value.alternatives)
            ? value.alternatives
            : (() => {
                throw new Error(`Invalid ${label}.alternatives`);
              })()
          ).map((entry, index) => parseAdditionalCost(entry, `${label}.alternatives[${index}]`)),
        }),
  };
}

/** A "spend this mana only to …" filter. */
function parseManaRestriction(value: unknown, label: string): ManaRestriction {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const types = parseStringList(value.types, `${label}.types`);
  return {
    ...(types.length > 0 ? { types } : {}),
    ...(value.chosenSubtype === true ? { chosenSubtype: true } : {}),
    ...(value.monocoloredChosenColor === true ? { monocoloredChosenColor: true } : {}),
    ...(value.subtype === undefined
      ? {}
      : { subtype: expectString(value.subtype, `${label}.subtype`) }),
    ...(value.legendary === true ? { legendary: true } : {}),
    ...(value.commanderSpell === true ? { commanderSpell: true } : {}),
    ...(value.colorless === true ? { colorless: true } : {}),
    ...(value.allowsAbilities === true ? { allowsAbilities: true } : {}),
    ...(value.unrestricted === true ? { unrestricted: true } : {}),
    ...(value.sharesCreatureTypeWithCommander === true
      ? { sharesCreatureTypeWithCommander: true }
      : {}),
  };
}

function parseManaRider(value: unknown, label: string): ManaRider {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return {
    when: parseManaRestriction(value.when, `${label}.when`),
    effects: parseCardEffects(value.effects, `${label}.effects`),
  };
}

/** One colour letter, validated. */
/**
 * A land-tap echo (Forsaken Monument, High Tide). One parser, used by the
 * definition field, by the effect that installs a turn-scoped one, and by
 * the game-state list those live in — rather than the same four optional
 * fields written out at each site, which is how the copies drift.
 */
function parseLandTapEcho(
  value: unknown,
  label: string,
): NonNullable<CardDefinition["landTapEcho"]> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return {
    ...(value.subtype === undefined
      ? {}
      : { subtype: expectString(value.subtype, `${label}.subtype`) }),
    ...(value.anyPermanent === true ? { anyPermanent: true } : {}),
    ...(value.addColor === undefined
      ? {}
      : { addColor: parseManaColor(value.addColor, `${label}.addColor`) }),
    ...(value.requiresProduced === undefined
      ? {}
      : { requiresProduced: parseManaColor(value.requiresProduced, `${label}.requiresProduced`) }),
  };
}

function parseColorArray(value: unknown, label: string): Color[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.map((entry: unknown) => parseColor(entry, label));
}

function parseColor(value: unknown, label: string): Color {
  const color = expectString(value, label);
  if (!(COLOR_KEYS as readonly string[]).includes(color)) {
    throw new Error(`Invalid ${label}`);
  }
  return color as Color;
}

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

/** A team pump's power term: a number, or one of the read-at-bind names. */
function parseTeamPtTerm(
  value: unknown,
  label: string,
): number | "creature_count" | "greatest_power" | "x" {
  if (
    value === "creature_count" ||
    value === "greatest_power" ||
    value === "x"
  ) {
    return value;
  }
  return expectNumber(value, label);
}

/**
 * Every DynamicCount, as values.
 *
 * Two hand-written parsers each carried their own short list — bonusPt.per
 * took five of these and dynamicPt.count took eight — so cards the compiler
 * emitted CORRECTLY produced definitions that could not be loaded, and a
 * saved table holding one of them would not reopen. Being a
 * Record<DynamicCount, true> makes a future union member a compile error
 * here rather than a save file that will not open.
 */
const DYNAMIC_COUNTS_BY_NAME: Record<Extract<DynamicCount, string>, true> = {
  times_it_has_attacked_this_turn: true,
  lands_you_control: true,
  creatures_you_control: true,
  artifacts_you_control: true,
  enchantments_you_control: true,
  artifacts_and_enchantments_you_control: true,
  cards_in_your_hand: true,
  cards_in_your_graveyard: true,
  creature_cards_in_your_graveyard: true,
  colors_among_permanents_you_control: true,
  colorless_creatures_you_control: true,
  creatures_you_control_with_a_counter: true,
  auras_attached_to_it: true,
  auras_and_equipment_attached_to_it: true,
  creatures_and_enchantments_you_control: true,
  auras_you_control_attached_to_a_creature: true,
  legendary_creatures_you_control: true,
  attacking_creatures_you_control: true,
  other_creatures_you_control: true,
  attacking_creatures: true,
  permanents_you_control: true,
  plains_you_control: true,
  islands_you_control: true,
  swamps_you_control: true,
  mountains_you_control: true,
  forests_you_control: true,
  cards_drawn_this_turn: true,
  creatures_sharing_a_type_with_it: true,
  attacking_creatures_sharing_a_type_with_it: true,
};

function parseDynamicCount(value: unknown, label: string): DynamicCount {
  if (isControlledSubtypeCount(value)) {
    return copyDynamicCount(value);
  }
  const count = expectString(value, label);
  if (!Object.hasOwn(DYNAMIC_COUNTS_BY_NAME, count)) {
    throw new Error(`Invalid ${label}`);
  }
  return count as DynamicCount;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/** The zones Midnight Clock may sweep back into a library. */
function parseShuffleZones(value: unknown, label: string): ("hand" | "graveyard")[] {
  return expectStringArray(value, label).map((zone) => {
    if (zone !== "hand" && zone !== "graveyard") {
      throw new Error(`Invalid ${label}`);
    }
    return zone;
  });
}

function expectList(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
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

/** Adamant's gate on `entersWithCounters`, and nothing else yet. */
function parseManaSpentGate(
  value: Record<string, unknown>,
  label: string,
): { atLeast: number; color?: Color } {
  const color = value.color === undefined ? undefined : parseColor(value.color, `${label}.color`);
  return {
    atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
    ...(color ? { color } : {}),
  };
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
    // Absent on a state written before infect existed: nobody was poisoned.
    poisonCounters:
      value.poisonCounters === undefined
        ? 0
        : expectNumber(value.poisonCounters, "player.poisonCounters"),
    ...(value.ringTempts === undefined
      ? {}
      : { ringTempts: expectNumber(value.ringTempts, "player.ringTempts") }),
    ...(value.ringBearerId === undefined
      ? {}
      : { ringBearerId: expectString(value.ringBearerId, "player.ringBearerId") }),
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
    ...(value.persistentMana === undefined
      ? {}
      : { persistentMana: parsePartialMana(value.persistentMana, "player.persistentMana") }),
    ...(value.restrictedMana === undefined
      ? {}
      : {
          restrictedMana: (Array.isArray(value.restrictedMana)
            ? value.restrictedMana
            : (() => {
                throw new Error("Invalid player.restrictedMana");
              })()
          ).map((entry, index) => {
            if (!isRecord(entry)) {
              throw new Error(`Invalid player.restrictedMana[${index}]`);
            }
            return {
              color: parseManaColor(entry.color, `player.restrictedMana[${index}].color`),
              amount: expectNumber(entry.amount, `player.restrictedMana[${index}].amount`),
              sourceId: expectString(entry.sourceId, `player.restrictedMana[${index}].sourceId`),
              ...(entry.rider === undefined
                ? {}
                : {
                    rider: parseManaRider(
                      entry.rider,
                      `player.restrictedMana[${index}].rider`,
                    ),
                  }),
              restriction: parseManaRestriction(
                entry.restriction,
                `player.restrictedMana[${index}].restriction`,
              ),
            };
          }),
        }),
    ...(value.attackersThisTurn === undefined
      ? {}
      : {
          attackersThisTurn: expectNumber(value.attackersThisTurn, "player.attackersThisTurn"),
        }),
    failedToDraw: value.failedToDraw === true,
    ...(value.cityBlessing === true ? { cityBlessing: true } : {}),
    ...(value.extraLandDropsThisTurn === undefined
      ? {}
      : {
          extraLandDropsThisTurn: expectNumber(
            value.extraLandDropsThisTurn,
            "player.extraLandDropsThisTurn",
          ),
        }),
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
      ...(card.timesAttackedThisTurn === undefined
        ? {}
        : {
            timesAttackedThisTurn: expectNumber(
              card.timesAttackedThisTurn,
              "card.timesAttackedThisTurn",
            ),
          }),
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
      ...(card.imprintedCardIds === undefined
        ? {}
        : {
            imprintedCardIds: expectStringArray(
              card.imprintedCardIds,
              "card.imprintedCardIds",
            ),
          }),
      attachedTo:
        card.attachedTo === undefined || card.attachedTo === null
          ? null
          : expectString(card.attachedTo, "card.attachedTo"),
      ...(card.exiledBy === undefined
        ? {}
        : { exiledBy: expectString(card.exiledBy, "card.exiledBy") }),
      ...(card.reanimatedCardId === undefined
        ? {}
        : { reanimatedCardId: expectString(card.reanimatedCardId, "card.reanimatedCardId") }),
      ...(card.drawnOnTurn === undefined
        ? {}
        : { drawnOnTurn: expectNumber(card.drawnOnTurn, "card.drawnOnTurn") }),
      ...(Array.isArray(card.grantedActivatedAbilities)
        ? {
            grantedActivatedAbilities: parseActivatedAbilities(
              card.grantedActivatedAbilities,
              "card.grantedActivatedAbilities",
            ),
          }
        : {}),
      ...(Array.isArray(card.grantedManaAbilities)
        ? {
            grantedManaAbilities: parseManaAbilities(
              card.grantedManaAbilities,
              "card.grantedManaAbilities",
            ),
          }
        : {}),
      loyaltyActivatedThisTurn: card.loyaltyActivatedThisTurn === true,
      ...(card.skipNextUntap === true ? { skipNextUntap: true } : {}),
      ...(card.exertedThisTurn === true ? { exertedThisTurn: true } : {}),
      ...(card.bonusEnterCounters === undefined
        ? {}
        : {
            bonusEnterCounters: expectNumber(
              card.bonusEnterCounters,
              "card.bonusEnterCounters",
            ),
          }),
      ...(card.bargainedThisCast === true ? { bargainedThisCast: true } : {}),
      ...(card.sacrificeAtNextCleanup === true ? { sacrificeAtNextCleanup: true } : {}),
      ...(card.bestowed === true ? { bestowed: true } : {}),
      ...(isRecord(card.manaSpentToCast)
        ? { manaSpentToCast: parseMana(card.manaSpentToCast, "card.manaSpentToCast") }
        : {}),
      ...(typeof card.castFromZone === "string"
        ? { castFromZone: card.castFromZone as ZoneName }
        : {}),
      ...(card.goadedBy === undefined
        ? {}
        : {
            goadedBy: expectStringArray(card.goadedBy, "card.goadedBy"),
          }),
      ...(card.mustAttackThisTurn === true ? { mustAttackThisTurn: true } : {}),
      ...(card.exileIfLeaves === true ? { exileIfLeaves: true } : {}),
      // Kodama's mark is instance state: without it a reopened table lets
      // the chain restart off a permanent the ability already placed.
      ...(Array.isArray(card.addedSubtypes)
        ? {
            addedSubtypes: expectStringArray(card.addedSubtypes, "card.addedSubtypes"),
          }
        : {}),
      ...(card.regenerationShields === undefined
        ? {}
        : {
            regenerationShields: expectNumber(
              card.regenerationShields,
              "card.regenerationShields",
            ),
          }),
      ...(card.putByAbilityOf === undefined
        ? {}
        : { putByAbilityOf: expectString(card.putByAbilityOf, "card.putByAbilityOf") }),
      ...(card.evoked === true ? { evoked: true } : {}),
      ...(card.echoDue === true ? { echoDue: true } : {}),
      faceDown: card.faceDown === true,
      ...(card.phasedOut === true ? { phasedOut: true } : {}),
      ...(card.enteredFromCast === true ? { enteredFromCast: true } : {}),
      ...(card.attachedToPlayer === undefined
        ? {}
        : { attachedToPlayer: expectString(card.attachedToPlayer, "card.attachedToPlayer") }),
      ...(card.chosenCardName === undefined
        ? {}
        : { chosenCardName: expectString(card.chosenCardName, "card.chosenCardName") }),
      chosenCreatureType:
        card.chosenCreatureType === undefined || card.chosenCreatureType === null
          ? null
          : expectString(card.chosenCreatureType, "card.chosenCreatureType"),
      ...(card.chosenCardType === undefined || card.chosenCardType === null
        ? {}
        : { chosenCardType: expectString(card.chosenCardType, "card.chosenCardType") }),
      chosenColor:
        card.chosenColor === undefined || card.chosenColor === null
          ? null
          : (() => {
              const color = expectString(card.chosenColor, "card.chosenColor");
              if (!(COLOR_KEYS as readonly string[]).includes(color)) {
                throw new Error("Invalid card.chosenColor");
              }
              return color as Color;
            })(),
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
      ...(def.wardLife === undefined
        ? {}
        : { wardLife: expectNumber(def.wardLife, "definition.wardLife") }),
      ...(def.noMaxHandSize === true ? { noMaxHandSize: true } : {}),
      ...(def.landsEnterUntapped === true ? { landsEnterUntapped: true } : {}),
      ...(def.totemArmor === true ? { totemArmor: true } : {}),
      ...(def.targetingLifeTax === undefined
        ? {}
        : { targetingLifeTax: expectNumber(def.targetingLifeTax, "definition.targetingLifeTax") }),
      ...(def.opponentsEnterTriggersSuppressed === true
        ? { opponentsEnterTriggersSuppressed: true }
        : {}),
      ...(def.payLifeForColor === undefined
        ? {}
        : { payLifeForColor: parseColor(def.payLifeForColor, "definition.payLifeForColor") }),
      ...(def.handSizeEffect === undefined
        ? {}
        : {
            handSizeEffect: (() => {
              if (!isRecord(def.handSizeEffect)) {
                throw new Error("Invalid definition.handSizeEffect");
              }
              const scope = expectString(def.handSizeEffect.scope, "definition.handSizeEffect.scope");
              const mode = expectString(def.handSizeEffect.mode, "definition.handSizeEffect.mode");
              if (scope !== "controller" && scope !== "opponents") {
                throw new Error("Invalid definition.handSizeEffect.scope");
              }
              if (mode !== "set" && mode !== "reduce") {
                throw new Error("Invalid definition.handSizeEffect.mode");
              }
              return {
                scope,
                mode,
                amount: expectNumber(def.handSizeEffect.amount, "definition.handSizeEffect.amount"),
              };
            })(),
          }),
      ...(def.opponentsDrawCap === undefined
        ? {}
        : { opponentsDrawCap: expectNumber(def.opponentsDrawCap, `definition.${id}.opponentsDrawCap`) }),
      ...(def.noncreatureSpellCap === undefined
        ? {}
        : {
            noncreatureSpellCap: expectNumber(
              def.noncreatureSpellCap,
              `definition.${id}.noncreatureSpellCap`,
            ),
          }),
      ...(def.cantLoseGame === true ? { cantLoseGame: true } : {}),
      ...(def.creaturesDontUntap === true ? { creaturesDontUntap: true } : {}),
      ...(def.controllerHexproof === true ? { controllerHexproof: true } : {}),
      ...(def.attackLimitPerCombat === undefined
        ? {}
        : {
            attackLimitPerCombat: expectNumber(
              def.attackLimitPerCombat,
              `definition.${id}.attackLimitPerCombat`,
            ),
          }),
      ...(def.extraBlocksGranted === undefined
        ? {}
        : {
            extraBlocksGranted: expectNumber(
              def.extraBlocksGranted,
              `definition.${id}.extraBlocksGranted`,
            ),
          }),
      ...(isRecord(def.damageReplacement)
        ? {
            damageReplacement: {
              ...(def.damageReplacement.times === undefined
                ? {}
                : {
                    times: expectNumber(
                      def.damageReplacement.times,
                      `definition.${id}.damageReplacement.times`,
                    ),
                  }),
              ...(def.damageReplacement.plus === undefined
                ? {}
                : {
                    plus: expectNumber(
                      def.damageReplacement.plus,
                      `definition.${id}.damageReplacement.plus`,
                    ),
                  }),
              ...(def.damageReplacement.sourceColors === undefined
                ? {}
                : {
                    sourceColors: (() => {
                      const raw = def.damageReplacement.sourceColors;
                      if (!Array.isArray(raw)) {
                        throw new Error(`Invalid definition.${id}.damageReplacement.sourceColors`);
                      }
                      return raw.map((color: unknown) =>
                        parseColor(color, `definition.${id}.damageReplacement.sourceColors`),
                      );
                    })(),
                  }),
              ...(def.damageReplacement.sourceMustBeCreature === true
                ? { sourceMustBeCreature: true }
                : {}),
              ...(def.damageReplacement.opponentsOnly === true ? { opponentsOnly: true } : {}),
              ...(def.damageReplacement.noncombatOnly === true ? { noncombatOnly: true } : {}),
            },
          }
        : {}),
      ...(isRecord(def.altCost)
        ? {
            altCost: {
              ...(def.altCost.opponentSpellsThisTurn === undefined
                ? {}
                : {
                    opponentSpellsThisTurn: expectNumber(
                      def.altCost.opponentSpellsThisTurn,
                      `definition.${id}.altCost.opponentSpellsThisTurn`,
                    ),
                  }),
              ...(def.altCost.onlyOnOpponentsTurn === true
                ? { onlyOnOpponentsTurn: true }
                : {}),
              ...(def.altCost.life === undefined
                ? {}
                : { life: expectNumber(def.altCost.life, `definition.${id}.altCost.life`) }),
              ...(isRecord(def.altCost.exileFromHand)
                ? {
                    exileFromHand: {
                      count: expectNumber(
                        def.altCost.exileFromHand.count,
                        `definition.${id}.altCost.exileFromHand.count`,
                      ),
                      ...(def.altCost.exileFromHand.colors === undefined
                        ? {}
                        : {
                            colors: parseColorArray(
                              def.altCost.exileFromHand.colors,
                              `definition.${id}.altCost.exileFromHand.colors`,
                            ),
                          }),
                    },
                  }
                : {}),
              ...(isRecord(def.altCost.sacrificeCreature)
                ? {
                    sacrificeCreature: {
                      ...(def.altCost.sacrificeCreature.nontoken === true
                        ? { nontoken: true }
                        : {}),
                      ...(def.altCost.sacrificeCreature.colors === undefined
                        ? {}
                        : {
                            colors: parseColorArray(
                              def.altCost.sacrificeCreature.colors,
                              `definition.${id}.altCost.sacrificeCreature.colors`,
                            ),
                          }),
                    },
                  }
                : {}),
              ...(isRecord(def.altCost.requires)
                ? {
                    requires: parseControlledGate(
                      def.altCost.requires,
                      `definition.${id}.altCost.requires`,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(def.manaTapMultiplier === undefined
        ? {}
        : {
            manaTapMultiplier: expectNumber(
              def.manaTapMultiplier,
              `definition.${id}.manaTapMultiplier`,
            ),
          }),
      ...(def.extraLandDrops === undefined
        ? {}
        : { extraLandDrops: expectNumber(def.extraLandDrops, `definition.${id}.extraLandDrops`) }),
      ...(def.cantBeCountered === true ? { cantBeCountered: true } : {}),
      ...(isRecord(def.spellsCantBeCountered)
        ? {
            spellsCantBeCountered: {
              ...(Array.isArray(def.spellsCantBeCountered.types)
                ? {
                    types: def.spellsCantBeCountered.types.map((type, index) =>
                      expectString(type, `definition.spellsCantBeCountered.types[${index}]`),
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(def.opponentsLockedDuringYourTurn === true
        ? { opponentsLockedDuringYourTurn: true }
        : {}),
      ...(def.opponentsCantCastDuringYourTurn === true
        ? { opponentsCantCastDuringYourTurn: true }
        : {}),
      ...(def.mustAttack === true ? { mustAttack: true } : {}),
      ...(isRecord(def.notCreatureBelowDevotion)
        ? {
            notCreatureBelowDevotion: (() => {
              const color = expectString(
                def.notCreatureBelowDevotion.color,
                `definition.${id}.notCreatureBelowDevotion.color`,
              );
              if (!(COLOR_KEYS as readonly string[]).includes(color)) {
                throw new Error(`Invalid definition.${id}.notCreatureBelowDevotion.color`);
              }
              return {
                color: color as Color,
                threshold: expectNumber(
                  def.notCreatureBelowDevotion.threshold,
                  `definition.${id}.notCreatureBelowDevotion.threshold`,
                ),
              };
            })(),
          }
        : {}),
      ...(def.freeIfCommander === true ? { freeIfCommander: true } : {}),
      ...(isRecord(def.altCostIfCreatures)
        ? {
            altCostIfCreatures: {
              cost: expectString(
                def.altCostIfCreatures.cost,
                `definition.${id}.altCostIfCreatures.cost`,
              ),
              count: expectNumber(
                def.altCostIfCreatures.count,
                `definition.${id}.altCostIfCreatures.count`,
              ),
            },
          }
        : {}),
      ...(def.changeling === true ? { changeling: true } : {}),
      ...(def.storm === true ? { storm: true } : {}),
      ...(def.doesntUntap === true ? { doesntUntap: true } : {}),
      ...(typeof def.toxic === "number" ? { toxic: expectNumber(def.toxic, `definition.${id}.toxic`) } : {}),
      ...(typeof def.artifactAbilityDiscount === "number" ? { artifactAbilityDiscount: expectNumber(def.artifactAbilityDiscount, `definition.${id}.artifactAbilityDiscount`) } : {}),
      ...(isRecord(def.untapRestriction)
        ? {
            untapRestriction: {
              max: expectNumber(def.untapRestriction.max, `definition.${id}.untapRestriction.max`),
              scope:
                def.untapRestriction.scope === "land"
                  ? ("land" as const)
                  : ("permanent" as const),
            },
          }
        : {}),
      ...(def.convoke === true ? { convoke: true } : {}),
      ...(def.improvise === true ? { improvise: true } : {}),
      ...(def.delve === true ? { delve: true } : {}),
      ...(isRecord(def.grantsCostKeyword)
        ? {
            grantsCostKeyword: {
              keyword:
                expectString(def.grantsCostKeyword.keyword, "grantsCostKeyword.keyword") ===
                "improvise"
                  ? ("improvise" as const)
                  : ("convoke" as const),
              ...(def.grantsCostKeyword.types === undefined
                ? {}
                : { types: parseStringList(def.grantsCostKeyword.types, "grantsCostKeyword.types") }),
              ...(def.grantsCostKeyword.nonTypes === undefined
                ? {}
                : {
                    nonTypes: parseStringList(
                      def.grantsCostKeyword.nonTypes,
                      "grantsCostKeyword.nonTypes",
                    ),
                  }),
            },
          }
        : {}),
      ...(def.grantsFlash === true ? { grantsFlash: true } : {}),
      ...(def.controlsOpponentSearches === true ? { controlsOpponentSearches: true } : {}),
      ...(isRecord(def.grantsFlashFor)
        ? {
            grantsFlashFor: {
              ...(def.grantsFlashFor.types === undefined
                ? {}
                : { types: parseStringList(def.grantsFlashFor.types, "grantsFlashFor.types") }),
              ...(def.grantsFlashFor.subtypesAny === undefined
                ? {}
                : {
                    subtypesAny: parseStringList(
                      def.grantsFlashFor.subtypesAny,
                      "grantsFlashFor.subtypesAny",
                    ),
                  }),
              ...(def.grantsFlashFor.nonTypes === undefined
                ? {}
                : {
                    nonTypes: parseStringList(
                      def.grantsFlashFor.nonTypes,
                      "grantsFlashFor.nonTypes",
                    ),
                  }),
            },
          }
        : {}),
      ...(isRecord(def.castFreeFromHand)
        ? {
            castFreeFromHand: {
              ...(def.castFreeFromHand.capFromCounter === undefined
                ? {}
                : {
                    capFromCounter: expectString(
                      def.castFreeFromHand.capFromCounter,
                      "definition.castFreeFromHand.capFromCounter",
                    ),
                  }),
              ...(def.castFreeFromHand.oncePerTurn === true ? { oncePerTurn: true } : {}),
            },
          }
        : {}),
      ...(def.extraDrawStepDraws === true ? { extraDrawStepDraws: true } : {}),
      ...(def.affinityArtifacts === true ? { affinityArtifacts: true } : {}),
      ...(def.selfDiscount === undefined
        ? {}
        : {
            selfDiscount: (() => {
              if (!isRecord(def.selfDiscount)) {
                throw new Error(`Invalid definition.${id}.selfDiscount`);
              }
              const per = def.selfDiscount.per;
              if (
                per !== undefined &&
                per !== "noncreature_artifacts_total_mv" &&
                per !== "historic_total_mv" &&
                per !== "greatest_creature_power" &&
                per !== "total_creature_power" &&
                per !== "opponent_stack_3"
              ) {
                throw new Error(`Invalid definition.${id}.selfDiscount.per`);
              }
              const scaled = def.selfDiscount.perDynamicCount;
              if (scaled === undefined) {
                return per === undefined ? {} : { per };
              }
              if (!isRecord(scaled) || !isDynamicCount(scaled.count)) {
                throw new Error(`Invalid definition.${id}.selfDiscount.perDynamicCount`);
              }
              const count = scaled.count;
              return {
                ...(per === undefined ? {} : { per }),
                perDynamicCount: {
                  generic: expectNumber(
                    scaled.generic,
                    `definition.${id}.selfDiscount.perDynamicCount.generic`,
                  ),
                  count,
                },
              };
            })(),
          }),
      ...(def.affinityAllCreatures === true ? { affinityAllCreatures: true } : {}),
      ...(def.flashback === undefined
        ? {}
        : {
            flashback: (() => {
              if (!isRecord(def.flashback)) {
                throw new Error(`Invalid definition.${id}.flashback`);
              }
              return {
                // Dread Return and Cabal Therapy pay a sacrifice and no mana
                // at all, so the mana half is legitimately empty. Rejected by
                // default, those two definitions could not LOAD.
                manaCost: expectString(
                  def.flashback.manaCost,
                  `definition.${id}.flashback.manaCost`,
                  def.flashback.sacrificeCreatures !== undefined,
                ),
                ...(def.flashback.life === undefined
                  ? {}
                  : { life: expectNumber(def.flashback.life, `definition.${id}.flashback.life`) }),
                ...(def.flashback.sacrificeCreatures === undefined
                  ? {}
                  : {
                      sacrificeCreatures: expectNumber(
                        def.flashback.sacrificeCreatures,
                        `definition.${id}.flashback.sacrificeCreatures`,
                      ),
                    }),
              };
            })(),
          }),
      ...(def.evoke === undefined
        ? {}
        : {
            evoke: {
              manaCost: expectString(
                isRecord(def.evoke) ? def.evoke.manaCost : undefined,
                `definition.${id}.evoke.manaCost`,
              ),
            },
          }),
      ...(def.echo === undefined
        ? {}
        : {
            echo: {
              manaCost: expectString(
                isRecord(def.echo) ? def.echo.manaCost : undefined,
                `definition.${id}.echo.manaCost`,
              ),
            },
          }),
      ...(def.splitSecond === true ? { splitSecond: true } : {}),
      ...(def.escalate === undefined
        ? {}
        : { escalate: expectString(def.escalate, `definition.${id}.escalate`) }),
      ...(def.blockPowerGate === undefined || !isRecord(def.blockPowerGate)
        ? {}
        : {
            blockPowerGate: {
              ...(def.blockPowerGate.attackerMaxPower === undefined
                ? {}
                : {
                    attackerMaxPower: expectNumber(
                      def.blockPowerGate.attackerMaxPower,
                      `definition.${id}.blockPowerGate.attackerMaxPower`,
                    ),
                  }),
              ...(def.blockPowerGate.blockerMinPower === undefined
                ? {}
                : {
                    blockerMinPower: expectNumber(
                      def.blockPowerGate.blockerMinPower,
                      `definition.${id}.blockPowerGate.blockerMinPower`,
                    ),
                  }),
              ...(def.blockPowerGate.blockerBelowSourcePower === true
                ? { blockerBelowSourcePower: true }
                : {}),
            },
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
                ...(grant.castColorless === true ? { castColorless: true } : {}),
                ...(typeof grant.castMinManaValue === "number"
                  ? { castMinManaValue: grant.castMinManaValue }
                  : {}),
                ...(grant.castChosenType === true ? { castChosenType: true } : {}),
                ...(grant.castRequiresCoven === true ? { castRequiresCoven: true } : {}),
                ...(grant.requiresAttached === true ? { requiresAttached: true } : {}),
                ...(grant.payLifeInsteadOfMana === true
                  ? { payLifeInsteadOfMana: true }
                  : {}),
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
      ...(def.chooseCardTypeOnEnter === true ? { chooseCardTypeOnEnter: true } : {}),
      ...(def.enterCountersPerChosenType === undefined
        ? {}
        : {
            enterCountersPerChosenType: expectString(
              def.enterCountersPerChosenType,
              `definition.${id}.enterCountersPerChosenType`,
            ),
          }),
      ...(def.freeEquipIfArtifacts === undefined
        ? {}
        : {
            freeEquipIfArtifacts: expectNumber(
              def.freeEquipIfArtifacts,
              `definition.${id}.freeEquipIfArtifacts`,
            ),
          }),
      ...(def.opponentsCastOnlyFromHand === true ? { opponentsCastOnlyFromHand: true } : {}),
      ...(def.selfIsChosenType === true ? { selfIsChosenType: true } : {}),
      ...(def.landChosenColorBonus === true ? { landChosenColorBonus: true } : {}),
      ...(isRecord(def.landTapEcho)
        ? { landTapEcho: parseLandTapEcho(def.landTapEcho, "definition.landTapEcho") }
        : {}),
      ...(def.opponentLandTapsSkipUntap === true ? { opponentLandTapsSkipUntap: true } : {}),
      ...(def.rebound === true ? { rebound: true } : {}),
      ...(def.triggerDoubling === undefined
        ? {}
        : {
            triggerDoubling: (() => {
              if (!isRecord(def.triggerDoubling)) {
                throw new Error(`Invalid definition.${id}.triggerDoubling`);
              }
              const cause = def.triggerDoubling.cause;
              if (
                cause !== undefined &&
                cause !== "enters" &&
                cause !== "dies" &&
                cause !== "attacks" &&
                cause !== "casts"
              ) {
                throw new Error(`Invalid definition.${id}.triggerDoubling.cause`);
              }
              const source = def.triggerDoubling.source;
              if (source !== undefined && !isRecord(source)) {
                throw new Error(`Invalid definition.${id}.triggerDoubling.source`);
              }
              return {
                ...(cause === undefined ? {} : { cause }),
                ...(def.triggerDoubling.causeTypesAny === undefined
                  ? {}
                  : {
                      causeTypesAny: expectStringArray(
                        def.triggerDoubling.causeTypesAny,
                        `definition.${id}.triggerDoubling.causeTypesAny`,
                      ),
                    }),
                ...(source === undefined
                  ? {}
                  : {
                      source: {
                        ...(source.types === undefined
                          ? {}
                          : {
                              types: expectStringArray(
                                source.types,
                                `definition.${id}.triggerDoubling.source.types`,
                              ),
                            }),
                        ...(source.subtypesAny === undefined
                          ? {}
                          : {
                              subtypesAny: expectStringArray(
                                source.subtypesAny,
                                `definition.${id}.triggerDoubling.source.subtypesAny`,
                              ),
                            }),
                        ...(source.chosenSubtype === true ? { chosenSubtype: true } : {}),
                        ...(source.excludeSelf === true ? { excludeSelf: true } : {}),
                        ...(source.maxPower === undefined
                          ? {}
                          : {
                              maxPower: expectNumber(
                                source.maxPower,
                                `definition.${id}.triggerDoubling.source.maxPower`,
                              ),
                            }),
                      },
                    }),
              };
            })(),
          }),
      ...(def.entersWithXCounters === true ? { entersWithXCounters: true } : {}),
      ...(typeof def.entersWithXCounterKind === "string"
        ? { entersWithXCounterKind: def.entersWithXCounterKind }
        : {}),
      ...(isRecord(def.entersWithCounters)
        ? {
            entersWithCounters: {
              counter: expectString(def.entersWithCounters.counter, "entersWithCounters.counter"),
              count: expectNumber(def.entersWithCounters.count, "entersWithCounters.count"),
              ...(isRecord(def.entersWithCounters.ifManaSpent)
                ? {
                    ifManaSpent: parseManaSpentGate(
                      def.entersWithCounters.ifManaSpent,
                      "entersWithCounters.ifManaSpent",
                    ),
                  }
                : {}),
            },
          }
        : {}),
      ...(def.enterAsCopy === undefined
        ? {}
        : {
            enterAsCopy: (() => {
              if (!isRecord(def.enterAsCopy)) {
                throw new Error(`Invalid definition.${id}.enterAsCopy`);
              }
              const scope = def.enterAsCopy.scope;
              if (
                scope !== "any_creature" &&
                scope !== "your_creature" &&
                scope !== "another_your_creature" &&
                scope !== "your_creature_or_planeswalker" &&
                scope !== "any_nonland_permanent" &&
                scope !== "any_artifact_or_creature" &&
                scope !== "any_artifact" &&
                scope !== "any_land" &&
                scope !== "any_equipment" &&
                scope !== "any_artifact_or_enchantment"
              ) {
                throw new Error(`Invalid definition.${id}.enterAsCopy.scope`);
              }
              return {
                scope,
                ...(def.enterAsCopy.extraCounters === undefined
                  ? {}
                  : {
                      extraCounters: expectNumber(
                        def.enterAsCopy.extraCounters,
                        `definition.${id}.enterAsCopy.extraCounters`,
                      ),
                    }),
                ...(def.enterAsCopy.maxManaValueBySpent === true
                  ? { maxManaValueBySpent: true }
                  : {}),
                ...(def.enterAsCopy.entersTapped === true ? { entersTapped: true } : {}),
                ...(def.enterAsCopy.untilEot === true ? { untilEot: true } : {}),
                ...(def.enterAsCopy.grantHaste === true ? { grantHaste: true } : {}),
              };
            })(),
          }),
      ...(def.bargain === true ? { bargain: true } : {}),
      ...(isRecord(def.reconfigure)
        ? { reconfigure: { manaCost: expectString(def.reconfigure.manaCost, "definition.reconfigure.manaCost") } }
        : {}),
      ...(isRecord(def.bestow)
        ? { bestow: { manaCost: expectString(def.bestow.manaCost, "definition.bestow.manaCost") } }
        : {}),
      ...(def.sacrificeIfCastAtInstantSpeed === true
        ? { sacrificeIfCastAtInstantSpeed: true }
        : {}),
      ...(def.additionalCost === undefined
        ? {}
        : {
            additionalCost: parseAdditionalCost(
              def.additionalCost,
              `definition.${id}.additionalCost`,
            ),
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
      ...(isRecord(def.grantsEscape)
        ? {
            grantsEscape: {
              exileOther: expectNumber(
                def.grantsEscape.exileOther,
                `definition.${id}.grantsEscape.exileOther`,
              ),
            },
          }
        : {}),
      ...(def.playLandsFromGraveyard === true ? { playLandsFromGraveyard: true } : {}),
      ...(isRecord(def.saga)
        ? {
            saga: {
              chapters: (Array.isArray(def.saga.chapters) ? def.saga.chapters : []).map(
                (chapter: unknown, chapterIndex: number) =>
                  parseCardEffects(chapter, `definition.${id}.saga.chapters[${chapterIndex}]`),
              ),
            },
          }
        : {}),
      ...(def.leyline === true ? { leyline: true } : {}),
      ...(isRecord(def.openingHandStart)
        ? {
            openingHandStart: {
              counter: expectString(
                def.openingHandStart.counter,
                `definition.${id}.openingHandStart.counter`,
              ),
              exileFromHand: expectNumber(
                def.openingHandStart.exileFromHand,
                `definition.${id}.openingHandStart.exileFromHand`,
              ),
            },
          }
        : {}),
      ...(def.ascend === true ? { ascend: true } : {}),
      ...(def.castFromExile === true ? { castFromExile: true } : {}),
      ...(def.castFromGraveyard === undefined
        ? {}
        : {
            castFromGraveyard: (() => {
              if (!isRecord(def.castFromGraveyard)) {
                throw new Error(`Invalid definition.${id}.castFromGraveyard`);
              }
              const types = parseStringList(
                def.castFromGraveyard.types,
                `definition.${id}.castFromGraveyard.types`,
              );
              const subtypes = parseStringList(
                def.castFromGraveyard.subtypes,
                `definition.${id}.castFromGraveyard.subtypes`,
              );
              return {
                ...(types.length > 0 ? { types } : {}),
                ...(subtypes.length > 0 ? { subtypes } : {}),
              };
            })(),
          }),
      ...(def.abilityHaste === true ? { abilityHaste: true } : {}),
      ...(def.untapDuringEachUntap === "creatures" || def.untapDuringEachUntap === "permanents" || def.untapDuringEachUntap === "artifacts" || def.untapDuringEachUntap === "self"
        ? { untapDuringEachUntap: def.untapDuringEachUntap }
        : {}),
      ...(def.opponentCreaturesEnterTapped === true ? { opponentCreaturesEnterTapped: true } : {}),
      ...(def.opponentNonbasicLandsEnterTapped === true
        ? { opponentNonbasicLandsEnterTapped: true }
        : {}),
      ...(def.extraLandDropsForAll === undefined
        ? {}
        : { extraLandDropsForAll: expectNumber(def.extraLandDropsForAll, "extraLandDropsForAll") }),
      ...(def.opponentArtifactsEnterTapped === true ? { opponentArtifactsEnterTapped: true } : {}),
      ...(def.dynamicPt === undefined
        ? {}
        : {
            dynamicPt: (() => {
              if (!isRecord(def.dynamicPt)) {
                throw new Error(`Invalid definition.${id}.dynamicPt`);
              }
              const count = parseDynamicCount(
                def.dynamicPt.count,
                `definition.${id}.dynamicPt.count`,
              );
              return {
                count,
                ...(def.dynamicPt.powerOnly === true ? { powerOnly: true } : {}),
              };
            })(),
          }),
      ...(def.bonusPt === undefined
        ? {}
        : {
            bonusPt: (() => {
              if (!isRecord(def.bonusPt)) {
                throw new Error(`Invalid definition.${id}.bonusPt`);
              }
              const per = parseDynamicCount(def.bonusPt.per, `definition.${id}.bonusPt.per`);
              return {
                power: expectNumber(def.bonusPt.power, `definition.${id}.bonusPt.power`),
                toughness: expectNumber(def.bonusPt.toughness, `definition.${id}.bonusPt.toughness`),
                per,
              };
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
                  ...(entry.scope === "opponents" || entry.scope === "all" || entry.scope === "you"
                    ? { scope: entry.scope }
                    : {}),
                  ...(entry.condition === undefined
                    ? {}
                    : {
                        condition: parseTriggerCondition(
                          entry.condition,
                          "costReductions.condition",
                        ),
                      }),
                  ...(entry.notDuringControllersTurn === true
                    ? { notDuringControllersTurn: true }
                    : {}),
                  filter: {
                    ...(types.length > 0 ? { types } : {}),
                    ...(typesAny.length > 0 ? { typesAny } : {}),
                    ...(subtypesAny.length > 0 ? { subtypesAny } : {}),
                    ...(colors.length > 0 ? { colors } : {}),
                    ...(entry.filter.chosenSubtype === true ? { chosenSubtype: true } : {}),
                    ...(entry.filter.chosenCardType === true ? { chosenCardType: true } : {}),
                    ...(typeof entry.filter.keyword === "string"
                      ? { keyword: entry.filter.keyword }
                      : {}),
                    ...(entry.filter.minPower === undefined
                      ? {}
                      : {
                          minPower: expectNumber(
                            entry.filter.minPower,
                            `definition.${id}.costReductions.minPower`,
                          ),
                        }),
                  },
                };
              });
            })(),
          }),
      ...(def.hexproofFrom === undefined
        ? {}
        : { hexproofFrom: parseColorArray(def.hexproofFrom, `definition.${id}.hexproofFrom`) }),
      ...(def.retrace === true ? { retrace: true } : {}),
      ...(def.opponentsSkipExtraTurns === true ? { opponentsSkipExtraTurns: true } : {}),
      ...(def.dredge === undefined
        ? {}
        : { dredge: expectNumber(def.dredge, `definition.${id}.dredge`) }),
      ...(isRecord(def.spliceOntoArcane)
        ? {
            spliceOntoArcane: {
              manaCost: expectString(
                def.spliceOntoArcane.manaCost,
                `definition.${id}.spliceOntoArcane.manaCost`,
              ),
            },
          }
        : {}),
      ...(isRecord(def.grantsRetrace)
        ? {
            grantsRetrace: {
              filter: parseSearchFilter(
                def.grantsRetrace.filter,
                `definition.${id}.grantsRetrace.filter`,
              ),
              ...(def.grantsRetrace.onlyYourTurn === true ? { onlyYourTurn: true } : {}),
            },
          }
        : {}),
      ...(def.protectionFrom === undefined
        ? {}
        : {
            protectionFrom: parseProtectionFrom(
              def.protectionFrom,
              `definition.${id}.protectionFrom`,
            ),
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
                ...(def.modeChoice.maxIfCommander === undefined
                  ? {}
                  : {
                      maxIfCommander: expectNumber(
                        def.modeChoice.maxIfCommander,
                        `definition.${id}.modeChoice.maxIfCommander`,
                      ),
                    }),
              };
            })(),
          }),
      ...(def.reanimateOnEnter === true ? { reanimateOnEnter: true } : {}),
      ...(def.cascade === undefined
        ? {}
        : { cascade: expectNumber(def.cascade, "definition.cascade") }),
      ...(def.harmonizeConvoke === true ? { harmonizeConvoke: true } : {}),
      ...(def.copySelfWhenCastFromGraveyard === true
        ? { copySelfWhenCastFromGraveyard: true }
        : {}),
      // Total record, not a chain of `===`: an unlisted member silently
      // dropped the Aura's whole enchant line on the wire, which turns an
      // Aura into a permanent nothing can un-attach.
      ...(isEnchantRestriction(def.enchant) ? { enchant: def.enchant } : {}),
      ...(def.chooseColorOnEnter === true ? { chooseColorOnEnter: true } : {}),
      ...(def.chooseColorExcludes === undefined
        ? {}
        : { chooseColorExcludes: parseColor(def.chooseColorExcludes, "definition.chooseColorExcludes") }),
      ...(def.enchantedTappedBonus === undefined
        ? {}
        : {
            enchantedTappedBonus: (() => {
              if (!isRecord(def.enchantedTappedBonus)) {
                throw new Error(`Invalid definition.${id}.enchantedTappedBonus`);
              }
              const color = def.enchantedTappedBonus.color;
              if (color !== "chosen" && !(COLOR_KEYS as readonly string[]).includes(color as string)) {
                throw new Error(`Invalid definition.${id}.enchantedTappedBonus.color`);
              }
              return {
                color: color as Color | "chosen",
                amount: expectNumber(
                  def.enchantedTappedBonus.amount,
                  `definition.${id}.enchantedTappedBonus.amount`,
                ),
              };
            })(),
          }),
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
                  ...(entry.xLoyaltyCost === true ? { xLoyaltyCost: true } : {}),
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
      ...(entry.grantedActivated === undefined
        ? {}
        : {
            grantedActivated: parseActivatedAbilities(
              [entry.grantedActivated],
              `stack[${index}].grantedActivated`,
            )[0]!,
          }),
      ...(entry.grantedTrigger === undefined
        ? {}
        : {
            grantedTrigger: parseTriggers(
              [entry.grantedTrigger],
              `stack[${index}].grantedTrigger`,
            )[0]!,
          }),
      ...(entry.subjectCardId === undefined
        ? {}
        : { subjectCardId: expectString(entry.subjectCardId, `stack[${index}].subjectCardId`) }),
      ...(entry.subjectStackObjectId === undefined
        ? {}
        : { subjectStackObjectId: expectString(entry.subjectStackObjectId, `stack[${index}].subjectStackObjectId`) }),
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
      ...(Array.isArray(entry.splicedFrom)
        ? { splicedFrom: expectStringArray(entry.splicedFrom, `stack[${index}].splicedFrom`) }
        : {}),
      ...(entry.sacrificedManaValue === undefined
        ? {}
        : {
            sacrificedManaValue: expectNumber(
              entry.sacrificedManaValue,
              `stack[${index}].sacrificedManaValue`,
            ),
          }),
      ...(entry.modeIndex === undefined
        ? {}
        : { modeIndex: expectNumber(entry.modeIndex, `stack[${index}].modeIndex`) }),
      ...(entry.isCopy === true ? { isCopy: true } : {}),
      ...(entry.cantBeCountered === true ? { cantBeCountered: true } : {}),
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
      // Tables saved before Oran-Rief landed have no opening stamp; 0 reads
      // as "everything on the battlefield entered this turn", which only a
      // freshly loaded Oran-Rief activation could notice.
      startTimestamp: expectNumber(raw.turn.startTimestamp ?? 0, "turn.startTimestamp"),
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
    ...(raw.pendingExtraCombatUntaps === undefined
      ? {}
      : {
          pendingExtraCombatUntaps: expectNumber(
            raw.pendingExtraCombatUntaps,
            "pendingExtraCombatUntaps",
          ),
        }),
    ...(raw.counterAttackBans === undefined
      ? {}
      : {
          counterAttackBans: (() => {
            if (!Array.isArray(raw.counterAttackBans)) {
              throw new Error("Invalid counterAttackBans");
            }
            return raw.counterAttackBans.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid counterAttackBans[${index}]`);
              }
              return {
                counter: expectString(entry.counter, `counterAttackBans[${index}].counter`),
                protectedPlayerId: expectString(
                  entry.protectedPlayerId,
                  `counterAttackBans[${index}].protectedPlayerId`,
                ),
              };
            });
          })(),
        }),
    pendingExtraCombats:
      raw.pendingExtraCombats === undefined
        ? 0
        : expectNumber(raw.pendingExtraCombats, "pendingExtraCombats"),
    // High Tide's echo is game state, not a permanent: without this a
    // reopened table stops doubling Islands mid-turn.
    ...(Array.isArray(raw.turnManaEchoes)
      ? {
          turnManaEchoes: raw.turnManaEchoes.map((echo, index) =>
            parseLandTapEcho(echo, `turnManaEchoes[${index}]`),
          ),
        }
      : {}),
    spellsCastThisTurn:
      raw.spellsCastThisTurn === undefined
        ? 0
        : expectNumber(raw.spellsCastThisTurn, "spellsCastThisTurn"),
    ...(raw.spellColorsCastByPlayerThisTurn === undefined
      ? {}
      : {
          spellColorsCastByPlayerThisTurn: (() => {
            if (!isRecord(raw.spellColorsCastByPlayerThisTurn)) {
              throw new Error("Invalid spellColorsCastByPlayerThisTurn");
            }
            const byPlayer: Record<string, Color[]> = {};
            for (const [key, entry] of Object.entries(raw.spellColorsCastByPlayerThisTurn)) {
              byPlayer[key] = parseColorArray(entry, `spellColorsCastByPlayerThisTurn.${key}`);
            }
            return byPlayer;
          })(),
        }),
    ...(raw.spellsUncounterableThisTurn === undefined
      ? {}
      : {
          spellsUncounterableThisTurn: expectStringArray(
            raw.spellsUncounterableThisTurn,
            "spellsUncounterableThisTurn",
          ),
        }),
    ...(raw.spellsCastByPlayerThisTurn === undefined
      ? {}
      : {
          spellsCastByPlayerThisTurn: (() => {
            if (!isRecord(raw.spellsCastByPlayerThisTurn)) {
              throw new Error("Invalid spellsCastByPlayerThisTurn");
            }
            const counts: Record<string, number> = {};
            for (const [key, entry] of Object.entries(raw.spellsCastByPlayerThisTurn)) {
              counts[key] = expectNumber(entry, `spellsCastByPlayerThisTurn.${key}`);
            }
            return counts;
          })(),
        }),
    // The prompt that reads this is answered across a client round trip, so
    // the list has to survive the wire or "from among them" silently offers
    // the whole graveyard.
    ...(raw.pendingExtraTurns === undefined
      ? {}
      : { pendingExtraTurns: expectStringArray(raw.pendingExtraTurns, "pendingExtraTurns") }),
    ...(raw.extraTurnsDenied === undefined
      ? {}
      : { extraTurnsDenied: expectStringArray(raw.extraTurnsDenied, "extraTurnsDenied") }),
    ...(raw.modesChosenThisTurn === undefined
      ? {}
      : {
          modesChosenThisTurn: (() => {
            if (!isRecord(raw.modesChosenThisTurn)) {
              throw new Error("Invalid modesChosenThisTurn");
            }
            const taken: Record<string, number[]> = {};
            for (const [key, entry] of Object.entries(raw.modesChosenThisTurn)) {
              taken[key] = expectList(entry, `modesChosenThisTurn.${key}`).map((mode, at) =>
                expectNumber(mode, `modesChosenThisTurn.${key}[${at}]`),
              );
            }
            return taken;
          })(),
        }),
    ...(raw.lastChosenCardName === undefined
      ? {}
      : {
          lastChosenCardName: expectString(raw.lastChosenCardName, "lastChosenCardName"),
        }),
    ...(raw.lastSearchedCardIds === undefined
      ? {}
      : {
          lastSearchedCardIds: expectStringArray(
            raw.lastSearchedCardIds,
            "lastSearchedCardIds",
          ),
        }),
    ...(raw.lastMilledCardIds === undefined
      ? {}
      : {
          lastMilledCardIds: expectStringArray(raw.lastMilledCardIds, "lastMilledCardIds"),
        }),
    ...(raw.spellsCastByNameThisGame === undefined
      ? {}
      : {
          spellsCastByNameThisGame: (() => {
            if (!isRecord(raw.spellsCastByNameThisGame)) {
              throw new Error("Invalid spellsCastByNameThisGame");
            }
            const byPlayer: Record<string, Record<string, number>> = {};
            for (const [playerId, names] of Object.entries(raw.spellsCastByNameThisGame)) {
              if (!isRecord(names)) {
                throw new Error(`Invalid spellsCastByNameThisGame.${playerId}`);
              }
              const counts: Record<string, number> = {};
              for (const [name, entry] of Object.entries(names)) {
                counts[name] = expectNumber(
                  entry,
                  `spellsCastByNameThisGame.${playerId}.${name}`,
                );
              }
              byPlayer[playerId] = counts;
            }
            return byPlayer;
          })(),
        }),
    ...(raw.noncreatureSpellsCastByPlayerThisTurn === undefined
      ? {}
      : {
          noncreatureSpellsCastByPlayerThisTurn: (() => {
            if (!isRecord(raw.noncreatureSpellsCastByPlayerThisTurn)) {
              throw new Error("Invalid noncreatureSpellsCastByPlayerThisTurn");
            }
            const counts: Record<string, number> = {};
            for (const [key, entry] of Object.entries(
              raw.noncreatureSpellsCastByPlayerThisTurn,
            )) {
              counts[key] = expectNumber(entry, `noncreatureSpellsCastByPlayerThisTurn.${key}`);
            }
            return counts;
          })(),
        }),
    ...(raw.creaturesDiedThisTurn === undefined
      ? {}
      : { creaturesDiedThisTurn: expectNumber(raw.creaturesDiedThisTurn, "creaturesDiedThisTurn") }),
    ...(raw.combatPhasesThisTurn === undefined
      ? {}
      : { combatPhasesThisTurn: expectNumber(raw.combatPhasesThisTurn, "combatPhasesThisTurn") }),
    ...(raw.createdTokenThisTurn === undefined
      ? {}
      : { createdTokenThisTurn: expectStringArray(raw.createdTokenThisTurn, "createdTokenThisTurn") }),
    ...(raw.drawsByPlayerThisTurn === undefined
      ? {}
      : {
          drawsByPlayerThisTurn: (() => {
            if (!isRecord(raw.drawsByPlayerThisTurn)) {
              throw new Error("Invalid drawsByPlayerThisTurn");
            }
            const counts: Record<string, number> = {};
            for (const [key, entry] of Object.entries(raw.drawsByPlayerThisTurn)) {
              counts[key] = expectNumber(entry, `drawsByPlayerThisTurn.${key}`);
            }
            return counts;
          })(),
        }),
    ...(raw.lifeGainedByPlayerThisTurn === undefined
      ? {}
      : {
          lifeGainedByPlayerThisTurn: (() => {
            if (!isRecord(raw.lifeGainedByPlayerThisTurn)) {
              throw new Error("Invalid lifeGainedByPlayerThisTurn");
            }
            const counts: Record<string, number> = {};
            for (const [key, entry] of Object.entries(raw.lifeGainedByPlayerThisTurn)) {
              counts[key] = expectNumber(entry, `lifeGainedByPlayerThisTurn.${key}`);
            }
            return counts;
          })(),
        }),
    ...(raw.lifeLostByPlayerThisTurn === undefined
      ? {}
      : {
          lifeLostByPlayerThisTurn: (() => {
            if (!isRecord(raw.lifeLostByPlayerThisTurn)) {
              throw new Error("Invalid lifeLostByPlayerThisTurn");
            }
            const counts: Record<string, number> = {};
            for (const [key, entry] of Object.entries(raw.lifeLostByPlayerThisTurn)) {
              counts[key] = expectNumber(entry, `lifeLostByPlayerThisTurn.${key}`);
            }
            return counts;
          })(),
        }),
    ...(raw.damageToPlayerThisTurn === undefined
      ? {}
      : {
          damageToPlayerThisTurn: (() => {
            if (!isRecord(raw.damageToPlayerThisTurn)) {
              throw new Error("Invalid damageToPlayerThisTurn");
            }
            const counts: Record<string, number> = {};
            for (const [key, entry] of Object.entries(raw.damageToPlayerThisTurn)) {
              counts[key] = expectNumber(entry, `damageToPlayerThisTurn.${key}`);
            }
            return counts;
          })(),
        }),
    ...(raw.selfCastLockUntilEot === undefined
      ? {}
      : {
          selfCastLockUntilEot: expectStringArray(
            raw.selfCastLockUntilEot,
            "selfCastLockUntilEot",
          ),
        }),
    ...(raw.castLockUntilEot === undefined
      ? {}
      : { castLockUntilEot: expectString(raw.castLockUntilEot, "castLockUntilEot") }),
    ...(raw.noncreatureCastLockUntilEot === undefined
      ? {}
      : {
          noncreatureCastLockUntilEot: expectString(
            raw.noncreatureCastLockUntilEot,
            "noncreatureCastLockUntilEot",
          ),
        }),
    ...(raw.exilePlayable === undefined
      ? {}
      : {
          exilePlayable: (() => {
            if (!Array.isArray(raw.exilePlayable)) {
              throw new Error("Invalid exilePlayable");
            }
            return raw.exilePlayable.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid exilePlayable[${index}]`);
              }
              return {
                cardId: expectString(entry.cardId, `exilePlayable[${index}].cardId`),
                casterId: expectString(entry.casterId, `exilePlayable[${index}].casterId`),
                ...(entry.freeCast === true ? { freeCast: true } : {}),
                ...(entry.locksCastingAfter === true ? { locksCastingAfter: true } : {}),
                ...(entry.whileExiled === true ? { whileExiled: true } : {}),
                ...(entry.anyColorMana === true ? { anyColorMana: true } : {}),
                ...(entry.remainingOwnCleanups === undefined
                  ? {}
                  : {
                      remainingOwnCleanups: expectNumber(
                        entry.remainingOwnCleanups,
                        `exilePlayable[${index}].remainingOwnCleanups`,
                      ),
                    }),
              };
            });
          })(),
        }),
    ...(raw.playerShields === undefined
      ? {}
      : {
          playerShields: (() => {
            if (!Array.isArray(raw.playerShields)) {
              throw new Error("Invalid playerShields");
            }
            return raw.playerShields.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid playerShields[${index}]`);
              }
              return {
                playerId: expectString(
                  entry.playerId,
                  `playerShields[${index}].playerId`,
                ),
                ...(entry.protectionFromEverything === true
                  ? { protectionFromEverything: true }
                  : {}),
                ...(entry.lifeLocked === true ? { lifeLocked: true } : {}),
                ...(entry.hexproofFromColors === undefined
                  ? {}
                  : {
                      hexproofFromColors: parseColorArray(
                        entry.hexproofFromColors,
                        `playerShields[${index}].hexproofFromColors`,
                      ),
                    }),
                ...(entry.untilEndOfTurn === true ? { untilEndOfTurn: true } : {}),
                createdOnTurn: expectNumber(
                  entry.createdOnTurn,
                  `playerShields[${index}].createdOnTurn`,
                ),
              };
            });
          })(),
        }),
    ...(raw.pendingManaRiders === undefined
      ? {}
      : {
          pendingManaRiders: (() => {
            if (!Array.isArray(raw.pendingManaRiders)) {
              throw new Error("Invalid pendingManaRiders");
            }
            return raw.pendingManaRiders.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid pendingManaRiders[${index}]`);
              }
              return {
                controllerId: expectString(
                  entry.controllerId,
                  `pendingManaRiders[${index}].controllerId`,
                ),
                sourceId: expectString(
                  entry.sourceId,
                  `pendingManaRiders[${index}].sourceId`,
                ),
                effects: parseCardEffects(
                  entry.effects,
                  `pendingManaRiders[${index}].effects`,
                ),
              };
            });
          })(),
        }),
    ...(raw.pendingRebounds === undefined
      ? {}
      : {
          pendingRebounds: (() => {
            if (!Array.isArray(raw.pendingRebounds)) {
              throw new Error("Invalid pendingRebounds");
            }
            return raw.pendingRebounds.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid pendingRebounds[${index}]`);
              }
              return {
                cardId: expectString(entry.cardId, `pendingRebounds[${index}].cardId`),
                casterId: expectString(entry.casterId, `pendingRebounds[${index}].casterId`),
              };
            });
          })(),
        }),
    preventCombatDamage: raw.preventCombatDamage === true,
    ...(raw.preventCombatFor === undefined
      ? {}
      : { preventCombatFor: expectStringArray(raw.preventCombatFor, "preventCombatFor") }),
    ...(Array.isArray(raw.combatDamageShields)
      ? {
          combatDamageShields: raw.combatDamageShields.map((entry, index) => {
            if (!isRecord(entry)) {
              throw new Error(`Invalid combatDamageShields[${index}]`);
            }
            return {
              playerId: expectString(entry.playerId, `combatDamageShields[${index}].playerId`),
              prevented: expectNumber(
                entry.prevented,
                `combatDamageShields[${index}].prevented`,
              ),
              ...(isRecord(entry.tokenPerDamage)
                ? {
                    tokenPerDamage: parseGameEffect(
                      entry.tokenPerDamage,
                      `combatDamageShields[${index}].tokenPerDamage`,
                    ) as Extract<GameEffect, { kind: "create_token" }>,
                  }
                : {}),
            };
          }),
        }
      : {}),
    ...(raw.flashThisTurn === undefined
      ? {}
      : { flashThisTurn: expectStringArray(raw.flashThisTurn, "flashThisTurn") }),
    ...(raw.noMaxHandSizePlayers === undefined
      ? {}
      : {
          noMaxHandSizePlayers: expectStringArray(
            raw.noMaxHandSizePlayers,
            "noMaxHandSizePlayers",
          ),
        }),
    ...(raw.temporaryControl === undefined
      ? {}
      : {
          temporaryControl: (Array.isArray(raw.temporaryControl)
            ? raw.temporaryControl
            : (() => {
                throw new Error("Invalid temporaryControl");
              })()
          ).map((entry: unknown, index: number) => {
            if (!isRecord(entry)) {
              throw new Error(`Invalid temporaryControl[${index}]`);
            }
            return {
              cardId: expectString(entry.cardId, `temporaryControl[${index}].cardId`),
              returnToId: expectString(entry.returnToId, `temporaryControl[${index}].returnToId`),
            };
          }),
        }),
    ...(raw.nextSpellGrants === undefined
      ? {}
      : {
          nextSpellGrants: (Array.isArray(raw.nextSpellGrants)
            ? raw.nextSpellGrants
            : (() => {
                throw new Error("Invalid nextSpellGrants");
              })()
          ).map((entry: unknown, index: number) => {
            if (!isRecord(entry)) {
              throw new Error(`Invalid nextSpellGrants[${index}]`);
            }
            return {
              playerId: expectString(entry.playerId, `nextSpellGrants[${index}].playerId`),
              ...(entry.improvise === true ? { improvise: true } : {}),
              ...(entry.cantBeCountered === true ? { cantBeCountered: true } : {}),
            };
          }),
        }),
    ...(raw.temporaryCopies === undefined
      ? {}
      : {
          temporaryCopies: (Array.isArray(raw.temporaryCopies)
            ? raw.temporaryCopies
            : (() => {
                throw new Error("Invalid temporaryCopies");
              })()
          ).map((entry: unknown, index: number) => {
            if (!isRecord(entry)) {
              throw new Error(`Invalid temporaryCopies[${index}]`);
            }
            return {
              cardId: expectString(entry.cardId, `temporaryCopies[${index}].cardId`),
              restoreDefinitionId: expectString(
                entry.restoreDefinitionId,
                `temporaryCopies[${index}].restoreDefinitionId`,
              ),
            };
          }),
        }),
    ...(raw.freeCastUsedThisTurn === undefined
      ? {}
      : {
          freeCastUsedThisTurn: expectStringArray(
            raw.freeCastUsedThisTurn,
            "freeCastUsedThisTurn",
          ),
        }),
    ...(raw.freeCastFromHand === undefined
      ? {}
      : {
          freeCastFromHand: (Array.isArray(raw.freeCastFromHand)
            ? raw.freeCastFromHand
            : (() => {
                throw new Error("Invalid freeCastFromHand");
              })()
          ).map(
            (entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid freeCastFromHand[${index}]`);
              }
              const record = entry;
              return {
                casterId: expectString(record.casterId, `freeCastFromHand[${index}].casterId`),
                ...(record.maxManaValue === undefined
                  ? {}
                  : {
                      maxManaValue: expectNumber(
                        record.maxManaValue,
                        `freeCastFromHand[${index}].maxManaValue`,
                      ),
                    }),
                remaining: expectNumber(record.remaining, `freeCastFromHand[${index}].remaining`),
              };
            },
          ),
        }),
    delayedTriggers:
      raw.delayedTriggers === undefined
        ? []
        : (() => {
            if (!Array.isArray(raw.delayedTriggers)) {
              throw new Error("Invalid delayedTriggers");
            }
            return raw.delayedTriggers.map((entry, index) => {
              if (!isRecord(entry)) {
                throw new Error(`Invalid delayedTriggers[${index}]`);
              }
              const step = expectString(entry.step, `delayedTriggers[${index}].step`);
              if (step !== "upkeep" && step !== "first_main_phase") {
                throw new Error(`Invalid delayedTriggers[${index}].step`);
              }
              const whose = expectString(entry.whose, `delayedTriggers[${index}].whose`);
              if (whose !== "controller" && whose !== "any") {
                throw new Error(`Invalid delayedTriggers[${index}].whose`);
              }
              return {
                controllerId: expectString(
                  entry.controllerId,
                  `delayedTriggers[${index}].controllerId`,
                ),
                step,
                whose,
                effects: parseGameEffects(
                  entry.effects,
                  `delayedTriggers[${index}].effects`,
                ),
                sourceId:
                  entry.sourceId === null || entry.sourceId === undefined
                    ? null
                    : expectString(entry.sourceId, `delayedTriggers[${index}].sourceId`),
              };
            });
          })(),
    // Myriad's tokens: without this a reopened table keeps them for good.
    // The Ring's third tier puts a SACRIFICE in the same list, so each entry
    // says which it is.
    ...(Array.isArray(raw.delayedEndCombat)
      ? {
          delayedEndCombat: raw.delayedEndCombat.map((entry, index) => {
            if (!isRecord(entry)) {
              throw new Error(`Invalid delayedEndCombat[${index}]`);
            }
            const action = expectString(entry.action, `delayedEndCombat[${index}].action`);
            if (action !== "exile" && action !== "sacrifice") {
              throw new Error(`Invalid delayedEndCombat[${index}].action`);
            }
            return {
              cardId: expectString(entry.cardId, `delayedEndCombat[${index}].cardId`),
              action,
            };
          }),
        }
      : {}),
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
              if (
                action !== "sacrifice" &&
                action !== "exile" &&
                action !== "hand" &&
                action !== "battlefield"
              ) {
                throw new Error(`Invalid delayedEndStep[${index}].action`);
              }
              return {
                cardId: expectString(entry.cardId, `delayedEndStep[${index}].cardId`),
                action,
                // Nezahal comes back TAPPED; without this the drawback is
                // lost the moment a table is reopened mid-blink.
                ...(entry.returnsTapped === true ? { returnsTapped: true } : {}),
                ...(entry.withCounter === undefined
                  ? {}
                  : {
                      withCounter: expectString(
                        entry.withCounter,
                        `delayedEndStep[${index}].withCounter`,
                      ),
                    }),
                ...(entry.controllerId === undefined
                  ? {}
                  : {
                      controllerId: expectString(
                        entry.controllerId,
                        `delayedEndStep[${index}].controllerId`,
                      ),
                    }),
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
    if (
      entry.duration !== "until_end_of_turn" &&
      entry.duration !== "until_your_next_turn"
    ) {
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
      duration: entry.duration,
      // Elspeth's grant outlives the turn it was made on, so BOTH of these
      // have to cross the wire — without them a reopened table would sweep
      // the grant at the next untap step no matter whose turn it was.
      ...(entry.forPlayerId === undefined
        ? {}
        : { forPlayerId: expectString(entry.forPlayerId, `activeEffects[${index}].forPlayerId`) }),
      ...(entry.createdOnTurn === undefined
        ? {}
        : {
            createdOnTurn: expectNumber(
              entry.createdOnTurn,
              `activeEffects[${index}].createdOnTurn`,
            ),
          }),
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
    if (kind === "discard_land_or_graveyard") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
      };
    }
    if (kind === "discard_land_or_graveyard") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
      };
    }
    if (kind === "exile_until_taken") {
      return {
        kind,
        playerId,
        cardId: expectString(entry.cardId, `prompts[${index}].cardId`),
        exiledThisWay: expectStringArray(
          entry.exiledThisWay,
          `prompts[${index}].exiledThisWay`,
        ),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "punisher_choice") {
      return {
        kind,
        playerId,
        controllerId: expectString(entry.controllerId, `prompts[${index}].controllerId`),
        sourceId:
          entry.sourceId === null
            ? null
            : expectString(entry.sourceId, `prompts[${index}].sourceId`),
        ifTaken: parseCardEffects(entry.ifTaken, `prompts[${index}].ifTaken`),
        ifDeclined: parseCardEffects(entry.ifDeclined, `prompts[${index}].ifDeclined`),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "replace_draw_with_dredge") {
      return {
        kind,
        playerId,
        cardIds: expectStringArray(entry.cardIds, `prompts[${index}].cardIds`),
        remaining: expectNumber(entry.remaining, `prompts[${index}].remaining`),
        ...(entry.turnDraw === true ? { turnDraw: true } : {}),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "tap_own_for_x") {
      return {
        kind,
        playerId,
        sourceId:
          entry.sourceId === null
            ? null
            : expectString(entry.sourceId, `prompts[${index}].sourceId`),
        cardIds: expectStringArray(entry.cardIds, `prompts[${index}].cardIds`),
        rider: parseCardEffects(entry.rider, `prompts[${index}].rider`),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "tempting_offer") {
      return {
        kind,
        playerId,
        controllerId: expectString(entry.controllerId, `prompts[${index}].controllerId`),
        remaining: expectStringArray(entry.remaining, `prompts[${index}].remaining`),
        accepted: expectNumber(entry.accepted, `prompts[${index}].accepted`),
        action: parseCardEffects(entry.action, `prompts[${index}].action`),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "divide_piles") {
      return {
        kind,
        playerId,
        cardIds: expectStringArray(entry.cardIds, `prompts[${index}].cardIds`),
        chooserId: expectString(entry.chooserId, `prompts[${index}].chooserId`),
        taken: parsePileZone(entry.taken, `prompts[${index}].taken`),
        left: parsePileZone(entry.left, `prompts[${index}].left`),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "choose_pile") {
      return {
        kind,
        playerId,
        first: expectStringArray(entry.first, `prompts[${index}].first`),
        second: expectStringArray(entry.second, `prompts[${index}].second`),
        taken: parsePileZone(entry.taken, `prompts[${index}].taken`),
        left: parsePileZone(entry.left, `prompts[${index}].left`),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "choose_card_name") {
      return {
        kind,
        playerId,
        ...(entry.sourceId === undefined
          ? {}
          : { sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`) }),
        ...(entry.resumeEffects === undefined
          ? {}
          : {
              resumeEffects: parseGameEffects(
                entry.resumeEffects,
                `prompts[${index}].resumeEffects`,
              ),
            }),
      };
    }
    if (kind === "choose_creature_type") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
      };
    }
    if (kind === "choose_color") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
        ...(entry.grantProtectionTo === undefined
          ? {}
          : {
              grantProtectionTo: expectString(
                entry.grantProtectionTo,
                `prompts[${index}].grantProtectionTo`,
              ),
        ...(entry.excludeColor === undefined
          ? {}
          : { excludeColor: parseColor(entry.excludeColor, `prompts[${index}].excludeColor`) }),
            }),
      };
    }
    if (kind === "choose_trigger_mode") {
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
        triggerIndex: expectNumber(entry.triggerIndex, `prompts[${index}].triggerIndex`),
        ...(entry.spentModes === undefined
          ? {}
          : {
              spentModes: expectList(entry.spentModes, `prompts[${index}].spentModes`).map(
                (mode, at) => expectNumber(mode, `prompts[${index}].spentModes[${at}]`),
              ),
            }),
        ...(isRecord(entry.modeChoice)
          ? {
              modeChoice: {
                min: expectNumber(
                  entry.modeChoice.min,
                  `prompts[${index}].modeChoice.min`,
                ),
                max: expectNumber(
                  entry.modeChoice.max,
                  `prompts[${index}].modeChoice.max`,
                ),
              },
            }
          : {}),
        ...(entry.subjectCardId === undefined
          ? {}
          : { subjectCardId: expectString(entry.subjectCardId, `prompts[${index}].subjectCardId`) }),
        ...(entry.subjectPlayerId === undefined
          ? {}
          : {
              subjectPlayerId: expectString(
                entry.subjectPlayerId,
                `prompts[${index}].subjectPlayerId`,
              ),
            }),
        ...(entry.subjectAmount === undefined
          ? {}
          : { subjectAmount: expectNumber(entry.subjectAmount, `prompts[${index}].subjectAmount`) }),
      };
    }
    if (kind === "enter_as_copy") {
      const scope = entry.scope;
      if (
        scope !== "any_creature" &&
        scope !== "your_creature" &&
        scope !== "another_your_creature" &&
        scope !== "your_creature_or_planeswalker" &&
        scope !== "any_nonland_permanent" &&
        scope !== "any_artifact_or_creature" &&
        scope !== "any_artifact" &&
        scope !== "any_land" &&
        scope !== "any_equipment" &&
        scope !== "any_artifact_or_enchantment"
      ) {
        throw new Error(`Invalid prompts[${index}].scope`);
      }
      return {
        kind,
        playerId,
        sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
        scope,
        ...(entry.extraCounters === undefined
          ? {}
          : { extraCounters: expectNumber(entry.extraCounters, `prompts[${index}].extraCounters`) }),
        ...(entry.maxManaValue === undefined
          ? {}
          : { maxManaValue: expectNumber(entry.maxManaValue, `prompts[${index}].maxManaValue`) }),
        // These three were absent, so a game saved with the choice still
        // open came back with Vesuva's copy untapped and, once Cursed
        // Mirror existed, permanent and hasteless. The prompt is state.
        ...(entry.entersTapped === true ? { entersTapped: true } : {}),
        ...(entry.untilEot === true ? { untilEot: true } : {}),
        ...(entry.grantHaste === true ? { grantHaste: true } : {}),
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
        // Ward—Pay N life: without this the tax came back across the wire as
        // a free {0} and the ward simply stopped taxing.
        ...(entry.life === undefined
          ? {}
          : { life: expectNumber(entry.life, `prompts[${index}].life`) }),
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
        cost: expectString(entry.cost, `prompts[${index}].cost`, entry.life !== undefined),
        ...(entry.life === undefined
          ? {}
          : { life: expectNumber(entry.life, `prompts[${index}].life`) }),
        thenEffects: parseGameEffects(entry.thenEffects, `prompts[${index}].thenEffects`),
        sourceId:
          entry.sourceId === undefined || entry.sourceId === null
            ? null
            : expectString(entry.sourceId, `prompts[${index}].sourceId`),
        ...(entry.whenPaid === true ? { whenPaid: true } : {}),
        ...(entry.elseEffects === undefined
          ? {}
          : {
              elseEffects: parseGameEffects(
                entry.elseEffects,
                `prompts[${index}].elseEffects`,
              ),
            }),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind === "choose_from_hand") {
      const destination = entry.destination;
      if (destination !== "library_bottom" && destination !== "battlefield") {
        throw new Error(`Invalid prompts[${index}].destination`);
      }
      const resumeEffects =
        entry.resumeEffects === undefined
          ? undefined
          : parseGameEffects(entry.resumeEffects, `prompts[${index}].resumeEffects`);
      return {
        kind,
        playerId,
        destination,
        ...(Array.isArray(entry.types)
          ? {
              types: entry.types.map((type, typeIndex) =>
                expectString(type, `prompts[${index}].types[${typeIndex}]`),
              ),
            }
          : {}),
        ...(entry.thenDrawPlus === undefined
          ? {}
          : {
              thenDrawPlus: expectNumber(
                entry.thenDrawPlus,
                `prompts[${index}].thenDrawPlus`,
              ),
            }),
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
        ...(entry.hideawaySourceId === undefined
          ? {}
          : {
              hideawaySourceId: expectString(
                entry.hideawaySourceId,
                `prompts[${index}].hideawaySourceId`,
              ),
            }),
        ...(entry.exilePlayableThisTurn === true ? { exilePlayableThisTurn: true } : {}),
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
        ...(entry.untapIfLands === undefined
          ? {}
          : { untapIfLands: expectNumber(entry.untapIfLands, `prompts[${index}].untapIfLands`) }),
        ...(entry.landsToBattlefieldTapped === true
          ? { landsToBattlefieldTapped: true }
          : {}),
        ...(entry.alsoGraveyard === true ? { alsoGraveyard: true } : {}),
        ...(entry.hijackedFrom === undefined
          ? {}
          : {
              hijackedFrom: expectString(
                entry.hijackedFrom,
                `prompts[${index}].hijackedFrom`,
              ),
            }),
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
        ...(entry.optional === true ? { optional: true } : {}),
        ...(entry.thenEffectsIfNone === undefined
          ? {}
          : {
              thenEffectsIfNone: parseCardEffects(
                entry.thenEffectsIfNone,
                `prompts[${index}].thenEffectsIfNone`,
              ),
            }),
        ...(typeof entry.controllerId === "string"
          ? { controllerId: entry.controllerId }
          : {}),
        ...(resumeEffects && resumeEffects.length > 0 ? { resumeEffects } : {}),
      };
    }
    if (kind !== "choose_targets") {
      throw new Error(`Invalid prompts[${index}].kind`);
    }
    const origin = expectString(entry.origin, `prompts[${index}].origin`);
    if (origin !== "trigger" && origin !== "retarget" && origin !== "free_copy") {
      throw new Error(`Invalid prompts[${index}].origin`);
    }
    return {
      kind,
      playerId,
      sourceId: expectString(entry.sourceId, `prompts[${index}].sourceId`),
      origin,
      ...(entry.triggerIndex === undefined
        ? {}
        : { triggerIndex: expectNumber(entry.triggerIndex, `prompts[${index}].triggerIndex`) }),
      ...(entry.modeIndex === undefined
        ? {}
        : { modeIndex: expectNumber(entry.modeIndex, `prompts[${index}].modeIndex`) }),
      ...(entry.stackObjectId === undefined
        ? {}
        : { stackObjectId: expectString(entry.stackObjectId, `prompts[${index}].stackObjectId`) }),
      ...(entry.copyOfCardId === undefined
        ? {}
        : { copyOfCardId: expectString(entry.copyOfCardId, `prompts[${index}].copyOfCardId`) }),
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
      ...(entry.causeKind === "enters" || entry.causeKind === "dies" || entry.causeKind === "attacks"
        ? { causeKind: entry.causeKind }
        : {}),
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

/**
 * The dig's two destinations, as runtime sets: a string union cannot check
 * itself off the wire, and a bad one here silently sends cards somewhere
 * the printed card never mentions.
 */
type DigFound = Extract<CardEffect, { kind: "dig_until" }>["found"];
type DigRest = Extract<CardEffect, { kind: "dig_until" }>["rest"];
const DIG_FOUND_ZONES = new Set<string>([
  "hand",
  "battlefield",
  "battlefield_tapped",
  "graveyard",
  "exile",
]);
const DIG_REST_ZONES = new Set<string>([
  "library_bottom_random",
  "library_bottom",
  "graveyard",
  "exile",
]);

const PILE_ZONES = new Set<string>(["hand", "graveyard"]);

function parsePileZone(value: unknown, label: string): "hand" | "graveyard" {
  const zone = expectString(value, label);
  if (!PILE_ZONES.has(zone)) {
    throw new Error(`Invalid ${label}`);
  }
  return zone as "hand" | "graveyard";
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
  const colors = parseStringList(value.colors, `${label}.colors`).filter(
    (entry): entry is Color => ["W", "U", "B", "R", "G"].includes(entry),
  );
  const nonTypes = parseStringList(value.nonTypes, `${label}.nonTypes`);
  const nonSubtypes = parseStringList(value.nonSubtypes, `${label}.nonSubtypes`);
  return {
    ...(nonTypes.length > 0 ? { nonTypes } : {}),
    ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
    ...(supertypes.length > 0 ? { supertypes } : {}),
    ...(types.length > 0 ? { types } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
    ...(subtypesAny.length > 0 ? { subtypesAny } : {}),
    ...(typesAny.length > 0 ? { typesAny } : {}),
    ...(colors.length > 0 ? { colors } : {}),
    ...(Array.isArray(value.manaCostIn)
      ? { manaCostIn: parseStringList(value.manaCostIn, `${label}.manaCostIn`) }
      : {}),
    ...(value.maxManaValue === undefined
      ? {}
      : { maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`) }),
    ...(value.maxManaValueX === true ? { maxManaValueX: true } : {}),
    ...(value.maxPowerX === true ? { maxPowerX: true } : {}),
    ...(isDynamicCount(value.maxManaValueFrom)
      ? { maxManaValueFrom: value.maxManaValueFrom }
      : {}),
    ...(value.nameIsChosen === true ? { nameIsChosen: true } : {}),
    ...(value.maxManaValuePlusSacrificed === undefined
      ? {}
      : {
          maxManaValuePlusSacrificed: expectNumber(
            value.maxManaValuePlusSacrificed,
            `${label}.maxManaValuePlusSacrificed`,
          ),
        }),
    ...(value.maxToughness === undefined
      ? {}
      : { maxToughness: expectNumber(value.maxToughness, `${label}.maxToughness`) }),
    ...(value.maxPower === undefined
      ? {}
      : { maxPower: expectNumber(value.maxPower, `${label}.maxPower`) }),
    ...(value.exactManaValue === undefined
      ? {}
      : { exactManaValue: expectNumber(value.exactManaValue, `${label}.exactManaValue`) }),
    ...(value.keyword === undefined
      ? {}
      : { keyword: parseSingleKeyword(value.keyword, `${label}.keyword`) }),
    // One level only: a branch is parsed by this same function, and
    // nothing writes a branch that carries its own `anyOf`, so the
    // recursion terminates on the shape rather than on a depth counter.
    ...(value.anyOf === undefined
      ? {}
      : {
          anyOf: (() => {
            if (!Array.isArray(value.anyOf)) {
              throw new Error(`Invalid ${label}.anyOf`);
            }
            return value.anyOf.map((branch: unknown, index: number) =>
              parseSearchFilter(branch, `${label}.anyOf[${index}]`),
            );
          })(),
        }),
  };
}

function parseSingleKeyword(value: unknown, label: string): Keyword {
  const keyword = expectString(value, label);
  if (!KEYWORDS.has(keyword as Keyword)) {
    throw new Error(`Invalid ${label}`);
  }
  return keyword as Keyword;
}

function parseControlAllScope(value: unknown, label: string): ControlAllScope {
  const scope = expectString(value, label);
  if (scope !== "creatures" && scope !== "artifacts" && scope !== "permanents") {
    throw new Error(`Invalid ${label}`);
  }
  return scope;
}

function parseSearchDestination(value: unknown, label: string): SearchDestination {
  const destination = expectString(value, label);
  if (
    destination !== "hand" &&
    destination !== "battlefield" &&
    destination !== "graveyard" &&
    destination !== "exile" &&
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
    if (
      destination !== "hand" &&
      destination !== "library_bottom" &&
      destination !== "library_top" &&
      destination !== "exile"
    ) {
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
    scope !== "nonland" &&
    scope !== "permanents"
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return scope;
}

/**
 * A TOTAL record, not a chain of `!==`. The chain this replaced had already
 * fallen a member behind the union once, so a definition using the newest
 * filter compiled clean and then refused to load. A missing key here is a
 * type error; a missing arm of a chain is a silent one.
 */
const CARD_FILTERS: Record<CardFilter, true> = {
  any: true,
  creature: true,
  nontoken_creature: true,
  creature_or_planeswalker: true,
  land: true,
  nonland: true,
  noncreature_nonland: true,
  nonartifact_nonland: true,
  equipment: true,
  basic_land: true,
  token_creature: true,
  planeswalker: true,
  artifact: true,
  permanent: true,
  enchantment: true,
  battle: true,
  instant: true,
};

function parseCardFilter(value: unknown, label: string): CardFilter {
  const filter = expectString(value, label);
  if (!(filter in CARD_FILTERS)) {
    throw new Error(`Invalid ${label}`);
  }
  return filter as CardFilter;
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
    if (zone !== "hand" && zone !== "graveyard" && zone !== "battlefield" && zone !== "exile") {
      throw new Error(`Invalid ${label}[${index}].zone`);
    }
    return {
      playerId: parsePlayerSelector(entry.playerId, `${label}[${index}].playerId`),
      zone,
      filter: parseCardFilter(entry.filter, `${label}[${index}].filter`),
      ...(entry.excludeSelf === true ? { excludeSelf: true } : {}),
      ...(entry.drawnThisTurn === true ? { drawnThisTurn: true } : {}),
      ...(entry.milledThisWay === true ? { milledThisWay: true } : {}),
      ...(entry.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(entry.maxManaValue, "chooseSource.maxManaValue") }),
      ...(entry.hasVoidCounter === true ? { hasVoidCounter: true } : {}),
      ...(Array.isArray(entry.sharesTypes)
        ? { sharesTypes: parseStringList(entry.sharesTypes, `${label}[${index}].sharesTypes`) }
        : {}),
      ...(entry.sharesTypeWithChosen === true ? { sharesTypeWithChosen: true } : {}),
      ...(entry.excludePreviousChoice === true ? { excludePreviousChoice: true } : {}),
      ...(entry.maxManaValueOfSubject === true ? { maxManaValueOfSubject: true } : {}),
      ...(entry.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(entry.maxManaValue, "chooseSource.maxManaValue") }),
      ...(entry.greatestManaValue === true ? { greatestManaValue: true } : {}),
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
    if (zone !== "hand" && zone !== "graveyard" && zone !== "battlefield" && zone !== "exile") {
      throw new Error(`Invalid ${label}[${index}].zone`);
    }
    return {
      playerId,
      zone,
      filter: parseCardFilter(entry.filter, `${label}[${index}].filter`),
      ...(typeof entry.excludeCardId === "string"
        ? { excludeCardId: entry.excludeCardId }
        : {}),
      ...(entry.drawnThisTurn === true ? { drawnThisTurn: true } : {}),
      ...(entry.milledThisWay === true ? { milledThisWay: true } : {}),
      ...(entry.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(entry.maxManaValue, "chooseSource.maxManaValue") }),
      ...(entry.hasVoidCounter === true ? { hasVoidCounter: true } : {}),
      ...(Array.isArray(entry.sharesTypes)
        ? { sharesTypes: parseStringList(entry.sharesTypes, `${label}[${index}].sharesTypes`) }
        : {}),
      ...(entry.sharesTypeWithChosen === true ? { sharesTypeWithChosen: true } : {}),
      ...(entry.maxManaValueOfSubject === true ? { maxManaValueOfSubject: true } : {}),
      ...(entry.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(entry.maxManaValue, "chooseSource.maxManaValue") }),
      ...(entry.greatestManaValue === true ? { greatestManaValue: true } : {}),
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

/**
 * Every TargetKind a saved state may name. Written as a TOTAL record so that
 * adding a union member without listing it here is a tsc error: this guard
 * used to be a forty-line chain of `kind !== "..."` comparisons, and an
 * omission there is the expensive kind of drift -- the card compiles with no
 * notes and the definition then fails to LOAD.
 */
/**
 * A mana ability's sacrifice-cost scopes. A TOTAL record, not a chain of
 * `=== "creature" || …`: the chain this replaced had fallen two members
 * behind the union, so a Bolas's Citadel or Fountainport ability lost its
 * cost crossing the wire and came back free. A missing key here is a type
 * error; a missing arm of a chain is a silent one.
 */
type ManaCostSacrifice = NonNullable<ManaAbility["costSacrifice"]>;
const MANA_COST_SACRIFICE_SCOPES: Record<ManaCostSacrifice, true> = {
  creature: true,
  artifact: true,
  creature_or_artifact: true,
  land: true,
  treasure: true,
  nonland_permanent: true,
  permanent: true,
  token: true,
};

const TARGET_KINDS: Record<TargetKind, true> = {
  player: true,
  opponent: true,
  creature: true,
  own_creature: true,
  permanent: true,
  creature_or_planeswalker: true,
  artifact: true,
  enchantment: true,
  artifact_or_enchantment: true,
  creature_or_artifact: true,
  creature_or_enchantment: true,
  creature_enchantment_or_planeswalker: true,
  nonland_permanent: true,
  noncreature_nonland_permanent: true,
  own_graveyard_card: true,
  own_graveyard_creature_card: true,
  own_graveyard_permanent_card: true,
  own_graveyard_artifact_card: true,
  own_graveyard_enchantment_card: true,
  own_graveyard_land_card: true,
  own_graveyard_instant_or_sorcery_card: true,
  own_graveyard_creature_or_planeswalker_card: true,
  graveyard_creature_card: true,
  graveyard_card: true,
  artifact_creature_or_land: true,
  nonartifact_creature: true,
  land: true,
  artifact_enchantment_or_nonbasic_land: true,
  artifact_enchantment_or_land: true,
  artifact_creature_enchantment_or_land: true,
  artifact_creature_or_planeswalker_spell: true,
  artifact_enchantment_or_planeswalker: true,
  artifact_creature_or_planeswalker: true,
  planeswalker: true,
  commander: true,
  player_or_creature: true,
  player_or_planeswalker: true,
  spell: true,
  creature_spell: true,
  noncreature_spell: true,
  instant_spell: true,
  instant_or_sorcery_spell: true,
  enchantment_instant_or_sorcery_spell: true,
  spell_or_permanent: true,
  spell_or_ability: true,
  triggered_ability_you_control: true,
  instant_sorcery_or_ability: true,
};

function parseTargetRequirement(value: unknown, label: string): TargetRequirement {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const raw = expectString(value.kind, `${label}.kind`);
  if (!Object.hasOwn(TARGET_KINDS, raw)) {
    throw new Error(`Invalid ${label}.kind`);
  }
  const kind = raw as TargetKind;
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
    // Agadeem's Awakening: both bounds ride the requirement, and losing
    // either on the wire turns the spell into a graveyard-wide reanimate.
    ...(Array.isArray(value.requiredSubtypesAny)
      ? {
          requiredSubtypesAny: expectStringArray(
            value.requiredSubtypesAny,
            `${label}.requiredSubtypesAny`,
          ),
        }
      : {}),
    ...(Array.isArray(value.requiredTypesAny)
      ? {
          requiredTypesAny: expectStringArray(
            value.requiredTypesAny,
            `${label}.requiredTypesAny`,
          ),
        }
      : {}),
    ...(value.targetsYouOrYours === true ? { targetsYouOrYours: true } : {}),
    ...(value.maxManaValueX === true ? { maxManaValueX: true } : {}),
    ...(value.maxPowerX === true ? { maxPowerX: true } : {}),
    ...(value.maxManaValuePlusSacrificed === undefined
      ? {}
      : {
          maxManaValuePlusSacrificed: expectNumber(
            value.maxManaValuePlusSacrificed,
            `${label}.maxManaValuePlusSacrificed`,
          ),
        }),
    ...(value.distinctManaValues === true ? { distinctManaValues: true } : {}),
    ...(value.optional === true ? { optional: true } : {}),
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
    ...(value.minPower === undefined
      ? {}
      : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
    ...(value.multicolored === true ? { multicolored: true } : {}),
    ...(value.legendaryOnly === true ? { legendaryOnly: true } : {}),
    ...(value.commanderOnly === true ? { commanderOnly: true } : {}),
    ...(value.nonlegendaryOnly === true ? { nonlegendaryOnly: true } : {}),
    ...(value.nontoken === true ? { nontoken: true } : {}),
    ...(value.nonbasicOnly === true ? { nonbasicOnly: true } : {}),
    ...(value.manaValueEqualsX === true ? { manaValueEqualsX: true } : {}),
    ...(value.nonTokenOnly === true ? { nonTokenOnly: true } : {}),
    ...(value.tokenTargetOnly === true ? { tokenTargetOnly: true } : {}),
    ...(value.manaValueBelowSubject === true ? { manaValueBelowSubject: true } : {}),
    ...(value.attackingOnly === true ? { attackingOnly: true } : {}),
    ...(value.attackingOrBlockingOnly === true ? { attackingOrBlockingOnly: true } : {}),
    ...(value.singleTargetOnly === true ? { singleTargetOnly: true } : {}),
    ...(() => {
      const requiredSubtypes = parseStringList(value.requiredSubtypes, `${label}.requiredSubtypes`);
      return requiredSubtypes.length > 0 ? { requiredSubtypes } : {};
    })(),
    ...(() => {
      const excludedSubtypes = parseStringList(value.excludedSubtypes, `${label}.excludedSubtypes`);
      return excludedSubtypes.length > 0 ? { excludedSubtypes } : {};
    })(),
    ...(() => {
      const excludedTypes = parseStringList(value.excludedTypes, `${label}.excludedTypes`);
      return excludedTypes.length > 0 ? { excludedTypes } : {};
    })(),
    ...(value.owner === "own" ? { owner: "own" as const } : {}),
    ...(() => {
      if (value.requiredColors === undefined) {
        return {};
      }
      if (!Array.isArray(value.requiredColors)) {
        throw new Error(`Invalid ${label}.requiredColors`);
      }
      const requiredColors = value.requiredColors.map((entry, index) => {
        const color = expectString(entry, `${label}.requiredColors[${index}]`);
        if (!(COLOR_KEYS as readonly string[]).includes(color)) {
          throw new Error(`Invalid ${label}.requiredColors[${index}]`);
        }
        return color as Color;
      });
      return requiredColors.length > 0 ? { requiredColors } : {};
    })(),
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

function parseChosenTargetRef(value: unknown, label: string): { type: "chosen"; index: number } {
  if (!isRecord(value) || expectString(value.type, `${label}.type`) !== "chosen") {
    throw new Error(`Invalid ${label}`);
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
  if (type !== "chosen" && type !== "chosen_controller" && type !== "chosen_owner") {
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
          value.amount === "subject_amount" ||
          value.amount === "subject_toughness" ||
          value.amount === "target_power" ||
          value.amount === "target_toughness" ||
          value.amount === "sacrificed_power"
            ? value.amount
            : expectNumber(value.amount, `${label}.amount`),
        ...(isRecord(value.perControlledCreature)
          ? {
              perControlledCreature: {
                ...(value.perControlledCreature.minPower === undefined
                  ? {}
                  : {
                      minPower: expectNumber(
                        value.perControlledCreature.minPower,
                        `${label}.perControlledCreature.minPower`,
                      ),
                    }),
              },
            }
          : {}),
        ...(value.perSpellsCastThisTurn === true ? { perSpellsCastThisTurn: true } : {}),
      };
    case "add_poison":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount:
          value.amount === "subject_amount"
            ? value.amount
            : expectNumber(value.amount, `${label}.amount`),
      };
    case "lose_life":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount:
          value.amount === "subject_amount" ||
          value.amount === "target_mana_value" ||
          value.amount === "source_power" ||
          value.amount === "own_life_lost_this_turn" ||
          value.amount === "sacrificed_power"
            ? value.amount
            : expectNumber(value.amount, `${label}.amount`),
        // `perDynamicCount` was documented on the type and dropped here,
        // so Castle Locthwain's scaling did not survive a round trip —
        // the loss silently became a flat 1.
        ...(isDynamicCount(value.perDynamicCount)
          ? { perDynamicCount: value.perDynamicCount }
          : {}),
        ...(value.perCounterOnSource === undefined
          ? {}
          : {
              perCounterOnSource: expectString(
                value.perCounterOnSource,
                `${label}.perCounterOnSource`,
              ),
            }),
      };
    case "draw":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count:
          value.count === "sacrificed_power"
            ? "sacrificed_power"
            : value.count === "x"
              ? ("x" as const)
              : value.count === "subject_amount"
                ? ("subject_amount" as const)
                : expectNumber(value.count, `${label}.count`),
        ...(value.optional === true ? { optional: true } : {}),
        ...(() => {
          if (!isRecord(value.countFromGreatestPower)) {
            return {};
          }
          const nonSubtypes = parseStringList(
            value.countFromGreatestPower.nonSubtypes,
            `${label}.countFromGreatestPower.nonSubtypes`,
          );
          const stat =
            value.countFromGreatestPower.stat === "toughness"
              ? ({ stat: "toughness" } as const)
              : {};
          return {
            countFromGreatestPower: {
              ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
              ...stat,
            },
          };
        })(),
        ...(value.countPerControlled === "creature" ? { countPerControlled: "creature" } : {}),
        ...(value.countFromCreaturesDied === true ? { countFromCreaturesDied: true } : {}),
        ...(value.countPerOpponent === true ? { countPerOpponent: true } : {}),
        ...(isRecord(value.countFromDynamicPlus)
          ? {
              countFromDynamicPlus: {
                count: parseDynamicCount(
                  value.countFromDynamicPlus.count,
                  `${label}.countFromDynamicPlus.count`,
                ),
                plus: expectNumber(
                  value.countFromDynamicPlus.plus,
                  `${label}.countFromDynamicPlus.plus`,
                ),
              },
            }
          : {}),
        ...(value.countFromChosenTypePermanents === true
          ? { countFromChosenTypePermanents: true }
          : {}),
        // Same drop as lose_life above: Inspiring Call's per-count draw
        // came back as a flat 1.
        ...(isDynamicCount(value.perDynamicCount)
          ? { perDynamicCount: value.perDynamicCount }
          : {}),
        ...(value.countFromCounterOnSource === undefined
          ? {}
          : {
              countFromCounterOnSource: expectString(
                value.countFromCounterOnSource,
                `${label}.countFromCounterOnSource`,
              ),
            }),
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
        amount: value.amount === "x" ? ("x" as const) : expectNumber(value.amount, `${label}.amount`),
        ...(value.subtype === undefined
          ? {}
          : { subtype: expectString(value.subtype, `${label}.subtype`) }),
      };
    case "look_and_assign":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        // Thassa's Oracle carries no slots: they are synthesized at bind
        // from a devotion-sized count. Demanding a non-empty list here
        // would make the DEFINITION fail to load, which is a card that
        // never reaches the table rather than one that plays wrong.
        destinations:
          value.upToOneOnTop === true && Array.isArray(value.destinations)
            ? []
            : parseLookDestinations(value.destinations, `${label}.destinations`),
        ...(value.hideawayFromSource === true ? { hideawayFromSource: true } : {}),
        ...(value.exilePlayableThisTurn === true ? { exilePlayableThisTurn: true } : {}),
        ...(value.countFromDevotion === undefined
          ? {}
          : {
              countFromDevotion: parseColor(
                value.countFromDevotion,
                `${label}.countFromDevotion`,
              ),
            }),
        ...(value.upToOneOnTop === true ? { upToOneOnTop: true } : {}),
      };
    case "play_hidden_card":
      return { kind, ...(value.free === true ? { free: true } : {}) };
    case "grant_self_activated":
      return {
        kind,
        ability: parseActivatedAbilities([value.ability], `${label}.ability`)[0]!,
      };
    case "grant_self_mana":
      return {
        kind,
        ability: parseManaAbilities([value.ability], `${label}.ability`)[0]!,
      };
    case "grant_play_chosen":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.free === true ? { free: true } : {}),
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
        ...(value.optional === true ? { optional: true } : {}),
        ...(value.thenEffectsIfNone === undefined
          ? {}
          : {
              thenEffectsIfNone: parseCardEffects(
                value.thenEffectsIfNone,
                `${label}.thenEffectsIfNone`,
              ),
            }),
        ...(value.cantDiscards === undefined
          ? {}
          : { cantDiscards: expectNumber(value.cantDiscards, `${label}.cantDiscards`) }),
      };
    case "add_mana":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        mana: parsePartialMana(value.mana, `${label}.mana`),
        ...(value.perChosenPlayerHand === true ? { perChosenPlayerHand: true } : {}),
        ...(value.untilEndOfTurn === true ? { untilEndOfTurn: true } : {}),
        ...(value.anyColor === undefined
          ? {}
          : { anyColor: expectNumber(value.anyColor, `${label}.anyColor`) }),
      };
    case "deal_damage": {
      if (!isRecord(value.target)) {
        throw new Error(`Invalid ${label}.target`);
      }
      const targetType = expectString(value.target.type, `${label}.target.type`);
      const rawSource = value.sourceId;
      // Ram Through: the source may itself be a chosen target ref.
      let sourceId: string | null | { type: "chosen"; index: number };
      if (rawSource === null || typeof rawSource === "string") {
        sourceId = rawSource;
      } else if (isRecord(rawSource) && rawSource.type === "chosen") {
        sourceId = {
          type: "chosen",
          index: expectNumber(rawSource.index, `${label}.sourceId.index`),
        };
      } else {
        throw new Error(`Invalid ${label}.sourceId`);
      }
      const amount =
        value.amount === "x"
          ? ("x" as const)
          : value.amount === "sacrificed_power"
            ? ("sacrificed_power" as const)
            : value.amount === "chosen_power"
              ? ("chosen_power" as const)
              : value.amount === "subject_power"
                ? ("subject_power" as const)
                : value.amount === "subject_amount"
                ? ("subject_amount" as const)
                : value.amount === "milled_mana_value"
                ? ("milled_mana_value" as const)
                : isRecord(value.amount) && typeof value.amount.subtypeCount === "string"
                  ? { subtypeCount: value.amount.subtypeCount }
                  : isRecord(value.amount) && typeof value.amount.sourceCounters === "string"
                    ? { sourceCounters: value.amount.sourceCounters }
                    : expectNumber(value.amount, `${label}.amount`);
      const gainLife = value.gainLife === true ? { gainLife: true as const } : {};
      if (targetType === "player") {
        return {
          kind,
          amount,
          sourceId,
          ...gainLife,
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
          ...gainLife,
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
          ...gainLife,
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
        ...(value.perControlled === "land" ||
        value.perControlled === "creature" ||
        value.perControlled === "artifact"
          ? { perControlled: value.perControlled }
          : {}),
        ...(value.perControlledSubtype === undefined
          ? {}
          : {
              perControlledSubtype: expectString(
                value.perControlledSubtype,
                `${label}.perControlledSubtype`,
              ),
            }),
        ...(value.count === undefined
          ? {}
          : {
              count:
                value.count === "x"
                  ? ("x" as const)
                  : value.count === "sacrificed_power"
                    ? ("sacrificed_power" as const)
                    : expectNumber(value.count, `${label}.count`),
            }),
        ...(value.perDiedCreatures === true ? { perDiedCreatures: true } : {}),
        ...(value.countFromSubjectAmount === true ? { countFromSubjectAmount: true } : {}),
        ...(value.perSourceCounters === undefined
          ? {}
          : { perSourceCounters: expectString(value.perSourceCounters, `${label}.perSourceCounters`) }),
        ...(value.countFromSourcePower === true ? { countFromSourcePower: true } : {}),
        ...(value.entersTappedAttacking === true ? { entersTappedAttacking: true } : {}),
        ...(value.attackingEachOpponent === true ? { attackingEachOpponent: true } : {}),
        ...(isRecord(value.bonusPt)
          ? {
              bonusPt: {
                power: expectNumber(value.bonusPt.power, `${label}.bonusPt.power`),
                toughness: expectNumber(value.bonusPt.toughness, `${label}.bonusPt.toughness`),
                per: parseDynamicCount(value.bonusPt.per, `${label}.bonusPt.per`),
              },
            }
          : {}),
        ...(value.entersTapped === true ? { entersTapped: true } : {}),
        ...(value.colors === undefined
          ? {}
          : { colors: parseColorArray(value.colors, `${label}.colors`) }),
        ...(value.atEndStep === "sacrifice" || value.atEndStep === "exile"
          ? { atEndStep: value.atEndStep }
          : {}),
        ...(value.copySelfIfLandsAtLeast === undefined
          ? {}
          : {
              copySelfIfLandsAtLeast: expectNumber(
                value.copySelfIfLandsAtLeast,
                `${label}.copySelfIfLandsAtLeast`,
              ),
            }),
      };
    case "move_card": {
      const toZone = expectString(value.toZone, `${label}.toZone`);
      if (toZone === "stack" || !ZONE_KEYS.includes(toZone as (typeof ZONE_KEYS)[number])) {
        throw new Error(`Invalid ${label}.toZone`);
      }
      // Approach of the Second Sun: "seventh from the top" is the one
      // numeric position any card names.
      const libraryPosition: LibraryPosition | undefined = isRecord(value.libraryPosition)
        ? { fromTop: expectNumber(value.libraryPosition.fromTop, `${label}.libraryPosition.fromTop`) }
        : (value.libraryPosition as LibraryPosition | undefined);
      if (
        libraryPosition !== undefined &&
        typeof libraryPosition !== "object" &&
        libraryPosition !== "top" &&
        libraryPosition !== "bottom" &&
        libraryPosition !== "shuffled"
      ) {
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
        ...(value.exileIfLeaves === true ? { exileIfLeaves: true } : {}),
        ...(value.putByAbilityOf === true ? { putByAbilityOf: true } : {}),
        ...(value.destroy === true ? { destroy: true } : {}),
        ...(value.denyRegeneration === true ? { denyRegeneration: true } : {}),
        ...(value.transformed === true ? { transformed: true } : {}),
        ...(value.underControlOf === "controller" ? { underControlOf: "controller" } : {}),
        ...(isRecord(value.withCounter)
          ? {
              withCounter: {
                counter: expectString(value.withCounter.counter, `${label}.withCounter.counter`),
                amount: expectNumber(value.withCounter.amount, `${label}.withCounter.amount`),
              },
            }
          : {}),
      };
    }
    case "become_copy":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        target: parseChosenTargetRef(value.target, `${label}.target`),
        ...(value.untilEot === true ? { untilEot: true } : {}),
        ...(value.keepAbilities === true ? { keepAbilities: true } : {}),
      };
    case "shuffle_zones_into_library":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        zones: parseShuffleZones(value.zones, `${label}.zones`),
      };
    case "tap":
    case "untap":
    case "remove_from_combat":
    case "tap_or_untap":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "types_until_eot":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        types: expectStringArray(value.types, `${label}.types`),
      };
    case "mill":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count:
          value.count === "sacrificed_power"
            ? "sacrificed_power"
            : value.count === "subject_amount"
              ? "subject_amount"
              : expectNumber(value.count, `${label}.count`),
      };
    case "double_all_counters":
    case "phase_out": {
      if (!Array.isArray(value.cardIds)) {
        throw new Error(`Invalid ${label}.cardIds`);
      }
      return {
        kind,
        cardIds: value.cardIds.map((entry, index) =>
          parseCardIdSelector(entry, `${label}.cardIds[${index}]`),
        ),
        ...(value.allChosen === true ? { allChosen: true } : {}),
        ...(value.allControlled === true ? { allControlled: true } : {}),
      };
    }
    case "discard":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        ...(value.countFromCreaturesDied === true ? { countFromCreaturesDied: true } : {}),
        ...(value.conniveCounterOn === undefined
          ? {}
          : {
              conniveCounterOn: parseCardIdSelector(
                value.conniveCounterOn,
                `${label}.conniveCounterOn`,
              ),
            }),
      };
    case "discard_random":
    case "exile_top":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
      };
    case "exile_top_to_hand":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "living_death":
      return { kind };
    case "may_sacrifice": {
      if (value.what !== "land" && value.what !== "another_creature") {
        throw new Error(`Invalid ${label}.what`);
      }
      return {
        kind,
        what: value.what,
        effects: parseCardEffects(value.effects, `${label}.effects`),
      };
    }
    case "exile_targets_into_tokens": {
      if (!isRecord(value.token)) {
        throw new Error(`Invalid ${label}.token`);
      }
      return {
        kind,
        token: {
          name: expectString(value.token.name, `${label}.token.name`),
          typeLine: expectString(value.token.typeLine, `${label}.token.typeLine`),
          power: expectNumber(value.token.power, `${label}.token.power`),
          toughness: expectNumber(value.token.toughness, `${label}.token.toughness`),
        },
      };
    }
    case "look_top_take_matching":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        filter: parseSearchFilter(value.filter, `${label}.filter`),
        ...(value.chosenSubtypeOfSource === true
          ? { chosenSubtypeOfSource: true }
          : {}),
      };
    case "sacrifice":
    case "sacrifice_or_discard_chosen":
    case "imprint":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
      };
    case "repeat_x_times":
      return {
        kind,
        effects: parseCardEffects(value.effects, `${label}.effects`),
      };
    case "add_counter":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        counter: expectString(value.counter, `${label}.counter`),
        amount:
          value.amount === "source_power"
            ? ("source_power" as const)
            : value.amount === "subject_amount"
              ? ("subject_amount" as const)
              : value.amount === "sacrificed_power"
                ? ("sacrificed_power" as const)
                : expectNumber(value.amount, `${label}.amount`),
        ...(isDynamicCount(value.perDynamicCount)
          ? { perDynamicCount: value.perDynamicCount }
          : {}),
        ...(value.dynamicOffset === undefined
          ? {}
          : { dynamicOffset: expectNumber(value.dynamicOffset, `${label}.dynamicOffset`) }),
      };
    case "remove_counter":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        counter: expectString(value.counter, `${label}.counter`),
        amount: expectNumber(value.amount, `${label}.amount`),
        ...(value.sacrificeWhenEmpty === true ? { sacrificeWhenEmpty: true } : {}),
      };
    case "move_all_counters":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        target: parseChosenTargetRef(value.target, `${label}.target`),
      };
    case "move_counter":
      return {
        kind,
        from: parseChosenTargetRef(value.from, `${label}.from`),
        to: parseChosenTargetRef(value.to, `${label}.to`),
      };
    case "distribute_counters":
      return {
        kind,
        counter: expectString(value.counter, `${label}.counter`),
        amount: expectNumber(value.amount, `${label}.amount`),
        targets: expectList(value.targets, `${label}.targets`).map((entry, index) =>
          parseChosenTargetRef(entry, `${label}.targets[${index}]`),
        ),
      };
    case "copy_subject_spell":
    case "counter_subject_spell":
      return { kind };
    case "extra_combat":
      return {
        kind,
        ...(value.untapAtBeginning === true ? { untapAtBeginning: true } : {}),
      };
    case "fog":
      return {
        kind,
        ...(value.forPlayerId === undefined
          ? {}
          : { forPlayerId: parsePlayerSelector(value.forPlayerId, `${label}.forPlayerId`) }),
        ...(isRecord(value.tokenPerDamage)
          ? {
              tokenPerDamage: parseCardEffect(
                value.tokenPerDamage,
                `${label}.tokenPerDamage`,
              ) as Extract<CardEffect, { kind: "create_token" }>,
            }
          : {}),
      };
    case "windfall":
      return {
        kind,
        ...(value.drawCount === undefined
          ? {}
          : { drawCount: expectNumber(value.drawCount, `${label}.drawCount`) }),
      };
    case "copy_each_token":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
      };
    case "bounce_each_creature":
      return {
        kind,
        ...(value.unlessCounter === undefined
          ? {}
          : { unlessCounter: expectString(value.unlessCounter, `${label}.unlessCounter`) }),
        ...(value.onlyAttacking === true ? { onlyAttacking: true } : {}),
        ...(value.exceptChosenType === true ? { exceptChosenType: true } : {}),
      };
    case "dig_top": {
      const digDestination = expectString(value.destination, `${label}.destination`);
      if (
        digDestination !== "hand" &&
        digDestination !== "battlefield" &&
        digDestination !== "battlefield_tapped"
      ) {
        throw new Error(`Invalid ${label}.destination`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        filter: parseSearchFilter(value.filter, `${label}.filter`),
        destination: digDestination,
        ...(value.restTo === "graveyard" || value.restTo === "bottom"
          ? { restTo: value.restTo }
          : {}),
      };
    }
    case "untap_all": {
      const what = expectString(value.what, `${label}.what`);
      if (what !== "creature" && what !== "land" && what !== "attacking" && what !== "nonland") {
        throw new Error(`Invalid ${label}.what`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        what,
        ...(value.excludeSource === true ? { excludeSource: true } : {}),
        ...(value.subtypes === undefined
          ? {}
          : { subtypes: parseStringList(value.subtypes, `${label}.subtypes`) }),
      };
    }
    case "exert":
      return { kind, cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) };
    case "tap_all": {
      const tapWhat = expectString(value.what, `${label}.what`);
      if (tapWhat !== "creature" && tapWhat !== "land") {
        throw new Error(`Invalid ${label}.what`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        what: tapWhat,
      };
    }
    case "goad":
      return { kind, target: parseChosenTargetRef(value.target, `${label}.target`) };
    case "goad_all":
    case "must_attack_all":
      return { kind };
    case "attackers_gain_keyword_until_eot": {
      const attackersKeyword = expectString(value.keyword, `${label}.keyword`);
      if (!KEYWORDS.has(attackersKeyword as Keyword)) {
        throw new Error(`Invalid ${label}.keyword`);
      }
      return { kind, keyword: attackersKeyword as Keyword };
    }
    case "gain_control":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.untilEot === true ? { untilEot: true } : {}),
      };
    case "gain_control_all":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        what: parseControlAllScope(value.what, `${label}.what`),
        ...(value.fromId === undefined
          ? {}
          : { fromId: parsePlayerSelector(value.fromId, `${label}.fromId`) }),
        ...(value.untilEot === true ? { untilEot: true } : {}),
      };
    case "restore_control":
      return { kind, what: parseControlAllScope(value.what, `${label}.what`) };
    case "double_counters_on":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        counter: expectString(value.counter, `${label}.counter`),
      };
    case "double_counters_on_team":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        counter: expectString(value.counter, `${label}.counter`),
      };
    case "if_condition":
      return {
        kind,
        condition: parseTriggerCondition(value.condition, `${label}.condition`),
        then: parseCardEffects(value.then, `${label}.then`),
        ...(value.otherwise === undefined
          ? {}
          : { otherwise: parseCardEffects(value.otherwise, `${label}.otherwise`) }),
      };
    case "ring_tempts":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "sacrifice_blocker_at_end_of_combat":
      return { kind };
    case "proliferate":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.thenPhaseOutTouched === true ? { thenPhaseOutTouched: true } : {}),
      };
    case "populate":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "exile_top_play":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        ...(value.freeCast === true ? { freeCast: true } : {}),
        ...(value.untilEndOfNextTurn === true ? { untilEndOfNextTurn: true } : {}),
        ...(value.untilNonland === true ? { untilNonland: true } : {}),
      };
    case "exile_return_end_step":
      return {
        kind,
        // Nezahal blinks ITSELF, so there is no target to read.
        ...(value.self === true
          ? { self: true }
          : { target: parseChosenTargetRef(value.target, `${label}.target`) }),
        ...(value.toOwner === true ? { toOwner: true } : {}),
        ...(value.returnsTapped === true ? { returnsTapped: true } : {}),
        ...(value.withCounter === undefined
          ? {}
          : { withCounter: expectString(value.withCounter, `${label}.withCounter`) }),
      };
    case "exile_return_end_step_all":
      return { kind };
    case "adapt":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        amount: expectNumber(value.amount, `${label}.amount`),
      };
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
    case "exile_spell":
      // Its own case, not folded into the group below: only this one takes
      // "any number of target spells", and only that group carries
      // counter_spell's `exileInstead`.
      return value.target === "all_chosen"
        ? { kind, target: "all_chosen" }
        : { kind, target: parseChosenTargetRef(value.target, `${label}.target`) };
    case "grant_protection_choice":
    case "counter_spell":
    case "mill_and_dig_free":
    case "copy_spell": {
      // Rings of Brighthearth: the targetless "copy that ability" form.
      if (kind === "copy_spell" && value.fromSubject === true) {
        return { kind, fromSubject: true };
      }
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
        ...(kind === "counter_spell" && value.exileInstead === true
          ? { exileInstead: true }
          : {}),
      };
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
    case "bounce_spell_or_permanent": {
      const target = value.target;
      if (!isRecord(target) || target.type !== "chosen") {
        throw new Error(`Invalid ${label}.target`);
      }
      return {
        kind,
        target: { type: "chosen", index: expectNumber(target.index, `${label}.target.index`) },
      };
    }
    case "exchange_life_toughness":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "pt_until_eot":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        // Both sides are read the same way: a number, or one of the variable
        // terms the bind step resolves. "x" was admitted by the type but not
        // by this parser, so an announced-X pump round-tripped as an error.
        power:
          value.power === "target_power"
            ? "target_power"
            : value.power === "x"
              ? "x"
              : value.power === "minus_x"
                ? "minus_x"
                : expectNumber(value.power, `${label}.power`),
        toughness:
          value.toughness === "x"
            ? "x"
            : value.toughness === "minus_x"
              ? "minus_x"
              : expectNumber(value.toughness, `${label}.toughness`),
        ...(value.per === undefined
          ? {}
          : isDynamicCount(value.per)
            ? { per: value.per }
            : (() => {
                throw new Error(`Invalid ${label}.per`);
              })()),
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
    case "team_set_pt_until_eot":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        power: value.power === "x" ? ("x" as const) : expectNumber(value.power, `${label}.power`),
        toughness:
          value.toughness === "x"
            ? ("x" as const)
            : expectNumber(value.toughness, `${label}.toughness`),
        ...(value.allCreatureTypes === true ? { allCreatureTypes: true } : {}),
      };
    case "team_pt_until_eot": {
      const nonSubtypes = parseStringList(value.nonSubtypes, `${label}.nonSubtypes`);
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        // The type has allowed "greatest_power" and "x" all along; only
        // "creature_count" was parsed, so Overwhelming Stampede and Finale
        // of Devastation made definitions that could not be LOADED.
        power: parseTeamPtTerm(value.power, `${label}.power`),
        toughness: parseTeamPtTerm(value.toughness, `${label}.toughness`),
        ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
        ...(value.minPower === undefined
          ? {}
          : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
      };
    }
    case "team_keyword_until_eot": {
      const keyword = expectString(value.keyword, `${label}.keyword`);
      if (!KEYWORDS.has(keyword as Keyword)) {
        throw new Error(`Invalid ${label}.keyword`);
      }
      const nonSubtypes = parseStringList(value.nonSubtypes, `${label}.nonSubtypes`);
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        keyword: keyword as Keyword,
        ...(value.untilYourNextTurn === true ? { untilYourNextTurn: true } : {}),
        ...(value.scope === "permanents" ? { scope: "permanents" } : {}),
        ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
        ...(value.minPower === undefined
          ? {}
          : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
      };
    }
    case "protection_until_eot":
    case "hexproof_from_until_eot":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        colors: parseColorArray(value.colors, `${label}.colors`),
      };
    case "team_hexproof_from_until_eot":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        colors: parseColorArray(value.colors, `${label}.colors`),
        ...(value.includePlayer === true ? { includePlayer: true } : {}),
      };
    case "spells_uncounterable_this_turn":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "team_protection_until_eot": {
      if (!Array.isArray(value.colors)) {
        throw new Error(`Invalid ${label}.colors`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        colors: value.colors.map((entry, index) => {
          const color = expectString(entry, `${label}.colors[${index}]`);
          if (!(COLOR_KEYS as readonly string[]).includes(color)) {
            throw new Error(`Invalid ${label}.colors[${index}]`);
          }
          return color as Color;
        }),
      };
    }
    case "all_pt_until_eot":
      return {
        kind,
        power: value.power === "-x" ? "-x" : expectNumber(value.power, `${label}.power`),
        toughness:
          value.toughness === "-x" ? "-x" : expectNumber(value.toughness, `${label}.toughness`),
        ...(value.exceptChosenType === true ? { exceptChosenType: true } : {}),
      };
    case "all_restrict_until_eot":
      return {
        kind,
        ...(value.cantAttack === true ? { cantAttack: true } : {}),
        ...(value.cantBlock === true ? { cantBlock: true } : {}),
        ...(value.cantBeBlocked === true ? { cantBeBlocked: true } : {}),
        ...(value.withoutKeyword === undefined
          ? {}
          : { withoutKeyword: parseKeywords([value.withoutKeyword], `${label}.withoutKeyword`)[0]! }),
        ...(value.withKeyword === undefined
          ? {}
          : { withKeyword: parseKeywords([value.withKeyword], `${label}.withKeyword`)[0]! }),
      };
    case "grant_next_spell":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.improvise === true ? { improvise: true } : {}),
        ...(value.cantBeCountered === true ? { cantBeCountered: true } : {}),
      };
    case "reveal_top_put_permanent":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
      };
    case "silence":
    case "silence_noncreature":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
      };
    case "drain_opponents":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        amount:
          value.amount === "x"
            ? "x"
            : isRecord(value.amount)
              ? (() => {
                  const devotion = expectString(value.amount.devotion, `${label}.amount.devotion`);
                  if (!(COLOR_KEYS as readonly string[]).includes(devotion)) {
                    throw new Error(`Invalid ${label}.amount.devotion`);
                  }
                  return { devotion: devotion as Color };
                })()
              : expectNumber(value.amount, `${label}.amount`),
      };
    case "choose_card_name":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.onSelf === true ? { onSelf: true } : {}),
      };
    case "tempting_offer":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        action: parseCardEffects(value.action, `${label}.action`),
      };
    case "tap_own_for_x":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        subtype: expectString(value.subtype, `${label}.subtype`),
        rider: parseCardEffects(value.rider, `${label}.rider`),
      };
    case "exile_until_taken":
    case "extra_turn":
    case "deny_extra_turns":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "exile_until_source_leaves":
      return { kind, target: parseChosenTargetRef(value.target, `${label}.target`) };
    case "return_exiled_by_source":
      return { kind };
    case "commander_cast_counters":
      return { kind, cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) };
    case "cast_free_copy":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
      };
    case "grant_cast_this_turn":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.locksCastingAfter === true ? { locksCastingAfter: true } : {}),
      };
    case "punisher_choice":
      return {
        kind,
        chooserId: parsePlayerSelector(value.chooserId, `${label}.chooserId`),
        ifTaken: parseCardEffects(value.ifTaken, `${label}.ifTaken`),
        ifDeclined: parseCardEffects(value.ifDeclined, `${label}.ifDeclined`),
      };
    case "divide_into_piles":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        dividerId: parsePlayerSelector(value.dividerId, `${label}.dividerId`),
        count: expectNumber(value.count, `${label}.count`),
        taken: parsePileZone(value.taken, `${label}.taken`),
        left: parsePileZone(value.left, `${label}.left`),
      };
    case "dig_until": {
      const digFound = expectString(value.found, `${label}.found`);
      const digRest = expectString(value.rest, `${label}.rest`);
      if (!DIG_FOUND_ZONES.has(digFound)) {
        throw new Error(`Invalid ${label}.found`);
      }
      if (!DIG_REST_ZONES.has(digRest)) {
        throw new Error(`Invalid ${label}.rest`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        filter: parseSearchFilter(value.filter, `${label}.filter`),
        found: digFound as DigFound,
        rest: digRest as DigRest,
        ...(value.optional === true ? { optional: true } : {}),
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
        ...(value.countFromGreatestPower === true ? { countFromGreatestPower: true } : {}),
        ...(value.untapIfLands === undefined
          ? {}
          : { untapIfLands: expectNumber(value.untapIfLands, `${label}.untapIfLands`) }),
        ...(value.landsToBattlefieldTapped === true
        ? { landsToBattlefieldTapped: true }
        : {}),
      ...(value.alsoGraveyard === true ? { alsoGraveyard: true } : {}),
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
        ...(value.attackingEachOpponent === true ? { attackingEachOpponent: true } : {}),
        ...(value.halvePtRoundUp === true ? { halvePtRoundUp: true } : {}),
        ...(value.onlyIfDied === true ? { onlyIfDied: true } : {}),
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
        ...(value.setColors === undefined
          ? {}
          : { setColors: parseColorArray(value.setColors, `${label}.setColors`) }),
        ...(value.addSubtypes === undefined
          ? {}
          : { addSubtypes: expectStringArray(value.addSubtypes, `${label}.addSubtypes`) }),
        ...(value.notLegendary === true ? { notLegendary: true } : {}),
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
        amount:
          value.amount === "source_power"
            ? ("source_power" as const)
            : expectNumber(value.amount, `${label}.amount`),
      };
    case "counter_on_each_creature":
      return {
        kind,
        counter: expectString(value.counter, `${label}.counter`),
        amount:
          value.amount === "x" ? ("x" as const) : expectNumber(value.amount, `${label}.amount`),
        ...(value.subtype === undefined
          ? {}
          : { subtype: expectString(value.subtype, `${label}.subtype`) }),
        ...(value.controlledOnly === true ? { controlledOnly: true } : {}),
        ...(value.opponentsOnly === true ? { opponentsOnly: true } : {}),
        ...(value.colors === undefined ? {} : { colors: parseColorArray(value.colors, `${label}.colors`) }),
        ...(value.enteredThisTurn === true ? { enteredThisTurn: true } : {}),
      };
    case "each_creature_damages_controller":
      return { kind, amount: expectNumber(value.amount, `${label}.amount`) };
    case "double_team_pt_until_eot":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "power_nova":
      return { kind, cardId: parseChosenTargetRef(value.cardId, `${label}.cardId`) };
    case "retarget":
      return {
        kind,
        target: parseChosenTargetRef(value.target, `${label}.target`),
        ...(value.toSelf === true ? { toSelf: true } : {}),
      };
    case "animate_until_eot":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        power: expectNumber(value.power, `${label}.power`),
        toughness: expectNumber(value.toughness, `${label}.toughness`),
        ...(value.ptFrom === undefined
          ? {}
          : { ptFrom: parseDynamicCount(value.ptFrom, `${label}.ptFrom`) }),
        ...(Array.isArray(value.subtypes)
          ? {
              subtypes: value.subtypes.map((subtype, index) =>
                expectString(subtype, `${label}.subtypes[${index}]`),
              ),
            }
          : {}),
        ...(Array.isArray(value.types)
          ? {
              types: value.types.map((type, index) =>
                expectString(type, `${label}.types[${index}]`),
              ),
            }
          : {}),
        ...(value.colors === undefined
          ? {}
          : { colors: parseColorArray(value.colors, `${label}.colors`) }),
        ...(value.allCreatureTypes === true ? { allCreatureTypes: true } : {}),
        ...(value.keywords === undefined
          ? {}
          : { keywords: parseKeywords(value.keywords, `${label}.keywords`) }),
      };
    case "add_turn_mana_echo":
      return { kind, echo: parseLandTapEcho(value.echo, `${label}.echo`) };
    case "choose_from_hand": {
      const destination = value.destination;
      if (destination !== "library_bottom" && destination !== "battlefield") {
        throw new Error(`Invalid ${label}.destination`);
      }
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        destination,
        ...(Array.isArray(value.types)
          ? {
              types: value.types.map((type, index) =>
                expectString(type, `${label}.types[${index}]`),
              ),
            }
          : {}),
        ...(value.thenDrawPlus === undefined
          ? {}
          : { thenDrawPlus: expectNumber(value.thenDrawPlus, `${label}.thenDrawPlus`) }),
      };
    }
    case "discover":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        maxManaValue:
          value.maxManaValue === "below_source"
            ? "below_source"
            : expectNumber(value.maxManaValue, `${label}.maxManaValue`),
        ...(value.toHandAllowed === true ? { toHandAllowed: true } : {}),
      };
    case "regenerate":
      return {
        kind,
        ...(value.allControlled === true
          ? { allControlled: true }
          : { cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) }),
      };
    case "sacrifice_others_of_type":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        cardType: expectString(value.cardType, `${label}.cardType`),
      };
    case "ban_attacks_while_counter":
      return {
        kind,
        counter: expectString(value.counter, `${label}.counter`),
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
      };
    case "searched_free_or_hand":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`),
      };
    case "look_top_card":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        viewerId: parsePlayerSelector(value.viewerId, `${label}.viewerId`),
      };
    case "add_subtypes":
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        subtypes: expectStringArray(value.subtypes, `${label}.subtypes`),
      };
    case "add_subtypes_all":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        what: "creature",
        subtypes: expectStringArray(value.subtypes, `${label}.subtypes`),
      };
    case "mass_reanimate":
    case "return_all_lands":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "return_all_from_graveyard":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        cardType: expectString(value.cardType, `${label}.cardType`),
        ...(value.gainsHaste === true ? { gainsHaste: true } : {}),
      };
    case "animate_controlled_until_eot":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        cardType: expectString(value.cardType, `${label}.cardType`),
        power: expectNumber(value.power, `${label}.power`),
        toughness: expectNumber(value.toughness, `${label}.toughness`),
      };
    case "prevent_combat_for":
      return { kind, cardId: parseChosenTargetRef(value.cardId, `${label}.cardId`) };
    case "extra_land_drop":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "grant_player_shield":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(value.protectionFromEverything === true
          ? { protectionFromEverything: true }
          : {}),
        ...(value.lifeLocked === true ? { lifeLocked: true } : {}),
      };
    case "win_game":
      // Split from the two below: they share a shape, but only this one
      // carries a condition, and a grouped return would drop it silently.
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(isRecord(value.ifSameNameCount)
          ? {
              ifSameNameCount: {
                type: expectString(
                  value.ifSameNameCount.type,
                  `${label}.ifSameNameCount.type`,
                ),
                atLeast: expectNumber(
                  value.ifSameNameCount.atLeast,
                  `${label}.ifSameNameCount.atLeast`,
                ),
              },
            }
          : {}),
        ...(value.ifDevotionAtLeastLibrary === undefined
          ? {}
          : {
              ifDevotionAtLeastLibrary: parseColor(
                value.ifDevotionAtLeastLibrary,
                `${label}.ifDevotionAtLeastLibrary`,
              ),
            }),
      };
    case "lose_game":
    case "grant_no_max_hand_size":
    case "grant_flash_this_turn":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "delayed_trigger": {
      const step = expectString(value.step, `${label}.step`);
      if (step !== "upkeep" && step !== "first_main_phase") {
        throw new Error(`Invalid ${label}.step`);
      }
      const whose = expectString(value.whose, `${label}.whose`);
      if (whose !== "controller" && whose !== "any") {
        throw new Error(`Invalid ${label}.whose`);
      }
      return {
        kind,
        step,
        whose,
        effects: parseCardEffects(value.effects, `${label}.effects`),
      };
    }
    case "grant_free_cast_from_hand": {
      const cap = value.maxManaValue;
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        ...(cap === undefined
          ? {}
          : {
              maxManaValue:
                cap === "x"
                  ? ("x" as const)
                  : cap === "subject_amount"
                    ? ("subject_amount" as const)
                    : expectNumber(cap, `${label}.maxManaValue`),
            }),
        count: expectNumber(value.count, `${label}.count`),
      };
    }
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
      ...(value.typesAny === undefined
        ? {}
        : { typesAny: parseStringList(value.typesAny, `${label}.typesAny`) }),
      ...(value.tapState === "tapped" || value.tapState === "untapped"
        ? { tapState: value.tapState }
        : {}),
      ...(value.withoutCounters === true ? { withoutCounters: true } : {}),
      ...(value.notEnchanted === true ? { notEnchanted: true } : {}),
      ...(value.notLegendary === true ? { notLegendary: true } : {}),
      ...(value.nontoken === true ? { nontoken: true } : {}),
      ...(value.coloredOnly === true ? { coloredOnly: true } : {}),
      ...(value.gainLifePerDestroyed === undefined
        ? {}
        : { gainLifePerDestroyed: expectNumber(value.gainLifePerDestroyed, `${label}.gainLifePerDestroyed`) }),
      ...(value.asSacrifice === true ? { asSacrifice: true } : {}),
      ...(value.denyRegeneration === true ? { denyRegeneration: true } : {}),
      ...(value.toZone === "exile" ? { toZone: "exile" } : {}),
        ...(value.typesAny === undefined
          ? {}
          : { typesAny: parseStringList(value.typesAny, `${label}.typesAny`) }),
        ...(value.tapState === "tapped" || value.tapState === "untapped"
          ? { tapState: value.tapState }
          : {}),
        ...(value.withoutCounters === true ? { withoutCounters: true } : {}),
        ...(value.notEnchanted === true ? { notEnchanted: true } : {}),
        ...(value.notLegendary === true ? { notLegendary: true } : {}),
        ...(value.nontoken === true ? { nontoken: true } : {}),
        ...(value.coloredOnly === true ? { coloredOnly: true } : {}),
        ...(value.gainLifePerDestroyed === undefined
          ? {}
          : { gainLifePerDestroyed: expectNumber(value.gainLifePerDestroyed, `${label}.gainLifePerDestroyed`) }),
        ...(value.asSacrifice === true ? { asSacrifice: true } : {}),
        ...(value.denyRegeneration === true ? { denyRegeneration: true } : {}),
        ...(value.toZone === "exile" ? { toZone: "exile" } : {}),
        ...(value.maxManaValue === undefined
          ? {}
          : { maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`) }),
        ...(value.minManaValue === undefined
          ? {}
          : { minManaValue: expectNumber(value.minManaValue, `${label}.minManaValue`) }),
        ...(value.minPower === undefined
          ? {}
          : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
        ...(value.minPowerAboveTarget === undefined
          ? {}
          : {
              minPowerAboveTarget: expectNumber(
                value.minPowerAboveTarget,
                `${label}.minPowerAboveTarget`,
              ),
            }),
        ...(value.exceptChosenType === true ? { exceptChosenType: true } : {}),
        ...(value.exceptSubtype === undefined
          ? {}
          : { exceptSubtype: expectString(value.exceptSubtype, `${label}.exceptSubtype`) }),
        ...(value.exceptTypes === undefined
          ? {}
          : { exceptTypes: parseStringList(value.exceptTypes, `${label}.exceptTypes`) }),
        ...(value.opponentsOnly === true ? { opponentsOnly: true } : {}),
        ...(value.onlySubtype === undefined
          ? {}
          : { onlySubtype: expectString(value.onlySubtype, `${label}.onlySubtype`) }),
        ...(value.addManaPerDestroyedOptions === undefined
          ? {}
          : {
              addManaPerDestroyedOptions: (() => {
                if (!Array.isArray(value.addManaPerDestroyedOptions)) {
                  throw new Error(`Invalid ${label}.addManaPerDestroyedOptions`);
                }
                return value.addManaPerDestroyedOptions.map((entry, index) =>
                  parseManaColor(entry, `${label}.addManaPerDestroyedOptions[${index}]`),
                );
              })(),
            }),
      };
    case "create_emblem":
      return {
        kind,
        ownerId: parsePlayerSelector(value.ownerId, `${label}.ownerId`),
        statics: parseStaticAbilities(value.statics, undefined, `${label}.statics`),
      };
    case "roll_die_treasures":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        sides: expectNumber(value.sides, `${label}.sides`),
      };
    case "cumulative_upkeep":
    case "echo":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        cost: expectString(value.cost, `${label}.cost`),
      };
    case "sacrifice_unless_sacrifice":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        scope: "land",
      };
    case "unless_pays":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        // Sylvan Library's cost is life, so the mana half is empty. An
        // empty string is rejected by default, which made the definition
        // fail to LOAD.
        cost: expectString(value.cost, `${label}.cost`, value.life !== undefined),
        ...(value.costFromPower === true ? { costFromPower: true } : {}),
        ...(value.life === undefined
          ? {}
          : { life: expectNumber(value.life, `${label}.life`) }),
        effects: parseCardEffects(value.effects, `${label}.effects`),
      };
    // Grouped with `unless_pays` above: both carry a mana half that may be
    // empty and an optional life half, and reading them apart is what let
    // the life cost fall off `may_pay` in the first place.
    case "may_pay":
      return {
        kind,
        playerId: parsePlayerSelector(value.playerId, `${label}.playerId`),
        cost: expectString(value.cost, `${label}.cost`, value.life !== undefined),
        ...(value.life === undefined
          ? {}
          : { life: expectNumber(value.life, `${label}.life`) }),
        effects: parseCardEffects(value.effects, `${label}.effects`),
        ...(value.requiresHostCreature === true ? { requiresHostCreature: true } : {}),
        ...(value.elseEffects === undefined
          ? {}
          : { elseEffects: parseCardEffects(value.elseEffects, `${label}.elseEffects`) }),
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
        // Chain Reaction: "creature_count" is in the type and emitted by
        // the compiler, but was not parsed — so the card compiled clean
        // and produced a definition that could not be loaded.
        amount:
          value.amount === "x" || value.amount === "creature_count"
            ? value.amount
            : expectNumber(value.amount, `${label}.amount`),
        ...(value.includePlayers === true ? { includePlayers: true } : {}),
      ...(value.opponentsOnly === true ? { opponentsOnly: true } : {}),
        ...(value.opponentsOnly === true ? { opponentsOnly: true } : {}),
      };
    case "flicker":
      return { kind, cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) };
    case "return_self_as_enchantment":
      return { kind, cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) };
    case "germ_attach":
      return { kind, cardId: parseCardIdSelector(value.cardId, `${label}.cardId`) };
    case "exile_graveyard":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "commander_to_hand":
      return { kind, playerId: parsePlayerSelector(value.playerId, `${label}.playerId`) };
    case "fight": {
      if (!isRecord(value.withTarget)) {
        throw new Error(`Invalid ${label}.withTarget`);
      }
      const targetIndex = expectNumber(value.withTarget.index, `${label}.withTarget.index`);
      return {
        kind,
        cardId: parseCardIdSelector(value.cardId, `${label}.cardId`),
        withTarget: { type: "chosen", index: targetIndex },
      };
    }
    case "opponents_lose_keywords_until_eot":
      return {
        kind,
        keywords: parseKeywords(value.keywords, `${label}.keywords`),
        ...(value.creaturesOnly === true ? { creaturesOnly: true } : {}),
        ...(value.alsoLock === true ? { alsoLock: true } : {}),
      };
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
      ...(entry.zone === "hand" || entry.zone === "graveyard" ? { zone: entry.zone } : {}),
      ...(entry.discard === true ? { discard: true } : {}),
      ...(entry.sacrificeSelf === true ? { sacrificeSelf: true } : {}),
      ...(entry.sacrificeCost === undefined
        ? {}
        : {
            sacrificeCost: (() => {
              const scope = expectString(entry.sacrificeCost, `${label}[${index}].sacrificeCost`);
              if (
                scope !== "creature" &&
                scope !== "another_creature" &&
                scope !== "another_black_creature" &&
                scope !== "artifact" &&
                scope !== "creature_or_artifact" &&
                scope !== "land" &&
                scope !== "treasure" &&
                scope !== "permanent" &&
                // These three were missing from the chain, which made any
                // definition using them fail to LOAD rather than merely
                // parse wrong.
                scope !== "another_creature_or_artifact" &&
                scope !== "nonland_permanent" &&
                scope !== "token"
              ) {
                throw new Error(`Invalid ${label}[${index}].sacrificeCost`);
              }
              return scope;
            })(),
          }),
      ...(entry.sacrificeSubtype === undefined
        ? {}
        : {
            sacrificeSubtype: expectString(
              entry.sacrificeSubtype,
              `${label}[${index}].sacrificeSubtype`,
            ),
          }),
      ...(entry.exileSelf === true ? { exileSelf: true } : {}),
      ...(entry.costTapCreatureOther === true ? { costTapCreatureOther: true } : {}),
      ...(entry.legendaryDiscount === true ? { legendaryDiscount: true } : {}),
      ...(entry.subtypeDiscount === undefined
        ? {}
        : { subtypeDiscount: expectString(entry.subtypeDiscount, `${label}[${index}].subtypeDiscount`) }),
      ...(entry.requiresOpponentMoreLands === true ? { requiresOpponentMoreLands: true } : {}),
      ...(entry.modes === undefined
        ? {}
        : { modes: parseSpellModes(entry.modes, `${label}[${index}].modes`) }),
      ...(entry.lifeCost === undefined
        ? {}
        : { lifeCost: expectNumber(entry.lifeCost, `${label}[${index}].lifeCost`) }),
      ...(entry.lifeCostFromCommanderColors === true
        ? { lifeCostFromCommanderColors: true }
        : {}),
      ...(entry.timing === "sorcery" || entry.timing === "your_turn"
        ? { timing: entry.timing }
        : {}),
      ...(entry.payWithChosenColorOnly === true ? { payWithChosenColorOnly: true } : {}),
      ...(entry.requiresControlled === undefined
        ? {}
        : {
            requiresControlled: parseControlledGate(
              entry.requiresControlled,
              `${label}[${index}].requiresControlled`,
            ),
          }),
      ...(entry.requiresAttackersThisTurn === undefined
        ? {}
        : {
            requiresAttackersThisTurn: expectNumber(
              entry.requiresAttackersThisTurn,
              `${label}[${index}].requiresAttackersThisTurn`,
            ),
          }),
      ...(isRecord(entry.removeCounterCost)
        ? {
            removeCounterCost: {
              counter: expectString(entry.removeCounterCost.counter, `${label}[${index}].removeCounterCost.counter`),
              count: expectNumber(entry.removeCounterCost.count, `${label}[${index}].removeCounterCost.count`),
            },
          }
        : {}),
      ...(isRecord(entry.addCounterCost)
        ? {
            addCounterCost: {
              counter: expectString(entry.addCounterCost.counter, `${label}[${index}].addCounterCost.counter`),
              count: expectNumber(entry.addCounterCost.count, `${label}[${index}].addCounterCost.count`),
            },
          }
        : {}),
      ...(isRecord(entry.discardCost)
        ? {
            discardCost: {
              count: expectNumber(entry.discardCost.count, `${label}[${index}].discardCost.count`),
              ...(entry.discardCost.types === undefined
                ? {}
                : { types: parseStringList(entry.discardCost.types, `${label}[${index}].discardCost.types`) }),
            },
          }
        : {}),
      ...(entry.millCost === undefined
        ? {}
        : { millCost: expectNumber(entry.millCost, `${label}[${index}].millCost`) }),
      ...(isRecord(entry.exileFromGraveyardCost)
        ? {
            exileFromGraveyardCost: {
              count: expectNumber(entry.exileFromGraveyardCost.count, `${label}[${index}].exileFromGraveyardCost.count`),
              ...(entry.exileFromGraveyardCost.types === undefined
                ? {}
                : { types: parseStringList(entry.exileFromGraveyardCost.types, `${label}[${index}].exileFromGraveyardCost.types`) }),
            },
          }
        : {}),
      ...(entry.sacrificeCount === undefined
        ? {}
        : { sacrificeCount: expectNumber(entry.sacrificeCount, `${label}[${index}].sacrificeCount`) }),
      ...(entry.sacrificeCountFromX === true ? { sacrificeCountFromX: true } : {}),
      ...(entry.xCost === undefined ? {} : { xCost: expectNumber(entry.xCost, `${label}.xCost`) }),
      ...(entry.requiresCreatedToken === true ? { requiresCreatedToken: true } : {}),
      ...(entry.requiresCondition === undefined
        ? {}
        : {
            requiresCondition: parseTriggerCondition(
              entry.requiresCondition,
              `${label}.requiresCondition`,
            ),
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
      ...(entry.replacesCost === undefined
        ? {}
        : {
            replacesCost: expectString(
              entry.replacesCost,
              `${label}[${index}].replacesCost`,
            ),
          }),
      ...(entry.dash === true ? { dash: true } : {}),
      effects: parseCardEffects(entry.effects, `${label}[${index}].effects`),
      targetRequirements: parseTargetRequirements(
        entry.targetRequirements,
        `${label}[${index}].targetRequirements`,
      ),
    };
  });
}

/**
 * Every TriggerEvent name, as a TOTAL record: omitting a union member is a
 * tsc error here rather than a definition that compiles clean and then fails
 * to LOAD. This was a hand-written comparison chain that silently fell
 * behind (it rejected becomes_tapped and opponent_draws_second on reload),
 * then a `satisfies TriggerEvent[]` array — which checks that every entry is
 * valid but not that every member is present.
 */
const TRIGGER_EVENT_NAMES: Record<TriggerEvent, true> = {
  activated_ability: true,
  class_level: true,
  you_lose_life: true,
  enter_battlefield: true,
  begin_combat: true,
  dies: true,
  leaves_battlefield: true,
  put_into_graveyard: true,
  chooses_ring_bearer: true,
  becomes_blocked: true,
  player_attacked: true,
  attacks: true,
  upkeep: true,
  end_step: true,
  you_gain_life: true,
  opponent_loses_life: true,
  cast_spell: true,
  deals_combat_damage_to_player: true,
  deals_damage_to_player: true,
  opponent_draws: true,
  you_create_token: true,
  you_sacrifice_token: true,
  becomes_untapped: true,
  becomes_tapped: true,
  plays_land: true,
  taps_for_mana: true,
  opponent_draws_second: true,
  opponent_draws_except_first: true,
  becomes_target: true,
  player_sacrifices: true,
  opponent_searches: true,
  casts_second_spell: true,
  opponent_casts_first_noncreature_spell: true,
  graveyard_from_elsewhere: true,
  leaves_your_graveyard: true,
  you_draw: true,
  is_dealt_damage: true,
  counter_added: true,
  discards: true,
  draw_step: true,
  first_main_phase: true,
};

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
    const eventName = expectString(entry.event, `${label}[${index}].event`);
    if (!Object.hasOwn(TRIGGER_EVENT_NAMES, eventName)) {
      throw new Error(`Invalid ${label}[${index}].event`);
    }
    const event = eventName as TriggerEvent;
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
              ...(() => {
                const subtypesAny = parseStringList(
                  entry.subjectFilter.subtypesAny,
                  `${label}[${index}].subjectFilter.subtypesAny`,
                );
                return subtypesAny.length > 0 ? { subtypesAny } : {};
              })(),
              ...(entry.subjectFilter.chosenSubtype === true ? { chosenSubtype: true } : {}),
              ...(entry.subjectFilter.nonToken === true ? { nonToken: true } : {}),
              ...(entry.subjectFilter.tokenOnly === true ? { tokenOnly: true } : {}),
              ...(entry.subjectFilter.greaterPtThanWatcher === true
                ? { greaterPtThanWatcher: true }
                : {}),
              ...(entry.subjectFilter.manaValueBelowWatcherPower === true
                ? { manaValueBelowWatcherPower: true }
                : {}),
              ...(entry.subjectFilter.ownedByYou === true ? { ownedByYou: true } : {}),
              ...(entry.subjectFilter.counterName === undefined
                ? {}
                : {
                    counterName: expectString(
                      entry.subjectFilter.counterName,
                      `${label}[${index}].subjectFilter.counterName`,
                    ),
                  }),
              ...(entry.subjectFilter.colorless === true ? { colorless: true } : {}),
              ...(entry.subjectFilter.historic === true ? { historic: true } : {}),
              ...(entry.subjectFilter.legendary === true ? { legendary: true } : {}),
              ...(entry.subjectFilter.commanderOnly === true ? { commanderOnly: true } : {}),
              ...(entry.subjectFilter.enteredTapped === true ? { enteredTapped: true } : {}),
              ...(entry.subjectFilter.attacking === true ? { attacking: true } : {}),
              ...(entry.subjectFilter.modified === true ? { modified: true } : {}),
              ...(entry.subjectFilter.minManaValue === undefined
                ? {}
                : {
                    minManaValue: expectNumber(
                      entry.subjectFilter.minManaValue,
                      "trigger.subjectFilter.minManaValue",
                    ),
                  }),
              ...(entry.subjectFilter.withKeyword === undefined
                ? {}
                : {
                    withKeyword: parseSingleKeyword(
                      entry.subjectFilter.withKeyword,
                      "trigger.subjectFilter.withKeyword",
                    ),
                  }),
              ...(entry.subjectFilter.withoutKeyword === undefined
                ? {}
                : {
                    withoutKeyword: parseSingleKeyword(
                      entry.subjectFilter.withoutKeyword,
                      "trigger.subjectFilter.withoutKeyword",
                    ),
                  }),
              ...(entry.subjectFilter.powerAboveBase === true ? { powerAboveBase: true } : {}),
              ...(() => {
                if (entry.subjectFilter.colors === undefined) {
                  return {};
                }
                if (!Array.isArray(entry.subjectFilter.colors)) {
                  throw new Error(`Invalid ${label}[${index}].subjectFilter.colors`);
                }
                return {
                  colors: entry.subjectFilter.colors.map((color) => {
                    const parsed = expectString(color, `${label}[${index}].subjectFilter.colors`);
                    if (!(COLOR_KEYS as readonly string[]).includes(parsed)) {
                      throw new Error(`Invalid ${label}[${index}].subjectFilter.colors`);
                    }
                    return parsed as Color;
                  }),
                };
              })(),
              ...(entry.subjectFilter.maxManaValue === undefined
                ? {}
                : {
                    maxManaValue: expectNumber(
                      entry.subjectFilter.maxManaValue,
                      `${label}[${index}].subjectFilter.maxManaValue`,
                    ),
                  }),
              ...(() => {
                const nonSubtypes = parseStringList(
                  entry.subjectFilter.nonSubtypes,
                  `${label}[${index}].subjectFilter.nonSubtypes`,
                );
                return nonSubtypes.length > 0 ? { nonSubtypes } : {};
              })(),
              ...(entry.subjectFilter.minPower === undefined
                ? {}
                : {
                    minPower: expectNumber(
                      entry.subjectFilter.minPower,
                      `${label}[${index}].subjectFilter.minPower`,
                    ),
                  }),
              ...(entry.subjectFilter.maxPower === undefined
                ? {}
                : {
                    maxPower: expectNumber(
                      entry.subjectFilter.maxPower,
                      `${label}[${index}].subjectFilter.maxPower`,
                    ),
                  }),
            };
          })();
    return {
      event,
      ...(watch === undefined ? {} : { watch }),
      ...(entry.fromGraveyard === true ? { fromGraveyard: true } : {}),
      ...(entry.onSelfCast === true ? { onSelfCast: true } : {}),
      ...(entry.excludeSelf === true ? { excludeSelf: true } : {}),
      ...(entry.oncePerTurn === true ? { oncePerTurn: true } : {}),
      ...(entry.modesOncePerTurn === true ? { modesOncePerTurn: true } : {}),
      ...(entry.enchantedPlayersStep === true ? { enchantedPlayersStep: true } : {}),
      ...(entry.minAttackers === undefined
        ? {}
        : { minAttackers: expectNumber(entry.minAttackers, "trigger.minAttackers") }),
      ...(entry.oncePerBatch === true ? { oncePerBatch: true } : {}),
      ...(entry.classLevel === undefined
        ? {}
        : { classLevel: expectNumber(entry.classLevel, `${label}[${index}].classLevel`) }),
      ...(entry.eachPlayersStep === true ? { eachPlayersStep: true } : {}),
      ...(entry.opponentsStepOnly === true ? { opponentsStepOnly: true } : {}),
      ...(entry.alsoOnCopy === true ? { alsoOnCopy: true } : {}),
      ...(entry.modes === undefined
        ? {}
        : { modes: parseSpellModes(entry.modes, `${label}[${index}].modes`) }),
      ...(isRecord(entry.modeChoice)
        ? {
            modeChoice: {
              min: expectNumber(entry.modeChoice.min, `${label}[${index}].modeChoice.min`),
              max: expectNumber(entry.modeChoice.max, `${label}[${index}].modeChoice.max`),
            },
          }
        : {}),
      ...(entry.condition === undefined
        ? {}
        : {
            condition: parseTriggerCondition(
              entry.condition,
              `${label}[${index}].condition`,
            ),
          }),
      ...(entry.subjectPlayerOpponent === true ? { subjectPlayerOpponent: true } : {}),
      ...(entry.noncombatOnly === true ? { noncombatOnly: true } : {}),
      ...(entry.subjectPlayerSelf === true ? { subjectPlayerSelf: true } : {}),
      ...(entry.attacksAlone === true ? { attacksAlone: true } : {}),
      // Attach the filter when it has ANY field. This was a whitelist of
      // ten names, and the filter has grown to roughly twenty-five — so a
      // trigger filtered only on `legendary`, `attacking`, `modified`,
      // `historic`, `colorless` or `commanderOnly` lost its whole filter on
      // a round trip and afterwards fired for EVERY subject. Counting keys
      // cannot go stale the way a list of names does.
      ...(subjectFilter && Object.keys(subjectFilter).length > 0 ? { subjectFilter } : {}),
      effects: parseCardEffects(entry.effects, `${label}[${index}].effects`),
      targetRequirements: parseTargetRequirements(
        entry.targetRequirements,
        `${label}[${index}].targetRequirements`,
      ),
    };
  });
}

/**
 * One intervening-"if" condition. Shared by trigger heads and by the
 * ability-word riders that test the same vocabulary when their effects
 * bind, so the two readings cannot drift apart.
 */
function parseTriggerCondition(value: unknown, label: string): TriggerCondition {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
      const conditionKind = expectString(
        value.kind,
        `${label}.kind`,
      );
      if (conditionKind === "opponent_cast_color_this_turn") {
        return {
          kind: conditionKind,
          colors: parseColorArray(value.colors, `${label}.colors`),
        };
      }
      if (conditionKind === "mana_spent_to_cast") {
        const color = value.color === undefined ? undefined : parseColor(value.color, `${label}.color`);
        return {
          kind: conditionKind,
          atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
          ...(color ? { color } : {}),
        };
      }
      if (
        conditionKind === "greatest_artifact_mana_value" ||
        conditionKind === "no_mana_spent_to_cast" ||
        conditionKind === "no_spells_cast_this_turn" ||
        conditionKind === "opponent_controls_more_lands" ||
        conditionKind === "subject_name_unique" ||
        conditionKind === "subject_not_put_by_watcher" ||
        conditionKind === "first_combat_this_turn" ||
        conditionKind === "own_main_phase" ||
        conditionKind === "self_tapped" ||
        conditionKind === "attacking_most_life"
      ) {
        return { kind: conditionKind };
      }
      if (conditionKind === "controls_total_power_at_least") {
        return {
          kind: conditionKind,
          power: expectNumber(value.power, `${label}.power`),
        };
      }
      if (conditionKind === "controls_power_at_least") {
        return {
          kind: conditionKind,
          power: expectNumber(
            value.power,
            `${label}.power`,
          ),
        };
      }
      if (conditionKind === "life_at_least") {
        return {
          kind: conditionKind,
          amount: expectNumber(
            value.amount,
            `${label}.amount`,
          ),
        };
      }
      if (conditionKind === "self_attacking") {
        return { kind: conditionKind };
      }
      if (conditionKind === "self_no_counter") {
        return { kind: conditionKind, counter: expectString(value.counter, `${label}.counter`) };
      }
      if (conditionKind === "hand_size_exactly") {
        return {
          kind: conditionKind,
          count: expectNumber(
            value.count,
            `${label}.count`,
          ),
        };
      }
      if (
        conditionKind === "graveyard_cards_at_least" ||
        conditionKind === "graveyard_card_types_at_least"
      ) {
        return { kind: conditionKind, count: expectNumber(value.count, `${label}.count`) };
      }
      if (conditionKind === "creature_died_this_turn" || conditionKind === "attacked_this_turn") {
        return { kind: conditionKind };
      }
      if (conditionKind === "graveyard_creature_cards_at_least") {
        return { kind: conditionKind, count: expectNumber(value.count, `${label}.count`) };
      }
      if (conditionKind === "drew_cards_this_turn") {
        return { kind: conditionKind, moreThan: expectNumber(value.moreThan, `${label}.moreThan`) };
      }
      if (
        conditionKind === "gained_life_this_turn" ||
        conditionKind === "opponent_lost_life_this_turn"
      ) {
        return {
          kind: conditionKind,
          atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
        };
      }
      if (
        conditionKind === "created_token_this_turn" ||
        conditionKind === "self_not_exerted_this_turn" ||
        conditionKind === "cast_from_hand_and_another_named_this_game"
      ) {
        return { kind: conditionKind };
      }
      if (conditionKind === "controls_commander") {
        return { kind: conditionKind };
      }
      if (conditionKind === "attackers_against_you_at_least") {
        return { kind: conditionKind, count: expectNumber(value.count, `${label}.count`) };
      }
      if (
        conditionKind === "attacked_with_creatures_this_turn" ||
        conditionKind === "opponent_damaged_this_turn"
      ) {
        return {
          kind: conditionKind,
          atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
        };
      }
      if (conditionKind === "library_at_most") {
        return { kind: conditionKind, count: expectNumber(value.count, `${label}.count`) };
      }
      if (conditionKind === "announced_x_at_least") {
        return {
          kind: conditionKind,
          amount: expectNumber(value.amount, `${label}.amount`),
        };
      }
      if (conditionKind === "subject_power_greatest") {
        return { kind: conditionKind };
      }
      if (conditionKind === "self_untapped") {
        return { kind: conditionKind };
      }
      if (conditionKind === "library_empty" || conditionKind === "entered_from_cast") {
        return { kind: conditionKind };
      }
      if (conditionKind === "self_counter_count") {
        const comparison = expectString(value.comparison, `${label}.comparison`);
        if (comparison !== "at_least" && comparison !== "fewer_than") {
          throw new Error(`Invalid ${label}.comparison`);
        }
        return {
          kind: conditionKind,
          counter: expectString(value.counter, `${label}.counter`),
          comparison,
          count: expectNumber(value.count, `${label}.count`),
        };
      }
      if (conditionKind === "opponent_controls_count") {
        const scope = expectString(value.what, `${label}.what`);
        if (scope !== "land" && scope !== "creature" && scope !== "artifact") {
          throw new Error(`Invalid ${label}.what`);
        }
        return {
          kind: conditionKind,
          what: scope,
          atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
        };
      }
      if (conditionKind === "controls_no_subtype") {
        return {
          kind: conditionKind,
          subtype: expectString(
            value.subtype,
            `${label}.subtype`,
          ),
        };
      }
      if (conditionKind === "controls_lands_with_different_names") {
        return {
          kind: conditionKind,
          atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
        };
      }
      if (conditionKind === "controls_subtype_count") {
        return {
          kind: conditionKind,
          subtype: expectString(value.subtype, `${label}.subtype`),
          atLeast: expectNumber(value.atLeast, `${label}.atLeast`),
          ...(value.excludeSelf === true ? { excludeSelf: true } : {}),
        };
      }
      if (conditionKind === "chosen_has_subtype") {
        return { kind: conditionKind, subtype: expectString(value.subtype, `${label}.subtype`) };
      }
      if (conditionKind === "controls_colored_permanent") {
        return { kind: conditionKind, color: parseColor(value.color, `${label}.color`) };
      }
      if (conditionKind === "controls_count") {
        const what = expectString(
          value.what,
          `${label}.what`,
        );
        if (what !== "land" && what !== "creature" && what !== "artifact") {
          throw new Error(`Invalid ${label}.what`);
        }
        return {
          kind: conditionKind,
          what,
          atLeast: expectNumber(
            value.atLeast,
            `${label}.atLeast`,
          ),
        };
      }
  throw new Error(`Invalid ${label}.kind`);
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
      kind === "self_to_library_shuffled" ||
      kind === "opponents_graveyard_to_void_exile" ||
      kind === "empty_draw_wins" ||
      kind === "double_life_gain" ||
      kind === "double_draws_except_first"
    ) {
      return { kind };
    }
    if (kind === "life_gain_bonus") {
      return { kind, amount: expectNumber(entry.amount, `${label}[${index}].amount`) };
    }
    if (kind === "double_tokens") {
      return {
        kind,
        ...(entry.multiplier === undefined
          ? {}
          : { multiplier: expectNumber(entry.multiplier, `${label}[${index}].multiplier`) }),
        ...(entry.creaturesOnly === true ? { creaturesOnly: true } : {}),
      };
    }
    if (kind === "tokens_one_of_each") {
      return {
        kind,
        subtypes: parseStringList(entry.subtypes, `${label}[${index}].subtypes`),
      };
    }
    if (kind === "extra_token" || kind === "substitute_tokens") {
      const token = entry.token;
      if (!isRecord(token)) {
        throw new Error(`Invalid ${label}[${index}].token`);
      }
      const match = isRecord(entry.match) ? entry.match : undefined;
      return {
        kind,
        ...(match
          ? {
              match: {
                ...(match.types === undefined
                  ? {}
                  : { types: parseStringList(match.types, `${label}[${index}].match.types`) }),
                ...(match.subtypesAny === undefined
                  ? {}
                  : {
                      subtypesAny: parseStringList(
                        match.subtypesAny,
                        `${label}[${index}].match.subtypesAny`,
                      ),
                    }),
              },
            }
          : {}),
        token: {
          name: expectString(token.name, `${label}[${index}].token.name`),
          typeLine: expectString(token.typeLine, `${label}[${index}].token.typeLine`),
          power:
            token.power === null || token.power === undefined
              ? null
              : expectNumber(token.power, `${label}[${index}].token.power`),
          toughness:
            token.toughness === null || token.toughness === undefined
              ? null
              : expectNumber(token.toughness, `${label}[${index}].token.toughness`),
          ...(token.keywords === undefined
            ? {}
            : { keywords: parseKeywords(token.keywords, `${label}[${index}].token.keywords`) }),
          ...(token.colors === undefined
            ? {}
            : { colors: parseColorArray(token.colors, `${label}[${index}].token.colors`) }),
        },
      };
    }
    if (kind === "double_opponent_life_loss_on_your_turn") {
      return { kind };
    }
    if (kind === "double_counters" || kind === "bonus_counters") {
      return {
        kind,
        ...(entry.counter === undefined
          ? {}
          : { counter: expectString(entry.counter, `${label}[${index}].counter`) }),
        ...(entry.creaturesOnly === true ? { creaturesOnly: true } : {}),
        ...(entry.typesAny === undefined
          ? {}
          : { typesAny: expectStringArray(entry.typesAny, `${label}[${index}].typesAny`) }),
      };
    }
    if (kind === "may_pay_life_or_enter_tapped") {
      return {
        kind,
        amount: expectNumber(entry.amount, `${label}[${index}].amount`),
      };
    }
    if (kind === "discard_land_or_graveyard") {
      return { kind };
    }
    if (kind === "discard_land_or_graveyard") {
      return { kind };
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
  if (
    kind === "basic_lands" ||
    kind === "other_lands_at_most" ||
    kind === "opponents" ||
    kind === "turn_at_most"
  ) {
    const count = expectNumber(value.count, `${label}.count`);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid ${label}.count`);
    }
    return { kind, count };
  }
  if (kind === "legendary_creature") {
    return { kind };
  }
  if (kind === "controlled_subtype") {
    // The Eldraine castle lands. Present in the union and emitted by the
    // compiler, but never parsed — so all five made definitions that could
    // not be loaded, and a saved table holding one would not reopen.
    const count = expectNumber(value.count, `${label}.count`);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`Invalid ${label}.count`);
    }
    return {
      kind,
      subtype: expectString(value.subtype, `${label}.subtype`),
      count,
      ...(value.excludeSelf === true ? { excludeSelf: true } : {}),
    };
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

/**
 * "Activate only if you control …" gates ride activated abilities, mana
 * abilities, and static abilities alike, so all three parsers share this one
 * — a new gate field added here reaches every carrier at once.
 */
function parseControlledGate(value: unknown, label: string): ControlledGate {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const types = parseStringList(value.types, `${label}.types`);
  const subtypes = parseStringList(value.subtypes, `${label}.subtypes`);
  const subtypesAny = parseStringList(value.subtypesAny, `${label}.subtypesAny`);
  return {
    ...(types.length > 0 ? { types } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
    ...(subtypesAny.length > 0 ? { subtypesAny } : {}),
    ...(value.legendary === true ? { legendary: true } : {}),
    ...(value.minPower === undefined
      ? {}
      : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
    ...(value.atLeast === undefined
      ? {}
      : { atLeast: expectNumber(value.atLeast, `${label}.atLeast`) }),
  };
}

function parseEffectSelector(value: unknown, label: string): EffectSelector {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const scope = expectString(value.scope, `${label}.scope`);
  if (
    scope !== "self" &&
    scope !== "controlled" &&
    scope !== "all" &&
    scope !== "attached" &&
    scope !== "opponents"
  ) {
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
    ...(value.chosenColor === true ? { chosenColor: true } : {}),
    ...(value.withoutKeyword === undefined
      ? {}
      : { withoutKeyword: parseKeywords([value.withoutKeyword], `${label}.withoutKeyword`)[0]! }),
    ...(value.withKeyword === undefined
      ? {}
      : { withKeyword: parseKeywords([value.withKeyword], `${label}.withKeyword`)[0]! }),
    ...(value.tokenOnly === true ? { tokenOnly: true } : {}),
    ...(value.nonToken === true ? { nonToken: true } : {}),
    ...(value.legendary === true ? { legendary: true } : {}),
    ...(value.nonLegendary === true ? { nonLegendary: true } : {}),
    ...(() => {
      const nonTypes = parseStringList(value.nonTypes, `${label}.nonTypes`);
      return nonTypes.length > 0 ? { nonTypes } : {};
    })(),
    ...(value.commanderOnly === true ? { commanderOnly: true } : {}),
    ...(value.maxPower === undefined
      ? {}
      : { maxPower: expectNumber(value.maxPower, `${label}.maxPower`) }),
    ...(value.maxPowerOrToughness === undefined
      ? {}
      : {
          maxPowerOrToughness: expectNumber(
            value.maxPowerOrToughness,
            `${label}.maxPowerOrToughness`,
          ),
        }),
    ...(value.withCounter === undefined
      ? {}
      : { withCounter: expectString(value.withCounter, `${label}.withCounter`) }),
    ...(value.withAnyCounter === true ? { withAnyCounter: true } : {}),
    ...(excludeSelf ? { excludeSelf: true } : {}),
  };
}

function parseProtectionFrom(value: unknown, label: string): ProtectionFrom {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const colors =
    value.colors === undefined
      ? undefined
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
    ...(colors ? { colors } : {}),
    ...(value.types === undefined
      ? {}
      : { types: parseStringList(value.types, `${label}.types`) }),
    ...(value.subtypes === undefined
      ? {}
      : { subtypes: parseStringList(value.subtypes, `${label}.subtypes`) }),
    ...(value.multicolored === true ? { multicolored: true } : {}),
    ...(value.colorless === true ? { colorless: true } : {}),
    ...(value.everything === true ? { everything: true } : {}),
    ...(value.colorsOutsideCommanderIdentity === true
      ? { colorsOutsideCommanderIdentity: true }
      : {}),
  };
}

function isEnchantRestriction(
  value: unknown,
): value is NonNullable<CardDefinition["enchant"]> {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ENCHANT_RESTRICTIONS, value)
  );
}

const ENCHANT_RESTRICTIONS: Record<NonNullable<CardDefinition["enchant"]>, true> = {
  creature: true,
  land: true,
  creature_or_planeswalker_own: true,
  creature_land_or_planeswalker: true,
  permanent: true,
  artifact_own: true,
  player: true,
};

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
  if (kind === "set_types") {
    const subtypes = value.subtypes === undefined
      ? []
      : parseStringList(value.subtypes, `${label}.subtypes`);
    return {
      kind,
      types: parseStringList(value.types, `${label}.types`),
      ...(subtypes.length > 0 ? { subtypes } : {}),
    };
  }
  if (kind === "all_creature_types") {
    return { kind };
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
  if (kind === "grant_ward" || kind === "grant_ward_life") {
    return { kind, amount: expectNumber(value.amount, `${label}.amount`) };
  }
  if (kind === "grant_protection") {
    return { kind, from: parseProtectionFrom(value.from, `${label}.from`) };
  }
  if (kind === "grant_hexproof_from") {
    return { kind, colors: parseColorArray(value.colors, `${label}.colors`) };
  }
  if (kind === "grant_activated") {
    const parsed = parseActivatedAbilities([value.ability], `${label}.ability`);
    if (!parsed[0]) {
      throw new Error(`Invalid ${label}.ability`);
    }
    return { kind, ability: parsed[0] };
  }
  if (kind === "grant_trigger") {
    // Reuses the whole trigger parser rather than a second, drifting copy —
    // a granted trigger is an ordinary trigger that lives somewhere else.
    const parsed = parseTriggers([value.trigger], `${label}.trigger`);
    if (!parsed[0]) {
      throw new Error(`Invalid ${label}.trigger`);
    }
    return { kind, trigger: parsed[0] };
  }
  if (kind === "grant_mana_ability") {
    const parsed = parseManaAbilities([value.ability], `${label}.ability`);
    if (!parsed[0]) {
      throw new Error(`Invalid ${label}.ability`);
    }
    return { kind, ability: parsed[0] };
  }
  if (kind === "remove_all_abilities" || kind === "goaded") {
    return { kind };
  }
  if (kind === "remove_keywords" || kind === "lock_keywords") {
    return { kind, keywords: parseKeywords(value.keywords, `${label}.keywords`) };
  }
  if (kind === "restrict") {
    return {
      kind,
      ...(value.cantAttack === true ? { cantAttack: true } : {}),
      ...(value.cantBlock === true ? { cantBlock: true } : {}),
      ...(value.cantBeBlocked === true ? { cantBeBlocked: true } : {}),
      ...(value.unlessCityBlessing === true ? { unlessCityBlessing: true } : {}),
    };
  }
  if (kind === "set_pt" || kind === "modify_pt") {
    const per = value.per;
    if (kind === "modify_pt" && per !== undefined && !isDynamicCount(per)) {
      throw new Error(`Invalid ${label}.per`);
    }
    return {
      kind,
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
      ...(kind === "modify_pt" && per !== undefined ? { per: per as DynamicCount } : {}),
      ...(kind === "modify_pt" && value.perSourceCounter !== undefined
        ? { perSourceCounter: expectString(value.perSourceCounter, `${label}.perSourceCounter`) }
        : {}),
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
        ...(entry.fromGraveyard === true ? { fromGraveyard: true } : {}),
        ...(entry.requiresControlled === undefined
          ? {}
          : {
              requiresControlled: parseControlledGate(
                entry.requiresControlled,
                `${label}[${index}].requiresControlled`,
              ),
            }),
        ...(isRecord(entry.requiresCounters)
          ? {
              requiresCounters: {
                counter: expectString(
                  entry.requiresCounters.counter,
                  `${label}[${index}].requiresCounters.counter`,
                ),
                atLeast: expectNumber(
                  entry.requiresCounters.atLeast,
                  `${label}[${index}].requiresCounters.atLeast`,
                ),
              },
            }
          : {}),
        ...(entry.requiresControlledBelow === undefined
          ? {}
          : {
              requiresControlledBelow: parseControlledGate(
                entry.requiresControlledBelow,
                `${label}[${index}].requiresControlledBelow`,
              ),
            }),
        ...(entry.requiresDelirium === true ? { requiresDelirium: true } : {}),
        ...(entry.requiresYourTurn === true ? { requiresYourTurn: true } : {}),
        ...(entry.requiresOpponentLifeAtMost === undefined
          ? {}
          : {
              requiresOpponentLifeAtMost: expectNumber(
                entry.requiresOpponentLifeAtMost,
                `${label}[${index}].requiresOpponentLifeAtMost`,
              ),
            }),
        ...(entry.requiresLife === undefined
          ? {}
          : { requiresLife: expectNumber(entry.requiresLife, `${label}[${index}].requiresLife`) }),
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
      ...(entry.poisonToController === undefined
        ? {}
        : {
            poisonToController: expectNumber(
              entry.poisonToController,
              `${label}[${index}].poisonToController`,
            ),
          }),
      ...(entry.gainLifeToController === undefined
        ? {}
        : {
            gainLifeToController: expectNumber(
              entry.gainLifeToController,
              `${label}[${index}].gainLifeToController`,
            ),
          }),
      ...(entry.count === undefined
        ? {}
        : { count: expectNumber(entry.count, `${label}[${index}].count`) }),
      ...(entry.sacrificeSelf === true ? { sacrificeSelf: true } : {}),
      ...(entry.costMana === undefined
        ? {}
        : { costMana: expectString(entry.costMana, `${label}[${index}].costMana`) }),
      ...(typeof entry.costSacrifice === "string" &&
      entry.costSacrifice in MANA_COST_SACRIFICE_SCOPES
        ? { costSacrifice: entry.costSacrifice as ManaCostSacrifice }
        : {}),
      ...(entry.costDiscardHand === true ? { costDiscardHand: true } : {}),
      ...(isRecord(entry.upgrade)
        ? {
            upgrade: (() => {
              const raw = entry.upgrade;
              const label2 = `${label}[${index}].upgrade`;
              if (!Array.isArray(raw.requires)) {
                throw new Error(`Invalid ${label2}.requires`);
              }
              return {
                requires: raw.requires.map((gate: unknown, gateIndex: number) =>
                  parseControlledGate(gate, `${label2}.requires[${gateIndex}]`),
                ),
                ...(raw.produces === undefined
                  ? {}
                  : { produces: parseProduces(raw.produces, `${label2}.produces`) }),
                ...(raw.anyColor === undefined
                  ? {}
                  : { anyColor: expectNumber(raw.anyColor, `${label2}.anyColor`) }),
                ...(raw.selfCounter === undefined
                  ? {}
                  : { selfCounter: expectString(raw.selfCounter, `${label2}.selfCounter`) }),
                ...(raw.sameTypeCount === undefined
                  ? {}
                  : { sameTypeCount: expectNumber(raw.sameTypeCount, `${label2}.sameTypeCount`) }),
              };
            })(),
          }
        : {}),
      ...(entry.costSacrificeSubtype === undefined
        ? {}
        : {
            costSacrificeSubtype: expectString(
              entry.costSacrificeSubtype,
              `${label}[${index}].costSacrificeSubtype`,
            ),
          }),
      ...(entry.noTap === true ? { noTap: true } : {}),
      ...(entry.countFromPower === true ? { countFromPower: true } : {}),
      ...(entry.countFromDevotion === true ? { countFromDevotion: true } : {}),
      ...(entry.exertSelf === true ? { exertSelf: true } : {}),
      ...(entry.countFromChosenTypeCreatures === true
        ? { countFromChosenTypeCreatures: true }
        : {}),
      ...(entry.countFromGreatestControlledPower === true
        ? { countFromGreatestControlledPower: true }
        : {}),
      ...(entry.countFromEnchantments === true ? { countFromEnchantments: true } : {}),
      ...(entry.countFromArtifacts === true ? { countFromArtifacts: true } : {}),
      ...(isRecord(entry.requiresManaCounters)
        ? {
            requiresManaCounters: {
              counter: expectString(
                entry.requiresManaCounters.counter,
                `${label}[${index}].requiresManaCounters.counter`,
              ),
              atLeast: expectNumber(
                entry.requiresManaCounters.atLeast,
                `${label}[${index}].requiresManaCounters.atLeast`,
              ),
            },
          }
        : {}),
      ...(entry.costTapCreature === true ? { costTapCreature: true } : {}),
      ...(entry.costTapArtifact === true ? { costTapArtifact: true } : {}),
      ...(entry.costTapCreatureLegendary === true ? { costTapCreatureLegendary: true } : {}),
      ...(entry.requiresCondition === undefined
        ? {}
        : {
            requiresCondition: parseTriggerCondition(
              entry.requiresCondition,
              `${label}[${index}].requiresCondition`,
            ),
          }),
      ...(entry.anyColorAmong === "legendary" ||
      entry.anyColorAmong === "legendary_permanents" ||
      entry.anyColorAmong === "opponent_lands" ||
      entry.anyColorAmong === "your_lands" ||
      entry.anyColorAmong === "commander_identity" ||
      entry.anyColorAmong === "imprinted"
        ? { anyColorAmong: entry.anyColorAmong }
        : {}),
      ...(entry.producesChosenColor === true ? { producesChosenColor: true } : {}),
      ...(entry.producesColorsAmong === "permanents"
        ? { producesColorsAmong: "permanents" as const }
        : {}),
      ...(isRecord(entry.requiresCount)
        ? {
            requiresCount: (() => {
              const what = expectString(
                entry.requiresCount.what,
                `${label}[${index}].requiresCount.what`,
              );
              if (what !== "artifact" && what !== "creature" && what !== "land") {
                throw new Error(`Invalid ${label}[${index}].requiresCount.what`);
              }
              return {
                what,
                atLeast: expectNumber(
                  entry.requiresCount.atLeast,
                  `${label}[${index}].requiresCount.atLeast`,
                ),
              };
            })(),
          }
        : {}),
      ...(entry.requiresControlled === undefined
        ? {}
        : {
            requiresControlled: parseControlledGate(
              entry.requiresControlled,
              `${label}[${index}].requiresControlled`,
            ),
          }),
      ...(isRecord(entry.rider)
        ? { rider: parseManaRider(entry.rider, `${label}[${index}].rider`) }
        : {}),
      ...(isRecord(entry.spendOnly)
        ? {
            spendOnly: parseManaRestriction(
              entry.spendOnly,
              `${label}[${index}].spendOnly`,
            ),
          }
        : {}),
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
    if (kind === "life_change" || kind === "poison_change") {
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
    const perCounter = value.countFromCounterOnSource;
    if (isRecord(perCounter)) {
      return {
        kind,
        playerId: expectString(value.playerId, `${label}.playerId`),
        count: expectNumber(value.count, `${label}.count`),
        ...(value.optional === true ? { optional: true } : {}),
        ...(value.turnDraw === true ? { turnDraw: true } : {}),
        countFromCounterOnSource: {
          sourceId: expectString(
            perCounter.sourceId,
            `${label}.countFromCounterOnSource.sourceId`,
          ),
          counter: expectString(
            perCounter.counter,
            `${label}.countFromCounterOnSource.counter`,
          ),
        },
      };
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
      ...(value.optional === true ? { optional: true } : {}),
      ...(value.turnDraw === true ? { turnDraw: true } : {}),
    };
  }
  if (
    kind === "scry" ||
    kind === "surveil" ||
    kind === "mill" ||
    kind === "discard" ||
    kind === "discard_random" ||
    kind === "exile_top"
  ) {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
    };
  }
  if (kind === "gain_life" || kind === "lose_life" || kind === "add_poison") {
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
      ...(value.untilEndOfTurn === true ? { untilEndOfTurn: true } : {}),
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
  if (kind === "attackers_gain_keyword_until_eot") {
    const attackersKeyword = expectString(value.keyword, `${label}.keyword`);
    if (!KEYWORDS.has(attackersKeyword as Keyword)) {
      throw new Error(`Invalid ${label}.keyword`);
    }
    return { kind, keyword: attackersKeyword as Keyword };
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
  if (kind === "team_set_pt_until_eot") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
      ...(value.allCreatureTypes === true ? { allCreatureTypes: true } : {}),
    };
  }
  if (kind === "team_pt_until_eot") {
    const nonSubtypes = parseStringList(value.nonSubtypes, `${label}.nonSubtypes`);
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
      ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
      ...(value.minPower === undefined
        ? {}
        : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
    };
  }
  if (kind === "team_keyword_until_eot") {
    const keyword = expectString(value.keyword, `${label}.keyword`);
    if (!KEYWORDS.has(keyword as Keyword)) {
      throw new Error(`Invalid ${label}.keyword`);
    }
    const nonSubtypes = parseStringList(value.nonSubtypes, `${label}.nonSubtypes`);
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      keyword: keyword as Keyword,
      ...(value.untilYourNextTurn === true ? { untilYourNextTurn: true } : {}),
      ...(value.scope === "permanents" ? { scope: "permanents" } : {}),
      ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
      ...(value.minPower === undefined
        ? {}
        : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
    };
  }
  if (kind === "team_hexproof_from_until_eot") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      colors: parseColorArray(value.colors, `${label}.colors`),
      ...(value.includePlayer === true ? { includePlayer: true } : {}),
    };
  }
  if (kind === "spells_uncounterable_this_turn") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "protection_until_eot" || kind === "hexproof_from_until_eot") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      colors: parseColorArray(value.colors, `${label}.colors`),
    };
  }
  if (kind === "team_protection_until_eot") {
    if (!Array.isArray(value.colors)) {
      throw new Error(`Invalid ${label}.colors`);
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      colors: value.colors.map((entry, index) => {
        const color = expectString(entry, `${label}.colors[${index}]`);
        if (!(COLOR_KEYS as readonly string[]).includes(color)) {
          throw new Error(`Invalid ${label}.colors[${index}]`);
        }
        return color as Color;
      }),
    };
  }
  if (kind === "all_pt_until_eot") {
    return {
      kind,
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
      ...(value.exceptSubtype === undefined
        ? {}
        : { exceptSubtype: expectString(value.exceptSubtype, `${label}.exceptSubtype`) }),
      ...(value.exceptTypes === undefined
        ? {}
        : { exceptTypes: parseStringList(value.exceptTypes, `${label}.exceptTypes`) }),
    };
  }
  if (kind === "all_restrict_until_eot") {
    return {
      kind,
      ...(value.cantAttack === true ? { cantAttack: true } : {}),
      ...(value.cantBlock === true ? { cantBlock: true } : {}),
      ...(value.cantBeBlocked === true ? { cantBeBlocked: true } : {}),
      ...(value.withoutKeyword === undefined
        ? {}
        : { withoutKeyword: parseKeywords([value.withoutKeyword], `${label}.withoutKeyword`)[0]! }),
      ...(value.withKeyword === undefined
        ? {}
        : { withKeyword: parseKeywords([value.withKeyword], `${label}.withKeyword`)[0]! }),
    };
  }
  if (kind === "grant_next_spell") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      ...(value.improvise === true ? { improvise: true } : {}),
      ...(value.cantBeCountered === true ? { cantBeCountered: true } : {}),
    };
  }
  if (kind === "reveal_top_put_permanent") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "silence" || kind === "silence_noncreature") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "drain_opponents") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "exile_until_taken" || kind === "extra_turn" || kind === "deny_extra_turns") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "commander_cast_counters") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "cast_free_copy") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      playerId: expectString(value.playerId, `${label}.playerId`),
    };
  }
  if (kind === "grant_cast_this_turn") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      playerId: expectString(value.playerId, `${label}.playerId`),
      ...(value.locksCastingAfter === true ? { locksCastingAfter: true } : {}),
    };
  }
  if (kind === "punisher_choice") {
    return {
      kind,
      chooserId: expectString(value.chooserId, `${label}.chooserId`),
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      sourceId: value.sourceId === null ? null : expectString(value.sourceId, `${label}.sourceId`),
      // Still card effects: "that player" in them is the chooser.
      ifTaken: parseCardEffects(value.ifTaken, `${label}.ifTaken`),
      ifDeclined: parseCardEffects(value.ifDeclined, `${label}.ifDeclined`),
    };
  }
  if (kind === "tap_own_for_x") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      sourceId: value.sourceId === null ? null : expectString(value.sourceId, `${label}.sourceId`),
      subtype: expectString(value.subtype, `${label}.subtype`),
      // Still card effects: X is not known until the choice is answered.
      rider: parseCardEffects(value.rider, `${label}.rider`),
    };
  }
  if (kind === "tempting_offer") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      // Still card effects, not game effects: the whole point is that they
      // are rebound to whoever takes the offer.
      action: parseCardEffects(value.action, `${label}.action`),
    };
  }
  if (kind === "divide_into_piles") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      dividerId: expectString(value.dividerId, `${label}.dividerId`),
      count: expectNumber(value.count, `${label}.count`),
      taken: parsePileZone(value.taken, `${label}.taken`),
      left: parsePileZone(value.left, `${label}.left`),
    };
  }
  if (kind === "choose_card_name") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      ...(value.sourceId === undefined
        ? {}
        : { sourceId: expectString(value.sourceId, `${label}.sourceId`) }),
    };
  }
  if (kind === "dig_until") {
    const digFound = expectString(value.found, `${label}.found`);
    const digRest = expectString(value.rest, `${label}.rest`);
    if (!DIG_FOUND_ZONES.has(digFound)) {
      throw new Error(`Invalid ${label}.found`);
    }
    if (!DIG_REST_ZONES.has(digRest)) {
      throw new Error(`Invalid ${label}.rest`);
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      filter: parseSearchFilter(value.filter, `${label}.filter`),
      found: digFound as DigFound,
      rest: digRest as DigRest,
      ...(value.optional === true ? { optional: true } : {}),
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
      ...(value.untapIfLands === undefined
        ? {}
        : { untapIfLands: expectNumber(value.untapIfLands, `${label}.untapIfLands`) }),
      ...(value.landsToBattlefieldTapped === true
        ? { landsToBattlefieldTapped: true }
        : {}),
      ...(value.alsoGraveyard === true ? { alsoGraveyard: true } : {}),
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
      ...(value.setColors === undefined
        ? {}
        : { setColors: parseColorArray(value.setColors, `${label}.setColors`) }),
      ...(value.addSubtypes === undefined
        ? {}
        : { addSubtypes: expectStringArray(value.addSubtypes, `${label}.addSubtypes`) }),
      ...(value.notLegendary === true ? { notLegendary: true } : {}),
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
      ...(value.subtype === undefined
        ? {}
        : { subtype: expectString(value.subtype, `${label}.subtype`) }),
      ...(value.controllerId === undefined
        ? {}
        : { controllerId: expectString(value.controllerId, `${label}.controllerId`) }),
      ...(value.opponentsOf === undefined
        ? {}
        : { opponentsOf: expectString(value.opponentsOf, `${label}.opponentsOf`) }),
      ...(value.colors === undefined ? {} : { colors: parseColorArray(value.colors, `${label}.colors`) }),
      ...(value.enteredThisTurn === true ? { enteredThisTurn: true } : {}),
    };
  }
  if (kind === "each_creature_damages_controller") {
    return { kind, amount: expectNumber(value.amount, `${label}.amount`) };
  }
  if (kind === "double_team_pt_until_eot") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "power_nova") {
    return {
      kind,
      sourceId: expectString(value.sourceId, `${label}.sourceId`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "retarget") {
    return {
      kind,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      ...(value.toCardId === undefined
        ? {}
        : { toCardId: expectString(value.toCardId, `${label}.toCardId`) }),
    };
  }
  if (kind === "animate_until_eot") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
      ...(Array.isArray(value.subtypes)
        ? {
            subtypes: value.subtypes.map((subtype, index) =>
              expectString(subtype, `${label}.subtypes[${index}]`),
            ),
          }
        : {}),
      ...(Array.isArray(value.types)
        ? {
            types: value.types.map((type, index) =>
              expectString(type, `${label}.types[${index}]`),
            ),
          }
        : {}),
      ...(value.colors === undefined
        ? {}
        : { colors: parseColorArray(value.colors, `${label}.colors`) }),
      ...(value.allCreatureTypes === true ? { allCreatureTypes: true } : {}),
      ...(value.keywords === undefined
        ? {}
        : { keywords: parseKeywords(value.keywords, `${label}.keywords`) }),
    };
  }
  if (kind === "add_turn_mana_echo") {
    return { kind, echo: parseLandTapEcho(value.echo, `${label}.echo`) };
  }
  if (kind === "choose_from_hand") {
    const destination = value.destination;
    if (destination !== "library_bottom" && destination !== "battlefield") {
      throw new Error(`Invalid ${label}.destination`);
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      destination,
      ...(Array.isArray(value.types)
        ? {
            types: value.types.map((type, index) =>
              expectString(type, `${label}.types[${index}]`),
            ),
          }
        : {}),
      ...(value.thenDrawPlus === undefined
        ? {}
        : { thenDrawPlus: expectNumber(value.thenDrawPlus, `${label}.thenDrawPlus`) }),
    };
  }
  if (kind === "discover") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`),
      ...(value.toHandAllowed === true ? { toHandAllowed: true } : {}),
    };
  }
  if (kind === "regenerate") {
    return { kind, cardIds: expectStringArray(value.cardIds, `${label}.cardIds`) };
  }
  if (kind === "ban_attacks_while_counter") {
    return {
      kind,
      counter: expectString(value.counter, `${label}.counter`),
      playerId: expectString(value.playerId, `${label}.playerId`),
    };
  }
  if (kind === "searched_free_or_hand") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`),
      bargained: value.bargained === true,
    };
  }
  if (kind === "sacrifice_others_of_type") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cardType: expectString(value.cardType, `${label}.cardType`),
      keepId:
        value.keepId === null || value.keepId === undefined
          ? null
          : expectString(value.keepId, `${label}.keepId`),
    };
  }
  if (kind === "look_top_card") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      viewerId: expectString(value.viewerId, `${label}.viewerId`),
    };
  }
  if (kind === "add_subtypes") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      subtypes: expectStringArray(value.subtypes, `${label}.subtypes`),
    };
  }
  if (kind === "add_subtypes_all") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      what: "creature" as const,
      subtypes: expectStringArray(value.subtypes, `${label}.subtypes`),
    };
  }
  if (kind === "mass_reanimate" || kind === "return_all_lands") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "return_all_from_graveyard") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cardType: expectString(value.cardType, `${label}.cardType`),
      ...(value.gainsHaste === true ? { gainsHaste: true } : {}),
    };
  }
  if (kind === "animate_controlled_until_eot") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cardType: expectString(value.cardType, `${label}.cardType`),
      power: expectNumber(value.power, `${label}.power`),
      toughness: expectNumber(value.toughness, `${label}.toughness`),
    };
  }
  if (kind === "prevent_combat_for") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (
    kind === "extra_land_drop" ||
    kind === "win_game" ||
    kind === "lose_game" ||
    kind === "grant_flash_this_turn" ||
    kind === "grant_no_max_hand_size"
  ) {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "grant_player_shield") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      ...(value.protectionFromEverything === true
        ? { protectionFromEverything: true }
        : {}),
      ...(value.lifeLocked === true ? { lifeLocked: true } : {}),
    };
  }
  if (kind === "delayed_trigger") {
    const step = expectString(value.step, `${label}.step`);
    if (step !== "upkeep" && step !== "first_main_phase") {
      throw new Error(`Invalid ${label}.step`);
    }
    const whose = expectString(value.whose, `${label}.whose`);
    if (whose !== "controller" && whose !== "any") {
      throw new Error(`Invalid ${label}.whose`);
    }
    return {
      kind,
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      step,
      whose,
      effects: parseGameEffects(value.effects, `${label}.effects`),
      sourceId:
        value.sourceId === null || value.sourceId === undefined
          ? null
          : expectString(value.sourceId, `${label}.sourceId`),
    };
  }
  if (kind === "grant_free_cast_from_hand") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      ...(value.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(value.maxManaValue, `${label}.maxManaValue`) }),
      count: expectNumber(value.count, `${label}.count`),
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
      ...(value.minManaValue === undefined
        ? {}
        : { minManaValue: expectNumber(value.minManaValue, `${label}.minManaValue`) }),
      ...(value.minPower === undefined
        ? {}
        : { minPower: expectNumber(value.minPower, `${label}.minPower`) }),
      ...(value.exceptSubtype === undefined
        ? {}
        : { exceptSubtype: expectString(value.exceptSubtype, `${label}.exceptSubtype`) }),
      ...(value.exceptTypes === undefined
        ? {}
        : { exceptTypes: parseStringList(value.exceptTypes, `${label}.exceptTypes`) }),
      ...(value.opponentsOf === undefined
        ? {}
        : { opponentsOf: expectString(value.opponentsOf, `${label}.opponentsOf`) }),
      ...(value.onlySubtype === undefined
        ? {}
        : { onlySubtype: expectString(value.onlySubtype, `${label}.onlySubtype`) }),
      ...(value.addManaPerDestroyed === undefined
        ? {}
        : { addManaPerDestroyed: parseManaColor(value.addManaPerDestroyed, `${label}.addManaPerDestroyed`) }),
      ...(value.manaTo === undefined
        ? {}
        : { manaTo: expectString(value.manaTo, `${label}.manaTo`) }),
    };
  }
  if (kind === "create_emblem") {
    return {
      kind,
      ownerId: expectString(value.ownerId, `${label}.ownerId`),
      statics: parseStaticAbilities(value.statics, undefined, `${label}.statics`),
    };
  }
  if (kind === "roll_die_treasures") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      sides: expectNumber(value.sides, `${label}.sides`),
    };
  }
  if (kind === "cumulative_upkeep" || kind === "echo") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cardId: expectString(value.cardId, `${label}.cardId`),
      cost: expectString(value.cost, `${label}.cost`),
    };
  }
  if (kind === "sacrifice_unless_sacrifice") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cardId: expectString(value.cardId, `${label}.cardId`),
      scope: "land",
    };
  }
  if (kind === "unless_pays" || kind === "may_pay") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cost: expectString(value.cost, `${label}.cost`, value.life !== undefined),
      // Both carry a life cost now — Call of the Ring pays for its draw
      // that way. Parsing it for both is what kept these two from drifting
      // apart when it arrived.
      ...(value.life === undefined
        ? {}
        : { life: expectNumber(value.life, `${label}.life`) }),
      effects: parseGameEffects(value.effects, `${label}.effects`),
      ...(kind === "may_pay" && value.hostMissing === true ? { hostMissing: true } : {}),
      ...(kind === "may_pay" && value.elseEffects !== undefined
        ? { elseEffects: parseGameEffects(value.elseEffects, `${label}.elseEffects`) }
        : {}),
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
  if (kind === "return_self_as_enchantment") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "germ_attach") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "exile_graveyard") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "commander_to_hand") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "fight") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      otherId: expectString(value.otherId, `${label}.otherId`),
    };
  }
  if (kind === "grant_protection_choice") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      playerId: expectString(value.playerId, `${label}.playerId`),
    };
  }
  if (kind === "opponents_lose_keywords_until_eot") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      keywords: parseKeywords(value.keywords, `${label}.keywords`),
      ...(value.creaturesOnly === true ? { creaturesOnly: true } : {}),
      ...(value.alsoLock === true ? { alsoLock: true } : {}),
    };
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
      ...(value.exileIfLeaves === true ? { exileIfLeaves: true } : {}),
      ...(value.putByAbilityOf === undefined
        ? {}
        : { putByAbilityOf: expectString(value.putByAbilityOf, `${label}.putByAbilityOf`) }),
      ...(value.destroy === true ? { destroy: true } : {}),
      ...(value.denyRegeneration === true ? { denyRegeneration: true } : {}),
      ...(value.transformed === true ? { transformed: true } : {}),
      ...(value.controllerId === undefined
        ? {}
        : { controllerId: expectString(value.controllerId, `${label}.controllerId`) }),
      ...(isRecord(value.withCounter)
        ? {
            withCounter: {
              counter: expectString(value.withCounter.counter, `${label}.withCounter.counter`),
              amount: expectNumber(value.withCounter.amount, `${label}.withCounter.amount`),
            },
          }
        : {}),
    };
  }
  if (kind === "become_copy") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      ofCardId: expectString(value.ofCardId, `${label}.ofCardId`),
      ...(value.untilEot === true ? { untilEot: true } : {}),
      ...(value.keepAbilities === true ? { keepAbilities: true } : {}),
    };
  }
  if (kind === "look_top_take_matching") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      filter: parseSearchFilter(value.filter, `${label}.filter`),
    };
  }
  if (kind === "play_hidden_card") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      sourceId: expectString(value.sourceId, `${label}.sourceId`),
      ...(value.free === true ? { free: true } : {}),
    };
  }
  if (kind === "grant_self_activated") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      ability: parseActivatedAbilities([value.ability], `${label}.ability`)[0]!,
    };
  }
  if (kind === "grant_self_mana") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      ability: parseManaAbilities([value.ability], `${label}.ability`)[0]!,
    };
  }
  if (kind === "grant_play_chosen") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      cardId: expectString(value.cardId, `${label}.cardId`),
      ...(value.free === true ? { free: true } : {}),
    };
  }
  if (kind === "imprint") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      sourceId: expectString(value.sourceId, `${label}.sourceId`),
    };
  }
  if (
    kind === "tap" ||
    kind === "untap" ||
    kind === "remove_from_combat" ||
    kind === "tap_or_untap" ||
    kind === "sacrifice"
  ) {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "types_until_eot") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      types: expectStringArray(value.types, `${label}.types`),
    };
  }
  if (kind === "shuffle_zones_into_library") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      zones: parseShuffleZones(value.zones, `${label}.zones`),
    };
  }
  if (kind === "add_counter") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      counter: expectString(value.counter, `${label}.counter`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
  }
  if (kind === "remove_counter") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      counter: expectString(value.counter, `${label}.counter`),
      amount: expectNumber(value.amount, `${label}.amount`),
      ...(value.sacrificeWhenEmpty === true ? { sacrificeWhenEmpty: true } : {}),
    };
  }
  if (kind === "move_all_counters") {
    return {
      kind,
      fromId: expectString(value.fromId, `${label}.fromId`),
      toId: expectString(value.toId, `${label}.toId`),
    };
  }
  if (kind === "move_counter") {
    return {
      kind,
      fromId: expectString(value.fromId, `${label}.fromId`),
      toId: expectString(value.toId, `${label}.toId`),
      counter: expectString(value.counter, `${label}.counter`),
    };
  }
  if (kind === "distribute_counters") {
    return {
      kind,
      counter: expectString(value.counter, `${label}.counter`),
      cardIds: expectStringArray(value.cardIds, `${label}.cardIds`),
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
    return {
      kind,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
      ...(value.exileInstead === true ? { exileInstead: true } : {}),
    };
  }
  if (kind === "mill_and_dig_free") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      excludedName: expectString(value.excludedName, `${label}.excludedName`),
    };
  }
  if (kind === "bounce_spell_or_permanent") {
    return {
      kind,
      ...(value.cardId === undefined
        ? {}
        : { cardId: expectString(value.cardId, `${label}.cardId`) }),
      ...(value.stackObjectId === undefined
        ? {}
        : { stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`) }),
    };
  }
  if (kind === "exchange_life_toughness") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      sourceId: expectString(value.sourceId, `${label}.sourceId`),
    };
  }
  if (kind === "copy_spell") {
    return {
      kind,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
    };
  }
  if (kind === "exile_spell") {
    return {
      kind,
      stackObjectId: expectString(value.stackObjectId, `${label}.stackObjectId`),
    };
  }
  if (kind === "extra_combat") {
    return {
      kind,
      ...(value.untapAtBeginning === true ? { untapAtBeginning: true } : {}),
    };
  }
  if (kind === "fog") {
    return {
      kind,
      ...(value.forPlayerId === undefined
        ? {}
        : { forPlayerId: expectString(value.forPlayerId, `${label}.forPlayerId`) }),
      ...(isRecord(value.tokenPerDamage)
        ? {
            tokenPerDamage: parseGameEffect(
              value.tokenPerDamage,
              `${label}.tokenPerDamage`,
            ) as Extract<GameEffect, { kind: "create_token" }>,
          }
        : {}),
    };
  }
  if (kind === "windfall") {
    return {
      kind,
      ...(value.drawCount === undefined
        ? {}
        : { drawCount: expectNumber(value.drawCount, `${label}.drawCount`) }),
    };
  }
  if (kind === "exile_top_to_hand") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "living_death") {
    return { kind };
  }
  if (kind === "may_sacrifice") {
    if (value.what !== "land" && value.what !== "another_creature") {
      throw new Error(`Invalid ${label}.what`);
    }
    return {
      kind,
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      what: value.what,
      ...(value.cardId === undefined
        ? {}
        : { cardId: expectString(value.cardId, `${label}.cardId`) }),
      effects: parseGameEffects(value.effects, `${label}.effects`),
    };
  }
  if (kind === "exile_targets_into_tokens") {
    if (!isRecord(value.token)) {
      throw new Error(`Invalid ${label}.token`);
    }
    return {
      kind,
      cardIds: expectStringArray(value.cardIds, `${label}.cardIds`),
      token: {
        name: expectString(value.token.name, `${label}.token.name`),
        typeLine: expectString(value.token.typeLine, `${label}.token.typeLine`),
        power: expectNumber(value.token.power, `${label}.token.power`),
        toughness: expectNumber(value.token.toughness, `${label}.token.toughness`),
      },
    };
  }
  if (kind === "copy_each_token") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "bounce_each_creature") {
    return {
      kind,
      ...(value.unlessCounter === undefined
        ? {}
        : { unlessCounter: expectString(value.unlessCounter, `${label}.unlessCounter`) }),
      ...(value.onlyAttacking === true ? { onlyAttacking: true } : {}),
      ...(value.exceptSubtype === undefined
        ? {}
        : { exceptSubtype: expectString(value.exceptSubtype, `${label}.exceptSubtype`) }),
      ...(value.exceptTypes === undefined
        ? {}
        : { exceptTypes: parseStringList(value.exceptTypes, `${label}.exceptTypes`) }),
    };
  }
  if (kind === "dig_top") {
    const digDestination = expectString(value.destination, `${label}.destination`);
    if (
      digDestination !== "hand" &&
      digDestination !== "battlefield" &&
      digDestination !== "battlefield_tapped"
    ) {
      throw new Error(`Invalid ${label}.destination`);
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      count: expectNumber(value.count, `${label}.count`),
      filter: parseSearchFilter(value.filter, `${label}.filter`),
      destination: digDestination,
      ...(value.restTo === "graveyard" || value.restTo === "bottom"
        ? { restTo: value.restTo }
        : {}),
    };
  }
  if (kind === "untap_all") {
    const what = expectString(value.what, `${label}.what`);
    if (what !== "creature" && what !== "land" && what !== "attacking" && what !== "nonland") {
      throw new Error(`Invalid ${label}.what`);
    }
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      what,
      ...(value.excludeSource === true ? { excludeSource: true } : {}),
      ...(value.subtypes === undefined
        ? {}
        : { subtypes: parseStringList(value.subtypes, `${label}.subtypes`) }),
      ...(value.sourceId === undefined
        ? {}
        : { sourceId: expectString(value.sourceId, `${label}.sourceId`) }),
    };
  }
  if (kind === "exert") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "tap_all") {
    const tapWhat = expectString(value.what, `${label}.what`);
    if (tapWhat !== "creature" && tapWhat !== "land") {
      throw new Error(`Invalid ${label}.what`);
    }
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`), what: tapWhat };
  }
  if (kind === "goad") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      byPlayerId: expectString(value.byPlayerId, `${label}.byPlayerId`),
    };
  }
  if (kind === "goad_all" || kind === "must_attack_all") {
    return { kind, byPlayerId: expectString(value.byPlayerId, `${label}.byPlayerId`) };
  }
  if (kind === "gain_control") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      ...(value.untilEot === true ? { untilEot: true } : {}),
    };
  }
  if (kind === "gain_control_all") {
    return {
      kind,
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      what: parseControlAllScope(value.what, `${label}.what`),
      ...(value.fromId === undefined
        ? {}
        : { fromId: expectString(value.fromId, `${label}.fromId`) }),
      ...(value.untilEot === true ? { untilEot: true } : {}),
    };
  }
  if (kind === "restore_control") {
    return { kind, what: parseControlAllScope(value.what, `${label}.what`) };
  }
  if (kind === "double_counters_on") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      counter: expectString(value.counter, `${label}.counter`),
    };
  }
  if (kind === "double_counters_on_team") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      counter: expectString(value.counter, `${label}.counter`),
    };
  }
  if (kind === "ring_tempts") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "sacrifice_blocker_at_end_of_combat") {
    return { kind, cardId: expectString(value.cardId, `${label}.cardId`) };
  }
  if (kind === "proliferate") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      ...(value.thenPhaseOutTouched === true ? { thenPhaseOutTouched: true } : {}),
    };
  }
  if (kind === "populate") {
    return { kind, playerId: expectString(value.playerId, `${label}.playerId`) };
  }
  if (kind === "exile_top_play") {
    return {
      kind,
      playerId: expectString(value.playerId, `${label}.playerId`),
      casterId: expectString(value.casterId, `${label}.casterId`),
      count: expectNumber(value.count, `${label}.count`),
      ...(value.freeCast === true ? { freeCast: true } : {}),
      ...(value.untilEndOfNextTurn === true ? { untilEndOfNextTurn: true } : {}),
      ...(value.untilNonland === true ? { untilNonland: true } : {}),
    };
  }
  if (kind === "exile_return_end_step") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      controllerId: expectString(value.controllerId, `${label}.controllerId`),
      ...(value.returnsTapped === true ? { returnsTapped: true } : {}),
      ...(value.withCounter === undefined
        ? {}
        : { withCounter: expectString(value.withCounter, `${label}.withCounter`) }),
    };
  }
  if (kind === "exile_return_end_step_all") {
    return { kind, cardIds: expectStringArray(value.cardIds, `${label}.cardIds`) };
  }
  if (kind === "adapt") {
    return {
      kind,
      cardId: expectString(value.cardId, `${label}.cardId`),
      amount: expectNumber(value.amount, `${label}.amount`),
    };
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
      ...(value.colors === undefined
        ? {}
        : { colors: parseColorArray(value.colors, `${label}.colors`) }),
      ...(value.count === undefined
        ? {}
        : { count: expectNumber(value.count, `${label}.count`) }),
      ...(isRecord(value.countFromCounters)
        ? {
            countFromCounters: {
              cardId: expectString(value.countFromCounters.cardId, `${label}.countFromCounters.cardId`),
              counter: expectString(
                value.countFromCounters.counter,
                `${label}.countFromCounters.counter`,
              ),
            },
          }
        : {}),
      ...(value.countFromPowerOf === undefined
        ? {}
        : { countFromPowerOf: expectString(value.countFromPowerOf, `${label}.countFromPowerOf`) }),
      ...(value.entersTappedAttacking === true ? { entersTappedAttacking: true } : {}),
      ...(value.attackingEachOpponent === true ? { attackingEachOpponent: true } : {}),
      ...(isRecord(value.bonusPt)
        ? {
            bonusPt: {
              power: expectNumber(value.bonusPt.power, `${label}.bonusPt.power`),
              toughness: expectNumber(value.bonusPt.toughness, `${label}.bonusPt.toughness`),
              per: parseDynamicCount(value.bonusPt.per, `${label}.bonusPt.per`),
            },
          }
        : {}),
      ...(value.entersTapped === true ? { entersTapped: true } : {}),
      ...(value.atEndStep === "sacrifice" || value.atEndStep === "exile"
        ? { atEndStep: value.atEndStep }
        : {}),
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
      // Descent into Avernus: without this the tally is lost on the wire
      // and a reopened game deals the bound zero instead of counting.
      ...(value.amountFromMilled === true ? { amountFromMilled: true } : {}),
      ...(isRecord(value.amountFromCounters)
        ? {
            amountFromCounters: {
              cardId: expectString(
                value.amountFromCounters.cardId,
                `${label}.amountFromCounters.cardId`,
              ),
              counter: expectString(
                value.amountFromCounters.counter,
                `${label}.amountFromCounters.counter`,
              ),
            },
          }
        : {}),
      ...(value.gainLife === true ? { gainLife: true } : {}),
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
        if (zone !== "hand" && zone !== "graveyard" && zone !== "battlefield" && zone !== "exile") {
          throw new Error(`Invalid ${label}.sources[${index}].zone`);
        }
        return {
          playerId: expectString(entry.playerId, `${label}.sources[${index}].playerId`),
          zone,
          filter: parseCardFilter(entry.filter, `${label}.sources[${index}].filter`),
          // Every narrowing flag was dropped here. A RESUMED choice came
          // back offering the whole zone: Sylvan Library would have let a
          // card held since last turn be given back, and Dauthi Voidwalker
          // would have offered an opponent's every exiled card.
          ...(typeof entry.excludeCardId === "string"
            ? { excludeCardId: entry.excludeCardId }
            : {}),
          ...(entry.drawnThisTurn === true ? { drawnThisTurn: true } : {}),
      ...(entry.milledThisWay === true ? { milledThisWay: true } : {}),
      ...(entry.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(entry.maxManaValue, "chooseSource.maxManaValue") }),
          ...(entry.hasVoidCounter === true ? { hasVoidCounter: true } : {}),
          ...(Array.isArray(entry.sharesTypes)
            ? {
                sharesTypes: parseStringList(
                  entry.sharesTypes,
                  `${label}.sources[${index}].sharesTypes`,
                ),
              }
            : {}),
          ...(entry.maxManaValueOfSubject === true ? { maxManaValueOfSubject: true } : {}),
      ...(entry.maxManaValue === undefined
        ? {}
        : { maxManaValue: expectNumber(entry.maxManaValue, "chooseSource.maxManaValue") }),
      ...(entry.greatestManaValue === true ? { greatestManaValue: true } : {}),
        };
      }),
      thenEffects: parseCardEffects(value.thenEffects, `${label}.thenEffects`),
      ...(value.optional === true ? { optional: true } : {}),
      ...(value.thenEffectsIfNone === undefined
        ? {}
        : {
            thenEffectsIfNone: parseCardEffects(
              value.thenEffectsIfNone,
              `${label}.thenEffectsIfNone`,
            ),
          }),
      ...(typeof value.controllerId === "string"
        ? { controllerId: value.controllerId }
        : {}),
      ...(value.cantDiscards === undefined
        ? {}
        : { cantDiscards: expectNumber(value.cantDiscards, `${label}.cantDiscards`) }),
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
      ...(value.exilePlayableThisTurn === true ? { exilePlayableThisTurn: true } : {}),
      ...(value.hideawaySourceId === undefined
        ? {}
        : {
            hideawaySourceId: expectString(
              value.hideawaySourceId,
              `${label}.hideawaySourceId`,
            ),
          }),
      ...(value.exilePlayableThisTurn === true ? { exilePlayableThisTurn: true } : {}),
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
      ...(raw.spliceCardIds === undefined
        ? {}
        : { spliceCardIds: expectStringArray(raw.spliceCardIds, "action.spliceCardIds") }),
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
      ...(kind === "activate_ability" && raw.modeIndex !== undefined
        ? { modeIndex: expectNumber(raw.modeIndex, "action.modeIndex") }
        : {}),
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
  if (kind === "resolve_exile_until_taken") {
    return { kind, playerId, take: raw.take === true };
  }
  if (kind === "resolve_punisher") {
    return { kind, playerId, take: raw.take === true };
  }
  if (kind === "resolve_dredge") {
    return {
      kind,
      playerId,
      cardId: raw.cardId === null ? null : expectString(raw.cardId, "action.cardId"),
    };
  }
  if (kind === "resolve_tap_own_for_x") {
    return { kind, playerId, cardIds: expectStringArray(raw.cardIds, "action.cardIds") };
  }
  if (kind === "resolve_tempting_offer") {
    return { kind, playerId, accept: raw.accept === true };
  }
  if (kind === "resolve_divide_piles") {
    return { kind, playerId, cardIds: expectStringArray(raw.cardIds, "action.cardIds") };
  }
  if (kind === "resolve_choose_pile") {
    return { kind, playerId, takeFirst: raw.takeFirst === true };
  }
  if (kind === "resolve_card_name") {
    return { kind, playerId, cardName: expectString(raw.cardName, "action.cardName") };
  }
  if (kind === "resolve_creature_type") {
    return {
      kind,
      playerId,
      creatureType: expectString(raw.creatureType, "action.creatureType"),
    };
  }
  if (kind === "resolve_color") {
    const color = expectString(raw.color, "action.color");
    if (!(COLOR_KEYS as readonly string[]).includes(color)) {
      throw new Error("Invalid action.color");
    }
    return { kind, playerId, color: color as Color };
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
  if (kind === "resolve_discard" || kind === "resolve_choose_from_hand") {
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
      // Braids: null DECLINES. Demanding a string here would make the
      // decline unsendable over the wire, and the choice not a choice.
      cardId:
        raw.cardId === null
          ? null
          : expectString(raw.cardId, "action.cardId"),
    };
  }
  if (kind === "resolve_enter_copy") {
    return {
      kind,
      playerId,
      cardId: raw.cardId === null ? null : expectString(raw.cardId, "action.cardId"),
    };
  }
  if (kind === "resolve_trigger_mode") {
    return {
      kind,
      playerId,
      modeIndex: expectNumber(raw.modeIndex, "action.modeIndex"),
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
