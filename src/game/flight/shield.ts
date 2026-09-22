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

export type { CanisterHintInput } from "@engine/hull/index.js";
export type { RockHintView } from "@engine/hint/index.js";
export { rockHintFits, rockOnScreen } from "@engine/hint/index.js";

export {
  CANISTER_SPAWN_CHANCE,
  HULL_BASE_MARKS,
  HULL_PASS_COST,
  HULL_STRIKE_COST,
  HULL_MARK_COUNT,
  HULL_MARK_DIM,
  HULL_BASE_SPAWNS,
  HULL_SPAWNS_PER_MARK,
  LAMP_GUTTER_FRACTION,
  LAMP_MIN,
  MIN_HULL,
  hullAfterShield,
  hullAfterStrike,
  hullIsDamaged,
  hullForStage,
  hullLampLevel,
  hullLampStep,
  hullMarkAlpha,
  hullMarksLit,
  isStalled,
  maySpawnCanister,
  shouldHintCanister,
  startingHull,
  survivableHitRate,
} from "@engine/hull/index.js";
