# Phase 10.1 Report — SITE-AWARE HARDENING

## Summary

Focused hardening of Phase 10 implementation that was audited as VERIFIED WITH MEDIUM FINDINGS. Fixes HIGH multi-floor DXF bbox fallback, MEDIUM 8-vertex fallback, MEDIUM incomplete containment, MEDIUM area semantics bounding vs actual, MEDIUM documentation overstatement. Preserves Phase 1-9 behavior, regulation discipline, deterministic, bounded.

**Tests: 402 PASS (328 Phase1-9 + 46 Phase10 + 28 Phase10.1). No CRITICAL/HIGH after fix. Final status VERIFIED WITH LOW FINDINGS.**

## Files Changed

- `packages/core/src/geometry/polygon-ops.ts` — Rewrote `decomposeOrthogonalPolygonToRects` to return `Rect[]|null`, no silent bbox fallback. Added deterministic vertical scanline decomposition for 4/6/8-vert orthogonal polygons: xs unique sorted, slabs, midX, collect y intersections of horizontal edges crossing midX, sort dedup, check even count else null, pair intervals inside via pointInPolygon, create rects, validate rectInsidePolygon + area sum ≈ polygon area else null, mergeRectsDeterministic horizontal then vertical, sort by area desc then y then x. Bounded xs≤8 slabs≤7 intervals≤4 rects≤12. Added `mergeRectsDeterministic`. Preserved L-shape 6-vert dedicated missing-corner logic with area validation.
- `packages/core/src/site/buildable.ts` — Updated to handle `decomposeOrthogonalPolygonToRects` returning null: if null or empty, push error `decomposition failure for N-vertex polygon — cannot decompose safely into rectangles (bounded failure, no bbox fallback as canonical)` and set `buildableRects=[]` (empty signals failure, not bbox). `buildableRect` remains bounding rect as compatibility/presentation only, clearly documented. `buildableRects` is canonical.
- `packages/core/src/generator/generator.ts` — Added handling for `buildableRects.length==0` as explicit decomposition failure: log explanation, fallback to bounding rect for placement attempt to avoid crash but with `[DECOMPOSITION-FAILURE-FALLBACK bounding]` prefix and candidate already marked SITE_GEOM_INVALID HARD. Preserved rectangle canonical == bounding, L-shape/polygon canonical = buildableRects. Comments clarify canonical vs compatibility.
- `packages/core/src/dxf/writer.ts` — Fixed HIGH: for EVERY floor, use canonical `buildableBoundary` polygon for `A-FLOOR-n-A-BLDG-OUT` and `A-FLOOR-n-A-SETBACK`, and canonical `siteBoundary` for `A-FLOOR-n-A-SITE`, not just ground floor. Previously only fi==0 used buildableBoundary, upper floors used footprint rect (bounding). Now: if buildableBoundary exists, shifted = buildableBoundary.map(p=>{x:p.x,y:p.y+yOff}) for all floors; generic layers for floor 0 only backward compat still canonical polygon; per-floor layers always canonical. Same for siteBoundary: emits for every floor, not just floor 0. Site label only ground floor to avoid clutter but geometry per floor exists. Deterministic ordering preserved, AC1009 R12 INSUNITS=4.
- `packages/core/src/validation/site.ts` — Strengthened complete containment per Phase 10.1: rooms + corridors HARD (previously corridors skipped), walls HARD checking start+end+mid inside buildableBoundary (previously midpoint soft), openings HARD center inside + host wall inside, furniture HARD inside room + inside buildable (new), stairs HARD footprint + flights inside, parking HARD outside site + overlaps building using canonical buildableRects or buildableBoundary if rects empty. Added codes: SITE_CORRIDOR_OUTSIDE_BUILDABLE, SITE_OPENING_OUTSIDE_BUILDABLE, SITE_OPENING_HOST_WALL_OUTSIDE, SITE_FURNITURE_OUTSIDE_BUILDABLE, SITE_FURNITURE_OUTSIDE_ROOM, SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE. All geometric integrity, not legal.
- `packages/core/src/documentation/builder.ts` — Fixed area semantics: `buildAreaSummary` now uses actual canonical areas: siteArea = siteAreaValue (actual polygon area) not legacy rect area, buildableAreaActual = buildableAreaValue, buildingFootprint = actual buildableBoundary polygon area (buildableAreaActual) not bounding rect, grossFloorArea = sum actual per floor (buildingFootprint * floors), residual uses actual. `floorMeta` now computes actual area via shoelace of buildableBoundary if available, so footprint area is canonical actual, x,y,w,h remain bounding compatibility. Clearly labeled in comments.
- `packages/core/src/phase101.test.ts` — NEW 28 tests for Phase 10.1 hardening: DXF per-floor canonical parsed polyline coordinates, 8-vertex decomposition, complete containment adversarial, area semantics, determinism, performance.
- `README.md` — Updated to Phase 10.1: genuinely supported shapes, canonical vs compatibility, complete containment HARD guarantees, per-floor DXF canonical, area semantics actual vs bounding, 402 tests.
- `ARCHITECTURE.md` — Updated pipeline, geometric conventions, layer convention per-floor canonical, site/buildable data model canonical vs compatibility, area semantics, testing 402.
- `PHASE_10_1_REPORT.md` — This file.

