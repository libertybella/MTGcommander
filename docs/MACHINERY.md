# Machinery index — where things live

**Read this before searching.** A wave spends most of its budget
rediscovering where machinery lives; this is that map, kept as symbol
names rather than line numbers so it does not rot on the next edit.

It is a *pointer*, not a second copy of the rules. The wave loop and the
tier live in [../CONTRIBUTING.md](../CONTRIBUTING.md); what the engine
already does lives in [RULES_COVERAGE.md](RULES_COVERAGE.md); operational
lessons live in [HANDOFF.md](HANDOFF.md). When any of those disagree with
this file, they win — but fix the drift.

Refresh at checkpoints, same cadence as HANDOFF.md.

---

## 1. The recipes — "I am adding a new …"

Each of these is a checklist of every site that must change. Miss one and
the thing compiles, typechecks, and does nothing. That failure is
invisible to the compile-rate metric **by construction**: the metric asks
whether text compiled, not whether the result is wired up.

### … effect (a new `CardEffect` kind)

1. `engine/src/types.ts` — **both unions**. The UNBOUND one
   (`CardEffect`, selectors like `CardIdSelector` / `PlayerSelector`) and
   the BOUND one (`GameEffect`, concrete ids). They are far apart in the
   file; search the kind of a neighbouring effect to find both.
2. `engine/src/effects.ts` — `bindCardEffects`' switch (unbound → bound),
   then the apply switch. Both are exhaustive, so **tsc will name both
   sites for you** — add the union member first and let it point.
3. `engine/src/serialize.ts` — a parser in **each** of the two parser
   chains, matching the two unions.
4. If it can be produced by an each-opponent clause, check
   `expandEachOpponent` in `effects.ts` — a missing kind there *throws*
   at bind rather than dropping quietly.

### … field on `CardDefinition` (or on an ability)

The four mapper layers, listed in full in
[../CONTRIBUTING.md](../CONTRIBUTING.md) — `createGame.ts` (Pick list
**and** spread), `serialize.ts` (both unions), `oracle.ts`
(compiled→definition pass-through), and `client/` + bot + fuzz for new
prompt kinds.

**A fifth site exists for activated abilities:** `oraclePatterns.ts`
rebuilds the ability field-by-field at the push site, so a new
`ActivatedAbility` field must be added there too, and to
`parseAbilityCost`'s explicit return type (a conditional spread is
widened away otherwise). This bit Metalwork Colossus's `xCost` in wave
196.

### … target kind (`TargetKind`)

1. `types.ts` — the `TargetKind` union.
2. `targeting.ts` — the legality branch (`isChosenTargetLegal`) **and**
   the permanent-family list further down that decides which kinds route
   through the permanent check. Two sites; both are `||` chains.
3. `serialize.ts` — the `kind !== "…"` validator chain.
4. `oraclePatterns.ts` — a row in `TARGET_HEAD_NOUNS` (battlefield),
   `GRAVEYARD_HEAD_NOUNS`, or a spell branch.

### … counted noun ("for each X" / "the number of X")

1. `types.ts` — the `DynamicCount` union.
2. `characteristicsEngine.ts` — `dynamicCountOf`. The tail is a **total
   `Record<typeof count, string>`**, so a new member that belongs there
   is a tsc error rather than a silent fall-through. Keep it that way.
3. `serialize.ts` — `DYNAMIC_COUNT_KEYS`, also a total record. Same
   reason: this guard had drifted to 7 of 13 and made one card fail to
   *deserialize*.
4. `oraclePatterns.ts` — a row in `DYNAMIC_COUNTS`. Every row admits
   singular **and** plural: printed text says "for each artifact" but
   "the number of artifacts".

### … continuous effect (a layer-6-ish static)

1. `types.ts` — `ContinuousEffectData`.
2. `characteristicsEngine.ts` — `LAYER_OF` (a total record — tsc catches
   a missing entry) **and** the apply switch in `applyInstance`.
