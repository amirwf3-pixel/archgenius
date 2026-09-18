export * from './site.js';
export * from './building.js';
export * from './space.js';
export * from './wall.js';
export * from './opening.js';
export * from './stairs.js';
export * from './parking.js';
export * from './floor.js';
export * from './layout.js';
export * from './project.js';
// Phase 11.1: RoomSizeConstraint canonical in space.ts (re-exported from room-constraints for compat, but index exports only once from space to avoid duplicate)
// Export constraint types explicitly excluding RoomSizeConstraint to avoid duplicate export (canonical is from space.ts)
export {
  type RoomConstraintKind,
  type ConstraintStrength,
  type RoomAdjacencyConstraint,
  type ParametricRoomConstraints,
  type RoomLock,
  createDefaultRoomLock,
  isRoomLocked,
  validateRoomSizeConstraints,
  constraintsFromSpec,
} from './room-constraints.js';
// Alias for backward compat: ParametricRoomSizeConstraint = RoomSizeConstraint
export type { RoomSizeConstraint as ParametricRoomSizeConstraint } from './space.js';
