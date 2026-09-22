/**
 * Hull and the shield canister (FR-4, FR-5; D17, D26, D27, D28, D29, D31).
 *
 * These are rules, so they live here rather than in a scene. They used to live
 * in `src/game/flight/shield.ts`, which the 95% coverage gate does not cover -
 * the audit's G-coverage finding was that the file deciding when a child's run
 * ends had no test of any kind. `src/game/flight/shield.ts` is now a re-export
 * of this module and every rule below is under the gate.
 *
 * ==========================================================================
 * SIX MARKS AT THE SHIPPED BELT (C26, RESOLVED BY THE PROJECT OWNER)
 * ==========================================================================
 *
 * D27 fixes the hull at three hits per stage and AC-4.1 repeats it in as many
 * words: `hull == 3 at every stage start`. D17 targets ~85% success, "the
 * center of an ~80-90% band". Both were written when a stage was 18 words, and
 * at 18 words they agree: 85% of 18 is 2.7 rocks past the ship, and three marks
 * covers it. THIS FILE STILL RETURNS EXACTLY 3 AT 18 WORDS.
 *
 * The stage is now 58 words (`flight/stage.ts`, FR-6: a belt has to last 90-150
 * seconds), and three marks over 58 words is survivable only above
 *
 *     1 - 3/58 = 94.8%
 *
 * which is four points clear of the TOP of D17's band - so the controller can
 * be holding a child exactly where the spec wants them and the stage still ends
 * under them, twice. Two constants were written against different stage lengths
 * and one of them moved. That is C26, and it was put to the owner with a
 * measurement under it rather than settled in this comment.
 *
 * ================== WHAT THE OWNER DECIDED ==================
 * SIX MARKS AT THE SHIPPED BELT, down from the nine an earlier rate produced.
 * `hullForStage` returns six at 58 words and this file implements that, not the
 * literal AC-4.1 three: three was measured and refused because it breaks the
 * one bar this project holds constant, that the grade-2 pilot loses no belts.
 *
 * ================== THE SWEEP IT WAS PICKED FROM ==================
 * `tests/unit/simulation/hullThreeHits.test.ts` flies the whole six-stop route
 * with canisters ON in every arm, five pilots, the real controller and the real
 * pacing. Stalls per 720 belts, 120 seeds, re-measured against THIS tree:
 *
 *                                 ace  fast  median  slow  grade2   needs
 *     maxHull 9 (the old rate)      0     0      82     9      0    84.5%
 *     maxHull 6 (SHIPPED)           0     6     162    64      0    89.7%
 *     maxHull 5                     1    22     202   112      0    91.4%
 *     maxHull 3 (AC-4.1 literal)   58   135     307   309     42    94.8%
 *     maxHull 3, canisters MAXED   10    43     165   106     35    94.8%
 *
 * ================== IT IS A CHANGED RATE, NOT A CHANGED CAP ==================
 * Six at 58 words can be written two ways and they are not the same rule.
 *
 *   A CAP:  `min(6, floor(spawnCount / 6))` - the old rate, stopped at six.
 *   A RATE: `ceil(spawnCount / 10)`         - one mark per ten words.
 *
 * THE RATE IS THE ONE THAT SHIPS, because the cap silently re-creates the
 * defect the rate exists to prevent. A fixed six marks is survivable above
 * `1 - 6/n`, which passes 90% as soon as the belt passes 60 words - so the next
 * time `stageWordCount` moves, the difficulty target tightens past D17's
 * ceiling again with no test going red, which is exactly how nine marks came to
 * be needed in the first place. A rate cannot do that: `ceil(n/10)` keeps
 * `survivableHitRate` at or below the ceiling at EVERY belt length, which is
 * the property `tests/unit/flight/shield.test.ts` asserts over 18..200 words.
 *
 * ================== WHY TEN, AND WHY 6 RATHER THAN 5 ==================
 * The rate is not reverse-engineered from the number the owner picked. D17's
 * ceiling IS the rate: `1 - h/n <= 0.90` is `h >= n/10`, so the smallest whole
 * hull D17 permits is `ceil(n/10)`, which is 6 at 58. The stall sweep and the
 * band therefore land on the same number from two directions - and they pick
 * between the two hulls that both hold the grade-2 line, because five marks at
 * 58 words needs 91.4% and is outside the band while six needs 89.7% and is
 * inside it.
 *
 * `MIN_HULL` keeps a short stage at D27's three marks whatever the rate says,
 * so no stage is ever harsher than D27 wrote it (D31).
 *
 * ================== AND THE REPAIR ROCKS ARE STILL NOT A LEVER ==================
 * The owner's original ask was three marks, on the premise that the shield
 * canister covers the difference. Measured, it does not, which is why the
 * answer was six rather than three: with `CANISTER_SPAWN_CHANCE` at 1.0 and
 * three canisters live at once - roughly a third of the belt turned into repair
 * rocks, far past anything shippable - the grade-2 pilot still loses 35 belts
 * of 720. A canister is not a refund. It is an ORDINARY ROCK with an ordinary
 * fall time that pays only when it is BLASTED, typed by the one pair of hands
 * that is already behind (AC-2.1), so a 3-mark hull is three events however
 * many repair rocks are in the air. That negative result is asserted rather
 * than remembered: if a later change makes three marks survivable, the last
 * assertion in that test file goes RED and asks for the question to be
 * re-measured rather than re-decided from here.
 * ==========================================================================
 *
 * Nothing in this file is a failure count. `hullMarksLit` is what the HUD
 * draws - marks that dim - and there is no "lives", no deduction and no penalty
 * anywhere in the surface (D31, AC-22b.1).
 *
 * Pure TypeScript: no Phaser, no DOM, no Math.random (CLAUDE.md).
 */