3. `serialize.ts` — the continuous-effect parser.
4. If it adds a field to `ComputedCard`, initialise it in **both**
   returns of `baseComputed` (the face-down branch is easy to miss).

### … reader of a granted ability

A permanent can hand a triggered or activated ability to a set of other
permanents (`grant_trigger` / `grant_activated`, both layer 6). Two rules
follow, and breaking either is silent:

1. **Never read `definition.triggers` or `definition.activated` directly.**
   Use `triggersOf(state, cardId)` and `activatedOf(state, cardId)` from
   `characteristicsEngine.ts`. They return printed-then-granted as ONE
   list, so an index past the printed length names a grant. Inside a loop
   over the battlefield, pass a `computedCards(state)` map as the third
   argument — otherwise every call reruns the whole layer engine.
2. **Anything that goes on the stack snapshots the grant**, via
   `grantedTriggerSpread` / `grantedActivatedSpread` at the push site. An
   ability on the stack outlives its source (CR 113.7a); the grant does
   not. Without the snapshot, destroying the granting permanent in
   response resolves the ability into nothing — after its cost was paid.

The grant is the AFFECTED permanent's ability: it fires from that
permanent, "~" in its body is that permanent, and a granted `{T}` taps
that permanent. Hand and graveyard activations still read the definition
— only battlefield statics grant.

### … trigger event

`types.ts` (`TriggerEvent`), `triggers.ts` (dispatch), `serialize.ts`
(`TRIGGER_EVENT_NAMES`, which uses `satisfies TriggerEvent[]` to catch
drift — imitate that pattern), and a head in `oraclePatterns.ts`.

### … `subjectFilter` field

`types.ts`, `triggers.ts` (`subjectMatchesFilter`), `serialize.ts`, **and
`createGame.ts`'s explicit per-field subjectFilter mapper** — that last
one is the trap; tsc is perfectly happy without it.

---

## 2. The grammars — extend, never parallel

All in `engine/src/oraclePatterns.ts`. Every one **refuses what it cannot
read**, which is what makes them safe: an unparsed qualifier becomes a
clean miss rather than a silently widened target. Preserve that.

| Grammar | Reads |
| --- | --- |
| `parseSimpleTargetPhrase` | battlefield target noun phrase. Expects the word "target" still attached. Trailing-qualifier loop + leading adjectives. |
| `parseGraveyardTargetPhrase` | "target creature card from your graveyard". Takes the phrase *without* "target". |
| `parseSweepPhrase` | "all nonartifact creatures your opponents control" |
| `parseTriggerSubjectPhrase` | trigger subjects. **Order is load-bearing**: keyword qualifier ("with flying") strips before possessor. |
| `parseTokenDescriptor` | token count/size/colours/types. Subtypes are told from card types by **capitalisation** — oracle text capitalises one and lowercases the other. |
| `parseEffectCondition` | the shared condition vocabulary: trigger intervening-ifs, `Activate only if …` on activated *and* mana abilities, ability-word riders. |
| `parseGrantPredicate` | "get +1/+1 and have vigilance". Splits on VERBS, not "and" — keyword lists use "and" internally. |
| `compileStaticGrant` / `compileUntilEotGrant` | static and until-EOT grants |
| `compileSimpleClause` | **the clause compiler.** Trigger bodies and modal bullets reach here. |
| `compileCompoundClause` | splits a body at top-level ", then" / "and" |
| `parseAbilityCost` | cost half of an activated ability |
| `parseSpellDescriptor` | cast-trigger fillings |

**A branch added to the main sentence loop is invisible to trigger
bodies.** That loop walks a card's top-level sentences only. Anything a
trigger or a modal bullet needs belongs in `compileSimpleClause`.

### Shared tables

`TARGET_HEAD_NOUNS`, `GRAVEYARD_HEAD_NOUNS`, `SWEEP_HEAD_NOUNS`,
`DYNAMIC_COUNTS`, `SUBJECT_HEAD_VERBS`, `KEYWORD_GRANTS`,
`ABILITY_WORDS`, `COUNT_WORDS`, `TOKEN_CARD_TYPES`, `SEARCH_CARD_TYPES`,
`BATTLEFIELD_RETURNABLE`, `COST_UNIT`.

