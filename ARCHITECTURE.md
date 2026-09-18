# ArchGenius — Technical Architecture

## Overview

ArchGenius is an offline-first, deterministic architectural floor-plan generator for the Iranian market. It produces real, editable AutoCAD-compatible DXF files from structured parametric inputs.

```
┌─────────────────────────────────────────────────────────────────┐
│                    @archgenius/web (React UI)                  │
│  Parameters │ Canvas preview │ Candidates │ Validation │ Export │
└──────────────────────────────┬──────────────────────────────────┘
                               │ typed API, pure function calls
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      @archgenius/core                          │
│                                                                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────────┐ │
│  │  Project   ││ Regulation ││   Space    ││   Layout      │ │
│  │  Model     ││   Engine   ││ Programming││  Generator    │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └──────┬────────┘ │
│        │              │              │               │          │
│  ┌─────▼──────────────▼──────────────▼───────────────▼────────┐ │
│  │                  Geometry Engine (2D)                     │ │
│  │  Vec2, Rect, Polygon, distance, overlap, partition,      │ │
│  │  sweep, offset, wall-merge, bsp (future)                  │ │
│  └─────┬──────────────────────────────────────────────────────┘ │
│        │                                                        │
│  ┌─────▼──────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Validator  ││ Optimizer  ││  DXF Writer││  Reporters   │  │
│  │ (HARD/SOFT/││ (determin- ││ (R12 ASCII ││ PDF/XLSX/MD  │  │
│  │  ADVISORY) ││  istic pen-││  layered)  ││              │  │
│  └────────────┘│  alties)   │└────────────┘└──────────────┘  │
│                └────────────┘                                 │
└───────────────────────────────────────────────────────────────┘
```

## Package layout

```
archgenius/
├── package.json               (npm workspaces monorepo)
├── tsconfig.base.json
├── ARCHITECTURE.md            (this file)
├── ROADMAP.md
├── DECISIONS.md
├── packages/
│   ├── core/                  # @archgenius/core — deterministic engine
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts                      # public API
│   │       ├── geometry/                     # 2D primitives
│   │       │   ├── vec2.ts
│   │       │   ├── rect.ts
│   │       │   ├── polygon.ts
│   │       │   ├── line.ts
│   │       │   ├── distance.ts
│   │       │   ├── overlap.ts
│   │       │   └── index.ts
│   │       ├── model/                        # domain model types
│   │       │   ├── project.ts
│   │       │   ├── site.ts
│   │       │   ├── building.ts
│   │       │   ├── space.ts
│   │       │   ├── wall.ts
│   │       │   ├── opening.ts
│   │       │   ├── floor.ts
│   │       │   ├── circulation.ts
│   │       │   ├── stairs.ts
│   │       │   ├── parking.ts
│   │       │   ├── layout.ts
│   │       │   └── index.ts
│   │       ├── units.ts                      # units/constants
│   │       ├── programming/                  # space programming
│   │       │   ├── program.ts
│   │       │   ├── adjacency.ts
│   │       │   └── index.ts
│   │       ├── regulations/                  # regulation packs
│   │       │   ├── types.ts
│   │       │   ├── engine.ts
│   │       │   ├── packs/
│   │       │   │   └── ir-national-mbr/
│   │       │   └── index.ts
│   │       ├── generator/                    # layout generation
│   │       │   ├── buildable-area.ts
│   │       │   ├── slicing.ts
│   │       │   ├── place-rooms.ts
│   │       │   ├── walls.ts
│   │       │   ├── openings.ts
│   │       │   ├── circulation.ts
│   │       │   ├── parking.ts
│   │       │   ├── stairs.ts
│   │       │   ├── generator.ts             # main pipeline
│   │       │   └── index.ts
│   │       ├── optimizer/
│   │       │   ├── metrics.ts
│   │       │   ├── penalties.ts
│   │       │   └── index.ts
│   │       ├── validation/
│   │       │   ├── types.ts
│   │       │   ├── geometric.ts
│   │       │   ├── architectural.ts
│   │       │   ├── regulatory.ts
│   │       │   └── validator.ts
│   │       ├── dxf/                          # DXF writer
│   │       │   ├── writer.ts
│   │       │   ├── layers.ts
│   │       │   ├── entities/
│   │       │   │   ├── line.ts
│   │       │   │   ├── polyline.ts
│   │       │   │   ├── circle.ts
│   │       │   │   ├── arc.ts
│   │       │   │   ├── text.ts
│   │       │   │   ├── insert.ts
│   │       │   │   ├── hatch.ts
│   │       │   │   └── dimension.ts
│   │       │   ├── header.ts
│   │       │   ├── tables.ts                 # LAYER, LTYPE, STYLE, DIMSTYLE
│   │       │   ├── blocks.ts                 # title block, north arrow, door
│   │       │   ├── titleblock.ts
│   │       │   └── index.ts
│   │       ├── export/
│   │       │   ├── space-schedule.ts         # XLSX-ready data
│   │       │   ├── design-report.ts          # Markdown/structured
│   │       │   └── index.ts
│   │       ├── storage/                      # project persistence
│   │       │   └── project-store.ts
│   │       └── pipeline.ts                   # end-to-end generate()
│   └── web/                       # @archgenius/web — React UI
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── src/...
└── package-lock.json
```

