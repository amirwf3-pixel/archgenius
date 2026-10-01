# ArchGenius — Technical Architecture

## Overview

ArchGenius is an offline-first, deterministic architectural floor-plan generator for the Iranian market. It produces real, editable AutoCAD-compatible DXF files from structured parametric inputs.

Phase 11 — PARAMETRIC PLANNING & CONSTRAINT-AWARE EDITING: Space.polygon canonical authoritative (rect 4, L-shape 6, concave up to 8 verts), parametric constraints (minArea/targetArea/maxArea/minWidth/minLength/preferredAspectRatio/MUST_ADJACENT/PREFER_ADJACENT/MUST_BE_SEPARATED/PREFER_SEPARATED/DIRECT_ACCESS_REQUIRED/PRIVACY_REQUIRED/zone/privacy), core-level locking (position/size/geometry/adjacency/all), bounded editing (move/resize/lock/unlock/setLShape) with deterministic repair (max 4 iter × 4 dirs 0.1m), site-aware buildableBoundary, DXF polygon canonical R12, deterministic offline-first.

Phase 10.1 — SITE-AWARE HARDENING: rectangle, L-shape, orthogonal polygon (V1 3..8 verts, deterministic scanline decomposition up to 6 rects, no silent bbox fallback), canonical buildable geometry (siteBoundary/buildableBoundary/buildableRects canonical, siteBoundingRect/buildableBoundingRect/buildableRect compatibility), complete containment HARD (rooms, corridors, walls, openings, furniture, stairs, parking), DXF per-floor canonical site/buildable layers (A-FLOOR-n-A-SITE/A-SETBACK/A-BLDG-OUT use actual polygons for every floor, not bounding rect), area semantics actual vs bounding (buildingFootprint = actual buildable polygon area, not bounding), deterministic, bounded, offline-first.

```
┌─────────────────────────────────────────────────────────────────┐
│                    @archgenius/web (React UI)                  │
│  Site Shape Selector │ Setbacks │ Parking Layout │ Canvas │ Validation │
└──────────────────────────────┬──────────────────────────────────┘
                               │ typed API, pure function calls
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @archgenius/core                          │
│                                                                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │  Project   ││ Regulation ││   Space    ││   Layout      │ │
│  │  Model     ││   Engine   ││ Programming││  Generator    │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └──────┬────────┘ │
│        │              │              │               │          │
│  ┌─────▼──────────────▼──────────────▼───────────────▼────────┐ │
│  │                  Geometry Engine (2D)                     │ │
│  │  Vec2, Rect, Polygon, polygon-ops (orthogonal, 3..8,     │ │
│  │  duplicate/zero/self-intersect, inset, decomp scanline,  │ │
│  │  pointInPoly, rectInsidePoly, null on failure)          │ │
│  └─────┬──────────────────────────────────────────────────────┘ │
│        │                                                        │
│  ┌─────▼──────────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐
│  │ Site/Buildable     │ │ Validator│ │ Optimizer  │ │ DXF Writer   │
│  │ buildable.ts       │ │ SITE_*   │ │ (determin- │ │ R12 AC1009   │
│  │ canonical:         │ │ HARD all │ │  istic)    │ │ mm coords    │
│  │ siteBoundary,      │ │ rooms,   │ │            │ │ per-floor    │
│  │ buildableBoundary, │ │ corridors│ │            │ │ canonical    │
│  │ buildableRects     │ │ walls,   │ │            │ │ A-SITE/      │
│  │ compatibility:     │ │ openings,│ │            │ │ A-BLDG-OUT/  │
│  │ bounding rects     │ │ furniture│ │            │ │ A-SETBACK    │
│  └────────────────────┘ │ stairs,  │ └────────────┘ └──────┬───────┘
│                         │ parking  │                       │
│  ┌──────────────┐ ┌─────▼──────┐ ┌────────────┐ ┌──────────────┐
│  │ Documentation│ │ PDF (site) │ │ XLSX 11    │ │ Report/Manifest│
│  │ builder.ts   │ │ site ctx   │ │ 11_Site    │ │ actual areas   │
│  │ actual areas │ │ AG-{id}-WB │ │ actual vs  │ │ site metadata  │
│  └──────────────┘ └────────────┘ │ bounding   │ └────────────────┘
│                                  └────────────┘
└───────────────────────────────────────────────────────────────┘
```

