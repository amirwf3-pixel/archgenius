# Sources — Primary Regulation Documents — Phase 5.2 VERIFIED

This directory holds authoritative (Tier 1) Iranian building-regulation
documents in their original PDF form. See
[`../docs/REGULATION_AUDIT.md`](../docs/REGULATION_AUDIT.md) for the audit
trail and [`../packages/core/src/regulations/packs/source-registry.ts`](../packages/core/src/regulations/packs/source-registry.ts)
for the machine-readable source registry with SHA-256 digests.

## Status at last audit (2026-09-18 — Phase 5.2 VERIFIED)

| Source | Tier | Filename | Bytes | SHA-256 | Pages | Status |
|--------|------|----------|-------|---------|-------|--------|
| **مبحث چهارم — الزامات عمومی ساختمان** (1396 / 3rd rev., 128p) | 1 | `mabhas4-96.pdf` (repo root) + `sources/mabhas4-96.pdf` | 3575435 | `ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6` | 128 (PyPDF2) | **OBTAINED-AUTHENTICATED** — obtained via `git checkout origin/main -- mabhas4-96.pdf` from commit bc800bd, copied to sources/, registered via `register-source.js` |
| **مبحث چهارم — الزامات عمومی ساختمان** (1399 / 4th rev., latest) | 1 | `mabhas-4-1399.pdf` (future) | — | — | — | **NOT OBTAINED** — latest revision, not yet placed |
| **مبحث پانزدهم — آسانسورها و پلکان برقی** (1392) | 1 | `mabhas-15.pdf` (repo root) + `sources/mabhas-15.pdf` | 1026762 | `e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477` | 84 (PyPDF2) | **OBTAINED-AUTHENTICATED** — same as above |
| **طرح تفصیلی تهران** / دستور نقشه | 1 | (project-specific PDF supplied by user) | — | — | — | **NOT OBTAINED** — always supplied per-project |

### Verification evidence (Phase 5.2)

- Extraction: `pymupdf` (fitz) `get_pixmap(dpi=250)` → PNG, visual inspection (PyPDF2 text garbled Persian RTL).
- Images: `m4_page_62.png` (book 48 PDF 62) stair general §4-5-1-7-1/3/4/5/6; `m4_page_73.png` (book 59 PDF 73) kitchen general §4-5-5-2; `m4_page_75.png` (book 61 PDF 75) sanitary general §4-5-6-2-1; `m4_page_99.png` (book 85 PDF 99) residential stair §7-1-1-3/4/6 and room §7-1-1-8; `m4_page_100.png` (book 86 PDF 100) kitchen §7-1-1-10/11/12/13 and sanitary §7-1-1-18 (1.00×1.30 corrected); `m4_page_101.png` (book 87 PDF 101) sanitary exceptions §7-1-1-18/19; `m4_hab_66.png` (book 52 PDF 66) habitable §4-5-2-2-1/2/3; `m15_page_19.png` (book 9 PDF 19) elevator §15-2-1-2/3/4; etc.
- **9 rules promoted to VERIFIED** with page, snippet, verifiedAt: ROOM-001 (p99), ROOM-002 (p66), ROOM-004 (p73/p100), ROOM-007 (p100/101/75 corrected 1.20→1.30), STAIR-001 (p62/p99), STAIR-002 (p62), STAIR-003 (p62), LIFT-001 (p19), DYL-001 (p100).
- Remaining municipal MUN-PARK-001 / MUN-SET-001 stay REQUIRES_SOURCE_VERIFICATION (local policy).
- NOT_IMPLEMENTED slots: ROOM-003, STAIR-004, LIFT-002 now have Tier-1 backing for thresholds (2.40/2.60, 2.05, cab sizes) but still need 3-D model.

No rule is marked VERIFIED without Tier-1, obtained-authenticated, 64-char SHA-256, page >0, known digest. Integrity tests enforce this.

## Adding a new primary document

Same workflow as before:

1. Obtain PDF from issuing authority.
2. Place in this directory.
3. `node sources/register-source.js <sourceId> <pdf-path>` → computes SHA-256, sets obtained-authenticated, documentPath.
4. Locate exact clause/page for each rule, compare threshold/operator/unit/conditions/exceptions, fix if needed, add tests.
5. `npm test`, `npm run build`, DXF validation.
6. Update docs.

## File integrity

Digests recorded in `source-registry.ts`:

- `mabhas4-96.pdf`: sha256 `ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6`, 3575435 bytes, 128 pages
- `mabhas-15.pdf`: sha256 `e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477`, 1026762 bytes, 84 pages

Re-run `register-source.js` if you replace a PDF.

## Do NOT commit unlicensed or pirated scans

Only ship PDFs you are authorised to redistribute. For Phase 5.2, PDFs are present in repo root and sources/ because they were uploaded to origin/main commit bc800bd as primary sources for verification.
