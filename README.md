# ArchGenius — AI Architectural Planning & Professional CAD System

**Phase 10.1 — SITE-AWARE HARDENING** — rectangle, L-shape, orthogonal polygon (V1 3..8 verts, deterministic decomposition), canonical buildable geometry, site-aware placement, complete containment HARD, DXF per-floor canonical site/buildable layers, area semantics actual vs bounding, deterministic, offline-first, R12 DXF A-SITE/A-BLDG-OUT/A-SETBACK.

## Site Geometry First-Class — Not BBox Fallback (Phase 10.1 Hardened)

### Supported shapes (genuinely supported)
- `rectangle` — width x length, CCW 4 verts, area = W*L, decomposition 1 rect (canonical = bounding, actual == bounding)
- `l-shape` — overall W/L minus rectangular notch from corner (ne/nw/se/sw or north-east etc), deterministic 6-vert polygon, area = W*L - notchW*notchL, decomposition into 2 rects via concave vertex + missing corner (canonical, area sum = polygon area, not bounding), genuinely supported
- `polygon` — simple orthogonal polygon, 3..8 verts V1, finite, no duplicate consecutive, no zero-length, no self-intersection, deterministic CCW ordering, EPS 1e-6m, decomposition via vertical scanline into up to 6 rects (deterministic, bounded, area sum = polygon area, no silent bbox fallback), affects placement. 8-vertex orthogonal polygons fully decomposed when orthogonal simple; if decomposition fails safely, returns null (no bbox as canonical) and validation marks SITE_GEOM_INVALID HARD.

### Validation (finite, min valid verts, no duplicate consecutive, no zero-length, no self-intersection, deterministic ordering, max 8 verts V1, EPS handling)
- `validateSitePolygon(poly, maxVerts=8, minArea=10)` → {valid, isValid, errors, area}
- Checks: <3 verts, >8 verts, duplicate consecutive (dist <=1e-6), zero-length edges (dist <=1e-6), area <10m², self-intersection (segment intersection excluding shared endpoints), non-orthogonal (V1 axis-aligned only)
- Buildable geometry: `computeBuildableGeometry(siteInput)` → {siteBoundary CCW canonical, siteArea actual polygon area, siteBoundingRect compatibility/bounding, appliedSetbacks [{direction,value,source,status,reference}], buildableBoundary canonical polygon (inset), buildableArea actual polygon area, buildableBoundingRect compatibility/bounding, buildableRect legacy bounding compatibility, buildableRects canonical decomposition (rectangle 1, L-shape 2, 8-vert up to 6, null on failure), isValid, validationErrors, source}
- Canonical vs compatibility: siteBoundary/buildableBoundary/buildableRects are canonical for placement/validation/outputs; siteBoundingRect/buildableBoundingRect/buildableRect are compatibility/bounding helpers only (presentation, legacy footprint), NOT canonical for L-shape/polygon placement.

### Site-boundary validation findings (complete containment Phase 10.1)
- Codes: `SITE_INVALID_POLYGON`, `SITE_ZERO_AREA` (<10m²), `SITE_INSUFFICIENT_BUILDABLE` (<5m² or consumed), `SITE_ROOM_OUTSIDE_BUILDABLE`, `SITE_CORRIDOR_OUTSIDE_BUILDABLE` (now HARD, not skipped), `SITE_WALL_OUTSIDE_BUILDABLE` (now HARD, checks start+end+mid), `SITE_OPENING_OUTSIDE_BUILDABLE`, `SITE_OPENING_HOST_WALL_OUTSIDE`, `SITE_FURNITURE_OUTSIDE_BUILDABLE`, `SITE_FURNITURE_OUTSIDE_ROOM`, `SITE_STAIR_OUTSIDE_BUILDABLE`, `SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE`, `SITE_PARKING_OUTSIDE_SITE`, `SITE_PARKING_OVERLAPS_BUILDING` — all HARD except advisory, deterministic, geometric integrity checks not legal
- Containment guarantees: every space (rooms + corridors/circulation) inside buildableBoundary via `rectInsidePolygon`, walls inside (start+end+mid), openings center inside + host wall inside, furniture inside containing room + inside buildable, stairs footprint + flights inside, parking inside siteBoundary + no overlap building footprint (buildableRects canonical, or buildableBoundary if rects empty due to decomposition failure)