## Package layout

```
archgenius/
├── packages/core/src/
│   ├── geometry/polygon-ops.ts — Phase10.1: orthogonal 3..8 verts, duplicate/zero/self-intersect, inset, decomp scanline deterministic up to 6 rects, returns null on failure (no bbox fallback), mergeRectsDeterministic
│   ├── site/buildable.ts — canonical BuildableGeometry: siteBoundary canonical, siteArea actual, siteBoundingRect compatibility, appliedSetbacks source/status, buildableBoundary canonical, buildableArea actual, buildableBoundingRect compatibility, buildableRect legacy bounding compatibility, buildableRects canonical decomposition (Rect[]|null handled as [] on failure with HARD error, no silent bbox as canonical), isValid, validationErrors
│   ├── validation/site.ts — Phase10.1 complete containment: rooms HARD including corridors, walls HARD start+end+mid, openings HARD center+host wall, furniture HARD inside room+buildable, stairs HARD footprint+flights, parking HARD outside site+overlaps building (buildableRects canonical or buildableBoundary if rects empty), codes SITE_ROOM_OUTSIDE_BUILDABLE, SITE_CORRIDOR_OUTSIDE_BUILDABLE, SITE_WALL_OUTSIDE_BUILDABLE, SITE_OPENING_OUTSIDE_BUILDABLE, SITE_OPENING_HOST_WALL_OUTSIDE, SITE_FURNITURE_OUTSIDE_BUILDABLE, SITE_FURNITURE_OUTSIDE_ROOM, SITE_STAIR_OUTSIDE_BUILDABLE, SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE, SITE_PARKING_OUTSIDE_SITE, SITE_PARKING_OVERLAPS_BUILDING
│   ├── generator/generator.ts — site geometry → buildable → site-aware placement: buildableRects canonical, buildableRect compatibility, handle empty rects as explicit decomposition failure with SITE_GEOM_INVALID HARD, placeSpacesAcrossRects sorts by area desc then y, repairSpacesToBuildable findPositionForRect step 0.5m rectInsidePolygon, snapCorridorsToRoomsSiteAware
│   ├── generator/parking.ts — placeParkingSiteAware: siteBoundary canonical, buildableBoundary canonical, buildableRects canonical, geometric fit perpendicular/parallel deterministic attempts[]
│   ├── dxf/layers.ts — A-SITE color3 DASHED, A-SETBACK color2 DASHED, A-BLDG-OUT color1
│   ├── dxf/writer.ts — Phase10.1 fixed: for EVERY floor, A-FLOOR-n-A-SITE = actual siteBoundary shifted, A-FLOOR-n-A-SETBACK = actual buildableBoundary shifted, A-FLOOR-n-A-BLDG-OUT = actual buildableBoundary shifted (not bounding rect), generic floor-0 layers backward compat canonical polygon, includeGenericLayers flag, AC1009 R12 (mm coordinates; R12 has no INSUNITS) deterministic ordering, parseable polylines
│   ├── documentation/builder.ts — Phase10.1 area semantics: siteArea actual siteAreaValue, buildableArea actual buildableAreaValue, buildingFootprint actual buildableBoundary polygon area (not bounding), grossFloorArea sum actual per floor, floorMeta area actual via buildableBoundary shoelace, residual uses actual, reconciliation actual
│   ├── documentation/model.ts — schema v5, SOFTWARE_VERSION 0.10.0-phase10 (still phase10 version, but docs say 10.1 hardening), SiteMetadata actual areas, FloorMetadata area actual
│   └── phase101.test.ts — 28 tests Phase10.1 hardening
```

## Pipeline (Phase 10.1)

