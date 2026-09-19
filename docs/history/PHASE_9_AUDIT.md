# Phase 9 — Mandatory Pre-Implementation Audit

**Date:** 2026-09-18
**Branch:** arena/01a0b33a-archgenius
**Baseline Commit:** 1b7300e (docs: add phase 8 hardening release gate report), previous bb38734
**Verified Baseline:** 263 tests PASS, Core tsc PASS, Web Vite build PASS, DXF/PDF/XLSX verified, deterministic seed, cross-output consistency, adversarial regression, multi-floor geometry exists, Phase 8 intelligence Ground-Floor-only

---

## 0. Documents Read

- HARDENING_REPORT.md — kitchen N/A renormalization, multi-floor transparency scope string, schema v3, heuristic badges, seed 42, graph.ts shared utils, 263 tests
- docs/PHASE_8_REPORT.md — 8 intelligence modules, scoring weights sum 1.0, Q=Σ(Mi*Wi), hard feasibility separate, diverseTop labels, explainable evaluation, determinism
- docs/ARCHITECTURAL_INTELLIGENCE.md (if present) — metrics/scoring/normalization/weights/heuristics/hard constraints/comparison/determinism/limitations
- ARCHITECTURE.md — monorepo core/web, pipeline ProjectInput → buildableArea → space program → candidates → scoring → DXF/PDF/XLSX/report/manifest, deterministic slice-based partitioning, layer convention, EPS 1e-6, mulberry32 seed
- DECISIONS.md — monorepo, no image-to-CAD, DXF R12 from scratch, coordinate system meters internal, layout generation deterministic slice, validation HARD/SOFT/ADVISORY, regulation packs versioned, units, web stack, testing
- ROADMAP.md — Phase 1-6 done, Phase 7-8 done, non-goals image/PDF/DXF import, raster-to-CAD, 3D/BIM
- Intelligence types/evaluation/scoring/optimization: types.ts, scoring.ts, evaluation.ts, comparison.ts, optimization/index.ts, adjacency.ts, circulation.ts, privacy.ts, daylight.ts, furniture.ts, kitchen.ts, bedroom.ts, entrance.ts, graph.ts, intelligence.test.ts
- Floor/building/layout models: model/building.ts BuildingInput floors:number, model/floor.ts Floor {level, elevation, footprint, spaces, walls, openings, stairs, elevators, furniture, parkingStalls}, model/layout.ts LayoutCandidate {id, buildableArea, floors: Floor[], findings, valid, metrics, explanations, metadata}, model/project.ts ProjectInput {site, building, deterministic, seed}
- Generator: generator/generator.ts — generates Floor per level, placeSpaces, generateWalls, placeFurniture, solveStair, placeOpenings, snapCorridorsToRooms, needStairForFloor, DEFAULT_FLOOR_HEIGHT
- Documentation/export: documentation/model.ts DOCUMENTATION_SCHEMA_VERSION 3 SOFTWARE_VERSION 0.8.1-phase8-hardened, IntelligenceModel with quality nullable kitchen + scope + evaluableWeightsSum, contributions nullable + isEvaluable, builder.ts builds doc from Project+Candidate, roomSchedule loops over all floors, areaSummary aggregates GFA sum footprints, footprintVsRooms uses floors[0] for reconciliation, pdf.ts footprint = candidate.floors[0].footprint, draws only docModel.drawing.floor (0), xlsx.ts roomSchedule all floors, 07_Intelligence sheet with scope and N/A handling, manifest.ts footprint uses floors[0], intelligence quality Record<string,number|null> + intelligenceScope + evaluableWeightsSum, report.ts preserves intelligence
- DXF: writer.ts loops for fi in candidate.floors.length for walls/openings, but uses cand.floors[0].footprint for title block, emits text Strategy Floors count
- Existing tests: intelligence.test.ts 20+ Phase8 plus hardening 26, documentation.test.ts 19, pipeline.test.ts, phase6-invariants.test.ts, qa-phase41.test.ts, etc.

---

## 1. Where Floors Are Represented

