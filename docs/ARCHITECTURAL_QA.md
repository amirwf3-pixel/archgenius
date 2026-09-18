# Phase 6 — Architectural QA & Professional CAD Quality

**Date:** 2026-09-18
**Branch:** arena/01a0b33a-archgenius
**Baseline:** 172 tests (Phase 5.2) → 198 tests (Phase 6) all pass

## Objective

Implement professional architectural layout & CAD quality engine on top of Phase 5.2 verified regulations (9 VERIFIED rules, SHA256 ff5b351c..., e27e1d74..., 128/84 pages, DXF R12 mm INSUNITS=4). Improve room geometry, wall system, doors/windows, circulation, privacy, parking, furniture, dimensions, annotations, DXF layers, candidate ranking, architectural QA, regression, invariants, UI, explainability.

## Wall System (Professional)

### Kinds

- `exterior` — one side null, thickness 0.35m, layer A-WALL-EXT
- `interior` — between two non-service rooms, 0.15m, A-WALL-INT
- `core` — stair-hall / elevator-hall, 0.20m, A-WALL-CORE (fire rated)
- `service` — service/wet vs non-service, 0.12m, A-WALL-SERVICE
- `partition` — between two service rooms, 0.10m, A-WALL-PART
- `retaining` — future

Generator `generateWalls()` merges colinear candidates via sweep-line, tracks spaceIds per side, assigns kind by space types, thickness per kind.

DXF: two parallel lines per wall span (left/right edges offset by thickness/2), end caps at span ends and around openings.

## Doors

### Model

`Opening` extended with `hinge`, `leafEnd`, `openEnd`, `swingAngle=90`, `leafThickness=0.04`.

Compute via `computeDoorLeaf(center, wallDir, normal, width, swing)`:

- hinge = center + wallDir * width/2 * hingeSign (left=-1, right=+1)
- leafEnd = center - wallDir * width/2 * hingeSign
- openEnd = hinge + normal * width

Deterministic swing: left/right alternates by wall.id hash.

### Placement

- Entrance: exterior wall on accessSide where interior is circulation, margin 0.1m, middle prefer.
- Interior: every interior wall where one side is circulation (corridor/foyer/entrance/stair-hall/elevator-hall) gets a door into non-circulation side. Bath doors 0.80m, others 0.90m. Small walls use minimal margin.
- Ensuite: master-bathroom ↔ master-bedroom if shares wall and no opening yet.
- Guest-WC off entrance/foyer, bedroom suite, storage off kitchen, kitchen-dining pass, second bathroom off bedroom.

Occupied tracking prevents collisions on same wall.

### DXF

`drawDoor()` uses hinge/leafEnd/openEnd if present, draws leaf line, 90° swing arc (CCW normalized), optional thickness line at openEnd. Layer A-DOOR.

Validation: `OPENING_DOOR_SWING_BLOCKED` soft if arc near other wall, `DOOR_COLLISION` if two doors on same wall < (w1+w2)/2+0.1.

## Windows

### Orientation Preference

Scoring per room type:

- living: south 10, east/west 6, north 2
- master-bedroom: south 10, east 8, west 5, north 1
- bedroom: east 9, west 7, south 6, north 2
- kitchen: east 9, north 7, south 4, west 3
- dining: south 8, east/west 6

Sort exterior walls by orientationScore + length.

### Width & Sill

- living 0.65 ratio max 3.0m, master-bedroom 0.6 max 2.4, bedroom 0.5 max 2.0, kitchen 0.45 max 1.8, bath 0.35 max 1.0, others 0.55 max 2.4, min 0.60m.
- Sill: bath 1.2m, kitchen 1.0m, others 0.9m, lintel 2.4m.

Placement via free span middle, margin 0.5m, marks `hasExteriorWall=true`.

DXF: four parallel lines across opening width offset by 0.04m depth, layer A-WINDOW.

Validation: `WINDOW_OUTSIDE` hard if not exterior, `WINDOW_COLLISION` soft if overlaps door.