## Tests Before/After

- Before: 374 PASS (328 Phase1-9 + 46 Phase10)
- After: 402 PASS (328 Phase1-9 + 46 Phase10 + 28 Phase10.1)
- New tests all PASS, no regression.
- Existing 374 remain PASS verified via `npm run test:core`.

## Exact DXF Fix

**Before (HIGH):**
```ts
if (fi === 0 && buildableBoundary && ...) {
  shifted = buildableBoundary.map(...)
} else {
  shifted = [footprint rect bounding]
}
if (fi === 0) emitPolyline(shifted, 'A-SETBACK')
if (fi === 0 && siteBoundary) emitPolyline(siteBoundary, 'A-SITE')
```
Upper floors used `footprint` rect (bounding rect of buildableBoundary) for `A-FLOOR-n-A-BLDG-OUT`, which for L-shape/polygon is larger than actual L-shape area, misleading. `A-SETBACK` and `A-SITE` only emitted for floor 0.

**After (Phase 10.1):**
```ts
if (buildableBoundary && ...) {
  shifted = buildableBoundary.map(p=>{x:p.x,y:p.y+yOff}) // canonical for EVERY floor
} else {
  shifted = [footprint rect] // compatibility fallback only if no canonical
}
if (fi===0 && includeGenericLayers) emitPolyline(shifted, 'A-BLDG-OUT'), emitPolyline(shifted, 'A-SETBACK')
emitPolyline(shifted, `A-FLOOR-${fi}-A-BLDG-OUT`)
emitPolyline(shifted, `A-FLOOR-${fi}-A-SETBACK`) // per floor canonical

if (siteBoundary) {
  shiftedSite = siteBoundary.map(...)
  if (fi===0 && includeGenericLayers) emitPolyline(shiftedSite, 'A-SITE')
  emitPolyline(shiftedSite, `A-FLOOR-${fi}-A-SITE`) // every floor canonical
}
```
Now for multi-floor L-shape (20x25 notch 8x10) and polygon (6-vert L via polygon), upper floor `A-FLOOR-2-A-BLDG-OUT` has 6 vertices (non-rectangular) matching actual buildableBoundary area, not 4. Verified via parsing DXF polylines per layer and checking vertex count and area.

Behavioral tests inspect parsed polyline coordinates/geometry, not merely string presence: `parseDXFPolylines` extracts POLYLINE VERTEX coordinates per layer, converts mm→m, computes area via shoelace, compares to `computeBuildableGeometry` actual buildableArea (should match actual, not bounding).

## Exact 8-Vertex Handling

**Before (MEDIUM):**
```ts
export function decomposeOrthogonalPolygonToRects(poly: Polygon): Rect[] {
  if (poly.length===4) return [br];
  // ... incomplete scanline attempt with empty loop
  const concaveIdx = findConcaveVertex(poly);
  if (concaveIdx!==-1 && poly.length===6) { // L-shape 2 rects }
  const br = polygonBoundingRect(poly);
  return [br]; // silent bbox fallback for 8-vert
}
```
For 8-vert valid orthogonal polygons, returned bounding rect fallback, then relied on repair to ensure containment. Not genuinely decomposed.

