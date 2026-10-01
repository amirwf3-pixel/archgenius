## Unreleased — Tasks 145–162 (post-Phase 18)

Post-v1.1.0 work, pushed to the working branch (verified at `41bff3e`: core 1928 / web 218 tests,
typecheck, build and GitHub Actions CI pass). Historical per-item notes below may still mention the
commit or test counts of the time.

### V1 productization and portfolio (`41bff3e` and after)

- Web form sends the declared `setbackNorth/South/East/West` site fields, so the
  `DEF-SETBACK-001` "Applied setbacks" finding reports the user's setbacks (geometry and DXF
  unchanged); the plan-canvas caption reads "floor N of total" (1-based).
- English portfolio overview [docs/PORTFOLIO.md](docs/PORTFOLIO.md) with a UI screenshot; README
  facts refreshed (V1 rectangle-only scope, DXF units, test/CI status, demo output).

### Coordinated rectangle planner (`coordinatedRectPlanner`, opt-in, default OFF) — P1–P10 complete

An API-level option of `generate()` / `generateLayouts()` (not exposed in the UI). Omitted or
false = legacy output, byte-identical (layout regression harness: 0 changed rows; best DXFs
byte-identical 32/32 benchmark, 177/177 sweep). When on, a coordinated building frame is tried per
strategy and adopted only through the existing adoption guard; any rejection returns the exact
legacy candidate.

- **P1** pure building-frame derivation (`layout/building-frame.ts`).
- **P2** rectangle public-band families extracted from the placer (behaviour-preserving).
- **P3** optional pinned zones / public family inputs to `placeSpaces()` (absent = unchanged).
- **P4** single-floor, no-core coordinated planner behind a strict adoption guard.
- **P5** coordinated multi-floor stair/elevator core on a shared frame.
- **P6** strict frame-residual check (placed rects entering the residual → rejected).
- **P7** vertical (depth-dominant) frame mode.
- **P8** residual retry without a side residual.
- **P9** target-depth retry.
- **P10** bounded vertical target-length retry.

Measured with the option on (128-case benchmark + 560-case matrix, 1888 strategy rows): 237
coordinated adoptions (61 of them via P10); all other rows keep the legacy candidate.

**P11 — diagnosed, rejected (`NO SAFE SMALL FIX`, no production change).** The largest remaining
non-adopted group with a valid legacy (28 rows) adds a soft `CIRCULATION_EXCESSIVE` on the ground
floor of multi-floor layouts. Circulation area actually decreases versus legacy and the corridor
has no unserved length; the ratio exceeds 35 % only because rooms shrink toward their targets
(legacy passes with oversized rooms, e.g. a 122 m² living room). Removing the finding would require
inflating rooms, changing programme/stair sizing, redesigning the corridor topology, or changing
the adoption guard / threshold — none of which is a safe bounded fix.

### Plan inspection UI
- **Task 145 — per-room dimension callouts** (`8c984e7`): the selected room shows edge-length
  callouts computed only from the canonical `Space.polygon` (world metres); geometry is never
  mutated or inferred from pixels (`packages/web/src/room-dimensions.ts`).
- **Task 146 — callout fixes** (`95bed73`): dimension labels render in an LTR run and avoid the
  room label.
- **Task 147 — area labels** (`bb34df0`): canvas room area labels render in an LTR run inside the
  Persian RTL UI.

### Regression infrastructure
- **Task 148 — CI workflow** (`d76e15b`): `.github/workflows/ci.yml` runs `npm ci`,
  `npm run typecheck`, the core and web test suites and `npm run build` on push / pull request
  (Node 22). **It has not yet been executed on GitHub** — the commit has not been pushed — so no
  GitHub CI result exists.
- **Task 149 — golden DXF fixtures** (`f76227e`): three committed fixtures (`rect-1f`,
  `lshape-2f-stair`, `decimal-asym-2f-stair`) under
  `packages/core/src/regression/fixtures/golden-dxf/`, compared byte-for-byte (size + sha256) by
  `golden-dxf.test.ts`. The DXF writer and its frozen R12 ASCII profile (`$ACADVER` = `AC1009`)
  are unchanged; output is not normalized. No AutoCAD verification is claimed.
