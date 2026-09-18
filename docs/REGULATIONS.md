# Regulation Engine

## Status

> **Last updated:** 2026-09-18 (Phase 5 — Primary Source Integration & Verification,
> **0 VERIFIED rules**).
>
> Phase 5 attached PDFs `mabhas4-96.pdf` (Mabhas 4, 3rd ed 1396, 128 pages) and
> `mabhas-15.pdf` (Mabhas 15, 1392) were announced in UI as saved to
> `/home/user/uploads/`, but filesystem inspection in sandbox shows:
> - `ls /home/user/uploads/` → No such file or directory
> - `find /home -name *.pdf` → none
> - `sources/` contains only README.md + register-source.js
> Therefore SHA-256 and exact clause/page verification could NOT be performed
> in this session. Per task, limitation is honestly reported and no rule is
> promoted to VERIFIED. Source registry entries `t1-mabhas4-96-pdf` and
> `t1-mabhas15-92-pdf` added with `verificationState: 'not-obtained'`.
>
> Previous Phase 2c also had 0 VERIFIED due to network restrictions blocking
> *.ir hosts. Every implemented rule has been audited against verbatim-clause
> reproductions (see [REGULATION_AUDIT.md](./REGULATION_AUDIT.md)). All active
> rules therefore carry `status: REQUIRES_SOURCE_VERIFICATION`, and every
> surfaced finding shows an exact clause reference. Findings must be read as
> **Automated Regulation Checks / Potential Non-Compliance / Professional
> Review Required**, NEVER as a guarantee of permit approval.
>
> A machine-readable source registry lives at
> `packages/core/src/regulations/packs/source-registry.ts`, and a helper
> CLI at `sources/register-source.js` automates registering a PDF when the
> user provides one. Integrity tests
> (`source-registry.test.ts` + `phase5-verification.test.ts`) prevent any
> rule from being silently marked `VERIFIED` without a Tier-1, hash-verified
> document with an exact page number. See `sources/README.md` for the
> promotion procedure.

## Architecture

The regulation engine lives in `packages/core/src/regulations/`. Rules run
in two passes:

1. **Pre-generation (buildable-area)** — `runPackRules` runs before floor
   planning. Used for footprint-level checks (e.g. elevator trigger based
   on vertical travel from main entrance, parking shortfall advisory).
2. **Post-generation (per-candidate)** — `runPackRulesOnCandidate` runs
   after walls, doors and windows are placed for each LayoutCandidate.
   Used for room-dimension, stair-geometry, and daylight-exterior-wall
   checks.

All findings are then merged into `validateLayout(candidate)` (which
combines them with geometric/circulation validators and buckets them into
HARD / SOFT / ADVISORY).

### Packs

| ID | Jurisdiction | Scope | Edition | Status |
|----|--------------|-------|---------|--------|
| `ir-default-v0.1` | fallback defaults | local/default | draft-v0.1 | Default setbacks/parking; all values REQUIRES_SOURCE_VERIFICATION |
| `ir-national-mbr` | Iran (country=IR) | national | 1396 (Mabhas 4) / 1392 (Mabhas 15) — audited Tier-3 draft | See audit table below |
| `ir-tehran-stub` | Tehran (city=tehran) | local | not-implemented | Placeholder only — emits an advisory that no Tehran detailed-plan pack is loaded |

### Pack composition

Selected by `composePacks(input)` based on `project.country`,
`project.regulationJurisdiction`, and `site.city`:

- `country` ≠ `"IR"`/`"iran"` → only the default-assumption pack.
- `country == "IR"` → default + IR national MBR + Tehran stub (Tehran stub
  is added regardless of city so that users always see the "supply a
  municipal pack" advisory; a future real Tehran pack will replace it when
  city=tehran).

### Source model

Every pack carries a `sourceRegistry: RegulationSource[]` keyed by ID.
Each `RegulationRule` references its backing sources via
`sources: SourceRef[]` (with an exact clause/table reference). The
`RuleResult`/`Finding` objects carry these references through to the
validator/UI so that every surfaced finding is auditable.

Source tiers:

| Tier | Meaning |
|------|---------|
| 1 | Official BHRC / Ministry PDF held in `sources/` (none at present) |
| 2 | Officially-published reproduction of the authoritative edition |
| 3 | Reputable secondary sources (practitioner blogs, exam-prep, firms) |

**Tier 3 alone is NEVER sufficient to mark a rule VERIFIED.** Every active
rule therefore carries `status: REQUIRES_SOURCE_VERIFICATION`.

### Rule statuses

| Status | Meaning |
|--------|---------|
| `VERIFIED` | Clause verified against a Tier-1 source in `sources/` (none yet) |
| `REQUIRES_SOURCE_VERIFICATION` | Active check, but values are transcribed from secondary sources; professional review required |
| `NOT_IMPLEMENTED` | Slot reserved; evaluator emits a single advisory note |
| `DEPRECATED` | Superseded / incorrect; no finding emitted |

