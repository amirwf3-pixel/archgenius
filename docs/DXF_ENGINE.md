# DXF Engine — Architecture, Layers, Annotation, Validation

Status: P16-D-A/B/C/D + Phase 28-E complete. This document describes the
**actual current** DXF output pipeline. For the historical R12 black-screen
diagnosis see `docs/DXF_R12_COMPATIBILITY.md` (§1.6): after real AutoCAD 2027
isolation (Phase 28-C/28-D ladders) the header is the MINIMAL proven profile —
`$ACADVER` only, no VPORT table — replacing the P22-B view-variable/VPORT
profile, which AutoCAD 2027 rejected (black/blank) in every tested variant.

## 1. Overview

The DXF writer converts a ranked `LayoutCandidate` (single source of truth:
`candidate.floors`) into a **DXF R12 (AC1009) ASCII** drawing. It is a pure
function of the candidate and the options: same input → byte-identical output,
always. There is no wall-clock data, no randomness, and no dependence on
environment in the output.

Hard output invariants:

- R12 `AC1009`, minimal HEADER (`$ACADVER` only — no R13+ variables).
- Pure-ASCII, CRLF line endings, `EOF`-terminated.
- All coordinates in **millimetres** (R12 has no `$INSUNITS`; the millimetre
  scale is implied by the geometry and stated in the title block).
- Entity vocabulary limited to `LINE`, `ARC`, `TEXT`, `POLYLINE`, `VERTEX`,
  `SEQEND` — no R13+ entities (`LWPOLYLINE`, `HATCH`, `MTEXT`, `DIMENSION`,
  `INSERT`, `SPLINE`).
- No group codes 370 (lineweight) or 100 (subclass markers) anywhere.

Module map (`packages/core/src/dxf/`):

| File | Role |
|---|---|
| `writer.ts` | `writeDXF` (document builder), `dxfSafeText` (ASCII policy), `validateDXFStructure` (structural QA gate) |
| `layers.ts` | `LAYERS` layer roster (`LayerDef`: name/ACI colour/lineweight/linetype), `layerByName` |
| `analyzer.ts` | `analyzeDXF` / `formatAnalysis` — offline QA analysis of a DXF string |
| `verify.ts` | `parseDxf` — lightweight pair-level parser for verification |
| `index.ts` | re-exports `writer.js` + `layers.js` |

Consumers: `pipeline.exportDXF` (validates the candidate envelope, then calls
`writeDXF` + `validateDXFStructure`) and the web download button, which uses the
identical string (`exportDXF(...).dxf === writeDXF(...)` is pinned by tests).

## 2. Layer architecture

`LAYERS` in `layers.ts` is the authoritative roster (plus the mandatory `'0'`).
Every name follows the AIA-style `A-<DISCIPLINE>` convention. Colours are ACI;
linetypes are `CONTINUOUS`, `CENTER` (grid/axes) or `DASHED` (site helpers).

### 2.1 Lineweight pen ladder (P16-D-B)

Lineweights are 1/100 mm and use only valid ISO 128 / AutoCAD pen values.
They are **layer-table metadata**: R12 has no group-370 lineweight record, so
the pen assignment travels with these definitions and is applied by any CAD
tool that plots by layer name (CTB/pen-table mapping). The ladder:

| Pen | Role | Layers |
|---|---|---|
| 50 | structure | `A-WALL-EXT`, `A-WALL-CORE`, `A-COLUMN` |
| 35 | primary walls | `A-WALL-INT`, `A-TITLE` |
| 25 | openings / site | `A-DOOR`, `A-WINDOW`, `A-STAIR`, `A-WALL-SERVICE`, `A-PARKING`, `A-SITE`, `A-NORTH`, `0` |
| 20 | partitions | `A-WALL-PART` |
| 18 | annotation | `A-DIMS`, `A-TEXT`, `A-ROOM`, `A-AXIS-TEXT`, `A-STAIR-TREAD`, `A-STAIR-DIR`, `A-SANITARY`, `A-FURN` |
| 13 | helpers | `A-GRID`, `A-AXIS`, `A-BLDG-OUT`, `A-SETBACK` |
| 9 | halftone | `A-HATCH` |