- **Task 150 — regression audit** and **Task 151 — UI-exposure gap report**: analysis only, no
  code change.

### Balcony (`building.hasBalcony`)
- **Task 152 — bounded core balcony** (`84bff39`): an enabled balcony is bounded by its existing
  program (target 4 m², min 2 m²; area cap 7.0 m² from the existing M4 formula) and gets a real
  access door. New HARD findings `BALCONY_OVERSIZED` and `BALCONY_NO_ACCESS`.
- **Task 153 — UI toggle** (`79ebf2a`): «بالکن» checkbox, default OFF, sent as `hasBalcony: true`
  only when checked; saved projects round-trip the flag; Persian titles/messages for both findings.

### Yard (`building.hasYard`)
- **Task 154 — bounded core yard** (`c13764c`): an enabled yard is a real open-air ground-floor
  space (no walls, no doors) placed behind or beside the building — never on the street side —
  inside the buildable polygon, clear of every floor's spaces and of parking, sized from the
  existing program (target 20 m², min 10 m², cap 35 m²) and reachable from the street over open
  ground with a walkway at least the corridor minimum width. New HARD findings `YARD_INVALID` and
  `YARD_NO_ACCESS`; a yard that cannot fit is reported as `ARCH_PROGRAM_UNPLACED` → INFEASIBLE.
- **Task 155 — UI toggle** (`2f46531`): «حیاط» checkbox, default OFF, sent as `hasYard: true` only
  when checked; saved projects round-trip the flag; Persian titles/messages for both findings.
- **Task 156 — Persian program names** (`910b8ee`): `ARCH_PROGRAM_UNPLACED` shows the Persian space
  name (e.g. «حیاط», «بالکن», «اتاق خواب») via the existing space-type table; unknown ids stay
  verbatim.

With both toggles OFF (the default), the engine input and the generated plans/DXF are
byte-identical to the previous behaviour (pinned by the web tests and the golden fixtures).

### Family room (`building.hasFamilyRoom`, core only)
- **Task 159 — diagnosis**: analysis only, no code change. On the first upper floor the family
  room could be the only public space in its band, and the band filler gave it the whole band
  (measured up to ~251 m² for a 12 m² program).
- **Tasks 160–161 — bounded family room** (`f1189b7`): the family room is now placed in a bounded
  rectangle sized from its existing program (target 12 m², min 8 m², min width 2.6 m), with a
  door and an exterior window. New HARD finding `FAMILY_ROOM_OVERSIZED` above the shared M4 area
  cap (21.0 m² for this program). A family room that cannot fit is reported as
  `ARCH_PROGRAM_UNPLACED` → INFEASIBLE. With `hasFamilyRoom` off, plans/DXF are byte-identical.
  Some already-invalid (diagnostic) candidates now report different HARD findings, because the
  oversized room had been bridging disconnected circulation; no previously HARD-free candidate
  gained a HARD finding (pinned by `family-room.test.ts`). The flag is still **not exposed in
  the UI**.

### Local verification at `f1189b7`
Core 1619/1619 tests (86 files), web 209/209 (11 files), `npm run typecheck` and `npm run build`
pass — executed locally, not on GitHub CI.

### Known limitations (current)
- **Balcony / yard can make a previously feasible input INFEASIBLE.** This is intentional: when
  the requested space cannot be placed with valid, bounded, accessible geometry the result is an
  honest INFEASIBLE, never a degraded plan (e.g. two-floor L-shape and some decimal/east-access
  sites where the building fills the rear and flanks of the buildable area).
- **Family room — core only, not exposed.** `hasFamilyRoom` exists in the core program and its
  geometry is now bounded (Tasks 160–161), but it is intentionally not in the UI.
- **Guest room — core only, not exposed.** `hasGuestRoom` exists in the core program, but common
  cases are currently infeasible, so it is intentionally not in the UI.
- **North rotation is not functionally consumed.** `site.northRotationDeg` appears only in the
  documentation/PDF text; the layout and DXF engines ignore it, and the UI sends 0.
