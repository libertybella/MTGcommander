import {
  isCreature,
  isLand,
  isPlaneswalker,
  type CardInstanceId,
  type GameState,
} from "@mtgcommander/engine";

export type FieldLane = "creature" | "artifact" | "planeswalker" | "land";

export type FieldPos = { x: number; y: number };

const CARD = { w: 0.078, h: 0.2 };
const GAP = 0.012;
const COMMANDER_RIGHT = 0.3;

export const FIELD_GUIDES: Record<FieldLane, { left: number; top: number; width: number; height: number }> = {
  creature: { left: 0.03, top: 0.04, width: 0.74, height: 0.42 },
  artifact: {
    left: 0.42 + 4 * CARD.w,
    top: 0.48 - CARD.h / 2,
    width: 0.24,
    height: 0.22,
  },
  planeswalker: { left: 0.8, top: 0.04, width: 0.17, height: 0.66 },
  land: {
    left: COMMANDER_RIGHT + CARD.w,
    top: 0.72,
    width: 1 - (COMMANDER_RIGHT + CARD.w) - 0.03,
    height: 0.24,
  },
};

export function fieldLane(state: GameState, cardId: CardInstanceId): FieldLane {
  if (isCreature(state, cardId)) {
    return "creature";
  }
  if (isPlaneswalker(state, cardId)) {
    return "planeswalker";
  }
  if (isLand(state, cardId)) {
    return "land";
  }
  return "artifact";
}

export function snapSlot(lane: FieldLane, index: number): FieldPos {
  const zone = FIELD_GUIDES[lane];
  const colW = CARD.w + GAP;
  const rowH = CARD.h + GAP;
  const cols = Math.max(1, Math.floor((zone.width - GAP) / colW));
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: zone.left + GAP + col * colW,
    y: zone.top + GAP + row * rowH,
  };
}

export function clampFieldPos(pos: FieldPos): FieldPos {
  return {
    x: Math.min(1 - CARD.w, Math.max(0, pos.x)),
    y: Math.min(1 - CARD.h, Math.max(0, pos.y)),
  };
}

export type Transform2D = { a: number; b: number; c: number; d: number };

/** Map a screen point into a play field's local 0–1 space, including CSS rotate/scale. */
export function localFieldPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  offsetWidth: number,
  offsetHeight: number,
  matrix: Transform2D | null,
): { x: number; y: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let lx = clientX - cx;
  let ly = clientY - cy;
  if (matrix) {
    const scaleX = Math.hypot(matrix.a, matrix.b) || 1;
    const scaleY = Math.hypot(matrix.c, matrix.d) || 1;
    const angle = Math.atan2(matrix.b, matrix.a);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    lx = rx / scaleX;
    ly = ry / scaleY;
  }
  const width = offsetWidth || rect.width;
  const height = offsetHeight || rect.height;
  return {
    x: width === 0 ? 0 : lx / width + 0.5,
    y: height === 0 ? 0 : ly / height + 0.5,
  };
}

function readTransform2D(el: HTMLElement): Transform2D | null {
  const value = getComputedStyle(el).transform;
  if (!value || value === "none") {
    return null;
  }
  try {
    const matrix = new DOMMatrix(value);
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
  } catch {
    return null;
  }
}

export function pointerToFieldPos(field: HTMLElement, clientX: number, clientY: number): FieldPos {
  const local = localFieldPoint(
    clientX,
    clientY,
    field.getBoundingClientRect(),
    field.offsetWidth,
    field.offsetHeight,
    readTransform2D(field),
  );
  return clampFieldPos({
    x: local.x - CARD.w / 2,
    y: local.y - CARD.h / 2,
  });
}

export function pointInField(field: HTMLElement, clientX: number, clientY: number): boolean {
  const local = localFieldPoint(
    clientX,
    clientY,
    field.getBoundingClientRect(),
    field.offsetWidth,
    field.offsetHeight,
    readTransform2D(field),
  );
  return local.x >= 0 && local.x <= 1 && local.y >= 0 && local.y <= 1;
}

export function clampPreviewBox(
  anchor: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  box: { width: number; height: number },
  pad = 12,
): { left: number; top: number } {
  const maxLeft = Math.max(pad, viewport.width - pad - box.width);
  const maxTop = Math.max(pad, viewport.height - pad - box.height);
  const gap = 8;
  const above = anchor.top - box.height - gap;
  const below = anchor.top + anchor.height + gap;
  const fitsAbove = above >= pad;
  const fitsBelow = below + box.height <= viewport.height - pad;
  let left = anchor.left + anchor.width / 2 - box.width / 2;
  let top = fitsAbove ? above : below;
  if (!fitsAbove && !fitsBelow) {
    const right = anchor.left + anchor.width + gap;
    const leftSide = anchor.left - box.width - gap;
    if (right + box.width <= viewport.width - pad) {
      left = right;
    } else if (leftSide >= pad) {
      left = leftSide;
    }
    top = anchor.top;
  }
  return {
    left: Math.min(Math.max(pad, left), maxLeft),
    top: Math.min(Math.max(pad, top), maxTop),
  };
}
