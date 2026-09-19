# Regulation Engine — Phase 5.2 VERIFIED

## Status

> **Last updated:** 2026-09-18 (Phase 5.2 — Primary Source Integration & Verification, **9 VERIFIED rules**).
>
> Tier-1 PDFs are now present in the workspace:
> - `mabhas4-96.pdf` (repo root) and `sources/mabhas4-96.pdf` — Mabhas 4, 3rd ed 1396, 128 pages, 3575435 bytes, SHA256 `ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6`
> - `mabhas-15.pdf` (repo root) and `sources/mabhas-15.pdf` — Mabhas 15, 1392, 84 pages, 1026762 bytes, SHA256 `e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477`
>
> Both PDFs were obtained via `git checkout origin/main -- mabhas4-96.pdf mabhas-15.pdf` from commit `bc800bd` (Add files via upload) on origin/main. Hashes computed via `sha256sum` and `PyPDF2` page counts verified. Copies placed in `sources/` and registered via `sources/register-source.js` → entries `t1-mabhas4-96-pdf`, `t1-mabhas4-1396`, `t1-mabhas15-92-pdf`, `t1-mabhas15-1392` now `obtained-authenticated` with digests and `documentPath`.
>
> Rules were then verified clause-by-clause against PDF images rendered with `pymupdf` (250 dpi PNGs). Evidence:
> - **MBH4-ROOM-001** §7-1-1-8 Book p85 / PDF p99: “12/00 m² با پهنای 2/70 m” for ≥75 m² units, “9 m² و 2/50 m” for <75.
> - **MBH4-ROOM-002** §4-5-2-2-1/2 Book p52 / PDF p66: “6/50 m²” and “2/15 m”.
> - **MBH4-ROOM-004** §4-5-5-2 Book p59 / PDF p73: “5/50 m², 1/80 m, 2/75 m² free work, 0/90 m clearance” + §7-1-1-10/11/12 Book p86 / PDF p100: “5/50 & 2/75, 7/50, 1/80 & 2/15, 1/10 & 3/00”.
> - **MBH4-ROOM-007** §7-1-1-18 Book p86 / PDF p100: “1/00 m عرض و 1/30 m طول” (corrected from 1.20). Plus §7-1-1-18 تبصره & §7-1-1-19 Book p87 / PDF p101: “1/50 m if vestibule, 0/15 m reduction combined, 2/20 m height over 80% and 2/05 m shortest”.
> - **MBH4-STAIR-001** §4-5-1-7-3 Book p48 / PDF p62: “1/10 m & 2/40 m public” + §7-1-1-3/4/6 Book p85 / PDF p99: “0/90 straight group 1-3, 1/10 with turn, 1/10 straight group 4-7, 2/40 stairwell, 0/90 internal”.
> - **MBH4-STAIR-002** §4-5-1-7-1 Book p48 / PDF p62: “0/28 m tread, 2h+b 0/63–0/64 m”.
> - **MBH4-STAIR-003** §4-5-1-7-5 Book p48 / PDF p62: “حداکثر 12 پله”, §4-5-1-7-4 landing width = stair width, §4-5-1-7-6 headroom 2/05 m.
> - **MBH15-LIFT-001** §15-2-1-2 Book p9 / PDF p19: “>7 m from main entrance entrance, معمولاً بیش از سه طبقه”, §15-2-1-3 “8 floors / 28 m → 2 lifts”, §15-2-1-4 “>21 m stretcher lift”.
> - **MBH4-DYL-001** §7-1-1-14 Book p86 / PDF p100: independent daylight mandatory for closed kitchens and units ≥75 m² or kitchen >7 m from adjacent window; §4-5-2-8-3 Book p55 / PDF p? “عمق نورگیری حداکثر 7 متر”.
>
> **9 rules promoted to VERIFIED** with Tier-1 source, page, snippet, verifiedAt. Remaining municipal/parking/setback stay REQUIRES_SOURCE_VERIFICATION (Tier-3, advisory). NOT_IMPLEMENTED slots remain advisory but thresholds where verifiable are now backed by Tier-1 (e.g. headroom 2.05 m, cab sizes).
>
> Correction applied: MBH4-ROOM-007 min_length 1.20 → 1.30 per PDF p100.
>
> Integrity tests enforce: VERIFIED requires Tier-1, obtained-authenticated, digest 64 hex, page >0. See `source-registry.test.ts` and `phase5-verification.test.ts`.

## Architecture

Same two-pass architecture as Phase 5, but findings now carry VERIFIED badge where applicable.

### Packs

| ID | Jurisdiction | Scope | Edition | Status |
|----|--------------|-------|---------|--------|
| `ir-default-v0.1` | fallback defaults | local/default | draft-v0.1 | Default setbacks/parking; REQUIRES_SOURCE_VERIFICATION |
| `ir-national-mbr` | Iran (country=IR) | national | 1396 (Mabhas 4 128p SHA256 ff5b35…) / 1392 (Mabhas 15 84p SHA256 e27e1d74…) — VERIFIED draft Phase 5.2 | 9 VERIFIED, 2 REQUIRES (municipal), 7 NOT_IMPLEMENTED |
| `ir-tehran-stub` | Tehran (city=tehran) | local | not-implemented | Placeholder only |

### Source model

Tier-1 PDFs now obtained-authenticated. Tier-3 retained only for audit trail.

| Tier | Meaning | Present? |
|------|---------|----------|
| 1 | Official BHRC PDF in `sources/` with SHA-256 | ✅ Yes — mabhas4-96.pdf (128p) and mabhas-15.pdf (84p) |
| 2 | Official reproduction | ❌ None |
| 3 | Secondary practitioner | ✅ Retained as cross-reference |

