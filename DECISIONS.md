# ArchGenius — Architectural & Technical Decisions

This file records significant design decisions. New entries are added in reverse chronological order.

---

## 001 — Monorepo (npm workspaces)

**Date:** 2026-09-18
**Status:** Accepted

**Context:** We need a deterministic geometry engine that can be tested independently of a UI, plus a web front-end and shared domain types.

**Decision:** Use a single npm-workspaces monorepo:

- `packages/core` — deterministic planning engine, geometry, regulation, validation, DXF export. Zero runtime dependencies beyond Node standard libraries.
- `packages/web` — React/Vite/Tailwind UI that consumes `@archgenius/core` as a library.
- `packages/shared-types` — (future) if type sharing is needed; currently types live in `core`.

**Consequences:** Core stays testable and portable. UI can never leak logic back into core.

---

## 002 — Language: TypeScript (strict mode)

**Date:** 2026-09-18
**Status:** Accepted

**Context:** The product is a serious engineering tool with strong types for geometry, regulation, and validation.

**Decision:** TypeScript with `strict: true` everywhere. All public APIs have explicit type signatures. Geometric primitives are plain value objects (immutable-by-convention).

---

## 003 — Offline-first deterministic core

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** `@archgenius/core` has no network calls, no LLM dependencies, no non-deterministic randomness in `generate(deterministic = true)`. All geometry is computed from the parametric input. Identical inputs → identical outputs when a fixed random seed is supplied.

**Consequences:** Tests are reproducible. The core can run in a worker, in Node, or in the browser without network.

---

## 004 — DXF writer implemented from scratch

**Date:** 2026-09-18
**Status:** Accepted

**Context:** DXF is the primary deliverable. We need full control over layers, lineweights, entity types, dimensions, and annotations, and we need to avoid heavyweight CAD libraries with transitive dependencies.

**Decision:** Implement a self-contained DXF ASCII (R12-compatible) writer inside core, emitting LINE, LWPOLYLINE, CIRCLE, ARC, TEXT, DIMENSION, INSERT, HATCH, BLOCK entities directly from the architectural model. R12 is chosen because it is universally compatible (AutoCAD, LibreCAD, DraftSight, ARES Commander, online viewers) and has a clean textual grammar. Future versions may add an R2000/AC1015 binary writer.

**Alternatives considered:**
- `dxf-writer` npm package — too limited (no proper HATCH, DIMENSION, block support).
- `brics-dxf`, `node-dxf` — unmaintained / license concerns.
- Using SVG-to-DXF conversion — violates principle of generating DXF from the source-of-truth model.

**Consequences:** We own the DXF quality. We must add our own regression tests against a DXF parser.

---

## 005 — Coordinate system

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** Internal coordinate system is metric (meters), double precision. Origin is at the **south-west** corner of the site bounding box. +X = East, +Y = North. All rounding is deferred until DXF/DXF-friendly export (millimeters in DXF: internal meters × 1000). Angles are in radians internally, converted to degrees (counter-clockwise from +X east-axis) for DXF.

**Reason:** North orientation is an input parameter (degrees clockwise from true North of the +Y axis); rotation is applied only at render/export time so the model always stays axis-aligned internally. This dramatically simplifies rectangle packing and overlap checks.

---

## 006 — Layout generation strategy

**Date:** 2026-09-18
**Status:** Accepted

**Context:** V1 must produce valid rectangular residential plans quickly and deterministically.

**Decision:** Use a **deterministic slice-based partitioning** for rectangular sites:

1. Compute the buildable footprint from setbacks (regulation-driven).
2. Reserve perimeter zones for parking/yard/entrance on the access side.
3. Place the stair/elevator core and vertical circulation.
4. Slice the remaining footprint into bands (public/semi-private/private) based on adjacency priorities.
5. Subdivide bands into rooms matching the space program, using proportional target areas.
6. Generate walls along room boundaries, deduplicate shared walls.
7. Insert doors along circulation-adjacent walls.
8. Insert windows on exterior walls.
9. Run full geometric + architectural validation; reject the candidate if any HARD constraint fails.

**Alternatives considered:**
- Evolutionary / genetic algorithms — postponed to Phase 3 (multi-solution + optimization).
- Force-directed placement — too non-deterministic for V1.
- AI/ML floor-plan models — rejected by Principle #3.

---

## 007 — Validation categories

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** Three validation severities, never mixed:
- **HARD** → layout is INVALID; cannot be exported.
- **SOFT** → layout is usable but SUBOPTIMAL; contributes a numeric penalty during optimization.
- **ADVISORY** → REVIEW REQUIRED; professional judgment needed.

Each finding carries: `code`, `severity`, `message`, `sourceRuleId?`, `entityId?`, and (when possible) a geometric bounding box for UI highlighting.

---

## 008 — Regulation pack architecture

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** Regulations are represented as versioned JSON/TS packs under `packages/core/src/regulations/packs/<jurisdiction>/`. Each rule has: `ruleId`, `jurisdiction`, `edition`, `effectiveDate`, `severity` (HARD/SOFT/ADVISORY), `condition` (evaluator function or data-driven predicate), `reference`, and `status` (`ACTIVE`, `DRAFT`, `REQUIRES_SOURCE_VERIFICATION`). Unknown rules are never invented — they are surfaced as `REQUIRES SOURCE VERIFICATION`. National packs (e.g., `ir-national-mbr`) and local packs (e.g., `ir-tehran`, `ir-karaj`) are composed at runtime.

---

## 009 — Units & precision

**Date:** 2026-09-18
**Status:** Accepted

**Decision:**
- Internal: meters (floating-point doubles).
- Geometric epsilon: `1e-6` meters (1 micrometer) for overlap/intersection tests.
- Display: millimeters (0 decimals) and square meters (2 decimals).
- DXF: millimeters (INSUNITS=4), written as integers where possible, coordinates rounded to 0.01 mm (4 decimal places after m→mm conversion).

---

## 010 — Web UI stack

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** React 18 + Vite + TypeScript + Tailwind CSS. Canvas-based 2D plan preview (no map/3D libraries for V1). Zustand for client state. Project persistence uses `localStorage` + file-based JSON export/import in V1.

**Consequences:** UI stays a thin view/control layer over the deterministic core.

---

## 011 — Testing

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** Vitest with TS support. All geometry, layout, validation, regulation, and DXF code paths must have unit tests. DXF tests parse generated output to verify layers, entities, and structural validity. A golden-file strategy will be used for representative floor plans.

---

## 012 — No image-based generation at any layer

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** Raster images are NEVER the source of truth. The DXF is written from the structured architectural model. Rendering the model for screen preview is a downstream consumer.

---

## 013 — First vertical slice scope

**Date:** 2026-09-18
**Status:** Accepted

**Decision:** The first working slice targets:
- Rectangular site (single access side, flat north-up orientation),
- Single-floor or two-floor villa / small apartment,
- Configurable bedrooms (1–3), bathrooms, WC, kitchen (open/closed), living/dining, parking (0–2), stair,
- Deterministic rectangular-room layout,
- Walls, interior doors, entrance door, windows,
- Hard-constraint geometric validation,
- Real DXF output with proper layers,
- Basic web UI to enter inputs, view plan on canvas, download DXF,
- Tests covering geometry, space programming, a sample layout, DXF structure.