- **Model:** `packages/core/src/model/floor.ts` Floor interface: level, floorHeight, elevation, footprint Rect, spaces Space[], walls Wall[], openings Opening[], stairs Stair[], elevators, furniture Furniture[], parkingStalls
- **Layout:** `LayoutCandidate.floors: Floor[]` length == building.floors input
- **Project Input:** `BuildingInput.floors: number` (above-ground floors including ground)
- **Documentation:** `FloorMetadata[]` per floor, `RoomScheduleEntry` includes floor number, `AreaSummary` grossFloorArea = sum footprints across floors, `DrawingMetadata` floor number for PDF
- **DXF:** writer iterates `candidate.floors.length`, emits per-floor geometry, but title block uses `floors[0]`
- **Intelligence:** `CandidateEvaluation` currently holds single `quality: QualityMetrics` from ground floor, `intelligenceScope` string, `detailed` single floor, no per-floor array

## 2. Where Floor Count Is Currently Determined

- **Input:** User chooses `building.floors` in ProjectInput (villa/apartment, 1..6 UI, validation in form)
- **Project Model:** `BuildingInput.floors` propagated via `Project.input.building.floors`
- **Generator:** `generator/generator.ts` creates Floor per level loop `for level 0..floors-1`, `needStairForFloor(input, level)` decides stair need, floorHeight constant DEFAULT_FLOOR_HEIGHT, elevation = level * floorHeight
- **Pipeline:** `pipeline.ts generate()` calls generator for each strategy, returns candidates each with floors array length == input floors
- **Documentation:** `docModel.building.floors` from input, `areaSummary` aggregates, but `intelligenceScope` only reports count, not evaluates
- **UI:** `App.tsx` has `floors` number input min 1 max 6, updates hasStair when >1, passes to ProjectInput

## 3. Where Layouts Are Generated

- **Main:** `packages/core/src/generator/generator.ts` — `generateFloor(input, level, strategy, ...)` → Floor, called per level per candidate strategy
- **Strategies:** 4 deterministic: area-efficiency (horizontal spine 45% corridor), functional-circulation (l-spur 48% +16% spur), daylight-orientation (vertical spine 50%), alternative-zoning (l-spur 55%+22% spur)
- **Space Program:** `programming/program.ts` per-floor SpaceSpec[] based on building input
- **Constraints:** `layout/constraints.ts` adjacency/separation/access
- **Placer:** `layout/placer.ts` placeSpaces, reserve circulation spine, slice remaining footprint, subdivide into rooms
- **Walls/Openings:** `walls.ts`, `openings.ts`, `circulation.ts`, `parking.ts`, `stairs.ts` stair solver
- **Pipeline:** `pipeline.ts` `generate()` loops strategies, calls generator, validates, scores via optimizer metrics (not intelligence), returns LayoutCandidate[]

## 4. Where `floors[0]` Is Currently Used (Accidental First-Floor-Only Logic)

- `intelligence/evaluation.ts:20` `const floor = candidate.floors[0]; // evaluate ground floor for V1, extend to all floors later` — **CRITICAL**
- `documentation/builder.ts:139-140` footprintVsRooms uses `candidate.floors[0].footprint` and `candidate.floors[0].spaces` for reconciliation first floor only
- `documentation/manifest.ts:138` footprint uses `candidate.floors[0]?.footprint`
- `documentation/pdf.ts:71` `const footprint = candidate.floors[0].footprint;` and `for (const fl of candidate.floors) { if (fl.level !== docModel.drawing.floor) continue; }` — draws only floor 0
- `dxf/writer.ts:526` `const fr = cand.floors[0].footprint;` for title block
- Tests: many `floors[0]` in test files (acceptable for single-floor assertions but indicates ground-floor assumption)
- `intelligence.test.ts` hardening: `floorWithoutKitchen` uses `floors[0]` to simulate N/A — test logic, not production, but shows pattern

## 5. How Candidate Generation Works

- **Input:** ProjectInput with building.floors, seed, deterministic
- **Per Strategy:** For each of 4 strategies, generate `floors.length` Floor objects via `generateFloor`
- **Stair Logic:** Stair hall reserved, `solveStair(stairRect, cfg, corridorSide, ...)` attempts multi-flight, fallback single-flight with HARD violation if no feasible config
- **Validation:** Each candidate's `findings` includes geometric, architectural QA, regulatory — HARD violations cause invalid but still returned for ranking demotion
- **Metrics:** `LayoutMetrics` usableAreaRatio, circulationRatio, etc from optimizer (pre-intelligence)
- **No per-floor candidate combinations:** Currently each candidate is coherent building with same strategy applied to all floors (not independent per-floor optimization that would cause incoherent building)
- **Determinism:** Seed used via mulberry32 for tie-breaking, sorting explicit, IDs deterministic

