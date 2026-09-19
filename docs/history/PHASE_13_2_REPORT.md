# Phase 13.2 Report — Infeasible Result Semantics Hardening (FINAL DEVELOPMENT PHASE)

Project: **ArchGenius — AI Architectural Planning & Professional CAD System**
Base: Phase 13.1 (`4b168e0`), branch line `arena/01a0b33a-archgenius` → continued on session branch `arena/01a0b849-archgenius` (see Git section).
Scope: **Phase 13.2 only** — infeasible result semantics. No solver/placement/graph redesign, no new architectural features, no Phase 14.

---

## 1. Problem

Independent Phase 13.1 QA verdict: **VERIFIED WITH MEDIUM FINDINGS** — one remaining substantive finding.

Phase 13.1 eliminated *strict* invalid geometry (w ≤ 0, h ≤ 0, area ≤ 0, polygon < 3) from the generated
candidates. However, the pipeline still used this fallback when **no** candidate satisfied the
minimum-geometry contract:

```ts
// Phase 13.1 behavior
const toRank = validCandidates.length > 0 ? validCandidates : all;   // ← fallback to ALL (incl. below-min)
const bestCandidate = candidates[0];                                 // ← selected from invalid/below-min set
project.candidates = validCandidates.length > 0 ? validCandidates : candidates;
project.selectedCandidateId = bestCandidate.id;                      // ← points at a below-min candidate
return { project, candidates: [bestCandidate], bestCandidate };      // ← exposed as a normal plan
```

Consequence: a **below-min-but-positive** candidate (e.g. master-bedroom 9.10 m² < 12 m² minArea,
living h=2.10 m < 3 m minLength) was returned as `bestCandidate`, written into `project.candidates`
and `project.selectedCandidateId`, and could be consumed downstream (DXF/XLSX/report/manifest) as if
it were a normal architectural plan — despite carrying `HARD_CONSTRAINT_INFEASIBLE_DIMENSION`.

Reproduced CASE A fixtures under Phase 13.1 semantics (all 4 strategies below-min, yet a
bestCandidate was exposed): 8x10 (4-bed), 6x14, 5x20, 10x14, 8x12 (1-bed program), tight
L-shapes (L 15x20 notch 5x6 with setbacks, L 12x18 notch 4x6, L 10x10 notch 4x4, L 15x20 notch 5x5),
8-vertex polygon 15x20, 6-vertex polygon 20x20, 3x3, 6x8.

## 2. Root Cause

The Phase 13.1 gate separated `validCandidates` from `invalidCandidates` and (correctly) excluded
invalid candidates from ranking **when at least one valid candidate existed**. But the empty-valid
case had no dedicated result state: the code fell back to ranking the invalid set and returning its
top entry as `bestCandidate`, annotated with a HARD finding and an explanation string. The type
`GenerateResult.bestCandidate: LayoutCandidate` (non-nullable) encoded the wrong contract — it made
"there is always a plan" a type-level guarantee, so every consumer could assume a usable candidate.

A secondary latent defect in the same path: with zero generated candidates
(`generateLayouts` returning `[]`, e.g. `strategies: []`), `bestCandidate.id` threw a `TypeError`.

## 3. Semantic Fix (exactly what happens when `validCandidates.length === 0`)

`packages/core/src/pipeline.ts`:

1. The Phase 13.1 gate is unchanged in its checks (`isValidRoomGeometry`: every room
   w > 0, h > 0, area > 0, polygon ≥ 3 vertices, minWidth, minLength, minArea — same tolerances).
   Each invalid candidate still receives the `HARD_CONSTRAINT_INFEASIBLE_DIMENSION` HARD finding
   (severity `hard`, ruleId `GEOM_VALIDATION`, status `VERIFIED`), now worded for 13.2 semantics.
2. **When `validCandidates.length === 0` the pipeline returns an explicit infeasible result:**
   - `bestCandidate: null` — never selected from invalid candidates.
   - `candidates: []` — usable candidates contain only valid candidates; here: none.
   - `project.candidates = []` and `project.selectedCandidateId = undefined`.
   - `infeasible: InfeasibleResult` with:
     - `code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION'`, `severity: 'hard'`
     - `explanation` — deterministic string (same input+seed → same string), including the count of
       strategy attempts and the first failing minimum-geometry reason per strategy
     - `attempts: InfeasibleStrategyAttempt[]` — per-strategy `{strategy, candidateId, reason}` in
       the order strategies were requested (strategy-attempt information preserved)
     - `attemptedCandidates` — number of candidates generated (all invalid/below-min)
     - `diagnosticCandidates` — the invalid candidates retained **for diagnostics only**, ranked
       best-first with the exact same comparator as the feasible path, so `diagnostics[0]` is the
       least-bad attempt (the same candidate Phase 13.1 would have exposed — now correctly non-usable)
   - No ranking/exposure of invalid candidates as usable; no crash on zero generated candidates
     (`attempts: []`, explanation states "no candidates were generated").