- **Multi-unit apartments remain incomplete** (first vertical slice: one unit per floor).
- **Municipal regulation packs remain placeholders** — municipal sources have not been obtained;
  no municipal rules or thresholds are shipped.

---

## Unreleased — Phase 18 final QA (post-v1.1.0)

Final QA pass on the four remaining SOFT findings from the P17-F audit. Two were
fixed (validator/producer precision — no HARD, threshold, or architecture changes):

- **Door-swing + furniture-vs-door findings eliminated at the source.** Both
  `OPENING_DOOR_SWING_BLOCKED` and `FURNITURE_BLOCKS_DOOR` were driven by proxy
  heuristics (arc bounding box + 0.4 m proximity; 0.8 m furniture-center
  distance). Both now use the exact 90° swing sector the Opening model already
  carries (new `geometry/swing.ts`, shared by validators and the furniture
  producer, which now runs after openings and skips swing sectors). Genuine
  obstructions still flag; tangential/T-junction contacts stay clear.
  Representative scenarios: both counts 0 (previously 1–4 and 1–3 per plan).
- **Confirmed intentional (unchanged, documented):** `EXCESSIVE_RESIDUAL`
  (P16-C/M4 intentional band-slack voids) and `CIRCULATION_EXCESSIVE` (narrow
  multi-floor circulation ~36%) remain honest reports ranked by P17-B/P17-D.

Verification: core **854/854** (46 files), web 64/64, typecheck 0 errors,
build 321 modules, 560-case battery 160 feasible / 400 NC / 0 hard / 0 err,
DXF 126/126 valid + deterministic.

---

# ArchGenius V1.1.0 — Release Notes

**Version:** 1.1.0 · **State:** Release · **Branch:** `arena/01a0c87d-archgenius` · **Base:** v1.0.2 (`274aa32`)
**Scope:** architectural quality program (Phase 16 A–D, Phase 17 A–F). No changes to the DXF
architecture, regulations, feasibility semantics, or validators. First release since v1.0.2
(DXF R12 hardening, 2026-09-19).

## What's new since v1.0.2

### Phase 16 — parking, access, proportions, drawing quality
- **P16-A — parking placement (was: known limitation "0 stalls"):** the access-side parking band
  (aisle + stall depth) is reserved BEFORE room slicing, guarded by a 72% program-headroom rule;
  perpendicular/parallel stalls are placed with street access. When the geometry cannot host the
  band, the reservation is refused and parking is reported honestly (never crushing rooms into
  slivers). Every feasible battery case requesting parking places exactly the requested count.
- **P16-B — all-side access:** entrance recovery is access-aware; the vestibule is carved on the
  real street edge for N/S/E/W access via the orientation frame (street normalized to
  frame-south, layout mapped back).
- **P16-C — room proportions / quality depth:** proportion-aware sizing with an intentional-void
  convention at band free ends; ranking depth cap.
- **P16-D — DXF presentation QA:** professional pen-ladder lineweights, furniture and sanitary
  annotation layers (A-FURN, A-SANITARY), grid/axis/north/title sheets (A-GRID, A-AXIS, A-NORTH,
  A-TITLE), per-floor namespaces, duplicate suppression. (See docs/DXF_ENGINE.md.)

### Phase 17 — final architectural quality program
- **P17-A — independent audit:** established the systemic defect baselines (corridor AR 8–14,
  oversized communal rooms, floor-envelope residuals, east/west NC gap).
- **P17-B — architectural-form ranking (ranking only):** deterministic penalties for contiguous
  floor voids (> 8 m² grid-BFS), communal oversizing (> 2× target), and corridor proportion;
  a new architecturalQualityPenalty vector component after the furniture tier.
- **P17-C — per-floor envelope compaction:** each floor's declared footprint is compacted to its
  placed geometry (occupied bbox + wall pad, clipped to the buildable rect) with safe fallback
  keeping the original envelope; deep-narrow envelope 177→127 m² (northern void eliminated);
  audited quality penalties −84%/−58% on the audited defect cases.
