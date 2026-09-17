/**
 * Hull and the shield canister (FR-4, FR-5; D26, D27, D28, D29).
 *
 * THIS FILE IS NOW A RE-EXPORT. The rules moved to `src/engine/hull/`, where
 * CLAUDE.md says rules belong and where the 95% coverage gate can see them -
 * the audit's G-coverage finding was that the file deciding when a child's run
 * ends sat outside every gate in the repo.
 *
 * The seam is kept because several callers import `@game/flight/shield.js` and
 * a file move is not worth a cross-lane edit. Everything below is the engine's,
 * unchanged, and `MAX_HULL` is deliberately absent: a stage's hull now depends
 * on how long the stage is (`hullForStage`), so a module-level constant would
 * be the very mistake the engine module documents.
 */

export {
  HULL_BASE_MARKS,
  HULL_MARK_COUNT,
  HULL_MARK_DIM,
  HULL_BASE_SPAWNS,
  LAMP_GUTTER_FRACTION,
  LAMP_MIN,
  MIN_HULL,
  hullAfterShield,
  hullAfterStrike,
  hullForStage,
  hullLampLevel,
  hullLampStep,
  hullMarkAlpha,
  hullMarksLit,
  isStalled,
  maySpawnCanister,
  startingHull,
  survivableHitRate,
} from "@engine/hull/index.js";