### 2.2 Floor namespace and schemes (P16-D)

Per-floor copies `A-FLOOR-{n}-{base}` are generated for the disciplines listed
in `baseForFloorLayers` (walls, openings, stairs, room, text, furn/sanitary,
dims, parking, envelope helpers). `DXFOptions.layerScheme`:

- `'both'` (**default**, legacy contract) — every entity is drawn once on its
  `A-FLOOR-{n}-*` layer; floor 0 additionally mirrors onto the base discipline
  layers (and the envelope trio). An entity appears at most once **per layer**.
- `'none'` — per-floor layers only; no generic entity references.
- `'generic'` — shared discipline layers only, no floor mirrors.

`includeGenericLayers: true/false` is the legacy boolean alias (maps to
`'both'`/`'none'`; `layerScheme` wins when both are given). All base layers are
always present in the LAYER table regardless of scheme.

Emitter-level cleanliness (P16-D): exact same-layer duplicates are suppressed
via a signature `Set`; zero-length segments, empty/zero-height text and
non-positive-radius arcs are never emitted.

## 3. Emitted geometry

- **Walls** — double parallel faces broken around openings, with jamb caps,
  routed by `Wall.kind` (`exterior/core/service/partition/interior`).
- **Openings** — windows: four glass lines in the reveal; doors: leaf +
  quarter-circle swing arc + leaf-end tick. Exterior openings ≥ 0.6 m also get
  a geometry-derived width dimension (witness lines + 45° ticks + value).
- **Stairs** — well outline, landing polygons + labels, per-flight tread lines,
  up/down arrows (`A-STAIR-DIR`), and a fitted build note (below).
- **Parking** — stall rectangles with `P{index} F{floor}` labels and the aisle
  rectangle (`A-PARKING`).
- **Furniture / sanitary (P16-D-C)** — every `Floor.furniture` footprint drawn
  as a plain rectangle outline at exact model coordinates: toilet/sink/shower/
  bathtub → `A-SANITARY`, everything else → `A-FURN`. Footprints only — no
  invented symbols, no labels (the model layer doc defines this intent).
- **Site context** — canonical `siteBoundary` / `buildableBoundary` polygons,
  setback values note, grid/axes (`A-GRID`/`A-AXIS`/`A-AXIS-TEXT`), north arrow.
- **Multi-floor** — floors are stacked north in model space with a 4 m
  presentation gap (`floorOffset(fi)`); floor 0 additionally carries site
  dimensions, the north arrow and the title block. A stair-stack marker line
  connects stair wells across floors for multi-storey plans.

## 4. Annotation (P16-D-A/C/D)

Text roles are strictly separated:

| Layer | Carries |
|---|---|
| `A-ROOM` | room name + area label pairs only |
| `A-DIMS` | dimension lines, ticks and dimension values |
| `A-TEXT` | floor headers, stair build notes, stair-stack marker, site note |
| `A-TITLE` | title block text + legend row labels |
| `A-STAIR-DIR` | direction arrows and `UP` labels only |

### 4.1 Room labels (P16-D-C)

- **Anchor** — the deepest interior point (pole of inaccessibility) of the
  actual room polygon: deterministic coarse grid scan over the bbox + six
  refinement passes, with a centroid-proximity tie-break so rectangular rooms
  self-centre. Guaranteed inside the polygon (a concave centroid is not).
- **Sizing** — `fitRoomText` picks the largest height (clamped 0.12–0.35 m) at
  which the name line and the 0.7× area line fit the polygon chord through the
  anchor (character advance ≈ 0.72 × height, 0.15 m boundary pad).
- **Orientation** — the block rotates 90° only when the vertical chord beats
  the horizontal by ≥ 1.15×; wide/flat rooms stay horizontal.
- **Area** — recomputed from the canonical polygon (shoelace), never from
  stale metadata. Multi-floor plans suffix labels with `· F{n}`.

### 4.2 Stair build notes (P16-D-D)

The per-stair note (`{flights}F · {risers}R @ {riser}×{tread} · F{n}→F{n+1}
{type}[ ent.{side}]`) is fitted to its stair well: the largest height ≤ 0.15 m
that fits the well width (floor 0.09 m); if only the (longer) vertical run
fits, the note runs vertically (rotation 90). Notes that already fit keep the
legacy 0.15 m height and anchor.

