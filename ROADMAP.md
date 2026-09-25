# ArchGenius — Roadmap

> **V1.0 status:** Development is complete and frozen as of **Phase 13.2** (final development phase).
> Current release state: **V1.0 Release Candidate** — independent QA verdict `VERIFIED WITH MEDIUM FINDINGS`.
> See [RELEASE_NOTES.md](RELEASE_NOTES.md) for verified capabilities and known limitations.
> This roadmap reflects the actual completed state; the original per-milestone planning items are
> annotated with their final status. Full phase-by-phase engineering history lives in
> [`docs/history/`](docs/history/).

## Phase 1 — Foundation (complete)
- [x] Repository scaffold (monorepo, TS, workspaces)
- [x] Domain model types (Project, Site, Building, Space, Wall, Opening, Floor, Layout)
- [x] Geometry primitives (Vec2, Rect, Polygon, overlap, area, distance)
- [x] Regulation abstraction (Rule, Pack, Severity, engine)
- [x] Validation abstraction (Finding, severity categories, validator pipeline)
- [x] DXF writer abstraction (ASCII R12, layers, LINE/TEXT/CIRCLE/ARC/POLYLINE)
- [x] Testing infrastructure (Vitest, test categories)
- [x] ARCHITECTURE.md / DECISIONS.md / ROADMAP.md
- [x] Project persistence (JSON serializable model)

## Phase 2 — Real MVP engine (complete)
- [x] Rectangular site input (width, length, north, access side, street width)
- [x] Parametric building input (villa / apartment, floors, units, bedrooms, baths, WCs, kitchen, parking, stair, elevator)
- [x] Space programming (derive rooms, target/min areas, adjacency)
- [x] Buildable-area from setbacks (stub regulation pack)
- [x] Deterministic slice-based layout generation for rectangular rooms
- [x] Wall generation (external + internal, thickness-aware, merged shared walls)
- [x] Door placement (entrance + internal doors on circulation)
- [x] Window placement on exterior walls
- [x] Stair placement (single rectangular flight in V1)
- [x] Parking placement (rectangular stalls on access side)
- [x] Geometric validation (overlap, zero-area, invalid dims, disconnected circulation)
- [x] Real DXF export with proper layers, walls, doors, windows, room labels, dimensions
- [x] Basic React UI: parameter form + canvas preview + DXF download
- [x] Automated tests (geometry, programming, generator, DXF structure)

## Phase 3 — Optimization & multiple candidates (complete)
- [x] Candidate strategies — delivered as **four**: area-efficiency / functional-circulation / daylight-orientation / alternative-zoning
- [x] Scoring metrics (usable-area ratio, circulation ratio, adjacency satisfaction, daylight, privacy, …)
- [x] Deterministic optimization — implemented as bounded deterministic search (8 placement attempts / 4 repair iterations / 12 candidate positions) + deterministic ranking
- [x] Multi-floor vertical circulation validation (stair validation, vertical-circulation & stacking evaluation)
- [x] Non-rectangular rooms (L-shape 6-vertex, bounded orthogonal concave up to 8 vertices, polygon-authoritative)

## Phase 4 — Regulation packs (partially complete)
- [x] National pack: Iran MBR (Mabhas-e 4 / Mabhas 15) — sourced from Tier-1 PDFs, 9 rules VERIFIED with SHA-256/page/clause evidence
- [x] Jurisdiction packs: Tehran, Karaj, Mashhad, Isfahan, Shiraz — **infrastructure complete** (deterministic municipality resolver over jurisdiction/city input with English/Persian variants; per-city placeholder packs `ir-tehran-stub`, `ir-karaj-stub`, `ir-mashhad-stub`, `ir-isfahan-stub`, `ir-shiraz-stub`, each a single advisory NOT_IMPLEMENTED notice; municipal sources NOT OBTAINED — no municipal rules or thresholds are shipped, and actual municipal rules remain REQUIRES_SOURCE_VERIFICATION)
- [x] Setbacks with explicit source/status tracking (user design input vs default assumption vs verified) — legal FAR/coverage/density enforcement intentionally out of scope
- [x] Regulation explorer UI with source references — **complete** (read-only pack/rule browser: status badges, reference/edition, source tier, clause/page)
- [x] Rule traceability via the source registry (digests, pages, snippets); multi-version pack loading **built**

