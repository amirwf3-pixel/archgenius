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
7. **No CI pipeline.** Release gates (tests, typechecks, build) were executed locally at release
   time and are reproducible via `npm test`, `npm run typecheck`, `npm run build`.
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
