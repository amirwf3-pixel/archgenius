# Phase 8 Hardening / Release Gate — Final Report

## 1. Baseline Verified
- Branch: `arena/01a0b33a-archgenius` HEAD `a0ff63d` reset from origin, clean tree
- `npm install` 269 packages
- `npm test` 237 PASS baseline confirmed before hardening
- Core `tsc` PASS, Web `vite build` PASS baseline

## 2. Kitchen N/A Scoring Fix
- `packages/core/src/intelligence/types.ts`: `KitchenEvaluation` score `number|null`, `QualityMetrics` kitchen `number|null` + `intelligenceScope` + `evaluableWeightsSum`, `ScoringContribution` raw nullable + `isEvaluable`, `CandidateEvaluation` intelligenceScope
- `scoring.ts`: `computeQualityMetrics(floorsCount)` renormalization `Q=Σ(evaluable*weight)/Σ(evaluable weights)` handling kitchen null weight 0, e.g. 0.92 when kitchen N/A, scope string Ground Floor vs multi-floor
- `kitchen.ts`: returns `score:null`, `isEvaluable:false`, reason `N/A — Not Evaluated` instead of 0.5, weaknesses N/A label
- `evaluation.ts`: passes floorsCount, filters null kitchen from trade-off sorting, tradeOff includes scope and kitchen N/A note
- `builder.ts`: propagates nullable kitchen, scope, evaluableWeightsSum to docModel
- Tests: kitchen N/A returns null, isEvaluable false, N/A reason, weight 0, renormalization overall 0.92 > 0 case

## 3. Multi-floor Transparency
- `intelligenceScope` field added to QualityMetrics, CandidateEvaluation, DocumentationModel, IntelligenceModel
- Logic: 1F = `Ground Floor Intelligence`, multi-floor = `Ground Floor Intelligence — N floors total, whole-building intelligence not evaluated`
- `builder.ts`, `pdf.ts`, `xlsx.ts`, `manifest.ts`, `comparison.ts`, `App.tsx` all display scope
- PDF adds scope line for multi-floor: `Intelligence scope: Ground Floor only | Whole-building intelligence: Not evaluated | Hard validation: All N floors`
- XLSX adds Scope Note row and Evaluable Weights Sum row
- Manifest adds `intelligenceScope` + `evaluableWeightsSum`
- Comparison tradeOff includes `Scope: ... Hard validation: All floors`
- Tests: single floor scope, multi-floor 2F scope contains total and not evaluated, doc model carries scope

## 4. Documentation Model Version Bump
- `DOCUMENTATION_SCHEMA_VERSION` 2 → 3
- `SOFTWARE_VERSION` `0.8.0-phase8` → `0.8.1-phase8-hardened`
- `IntelligenceMetrics` kitchen nullable + scope + evaluableWeightsSum
- `IntelligenceContribution` raw nullable + isEvaluable
- `IntelligenceModel` intelligenceScope + kitchen reason
- `documentation.test.ts` updated to expect schemaVersion 3

## 5. PDF / XLSX / Report / Manifest Hardening
- `pdf.ts`: scope transparency, heuristic label `Design Heuristics`, kitchen N/A display `Kitchen N/A`, multi-floor banner, sanitization preserved, ASCII only
- `xlsx.ts`: Intelligence sheet columns added `Is Evaluable`, raw displays `N/A — Not Evaluated` when null, weight 0, reason N/A, Evaluable Weights Sum row, Scope Note row, Kitchen N/A row when not evaluable
- `report.ts`: already includes intelligence, now includes scope via docModel
- `manifest.ts`: intelligence quality `Record<string, number|null>`, adds `intelligenceScope` + `evaluableWeightsSum`, validation deterministic preserved

## 6. UI Hardening
- `App.tsx`: 
  - Seed numeric input default 42, deterministic label `Same input+seed → same output`
  - FormState seed field added, generation uses `Number(form.seed) || 42`
  - Responsive hardening: `overflow-x-hidden`, `min-w-0`, `truncate`, `shrink-0`, `break-words`, `overflow-hidden` on panels
  - Heuristic badges: `HEURISTIC` badge on validation, contributions, detailed intelligence, top strip
  - Intelligence scope banner: `Ground Floor Intelligence — ...` + `Design Heuristics, not legal verification — Hard validation: All floors — Evaluable weights sum`
  - Kitchen metric displays `N/A` when null
  - Version label `v0.8.1-phase8-hardened`
