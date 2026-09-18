/**
 * Source registry for the Iranian national Mabar pack.
 *
 * ------------------------------------------------------------------
 * CRITICAL SOURCE AVAILABILITY NOTE (2026-09-18 — Phase 2c audit)
 * ------------------------------------------------------------------
 * The sandboxed environment in which Phase 2c is being executed has
 * restricted outbound HTTPS egress: all *.ir hosts (fc.icivil.ir, inbr.ir,
 * bhrc.ac.ir, mrud.gov.ir, memaripedia.com, hamyarnazer.com, omranpooya.com,
 * atnasr.ir, etc.) fail the TLS handshake (OpenSSL SSL_connect:
 * SSL_ERROR_SYSCALL), and CDN / archive.org mirrors tested were also not
 * reachable from whitelisted npm/GitHub-only egress. As a result, the
 * Tier-1 BHRC PDFs for Mabhas 4 and Mabhas 15 could NOT be downloaded
 * into sources/. Tier-1 entries are therefore registered with
 * verificationState: 'not-obtained' and canonical URIs so that when a
 * user places authenticated PDFs in sources/ they can update
 * documentPath/digest/verificationState and promote rules to VERIFIED
 * one-by-one.
 *
 * The Tier-3 secondary-practitioner source URIs listed below were
 * successfully consulted in Phase 2b (audit) but the rendered HTML pages
 * were not committed to the repo (they are dynamic practitioner sites
 * and snapshotting would risk copyright issues); clause text was
 * transcribed into rule evaluators and is recorded with exact clause
 * numbers in docs/REGULATION_AUDIT.md. Tier-3 entries are therefore also
 * 'not-obtained' as locally-archived files, but were used during
 * transcription and cross-referencing.
 *
 * To promote a rule to VERIFIED:
 *   1. Place the authenticated PDF in sources/<filename>.pdf.
 *   2. Compute sha256 (sha256sum) and record it as digest.
 *   3. Set verificationState: 'obtained-authenticated'.
 *   4. For each rule you verify, change status: 'VERIFIED' and fill in
 *      SourceRef.page with the PDF page number and SourceRef.verifiedAt.
 *   5. Add a regression test for each threshold boundary.
 */
import type { RegulationSource } from '../types.js';