import { rockHintFits, type RockHintView } from "../hint/index.js";

/** D27, verbatim: three hits per stage at the stage length D27 was written for. */
export const HULL_BASE_MARKS = 3;

/**
 * The stage length D27 was written against.
 *
 * NOT the rate's denominator any more - `HULL_SPAWNS_PER_MARK` is. It stays
 * named because it is the thing that moved (`stageWordCount` went 18 -> 58
 * while the literal `3` stayed put), and because D27's own row is the one row
 * `hullForStage` still has to reproduce: `hullForStage(HULL_BASE_SPAWNS)` is
 * `HULL_BASE_MARKS`, via `MIN_HULL`.
 */
export const HULL_BASE_SPAWNS = 18;

/** No stage is ever harsher than D27 wrote it, however short it is. */
export const MIN_HULL = HULL_BASE_MARKS;

/**
 * WORDS OF BELT PER MARK OF HULL. The rate, and the whole of the C26 change.
 *
 * Ten, because D17's band is the thing that fixes it. A belt of `n` words with
 * `h` marks is survivable above `1 - h/n`, and D17's ceiling is 90%, so
 *
 *     1 - h/n <= 0.90   <=>   h >= n/10
 *
 * and the smallest whole hull D17 permits at any belt length is `ceil(n/10)`.
 * At the shipped 58-word belt that is 6, which is the number the project owner
 * picked from the measurement (C26). The two arrive at the same place: 6 is
 * both the smallest hull that keeps the grade-2 pilot at zero lost belts and
 * the smallest hull D17's ceiling allows at 58 words. Five is neither - it
 * needs 91.4%, above the ceiling.
 *
 * IT IS A RATE AND NOT A CAP, and that is a decision rather than a detail. A
 * cap - `min(6, floor(n/6))` - also yields 6 at 58 and is one character
 * shorter to write, and it silently re-creates the exact defect the rate was
 * introduced to kill: past 60 words a fixed 6 marks needs more than 90% again,
 * so the next time `stageWordCount` moves the difficulty target tightens with
 * no test going red. A rate cannot do that. `survivableHitRate` stays inside
 * D17's band at EVERY belt length, which is the property
 * `tests/unit/flight/shield.test.ts` asserts over 18..200 words and the only
 * reason this is expressed as arithmetic instead of as a constant.
 */
export const HULL_SPAWNS_PER_MARK = 10;