## Pipeline (end-to-end)

```pipeline
ProjectInput
  → validateInput()           // syntactic/input checks
  → loadRegulationPacks()     // compose national + local
  → deriveConstraints()       // setbacks, coverage, etc.
  → computeBuildableArea()
  → generateSpaceProgram()    // → Space[]
  → generateCandidates(N)     // for each strategy (efficiency / circulation / orientation)
        → slice & place rooms
        → generate walls
        → place openings
        → place stairs / elevator / parking
        → run validator (HARD violations → reject)
  → scoreCandidates()         // soft metrics
  → return LayoutCandidate[]
User selects a candidate
  → run full validator
  → run DXF writer
  → optionally produce PDF / XLSX / report
```

## Geometric conventions

- All 2D primitives are plain objects; functions are pure.
- Walls are represented as axis-aligned or rectilinear segments with a thickness and a centerline. They are merged when collinear and co-linear-shared to avoid double lines.
- Rooms are rectangular polygons in V1 (Phase 2 extends to rectilinear polygons).
- Openings (doors, windows) reference the wall they sit on and a parametric position (start offset + width + sill/lintel height).
- Coordinate system: origin at SW corner of site bounding box, meters, X=East, Y=North, north rotation applied at export/render.
- Floating-point comparisons use `EPS = 1e-6` m.

## Layer convention (DXF)

CAD layer names follow an `A-` architectural prefix, consistent with AIA/NCS-style layering (adapted):

| Layer       | Purpose                         | Color (ACI) | Lineweight |
|-------------|---------------------------------|-------------|------------|
| A-GRID      | Axis grid                       | 1 (red)     | 0.18       |
| A-AXIS-TEXT | Axis labels                     | 1 (red)     | 0.18       |
| A-WALL-EXT  | Exterior walls                  | 7 (white)   | 0.50       |
| A-WALL-INT  | Interior walls                  | 7 (white)   | 0.30       |
| A-COLUMN    | Structural columns              | 7           | 0.50       |
| A-DOOR      | Doors (swing arc)               | 3 (green)   | 0.25       |
| A-WINDOW    | Windows                         | 4 (cyan)    | 0.25       |
| A-STAIR     | Stairs                          | 6 (magenta) | 0.25       |
| A-PARKING   | Parking lines                   | 8           | 0.25       |
| A-SANITARY  | Plumbing fixtures (sanitary)    | 3           | 0.18       |
| A-FURN      | Furniture                       | 8           | 0.18       |
| A-ROOM      | Room labels / area tags         | 7           | 0.18       |
| A-HATCH     | Floor hatches                   | 8           | 0.13       |
| A-DIMS      | Dimension lines                 | 2 (yellow)  | 0.18       |
| A-TEXT      | General annotations             | 7           | 0.18       |
| A-NORTH     | North arrow                     | 7           | 0.25       |
| A-TITLE     | Title block / border            | 7           | 0.35       |
| A-BLDG-OUT  | Buildable-area outline (helper) | 9           | 0.13       |

## Determinism & reproducibility

- No `Math.random()` in the generator when `deterministic: true`. A seeded PRNG (`mulberry32`) is used only for tie-breaking.
- Sort orders are explicit for all array reductions (rooms sorted by privacy band, then target area, then id).
- DXF output is byte-stable for identical models (entities written in deterministic order).

## Testing

Four layers of tests:
1. **Unit** — geometry primitives (overlap, distance, rect ops, polygon area).
2. **Domain** — space programming, adjacency graph, regulation pack evaluation.
3. **Integration** — full `generate()` pipeline for a 1/2/3-bedroom scenario, asserting non-overlap, area tolerances, required room presence.
4. **DXF regression** — parse generated DXF and assert required layers, entity counts, structural sections, absence of duplicate entities.

## Persistence (V1)

Projects are serializable to JSON (all plain data, no functions in the model) and stored in `localStorage` plus an export/import JSON file.

## Out of scope for V1

- 3D modeling, BIM/IFC export, rendering.
- Import of scanned / raster / PDF / existing DXF plans.
- Multi-building complexes.
- Commercial / industrial / educational building types.
- Real-time LLM chat.
