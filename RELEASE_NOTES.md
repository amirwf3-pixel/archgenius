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
