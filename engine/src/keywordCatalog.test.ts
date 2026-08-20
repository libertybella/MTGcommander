import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CR702_KEYWORD_ABILITIES,
  IMPLEMENTED_KEYWORDS,
  keywordCoverage,
  keywordCoverageMarkdown,
} from "./keywordCatalog";

const CHECKLIST_PATH = resolve(__dirname, "../../docs/KEYWORD_COVERAGE.md");

describe("CR 702 keyword catalog", () => {
  it("has no duplicate entries", () => {
    expect(new Set(CR702_KEYWORD_ABILITIES).size).toBe(CR702_KEYWORD_ABILITIES.length);
  });

  it("maps every engine keyword onto a catalog name", () => {
    const names = new Set(CR702_KEYWORD_ABILITIES);
    for (const mapped of Object.values(IMPLEMENTED_KEYWORDS)) {
      expect(names.has(mapped), `${mapped} missing from CR 702 catalog`).toBe(true);
    }
  });

  it("reports coverage as implemented + missing = total", () => {
    const coverage = keywordCoverage();
    expect(coverage.implemented.length + coverage.missing.length).toBe(coverage.total);
    expect(coverage.implemented.length).toBeGreaterThanOrEqual(14);
  });

  it("keeps docs/KEYWORD_COVERAGE.md in sync (set UPDATE_COVERAGE=1 to regenerate)", () => {
    const expected = keywordCoverageMarkdown();
    if (process.env.UPDATE_COVERAGE) {
      writeFileSync(CHECKLIST_PATH, expected, "utf8");
      return;
    }
    let actual = "";
    try {
      actual = readFileSync(CHECKLIST_PATH, "utf8");
    } catch {
      // Missing file fails the comparison below with a helpful diff.
    }
    expect(actual.replaceAll("\r\n", "\n")).toBe(expected);
  });
});
