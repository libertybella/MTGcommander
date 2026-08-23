import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characters that are legal in a source file and invisible in every editor,
 * diff, and terminal this project is read through.
 *
 * The one that keeps costing waves is U+0008, and the cause is narrower than
 * it looks. The agent tooling used on this repo cannot write a doubled
 * backslash: every path through it, quoted heredoc included, collapses two
 * into one. Source that legitimately needs two therefore arrives with one --
 * a string meant to hold a word boundary becomes a string holding a
 * backspace, and the pattern silently matches nothing for ever.
 *
 * Regex LITERALS are unaffected, since they need only one backslash. It is
 * regex-in-a-string that breaks, which is why it took three waves to see.
 *
 * Nothing else in the tier can see that. tsc compiles it, oxlint has no rule
 * for it, and the compile-rate metric reports a smaller number with no reason
 * attached — the same blind spot as a dropped field, arriving one layer lower.
 * So the guard is a byte scan, and it names the cause rather than the symptom.
 *
 * The code points below are written numerically on purpose: a guard against an
 * escape sequence must not be spelled with the escape sequence it guards.
 */
const INVISIBLE = new Map<number, string>([
  [0x00, "NULL"],
  [0x01, "START OF HEADING"],
  [0x02, "START OF TEXT"],
  [0x03, "END OF TEXT"],
  [0x04, "END OF TRANSMISSION"],
  [0x05, "ENQUIRY"],
  [0x06, "ACKNOWLEDGE"],
  [0x07, "BELL"],
  [0x08, "BACKSPACE"],
  [0x0b, "LINE TABULATION"],
  [0x0c, "FORM FEED"],
  [0x0e, "SHIFT OUT"],
  [0x0f, "SHIFT IN"],
  [0x10, "DATA LINK ESCAPE"],
  [0x11, "DEVICE CONTROL ONE"],
  [0x12, "DEVICE CONTROL TWO"],
  [0x13, "DEVICE CONTROL THREE"],
  [0x14, "DEVICE CONTROL FOUR"],
  [0x15, "NEGATIVE ACKNOWLEDGE"],
  [0x16, "SYNCHRONOUS IDLE"],
  [0x17, "END OF TRANSMISSION BLOCK"],
  [0x18, "CANCEL"],
  [0x19, "END OF MEDIUM"],
  [0x1a, "SUBSTITUTE"],
  [0x1b, "ESCAPE"],
  [0x1c, "FILE SEPARATOR"],
  [0x1d, "GROUP SEPARATOR"],
  [0x1e, "RECORD SEPARATOR"],
  [0x1f, "UNIT SEPARATOR"],
  [0x7f, "DELETE"],
  // Not control characters, but invisible for the same reason and just as
  // capable of making a string comparison fail against text that looks equal.
  [0x00a0, "NO-BREAK SPACE"],
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x200e, "LEFT-TO-RIGHT MARK"],
  [0x200f, "RIGHT-TO-LEFT MARK"],
  [0x2060, "WORD JOINER"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE"],
]);

const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".txt",
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  "coverage",
  ".vite",
]);

const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Source files are never this big — the largest here is a little over 1MB
 * and grows by a describe block a wave. The cap exists so a stray dump left
 * in the tree by an interrupted session cannot make the tier read hundreds
 * of megabytes. Anything over it is REPORTED rather than skipped: a silent
 * cap would quietly stop scanning the one file worth scanning.
 */
const MAX_SCANNED_BYTES = 8 * 1024 * 1024;

type Finding = { line: number; column: number; codePoint: number; rendered: string };

/** Every invisible character in `text`, with the line rendered so it can be seen. */
function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (let column = 0; column < line.length; column += 1) {
      const codePoint = line.codePointAt(column);
      if (codePoint === undefined || !INVISIBLE.has(codePoint)) {
        continue;
      }
      // A carriage return ending a CRLF line is the platform's, not a typo.
      if (codePoint === 0x0d && column === line.length - 1) {
        continue;
      }
      findings.push({
        line: index + 1,
        column: column + 1,
        codePoint,
        rendered: renderLine(line),
      });
    }
  });
  return findings;
}

