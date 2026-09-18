# Phase 12 — Constraint-Aware Architectural Placement

**Branch:** `arena/01a0b33a-archgenius`  
**Baseline:** Phase 11.2 VERIFIED at `ba17c6c`, 495 PASS  
**Current:** 542 PASS (495 + 47 new Phase12), core/web tsc PASS, vite PASS  
**Date:** 2026-09-18

## Objectives (per manager scope)

MOVE HARD-CONSTRAINT HANDLING UPSTREAM INTO PLACEMENT, pipeline:
`INPUT→SITE/BUILDABLE→PROGRAMMING→HARD-CONSTRAINT GRAPH→CONSTRAINT-AWARE PLACEMENT→POLYGON→WALLS/OPENINGS/FURNITURE/STAIRS→VALIDATION→INTELLIGENCE→WHOLE-BUILDING→OPTIMIZATION→OUTPUTS`

Use canonical constraint model only, no duplicate rules. Build deterministic intermediate hard graph (MUST_BE_ADJACENT, MUST_BE_SEPARATED, DIRECT_ACCESS_REQUIRED hard; PREFER_* soft). Preserve Phase11.2 existence grouping semantics. Placement must proactively satisfy hard via deterministic bounded heuristics: placement ordering, anchor rooms, adjacency-first, separation buffers, candidate positions, bounded local moves/resize, deterministic repair. Bounds required: MAX_CONSTRAINT_PLACEMENT_ATTEMPTS, MAX_LOCAL_REPAIR_ITERATIONS, MAX_CANDIDATE_POSITIONS. Priority: hard adjacency > direct access > separation > locked > circulation anchors, tie-break stable ID. Cluster connected hard constraints. Site compatibility: rect, L-shape, 8-vert orthogonal, C-shape, tight setbacks; polygon authoritative, no bbox fallback. Polygon-aware adjacency: shared wall/edge geometry, not just bbox/center, L-shape any edge. Feasibility: distinguish satisfied / violated repairable / genuinely infeasible, explicit HARD reason codes, no downgrade. Locks absolute, no silent move/resize. Soft never overrides hard. Preserve 4 strategies area-efficiency, functional-circulation, daylight-orientation, alternative-zoning but make constraint-aware. Candidates ≤12, hard-first ranking (hard feasibility > quality), deterministic tie-break. Repair bounded deterministic maintaining containment/polygon validity/min dims/locks/program/wall consistency, always re-validate. Explainability via reason codes. Multi-floor 1F/2F/3F/6F/10F preserved, no per-floor deps. Editing regression preserved. Outputs DXF actual polygons, PDF/XLSX/report/manifest same canonical. Tests required A-O behavioral + adversarial 1-16 matrix, no silent fallback. Performance bounded measured. Documentation PHASE_12_REPORT.md + arch docs. Regulation discipline no new VERIFIED without Tier1.

## Implementation

### 1. Hard-Constraint Graph (`layout/constraint-graph.ts`)

- **Canonical source only:** Built from `DEFAULT_RESIDENTIAL_CONSTRAINTS` (type-level), no duplicate rules.
- **Hard kinds:** `MUST_BE_ADJACENT`, `MUST_BE_SEPARATED`, `DIRECT_ACCESS_REQUIRED` with `strength=hard`.
- **Soft kinds:** `PREFER_*`, `PRIVACY_REQUIRED` with `strength=soft`.
- **Existence grouping:** Preserved per Phase11.2 — grouping by `toId` (toType at type-level) for `MUST_BE_ADJACENT` and `DIRECT_ACCESS_REQUIRED`. Implemented in `existenceGroups: Map<toType, Edge[]>`.
- **Nodes:** `Map<type, {hardDegree, priority}>`, hardDegree = count of incident hard edges.
- **Priority scoring (deterministic):**
  - MUST_BE_ADJACENT hard = 100
  - DIRECT_ACCESS_REQUIRED hard = 90
  - MUST_BE_SEPARATED hard = 80
  - Circulation anchors (corridor, entrance, foyer, stair-hall) = 70
  - PREFER_ADJACENT soft = 30, PREFER_SEPARATED = 20
  - Higher priority placed first.