```
ProjectInput (site: shape rectangle|l-shape|polygon, width, length, lShape {width,length,notchWidth,notchLength,notchCorner ne/nw/se/sw}, polygon {vertices 3..8}, setbacks N/S/E/W user-defined, jurisdiction, city, parkingLayout auto/perpendicular/parallel, accessSide)
  → validateInput() // shape, width>2 length>2, polygon 3..8 verts finite no duplicate consecutive no zero-length area>=10 no self-intersect orthogonal, l-shape, accessSide, parkingLayout, floors 1..10 integer
  → computeBuildableGeometry(site) // canonical: siteBoundary CCW actual area, siteArea actual, siteBoundingRect compatibility, appliedSetbacks source/status, buildableBoundary via insetOrthogonalPolygon, buildableArea actual polygon area, buildableBoundingRect compatibility, buildableRect legacy bounding compatibility, buildableRects via decomposeOrthogonalPolygonToRects (returns Rect[]|null, null = bounded failure no bbox fallback as canonical, [] signals failure with HARD error), isValid, validationErrors
  → regulation packs + buildableArea legacy
  → generateSpaceProgram()
  → generateCandidates bounded ≤12
        → for each strategy:
          → parking placeParkingSiteAware canonical siteBoundary/buildableBoundary/buildableRects
          → site-aware placement:
            if buildableRects.length==0: explicit decomposition failure logged, fallback to bounding rect for placement attempt but SITE_GEOM_INVALID HARD already, validation will flag outside
            else if rectangle or 1 rect: placeSpaces(buildableRect) — rectangle canonical == bounding
            else: placeSpacesAcrossRects(buildableRects canonical, buildableBoundary canonical) — sorts by area desc then y, assigns zones
          → repairSpacesToBuildable findPositionForRect step0.5m rectInsidePolygon canonical
          → snapCorridorsToRoomsSiteAware
          → entrance fallback rectInsidePolygon
          → stair repair + solveStair + footprint inside buildable check
          → walls, furniture, openings
          → candidate with siteBoundary/buildableBoundary/buildableRects/siteShape attached as any
          → runPackRulesOnCandidate + validateLayout includes validateSite complete containment HARD
  → score + intelligence per-floor + vertical + stacking + inter-floor + whole-building
  → return LayoutCandidate[] bounded ≤12 no 4^floors

User selects candidate
  → buildDocumentation actual areas: siteArea actual, buildableArea actual, buildingFootprint actual (not bounding), grossFloorArea sum actual, floorMeta area actual
  → DXF writer per-floor canonical: every floor A-FLOOR-n-A-SITE actual siteBoundary, A-FLOOR-n-A-SETBACK actual buildableBoundary, A-FLOOR-n-A-BLDG-OUT actual buildableBoundary (not bounding), generic floor-0 compat canonical polygon
  → PDF site/context AG-{id}-WB
  → XLSX 11 sheets including 11_Site actual vs bounding
  → Report/Manifest site metadata actual areas
```

## Geometric conventions

- Internal meters, DXF millimetre coordinates (R12 has no INSUNITS header variable), EPS 1e-6m
- Polygon-ops Phase10.1:
  - polygonSignedArea, polygonArea, polygonOrientation, polygonBoundingRect, hasDuplicateConsecutiveVertices, hasZeroLengthEdges, segIntersect, hasSelfIntersection, isOrthogonal, pointOnSegment, pointOnPolygonBoundary, pointInPolygon, rectInsidePolygon (corners+center+edge midpoints), insetOrthogonalPolygon (outward direction north/south/east/west, shift inward, reconstruct vertices, validates duplicate/zero/self-intersection/containment), decomposeOrthogonalPolygonToRects: returns Rect[]|null, 4 verts → 1 rect bounding, 6 verts L-shape via concave vertex + missing corner → 2 rects area sum = polygon area, 8-vert via vertical scanline: xs unique sorted, slabs, midX, collect y intersections of horizontal edges crossing midX, sort y dedup, check even count else null, pair intervals inside via pointInPolygon mid, create rects, validate rectInsidePolygon + area sum ≈ polygon area else null, mergeRectsDeterministic horizontal then vertical, sort by area desc then y then x deterministic, bounded xs≤8 slabs≤7 intervals≤4 rects≤12 no explosion, null on failure not bounding rect
  - createLShapePolygon W/L/nW/nL/corner ne/nw/se/sw or long forms, origin, CCW
  - validateSitePolygon checks <3, >8, duplicate, zero-length, area<10, self-intersect, non-orthogonal
- Canonical vs compatibility: siteBoundary/buildableBoundary/buildableRects canonical for placement/validation/outputs; siteBoundingRect/buildableBoundingRect/buildableRect compatibility/bounding helpers only (presentation, legacy footprint, floor.footprint remains bounding for backward compat but area field is actual canonical)

## Layer convention (DXF) Phase10.1