/**
 * Hull marks for a stage of `spawnCount` words (C26: D17's ceiling as a rate).
 *
 * `ceil`, not `floor`: the hull is the SMALLEST whole number of marks that
 * keeps the belt survivable at or below D17's 90% ceiling, and flooring would
 * hand back a hull one mark short of it at every length that does not divide.
 *
 * Total: junk input yields the D27 floor rather than NaN marks on the HUD.
 */
export function hullForStage(spawnCount: number): number {
  if (!Number.isFinite(spawnCount)) return MIN_HULL;
  const spawns = Math.max(0, Math.floor(spawnCount));
  const scaled = Math.ceil(spawns / HULL_SPAWNS_PER_MARK);
  return Math.max(MIN_HULL, scaled);
}

/**
 * The survivable hit rate for a stage of this shape - what D17's band is being
 * compared against. Exported because the relation between D27 and D17 is the
 * thing that broke, and a number nobody can read is a number that can drift
 * again.
 */
export function survivableHitRate(spawnCount: number, maxHull = hullForStage(spawnCount)): number {
  const spawns = Math.max(0, Math.floor(Number.isFinite(spawnCount) ? spawnCount : 0));
  if (spawns === 0) return 1;
  return Math.max(0, 1 - Math.max(0, maxHull) / spawns);
}

/** AC-4.1: hull at every stage start, for a stage of this length. */
export const startingHull = (spawnCount: number): number => hullForStage(spawnCount);

/**
 * What a rock costs, by how it left the board (UR-91, C20).
 *
 * A rock that reaches the ship takes a whole mark. A rock that goes PAST the
 * ship and off the bottom of the screen takes half of one: the word was still
 * missed, and the owner's rule is that any word which passes the ship is a
 * failure - but a near miss is not the same event as a hit and must not read
 * like one.
 *
 * C20 IS LOGGED AGAINST THIS FILE'S OWN HEADER. It says "nothing in this file
 * is a failure count ... there is no lives, no deduction and no penalty
 * anywhere in the surface (D31, AC-22b.1)", and a practice rock used to pass
 * the ship for free on exactly that reasoning. The project owner has overruled
 * it: a belt where words can pass at no cost is a belt a child can finish
 * without typing, which is what they reported. D31's "not-yet, never denied"
 * still governs the WORDING and the re-teaching; it no longer governs whether
 * a missed word costs anything.
 */
export const HULL_STRIKE_COST = 1;
export const HULL_PASS_COST = 0.5;

/**
 * Clamp any hull value into [0, maxHull] as a whole number of MARKS.
 *
 * CEILING, NOT FLOOR, since half marks exist (UR-91). A hull of 0.5 is half a
 * mark of ship left and a child who is still flying; flooring it would draw an
 * empty hull over a live run, and "no marks showing" has to mean the run is
 * over - which is the owner's rule. So a partial mark still reads as a mark,
 * and zero marks means zero hull exactly.
 *
 * Every whole-number case is unchanged, which is why no existing assertion
 * moved.
 */
export function hullMarksLit(hull: number, maxHull: number): number {
  const cap = Math.max(0, Math.floor(maxHull));
  if (!Number.isFinite(hull)) return 0;
  return Math.max(0, Math.min(cap, Math.ceil(hull)));
}

/**
 * AC-4.2: a rock leaving the board costs the hull. Never below 0.
 *
 * THE RUNNING VALUE IS NOT ROUNDED, and that is the half mark's whole point:
 * this used to call `hullMarksLit` first, so two half-costs would have been
 * floored away to nothing. It clamps into the stage's range and subtracts,
 * leaving fractions intact for the next call. `hullMarksLit` does the rounding,
 * once, where it is drawn.
 */
export function hullAfterStrike(
  hull: number,
  maxHull: number,
  cost: number = HULL_STRIKE_COST,
): number {
  const cap = Math.max(0, Math.floor(maxHull));
  if (!Number.isFinite(hull)) return 0;
  const held = Math.min(Math.max(0, hull), cap);
  return Math.max(0, held - Math.max(0, cost));
}