## Implemented rules (IR national MBR pack)

Severity legend: **HARD** = blocks a "valid" layout (potential code
violation); **SOFT** = flagged for review; **ADVISORY** = disclaimer /
info / NOT_IMPLEMENTED note.

| Code | Title | Clause | Severity | Status |
|------|-------|--------|----------|--------|
| MBH4-ROOM-001 | At least one main habitable room per unit meets area/width for unit tier (≥75 m² → 12 m² × 2.7 m, <75 m² → 9 m² × 2.5 m) | §7-1-1-8 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MBH4-ROOM-002 | Universal habitable-room minimum (6.5 m² × 2.15 m) applies to every habitable space | §4-5-2-2-1/2 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MBH4-ROOM-004 | Kitchen ≥5.5 m² × 1.80 m (cook-only); cook+dine 7.5 m² × 2.15 m | §7-1-1-10/11/12 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MBH4-ROOM-007 | Independent sanitary space ≥1.00 × 1.20 m (non-accessible) | §7-1-1-18 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MBH4-STAIR-001 | Stair clear width ≥0.90 m (villa ≤3 st) / ≥1.10 m (other) | §4-5-1-7-3 / §7-1-1-3/4 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MBH4-STAIR-002 | Tread ≥0.28 m, riser ≤0.18 m, 2r+t ∈ [0.63, 0.64] m | §4-5-1-7-1 | HARD (geometry) / SOFT (2r+t) | REQUIRES_SOURCE_VERIFICATION |
| MBH4-STAIR-003 | Max 12 risers between two landings | §4-5-1-7-5 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MBH15-LIFT-001 | Elevator mandatory when vertical travel from main entrance >7 m; soft advisory at exactly 3 storeys; ramp exception noted | §15-2-1-2 | HARD/SOFT | REQUIRES_SOURCE_VERIFICATION |
| MBH4-DYL-001 | Habitable rooms + independent kitchens must touch an exterior wall (daylight/vent) | ch.6 / §7-1-1-14 | HARD | REQUIRES_SOURCE_VERIFICATION |
| MUN-PARK-001 | "1 parking bay per unit" is a common municipal praxis, NOT a national rule | municipal detailed plan | SOFT | REQUIRES_SOURCE_VERIFICATION |
| MUN-SET-001 | Setback/coverage/FAR come from the municipal detailed plan (طرح تفصیلی) — defaults are generation aides only | municipal detailed plan | ADVISORY | REQUIRES_SOURCE_VERIFICATION |

### NOT_IMPLEMENTED rule slots (advisory only)

MBH4-ROOM-003 (ceiling heights 2.40/2.60 m) · MBH4-STAIR-004 (landing/
headroom/handrail/roof-stair) · MBH15-LIFT-002 (wheelchair/stretcher/bed
cabin dimensions) · MBH4-DYL-002 (glazing ratios — tiered, NOT a fixed 1/7
constant) · MBH4-DYL-003 (light-well/patio dimensions) · MBH4-VENT-001
(kitchen operable vent ≥1/16 of floor) · THN-000 (Tehran detailed plan
pack not loaded).

## National vs Local separation

- **National (Mabhas)** rules — rooms, stairs, elevators, daylight at the
  exterior-wall level — live in `ir-national-mbr`.
- **Local/municipal** rules — setbacks, ground coverage, FAR, height
  districts, parking ratios, encroachments (اشکوب), balcony bonuses —
  vary by municipality and zoning district and are NOT encoded in the
  national pack. They fall back to sane-default advisories until the user
  supplies a signed municipal pack with their building permit
  instruction (دستور نقشه).

## Testing

- `packages/core/src/regulations/packs/ir-national-mbr.test.ts` contains
  per-rule tests (compliant, non-compliant, boundary, status/source
  stamping, NOT_IMPLEMENTED placeholders, jurisdiction selection).
- Run all tests:
  ```bash
  npx vitest run
  ```
- Manual verification harness (six typical projects):
  ```bash
  cd packages/core && node --experimental-vm-modules -e "import('./dist/verify/run-verification.js');"
  ```

## Build

```bash
npm run build
```

Build passes cleanly (core tsc + web tsc + vite production bundle).

## Source policy reminder

ArchGenius never claims "100% compliant", "legally approved", "municipality
approved", or "guaranteed permit". Every regulation finding carries a
`status` badge (`REQUIRES_SOURCE_VERIFICATION` or `NOT_IMPLEMENTED`) and an
exact clause reference so that a licensed professional can cross-check it
against the official publication. Offline-first: all packs are bundled
with `@archgenius/core`; no runtime network calls are made.

## Further reading

- **[REGULATION_AUDIT.md](./REGULATION_AUDIT.md)** — full audit table,
  sources, corrections, discrepancies, missing Tier-1 documents, and
  roadmap for promoting rules to `VERIFIED`.
