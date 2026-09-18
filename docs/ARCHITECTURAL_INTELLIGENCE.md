# Architectural Intelligence — Phase 8

## Purpose

Explainable, deterministic evaluation of "How well does plan function?" without second geometry, without LLM authoritative geometry. Single source of truth: canonical Project → Floor → Space → Wall → Opening → Furniture rects.

## Architecture

Canonical Project → Candidate Layouts (4 deterministic strategies) → Architectural Intelligence (8 modules) → Metric Normalization (0..1) → Hard Constraint Filtering → Quality Scoring (weighted sum) → Candidate Comparison → Explainable Trade-offs → Selected+Alternatives.

## Modules

### 1. Functional Adjacency

**Relationships:** 20+ STRONG_RELATIONSHIPS
- MUST: entrance MUST foyer direct_adjacency, foyer MUST living direct_access, corridor MUST bedroom/master direct_access, master MUST ensuite direct_access (soft if ensuite not requested)
- PREFER: living<->dining direct_adjacency, kitchen<->dining direct_adjacency + direct_access, kitchen<->living short_path, master<->ensuite direct_adjacency, bedroom<->corridor direct_access, guestWC near entrance short_path, guestWC near foyer direct_adjacency, kitchen near storage direct_adjacency
- AVOID: bedroom/master AVOID entrance/foyer direct_access (hard), bathroom AVOID living/dining direct_access, WC AVOID kitchen direct_adjacency, kitchen AVOID bedroom direct_access, storage AVOID living short_path

**Kinds:**
- direct_adjacency: adjacentSpaceIds includes
- short_path: BFS path <=2 via adj map
- same_zone / separated_zone: zone equality
- direct_access: door on shared wall (opening wall spaceIds includes both)
- privacy_separation: path >1 via circulation

**Evaluation:** For each from space, check any to satisfies kind, AVOID satisfied when NOT having relationship. Score = satisfied/total. Findings sorted by weight, strengths when satisfied weight>=7, weaknesses when MUST failed or AVOID violation weight>=8. Deduplicated.

**Range:** 0..1, deterministic.

### 2. Circulation

**Paths:** BFS shortestPathWithTrace from entrance to living/kitchen/bedroom, longestImportantPath = max of those, unnecessaryPathLength = sum beyond minimal, turnCount via rect centers (angle >30deg), deadEndCount via doorConnections (spaces with only 1 door not entrance/foyer/bathroom), corridorArea = sum corridor spaces, circulationRatio = circArea/footprint, public/private/service circ areas by zone, accessGraphQuality = reachable/total.

**Geometry-derived:** All from canonical walls/openings/rects, no timestamp.

**Findings:** SOFT for high ratio >0.35, deadEnds.

### 3. Privacy

**Metrics:** entranceToBedroomExposure direct doors / bedrooms, entranceToPrivateZone same, livingToBedroom direct doors, livingToBathroomExposure direct doors / bathrooms, guestWCLocationScore path entrance→guestWC <=2 good, bedroomClusterScore same zone + path <=2, masterSeparationScore master separated from secondary >=2 steps, publicPrivateTransitionScore direct public→private doors penalized.

**Score:** 1 - weighted exposures: entranceBedroom 0.3, livingBedroom 0.2, livingBathroom 0.2, guestWC 0.1, cluster 0.05, masterSep 0.05, transition 0.1.

**Findings:** PRIVACY_WEAK, SERVICE_EXPOSURE soft.

### 4. Daylight

**Orientation:** wallSide via footprint y/x comparison south/north/east/west. orientationScoreForType:
- living: south 10 east/west 6 north 2
- master: south 10 east 8 west 5 north 1
- bedroom: east 9 west 7 south 6 north 2
- kitchen: east 9 north 7 south 4 west 3
- dining: south 8 east/west 6 north 3
- default 5

**Window Potential:** has window 1, exterior wall but no window 0.5, else 0.

**Depth:** max(w,h), >7m penalized (MBH4-DYL-001 verified max 7m depth for daylight), finding ARCH_DAYLIGHT_MISSING soft.

**ExteriorWallRatio:** rooms with ext wall / total rooms.

**Overall:** living 0.3, bedroom 0.25, dining 0.2, kitchen 0.15, extRatio 0.1.

**Heuristic:** Not legal, isHeuristic=true, no VERIFIED claim.

### 5. Furniture Usability

**Checks:** hasDoorConflict distance <0.8m, rContains, rOverlapArea >1e-3 collision, clearanceFront thresholds.

**Bedroom:** bed presence, wardrobe presence, bed clearance >=0.6, circulation minSide >=2.5, door near corner.

**Living:** sofa presence, dining proximity.

**Dining:** table clearance >=1.6.

**Kitchen:** counter L-shaped preferred, clearance >=0.9.

**Scores:** Weighted per type, overall average 0..1.

### 6. Kitchen Dedicated

**Presence:** fridge/sink/cooktop implied by counter (minimal model). If no counter, isEvaluable false, reason provided, NOT EVALUABLE.

**Sequence:** L-shaped counter 1 else 0.7.

