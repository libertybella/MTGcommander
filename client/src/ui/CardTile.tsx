import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { HIDDEN_DEFINITION_ID, type CardInstanceId, type GameState } from "@mtgcommander/engine";
import { cardArtUrl } from "./cardArt";

function definition(state: GameState, cardId: CardInstanceId) {
  const card = state.cards[cardId];
  return card ? state.definitions[card.definitionId] : undefined;
}

export function CardTile(props: {
  state: GameState;
  cardId: CardInstanceId;
  testId?: string;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPreviewEnter?: (cardId: CardInstanceId, el: HTMLElement) => void;
  onPreviewLeave?: (cardId: CardInstanceId) => void;
  onContextMenu?: (cardId: CardInstanceId, el: HTMLElement) => void;
  size?: "hand" | "field" | "back";
  rejected?: boolean;
  dragging?: boolean;
  previewable?: boolean;
  artOnly?: boolean;
}) {
  const card = props.state.cards[props.cardId];
  const def = definition(props.state, props.cardId);
  const [artFailed, setArtFailed] = useState(false);
  if (!card || !def) {
    return null;
  }
  const hidden = def.id === HIDDEN_DEFINITION_ID;
  const art = hidden || artFailed ? null : cardArtUrl(def);
  const pt =
    def.power !== null && def.toughness !== null ? `${def.power}/${def.toughness}` : null;
  const interactive = Boolean(props.onClick || props.onPointerDown || props.previewable || props.onContextMenu);
  const classes = [
    "card-tile",
    props.size ? `size-${props.size}` : "",
    card.tapped && !props.artOnly ? "is-tapped" : "",
    card.attacking ? "is-attacking" : "",
    hidden ? "is-hidden" : "",
    art ? "has-art" : "",
    props.selected ? "is-selected" : "",
    props.onClick || props.onPointerDown ? "is-clickable" : "",
    props.rejected ? "is-rejected" : "",
    props.dragging ? "is-dragging" : "",
    props.previewable ? "is-previewable" : "",
    props.artOnly ? "is-art-only" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-testid={props.testId ?? `card-${card.id}`}
      data-card-name={def.name}
      data-tapped={card.tapped ? "true" : "false"}
      title={def.name}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onPointerDown={props.onPointerDown}
      onMouseEnter={(event) => {
        if (props.previewable && !hidden) {
          props.onPreviewEnter?.(props.cardId, event.currentTarget);
        }
      }}
      onMouseLeave={() => {
        if (props.previewable) {
          props.onPreviewLeave?.(props.cardId);
        }
      }}
      onContextMenu={(event) => {
        if (!props.onContextMenu || hidden) {
          return;
        }
        event.preventDefault();
        props.onContextMenu(props.cardId, event.currentTarget);
      }}
      disabled={!interactive}
    >
      {art ? (
        <img
          className="card-art"
          src={art}
          alt=""
          draggable={false}
          onError={() => setArtFailed(true)}
        />
      ) : null}
      {props.artOnly ? null : (
        <>
          <span className="card-name">{def.name}</span>
          {hidden ? null : <span className="card-type">{def.typeLine}</span>}
          {pt && !hidden ? <span className="card-pt">{pt}</span> : null}
          {card.classLevel > 0 && !hidden ? (
            <span className="card-class-level" data-testid={`class-level-${card.id}`}>
              Lv {card.classLevel}
            </span>
          ) : null}
          {card.tapped ? <span className="card-flag">Tapped</span> : null}
        </>
      )}
    </button>
  );
}
