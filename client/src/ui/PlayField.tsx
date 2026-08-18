import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  type CardInstanceId,
  type GameState,
  type StackObject,
  type StackObjectId,
} from "@mtgcommander/engine";
import { CardTile } from "./CardTile";
import { FIELD_GUIDES, type FieldLane, type FieldPos } from "./fieldLayout";

const LANES: FieldLane[] = ["creature", "artifact", "planeswalker", "land"];

function FitRotate(props: { rotate: "east" | "west"; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = box?.querySelector(".play-field") as HTMLElement | null;
    if (!box || !inner) {
      return;
    }
    function fit() {
      if (!box || !inner) {
        return;
      }
      const angle = props.rotate === "east" ? -90 : 90;
      inner.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      const naturalW = inner.offsetWidth;
      const naturalH = inner.offsetHeight;
      if (!naturalW || !naturalH) {
        return;
      }
      const scale = Math.min(box.clientWidth / naturalH, box.clientHeight / naturalW, 1);
      inner.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;
    }
    fit();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [props.rotate]);
  return (
    <div ref={boxRef} className={`play-field-shell is-${props.rotate}`}>
      {props.children}
    </div>
  );
}

function StackDock(props: {
  state: GameState;
  stack: StackObject[];
  targeting?: boolean;
  onStackClick?: (id: StackObjectId) => void;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
}) {
  if (props.stack.length === 0) {
    return null;
  }
  return (
    <div className="stack-dock" data-testid="stack">
      {props.stack.map((entry) => {
        const sourceName = entry.sourceId
          ? props.state.definitions[props.state.cards[entry.sourceId]?.definitionId ?? ""]?.name ??
            entry.sourceId
          : entry.kind;
        return (
          <div className="stack-item" key={entry.id}>
            {entry.sourceId ? (
              <CardTile
                state={props.state}
                cardId={entry.sourceId}
                size="field"
                testId={`stack-card-${entry.id}`}
                previewable
                onClick={props.targeting ? () => props.onStackClick?.(entry.id) : undefined}
                onPreviewEnter={props.onPreviewEnter}
                onPreviewLeave={props.onPreviewLeave}
              />
            ) : (
              <div className="pile-outline" />
            )}
            {props.targeting ? (
              <button type="button" data-testid={`stack-target-${entry.id}`} onClick={() => props.onStackClick?.(entry.id)}>
                {entry.kind}: {sourceName}
              </button>
            ) : (
              <p className="stack-copy">
                {entry.kind}: {sourceName}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PlayField(props: {
  state: GameState;
  cardIds: CardInstanceId[];
  layout: Record<string, FieldPos>;
  seat: "south" | "north" | "east" | "west";
  testId: string;
  ownerId?: string;
  selected: (cardId: CardInstanceId) => boolean;
  rejectedId: CardInstanceId | null;
  draggingId: CardInstanceId | null;
  onCardClick?: (cardId: CardInstanceId) => void;
  onCardPointerDown?: (cardId: CardInstanceId, event: React.PointerEvent<HTMLButtonElement>) => void;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
  onCardContextMenu?: (cardId: CardInstanceId, el: HTMLElement) => void;
  droppable?: boolean;
  stack?: StackObject[];
  targetingStack?: boolean;
  onStackClick?: (id: StackObjectId) => void;
}) {
  const field = (
    <div
      className={["play-field", `is-${props.seat}`, props.droppable ? "is-droppable" : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid={props.testId}
      data-field-owner={props.ownerId}
    >
      <div className="field-guides" aria-hidden="true">
        {LANES.map((lane) => (
          <div
            key={lane}
            className={`field-guide is-${lane}`}
            data-lane={lane}
            style={{
              left: `${FIELD_GUIDES[lane].left * 100}%`,
              top: `${FIELD_GUIDES[lane].top * 100}%`,
              width: `${FIELD_GUIDES[lane].width * 100}%`,
              height: `${FIELD_GUIDES[lane].height * 100}%`,
            }}
          />
        ))}
      </div>
      {props.cardIds.map((cardId) => {
        const pos = props.layout[cardId] ?? { x: 0.04, y: 0.04 };
        return (
          <div
            key={cardId}
            className="field-card"
            style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
          >
            <CardTile
              state={props.state}
              cardId={cardId}
              size="field"
              selected={props.selected(cardId)}
              rejected={props.rejectedId === cardId}
              dragging={props.draggingId === cardId}
              previewable
              onClick={props.onCardClick ? () => props.onCardClick?.(cardId) : undefined}
              onPointerDown={
                props.onCardPointerDown
                  ? (event) => props.onCardPointerDown?.(cardId, event)
                  : undefined
              }
              onPreviewEnter={props.onPreviewEnter}
              onPreviewLeave={props.onPreviewLeave}
              onContextMenu={props.onCardContextMenu}
            />
          </div>
        );
      })}
      {props.stack ? (
        <StackDock
          state={props.state}
          stack={props.stack}
          targeting={props.targetingStack}
          onStackClick={props.onStackClick}
          onPreviewEnter={props.onPreviewEnter}
          onPreviewLeave={props.onPreviewLeave}
        />
      ) : null}
    </div>
  );
  if (props.seat === "east" || props.seat === "west") {
    return <FitRotate rotate={props.seat}>{field}</FitRotate>;
  }
  return field;
}
