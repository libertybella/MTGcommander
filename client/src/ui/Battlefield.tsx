import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  MANA_COLORS,
  autoTapPlan,
  canPayManaCost,
  countedMulligans,
  currentPrompt,
  parseManaCost,
  isClass,
  isCreature,
  isGameOver,
  isInstantOrSorcery,
  isLand,
  isMulliganOpen,
  isOpeningRoll,
  openingRollPending,
  lookedAtCardIds,
  legalChoicesForRequirement,
  legalIdsForChooseSources,
  manaAbilitiesFor,
  manaAbilitiesOf,
  manaTapOptionsFor,
  tokenTemplatesOf,
  topOfLibraryGrant,
  type ActivatedAbility,
  type CardDefinition,
  type CardInstanceId,
  type ChosenTarget,
  type GameAction,
  type GameLogEntry,
  type GameState,
  type LookDestination,
  type ManaAbility,
  type ManaColor,
  type ManualOverrideChange,
  type PlayerId,
  type PlayerZones,
  type PlayerState,
  type StackObjectId,
  type TargetRequirement,
  type TokenTemplate,
} from "@mtgcommander/engine";
import { CardTile } from "./CardTile";
import { PlayField } from "./PlayField";
import { clampPreviewBox, fieldLane, pointerToFieldPos, pointInField, snapSlot, type FieldPos } from "./fieldLayout";
import { assignOpponentSeats, opponentsAfterViewer } from "./seats";
import { actorButtonSuffix, advanceButtonLabel, playtestActorId, showAdvanceButton } from "./advanceLabel";
import { classOracleSections } from "./classOracle";
import { cardArtUrl } from "./cardArt";
import { PhaseLadder } from "./PhaseLadder";
import type { StopPrefs } from "./stopPrefs";

export type UiMode =
  | { type: "idle" }
  | {
      type: "targets";
      cardId: CardInstanceId;
      chosen: ChosenTarget[];
      origin: "spell" | "ability" | "trigger";
      abilityIndex?: number;
      faceIndex?: number;
      modeIndex?: number;
      modeIndexes?: number[];
    }
  | { type: "spell-mode-pick"; cardId: CardInstanceId; chosen?: number[] }
  | { type: "cost-sacrifice"; cardId: CardInstanceId }
  | { type: "cost-discard"; cardId: CardInstanceId; chosen: CardInstanceId[] }
  | { type: "attackers"; attackerIds: CardInstanceId[]; defenderId: PlayerId | null }
  | { type: "block-pick-blocker" }
  | { type: "block-pick-attacker"; blockerId: CardInstanceId }
  | { type: "bottom"; selected: CardInstanceId[] }
  | { type: "mana-color"; cardId: CardInstanceId; colors: ManaColor[]; manaIndex: number }
  | { type: "ability-pick"; cardId: CardInstanceId }
  | { type: "hand-choice"; cardId: CardInstanceId }
  | { type: "token-create"; cardId: CardInstanceId }
  | { type: "override"; selectedCardId: CardInstanceId | null };

type DragState = {
  cardId: CardInstanceId;
  origin: "hand" | "field";
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
};

type Props = {
  state: GameState;
  viewerId: PlayerId;
  error: string | null;
  mode: UiMode;
  onMode: (mode: UiMode) => void;
  onAction: (action: GameAction) => void;
  onNewGame: () => void;
  onLeaveTable: () => void;
  isHost?: boolean;
  /** Local hotseat: opponent hands and libraries are already unredacted. */
  openHands?: boolean;
  /** Priority stops / yield / full control for this seat (phase ladder). */
  stopPrefs?: StopPrefs;
  onStopPrefs?: (prefs: StopPrefs) => void;
};

function definition(state: GameState, cardId: CardInstanceId) {
  const card = state.cards[cardId];
  return card ? state.definitions[card.definitionId] : undefined;
}

function activatedAbility(state: GameState, cardId: CardInstanceId, abilityIndex = 0) {
  return definition(state, cardId)?.activated[abilityIndex];
}

function manaAbilityLabel(ability: ManaAbility): string {
  const damage =
    ability.damageToController > 0
      ? `. This land deals ${ability.damageToController} damage to you`
      : "";
  if (ability.producesAnyColor) {
    return `{T}: Add one mana of any color${damage}`;
  }
  if (ability.producesOptions.length > 0) {
    return `{T}: Add ${ability.producesOptions.map((color) => `{${color}}`).join(" or ")}${damage}`;
  }
  const pips = MANA_COLORS.flatMap((color) =>
    Array.from({ length: ability.produces[color] ?? 0 }, () => `{${color}}`),
  );
  return `{T}: Add ${pips.join("") || "{C}"}${damage}`;
}

function activatedAbilityLabel(ability: ActivatedAbility): string {
  if (ability.discard) {
    const effect = ability.effects[0]?.kind.replaceAll("_", " ") ?? "ability";
    return `Channel — ${ability.manaCost || "0"}, Discard: ${effect}`;
  }
  const costs = [ability.manaCost, ability.tap ? "{T}" : ""].filter(Boolean);
  const level = ability.effects[0]?.kind === "set_class_level" ? ability.effects[0].level : null;
  if (level) {
    return `${ability.manaCost}: Level ${level}`;
  }
  const effect = ability.effects[0]?.kind.replaceAll("_", " ") ?? "ability";
  return `${costs.join(", ") || "0"}: ${effect}`;
}

function usableActivated(
  state: GameState,
  cardId: CardInstanceId,
): { ability: ActivatedAbility; index: number }[] {
  const def = definition(state, cardId);
  const card = state.cards[cardId];
  if (!def || !card) {
    return [];
  }
  return def.activated
    .map((ability, index) => ({ ability, index }))
    .filter(({ ability }) => {
      if (ability.zone === "hand") {
        return false;
      }
      const effect = ability.effects[0];
      if (effect?.kind === "set_class_level") {
        return card.classLevel > 0 && effect.level === card.classLevel + 1;
      }
      return true;
    });
}

function channelAbilities(
  def: CardDefinition | undefined,
): { ability: ActivatedAbility; index: number }[] {
  if (!def) {
    return [];
  }
  return def.activated
    .map((ability, index) => ({ ability, index }))
    .filter(({ ability }) => ability.zone === "hand" && ability.discard);
}

function modeRequirements(state: GameState, mode: UiMode): TargetRequirement[] {
  if (mode.type !== "targets") {
    return [];
  }
  if (mode.origin === "ability") {
    return activatedAbility(state, mode.cardId, mode.abilityIndex)?.targetRequirements ?? [];
  }
  if (mode.origin === "trigger") {
    const prompt = currentPrompt(state);
    return prompt?.kind === "choose_targets" ? prompt.requirements : [];
  }
  const def = definition(state, mode.cardId);
  if (mode.modeIndexes && mode.modeIndexes.length > 0 && def?.modes) {
    return mode.modeIndexes.flatMap((index) => def.modes![index]?.targetRequirements ?? []);
  }
  if (mode.modeIndex !== undefined && def?.modes?.[mode.modeIndex]) {
    return def.modes[mode.modeIndex]!.targetRequirements;
  }
  return def?.targetRequirements ?? [];
}

function manaLine(mana: GameState["players"][number]["mana"]): string {
  return MANA_COLORS.filter((color) => mana[color] > 0)
    .map((color) => `${color}:${mana[color]}`)
    .join(" ") || "none";
}

function ManaFloat(props: {
  mana: GameState["players"][number]["mana"];
  testId?: string;
}) {
  const pips = MANA_COLORS.filter((color) => props.mana[color] > 0);
  return (
    <div className="mana-float" data-testid={props.testId} title={`Mana ${manaLine(props.mana)}`}>
      <span className="visually-hidden">Mana {manaLine(props.mana)}</span>
      {pips.map((color) => (
        <span
          key={color}
          className={`mana-pip mana-${color}`}
          data-testid={props.testId ? `${props.testId}-${color}` : undefined}
        >
          {props.mana[color]}
        </span>
      ))}
    </div>
  );
}

function ZonePile(props: {
  state: GameState;
  cardIds: CardInstanceId[];
  label: string;
  testId: string;
  facedown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
}) {
  const topId = props.facedown ? props.cardIds[0] : props.cardIds[props.cardIds.length - 1];
  const empty = props.cardIds.length === 0;
  return (
    <div className={["zone-pile", empty ? "is-empty" : ""].filter(Boolean).join(" ")} data-testid={props.testId}>
      {empty || !topId ? (
        <div className="pile-outline" />
      ) : props.facedown ? (
        <button
          type="button"
          className={["card-tile", "size-field", "is-hidden", "pile-back", props.selected ? "is-selected" : ""]
            .filter(Boolean)
            .join(" ")}
          disabled={!props.onClick}
          onClick={props.onClick}
          aria-label={props.label}
        />
      ) : (
        <CardTile
          state={props.state}
          cardId={topId}
          size="field"
          selected={props.selected}
          previewable={!props.facedown}
          onClick={props.onClick}
          onPreviewEnter={props.onPreviewEnter}
          onPreviewLeave={props.onPreviewLeave}
        />
      )}
      <span className="pile-label">
        {props.label} {props.cardIds.length}
      </span>
    </div>
  );
}

function CommandZone(props: {
  state: GameState;
  cardIds: CardInstanceId[];
  tax: number;
  testId: string;
  selected: (cardId: CardInstanceId) => boolean;
  onCard?: (cardId: CardInstanceId) => void;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
}) {
  const empty = props.cardIds.length === 0;
  return (
    <div className="command-dock">
      <div
        className={["command-zone", empty ? "is-empty" : ""].filter(Boolean).join(" ")}
        data-testid={props.testId}
      >
        {empty ? (
          <div className="pile-outline" />
        ) : (
          props.cardIds.map((cardId) => (
            <CardTile
              key={cardId}
              state={props.state}
              cardId={cardId}
              size="field"
              selected={props.selected(cardId)}
              previewable
              onClick={props.onCard ? () => props.onCard?.(cardId) : undefined}
              onPreviewEnter={props.onPreviewEnter}
              onPreviewLeave={props.onPreviewLeave}
            />
          ))
        )}
        <span className="pile-label">Command {props.cardIds.length}</span>
      </div>
      <p className="commander-tax" data-testid={`${props.testId}-tax`}>
        Tax = {props.tax}
      </p>
    </div>
  );
}

function pileTop(cardIds: CardInstanceId[], facedown?: boolean): CardInstanceId | undefined {
  return facedown ? cardIds[0] : cardIds[cardIds.length - 1];
}