/**
 * AC-5.2: blasting a canister restores ONE, capped at the stage's maximum.
 *
 * ONE MARK, NOT SOMETIMES ONE AND A HALF. This used to call `hullMarksLit` -
 * which CEILS - before adding, so a hull standing at 1.5 (one strike and one
 * pass-by, UR-91) came back at 3 and the canister had paid 1.5 marks against an
 * AC that writes 1. Whole-number hulls were exact, so no existing assertion
 * moved and nothing went red; only the halves `HULL_PASS_COST` creates were
 * over-paid, and they are exactly the halves a belt is full of.
 *
 * FIXED RATHER THAN DOCUMENTED. It was left in place once, on the reasoning
 * that a rounding which favours the child is the direction D31 asks for. That
 * reasoning is about difficulty; this is about an AC saying one thing and the
 * code doing another, and a repair whose value depends on whether the damage
 * before it happened to be half a mark is not a rule anybody wrote. It also
 * mattered more at every hull size below nine: at six marks the 0.5 it used to
 * invent is a twelfth of the whole ship.
 *
 * The running value stays fractional on purpose (`hullAfterStrike` says why).
 * `hullMarksLit` does the rounding, once, where the hull is DRAWN.
 *
 * `BeltResult.hullRepaired` still counts the marks actually returned rather
 * than canisters x 1, because the cap can still make a repair worth less than
 * one, and a harness that assumed otherwise would mis-state it.
 */
export function hullAfterShield(hull: number, maxHull: number): number {
  const cap = Math.max(0, Math.floor(maxHull));
  const held = Number.isFinite(hull) ? Math.min(Math.max(0, hull), cap) : 0;
  return Math.min(cap, held + 1);
}

/** AC-4.3: an empty hull stalls the stage (D29). */
export const isStalled = (hull: number): boolean => !(hull > 0);

/**
 * AC-5.1: a canister spawns only when the hull is damaged, and only one is ever
 * live. The word on it comes from the stage pool like any other rock, so this
 * predicate decides WHETHER, never WHAT - selection/ owns what.
 */
/**
 * A HALF-MARK OF DAMAGE DOES NOT OPEN THIS GATE, at any stage length.
 *
 * `hullMarksLit` rounds UP, so a hull of 5.5 out of 6 - or 2.5 out of 3 - still
 * reads as a full hull here and no canister spawns. A child whose only damage
 * so far is pass-bys (`HULL_PASS_COST`, UR-91) is offered no repair rock at all
 * until a rock actually reaches the ship. Recorded because it is invisible in
 * the arithmetic and it matters more the smaller the hull is: at the shipped
 * six marks a pass-by is a TWELFTH of the whole ship and still buys nothing,
 * where at nine it was an eighteenth. MEASURED AT SIX AND NOT CHANGED - the
 * numbers and the options are in `gauntlet/escalations.md`, because what a
 * near miss should do to the repair window is the owner's call and not a
 * side effect of a hull size.
 */
export function maySpawnCanister(
  hull: number,
  maxHull: number,
  canisterLive: boolean,
): boolean {
  if (canisterLive) return false;
  return hullMarksLit(hull, maxHull) < Math.max(0, Math.floor(maxHull));
}

/**
 * How often a spawn that MAY be a canister actually is one (AC-5.1).
 *
 * It was the literal `0.5` in `FlightScene.spawnRock` and a second literal
 * `0.5` in the belt harness - two copies of the number the whole "the repair
 * rocks cover it" argument rests on, neither of them named and neither of them
 * measured. Named here so the rate the game flies and the rate the harness
 * measures cannot drift apart, and so a sweep can move it.
 *
 * It is a CHANCE, not a rate per belt: the gate in front of it is
 * `maySpawnCanister`, so a full hull spawns none however high this is, and a
 * board that already carries one spawns none either.
 */
export const CANISTER_SPAWN_CHANCE = 0.5;

// ---------------------------------------------------------------------------
// What the HUD draws (D31, AC-22b.1)
// ---------------------------------------------------------------------------

