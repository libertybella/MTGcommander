import { describe, expect, it } from "vitest";
import { assignOpponentSeats, opponentsAfterViewer } from "./seats";

describe("table seats", () => {
  it("puts a single opponent at North", () => {
    expect(assignOpponentSeats(["a"])).toEqual({ north: "a", east: null, west: null });
  });

  it("puts two opponents at West then North (clockwise)", () => {
    expect(assignOpponentSeats(["a", "b"])).toEqual({ north: "b", east: null, west: "a" });
  });

  it("puts three opponents West, North, and East clockwise", () => {
    expect(assignOpponentSeats(["a", "b", "c"])).toEqual({ north: "b", east: "c", west: "a" });
  });

  it("walks opponents in wrap order after the viewer", () => {
    const players = [{ id: "s" }, { id: "e" }, { id: "n" }, { id: "w" }];
    expect(opponentsAfterViewer(players, "s").map((player) => player.id)).toEqual(["e", "n", "w"]);
  });
});