### Buildable-Area Geometry (canonical)
- Original site boundary (input shape)
- Applied setbacks: user-defined DESIGN INPUT vs default-assumption, source/status per setback, reference "User-defined design input — NOT a legal requirement" or "Default assumption — REQUIRES_SOURCE_VERIFICATION", NOT invented legal
- Buildable boundary: inset orthogonal polygon by directional setbacks (north/south/east/west), inward shift, CCW, area, bounding rect, containment check inside original site
- For rectangle: inset rect {x+west, y+south, w - west-east, h - south-north}
- For L-shape/polygon: `insetOrthogonalPolygon(poly, setbacks)` — shifts each edge inward by setback value based on outward direction, reconstructs vertices via intersection of shifted edges, validates duplicate/zero-length/self-intersection/containment, returns polygon + errors
- Buildable rects: `decomposeOrthogonalPolygonToRects(poly)` → Rect[] | null — rectangle 1 rect, L-shape 2 rects via concave vertex + missing corner (area sum = polygon area), 8-vert via vertical scanline: xs = unique x sorted, slabs between xs, midX, collect y intersections of horizontal edges crossing midX, sort y, pair as inside intervals, create rects, validate rectInsidePolygon + area sum ≈ polygon area, merge horizontally/vertically deterministic, returns null on failure (no silent bbox fallback). Bounded: xs ≤8, slabs ≤7, intervals ≤4, total rects ≤12, no combinatorial explosion.

### Setback Representation/Resolution
- User-defined DESIGN INPUT vs VERIFIED Tier-1 with source ID/SHA256/page/clause/snippet/verification state else REQUIRES_SOURCE_VERIFICATION
- In V1: setbacks are design inputs, NOT legal requirements unless VERIFIED via regulation pack Tier-1
- AppliedSetback: {direction, value, source: 'user-defined'|'default-assumption'|'verified', status: 'VERIFIED'|'REQUIRES_SOURCE_VERIFICATION'|'USER_DEFINED'|'DEFAULT', reference}
- UI: setback inputs N/S/E/W with badges showing source/status, jurisdiction field, parking layout selector

### Site-Aware Room Placement
- Every space inside buildable: `rectInsidePolygon(rect, buildableBoundary)` checks all corners + center + edge midpoints, no bbox fallback for canonical
- Walls/openings/furniture/circulation/stair/parking inside buildable via HARD checks
- L-shape deterministic decomposition: `placeSpacesAcrossRects(buildableRects, buildableBoundary, specs, strategy, access, mkSpace)` — sorts rects by area descending then y, assigns public/semi-private/service to south rect, private + stair-hall to north rect for 2-rect L-shape, proportional by area for >2 rects, deterministic
- Polygon safe strategy: candidate regions (buildableRects) → placement → reject/repair → validate: `repairSpacesToBuildable` moves rooms outside buildable to alternative positions inside buildableRects via `findPositionForRect` scanning step 0.5m, `snapCorridorsToRoomsSiteAware` clamps to buildableRect bounding and re-repairs if still outside, final check rectInsidePolygon
- 8-vertex: scanline decomposition provides canonical rects, not bounding rect fallback; if decomposition fails, returns null, candidate marked SITE_GEOM_INVALID HARD, placement uses bounding rect as presentation fallback but validation flags outside
- Parking fit/orientation alternatives perpendicular/parallel deterministic geometric (no overlap site/buildable/building/other stalls): `placeParkingSiteAware(siteBoundary, buildableBoundary, buildableRects, siteRect, buildableRect, accessSide, count, level, layoutPref)` — tries perpendicular then parallel, checks `rectInsidePolygon(stall, siteBoundary)` and `!rIntersects(stall, buildingFootprint)` and no overlap other stalls, deterministic attempts[] array, layout 'perpendicular'|'parallel'|'auto'
- Placement quality preserve adjacency/privacy/circulation/daylight/furniture/kitchen/bedroom/entrance/stair Phase 8/9 intelligence intact

## DXF Multi-Floor Layers — Per-Floor Canonical (Phase 10.1 Fixed)