| Layer | Purpose | Color | Linetype | Canonical per floor? |
|-------|---------|-------|----------|----------------------|
| A-SITE | Site boundary polygon canonical | 3 green | DASHED | Yes: A-FLOOR-n-A-SITE = actual siteBoundary for EVERY floor |
| A-BLDG-OUT | Buildable boundary canonical (setback-applied) | 1 red | CONTINUOUS | Yes: A-FLOOR-n-A-BLDG-OUT = actual buildableBoundary for EVERY floor, NOT bounding rect for L-shape/polygon |
| A-SETBACK | Setback lines (buildable boundary duplicated) | 2 yellow | DASHED | Yes: A-FLOOR-n-A-SETBACK = actual buildableBoundary for EVERY floor |
| A-WALL-EXT | Exterior walls | 7 white | CONTINUOUS | Yes per floor |
| A-DOOR/A-WINDOW | Openings | 3/4 | CONTINUOUS | Yes per floor |
| A-STAIR | Stairs | 6 magenta | CONTINUOUS | Yes per floor |

Plus generic base layers for floor 0 only backward compat (still canonical polygon, controlled by includeGenericLayers).

## Site/Buildable Data Model (Phase10.1)

- SiteInput: shape rectangle|l-shape|polygon, width, length, northRotationDeg, accessSide, streetWidth, area?, setbackNorth/South/East/West user-defined, jurisdiction, city, zoning, lShape, polygon, parkingLayout
- BuildableGeometry: siteBoundary Polygon CCW canonical actual area, siteArea actual, siteBoundingRect Rect compatibility/bounding, appliedSetbacks AppliedSetback[] {direction, value, source user-defined|default-assumption|verified, status VERIFIED|REQUIRES_SOURCE_VERIFICATION|USER_DEFINED|DEFAULT, reference}, buildableBoundary Polygon CCW canonical actual area, buildableArea actual, buildableBoundingRect Rect compatibility/bounding, buildableRect Rect legacy bounding compatibility, buildableRects Rect[] canonical decomposition (or [] on failure, null from decompose), isValid (errors==0 && buildableArea>=5 && buildableRects.length>0 or rectangle), validationErrors, source
- Validation: validateSite(candidate) → Finding[] complete containment HARD: SITE_ROOM_OUTSIDE_BUILDABLE, SITE_CORRIDOR_OUTSIDE_BUILDABLE, SITE_WALL_OUTSIDE_BUILDABLE (start+end+mid), SITE_OPENING_OUTSIDE_BUILDABLE, SITE_OPENING_HOST_WALL_OUTSIDE, SITE_FURNITURE_OUTSIDE_BUILDABLE, SITE_FURNITURE_OUTSIDE_ROOM, SITE_STAIR_OUTSIDE_BUILDABLE, SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE, SITE_PARKING_OUTSIDE_SITE, SITE_PARKING_OVERLAPS_BUILDING — geometric integrity not legal

## Area Semantics (Phase10.1)

- siteArea = actual site polygon area (siteAreaValue) — canonical
- buildableArea = actual buildable polygon area (buildableAreaValue) — canonical
- buildingFootprint = actual canonical building footprint area = buildableBoundary polygon area (actual), NOT bounding rect area for L-shape/polygon — canonical
- grossFloorArea = sum actual per floor = buildingFootprint * floors (same site for all floors) — canonical
- floorMeta footprint x,y,w,h = bounding rect compatibility, area = actual canonical area — legacy x,y,w,h preserved as compatibility but area is canonical actual
- For rectangle: actual == bounding (verified)
- For L-shape/polygon: actual != bounding where applicable (actual < bounding, verified)
- Cross-output consistency: doc=report=manifest=DXF/PDF/XLSX agree on actual areas

## Determinism & reproducibility

- No Math.random in generator when deterministic true, mulberry32 PRNG for tie-breaking
- Sort orders explicit, CCW normalization deterministic, scanline decomposition deterministic sorted xs, y, area desc
- DXF byte-stable for same input+seed (geometry deterministic, metadata timestamps may vary but not geometry)
- Candidate generation bounded floors≤10 verts≤8 candidates≤12 no 4^floors, polygon ops O(n^2) n≤8, repair loops bounded step0.5m, no uncontrolled retry

## Testing