## Circulation

### Metrics

- `usableAreaRatio` = usable / footprint
- `circulationRatio` = circ / footprint (corridor+stair+entrance+foyer+elevator)
- `totalCirculationArea` = circ m²
- `longestCirculationPath` ≈ circ spaces + total spaces (approx graph diameter)
- `deadEndCount` = count of CIRCULATION_DEAD_END findings
- `wastedArea` = footprint - assigned
- `avgRoomProportion` = avg max/min per room
- `badProportionCount` = ratio >3.5

### Validation

- `CIRC_INACCESSIBLE_SPACE` hard if not reachable from entrance/foyer/corridor BFS via doors.
- `CIRC_DISCONNECTED` hard if no circulation seed.
- `CIRC_CORRIDOR_TOO_NARROW` hard if corridor min side <1.10m.
- `CIRCULATION_DEAD_END` soft if corridor has ≤1 door.
- `CIRCULATION_EXCESSIVE` soft if ratio >35%.
- `EXCESSIVE_RESIDUAL` soft if residual >15% footprint.

Longest path heuristic: corridor spine length vs footprint, flagged via ratio.

## Privacy

- `privacySatisfaction` = 1 - violations/10, violations when private room adjacent to entrance/foyer.
- `PRIVACY_WEAK` soft when bedroom/bath directly opens to entrance/foyer via door.
- `SERVICE_EXPOSURE` soft when bathroom/WC opens directly to living/dining.

Public zone: living/dining/guest-wc/guest-room/yard/balcony = public, kitchen/family = semi-private, bedroom/master/bath = private, storage/utility/parking = service.

## Kitchen/Dining/Living

- Placer zones: public (south band), private (north band), circulation spine horizontal/vertical/L.
- Kitchen adjacent to dining via door if no circulation door, storage off kitchen, dining near living via adjacency constraints.
- Window orientation prefers east for kitchen (morning light), south for living.

## Parking

- `placeParking()` along access side, perpendicular stalls 2.5×5.0m, aisle 3.5m min.
- `PARKING_ACCESS_BLOCKED` soft if stalls exist but no aisle.
- `PARK_BLOCKED_ACCESS`, `PARK_INFEASIBLE_STALL`, `PARK_AISLE_TOO_NARROW` from parking validation.

## Furniture

- Minimal footprints for clearance QA: bed-double 1.6×2.0, bed-king 1.8×2.0, wardrobe 1.8×0.6, sofa 2.2×0.9, dining-table 1.2×0.8, kitchen-counter-L 2.6×1.8, toilet 0.5×0.7, sink 0.6×0.5, shower 0.9×0.9.
- Placement corners/walls/center, clamped inside room, no overlap same room.
- Validation: `FURN_OUTSIDE_ROOM`, `FURN_COLLISION`, `FURNITURE_BLOCKS_DOOR` (distance <0.8m from door center).

## Dimensions & Annotations

- Outer dimensions: south and west offset 1.0m, ticks, text `${w} m`, layer A-DIMS.
- Room dimensions: per room if w>=2 and h>=2, bottom and left edges offset 0.15m, text width/height 0.12m, A-DIMS.
- Grid: vertical lines at x, cx, x+w, horizontal at y, cy, y+h, layers A-GRID (center linetype) and A-AXIS, labels A/B/C and 1/2, A-AXIS-TEXT.
- Room labels: center, label + area `${area.toFixed(1)} m²`, A-ROOM.
- North arrow: line + arrowhead + circle stub, N label, A-NORTH.
- Title block: border around drawing + bottom-right 10×2m block, project name, strategy/floors/scale, A-TITLE.
- Parking labels: P index, AISLE, A-PARKING.

## DXF Layers (Professional)