## 6. How Evaluation Works

- **Current:** `evaluateCandidate(candidate)` takes `candidate.floors[0]` only, calls 8 modules: functional, circulation, privacy, daylight, furniture, kitchen, bedroom, entranceService — each module takes Floor and returns score + findings + strengths/weaknesses
- **Scoring:** `computeQualityMetrics(..., floorsCount)` computes weighted sum Q = Σ(evaluable*weight)/Σ(evaluable weights) with kitchen N/A handling, returns QualityMetrics with overall, intelligenceScope string, evaluableWeightsSum
- **Contributions:** `buildContributions(quality)` builds ScoringContribution[] with metric, raw nullable, normalized, weight 0 when N/A, reason, isHard false, isHeuristic true, isEvaluable
- **Aggregated:** strengths/weaknesses deduplicated from all 8 modules, tradeOff string includes top/bottom metrics, hard violations, strategy, scope, kitchen N/A note
- **Multi-floor:** Only floorsCount passed for scope string, no per-floor evaluation, no vertical evaluation

## 7. How Optimization Works

- **Evaluation:** `evaluateCandidates(candidates)` maps evaluateCandidate and sorts hard-first (feasible first, hardViolations ascending), then overallQuality descending, deterministic tie-breaker id
- **Result:** `buildOptimizationResult(evaluations)` picks best = sorted[0], alternatives = sorted[1..3], diverseTop 3 with labels reflecting real behavior (Area/efficiency oriented when functional>=0.8 && circulation>=0.7, Privacy oriented when privacy>=0.85, etc) with reason containing metric values, not falsely universal best
- **Comparison:** `compareCandidates(a,b)` feasibilityDiff, metricDiffs for 9 metrics, strengths/weaknesses, tradeOffExplanation including scope
- **Current Limitation:** Optimization ranking ground-floor only, no vertical/stacking/inter-floor

## 8. How Documentation Consumes Intelligence

- **Builder:** `buildDocumentation(project, candidate)` calls `evaluateCandidate(candidate)` → IntelligenceModel with candidateId, strategy, feasible, hardViolations, overallQuality, quality, contributions, strengths, weaknesses, tradeOff, intelligenceScope, detailed (single floor)
- **Model:** `DocumentationModel.intelligence?: IntelligenceModel` with per-metric quality nullable kitchen, scope, evaluableWeightsSum, contributions, detailed per category
- **Report:** `buildQAReport(docModel)` includes `intelligence?: docModel.intelligence`
- **Manifest:** `buildManifest(doc, project, candidate)` includes `intelligence` with feasible, hardViolations, overallQuality, quality, strategy, intelligenceScope, evaluableWeightsSum
- **PDF:** `generatePDF(docModel, candidate)` draws intelligence summary: feasible, hard, quality %, func/circ/priv/daylight, kitchen N/A, scope line for multi-floor, strengths/weaknesses first lines sanitized ASCII, heuristic label
- **XLSX:** `generateXLSX(docModel)` 07_Intelligence sheet with Candidate ID, Feasible, Overall Quality, Evaluable Weights Sum, contributions with raw N/A display, weight, weighted, reason, isHard, isHeuristic, isEvaluable, Strengths, Weaknesses, Trade-off, Scope Note, Kitchen N/A row
- **Limitation:** All outputs currently represent ground-floor intelligence only, with transparency note whole-building not evaluated

## 9. How DXF/PDF/XLSX Consume Canonical Geometry

- **Canonical Source:** `LayoutCandidate.floors[]` with spaces, walls, openings, furniture, stairs — single source of truth, no second geometry
- **DXF:** `dxf/writer.ts` `writeDXF(candidate)` loops floors, emits walls as LINE/LWPOLYLINE, openings as DOOR/WINDOW blocks, spaces labels, furniture, stairs with layers A-STAIR, A-STAIR-TREAD, A-STAIR-DIR, dimensions, title block, north arrow, grid, deterministic order, R12 ASCII, INSUNITS=4 mm, internal meters*1000
- **PDF:** `pdf.ts` `generatePDF(docModel, candidate)` uses `candidate.floors[0].footprint` for transform, draws only selected floor (docModel.drawing.floor =0), walls with thickness by kind, openings window blue line, door leaf brown, spaces labels + area from docModel.roomSchedule, dimensions, furniture rectangles, grid, title block, area summary, intelligence summary — ground-floor only
- **XLSX:** `xlsx.ts` `generateXLSX(docModel)` uses docModel which already aggregated all floors for roomSchedule (loops over all floors), areaSummary gross = sum footprints, but intelligence only ground floor
- **Report/Manifest:** Use docModel which references canonical candidate id, consistency checksum from room areas, deterministic

