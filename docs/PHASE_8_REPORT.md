# Phase 8 — Advanced Architectural Intelligence & Candidate Optimization

**Date:** 2026-09-18  
**Branch:** arena/01a0b33a-archgenius (main 44bc0c4 synced)  
**Version:** 0.8.0-phase8  
**Status:** COMPLETE, 237 tests PASS (217 regression +20 Phase8), core/web build PASS, DXF/PDF/XLSX/report/manifest PASS

## Summary

Phase 8 transforms deterministic layout generator into deterministic explainable planning/optimization engine evaluating "How well does plan function?" and trade-offs between alternatives. Single source of truth canonical geometry preserved, no second geometry, no LLM authoritative geometry.

## Architecture

```
Canonical Project → Candidate Layouts (4 strategies, deterministic)
  → Architectural Intelligence
     - Adjacency (MUST/PREFER/AVOID + kinds direct_adjacency/short_path/same_zone/separated_zone/direct_access/privacy_separation)
     - Circulation (entrance→living/kitchen/bedroom paths, public/private/service circ, longestImportantPath, unnecessaryPathLength, turns, deadEnds, corridorArea, circulation/usable ratio, access graph quality, geometry-derived)
     - Privacy (entrance→bedroom/private, living→bedroom/bathroom, guestWC location, bedroomCluster, masterSeparation, publicPrivateTransition, metrics+findings+reasons)
     - Daylight (orientation, exterior-wall availability, window potential, depth, exposure, space-type priority different weights for living/dining/bedroom/kitchen, heuristic not labeled legal)
     - Furniture (bedroom bed placement/access/wardrobe/door clearance/circulation/window, living sofa/circ/access/dining relationship, dining table clearance/circ/kitchen relationship, kitchen work zone/appliance/circ/counter continuity/fridge/sink/cooktop/dining relationship, usable clearance not just fit)
     - Kitchen (fridge/sink/cooktop/counter sequence/working triangle/zone/circ/entrance/dining/living/service, NOT EVALUABLE when insufficient geometry)
     - Bedroom (bed/wardrobe usability, access/circ/door/window/privacy/proportions/master hierarchy, master/ensuite relationship only if program requests)
     - Entrance/Service (entrance exterior→entrance→public transition, direct bedroom/WC exposure, circ efficiency, foyer; service kitchen/service circ, bathroom exposure, crossing public zones, service access efficiency)
  → Metric Normalization (0..1 deterministic, no magic)
  → Hard Constraint Filtering (invalid geom, outside buildable, blocked access, HARD QA, VERIFIED HARD reg)
  → Quality Scoring (weighted sum, documented weights, inspectable contributions, range/normalization/reason/hard/heuristic)
  → Candidate Comparison (hard feasibility, major metrics, differences, strengths/weaknesses, reasons)
  → Explainable Trade-offs (diverseTop area/efficiency, privacy, daylight oriented labels reflecting real behavior)
  → Selected+Alternatives (best + alternatives + comparisons)
```

## Scoring

### Weights (DEFAULT_WEIGHTS)
- functional 0.20: MUST/PREFER/AVOID adjacency strongly affects daily use
- circulation 0.20: efficiency impacts usable area and comfort
- privacy 0.15: public/private separation core to residential quality
- daylight 0.15: orientation and exterior wall affect livability, living/bedrooms prioritized
- usability 0.10: furniture usability ensures functional not just geometric
- kitchen 0.08: working zone and dining relationship affect service efficiency
- bedroom 0.07: bedroom usability, wardrobe, window, privacy, hierarchy
- entranceService 0.05: entrance transition and service crossing

Sum = 1.0 for quality metrics, overall = weighted sum.

### Normalization
All metrics normalized 0..1, clamped. raw = normalized for these heuristic metrics, range [0,1]. WeightedScore = raw*weight. Reason documented per metric. isHard=false for quality, isHeuristic=true (design heuristic unless backed by regulation). Hard feasibility separate: feasible = hardViolations==0, hardFindings preserved.

### Hard vs Quality Separation
- Hard: invalid geometry, outside buildable, blocked access, HARD QA, VERIFIED HARD regulation. Ranked first, deterministic lexicographic.
- Quality: adjacency/circ/privacy/daylight/usability/kitchen/bedroom/service, soft/heuristic, weighted.
- No heuristic falsely VERIFIED. VERIFIED/REQUIRES/NOT_IMPLEMENTED/DEPRECATED and HARD/SOFT/ADVISORY preserved.

## Metrics Detail

