# PHASE 9.1 HARDENING ADDENDUM

**Baseline:** `5ecb044` — Phase 9 Whole-Building Multi-Floor Intelligence  
**Final:** Phase 9.1 hardening patch — close final QA findings  
**Date:** 2026-09-18  
**Branch:** `arena/01a0b33a-archgenius`

## Findings Closed

### 1. Legacy Scoring Scope Debt — CLOSED
- **Audit finding:** `packages/core/src/intelligence/scoring.ts:97-101` contained legacy `Ground Floor Intelligence` and `...not evaluated` path.
- **Action:** Removed `floorsCount` param, replaced with explicit `intelligenceScope: string` param, default `Floor Intelligence`. Deleted legacy if/else producing contradictory ground-floor-only scope.
- **Single authoritative scope:** `Floor N Intelligence` (`Floor 0 Intelligence — Ground Floor` for ground, `Floor N Intelligence` for N>0) and `Whole-Building Intelligence — N floors` / `...avg floor quality`.
- **Search:** `grep -Rn "Ground Floor Intelligence"` production now yields zero hits except comments about removal and test assertions that it must NOT appear.
- **Regression test:** `phase91.test.ts` — multi-floor evaluation never exposes legacy string, asserts `not.toContain('not evaluated')`, `not.toBe('Ground Floor Intelligence')`, scope correctness for 1F/2F/3F/6F/10F.

### 2. DXF Generic Floor-0 Layers — CLOSED
- **Current behavior preserved:** `A-FLOOR-{n}-{base}` authoritative, generic base layers for floor 0 for backward compat.
- **Documentation:** Updated `README.md` with authoritative namespace, backward compat explanation, multi-floor transformation `FLOOR_GAP_M=4m`, `floorOffset(fi)=fi*(maxH+4)`, vertical presentation offset not architectural, no duplicated geometry.
- **Optional flag:** Added `DXFOptions.includeGenericLayers?: boolean` default `true` in `writeDXF(candidate, projectName, options)`. When `false`, only authoritative layers emitted. Clean, no architectural complexity.
- **Regression:** `phase91.test.ts` proves authoritative layers present in both modes, generic optional, `withGeneric.length > withoutGeneric.length`, checksum consistency, no second geometry.
- **Writer.ts:** All generic emissions now `if (fi===0 && includeGenericLayers)`, plus dims functions accept flag.

### 3. Multi-Floor Footprint Reconciliation — CLOSED
- **Audit:** `builder.ts footprintVsRooms` used `floors[0]` classified LOW, intentionally ground-floor-specific.
- **Action:** Renamed internal vars to `groundFootprint`, `groundRoomsSum`, kept legacy return names for backward compat but added explicit explanations:
  - `grossVsComponents` — whole-building
  - `footprintVsRooms` — ground-floor-specific
  - Explanations: `Ground floor footprint vs ground floor rooms: ... — ground-floor-specific reconciliation, not whole-building`
- **Test:** `phase91.test.ts` proves ground rooms sum != total room area for multi-floor, `footprintVsRooms.roomsSum` == ground only, `grossFloorArea` > `buildingFootprint` for multi-floor, explanations contain `whole-building` and `ground-floor-specific`.

### 4. PDF Whole-Building Drawing Number — CLOSED
- **Before:** `AG-${project.id}-${strategy}-F0` misleading F0 for whole-building.
- **After:** `AG-${candidate.id}-WB` deterministic whole-building identifier. Per-floor pages: `AG-{candidateId}-WB-F{level}` via existing `${drawingNumber}-F{level}` logic.
- **Example:** `AG-cand-alternative-zoning-42-WB`, `AG-cand-alternative-zoning-42-WB-F0`, `...-F1`
- **Determinism:** Same seed → same candidateId → same drawingNumber.
- **Test:** `phase91.test.ts` asserts `drawingNumber` contains `-WB`, not `-F0`, equals `AG-${candidate.id}-WB`, deterministic repeat.

### 5. XLSX Stacking Details — CLOSED
- **Before:** `10_Stacking` placeholder strengths/weaknesses slice 0..3.
- **After:**
  - `stacking.ts`: details sorted deterministically, bounded 100 not 20, preserves evidence for 10F (9 pairs).
  - `model.ts`: `stacking.details?` added to `IntelligenceModel`.
  - `builder.ts`: includes `details` with rounded overlap, aligned, reason.
  - `xlsx.ts`: Sheet `10_Stacking` columns `From Level, To Level, Category, From Type, To Type, Overlap, Aligned, Score Contribution, Is Heuristic, Reason` — structured rows from actual `stacking.details`, fallback with explicit limitation label if details unavailable.
  - For N floors, no arbitrary truncation to 20.
- **Test:** `phase91.test.ts` checks details defined, structured fields, deterministic ordering, bounded ≤100, XLSX contains sheet.

## Files Changed

