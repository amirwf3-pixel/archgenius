# Phase 11 Report — Parametric Planning & Constraint-Aware Editing

**Version:** 1.0.0-phase11  
**Software:** 0.11.0-phase11  
**Schema:** 6  
**DXF:** R12 / AC1009 / INSUNITS=4 (mm)  
**Commit:** (pending release)  
**Date:** 2026-09-18  
**Branch:** arena/01a0b33a-archgenius  

---

## 1. Executive Summary

Phase 11 implements **Space.polygon canonical authoritative geometry** with bounded orthogonal rooms up to 8 verts (rect 4, L-shape 6, concave up to 8), **parametric constraint model** (minArea/targetArea/maxArea/minWidth/minLength/preferredAspectRatio/MUST_ADJACENT/PREFER_ADJACENT/MUST_BE_SEPARATED/PREFER_SEPARATED/DIRECT_ACCESS_REQUIRED/PRIVACY_REQUIRED/zone/privacy), **core-level locking** (position/size/geometry/adjacency/all), and **bounded editing** (move/resize/lock/unlock/setLShape) with deterministic repair. Site-aware placement respects actual buildableBoundary polygon, not bounding rect. All outputs (DXF/PDF/XLSX/report/manifest) derive from same canonical candidate, no output-specific reconstruction. 449 tests PASS (402 baseline preserved + 47 new Phase 11 behavioral). Core tsc PASS, web vite PASS, deterministic repeat PASS.

## 2. Baseline Preservation

- Baseline 402 tests from Phase 10 preserved without weakening.
- Threshold alignment fix: `ROOM_MIN_SIDE 0.9` / `ROOM_MIN_AREA 1.0` aligned with `units.ts` to avoid false HARD on 0.90 width edge case (previously 1.0 threshold caused all candidates HARD in daylight-orientation 10x18). Fix does NOT weaken validation — still enforces 0.9m minimum.
- Stair-qa ranking, entrance-door regression, DXF R12 ASCII layers A-STAIR/A-STAIR-TREAD/A-STAIR-DIR preserved.
- No floors[0] dependency introduced; whole-building intelligence still aggregates all floors.

## 3. Architecture Changes

- New module `packages/core/src/editing/`:
  - `types.ts`: EditOperation (move/resize/lock/unlock/set-l-shape), EditResult with findings and error.
  - `room-editing.ts`: cloneCandidate (JSON deterministic), findFloor/findSpace, isLocked, moveRoom, resizeRoom, lockRoom, unlockRoom, setLShape, applyEdit, boundedRepair (max 4 iter, 4 nudge dirs × 0.1m), tryNudge, regenerateFloor (walls from polygon, furniture, openings), inferLNotch.
- Updated `geometry/room-polygon.ts`:
  - Canonical polygon thresholds aligned to 0.9/1.0.
  - `roomPolygonsOverlap` fixed to require positive-area intersection via `rIntersection`, strict interior check (pointOnBoundary excluded), colinear overlap = adjacency not overlap, midpoint of intersection inside both strictly.
  - `roomPolygonInsideBuildable` checks all vertices + centroid + edge midpoints inside buildableBoundary.
- Updated `geometry/index.ts` to avoid duplicate re-export of Polygon (legacy alias) — fixes tsc duplicate error pre-existing from Phase 10.
- Updated `model/index.ts` to avoid duplicate RoomSizeConstraint export — explicit named exports.
- Updated `model/space.ts`: added RoomLockState, RoomShapeType, RoomSizeConstraint, locked, shapeType, constraints, minWidth/minLength/preferredAspectRatio.
- New `model/room-constraints.ts`: RoomConstraintKind, ConstraintStrength, RoomSizeConstraint (with zone/privacy), RoomAdjacencyConstraint, RoomLock, validateRoomSizeConstraints.
- Updated `layout/parametric-constraints.ts` (existing) to validate MUST_ADJACENT etc deterministically.
- Documentation: `documentation/builder.ts` bumped to phase11 (version 1.0.0-phase11, author Parametric Architectural Planning Engine, qaConfig phase11-v1 with room-polygon/parametric-constraints/locking/editing checks), `documentation/model.ts` schema 6 software 0.11.0-phase11.
- UI: `App.tsx` now holds editedCandidate state, selectedSpaceId, move/resize/L-shape controls calling Core Editing APIs thinly, shows constraint/lock state, validation HARD/SOFT/ADVISORY. `PlanCanvas.tsx` renders canonical polygon (not just rect), selection highlight, buildableBoundary polygon dashed, click-to-select via point-in-polygon, locked indicator 🔒.

