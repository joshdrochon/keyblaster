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
 * WHY THE HULL IS NO LONGER THE NUMBER 3
 *
 * D27 fixes the hull at three hits per stage. D17 targets ~85% success, "the
 * center of an ~80-90% band". Both were written when a stage was 18 words, and
 * at 18 words they agree: 85% of 18 is 2.7 rocks past the ship, and three marks
 * covers it.
 *
 * The stage is now 58 words (`flight/stage.ts`, FR-6: a belt has to last 90-150
 * seconds). 85% of 58 is 8.7 rocks past the ship. Three marks does not cover
 * that and never could: a stage of 58 is survivable only above
 *
 *     1 - 3/58 = 94.8%
 *
 * which is four points clear of the TOP of D17's band. So the difficulty
 * controller can be holding a child exactly where the spec wants them - 85%,
 * the middle of the band, the number the whole engine is tuned around - and the
 * stage still ends under them, twice. Nothing is broken; two constants were
 * written against different stage lengths and one of them moved.
 *
 * THE FIX IS A RATE, NOT A NEW CONSTANT. D27's real content is not "3"; it is
 * "about three rocks' worth of slack per 18 words", which is 85% survivability.
 * Expressed as a rate it keeps holding when the belt gets longer:
 *
 *     hull = floor(spawnCount x 3 / 18)
 *
 *     18 words -> 3 marks   (D27 exactly, unchanged)
 *     58 words -> 9 marks   (survivable at 1 - 9/58 = 84.5%)
 *
 * 84.5% is the band's centre rather than four points above its ceiling, which
 * is the relation D17 and D27 were always supposed to have.
 *
 * THIS IS NOT "MAKE IT EASIER". The number of rocks a child may lose per word
 * flown is identical to what D27 shipped. What changed is that the allowance
 * now scales with how much flying the stage asks for, so lengthening the belt
 * cannot silently tighten the difficulty target again - which is exactly what
 * it did last time, without a single test going red.
 *
 * D31 ("the player should always feel like the best typer in the world") is the
 * governing rule and it is the reason this is a floor rather than a tuning
 * knob: `MIN_HULL` keeps a short stage at three marks, so no stage is ever
 * harsher than D27 wrote it.
 * ==========================================================================
 *
 * Nothing in this file is a failure count. `hullMarksLit` is what the HUD
 * draws - marks that dim - and there is no "lives", no deduction and no penalty
 * anywhere in the surface (D31, AC-22b.1).
 *
 * Pure TypeScript: no Phaser, no DOM, no Math.random (CLAUDE.md).
 */

/** D27, verbatim: three hits per stage. The rate's numerator. */
export const HULL_BASE_MARKS = 3;

/**
 * The stage length D27 was written against. The rate's denominator.
 *
 * It is a named constant rather than an inline 18 because it is the thing that
 * moved: the defect was `stageWordCount` going from 18 to 58 while this number
 * stayed implicit in the literal `3`. Named, the relation is visible.
 */
export const HULL_BASE_SPAWNS = 18;

/** No stage is ever harsher than D27 wrote it, however short it is. */
export const MIN_HULL = HULL_BASE_MARKS;

/**
 * Hull marks for a stage of `spawnCount` words (D27 as a rate, D17's band).
 *
 * Total: junk input yields the D27 floor rather than NaN marks on the HUD.
 */
export function hullForStage(spawnCount: number): number {
  if (!Number.isFinite(spawnCount)) return MIN_HULL;
  const spawns = Math.max(0, Math.floor(spawnCount));
  const scaled = Math.floor((spawns * HULL_BASE_MARKS) / HULL_BASE_SPAWNS);
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

/** Clamp any hull value into [0, maxHull] and make it whole. */
export function hullMarksLit(hull: number, maxHull: number): number {
  const cap = Math.max(0, Math.floor(maxHull));
  if (!Number.isFinite(hull)) return 0;
  return Math.max(0, Math.min(cap, Math.floor(hull)));
}

/** AC-4.2: a rock crossing the breach line costs exactly one. Never below 0. */
export function hullAfterStrike(hull: number, maxHull: number): number {
  return Math.max(0, hullMarksLit(hull, maxHull) - 1);
}

/** AC-5.2: blasting a canister restores one, capped at the stage's maximum. */
export function hullAfterShield(hull: number, maxHull: number): number {
  const cap = Math.max(0, Math.floor(maxHull));
  return Math.min(cap, hullMarksLit(hull, maxHull) + 1);
}

/** AC-4.3: an empty hull stalls the stage (D29). */
export const isStalled = (hull: number): boolean => !(hull > 0);

/**
 * AC-5.1: a canister spawns only when the hull is damaged, and only one is ever
 * live. The word on it comes from the stage pool like any other rock, so this
 * predicate decides WHETHER, never WHAT - selection/ owns what.
 */
export function maySpawnCanister(
  hull: number,
  maxHull: number,
  canisterLive: boolean,
): boolean {
  if (canisterLive) return false;
  return hullMarksLit(hull, maxHull) < Math.max(0, Math.floor(maxHull));
}

// ---------------------------------------------------------------------------
// What the HUD draws (D31, AC-22b.1)
// ---------------------------------------------------------------------------

/**
 * THREE marks, whatever the hull is.
 *
 * Not one pip per hull mark. Nine pips in a row IS a lives counter, which
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
 *   maxHull 3, hull 2  ->  [1, 1, 0.16]       one mark per hit, as shipped
 *   maxHull 9, hull 8  ->  [1, 1, 0.72]       one hit dims a third of a mark
 *   maxHull 9, hull 0  ->  [0.16, 0.16, 0.16] nothing left, nothing counted
 *
 * Fractional on purpose: compressing nine marks into three must not make a
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
 * What was wrong is that NOTHING ON SCREEN MOVED. A 58-word belt carries nine
 * marks (`hullForStage`) and the HUD draws three (`HULL_MARK_COUNT`), so one
 * hit moved a 16x16 square from alpha 1.00 to 0.72 and the next from 0.72 to
 * 0.44. On a 1920x1080 frame, in a corner, while the player is reading a word
 * in the middle of the screen, that is not a damage moment. Nine hits looked
 * like zero hits, so the hull looked infinite.
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

/** The Lantern's light for a hull of any size, in [LAMP_MIN, 1]. */
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