/** The line with each invisible character replaced by its name, in place. */
function renderLine(line: string): string {
  return [...line]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const name = INVISIBLE.get(codePoint);
      return name === undefined ? character : `<U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} ${name}>`;
    })
    .join("");
}

function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        sourceFiles(join(directory, entry.name), found);
      }
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    if (dot > 0 && SCANNED_EXTENSIONS.has(entry.name.slice(dot))) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

describe("source hygiene: no invisible characters", () => {
  it("detects a planted backspace, so the scan cannot rot into a no-op", () => {
    // Built by code point rather than written as an escape, for the same
    // reason the table above is: this test must fail if the scan stops
    // looking, and it must not itself put the byte on disk.
    const backspace = String.fromCodePoint(0x08);
    const findings = scanText(`const RE = /(?!from${backspace})/;\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.codePoint).toBe(0x08);
    expect(findings[0]?.rendered).toContain("<U+0008 BACKSPACE>");

    // Tabs and newlines are ordinary whitespace and must not be reported, or
    // the guard would cry wolf on every indented file and get switched off.
    expect(scanText("\tconst a = 1;\n\tconst b = 2;\n")).toEqual([]);
  });

  it("finds no invisible character anywhere in the repository", () => {
    const offences: string[] = [];
    for (const file of sourceFiles(REPO_ROOT)) {
      const size = statSync(file).size;
      if (size > MAX_SCANNED_BYTES) {
        offences.push(
          `${relative(REPO_ROOT, file)} — ${size} bytes, over the ${MAX_SCANNED_BYTES}` +
            " byte scan cap. If this is a real source file, raise the cap; if it is" +
            " a dump left behind by an interrupted session, delete it.",
        );
        continue;
      }
      for (const finding of scanText(readFileSync(file, "utf8"))) {
        const name = INVISIBLE.get(finding.codePoint) ?? "UNKNOWN";
        const point = `U+${finding.codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
        offences.push(
          `${relative(REPO_ROOT, file)}:${finding.line}:${finding.column}` +
            ` — ${point} ${name}\n    ${finding.rendered}`,
        );
      }
    }
    expect(
      offences,
      offences.length === 0
        ? ""
        : `Invisible characters found in source:\n\n${offences.join("\n\n")}\n\n` +
            "A U+0008 BACKSPACE inside a regex is a word boundary that was written\n" +
            "through a layer that interprets escape sequences. Rewrite the file with\n" +
            "a quoted heredoc (<<'EOF'), printf '%s', or the Write/Edit tools — never\n" +
            "with echo -e, printf using the pattern as its format argument, a sed\n" +
            "replacement, or a non-raw string literal. See docs/MACHINERY.md.\n",
    ).toEqual([]);
  });
});

describe("source hygiene: one line ending per file", () => {
  it("finds no file that mixes CRLF and LF", () => {
    // Appending content written with the other convention is how this drifts:
    // a PowerShell `Add-Content` of an LF scratch file into a CRLF source, for
    // instance. git hides it — autocrlf normalizes on commit, so `git diff`
    // reports nothing — but the working tree is what an exact-match edit reads,
    // and a needle joined with the wrong newline silently matches zero times.
    const offences: string[] = [];
    for (const file of sourceFiles(REPO_ROOT)) {
      if (statSync(file).size > MAX_SCANNED_BYTES) {
        continue; // Already reported by the invisible-character scan above.
      }
      const text = readFileSync(file, "utf8");
      const crlf = (text.match(/\r\n/g) ?? []).length;
      const total = (text.match(/\n/g) ?? []).length;
      if (crlf > 0 && crlf < total) {
        offences.push(`${relative(REPO_ROOT, file)} — ${crlf} CRLF, ${total - crlf} LF-only`);
      }
    }
    expect(
      offences,
      offences.length === 0
        ? ""
        : `Files mixing line endings:\n\n${offences.join("\n")}\n\n` +
            "Rewrite the file with one convention throughout. Whichever ending\n" +
            "dominates is the one to keep — the point is that the file is\n" +
            "internally consistent, not that the repo picks CRLF or LF.\n",
    ).toEqual([]);
  });
});