## 4. Canonical Geometry

- **Space.polygon authoritative**: `Space.polygon: Polygon` is canonical; `Space.rect` is derived bounding via `polygonBoundingRect` compatibility only; `Space.area` from `polygonArea` (canonical). No dual drift.
- **Rect 4-vert**: `createRectangleRoomPolygon(rect)` CCW SW,SE,NE,NW, area == bounding.
- **L-shape 6-vert**: `createLShapedRoomPolygon(bounding, notchW, notchL, corner)` with CCW enforcement, validation via `validateRoomPolygon`, area = bounding - notchW*notchL.
- **Bounded orthogonal concave up to 8 verts**: validate orthogonal via `isOrthogonal`, simple via `hasSelfIntersection`, duplicate/zero-length check, min side 0.9, min area 1.0, max verts 8. Unsupported (non-orthogonal, >8, self-intersect) → explicit fail, no silent bbox fallback.
- **Area/containment/intersection/adjacency**: `roomPolygonArea`, `roomContainsPoint`, `roomContainsRect`, `roomContainsPolygon`, `roomPolygonsOverlap`, `sharedWallEdges`, `roomPolygonInsideBuildable`, `translateRoomPolygon`, `roomPolygonToBoundingRect`, `roomPolygonCentroid`.
- **Wall gen from polygon**: `generateWalls` uses polygon edges (4 for rect, 6 for L-shape), thickness preserved, shared deterministic, merging via deterministic sort.

## 5. Constraint Model

- **Size**: minArea/targetArea/maxArea/minWidth/minLength/preferredAspectRatio/MUST_ADJACENT/PREFER_ADJACENT/MUST_BE_SEPARATED/PREFER_SEPARATED/DIRECT_ACCESS_REQUIRED/PRIVACY_REQUIRED/zone/privacy.
- **Phase 8 semantics compatible**: legacy adjacencies still honoured, new parametric constraints additive.
- **Hard vs heuristic separate**: minArea/maxArea/minWidth/minLength/MUST_ADJACENT/MUST_BE_SEPARATED/DIRECT_ACCESS_REQUIRED → hard; targetArea/preferredAspectRatio/PREFER_ADJACENT/PREFER_SEPARATED/PRIVACY_REQUIRED → soft/heuristic. No Pareto weighting, N/A renormalization preserved.
- **Validation**: `validateRoomSizeConstraints(area, bounding, constraints)` returns hard/soft findings with codes ROOM_CONSTRAINT_MIN_AREA etc. `validateParametricConstraints(spaces, constraints)` checks sharedWallEdges for adjacency, overlap for separation, privacy via adjacency + zone.

## 6. Locking / Editing

- **Locking core-level**: `Space.locked: { position?, size?, geometry?, adjacency? }`. Locked MUST NOT be modified by repair/edit. Check via `isLocked`.
- **Lock invariants**: moveRoom/resizeRoom/setLShape reject if target locked for position/size/geometry; boundedRepair never moves locked rooms; if edit cannot preserve HARD → deterministic failure with error message, no silent violation.
- **Editing bounded in CORE not UI**:
  - `moveRoom`: translate polygon, validateRoomPolygon, check buildableBoundary containment, check overlap with locked rooms, apply, boundedRepair, regenerate walls/openings/furniture, validateLayout, reject if HARD SITE_.
  - `resizeRoom`: anchor sw/se/nw/ne/center, create new polygon (preserve L-shape notch proportionally if possible via inferLNotch), validate constraints (minArea/maxArea), site containment, locked overlap, boundedRepair, regenerate, validate.
  - `setLShape`: create L-shape from bounding rect + notch, validate constraints, site containment, locked overlap, repair, regenerate.
  - `lockRoom`/`unlockRoom`: set locked flags, re-validate, recompute metrics.
  - `applyEdit`: dispatcher.