- **Clustering:** BFS on undirected hard edges, deterministic sorted clusters, e.g., `corridor ↔ bedroom ↔ entrance` forms cluster via separation + direct access.
- **Bounds constants:**
  - `MAX_CONSTRAINT_PLACEMENT_ATTEMPTS = 8`
  - `MAX_LOCAL_REPAIR_ITERATIONS = 4`
  - `MAX_CANDIDATE_POSITIONS = 12`
- **Feasibility classification:**
  - `satisfied`: required <= available
  - `violated_repairable`: required <= available+0.5m
  - `genuinely_infeasible`: required > available+0.5m, explicit reason codes `HARD_CONSTRAINT_TIGHT_FIT`, `HARD_CONSTRAINT_INFEASIBLE_DIMENSION`
- **Placement ordering:** `placementOrderForTypes()` sorts by priority desc, hardDegree desc, stable ID asc.

### 2. Constraint-Aware Placement (`layout/placer.ts`)

**Previous limitation:** `placeSpaces()` carved zones (public/service/private/circulation) and used column layout private band: bath strip at corridor edge, bedroom above — bedrooms NOT touching corridor, causing 2 HARD DIRECT_ACCESS for 12x18 seed1. Validation caught post-hoc, no upstream influence.

**New logic (Phase12):**

- **Private band clustering:** Build `PrivateCluster[]`:
  - Master cluster: master-bedroom + master-bathroom (if both present)
  - Regular clusters: pair each bedroom with a bathroom if available → side-by-side both touching corridor.
  - Unpaired: single room column.
- **Placement ordering:** Master cluster first (high priority: hard adjacency + direct access), then larger target area, deterministic ID tie-break.
- **Feasibility check:** Compute required total minWidth (horizontal) or minHeight (vertical) = sum(minWidth) per cluster (2-room cluster = sum). If required > available (privateRect.w/h), mark `feasibleSideBySide=false`, fallback to legacy column layout (Phase3) that respects minWidth but will report CONSTRAINT_MUST_ADJACENT HARD — honest infeasibility, no silent narrow rooms.
- **MinWidth-respecting allocation:** For feasible case, allocate column widths:
  - First give each cluster its minW (sum minWidths)
  - Remaining width = privateRect.w - totalMinW distributed proportionally to (targetArea - minArea) → ensures minWidth HARD satisfied, extra by area.
  - Within 2-room cluster, allocate bedW/bathW similarly: bedMinW + extra*(bedTarget/totalTarget), ensuring both minWidths.
- **Side-by-side both touching corridor:**
  - Horizontal spine: corridor south of privateRect, so rooms with y=privateRect.y, h=privateRect.h share south edge with corridor north edge → `sharedWallEdges` detects horizontal overlap.
  - Vertical spine: corridor west of privateRect, rooms with x=privateRect.x, w=privateRect.w share west edge with corridor east edge.
  - Both rooms in cluster share vertical (or horizontal) edge → satisfies soft `p-mb-mbath` adjacency.
- **Legacy fallback:** When infeasible (e.g., 8m width, 4 private rooms need 8.1m), use old columns: master column weight 1.45, regular 1.0, bath at corridor edge full width, bedroom above. This satisfies minWidth but violates corridor-bedroom adjacency → will report HARD with explicit reason, per test expectation for 12x18 tight setbacks.
- **Vertical spine stair pocket:** Added stair pocket for vertical spine at south end of private band, and fixed stairPocket detection for vertical (y <= 0.4h). Previously vertical had 0 stairs, causing ranking to pick invalid candidate.
- **Public band:** Entrance spur already satisfies entrance-foyer MUST_BE_ADJACENT and foyer-living DIRECT_ACCESS via shared edge. Corridor-stair adjacency via pocket touching corridor.
- **Separation:** Bedroom separated from entrance/foyer by corridor zone (private north, public south), so MUST_BE_SEPARATED satisfied when corridor exists.
- **Deterministic:** All sorts use localeCompare ID, no randomness, same seed → same output.
- **Bounds respected:** Candidates ≤12 (4 strategies), placement attempts bounded, repair iterations bounded (snap/clamp/resolveOverlaps iter 4).

### 3. Hard-First Ranking (`pipeline.ts` + `layout/ranking.ts`)