### 4.3 Title block and legend (P16-D-A/D)

Model-space `A-TITLE` block: outer border, project name, floor/strategy line,
units/scale line, net-floor-area line, and the fixed honesty line
`ARCHGENIUS — AUTOMATED CAD DRAFT — PROFESSIONAL REVIEW REQUIRED`. No dates
(determinism contract).

Small-plan adaptation (`fr.w < 9 m`, P16-D-D): the title box width becomes
`max(5, 0.62·fr.w)` and each long line's height is fitted to the box
(`fitTitleH`, floor 0.09 m). Plans with `fr.w ≥ 9 m` keep the legacy layout
unchanged.

Legend (11 discipline rows; swatch drawn on the documented layer itself):
the column sits at `tx0 − 3.6` but is clamped to the drawing border; when the
clamped column would run into the title box, the legend is relocated into the
box as a compact grid inside the clear zone **below** the project-name divider
and above the honesty line. Roomy plans keep the beside-box layout untouched.

### 4.4 A-HATCH — reserved, intentionally unused

`A-HATCH` (ACI 8, pen 9) is defined in the LAYER table but **no entity
references it**. The R12 entity vocabulary used by this writer has no hatch
primitive, and generating artificial hatch boundary geometry was explicitly
rejected. The layer is reserved for a future fill strategy; tests pin both the
definition and the non-use.

## 5. Validation

`validateDXFStructure(dxf)` (in `writer.ts`) is the deterministic, line-oriented
QA gate run by `exportDXF`. It checks: required sections/tables/EOF, the
required layer roster in the LAYER table, `$ACADVER AC1009` presence, absence
of R13+ header variables (`$SCREENSIZE`, `$DWGCODEPAGE`, `$INSUNITS`,
`$MEASUREMENT`, `$LUNITS`), and per-entity: finite coordinates, magnitudes
≤ 1e9 mm, no zero-length lines, no exact same-layer duplicate entities, valid
TEXT (non-empty, positive height), positive ARC radii, POLYLINE vertex counts,
no undefined layer references and no dangling linetype references. Coincident
geometry across *different* layers is legal (floor-0 mirror in `'both'` mode).

`pipeline.exportDXF` refuses candidates with hard site-envelope violations and
returns `{ dxf, validation }`; the web UI surfaces the validation state.

## 6. Determinism

- The writer is a pure function: no clock, no RNG, no locale-dependent
  formatting (`toFixed`/`String(number)` only).
- Emission order is fixed by the floor/space/wall iteration order of the
  candidate; the dedup `Set` only suppresses repeats, never reorders.
- Coordinates are rounded to 0.01 mm (`Math.round(m * 100000) / 100`).
- Byte-identity is pinned by tests at three levels: `writeDXF` twice,
  `exportDXF === writeDXF`, and cross-scheme regeneration.

## 7. Known limitations (intentional, current)

- **Pen weights are metadata, not file data**: R12 cannot store layer
  lineweights (group 370 is R13+); plotting by layer name/CTB is required.
- **ASCII-only text**: `dxfSafeText` maps typography and transliterates
  Persian/Arabic letter-by-letter for the DXF representation only — it is a
  deterministic fallback label, not a translation (the web UI keeps full
  Persian).
- **Furniture/sanitary glyphs are footprint rectangles**, not architectural
  symbols (explicitly scoped out; the model footprints exist for QA).
- **A-HATCH reserved but unused** (see §4.4).
- **One presentation scale**: text heights target the documented 1:100 @ A1
  plot; other scales are not auto-adapted.
- **Model space only**: no paper-space layouts, viewports or dimension
  *entities* (dimensions are exploded line/tick/text geometry by design).
- **Small-plan floors**: the fitted floors (title 0.09 m, stair notes 0.09 m)
  are legible on screen but small on paper; this is the accepted trade-off for
  keeping every line inside its container.
- **Test coverage**: the targeted suites (808 core tests, incl. the P16-D
  presentation regression blocks) all pass; the historical ~560-case P16-D
  battery has not been executed yet and remains a deferred item.
