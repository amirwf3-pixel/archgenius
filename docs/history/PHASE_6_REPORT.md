# Phase 6 — Professional Architectural Layout & CAD Quality — Report

**Date:** 2026-09-18
**Branch:** arena/01a0b33a-archgenius
**Baseline:** 9b33025 Phase 5.2 (172 tests) → Phase 6 (198 tests)

## Objective

Phase 6 Professional Architectural Layout & CAD Quality Engine on top of Phase 5.2 baseline. Must preserve VERIFIED rules (9), source integrity (SHA256 ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6 128 pages, e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477 84 pages), DXF R12 mm INSUNITS=4. Scope: room geometry, wall system, doors, windows, circulation, privacy, parking, furniture, dimensions, annotations, DXF layers, candidate ranking, architectural QA, regression, invariants, DXF parser, UI minimal, explainability.

## Baseline Before Phase 6

- PDFs in repo root and sources/: mabhas4-96.pdf 3.5M SHA ff5b351c..., 128 pages, mabhas-15.pdf 1.0M SHA e27e1d74..., 84 pages (pymupdf verified)
- source-registry.ts obtained-authenticated with digests, documentPath sources/...
- 9 VERIFIED: MBH4-ROOM-001 p99 12/2.7 9/2.5, ROOM-002 p66 6.5/2.15, ROOM-004 p73/p100 5.5/2.75/7.5/1.8/2.15/1.1/3.0, ROOM-007 1.0×1.3 p100-101, STAIR-001 p62/p99 0.9/1.1/2.4, STAIR-002 p62 0.28 tread 0.63-0.64 2r+t, STAIR-003 p62 max 12, DYL-001 p100 7m depth, LIFT-001 p19 >7m >21m 8 floors/28m two lifts
- 3 NOT_IMPLEMENTED Tier-1 backed, 2 municipal REQUIRES
- Tests 172 passed, build core tsc OK, web vite OK, DXF R12 INSUNITS=4

## Implementation

### 1. Wall System

- Extended WallKind: exterior, interior, partition, retaining, core, service
- Thickness: ext 0.35, int 0.15, partition 0.10, core 0.20, service 0.12
- generateWalls() assigns: ext if one side null, core if stair-hall/elevator-hall, partition if both service, service if one service, else interior
- DXF layers: A-WALL-EXT, A-WALL-INT, A-WALL-CORE, A-WALL-SERVICE, A-WALL-PART, A-COLUMN

### 2. Doors

- Opening extended: hinge, leafEnd, openEnd, swingAngle 90, leafThickness 0.04
- computeDoorLeaf()
- Placement: entrance on accessSide circulation wall margin 0.1, interior on every circulation wall, ensuite master-bath↔master-bedroom, guest-WC off entrance, bedroom suite, storage off kitchen, kitchen-dining, second bathroom off bedroom
- DXF: leaf line + 90° arc + thickness line, A-DOOR
- Validation: DOOR_COLLISION, DOOR_SWING_BLOCKED

### 3. Windows

- Orientation scoring per type (south for living/master, east for bedroom/kitchen)
- Width ratio 0.35-0.65 max 1.0-3.0m, sill 0.9-1.2m
- DXF four lines depth 0.04, A-WINDOW
- Validation WINDOW_OUTSIDE hard if not exterior

### 4. Circulation

- Metrics: usableAreaRatio, circulationRatio, totalCirculationArea, longestPath, deadEndCount, wastedArea, avgProportion, badCount
- Validation: CIRC_INACCESSIBLE hard, DISCONNECTED hard, CORRIDOR_TOO_NARROW hard 1.10, DEAD_END soft ≤1 door, EXCESSIVE soft >35%, EXCESSIVE_RESIDUAL soft >15%

### 5. Privacy

- privacySatisfaction 1 - violations/10
- PRIVACY_WEAK soft private adjacent entrance, SERVICE_EXPOSURE soft bath→living/dining

### 6. Parking

- placeParking perpendicular 2.5×5.0 aisle 3.5 min, PARKING_ACCESS_BLOCKED soft if no aisle

### 7. Furniture

- Sizes per Iranian practice, placement corners/walls/center clamped no overlap, validation FURNITURE_BLOCKS_DOOR distance <0.8

### 8. Dimensions & Annotations

- Outer dims offset 1.0, room dims offset 0.15 if >=2m, grid A-GRID/A-AXIS labels A/B/C 1/2, room labels area, north arrow, title block border + 10×2 block