3. **When at least one valid candidate exists** the behavior is unchanged from Phase 13.1/13:
   valid candidates only are ranked (same comparator, same tie-breaks), `bestCandidate` is the
   ranked-best valid candidate, `project.candidates = validCandidates`,
   `infeasible: null`. Invalid candidates are dropped from the usable set exactly as before.

New/changed types (existing architecture, no new abstractions beyond the explicit result state):

```ts
export interface InfeasibleStrategyAttempt { strategy: CandidateStrategy; candidateId: string; reason: string; }
export interface InfeasibleResult {
  code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION';
  severity: 'hard';
  explanation: string;
  attempts: InfeasibleStrategyAttempt[];
  attemptedCandidates: number;
  diagnosticCandidates: LayoutCandidate[]; // diagnostics ONLY — never usable plans
}
export interface GenerateResult {
  project: Project;
  candidates: LayoutCandidate[];        // usable (geometrically valid) only; empty when infeasible
  bestCandidate: LayoutCandidate | null; // null when no geometrically valid candidate exists
  infeasible: InfeasibleResult | null;   // non-null only in the infeasible case
}
```

The `Project` model is untouched (`candidates?`/`selectedCandidateId?` were already optional);
schema version unchanged.

## 4. Feasible vs Infeasible Contract (concrete examples)

All examples verified deterministically (seed 42 unless noted), program = 1F villa unless noted:

| Input | Result | Why |
|---|---|---|
| **15x20** (2 bed, 1 bath) | FEASIBLE — `bestCandidate` non-null, `infeasible: null`, all 4 strategies valid | Site satisfies every minimum |
| **12x18** (2 bed, 1 bath) | FEASIBLE — `bestCandidate` non-null; 3 of 4 strategies valid, only valid ones exposed | One strategy below-min (entrance 1.80 m² < 2) is excluded from usable set, others usable |
| **8x10 (4 bed)** / **6x14** / **5x20** / **10x14** | **INFEASIBLE (CASE A)** — `bestCandidate: null`, `candidates: []`, `project.candidates: []`, `selectedCandidateId: undefined`, `infeasible.code = HARD_CONSTRAINT_INFEASIBLE_DIMENSION`, 4 attempts with reasons like `minA master-bedroom a=9.10<12`, `minL living h=2.10<3`, diagnostics positive-geometry only | Every strategy produces below-min rooms |
| **8x12** (2 bed, 2 bath, 1 parking, seed 1) | **CASE B preserved** — `bestCandidate` non-null with valid geometry, `infeasible: null`, honest HARD site findings remain (GEO_ROOM_OUTSIDE_FOOTPRINT, SITE_*, CIRC_*, …) | Valid geometry exists; HARD *site* findings do NOT become a null candidate |
| `strategies: []` | INFEASIBLE — `bestCandidate: null`, `attempts: []`, explanation "no candidates were generated" (previously `TypeError`) | Zero candidates generated is also an explicit non-usable state |

Key distinction implemented exactly as specified: CASE A (geometry invalid or below minimum →
explicit infeasible state) vs CASE B (geometry valid, validation reports HARD site/constraint
findings → normal candidate semantics preserved, not nulled).

## 5. Downstream Safety

Audit of all consumers of `bestCandidate` / `candidates` / project result / DXF / XLSX / report / manifest:

| Consumer | Behavior for infeasible projects | Feasible projects |
|---|---|---|
| `exportDXF(candidate, …)` | **Throws explicitly** on null candidate (`…no usable candidate — the project is INFEASIBLE…`) and on any candidate marked `HARD_CONSTRAINT_INFEASIBLE_DIMENSION` (`…diagnostic-only…`) | unchanged |
| `buildDocumentation(project, candidate)` | same explicit refusal (doc model drives report/manifest/XLSX/PDF) | unchanged |
| `exportAll(project, candidate)` (DXF + PDF + XLSX + QA report + manifest) | same explicit refusal — **no output set can be silently generated for an infeasible project** | unchanged (verified end-to-end in tests) |
| `validateCandidate` / `summarizeValidation` | clear explicit error on null (diagnostic candidates may still be validated — validation is diagnostics) | unchanged |
| `Project.candidates` / `Project.selectedCandidateId` | `[]` / `undefined` — nothing selectable | unchanged |
| Web UI (`App.tsx`) | `generate()` result handled: empty candidate list, explicit **"INFEASIBLE — no geometrically valid candidate…"** message with the deterministic explanation; plan canvas shows no plan; DXF download disabled | unchanged |
| `documentation/generate-samples.ts` | refuses to generate samples when `bestCandidate` is null | unchanged (feasible 15x20 sample) |
| `Editing` / editing flows | null-guarded by the UI as before (editing requires a displayed candidate) | unchanged |

