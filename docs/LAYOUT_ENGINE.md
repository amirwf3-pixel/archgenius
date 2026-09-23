# ArchGenius Layout Engine (Phase 3)

The layout engine places rectangular spaces deterministically inside a
rectangular buildable footprint and produces DXF drawings, validation
findings, and quantitative metrics.

## Architecture

```
ProjectInput
   │
   ▼
generateLayouts()                 ─┐  runs four strategies
   │                               │
   ▼                               │
buildBuildableArea()               │  setbacks → buildable rect
   │                               │
   ▼                               │
placeSpaces()                      │  carve footprint into zones
   │                               │
   ▼                               │
placeWalls() ─► placeOpenings()     │  walls, doors, windows
   │                               │
   ▼                               │
placeFurniture()                   │  A-FURN layer footprints
   │                               │
   ▼                               │
applyRegulationPack()              │  code checks
   │                               │
   ▼                               │
validateFloor()                    │  geometry / circulation / furniture
   │                               │
   ▼                               │
computeMetrics()                   ▼
   │
   ▼
generate() ranks strategies and returns `bestCandidate`
```

## Strategies

Four deterministic `CandidateStrategy` values are supported:

| Strategy                | Spine        | Corridor position | Best for                         |
|-------------------------|--------------|-------------------|----------------------------------|
| `area-efficiency`       | horizontal   | 45 % depth        | compact single floor, no spur    |
| `functional-circulation`| L-spur       | 48 % depth, 16 %  | default villa (entrance spur)    |
| `daylight-orientation`  | vertical     | 50 % split        | N-S daylit lots, deep footprints |
| `alternative-zoning`    | L-spur (wide)| 55 % depth, 22 %  | larger villas, wider entrance    |

`generate()` runs all four strategies and ranks them on:
1. Lower total constraint-violation count (hard + soft).
2. Weighted score of usable-area ratio (35 %), daylight exposure (35 %),
   adjacency satisfaction (20 %), and privacy satisfaction (10 %).
3. Strategy order in the list above.

Pass `{ allStrategies: true }` to receive all four candidates.

## Zone Carving

1. **Entrance spur** (L-spur strategies only) is carved off the west end of
   the public band; it holds the entrance door and a small foyer.
2. **Kitchen strip** is placed on the **east** edge of the public band.
   Strip width is clamped between 1.5 m and 2.4 m: `kw = max(1.5, min(2.4,
   publicW × 0.25))`.
3. **Corridor** is a 1.5 m horizontal (or vertical) spine separating the
   public/semi-private band from the private band.
4. **Stair pocket** is placed at the west end of the private band for
   multi-floor buildings.
5. **Private band** is split into equal(ish) columns — one per bedroom, with
   the master column weighted 1.45× so the ensuite is comfortable. Each
   column is Y-split into a 2.6 m bath strip at the corridor edge and a
   bedroom above it (daylight/facade side).

## Public-band Layout (South facade)

To satisfy MBH4-DYL-001 (dining must have an exterior wall), the south
facade is split between:

```
┌───────────────────────┬────────────┬───┐
│                       │            │WC │  ← corridor (north)
│        Living         │  Dining    │   │
│       (west)          │  (east)    │   │
└───────────────────────┴────────────┴───┘
         ← south facade (daylight) →
```

- Living ≥ 3.6 m wide; dining ≥ 2.2 m wide (2.15 m code minimum + 5 cm
  margin), giving a 22+ m² combined south face on a 15×20 villa.
- Guest-WC is tucked into the **NE** corner of the dining column only when
  there is ≥ 1.2 m width remaining after allocating 2.2 m to dining
  (`diningMinW + gwcMinW = 2.2 + 1.2 = 3.4 m`).
- Storage / pantry is placed at the **south (facade) end** of the kitchen
  strip, so the kitchen keeps a full corridor-edge wall for its door. The
  openings post-processor adds an interior door from storage to kitchen.

## Furniture Placement (`placeFurniture`)

Furniture is placed against walls with conservative offsets:

| Room           | Items placed                         |
|----------------|--------------------------------------|
| Living room    | Sofa (west wall), coffee table, TV unit |
| Dining         | 4-chair dining set (centered)        |
| Kitchen        | Counter along outer wall, refrigerator, stove |
| Bedroom(s)     | 1.6×2.0 m bed (head against far wall), nightstands, wardrobe |
| Master bedroom | 1.8×2.0 m bed + wardrobe + dresser   |

