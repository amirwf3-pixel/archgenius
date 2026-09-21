# ArchGenius Stair & Vertical Circulation Engine (Phase 4 + 4.1 QA)

The Phase 4 stair engine replaces the V1 rectangular stair placeholder with a
deterministic geometry solver that produces **real multi-flight stairs**
(straight, U-shaped, L-shaped) with flights, landings, tread lines, and
direction arrows. Phase 4.1 is a stabilization pass that fixes boundary-drift
regressions and stair-geometry connectivity.

## 1. Architecture

```
LayoutEngine.placeSpaces()
      │  reserves a "stair-hall" space in the private band (west pocket)
      ▼
generator.buildFloor()
      │  identifies the stair-hall space
      │  snapCorridorsToRooms() → 1cm grid + footprint clamp (Phase 4.1)
      ▼
stair-solver.solveStair(availRect, config, corridorSide, coreId, level)
      │  tries STRAIGHT → U_STAIR → L_STAIR deterministically
      │  picks first type whose footprint fits inside the hall
      │  distributes risers into flights, builds landings
      ▼
Stair { flights: Flight[], landings: Landing[], footprint, … }
      │
      ├──► walls/openings module       (stair door on corridor wall)
      ├──► placeFurniture()            (furniture-on-stair detection)
      ├──► validateStairs()            (geometry/dim/circulation)
      ├──► IR-National-MBR rules       (MBH4-STAIR-001/002/003)
      ├──► computeMetrics()            (stairFootprintArea, stairFlightCount)
      └──► dxf/writer.drawStair()      (A-STAIR, A-STAIR-TREAD, A-STAIR-DIR)
```

## 2. Domain Model (`src/model/stairs.ts`)

```ts
interface Stair {
  id, type: 'straight'|'u-stair'|'l-stair', coreId,
  totalRise, totalRisers, riserHeight, treadDepth, width,
  flights: StairFlight[],
  landings: StairLanding[],
  footprint: Rect, startPoint, endPoint, floor,
  explanation: string[], valid: boolean,
  // Legacy V1 aliases (rect, flightWidth, riser, tread, riserCount, floorHeight)
}

interface StairFlight {
  id, direction: 'north'|'south'|'east'|'west',
  riserCount, treadCount,            // treadCount = riserCount - 1
  riserHeight, treadDepth, width,
  runLength,                         // = treadCount × treadDepth
  startPoint, endPoint, footprint: Rect,
  treadLines: number[],              // offsets from start for each tread
}

interface StairLanding {
  id, footprint: Rect, width, depth, connectedFlightIds: string[]
}
```

### Tread convention

For each flight:

```
treadCount = riserCount - 1
runLength  = treadCount × treadDepth
```

The last "step up" arrives at the landing/upper floor and does not have a
tread drawn at its face (that edge is the landing nosing). This convention
is used consistently by the solver, validator, and DXF writer.

## 3. Stair Types

| Type       | Flights | Plan shape                        | Used when                                          |
|------------|--------:|-----------------------------------|----------------------------------------------------|
| `straight` | 2       | Single (or stacked) run           | Hall is long + narrow, run fits in one direction, width <2.4 blocks U |
| `u-stair`  | 2       | Parallel opposite + end landing   | Default for ~2.6×4.2 m cores (3.20 m floor height) |
| `l-stair`  | 2       | Perpendicular + corner landing    | Wider/deeper cores where U fails width but L fits |

The solver tries types in deterministic order (`straight → u-stair → l-stair`)
and picks the first whose computed footprint fits inside the available
stair-hall rectangle. Rotation (swapped width/height) is considered when
the hall is tall-but-narrow.

**Phase 4.1 fix:** Well placement was corrected for CAD y-grows-north
convention. Previously `corridorSide='south'` placed the well against the
north edge of avail (`wellY = avail.y + avail.h - wellH`), which inverted
the corridor relationship. Now:

```
south → wellY = avail.y (south edge flush with corridor)
north → wellY = avail.y + avail.h - wellH
west  → wellX = avail.x
east  → wellX = avail.x + avail.w - wellW
```