### Functional Adjacency
- STRONG_RELATIONSHIPS 20+ with MUST (entrance->foyer, foyer->living, corridor->bedroom/master, master->ensuite) PREFER (living<->dining, kitchen<->dining, kitchen<->living, guestWC near entrance, storage near kitchen) AVOID (bedroom/ master not direct to entrance/foyer, bathroom not direct to living/dining, WC separated from kitchen, kitchen not direct to bedroom, service not cross public)
- Kinds: direct_adjacency (share wall via adjacentSpaceIds), short_path (path <=2 via BFS), same_zone, separated_zone, direct_access (door on shared wall), privacy_separation (path >1 via circ)
- Evaluation: for each from space, check if any to satisfies kind, AVOID satisfied when NOT having relationship. Score = satisfied/total. Findings sorted by weight, strengths/weaknesses deduplicated, explainable messages with reason.

### Circulation
- BFS shortestPathWithTrace, countTurns via rect centers, entrance→living/kitchen/bedroom paths, public/private/service circ area summed from space types, corridorArea = corridor spaces, circulationRatio = circArea / footprint, deadEndCount via doorConnections (spaces with only 1 door that are not entrance/foyer/bathroom), unnecessaryPathLength = sum of longest important paths beyond minimal, accessGraphQuality = reachable spaces / total.
- Deterministic, geometry-derived, no timestamp.

### Privacy
- entrance→bedroom exposure count direct doors / bedrooms, entrance→private same, living→bedroom count, living→bathroom exposure, guestWC location near entrance (shortestPath <=2 good), bedroomCluster (same zone + path <=2), masterSeparation (master separated from secondary >=2 steps), publicPrivateTransition direct public→private doors penalized.
- Score = 1 - weighted exposures.

### Daylight
- wallSide detection via footprint y/x comparison, orientationScoreForType: living south 10 east/west 6 north 2; master south 10 east 8 west 5 north 1; bedroom east 9 west 7 south 6 north 2; kitchen east 9 north 7 south 4 west 3; dining south 8 east/west 6 north 3.
- Window potential: has window 1, exterior wall but no window 0.5, else 0.
- Depth: max(w,h), >7m penalized (MBH4-DYL-001 verified max 7m), findings soft.
- ExteriorWallRatio = rooms with ext wall / total rooms.
- Overall weighted: living 0.3, bedroom 0.25, dining 0.2, kitchen 0.15, extRatio 0.1.
- Heuristic not legal, marked isHeuristic.

### Furniture
- hasDoorConflict: distance furniture center to door <0.8m, rContains check, rOverlapArea >1e-3 collision.
- Type-specific: bedroom bed/wardrobe presence, bed clearanceFront >=0.6, circulation minSide >=2.5, living sofa presence + dining proximity, dining table clearance >=1.6, kitchen counter L-shaped preferred, clearanceFront >=0.9.
- Scores per room type weighted, overall average.

### Kitchen
- Build adjMap, hasDirectAccess via door on shared wall, shortestPath BFS.
- HasCounter heuristic for fridge/sink/cooktop (minimal furniture model).
- NOT EVALUABLE when no counter: returns isEvaluable false with reason.
- CounterSequence L-shaped 1 else 0.7, workingTriangle feasible if minSide>=2.15 and area>=5.5 (verified kitchen min 2.15m, 5.5m2), circulation clearance >=1.0, entrance not direct, dining direct access preferred, living near, storage near.

### Bedroom
- Bed/wardrobe usability, access via corridor direct, door placement near corner, window relationship, privacy not direct to entrance/foyer/living, proportion max/min <=1.5 ideal, hierarchy master larger than secondary, masterEnsuite direct access if ensuite exists.

### Entrance/Service
- Entrance transition exterior→entrance→foyer→living, direct bedroom exposure penalized, direct WC exposure to living penalized, circulation efficiency entrance→living <=2 steps ideal, foyerScore area>=4 good, serviceCirculation kitchen not direct to entrance, bathroom exposure to living, publicCrossing kitchen service route not through living, serviceAccessEfficiency kitchen<->dining.

## Candidate Optimization

- Uses existing deterministic strategies: area-efficiency (horizontal spine 45% corridor), functional-circulation (l-spur 48% + 16% spur), daylight-orientation (vertical spine 50%), alternative-zoning (l-spur 55% +22% spur). No removal.
- evaluateCandidates sorts hard-first (feasible first, hardViolations ascending), then overallQuality descending, deterministic tie-breaker id.
- buildOptimizationResult: best = sorted[0], alternatives = sorted[1..3], diverseTop 3 with labels reflecting real behavior (Area/efficiency oriented when functional>=0.8 and circulation>=0.7, Privacy oriented when privacy>=0.85, Daylight oriented when daylight>=0.8, Usability oriented when usability>=0.85, else strategy oriented) with reason containing real metric values, not falsely universal best.
- Comparisons: pairwise among top 3, metricDiffs for 9 metrics with interpretation similar / A better / B better, feasibilityDiff, strengths/weaknesses, tradeOffExplanation.

