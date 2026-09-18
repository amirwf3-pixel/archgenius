export * from './vec2.js';
export * from './rect.js';
export * from './line.js';
// polygon.js legacy kept for direct imports, but avoid duplicate re-export via index (use polygon-ops canonical)
export { type Polygon as LegacyPolygon } from './polygon.js';
export * from './polygon-ops.js';
export * from './room-polygon.js';