export const SOURCE_REGISTRY_DEFAULTS: RegulationSource[] = [
  // ===== TIER 1: Authoritative BHRC publications (NOT OBTAINED in sandbox) =====
  // Phase 5: PDFs were attached in the UI as mabhas4-96.pdf (Mabhas 4, 3rd ed 1396, 128p)
  // and mabhas-15.pdf (Mabhas 15, 1392). However they are NOT accessible in the
  // agent filesystem (/home/user/uploads/ not present, find / -name *.pdf = none).
  // Therefore they remain not-obtained with no SHA-256, per task instruction to
  // honestly report limitation rather than fabricate metadata.
  {
    id: 't1-mabhas4-1399',
    title: 'مبحث چهارم مقررات ملی ساختمان — الزامات عمومی ساختمان (ویرایش ۱۳۹۹، چهارم)',
    publisher: 'دفتر مقررات ملی ساختمان، وزارت راه و شهرسازی (راه، مسکن و شهرسازی)',
    edition: '1399 (ویرایش چهارم)',
    jurisdiction: 'ir-national',
    tier: 1,
    uri: 'https://inbr.ir/',
    documentPath: undefined,
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Latest in-force revision at the time of audit. Could not be downloaded from inbr.ir due to sandbox network restrictions; user must supply an authenticated copy (bhrc.ac.ir or official publication). Supersedes the 1396 edition for clauses that were amended.',
  },
  {
    id: 't1-mabhas4-1396',
    title: 'مبحث چهارم مقررات ملی ساختمان — الزامات عمومی ساختمان (ویرایش ۱۳۹۶، سوم)',
    publisher: 'دفتر مقررات ملی ساختمان، وزارت راه و شهرسازی',
    edition: '1396 (ویرایش سوم)',
    publicationDate: '1396',
    jurisdiction: 'ir-national',
    tier: 1,
    uri: 'https://fc.icivil.ir/mabahes-pdf/mabhas-4-v1396%28www.icivil.ir%29.pdf',
    documentPath: undefined,
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Edition transcribed into current rules (based on clause numbering 4-5-1-7, 4-5-2-2, 7-1-1-x used by secondary sources). Expected filename in repo: sources/mabhas4-96.pdf (Phase 5 attachment: 128 pages, ویرایش سوم ۱۳۹۶). Not accessible in sandbox filesystem at audit time.',
  },
  {
    id: 't1-mabhas4-96-pdf',
    title: 'مبحث چهارم مقررات ملی ساختمان — ویرایش سوم ۱۳۹۶ (128 صفحه) — PDF پیوست شده در Phase 5',
    publisher: 'دفتر مقررات ملی ساختمان، وزارت راه و شهرسازی',
    edition: '1396 (ویرایش سوم) — 128 pages',
    publicationDate: '1396',
    jurisdiction: 'ir-national',
    tier: 1,
    uri: 'https://inbr.ir/',
    documentPath: undefined,
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Phase 5 primary source: mabhas4-96.pdf attached in UI (arena-system-message says /home/user/uploads/mabhas4-96.pdf) but NOT present in agent filesystem (ls /home/user/uploads/ fails, find / -name *.pdf = none). SHA-256 cannot be computed. Honest limitation per Phase 5 task: report as not-obtained rather than fabricate hash. Expected repo path: sources/mabhas4-96.pdf',
  },
  {
    id: 't1-mabhas15-1392',
    title: 'مبحث پانزدهم مقررات ملی ساختمان — آسانسورها و پلکان برقی (ویرایش ۱۳۹۲ با الحاقیه‌های بعدی)',
    publisher: 'دفتر مقررات ملی ساختمان، وزارت راه و شهرسازی',
    edition: '1392 (با الحاقیه‌ها)',
    jurisdiction: 'ir-national',
    tier: 1,
    uri: 'https://inbr.ir/',
    documentPath: undefined,
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Elevator / escalator regulation. §15-2-1-2 (7 m trigger) and cab-size clauses require Tier-1 confirmation. Expected filename: sources/mabhas-15.pdf (Phase 5 attachment mabhas-15.pdf, ویرایش ۱۳۹۲).',
  },
  {
    id: 't1-mabhas15-92-pdf',
    title: 'مبحث پانزدهم مقررات ملی ساختمان — ویرایش ۱۳۹۲ — PDF پیوست شده در Phase 5',
    publisher: 'دفتر مقررات ملی ساختمان، وزارت راه و شهرسازی',
    edition: '1392',
    publicationDate: '1392',
    jurisdiction: 'ir-national',
    tier: 1,
    uri: 'https://inbr.ir/',
    documentPath: undefined,
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Phase 5 primary source: mabhas-15.pdf attached in UI but NOT present in agent filesystem. SHA-256 cannot be computed. Expected repo path: sources/mabhas-15.pdf',
  },
  {
    id: 't1-tehran-tarh-tafsili',
    title: 'طرح تفصیلی شهر تهران (آخرین ابلاغیه) به همراه دستورالعمل‌های اجرایی',
    publisher: 'شهرداری تهران — معاونت شهرسازی و معماری',
    jurisdiction: 'ir-tehran',
    tier: 1,
    verificationState: 'not-obtained',
    note: 'Tehran detailed plan; district-specific (R-110, R-120, R-160, …). Must be supplied by the user with their building-permit instruction (دستور نقشه).',
  },

  // ===== TIER 3: Secondary-practitioner sources (referenced during audit;
  //         HTML content transcribed, no local snapshot archived) =====
  {
    id: 't3-mabhas4-1396-residential',
    title: 'مبحث چهار (۱۳۹۶) — مقررات اختصاصی تصرف‌های مسکونی (فصل ۷-۱-۱، گروه م-۲)، بندهای ۱ تا ۲۶',
    publisher: 'omranpooya.com (transcript of verbatim clauses)',
    edition: '1396',
    jurisdiction: 'ir-national',
    tier: 3,
    uri: 'https://omranpooya.com/construction/procedure/general-requirements/gr-7',
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Used as the primary Tier-3 cross-reference for §7-1-1-3, §7-1-1-4, §7-1-1-8, §7-1-1-9, §7-1-1-10, §7-1-1-11, §7-1-1-12, §7-1-1-13, §7-1-1-14, §7-1-1-15, §7-1-1-18, §7-1-1-19. Rendered HTML was not archived to disk.',
  },
  {
    id: 't3-mabhas4-1396-stair',
    title: 'مبحث چهار (۱۳۹۶) بند ۴-۵-۱-۷ راه‌پله‌ها (اجرا) — نقل verbatim زیربندها',
    publisher: 'manexgroup.net (engineer practitioner summary with quoted sub-clauses)',
    edition: '1396',
    jurisdiction: 'ir-national',
    tier: 3,
    uri: 'https://manexgroup.net/implementation-building-stairs/',
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Source for §4-5-1-7-1 (tread 0.28 m, 2r+t = 0.63–0.64 m), §4-5-1-7-3 (width 1.10 m / 2.40 m public), §4-5-1-7-4 (landing), §4-5-1-7-5 (max 12 risers), §4-5-1-7-6 (headroom 2.05 m), §4-5-1-7-7 (roof stair). Cross-checked against hamyarnazer.com and sabzsaze.com.',
  },
  {
    id: 't3-mabhas4-1396-habitable',
    title: 'مبحث چهار (۱۳۹۶) بند ۴-۵-۲-۲ — فضاهای اقامت (الزامات عمومی)',
    publisher: 'sandbadstudio.ir (instructor site, verbatim clause quotation)',
    edition: '1396',
    jurisdiction: 'ir-national',
    tier: 3,
    uri: 'https://sandbadstudio.ir/bedroom-lvr-height/',
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Source for §4-5-2-2-1 (6.50 m²), §4-5-2-2-2 (2.15 m), §4-5-2-2-3 (2.40 m height) general habitable-room minimums.',
  },
  {
    id: 't3-mabhas15-1392-elevator',
    title: 'مبحث پانزدهم — نکات مهم الزامات اولیه انتخاب آسانسور (بند ۱۵-۲-۱)',
    publisher: 'memaripedia.com (exam-prep/clause summary with numbered sub-clauses)',
    edition: '1392 (with amendments)',
    jurisdiction: 'ir-national',
    tier: 3,
    uri: 'https://memaripedia.com/mini-mabhas-15/',
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Source for §15-2-1-2 (>7 m trigger), §15-2-1-4 (>21 m stretcher), §15-2-1-9 (wheelchair 1.4×1.1), §15-2-1-10 (stretcher 2.1×1.1), §15-2-1-11 (bed 2.4×1.4). Cross-checked with cadkhoda-academy.ir and sabzsaze.com.',
  },
  {
    id: 't3-mabhas4-1396-daylight',
    title: 'مبحث چهار (۱۳۹۶) — فصل ۶ الزامات نورگیری و تهویه (نسبت شیشه، عمق نورگیری، نورگیرها)',
    publisher: 'memaripedia.com / atnasr.ir / danesh-cad.blogfa.ir (aggregated)',
    edition: '1396',
    jurisdiction: 'ir-national',
    tier: 3,
    uri: 'https://memaripedia.com/%D9%85%D8%A8%D8%AD%D8%AB-%DA%86%D9%87%D8%A7%D8%B1%D9%85/',
    verificationState: 'not-obtained',
    retrievedAt: '2026-09-18',
    note: 'Used to enumerate glazing ratios (1/8, 1/7, 1/6, 1/5) and light-well dimensions (12 m²×3 m / 6 m²×2 m / 6% and 3% of parcel / 6 m and 4 m opposite-window separation). All daylight ratio and light-well rules remain NOT_IMPLEMENTED until the Tier-1 PDF is held.',
  },

  // ===== Assumptions (NOT regulatory) =====
  {
    id: 'local-parking-assumption',
    title: 'عرف پارکینگ طرح تفصیلی (بدون منبع قانونی)',
    jurisdiction: 'ir-national',
    tier: 3,
    verificationState: 'not-obtained',
    note: 'Parking-per-unit ratios vary by municipality and detailed-plan zoning; no national Mabar rule exists. The 1-bay/unit default is common praxis in many districts and is emitted as a SOFT advisory only.',
  },
  {
    id: 'local-setback-assumption',
    title: 'عقب‌نشینی / سطح اشغال / تراکم پیش‌فرض (بدون منبع قانونی)',
    jurisdiction: 'ir-national',
    tier: 3,
    verificationState: 'not-obtained',
    note: 'Default setbacks used for layout generation when the user does not supply a municipal pack; MUST be replaced by values from the user\'s permit instruction (دستور نقشه).',
  },
];