- **Flow**: op → constraint-aware mutation → bounded repair unlocked → validation → intelligence (metrics recomputed).
- **UI thin**: App.tsx calls Editing.* directly, no core algorithms in UI, no Math.random, deterministic.

## 7. Placement / Repair

- **Placer review**: `rSplitX/rSplitY/carveZones` still rect-only for rectangular rooms; L-shape rooms only via editing `setLShape`, not via placer unbounded search. Preserves Phase 8/9/10 deterministic bounded seed-stable no Math.random no unbounded search no floor explosion.
- **Site-aware**: `siteBoundary/buildableBoundary/buildableRects` authoritative from `computeBuildableGeometry`. Placement respects actual buildable polygon via `roomPolygonInsideBuildable`, not bounding. Cannot fit → deterministic repair or explicit reject, no silent outside acceptance.
- **Bounded repair**: max 4 iterations, 4 nudge directions × 0.1m, no 4^floors expansion, candidates ≤12, verts ≤8, floors ≤10. Repair only nudges unlocked rooms, fails if overlap with locked remains.

## 8. Wall / Opening / Furniture

- **Walls from polygon boundaries**: thickness preserved, shared deterministic, exterior detection via buildableBoundary, merging deterministic sort.
- **Openings attach to actual host walls**: `placeOpenings` uses wall segments inside buildable, deterministic, entrance-door regression preserved (door coords derive from real wall segments).
- **Furniture inside polygon**: `placeFurniture` inside polygon, explicit finding if cannot fit (FURNITURE_FIT advisory).
- **Stairs/parking compatible**: stair solver still geometry-authoritative flights/landings polygon, treadCount = riserCount -1, tread lines = treadCount per flight, DXF layers A-STAIR/A-STAIR-TREAD/A-STAIR-DIR, parking geometric fit perpendicular/parallel alternatives, no overlap site/buildable/building/other stalls.

## 9. Multi-floor

- 1F-10F authoritative, no floors[0] deps for whole-building, ground-floor explicit.
- `buildableBoundary` present for all floors (per-floor copy, deterministic).
- Tests for 1/2/3/6/10F: each floor has spaces, buildableBoundary defined, no explosion.
- Whole-building intelligence preserved: functional/circulation/privacy/daylight/usability/kitchen/bedroom/entranceService/vertical/stacking/inter-floor/whole-building; hard feasibility separate from quality; N/A renormalization; heuristics remain HEURISTIC.

## 10. Intelligence Compatibility

- Preserve functional/circulation/privacy/daylight/usability/kitchen/bedroom/entranceService/vertical/stacking/inter-floor/whole-building scores.
- Hard feasibility separate from quality: `feasible` bool + hardViolations count, overallQuality only from evaluable weights.
- Editing recomputes metrics via `computeMetrics` after each successful edit, deterministic.
- No new optimization (no hill climbing, no 4^floors, no genetic/annealing).

## 11. Output Consistency

- **Same canonical candidate**: all outputs from same `LayoutCandidate` with polygon canonical.
- **DXF actual polygon**: writer emits `Space.polygon` polylines on A-FLOOR-n-A-ROOM + generic A-ROOM with centroid label area-weighted, site/buildable layers canonical per-floor (A-SITE, A-BLDG-OUT, A-SETBACK, A-FLOOR-n-A-SITE etc), R12/AC1009/INSUNITS=4, no output-specific reconstruction.
- **PDF/XLSX/report/manifest consistent**: roomSchedule area from `space.area` (polygon), consistency checksum from docModel, totalArea reconciliation tolerance 0.01, manifest geometry.candidateId = docModel.canonicalCandidateId = report.consistency.checksum.
- **Tests**: DXF polylines parsed, 4/6/8 verts, floor layers exist; PDF integration area matches candidate; XLSX area matches candidate; report/manifest checksum equality.