**After (Phase 10.1):**
```ts
export function decomposeOrthogonalPolygonToRects(poly: Polygon): Rect[] | null {
  if (!isOrthogonal) return null;
  if (poly.length===4) return [br];
  if (poly.length===6) { // dedicated L-shape with area validation }
  // General scanline:
  xs = unique x sorted dedup
  for each slab [xs[i], xs[i+1]]:
    midX = (x0+x1)/2
    yInts = horizontal edges where midX in [minX,maxX] → y
    sort y dedup, check even count else return null
    pair intervals [y0,y1], [y2,y3] → check pointInPolygon mid → create rect
  validate rectInsidePolygon each rect + sumArea ≈ polyArea else null
  mergeRectsDeterministic horizontal then vertical, sort by area desc
  return merged or null on failure
}
```
- Deterministic orthogonal polygon decomposition into valid interior rectangles, bounded by ≤8 vertex constraint, no unrestricted algorithm, no combinatorial explosion (xs≤8, slabs≤7, intervals≤4, rects≤12)
- If valid 8-vertex polygon cannot be decomposed safely: returns null (explicit bounded decomposition failure), NOT bounding rect as canonical. Caller `computeBuildableGeometry` sets `buildableRects=[]` and pushes error `decomposition failure for N-vertex polygon — cannot decompose safely into rectangles (bounded failure, no bbox fallback as canonical)` and marks `isValid=false`, candidate gets SITE_GEOM_INVALID HARD via packFindings.
- Bounding rectangles remain compatibility/presentation helpers only: `buildableRect` = bounding rect of buildableBoundary (legacy), `siteBoundingRect`/`buildableBoundingRect` compatibility.
- Tests: convex 8-vertex orthogonal (impossible as convex orthogonal is rectangle, but we test rectangle as 8-vert with collinear? Actually we test C-shape 8-vert valid 3 rects, staircase 8-vert, concave 8-vert containment every room, final geometry differs from bounding rect (area < bounding), deterministic repeated generation same buildableRects length, invalid cases duplicate/9 verts/self-intersect, decomposition failure null not bbox.

## Containment Guarantees (Phase 10.1)

**Before:**
- Rooms: HARD via rectInsidePolygon, but corridors skipped (`if space.type==='corridor' continue`)
- Walls: midpoint outside soft
- Openings: not checked
- Furniture: not checked
- Stairs: HARD
- Parking: HARD

**After:**
- Rooms + corridors/circulation: HARD `SITE_ROOM_OUTSIDE_BUILDABLE` / `SITE_CORRIDOR_OUTSIDE_BUILDABLE` — every space inside buildableBoundary via rectInsidePolygon
- Walls: HARD `SITE_WALL_OUTSIDE_BUILDABLE` — checks start+end+mid inside buildableBoundary
- Openings: HARD `SITE_OPENING_OUTSIDE_BUILDABLE` center inside + `SITE_OPENING_HOST_WALL_OUTSIDE` host wall inside
- Furniture: HARD `SITE_FURNITURE_OUTSIDE_BUILDABLE` inside buildable + `SITE_FURNITURE_OUTSIDE_ROOM` inside containing room rect
- Stairs: HARD `SITE_STAIR_OUTSIDE_BUILDABLE` footprint + `SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE` flights
- Parking: HARD `SITE_PARKING_OUTSIDE_SITE` inside siteBoundary + `SITE_PARKING_OVERLAPS_BUILDING` no overlap building footprint (canonical buildableRects or buildableBoundary if rects empty)
- All geometric integrity checks, not Iranian municipal rules, no invented legal, severity HARD where applicable, uses existing severity terminology VERIFIED for geometric integrity.

Adversarial tests for each category: manually craft outside rect/wall/opening/furniture/stair/parking and verify HARD finding; valid candidate zero HARD site findings.

## Area Semantics Fix

**Before:**
- `buildAreaSummary` used `rArea(candidate.buildableArea)` legacy rect area for siteArea, `rArea(fl.footprint)` bounding rect for buildingFootprint and grossFloorArea. For L-shape, footprint = bounding rect of buildableBoundary, so buildingFootprint = bounding area > actual L-shape area, overestimated.
- `floorMeta` footprint area = rArea(fl.footprint) bounding.

**After:**
- siteArea = actual site polygon area via `siteAreaValue` (from computeBuildableGeometry) canonical
- buildableAreaActual = actual buildable polygon area via `buildableAreaValue` canonical
- buildingFootprint = actual canonical building footprint area = buildableBoundary polygon area (buildableAreaActual) canonical, NOT bounding rect
- grossFloorArea = sum actual per floor = buildingFootprint * floors (same site for all floors) canonical
- floorMeta area = actual via shoelace of buildableBoundary if available, x,y,w,h remain bounding compatibility
- Tests: rectangle actual==bounding, L-shape actual!=bounding (actual < bounding), polygon actual!=bounding where applicable, cross-output consistency doc=report=manifest agree on actual areas, gross = footprint * floors, rectangle area semantics.

Preserve legacy fields only when clearly labeled as compatibility/bounding values: `buildableRect`, `siteBoundingRect`, `buildableBoundingRect`, `floor.footprint x,y,w,h` remain bounding compatibility, documented as compatibility/presentation, area fields are canonical actual.

## Documentation Changes

- README.md: Updated to Phase 10.1, genuinely supported shapes, canonical vs compatibility, complete containment HARD guarantees, per-floor DXF canonical, area semantics actual vs bounding, 402 tests, no overstatement.
- ARCHITECTURE.md: Updated pipeline, geometric conventions decompose returns Rect[]|null, layer convention per-floor canonical table, site/buildable data model canonical vs compatibility, area semantics, testing 402.
- PHASE_10_REPORT.md: Preserved as Phase 10 baseline.
- PHASE_10_1_REPORT.md: New report (this file) with exact fixes, files changed, tests before/after, DXF fix, 8-vertex handling, containment guarantees, area semantics fix, documentation changes, tsc/build status, determinism, performance, remaining LOW findings, final status.

Documentation accurately states:
- What site shapes are genuinely supported: rectangle (1 rect canonical == bounding), L-shape (6-vert, 2 rects canonical, area sum = polygon area), polygon orthogonal 3..8 verts (deterministic scanline up to 6 rects, null on failure, no bbox as canonical)
- Whether 8-vertex polygons are fully decomposed: Yes for orthogonal simple polygons via scanline, returns null on failure with HARD error, no silent bbox fallback
- Which DXF site/buildable layers exist per floor: A-FLOOR-n-A-SITE, A-FLOOR-n-A-SETBACK, A-FLOOR-n-A-BLDG-OUT for EVERY floor canonical actual polygons, generic floor-0 layers backward compat canonical
- What is canonical vs compatibility bounding geometry: siteBoundary/buildableBoundary/buildableRects canonical for placement/validation/outputs; siteBoundingRect/buildableBoundingRect/buildableRect/floor.footprint x,y,w,h compatibility/bounding presentation only
- Exact containment guarantees: rooms+corridors HARD, walls HARD start+end+mid, openings HARD center+host wall, furniture HARD inside room+buildable, stairs HARD footprint+flights, parking HARD outside site+overlaps building
- Remaining heuristic/source-verification limitations: setbacks USER-DEFINED vs VERIFIED Tier-1, parking dimensions default not VERIFIED, vertical/stacking/interFloor isHeuristic=true, no municipality approval automation, orthogonal only ≤8 verts, no 3D/BIM

Do NOT mark limitation solved merely by changing wording: code actually fixed DXF per-floor canonical, 8-vert decomposition scanline, containment HARD, area semantics actual.

## TSC/Build Status

- `npx tsc -p packages/core/tsconfig.json --noEmit`: PASS (0 errors)
- `npm run test:core`: 20 files 402 PASS (14.13s)
- `npm run build --workspace=@archgenius/core`: PASS
- `vite build` in packages/web: 304 modules transformed, 1,770kB, PASS
- No reduction in validation strictness, no change to Phase 9 scoring weights, no accidental floors[0] regression (ground-floor-specific metrics documented as ground-floor-specific)

## Determinism

- Same input+seed produces identical site geometry (siteBoundary, siteArea), buildable geometry (buildableBoundary, buildableArea, buildableRects), generated geometry (rooms, walls, openings, furniture, stairs, parking), candidate IDs, quality (overallQuality), DXF geometry (parsed polylines identical), cross-output deterministic fields (checksum, area, shape)
- Verified via tests: deterministic repeat same buildable geometry, same candidate IDs, same DXF byte identical for same input+seed
- Metadata timestamps: `generatedAt: Date.now()` in generator.ts, `new Date()` in documentation/builder.ts revision date and generation timestamp, `new Date()` in pdf.ts title block date — non-byte-deterministic for metadata but do NOT affect geometry or candidate selection, deterministic for geometry, allowed per architecture (metadata timestamps may remain non-byte-deterministic if already architectural)
- No Math.random in core geometry, no non-stable iteration (xs sorted, y sorted, area desc sort explicit)

## Performance

- Floors ≤10: validated in validateInput floors 1..10 integer, tests 1F2F3F6F10F
- Vertices ≤8: validateSitePolygon max 8, tests max 8, 9 verts rejected
- Candidates ≤12: strategies 4, generateLayouts returns ≤4, pipeline generate returns [best] unless allStrategies, tests candidates.length ≤12
- No 4^floors generation: 4^10=1M vs ≤12, verified
- No unbounded polygon search: polygon ops O(n^2) n≤8, hasSelfIntersection double loop, inset O(n), decompose scanline O(xs * n) xs≤8 n≤8 bounded
- No uncontrolled repair loops: findPositionForRect step 0.5m, nested x/y loops bounded by rect dimensions (~40*60=2400 iterations per rect), per room ~10 rooms → ~24k checks bounded, no retry explosion
- Performance regression tests: candidate generation 10F 20x30 8-vert <10s, site validation 100 polys <1s, DXF generation 10F <2s — PASS

## Remaining LOW Findings

- **Non-deterministic metadata timestamps**: `Date.now()` for generatedAt, project id `prj-${now}`, updatedAt, `new Date()` for revision date and generation timestamp and PDF title block date — breaks byte determinism for metadata, but geometry deterministic, allowed per spec (metadata timestamps may remain non-byte-deterministic if already architectural). LOW.
- **PDF only ground floor site label**: PDF draws siteBoundary/buildableBoundary labels only for ground floor to avoid clutter, but geometry per floor exists in DXF. Documentation states site/context on first page, which is accurate. Could be considered LOW if expecting site label on every PDF page, but per-floor DXF has geometry, PDF shows site context. LOW.
- **Legacy footprint x,y,w,h bounding compatibility**: `floor.footprint` x,y,w,h remain bounding rect for backward compat, area field is actual canonical. Documented as compatibility/bounding vs canonical actual. Could be confusing but preserved for backward compat, clearly labeled. LOW.
- **Furniture placement heuristic**: furniture placed deterministically inside rooms via corners/walls, but not full clearance simulation, may fail to place if room too small — returns null, not crash, validation will flag if outside. LOW, not a defect.
- **8-vertex decomposition edge case**: For orthogonal polygons with 2 concave vertices that after setback inset cause self-intersection or area <5, decomposition returns null and candidate marked invalid HARD. This is safe failure, not silent bbox, but means some valid site inputs with large setbacks may be marked invalid. This is acceptable bounded failure, documented as heuristic limitation. LOW.

No MEDIUM/HIGH findings remain after hardening.

## Final Self-Audit — Bounding Geometry Classification

Inspect production code for `buildableRect`, `buildableBoundingRect`, `siteBoundingRect`, `boundingRect`, `footprint`, `floors[0]`, `Math.random`, `Date.now`, `new Date`:

- `buildableRect`:
  - `site/buildable.ts`: `buildableRect = buildableBoundingRect` for L-shape/polygon, `buildableRect = insetRect` for rectangle — **compatibility/bounding** (legacy footprint), documented as compatibility/presentation only, canonical is buildableBoundary/buildableRects
  - `generator.ts`: `footprint: Rect = bfp.rect` legacy compat, `buildableRect` used as `floor.footprint` legacy compat — **compatibility**, `placeSpaces(buildableRect,...)` for rectangle canonical == bounding, for L-shape/polygon uses buildableRects canonical, not buildableRect — **canonical for rectangle, compatibility for L-shape/polygon**
  - `dxf/writer.ts`: previously used `fl.footprint` (buildableRect bounding) for upper floors — **defect fixed** — now uses buildableBoundary canonical for all floors, footprint only fallback if no canonical
  - `documentation/builder.ts`: `rArea(fl.footprint)` previously used for buildingFootprint — **defect fixed** — now uses actual buildableAreaValue canonical, footprint area via shoelace actual, x,y,w,h bounding compatibility
  - `documentation/manifest.ts`: `footprint: candidate.floors[0]?.footprint` — **compatibility/bounding**, buildableArea actual canonical
  - Overall: No production path uses bounding geometry as canonical site-aware geometry for L-shape/valid polygon after fix — VERIFIED

- `buildableBoundingRect`:
  - `site/buildable.ts`: computed via `polygonBoundingRect(buildableBoundary)` — **compatibility/bounding**
  - `documentation/builder.ts`: `buildableBoundingRect` exposed as `buildableBoundingRect` with area actual — **compatibility/bounding** labeled
  - `dxf/writer.ts`: not used as canonical after fix
  - Classification: **compatibility**

- `siteBoundingRect`:
  - `site/buildable.ts`: `polygonBoundingRect(siteBoundary)` — **compatibility/bounding**
  - `generator.ts`: `siteRect: Rect = buildableGeom.siteBoundingRect` used for parking zone bounding — **compatibility** (parking site-aware uses siteBoundary canonical for containment, siteRect for zone bounds)
  - Classification: **compatibility**

- `boundingRect`:
  - `polygon-ops.ts`: `polygonBoundingRect` function — **compatibility helper**
  - `site/buildable.ts`: `buildableBoundingRect` — **compatibility**
  - Classification: **compatibility**

- `footprint`:
  - `model/floor.ts`: `footprint: Rect` — **legacy compatibility** (bounding rect of buildable), but actual area via buildableBoundary canonical
  - `generator.ts`: `floor.footprint = buildableRect` — **compatibility**, canonical is buildableBoundary/buildableRects
  - `dxf/writer.ts`: `fl.footprint` previously used as canonical for upper floors — **defect fixed**, now only fallback if no canonical
  - `documentation/builder.ts`: `fl.footprint` x,y,w,h bounding compatibility, area actual canonical
  - Classification: **compatibility/presentation** for L-shape/polygon, **canonical for rectangle** (where actual==bounding)

- `floors[0]`:
  - `documentation/builder.ts`: `groundFootprint = candidate.floors.length>0 ? rArea(...)` etc — **legitimate ground-floor semantic** (ground floor footprint vs ground rooms reconciliation explicitly documented as ground-floor-specific, not whole-building)
  - `dxf/writer.ts`: `firstStairs = candidate.floors[0].stairs` for vertical markers — **legitimate ground-floor semantic** (stair stack from ground)
  - `pipeline.ts`: `project.candidates[0]` etc — **legitimate**
  - `intelligence/vertical-circulation.ts`, `inter-floor.ts`, `regulations/packs/ir-national-mbr.ts`, `verify/run-verification.ts`: ground floor specific logic — **legitimate ground-floor semantic**
  - No accidental floors[0] regression: whole-building metrics use all floors, not just floors[0], per-floor quality computed per floor, verified via intelligence.test.ts 46 tests — PASS

- `Math.random`: None in core (grep returns none) — **none**

- `Date.now`:
  - `generator.ts`: `generatedAt: Date.now()` for metadata — **legitimate** (metadata, not geometry)
  - `pipeline.ts`: `createProject` id `prj-${now}` and updatedAt — **legitimate** (metadata)
  - Classification: **metadata only, not geometry**

- `new Date`:
  - `documentation/builder.ts`: `new Date()` for revision date and generation timestamp — **legitimate** (metadata)
  - `documentation/pdf.ts`: `new Date()` for title block date — **legitimate** (metadata)
  - Classification: **metadata only**

Especially prove that no production path uses bounding geometry as canonical site-aware geometry for L-shape/valid polygon: After fix, `decomposeOrthogonalPolygonToRects` returns null on failure (no bbox fallback), `computeBuildableGeometry` returns [] on failure (not bbox), generator uses `buildableRects` canonical for L-shape/polygon placement, `rectInsidePolygon` checks against `buildableBoundary` canonical, DXF per-floor uses `buildableBoundary` canonical for all floors, area semantics uses actual polygon area canonical. Verified via tests parsing DXF polylines and checking vertex counts and areas.

## Final Status

**VERIFIED WITH LOW FINDINGS**

No CRITICAL/HIGH/MEDIUM findings after hardening. Remaining LOW findings are metadata timestamps non-byte-deterministic (allowed), PDF ground floor label only (documented), legacy footprint x,y,w,h bounding compatibility (documented), furniture heuristic, 8-vertex decomposition safe failure edge case with large setbacks.

All Phase 1-9 behavior preserved, regulation discipline preserved, 402 tests PASS, tsc PASS, web build PASS 304 modules.