### Authoritative floor-specific geometry (canonical)
- `A-FLOOR-{n}-{base}` is authoritative floor-specific geometry namespace, `{n}` = floor index 0..N-1 deterministic sorted by level
- `{base}` = `A-WALL-EXT`, `A-WALL-INT`, `A-WALL-CORE`, `A-WALL-SERVICE`, `A-WALL-PART`, `A-DOOR`, `A-WINDOW`, `A-STAIR`, `A-STAIR-TREAD`, `A-STAIR-DIR`, `A-ROOM`, `A-DIMS`, `A-PARKING`, `A-BLDG-OUT`, `A-SITE`, `A-SETBACK`
- For EVERY floor (not just ground): 
  - `A-FLOOR-{n}-A-SITE` = actual siteBoundary polygon shifted by floorOffset (canonical)
  - `A-FLOOR-{n}-A-SETBACK` = actual buildableBoundary polygon (setback-applied) shifted (canonical)
  - `A-FLOOR-{n}-A-BLDG-OUT` = actual buildableBoundary polygon shifted (canonical), NOT bounding rect for L-shape/polygon
- Generic base layers `A-SITE`, `A-SETBACK`, `A-BLDG-OUT` emitted for floor 0 ONLY for backward compatibility (still canonical polygon, controlled by includeGenericLayers flag)
- Multi-floor L-shape and polygon candidates: upper-floor DXF geometry genuinely non-rectangular when canonical building geometry is non-rectangular (verified via parsing polyline coordinates, not string presence)

### Layer table
- `A-SITE` color 3 green DASHED — original site boundary polygon
- `A-BLDG-OUT` color 1 red — buildable boundary (setback-applied) canonical
- `A-SETBACK` color 2 yellow DASHED — setback lines (buildable boundary duplicated) + label N/S/E/W
- INSUNITS=4 mm, R12 ASCII AC1009, deterministic entity ordering

### Multi-floor presentation transformation (presentation only)
- Floors north-stacked in model space Y offset, `FLOOR_GAP_M=4m`, `floorOffset(fi)=fi*(maxFootprintH+4)` deterministic presentation, architectural elevation stored in Floor.elevation
- No second independent geometry: only one source of truth candidate.floors + siteBoundary/buildableBoundary

## PDF Drawing Numbers — Whole-Building + Site Context

- DrawingNumber = `AG-{candidateId}-WB` whole-building, per-floor `AG-{id}-WB-F{level}`
- PDF title block includes site shape, width x length, area, buildable area (actual), setbacks N/S/E/W
- PDF ground floor page draws siteBoundary green + buildableBoundary orange + labels, upper floors show floor-specific geometry
- Multi-page per floor, site/context info

## XLSX — 11 Sheets Including Site

- Sheets: `01_Project`, `02_Room_Schedule`, `03_Area_Summary`, `04_Openings`, `05_QA`, `06_Regulations`, `07_Intelligence`, `08_PerFloor`, `09_Vertical`, `10_Stacking`, `11_Site`
- `11_Site`: shape, width, length, area actual, buildable area actual, bounding rect compatibility, rects count + each rect, access side, jurisdiction, city, parking layout, setbacks N/S/E/W with source/status/reference, site boundary vertices, buildable boundary vertices, site validation isValid/errors, L-shape JSON, polygon vertices — structurally meaningful
- `01_Project` includes site shape, buildable area actual, buildable rects, setbacks, jurisdiction, city, parking layout

## Area Semantics (Phase 10.1 Fixed)

- Actual buildable polygon area used for site/buildable area (siteAreaValue, buildableAreaValue from computeBuildableGeometry)
- Actual canonical building footprint area used for building footprint: areaSummary.buildingFootprint = actual buildableBoundary polygon area (not bounding rect), grossFloorArea = sum actual per floor = buildingFootprint * floors for same site
- For rectangle: actual == bounding (verified)
- For L-shape/polygon: actual != bounding where applicable (verified, actual < bounding)
- Legacy fields: footprint x,y,w,h remain bounding rect as compatibility/presentation, area field is canonical actual; clearly labeled in docs as compatibility/bounding vs canonical actual
- Cross-output consistency: doc=report=manifest=DXF/PDF/XLSX agree on site shape/area/buildable/setbacks/jurisdiction/validation/floor count/checksum, area semantics consistent

## Report/Manifest — Site Metadata Cross-Output Consistent