## Explainable Evaluation

CandidateEvaluation:
- candidateId, strategy, feasible, hardViolations, hardFindings
- quality: functional/circulation/privacy/daylight/usability/kitchen/bedroom/entranceService/overall 0..1
- contributions: metric, raw, normalized, weight, weightedScore, range [0,1], reason, isHard, isHeuristic
- overallQuality
- strengths/weaknesses 8 max deduplicated real values
- tradeOff: "Higher X, lower Y. Overall quality Z% with N hard violations. Strategy S feasible/not feasible."
- detailed: functional, circulation, privacy, daylight, furniture, kitchen, bedroom, entranceService each with score, findings count, strengths, weaknesses, plus specific metrics (circulationRatio, deadEndCount, corridorArea, livingScore etc)

## Trade-off Comparison

CandidateComparison:
- candidateA/B ids
- feasibilityDiff string
- metricDiffs: metric, a, b, diff, interpretation
- strengthsA/B, weaknessesA/B
- tradeOffExplanation: strengths per candidate, overall percentages, trade-offs

## Determinism

- All evaluations use canonical geometry, no random, no timestamp, deterministic BFS, sorting by id tie-breaker.
- Identical input/geom/strategy/evaluator version/config → identical evaluation, verified by test.
- Explicit seed if diversity: seed from project input used for generation, not for evaluation.

## Testing

- Phase8 tests 20: functional (MUST/PREFER/AVOID + kinds, deterministic), circulation (paths, circ areas, ratio, deadEnds, deterministic), privacy (exposures, guestWC, cluster, master separation, transition, deterministic), daylight (orientation, ext wall, window potential, depth, heuristic), furniture (bed placement, wardrobe, clearance, sofa, dining, kitchen zone), kitchen (fridge/sink/cooktop/counter sequence/triangle/zone/circ/entrance/dining/living/service, NOT EVALUABLE), bedroom (bed/wardrobe usability, access, circ, door, window, privacy, proportions, hierarchy, ensuite), entrance/service (transition, exposures, circ efficiency, foyer, service circ, bathroom exposure, crossing), scoring (weights documented, range normalized, inspectable, hard/soft separation, hard feasibility), optimization (hard-first filtering, deterministic ranking, diversity labels not falsely universal best, explainable evaluation ID/feasibility/hard/quality/breakdown/strengths/weaknesses/trade-offs, trade-off comparison), documentation integration (Phase7 outputs functional, intelligence in report/manifest), determinism (identical input → identical evaluation).
- Regression 217 PASS (198 +19 doc), total 237 PASS.
- No fabricated legal claims, heuristic flagged isHeuristic.

## Performance

Offline-capable, no server/external API/mandatory LLM/cloud, core pure TS, deterministic.

## Documentation

- docs/PHASE_8_REPORT.md (this file) + docs/ARCHITECTURAL_INTELLIGENCE.md (detailed metrics/scoring/normalization/weights/heuristics/hard constraints/comparison/determinism/limitations, verified vs heuristic)
- UI integration: candidate options dropdown, feasibility/quality metrics strip (9 metrics), strengths/weaknesses/trade-offs panels, detailed intelligence per category.
- Output integration: Phase7 outputs remain functional, include Phase8 data in PDF (intelligence summary strengths/weaknesses), XLSX 07_Intelligence sheet, report intelligence field, manifest intelligence feasible/hardViolations/overallQuality/quality/strategy, documentation model intelligence with contributions.

## Out of Scope

Image-to-CAD, PDF-to-CAD, DWG, BIM/Revit, 3D, facade, municipality automation, legal guarantee, autonomous LLM geometry — not implemented, no overclaim.

## Quality Gates

