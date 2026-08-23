# Session handoff brief

Operational knowledge for any agent taking over the M6 compile-rate
grind — written at checkpoint-71 as the original flywheel session wound
down. The binding rules live in [../AGENTS.md](../AGENTS.md); the wave
loop lives in [../CONTRIBUTING.md](../CONTRIBUTING.md); who-is-working-
on-what lives in [CLAIMS.md](CLAIMS.md). This file is the tribal
knowledge that isn't obvious from those: exact commands, traps, and
the current state of play. Read all four before writing code.

## State of play (checkpoint-90-narrow-matchers, 2026-08-23)

- Branch `comprehensive-plan`, tags through `checkpoint-90-narrow-matchers`,
  pushed to `fork`.
- 1,262 tests green; top-2,000 compile rate **68.4% (1,374/2,009)**;
  60-card sample 97% (CI floor now 90); oxlint silent; 800/800 fuzz seeds
  on a clean tree at the tag.
- **Liberty's goal is 80% = 1,608 cards.** That is 234 more from here.
  Sixteen waves measured across this run flipped 21 cards between them,
  so the honest rate is **about one and a third a wave** and 80% is on the
  order of a hundred and seventy more waves. Say so rather than implying
  otherwise; it is not reachable in one session.
- **Three veins are now measured as EXHAUSTED, so do not re-search them.**
  `near.sh`: no one-away card is fixed by any mechanical rewording (251
  examined, 0 hits). `split.sh`: of the 68 one-away cards whose fragment is
  a trigger, **0 are blocked on the head** — 41 are blocked on the body and
  27 on both. Waves 231 and 241 took the last of the head gaps. The
  qualifier matrix still has unexplored cells, but corpus demand for them
  is thin.
- **What is left is bodies and features.** The largest single mechanism is
  phasing (8 cards, 3 one-away) and it is filed as a PRIMITIVE, not a wave.
- **Roughly 7 of the current wins are not wins.** See the stranded-effects
  row in CLAIMS.md: a rider on the same printed line as a trigger can land
  in `definition.effects`, where a permanent never runs it, so the card
  scores and does nothing. Measured with `stranded.sh` — 26 permanents
  carry spell effects, 7 of them currently score. Fixing it will LOWER the
  headline rate, and should still be done.
- **The shape that pays best right now is a NARROW MATCHER, not a missing
  feature.** Waves 231 and 233 were both "the engine already understands
  this phrase somewhere else": a head verb widened in the shared table but
  not in four hardcoded copies; an exclusion reachable from a leading
  "another" but not a trailing "other than ~"; a qualifier the static
  selector parser knew and the trigger-subject parser did not. Look for a
  phrase understood by ONE parser and not its sibling before looking for a
  feature to build.
- **The miss corpus is a genuine long tail.** 653 fragments, 651 of them
  distinct — only two appear on more than one card. There is no lever
  left that flips ten cards; the method now is to find the handful of
  cards that share ENGINE machinery rather than share wording, and to
  batch several small readers into one wave.
- **Wave 228 was reverted, and the reason generalises.** It measured +1
  and the +1 was a mis-compile: the grammar was fine but the value it
  read (`sacrificedPower`) is only ever set at cast time, so the card
  would have scored and played wrong. Before counting a flip, check that
  the value the new grammar reads is actually populated on the path that
  card takes. See the blocked row in CLAIMS.md.
- **The granted-ability primitive is DONE** (`grant_trigger` +
  `grant_activated`, layer 6). It moved the rate by design: a primitive
  session is judged by what it unblocks. Its reader — the quoted-grant
  grammar — is the next wave and is claimed as such in `CLAIMS.md`.
  **Never read `definition.triggers` / `definition.activated` again;**
  use `triggersOf` / `activatedOf`, and see the MACHINERY.md recipe.
- **The plan, agreed 2026-08-22 (Liberty + a Fable 5 review).** The wave
  grind alone tops out: a growing share of what is left is blocked on
  engine primitives that do not exist, so yield keeps falling. The fix is
  to alternate.
  1. **Primitive sessions, one primitive each, never mixed with wave
     grinding.** They end with the primitive, its tests, and maybe two
     demonstration cards — judged by what they unblock, not by the rate
     they move. Order by blast radius, smallest first: granted-ability
     statics (**done 2026-08-23**), then **a real "destroy" event**
     (widest change since tagged mana) — but take the quoted-grant
     grammar wave in between, so the primitive that just landed is
     actually read by something.
  2. **Wave sessions harvest what the primitive unblocked**, five to
     eight waves, then a PLANNED stop at a checkpoint — do not run to
     context exhaustion, the last waves get cramped and the handoff
     suffers.
  3. **Parallel sessions only when the streams are file-disjoint.**
     `CLAIMS.md` stops duplicated work, not merge pain: nearly every
     compiler wave touches `oraclePatterns.ts`, `types.ts` and
     `serialize.ts`, so two wave-grinders at once will collide. One
     grinder plus one primitive session is safe.
  4. Read-only subagents for the "where does X live" phase were
     PROPOSED and are **not authorised** — the project instruction
     stands: do not call the Agent tool unless Liberty asks.
     `MACHINERY.md` is the substitute, and it is working.
