# Phase 9 — Whole-Building Multi-Floor Architectural Intelligence & Optimization

**Date:** 2026-09-18  
**Branch:** arena/01a0b33a-archgenius  
**Baseline Commit:** 1b7300e (docs: add phase 8 hardening release gate report)  
**Final Commit:** Phase 9 implementation (this report)  
**Version:** 0.9.0-phase9  
**Schema Version:** 4  
**Tests:** 310 PASS (263 Phase 8 + 47 Phase 9)  
**Build:** Core tsc PASS, Web Vite PASS  

---

## 1. Objective

Upgrade from "multi-floor geometry with Ground-Floor-only intelligence" to "whole-building multi-floor architectural intelligence and optimization". Floor count must become first-class deterministic input propagating Input→Project model→Candidate generation→Geometry→Per-floor eval→Vertical eval→Whole-building scoring→Optimization→DXF→PDF→XLSX→Report→Manifest→UI, with validation rejecting invalid counts and explicit technical max, no UI-only disconnected count.

---

## 2. Floor Count First-Class Input

- **Validation:** `FLOOR_COUNT_MIN=1`, `FLOOR_COUNT_MAX=10` defined in `generator/generator.ts` and `model/building.ts`.
- **Checks:** required, finite, integer, >=1, <=10 technical maximum, deterministic error messages.
- **Propagation:** UI `floors` input (1..10) → `ProjectInput.building.floors` → `validateInput()` → `createProject()` → `generate()` loop `for level 0..floors-1` → `Floor[]` → evaluation → documentation → DXF/PDF/XLSX/Report/Manifest/UI.
- **Invalid cases:** 0 → "must be >=1", 11 → "technical maximum", 2.5 → "must be integer", NaN → "finite number", null → "required".
- **UI:** Professional input with label "Floors (1..10) *", technical max note, multi-floor warning when >1, generate button shows "Generate NF Layout →".

---

## 3. Whole-Building Data Model

```
Building {
  Floor[] {
    level, elevation, footprint, spaces, walls, openings, furniture,
    parkingStalls, stairs, intelligence: FloorIntelligence {
      quality: QualityMetrics (8 metrics + overall + scope + evaluableWeightsSum),
      contributions, overallQuality, strengths/weaknesses, tradeOff, detailed 8 modules
    }
  },
  VerticalRelationships {
    stairs: Stair[] per floor,
    vertical access: VerticalCirculationEvaluation {
      score, isConnected, floorConnectivity, stairContinuityScore,
      stairAlignmentScore, verticalAccessPath, disconnectedFloors,
      stairCount, findings, strengths/weaknesses, isHeuristic=true
    },
    stacking: StackingEvaluation {
      score, kitchenStackingScore, bathroomStackingScore,
      wetAreaClusteringScore, circulationAlignmentScore,
      serviceZoneAlignmentScore, details overlap, findings, strengths/weaknesses, isHeuristic
    },
    inter-floor: InterFloorEvaluation {
      score, entranceToVerticalScore, publicPrivateTransitionScore,
      bedroomDistributionScore, serviceDistributionScore,
      sharedCirculationScore, privacyTransitionScore, floorAccessScore,
      findings, strengths/weaknesses, isHeuristic
    }
  },
  wholeBuilding: WholeBuildingQuality {
    floorCount, perFloor[], avgFloorQuality, vertical, stacking,
    interFloor, overall, contributions, strengths/weaknesses, tradeOff, scope
  }
}
```

- **Canonical geometry single source of truth:** `LayoutCandidate.floors[]` geometry drives all intelligence, DXF, PDF, XLSX, report, manifest. No second geometry.

---

## 4. Per-Floor Intelligence