`COST_UNIT` splits cost from body and sits **upstream** of everything —
a gap there means working machinery downstream never sees the text.

---

## 3. Engine map — which file owns what

| Concern | File |
| --- | --- |
| CR 613 layers, `ComputedCard`, `dynamicCountOf` | `characteristicsEngine.ts` |
| What abilities an object HAS (`triggersOf`, `activatedOf`) | `characteristicsEngine.ts` |
| Binding unbound→bound, applying every effect | `effects.ts` |
| Target legality and legal-choice enumeration | `targeting.ts` |
| Trigger dispatch, `subjectMatchesFilter`, `triggerConditionHolds` | `triggers.ts` |
| Attack/block declaration and its requirements | `combat.ts` |
| State-based actions (lethal damage, 0 toughness) | `status.ts` |
| Steps, cleanup, and everything that expires | `turn.ts` |
| Cast/activate validation, cost payment | `actions.ts` |
| What the UI may offer (works from POTENTIAL mana) | `legalActions.ts` |
| Cycle-safe shared queries | `derived.ts` |
| Mana abilities and colour scopes | `manaOptions.ts` |
| Zone changes, ETB counters, death events | `zones.ts` |

**`actions.ts` and `legalActions.ts` ask different questions.** Actions
work from a real pool; enumeration works from potential mana and must
never offer a spell the payment path would refuse, nor hide one that
could be paid. A cost change usually needs both.

**`derived.ts` exists to break import cycles.** A helper needed by both
`actions.ts` and `legalActions.ts` goes there.

---

## 4. Things that expire

Anything temporary is cleared in `turn.ts`'s cleanup branch (inside
`onEnterStep`, gated on `step === "cleanup"`) — **not** in
`beginNextLivingTurnInPlace`. A test that wants the expiry must step into
cleanup, not into the next turn.

Current list: `temporaryControl`, `temporaryCopies`, `nextSpellGrants`,
`freeCastFromHand`, `flashThisTurn`, `diesReturnUntilEot`, and the
until-EOT effect list. Goad is the exception: it expires at the
**goader's** untap, not at cleanup, because it lasts "until your next
turn".

---

## 5. Tooling

Scratch tooling lives **outside the repo**, in the workbench at
`E:\Claude\mtg-workbench`, so a `tmp*.test.ts` can never be committed (they
are `.test.ts` files and *will* run in the suite, inflating counts).
`**/src/tmp*.test.ts` is also gitignored now, so a probe left behind by an
interrupted run cannot be committed even by accident.

    mtg-workbench/data/    oracle-bulk.jsonl, edhrec-top2000.json
    mtg-workbench/tools/   scan.sh, text.sh, bullet.sh, synth.sh, probes/

**It moved off `%LOCALAPPDATA%\Temp` on 2026-08-23.** Storage Sense is
enabled on this machine with temp-file deletion on, and it had both the
200MB bulk file and the entire session scratchpad in scope — an unattended
overnight run would have lost its tooling and its measure mid-flight. The
tools are self-locating, so the directory can be moved as a unit.

- `scan.sh` — copies a scanner in, runs it, takes it back out. Emits
  `[scan] dN rNNN <card> :: <uncompiled fragments>`.
- Pick clusters by sorting that output **two ways**: by grammar, and by
  the *length* of the missing fragment. The length sort is what finds
  families the grammar sort reports as a thin tail.
- `near.sh` — for every ONE-AWAY card, rewrites its fragment by a short
  list of mechanical substitutions (drop "or planeswalker", "an opponent"
  to "a player", drop "nontoken", drop "you may", …) and reports the ones
  that compile afterwards. A hit is the cheapest kind of flip there is:
  the engine already understands the shape and something narrower than it
  needs one more spelling. Wave 231 was exactly that shape.
  **Measured 2026-08-23: 254 one-away cards examined, ZERO fixed by any
  rewrite in the list.** That is a real result and not a broken probe (it
  reports how many cards it examined for exactly that reason): the cheap
  phrasing wins are spent, and every remaining miss needs a feature.
  Add rewrites to the list before concluding otherwise.