- DocumentationModel.site extended: buildableArea actual, buildableBoundingRect compatibility, buildableRects canonical, siteBoundary canonical, buildableBoundary canonical, setbacks, setbackSources, jurisdiction, city, parkingLayout, lShape, polygonVertices, siteValidation
- QAReport.site, ProjectManifest input.site + geometry.siteShape/buildableArea actual/siteValidation, areaSummary gross/net/circ/service/parking/residual actual
- Consistency checksum deterministic

## UI — Site Shape Selector

- Site Shape selector: Rectangle / L-shape / Polygon
- Rectangle: width, length, access side, street width
- L-shape: notch width, notch length, notch corner (ne/nw/se/sw or north-east etc), deterministic decomposition info
- Polygon: vertex editor textarea JSON array of {x,y}, orthogonal V1 3..8 verts, validation feedback, deterministic ordering
- Setbacks: N/S/E/W inputs with badge REQUIRES_SOURCE_VERIFICATION unless VERIFIED
- Jurisdiction, city, parking layout (auto/perpendicular/parallel), floor selector, seed, deterministic
- Site validation feedback: shape, area actual, buildable area actual, rects count, vertices count, valid yes/no + errors, setback sources badges

## Testing — Phase 10.1

- 402 tests PASS (328 Phase1-9 + 46 Phase10 + 28 Phase10.1)
- Phase10 A-H + site validation findings preserved
- Phase10.1 new:
  - DXF per-floor canonical: every floor has A-FLOOR-n-A-SITE actual siteBoundary, A-FLOOR-n-A-SETBACK actual buildable, A-FLOOR-n-A-BLDG-OUT actual buildableBoundary not bounding rect, multi-floor L-shape/polygon upper floor genuinely non-rectangular (parsed polyline coordinates geometry, not string presence)
  - 8-vertex: C-shape 3 rects not bounding, staircase shape, concave 8-vert containment every room, final geometry differs from bounding rect, deterministic repeated generation, invalid cases self-intersect/duplicate/9 verts, decomposition failure returns null not bounding rect and validation HARD
  - Complete containment: rooms outside HARD, corridors outside HARD (not skipped), walls outside HARD (start+end+mid), openings outside HARD, furniture outside buildable HARD + outside room HARD, stairs outside HARD, parking outside site HARD + overlaps building HARD, valid candidate zero HARD site findings
  - Area semantics: rectangle actual==bounding, L-shape actual!=bounding, polygon actual!=bounding where applicable, cross-output consistency actual areas, rectangle area semantics, gross = footprint * floors
  - Determinism: same input+seed → identical site geometry, buildable geometry, candidate IDs, quality, DXF geometry
  - Performance bounded: floors≤10 verts≤8 candidates≤12 no 4^floors, 10F 20x30 8-vert <10s
- No reduction in validation strictness, Phase9 scoring weights unchanged, no accidental floors[0] regression

## Determinism

- Same input + seed → same geometry, siteBoundary, buildableBoundary, buildableRects, floors, candidateId, evaluation, ranking, DXF geometry (parsed), PDF/XLSX/report/manifest deterministic fields
- mulberry32 PRNG, no Math.random in core, Date.now only for generatedAt/updatedAt metadata (not geometry), no Math.random in geometry

## Regulation Discipline

- No fabricated legal claims; use "REQUIRES SOURCE VERIFICATION"/"Professional Review Required"/"NOT_IMPLEMENTED" for unknowns
- Setbacks USER-DEFINED DESIGN INPUTS unless VERIFIED Tier-1 with source ID/SHA256/page/clause/snippet
- Vertical/stacking/interFloor isHeuristic=true, never legal claim
- Statuses VERIFIED/REQUIRES_SOURCE_VERIFICATION/NOT_IMPLEMENTED preserved, 9 VERIFIED rules unchanged

## Build

- `npm run test:core` 402 PASS (19+1 files)
- `npx tsc -p packages/core/tsconfig.json --noEmit` PASS
- `npm run build --workspace=@archgenius/web` PASS (vite 304 modules, 1,770kB)

## Out of Scope (Phase 10.1)

- 3D/BIM/IFC/Revit/DWG/image-to-CAD/topography/terrain/neighbor sim/full solar/structural/MEP/municipality approval automation/unrestricted AI geometry/invented regs/FAR/coverage legal enforcement without Tier-1
- Unrestricted polygon decomposition (only orthogonal ≤8 verts, deterministic scanline, bounded, no combinatorial explosion)
