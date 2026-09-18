# Phase 5 Report — Primary Regulation Source Integration & Verification

**Date:** 2026-09-18
**Baseline:** `0ec7034 Phase 4.1: Stair engine QA and stabilization`
**Current:** Phase 5 completion

## 1. Source Files

### PDF 1: mabhas4-96.pdf
- **Expected repo path:** `sources/mabhas4-96.pdf`
- **Title:** مبحث چهارم مقررات ملی ساختمان — الزامات عمومی ساختمان
- **Edition/year:** ویرایش سوم ۱۳۹۶ (3rd edition, 1396)
- **Pages (per task description):** 128
- **SHA-256:** NOT COMPUTABLE — file not present in agent filesystem
- **Tier:** 1 (primary authoritative)
- **Verification state:** not-obtained
- **Accessibility:** Attached in UI per arena-system-message (`/home/user/uploads/mabhas4-96.pdf`) but filesystem inspection:
  - `ls /home/user/uploads/` → No such file or directory
  - `find /home -type f -name "*.pdf"` → none
  - `ls sources/` → only README.md + register-source.js
  - Per task instruction: DO NOT pretend registered, report limitation clearly.

### PDF 2: mabhas-15.pdf
- **Expected repo path:** `sources/mabhas-15.pdf`
- **Title:** مبحث پانزدهم مقررات ملی ساختمان — آسانسورها و پلکان برقی
- **Edition/year:** ویرایش ۱۳۹۲ (1392)
- **Pages:** unknown (task does not specify)
- **SHA-256:** NOT COMPUTABLE — file not present
- **Tier:** 1
- **Verification state:** not-obtained
- **Accessibility:** Same limitation as above.

### Source Registry Updates
- Added `t1-mabhas4-96-pdf` (tier 1, edition 1396 3rd ed 128p, not-obtained, note about sandbox)
- Added `t1-mabhas15-92-pdf` (tier 1, edition 1392, not-obtained)
- Updated existing `t1-mabhas4-1396` note to mention expected filename `sources/mabhas4-96.pdf`
- Updated existing `t1-mabhas15-1392` note to mention expected filename `sources/mabhas-15.pdf`
- Integrity tests ensure no VERIFIED without Tier-1 + digest + page number.

## 2. Regulation Audit

### Rules audited: 18 (11 active + 7 NOT_IMPLEMENTED)

| Rule | Source | Edition | Clause | Status (Phase 5) |
|------|--------|---------|--------|------------------|
| MBH4-ROOM-001 | S-RES (Tier3) | 1396 | §7-1-1-8 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-ROOM-002 | S-HAB (Tier3) | 1396 | §4-5-2-2-1/2 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-ROOM-004 | S-RES | 1396 | §7-1-1-10/11/12 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-ROOM-007 | S-RES | 1396 | §7-1-1-18 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-STAIR-001 | S-STAIR+S-RES | 1396 | §4-5-1-7-3 / §7-1-1-3/4 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-STAIR-002 | S-STAIR | 1396 | §4-5-1-7-1 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-STAIR-003 | S-STAIR | 1396 | §4-5-1-7-5 | REQUIRES_SOURCE_VERIFICATION |
| MBH15-LIFT-001 | S-LIFT | 1392 | §15-2-1-2 | REQUIRES_SOURCE_VERIFICATION |
| MBH4-DYL-001 | S-DAY+S-RES | 1396 | ch.6 / §7-1-1-14 | REQUIRES_SOURCE_VERIFICATION |
| MUN-PARK-001 | local-parking | n/a | municipal | REQUIRES_SOURCE_VERIFICATION (soft) |
| MUN-SET-001 | local-setback | n/a | municipal | REQUIRES_SOURCE_VERIFICATION (advisory) |
| MBH4-ROOM-003 | - | 1396 | §4-5-2-2-3 / §7-1-1-9 | NOT_IMPLEMENTED |
| MBH4-STAIR-004 | - | 1396 | §4-5-1-7-4/6/7 | NOT_IMPLEMENTED |
| MBH15-LIFT-002 | - | 1392 | §15-2-1-9/10/11 | NOT_IMPLEMENTED |
| MBH4-DYL-002 | - | 1396 | ch.6 table 1-6-4 | NOT_IMPLEMENTED |
| MBH4-DYL-003 | - | 1396 | ch.6 light-well | NOT_IMPLEMENTED |
| MBH4-VENT-001 | - | 1396 | §7-1-1-15 | NOT_IMPLEMENTED |
| THN-000 | - | - | Tehran detailed plan | NOT_IMPLEMENTED |

### Summary

- **Rules audited:** 18
- **VERIFIED:** 0 (no Tier-1 PDF accessible to locate exact clause/page)
- **REQUIRES_SOURCE_VERIFICATION:** 11
- **NOT_IMPLEMENTED:** 7
- **DEPRECATED:** 0

Per task: VERIFIED only if actual primary PDF accessed, clause located, page identified, thresholds match, conditions checked, SHA-256 registered. None met due to filesystem limitation.

## 3. Corrections