---

## 10. Current Multi-Floor Capability

- **Geometry:** Full support for 1F,2F,3F,... up to 6 via UI, LayoutCandidate floors array, per-floor spaces/walls/openings/furniture/stairs, stair solver, elevation = level*DEFAULT_FLOOR_HEIGHT
- **Validation:** Hard validation covers all floors (findings from all floors, GEO, CIRC, STAIR), hard feasibility separate
- **Area:** GrossFloorArea = sum footprints, components sum across floors, residual, reconciliation tolerance 0.01
- **DXF:** Loops over all floors, all floors represented
- **Room Schedule:** Includes all floors, floor column
- **Intelligence:** Ground-floor-only with explicit transparency: `Ground Floor Intelligence — N floors total, whole-building intelligence not evaluated`, evaluableWeightsSum, N/A handling
- **Optimization:** Ground-floor-only ranking, hard-first

## 11. Current Limitations (Phase 9 Must Fix)

- **Evaluation:** Only `floors[0]` evaluated, comment `extend to all floors later`
- **No per-floor intelligence:** No FloorIntelligence[] array, no per-floor metrics/findings/strengths/weaknesses
- **No vertical circulation intelligence:** No stair existence/continuity/connectivity/landing/flight consistency/vertical accessibility/disconnected floors/penalties module
- **No stacking intelligence:** No kitchen over kitchen, bathroom over bathroom, wet-area clustering, circulation alignment, inefficient displacement
- **No inter-floor functional relationships:** No entrance→vertical circulation→upper zones, public/private between floors, bedroom/service distribution, privacy transitions
- **No whole-building quality model:** No floorQuality[], verticalQuality, wholeBuildingQuality, no combination logic
- **Optimization ground-floor-only:** Candidate ranking ignores upper floors, vertical, stacking
- **PDF ground-floor-only:** Only draws floor 0, no multi-floor representation
- **Documentation model ground-floor-only:** IntelligenceModel detailed single floor, no per-floor, vertical, whole-building
- **Floors[0] assumptions:** builder, manifest, pdf, dxf title block use floors[0] for footprint — okay for footprint but indicates first-floor-only thinking
- **Floor count not first-class in outputs:** No explicit floor count in intelligence, no per-floor sheets, no vertical sheets

## 12. Files/Modules That Must Change

**Core Intelligence:**
- `packages/core/src/intelligence/types.ts` — add FloorIntelligence, VerticalCirculationEvaluation, StackingEvaluation, InterFloorEvaluation, WholeBuildingQuality, extended CandidateEvaluation with perFloor[], vertical, stacking, interFloor, wholeBuilding
- `packages/core/src/intelligence/evaluation.ts` — evaluate all floors, call vertical circulation, stacking, inter-floor, compute whole-building quality, preserve floors[0] logic for backward compat but add per-floor
- `packages/core/src/intelligence/scoring.ts` — extend to floorQuality[], verticalQuality, wholeBuildingQuality, preserve Q=Σ(Mi*Wi) renormalization, define weights for vertical (e.g., 0.15), stacking (0.10), inter-floor (0.05) or similar, no double-counting, explainable contributions
- `packages/core/src/intelligence/comparison.ts` — compare whole-building, include per-floor diffs, vertical diffs, stacking diffs
- `packages/core/src/intelligence/optimization/index.ts` — whole-building ranking, hard feasibility, deterministic tie-breaking, seed determinism
- **New modules:**
  - `vertical-circulation.ts` — stair existence where required, continuity, floor-to-floor connectivity, landing/flight consistency, vertical accessibility path, disconnected floors, gross penalties, HEURISTIC label
  - `stacking.ts` — kitchen/bathroom/service wet-area clustering, circulation alignment, inefficient displacement, rewards/penalties/findings/explanations, HEURISTIC
  - `inter-floor.ts` — entrance→vertical→upper zones, public/private between floors, bedroom/service distribution, shared circulation, privacy transitions, deterministic from geometry
  - `whole-building.ts` — combine per-floor avg + vertical + stacking + inter-floor into wholeBuildingQuality, explainable

