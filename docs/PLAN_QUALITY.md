# Plan Quality — Residential Coherence (Phase 13 increments)

## 1. Goal
Generate coherent residential architecture that prioritizes architectural coherence over raw area. The ranker must favor professional residential logic using measurable metrics, not just area maximization.

## 2. 20 Coherence Criteria (priority order)
1. Zoning: public (living/dining/guest) vs private (bedrooms/baths) vs service (kitchen/storage) vs circulation (corridor/stair) separated.
2. Public/private separation (bedroom never adjacent to entrance).
3. Entrance sequence (entrance → foyer/corridor → living).
4. Living/dining grouping (shared wall or stacked, not isolated).
5. Kitchen ↔ dining direct access / prefer adjacent (soft/hard graph).
6. Bedroom grouping (private band, corridor access).
7. Bathroom logic (wet strip at corridor edge, BATH_STRIP_H=2.6, not full-height sliver).
8. Service strips (kitchen at north/east service pocket, not blocking living-corridor).
9. Corridors (continuous, min 1.5m width, single spine or L-spur).
10. Doors (valid wall segment, clear swing, no furniture collision, sensible direction).
11. Swings (door swing blocked detection via AABB 1.8×1.8, must be clear).
12. Furniture (bed/wardrobe/sofa/dining placed, not outside room, not blocking door <0.8m).
13. Proportions (1:3.6 max, corridor excluded 1:7).
14. Circulation (all rooms reachable from entrance via corridor, CIRC_INACCESSIBLE hard).
15. Daylight (living/bedroom exterior wall, window per room).
16. Stair integration (U-stair core 2.6×4.2, west pocket for horizontal, south pocket for vertical, aligned per floor).
17. No sliver rooms (minWidth preserved, never <0.9).
18. No leftover narrow gaps (clamp + resolveOverlaps).
19. No arbitrary packing (splitBinary respects priority/area, not random).
20. No narrow corridors (1.5m min, corridor ratio excluded from BAD).

## 3. Hard Graph (canonical `DEFAULT_RESIDENTIAL_CONSTRAINTS`)
- `MUST_BE_ADJACENT` (entrance-foyer, living-dining via sharedWallEdges polygon-aware).
- `DIRECT_ACCESS_REQUIRED` (corridor ↔ bedroom/bath/kitchen, stair-hall ↔ corridor).
- `MUST_BE_SEPARATED` (bedroom ↔ entrance).
- `PREFER_ADJACENT` soft (master-bedroom ↔ master-bathroom, kitchen ↔ dining, etc.).
The placer builds `HardConstraintGraph`, orders types via `placementOrderForTypes` (priority 100 for corridor/entrance, 90 for bedroom, 30 for dining/kitchen). Clusters are generic: `genericClusters` derived from hard clusters + soft adjacency, not hard-coded bedroom branches.

## 4. Zoning & Carving (`placer.carveZones`)
- **Horizontal / L-spur**: corridor at 45-55% depth, public band south, private band north, kitchen east strip (≥2.0m where feasible), stair pocket west (2.6×4.2 min).
- **Vertical (daylight-orientation)**: central corridor 1.5m at 50% width, public west band, private east band, kitchen north pocket (3.0-4.2m high) to keep living/dining south and corridor-adjacent, stair pocket at south end of private (4.2×2.6), storage pocket east small square (1.4-2.0×1.4-1.8) to avoid west sliver 5.0×1.4 (previously storage 5.0×1.4 ratio 3.6 BAD). Storage now east (full-width offset for no-stair case) to keep square proportion.

## 5. Private Band — Generic Cluster Placement
- Collect private specs via `zoneOf`, order via graph, build `softAdjMap` from soft `PREFER_ADJACENT`.
- First pass: pair specs whose types have soft adjacency (e.g., master-bedroom + master-bathroom) — now without requiring same hard cluster (previously too strict).
- Second pass: pair leftover wet rooms (bathroom/master-bathroom/guest-wc) with unpaired bedroom to avoid 1.3×6.9 sliver columns (iterative, deterministic). This fixes 15.5×22 sliver: bathroom 1.32×8.6 (ratio 6.52) now paired → bathroom height BATH_STRIP_H+0.4, bedroom height remainder, both square-ish.
- Sort clusters by `mustTouchCorridor` then area.
- Feasibility: `requiredTotal` vs `privateRect` dimension; if `>`, fallback column layout preserves minWidth and reports `HARD_CONSTRAINT_INFEASIBLE_DIMENSION` but never below 0.9 (GENUINELY_INFEASIBLE).
- Bounded search (8 attempts) varies width distribution via `attemptFactor`, evaluates separation via `sharedWallEdges` (bedroom-entrance must be 0 shared length).

## 6. Public Band — Living/Dining
- Side-by-side where width permits (`livingMinW 3 + diningMinW 2.2 ≤ publicRect.w`), else vertical stacking preserving min, else overflow with min preserved (GEO outside reported, not negative).
- Guest-WC placed east of dining when width allows (1.2m min).

## 7. Doors, Swings, Furniture
- Door placement searches valid wall segment, leaves 0.2-0.3 margin, prefers middle, swing direction now chosen to avoid walls (previously hash-based, now tested for clear quadrant).
- Furniture downstream reposition: `placeFurniture` tries alternative `north-wall` vs `sw-corner` if `FURNITURE_BLOCKS_DOOR` (<0.8m) or door swing blocked; ranking penalizes `FURNITURE_BLOCKS_DOOR` but not as hard as before.
- Validation remains strict: `OPENING_DOOR_SWING_BLOCKED`, `FURNITURE_BLOCKS_DOOR`, `ROOM_BAD_PROPORTION` are soft/hard and not suppressed — fixer must move geometry.

## 8. Ranking — Coherence over Raw Area
- `compareCandidates` (layout/ranking) tiers: hard count (fewest), then soft failures weighted (corridor access > proportion > door/furniture), then `usableAreaRatio` not raw area, then `circulationRatio` (lower is better), then `roomAreaDeviation`, then deterministic tie-break by strategy order.
- Measurable metrics: `constraintViolations`, `badProportionCount`, `doorSwingBlocked`, `furnitureBlocksDoor`, `privacyWeak`, `circulationRatio` documented in candidate metrics.

## 9. Generalization
Tested across 8×12, 8×25, 10×30, 12×18, 15×20, 15.5×22, 18×25, 20×25 and multi-story + L-shape + N/S/E/W access via `generateLayouts` with 4 strategies. Narrow 8×12 now correctly returns `INFEASIBLE` (below-min master 9.8<12) rather than a valid-looking sliver plan — honest hard, not a regression. Vertical spine generalizes: storage east square avoids sliver for all vertical footprints, wet pairing fixes sliver for all private counts.

## 10. Remaining Weaknesses (honest)
- 15.5×22 best daylight still 4× `OPENING_DOOR_SWING_BLOCKED` + 3× `FURNITURE_BLOCKS_DOOR` (door swing heuristic strict 0.4m, corridor walls within 0.4 flag). Fix would require larger door free span margin (0.5m) and furniture reposition loop — incremental next.
- Kitchen ↔ dining `DIRECT_ACCESS` still soft fail for vertical when kitchen north pocket separated by living — needs inter-room door across living, not corridor.
- Daylight vertical L-shape 15×20 2F with 5×6 notch still below-min for living (11<12) on tight wells — needs larger floor-to-floor or smaller program; currently honest infeasible.

## 11. Regression Guards
- `generator-boundary.test` (rooms inside footprint or honest HARD)
- `phase6-invariants` (DXF structure)
- New `dxf/envelope.test` (visible modelspace geometry inside envelope)