## Phase 5 — Professional deliverables & UI (mostly complete)
- [x] PDF sheet generation (title block, per-floor pages, drawing numbers `AG-{id}-WB`)
- [x] XLSX space schedule (11 sheets incl. site, QA, regulations, intelligence)
- [x] QA report (structured findings: qa + regulations)
- [x] Consistency manifest (checksum, cross-output consistency)
- [x] Project management dashboard (list, save/load/import/export) — **complete** (core storage module exposed publicly; localStorage-backed list/save/load/import/export)
- [x] Plan inspection UI (spaces panel: type/area/vertices, click-to-select; findings panel with severity codes) — per-room dimension callouts not built
- [x] Better canvas preview (panning, zoom, hatch) — **built** (cursor-anchored wheel/button zoom with limits, eased pan with capped inertia, fit-to-view, room-clipped architectural hatch toggle)
- [x] North symbol, grid lines, axis labels, and title block in DXF — emitted on layers `A-NORTH` (north arrow with "N" label), `A-GRID`, `A-AXIS` (labels A/B/C/1/2), `A-TITLE` (title block), plus dimension entities on `A-DIMS`

## Phase 6 — Advanced cases & polish (partially complete)
- [x] Irregular sites — L-shape and orthogonal polygon (3–8 vertices, deterministic scanline decomposition, no silent bbox fallback)
- [x] Apartment typology — **first vertical slice only** (single full unit per floor; no shared cores / multi-unit layouts)
- [x] Storage rooms (programmed space) — balcony/yard specs exist in programming but are not exposed in the UI
- [x] Furniture placement (sanitary fixtures, kitchen counters, furniture validation)
- [x] Elevator shaft geometry — **complete** (deterministic shaft cell reserved beside the stair core, exactly stacked on every floor with ELEV_* validation; dimensions are design assumptions — MBH15-LIFT-002 remains NOT_IMPLEMENTED)
- [x] Multi-section details — **complete** (6c4ce1b)
- [x] Comprehensive regression suite (core 959 tests, web 153 tests, incl. determinism, adversarial matrices, CAD structural validation) — committed golden DXF fixtures not included (outputs gitignored)
- [x] Accessibility checks — **complete** (42bb918)
- [x] Bounded performance (bounded search enforced in code and tests; 10-floor generation well under a second in QA runs) — committed benchmark suite not included

## Completed development history (Phases 5.2 → 13.2)

| Phase | Scope (from the phase reports) |
|---|---|
| 5.2 | Primary regulation source integration & verification — 9 rules promoted to VERIFIED |
| 6 | Professional architectural layout & CAD quality |
| 7 | Professional documentation & multi-output engine (PDF/XLSX/report/manifest) |
| 8 | Advanced architectural intelligence & candidate optimization |
| 9 / 9.1 | Whole-building multi-floor intelligence & optimization + hardening addendum |
| 10 / 10.1 | Site/context intelligence & buildability constraints + site-aware hardening |
| 11 / 11.1 / 11.2 | Parametric planning & constraint-aware editing (polygon canonical, locking, bounded editing) |
| 12 | Constraint-aware architectural placement |
| 13 | Generic constraint solver & graph-driven placement |
| 13.1 | Hardening: negative dimensions eliminated, feasibility-first placement, invalid candidates excluded from ranking |
| 13.2 | Infeasible result semantics: nullable bestCandidate, explicit INFEASIBLE state, downstream output guards |
| 15 | M1–M8 hardening: 560-case stress matrix, honest NC taxonomy, bounded search, program completeness, vertical-core coherence |
| 16 | P16-A parking band reservation + stall placement · P16-B all-side entrance orientation · P16-C proportions/quality depth · P16-D DXF presentation QA |
| 17 | P17-A architectural audit · P17-B form-quality ranking · P17-C per-floor envelope compaction · P17-D corridor-quality ranking · P17-E east/west access · P17-F final architectural QA (0 CRITICAL / 0 HIGH / 5 MEDIUM) |
| 18 | Final QA: exact door-swing sector geometry (swing/furniture SOFT false positives eliminated); residual/circulation findings confirmed intentional |

## Release state (v1.1.0)

- Phases 15 (stress/validation hardening), 16 (parking, all-side access, proportions, DXF
  presentation) and 17 (architectural quality program, audit-closed) are **complete**.
- Independent release QA: `VERIFIED WITH MEDIUM FINDINGS` at V1.0 (M1/M2 still documented);
  final architectural QA at v1.1.0 (P17-F): 0 CRITICAL, 0 HIGH, 5 MEDIUM known limitations
  (see [RELEASE_NOTES.md](RELEASE_NOTES.md) and README §10).
- Known partial capabilities: apartment (first slice), CI pipeline. Elevator shaft geometry,
  regulation explorer UI and project dashboard are complete (MBH15-LIFT-002 elevator dimensions
  remain NOT_IMPLEMENTED). Parking is implemented since P16-A.

## Non-goals (for the foreseeable future)
- Image/PDF/DXF import
- Raster-to-CAD
- 3D visualization / BIM
- Commercial / hospital / educational / industrial typologies
- Cloud-dependent AI as a required component
- Municipality approval automation
