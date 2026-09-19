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
│  │ canonical:         │ │ HARD all │ │  istic)    │ │ INSUNITS=4   │
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
│   ├── dxf/writer.ts — Phase10.1 fixed: for EVERY floor, A-FLOOR-n-A-SITE = actual siteBoundary shifted, A-FLOOR-n-A-SETBACK = actual buildableBoundary shifted, A-FLOOR-n-A-BLDG-OUT = actual buildableBoundary shifted (not bounding rect), generic floor-0 layers backward compat canonical polygon, includeGenericLayers flag, AC1009 R12 INSUNITS=4 deterministic ordering, parseable polylines
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

- Internal meters, DXF mm INSUNITS=4, EPS 1e-6m
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

## Persistence

- Projects serializable JSON, plain data, schema version 6 (Phase11), preserve saved projects, locked state persisted, polygon canonical

## Out of scope for V1

- 3D/BIM/IFC/Revit/DWG/image-to-CAD/topography/terrain/neighbor sim/full solar/structural/MEP/municipality approval automation/unrestricted AI geometry (only orthogonal ≤8 verts deterministic scanline bounded)/invented regs/FAR/coverage legal enforcement without Tier-1