Guard implementation: `requireUsableCandidate(candidate, operation)` rejects (1) null/undefined and
(2) candidates carrying `HARD_CONSTRAINT_INFEASIBLE_DIMENSION`. Valid-geometry candidates with
ordinary HARD site/constraint findings (CASE B) are **not** rejected — existing export semantics for
them are preserved. Lower-level building blocks (`writeDXF`, `buildDocumentationModel`, `generateXLSX`,
…) remain available for diagnostics; the public pipeline API is the guarded boundary.

## 6. Tests

New file `packages/core/src/phase13_2.test.ts` — 17 focused tests:

- **A** — all candidates below minArea/min (8x10 b4, 6x14, 5x20): `bestCandidate` null, usable
  candidates empty (`result.candidates`, `project.candidates`), `selectedCandidateId` undefined,
  `HARD_CONSTRAINT_INFEASIBLE_DIMENSION` present, 4 attempts with deterministic reasons,
  diagnostics carry the HARD finding; `allStrategies` variant.
- **B** — zero/negative geometry never exposed: rect 8x12 (CASE B), 10x14 (CASE A), L-shape 12x18
  notch 4x6, 8-vertex polygon 15x20 — no exposed or diagnostic candidate has w ≤ 0 / h ≤ 0 /
  area ≤ 0 / polygon < 3; plus the empty-strategies edge (explicit infeasible, no crash).
- **C** — 12x18 feasible: normal `bestCandidate`, `infeasible: null`, only valid candidates exposed.
- **D** — 15x20 feasible: normal `bestCandidate`, all four strategies valid and exposed.
- **E** — 8x12 CASE B: `bestCandidate` **not** null, valid geometry, HARD site findings preserved,
  not converted to infeasible.
- **F** — deterministic infeasibility: same input/seed (42 and 7) → identical explanation, identical
  attempts, identical diagnostic finding codes and ranked-first diagnostic id.
- **G** — downstream safety: infeasible → `exportDXF`/`buildDocumentation`/`exportAll`/`validateCandidate`
  fail explicitly on null and on diagnostic candidates; feasible → full output set generates
  (DXF validated, PDF/XLSX non-empty, report + manifest); CASE B → outputs remain available.

Existing test updates (inspected first; updated **only** to distinguish feasible/infeasible
semantics — no deletions, no weakened assertions):

- `phase12.test.ts` — adversarial matrix (cases 1–5 are CASE A): explicit infeasible branch
  (bestCandidate null, code, explanation, attempts, diagnostics positive-geometry + HARD marker);
  feasible cases keep the original assertions. `M: L-shape site`: infeasible branch with
  diagnostics-geometry check.
- `phase13.test.ts` — `H` (8x12): the 0.85 m unusable-threshold guarantee now verified on
  diagnostic candidates in the infeasible branch; `I`: containment verified on the ranked-first
  diagnostic; `O` adversarial: infeasible branch mirrors the previous "honest HARD" branch.
- `phase13_1.test.ts` — `G` (L-shape 12x18, CASE A): positivity guarantee (`checkNoInvalidGeom`)
  now also verified on diagnostic candidates.
- `phase10.test.ts` — tight-L DXF-site-layer and cross-output tests: the original tight fixtures
  (L 15x20 notch 5x6 with setbacks) are now CASE A; their infeasible semantics are pinned inline
  and the DXF/cross-output verification is kept alive on the feasible L 20x25 notch 8x10 (same
  6-vertex L characteristics). Small-site tests (3x3, 6x8) validate SITE_*/parking diagnostics on
  diagnostic candidates.
- `phase101.test.ts` — per-floor canonical DXF layer tests, multi-floor polygon test, cross-output
  area consistency and determinism tests: same pattern (pin infeasible semantics of the original
  tight fixtures; verify on feasible equivalents — L 20x25 notch 8x10, 6-vertex polygon 24x24).