- **Reuse:** All Phase 8 modules (functional, circulation, privacy, daylight, furniture, kitchen, bedroom, entrance/service) work on every floor.
- **Evaluation:** `evaluateSingleFloor()` per floor, returns `FloorIntelligence` with quality (8 metrics nullable kitchen + overall + scope + evaluableWeightsSum), contributions (metric, raw nullable, normalized, weight 0 when N/A, weightedScore, range [0,1], reason, isHard false, isHeuristic true, isEvaluable), strengths/weaknesses, tradeOff, detailed 8 modules.
- **Scope:** `Floor 0 Intelligence — Ground Floor Intelligence` for level 0, `Floor N Intelligence` for N>0, contains Floor N identifier.
- **N/A explicit:** Kitchen returns score null, isEvaluable false, reason "N/A — Not Evaluated" when insufficient geometry, weight 0, renormalization preserves Q=Σ(Mi×Wi)/Σ(evaluable Wi).
- **No floors[0] dependence:** Tests verify perFloor length == floorCount for 1F/2F/3F, all floors have quality metrics, deterministic independent.

---

## 5. Vertical Circulation Intelligence

- **Module:** `vertical-circulation.ts`
- **Checks:** stair existence where required (floorCount>1), continuity between floors, floor-to-floor connectivity, landing/flight consistency via valid flag, vertical accessibility path from ground, disconnected floors list, gross penalties (too many stairs, invalid stairs).
- **Scores:** connectivityScore (connected pairs / total pairs), stairContinuityScore, stairAlignmentScore via footprint overlap area ratio, stairValidityScore, final score = connectivity*0.4 + continuity*0.2 + alignment*0.2 + validity*0.2 - penalty, clamped 0..1.
- **Findings:** `VERT_CIRC_MISSING_STAIR` soft, `VERT_CIRC_MISALIGNED` advisory, `VERT_CIRC_INVALID_STAIR` soft, all HEURISTIC.
- **HEURISTIC vs VERIFIED:** Separate, isHeuristic=true, not legal, strengths/weaknesses.
- **Deterministic:** Pure function, no Math.random().

---

## 6. Vertical Stacking Intelligence

- **Module:** `stacking.ts`
- **Checks:** kitchen over kitchen, bathroom over bathroom, wet-area clustering (bathroom, wc, kitchen), circulation alignment (corridor, stair-hall), service zone alignment, inefficient displacement.
- **Overlap:** Uses `rOverlapArea` to compute footprint overlap ratio between wet areas across consecutive floors.
- **Scores:** kitchenStackingScore, bathroomStackingScore, wetAreaClusteringScore, circulationAlignmentScore, serviceZoneAlignmentScore, overall score = weighted average, rewards aligned, penalties misaligned.
- **Findings:** `STACKING_MISALIGNED_KITCHEN`, `STACKING_MISALIGNED_BATHROOM`, etc., HEURISTIC, with explanations.
- **Deterministic:** Pure, deterministic score change when displaced.

---

## 7. Inter-Floor Functional Relationships

- **Module:** `inter-floor.ts`
- **Checks:** entrance→vertical circulation→upper zones distance, public/private transition between floors, bedroom distribution across floors, service distribution, shared circulation efficiency, privacy transition floor-to-floor, floor access score.
- **Deterministic only:** Derived from canonical geometry, no speculative frameworks.
- **Scores:** entranceToVerticalScore, publicPrivateTransitionScore, bedroomDistributionScore, serviceDistributionScore, sharedCirculationScore, privacyTransitionScore, floorAccessScore, overall weighted.
- **HEURISTIC:** isHeuristic=true.

---

## 8. Whole-Building Quality

- **Preserve Q=Σ(Mi×Wi) with N/A excluded renormalized:** `computeQualityMetrics` still does Σ(evaluable*weight)/Σ(evaluable weights), kitchen N/A weight 0, evaluableWeightsSum.
- **FloorQuality[]:** perFloor[] each with overallQuality, quality metrics, contributions, tradeOff.
- **VerticalQuality:** vertical.score, stacking.score, interFloor.score.
- **WholeBuildingQuality:** `overall = avgFloorQuality.overall*0.6 + vertical*0.2 + stacking*0.12 + interFloor*0.08`, clamped 0..1, no double-counting (per-floor metrics weighted by 0.6*baseWeight, vertical/stacking/interFloor separate, overall contribution weight 1).
- **Explainable contributions:** Each contribution exposes metric, score, weight, raw, evaluability, heuristic/legal, explanation. Whole-building contributions include functional, circulation, privacy, daylight, usability, kitchen (N/A handling), bedroom, entranceService (each weight = baseWeight*0.6), verticalCirculation (0.2), stacking (0.12), interFloor (0.08), overall (1).
- **evaluableWeightsSum:** Present at per-floor quality and whole-building.