All items are validated by `validateFurniture`:
- `FURN_OUTSIDE_ROOM` (hard) if any piece extends beyond its room.
- `FURN_COLLISION` (soft) if two pieces in the same room overlap.

Furniture is written to the `A-FURN` DXF layer, alongside `A-WALL-EXT`,
`A-WALL-INT`, `A-DOOR`, `A-WINDOW`, `A-ROOM`, `A-DIMS`, and `A-STAIR`.

## Metrics (`computeMetrics`)

| Metric                    | Meaning                                                             |
|---------------------------|---------------------------------------------------------------------|
| `usableAreaRatio`         | non-circulation room area / footprint area (0..1, higher better)    |
| `circulationRatio`        | corridor+stair / footprint (lower generally better)                 |
| `wastedArea`              | footprint area not assigned to any room (m²)                        |
| `roomAreaDeviation`       | average fractional deviation from target areas (0 = perfect)        |
| `adjacencySatisfaction`   | 1 − (inaccessible rooms / total rooms)                              |
| `collisionCount`          | overlapping room pairs (should be 0)                                |
| `parkingFeasibility`      | placed stalls / requested stalls                                    |
| `daylightExposure`        | daylit rooms / daylight-required rooms                              |
| `orientationSatisfaction` | V1 placeholder (0.7) — refined with facade analysis later           |
| `privacySatisfaction`     | 1.0 when no private room directly adjoins entrance/foyer            |
| `constraintViolations`    | total hard + soft findings                                          |

## L-Shaped Sites (Phase 25 — dedicated two-rectangle path)

When the buildable polygon decomposes into exactly two rectangles
(`shape: 'l-shape'`, notch area removed by setbacks), placement bypasses the
generic multi-rect band planner and uses `generator/l-shape.ts`:

- **Split ladder** — the site-decomposition cut plus an exact-area horizontal
  re-cut are tried (ordered by whether the night wing can host the sleeping
  program at MBH4 main-room floors).
- **Bridge strip** — a 1.5 m corridor strip on the shared cut connects the
  wings; near-first ordering keeps street-spine↔bridge adjacency
  corridor-to-corridor.
- **Entry modes** — an entry band (entrance/guest-WC/foyer tiled along the
  street edge, foyer on the cut) or, on shallow street stubs, a full
  entry-annex (stub carries the entry sequence; the main block carries
  living at the cut corner plus a spine with private/public stacks).
- **Acceptance gates (geometry-authoritative)** — full program coverage, no
  room collisions, containment inside the L polygon (the notch stays empty),
  and exterior-wall reachability for every habitable room. A plan that fails
  any gate is rejected; `null` falls back to the generic planner, and a
  genuinely unfillable L stays honestly INFEASIBLE
  (`HARD_CONSTRAINT_INFEASIBLE_DIMENSION`). Nothing is forced.
- **Parking** — the stall envelope is clamped to the lot's front band so a
  south-side notch can never host a stall (the notch is not part of the
  site). Rectangular and rear-notch sites keep the original envelope.
- **Openings** — a bounded BFS connectivity-repair pass adds a door on the
  longest shared wall when the door graph cannot reach every space; it is a
  no-op for already-connected plans (every rectangular scenario).

Deterministic throughout: fixed ladders, no randomness, byte-identical DXF
across repeated exports.

## Known Phase-3 Residuals (non-blocking)

- **Stair flight length** (MBH4-STAIR-003): multi-flight L/U stairs with a
  mid-flight landing are not yet implemented. A single straight flight
  exceeds the 12-riser cap for 2-story 3.0+ m floor-to-floor heights. The
  engine correctly reports this as HARD so the user/professional reviewer
  sees it; the fix is a planned L-stair placement in a future iteration.
- **Door-swing heuristics** (`OPENING_DOOR_SWING_BLOCKED`) are flagged soft
  because the simplified corridor/foyer overlap check reports false
  positives on entrance-to-foyer transitions; hinges are placed correctly
  and no door actually opens into a wall.
- **Furniture placement** is V1 (wall-aligned footprints only); it does not
  yet model accessibility clearances (wheelchair turning radius, MBH4
  §4-5-5) or articulated seating groups.