- `phase9.test.ts` (8x12 2F), `phase11.test.ts` (tight L containment/concave), `phase11_1.test.ts`
  (concave corner), `qa-phase41.test.ts` (regression matrix 8x12; stair-fallback test now also
  iterates diagnostic candidates so it is not vacuous), `phase5-verification.test.ts` (8x12),
  `ir-national-mbr.test.ts` (MBH4-ROOM-001 fires on diagnostics when no usable candidate),
  `intelligence.test.ts` (E2E-F): feasible/infeasible distinction, original assertions preserved
  for the feasible path.
- Type-only cleanup: `bestCandidate` is now `LayoutCandidate | null`; ~357 non-null assertions
  (`!`) were added at use sites on known-feasible fixtures across 16 test files (no runtime or
  assertion changes). Test files are excluded from the project tsc configs by pre-existing design;
  an ad-hoc tests-included typecheck now reports exactly the same 48 pre-existing errors as the
  Phase 13.1 baseline (26 TS18048, 18 TS2339, 3 TS2353, 1 TS2551) — zero new type errors.

**Counts: 27 test files, 613 tests passed, 0 failed, 0 skipped** (Phase 13.1 baseline: 26 files,
596 tests; +1 file, +17 tests).

## 7. Regression — Phase 13 / 13.1 preserved

Untouched and re-verified by the existing suites (all 596 pre-existing tests still pass):
graph-driven placement with `graph.clusters` consumed; generic MUST_ADJACENT /
DIRECT_ACCESS_REQUIRED / MUST_BE_SEPARATED; existence grouping; hard-first ranking;
`MAX_CONSTRAINT_PLACEMENT_ATTEMPTS = 8`, `MAX_LOCAL_REPAIR_ITERATIONS = 4`,
`MAX_CANDIDATE_POSITIONS = 12`; minimum dimensions; canonical polygon (rect derived); locks; four
strategies; stairs; multi-floor (1–10F); L-shape and 8-vertex sites; narrow-site fixes; entrance
carving guards; public-band feasibility-first logic; deterministic behavior (no changes to
`generator.ts`, `placer.ts`, `constraint-graph.ts`, `ranking.ts`, or any layout/geometry module —
the only production-code changes are `pipeline.ts`, the `generate-samples.ts` null guard, and the
web `App.tsx` result handling).

## 8. Verification Results

| Check | Result |
|---|---|
| `npx vitest run` (core) | **613 passed / 0 failed / 0 skipped — 27 test files** |
| Core `tsc --noEmit` | **PASS** |
| Web `tsc --noEmit` | **PASS** |
| `vite build` | **PASS — 311 modules transformed** |
| Ad-hoc tests-included typecheck | 48 pre-existing errors only (identical to Phase 13.1 baseline) |

## 9. Limitations

- "Infeasible" here means **no candidate satisfies the minimum-geometry contract**. It is a
  generation-level state, not a claim that the site is legally unbuildable, and not a regulation
  compliance verdict. No "100% compliant"/"municipality approved" claims are made anywhere.
- CASE B candidates (valid geometry + HARD site findings, e.g. 8x12 narrow) remain exportable by
  design; consumers must continue to read findings. This preserves Phase 13.1 semantics as required.
- `diagnosticCandidates` are retained for diagnostics; their geometry is positive (Phase 13.1
  guarantee) but below-minimum. Any consumer using them (instead of `candidates`/`bestCandidate`)
  is responsible for treating them as non-plans — the export guards enforce this at the pipeline
  boundary, and lower-level modules (`writeDXF` etc.) intentionally remain unguarded building blocks.
- The feasibility boundary itself (which fixtures are CASE A) is a property of the deterministic
  placer and program minimums; it may shift if placement or program minimums ever change — the
  Phase 13.2 tests pin the current boundary.
- Iranian national regulation rules remain separated from municipal rules; rule statuses remain
  VERIFIED / REQUIRES_SOURCE_VERIFICATION / NOT_IMPLEMENTED / DEPRECATED; findings remain
  HARD / SOFT / ADVISORY. No regulation content was modified.

## 10. Git

- Implementation branch: `arena/01a0b849-archgenius` (this session's fixed branch; the platform
  does not allow this session to push `arena/01a0b33a-archgenius`). It was reset — with no unique
  work on it — from main's tip to the exact Phase 13.1 commit `4b168e09` so that Phase 13.2
  continues precisely from the Phase 13.1 state. `main` untouched; no force push.
- Commit: `Phase 13.2 final hardening: explicit infeasible result semantics — bestCandidate null, no usable candidate for below-minimum geometry, downstream output guards` (+ follow-up docs commit with the final hash, per project convention).

## 11. Status

Phase 13.2 contract implemented and verified as described above. Recommended next step: independent
read-only FINAL QA. No Phase 14 work was started.