---

## 9. Optimization — Whole-Building Ranking

- **Hard feasibility separate:** `isFeasible()` counts hard violations from all floors, feasible false if hard>0, even if heuristic high.
- **Ranking:** Hard-first (feasible first, hardViolations ascending), then whole-building overallQuality descending, deterministic tie-breaking by candidateId.
- **DiverseTop:** Labels reflecting real behavior — "Vertical / stacking efficient" when vertical>=0.85 && stacking>=0.8, "Area / efficiency oriented", "Privacy oriented", etc., with reason containing metric values, not falsely universal best.
- **Determinism:** Same input+seed → same ranking, candidateId, overallQuality.
- **Bounded:** Candidate count = strategies (4) not 4^floors, no combinatorial explosion.

---

## 10. Candidate Generation — Multi-Floor Coherence

- **Strategies:** 4 remain functional: area-efficiency, functional-circulation, daylight-orientation, alternative-zoning.
- **Coherence:** Same strategy applied to all floors, complete-building candidates, deterministic combination logic, bounded.
- **Handles 1F/2F/3F+ without hard-coded 2F/3F logic:** Loop over floorCount, no if floors==2 special case, scales to 10.
- **Stair logic:** `needStairForFloor` places stair on every floor below top, solver attempts U/L/straight, fallback with attempts[] and HARD finding when no stair fits, not plausible-looking invalid stair.
- **Performance:** Instrumented candidate count, floor count, eval time, gen time. For 3F: candidates=1-4, genTime ~10ms, evalTime ~2ms, avgEval ~2ms, bounded.

---

## 11. Multi-Floor Hard Validation Building-Wide

- **Statuses:** VERIFIED, REQUIRES_SOURCE_VERIFICATION, NOT_IMPLEMENTED, DEPRECATED preserved.
- **Severities:** HARD, SOFT, ADVISORY preserved.
- **Scope:** All floors validated, findings from all floors aggregated, hard feasibility separate.
- **Hard validation:** Building-wide, not per-floor only, scope noted in intelligenceScope and outputs.

---

## 12. Documentation/Outputs — Whole-Building Exposure

- **Model:** `DOCUMENTATION_SCHEMA_VERSION` 3→4, `SOFTWARE_VERSION` 0.8.1-phase8-hardened→0.9.0-phase9, `IntelligenceModel` extended with floorCount, perFloor[], vertical, stacking, interFloor, wholeBuilding.
- **Builder:** revision 1.0.0-phase9, qaConfig phase9-v1 17 checks (8 Phase 8 + vertical, stacking, inter-floor, whole-building), xlsx sheets 7→10, intelligence mapping perFloor with rounding, vertical/stacking/interFloor/wholeBuilding sections with rounding and HEURISTIC preservation.
- **Manifest:** intelligence extended with floorCount, perFloor, vertical, stacking, interFloor, wholeBuilding, buildManifest populates them.
- **PDF:** Rewritten multi-page: one page per floor sorted by level, title block includes floorLabel, page N/M, Whole-Building Intelligence — N floors, per-page transform from floor footprint, footer floor area, per-floor intelligence line with vertical/stacking/interFloor percentages + HEURISTIC badge, whole-building summary on page 0.
- **XLSX:** 07_Intelligence whole-building (overall, avgFloor, vertical, stacking, interFloor, contributions, strengths/weaknesses, tradeOff, scope, evaluable sum), 08_PerFloor (floorLevel, scope, overallQuality, 8 metrics, evaluableWeightsSum, tradeOff), 09_Vertical (vertical circulation, stacking, interFloor scores, connectivity, alignment, disconnected, findings, heuristic), 10_Stacking (details, strengths/weaknesses).
- **Report:** `QAReport` extended with wholeBuilding summary (floorCount, perFloor overall, vertical connectivity, stacking scores, interFloor, wholeBuilding overall, scope), version 1.0.0-phase9-report.
- **DXF:** R12 ASCII, deterministic, floor identity preserved via layers `A-FLOOR-{n}-{base}` for all floors, generic layers for floor 0 backward compat, vertical offset per floor (stacked north with gap 4m), all floors represented, no second geometry, vertical markers stair stack, room labels `[F{n}]`, floor label text `FLOOR {n} — Level {level} — {elevation}m elev`.
- **No silent Ground-Floor-only when multi-floor:** All outputs explicitly expose floor count, per-floor, vertical, whole-building, scope, N/A, evaluableWeightsSum, heuristic labels, hard validation scope All floors.