- A-GRID, A-AXIS, A-AXIS-TEXT
- A-WALL-EXT (7, 50, CONTINUOUS), A-WALL-INT (7,30), A-WALL-CORE (7,40), A-WALL-SERVICE (7,25), A-WALL-PART (7,18)
- A-COLUMN
- A-DOOR (3,25), A-WINDOW (4,25)
- A-STAIR (6,25), A-STAIR-TREAD (8,18), A-STAIR-DIR (6,25)
- A-PARKING (8,25), A-SANITARY (3,18), A-FURN (8,18)
- A-ROOM (7,18), A-HATCH (8,13), A-DIMS (2,18), A-TEXT (7,18), A-NORTH (7,25), A-TITLE (7,35), A-BLDG-OUT (9,13,DASHED), 0 default

All required layers validated in `validateDXFStructure()` plus INSUNITS=4 check.

## Candidate Generation & Ranking

Strategies preserved: area-efficiency, functional-circulation, daylight-orientation, alternative-zoning. Each generates one candidate, sorted best-first.

Ranking vector (deterministic, HARD dominates):

1. hardCount = severity hard total
2. geoSoft = GEO_/OPENING_/ROOM_TOO_NARROW/ROOM_BAD_PROPORTION soft
3. hardAdj = ARCH_ADJACENCY_VIOLATION hard
4. circulationFailures = CIRC_* + CIRCULATION_DEAD_END + CIRCULATION_EXCESSIVE + EXCESSIVE_RESIDUAL soft
5. roomAreaDeviation
6. wastedArea + circulationRatio + badProportion
7. softPreferencePenalty = (1-adj)*10 + (1-daylight)*5 + (1-orient)*3 + (1-privacy)*4 + badProp*0.5 + deadEnds*1 + serviceExposure*2 + privacyWeak*1.5 + doorColl*1 + windowColl*1

Formula documented in `ranking.ts`, tie-breaker by id.

## Architectural QA Layer

Findings (soft unless unusable):

- ROOM_UNUSABLE hard if area <1.0 or minSide <0.90
- ROOM_TOO_NARROW soft if minSide <1.0 and not guest-wc/storage/utility
- ROOM_BAD_PROPORTION soft if ratio >3.5 and not corridor
- CIRC_CORRIDOR_TOO_NARROW hard if <1.10
- CIRCULATION_DEAD_END soft if corridor ≤1 door
- CIRCULATION_EXCESSIVE soft if ratio >35%
- DOOR_COLLISION, WINDOW_COLLISION, WINDOW_OUTSIDE hard, PARKING_ACCESS_BLOCKED, FURNITURE_BLOCKS_DOOR, SERVICE_EXPOSURE, PRIVACY_WEAK, EXCESSIVE_RESIDUAL

Implemented in `validation/architectural-qa.ts`, integrated into `validateFloor()`.

## Regression & Invariants

10 scenarios: 12x18 1BR/2BR, 15x20 2BR/3BR, 15x22 2BR 2F, 18x25 3BR 2F, 14x20 2BR 2F, 20x20 2BR, 20x25 3BR 2F, 15x18 1BR.

1-3 bedrooms × 1-3 floors matrix.

Invariants:

- area>0, w>0, h>0
- polygon 4 points, area>0
- no outside buildable (rContains with 0.05 tol)
- furniture inside its room (rContains 0.01)
- openings on walls (wall exists)
- deterministic same input+seed → same rects within 1e-6
- DXF structure ok, INSUNITS=4, layers present
- architectural QA no HARD for normal cases

Tests: `phase6-invariants.test.ts` 19, `architectural-qa.test.ts` 7, total 198.

## UI & Explainability

Minimal UI changes, explainability via `explanations[]` deterministic reasons: constraint graph count, parking fit, entrance placed, stair explanation, furniture count, strategy, seed, regulation packs.

## No Weakening

9 VERIFIED rules preserved with same thresholds, pages, digests. No new regulation families unless defect (none added). No DWG/image-to-CAD/MEP/rendering/3D.

## Build & DXF Validation

- npm test 198 passed
- npm run build core tsc OK, web vite 280kB gzip 89kB
- DXF R12 ASCII, INSUNITS=4, layers validated