- 402 tests: 328 Phase1-9 + 46 Phase10 + 28 Phase10.1
- Phase10.1: DXF per-floor canonical parsed polylines, 8-vertex C-shape 3 rects, staircase, containment every room, differs from bounding, deterministic repeat, invalid cases, decomposition failure null not bbox, complete containment HARD for rooms/corridors/walls/openings/furniture/stairs/parking, area semantics actual vs bounding, cross-output consistency, determinism, performance bounded
- No reduction in validation strictness, Phase9 scoring weights unchanged, no accidental floors[0] regression (ground-floor-specific metrics documented as ground-floor-specific, not whole-building)

## Phase 11 — Parametric & Editing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    @archgenius/web (React UI)                  │
│  Floor/Room Selector │ Move/Resize/L-Shape │ Lock/Unlock │ Canvas│
│  Validation HARD/SOFT/ADVISORY │ Constraint/Lock State           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Editing.moveRoom etc (thin)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @archgenius/core                          │
│  Editing: moveRoom/resizeRoom/lockRoom/unlockRoom/setLShape     │
│  cloneCandidate JSON deterministic, isLocked, boundedRepair     │
│  tryNudge 4 dirs ×0.1m max 4 iter, regenerateFloor walls from   │
│  polygon canonical, furniture, openings, validateLayout HARD    │
│                                                                 │
│  Geometry: Space.polygon canonical, rect derived bounding,      │
│  room-polygon: rect 4, L-shape 6, concave up to 8, area from    │
│  polygon, containment, overlap (positive-area), sharedWall      │
│  insideBuildable, translate, centroid                           │
│                                                                 │
│  Constraints: minArea/targetArea/maxArea/minWidth/minLength/    │
│  preferredAspectRatio/MUST_ADJACENT/PREFER_ADJACENT/            │
│  MUST_BE_SEPARATED/PREFER_SEPARATED/DIRECT_ACCESS_REQUIRED/     │
│  PRIVACY_REQUIRED/zone/privacy — hard vs heuristic separate     │
│                                                                 │
│  Locking: Space.locked {position,size,geometry,adjacency}       │
│  survives repair, impossible edit → explicit failure            │
└───────────────────────────────────────────────────────────────┘
```

- `packages/core/src/editing/room-editing.ts` — move/resize/lock/unlock/setLShape, boundedRepair, regenerateFloor, inferLNotch
- `packages/core/src/geometry/room-polygon.ts` — canonical polygon, thresholds 0.9/1.0, overlap fixed positive-area, insideBuildable checks vertices+centroid+midpoints
- `packages/core/src/model/space.ts` — locked, shapeType, constraints, minWidth/minLength/preferredAspectRatio
- `packages/core/src/model/room-constraints.ts` — parametric constraints, RoomLock, validateRoomSizeConstraints
- `documentation/builder.ts` — revision version 1.0.0, qaConfig v1, software 1.0.0, schema 6
- `phase11.test.ts` — 47 tests A-J + canonical invariants

### Pipeline Phase 11

```
ProjectInput (same as Phase10.1)
  → computeBuildableGeometry canonical
  → generateSpaceProgram with constraints (minArea etc stored per Space)
  → generateCandidates bounded ≤12 (rect-only placer, L-shape via editing later)
  → User selects candidate
  → Editing operations (core):
    moveRoom: translate polygon, validate, site containment, locked overlap, boundedRepair, regenerate walls/openings/furniture, validate HARD SITE_
    resizeRoom: anchor, new polygon (preserve L notch), validate constraints, containment, locked overlap, repair, regenerate, validate
    setLShape: create L-shape from bounding + notch, validate constraints, containment, locked overlap, repair, regenerate
    lock/unlock: set flags, re-validate, recompute metrics
  → DXF writer emits Space.polygon polylines on A-FLOOR-n-A-ROOM + generic A-ROOM, area from polygon
  → PDF/XLSX/report/manifest same canonical candidate, checksum deterministic