---

## 13. UI — Professional Floor-Count Input + Whole-Building Display

- **Floor-count input:** Professional, label "Floors (1..10) *", min 1 max 10, validated 1..10, note "First-class input, validated deterministic, technical max 10", multi-floor warning when >1.
- **Show:** Floor count, candidate, per-floor/whole/vertical intelligence, hard validation, heuristic badges, maintain responsive Phase 8 hardening.
- **Preview:** `PlanCanvas` now takes `floorIndex` prop, floor selector dropdown when candidate has >1 floor, shows floor N spaces, stairs, labels `[F{n}]`, north arrow, scale bar, floor count in title.
- **Metrics strips:** Usable area, circulation, room area dev, daylight, parking + whole-building strip: Whole, Avg Floor, Vertical (with connected ✓/✗), Stacking, InterFloor, Kitchen N/A, Floors, Stairs + per-floor quality strip.
- **Right panel:** Validation scope All N floors, whole-building intelligence section with weighted sum explanation Q=Σ(Mi×Wi) no double-counting, vertical/stacking/interFloor details, strengths/weaknesses, trade-off, per-floor intelligence list with View button, spaces list per selected floor.

---

## 14. Testing — Phase 9 Categories

- **A Existing 263+:** 263 Phase 8 tests still PASS (now 310 total with Phase 9).
- **B Floor-count:** 1F/2F/3F/10F valid, 0/11/non-integer/NaN invalid deterministic rejection.
- **C Per-floor:** Every floor evaluated, no floors[0] dependence, each floor has metrics/findings/strengths/weaknesses, N/A handling, intelligenceScope contains Floor N.
- **D Vertical:** Connected (stairs exist), disconnected (remove stair → disconnected + finding), inconsistent alignment (displace → lower alignment), isHeuristic, strengths/weaknesses.
- **E Stacking:** Aligned vs displaced deterministic score change, deterministic re-run same score, isHeuristic, kitchen/bathroom scores.
- **F Whole-building:** Scoring propagation (overall = avg*0.6+vertical*0.2+stacking*0.12+interFloor*0.08), N/A handling, no double count (sum without overall =1.0), per-floor overall propagates to avgFloorQuality.
- **G Optimization:** Whole-building ranking, hard feasibility separate, deterministic tie-breaking.
- **H Seed determinism:** Same input+seed → same output (floors, per-floor, vertical, stacking, whole-building), different seeds deterministic but may differ.
- **I Cross-output consistency:** Doc=report=manifest agree on floorCount, perFloor, vertical, stacking, whole-building, overallQuality; DXF contains floor identity layers for all floors, no second geometry; PDF multi-page per floor, XLSX 10 sheets, report whole-building, no silent ground-floor-only.
- **J Adversarial:** Worsen floor → quality not improve, worsen vertical → score decrease, worsen stacking → decrease, remove upper access → finding, improve stacking → improve.
- **K E2E:** 1F/2F/3F/multi-bedroom/small/no parking/deterministic repeat all PASS, performance instrumentation bounded (candidates ≤10, evalTime <5s).
- **Performance:** Bound combinatorial explosion (same strategy all floors, not 4^floors), instrument candidate count, floor count, eval time, gen time, avgEval.