**Documentation/Outputs:**
- `packages/core/src/documentation/model.ts` — bump SCHEMA_VERSION 3→4, SOFTWARE_VERSION 0.8.1-phase8-hardened → 0.9.0-phase9, extend IntelligenceModel with floorCount, perFloor[], vertical, stacking, interFloor, wholeBuilding, scope whole-building
- `packages/core/src/documentation/builder.ts` — build per-floor intelligence, vertical, stacking, inter-floor, whole-building, propagate floor count, per-floor metadata, evaluable weights
- `packages/core/src/documentation/pdf.ts` — must represent all floors or at least per-floor summary + vertical + whole-building, scope whole-building intelligence, heuristic labels, N/A, no silent ground-floor-only when multi-floor
- `packages/core/src/documentation/xlsx.ts` — add sheets or sections: 07_Intelligence (whole-building), 08_PerFloor, 09_Vertical, 10_Stacking, or extend 07 with per-floor, vertical, stacking, scope, N/A, evaluable sums
- `packages/core/src/documentation/manifest.ts` — add floorCount, per-floor quality, vertical, stacking, wholeBuilding, scope
- `packages/core/src/documentation/report.ts` — include per-floor, vertical, whole-building

**DXF:**
- `packages/core/src/dxf/writer.ts` — ensure floor identity clear, canonical geometry preserved, all floors represented, layers/organization, validate actual DXF output, no second geometry

**UI:**
- `packages/web/src/App.tsx` — professional floor-count input (already exists but make clear), per-floor intelligence UI, whole-building intelligence, vertical intelligence, stacking, hard validation, heuristic labels, responsive from Phase 8 hardening preserved, no full redesign

**Pipeline/Generator:**
- `packages/core/src/pipeline.ts` or `generator/generator.ts` — ensure floor count propagation deterministic, validation rejects invalid floor counts (0, negative, >max e.g., 10), technical maximum defined, coherent complete-building candidates, bounded combinatorial explosion, deterministic combination logic, document strategy

**Tests:**
- `packages/core/src/intelligence/intelligence.test.ts` — extend with Phase 9 tests, keep 263 existing green

## 13. Files/Modules That Must NOT Change (Or Change Minimally/Safely)

- **Geometry engine:** `geometry/vec2.ts, rect.ts, polygon.ts, line.ts, distance.ts, overlap.ts, index.ts` — deterministic pure, single source of truth
- **Model basics:** `model/project.ts, site.ts, building.ts` (except validation of floor count max), `space.ts, wall.ts, opening.ts, circulation.ts, stairs.ts, parking.ts, furniture.ts, layout.ts` — keep structure
- **Generator single-floor placement:** `place-rooms.ts, walls.ts, openings.ts, circulation.ts, parking.ts, stairs.ts, slicing.ts, buildable-area.ts` — preserve deterministic slice logic, only ensure coherence across floors, not rewrite
- **Regulation packs:** `regulations/packs/*` — do NOT invent new Iranian legal requirements, keep VERIFIED/REQUIRES_SOURCE_VERIFICATION/NOT_IMPLEMENTED/DEPRECATED, HARD/SOFT/ADVISORY separation, existing verified source system authoritative
- **Validation:** `validation/types.ts, geometric.ts, architectural.ts, regulatory.ts, validator.ts` — preserve HARD/SOFT/ADVISORY, do not convert heuristic to hard legal
- **DXF core:** R12 ASCII writer core entities, layers, header, tables, blocks — keep, only ensure multi-floor representation
- **Existing Phase 8 intelligence modules:** `adjacency.ts, circulation.ts, privacy.ts, daylight.ts, furniture.ts, kitchen.ts, bedroom.ts, entrance.ts, graph.ts` — must work on every floor where applicable, do NOT remove, do NOT weaken, reuse
- **Existing tests:** 263 Phase 8 tests must remain green, do NOT weaken validation to hide failures
- **Package versions:** Do NOT change unless required by existing interface

## 14. Proposed Phase 9 Architecture