**Working Triangle/Zone:** minSide>=2.15 and area>=5.5 feasible (verified kitchen min 2.15m, 5.5m2), score 0.9 else 0.5.

**Circulation:** clearance >=1.0 good.

**Entrance:** not direct to entrance.

**Dining:** direct access preferred, path <=2 good.

**Living:** near living <=2 steps.

**Service:** storage direct good.

**Overall weighted:** counterSeq 0.2, triangle 0.25, circ 0.15, entrance 0.1, dining 0.15, living 0.05, service 0.1.

### 7. Bedroom

**Usability:** bed/wardrobe presence, bed not near door <1.0m, clearance >=0.6, access via corridor direct, door placement, window presence, privacy not direct to entrance/living, proportion max/min <=1.5 ideal, hierarchy master larger than secondary, masterEnsuite direct access if ensuite exists (only if program requests ensuite).

**Overall:** bed 0.2, wardrobe 0.15, access 0.15, circ 0.15, door 0.05, window 0.15, privacy 0.1, proportion 0.05, ensuite 0.1 if master.

### 8. Entrance/Service

**Entrance Transition:** entrance→foyer→living direct_access, score (eToF+fToL)/2, or entrance→living 0.7 if foyer missing.

**Exposures:** direct bedroom exposure count, direct WC exposure to living, bathroom exposure to living.

**Circulation Efficiency:** entrance→living <=2 steps good.

**Foyer:** area>=4 good, >=2 medium.

**Service Circulation:** kitchen not direct to entrance, kitchen service route not through living (BFS path includes living?), service access efficiency kitchen<->dining direct.

**Overall weighted:** transition 0.2, bedroomExp 0.15, wcExp 0.1, circEff 0.15, foyer 0.1, serviceCirc 0.1, bathExp 0.1, publicCross 0.05, serviceAccess 0.05.

## Scoring & Normalization

**Weights:** functional 0.20, circulation 0.20, privacy 0.15, daylight 0.15, usability 0.10, kitchen 0.08, bedroom 0.07, entranceService 0.05 sum 1.0.

**Reasons documented** in WEIGHT_REASONS.

**Normalization:** clamp 0..1, raw=normalized for heuristic, range [0,1], weightedScore=raw*weight, overall=weighted sum.

**Contributions:** inspectable array with metric, raw, normalized, weight, weightedScore, range, reason, isHard=false, isHeuristic=true for quality.

**Hard vs Soft:** feasible = hardViolations==0, hardFindings preserved, hard ranked first, quality second. HARD findings: invalid geom, outside buildable, blocked access, HARD QA, VERIFIED HARD reg. SOFT/ADVISORY: heuristic quality.

**No arbitrary magic:** weights documented, range explicit, reason per metric, deterministic.

## Candidate Optimization

**Strategies:** area-efficiency horizontal 45%, functional-circulation l-spur 48%+16%, daylight-orientation vertical 50%, alternative-zoning l-spur 55%+22%. Deterministic, no removal.

**Evaluation:** evaluateCandidates sorts feasible first, hardViolations asc, overallQuality desc, id tie-breaker.

**DiverseTop:** 3 candidates different strategies, labels reflecting real behavior: Area/efficiency oriented when functional>=0.8 and circulation>=0.7, Privacy oriented when privacy>=0.85, Daylight oriented when daylight>=0.8, Usability oriented when usability>=0.85, else strategy oriented, reason contains real metric values, not falsely universal best.

**Comparisons:** pairwise top 3, metricDiffs 9 metrics with interpretation similar/better, feasibilityDiff, strengths/weaknesses, tradeOffExplanation.

## Explainable Evaluation

CandidateEvaluation: candidateId, strategy, feasible, hardViolations, hardFindings, quality 8+overall, contributions, overallQuality, strengths 8, weaknesses 8, tradeOff string with higher/lower metrics and real values, detailed 8 modules each with score, findings count, strengths, weaknesses, plus specific metrics.

## Trade-off Comparison

CandidateComparison: candidateA/B, feasibilityDiff, metricDiffs (metric, a, b, diff, interpretation), strengthsA/B, weaknessesA/B, tradeOffExplanation.

## Determinism

Identical input/geom/strategy/evaluator version/config → identical evaluation, seed from input for generation diversity, no timestamp, deterministic BFS, sorting by id.

## Limitations & Heuristic vs Verified

- All quality metrics heuristic unless backed by regulation, isHeuristic=true, not VERIFIED.
- Daylight depth 7m verified (MBH4-DYL-001), but orientation scores heuristic.
- Kitchen min 2.15m width, 5.5m2 area verified thresholds used for working zone feasibility, but sequence/triangle heuristic.
- Bedroom min 2.15m, master 12m2 verified used for circulation score, but bed placement heuristic.
- Furniture clearance thresholds 0.6m bed, 0.9m counter, 1.0m kitchen circ, door conflict 0.8m heuristic.
- No fabricated legal claims, REQUIRES SOURCE VERIFICATION for unknowns, NOT_IMPLEMENTED for incomplete.
- Single source of truth canonical geometry, no second geometry, no LLM authoritative geometry.
