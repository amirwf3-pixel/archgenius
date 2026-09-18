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
// room-constraints exports RoomSizeConstraint which duplicates space.ts — export explicitly without duplicate
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
export type { RoomSizeConstraint as ParametricRoomSizeConstraint } from './room-constraints.js';