**No threshold corrections made in Phase 5** because primary PDFs were not accessible to demonstrate incorrectness. Per task §8: DO NOT weaken HARD to SOFT to make plans pass.

Existing thresholds remain as audited in Phase 2c, all marked REQUIRES_SOURCE_VERIFICATION. Edition control verified:
- Mabhas 4 rules cite 1396 (matches mabhas4-96.pdf)
- Mabhas 15 rules cite 1392 (matches mabhas-15.pdf)
- No mixing of 1399 vs 1396 values.

If PDFs become accessible, expected verification steps for each rule are documented in REGULATION_AUDIT.md §11.7.

## 4. Tests

### New tests added

- `source-registry.test.ts`: +1 test for Phase 5 PDFs honest reporting
- `phase5-verification.test.ts`: 19 tests
  - Source accessibility honest reporting (2)
  - VERIFIED integrity (1)
  - Numerical boundary: MBH4-ROOM-002 (2), MBH4-ROOM-004 (1), MBH4-ROOM-007 (1), MBH4-STAIR-002 (3), MBH4-STAIR-003 (1), MBH15-LIFT-001 (1)
  - Traceability (1)
  - Regression matrix 10 scenarios (10)

### Test result

```
npx vitest run
Test Files: 12 passed
Tests: 152 passed (133 Phase 4.1 + 19 Phase 5)
```

- Existing Phase 4.1 baseline 133/133 still passing
- New Phase 5 19/19 passing
- No regressions

### Regression result (10 scenarios)

All 10 scenarios have zero GEO_ROOM_OUTSIDE_FOOTPRINT after Phase 4.1 fix:
- 8×12 1F s1: HARD 0
- 8×25 1F s2: HARD 0
- 10×30 1F s3: HARD 0
- 12×18 1F s1: HARD 0 (fixed)
- 14×20 2F s7: HARD 0 (U-stair 9+9)
- 15×20 1F s42: HARD 0
- 15×22 3F s42: HARD 0 (U-stair aligned)
- 18×25 2F s42: HARD 0
- 20×20 2F s1: HARD 0
- 20×25 2F s2: HARD 0

## 5. Build

- **Core:** `npx tsc -p packages/core/tsconfig.json --noEmit` → EXIT 0
- **Core build:** `npm run build -w @archgenius/core` → tsc OK
- **Web:** `npm run build -w @archgenius/web` → vite
  - dist/assets/index-*.js 260.11 kB gzip 83.44 kB (same as Phase 4.1)
  - No increase from Phase 5 (no threshold changes)

## 6. DXF

- **Structural validation:** `exportDXF` validation.ok = true
- **Layers:** A-STAIR, A-STAIR-TREAD, A-STAIR-DIR present (Phase 4.1)
- **INSUNITS:** 4 (millimeters) preserved
- **Geometry:** editable lines, no NaN, ends with EOF, tread counts ≥14, dir arrows ≥2, LDNG/UP labels present
- **Result:** PASS

## 7. Documentation

Files changed:

- `packages/core/src/regulations/packs/source-registry.ts` — added t1-mabhas4-96-pdf and t1-mabhas15-92-pdf, updated notes
- `packages/core/src/regulations/packs/source-registry.test.ts` — +1 test for Phase 5 honest reporting
- `packages/core/src/regulations/packs/phase5-verification.test.ts` — new 19 tests
- `sources/README.md` — Phase 5 status table with honest limitation
- `docs/REGULATION_AUDIT.md` — added Phase 5 section 11 with source files, audit table, gaps
- `docs/REGULATIONS.md` — updated status to Phase 5, 0 VERIFIED, honest limitation
- `docs/PHASE_5_REPORT.md` — this report (new)

## 8. Remaining Gaps

- **Primary PDFs not accessible in sandbox:** Cannot promote any rule to VERIFIED without human reviewer placing authenticated PDFs into `sources/` and running `register-source.js`. This is the sole blocker for VERIFIED status.
- **No fabricated metadata:** Per task, no fake page numbers, clauses, hashes, editions, URLs created.
- **Numerical verification:** Boundary tests exist for all active rules, but exact clause/page verification pending Tier-1 PDF.
- **Conditions/exceptions:** Some rules have conditional logic (e.g., unit area ≥75 m² vs <75 m² for MBH4-ROOM-001, kitchen open vs closed for DYL-001, 3-storey borderline for LIFT-001) but full exception handling (ramp exception for elevator, accessible WC 1.50×1.70) remains NOT_IMPLEMENTED pending 3D/elevator-shaft model.
- **Edition mixing:** 1399 edition entry exists but not yet used; when 1399 PDF obtained, need to check if thresholds changed vs 1396.

## 9. Legal / Professional Position

- No claim of 100% compliance, guaranteed approval, municipality approval, or replacement for architect/engineer.
- All findings use language: Automated Regulation Check, Potential Non-Compliance, Professional Review Required, Source Verification Required, Not Implemented.
- Findings carry `status` badge for UI.

## 10. Commit

Phase 5 changes committed with message "Phase 5: Primary regulation source integration & verification".