```
ProjectInput (building.floors first-class, validation max 10, default compatible)
  ↓
Project Model (BuildingInput.floors propagated)
  ↓
Candidate Generation (coherent complete-building, same strategy all floors, bounded, deterministic seed)
  ↓
Geometry (Floor[] canonical, single source of truth, stairs continuity)
  ↓
Per-Floor Intelligence (evaluate each Floor independently with existing 8 modules → FloorIntelligence[])
  ↓
Vertical Relationships (VerticalRelationships {stairs, vertical access, stacking, inter-floor})
  ├── Vertical Circulation Intelligence (stair existence, continuity, connectivity, landing/flight consistency, accessibility path, disconnected floors, penalties) — HEURISTIC + verified regulation checks separate
  ├── Vertical Stacking Intelligence (kitchen/bathroom/service wet-area clustering, circulation alignment, displacement) — HEURISTIC rewards/penalties/findings/explanations
  └── Inter-Floor Functional Relationships (entrance→vertical→upper zones, public/private between floors, bedroom/service distribution, shared circulation, privacy transitions) — deterministic from geometry
  ↓
Whole-Building Quality Model
  - floorQuality[] per floor (each Q=Σ(Mi*Wi) renormalized)
  - verticalQuality (circulation + stacking + inter-floor weighted)
  - wholeBuildingQuality = weighted combination per-floor avg + vertical + stacking + inter-floor, no double-counting, explainable contributions (metric, score, weight, raw, evaluability, heuristic/legal, explanation)
  ↓
Optimization (whole-building ranking: all floor qualities + vertical + stacking + inter-floor + hard feasibility separate, hard violations not feasible even if heuristic high, deterministic tie-breaking, seed determinism)
  ↓
Documentation/Outputs (same canonical building)
  - DocumentationModel v4, SOFTWARE_VERSION 0.9.0-phase9, floorCount, perFloor[], vertical, stacking, interFloor, wholeBuilding, scope whole-building, N/A, evaluable sums, heuristic labels, hard summary
  - DXF R12 deterministic, floor identity, all floors represented, clear layers
  - PDF A3, title block, per-floor intelligence summary + vertical + whole-building, scope, heuristic labels, N/A, no silent ground-floor-only
  - XLSX 01_Project ... 07_Intelligence (whole-building) + 08_PerFloor + 09_Vertical + 10_Stacking, or extended 07, scope, N/A, evaluable sums
  - Report manifest comparison UI — same canonical data
  ↓
UI (professional floor-count input, current candidate, per-floor intelligence, whole-building intelligence, vertical intelligence, stacking, hard validation, heuristic intelligence, responsive)
```

**Floor Count as First-Class Input:**
- UI explicitly chooses floors, default compatible (1), propagates Input → Project → Candidate generation → Geometry → Per-floor eval → Vertical eval → Whole-building scoring → Optimization → DXF/PDF/XLSX/Report/Manifest/UI
- Technical maximum: 10 (or 6 existing UI max, document limit), validation rejects invalid deterministically (0, negative, >max, non-integer)
- No disconnected UI-only count, clearly defined max, no unlimited claim

**Whole-Building Data Model Minimum:**
- Building { Floor[] + VerticalRelationships {stairs, vertical access, stacking, inter-floor relationships} } — no duplicate geometry, canonical geometry single source, intelligence consumes canonical geometry

**Quality Model Extension:**
- Preserve Q=Σ(Mi×Wi) with N/A excluded renormalized
- Extend to floorQuality[] (per floor), verticalQuality, wholeBuildingQuality (per-floor avg + vertical + stacking + inter-floor)
- No double-counting, final score explainable, every contribution exposes metric, score, weight, raw, evaluability, heuristic/legal, explanation, no black-box

**Candidate Generation:**
- Existing 4 strategies remain functional, multi-floor coherent complete-building candidates, same strategy all floors, no independent per-floor optimization causing incoherent building, deterministic combination logic, bound combinatorial explosion, reproducibility, document strategy, handle 1F/2F/3F and architected to scale to higher valid counts without hard-coded 2F/3F logic

## 15. Risks