- **P17-D — corridor quality:** the corridor term scores connected corridor SYSTEMS once with
  continuous quadratic ramps (AR > 8, span > 75% of the floor long side); proportionate
  corridors pay zero, deep-site spines pay little, slivers ramp up smoothly.
- **P17-E — east/west access on depth-dominant sites:** east/west NC count 344→331/332 (+13/+12
  valid plans) by assembling the public band as one side-by-side row along the street for wide
  frames — adopted only when it strictly fixes missing program without new deficits or overlaps.
  Genuinely impossible geometry stays honest NC with deterministic reasons.
- **P17-F — final architectural QA (audit only):** 15 rendered scenarios, wall-level entrance
  verification, DXF/validator cross-check. Result: **0 CRITICAL, 0 HIGH, 5 MEDIUM** known
  limitations (communal oversizing on wide plans, door-swing soft findings, large intentional
  residuals on wide/L plans, multi-floor circulation ratio ~36%, minimum-sized wet cells) plus
  LOW observations — all documented in README §10. No further engineering subphase required.

## Verification at release (this tree, `8045a60` + docs/version bumps)

- Core: **847/847 tests** (45 files) · Web: **64/64** · typecheck 0 errors · web build 320 modules.
- 560-case deterministic battery (single run): **160 feasible / 400 NC / 0 hard-invalid winners /
  0 harness errors**; DXF sample **126/126 valid + byte-deterministic**; NC proven-genuine 77/400.
- Representative regression probes: deep-narrow compaction intact (6.0×21.2 m envelope), corridor
  penalty 1.462 on the audited deep-narrow plan, east/west entrances on the requested facades,
  multi-floor stair rects identical across levels, parking stalls exact.

## Compliance language (unchanged posture)

No "guaranteed compliance", "municipality approved", or legal/construction claims. Automated
validation (HARD/SOFT/ADVISORY findings) is an engineering aid, **not** a substitute for review
by licensed professionals. Iranian code rules carry Tier-1 source evidence; municipal values
remain REQUIRES_SOURCE_VERIFICATION. See README §7.

---

## Historical — V1.0.0 release notes (frozen after Phase 13.2 era)

# ArchGenius V1.0 — Release Notes

**Version:** 1.0.0 · **State:** Release Candidate · **Branch:** `arena/01a0b849-archgenius`
**Development:** frozen after Phase 13.2 (final development phase). No Phase 14.

---

## Verified capabilities

Verified by execution during the independent release QA (613 tests / 27 files, all passing):

- **Deterministic planning engine** — same input + seed → identical plan, findings, ranking and outputs.
- **Site inputs** — rectangle, L-shape, orthogonal polygon (3–8 vertices); setbacks N/S/E/W with
  source/status tracking; access side, street width, jurisdiction/city.
- **Residential programming** — villa, 1–10 floors, bedrooms/master/bathrooms/WC, open/closed
  kitchen, storage.
- **Four candidate strategies** — area-efficiency, functional-circulation, daylight-orientation,
  alternative-zoning — with bounded deterministic search (8 placement attempts / 4 repair
  iterations / 12 candidate positions) and deterministic ranking (hard-count, then soft-count,
  then weighted quality metrics).
- **Constraint graph** — generic MUST_BE_ADJACENT / MUST_BE_SEPARATED / DIRECT_ACCESS_REQUIRED
  constraints with clusters; no hard-coded per-room-type placement.
- **Validation** — HARD / SOFT / ADVISORY findings: geometry, site containment, circulation,
  stairs, furniture, regulations.
- **Infeasible-result semantics (Phase 13.2)** — when no candidate satisfies minimum geometry:
  `bestCandidate = null`, `candidates = []`, explicit `INFEASIBLE` state with code
  `HARD_CONSTRAINT_INFEASIBLE_DIMENSION`, deterministic explanation, per-strategy attempts, and
  diagnostic-only candidates that can never be exported as a normal plan. CASE B (valid geometry
  with HARD site findings) remains usable/exportable per the established contract.