- **`docs/MACHINERY.md` is the location map** — the per-kind checklists
  ("I am adding a new effect / target kind / counted noun"), the grammar
  inventory, which engine file owns what, and the traps. Read it before
  searching; most of a wave's budget used to go on rediscovering it.
- **The `\b` trap is caught by the tier now, not by vigilance.**
  `engine/src/sourceHygiene.test.ts` fails the ordinary `npx vitest run` on
  any invisible character anywhere in the repo, naming the file, line, column
  and character. **The cause is that the Bash tool cannot write a doubled
  backslash** — every path through it, quoted heredoc included, collapses
  them to one, so JS source that needs two gets one and reads it as an
  escape. Two earlier explanations here ("a python heredoc", then "any
  escape-expanding writer") were both wrong, which is most of why it
  recurred three times. Build the character with `String.fromCharCode(92)`,
  or use the Write/Edit tools. MACHINERY.md §5 has the verified detail.
- **No live percentage target.** The "grind to 75%" directive was cleared by
  Liberty; the goal is 100% of the top 2,000, taken in chunks, with primitive
  sessions judged by what they unblock rather than by the rate they move.
  Waves 206–223 flipped between two and five cards each, and the rate keeps
  drifting down as the fat clusters get spent (206–210 averaged 3.4,
  216–220 averaged 2.0). Size a session at **two a wave**, not three.
- **A rider that needs to know what just happened belongs ON the effect
  that did it.** "You gain 1 life for each creature destroyed this way"
  is a field on the sweep, not a second effect asking the state what it
  missed — the sweep is the only thing that knows its own body count.
  Culling Ritual's mana had the shape already. Watch the plural case:
  "destroy all artifacts and enchantments" compiles to TWO sweeps, so the
  rider goes on every trailing one or it counts half the board. There is no single
  lever left in the miss corpus; this is a grind, and the method below is
  what makes it a steady one rather than a stalling one.
- **Pick clusters by sorting the miss corpus two ways, not one.** By
  GRAMMAR (`^Whenever` 48, `^{` 31, `^If` 28) the d1 pool reads as a long
  thin tail with nothing in it. By FRAGMENT LENGTH the same 286 cards put
  whole families on one screen — that is how the keyword vein was found,
  and how waves 211–217 kept finding three-card batches. Regenerate with
  `scan.sh`, then `awk -F' :: '` on the length of field 2.
- **The remaining keyword vein**, cheapest first: warp (3 cards), morph,
  dredge, suspend (2), cascade (2), foretell, evoke, spectacle, miracle,
  escalate, reconfigure, encore, split second, cumulative upkeep, myriad,
  impending, harmonize, splice onto Arcane, fuse. Where the reminder text
  says something the engine can already do, the keyword is a lowering and
  costs a few lines; the rest are a wave each.
- **Every wave this stretch that asserted a NEGATIVE case found a bug**,
  and none of them were visible to tsc or to the compile-rate metric.
  Three were the same shape — a filter that parses and is read by nobody
  (the serializer's counted-noun allow-list had drifted to seven of
  thirteen, so one card failed to DESERIALIZE; `dynamicCountOf` was
  called with no source, so every "attached to it" count was zero; the
  whole graveyard target family checked mana value and nothing else).
  Two were logic: sacrificing on "no counters left" rather than "one was
  actually removed" kills anything that outlives its counters, and
  recording the restore on every copy rather than the first would have
  restored the first copy instead of the printed card.
- **When a new union member must be handled somewhere, make the somewhere
  a total `Record<Union, …>`.** Wave 206 did that to the count evaluator
  and the serializer guard; wave 215 added five members and got two tsc
  errors instead of two silent fall-throughs. Prefer this to a chain of
  `if`s or ternaries whenever a new case would otherwise be swallowed.
- **"Add N mana in any combination of colors"** (Cascading Cataracts,
  Great Hall of the Citadel, Gwenna) needs a colour choice PER MANA.
  `producesAnyColor` with `count: N` gives N mana of ONE chosen colour,
  which turns a colour-fixing land into a meaningfully worse card — so it
  stays a miss until the mana ability can carry a per-mana choice.
- **Two shapes worth knowing before you re-try them.** Totem armor and
  regeneration both need a "destroy" event this engine does not have — a
  targeted destruction is a `move_card` to the graveyard, so a
  replacement would also catch sacrifices and bounces. And "when you PLAY
  a land" is not "when a land enters"; approximating it makes City of
  Traitors die to a fetched land, which is a wrong game rather than a
  rough one.
- **The one-away pile has a vein in it: bare keyword lines.** Sorting the
  misses by fragment LENGTH rather than by grammar found what clustering
  by shape had missed — roughly thirty cards are one sentence away, and
  that sentence is a keyword with nothing else on the line. Persist,
  Vanishing, Outlast, Unearth, Eternalize, Umbra armor, Evoke, Foretell,
  Morph, Dredge, Suspend, Cascade, Miracle, Spectacle, Escalate,
  Reconfigure, Encore, Split second, Cumulative upkeep, Myriad, Warp,
  Impending, Harmonize, Splice onto Arcane, Fuse. **Where the reminder
  text says something the engine can already do, the keyword is a
  lowering, not a mechanic** — outlast is a tap ability at sorcery
  timing, typecycling is cycling with a search where the draw was,
  unearth is a graveyard activation whose every rider already existed.
  Those cost a few lines each. The rest are real work, and waves 208–210
  took the cheap end first. **This is the highest-density remaining vein;
  keep working it.**
- **Sort the miss corpus by fragment length, not only by grammar.** The
  structural clustering (`^Whenever` 48, `^If` 28, `^{` 31) is a long
  thin tail of one-offs and reads as "no lever left". The same 294 cards
  sorted by how much text is missing put the entire keyword vein on one
  screen.
- **Two things were probed this stretch and deliberately left**, both
  worth knowing before someone tries again. Totem armor (Bear Umbra,
  Snake Umbra) has nothing to hook: this engine has no "destroy" distinct
  from a `move_card` to the graveyard, so a destruction replacement would
  also catch sacrifices and bounces. Blade of Selves GRANTS myriad rather
  than having it — the granted-ability primitive now exists for it, and
  what is still missing is the grammar that reads the quoted body.
  (Kaldra Compleat turned out NOT to be waiting on that primitive: its
  miss is a printed `watch: "attached"` trigger head. **Check what a
  card's miss actually is before listing it under a blocker.**)
  Encore needs a token that must attack one NAMED player —
  wave 207 taught the engine "must attack" and "may not attack X", but
  not "must attack X".
- **Waves 195–200 flipped 5, 3, 5, 10, 3, 3. The +10 was the cheapest
  wave of the stretch, and it added almost no capability.** Every gap in
  it was a REFUSED READING rather than a missing feature: the sweep
  effect had accepted a negated X since it was written and the grant
  refused to pass one; "each creature" was not an alias for "all
  creatures". **Check whether the capability exists and the reading is
  what is missing, before building anything.** A refused wording is far
  cheaper to diagnose than a feature is to add, and it outperformed the
  two heavy feature waves either side of it.
- **When something you just added is inert, the cause is often older and
  wider than your change.** Adding `excludedTypes` to a target did
  nothing; chasing why found that the whole permanent-target family
  (artifact / enchantment / artifact_or_enchantment / nonland_permanent /
  planeswalker / commander / …) recursed into the permanent check with a
  BARE `{kind:"permanent"}` requirement, so it never saw its own
  qualifiers. Excluded types, legendary, multicolored, both power bounds,
  nontoken and both subtype filters were inert across every one of them.
- **A branch in the main sentence loop is invisible to trigger bodies.**
  That loop only walks a card's top-level sentences; anything a trigger
  or a modal bullet needs belongs in `compileSimpleClause`. This cost two
  round-trips in wave 200 alone.
- **A gap can sit upstream of perfectly good machinery.** "Sacrifice
  three Foods" had both halves already (`sacrificeSubtype` and
  `sacrificeCount`) — but `COST_UNIT`, which splits cost from body, did
  not recognise the phrase as a cost at all, so the text never reached
  the parser that knew what to do with it.
- **Waves 189–194 flipped 5, 3, 6, 4, 3, 6. Wave 189 is the one to read
  first, because it corrects the rule above it.** The damage clauses were
  the obvious next collapse by branch count — EIGHTEEN of them, more than
  the token family that had just paid out eight. Sizing the miss list
  first said not to: it held TWO damage-recipient gaps, because those
  eighteen branches had already caught nearly every printed recipient.
  **Counting branches is half the test. The other half is whether the miss
  list still wants what they cover.**
- **The compile-rate metric cannot see a dropped field, by construction.**
  In wave 192 a narrowed flash grant compiled, the rate went UP, and both
  cards reported "fully compiled" — while `oracle.ts` never copied the new
  field onto the definition, so the grant did nothing at the table. Only
  the test caught it. Whenever you add a definition field, walk all four
  mapper layers before trusting the number.
- **Read the printed card, not the report line.** Valakut looked like it
  needed only a condition; the one-away report had truncated "you may have
  this land deal 3 damage" out of view, and that was the real blocker.
- **Waves 185–188 flipped 2, 3, 8, 5, and the size gap between them is
  the lesson.** Wave 185 pointed the until-EOT grant at the general
  target phrase and picked up almost nothing, because that grammar was
  already well covered. Wave 187 collapsed token creation — where a dozen
  branches each rebuilt the same effect from a different printed wording —
  and picked up eight. **Before starting a collapse, count the branches
  you are collapsing.** A family with two or three near-duplicates is
  already covered; a family with a dozen is where the cards are.
- **The capitalisation trick is worth remembering.** Oracle text
  capitalises subtypes and lowercases card types, so "Phyrexian Wurm
  artifact creature" divides with no type table at all. Printed text
  carries more structure than it looks like it does — look for it before
  writing a lookup.
- **Wave 186 found a bug class, not a bug.** Every "what does this player
  control" site read that player's OWN battlefield list and then filtered
  by controller. That is a subset of the real set — it silently drops
  anything controlled but not owned — and it was correct only for as long
  as nothing could change control. When you add a mechanic, grep for the
  places that assumed it could not happen; they will all be shaped alike,
  and they will all typecheck.
- **Three inert filters turned up in four waves**, all the same shape as
  the ones below: `legalChoicesForRequirement` listed every creature for a
  "creature" requirement while the legality check enforced its qualifiers;
  the unbound `pt_until_eot` parser rejected the `"x"` its own type had
  allowed for four waves; and the `player_sacrifices` dispatch returned
  true for any sacrifice by any player, ignoring watch, excludeSelf and
  the subject filter outright. That last one was invisible because the
  only head reaching it restricted nothing. **A filter with exactly one
  caller that happens not to use it is not covered — it is untested.**
- **Waves 179–183 flipped 11, 6, 5, 6, 4 — and the largest came from
  pointing grammars that already existed at a new destination.** Wave 182
  is the clearest case: "put target enchantment card from your graveyard
  on top of your library" needed no new parsing at all, just the existing
  graveyard noun phrase with a different `toZone`. Before writing a
  parser, check whether one of the eight already here fits.
- **A documented approximation is a to-do, not a decision.** "+X/+X until
  end of turn" had been a written-off drop since wave 147 because those
  effects held only fixed numbers; wave 181 closed it in one wave and
  picked up five cards. Re-read the documented-drop list in
  RULES_COVERAGE.md periodically — some entries have quietly become cheap.
- **Waves 174–178 flipped 7, 4, 5, 9, 5 — the grammar approach keeps
  holding.** The pattern that produced the biggest wave (177, nine cards)
  was the same one as wave 171: eight one-away cards turned out to be the
  same sentence with different filling, so the filling became a parser.
  Look for that shape first.
- **A replacement effect is worth building the moment two cards want it,
  because the third and fourth are free.** `damageAfterReplacements`
  (wave 175) took four cards and the mana multiplier took two, but both
  had to be wired at *every* application site — five for damage, or
  Torbran would have boosted a Bolt and not an attack. Find every site
  before writing the helper, not after.
- **Before adding machinery, check whether the mirror of something that
  exists will do.** A cost tax is a cost reduction with a negative
  generic (wave 176); what was actually missing was a scope field, since
  `castCostReduction` only ever walked the caster's own permanents.
- **Waves 169–173 reversed the falling-yield trend, and the reason is
  worth copying: every one of them replaced a family of enumerated
  regexes with a parser.** Target noun phrases, graveyard noun phrases,
  cast-trigger heads, sacrifice-cost subtypes, quoted grants on
  attachments. Wave 171 alone flipped 10. When the miss list looks like a
  long tail, check whether the *branches you already have* are a long
  tail — collapsing twelve of them into one grammar picks up the cards
  nobody wrote a branch for yet.
- **Every one of these waves also surfaced a silent drop, and none of
  them were caught by tsc.** A `permanent` target never ran the
  characteristic filter, so `legendaryOnly` was inert. Unwinding "gets
  +1/+1 and has \"…\"" in the wrong order ate the buff half without a
  note. `Sacrifice a token` split off a cost unit no branch understood
  and would have compiled to a free sacrifice. The pattern: a field that
  exists, typechecks, and does nothing. Assert the *negative* case in the
  test — the target that should be illegal, the half that should survive.
- **Two clusters this brief called "needs real surgery" turned out to be
  much smaller than the estimate, and both times the estimate was mine.**
  Free casting was supposed to need a new prompt; it needed a permission.
  Tagged mana was supposed to touch every payment site; the payment path
  is centralised and only two call sites admit restricted mana. The
  Dominus cycle looked like missing Phyrexian machinery and was one
  over-strict line in the cost parser. **Scope the thing before believing
  a scary estimate — especially your own.**
- **The permission-not-prompt trick is the reusable idea of waves
  157–161.** "You may cast … without paying its mana cost" looked like it
  needed a new prompt, which would have meant answer paths in the client,
  the bot, and the fuzzer — the expensive half of adding any choice.
  Modelling it as a *permission with a use count*, the way `exilePlayable`
  already handled impulse exiles, meant the existing cast action served
  it. The same move worked twice more: a one-turn flash window is state on
  the game read by the existing `hasFlashGrant`, and an either-or
  additional cost reads its branch from the fields the cast action already
  carries. Before building a prompt, always ask whether the thing can be a
  permission the player may or may not exercise. Bolas's Citadel is the
  next card that wants this shape (same permission, from the library top,
  paying life) and is one clause away.
- **Cycles are worth more than ranks.** The five Verge lands, five
  Landscapes, and five Thriving lands each fell to a single fix, and
  together they beat a dozen individually-chased high-ranked cards. When
  the miss list shows near-identical text five times, take that first.
- **When a fix flips nothing, find out why before moving on.** Wave 164's
  "up to one target" support flipped zero cards; chasing the reason found
  that comma-less legend names were never shortened, which is a
  normalisation bug affecting a whole class of legends. The zero-flip
  wave was worth more than its number.
- The wave loop continues toward the goal gate: M6, ≥95% of the EDHREC
  top-2,000 fully compiling. The rhythm below is proven across 183
  waves (15.6% → 60.5%); follow it as written.
- **Yield per wave tracks how much of the wave is a grammar.** Waves
  145–168 flipped 13, 15, 11, 6, 7, 8, 7, 5, 1, 6, 6, 4, 2, 2, 4, 9, 2, 2,
  1, 0, 1, 6, 0, 6, 0, 2 — a decline that read like an exhausted tail.
  Waves 169–173 flipped 4, 5, 10, 3, 5 by going back to grammars. The
  lesson is not "the tail is cheap again"; it is that *enumerated branches
  are themselves a tail*, and collapsing a family of them into one parser
  flips the cards nobody enumerated. When picking a cluster, look at the
  compiler as hard as at the miss list. Card-by-card chasing still yields
  1–2 a wave; grammar work yields 5–10.
- **Never push to GitHub without Liberty's explicit yes.** Nothing has
  been pushed; the remote flow (Ross et al.) starts only when she says
  so.

## Pick waves by machinery family, not by card

Roughly **500 cards are exactly one fragment short of compiling**, and
at the exact-text level almost every one of those fragments is unique —
so there is no single big lever left, and picking "the top N misses"
gives you N unrelated mechanics. What works instead is grouping the
one-away pool by *shared machinery* and building one grammar per group.
Waves 145–149 each did that and averaged ~10 flips; by wave 157 the scan
stopped returning families, which is what the note above is about.

Two scratch tools make this quick. Neither lives in the repo — they are
kept outside it precisely so a `tmp*.test.ts` can never be committed:

- **`scan.sh`** copies a scratch scanner into `server/src/`, runs it,
  and deletes it. `SCAN_ONEAWAY=1` histograms every one-away card by
  EDHREC rank; `SCAN_RE=<regex> SCAN_MAXD=<n>` lists cards whose
  remaining fragments match, at most n fragments from compiling;
  `PROBE_NAMES='a|b|c'` prints compile notes for named cards.
- **`synth.sh`** compiles synthetic oracle lines (`SYNTH='line|line'`).
  This is the fastest way to tell a missing *head* from a missing
  *body*: pair the suspect head with a known-good body ("draw a card")
  and vice versa. Several waves' scope came straight out of that.

Both are under the session scratchpad; recreate them from this
description if they are gone — they are ~120 lines each and the
descriptions above are the whole spec.

## The duplicated-matcher trap

Twice in five waves the same bug shape appeared: one concept
hand-copied into several modules, then quietly diverging. The
"you control …" gate had **four** copies (activated abilities, mana
abilities, static abilities, and a fourth in `manaOptions.ts` that
would have passed a new clause for *any* permanent); `createGame` and
`serialize` had **three** each of the same field-copying block.

Before adding a field to a shape that several carriers share, grep the
field name across `engine/src` first. If it appears in more than two
places, factor the logic out before extending it — the layer engine and
gameplay paths can share one implementation parameterised by its trait
source (see `gateSatisfied` in `characteristicsEngine.ts`, which takes
computed characteristics for gameplay and printed ones for the layer
engine, which must not recurse into its own output).

## Grammars beat regexes

Three of the five recent waves replaced a pile of fixed-shape regexes
with a subject/predicate parser, and each one flipped cards nobody had
probed. The pattern:

1. Split the sentence into a **subject** phrase and a **predicate**.
2. Parse the subject into the existing selector/filter shape,
   composing qualifiers (possessor, "Other"/"Each", colour, supertype,
   "…tokens", trailing "of the chosen type").
3. Parse the predicate into a **list** of effects, splitting on the
   verbs rather than on "and" (keyword lists use "and" internally).
4. Return null if **any** conjunct is unrecognised. Half-understood
   lines that compile to half a card are worse than a clean miss, and
   the compile metric treats them identically.
5. Run the new grammar **after** the existing narrow patterns, so it
   only catches what already fell through. Then delete the narrow ones
   only once the suite is green — that is how the Sword of Vengeance
   Oxford-comma bug surfaced.

Watch for shadowing in the other direction too: a grammar placed early
in the sentence chain can swallow a sentence a *later*, more specific
handler owns. `~ gets +1/+0 for each artifact you control` is Storm-Kiln
Artist's `bonusPt`, not a static grant; claiming "~" as a subject broke
it, and wave 94's test caught it.

The grammars now in `oraclePatterns.ts`: `compileStaticGrant` (permanent
grants, including the "As long as …" conditional forms),
`compileUntilEotGrant` (temporary grants), `parseGenericSubjectHead`
(enters/dies trigger noun phrases, singular and batched), and
`compileCompoundClause` (a body split at a top-level conjunction).
Extend these rather than adding a sibling regex.

`compileCompoundClause` deserves a note of its own: it accepts a split
only when EVERY part compiles cleanly alone, which makes it safe to
apply to any sentence — a conjunction that is really one phrase just
fails to split. That property is why it can sit last in the chain and
catch things nobody enumerated.

## Compile "full" must mean playable

The metric counts a card as full when it leaves no notes, which makes it
easy to inflate: store an unenforced field, emit no note, score a flip.
Don't. The **"Spend this mana only to …"** cluster is six one-away cards
including Cavern of Souls (rank 107) and is left BLOCKED on purpose for
exactly this reason — the mana pool is an untyped `Record<ManaColor,
number>`, so the restriction cannot be enforced without tagging mana
through every payment site, and compiling it anyway would let the bot
spend Cavern mana on anything while the number went up. Do the pool
surgery first, then take the six cards honestly.

The same instinct applies to approximations that *widen* what is legal.
"At the beginning of each opponent's end step" is still a clean miss
because the nearest cheap approximation — every player's step — would
fire Archfiend of Depravity on its own controller. An approximation that
makes the game merely rough is fine and is what the documented-
approximation policy is for; one that makes it wrong is not.

## Three latent bugs the recent waves flushed out

All three had the same shape — a field that existed, typechecked, and
did nothing — and all three were caught by *runtime* assertions, not
compile assertions. Write both halves of every wave test.

- The `attached` selector scope returned as soon as it matched the host,
  so `legendary`, `withCounter`, and every other refinement on an
  attached selector were inert.
- The compiler emitted `exceptSubtype` on the UNBOUND `destroy_all`,
  where only `exceptChosenType` existed; conditional spreads meant tsc
  never saw the excess property and the binder dropped it silently.
- `exile_graveyard` was missing from `expandEachOpponent`, so an
  "each opponent's graveyard" clause bound to nobody.

## Unattended and overnight runs

Written 2026-08-23, before an 8-hour unsupervised grind. Everything an
unattended session needs is now off `%LOCALAPPDATA%\Temp` and in the
workbench (see MACHINERY.md §5), because Storage Sense is enabled on this
machine with temp-file deletion on.

The rules that matter when nobody is watching:

1. **Never weaken the tier to make it pass.** Do not lower a compile-rate
   floor, skip a test, loosen an assertion, or delete a wave block because
   it went red. A red tier means STOP: commit nothing, leave the tree
   clean, and write what happened at the end of this file. A silently
   weakened gate is worse than a stalled run, because the next session
   inherits it believing it is green.
2. **The rate only goes UP.** If the compile measure drops, the wave is
   wrong — revert it rather than reasoning about why the drop is
   acceptable.
3. **Push to `fork` only** (`git@github.com:libertybella/MTGcommander.git`).
   `origin` is Ross's repo and denies write access to this identity; work
   reaches him by pull request. Never `git push origin`.
4. **No subagents.** The project instruction stands: do not call the Agent
   tool unless Liberty asks. MACHINERY.md is the substitute and it works.
5. **Never run the suite alongside a fuzz burn** — the parallelism causes
   false timeouts. One at a time, always.
6. **Stop at a checkpoint, not at context exhaustion.** Five to eight waves,
   then checkpoint: 800-seed burn on a CLEAN tree, tag, refresh this file.
   The last waves of an over-long session are cramped and the handoff
   suffers, which costs the next session more than the waves gained.
7. **One commit per wave, tree clean between waves.** An interrupted run
   should always be resumable from a committed state.

## The wave rhythm

One wave ≈ one claimed cluster ≈ 4–6 card flips. The loop:

1. **Claim** the cluster in [CLAIMS.md](CLAIMS.md) and commit just that
   file (`Claim: <cluster> (<owner>)`) BEFORE writing code.
2. **Probe**: write a scratch `server/src/tmpProbe.test.ts` that
   compiles the candidate cards and prints `result.notes`. Run it from
   the REPO ROOT: `npx vitest run server/src/tmpProbe.test.ts`
   (running from `server/` finds no tests — the vitest config lives at
   the root). A card's single note joins ALL its uncompiled sentences
   with `"; "` — a "one-away" card can hide three missing features.
   **Delete every `tmp*.test.ts` before running the suite or
   committing** — they are `.test.ts` files and WILL run in the suite
   (one got committed once; it inflates counts and breaks the tier).
3. **Verify oracle text** against the real bulk file — never trust
   memory for card text:
   `E:\Claude\mtg-workbench\data\oracle-bulk.jsonl` (Scryfall bulk),
   `E:\Claude\mtg-workbench\data\edhrec-top2000.json` (the measured
   list). **These moved off `%LOCALAPPDATA%\Temp` on 2026-08-23** —
   Storage Sense is enabled here with temp-file deletion on, which had
   both the 200MB bulk and the whole session scratchpad in scope.
   Nothing an unattended run depends on may live there.
4. **Implement** across all four mapper layers (see below).
5. **Test**: append a `wave NNN` describe block to
   `engine/src/rulesSprint.test.ts` (compile assertions + runtime
   assertions).
6. **Tier** (all must pass, in this order — it's fast):
   ```powershell
   npx tsc -p engine --noEmit; npx tsc -p server --noEmit; npx tsc -p client --noEmit
   npx oxlint
   npx vitest run
   $env:COMPILE_BULK="E:\Claude\mtg-workbench\data\oracle-bulk.jsonl"; $env:COMPILE_LIST="E:\Claude\mtg-workbench\data\edhrec-top2000.json"; npx vitest run server/src/compileRate.test.ts
   # read the "[compile-rate] list:" line — the rate only goes UP
   $env:FUZZ_SEEDS="200"; npx vitest run engine/src/fuzz
   ```
   `FUZZ_SEEDS` is the TOTAL game count across the 8 shard files —
   running them bare plays only 8 games and proves nothing.
7. **Document**: add a bullet to
   [RULES_COVERAGE.md](RULES_COVERAGE.md) directly after the newest
   entry. Every deliberate approximation must be named there (and in a
   code comment) — approximations are silent in-game but never
   undocumented.
8. **Commit** (author `Liberty Bella <liberty.j.bella@gmail.com>`,
   trailer `Co-Authored-By: <the model doing the work>`), flipping the
   claims row to `done` with the flip count and new rate in the same
   commit.

Every 5th wave is a **checkpoint**: run an 800-seed burn
(`$env:FUZZ_SEEDS="800"`, background it — takes ~4 min), then tag
`checkpoint-NN-<name>`, update the README factstrip + checkpoint
table, and refresh the plan artifact if you have access to it.

## The four mapper layers (the #1 silent-failure trap)

A new `CardDefinition` field must be threaded through FOUR places or
it silently drops somewhere between the compiler and the game:

1. **`engine/src/createGame.ts`** — the definition intake uses a
   `Pick` list plus EXPLICIT per-field spreads for `triggers`,
   `subjectFilter`, `manaAbilities`, `activated`, `staticAbilities`,
   and `modes`. A new field inside any of those objects must be added
   to the matching mapper by hand. This trap has bitten at least four
   times ("Target cannot be null" at runtime, or a feature that
   works in compile tests but not in games, is the symptom).
2. **`engine/src/serialize.ts`** — validating parsers with allow-list
   sets. New trigger events go in `TRIGGER_EVENT_NAMES`, new target
   kinds in the kind rejection chain, new effect fields in BOTH the
   unbound (`parseCardEffect`) and bound (game-effect) parsers, new
   prompt/action kinds in their parsers. If the serializer doesn't
   know a field, save/reload silently strips it.
3. **`engine/src/oracle.ts`** — the compiled→definition pass-through;
   top-level definition fields need explicit mapping here.
4. **Client/session/fuzz** — any NEW PROMPT kind needs: a UI answer
   path in `client/src/ui/Battlefield.tsx`, a bot answer in
   `server/src/session.ts`, and a fuzz answer in
   `engine/src/fuzzHarness.ts`. (Reusing existing machinery — e.g.
   `SpellMode` pairs for the gift mechanic — avoids all of layer 4;
   prefer that when a mechanic maps onto an existing choice shape.)

Plain `effects`/`targetRequirements` arrays pass through createGame
wholesale — only fields inside the explicitly-mapped objects need
layer 1.

Two more explicit lists in the same family: `LAYER_OF` in
`characteristicsEngine.ts` must name every `ContinuousEffectData`
kind (tsc catches this one), and createGame's `topOfLibrary` mapper
is another explicit-field list (tsc does NOT catch that one — the
field just silently drops).

## Engine conventions worth knowing

- Effects come in UNBOUND (definition, selectors) and BOUND (concrete
  ids) unions in `types.ts`; `bindCardEffects` in `effects.ts` maps
  one to the other; `applyEffects` applies bound ones.
- Targeted destroys are `move_card` toZone `"graveyard"` — there is no
  `destroy` effect kind. Library index 0 is the TOP.
- Cards keep the same instance id across zone changes; counters are
  NOT cleared on zone exit (existing convention — don't "fix" it
  mid-wave). `enterOwnerZone` throws if the card is already in a
  player zone — graveyard→battlefield returns use `moveCard`.
- Search prompts open at RESOLUTION, not cast. `sacrificeSelf` mana
  activations resolve immediately (fetch-land path).
- The player's commander lives at `player.commander.commanderIds`.
- SBA reads printed stats for graveyard cards — assert zone, not
  power, when testing kill-sweeps.
- Random choices (`roll_die_treasures`, `discard_random`) use
  `Math.random`; tests swap it out (`const o = Math.random;
  Math.random = () => 0.99; try { … } finally { Math.random = o; }`).
- When a test compiles a card whose oracle text names the card ("put
  those counters on The Ozolith"), the `name` passed to
  compileOracleCard must match exactly — otherwise the `~`
  normalization fails and triggers silently don't compile (the compile
  succeeds with notes; runtime just has no triggers).
- Auto-picks are the standard approximation for free choices the bot
  can't reason about (chosen creature type = most common controlled;
  "any color" = first commander-identity color else G; gift recipient
  = next opponent). Always document them in RULES_COVERAGE.md.

## Windows/PowerShell pitfalls

- Compound commands mixing here-strings and `Remove-Item` can fail
  with "system path is blocked" — split into separate calls.
- Appending test blocks: write the block to a scratch file, then
  `Add-Content -Path engine\src\rulesSprint.test.ts -Value
  (Get-Content -Raw <scratch>)`. Bash heredocs with apostrophes
  mangle; don't fight them.
- `[IO.File]::Replace` fails ("path is empty") — use `Set-Content` to
  a .tmp then `Move-Item -Force`.
- NEVER junction `node_modules` into a git worktree — cleanup follows
  the junction and deletes real sources.
- Vitest "Timeout calling onTaskUpdate" unhandled errors during
  saturated 800-game burns are runner RPC noise; the tests-passed
  count is the signal (exit 1 with all tests passed = noise).

## Fuzz notes

- Seeds are only semi-deterministic (deck shuffles use `Math.random`);
  failures are probabilistic — reproduce with `FUZZ_DEBUG=1` (dumps
  state at stuck=24) and bigger burns, not by rerunning one seed.
- Each game has a 120s timeout; parallel over-subscription produces
  timeout failures masquerading as integrity failures.

## High-value open clusters (see CLAIMS.md for live status)

**The cheap tail is spent.** Waves 145–156 took the compile rate from
50.1% to 54.6% by finding families; by wave 157 the scan stopped
returning them. What is left divides into two piles, and the second is
where the remaining rate lives:

- *One-off clauses* — 3–6 flips per wave, each card its own mechanic.
  Still worth grinding, but budget accordingly.
- *Machinery that unlocks many at once, and needs real surgery first.*
  **Free casting is done** (waves 157–158) and turned out not to need a
  prompt at all — see the permission note above. **Tagged mana is done**
  (waves 166–167): `PlayerState.restrictedMana` is a second pool and
  payments take a `ManaPurpose`. It was smaller than feared because the
  payment path is centralised in `mana.ts` and only two call sites — a
  cast and an activation — ever admit restricted mana.
  What remains: **Phyrexian payment**, which can now ride the same
  purpose plumbing; and **sagas**, nominally the biggest miss (Urza's
  Saga) but worth less than it looks — only about four saga cards are in
  reach and each also needs its own chapter bodies compiled.

  A note on the mana work, since it was the thing this brief called
  blocked for several waves: the reason to build it rather than fake it
  was that an unenforced restriction would have raised the number while
  letting the bot spend Cavern of Souls mana on anything. The rule that
  produced the right call — *compile "full" must mean playable* — is
  worth keeping for the next cluster that looks similarly expensive.

Families identified but not yet built, each worth roughly a wave:
**general "A and B" trigger bodies** (the clause compiler handles some
conjunctions ad hoc and misses others — Undead Augur, Midnight Reaper,
Crime Novelist); **"As long as …" conditional statics** (Champion's
Helm, Serra Ascendant, The World Tree, Thunderfoot Baloth);
**granted abilities in quotes** ("Equipped creature has '{T}: Add one
mana of any color.'" — Paradise Mantle, Bootleggers' Stash, The Reaver
Cleaver, Diamond Pick-Axe); **an all-scope keyword grant** (there is
`all_pt_until_eot` but no keyword sibling — Lord of the Accursed);
**"+X/+X" in until-EOT effects** (they cannot carry an announced X —
Tyvar's Stand, Kessig Wolf Run); **protection from a card type**
(Spirit Mantle, Commander's Plate); **widening `leaves_battlefield`**,
which currently fires only for permanents carrying counters and so
cannot serve token-leave watches (Nadier's Nightblade).

Stream-F one-away buckets remain the steadiest 5–14 flips/wave (probe
the current top-miss list from the compile measure). Bigger machinery
still open, roughly by value: sagas (Urza's Saga is the #1 miss),
MDFCs (four in the top-miss head: Sink into Stupor, Valakut
Awakening, Sea Gate Restoration, Disciple of Freyalise),
convoke/improvise + delve (cast-payment surgery — Dig Through Time),
Confluences (choose-with-repeats), Fact or Fiction
(opponent-chooses), Academy Manufactor + Sylvan Library (replacement
effects), multikicker, hideaway trio, Meren experience counters,
Tergrid, Fiery Emancipation (damage tripling — six damage-apply sites
need a shared multiplier), High Tide (until-EOT tap replacement),
escape (Underworld Breach), Bloodchief Ascension (quest gates),
Wishclaw Talisman (control handoff), Trouble in Pairs (extra-turn
replacement), phasing, Phyrexian mana payment (unblocks Noxious
Revival's {G/P} and Drivnod), station. Deliberately deferred: Chrome
Mox imprint, Thassa's Oracle, cumulative upkeep, "Spend this mana
only…" restrictions.