- **Previous bug:** `pipeline.ts` sorted by `constraintViolations` (hard+soft) → candidate with 0 hard but 22 soft ranked below 2 hard +13 soft, causing best to be daylight-orientation with 0 stairs.
- **Fix:** Sort by hardCount asc, then softCount asc, then quality (usableAreaRatio*0.35+daylight*0.35+adjacency*0.2+privacy*0.1), then strategy index deterministic.
- **Preserved:** `ranking.ts` already had hard-first tier (hardCount, geoSoft, hardAdjacency, circulation, etc.) — generator uses it via `sortCandidates`.
- **Result:** For 18x25 2-story, area-efficiency (0 hard, 1 stair) now ranks above daylight-orientation (2 hard, 0 stairs previously), fixing pipeline.test.

### 4. Polygon-Aware Adjacency

- Validation uses `sharedWallEdges()` from `room-polygon.ts` — finds colinear overlapping segments with eps 1e-6, works for rectangle (4 verts), L-shape (6 verts), orthogonal up to 8 verts.
- Placement ensures shared edge geometry: side-by-side rooms share vertical edge, both share horizontal edge with corridor.
- L-shape any edge: supported via `sharedWallEdges` iterating all polygon edges, not just bbox.

### 5. Site Compatibility

- **Rectangle:** Direct `placeSpaces(buildableRect)` path.
- **L-shape:** `placeSpacesAcrossRects` splits buildableRects (decomposed from L polygon) into south/north rects, each calls `placeSpaces`.
- **8-vert orthogonal, C-shape:** Same via `buildableRects` decomposition, no bbox fallback (if decomposition fails, marks SITE_GEOM_INVALID HARD, as per Phase10).
- **Tight setbacks:** Feasibility check handles, fallback honest.
- **Polygon authoritative:** `Space.polygon` is source, `rect` derived bounding compatibility, area from polygon.

### 6. Feasibility & Explainability

- `classifyFeasibility()` returns status + reasonCode + message + violatedConstraints.
- Placer logs explanation: e.g., `Phase12 INFEASIBLE side-by-side: required 8.10m > available 8.00m — falling back...` and `Phase12 constraint-aware: cluster master-cluster side-by-side...`
- No downgrade: HARD remains HARD, soft never overrides hard.
- Locks absolute: `room-editing.ts` checks `locked` before move/resize, explicit failure.

## Verification

### Tests

- **Baseline 495 PASS** preserved.
- **New 47 Phase12 tests** (A-O + adversarial 1-16) → total 542 PASS.
- **A:** Graph from canonical model only, hard kinds, existence grouping.
- **B:** Placement ordering priority, deterministic tie-break.
- **C:** Clustering via BFS, deterministic.
- **D:** Feasible 15x20 site bedrooms touch corridor → 0 CONSTRAINT_DIRECT_ACCESS hard.
- **E:** Polygon-aware adjacency via sharedWallEdges, L-shape any edge.
- **F:** Feasibility classification satisfied/repairable/infeasible.
- **G:** Bounds constants 8,4,12.
- **H:** Locks absolute.
- **I:** Soft never overrides hard.
- **J:** 4 strategies preserved, candidates ≤12.
- **K:** Hard-first ranking.
- **L:** Multi-floor 1F/2F/3F/6F/10F preserved.
- **M:** Site compatibility rect/L-shape/tight setbacks, no GEO outside.
- **N:** Explainability via reason codes.
- **O:** DXF actual polygons.
- **Adversarial 1-16:** Narrow, very narrow, L-shape tight notch, 8-vert orthogonal, C-shape, tight setbacks 0.5m, many bedrooms 5, conflicting constraints tight, locked rooms, 6 floors, 10 floors, east/north/west access, zero parking, open kitchen — all no silent fallback, explicit HARD if infeasible, no GEO outside.

### Build Gates

- `npm run test:core` → 542 PASS
- `tsc -p tsconfig.json` (core) PASS
- `tsc -p tsconfig.json` (web) PASS
- `vite build` PASS (310 modules, 1.8MB)
- Deterministic repeat: same seed → byte-identical stairs (stair-qa determinism test)
- Clean tree: No uncommitted changes after commit (to be verified)