- **Combinatorial Explosion:** If per-floor candidate combinations used (e.g., 4 strategies ^ 3 floors = 64 combos), candidate count explodes. Mitigation: Use same strategy all floors, bounded candidate search, deterministic, document limit, measure candidate count/floor count/eval time/optimization time
- **Double-Counting:** Per-floor and whole-building both include same underlying metric (e.g., circulation). Mitigation: Define clearly floorQuality[] from per-floor metrics, verticalQuality separate (vertical circulation, stacking, inter-floor), wholeBuildingQuality = weighted avg floorQuality + verticalQuality, no double-count, explainable contributions
- **Accidental First-Floor-Only Logic:** Remaining `floors[0]` assumptions in builder, manifest, pdf, dxf title block, evaluation. Mitigation: Search codebase `grep -rn "floors\[0\]"`, review TODO/FIXME multi-floor, audit after implementation, tests for every floor evaluated
- **Overengineering Inter-Floor Relationships:** Implementing speculative relationships not deterministically evaluable. Mitigation: Only implement relationships evaluable from existing structured geometry/data (entrance→vertical→upper, public/private between floors, bedroom distribution), avoid speculative frameworks, keep modules cohesive
- **Inventing Legal Requirements:** Vertical circulation/stacking legal claims without verified sources. Mitigation: Separate verified regulation checks vs heuristics, heuristic labeled HEURISTIC, mark REQUIRES_SOURCE_VERIFICATION or NOT_IMPLEMENTED if cannot verify from authoritative sources, never present heuristic as legal
- **Breaking 263 Existing Tests:** Changing evaluation changes scores, weights sum, schema version. Mitigation: Preserve existing Phase 8 modules, preserve renormalization principle, bump schema version 3→4 with backward compat handling, update tests only where expected (schema version), keep regression green
- **Performance Degradation:** 3F evaluation 3x per-floor modules + vertical + stacking, may be slow. Mitigation: Deterministic bounded search, measure eval time, document limits, do not sacrifice correctness for speed
- **DXF/PDF/XLSX Consistency Break:** Per-floor intelligence not propagated, outputs claim whole-building but not evaluated, or silently show ground floor when multi-floor. Mitigation: Update all outputs to expose floor count, per-floor, vertical, whole-building, scope, N/A, evaluable sums, heuristic labels, hard summary, validate actual DXF output not only string existence, cross-output consistency tests
- **Seed Determinism Break:** New vertical/stacking modules introduce randomness. Mitigation: Pure/deterministic intelligence where practical, no Math.random(), explicit seed if diversity, stable IDs, reproducible outputs, test same input+seed identical complete building/evaluation
- **UI Misleading Presentation:** Showing whole-building intelligence when only ground floor evaluated, or confusing floor-count input. Mitigation: Professional floor-count input, clear current candidate, per-floor intelligence, whole-building, vertical, hard validation, heuristic intelligence, avoid misleading, maintain responsive

## 16. Test Plan (Phase 9 Required Regression Categories)

**A. Existing 263+ Phase 8 tests:** Must remain green, no weakening

**B. Floor-count tests:**
- 1F valid
- 2F valid
- 3F valid
- higher supported count (6F, 10F max)
- invalid floor count (0, -1, 11, non-integer, NaN) → deterministic rejection

**C. Per-floor intelligence:**
- every floor evaluated (floorQuality length == floors count)
- no accidental floors[0] dependence (test that 2F second floor metrics differ when second floor geometry differs, or at least evaluated)
- each floor has its own metrics, findings, strengths, weaknesses, hard/soft/advisory context
- non-applicable metrics N/A handling (kitchen N/A on upper floors if no kitchen)

**D. Vertical circulation:**
- connected (stairs exist, continuity, floor-to-floor connectivity)
- disconnected (missing stair on upper floor → hard/soft finding)
- inconsistent stair cases (landing/flight inconsistency → finding)
- vertical accessibility path exists, gross penalties

**E. Stacking:**
- aligned wet areas (kitchen over kitchen, bathroom over bathroom) → reward, higher stacking score
- deliberately displaced wet areas (kitchen over bedroom) → penalty, lower stacking score
- deterministic score change (same input → same stacking score)

**F. Whole-building scoring:**
- floor score changes propagate to whole-building quality
- vertical score changes propagate
- N/A handling remains correct (kitchen N/A on upper floor → weight 0, renormalized)
- no double counting (wholeBuildingQuality not double count circulation twice)

**G. Candidate optimization:**
- whole-building ranking (best has highest whole-building quality among feasible)
- hard feasibility separate (hard violation candidate not feasible even if heuristic high)
- deterministic tie-breaking (identical input+seed → identical ranking)