```

## Phase 5.2 — Programme door completion (opt-in)

- **Option:** `GenerateOptions.programmeDoorCompletion` (also `generateLayouts(input, strategies, { programmeDoorCompletion })`). **Default `false`.** Omitted or `false` makes the exact legacy `placeOpenings(floor, accessSide)` call: result JSON and DXF are byte-identical to the pre-5.2 output.
- **Source of truth:** `programmeDoorRequirements(specs)` (`generator/openings.ts`) reads only the existing programme specs — `spec.adjacencies` entries with `adjacent: true` and `doorRequired: true`; same-type entries dropped. No new adjacency rules or weights.
- **Stage 3b** (`placeOpenings`, after stage 3, before windows, so furniture still sees every door): for each requirement and each source room, when no door joins it to any room of the target type, add at most ONE direct door on the longest existing shared wall with a free span, using the existing `pairWalls` / `bestFreeWall` / `placeDoorOnWall` helpers. Existing doors are never moved or removed.
- **Guards:** already-satisfied pairs skipped; same-type pairs and parking / yard / balcony / elevator-hall skipped; `shaftPairOk` and `privacyTransitionAllowed` must pass; wall too short / occupied → skipped; the two rooms must already be in the same door-graph component (through-room guard — a 3b door never changes reachability, so it cannot create a through-room or suppress the Phase 25 connectivity repair); a new door whose swing is crossed by a wall, overlaps another door's swing, or collides on its wall is rolled back completely (openings, wall occupancy and id counter restored).
- **Deterministic:** requirements sorted by (source, target), rooms by id, ties broken by wall length then pair key. No randomness.
- **Why still opt-in:** enabling it changes the geometry/DXF golden hashes (`elevator-shaft.test.ts`, Phase 5.1c pinned digests), which have not been re-pinned; extra doors change furniture placement and therefore door/furniture ranking tiers; a master bathroom may carry two doors (corridor + bedroom), an unresolved privacy trade-off.
- **Measured** (128 candidates: 4 sites × 4 programmes × 2 seeds × 4 strategies, Quality V1 adjacency `door`): door-required satisfaction **696 → 924 / 1018 (68.4% → 90.8%)** — 120 dining→kitchen, 108 master-bedroom→master-bathroom; no instance worse, no new HARD / CIRC / DOOR / FURN / PRIVACY findings, room geometry unchanged.
- **Remaining 94 unmet:** 80 have no shared wall (placement — out of scope for 3b: corridor→stair-hall 24, foyer→guest-wc 24, master-bedroom→master-bathroom 8, bedroom→corridor 6, master-bedroom→corridor 6, foyer→living 6, dining→kitchen 6); 6 foyer→living shared wall < 1.5 m; 6 master-bedroom→master-bathroom blocked by the through-room guard (master bedroom not yet connected); 2 dining→kitchen rolled back for swing clash.
- **Tests:** `generator/programme-doors.test.ts` (21).

## Phase 5 bounded geometry-fix cycle — quality status (closed)

Status record at commit `86b5121`. This cycle is **closed**: the bounded investigation found no further production geometry change that is justified, so none is proposed.

- **Benchmark:** 128 candidates (4 sites `rect` / `rectE` / `rect14` / `lshape` × 4 programmes `b1` / `b2` / `b3lift` / `b4` × seeds 42, 7 × 4 strategies), generated with all current Phase 5 opt-in options plus `stairConnectorHardReduction: true`. Result: **110 valid / 70 HARD findings**. With `stairConnectorHardReduction` off, the result is 110 valid / 74 HARD.
- **Determinism:** two consecutive full benchmark runs produce byte-identical candidate JSON (with `generatedAt` zeroed).
- **All Phase 5 geometry options stay opt-in:** default `false`, checked with `=== true`. With the options omitted or `false`, output is byte-identical to the legacy output.

### Fixed (committed, guarded, opt-in)

These are the guarded geometry fixes up to `fbce409`, then `380d8a3` and `86b5121`, each covered by focused tests:

- programme adjacency (rectangular and L-shape);
- daylight-aware entry gallery;
- stair-core connector;
- daylight public-room stacking;
- thin stair-gap bridge;
- isolated-room access connectors;
- dining façade arrangement;
- shallow stair-pocket rotation;
- main-room minimum dimension;
- dining entry column;
- upper-floor private programme split;
- elevator landing-gap bridge;
- L-shape wing corridor link;
- L-shape entry-foyer alignment;
- stacked-pair minimum area;
- shaft/corridor notch;
- L-shape upper-core circulation;
- L-shape room-quality selection;
- the `stairConnectorHardReduction` adoption path (Task 135; 74 → 70 HARD).

### Remaining HARD findings — investigated, intentionally unresolved

Every one of the 70 remaining HARD findings belongs to one of six root-cause groups, and each group was investigated in Tasks 130–141. Seeds 42 and 7 produce identical findings within each group. No uninvestigated HARD subgroup remains (Task 142 audit).

| # | Candidates | HARD findings | Count | Root cause | Investigation |
|---|---|---|---|---|---|
| 1 | `lshape/b3lift`: daylight-orientation, alternative-zoning, area-efficiency (6) | `ELEV_SHAFT_MISSING` ×3 each | 18 | The elevator shaft cannot be kept on every floor of the L-shape plan without coordinated multi-floor core planning | Task 131 |
| 2 | `lshape/{b2,b3lift,b4}` area-efficiency (6) | `MBH4-DYL-001` on dining and kitchen | 12 | The L0 day-wing dining and kitchen are enclosed by the entry band, corridor and living; no genuine façade edge is available | Task 130 |
| 3 | `lshape/b4` alternative-zoning (2) | `CIRC_INACCESSIBLE_SPACE` ×8, `CONSTRAINT_MUST_ADJACENT` ×1, `MBH4-DYL-001` ×1 (L0 kitchen) | 20 | L1: the stair is re-pinned without a door and three corridors stay disjoint. L0: the kitchen column sits in a pocket whose façade edges are taken by the entry band, the rear corridor and the spur corridor | Tasks 129, 137, 140 |
| 4 | `rectE/b4` daylight-orientation (2) | `CONSTRAINT_DIRECT_ACCESS` ×3, `CIRC_ROOM_THROUGH_ROOM` ×2, `MBH4-DYL-001` ×1 (L1 bedroom) | 12 | Phase13 private-band fallback: the paired bedroom sits in the middle row, between the façade-end bathroom and the stair hall, and is reached through the stair hall | Tasks 132, 134, 141 |
| 5 | `rect14/b3lift` alternative-zoning (2) | `ROOM_CONSTRAINT_MIN_AREA` ×2, `MBH4-ROOM-001` ×1 | 6 | On the narrow 14 m site, the L1 master bedroom is 2.90 × 3.40 m (9.86 m²), below its 12 m² minArea, so no habitable room on L1 reaches 12 m² / 2.7 m | Tasks 129–133 |
| 6 | `lshape/b4` functional-circulation (2) | `MBH4-DYL-001` ×1 (L0 kitchen) | 2 | The P16-C depth cap and corridor-side anchoring leave the service-band slack void at the street façade | Task 139 |
| | **18 invalid candidates** | | **70** | | |

Rejected prototypes (not adopted) include:

- façade-anchoring the capped kitchen, which only counted as exterior through a void wall;
- swapping the order of the stacked bedroom/bathroom pair, which raised HARD from 6 to 7 and added through-room chains;
- a stricter adoption guard for the 5.6G variant, which did remove HARD findings but added soft findings.

### Known architectural limitations (future larger planning redesign)

Groups 1, 3 and 4 need coordinated multi-floor core and corridor planning, or a redesign of the Phase13 private-band fallback. Groups 2, 3 (L0), 4 and 6 need façade-aware tiling of enclosed pockets. These are outside a bounded, generic fix. They would require moving unrelated rooms and changing the frozen stair and corridor algorithms.

### What is not done

- Remaining blockers are **not** suppressed, downgraded or filtered.
- Validation rules, severities, thresholds and tolerances are unchanged.
- No existing guard was relaxed.
- No void wall or interior wall is counted as a daylight/exterior edge by any fix.
- No compliance claim is made for the invalid candidates.
- **DXF:** the frozen DXF R12 ASCII profile (header `$ACADVER = AC1009` only, existing layer/entity architecture) is unchanged. No DXF writer, header or layer change was made in this cycle. Real AutoCAD compatibility is not claimed without testing in AutoCAD.

## Persistence

- Projects serializable JSON, plain data, schema version 6 (Phase11), preserve saved projects, locked state persisted, polygon canonical

## Out of scope for V1

- 3D/BIM/IFC/Revit/DWG/image-to-CAD/topography/terrain/neighbor sim/full solar/structural/MEP/municipality approval automation/unrestricted AI geometry (only orthogonal ≤8 verts deterministic scanline bounded)/invented regs/FAR/coverage legal enforcement without Tier-1