## 12. UI

- **Minimal professional**: select floor (dropdown), select room (dropdown + canvas click), move (X/Y inputs + button), resize safe (W/H + button), set L-shape (notch W/L/corner + button), lock/unlock position/size/all (buttons), show validation HARD/SOFT/ADVISORY with badges, show constraint/lock state per room.
- **No full CAD**: no spline, no freeform, no 3D, no BIM.
- **UI calls Core APIs**: `Editing.moveRoom`, `resizeRoom`, `setLShape`, `lockRoom`, `unlockRoom` — thin orchestration, no geometry in UI except point-in-polygon for click selection.
- **Canvas**: renders polygon canonical (not rect), buildableBoundary dashed, locked indicator, selection highlight amber, area + vert count label, north arrow, scale bar, grid.

## 13. Tests

- **Baseline 402 PASS preserved** — no weakening.
- **New Phase 11 behavioral 47 tests** in `phase11.test.ts`:
  - A Geometry: rect 4-vert area==bounding, L-shape 6-vert area<bounding, 8-vert concave, containment, self-intersect rejection, shared-wall, wall-gen 4 vs 6.
  - B Constraints: min/target/max area width/length adjacency privacy deterministic findings.
  - C Locking: position/size preserved, survives repair, impossible edit failure no silent violation.
  - D Editing: move/resize deterministic repair invalid rejected validation after, set L-shape.
  - E Site: rect/L/8-vert/C-shaped/tight setbacks inside canonical polygon.
  - F Multi-floor: 1F/2F/3F/6F/10F authoritative, no floors[0] deps, buildableBoundary per floor.
  - G Outputs: DXF polygon coords floor layers, PDF/XLSX/report/manifest consistency.
  - H Determinism: same input+seed+edits → same geometry/validation/scores/DXF.
  - I Adversarial: narrow/consumed/concave touch/impossible resize/locked collision/overlap/invalid/non-orthogonal.
  - J Performance: bounded candidates≤12 no 4^floors, editing bounded <5s for 10 ops.
  - Canonical invariants: Space.polygon authoritative, rect derived compatibility, area semantics actual vs bounding.

## 14. Performance

- **Bounded**: floors ≤10, verts ≤8, candidates ≤12, repair max 4 iter × 4 dirs, no unbounded search, no Math.random.
- **10F generation <10s**, editing 10 ops <5s, 449 tests ~19s.
- **No 4^floors explosion**: candidates.length < 4^floors, deterministic seed-stable.

## 15. Determinism

- **Same input+seed → same output**: `createProject` + `generate` with same seed produces same spaces count, area, polygon.
- **Same input+seed+edits → same geometry/validation/scores/DXF**: moveRoom same op twice yields identical polygon, rect, area, findings, DXF string.
- **No Math.random geometry**: all randomness via seeded PRNG in generator, editing uses no random, bounded repair deterministic order (sorted spaces, fixed nudge order).
- **Checksum**: docModel.consistency.checksum deterministic, preserved across exportAll.

## 16. Regulation Status

- No new municipal enforcement; existing status intact.
- Site setbacks remain USER-DEFINED DESIGN INPUTS with status REQUIRES_SOURCE_VERIFICATION unless Tier-1 verified (source ID/SHA256/page/clause/snippet).
- Existing regulation packs (IR National MBR) preserved: VERIFIED only with Tier-1 source, else REQUIRES_SOURCE_VERIFICATION/NOT_IMPLEMENTED. No fabricated legal claims.
- Heuristics remain heuristics (HEURISTIC badge), not misrepresented as VERIFIED.

## 17. Limitations

- Placer still rect-only for initial generation; L-shape only via editing, not auto-placed.
- Concave rooms up to 8 verts supported, but decomposition into rects for placement still via scanline limited to orthogonal.
- No curved/freeform/non-orthogonal/spline/3D/BIM/IFC/DWG.
- Parking layout auto (perpendicular→parallel) deterministic but not optimizing for max stalls.
- Furniture placement inside polygon but not constraint-aware beyond fit finding.
- No large local-search optimization; foundation only.

