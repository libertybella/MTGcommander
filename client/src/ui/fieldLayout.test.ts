import { describe, expect, it } from "vitest";
import { FIELD_GUIDES, clampFieldPos, clampPreviewBox, localFieldPoint, snapSlot } from "./fieldLayout";

describe("field layout", () => {
  it("places the first creature inside the orange guide", () => {
    const pos = snapSlot("creature", 0);
    const zone = FIELD_GUIDES.creature;
    expect(pos.x).toBeGreaterThanOrEqual(zone.left);
    expect(pos.x).toBeLessThan(zone.left + zone.width);
    expect(pos.y).toBeGreaterThanOrEqual(zone.top);
    expect(pos.y).toBeLessThan(zone.top + zone.height);
  });

  it("advances land snaps across the blue guide", () => {
    const first = snapSlot("land", 0);
    const second = snapSlot("land", 1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
  });

  it("clamps free drops onto the play field", () => {
    expect(clampFieldPos({ x: -0.4, y: 1.4 })).toEqual({ x: 0, y: expect.any(Number) });
    const clamped = clampFieldPos({ x: -0.4, y: 1.4 });
    expect(clamped.y).toBeLessThan(1);
  });

  it("places the first land to the right of the commander cluster", () => {
    const pos = snapSlot("land", 0);
    expect(pos.x).toBeGreaterThan(0.3);
  });

  it("shifts artifact snaps right and up from the old center band", () => {
    const pos = snapSlot("artifact", 0);
    expect(pos.x).toBeGreaterThan(0.7);
    expect(pos.y).toBeLessThan(0.45);
  });

  it("maps an unrotated pointer onto the field the same as a bounding box", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    const local = localFieldPoint(200, 100, rect, 200, 100, null);
    expect(local.x).toBeCloseTo(0.5);
    expect(local.y).toBeCloseTo(0.5);
  });

  it("inverts a 180-degree field so the visual top maps to local bottom", () => {
    const rect = { left: 0, top: 0, width: 200, height: 100 };
    const local = localFieldPoint(100, 10, rect, 200, 100, { a: -1, b: 0, c: 0, d: -1 });
    expect(local.x).toBeCloseTo(0.5);
    expect(local.y).toBeGreaterThan(0.5);
  });

  it("keeps a preview box inside the viewport", () => {
    const placed = clampPreviewBox(
      { left: 700, top: 20, width: 40, height: 56 },
      { width: 800, height: 600 },
      { width: 220, height: 320 },
    );
    expect(placed.left).toBeGreaterThanOrEqual(12);
    expect(placed.left + 220).toBeLessThanOrEqual(800 - 12);
    expect(placed.top).toBeGreaterThanOrEqual(12);
    expect(placed.top + 320).toBeLessThanOrEqual(600 - 12);
  });

  it("keeps a two-face preview on screen at the right and top edges", () => {
    const wide = clampPreviewBox(
      { left: 720, top: 480, width: 48, height: 68 },
      { width: 800, height: 600 },
      { width: 460, height: 360 },
    );
    expect(wide.left).toBeGreaterThanOrEqual(12);
    expect(wide.left + 460).toBeLessThanOrEqual(800 - 12);
    expect(wide.top).toBeGreaterThanOrEqual(12);
    expect(wide.top + 360).toBeLessThanOrEqual(600 - 12);

    const tall = clampPreviewBox(
      { left: 640, top: 8, width: 52, height: 72 },
      { width: 800, height: 600 },
      { width: 220, height: 420 },
    );
    expect(tall.left).toBeGreaterThanOrEqual(12);
    expect(tall.left + 220).toBeLessThanOrEqual(800 - 12);
    expect(tall.top).toBeGreaterThanOrEqual(12);
    expect(tall.top + 420).toBeLessThanOrEqual(600 - 12);
  });
});
