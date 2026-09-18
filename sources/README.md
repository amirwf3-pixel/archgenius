# Sources — Primary Regulation Documents

This directory holds authoritative (Tier 1) Iranian building-regulation
documents in their original PDF form. See
[`../docs/REGULATION_AUDIT.md`](../docs/REGULATION_AUDIT.md) for the audit
trail and [`../packages/core/src/regulations/packs/source-registry.ts`](../packages/core/src/regulations/packs/source-registry.ts)
for the machine-readable source registry.

## Status at last audit (2026-09-18 — Phase 5)

| Source | Tier | Expected filename | Status |
|--------|------|-------------------|--------|
| **مبحث چهارم — الزامات عمومی ساختمان** (latest edition; 1399 / 4th rev. at audit date) | 1 | `mabhas-4-1399.pdf` | **NOT OBTAINED** — sandbox network restrictions prevented download from inbr.ir / bhrc.ac.ir. |
| **مبحث چهارم — الزامات عمومی ساختمان** (1396 / 3rd rev., edition from which current clause numbers are transcribed) | 1 | `mabhas-4-1396.pdf` / `mabhas4-96.pdf` (Phase 5 attachment, 128p) | **NOT OBTAINED in sandbox** — Phase 5 PDFs were attached in UI as `mabhas4-96.pdf` (arena-system-message says /home/user/uploads/mabhas4-96.pdf) but filesystem search `find / -name *.pdf` returns none; `/home/user/uploads/` does not exist. SHA-256 cannot be computed. Honest limitation per Phase 5 task. |
| **مبحث پانزدهم — آسانسورها و پلکان برقی** (1392 w/ amendments) | 1 | `mabhas-15.pdf` (Phase 5 attachment) | **NOT OBTAINED in sandbox** — same limitation as above; attachment not accessible in agent filesystem. |
| **طرح تفصیلی تهران** / دستور نقشه | 1 | (project-specific PDF supplied by user) | **NOT OBTAINED** — always supplied per-project by the architect from the municipality. |

Phase 5 attempted verification:
- Task attached `mabhas4-96.pdf` (مبحث چهارم ویرایش سوم ۱۳۹۶, 128 pages) and `mabhas-15.pdf` (مبحث پانزدهم ۱۳۹۲).
- Agent searched: `ls /home/user/uploads/` → no such file, `find /home -name *.pdf` → none, `find / -maxdepth 4 -name *.pdf` → none.
- Therefore SHA-256, page count from actual file, and exact clause/page verification could NOT be performed in this sandbox session.
- Per Phase 5 instructions: DO NOT pretend files registered, DO NOT fabricate hashes/page numbers, report limitation clearly.
- Source registry entries `t1-mabhas4-96-pdf` and `t1-mabhas15-92-pdf` added with `verificationState: 'not-obtained'` and explanatory note.

No rule is marked `VERIFIED` until a matching PDF exists in this directory
and a reviewer has verified the exact clause, page number, threshold, and
conditions (see promotion procedure below). Currently **0 VERIFIED**.

## Adding a new primary document

1. Obtain the PDF from the issuing authority (BHRC / inbr.ir / the
   municipality) or from an authorised distributor. Do not add pirated
   or unauthenticated scans.
2. Place the file in this directory using the filenames listed above (or
   a descriptive name for project-specific documents).
3. Register it in the machine-readable source registry:
   ```bash
   node sources/register-source.js <sourceId> <pdf-path>
   ```
   where `<sourceId>` matches one of the `t1-*` ids in
   `packages/core/src/regulations/packs/source-registry.ts` (e.g.
   `t1-mabhas4-1399`, `t1-mabhas4-1396`, `t1-mabhas15-1392`). The script
   records the SHA-256 digest, sets `verificationState: 'obtained-authenticated'`,
   and fills in the local `documentPath`.
4. Open the PDF, and for every implemented rule that this document governs:
   - Locate the exact clause/table/page.
   - Confirm the numerical threshold, units, conditions, and exceptions
     against the current implementation.
   - If the implementation is faithful, flip the rule's `status` to
     `'VERIFIED'`, add `page: <number>` to its `SourceRef`, and set
     `verifiedAt` (ISO date).
   - If the implementation disagrees, fix the evaluator AND add a
     regression test (compliant / boundary / non-compliant / exception).
5. Add tests for each newly-verified rule (see the "Testing" section of
   `docs/REGULATION_AUDIT.md`).
6. Run `npm run build` and `npx vitest run`. Both must pass.
7. Update the status tables in `docs/REGULATION_AUDIT.md` and
   `docs/REGULATIONS.md` to reflect which rules are now VERIFIED.

## File integrity

Every registered document carries a SHA-256 digest in
`source-registry.ts` under `digest: { algorithm: 'sha256', value: '…' }`.
This allows the UI and CI to detect tampering. The digest is computed
automatically by `register-source.js`. Re-run the script if you replace
a PDF with a newer edition.

## Do NOT commit unlicensed or pirated scans

ArchGenius will only ship with regulation PDFs that the project is
authorised to redistribute. When in doubt, leave the PDF out of this
directory and distribute it via an external mechanism; the regulation
engine only requires that the PDF be available at audit time — it does
not need to be bundled into the web app at runtime.