/**
 * THREE marks, whatever the hull is.
 *
 * Not one pip per hull mark. Six pips in a row IS a lives counter, which
 * AC-22b.1 forbids by name, and it would have arrived as a side effect of a
 * difficulty fix rather than as a decision anybody made about the surface. So
 * the three marks D31 describes stay, and each one owns a THIRD of the hull -
 * the same division `starsForHullHits` uses, so what the child watches for two
 * minutes and what the results screen tells them afterwards are the same three
 * buckets.
 *
 * At an 18-word stage this is literally unchanged: one mark per hit.
 */
export const HULL_MARK_COUNT = 3;

/** The dim value a spent mark takes. It dims; it never disappears (D31). */
export const HULL_MARK_DIM = 0.16;

/**
 * How lit the i-th of the three marks is, for a hull of any size.
 *
 *   maxHull 3, hull 2  ->  [1, 1, 0.16]       one mark per hit, as D27 wrote it
 *   maxHull 6, hull 5  ->  [1, 1, 0.58]       one hit dims half a mark
 *   maxHull 6, hull 0  ->  [0.16, 0.16, 0.16] nothing left, nothing counted
 *
 * Fractional on purpose: compressing six marks into three must not make a
 * single hit invisible, or the child would take damage with no feedback at all
 * - a worse regression than the one being fixed.
 *
 * Here rather than in the scene so it is a RULE under the coverage gate, and so
 * it can be checked against the star bands instead of eyeballed on a frame.
 */
// ---------------------------------------------------------------------------
// What the SHIP shows (UR-22)
// ---------------------------------------------------------------------------

/**
 * THE LANTERN'S LIGHT, as a fraction of full.
 *
 * ================== UR-22 ==================
 * Reported from play: the hull looked as though it could absorb damage without
 * limit.
 *
 * The rule was never wrong - `isStalled` ends the belt at zero and always has.
 * What was wrong is that NOTHING ON SCREEN MOVED. A 58-word belt carried nine
 * marks when UR-22 was raised (six now, C26) against a HUD that draws three
 * (`HULL_MARK_COUNT`), so one hit moved a 16x16 square from alpha 1.00 to 0.72
 * and the next from 0.72 to 0.44. On a 1920x1080 frame, in a corner, while the
 * player is reading a word in the middle of the screen, that is not a damage
 * moment. Nine hits looked like zero hits, so the hull looked infinite. Six
 * marks makes each hit twice the step it was and does not change the answer:
 * the damage still belongs on the ship.
 *
 * ================== WHY THE FIX IS NOT MORE PIPS ==================
 * AC-22b.1 forbids a lives counter by name and D31 forbids anything that reads
 * as punishment, which rules out nine pips in a row and rules out a red bar.
 * Both of those answer "how do we COUNT the damage", and counting is the thing
 * the surface is not allowed to do.
 *
 * So the damage is shown on the object taking it. The ship is called the
 * Lantern and the game is about lighting beacons: its light is the natural
 * place for a hull to live, and a light going dim is not a score being
 * deducted. It is also BIG - a soft glow around the ship rather than a 16 px
 * square in a corner - which is the actual reason the old feedback failed.
 *
 * ================== THE NUMBERS ==================
 * Linear in hull, from `LAMP_MIN` at an empty hull to 1 at a full one, so every
 * single hit moves it by `1/maxHull` of the range at every stage length. It
 * never reaches zero: D31's rule that a mark dims and never disappears applies
 * here for the same reason - the ship is still flying.
 */
export const LAMP_MIN = 0.22;

/**
 * How dark the lamp gutters at the instant of a hit, as a fraction of the
 * level it is heading for.
 *
 * The STATE above is legible but slow; this is the MOMENT. The light drops out
 * almost entirely for a beat and comes back at its new level, which is what a
 * knock looks like on something that is lit. It is not a flash: a flash adds
 * light and reads as an alarm, and D31 has no alarms in it.
 */
export const LAMP_GUTTER_FRACTION = 0.15;