## 4. Riser / Tread Calculation

Given `floorHeight` (default 3.20 m):

1. `totalRisers = ceil(floorHeight / maxRiserHeight)` (max = 0.18 m per MBH4
   §4-5-1-7-1).
2. `riserHeight = floorHeight / totalRisers` (uniform across all flights).
3. `treadDepth` is chosen from Blondel's rule `2h + b ∈ [0.63, 0.64]`
   clamped to `[0.28, 0.32]` m.

For U-stair (v1.0.1, AGX-01): each flight runs the EXACT nominal run
`(n-1) × tread` — the actual going is never stretched and never squeezed
below the configured minimum — and the landing absorbs the remaining well
depth (a deeper landing is code-legal; only landing MINIMA are regulated),
so flights still start at the corridor edge and terminate exactly at the
landing edge. `requiredFootprint` guarantees the well fits the nominal run
plus landing. Rotated wells (run axis swapped to X to fit the hall) are
constructed on the rotated axis: flights run east/west side-by-side with
the landing at the far X end. A well that cannot host the nominal run is
rejected (`buildStairGeometry` returns `null`), `solveStair` tries the next
deterministic configuration, and if none fits the generator falls back to
the documented `NO_FEASIBLE_STAIR_CONFIGURATION` representation (expect
MBH4-STAIR-003 HARD). MBH4-STAIR-002 validates the ACTUAL per-flight
`treadDepth`/`riserHeight`, not the nominal stair-level values.

## 5. Automatic Flight Splitting (`distributeRisers`)

```
flightsNeeded = ceil(totalRisers / maxPerFlight)     // maxPerFlight = 12
base          = floor(totalRisers / flightsNeeded)
rem           = totalRisers - base * flightsNeeded
flights[i]    = base + (i < rem ? 1 : 0)             // remainder on EARLIER flights
```

Examples:

| totalRisers | max/flight | flights     |
|------------:|-----------:|-------------|
| 9           | 12         | `[9]`       |
| 12          | 12         | `[12]`      |
| 13          | 12         | `[7, 6]`    |
| 18          | 12         | `[9, 9]`    |
| 19          | 12         | `[10, 9]`   |
| 24          | 12         | `[12, 12]`  |
| 25          | 12         | `[9, 8, 8]` |

Every flight is guaranteed to be between 2 and `maxPerFlight` risers
inclusive.

## 6. Landing Geometry

Intermediate landings are placed between consecutive flights:

- **U-stair**: single rectangular landing at the far (north) end of the well,
  spanning both flight strings, depth `max(minLandingDepth=1.0, width×0.9)` m
  (code ≥ stair width, V1 uses 90% of width for small cores). Flights run
  from south (corridor) edge to landing south edge; `f1` direction north,
  `f2` direction south, so:
  - `f1.endPoint.y == landing.footprint.y` (within 1 mm)
  - `f2.startPoint.y == landing.footprint.y`
  - `f1.startPoint.y == well.y` (corridor)
  - `f2.endPoint.y == well.y`
- **L-stair**: square corner landing connecting the two perpendicular
  flights.
- **Multi-flight straight**: landings are rectangles placed between runs.

Landings are explicit geometry, validated against non-zero area, containment,
overlap, depth ≥ stair-width.

## 7. Placement & Orientation

The stair hall is carved by the layout engine (`placer.carveZones`) at the
west end of the private band:

```
if (needStair && privateBand.w > 5.5) {
  pocketW = clamp(privateBand.w * 0.20, 2.6, 2.9);
  pocketH = clamp(privateBand.h * 0.55, 4.2, 4.6);
  zones.service.push({ x, y, w: pocketW, h: pocketH });
}
```

The minimum 2.6 × 4.2 m core guarantees a U-stair fits for a 3.20 m
floor-to-floor (18 risers split 9+9).

The solver assumes **corridor is south of the stair-hall** (Phase 3
horizontal L-spine layout); flights start at the south edge and travel
north into the core. Rotation is automatic for vertical-spine
(daylight-orientation) candidates.