---

## 15. Regulation Discipline Preserved

- **No fabricated legal claims:** Use "REQUIRES SOURCE VERIFICATION"/"Professional Review Required"/"NOT_IMPLEMENTED" for unknowns, heuristics never legal.
- **Heuristics:** Vertical circulation, stacking, inter-floor all marked isHeuristic=true, HEURISTIC badge in UI/PDF/XLSX/report.
- **Verified source system:** 9 rules VERIFIED per Phase 5.2 with primary PDFs, 2 municipal REQUIRES_SOURCE_VERIFICATION, 3 NOT_IMPLEMENTED with Tier-1 backing, authoritative.
- **Hard/soft/advisory separation:** Preserved.

---

## 16. Determinism & Offline-First

- **Deterministic core:** Same input+seed → same output (candidateId, floors count, per-floor quality, vertical, stacking, whole-building, DXF, PDF size approx, XLSX sheets, manifest checksum).
- **No Math.random():** mulberry32 seed, pure functions, stable IDs, reproducible outputs.
- **Offline-first:** No network, no AI→image→image-to-DXF, structured parametric model source of truth.

---

## 17. Files Changed

- `packages/core/src/model/building.ts` — BUILDING_FLOORS_MIN/MAX 1..10, comment first-class.
- `packages/core/src/generator/generator.ts` — FLOOR_COUNT_MIN/MAX, validateInput integer/finite/required/technical max, deterministic errors.
- `packages/core/src/intelligence/types.ts` — FloorIntelligence, VerticalCirculationEvaluation, StackingEvaluation, InterFloorEvaluation, WholeBuildingQuality, extended CandidateEvaluation.
- `packages/core/src/intelligence/evaluation.ts` — evaluate all floors, evaluateFloor exported, per-floor scope Floor N, whole-building via computeWholeBuildingQuality, backward compat ground floor detailed.
- `packages/core/src/intelligence/vertical-circulation.ts` — new, deterministic vertical analysis.
- `packages/core/src/intelligence/stacking.ts` — new, deterministic stacking.
- `packages/core/src/intelligence/inter-floor.ts` — new, deterministic inter-floor.
- `packages/core/src/intelligence/whole-building.ts` — new, whole-building quality model, no double-counting, explainable contributions.
- `packages/core/src/intelligence/comparison.ts` — whole-building diffs, per-floor diffs, any cast for extended metric names.
- `packages/core/src/intelligence/scoring.ts` — already supports N/A, no change needed for whole-building (uses DEFAULT_WEIGHTS).
- `packages/core/src/documentation/model.ts` — schema v4, software 0.9.0-phase9, IntelligenceModel whole-building.
- `packages/core/src/documentation/builder.ts` — revision phase9, qaConfig 17 checks, xlsx 10 sheets, intelligence mapping whole-building.
- `packages/core/src/documentation/manifest.ts` — extended intelligence with floorCount/perFloor/vertical/stacking/interFloor/wholeBuilding.
- `packages/core/src/documentation/pdf.ts` — multi-page per-floor loop, title floorLabel, whole-building summary, per-floor intelligence line.
- `packages/core/src/documentation/xlsx.ts` — 07_Intelligence whole-building, 08_PerFloor, 09_Vertical, 10_Stacking.
- `packages/core/src/documentation/report.ts` — wholeBuilding summary, version phase9.
- `packages/core/src/dxf/writer.ts` — multi-floor with floor-specific layers A-FLOOR-{n}-{base}, vertical offset, all floors represented, vertical markers, no second geometry.
- `packages/web/src/App.tsx` — floor-count 1..10 professional input, per-floor/whole/vertical display, floor selector, whole-building metrics.
- `packages/web/src/PlanCanvas.tsx` — floorIndex prop, per-floor preview.
- `packages/core/src/documentation/documentation.test.ts` — XLSX 10 sheets, manifest schema v4.
- `packages/core/src/intelligence/intelligence.test.ts` — Phase 9 upgrade expectations (whole-building scope, weights, per-floor).
- `packages/core/src/phase9.test.ts` — new 47 tests covering B-K.
- `PHASE_9_REPORT.md` — this report.