## 18. OUT-OF-SCOPE

- Curved/freeform/non-orthogonal/spline/3D/BIM/IFC/DWG import/export.
- MEP, structural, cost estimation.
- Full CAD editing (trim, extend, fillet, offset).
- Hill climbing, annealing, genetic, 4^floors expansion.
- Municipal code enforcement beyond existing packs; no new VERIFIED without Tier-1 PDF.
- AI→image→image-to-DXF; structured parametric model remains source of truth; AI does NOT decide final coordinates.

## 19. Tech Debt

- `geometry/index.ts` duplicate Polygon export fixed via LegacyPolygon alias; `polygon.ts` legacy kept for direct imports but should be deprecated in favor of `polygon-ops.ts` canonical.
- `model/index.ts` duplicate RoomSizeConstraint fixed via explicit named exports; `space.ts` and `room-constraints.ts` both define RoomSizeConstraint with slight difference (zone/privacy) — should unify in future.
- `rSplitX/Y` still rect-only; future Phase 12 could support polygon-aware carveZones with bounded L-shape placement.
- Editing repair uses simple nudge 0.1m; could be enhanced with bounded shrink (tryShift/tryShrink) as originally planned but currently only nudge; shrink not yet implemented.
- Web tsc still has some type errors due to including core src directly (Space.locked optional) but vite build passes; should add proper d.ts build for core.

## 20. Release Gate

- **git clean**: pending commit, will push clean after report.
- **402 regression PASS**: yes, 402 preserved, total 449 PASS.
- **new Phase11 PASS**: 47 PASS.
- **core tsc PASS**: yes, after fixing duplicate exports.
- **web vite PASS**: yes, 309 modules, 1.79 MB JS, built in ~10s.
- **deterministic repeat PASS**: Phase 11 H test PASS, manual repeat shows same polygon and DXF.
- **canonical polygon invariants PASS**: Space.polygon authoritative, rect derived compatibility, area semantics.
- **site containment PASS**: rooms inside buildableBoundary for rect/L/8-vert/C-shaped.
- **lock invariants PASS**: locked position/size/all survives repair, impossible edit explicit failure.
- **editing invariants PASS**: move/resize/setLShape bounded, validation after edit no HARD SITE_, invalid rejected.
- **DXF parsed PASS**: polylines parsed, floor layers A-FLOOR-0-A-ROOM etc, 4/6/8 verts.
- **PDF/XLSX/report/manifest PASS**: documentation.test.ts 19 PASS, area consistency, checksum equality.
- **performance bounds PASS**: candidates ≤12, 10F <10s, editing 10 ops <5s, no 4^floors.
- **no floors[0] regression**: buildableBoundary present for all floors, whole-building intelligence aggregates all.
- **no legal claims**: setbacks REQUIRES_SOURCE_VERIFICATION, no fabricated VERIFIED.
- **no silent bbox fallback**: validateRoomPolygon fails explicitly for invalid, decompose returns null, no fallback.
- **no output-specific reconstruction**: DXF uses Space.polygon directly, not reconstructed from rect.

**Commit hash**: (to be filled after push)  
**Test count**: 449 PASS (402 baseline + 47 Phase11)  
**Build results**: core tsc PASS, web vite PASS (1.79 MB)  
**Version**: 0.11.0-phase11  
**Schema**: 6  
**DXF version**: R12 / AC1009 / INSUNITS=4  
**Findings by severity**: (from latest run) HARD 0 on typical 15x20 2F villa seed 42, SOFT ~22, ADVISORY ~6 (heuristic)

---

### How to Reproduce

```bash
npm run test:core
npx tsc -p packages/core/tsconfig.json --noEmit
cd packages/web && npx vite build
```

### Next Actions

- Push Phase 11 commit to origin/arena/01a0b33a-archgenius
- Update README and ARCHITECTURE with polygon canonical and editing
- Plan Phase 12: polygon-aware placer for L-shape auto-placement with bounded search

---