## 8. Phase 4.1 Boundary-Drift Fix (12×18 regression)

### Root cause

```
Issue: 12×18 / 2-bed / 1-story / seed 1 → 10 HARD (3× GEO_OUTSIDE ×2 passes + 4× CIRC)
Exact source: generator.ts:snapCorridorsToRooms() used UNSNAPPED corridor edges
Why: carveZones produces cy = 1.5 + 13.5*0.45 - 0.75 = 6.825 (raw float).
     placeSpaces snaps placed rooms to 1cm grid → public band rooms top = 6.83,
     corridor raw y = 6.825 remains unsnapped. snapCorridorsToRooms compared
     snapped room edge 6.83 vs raw corridor edge 6.825, diff 0.005 < eps 0.02,
     so it pulled rooms south by 5mm → y=1.495 instead of 1.500 → outside footprint.
     Second bug: private band height 6.675 rounded to 6.68, y 8.325→8.33, top 15.01>15.0.
Pre-existing: YES (Phase 3 placer logic, stair pocket not involved for 1-story)
Introduced by Phase 4: NO (needStair=false for 1-story, pocket code skipped)
Fixed: YES
Fix: 1) Snap ALL spaces (including corridors) to 1cm grid BEFORE aligning rooms to corridor edges.
     2) After snapping, clamp every room to buildable footprint (shrink w/h if east/north edge overshoots by <1cm).
```

### Verification

```
12×18 2-bed 1-story seed 1 after fix:
GEO hard = 0
CIRC hard = 0
STAIR hard = 0
REGULATION hard = 0
TOTAL hard = 0
```

Regression test `generator-boundary.test.ts` asserts `roomsInsideFootprint` for
12×18 seed 1..10 and other sites.

## 9. Stair Core Reuse

For multi-floor buildings the same `coreId = 'core-main'` is used on every
floor and the solver is invoked per-floor with identical configuration,
producing identical `footprint`, `flights`, and `landings` geometry (so
the stairwell aligns vertically in the DXF).

## 10. Validation (`validation/stair.ts`)

Finding codes:

| Code                          | Severity | Meaning                                                  |
|-------------------------------|----------|----------------------------------------------------------|
| `STAIR_OUTSIDE_BUILDING`      | hard     | Stairwell rect extends outside the floor footprint        |
| `STAIR_ZERO_AREA`             | hard     | Flight/landing has zero area                             |
| `STAIR_INVALID_RISER_COUNT`   | hard     | <2 risers or Σ flight risers ≠ totalRisers               |
| `STAIR_INVALID_TREAD_COUNT`   | hard     | treadCount ≠ riserCount − 1                              |
| `STAIR_INVALID_RUN`           | hard     | runLength ≠ treads × treadDepth or centerline mismatch   |
| `STAIR_RISE_MISMATCH`         | hard     | totalRise ≠ totalRisers × riserHeight (>5 mm)            |
| `STAIR_FLIGHT_COLLISION`      | hard     | Two flights overlap or a flight leaves the well          |
| `STAIR_MISSING_LANDING`       | hard     | ≥2 flights but fewer than N−1 intermediate landings      |
| `STAIR_LANDING_COLLISION`     | hard/soft| Landing overlaps flight or leaves the well / too narrow  |
| `STAIR_DISCONNECTED`          | hard     | Stair does not adjoin corridor/foyer/entrance            |
| `STAIR_NARROW_WIDTH`          | soft     | Flight width < 0.90 m                                    |
| `FURN_ON_STAIR`               | hard     | Furniture footprint on a flight                          |
| `FURN_ON_LANDING`             | hard     | Furniture footprint on a landing                         |
| `NO_FEASIBLE_STAIR_CONFIGURATION` (advisory) | Impossible geometry |

MBH4-STAIR-001/002/003 iterate per-flight.

## 11. DXF Output (`dxf/writer.ts`)

| Layer           | Purpose                                                          |
|-----------------|------------------------------------------------------------------|
| `A-STAIR`       | Stairwell outline, flight boundaries, landing outlines, "LDNG" text |
| `A-STAIR-TREAD` | Individual tread/riser lines across each flight                  |
| `A-STAIR-DIR`   | Up-direction arrows per flight, "UP" label, flight summary text  |