- **Multi-floor with stairs** — 1–10 floors, u-stair generation and validation.
- **Outputs** — DXF (ASCII R12/AC1009, INSUNITS=4, per-floor layers, structurally validated),
  PDF (per-floor pages, drawing numbers `AG-{candidateId}-WB`), XLSX (11 sheets), QA report,
  consistency manifest (checksum).
- **Regulation discipline** — Iranian national code (Mabhas 4 / Mabhas 15) rules from Tier-1 PDF
  sources with SHA-256/page/clause evidence; 9 rules VERIFIED; municipal rules remain
  REQUIRES_SOURCE_VERIFICATION. No compliance or approval claims are made.

## Verified demo

`ArchGenius-Demo-Villa` — 15 × 20 m site (300 m², buildable 170.5 m²), 1-floor villa, 2 bedrooms,
closed kitchen, seed 42 → `cand-area-efficiency-42`, 4/4 strategies valid, 0 HARD / 5 SOFT /
10 ADVISORY, full output set (DXF validated, PDF, XLSX, report, manifest). See README §8.

## Known limitations (documented, non-blocking)

1. **Parking — PARTIAL.** Input and placement machinery exist, but all verified probes placed
   **0 stalls** (the building consumes the buildable envelope and the parking strip does not
   fit). The condition is recorded in candidate explanations but not raised as a validation
   finding.
2. **Elevator — NOT IMPLEMENTED.** LIFT rules exist in the regulation pack; no elevator geometry
   is generated.
   *(Superseded: elevator shaft geometry is now generated for 2+ floor buildings when
   `hasElevator` is set, with HARD `ELEV_*` validation; shaft dimensions are design assumptions
   and MBH15-LIFT-002 remains NOT_IMPLEMENTED.)*
3. **Apartment — PARTIAL.** First vertical slice only: one full unit per floor; no shared cores
   or multi-unit layouts.
4. **M1 — generator defect, quarantined.** Specific tight L-shape infeasible cases (e.g. 10×10,
   notch 4×4, small open-kitchen program) can produce negative room dimensions (−0.07 m) inside
   **diagnostic-only** candidates. Pre-existing; never exposed as a usable candidate; cannot be
   exported as a normal plan; surfaces in the UI only as the explicit INFEASIBLE state.
5. **M2 — documentation wording.** Some Phase 13.2 report wording overstates the universality of
   positive diagnostic geometry; the guarantee is fixture-scoped, not generator-wide.
6. **Web UI surface.** Only DXF has a dedicated download button; PDF / XLSX / report / manifest
   are core-API only. Editing UI exposes move + select (resize/lock/setLShape are core-API);
   quality scores are not displayed; no project save/load dashboard; north rotation fixed at 0.
   *(Superseded: the web UI now has a project management panel (`ProjectManager`) with
   localStorage-backed list/save/load/delete and JSON import/export.)*
7. **No CI pipeline.** Release gates (tests, typechecks, build) were executed locally at release
   time and are reproducible via `npm test`, `npm run typecheck`, `npm run build`.
   *(Superseded post-release: a CI workflow is now committed but has not yet run on GitHub — see
   Unreleased → Task 148.)*
8. **No LICENSE yet.** The repository currently has no license file; no licensing is claimed.

## Engineering gates at release

| Gate | Result |
|---|---|
| Core test suite | 613 passed / 0 failed / 0 skipped (27 files) |
| Core `tsc --noEmit` | PASS (strict) |
| Web `tsc --noEmit` | PASS |
| Root `npm run typecheck` | PASS (runs both package typechecks) |
| `vite build` | PASS — 311 modules |
| Independent QA verdict | VERIFIED WITH MEDIUM FINDINGS |

## Documentation

- [README.md](README.md) — V1.0 product README (Persian)
- [ARCHITECTURE.md](ARCHITECTURE.md) · [DECISIONS.md](DECISIONS.md) · [ROADMAP.md](ROADMAP.md)
- [docs/REGULATIONS.md](docs/REGULATIONS.md) — authoritative regulation status
- [docs/history/](docs/history/) — phase-by-phase development & audit reports (engineering
  history, not product documentation)