---

## 18. Validation & Verification

- **Tests:** 310 PASS (17 test files), 0 FAIL.
- **Build:** Core tsc PASS, Web Vite PASS (301 modules, 1.7MB js, 14.9kB css).
- **DXF:** R12 ASCII, INSUNITS=4 mm, layers A-WALL-EXT, A-FLOOR-0-A-WALL-EXT etc., all floors represented, stair stack marker.
- **PDF:** Multi-page, %PDF- header, size >1000, per-floor pages, whole-building summary.
- **XLSX:** ZIP header PK, 10 sheets, size >5000, per-floor/vertical/stacking.
- **Cross-output:** docModel, report, manifest agree on floorCount, perFloor, vertical, stacking, whole-building, checksum, roomAreas.
- **Determinism:** Seed 42 repeat identical candidateId, overallQuality, floorCount, perFloor quality, vertical, stacking, whole-building, checksum.
- **Performance:** 3F candidates 1-4, genTime ~10ms, evalTime ~2ms, avgEval ~2ms, bounded, no explosion.

---

## 19. Risks & Mitigations — Closed

- **Combinatorial explosion:** Mitigated by same strategy all floors, candidate count bounded ≤10, measured.
- **Double-counting:** Mitigated by per-metric weighted 0.6*base + vertical 0.2 + stacking 0.12 + interFloor 0.08 =1.0, no avgFloorQuality double count, explainable contributions.
- **Accidental floors[0]:** Audited, evaluation now loops all floors, documentation builder loops all floors, PDF loops all floors, DXF loops all floors, tests verify every floor.
- **Overengineering inter-floor:** Only deterministic relationships from geometry.
- **Invented legal:** Heuristics labeled HEURISTIC, not legal, statuses preserved.
- **Breaking 263 tests:** Preserved, updated only where expected (schema v4, whole-building scope), 310 PASS.
- **Performance:** Bounded, instrumented.
- **DXF/PDF/XLSX consistency:** All expose floor count, per-floor, vertical, whole-building, scope, N/A, evaluable sums, heuristic labels.
- **Seed determinism:** Pure functions, no random, tested.
- **UI misleading:** Floor-count professional input, clear per-floor/whole/vertical, heuristic badges, responsive preserved.

---

## 20. Conclusion & Next Steps

Phase 9 upgrade complete: floor count first-class deterministic input 1..10 propagating Input→Project→Candidate→Geometry→Per-floor→Vertical→Whole-building→Optimization→DXF→PDF→XLSX→Report→Manifest→UI, whole-building data model Building { Floor[] {spaces,walls,openings,furniture,circulation,intelligence}, VerticalRelationships {stairs, vertical access, stacking, inter-floor} }, canonical geometry single source, per-floor intelligence all 8 modules every floor N/A explicit, vertical circulation HEURISTIC with connectivity/continuity/alignment/disconnected/penalties, stacking HEURISTIC with kitchen/bathroom/wet/circulation alignment, inter-floor deterministic, whole-building quality Q=Σ(Mi×Wi) renormalized no double-counting explainable, optimization whole-building ranking hard feasibility separate deterministic tie-breaking, DXF R12 multi-floor floor identity layers all floors no second geometry, PDF multi-page per-floor, XLSX 10 sheets, report/manifest whole-building, UI professional floor-count input per-floor/whole/vertical display heuristic badges responsive, testing A-K PASS, performance bounded, regulation discipline preserved.

**Next:** Phase 10 — BIM/IFC export, cost estimation, energy, or Iranian code expansion with Tier-1 sources.

---

*End of Phase 9 Report — Whole-Building Multi-Floor Intelligence & Optimization — v0.9.0-phase9 — Schema v4 — 310 tests PASS*