### 9. DXF Layers

- Added A-AXIS, A-WALL-CORE, A-WALL-SERVICE, A-WALL-PART
- LAYERS list 21 entries, validateDXFStructure checks 14 required + INSUNITS=4

### 10. Candidate Ranking

- Preserved 4 strategies, sort best-first
- Vector: hardCount, geoSoft, hardAdj, circFail, areaDev, wasted, circRatio, softPenalty with formula (adj*10 + daylight*5 + orient*3 + privacy*4 + badProp*0.5 + dead*1 + service*2 + privacyWeak*1.5 + door*1 + window*1)
- HARD dominates, documented in ranking.ts

### 11. Architectural QA

- New file validation/architectural-qa.ts with 12 finding codes, integrated into validateFloor()
- ROOM_UNUSABLE hard area<1 or minSide<0.9, ROOM_TOO_NARROW soft <1.0, BAD_PROPORTION soft >3.5, etc.

### 12. Tests

- architectural-qa.test.ts 7 tests: narrow rooms, circulation ratio, DXF layers, hinge geometry, windows exterior, privacy, ranking HARD dominates
- phase6-invariants.test.ts 19 tests: 10 scenarios (12x18 1BR/2BR, 15x20 2BR/3BR, 15x22 2BR 2F, 18x25 3BR 2F, 14x20 2BR 2F, 20x20 2BR, 20x25 3BR 2F, 15x18 1BR) + 1-3 bedrooms ×1-3 floors matrix + invariants area>0 polygon no outside furniture inside openings on walls deterministic DXF structural QA no HARD
- Total 198 tests pass (was 172)

### 13. Build & DXF

- npm run build core tsc OK, web vite 280kB
- DXF R12 ASCII, INSUNITS=4, layers validated

## Verification

```bash
npx vitest run # 198 passed 14 files
npm run build # core tsc, web vite OK
```

- Source integrity preserved: SHA256 ff5b351c..., e27e1d74..., pages 128/84
- 9 VERIFIED preserved, no weakening
- DXF: A-WALL-EXT, A-WALL-CORE, A-WALL-SERVICE, A-WALL-PART, A-DOOR hinge/leaf, A-WINDOW orientation, A-GRID, A-AXIS, A-NORTH, A-TITLE, A-PARKING, A-DIMS, A-ROOM, INSUNITS=4

## Files Changed

- packages/core/src/model/wall.ts: added core/service kinds
- packages/core/src/units.ts: added WALL_CORE_THK, WALL_SERVICE_THK
- packages/core/src/generator/walls.ts: assign core/service/partition
- packages/core/src/model/opening.ts: hinge/leafEnd/openEnd/swingAngle/leafThickness
- packages/core/src/generator/openings.ts: computeDoorLeaf, orientation scoring, width/sill per type
- packages/core/src/dxf/layers.ts: added A-AXIS, A-WALL-CORE, A-WALL-SERVICE, A-WALL-PART
- packages/core/src/dxf/writer.ts: wall layer switch, drawDoor uses hinge, emitGrid, emitRoomDimensions, validateDXFStructure checks 14 layers + INSUNITS
- packages/core/src/validation/types.ts: added 15 new codes
- packages/core/src/validation/architectural-qa.ts: new 170-line QA layer
- packages/core/src/validation/validator.ts: integrate architectural-qa
- packages/core/src/optimizer/metrics.ts: extended metrics, orientation satisfaction, deadEnds, badProp
- packages/core/src/layout/ranking.ts: documented formula, extended softPenalty
- packages/core/src/validation/architectural-qa.test.ts: 7 tests
- packages/core/src/phase6-invariants.test.ts: 19 tests
- docs/ARCHITECTURAL_QA.md, docs/PHASE_6_REPORT.md

## Remaining Gaps

- Glazing ratios DYL-002, light-well DYL-003, vent VENT-001 still NOT_IMPLEMENTED (need window area model)
- Tehran THN-000 NOT_IMPLEMENTED
- Parking/setback municipal REQUIRES

## Conclusion

Phase 6 upgrades wall system to core/service, doors with leaf/hinge/swing, windows with orientation preference, circulation metrics, privacy, parking, furniture, dimensions, grid, DXF layers professional, architectural QA layer, ranking formula documented, regression 10 scenarios + bedroom/floor matrix, invariants, DXF validation, 198 tests pass, build OK, source integrity preserved, no weakening verified thresholds.