function ZoneHud(props: {
  state: GameState;
  player: PlayerState;
  idPrefix: string;
  manaTestId?: string;
  orient?: "south" | "north" | "east" | "west";
  selected: (cardId: CardInstanceId) => boolean;
  onPile?: (cardId: CardInstanceId) => void;
  onCommand?: (cardId: CardInstanceId) => void;
  extra?: ReactNode;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
}) {
  const { player } = props;
  function clickTop(zone: "exile" | "library" | "graveyard", facedown?: boolean) {
    const top = pileTop(player.zones[zone], facedown);
    if (!top || !props.onPile) {
      return undefined;
    }
    return () => props.onPile?.(top);
  }
  return (
    <div
      className={[
        "zone-hud",
        props.orient === "north" ? "is-mirrored" : "",
        props.orient === "east" ? "is-east" : "",
        props.orient === "west" ? "is-west" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="south-life">
        <div className="life-badge" data-testid={`life-${props.idPrefix}`}>
          Life {player.life}
        </div>
        <ManaFloat mana={player.mana} testId={props.manaTestId} />
        <h2>{player.displayName}</h2>
        {props.extra}
      </div>
      <div className="zone-piles">
        <ZonePile
          state={props.state}
          cardIds={player.zones.exile}
          label="Exile"
          testId={`pile-exile-${props.idPrefix}`}
          selected={Boolean(pileTop(player.zones.exile) && props.selected(pileTop(player.zones.exile)!))}
          onClick={clickTop("exile")}
          onPreviewEnter={props.onPreviewEnter}
          onPreviewLeave={props.onPreviewLeave}
        />
        <ZonePile
          state={props.state}
          cardIds={player.zones.library}
          label="Library"
          testId={`pile-library-${props.idPrefix}`}
          facedown
          selected={Boolean(player.zones.library[0] && props.selected(player.zones.library[0]))}
          onClick={clickTop("library", true)}
          onPreviewEnter={props.onPreviewEnter}
          onPreviewLeave={props.onPreviewLeave}
        />
        <ZonePile
          state={props.state}
          cardIds={player.zones.graveyard}
          label="Graveyard"
          testId={`pile-graveyard-${props.idPrefix}`}
          selected={Boolean(
            pileTop(player.zones.graveyard) && props.selected(pileTop(player.zones.graveyard)!),
          )}
          onClick={clickTop("graveyard")}
          onPreviewEnter={props.onPreviewEnter}
          onPreviewLeave={props.onPreviewLeave}
        />
      </div>
      <CommandZone
        state={props.state}
        cardIds={player.zones.command}
        tax={player.commander.tax}
        testId={`command-${props.idPrefix}`}
        selected={props.selected}
        onCard={props.onCommand}
        onPreviewEnter={props.onPreviewEnter}
        onPreviewLeave={props.onPreviewLeave}
      />
    </div>
  );
}

function formatLogEntry(state: GameState, entry: GameLogEntry): string {
  if (entry.kind === "life_change") {
    const player = state.players.find((item) => item.id === entry.playerId);
    const name = player?.displayName ?? entry.playerId;
    const delta = entry.delta > 0 ? `+${entry.delta}` : `${entry.delta}`;
    return `${name} life ${delta}`;
  }
  if (entry.kind === "override") {
    const player = state.players.find((item) => item.id === entry.playerId);
    const name = player?.displayName ?? entry.playerId;
    return `${name} override: ${entry.summary}`;
  }
  if (entry.kind === "die_roll") {
    const player = state.players.find((item) => item.id === entry.playerId);
    const name = player?.displayName ?? entry.playerId;
    return `${name} rolled a d${entry.sides}: ${entry.result}`;
  }
  if (entry.kind === "opening_tie") {
    const names = entry.playerIds
      .map((id) => state.players.find((item) => item.id === id)?.displayName ?? id)
      .join(", ");
    return `Tie for first player — ${names} roll again`;
  }
  if (entry.kind === "first_player") {
    const player = state.players.find((item) => item.id === entry.playerId);
    const name = player?.displayName ?? entry.playerId;
    return `${name} plays first`;
  }
  if (entry.kind === "creature_type_chosen") {
    const chooserName = definition(state, entry.cardId)?.name ?? "Unknown Card";
    return `${chooserName}: chose ${entry.creatureType}`;
  }
  const name = definition(state, entry.cardId)?.name ?? "Unknown Card";
  return `${name}: ${entry.from} → ${entry.to}`;
}

function HandZone(props: {
  state: GameState;
  player: PlayerState;
  testId: string;
  activeTurn: boolean;
  size?: "hand" | "back";
  selectedIds?: CardInstanceId[];
  onCard?: (cardId: CardInstanceId) => void;
  onDoubleClick?: (cardId: CardInstanceId) => void;
  onPointerDown?: (cardId: CardInstanceId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
  onContextMenu?: (cardId: CardInstanceId, el: HTMLElement) => void;
  rejectedId?: CardInstanceId | null;
  draggingId?: CardInstanceId | null;
  previewable?: boolean;
}) {
  const empty = props.player.zones.hand.length === 0;
  const fan = (props.size ?? "hand") === "hand";
  const mid = (props.player.zones.hand.length - 1) / 2;
  return (
    <div
      className={["hand", props.activeTurn ? "is-active-turn" : "", fan ? "is-fanned" : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid={props.testId}
    >
      {empty && props.activeTurn ? <div className="hand-mist" data-testid={`${props.testId}-mist`} /> : null}
      {props.player.zones.hand.map((cardId, index) => {
        const tilt = fan ? index - mid : 0;
        return (
          <span
            key={cardId}
            className="hand-slot"
            style={
              fan
                ? {
                    transform: `rotate(${tilt * 2.8}deg) translateY(${Math.abs(tilt) * 0.16}rem)`,
                  }
                : undefined
            }
          >
            <CardTile
              state={props.state}
              cardId={cardId}
              size={props.size ?? "hand"}
              selected={props.selectedIds?.includes(cardId)}
              rejected={props.rejectedId === cardId}
              dragging={props.draggingId === cardId}
              previewable={props.previewable}
              onClick={props.onCard ? () => props.onCard?.(cardId) : undefined}
              onDoubleClick={props.onDoubleClick ? () => props.onDoubleClick?.(cardId) : undefined}
              onPointerDown={
                props.onPointerDown ? (event) => props.onPointerDown?.(cardId, event) : undefined
              }
              onPreviewEnter={props.onPreviewEnter}
              onPreviewLeave={props.onPreviewLeave}
              onContextMenu={props.onContextMenu}
            />
          </span>
        );
      })}
    </div>
  );
}

function SideCluster(props: { seat: "east" | "west"; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const hud = box.querySelector(".zone-hud") as HTMLElement | null;
    if (!hud) {
      return;
    }
    function fit() {
      if (!box || !hud) {
        return;
      }
      const naturalW = hud.offsetWidth;
      const naturalH = hud.offsetHeight;
      if (!naturalW || !naturalH) {
        return;
      }
      const scale = Math.min(box.clientWidth / naturalH, box.clientHeight / naturalW, 1);
      const rotate = props.seat === "east" ? "-90deg" : "90deg";
      hud.style.transform = `rotate(${rotate}) scale(${scale})`;
    }
    fit();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [props.seat]);
  return (
    <div ref={boxRef} className={`side-cluster is-${props.seat}`}>
      <div className="side-cluster-spin">{props.children}</div>
    </div>
  );
}

function OpponentArea(props: {
  state: GameState;
  opponent: PlayerState;
  seat: "north" | "east" | "west";
  legacyIds: boolean;
  targeting: boolean;
  selectingDefender: boolean;
  selectedDefender: boolean;
  blockPick: boolean;
  isSelected: (cardId: CardInstanceId) => boolean;
  activeTurn: boolean;
  layout: Record<string, FieldPos>;
  rejectedId: CardInstanceId | null;
  onTargetPlayer: () => void;
  onSelectDefender: () => void;
  onPermanent: (cardId: CardInstanceId) => void;
  onHandCard?: (cardId: CardInstanceId) => void;
  onHandDoubleClick?: (cardId: CardInstanceId) => void;
  onHandPointerDown?: (cardId: CardInstanceId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPermanentPointerDown?: (cardId: CardInstanceId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  draggingId?: CardInstanceId | null;
  draggingOrigin?: "hand" | "field" | null;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
  openHands?: boolean;
}) {
  const { state, opponent, legacyIds } = props;
  const areaId = legacyIds ? "area-opponent" : `area-${opponent.id}`;
  const idPrefix = legacyIds ? "opponent" : opponent.id;
  const handId = legacyIds ? "hand-opponent" : `hand-${opponent.id}`;
  const fieldId = legacyIds ? "battlefield-opponent" : `battlefield-${opponent.id}`;
  const targetId = legacyIds ? "target-opponent" : `target-${opponent.id}`;
  const attackId = legacyIds ? "attack-opponent" : `attack-${opponent.id}`;
  const clickable = props.targeting || props.blockPick || Boolean(props.openHands);
  const hud = (
    <ZoneHud
      state={state}
      player={opponent}
      idPrefix={idPrefix}
      orient={props.seat}
      selected={props.isSelected}
      onPile={undefined}
      onCommand={props.onHandCard}
      onPreviewEnter={props.onPreviewEnter}
      onPreviewLeave={props.onPreviewLeave}
      extra={
        <>
          {props.targeting ? (
            <button type="button" data-testid={targetId} onClick={props.onTargetPlayer}>
              Target {opponent.displayName}
            </button>
          ) : null}
          {props.selectingDefender ? (
            <button
              type="button"
              data-testid={attackId}
              className={props.selectedDefender ? "is-selected" : ""}
              onClick={props.onSelectDefender}
            >
              Attack {opponent.displayName}
            </button>
          ) : null}
        </>
      }
    />
  );
  const hand = (
    <HandZone
      state={state}
      player={opponent}
      testId={handId}
      activeTurn={props.activeTurn}
      size="back"
      previewable={props.openHands}
      selectedIds={opponent.zones.hand.filter(props.isSelected)}
      rejectedId={props.rejectedId}
      draggingId={props.draggingOrigin === "hand" ? props.draggingId ?? null : null}
      onCard={props.onHandCard}
      onDoubleClick={props.onHandDoubleClick}
      onPointerDown={props.onHandPointerDown}
      onPreviewEnter={props.onPreviewEnter}
      onPreviewLeave={props.onPreviewLeave}
    />
  );
  return (
    <section
      className={`player-area opponent seat-${props.seat}`}
      data-testid={areaId}
      data-seat={props.seat}
    >
      <div
        className={["seat-hud", `is-${props.seat}`].join(" ")}
        data-testid={`orient-${props.seat}`}
      >
        {hand}
        {props.seat === "north" ? hud : null}
      </div>
      {props.seat === "east" || props.seat === "west" ? (
        <SideCluster seat={props.seat}>{hud}</SideCluster>
      ) : null}
      <div className="permanents-wrap">
        <PlayField
          state={state}
          cardIds={opponent.zones.battlefield}
          layout={props.layout}
          seat={props.seat}
          testId={fieldId}
          ownerId={opponent.id}
          selected={props.isSelected}
          rejectedId={props.rejectedId}
          draggingId={props.draggingOrigin === "field" ? props.draggingId ?? null : null}
          droppable={props.openHands}
          onCardClick={clickable ? props.onPermanent : undefined}
          onCardPointerDown={props.onPermanentPointerDown}
          onPreviewEnter={props.onPreviewEnter}
          onPreviewLeave={props.onPreviewLeave}
        />
      </div>
      <p className="visually-hidden" data-testid={legacyIds ? "counts-opponent" : `counts-${opponent.id}`}>
        Hand {opponent.zones.hand.length} · Library {opponent.zones.library.length} · Graveyard{" "}
        {opponent.zones.graveyard.length} · Command {opponent.zones.command.length}
      </p>
    </section>
  );
}

function CardPreview(props: {
  state: GameState;
  cardId: CardInstanceId;
  anchor: { left: number; top: number; width: number; height: number };
}) {
  const card = props.state.cards[props.cardId];
  const def = card ? props.state.definitions[card.definitionId] : undefined;
  const other = def?.otherFaceId ? props.state.definitions[def.otherFaceId] : undefined;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const faceWidth = Math.min(220, Math.max(160, viewport.width - 24));
  const width = other ? Math.min(faceWidth * 2 + 12, viewport.width - 24) : faceWidth;
  const heightGuess = Math.min(other ? 440 : def?.oracleText ? 400 : 310, viewport.height - 24);
  const placed = clampPreviewBox(props.anchor, viewport, { width, height: heightGuess });
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return;
    }
    const next = clampPreviewBox(
      props.anchor,
      { width: window.innerWidth, height: window.innerHeight },
      { width: el.offsetWidth, height: el.offsetHeight },
    );
    el.style.left = `${next.left}px`;
    el.style.top = `${next.top}px`;
  }, [props.cardId, props.anchor.left, props.anchor.top, props.anchor.width, other?.id]);
  return (
    <div
      ref={boxRef}
      className="card-preview-float"
      data-testid="card-preview"
      style={{ left: placed.left, top: placed.top, width }}
    >
      <div className={other ? "mdfc-preview" : undefined}>
        <div className={other ? "mdfc-face is-current" : undefined} data-testid="mdfc-current">
          <CardTile state={props.state} cardId={props.cardId} size="hand" />
          {def && isClass(props.state, props.cardId) ? (
            <ClassOracleText oracleText={def.oracleText} classLevel={card?.classLevel ?? 1} />
          ) : def?.oracleText ? (
            <p className="card-preview-oracle">{def.oracleText}</p>
          ) : null}
        </div>
        {other ? (
          <div className="mdfc-face" data-testid="mdfc-other">
            {other.imageUrl || other.name ? (
              <div className="mdfc-other-art">
                {cardArtUrl(other) ? (
                  <img className="card-art" src={cardArtUrl(other) ?? ""} alt="" />
                ) : null}
                <p className="mdfc-other-name">{other.name}</p>
              </div>
            ) : null}
            {other.oracleText ? <p className="card-preview-oracle">{other.oracleText}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ClassOracleText(props: { oracleText: string; classLevel: number }) {
  return (
    <div className="class-oracle" data-testid="class-oracle">
      {classOracleSections(props.oracleText).map((section) => (
        <p
          key={section.level}
          className={
            section.level === props.classLevel
              ? "is-class-current"
              : section.level < props.classLevel
                ? "is-class-gained"
                : "is-class-locked"
          }
        >
          {section.text}
        </p>
      ))}
    </div>
  );
}

function AbilityChoicePop(props: {
  cardId: CardInstanceId;
  mana: ManaAbility[];
  activated: { ability: ActivatedAbility; index: number }[];
  onMana: (index: number) => void;
  onActivated: (index: number) => void;
}) {
  const el = document.querySelector(`[data-testid="card-${props.cardId}"]`);
  const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
  if (!rect) {
    return null;
  }
  const left = rect.right + 10;
  const maxLeft = window.innerWidth - 220;
  return createPortal(
    <div
      className="mana-choice-pop ability-choice-pop"
      data-testid="ability-pick-hint"
      style={{
        left: left > maxLeft ? Math.max(8, rect.left - 220) : left,
        top: Math.max(8, rect.top),
      }}
    >
      <p>Choose an ability</p>
      {props.mana.map((ability, index) => (
        <button
          key={`mana-${index}`}
          type="button"
          data-testid={`ability-mana-${index}`}
          onClick={() => props.onMana(index)}
        >
          {manaAbilityLabel(ability)}
        </button>
      ))}
      {props.activated.map(({ ability, index }) => (
        <button
          key={`activated-${index}`}
          type="button"
          data-testid={`ability-activated-${index}`}
          onClick={() => props.onActivated(index)}
        >
          {activatedAbilityLabel(ability)}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function lookDestLabel(destination: LookDestination): string {
  if (destination === "hand") {
    return "Hand";
  }
  if (destination === "library_bottom") {
    return "Bottom";
  }
  return "Exile";
}

function TokenCreatePop(props: {
  cardId: CardInstanceId;
  templates: TokenTemplate[];
  onPick: (template: TokenTemplate) => void;
}) {
  const el = document.querySelector(`[data-testid="card-${props.cardId}"]`);
  const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
  if (!rect) {
    return null;
  }
  const left = rect.right + 10;
  const maxLeft = window.innerWidth - 220;
  return createPortal(
    <div
      className="mana-choice-pop ability-choice-pop"
      data-testid="token-create-hint"
      style={{
        left: left > maxLeft ? Math.max(8, rect.left - 220) : left,
        top: Math.max(8, rect.top),
      }}
    >
      <p>Create a token</p>
      {props.templates.map((template, index) => (
        <button
          key={`${template.name}-${index}`}
          type="button"
          data-testid={`token-create-${index}`}
          onClick={() => props.onPick(template)}
        >
          {template.name}
          {template.power != null && template.toughness != null
            ? ` ${template.power}/${template.toughness}`
            : ""}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function HandChoicePop(props: {
  cardId: CardInstanceId;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  const el = document.querySelector(`[data-testid="card-${props.cardId}"]`);
  const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
  if (!rect) {
    return null;
  }
  const left = rect.right + 10;
  const maxLeft = window.innerWidth - 220;
  return createPortal(
    <div
      className="mana-choice-pop ability-choice-pop"
      data-testid="hand-choice-hint"
      style={{
        left: left > maxLeft ? Math.max(8, rect.left - 220) : left,
        top: Math.max(8, rect.top),
      }}
    >
      <p>Choose how to play</p>
      {props.options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-testid={`hand-choice-${option.id}`}
          onClick={() => props.onPick(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ManaChoicePop(props: {
  cardId: CardInstanceId;
  colors: ManaColor[];
  onPick: (color: ManaColor) => void;
}) {
  const el = document.querySelector(`[data-testid="card-${props.cardId}"]`);
  const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
  if (!rect) {
    return null;
  }
  const left = rect.right + 10;
  const maxLeft = window.innerWidth - 140;
  return createPortal(
    <div
      className="mana-choice-pop"
      data-testid="mana-color-hint"
      style={{
        left: left > maxLeft ? Math.max(8, rect.left - 140) : left,
        top: Math.max(8, rect.top),
      }}
    >
      <p>Choose a color</p>
      {props.colors.map((color) => (
        <button
          key={color}
          type="button"
          data-testid={`mana-color-${color}`}
          onClick={() => props.onPick(color)}
        >
          Add {color}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function Battlefield(props: Props) {
  const {
    state,
    viewerId,
    error,
    mode,
    onMode,
    onAction,
    onNewGame,
    onLeaveTable,
    isHost = true,
    openHands = false,
    stopPrefs,
    onStopPrefs,
  } = props;
  const [logOpen, setLogOpen] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [dieSidesOpen, setDieSidesOpen] = useState(false);
  const [dieSidesDraft, setDieSidesDraft] = useState("20");
  const [chatDraft, setChatDraft] = useState("");
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatLines, setChatLines] = useState<{ name: string; text: string }[]>([]);
  const [layout, setLayout] = useState<Record<string, FieldPos>>({});
  const [rejectedId, setRejectedId] = useState<CardInstanceId | null>(null);
  const [preview, setPreview] = useState<{
    cardId: CardInstanceId;
    rect: DOMRect;
    width: number;
    height: number;
  } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [lookAssign, setLookAssign] = useState<Record<string, LookDestination>>({});
  const pendingPos = useRef<Record<string, FieldPos>>({});
  const attemptedId = useRef<CardInstanceId | null>(null);
  const previewLocked = useRef<CardInstanceId | null>(null);
  const suppressClick = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const finishDragRef = useRef<(cur: DragState, event: PointerEvent) => void>(() => {});
  dragRef.current = drag;

  useEffect(() => {
    setLayout((prev) => {
      const next = { ...prev };
      let changed = false;
      const alive = new Set<string>();
      for (const player of state.players) {
        const counts = { creature: 0, artifact: 0, planeswalker: 0, land: 0 };
        for (const cardId of player.zones.battlefield) {
          alive.add(cardId);
          const lane = fieldLane(state, cardId);
          if (!next[cardId]) {
            const pending = pendingPos.current[cardId];
            next[cardId] = pending ?? snapSlot(lane, counts[lane]);
            if (pending) {
              delete pendingPos.current[cardId];
            }
            changed = true;
          }
          counts[lane] += 1;
        }
      }
      for (const id of Object.keys(next)) {
        if (!alive.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [state]);

  useEffect(() => {
    if (!error || !attemptedId.current) {
      return;
    }
    const id = attemptedId.current;
    setRejectedId(id);
    const timer = window.setTimeout(() => {
      setRejectedId((current) => (current === id ? null : current));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!drag) {
      return;
    }
    function move(event: PointerEvent) {
      setDrag((current) => {
        if (!current || current.pointerId !== event.pointerId) {
          return current;
        }
        const moved =
          current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 8;
        if (moved) {
          previewLocked.current = current.cardId;
          setPreview(null);
        }
        return { ...current, x: event.clientX, y: event.clientY, moved };
      });
    }
    function up(event: PointerEvent) {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      setDrag(null);
      if (!current.moved) {
        return;
      }
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      finishDragRef.current(current, event);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag?.pointerId]);

  const actorId = playtestActorId(state, viewerId, openHands);
  const prompt = currentPrompt(state);

  useEffect(() => {
    setLookAssign({});
  }, [prompt?.kind, prompt && "count" in prompt ? prompt.count : 0, prompt?.playerId]);

  useEffect(() => {
    if (!prompt || prompt.kind !== "choose_targets" || actorId !== prompt.playerId) {
      if (mode.type === "targets" && mode.origin === "trigger") {
        onMode({ type: "idle" });
      }
      return;
    }
    if (
      mode.type === "targets" &&
      mode.origin === "trigger" &&
      mode.cardId === prompt.sourceId
    ) {
      return;
    }
    onMode({
      type: "targets",
      cardId: prompt.sourceId,
      chosen: [],
      origin: "trigger",
    });
  }, [prompt, mode, onMode, actorId]);

  useEffect(() => {
    if (
      state.turn.step !== "declareAttackers" ||
      state.turn.activePlayerId !== actorId ||
      state.priorityPlayerId !== actorId ||
      state.combat?.attackersDeclared ||
      mode.type !== "idle"
    ) {
      return;
    }
    const living = opponentsAfterViewer(state.players, actorId).filter((player) => !player.lost);
    onMode({
      type: "attackers",
      attackerIds: [],
      defenderId: living.length === 1 ? (living[0]?.id ?? null) : null,
    });
  }, [
    state.turn.step,
    state.turn.activePlayerId,
    state.priorityPlayerId,
    state.combat?.attackersDeclared,
    actorId,
    mode.type,
    state.players,
    onMode,
  ]);

  useEffect(() => {
    if (
      state.turn.step !== "declareBlockers" ||
      state.turn.activePlayerId !== actorId ||
      state.priorityPlayerId !== actorId ||
      mode.type !== "idle"
    ) {
      return;
    }
    onMode({ type: "block-pick-blocker" });
  }, [
    state.turn.step,
    state.turn.activePlayerId,
    state.priorityPlayerId,
    actorId,
    mode.type,
    onMode,
  ]);

  const you = state.players.find((player) => player.id === viewerId);
  const opponents = opponentsAfterViewer(state.players, viewerId);
  if (!you || opponents.length === 0) {
    return <p>Missing players.</p>;
  }
  const seatedName = you.displayName;
  const seats = assignOpponentSeats(opponents);

  const over = isGameOver(state);
  const winner = state.players.find((player) => player.id === state.winnerId);
  const priority = state.players.find((player) => player.id === state.priorityPlayerId);
  const activePlayer = state.players.find((player) => player.id === state.turn.activePlayerId);
  const forActor = actorButtonSuffix(state, actorId, viewerId);
  const canAdvance = showAdvanceButton(state, actorId);
  const chooser = prompt
    ? state.players.find((player) => player.id === prompt.playerId)
    : undefined;
  const targeting = mode.type === "targets";
  const nextRequirement = targeting ? modeRequirements(state, mode)[mode.chosen.length] : undefined;
  const targetingSpell =
    targeting &&
    (nextRequirement?.kind === "spell" ||
      nextRequirement?.kind === "creature_spell" ||
      nextRequirement?.kind === "noncreature_spell" ||
      nextRequirement?.kind === "instant_or_sorcery_spell");
  const livingOpponents = opponents.filter((player) => !player.lost);
  const logLines = state.log.slice(-40);
  const noticeLines = state.log
    .filter(
      (entry) =>
        entry.kind === "die_roll" || entry.kind === "opening_tie" || entry.kind === "first_player",
    )
    .map((entry) => ({
      name: "Table",
      text: formatLogEntry(state, entry).replace(/^Table:\s*/, ""),
    }));
  const tableChat = [...noticeLines, ...chatLines];
  const openingRollOpen = isOpeningRoll(state);
  const needsOpeningRoll = openingRollOpen && openingRollPending(state, actorId);
  const mulliganOpen = isMulliganOpen(state);
  const deciding = state.mulligan?.decidingPlayerId === actorId;
  const pendingBottom = state.mulligan?.pendingBottom ?? 0;
  const bottoming = deciding && pendingBottom > 0;
  const selectedBottom = mode.type === "bottom" ? mode.selected : [];
  const decider = state.players.find((player) => player.id === state.mulligan?.decidingPlayerId);
  const overriding = mode.type === "override";
  const overrideCardId = overriding ? mode.selectedCardId : null;

  function isTempSelected(cardId: CardInstanceId): boolean {
    if (selectedBottom.includes(cardId) || overrideCardId === cardId) {
      return true;
    }
    if (mode.type === "attackers") {
      return mode.attackerIds.includes(cardId);
    }
    if (mode.type === "block-pick-attacker") {
      return mode.blockerId === cardId;
    }
    if (mode.type === "mana-color" || mode.type === "ability-pick" || mode.type === "hand-choice" || mode.type === "token-create" || mode.type === "spell-mode-pick" || mode.type === "cost-sacrifice" || mode.type === "cost-discard") {
      return mode.cardId === cardId;
    }
    if (mode.type === "targets") {
      if (mode.cardId === cardId) {
        return true;
      }
      return mode.chosen.some((target) => target.type === "creature" && target.cardId === cardId);
    }
    return false;
  }
  const overrideMoveZones: (keyof PlayerZones)[] = [
    "hand",
    "battlefield",
    "graveyard",
    "exile",
    "command",
    "library",
  ];

  function sendOverride(change: ManualOverrideChange) {
    onAction({ kind: "manual_override", playerId: actorId, change });
  }

  function send(action: GameAction) {
    onMode({ type: "idle" });
    // Arena-style auto-tap: cover a castable cost from untapped producers
    // before the spell or ability is submitted. The engine still validates.
    if (action.kind === "cast_spell" || action.kind === "activate_ability") {
      const card = state.cards[action.cardId];
      const def = card ? state.definitions[card.definitionId] : undefined;
      const costText =
        action.kind === "activate_ability"
          ? def?.activated[action.abilityIndex]?.manaCost ?? ""
          : def?.manaCost ?? "";
      try {
        const cost = parseManaCost(costText);
        const player = state.players.find((entry) => entry.id === action.playerId);
        if (player?.zones.command.includes(action.cardId)) {
          cost.generic += player.commander.tax;
        }
        if (action.kind === "cast_spell" && action.xValue !== undefined) {
          cost.generic += action.xValue * cost.xCount;
        }
        if (player && !canPayManaCost(player.mana, cost, player.life)) {
          const plan = autoTapPlan(state, action.playerId, cost);
          for (const tap of plan ?? []) {
            onAction({
              kind: "tap_for_mana",
              playerId: action.playerId,
              cardId: tap.cardId,
              ...(tap.color ? { color: tap.color } : {}),
              ...(tap.manaIndex !== undefined ? { manaIndex: tap.manaIndex } : {}),
            });
          }
        }
      } catch {
        // Unparseable cost: submit as-is and let the engine explain.
      }
    }
    onAction(action);
  }

  function sendAdvance() {
    if (
      state.turn.step === "declareAttackers" &&
      state.turn.activePlayerId === actorId &&
      !state.combat?.attackersDeclared
    ) {
      if (mode.type === "attackers" && mode.attackerIds.length > 0 && !mode.defenderId) {
        return;
      }
      const attacks =
        mode.type === "attackers" && mode.defenderId
          ? mode.attackerIds.map((attackerId) => ({
              attackerId,
              defenderId: mode.defenderId as PlayerId,
            }))
          : [];
      onAction({ kind: "declare_attackers", playerId: actorId, attacks });
    }
    send({ kind: "pass_priority", playerId: actorId });
  }

  function openTokenMenu(cardId: CardInstanceId) {
    if (over || mulliganOpen) {
      return;
    }
    if (controllerOf(cardId) !== actorId) {
      return;
    }
    const def = definition(state, cardId);
    if (!def || tokenTemplatesOf(def).length === 0) {
      return;
    }
    onMode({ type: "token-create", cardId });
  }

  function submitDieRoll() {
    const sides = Number.parseInt(dieSidesDraft, 10);
    if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
      return;
    }
    setDieSidesOpen(false);
    onAction({ kind: "roll_die", playerId: actorId, sides });
  }

  function lockPreview(cardId: CardInstanceId) {
    previewLocked.current = cardId;
    setPreview(null);
  }

  function onPreviewEnter(cardId: CardInstanceId, el: HTMLElement) {
    if (previewLocked.current === cardId || dragRef.current?.moved) {
      return;
    }
    setPreview({
      cardId,
      rect: el.getBoundingClientRect(),
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
  }

  function onPreviewLeave(cardId: CardInstanceId) {
    if (previewLocked.current === cardId) {
      previewLocked.current = null;
    }
    setPreview((current) => (current?.cardId === cardId ? null : current));
  }

  function playFromHand(cardId: CardInstanceId, drop?: FieldPos) {
    if (suppressClick.current) {
      return;
    }
    lockPreview(cardId);
    attemptedId.current = cardId;
    if (prompt) {
      return;
    }
    if (drop && !isInstantOrSorcery(state, cardId)) {
      pendingPos.current[cardId] = drop;
    }
    clickHandCard(cardId);
  }

  function selectOverrideCard(cardId: CardInstanceId) {
    if (mode.type !== "override") {
      return;
    }
    onMode({
      ...mode,
      selectedCardId: mode.selectedCardId === cardId ? null : cardId,
    });
  }

  function toggleBottom(cardId: CardInstanceId) {
    const selected = selectedBottom.includes(cardId)
      ? selectedBottom.filter((id) => id !== cardId)
      : [...selectedBottom, cardId];
    onMode({ type: "bottom", selected });
  }

  function controllerOf(cardId: CardInstanceId): PlayerId | undefined {
    return state.cards[cardId]?.controllerId;
  }

  function ownerHasPriority(cardId: CardInstanceId): boolean {
    const controllerId = controllerOf(cardId);
    return Boolean(controllerId && state.priorityPlayerId === controllerId);
  }

  function clickHandCard(cardId: CardInstanceId) {
    if (suppressClick.current) {
      return;
    }
    lockPreview(cardId);
    attemptedId.current = cardId;
    if (over || mulliganOpen) {
      return;
    }
    if (prompt?.kind === "choose_discard" && actorId === prompt.playerId && you?.zones.hand.includes(cardId)) {
      send({ kind: "resolve_discard", playerId: actorId, cardIds: [cardId] });
      return;
    }
    if (prompt?.kind === "choose_card" && actorId === prompt.playerId) {
      const legal = legalIdsForChooseSources(state, prompt.sources);
      if (legal.includes(cardId)) {
        send({ kind: "resolve_choose_card", playerId: actorId, cardId });
        return;
      }
    }
    if (prompt) {
      return;
    }
    if (mode.type === "cost-discard") {
      if (you?.zones.hand.includes(cardId)) {
        pickCostDiscard(cardId);
      }
      return;
    }
    if (mode.type === "override") {
      selectOverrideCard(cardId);
      return;
    }
    const playerId = controllerOf(cardId);
    if (!playerId || !ownerHasPriority(cardId)) {
      setRejectedId(cardId);
      window.setTimeout(() => {
        setRejectedId((current) => (current === cardId ? null : current));
      }, 1000);
      return;
    }
    const def = definition(state, cardId);
    const channels = channelAbilities(def);
    const modal = def?.layout === "modal_dfc" && Boolean(def.otherFaceId);
    if (modal || channels.length > 0) {
      onMode({ type: "hand-choice", cardId });
      return;
    }
    if (isLand(state, cardId)) {
      send({ kind: "play_land", playerId, cardId });
      return;
    }
    if (def?.modes && def.modes.length > 0) {
      onMode({ type: "spell-mode-pick", cardId });
      return;
    }
    if (def?.additionalCost?.sacrifice) {
      onMode({ type: "cost-sacrifice", cardId });
      return;
    }
    if (def?.additionalCost?.discard) {
      onMode({ type: "cost-discard", cardId, chosen: [] });
      return;
    }
    const requirements = def?.targetRequirements ?? [];
    if (requirements.length === 0) {
      send({ kind: "cast_spell", playerId, cardId });
      return;
    }
    onMode({ type: "targets", cardId, chosen: [], origin: "spell" });
  }

  function pickCostSacrifice(sacrificeId: CardInstanceId) {
    if (mode.type !== "cost-sacrifice") {
      return;
    }
    const playerId = controllerOf(mode.cardId) ?? actorId;
    send({ kind: "cast_spell", playerId, cardId: mode.cardId, costSacrificeId: sacrificeId });
    onMode({ type: "idle" });
  }

  function pickCostDiscard(discardId: CardInstanceId) {
    if (mode.type !== "cost-discard") {
      return;
    }
    const def = definition(state, mode.cardId);
    const needed = def?.additionalCost?.discard ?? 1;
    if (discardId === mode.cardId || mode.chosen.includes(discardId)) {
      return;
    }
    const chosen = [...mode.chosen, discardId];
    if (chosen.length >= needed) {
      const playerId = controllerOf(mode.cardId) ?? actorId;
      send({ kind: "cast_spell", playerId, cardId: mode.cardId, costDiscardIds: chosen });
      onMode({ type: "idle" });
      return;
    }
    onMode({ type: "cost-discard", cardId: mode.cardId, chosen });
  }

  function pickSpellMode(cardId: CardInstanceId, modeIndex: number) {
    const playerId = controllerOf(cardId) ?? actorId;
    const def = definition(state, cardId);
    if (def?.modeChoice) {
      const current = mode.type === "spell-mode-pick" ? mode.chosen ?? [] : [];
      const toggled = current.includes(modeIndex)
        ? current.filter((index) => index !== modeIndex)
        : [...current, modeIndex].sort((a, b) => a - b);
      onMode({ type: "spell-mode-pick", cardId, chosen: toggled });
      return;
    }
    const spellMode = def?.modes?.[modeIndex];
    if (!spellMode) {
      onMode({ type: "idle" });
      return;
    }
    if (spellMode.targetRequirements.length === 0) {
      send({ kind: "cast_spell", playerId, cardId, modeIndex });
      onMode({ type: "idle" });
      return;
    }
    onMode({ type: "targets", cardId, chosen: [], origin: "spell", modeIndex });
  }

  function confirmSpellModes(cardId: CardInstanceId, chosen: number[]) {
    const playerId = controllerOf(cardId) ?? actorId;
    const def = definition(state, cardId);
    const requirements = def?.modes
      ? chosen.flatMap((index) => def.modes![index]?.targetRequirements ?? [])
      : [];
    if (requirements.length === 0) {
      send({ kind: "cast_spell", playerId, cardId, modeIndexes: chosen });
      onMode({ type: "idle" });
      return;
    }
    onMode({ type: "targets", cardId, chosen: [], origin: "spell", modeIndexes: chosen });
  }

  function pickHandChoice(cardId: CardInstanceId, optionId: string) {
    const playerId = controllerOf(cardId) ?? actorId;
    const def = definition(state, cardId);
    if (optionId.startsWith("face-")) {
      const faceIndex = Number(optionId.slice(5));
      const faceDef =
        faceIndex === 1 && def?.otherFaceId
          ? state.definitions[def.otherFaceId]
          : def;
      if (faceDef?.typeLine.toLowerCase().includes("land")) {
        send({ kind: "play_land", playerId, cardId, faceIndex });
        return;
      }
      const requirements = faceDef?.targetRequirements ?? [];
      if (requirements.length === 0) {
        send({ kind: "cast_spell", playerId, cardId, faceIndex });
        return;
      }
      onMode({ type: "targets", cardId, chosen: [], origin: "spell", faceIndex });
      return;
    }
    if (optionId.startsWith("channel-")) {
      const abilityIndex = Number(optionId.slice(8));
      beginActivate(cardId, playerId, abilityIndex);
    }
  }

  function beginDrag(
    origin: "hand" | "field",
    cardId: CardInstanceId,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0 || over || mulliganOpen) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      cardId,
      origin,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  }

  finishDragRef.current = (current, event) => {
    const ownerId = controllerOf(current.cardId);
    const ownerField = ownerId
      ? document.querySelector<HTMLElement>(`[data-field-owner="${ownerId}"]`)
      : null;
    const fields = [...document.querySelectorAll<HTMLElement>("[data-field-owner]")];
    const hit =
      fields.find((el) => pointInField(el, event.clientX, event.clientY)) ?? null;
    if (current.origin === "field") {
      const target = ownerField ?? hit;
      if (!target) {
        return;
      }
      setLayout((prev) => ({
        ...prev,
        [current.cardId]: pointerToFieldPos(target, event.clientX, event.clientY),
      }));
      return;
    }
    if (!hit) {
      return;
    }
    const dropOnOwner = Boolean(ownerField && pointInField(ownerField, event.clientX, event.clientY));
    playFromHand(
      current.cardId,
      dropOnOwner && ownerField
        ? pointerToFieldPos(ownerField, event.clientX, event.clientY)
        : undefined,
    );
  };

  function clickPermanent(cardId: CardInstanceId) {
    if (suppressClick.current) {
      return;
    }
    lockPreview(cardId);
    if (over) {
      return;
    }
    if (prompt?.kind === "choose_card" && actorId === prompt.playerId) {
      const legal = legalIdsForChooseSources(state, prompt.sources);
      if (legal.includes(cardId)) {
        send({ kind: "resolve_choose_card", playerId: actorId, cardId });
        return;
      }
    }
    if (mode.type === "override") {
      if (controllerOf(cardId) === actorId) {
        const card = state.cards[cardId];
        if (card?.zone === "battlefield") {
          sendOverride({ type: "set_tapped", cardId, tapped: !card.tapped });
        }
        selectOverrideCard(cardId);
      }
      return;
    }
    if (mode.type === "cost-sacrifice") {
      if (controllerOf(cardId) === actorId) {
        pickCostSacrifice(cardId);
      }
      return;
    }
    if (mode.type === "targets" && !targetingSpell) {
      if (nextRequirement?.kind === "opponent" || nextRequirement?.kind === "player") {
        return;
      }
      addTarget({ type: "creature", cardId });
      return;
    }
    if (mode.type === "attackers" && isCreature(state, cardId) && controllerOf(cardId) === state.turn.activePlayerId) {
      const next = mode.attackerIds.includes(cardId)
        ? mode.attackerIds.filter((id) => id !== cardId)
        : [...mode.attackerIds, cardId];
      onMode({ type: "attackers", attackerIds: next, defenderId: mode.defenderId });
      return;
    }
    if (mode.type === "block-pick-blocker" && isCreature(state, cardId)) {
      onMode({ type: "block-pick-attacker", blockerId: cardId });
      return;
    }
    if (mode.type === "block-pick-attacker") {
      send({
        kind: "declare_blockers",
        playerId: actorId,
        blocks: [{ blockerId: mode.blockerId, attackerId: cardId }],
      });
      return;
    }
    const playerId = controllerOf(cardId);
    if (!playerId || !ownerHasPriority(cardId)) {
      return;
    }
    const def = definition(state, cardId);
    if (!def || mulliganOpen) {
      return;
    }
    const mana = manaAbilitiesFor(state, cardId);
    const usable = usableActivated(state, cardId);
    if (mana.length + usable.length > 1) {
      onMode({ type: "ability-pick", cardId });
      return;
    }
    if (mana.length === 1) {
      beginManaTap(cardId, playerId, 0);
      return;
    }
    if (usable[0]) {
      beginActivate(cardId, playerId, usable[0].index);
    }
  }

  function beginManaTap(cardId: CardInstanceId, playerId: PlayerId, manaIndex: number) {
    const def = definition(state, cardId);
    if (!def) {
      return;
    }
    const ability = manaAbilitiesFor(state, cardId)[manaIndex];
    if (!ability) {
      return;
    }
    const options = manaTapOptionsFor(ability);
    if (options && options.length > 0) {
      onMode({ type: "mana-color", cardId, colors: options, manaIndex });
      return;
    }
    send({ kind: "tap_for_mana", playerId, cardId, manaIndex });
  }

  function beginActivate(cardId: CardInstanceId, playerId: PlayerId, abilityIndex: number) {
    const ability = activatedAbility(state, cardId, abilityIndex);
    if (!ability || mulliganOpen) {
      return;
    }
    if (ability.targetRequirements.length === 0) {
      send({
        kind: "activate_ability",
        playerId,
        cardId,
        abilityIndex,
      });
      return;
    }
    onMode({ type: "targets", cardId, chosen: [], origin: "ability", abilityIndex });
  }

  function addTarget(target: ChosenTarget) {
    if (mode.type !== "targets") {
      return;
    }
    const requirements = modeRequirements(state, mode);
    const chosen = [...mode.chosen, target];
    const playerId = controllerOf(mode.cardId) ?? actorId;
    if (chosen.length >= requirements.length) {
      if (mode.origin === "trigger") {
        send({
          kind: "choose_targets",
          playerId: prompt?.playerId ?? actorId,
          targets: chosen,
        });
        return;
      }
      if (mode.origin === "ability") {
        send({
          kind: "activate_ability",
          playerId,
          cardId: mode.cardId,
          abilityIndex: mode.abilityIndex ?? 0,
          targets: chosen,
        });
        return;
      }
      send({
        kind: "cast_spell",
        playerId,
        cardId: mode.cardId,
        targets: chosen,
        ...(mode.faceIndex !== undefined ? { faceIndex: mode.faceIndex } : {}),
        ...(mode.modeIndex !== undefined ? { modeIndex: mode.modeIndex } : {}),
        ...(mode.modeIndexes ? { modeIndexes: mode.modeIndexes } : {}),
      });
      return;
    }
    onMode({
      type: "targets",
      cardId: mode.cardId,
      chosen,
      origin: mode.origin,
      abilityIndex: mode.abilityIndex,
      faceIndex: mode.faceIndex,
      modeIndex: mode.modeIndex,
      modeIndexes: mode.modeIndexes,
    });
  }

  function clickStack(stackObjectId: StackObjectId) {
    if (targetingSpell) {
      addTarget({ type: "spell", stackObjectId });
    }
  }

  function sendChat() {
    const text = chatDraft.trim();
    if (!text) {
      return;
    }
    setChatLines((lines) => [...lines, { name: seatedName, text }]);
    setChatDraft("");
  }

  const activeTurnId = state.turn.activePlayerId;

  function renderSeat(
    seat: "north" | "east" | "west",
    opponent: (typeof opponents)[number] | null,
    legacyIds: boolean,
  ) {
    if (!opponent) {
      return <div className={`seat-slot seat-${seat} is-empty`} data-testid={`seat-${seat}`} data-seat={seat} />;
    }
    return (
      <OpponentArea
        key={opponent.id}
        state={state}
        opponent={opponent}
        seat={seat}
        legacyIds={legacyIds}
        targeting={targeting && !targetingSpell}
        selectingDefender={mode.type === "attackers" && livingOpponents.length > 1}
        selectedDefender={mode.type === "attackers" && mode.defenderId === opponent.id}
        blockPick={mode.type === "block-pick-blocker" || mode.type === "block-pick-attacker"}
        isSelected={isTempSelected}
        activeTurn={opponent.id === activeTurnId}
        layout={layout}
        rejectedId={rejectedId}
        onTargetPlayer={() => addTarget({ type: "player", playerId: opponent.id })}
        onSelectDefender={() => {
          if (mode.type === "attackers") {
            onMode({ ...mode, defenderId: opponent.id });
          }
        }}
        onPermanent={clickPermanent}
        onHandCard={openHands ? clickHandCard : undefined}
        onHandDoubleClick={openHands ? playFromHand : undefined}
        onHandPointerDown={
          openHands ? (cardId, event) => beginDrag("hand", cardId, event) : undefined
        }
        onPermanentPointerDown={
          openHands ? (cardId, event) => beginDrag("field", cardId, event) : undefined
        }
        draggingId={drag?.cardId ?? null}
        draggingOrigin={drag?.origin ?? null}
        onPreviewEnter={onPreviewEnter}
        onPreviewLeave={onPreviewLeave}
        openHands={openHands}
      />
    );
  }

  return (
    <div className="table arena" data-testid="area-opponents">
      <header className="status-bar">
        <p className="eyebrow">BizzyMTG Commander</p>
        <p data-testid="turn-step">
          Turn {state.turn.number} · {activePlayer?.displayName ?? "—"} · {state.turn.phase} ·{" "}
          {state.turn.step}
        </p>
        <p data-testid="priority">
          Priority: {priority?.displayName ?? state.priorityPlayerId}
          {state.stack.length > 0 ? ` · Stack ${state.stack.length}` : ""}
        </p>
        {stopPrefs && onStopPrefs ? (
          <PhaseLadder state={state} prefs={stopPrefs} onChange={onStopPrefs} />
        ) : null}
        {over ? (
          <p className="game-over" data-testid="game-over">
            Game over. Winner: {winner?.displayName ?? state.winnerId ?? "none"}
          </p>
        ) : null}
        {error ? (
          <p className="action-error" data-testid="action-error">
            {error}
          </p>
        ) : null}
        {mode.type === "targets" ? (
          <p data-testid="targeting-hint">
            {targetingSpell
              ? `Choose a spell on the stack for ${definition(state, mode.cardId)?.name}.`
              : nextRequirement?.kind === "opponent"
                ? `Choose an opponent for ${definition(state, mode.cardId)?.name}${
                    mode.origin === "ability"
                      ? " ability"
                      : mode.origin === "trigger"
                        ? "'s trigger"
                        : ""
                  }.`
                : `Choose a target for ${definition(state, mode.cardId)?.name}${
                    mode.origin === "ability"
                      ? " ability"
                      : mode.origin === "trigger"
                        ? "'s trigger"
                        : ""
                  }.`}
          </p>
        ) : null}
        {overriding ? (
          <p data-testid="override-hint">
            Override — click one of {actorId === viewerId ? "your" : `${state.players.find((player) => player.id === actorId)?.displayName ?? "this player"}'s`}{" "}
            cards to tap, untap, or move it. This only affects that player.
          </p>
        ) : null}
        {mulliganOpen ? (
          <p data-testid="mulligan-hint">
            {bottoming
              ? `Put ${pendingBottom} card(s) on the bottom.`
              : deciding
                ? `London mulligan — ${countedMulligans(state, actorId)} counted. Keep or mulligan.`
                : `Waiting for ${decider?.displayName ?? "a player"} to keep or mulligan.`}
          </p>
        ) : null}
        {prompt && !targeting ? (
          <p data-testid="prompt-hint">
            {prompt.kind === "order_triggers"
              ? actorId === prompt.playerId
                ? "Order your simultaneous triggers."
                : `Waiting for ${chooser?.displayName ?? "a player"} to order triggers.`
              : prompt.kind === "may_pay_life_or_enter_tapped"
              ? actorId === prompt.playerId
                ? `Pay ${prompt.amount} life or have ${definition(state, prompt.sourceId)?.name ?? "this land"} enter tapped.`
                : `Waiting for ${chooser?.displayName ?? "a player"} to pay life or enter tapped.`
              : prompt.kind === "choose_creature_type"
              ? actorId === prompt.playerId
                ? `Choose a creature type for ${definition(state, prompt.sourceId)?.name ?? "this permanent"}.`
                : `Waiting for ${chooser?.displayName ?? "a player"} to choose a creature type.`
              : prompt.kind === "scry"
                ? actorId === prompt.playerId
                  ? `Scry ${prompt.count}.`
                  : `Waiting for ${chooser?.displayName ?? "a player"} to scry.`
                : prompt.kind === "surveil"
                  ? actorId === prompt.playerId
                    ? `Surveil ${prompt.count}.`
                    : `Waiting for ${chooser?.displayName ?? "a player"} to surveil.`
                : `Waiting for ${chooser?.displayName ?? "a player"} to choose targets.`}
          </p>
        ) : null}
      </header>

      {renderSeat("north", seats.north, true)}
      <div className="log-corner">
        <div className="corner-tools">
          {isHost ? (
            <button
              type="button"
              className={hostOpen ? "is-selected" : ""}
              data-testid="host-toggle"
              aria-expanded={hostOpen}
              onClick={() => {
                setHostOpen((open) => !open);
                setLogOpen(false);
                setPlayerOpen(false);
              }}
            >
              Host
            </button>
          ) : null}
          <button
            type="button"
            className={playerOpen ? "is-selected" : ""}
            data-testid="player-toggle"
            aria-expanded={playerOpen}
            onClick={() => {
              setPlayerOpen((open) => !open);
              setLogOpen(false);
              setHostOpen(false);
            }}
          >
            Player
          </button>
          <button
            type="button"
            className={logOpen ? "is-selected" : ""}
            data-testid="log-toggle"
            aria-expanded={logOpen}
            onClick={() => {
              setLogOpen((open) => !open);
              setHostOpen(false);
              setPlayerOpen(false);
            }}
          >
            Log
          </button>
        </div>
        {isHost ? (
          <section
            className={["host-overlay", hostOpen ? "is-open" : ""].filter(Boolean).join(" ")}
            data-testid="host-controls"
            hidden={!hostOpen}
          >
            <h3>Host controls</h3>
            <button type="button" data-testid="host-new-game" onClick={onNewGame}>
              New game
            </button>
            <button
              type="button"
              data-testid="host-next-action"
              disabled={over || mulliganOpen || openingRollOpen}
              onClick={() => send({ kind: "advance_step", playerId: viewerId })}
            >
              Pass to next action
            </button>
            <button
              type="button"
              data-testid="host-next-turn"
              disabled={over || mulliganOpen || openingRollOpen}
              onClick={() => send({ kind: "advance_turn", playerId: viewerId })}
            >
              Pass to next player's turn
            </button>
            <button type="button" data-testid="leave-table" onClick={onLeaveTable}>
              Table setup
            </button>
          </section>
        ) : null}
        <section
          className={["player-overlay", playerOpen ? "is-open" : ""].filter(Boolean).join(" ")}
          data-testid="player-controls"
          hidden={!playerOpen}
        >
          <h3>Player options</h3>
          <button
            type="button"
            data-testid="player-undo"
            onClick={() => onAction({ kind: "undo", playerId: actorId })}
          >
            Undo last action
          </button>
          <div className="player-option-row">
            <button
              type="button"
              data-testid="player-life-plus"
              disabled={over || mulliganOpen || openingRollOpen}
              onClick={() =>
                sendOverride({ type: "adjust_life", targetPlayerId: actorId, delta: 1 })
              }
            >
              Life +1
            </button>
            <button
              type="button"
              data-testid="player-life-minus"
              disabled={over || mulliganOpen || openingRollOpen}
              onClick={() =>
                sendOverride({ type: "adjust_life", targetPlayerId: actorId, delta: -1 })
              }
            >
              Life -1
            </button>
          </div>
          <button
            type="button"
            data-testid="player-draw"
            disabled={over || mulliganOpen || openingRollOpen}
            onClick={() => sendOverride({ type: "draw", targetPlayerId: actorId, count: 1 })}
          >
            Draw card
          </button>
          <button
            type="button"
            data-testid="player-discard"
            disabled={over || mulliganOpen || openingRollOpen}
            onClick={() => sendOverride({ type: "discard_hand" })}
          >
            Discard hand
          </button>
          <button
            type="button"
            data-testid="player-roll"
            onClick={() => {
              setDieSidesDraft("20");
              setDieSidesOpen((open) => !open);
            }}
          >
            Roll a die
          </button>
          {dieSidesOpen ? (
            <form
              className="die-sides-pop"
              data-testid="die-sides-pop"
              onSubmit={(event) => {
                event.preventDefault();
                submitDieRoll();
              }}
            >
              <label>
                Sides
                <input
                  data-testid="die-sides-input"
                  type="number"
                  min={2}
                  max={1000}
                  value={dieSidesDraft}
                  onChange={(event) => setDieSidesDraft(event.target.value)}
                />
              </label>
              <button type="submit" data-testid="die-sides-roll">
                Roll
              </button>
            </form>
          ) : null}
          {!over && !you.lost ? (
            <button
              type="button"
              data-testid="concede"
              onClick={() => send({ kind: "concede", playerId: actorId })}
            >
              Concede
            </button>
          ) : null}
          <button
            type="button"
            data-testid="override-toggle"
            className={overriding ? "is-selected" : ""}
            disabled={over || mulliganOpen || openingRollOpen}
            onClick={() =>
              onMode(overriding ? { type: "idle" } : { type: "override", selectedCardId: null })
            }
          >
            Override
          </button>
          {overriding ? (
            <div className="override-panel" data-testid="override-panel">
              <p className="muted">
                {actorId === viewerId ? "Your" : `${state.players.find((player) => player.id === actorId)?.displayName ?? "This player"}'s`}{" "}
                cards only. Click one to move or tap it.
              </p>
              <button
                type="button"
                data-testid="override-mill"
                onClick={() => sendOverride({ type: "mill", targetPlayerId: actorId, count: 1 })}
              >
                Mill 1
              </button>
              {MANA_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  data-testid={`override-mana-${color}`}
                  onClick={() =>
                    sendOverride({
                      type: "add_mana",
                      targetPlayerId: actorId,
                      color,
                    })
                  }
                >
                  +{color}
                </button>
              ))}
              {overrideCardId ? (
                <>
                  <button
                    type="button"
                    data-testid="override-tap"
                    onClick={() =>
                      sendOverride({ type: "set_tapped", cardId: overrideCardId, tapped: true })
                    }
                  >
                    Tap
                  </button>
                  <button
                    type="button"
                    data-testid="override-untap"
                    onClick={() =>
                      sendOverride({ type: "set_tapped", cardId: overrideCardId, tapped: false })
                    }
                  >
                    Untap
                  </button>
                  {overrideMoveZones.map((zone) => (
                    <button
                      key={zone}
                      type="button"
                      data-testid={`override-move-${zone}`}
                      onClick={() =>
                        sendOverride({
                          type: "move_card",
                          cardId: overrideCardId,
                          toZone: zone,
                        })
                      }
                    >
                      To {zone}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </section>
        <section
          className={["log-overlay", logOpen ? "is-open" : ""].filter(Boolean).join(" ")}
          data-testid="game-log"
          hidden={!logOpen}
        >
          <h3>Log</h3>
          {logLines.length === 0 ? (
            <p className="muted">No public events yet.</p>
          ) : (
            <ol>
              {logLines.map((entry, index) => (
                <li key={`${entry.kind}-${index}`}>{formatLogEntry(state, entry)}</li>
              ))}
            </ol>
          )}
        </section>
      </div>
      {renderSeat("west", seats.west, false)}
      {renderSeat("east", seats.east, false)}
        <section className="player-area you seat-south" data-testid="area-you">
          <div className="your-field">
            <PlayField
              state={state}
              cardIds={you.zones.battlefield}
              layout={layout}
              seat="south"
              testId="battlefield-you"
              ownerId={you.id}
              selected={isTempSelected}
              rejectedId={rejectedId}
              draggingId={drag?.origin === "field" ? drag.cardId : null}
              droppable
              stack={state.stack}
              targetingStack={targetingSpell}
              onStackClick={clickStack}
              onCardClick={!over ? clickPermanent : undefined}
              onCardPointerDown={
                !over && !mulliganOpen
                  ? (cardId, event) => beginDrag("field", cardId, event)
                  : undefined
              }
              onPreviewEnter={onPreviewEnter}
              onPreviewLeave={onPreviewLeave}
              onCardContextMenu={openTokenMenu}
            />
          </div>
          <div className="south-hud">
            <ZoneHud
              state={state}
              player={you}
              idPrefix="you"
              manaTestId="mana-you"
              selected={isTempSelected}
              onPile={overriding ? selectOverrideCard : undefined}
              onCommand={
                !over && (overriding || !mulliganOpen) ? clickHandCard : undefined
              }
              onPreviewEnter={onPreviewEnter}
              onPreviewLeave={onPreviewLeave}
              extra={
                <>
                  {targeting &&
                  nextRequirement &&
                  (nextRequirement.kind === "player" ||
                    nextRequirement.kind === "player_or_creature") ? (
                    <button
                      type="button"
                      data-testid="target-you"
                      onClick={() => addTarget({ type: "player", playerId: you.id })}
                    >
                      Target {you.displayName}
                    </button>
                  ) : null}
                  {(() => {
                    // Oracle of Mul Daya-class grants: show the viewer their
                    // library's top card, playable like a hand card.
                    const grant = topOfLibraryGrant(state, you.id);
                    const topId = grant?.look ? you.zones.library[0] : undefined;
                    if (!topId) {
                      return null;
                    }
                    return (
                      <span className="top-of-library" data-testid="top-of-library">
                        <CardTile
                          state={state}
                          cardId={topId}
                          size="hand"
                          previewable
                          onClick={
                            !over && !mulliganOpen ? () => clickHandCard(topId) : undefined
                          }
                          onPreviewEnter={onPreviewEnter}
                          onPreviewLeave={onPreviewLeave}
                        />
                      </span>
                    );
                  })()}
                </>
              }
            />
            <HandZone
              state={state}
              player={you}
              testId="hand-you"
              activeTurn={you.id === activeTurnId}
              selectedIds={you.zones.hand.filter(isTempSelected)}
              previewable
              rejectedId={rejectedId}
              draggingId={drag?.origin === "hand" ? drag.cardId : null}
              onCard={
                over
                  ? undefined
                  : bottoming
                    ? toggleBottom
                    : overriding || !mulliganOpen
                      ? clickHandCard
                      : undefined
              }
              onDoubleClick={
                over || mulliganOpen || bottoming || overriding ? undefined : playFromHand
              }
              onPointerDown={
                over || mulliganOpen || bottoming
                  ? undefined
                  : (cardId, event) => beginDrag("hand", cardId, event)
              }
              onPreviewEnter={onPreviewEnter}
              onPreviewLeave={onPreviewLeave}
              onContextMenu={openTokenMenu}
            />
          </div>
          <p className="visually-hidden" data-testid="counts-you">
            Library {you.zones.library.length} · Graveyard {you.zones.graveyard.length} · Command{" "}
            {you.zones.command.length}
          </p>
        </section>

      <footer className="actions">
        {over ? (
          <button type="button" data-testid="new-game" onClick={onNewGame}>
            New game
          </button>
        ) : openingRollOpen ? (
          <>
            {needsOpeningRoll ? (
              <button
                type="button"
                className="pass-button"
                data-testid="roll-first"
                onClick={() => onAction({ kind: "opening_roll", playerId: actorId })}
              >
                Roll d20{forActor}
              </button>
            ) : (
              <button type="button" className="pass-button" data-testid="roll-first-wait" disabled>
                Waiting for other players
              </button>
            )}
            <p className="muted" data-testid="opening-rolls">
              {state.players
                .filter((player) => !player.lost)
                .map((player) => {
                  const result = state.openingRoll?.rolls[player.id];
                  return `${player.displayName}: ${result ?? "—"}`;
                })
                .join(" · ")}
            </p>
          </>
        ) : mulliganOpen ? (
          <>
            {deciding && pendingBottom === 0 ? (
              <>
                <button
                  type="button"
                  data-testid="keep-hand"
                  onClick={() => send({ kind: "keep_hand", playerId: actorId })}
                >
                  Keep hand{forActor}
                </button>
                <button
                  type="button"
                  data-testid="take-mulligan"
                  onClick={() => send({ kind: "mulligan", playerId: actorId })}
                >
                  Take mulligan{forActor}
                </button>
              </>
            ) : null}
            {bottoming ? (
              <button
                type="button"
                data-testid="confirm-bottom"
                disabled={selectedBottom.length !== pendingBottom}
                onClick={() =>
                  send({ kind: "bottom_cards", playerId: actorId, cardIds: selectedBottom })
                }
              >
                Put {pendingBottom} on bottom
              </button>
            ) : null}
            {!deciding ? (
              <button type="button" className="pass-button" data-testid="mulligan-wait" disabled>
                Waiting for {decider?.displayName ?? "other players"}
              </button>
            ) : null}
          </>
        ) : prompt ? (
          <>
            {actorId === prompt.playerId && prompt.kind === "order_triggers" ? (
              <>
                <p data-testid="order-triggers-hint">
                  Choose which trigger resolves first.
                </p>
                {prompt.entries.map((entry, index) => (
                  <button
                    key={`${entry.cardId}-${entry.triggerIndex}`}
                    type="button"
                    data-testid={`order-trigger-first-${index}`}
                    onClick={() => {
                      const rest = prompt.entries
                        .map((_, entryIndex) => entryIndex)
                        .filter((entryIndex) => entryIndex !== index);
                      // Last on the stack resolves first.
                      send({
                        kind: "resolve_order_triggers",
                        playerId: actorId,
                        order: [...rest, index],
                      });
                    }}
                  >
                    Resolve {definition(state, entry.cardId)?.name ?? "trigger"} first
                  </button>
                ))}
                <button
                  type="button"
                  className="pass-button"
                  data-testid="order-triggers-default"
                  onClick={() =>
                    send({
                      kind: "resolve_order_triggers",
                      playerId: actorId,
                      order: prompt.entries.map((_, index) => index),
                    })
                  }
                >
                  Printed order
                </button>
              </>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "may_pay_life_or_enter_tapped" ? (
              <>
                <button
                  type="button"
                  className="pass-button"
                  data-testid="pay-enter-life"
                  onClick={() =>
                    send({ kind: "choose_enter_replacement", playerId: actorId, pay: true })
                  }
                >
                  Pay {prompt.amount} life{forActor}
                </button>
                <button
                  type="button"
                  data-testid="enter-tapped"
                  onClick={() =>
                    send({ kind: "choose_enter_replacement", playerId: actorId, pay: false })
                  }
                >
                  Enter tapped{forActor}
                </button>
              </>
            ) : null}
            {actorId === prompt.playerId &&
            (prompt.kind === "pay_or_counter" || prompt.kind === "pay_or_effect") ? (
              <>
                <button
                  type="button"
                  className="pass-button"
                  data-testid="pay-cost"
                  disabled={autoTapPlan(state, actorId, prompt.cost) === null}
                  onClick={() => {
                    const plan = autoTapPlan(state, actorId, prompt.cost) ?? [];
                    send({ kind: "resolve_pay", playerId: actorId, pay: true, taps: plan });
                  }}
                >
                  Pay {prompt.cost}
                </button>
                <button
                  type="button"
                  data-testid="decline-cost"
                  onClick={() => send({ kind: "resolve_pay", playerId: actorId, pay: false })}
                >
                  {prompt.kind === "pay_or_counter" ? "Decline (countered)" : "Decline"}
                </button>
              </>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "choose_creature_type" ? (
              <div className="look-row" data-testid="creature-type-picker">
                {["Sliver", "Elf", "Goblin", "Zombie", "Dragon", "Human", "Merfolk", "Vampire"].map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        send({
                          kind: "resolve_creature_type",
                          playerId: actorId,
                          creatureType: option.toLowerCase(),
                        })
                      }
                    >
                      {option}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  data-testid="creature-type-other"
                  onClick={() => {
                    const answer = window.prompt("Creature type:");
                    if (answer && answer.trim()) {
                      send({
                        kind: "resolve_creature_type",
                        playerId: actorId,
                        creatureType: answer.trim().toLowerCase(),
                      });
                    }
                  }}
                >
                  Other…
                </button>
              </div>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "scry" ? (
              <>
                <div className="look-row" data-testid="scry-cards">
                  {lookedAtCardIds(state, prompt).map((cardId) => (
                    <CardTile
                      key={cardId}
                      state={state}
                      cardId={cardId}
                      size="hand"
                      previewable
                      onPreviewEnter={onPreviewEnter}
                      onPreviewLeave={onPreviewLeave}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="pass-button"
                  data-testid="scry-keep"
                  onClick={() => send({ kind: "resolve_scry", playerId: actorId, bottomIds: [] })}
                >
                  Keep on top
                </button>
                <button
                  type="button"
                  data-testid="scry-bottom"
                  onClick={() => {
                    send({
                      kind: "resolve_scry",
                      playerId: actorId,
                      bottomIds: lookedAtCardIds(state, prompt),
                    });
                  }}
                >
                  Put on bottom
                </button>
              </>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "surveil" ? (
              <>
                <div className="look-row" data-testid="surveil-cards">
                  {lookedAtCardIds(state, prompt).map((cardId) => (
                    <CardTile
                      key={cardId}
                      state={state}
                      cardId={cardId}
                      size="hand"
                      previewable
                      onPreviewEnter={onPreviewEnter}
                      onPreviewLeave={onPreviewLeave}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="pass-button"
                  data-testid="surveil-keep"
                  onClick={() =>
                    send({ kind: "resolve_surveil", playerId: actorId, graveyardIds: [] })
                  }
                >
                  Keep on top
                </button>
                <button
                  type="button"
                  data-testid="surveil-graveyard"
                  onClick={() => {
                    send({
                      kind: "resolve_surveil",
                      playerId: actorId,
                      graveyardIds: lookedAtCardIds(state, prompt),
                    });
                  }}
                >
                  Put in graveyard
                </button>
              </>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "choose_targets" ? (
              <button type="button" className="pass-button" data-testid="choose-target" disabled>
                Choose a target{forActor}
              </button>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "choose_discard" ? (
              <button type="button" className="pass-button" data-testid="choose-discard" disabled>
                Discard {prompt.count} card{prompt.count === 1 ? "" : "s"} — click your hand
              </button>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "choose_card" ? (
              <>
                <div className="look-row" data-testid="choose-card-row">
                  {legalIdsForChooseSources(state, prompt.sources).map((cardId) => (
                    <CardTile
                      key={cardId}
                      state={state}
                      cardId={cardId}
                      size="hand"
                      previewable
                      onClick={() =>
                        send({ kind: "resolve_choose_card", playerId: actorId, cardId })
                      }
                      onPreviewEnter={onPreviewEnter}
                      onPreviewLeave={onPreviewLeave}
                    />
                  ))}
                </div>
                <button type="button" className="pass-button" data-testid="choose-card" disabled>
                  Choose a card
                </button>
              </>
            ) : null}
            {actorId === prompt.playerId && prompt.kind === "look_and_assign" ? (
              <>
                <div className="look-row" data-testid="look-assign-cards">
                  {lookedAtCardIds(state, prompt).map((cardId) => (
                    <div key={cardId} className="look-assign">
                      <CardTile
                        state={state}
                        cardId={cardId}
                        size="hand"
                        previewable
                        selected={Boolean(lookAssign[cardId])}
                        onPreviewEnter={onPreviewEnter}
                        onPreviewLeave={onPreviewLeave}
                      />
                      <div className="look-assign-dests">
                        {prompt.destinations.map((destination) => (
                          <button
                            key={destination}
                            type="button"
                            className={lookAssign[cardId] === destination ? "is-selected" : ""}
                            data-testid={`look-assign-${destination}-${cardId}`}
                            onClick={() => {
                              setLookAssign((current) => {
                                const next = { ...current };
                                // Destinations are a multiset (Impulse has several
                                // bottom slots): only steal when at capacity.
                                const capacity = prompt.destinations.filter(
                                  (entry) => entry === destination,
                                ).length;
                                const holders = Object.entries(next).filter(
                                  ([id, used]) => used === destination && id !== cardId,
                                );
                                if (holders.length >= capacity) {
                                  delete next[holders[0]![0]];
                                }
                                next[cardId] = destination;
                                return next;
                              });
                            }}
                          >
                            {lookDestLabel(destination)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="pass-button"
                  data-testid="look-assign-confirm"
                  disabled={(() => {
                    const looked = lookedAtCardIds(state, prompt);
                    if (looked.some((cardId) => !lookAssign[cardId])) {
                      return true;
                    }
                    const capacity = new Map<string, number>();
                    for (const destination of prompt.destinations) {
                      capacity.set(destination, (capacity.get(destination) ?? 0) + 1);
                    }
                    for (const cardId of looked) {
                      const destination = lookAssign[cardId]!;
                      const remaining = capacity.get(destination) ?? 0;
                      if (remaining <= 0) {
                        return true;
                      }
                      capacity.set(destination, remaining - 1);
                    }
                    return false;
                  })()}
                  onClick={() =>
                    send({
                      kind: "resolve_look_assign",
                      playerId: actorId,
                      assignments: lookedAtCardIds(state, prompt).map((cardId) => ({
                        cardId,
                        destination: lookAssign[cardId]!,
                      })),
                    })
                  }
                >
                  Confirm
                </button>
              </>
            ) : null}
            {actorId !== prompt.playerId ? (
              <button type="button" className="pass-button" data-testid="choose-target-wait" disabled>
                Waiting for {chooser?.displayName ?? "a player"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {canAdvance ? (
              <button
                type="button"
                className="pass-button"
                data-testid="pass"
                onClick={sendAdvance}
              >
                {advanceButtonLabel(state, actorId)}
                {forActor}
              </button>
            ) : (
              <button type="button" className="pass-button" data-testid="pass-wait" disabled>
                Waiting for {priority?.displayName ?? "other players"}
              </button>
            )}
          </>
        )}
      </footer>
      <section
        className={["chat-dock", chatExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")}
        data-testid="table-chat"
      >
        <div className="chat-panel">
          <div className="chat-head">
            <h3>Chat</h3>
            <button
              type="button"
              data-testid="chat-expand"
              aria-expanded={chatExpanded}
              onClick={() => setChatExpanded((open) => !open)}
            >
              {chatExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <ol className="chat-lines">
            {tableChat.length === 0 ? (
              <li className="muted">No messages yet.</li>
            ) : (
              tableChat.map((line, index) => (
                <li key={`${line.name}-${index}`}>
                  <strong>{line.name}:</strong> {line.text}
                </li>
              ))
            )}
          </ol>
          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              sendChat();
            }}
          >
            <input
              data-testid="chat-input"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder="Message the table"
              aria-label="Table chat"
            />
            <button type="submit" data-testid="chat-send">
              Send
            </button>
          </form>
        </div>
      </section>
      {mode.type === "token-create" ? (
        <TokenCreatePop
          cardId={mode.cardId}
          templates={(() => {
            const def = definition(state, mode.cardId);
            return def ? tokenTemplatesOf(def) : [];
          })()}
          onPick={(template) => {
            onMode({ type: "idle" });
            sendOverride({ type: "create_token", template });
          }}
        />
      ) : null}
      {mode.type === "hand-choice" ? (
        <HandChoicePop
          cardId={mode.cardId}
          options={(() => {
            const def = definition(state, mode.cardId);
            const options: { id: string; label: string }[] = [];
            if (def?.layout === "modal_dfc" && def.otherFaceId) {
              options.push({ id: "face-0", label: `Play ${def.name}` });
              const other = state.definitions[def.otherFaceId];
              if (other) {
                options.push({ id: "face-1", label: `Play ${other.name}` });
              }
            } else if (isLand(state, mode.cardId)) {
              options.push({ id: "face-0", label: "Play land" });
            }
            for (const channel of channelAbilities(def)) {
              options.push({
                id: `channel-${channel.index}`,
                label: activatedAbilityLabel(channel.ability),
              });
            }
            return options;
          })()}
          onPick={(optionId) => pickHandChoice(mode.cardId, optionId)}
        />
      ) : null}
      {mode.type === "spell-mode-pick" ? (
        <HandChoicePop
          cardId={mode.cardId}
          options={(() => {
            const def = definition(state, mode.cardId);
            const chosen = mode.chosen ?? [];
            const options = (def?.modes ?? []).map((spellMode, index) => ({
              id: `mode-${index}`,
              label: `${chosen.includes(index) ? "✓ " : ""}${spellMode.label}`,
            }));
            if (
              def?.modeChoice &&
              chosen.length >= def.modeChoice.min &&
              chosen.length <= def.modeChoice.max
            ) {
              options.push({ id: "confirm", label: `Cast with ${chosen.length} mode(s)` });
            }
            return options;
          })()}
          onPick={(optionId) => {
            if (optionId === "confirm") {
              if (mode.type === "spell-mode-pick") {
                confirmSpellModes(mode.cardId, mode.chosen ?? []);
              }
              return;
            }
            const modeIndex = Number(optionId.replace("mode-", ""));
            pickSpellMode(mode.cardId, modeIndex);
          }}
        />
      ) : null}
      {mode.type === "ability-pick" ? (
        <AbilityChoicePop
          cardId={mode.cardId}
          mana={(() => {
            const picked = definition(state, mode.cardId);
            return picked ? manaAbilitiesOf(picked) : [];
          })()}
          activated={usableActivated(state, mode.cardId)}
          onMana={(manaIndex) => {
            const playerId = controllerOf(mode.cardId) ?? actorId;
            beginManaTap(mode.cardId, playerId, manaIndex);
          }}
          onActivated={(abilityIndex) => {
            const playerId = controllerOf(mode.cardId) ?? actorId;
            beginActivate(mode.cardId, playerId, abilityIndex);
          }}
        />
      ) : null}
      {mode.type === "targets" &&
      (nextRequirement?.kind === "own_graveyard_card" ||
        nextRequirement?.kind === "own_graveyard_creature_card") ? (
        <div
          className="mana-choice-pop"
          data-testid="graveyard-target-pop"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 140,
            transform: "translateX(-50%)",
            zIndex: 40,
          }}
        >
          <p>Choose a card from your graveyard.</p>
          <div className="look-row">
            {legalChoicesForRequirement(state, nextRequirement, actorId).map((choice) =>
              choice.type === "creature" ? (
                <CardTile
                  key={choice.cardId}
                  state={state}
                  cardId={choice.cardId}
                  size="hand"
                  previewable
                  onClick={() => addTarget({ type: "creature", cardId: choice.cardId })}
                  onPreviewEnter={onPreviewEnter}
                  onPreviewLeave={onPreviewLeave}
                />
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      {mode.type === "mana-color" ? (
        <ManaChoicePop
          cardId={mode.cardId}
          colors={mode.colors}
          onPick={(color) =>
            send({
              kind: "tap_for_mana",
              playerId: controllerOf(mode.cardId) ?? actorId,
              cardId: mode.cardId,
              color,
              manaIndex: mode.manaIndex,
            })
          }
        />
      ) : null}
      {preview && !drag?.moved
        ? createPortal(
            <CardPreview state={state} cardId={preview.cardId} anchor={preview.rect} />,
            document.body,
          )
        : null}
      {drag?.moved
        ? createPortal(
            <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
              <CardTile state={state} cardId={drag.cardId} size="field" dragging />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