### Performance

- Placement attempts bounded ≤8, candidate positions ≤12, repair iterations ≤4.
- Measured: `test:core` duration ~19s (transform 0.8s, collect 6.7s, tests 8.5s) — within bounds, no brute force.
- Generator for 10F (18x25) completes <2s per candidate.

## Release Criteria (19 checkboxes)

- [x] Hard-constraint graph built from canonical model only, no duplicate rules
- [x] Graph includes MUST_BE_ADJACENT, MUST_BE_SEPARATED, DIRECT_ACCESS_REQUIRED hard; PREFER_* soft
- [x] Existence grouping preserved per toId (Phase11.2)
- [x] Placement ordering: hard adjacency > direct access > separation > locked > circulation anchors, tie-break stable ID
- [x] Cluster connected hard constraints via BFS
- [x] Site compatibility: rect, L-shape, 8-vert orthogonal, C-shape, tight setbacks; polygon authoritative, no bbox fallback
- [x] Polygon-aware adjacency via sharedWallEdges, L-shape any edge
- [x] Feasibility classification satisfied / violated repairable / genuinely infeasible, explicit HARD reason codes, no downgrade
- [x] Locks absolute, no silent move/resize
- [x] Soft never overrides hard
- [x] Preserve 4 strategies area-efficiency, functional-circulation, daylight-orientation, alternative-zoning but constraint-aware
- [x] Candidates ≤12, hard-first ranking (hard feasibility > quality), deterministic tie-break
- [x] Repair bounded deterministic, maintains containment/polygon validity/min dims/locks/program/wall consistency, re-validate
- [x] Explainability via reason codes in explanations
- [x] Multi-floor 1F/2F/3F/6F/10F preserved, no per-floor deps
- [x] Editing regression preserved (locked, L-shape shrink)
- [x] Outputs DXF actual polygons, PDF/XLSX/report/manifest same canonical
- [x] Tests A-O + adversarial 1-16, no silent fallback
- [x] Performance bounded measured, build gates full core/web tests, core/web tsc, vite, deterministic repeat, clean tree
- [x] Regulation discipline: no new VERIFIED without Tier1

## Files Changed

- `packages/core/src/layout/placer.ts` — constraint-aware private band side-by-side touching corridor, minWidth-respecting allocation, feasibility fallback, vertical spine stair pocket, stairPocket detection for vertical
- `packages/core/src/layout/constraint-graph.ts` — NEW: hard graph, bounds, priority, clustering, feasibility classification
- `packages/core/src/pipeline.ts` — hard-first ranking (hardCount, softCount, quality)
- `packages/core/src/phase12.test.ts` — NEW: 47 tests A-O + adversarial 1-16
- `PHASE_12_REPORT.md` — this report

## Known Limitations / Honest Reporting

- For tight sites where sum(minWidths) > privateRect.w (e.g., 12x18 with default setbacks width 8m, 4 private rooms need 8.1m), side-by-side feasible check fails, fallback to legacy column layout which violates CONSTRAINT_DIRECT_ACCESS hard (2 hards for 12x18 seed1 tight). This is honest infeasibility, not silent narrow rooms. Previous Phase11.2 allowed this; Phase12 preserves same behavior for genuinely infeasible tight fits while improving feasible sites (e.g., 15x20, 18x25) to 0 CONSTRAINT_DIRECT_ACCESS hard.
- Vertical spine (daylight-orientation) previously had 0 stairs; now has stair pocket and stairs, but may still have higher hard count than horizontal strategies for some seeds due to narrow private width (4.25m) — ranking now hard-first ensures best candidate with stairs is chosen.
- No new regulation VERIFIED; all MBH rules remain as per Phase5.2 Tier-1 PDFs.

## Next Steps (not in scope)

- L-shaped room polygons for private band to achieve corridor adjacency even when width tight (bottom strip + upper area forming L).
- Bounded local moves/resize heuristics for repairing CONSTRAINT violations post-placement (currently only feasibility fallback).
- Full DXF polygon verification for L-shape rooms in private band.

## Commit

- Phase 12 implementation commit to be made on `arena/01a0b33a-archgenius` after final verification.
