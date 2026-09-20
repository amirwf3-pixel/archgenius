# Phase 15 — M1: Generalized Stress Harness (560 cases)

**Date:** 2026-09-20 · **Scope:** test-infrastructure only — zero production-geometry changes.

## Goal

Recover the Phase-15 program (lost workspace) with a deterministic, generalized stress
harness that measures the generator honestly, before any capability work begins.
The harness must never weaken validators; it classifies with the *existing*
`validateLayout` and the Phase-13.2 infeasible semantics.

## Matrix — 560 = 70 sites × 8 programs (site-major, seed 42 for all cases)

- **Sites (70):** 56 rectangles (widths 8/10/12/14/16/20/25 × lengths 10/12/15/18/22/26/30/34),
  6 l-shapes (notch variants incl. access-side and deep notches), 8 orthogonal polygons
  (U, T, Z, right-stair, wide-L, narrow-L, notched rectangle, boot; ≤ 8 vertices).
- **Programs (8):** 5 single-floor (1BD, 2BD, 3BD, 4BD, 3BD+2MB+balcony) and
  3 multi-floor villas (2F/3BD, 2F/4BD+family, 3F/5BD — stair forced by AGX-02).
- Narrow-site pressure is built in: width 8 with default setbacks (N3/S2/E2/W2) leaves
  ~4×N m buildable — a physical stress, not a corner-case hack.

## Classification (honest, validator-driven)

| Status | Rule |
|---|---|
| FEASIBLE | `bestCandidate` exists AND fresh `validateLayout` → **0 HARD findings** |
| HARD_WINNER | `bestCandidate` exists with ≥1 HARD finding (pre-15 CASE-B exposure; gated at M2) |
| INFEASIBLE_NC | pipeline returned explicit `InfeasibleResult` (Phase 13.2 CASE A) |
| ERROR | harness throw — must be 0; nonzero exit otherwise |

Per case: hard-code histogram, soft count, winning strategy, and a **program-capacity
diagnostic** (`buildableArea` vs per-floor Σ minArea → `worstFloorRatio`; > 1 proves a
genuine NC independent of the placer).

**DXF cohort:** 126 FEASIBLE cases selected deterministically (stratified ≤42 per site
class, then matrix order). Each is checked with `validateDXFStructure` + `parseDxf`
(both existing verifiers) and re-generated end-to-end for **cross-run byte determinism**
(second `generate()` + `writeDXF` must be byte-identical).

## M1 baseline measurement (current engine, before M2–M7)

```
cases: 560 · errors: 0
feasible: 165 (29.5%) · hard-winners: 122 (21.8%) · NC: 273 (48.8%)
  single: 128/350 feasible · multi: 37/210
  rectangle: 163/448 · l-shape: 2/48 · polygon: 0/64
DXF sample: 126 checked · 126 valid · 126 deterministic
NC demand-proven genuine (ratio > 1): 81/273
top winner hards: SITE_WALL_OUTSIDE_BUILDABLE 388 · SITE_FURNITURE_OUTSIDE_BUILDABLE 249 ·
  GEO_OVERLAPPING_ROOMS 219 · CIRC_INACCESSIBLE_SPACE 206 · SITE_OPENING*_OUTSIDE 338 ·
  GEO_ROOM_OUTSIDE_FOOTPRINT 139 · GEO_OVERLAPPING_WALLS 125 · MBH4-ROOM-001 69 ·
  CONSTRAINT_DIRECT_ACCESS 63 · CONSTRAINT_MUST_SEPARATED 33
```

Interpretation: ~195 m²-class rectangle sites already pass; the 54-NC target at M8 means
pushing feasible ≥ ~506, which requires the M2–M7 work (gate, program distribution,
topology, circulation, narrow/asymmetric sites, vertical integration). Harness run-to-run
output is byte-identical (verified with two full runs).

## Files

- `packages/core/src/stress/matrix.ts` — site/program matrix (pure data)
- `packages/core/src/stress/stress.ts` — runner + report model (report-only)
- `packages/core/src/stress/run-stress.ts` — CLI; writes `outputs/stress-report.json` (gitignored)
- `packages/web/tsconfig.json` — exclude `../core/src/stress/**` from the web graph
  (same mechanism already used for `src/verify/**` and `generate-samples`)
- `packages/web/src/ui.test.tsx` — 1-line implicit-any annotation (pre-existing HEAD
  typecheck error; type-only, no behavior change)

## Run

```
npm run build -w @archgenius/core
node packages/core/dist/stress/run-stress.js     # ~10 s
```

## Gates at M1

| Gate | Result |
|---|---|
| Core tests | **671 passed / 671** (unchanged — harness files are not tests) |
| Web tests | 64 passed / 64 |
| Root `npm run typecheck` | PASS (core + web) |
| `npm run build` | PASS |
| Harness determinism | 2× full runs → byte-identical report |
| DXF sample | 126/126 valid + deterministic |
