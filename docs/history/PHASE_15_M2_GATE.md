# Phase 15 — M2: Honest HARD-Feasibility Gate

Date: 2026-09-20 · Branch tip base: `a433ae4` (M1) · Scope: pipeline gate only (no geometry, no validator, no DXF-writer changes)

## Problem

Until M2, `generate()` exposed any geometrically-valid candidate as *usable*, even when the
unmodified validator still reported HARD findings (e.g. `GEO_OVERLAPPING_ROOMS`,
`CIRC_INACCESSIBLE_SPACE`, `SITE_WALL_OUTSIDE_BUILDABLE`, `MBH4-ROOM-001`). M1's 560-case
stress harness measured **122/560 cases where the winner carried residual HARD findings**
— silently presented as normal plans.

## The gate (packages/core/src/pipeline.ts)

A candidate is **usable** only if BOTH:

1. it is geometrically valid (`isValidRoomGeometry` — the pre-M2 contract), AND
2. a FRESH `validateLayout(candidate)` returns **zero HARD findings**.

Rejection taxonomy (deterministic, never silent):

| situation | result |
|---|---|
| ≥1 usable candidate | normal `GenerateResult` (infeasible = null; usable set only) |
| all candidates geometry-invalid | `INFEASIBLE` `HARD_CONSTRAINT_INFEASIBLE_DIMENSION` — Phase 13.2 frame, message byte-identical |
| valid-but-hard-dirty exist, none usable | `INFEASIBLE` `HARD_RULE_VIOLATION` (new variant) |
| nothing generated at all | `INFEASIBLE` `HARD_CONSTRAINT_INFEASIBLE_DIMENSION` + `no candidates were generated` |

`HARD_RULE_VIOLATION` infeasible result:

- `attempts[]` carry a per-strategy residual histogram: `reason = "hardCount=N: CODE xN, …"` (count-desc, code-asc) and new typed field `hardCodes?: Array<[code, count]>`.
- `explanation` fixed frame: `Phase15 M2 INFEASIBLE (HARD_RULE_VIOLATION): … must NOT be treated as a normal architectural plan.`
- `diagnosticCandidates` = every rejected candidate (both kinds), ranked.

Hard-dirty-but-valid candidates get ONE **additive** marker finding
(`HARD_RULE_VIOLATION` / `ruleId: HARD_FEASIBILITY_GATE`); their original validator findings are
kept verbatim. `project.candidates`/`selectedCandidateId` are only ever set from the usable set.

Downstream safety: `requireUsableCandidate` refuses both markers — `exportDXF`,
`buildDocumentation`, `validateCandidate(null)` produce explicit errors; a gate-rejected
candidate can never leave the system as a normal plan.

## Explicit non-goals honored

- `generator/`, `layout/ranking.ts`, `validation/validator.ts` and every validator: **untouched** — no weakening, suppression, or reclassification.
- DXF writer files: **untouched** (only `dxf/*.test.ts` fixture sourcing changed).
- M1 stress harness (`packages/core/src/stress/`): unchanged.
- No footprint-specific hacks: the gate is program/site-agnostic by construction.

## Test policy (79 fallout failures triaged individually)

- **Fixture-sourcing rows** (pre-M2 tests that merely needed *a* plan object to inspect
  rooms/openings/findings): switched to a test-only helper
  `packages/core/src/testutil/legacy-generate.ts`, which replicates the exact pre-M2
  geometry-only contract (incl. the DIM finding push and `project.candidates` mutation) so
  those tests keep testing what they were written to test. No assertion weakened.
- **Tolerant regression branches** (adversarial loops that already accepted “either feasible
  or explicit INFEASIBLE”): code check widened to `DIMENSION | RULE`; all diagnostics checks retained.
- **Honest semantic rewrites (3)**: `pipeline.test.ts` 2-story row and `v101-regression.test.ts`
  AGX-04 now assert the M2 contract (usable ⇒ zero hards, else explicit INFEASIBLE + refusals);
  `phase13_2.test.ts` D: `allStrategies` usable set = hard-clean only (15×20 legitimately
  exposes 3 of 4 strategies; the functional-circulation strategy's residual hard is now reported, not exposed).
- New `packages/core/src/phase15_2.test.ts` (6 tests): gate contract itself — usable⇒zero-hards,
  RULE variant shape + histogram ordering, determinism, DIM variant byte-identical (no
  reclassification), output-surface refusals, marker on every diagnostic.
- Web: `i18n.ts` gained `HARD_RULE_VIOLATION` finding translation + RULE infeasible-explanation
  translation (Persian), mirroring the DIM entries; the 18×25 i18n e2e row now sources its
  finding-carrying plan from the honest diagnostics (translation coverage of REAL validator
  findings preserved).

## Results (post-M2)

| gate | result |
|---|---|
| core tests | **677/677** (671 pre-M2 baseline repaired + 6 new M2 tests) |
| web tests | **64/64** |
| typecheck (root: core + web) | clean |
| build (root) | clean (vite bundle ok) |
| 560-case stress | feasible **165**, hard-winners **0** (was 122), NC **395** (was 273), errors 0; cohorts: single 128/350, multi 37/210; rect 163/448, l-shape 2/48, polygon 0/64; proven-genuine NC 87/395 |
| stress determinism | two consecutive runs: report content byte-identical (excl. `durationMs` wall-clock) |
| DXF sample | 126/126 valid + deterministic (same winners as M1 — gate only removes dirty winners, which are now NC) |

Every formerly hard-winning case is now an explicit `HARD_RULE_VIOLATION` INFEASIBLE with
per-strategy residual codes — the honest floor. Fixing WHY those strategies fail
(upper-floor program duplication, split rigidity, circulation, non-rect sites) is M3–M7.