Phase 4.1 QA: per-layer entity counts verified (≥14 tread lines for U-stair
9+9, ≥2 dir arrows, stair outlines, LDNG label, UP label, no NaN, ends with EOF).

## 12. Metrics

- `stairFootprintArea` (m²): total area of all stair cores.
- `stairFlightCount`: total number of flights.

## 13. Determinism

Byte-identical output for same `(project, seed)`: stairs JSON, findings,
DXF length.

## 14. Failure Mode (Impossible Geometry)

If no stair fits:

1. Solver returns `ok=false` with `attempts[]`.
2. Generator falls back to single-flight legacy representation with
   `valid=false` and `NO_FEASIBLE_STAIR_CONFIGURATION` explanation.
3. MBH4-STAIR-003 HARD fires; candidate demoted.

No plausible-looking but invalid stair is emitted.

## 15. Tests (Phase 4.1)

- `generator/stair-solver.test.ts` — 14 unit tests
- `validation/stair.test.ts` — 4
- `generator-boundary.test.ts` — 25+ boundary integrity tests (new, regression for 5mm drift)
- `stair-qa.test.ts` — 18 tests: distributeRisers, chooseTreadDepth, U-stair 9+9 numerical, multi-floor alignment, impossible, determinism, furniture-on-stair, DXF, ranking
- `qa-phase41.test.ts` — 23 tests: 12×18 regression, straight stair, L-stair, riser distribution, stair door, impossible fallback, DXF QA, regression matrix 10 scenarios

Total: 133 tests.

## 16. Regression Matrix (Phase 4.1 final)

| Scenario | Floors | Seed | HARD | GEO | CIRC | STAIR | Result |
|----------|--------|------|------|-----|------|-------|--------|
| 8×12     | 1      | 1    | 0    | 0   | 0    | 0     | PASS |
| 8×25     | 1      | 2    | 0    | 0   | 0    | 0     | PASS |
| 10×30    | 1      | 3    | 0    | 0   | 0    | 0     | PASS |
| 12×18    | 1      | 1    | 0    | 0   | 0    | 0     | PASS (fixed) |
| 14×20    | 2      | 7    | 0    | 0   | 0    | 0     | PASS U-stair 9+9 |
| 15×20    | 1      | 42   | 0    | 0   | 0    | 0     | PASS |
| 15×22    | 3      | 42   | 0    | 0   | 0    | 0     | PASS U-stair 9+9/floor aligned |
| 18×25    | 2      | 42   | 0    | 0   | 0    | 0     | PASS U-stair 9+9 |
| 20×20    | 2      | 1    | 0    | 0   | 0    | 0     | PASS |
| 20×25    | 2      | 2    | 0    | 0   | 0    | 0     | PASS |

All have zero GEO_ROOM_OUTSIDE_FOOTPRINT after fix.

## 17. Known Limitations

- Curved/spiral/winder stairs: not implemented.
- L-stair: reachable when a stacked straight run and parallel U columns both
  fail the hall — the M7 rewrite fixed the over-set L footprint (it previously
  added a spurious flight width to the travel axis, making L structurally
  unreachable) and rebuilt all four corridor-side geometries from one verified
  canonical (u,v) layout with consistent direction metadata.
- Straight stair requires the hall travel axis to fit Σruns + landings; the
  12-risers-per-flight cap (MBH4 §4-5-1-7-5) drives the flight count.
- Handrails/balusters not modeled (0.10 m gap reserved).
- Headroom 3D check remains NOT_IMPLEMENTED: the engine emits a structured
  `headroom: { status:'NOT_IMPLEMENTED', thresholdM: 2.05 }` advisory on every
  solved stair (metadata only — never a compliance claim), citing the pack
  rule MBH4-STAIR-003 that owns the verified threshold.

## 18. Phase 15 M7 — Professional vertical-circulation engine

M7 removed the last naive paths around the Phase 4 solver:

1. **No fake stairs, ever.** The old generator painted a decorative
   single-flight stair (all risers in one flight — the Phase 3 defect shape)
   when the solver failed. That fallback is deleted. An unsolvable hall stays
   unsolved: honest `NO_FEASIBLE_STAIR_CONFIGURATION` explanation +
   `STAIR_MISSING` (hard) via the validator; M2 then rejects the candidate —
   deterministic, diagnosed infeasibility, never a rectangle pretending to be
   a stair.
2. **Access-aware orientation search** (`generator/vertical-core.ts`).
   Instead of the hardcoded south entry side, the engine measures real
   circulation adjacency on all four hall sides (shared edge ≥ 0.8 m with
   corridor/foyer/entrance), runs the solver through every side, and ranks
   only by measurable geometry (feasibility → plan slack → fixed side order).
3. **Cross-floor core coherence.** Level 0 establishes a building-level
   `CoreAnchor` (hall rect + entry side + solved configuration). Upper floors
   re-pin their stair-hall onto the anchor (bounded, deterministic relocation
   of ≤2 blocking rooms; failure is logged, never faked) and re-solve on the
   anchor inputs, so every floor gets byte-identical stair geometry that
   stacks: measured over all 58 feasible multi-floor stress cases — 138 stair
   floors, 0 misaligned cores, 0 flights > 12 risers, 0 landings missing.
4. **Stair-specific validation strengthened** (`validation/stair.ts`):
   `STAIR_INVALID_U_GEOMETRY` / `STAIR_INVALID_L_GEOMETRY` (type structure:
   opposite/perpendicular flights, balanced splits), `STAIR_LANDING_DISCONNECTED`
   (landing must touch both flights), `STAIR_INVALID_ENTRANCE` (entry nosing
   inside the hall — no phantom entrance), `STAIR_DOOR_COLLISION` (a door must
   not open through a flight body), and `STAIR_MISSING` when a hall carries no
   stair. Existing codes are reused where they already applied — nothing
   weakened, nothing reclassified.
5. **DXF**: stair labels now carry level + configuration (`2F · 18R @ 178×280 ·
   F0→F1 u-stair ent.south`), landing text carries the real depth. All geometry
   stays vector LINE/POLYLINE entities on the existing A-STAIR* layers.

Test surface: `phase15_7.test.ts` (32 tests) — 9/12/13/18/19/24-riser
families, straight/U/L/rotated/narrow/asymmetric geometry, all failure
classes, anchor coherence, integration sites (12×18 … 18×25 3F, narrow,
L-shape, decimal), double-run DXF byte determinism.

---

## 19. M8 — release audit of the vertical engine (2026-09-22)

The M8 full-system audit re-exercised every vertical invariant across all 207
feasible winners (135 stair floors): **0** flights over the 12-riser cap, **0**
missing landings, **0** flight overlaps, **0** misaligned stacked cores, **0**
stairs escaping their hall, **0** stair-validator hards, and **0** occurrences
of the banned pre-M7 fake (`totalRisers ≥ 18` in a single flight; split
families observed: 18→9+9, 19→10+9, 24→12+12, 25→9+8+8). DXF stair export:
0 structural findings, per-floor labels intact, 207/207 byte-identical on
re-run.

The audit found and fixed **one validator defect with vertical consequences**:
`validation/circulation.ts` seeded upper-floor reachability from *every*
circulation space when no foyer existed, so a stair hall that opened into
nothing (hall↔spine shared only a sub-door-length butt edge) still validated.
Seeds on `level > 0` now come from the stair/elevator halls — arriving by stair
must be able to enter the floor. Effect: `P7--U2-3f5bd` and probe `P7wideL-3F`
moved from "feasible but sealed" to honest NC (`CIRC_INACCESSIBLE_SPACE`);
global stress 208 → 207 feasible, 0 hard-winners maintained. Regression tests
live in `validation/circulation.test.ts` (Phase 15 M8 describe). Headroom
remains `NOT_IMPLEMENTED`/advisory; the refusal to fake a door into a 0.40 m
edge is the intended gate behavior, not a bug to squeeze away.