- **Edit source with a script file, never `node -e '…'`.** Nested shell
  quoting adds another layer to the one the tool already applies (see the
  doubled-backslash trap below), and a `node -e` one-liner gives you nowhere
  to put a comment explaining the escaping. Write the script to the
  workbench and run it. Three rules make an edit safe:
  - Join a multi-line needle with **the file's own newline**. Line endings
    are not uniform here: `HANDOFF.md`, `CLAIMS.md` and most of `engine/src`
    are CRLF; a handful of files are LF. A needle joined with the wrong one
    matches zero times and the edit silently does nothing. git hides this —
    `autocrlf` normalizes on commit, so `git diff` shows a file as unchanged
    while the working tree an edit reads is mixed.
  - **Assert exactly one match before writing.** A replace that matched zero
    times looks identical to one that succeeded, and the next thing you run
    is a full tier that passes for the wrong reason.
  - **Never type a doubled backslash into the script.** The tool eats one
    of them before the file is written. Build it with
    `String.fromCharCode(92)` and concatenate.
  `sourceHygiene.test.ts` enforces the line-ending half repo-wide.

### Traps that have cost real time

- **This Bash tool cannot write a doubled backslash. That is the whole
  `\b` trap.** Every write path through it — quoted heredoc included —
  collapses `\\` to `\`. A lone backslash passes through untouched, so
  the corruption only bites where source legitimately needs two:

      you write   const p = "from\\b";   // correct JS for a word boundary
      disk gets   const p = "from\b";
      JS reads    \b as BACKSPACE, char code 8
      the regex   matches nothing, silently, for ever

  Verified 2026-08-23: `\\` to `\`, `\\\\` to `\\`, single backslash
  unchanged. This is the mechanism behind waves 211, 221 and 223. **Two
  earlier explanations in this file were wrong** — first "a Python heredoc",
  then "any escape-expanding writer such as `echo -e`". Those writers do
  expand escapes, but they were never how these files were being written;
  chasing them is why the trap survived three waves.
  *To write source containing two backslashes*: use the **Write/Edit tools**
  (byte-exact), or build the character in code — `String.fromCharCode(92)`,
  which is what `workbench/tools` and every edit script here now do. Writing
  `\\\\` to get `\\` also works and reads like a puzzle; prefer the first two.
  *Regex LITERALS are unaffected* — `/\b/` needs one backslash and survives.
  **You no longer have to spot any of this.** `engine/src/sourceHygiene.test.ts`
  fails the ordinary `npx vitest run` on any invisible character in the repo,
  naming file, line, column and character. Do not work around the trap with
  `(?= |$)`, which is a weaker assertion than a word boundary.
- **Never commit a raw control character, even a deliberate one.** If you need
  a sentinel, spell it `\u0001` and give it a name — `PERIOD_SHIELD` in
  `oraclePatterns.ts` shields periods inside quoted grants. An invisible byte
  cannot be reviewed in a diff and survives the edit meant to remove it.
- **`grep -P` refuses to run under a non-UTF-8 locale** ("supports only
  unibyte and UTF-8 locales") and writes that to stderr, so a scan ending in
  `|| echo clean` reports clean having matched nothing. Use `LC_ALL=C.UTF-8`,
  or bash ANSI-C quoting with plain grep: `grep -c $'[\x08]' file`.
- **A test card whose oracle text names the card** must use that exact
  `name`, or `~`-normalisation fails and triggers silently don't compile.
- **A one-letter test card name** gets normalised out of the oracle text
  (every "t" becomes "~"). Use a real name.
- **Never run vitest alongside an 800-seed burn** — false timeouts.
- Burn exit code 1 with all tests passed is vitest `onTaskUpdate` RPC
  noise, not a failure.