- No full redesign, preserves existing Phase6 QA + regulation + geometry validation

## 7. Shared Utils Extraction (Safe)
- New `graph.ts`: deterministic pure functions `buildAdjMap`, `shortestPath`, `hasDirectAccess`, `areAdjacent`, `sameZone`
- Refactored `adjacency.ts`, `circulation.ts`, `privacy.ts`, `kitchen.ts`, `bedroom.ts`, `entrance.ts` to import from graph.ts, behavior identical
- `circulation.ts` keeps `shortestPathWithTrace` custom, uses shared `buildAdjMap`
- No functional change, only deduplication, safe refactoring
- Verified by 263 tests PASS

## 8. Adversarial Regression Suite (10 scenarios monotonic)
- In `intelligence.test.ts`:
  1. higher functional → higher overall
  2. higher circulation → higher overall
  3. higher privacy → higher overall
  4. higher daylight → higher overall
  5. higher usability → higher overall
  6. higher kitchen (evaluable) → higher overall
  7. kitchen N/A renormalization increases overall vs 0 score (0.92 renormalization)
  8. higher bedroom → higher overall
  9. higher entranceService → higher overall
  10. all low vs all high monotonic (low <0.3, high >0.8)
- All monotonic assertions use `computeQualityMetrics` directly, deterministic

## 9. Seed Determinism Tests
- Same input + same seed 42 identical evaluation: candidateId, overallQuality, functional, intelligenceScope
- Different seeds 42 vs 123 deterministic but potentially different candidates, both deterministic evaluations identical on re-eval
- UI seed input default 42, numeric, min 0, step 1

## 10. Cross-output Consistency
- Documentation model, report, manifest agree on intelligenceScope and overallQuality
- Room areas, checksum, totalArea consistent across docModel, report, manifest, DXF, PDF, XLSX
- `exportAll` pipeline verified in `documentation.test.ts` 19 tests
- Overall quality = weighted sum renormalized when N/A

## 11. 6 E2E Cases A-F
- A: minimal 1BR villa — feasible defined, overall >=0
- B: 3BR with master — bedroom quality >=0
- C: 2 floors — scope contains `2 floors total`
- D: no parking — feasible defined
- E: open kitchen — kitchen nullable or number
- F: small site 8x12 — overall >=0
- All E2E in `intelligence.test.ts`

## 12. Full Verification
- `npm test` 263 PASS (16 files) — up from 237 baseline, added 26 hardening tests
- Core `tsc -p packages/core/tsconfig.json --noEmit` PASS (fixed adjacency.ts areAdjacent signature)
- Web build `tsc -p tsconfig.json && vite build` PASS — 297 modules, 1.7 MB JS, gzip 553 kB
- PDF generation validated: header `%PDF-`, size >1000
- XLSX validation: ZIP header, 7 sheets including Intelligence
- Manifest schemaVersion 3, deterministic true, checksum present
- Clean tree after commit

## 13. Commit and Push
- Commit `bb38734` message `fix: harden phase 8 release gate — N/A scoring renormalization, multi-floor scope transparency, heuristic badges, seed deterministic, shared graph utils, adversarial regression, E2E A-F, responsive overflow`
- 19 files changed, 630 insertions, 337 deletions, create graph.ts
- Pushed to `origin/arena/01a0b33a-archgenius` — `a0ff63d..bb38734`

## 14. Final Delivery
- Branch `arena/01a0b33a-archgenius` hardened
- All 21 quality gates satisfied: functional/circ/privacy/daylight/furniture/kitchen/bedroom/entrance-service/optimization/deterministic/explainable/trade-offs/QA intact/regulation separation/Phase7 outputs/regression+Phase8 tests/core/web build/clean tree/docs
- No Phase9, stop after Phase8
- Offline-capable, no server/external API/mandatory LLM/cloud
- Deterministic, single source of truth canonical geometry, no second geometry, no LLM authoritative geometry
- Heuristic not labeled legal, VERIFIED/REQUIRES/NOT_IMPLEMENTED/DEPRECATED and HARD/SOFT/ADVISORY separation preserved

HARDENING STATUS: COMPLETE