- `packages/core/src/intelligence/scoring.ts` — removed legacy scope, single authoritative scope param
- `packages/core/src/intelligence/evaluation.ts` — pass explicit floorScope `Floor 0 Intelligence — Ground Floor`, remove override hack
- `packages/core/src/intelligence/types.ts` — comments updated to new valid scopes
- `packages/core/src/intelligence/intelligence.test.ts` — updated `computeQualityMetrics` calls to new signature
- `packages/core/src/intelligence/stacking.ts` — sorted details, bounded 100 not 20
- `packages/core/src/documentation/model.ts` — added `details?` to stacking
- `packages/core/src/documentation/builder.ts` — ground footprint reconciliation explicit labeling, WB drawingNumber `AG-${candidate.id}-WB`
- `packages/core/src/documentation/xlsx.ts` — structured stacking evidence, category, score contribution, heuristic, limitation label
- `packages/core/src/dxf/writer.ts` — documented authoritative vs generic layers, FLOOR_GAP_M, presentation offset, optional `includeGenericLayers` flag, all generic emissions respect flag
- `packages/core/src/pipeline.ts` — exportDXF/exportAll accept DXFOptions, default generic true
- `README.md` — comprehensive DXF multi-floor layers documentation, scopes, reconciliation, PDF numbers, XLSX stacking, determinism, testing, regulation discipline
- `packages/core/src/phase91.test.ts` — new 18 tests for hardening
- `PHASE_9.1_ADDENDUM.md` — this file

## Tests

- **Total:** 328 (310 baseline + 18 new Phase 9.1)
- **Passed:** 328
- **Failed:** 0
- **Categories covered:** obsolete scope cannot reappear, multi-floor scope correctness, DXF generic layer backward compat + no duplicate geometry, explicit footprint reconciliation scope, PDF drawing number semantics, XLSX stacking details, determinism and performance 1F/2F/3F/6F/10F, cross-output consistency

## Core tsc

- `npx tsc -p packages/core/tsconfig.json --noEmit` — PASS (0 errors)

## Web Build

- `npm run build --workspace=@archgenius/web` — PASS, 301 modules transformed, built in ~9s

## 1F/2F/3F/6F/10F Verification

```
1F floorCount 1 perFloor 1 overall 0.958 avg 0.930 evaluable 0.920 contribSumNoOverall 0.952 scopes Floor 0 Intelligence — Ground Floor WB Whole-Building Intelligence — 1 floors feasible true
2F floorCount 2 perFloor 2 overall 0.854 avg 0.841 ... scopes Floor 0 Intelligence — Ground Floor|Floor 1 Intelligence WB Whole-Building Intelligence — 2 floors feasible true
3F floorCount 3 perFloor 3 overall 0.829 avg 0.810 ... scopes Floor 0|Floor1|Floor2 WB Whole-Building Intelligence — 3 floors feasible true (area-efficiency)
6F floorCount 6 perFloor 6 overall 0.841 avg 0.809 ... feasible false hard 2 (expected for 6F with 15x20 tight)
10F floorCount 10 perFloor 10 overall 0.849 avg 0.809 ... feasible false hard 2 (technical max)
```
- Gen time 9-37ms, eval time 2-7ms, candidates ≤10 bounded, no combinatorial explosion.
- Deterministic repeat: seed 42 identical candidateId, overallQuality, drawingNumber `AG-cand-alternative-zoning-42-WB`.

## DXF/PDF/XLSX/report/manifest Consistency

- `docModel.intelligence.floorCount == candidate.floors.length == manifest.intelligence.floorCount == report.wholeBuilding.floorCount`
- `perFloor.length == floorCount` for all outputs
- `overallQuality` rounded 3 decimals consistent across doc/report/manifest
- DXF: contains `A-FLOOR-0-A-WALL-EXT` always, `A-FLOOR-1-...` for 2F+, `FLOOR` labels, `STAIR STACK — N FLOORS — Whole-Building`, generic optional via flag, no second geometry
- PDF: multi-page per floor, title `Ground Floor` / `Floor N`, drawing `AG-...-WB-F{level}`, whole-building summary page0, heuristic badge
- XLSX: 10 sheets, `07_Intelligence` whole-building, `08_PerFloor` Floor N scopes, `09_Vertical` connected/disconnected, `10_Stacking` structured details category/overlap/aligned/reward/penalty/heuristic
- Checksum: `doc.consistency.checksum == manifest.consistency.checksum == manifest.generation.checksum`

## Remaining Findings Classified

- **CRITICAL:** 0
- **HIGH:** 0
- **MEDIUM:** 0 (previous MEDIUM legacy scope dead code and generic layer confusion closed)
- **LOW:** 2
  - `footprintVsRooms` still uses `floors[0]` internally but now explicitly labeled ground-floor-specific and documented; not accidental limitation but intentional.
  - PDF title block still references drawingNumber `AG-...-WB` base, per-page suffix adds `-F{level}`; some consumers may expect `F0` in base but now WB is clearer.
  - Stacking details bounded 100, for extremely large N=10 with many wet spaces could still truncate beyond 100, but deterministic and labeled; acceptable for V1.

## Final Status

**VERIFIED WITH LOW FINDINGS** — All mandatory hardening items cleanly closed, regression green, builds PASS, determinism verified, no new legal claims, no Phase 10 capabilities added.

## Notes

- No fabricated legal claims, no municipality approval claims.
- Offline-first, deterministic core preserved.
- Internal meters, DXF mm INSUNITS=4, tolerance 1e-6m preserved.
- Stair tread-count convention, geometry-authoritative stairs preserved.
- Search bounded, no brute force.