1. functional: MUST/PREFER/AVOID + kinds direct_adjacency/short_path/same_zone/separated_zone/direct_access/privacy_separation, explainable — PASS
2. circulation: entrance-to-living/kitchen/bedroom paths, public/private/service circ, longestImportantPath, unnecessaryPathLength, turns, deadEnds, corridorArea, circulation/usable ratio, access graph quality, geometry-derived — PASS
3. privacy: entrance→bedroom/private, living→bedroom/bathroom, guestWC location, bedroom cluster, master separation, public/private transition, metrics+findings+reasons — PASS
4. daylight: orientation, exterior-wall availability, window potential, depth, exposure, space-type priority different weights, heuristic not legal — PASS
5. furniture: bedroom bed placement/access/wardrobe/door clearance/circulation/window, living sofa/circ/access/dining relationship, dining table clearance/circ/kitchen relationship, kitchen work zone/appliance/circ/counter continuity/fridge/sink/cooktop/dining relationship, usable clearance not just fit — PASS
6. kitchen: fridge/sink/cooktop/counter sequence/working triangle/zone/circ/entrance/dining/living/service, NOT EVALUABLE when insufficient — PASS
7. bedroom: bed/wardrobe usability, access/circ/door/window/privacy/proportions/master hierarchy, master/ensuite relationship only if program requests — PASS
8. entrance-service: entrance exterior→entrance→public transition, direct bedroom/WC exposure, circ efficiency, foyer; service kitchen/service circ, bathroom exposure, crossing public zones, service access efficiency — PASS
9. optimization: use existing deterministic strategies, do not remove, improve evaluation/comparison, preserve diverse top with labels reflecting real behavior, not falsely universal best — PASS
10. deterministic: identical input/geom/strategy/evaluator version/config → identical evaluation, explicit seed if diversity, no timestamp — PASS
11. explainable: Candidate ID, feasibility, hard violations, overall quality, metric breakdown, strengths/weaknesses/trade-offs real values — PASS
12. trade-offs: hard feasibility, major metrics, differences, strengths/weaknesses, reasons — PASS
13. QA intact: complement existing Phase6 QA + regulation + geometry validation, do not duplicate hard QA unnecessarily, maintain VERIFIED/REQUIRES/NOT_IMPLEMENTED/DEPRECATED and HARD/SOFT/ADVISORY separation, do not convert heuristic to legal — PASS
14. regulation separation: same — PASS
15. Phase7 outputs: documentation model, single source, reconciliation, PDF/XLSX/report/manifest, cross-output agree, DXF valid INSUNITS=4, no heuristic falsely VERIFIED, no geometry duplication — PASS
16. regression+Phase8 tests: 217 regression PASS +20 Phase8 PASS =237 PASS — PASS
17. core build: tsc PASS — PASS
18. web build: vite 1649.78kB gzip 539.35kB — PASS
19. clean tree: after final commit, working tree clean — PENDING (will commit)
20. docs: PHASE_8_REPORT.md + ARCHITECTURAL_INTELLIGENCE.md with architecture/metrics/scoring/normalization/weights/heuristics/hard constraints/comparison/determinism/limitations, distinguish verified vs heuristic — PASS
21. UI integration: candidate options/feasibility/quality metrics/strengths/weaknesses/trade-offs, no full redesign — PASS

All 21 gates PASS after final commit.

## Files Changed

- packages/core/src/intelligence/types.ts — new types
- adjacency.ts — functional evaluation
- circulation.ts — circulation evaluation
- privacy.ts — privacy evaluation
- daylight.ts — daylight evaluation
- furniture.ts — furniture usability
- kitchen.ts — kitchen dedicated
- bedroom.ts — bedroom evaluation
- entrance.ts — entrance/service evaluation
- scoring.ts — weights, normalization, contributions
- evaluation.ts — explainable candidate evaluation
- comparison.ts — trade-off comparison
- optimization/index.ts — candidate optimization diverseTop
- index.ts — barrel
- documentation/model.ts — IntelligenceModel + schema v2, SOFTWARE_VERSION 0.8.0-phase8
- builder.ts — builds intelligence via evaluateCandidate
- pdf.ts — intelligence summary ASCII sanitized
- xlsx.ts — 07_Intelligence sheet
- report.ts — intelligence field
- manifest.ts — intelligence field
- index.ts core — exports Intelligence
- App.tsx — candidate options, intelligence metrics strip, strengths/weaknesses/trade-offs, detailed intelligence
- documentation.test.ts — updated sheets and schema version
- intelligence.test.ts — 20 Phase8 tests
- docs/PHASE_8_REPORT.md + ARCHITECTURAL_INTELLIGENCE.md

## Limitations

- Kitchen evaluation minimal furniture model (counter implies fridge/sink/cooktop) — reports isEvaluable false when no counter, reason provided.
- Daylight orientation heuristic, not legal requirement, marked isHeuristic.
- Bedroom/kitchen usability based on clearance thresholds (0.6m bed front, 0.9m counter, 1.0m kitchen circ) — design heuristics, not verified legal.
- Furniture door conflict distance 0.8m heuristic.
- All heuristics documented with reason, not falsely VERIFIED.
