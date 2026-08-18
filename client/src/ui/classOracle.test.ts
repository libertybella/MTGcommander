import { describe, expect, it } from "vitest";
import { classOracleSections } from "./classOracle";

describe("classOracleSections", () => {
  it("splits printed Class levels so the current one can be highlighted", () => {
    const sections = classOracleSections(
      "You have no maximum hand size.\n{2}{U}: Level 2\nYou may reveal an instant or sorcery card as you draw it.\n{4}{U}: Level 3\nWhenever you draw a card, put a +1/+1 counter on target creature you control.",
    );
    expect(sections.map((section) => section.level)).toEqual([1, 2, 3]);
    expect(sections[0]?.text).toMatch(/no maximum hand size/);
    expect(sections[1]?.text).toMatch(/^\{2\}\{U\}: Level 2/);
    expect(sections[2]?.text).toMatch(/^\{4\}\{U\}: Level 3/);
  });
});