/**
 * The Lantern's light for a hull of any size, in [LAMP_MIN, 1].
 *
 * IT READS `hullMarksLit`, SO A PASS-BY DOES NOT DIM IT. Half-mark damage
 * rounds up and the lamp holds its level, while `hullMarkAlpha` below takes the
 * raw hull and DOES show it. The two damage surfaces therefore disagree about
 * half the hull events on a belt, and they disagree in the direction UR-22 was
 * raised about: the Lantern is the big, legible one and the 16 px marks are the
 * ones a child was already not seeing.
 *
 * NOT CHANGED HERE. Making the lamp continuous is a feel decision with its own
 * evidence (a lamp that flickers on every near miss may read as noise), so it
 * is the owner's, not a side effect of a hull size. It is written down because
 * at the shipped six-mark hull it is a twelfth of the ship taken with nothing
 * on the Lantern to say so, and it is measured over the route rather than
 * asserted here: see `gauntlet/escalations.md`.
 */
export function hullLampLevel(hull: number, maxHull: number): number {
  const cap = Number.isFinite(maxHull) && maxHull > 0 ? Math.floor(maxHull) : MIN_HULL;
  const left = hullMarksLit(hull, cap);
  return LAMP_MIN + (1 - LAMP_MIN) * (left / cap);
}

/**
 * How much one hit moves the light, at a stage of this length.
 *
 * Exported because it is the QUANTITY THE DEFECT WAS ABOUT. The old feedback's
 * equivalent number is `(1 - HULL_MARK_DIM) / maxHull` spread over a 16x16
 * square; this one is spread over the ship. A test that only checked "something
 * changed" would have passed on the version a player called infinite.
 */
export function hullLampStep(maxHull: number): number {
  const cap = Number.isFinite(maxHull) && maxHull > 0 ? Math.floor(maxHull) : MIN_HULL;
  return (1 - LAMP_MIN) / cap;
}

export function hullMarkAlpha(index: number, hull: number, maxHull: number): number {
  const cap =
    Number.isFinite(maxHull) && maxHull > 0 ? maxHull : HULL_MARK_COUNT;
  const left = Math.max(0, Math.min(cap, Number.isFinite(hull) ? hull : 0));
  // How much of THIS mark's share is still standing, in [0, 1].
  //
  // Multiplied out rather than written as `(left - index * cap / 3) / (cap / 3)`,
  // which is the same number and is not the same FLOAT: a hull of 5 over three
  // marks makes the third mark 0.9999999999999999 full, and "a full hull draws
  // three full marks" then fails on the one stage length nobody checked.
  const share = Math.max(
    0,
    Math.min(1, (left * HULL_MARK_COUNT - index * cap) / cap),
  );
  return HULL_MARK_DIM + (1 - HULL_MARK_DIM) * share;
}

/**
 * UR-146: when Shadow points at the repair rock. The copy is in
 * `game/flight/copy.ts`; this is the part that can be wrong, which is WHEN.
 * Once per belt, hull damaged, and the canister visible with time to be named
 * (`@engine/hint` owns those last two - the two-layer warning asks the same).
 */

export interface CanisterHintInput {
  readonly hull: number;
  readonly maxHull: number;
  readonly saidThisBelt: boolean;
  /** How long the clause that NAMES the rock takes to say - not the whole line. */
  readonly leadMs: number;
  readonly canister: RockHintView | null;
}

/**
 * `maySpawnCanister`'s second half, unchanged: a hint that can fire on a hull
 * too healthy for the board to draw a canister points at a rock that cannot
 * exist. `hullMarksLit` ceils, so half a mark of pass-by damage (UR-91) is not
 * damaged here either.
 */
export function hullIsDamaged(hull: number, maxHull: number): boolean {
  const cap = Math.max(0, Math.floor(maxHull));
  return hullMarksLit(hull, cap) < cap;
}

/** All four gates. `true` means say it now, and say it once. */
export function shouldHintCanister(input: CanisterHintInput): boolean {
  if (input.saidThisBelt) return false;
  if (!hullIsDamaged(input.hull, input.maxHull)) return false;
  if (input.canister === null) return false;
  return rockHintFits(input.canister, input.leadMs);
}