### Rule statuses

| Status | Count (Phase 5.2) | Meaning |
|--------|-------------------|---------|
| VERIFIED | 9 | Clause verified against Tier-1 PDF with page, snippet, digest |
| REQUIRES_SOURCE_VERIFICATION | 2 (MUN-*) | Active but municipal — needs local detailed plan |
| NOT_IMPLEMENTED | 7 | Advisory slots; thresholds where verifiable are backed by Tier-1 |

## Implemented rules (IR national MBR pack) — Phase 5.2

| Code | Title | Clause | Page (PDF) | Severity | Status | Thresholds verified |
|------|-------|--------|------------|----------|--------|---------------------|
| MBH4-ROOM-001 | At least one main habitable room per unit | §7-1-1-8 | p99 (book 85) | HARD | VERIFIED | area 12 / width 2.7 for ≥75, area 9 / width 2.5 for <75 |
| MBH4-ROOM-002 | Universal habitable-room minimum | §4-5-2-2-1/2 | p66 (book 52) | HARD | VERIFIED | 6.5 m², 2.15 m |
| MBH4-ROOM-004 | Kitchen min area & width | §4-5-5-2 / §7-1-1-10/11/12/13 | p73/p100 (book 59/86) | HARD | VERIFIED | 5.5 m², 2.75 free, 7.5 cook+dine, 1.8 width, 2.15 cook+dine, 1.1 clearance, 3.0 length |
| MBH4-ROOM-007 | Independent sanitary 1.0×1.3 m (corrected) | §7-1-1-18/19 / §4-5-6-2-1 | p100-101/p75 (book 86-87/61) | HARD | VERIFIED | 1.0 width, 1.3 length (was 1.2), 1.5 vestibule, 0.15 reduction, 2.2/2.05 height, 0.9 general small side |
| MBH4-STAIR-001 | Stair clear width by group | §4-5-1-7-3 / §7-1-1-3/4/6 | p62/p99 (book 48/85) | HARD | VERIFIED | 0.9 straight G1-3, 1.1 turn G1-3, 1.1 straight G4-7, 2.4 public landing, 0.9 internal |
| MBH4-STAIR-002 | Tread/riser & 2h+b | §4-5-1-7-1 | p62 (book 48) | HARD/SOFT | VERIFIED | tread ≥0.28, riser ≤0.18, 2r+t 0.63-0.64 |
| MBH4-STAIR-003 | Max 12 risers between landings | §4-5-1-7-4/5/6 | p62 (book 48) | HARD | VERIFIED | max 12, landing width = stair width, headroom 2.05 |
| MBH15-LIFT-001 | Elevator mandatory >7 m vertical | §15-2-1-2/3/4 | p19 (book 9) | HARD/SOFT | VERIFIED | >7 m mandatory, 8 floors/28 m → 2 lifts, >21 m stretcher |
| MBH4-DYL-001 | Daylight — exterior wall required | §7-1-1-14 / ch.6 | p100 (book 86) | HARD | VERIFIED | kitchen independent daylight if closed or ≥75 m² or >7 m from adjacent window; max depth 7 m |
| MUN-PARK-001 | Parking ratio (municipal) | detailed plan | — | SOFT | REQUIRES | 1 bay/unit advisory |
| MUN-SET-001 | Setback/coverage/FAR (municipal) | detailed plan | — | ADVISORY | REQUIRES | advisory |

### NOT_IMPLEMENTED (advisory, thresholds VERIFIED where possible)

- MBH4-ROOM-003: ceiling 2.40/2.60 m (PDF p66/p99 VERIFIED, needs 3-D)
- MBH4-STAIR-004: landing width, headroom 2.05 m, handrail, roof stair (PDF p62 VERIFIED)
- MBH15-LIFT-002: cab sizes wheelchair 1.4×1.1/0.8, stretcher 2.1×1.1/0.9, bed 2.4×1.4/1.3 (PDF p20-21 VERIFIED)
- MBH4-DYL-002: glazing ratios 1/8-1/5 tiered (needs window area model)
- MBH4-DYL-003: light-well dimensions
- MBH4-VENT-001: kitchen vent ≥1/16 floor
- THN-000: Tehran detailed plan not loaded

## Testing — Phase 5.2

- 172 tests pass (up from 133 baseline + 19 Phase 5)
- Per-rule compliant/boundary/non-compliant/conditional tests added
- Integrity tests: VERIFIED requires Tier-1, obtained-authenticated, 64-char SHA-256, page >0, known digests
- Regression matrix 10 scenarios still 0 GEO outside, 12×18 still 0 HARD

```bash
npm test
npm run build
```

Build: core tsc OK, web vite 271 kB (gzip 86.8 kB)

DXF: R12 ASCII, INSUNITS=4, layers A-STAIR/A-STAIR-TREAD/A-STAIR-DIR present, structural validation OK.

## Source policy

No fabricated legal claims. VERIFIED rules carry clause, page, snippet, digest. Municipal rules remain REQUIRES_SOURCE_VERIFICATION and must be checked against دستور نقشه. All findings show status badge.

## Further reading

- [REGULATION_AUDIT.md](./REGULATION_AUDIT.md) — full audit with images, corrections, Phase 5.2 report
- [history/PHASE_5.2_REPORT.md](./history/PHASE_5.2_REPORT.md) — Phase 5.2 engineering report
- `sources/README.md` — how to register PDFs
- `packages/core/src/regulations/packs/source-registry.ts` — registry with hashes