**H. Seed determinism:**
- same input + same seed → identical complete building/evaluation/output-relevant data (candidateId, floors count, per-floor quality, vertical, whole-building, DXF checksum, PDF size approx, XLSX sheets)

**I. Cross-output consistency:**
- DocumentationModel = report = manifest = DXF/PDF/XLSX-relevant geometry/data (roomAreas, totalArea, checksum, floor count, per-floor intelligence, vertical, whole-building, scope, N/A, evaluable sums, heuristic labels, hard summary)

**J. Adversarial tests (at least 5):**
- worsen one floor → whole-building quality cannot improve solely because of that worsening (monotonic)
- worsen vertical circulation → vertical/whole-building score decreases
- worsen stacking → stacking/whole-building score decreases
- remove upper-floor access → appropriate hard/soft finding appears
- improve stacking → stacking score improves where applicable
- additional: improve one floor → whole-building quality increases or stays same, not decreases

**K. E2E:**
- 1F
- 2F
- 3F
- multi-floor with kitchen (kitchen on ground floor, maybe upper floor N/A)
- multi-floor with bedrooms (bedroom distribution across floors)
- small site (8x12)
- no parking
- deterministic repeated generation (same input twice → identical)

**L. Performance/Scalability:**
- Measure candidate count, floor count, evaluation time, optimization time
- Ensure bounded, no combinatorial explosion
- Document technical limits (max floors 10, candidate count 4 strategies * maybe 1 per floor = 4, not 4^floors)

**M. Regulation Discipline:**
- Verified source system authoritative, no invented Iranian requirements, mark REQUIRES_SOURCE_VERIFICATION or NOT_IMPLEMENTED if cannot verify, heuristics never presented as legal

---

## 17. Immediate Next Steps (After Audit Approval)

1. Implement floor count validation (max 10, min 1, integer) in model/building.ts and pipeline.ts
2. Create new modules: vertical-circulation.ts, stacking.ts, inter-floor.ts, whole-building.ts with deterministic pure functions, HEURISTIC labels
3. Extend types.ts with per-floor, vertical, stacking, inter-floor, whole-building types
4. Update evaluation.ts to evaluate all floors + vertical + stacking + inter-floor + whole-building
5. Update scoring.ts to combine per-floor avg + vertical + stacking + inter-floor, preserve renormalization, no double-counting, explainable contributions
6. Update optimization to whole-building ranking
7. Update documentation/model.ts schema v4, SOFTWARE_VERSION 0.9.0-phase9, per-floor, vertical, stacking, whole-building
8. Update builder.ts, pdf.ts, xlsx.ts, manifest.ts, report.ts to expose floor count, per-floor, vertical, whole-building, scope, N/A, evaluable sums, heuristic labels, hard summary
9. Update dxf/writer.ts to ensure multi-floor clear layers and all floors represented
10. Update App.tsx UI floor-count professional input, per-floor intelligence, whole-building, vertical, heuristic, responsive preserved
11. Add comprehensive Phase 9 tests (B-K above), keep 263 existing green
12. Run all tests, Core tsc, Web build, generate 1F/2F/3F outputs, inspect DXF/PDF/XLSX/report/manifest, verify cross-output consistency, search accidental floors[0] logic, review TODO/FIXME, git diff review
13. Create PHASE_9_REPORT.md with 20 sections, commit, push, clean tree

---

## 18. Approval Gate

**STOP after this audit. Wait for approval before modifying any source files.**

Audit complete, ready for implementation upon approval.

**Current Status:** Ground-floor-only intelligence with transparency, multi-floor geometry exists, whole-building intelligence NOT yet implemented — Phase 9 objective to upgrade to whole-building multi-floor intelligence and optimization.

**Risks Acknowledged:** Combinatorial explosion, double-counting, accidental first-floor-only logic, overengineering, invented legal requirements, breaking 263 tests, performance degradation, DXF/PDF/XLSX consistency break, seed determinism break, UI misleading presentation.

**Mitigations Planned:** Same strategy all floors, bounded search, clear quality model no double-count, grep floors[0] audit, only deterministic evaluable relationships, HEURISTIC label separation, preserve existing modules, measure performance, update all outputs, pure deterministic modules, professional UI.

---

*End of Pre-Implementation Audit*
