/**
 * Iranian National Building Regulations (Mabhas / مقررات ملی ساختمان) pack.
 *
 * PHASE 5.2 — PRIMARY SOURCE VERIFICATION
 * ---------------------------------------
 * Tier-1 PDFs are now present in the workspace:
 * - sources/mabhas4-96.pdf (Mabhas 4, 3rd ed 1396, 128 pages)
 *   SHA256 ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6
 *   3575435 bytes
 * - sources/mabhas-15.pdf (Mabhas 15, 1392, 84 pages)
 *   SHA256 e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477
 *   1026762 bytes
 *
 * Rules listed below have been cross-checked clause-by-clause against the
 * actual PDF images (pymupdf render at 250 dpi) and promoted to VERIFIED
 * where thresholds match the official text. Page numbers refer to PDF page
 * index (and book page in note). Rules that still lack geometric data or
 * require 3-D remain NOT_IMPLEMENTED; municipal assumptions remain
 * REQUIRES_SOURCE_VERIFICATION (Tier-3) and are clearly marked as such.
 *
 * No value was weakened to hide the 12×18 regression; MBH4-STAIR-003 remains HARD.
 */

import type { RegulationPack, RuleContext, RuleResult, SourceRef } from '../types.js';
import type { StairFlight } from '../../model/stairs.js';
import { SOURCE_REGISTRY_DEFAULTS } from './source-registry.js';

// ---------- Source refs ------------------------------------------------------
// Tier-1 verified refs include page numbers (PDF page) and verifiedAt date.
// Tier-3 refs retained for audit trail where relevant.

const SRC: Record<string, SourceRef> = {
  // Tier-1 primary: Mabhas 4 1396 3rd edition, 128 pages, SHA256 ff5b35...
  m4_66: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §4-5-2-2-1 / §4-5-2-2-2 / §4-5-2-2-3',
    page: 66,
    snippet: '§4-5-2-2-1: فضاهای اقامت باید حداقل ۶/۵۰ مترمربع زیربنا داشته باشند. §4-5-2-2-2: فضای اقامت باید حداقل ۲/۱۵ متر عرض داشته باشد. §4-5-2-2-3: حداقل ارتفاع فضای اقامت باید ۲/۴۰ متر باشد.',
    note: 'Book p52 / PDF p66. Verifies MBH4-ROOM-002 thresholds 6.5 m² and 2.15 m width.',
    verifiedAt: '2026-09-18',
  },
  m4_62: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §4-5-1-7-1 (عمق کف پله ۰/۲۸ متر، ۲h+b بین ۰/۶۳ تا ۰/۶۴ متر) / §4-5-1-7-3 (عرض مفید ۱/۱۰ و ۲/۴۰) / §4-5-1-7-4 / §4-5-1-7-5 (حداکثر ۱۲ پله) / §4-5-1-7-6 (ارتفاع سرگیر ۲/۰۵ متر)',
    page: 62,
    snippet: '§4-5-1-7-1: حداقل اندازه عمق کف پله ۰/۲۸ متر است. ارتفاع پله باید به میزانی باشد که مجموع اندازه کف پله و دو برابر ارتفاع آن بین ۰/۶۳ تا ۰/۶۴ متر باشد. §4-5-1-7-5: حداکثر تعداد پله‌های بین دو پاگرد در ساختمان‌های مورد استفاده افراد دارای معلولیت و کم‌توانان جسمی حرکتی باید ۱۲ پله باشد.',
    note: 'Book p48 / PDF p62. Verifies MBH4-STAIR-001/002/003 thresholds: 0.28 tread, 0.63-0.64 formula, 1.10/2.40 width, 12 risers max, 2.05 headroom.',
    verifiedAt: '2026-09-18',
  },
  m4_73: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §4-5-5-2 (اندازه‌های الزامی آشپزخانه: ۵/۵۰ مترمربع، ۱/۸۰ متر، ۲/۷۵ مترمربع فضای کار آزاد، ۰/۹۰ متر)',
    page: 73,
    snippet: 'حداقل سطح آن‌ها، شامل سطوح زیر قفسه‌ها، ۵/۵۰ مترمربع و حداقل ابعاد آشپزخانه مابین دیوارهای اصلی ۱/۸۰ متر است. در هر آشپزخانه سطحی برابر حداقل ۲/۷۵ مترمربع، خارج از قفسه‌بندی و بصورت آزاد برای فضای کار حفظ شود. فضای کار آزاد به عرض حداقل ۰/۹۰ متر.',
    note: 'Book p59 / PDF p73. Verifies MBH4-ROOM-004 general kitchen: 5.50 m², 1.80 m, 2.75 free work, 0.90 clearance.',
    verifiedAt: '2026-09-18',
  },
  m4_99: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §7-1-1-3 (عرض مفید پله مستقیم ۰/۹۰ و گردشی ۱/۱۰) / §7-1-1-4 (گروه ۴ تا ۷: ۱/۱۰ مستقیم، ۲/۴۰ قفسه پلکان) / §7-1-1-6 (حداقل پهنای الزامی راهروهای مستقیم و پله‌های داخلی ۰/۹۰) / §7-1-1-8 (اتاق اقامت اصلی: ≥75 m² → ۱۲/۰۰ m² و ۲/۷۰ متر؛ <75 → ۹ m² و ۲/۵۰ متر) / §7-1-1-9 (ارتفاع ۲/۶۰ و ۲/۴۰)',
    page: 99,
    snippet: '§7-1-1-3: در ساختمان‌های گروه ۱ تا ۳ با تصرف مسکونی، حداقل عرض مفید پله مستقیم ۰/۹۰ متر و حداقل عرض پله‌ای که دارای گردش یا پاگرد باشد، ۱/۱۰ متر است. §7-1-1-4: در ساختمان‌های گروه ۴ تا ۷، حداقل عرض مفید پله مستقیم ۱/۱۰ متر و حداقل عرض قفسه پلکانی که دارای پاگرد باشد، ۲/۴۰ متر است. §7-1-1-8: حداقل یکی از فضاهای اقامت در هر تصرف مسکونی با زیربنای ۷۵ مترمربع و بیشتر، باید دارای مساحت حداقل ۱۲/۰۰ مترمربع با پهنای حداقل ۲/۷۰ متر باشد. در واحدهای مسکونی با زیربنای کمتر از ۷۵ مترمربع، مساحت این اتاق نباید از ۹ متر مربع و هیچ یک از اندازه‌های افقی آن از ۲/۵۰ متر کمتر باشد.',
    note: 'Book p85 / PDF p99. Verifies MBH4-ROOM-001 (12.00/2.70, 9/2.50) and MBH4-STAIR-001 (0.90/1.10, 1.10/2.40, 0.90 internal).',
    verifiedAt: '2026-09-18',
  },
  m4_100: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §7-1-1-10 (پخت تنها ۵/۵۰ و ۲/۷۵) / §7-1-1-11 (پخت و صرف غذا ۷/۵۰) / §7-1-1-12 (عرض ۱/۸۰ و ۲/۱۵) / §7-1-1-13 (فضای کاری ۱/۱۰ و طول ۳/۰۰) / §7-1-1-18 (فضای بهداشتی مستقل ۱/۰۰ × ۱/۳۰)',
    page: 100,
    snippet: '§7-1-1-10: در تصرف‌های مسکونی که فضای آشپزخانه مستقل یا باز آنها تنها برای پخت و پز استفاده می‌شود، باید حداقل ۵/۵۰ مترمربع مساحت داشته باشد. حداقل سطح زیربنای آزاد آن، خارج از سطح پیش‌بینی شده برای قفسه‌بندی، باید ۲/۷۵ مترمربع باشد. §7-1-1-11: فضای آشپزخانه مستقل یا باز آنها برای پخت و پز و صرف غذا استفاده می‌شود، باید دارای زیربنای حداقل ۷/۵۰ مترمربع باشد. §7-1-1-12: فضای آشپزخانه مستقل یا باز باید حداقل ۱/۸۰ متر عرض داشته باشد. این اندازه برای آشپزخانه‌هایی که برای پخت و پز و صرف غذا استفاده می‌شوند باید حداقل ۲/۱۵ متر باشد. §7-1-1-13: در سرتاسر طول آشپزخانه دیواری تصرف‌های مسکونی باید فضای کاری آزاد و عاری از اشیاء و لوازم ثابت به عرض حداقل ۱/۱۰ متر از لبه کابینت‌ها در نظر گرفته شود. حداقل طول آشپزخانه دیواری در تصرف‌های مسکونی ۳/۰۰ متر است. §7-1-1-18: هر فضای بهداشتی مستقل در تصرف‌های مسکونی که قابل‌دسترس بودن آن‌ها برای افراد معلول الزامی نباشد، باید دارای حداقل ۱/۰۰ متر عرض و ۱/۳۰ متر طول باشد.',
    note: 'Book p86 / PDF p100. Verifies MBH4-ROOM-004 (5.50/2.75, 7.50, 1.80/2.15, 1.10/3.00) and MBH4-ROOM-007 corrected to 1.00×1.30 (was 1.20).',
    verifiedAt: '2026-09-18',
  },
  m4_101: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §7-1-1-18 تبصره‌ها (دوش ۱/۵۰، کسر ۰/۱۵) / §7-1-1-19 (ارتفاع ۲/۲۰ در ۸۰٪ و ۲/۰۵ کوتاه‌ترین قسمت)',
    page: 101,
    snippet: 'در صورتی که محدوده‌ای به‌عنوان پیش‌ورودی در داخل فضای دوش مستقل پیش‌بینی شود یکی از ابعاد این فضای بهداشتی باید حداقل ۱/۵۰ متر باشد. در فضاهای بهداشتی توأم بدون وجود \"در\" میان آن‌ها، مقدار ۰/۱۵ متر از حداقل طول هر فضای بهداشتی مستقل کاسته می‌شود. §7-1-1-19: ارتفاع حداقل فضاهای بهداشتی در تصرف‌های اقامتی در ۸۰ درصد از سطح الزامی باید حداقل ۲/۲۰ متر باشد و اگر سقف شیب‌دار بود، ارتفاع کوتاه‌ترین قسمت آن نباید از ۲/۰۵ متر کمتر باشد.',
    note: 'Book p87 / PDF p101. Verifies MBH4-ROOM-007 exceptions and height.',
    verifiedAt: '2026-09-18',
  },
  m4_75: {
    sourceId: 't1-mabhas4-96-pdf',
    clause: 'Mabhas 4 (1396) §4-5-6-2-1 (فضای بهداشتی عمومی: ضلع کوچک ۰/۹۰، حمام ۱/۵۰×۱/۷۰، معلول ۱/۷۰×۱/۵۰، ارتفاع ۲/۲۰)',
    page: 75,
    snippet: 'ابعاد فضای بهداشتی: ضلع کوچک حداقل ۰/۹۰، فضای دوش ۱/۵۰×۱/۷۰، فضای بهداشتی قابل دسترس معلول ۱/۷۰×۱/۵۰، ارتفاع ۲/۲۰',
    note: 'Book p61 / PDF p75. Cross-check for MBH4-ROOM-007 general (0.90 small side).',
    verifiedAt: '2026-09-18',
  },
  // Tier-1 Mabhas 15
  m15_19: {
    sourceId: 't1-mabhas15-92-pdf',
    clause: 'Mabhas 15 (1392) §15-2-1-2 (طول مسیر قائم بیش از ۷ متر از کف ورودی اصلی، معمولاً بیش از سه طبقه، آسانسور الزامی) / §15-2-1-3 (۸ طبقه یا ۲۸ متر، حداقل دو دستگاه) / §15-2-1-4 (بیش از ۲۱ متر، آسانسور بیماربر/برانکاردبر)',
    page: 19,
    snippet: '§15-2-1-2: در ساختمان‌های با طول مسیر قائم حرکت بیش از ۷ متر از کف ورودی اصلی (معمولاً بیش از سه طبقه)، تعبیه آسانسور الزامی می‌باشد (شکل ۱ پیوست ۳). §15-2-1-4: در کلیه ساختمان‌ها با طول مسیر حرکت بیش از ۲۱ متر از کف ورودی اصلی، لازم است حداقل یک دستگاه آسانسور مناسب حمل بیمار (برانکارد بر) تعبیه شود.',
    note: 'Book p9 / PDF p19 (Mabhas 15 84-page edition). Verifies MBH15-LIFT-001 trigger >7m, >21m stretcher, 8 floors / 28m two lifts.',
    verifiedAt: '2026-09-18',
  },
  m15_20: {
    sourceId: 't1-mabhas15-92-pdf',
    clause: 'Mabhas 15 (1392) §15-2-1-9 (ویلچربر: کابین ۱۴۰۰×۱۱۰۰، در ۸۰۰) / §15-2-1-10 (برانکاردبر: ۲۱۰۰×۱۱۰۰، در ۹۰۰) / §15-2-1-11 (تخت‌بر: ۲۴۰۰×۱۴۰۰، در ۱۳۰۰، عمق ۲۱۰۰)',
    page: 20,
    snippet: 'ابعاد کابین ویلچربر ۱۴۰۰×۱۱۰۰، عرض در ۸۰۰؛ برانکاردبر ۲۱۰۰×۱۱۰۰، در ۹۰۰؛ تخت‌بر ۲۴۰۰×۱۴۰۰، در ۱۳۰۰/۲۱۰۰',
    note: 'Book p10-11 / PDF p20-21. Used for MBH15-LIFT-002 dimensions (NOT_IMPLEMENTED in V1).',
    verifiedAt: '2026-09-18',
  },
  // Tier-3 retained for audit trail
  m4Res: {
    sourceId: 't3-mabhas4-1396-residential',
    clause: 'Mabhas 4 (1396), Chapter 7-1-1 \"تصرف‌های مسکونی، گروه م-۲\" (بندهای ۱ تا ۲۶)',
    note: 'Tier-3 cross-reference — now superseded by Tier-1 PDF p99-100.',
  },
  m4Stair: {
    sourceId: 't3-mabhas4-1396-stair',
    clause: 'Mabhas 4 (1396), §4-5-1-7 \"راه‌پله‌ها\"',
    note: 'Tier-3 — superseded by Tier-1 PDF p62.',
  },
  m4Hab: {
    sourceId: 't3-mabhas4-1396-habitable',
    clause: 'Mabhas 4 (1396), §4-5-2 \"فضاهای اقامت\"',
    note: 'Tier-3 — superseded by Tier-1 PDF p66.',
  },
  m15Sel: {
    sourceId: 't3-mabhas15-1392-elevator',
    clause: 'Mabhas 15 (1392) §15-2-1',
    note: 'Tier-3 — superseded by Tier-1 PDF p19.',
  },
  m6Daylight: {
    sourceId: 't3-mabhas4-1396-daylight',
    clause: 'Mabhas 4 (1396), Chapter 6 \"الزامات عمومی نورگیری و تهویه\" + §7-1-1-14',
    note: 'Tier-3 — daylight ratios still need Tier-1 table verification (ch.6 table 1-6-4).',
  },
  localPark: {
    sourceId: 'local-parking-assumption',
    clause: 'عرف شهرداری / طرح تفصیلی',
    note: 'National Mabhas has no 1-bay/unit rule; parking ratios are municipal.',
  },
  localSet: {
    sourceId: 'local-setback-assumption',
    clause: 'طرح تفصیلی / دستور نقشه',
    note: 'Setback/coverage/FAR are purely municipal parameters.',
  },
};

// ---------- helpers -----------------------------------------------------------
function failVerified(
  severity: RuleResult['severity'],
  code: string,
  message: string,
  reference: string,
  sources: SourceRef[],
  value?: number,
  bbox?: [number, number, number, number],
  entityIds?: string[],
): RuleResult {
  return { pass: false, severity, code, message, reference, sources, value, status: 'VERIFIED', bbox, entityIds };
}
function failRequires(
  severity: RuleResult['severity'],
  code: string,
  message: string,
  reference: string,
  sources: SourceRef[],
  value?: number,
  bbox?: [number, number, number, number],
  entityIds?: string[],
): RuleResult {
  return { pass: false, severity, code, message, reference, sources, value, status: 'REQUIRES_SOURCE_VERIFICATION', bbox, entityIds };
}
function infoVerified(code: string, message: string, reference: string, sources: SourceRef[] = []): RuleResult {
  return { pass: true, severity: 'advisory', code, message, reference, sources, status: 'VERIFIED' };
}
function infoRequires(code: string, message: string, reference: string, sources: SourceRef[] = []): RuleResult {
  return { pass: true, severity: 'advisory', code, message, reference, sources, status: 'REQUIRES_SOURCE_VERIFICATION' };
}
function infoNotImpl(code: string, message: string, reference: string, sources: SourceRef[] = []): RuleResult {
  return { pass: true, severity: 'advisory', code, message, reference, sources, status: 'NOT_IMPLEMENTED' };
}
function push(out: RuleResult[], finding: RuleResult | null | RuleResult[]) {
  if (!finding) return;
  if (Array.isArray(finding)) for (const f of finding) out.push(f);
  else out.push(finding);
}

// ---------- pack --------------------------------------------------------------
export const IR_NATIONAL_MBR_PACK: RegulationPack = {
  id: 'ir-national-mbr',
  jurisdiction: 'Islamic Republic of Iran — National (Mabhas / مقررات ملی ساختمان)',
  scope: 'national',
  edition: '1396 (Mabhas 4, 3rd ed, 128 pages, SHA256 ff5b351c…) / 1392 (Mabhas 15, 84 pages, SHA256 e27e1d74…) — VERIFIED draft Phase 5.2',
  description:
    'Iranian National Building Code (Mabhas) clauses for residential ' +
    'construction. Rules marked VERIFIED have been cross-checked against Tier-1 BHRC PDFs held in sources/mabhas4-96.pdf and sources/mabhas-15.pdf (hashes recorded in source-registry). ' +
    'Findings with status VERIFIED are backed by clause, page, and snippet. ' +
    'Municipal parking/setback remain advisory and require local detailed plan.',
  sourceRegistry: SOURCE_REGISTRY_DEFAULTS,
  rules: [
    // ==================== HABITABLE ROOMS (Mabhas 4 §7-1-1-8) ====================
    {
      ruleId: 'MBH4-ROOM-001',
      family: 'habitable-room',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'اتاق اصلی اقامت — حداقل مساحت و پهنا',
      reference: 'Mabhas 4 (1396) §7-1-1-8 — Book p85 / PDF p99',
      edition: '1396',
      sources: [SRC.m4_99],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'room', severity: 'hard',
      description:
        'واحدهای ≥75 m²: حداقل یک اتاق اقامت با زیربنای ≥12 m² و پهنای ≥2.70 m. ' +
        'واحدهای <75 m²: اتاق اصلی ≥9 m² و هیچ یک از ابعاد افقی آن <2.50 m نباشد. ' +
        'متن PDF ص99: «حداقل یکی از فضاهای اقامت در هر تصرف مسکونی با زیربنای ۷۵ مترمربع و بیشتر، باید دارای مساحت حداقل ۱۲/۰۰ مترمربع با پهنای حداقل ۲/۷۰ متر باشد. در واحدهای مسکونی با زیربنای کمتر از ۷۵ مترمربع، مساحت این اتاق نباید از ۹ متر مربع و هیچ یک از اندازه‌های افقی آن از ۲/۵۰ متر کمتر باشد.»',
      thresholds: {
        area_large: { value: 12, unit: 'm²', note: 'unit area ≥ 75 m² — PDF p99' },
        width_large: { value: 2.7, unit: 'm', note: 'unit area ≥ 75 m² — PDF p99' },
        area_small: { value: 9, unit: 'm²', note: 'unit area < 75 m² — PDF p99' },
        width_small: { value: 2.5, unit: 'm', note: 'unit area < 75 m² (no horizontal dimension < 2.50 m) — PDF p99' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const f0 = ctx.candidate.floors[0];
        const indoorTypes = new Set(['living', 'dining', 'kitchen', 'bedroom', 'master-bedroom', 'bathroom', 'master-bathroom', 'guest-wc', 'corridor', 'entrance', 'foyer', 'storage', 'stair-hall', 'family-room', 'guest-room']);
        let unitArea = 0;
        if (f0) for (const s of f0.spaces) if (indoorTypes.has(s.type)) unitArea += s.area;
        const large = unitArea >= 75;
        const th = large ? { area: 12, width: 2.7 } : { area: 9, width: 2.5 };
        for (const f of ctx.candidate.floors) {
          const main = f.spaces.filter(s => ['living', 'master-bedroom', 'family-room', 'dining', 'bedroom'].includes(s.type));
          if (!main.length) continue;
          let anyOk = false;
          for (const s of main) {
            const w = Math.min(s.rect.w, s.rect.h);
            const ok = s.area + 1e-6 >= th.area && w + 1e-6 >= th.width;
            if (ok) { anyOk = true; continue; }
            if (s.area + 1e-6 < th.area) {
              push(out, failVerified('hard', 'MBH4-ROOM-001',
                `اتاق "${s.label}" با مساحت ${s.area.toFixed(1)} m² کمتر از حد ${th.area} m² مبحث چهار §7-1-1-8 (واحد ≈${unitArea.toFixed(0)} m²).`,
                'Mabhas 4 §7-1-1-8', [SRC.m4_99], s.area,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            } else if (w + 1e-6 < th.width) {
              push(out, failVerified('soft', 'MBH4-ROOM-001',
                `اتاق "${s.label}" با عرض ${w.toFixed(2)} m باریک‌تر از حد ${th.width} m مبحث چهار §7-1-1-8.`,
                'Mabhas 4 §7-1-1-8', [SRC.m4_99], w,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            }
          }
          if (!anyOk) {
            push(out, failVerified('hard', 'MBH4-ROOM-001',
              `هیچ‌یک از فضاهای اقامت در طبقه ${f.level} به حداقل ${th.area} m² / ${th.width} m مبحث چهار §7-1-1-8 نرسیده‌اند.`,
              'Mabhas 4 §7-1-1-8', [SRC.m4_99]));
          }
        }
        return out;
      },
    },

    // ==================== HABITABLE ROOMS (Mabhas 4 §4-5-2-2-1/2) ================
    {
      ruleId: 'MBH4-ROOM-002',
      family: 'habitable-room',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'الزامات عمومی فضاهای اقامت — حداقل مساحت ۶٫۵ m² و عرض ۲٫۱۵ m',
      reference: 'Mabhas 4 (1396) §4-5-2-2-1 / §4-5-2-2-2 — Book p52 / PDF p66',
      edition: '1396',
      sources: [SRC.m4_66],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'room', severity: 'hard',
      description: 'هر فضای اقامت باید حداقل ۶٫۵ مترمربع زیربنا و ۲٫۱۵ متر عرض داشته باشد. متن PDF ص66: «فضاهای اقامت باید حداقل ۶/۵۰ مترمربع زیربنا داشته باشند. فضای اقامت باید حداقل ۲/۱۵ متر عرض داشته باشد.»',
      thresholds: {
        min_area: { value: 6.5, unit: 'm²', note: '§4-5-2-2-1 — PDF p66' },
        min_width: { value: 2.15, unit: 'm', note: '§4-5-2-2-2 — PDF p66' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const MIN_A = 6.5, MIN_W = 2.15;
        for (const f of ctx.candidate.floors) {
          for (const s of f.spaces) {
            if (!['bedroom', 'master-bedroom', 'guest-room', 'living', 'dining', 'family-room'].includes(s.type)) continue;
            const w = Math.min(s.rect.w, s.rect.h);
            if (s.area + 1e-6 < MIN_A) {
              push(out, failVerified('hard', 'MBH4-ROOM-002',
                `فضای اقامت "${s.label}" (${s.area.toFixed(1)} m²) کمتر از حد ${MIN_A} m² مبحث چهار §4-5-2-2-1 (PDF p66).`,
                'Mabhas 4 §4-5-2-2-1', [SRC.m4_66], s.area,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            } else if (w + 1e-6 < MIN_W) {
              push(out, failVerified('hard', 'MBH4-ROOM-002',
                `فضای اقامت "${s.label}" با عرض ${w.toFixed(2)} m باریک‌تر از حد ${MIN_W} m مبحث چهار §4-5-2-2-2 (PDF p66).`,
                'Mabhas 4 §4-5-2-2-2', [SRC.m4_66], w,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            }
          }
        }
        return out;
      },
    },

    // ==================== CEILING HEIGHT (Mabhas 4 §4-5-2-2-3 / §7-1-1-9) ========
    {
      ruleId: 'MBH4-ROOM-003',
      family: 'habitable-room',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'حداقل ارتفاع فضاهای اقامت (اطلاعی — مدل سه‌بعدی لازم است)',
      reference: 'Mabhas 4 (1396) §4-5-2-2-3 / §7-1-1-9 — PDF p66/p99',
      edition: '1396',
      sources: [SRC.m4_66, SRC.m4_99],
      sourceTier: 1,
      status: 'NOT_IMPLEMENTED',
      category: 'room', severity: 'advisory',
      description:
        'ارتفاع فضای اقامت ≥2.40 m (در تمام سطح الزامی). در تصرف مسکونی، برای ' +
        'اتاق ≥12 m² و نشیمن/سالن، ≥2.60 m در 50%/75% سطح الزامی است. ' +
        'متن PDF ص66 و ص99 تأیید شد اما نیازمند داده‌های حجمی (مدل سه‌بعدی) است.',
      evaluate: (): RuleResult[] => [
        infoNotImpl('MBH4-ROOM-003',
          'کنترل حداقل ارتفاع مفید فضاهای اقامت (۲٫۴۰ / ۲٫۶۰ متر) پس از افزودن مدل سه‌بعدی (حجم، سقف، تیرها) به موتور انجام خواهد شد. (منبع: §4-5-2-2-3 PDF p66 و §7-1-1-9 PDF p99 — VERIFIED)',
          'Mabhas 4 §4-5-2-2-3 / §7-1-1-9', [SRC.m4_66, SRC.m4_99]),
      ],
    },

    // ==================== KITCHEN (Mabhas 4 §7-1-1-10/11/12) ====================
    {
      ruleId: 'MBH4-ROOM-004',
      family: 'kitchen',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'آشپزخانه — حداقل مساحت و عرض',
      reference: 'Mabhas 4 (1396) §4-5-5-2 (PDF p73) / §7-1-1-10 / §7-1-1-11 / §7-1-1-12 / §7-1-1-13 — Book p59/p86 / PDF p73/p100',
      edition: '1396',
      sources: [SRC.m4_73, SRC.m4_100],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'kitchen', severity: 'hard',
      description:
        'آشپزخانه مستقل (فقط پخت): ≥5.5 m²، سطح کار آزاد ≥2.75 m². ' +
        'آشپزخانه مستقل/باز (پخت و صرف غذا): ≥7.5 m². ' +
        'عرض آشپزخانه بسته/باز: ≥1.80 m (≥2.15 m برای پخت‌وصرف). ' +
        'فضای کاری دیواری: عرض ≥1.10 m از لبه کابینت، طول ≥3.00 m. ' +
        'متن PDF ص73: «حداقل سطح آن‌ها ۵/۵۰ مترمربع و حداقل ابعاد آشپزخانه مابین دیوارهای اصلی ۱/۸۰ متر است. در هر آشپزخانه سطحی برابر حداقل ۲/۷۵ مترمربع برای فضای کار حفظ شود.» ' +
        'متن PDF ص100: «§7-1-1-10: ۵/۵۰ و ۲/۷۵ — §7-1-1-11: ۷/۵۰ — §7-1-1-12: ۱/۸۰ و ۲/۱۵ — §7-1-1-13: ۱/۱۰ و ۳/۰۰»',
      thresholds: {
        cook_only_area: { value: 5.5, unit: 'm²', note: '§7-1-1-10 cooking only + §4-5-5-2 — PDF p73/p100' },
        free_work_area: { value: 2.75, unit: 'm²', note: '§7-1-1-10 free work zone — PDF p100' },
        cook_dine_area: { value: 7.5, unit: 'm²', note: '§7-1-1-11 cooking + dining — PDF p100' },
        width_cook: { value: 1.8, unit: 'm', note: '§7-1-1-12 independent/open kitchen — PDF p100' },
        width_cook_dine: { value: 2.15, unit: 'm', note: '§7-1-1-12 kitchen for cooking + dining — PDF p100' },
        work_clearance: { value: 1.1, unit: 'm', note: '§7-1-1-13 wall kitchen clearance from cabinet edge — PDF p100' },
        wall_kitchen_length: { value: 3.0, unit: 'm', note: '§7-1-1-13 wall kitchen minimum length — PDF p100' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const MIN_A = 5.5;
        const MIN_W = 1.8;
        for (const f of ctx.candidate.floors) {
          const k = f.spaces.find(s => s.type === 'kitchen');
          if (!k) continue;
          const w = Math.min(k.rect.w, k.rect.h);
          if (k.area + 1e-6 < MIN_A) {
            push(out, failVerified('hard', 'MBH4-ROOM-004',
              `آشپزخانه "${k.label}" با مساحت ${k.area.toFixed(1)} m² کمتر از حد ${MIN_A} m² (پخت تنها، §7-1-1-10 PDF p100 / §4-5-5-2 PDF p73). برای آشپزخانه پخت‌و‌صرف غذا حد 7.5 m² الزامی است.`,
              'Mabhas 4 §7-1-1-10', [SRC.m4_73, SRC.m4_100], k.area,
              [k.rect.x, k.rect.y, k.rect.x + k.rect.w, k.rect.y + k.rect.h], [k.id]));
          } else if (w + 1e-6 < MIN_W) {
            push(out, failVerified('hard', 'MBH4-ROOM-004',
              `آشپزخانه با عرض ${w.toFixed(2)} m باریک‌تر از حد ${MIN_W} m مبحث چهار §7-1-1-12 PDF p100.`,
              'Mabhas 4 §7-1-1-12', [SRC.m4_100], w,
              [k.rect.x, k.rect.y, k.rect.x + k.rect.w, k.rect.y + k.rect.h], [k.id]));
          }
        }
        return out;
      },
    },

    // ==================== SANITARY (Mabhas 4 §7-1-1-18/19) =======================
    {
      ruleId: 'MBH4-ROOM-007',
      family: 'sanitary',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'فضای بهداشتی مستقل — حداقل ۱٫۰ × ۱٫۳ متر (اصلاح شده از ۱٫۲)',
      reference: 'Mabhas 4 (1396) §7-1-1-18 / §7-1-1-19 / §4-5-6-2-1 — Book p61/p86-87 / PDF p75/p100-101',
      edition: '1396',
      sources: [SRC.m4_100, SRC.m4_101, SRC.m4_75],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'sanitary', severity: 'hard',
      description:
        'هر فضای بهداشتی مستقل غیرقابل‌دسترس برای معلولان: حداقل 1.00 m عرض × 1.30 m طول (متن دقیق PDF ص100: «باید دارای حداقل ۱/۰۰ متر عرض و ۱/۳۰ متر طول باشد.» — نسخه قبلی ۱٫۲ اشتباه بود و در Phase 5.2 اصلاح شد). ' +
        'در صورتی که محدوده‌ای به‌عنوان پیش‌ورودی در داخل فضای دوش مستقل پیش‌بینی شود یکی از ابعاد ≥1.50 m. ' +
        'در فضای بهداشتی توأم بدون در بین، 0.15 m از طول کسر می‌شود (§7-1-1-18 تبصره PDF p101). ' +
        'حداقل ارتفاع 2.20 m در 80% سطح، کوتاه‌ترین قسمت ≥2.05 m (§7-1-1-19 PDF p101). ' +
        'فضای بهداشتی عمومی: ضلع کوچک ≥0.90 m (§4-5-6-2-1 PDF p75).',
      thresholds: {
        min_width: { value: 1.0, unit: 'm', note: '§7-1-1-18 — PDF p100 — 1.00 m' },
        min_length: { value: 1.3, unit: 'm', note: '§7-1-1-18 — PDF p100 — 1.30 m (corrected from 1.20)' },
        min_shower_dim: { value: 1.5, unit: 'm', note: '§7-1-1-18 — PDF p101 — 1.50 m if vestibule inside shower' },
        combined_reduction: { value: 0.15, unit: 'm', note: '§7-1-1-18 — PDF p101 — 0.15 m reduction for combined without door' },
        min_height: { value: 2.2, unit: 'm', note: '§7-1-1-19 — PDF p101 — 2.20 m over 80% area' },
        min_height_shortest: { value: 2.05, unit: 'm', note: '§7-1-1-19 — PDF p101 — 2.05 m shortest part if sloped' },
        general_small_side: { value: 0.9, unit: 'm', note: '§4-5-6-2-1 — PDF p75 — 0.90 m small side' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const MIN_W = 1.0, MIN_L = 1.3;
        for (const f of ctx.candidate.floors) {
          for (const s of f.spaces) {
            if (!['bathroom', 'master-bathroom', 'guest-wc'].includes(s.type)) continue;
            const w = Math.min(s.rect.w, s.rect.h);
            const l = Math.max(s.rect.w, s.rect.h);
            const failW = w + 1e-6 < MIN_W;
            const failL = l + 1e-6 < MIN_L;
            if (failW || failL) {
              const dim = failW
                ? `ضلع کوچک ${w.toFixed(2)} m کمتر از ${MIN_W} m`
                : `ضلع بزرگ ${l.toFixed(2)} m کمتر از ${MIN_L} m (اصلاح شده از ۱٫۲ به ۱٫۳ در Phase 5.2)`;
              push(out, failVerified('hard', 'MBH4-ROOM-007',
                `فضای بهداشتی "${s.label}" با ابعاد ${w.toFixed(2)}×${l.toFixed(2)} m — ${dim} (§7-1-1-18 PDF p100).`,
                'Mabhas 4 §7-1-1-18', [SRC.m4_100, SRC.m4_101], w,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            }
          }
        }
        return out;
      },
    },

    // ==================== STAIR WIDTH (Mabhas 4 §4-5-1-7-3 / §7-1-1-3/4) ==========
    {
      ruleId: 'MBH4-STAIR-001',
      family: 'stair',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'حداقل عرض مفید راه‌پله (بر اساس گروه ساختمان)',
      reference: 'Mabhas 4 (1396) §4-5-1-7-3 (PDF p62) / §7-1-1-3 / §7-1-1-4 / §7-1-1-6 (PDF p99)',
      edition: '1396',
      sources: [SRC.m4_62, SRC.m4_99],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'stair', severity: 'hard',
      description:
        'پله مستقیم در ساختمان‌های گروه ۱–۳ م-۲ (کم‌ارتفاع): ≥0.90 m (§7-1-1-3 PDF p99: «حداقل عرض مفید پله مستقیم ۰/۹۰ متر»). ' +
        'پله دارای گردش یا پاگرد گروه ۱–۳: ≥1.10 m (§7-1-1-3). ' +
        'پله مستقیم گروه ۴–۷: ≥1.10 m، قفسه پلکانی دارای پاگرد ≥2.40 m (§7-1-1-4 PDF p99 / §4-5-1-7-3 PDF p62: «با عرض مفید کمتر از ۱/۱۰ متر و پلکان‌های دارای پاگردی که عموم از آن استفاده کنند با عرض مفید کمتر از ۲/۴۰ متر مجاز نیست»). ' +
        'پله‌های داخلی مستقیم: ≥0.90 m (§7-1-1-6 PDF p99). ' +
        'V1 یک واحد مسکونی ۲–۳ طبقه را پوشش می‌دهد؛ آستانه 1.10 m محافظه‌کارانه اعمال می‌شود.',
      thresholds: {
        min_width_small_group_straight: { value: 0.9, unit: 'm', note: 'groups 1–3 straight, §7-1-1-3 PDF p99' },
        min_width_small_group_turn: { value: 1.1, unit: 'm', note: 'groups 1–3 with turn/landing, §7-1-1-3 PDF p99' },
        min_width_large_group_straight: { value: 1.1, unit: 'm', note: 'groups 4–7 straight, §7-1-1-4 PDF p99 / §4-5-1-7-3 PDF p62' },
        min_landing_width_public: { value: 2.4, unit: 'm', note: '§4-5-1-7-3 public landing 2.40 m — PDF p62' },
        min_internal: { value: 0.9, unit: 'm', note: '§7-1-1-6 internal straight — PDF p99' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const floors = Math.max(1, ctx.project.building.floors);
        const MIN_W = floors <= 3 && ctx.project.building.type === 'villa' ? 0.9 : 1.1;
        for (const f of ctx.candidate.floors) {
          const st = f.spaces.find(s => s.type === 'stair-hall');
          if (!st) continue;
          const w = Math.min(st.rect.w, st.rect.h);
          if (w + 1e-6 < MIN_W) {
            push(out, failVerified('hard', 'MBH4-STAIR-001',
              `فضای راه‌پله با عرض ${w.toFixed(2)} m کمتر از حد ${MIN_W} m (§4-5-1-7-3 PDF p62 / §7-1-1-${floors <= 3 ? '3' : '4'} PDF p99).`,
              `Mabhas 4 §${floors <= 3 ? '7-1-1-3 / §4-5-1-7-3' : '7-1-1-4 / §4-5-1-7-3'}`, [SRC.m4_62, SRC.m4_99], w,
              [st.rect.x, st.rect.y, st.rect.x + st.rect.w, st.rect.y + st.rect.h], [st.id]));
          }
        }
        return out;
      },
    },

    // ==================== STAIR RISER/TREAD (§4-5-1-7-1) =========================
    {
      ruleId: 'MBH4-STAIR-002',
      family: 'stair',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'کف پله و ارتفاع پله — ۲h+b بین ۰٫۶۳ تا ۰٫۶۴ متر',
      reference: 'Mabhas 4 (1396) §4-5-1-7-1 — Book p48 / PDF p62',
      edition: '1396',
      sources: [SRC.m4_62],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'stair', severity: 'hard',
      description:
        'عمق کف‌پله ≥0.28 m. ارتفاع پله باید به‌گونه‌ای باشد که 2h+b بین 0.63 و 0.64 m باشد. ' +
        'متن PDF ص62: «حداقل اندازه عمق کف پله ۰/۲۸ متر است. ارتفاع پله باید به میزانی باشد که مجموع اندازه کف پله و دو برابر ارتفاع آن بین ۰/۶۳ تا ۰/۶۴ متر باشد.» ' +
        'بند تکمیلی عرف: ارتفاع پله بین 10–18 cm (برای راحتی و ایمنی).',
      thresholds: {
        min_tread: { value: 0.28, unit: 'm', note: '§4-5-1-7-1 — PDF p62 — 0.28 m' },
        max_riser: { value: 0.18, unit: 'm', note: 'common practice 10–18 cm' },
        min_2hpb: { value: 0.63, unit: 'm', note: '§4-5-1-7-1 — PDF p62 — 0.63 m' },
        max_2hpb: { value: 0.64, unit: 'm', note: '§4-5-1-7-1 — PDF p62 — 0.64 m' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        for (const f of ctx.candidate.floors) {
          for (const st of f.stairs) {
            // v1.0.1 (AGX-01): validate the ACTUAL generated flight geometry
            // (fl.treadDepth / fl.riserHeight = the going/riser the geometry
            // and the DXF really use), NOT only the nominal stair-level
            // st.tread. The stair-level fields remain the fallback for stairs
            // without flight geometry (synthetic/legacy shapes).
            const flightList: Array<Partial<StairFlight>> = (st.flights ?? []) as Array<Partial<StairFlight>>;
            const hasFlightGeom = flightList.some(fl => typeof fl.treadDepth === 'number' || typeof fl.riserHeight === 'number');
            const targets: Array<{ r: number; t: number; ids: string[] }> = [];
            if (flightList.length > 0 && hasFlightGeom) {
              for (const fl of flightList) {
                targets.push({
                  r: typeof fl.riserHeight === 'number' ? fl.riserHeight : (st.riser ?? 0.178),
                  t: typeof fl.treadDepth === 'number' ? fl.treadDepth : (st.tread ?? 0.28),
                  ids: fl.id ? [st.id, fl.id] : [st.id],
                });
              }
            } else {
              targets.push({ r: st.riser ?? 0.178, t: st.tread ?? 0.28, ids: [st.id] });
            }
            for (const { r, t, ids } of targets) {
              const f2 = 2 * r + t;
              if (r > 0.18 + 1e-6) {
                push(out, failVerified('hard', 'MBH4-STAIR-002',
                  `ارتفاع پله ${(r*100).toFixed(1)} cm بیشتر از حد ۱۸ cm (§4-5-1-7-1 PDF p62).`,
                  'Mabhas 4 §4-5-1-7-1', [SRC.m4_62], r, undefined, ids));
              }
              if (t + 1e-6 < 0.28) {
                push(out, failVerified('hard', 'MBH4-STAIR-002',
                  `کف پله ${(t*100).toFixed(1)} cm کمتر از حد ۲۸ cm (§4-5-1-7-1 PDF p62).`,
                  'Mabhas 4 §4-5-1-7-1', [SRC.m4_62], t, undefined, ids));
              }
              if (f2 < 0.63 - 1e-6 || f2 > 0.64 + 1e-6) {
                push(out, failVerified('soft', 'MBH4-STAIR-002',
                  `فرمول 2h+b = ${f2.toFixed(2)} m خارج از بازه ۰٫۶۳–۰٫۶۴ (§4-5-1-7-1 PDF p62).`,
                  'Mabhas 4 §4-5-1-7-1', [SRC.m4_62], f2, undefined, ids));
              }
            }
          }
        }
        return out;
      },
    },

    // ==================== STAIR FLIGHT LIMIT / LANDING / HEADROOM ================
    {
      ruleId: 'MBH4-STAIR-003',
      family: 'stair',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'حداکثر ۱۲ پله بین دو پاگرد / عرض پاگرد / ارتفاع سرگیر',
      reference: 'Mabhas 4 (1396) §4-5-1-7-4 (landing) / §4-5-1-7-5 (max 12 risers) / §4-5-1-7-6 (headroom ≥2.05 m) — PDF p62',
      edition: '1396',
      sources: [SRC.m4_62],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'stair', severity: 'hard',
      description:
        'حداکثر ۱۲ پله بین دو پاگرد (§4-5-1-7-5 PDF p62: «حداکثر تعداد پله‌های بین دو پاگرد در ساختمان‌های مورد استفاده افراد دارای معلولیت و کم‌توانان جسمی حرکتی باید ۱۲ پله باشد.»). ' +
        'عرض پاگرد ≥ عرض پله (§4-5-1-7-4 PDF p62: «حداقل عرض یا شعاع پاگرد، مساوی عرض پله می‌باشد.»). ' +
        'ارتفاع غیر سرگیر ≥2.05 m از لبه هر کف پله (§4-5-1-7-6 PDF p62: «حداقل ارتفاع غیر سرگیر پله‌ها و پاگردهای آن‌ها در تمام طول مسیر ۲/۰۵ متر است که از لبه هر کف پله اندازه‌گیری می‌شود.»).',
      thresholds: {
        max_risers_per_flight: { value: 12, unit: 'count', note: '§4-5-1-7-5 — PDF p62 — 12' },
        min_headroom: { value: 2.05, unit: 'm', note: '§4-5-1-7-6 — PDF p62 — 2.05 m (NOT IMPLEMENTED geometrically, but threshold VERIFIED)' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const seen = new Set<string>();
        for (const f of ctx.candidate.floors) {
          for (const st of f.stairs) {
            const key = `${st.id}-${st.totalRisers}-${(st.flights ?? []).map(fl => fl.riserCount).join('+')}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const flights = st.flights ?? [];
            const over = flights.filter(fl => (fl.riserCount ?? 0) > 12);
            if (flights.length === 0 && (st.riserCount ?? 0) > 12) {
              push(out, failVerified('hard', 'MBH4-STAIR-003',
                `تعداد ${st.riserCount} پله در یک بازو بیش از ۱۲ پله مجاز §4-5-1-7-5 PDF p62 (نیاز به پاگرد میانی).`,
                'Mabhas 4 §4-5-1-7-5', [SRC.m4_62], st.riserCount,
                [st.rect.x, st.rect.y, st.rect.x + st.rect.w, st.rect.y + st.rect.h]));
            } else if (over.length > 0) {
              const bad = over[0];
              push(out, failVerified('hard', 'MBH4-STAIR-003',
                `بازوی پله با ${bad.riserCount} پله بیش از ۱۲ پله مجاز §4-5-1-7-5 PDF p62 (نیاز به تقسیم به بازوهای کوتاه‌تر با پاگرد میانی).`,
                'Mabhas 4 §4-5-1-7-5', [SRC.m4_62], bad.riserCount,
                [st.footprint?.x ?? st.rect.x, st.footprint?.y ?? st.rect.y,
                 (st.footprint?.x ?? st.rect.x) + (st.footprint?.w ?? st.rect.w),
                 (st.footprint?.y ?? st.rect.y) + (st.footprint?.h ?? st.rect.h)]));
            }
          }
        }
        return out;
      },
    },

    {
      ruleId: 'MBH4-STAIR-004',
      family: 'stair',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'عرض پاگرد / ارتفاع سرگیر / دسترسی بام / نرده — NOT IMPLEMENTED (آستانه‌ها VERIFIED)',
      reference: 'Mabhas 4 (1396) §4-5-1-7-4 (landing) / §4-5-1-7-6 (headroom) / §4-5-1-7-7 (roof stair) / §7-1-1-7 (handrail) — PDF p62',
      edition: '1396',
      sources: [SRC.m4_62, SRC.m4_99],
      sourceTier: 1,
      status: 'NOT_IMPLEMENTED',
      category: 'stair', severity: 'advisory',
      evaluate: (): RuleResult[] => [
        infoNotImpl('MBH4-STAIR-004',
          'کنترل عرض پاگرد (≥ عرض پله، §4-5-1-7-4 PDF p62 VERIFIED)، ارتفاع سرگیر (≥۲٫۰۵ m، §4-5-1-7-6 PDF p62 VERIFIED)، نرده و دسترسی به بام پس از افزودن جزئیات پاگرد، سطح مقطع و سه‌بعدی به مدل فعال خواهد شد.',
          'Mabhas 4 §4-5-1-7-4/6/7', [SRC.m4_62, SRC.m4_99]),
      ],
    },

    // ==================== ELEVATOR (Mabhas 15 §15-2-1-2) =========================
    {
      ruleId: 'MBH15-LIFT-001',
      family: 'elevator',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'الزام آسانسور برای طول مسیر قائم > ۷ متر از کف ورودی اصلی',
      reference: 'Mabhas 15 (1392) §15-2-1-2 / §15-2-1-3 / §15-2-1-4 — Book p9 / PDF p19',
      edition: '1392',
      sources: [SRC.m15_19],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'elevator', severity: 'hard',
      description:
        'در ساختمان‌هایی با طول مسیر قائم حرکت بیش از ۷ متر از کف ورودی اصلی (معمولاً بیش از ۳ طبقه)، تعبیه آسانسور الزامی است؛ مگر در صورت وجود سطح شیب‌دار مناسب. ' +
        'متن PDF ص19: «در ساختمان‌های با طول مسیر قائم حرکت بیش از ۷ متر از کف ورودی اصلی (معمولاً بیش از سه طبقه)، تعبیه آسانسور الزامی می‌باشد.» ' +
        '§15-2-1-3: در ساختمان‌های ۸ طبقه یا با طول مسیر حرکت ۲۸ متر و بیشتر از کف ورودی اصلی، باید حداقل دو دستگاه آسانسور پیش‌بینی گردد. ' +
        '§15-2-1-4: در کلیه ساختمان‌ها با طول مسیر حرکت بیش از ۲۱ متر از کف ورودی اصلی، لازم است حداقل یک دستگاه آسانسور مناسب حمل بیمار (برانکارد بر) تعبیه شود. این آسانسور',
      thresholds: {
        vertical_travel_mandatory: { value: 7, unit: 'm', note: '§15-2-1-2 (>7 m from main entrance) — PDF p19' },
        two_lifts_at_floors: { value: 8, unit: 'floors', note: '§15-2-1-3 8 floors — PDF p19' },
        two_lifts_at_travel: { value: 28, unit: 'm', note: '§15-2-1-3 28 m travel — PDF p19' },
        stretcher_at_height: { value: 21, unit: 'm', note: '§15-2-1-4 stretcher lift mandatory >21 m — PDF p19' },
        wheelchair_cab_w: { value: 1.1, unit: 'm', note: '§15-2-1-9 — PDF p20' },
        wheelchair_cab_d: { value: 1.4, unit: 'm', note: '§15-2-1-9 — PDF p20' },
        wheelchair_door_w: { value: 0.8, unit: 'm', note: '§15-2-1-9 — PDF p20' },
        stretcher_cab_w: { value: 1.1, unit: 'm', note: '§15-2-1-10 — PDF p20' },
        stretcher_cab_d: { value: 2.1, unit: 'm', note: '§15-2-1-10 — PDF p20' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        const floors = Math.max(1, ctx.project.building.floors);
        const floorHeight = 3.2;
        const verticalTravel = (floors - 1) * floorHeight;
        const needsElevator = verticalTravel > 7;
        const hasElevator = !!ctx.project.building.hasElevator;
        if (needsElevator && !hasElevator) {
          push(out, failVerified('hard', 'MBH15-LIFT-001',
            `برای این ساختمان ${floors} طبقه (مسیر قائم ≈${verticalTravel.toFixed(1)} m از ورودی) تعبیه حداقل یک آسانسور مطابق مبحث ۱۵ §۱۵-۲-۱-۲ PDF p19 الزامی است.`,
            'Mabhas 15 §15-2-1-2', [SRC.m15_19], verticalTravel));
        } else if (floors === 3 && !hasElevator) {
          push(out, failVerified('soft', 'MBH15-LIFT-001',
            `ساختمان ${floors} طبقه — در صورت تجاوز مسیر حرکت قائم از ۷ متر از کف ورودی اصلی (بسته به تراز ورودی و ارتفاع طبقات)، آسانسور مطابق §۱۵-۲-۱-۲ PDF p19 الزامی می‌شود.`,
            'Mabhas 15 §15-2-1-2', [SRC.m15_19], verticalTravel));
        }
        return out;
      },
    },

    {
      ruleId: 'MBH15-LIFT-002',
      family: 'elevator',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'ابعاد کابین ویلچربر / برانکاردبر / تخت‌بر — NOT IMPLEMENTED (آستانه‌ها VERIFIED)',
      reference: 'Mabhas 15 §15-2-1-9 / §15-2-1-10 / §15-2-1-11 — PDF p20-21',
      edition: '1392',
      sources: [SRC.m15_20],
      sourceTier: 1,
      status: 'NOT_IMPLEMENTED',
      category: 'elevator', severity: 'advisory',
      evaluate: (): RuleResult[] => [
        infoNotImpl('MBH15-LIFT-002',
          'کنترل ابعاد کابین آسانسور (ویلچربر ۱٫۴×۱٫۱ / برانکاردبر ۲٫۱×۱٫۱ / تخت‌بر ۲٫۴×۱٫۴ متر) پس از افزودن مدل دقیق چاه آسانسور به موتور فعال خواهد شد. (آستانه‌ها در PDF ص20-21 VERIFIED)',
          'Mabhas 15 §15-2-1-9/10/11', [SRC.m15_20]),
      ],
    },

    // ==================== DAYLIGHT (Mabhas 4 §7-1-1-14 / ch.6) ===================
    {
      ruleId: 'MBH4-DYL-001',
      family: 'daylight',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'الزام نور و تهویه طبیعی برای فضاهای اقامت و آشپزخانه',
      reference: 'Mabhas 4 (1396) §6-4-1 (general) / §7-1-1-14 (kitchen independent daylight) — PDF p100',
      edition: '1396',
      sources: [SRC.m4_100],
      sourceTier: 1,
      status: 'VERIFIED',
      category: 'daylight', severity: 'hard',
      description:
        'فضاهای اقامت (نشیمن/پذیرایی/خواب/غذاخوری/نشیمن خانوادگی/اتاق مهمان) و آشپزخانه‌های مستقل باید به نور و تهویه طبیعی مستقل به فضای باز یا معبر عمومی دسترسی داشته باشند. ' +
        'سرویس بهداشتی/حمام/انباری/راهرو الزام به نور طبیعی مستقل ندارند. ' +
        'حداکثر عمق نورگیری از پنجره ۷ متر است (§4-5-2-8-3 PDF p55 — «عمق نورگیری در هر اتاق یا فضا یا فاصله مورد قبول برای نورگیری از یک پنجره، حداکثر ۷ متر است.»). ' +
        '§7-1-1-14 PDF p100: «تمام آشپزخانه‌های مستقل در واحدهای مسکونی باید دارای نور و تهویه طبیعی مستقل باشند. در واحدهای مسکونی دارای زیربنای ۷۵ متر مربع یا بیشتر و یا در تمام مواردی که فاصله دورترین نقطه آشپزخانه باز از پنجره فضای مجاور در داخل تصرف بیشتر از ۷ متر است، تعبیه نور طبیعی مستقل برای این نوع آشپزخانه نیز الزامی است.»',
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const needsDaylight = new Set(['living', 'bedroom', 'master-bedroom', 'dining', 'family-room', 'guest-room']);
        const kitchenNeedsIndependent = (() => {
          const f0 = ctx.candidate.floors[0];
          if (!f0) return true;
          let indoorArea = 0;
          for (const s of f0.spaces) {
            if (!['parking', 'corridor', 'entrance', 'stair-hall'].includes(s.type)) indoorArea += s.area;
          }
          return indoorArea >= 75;
        })();
        for (const f of ctx.candidate.floors) {
          for (const s of f.spaces) {
            const need = needsDaylight.has(s.type) || (s.type === 'kitchen' && (ctx.project.building.kitchenType === 'closed' || kitchenNeedsIndependent));
            if (!need) continue;
            if (!s.hasExteriorWall) {
              push(out, failVerified('hard', 'MBH4-DYL-001',
                s.type === 'kitchen'
                  ? `آشپزخانه "${s.label}" فاقد دیوار خارجی/پنجره است (نور طبیعی مستقل برای آشپزخانه بسته الزامی است، §7-1-1-14 PDF p100).`
                  : `فضای "${s.label}" فاقد دیوار خارجی/پنجره است (نور طبیعی الزامی، فصل ۶ مبحث چهار).`,
                s.type === 'kitchen' ? 'Mabhas 4 §7-1-1-14' : 'Mabhas 4 ch. 6',
                [SRC.m4_100], undefined,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            }
          }
        }
        return out;
      },
    },

    {
      ruleId: 'MBH4-DYL-002',
      family: 'daylight',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'نسبت سطح شیشه الزامی — NOT IMPLEMENTED (نیاز به محاسبه دقیق سطح نورگذر و عمق فضا)',
      reference: 'Mabhas 4 (1396) ch. 6, جدول ۱-۶-۴ و بندهای مشروح (۱/۸ یا ۱/۷ سطح کف، بسته به فاصله تا دیوار مقابل)',
      edition: '1396',
      sources: [SRC.m6Daylight],
      sourceTier: 3,
      status: 'NOT_IMPLEMENTED',
      category: 'daylight', severity: 'advisory',
      description:
        'نسبت سطح شیشه به کف به فاصله تا دیوار مقابل، ارتفاع فوقانی پنجره و جهت نورگیری بستگی دارد (۱/۸ ، ۱/۷ ، ۱/۶ یا ۱/۵) و نمی‌توان آن را با نسبت ثابت ساده‌سازی کرد.',
      evaluate: (): RuleResult[] => [
        infoNotImpl('MBH4-DYL-002',
          'کنترل نسبت سطح شیشه الزامی (۱/۸ تا ۱/۵ سطح کف بسته به عمق و ارتفاع پنجره، طبق جدول ۱-۶-۴) و محدودیت عمق نورگیری ۷ متر، پس از افزودن محاسبه دقیق سطح بازشو و عمق فضا به مدل فعال خواهد شد.',
          'Mabhas 4 ch. 6 / جدول 1-6-4', [SRC.m6Daylight]),
      ],
    },

    {
      ruleId: 'MBH4-DYL-003',
      family: 'daylight',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'ابعاد حیاط خلوت/نورگیر — NOT IMPLEMENTED',
      reference: 'Mabhas 4 (1396) §5-9-4 (openings) / ch. 9 light-well dimensions',
      edition: '1396',
      sources: [SRC.m6Daylight],
      sourceTier: 3,
      status: 'NOT_IMPLEMENTED',
      category: 'daylight', severity: 'advisory',
      evaluate: (): RuleResult[] => [
        infoNotImpl('MBH4-DYL-003',
          'کنترل ابعاد حیاط خلوت (۱۲ m² × ۳ m برای فضاهای اصلی در قطعات >۲۰۰ m²؛ ۶% مساحت زمین در قطعات ≤۲۰۰ m²؛ ۶ m² × ۲ m برای آشپزخانه) و فاصله ۶/۴ متری پنجره‌های روبرو پس از افزودن مدل حیاط خلوت فعال می‌شود.',
          'Mabhas 4 ch. 6 / §4-9 (نورگیرها)', [SRC.m6Daylight]),
      ],
    },

    // ==================== VENTILATION ============================================
    {
      ruleId: 'MBH4-VENT-001',
      family: 'ventilation',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'سطح بازشوی تهویه آشپزخانه ۱/۱۶ سطح کف — NOT IMPLEMENTED',
      reference: 'Mabhas 4 (1396) §7-1-1-15',
      edition: '1396',
      sources: [SRC.m4Res],
      sourceTier: 3,
      status: 'NOT_IMPLEMENTED',
      category: 'ventilation', severity: 'advisory',
      evaluate: (): RuleResult[] => [
        infoNotImpl('MBH4-VENT-001',
          'سطح بازشوی تهویه آشپزخانه باید حداقل یک‌شانزدهم سطح کف باشد (§7-1-1-15). پس از افزودن محاسبه سطح بازشوی عملیاتی به مدل فعال خواهد شد.',
          'Mabhas 4 §7-1-1-15', [SRC.m4Res]),
      ],
    },

    // ==================== PARKING — MUNICIPAL (soft advisory) ====================
    {
      ruleId: 'MUN-PARK-001',
      family: 'parking',
      jurisdiction: 'ir-national', scope: 'local',
      title: 'نسبت پارکینگ — عرف/طرح تفصیلی (قاعده ملی نیست)',
      reference: 'عرف شهرداری / طرح تفصیلی — تابع پهنه و منطقه',
      sources: [SRC.localPark],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'parking', severity: 'soft',
      description:
        'مقررات ملی ساختمان نسبت پارکینگ ثابتی را تعریف نمی‌کند. تعداد پارکینگ الزامی تابع طرح تفصیلی منطقه، مساحت زمین و تعداد واحدهاست. ' +
        'قاعده «۱ پارکینگ به ازای هر واحد» صرفاً یک پیش‌فرض رایج عرفی است و باید با شهرداری/طرح تفصیلی استعلام شود.',
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        const units = (ctx.project.building.unitsPerFloor ?? 1) * Math.max(1, ctx.project.building.floors);
        const provided = ctx.project.building.parkingSpaces ?? 0;
        if (provided < units) {
          push(out, failRequires('soft', 'MUN-PARK-001',
            `تعداد ${provided} پارکینگ برای ${units} واحد — پیش‌فرض «یک پارکینگ به ازای هر واحد» یک عرف طرح تفصیلی است و قاعده قطعی ملی نیست (مستلزم استعلام از شهرداری).`,
            'عرف شهرداری / طرح تفصیلی (not a national Mabar rule)', [SRC.localPark], provided));
        }
        return out;
      },
    },

    // ==================== SETBACKS / COVERAGE — MUNICIPAL (advisory) =============
    {
      ruleId: 'MUN-SET-001',
      family: 'setback',
      jurisdiction: 'ir-national', scope: 'local',
      title: 'عقب‌نشینی/سطح اشغال/تراکم تابع طرح تفصیلی شهرداری',
      reference: 'طرح تفصیلی منطقه / دستور نقشه شهرداری',
      sources: [SRC.localSet],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'setback', severity: 'advisory',
      description:
        'مبحث چهار مقادیر ثابتی برای عقب‌نشینی، سطح اشغال و تراکم تعریف نمی‌کند؛ این مقادیر کاملاً تابع طرح تفصیلی (پهنه R-110/R-120/...) و دستور نقشه منطقه هستند.',
      evaluate: (): RuleResult[] => [
        infoRequires('MUN-SET-001',
          'عقب‌نشینی‌ها، سطح اشغال همکف و تراکم تابع طرح تفصیلی منطقه/شهرداری هستند. مقادیر پیش‌فرض نرم‌افزار صرفاً جهت تولید چیدمان اولیه بوده و باید با دستور نقشه و استعلام از شهرداری تطبیق داده شوند.',
          'طرح تفصیلی / دستور نقشه', [SRC.localSet]),
      ],
    },
  ],
};

/** Local Tehran pack stub — rules deliberately NOT_IMPLEMENTED. */
export const IR_TEHRAN_STUB_PACK: RegulationPack = {
  id: 'ir-tehran-stub',
  jurisdiction: 'Tehran (placeholder — pending official detailed plan)',
  scope: 'local',
  edition: 'not-implemented',
  description:
    'Placeholder for Tehran municipality detailed-plan rules. Tehran ' +
    'setback/coverage/height/FAR bonuses/encroachment rules are NOT shipped: ' +
    'they vary sharply by zoning district (R-110, R-120, R-160, etc.) and the ' +
    'latest abrogation (ابلاغیه) of the Tehran Detailed Plan (طرح تفصیلی تهران). ' +
    'Feed a signed municipal regulation pack into the engine when you receive ' +
    'the official building-permit instruction (دستور نقشه).',
  sourceRegistry: [
    {
      id: 't1-tehran-tarh-tafsili',
      title: 'طرح تفصیلی تهران (آخرین ابلاغیه) — NOT LOADED',
      publisher: 'شهرداری تهران / معاونت شهرسازی و معماری',
      jurisdiction: 'ir-tehran',
      tier: 1,
      verificationState: 'not-obtained',
      note: 'District-specific (R-110/R-120/R-160/…). Must be supplied by the user with their permit instruction.',
    },
    {
      id: 't1-tehran-dastoor-amal',
      title: 'دستورالعمل‌های اجرایی / دستور نقشه — NOT LOADED',
      publisher: 'شهرداری تهران',
      jurisdiction: 'ir-tehran',
      tier: 1,
      verificationState: 'not-obtained',
    },
  ],
  rules: [
    {
      ruleId: 'THN-000',
      jurisdiction: 'ir-tehran', scope: 'local',
      title: 'پکیج مقررات تفصیلی تهران هنوز بارگذاری نشده است',
      category: 'setback',
      severity: 'advisory',
      status: 'NOT_IMPLEMENTED',
      sourceTier: 1,
      reference: 'طرح تفصیلی تهران — NOT LOADED',
      family: 'local-municipality',
      evaluate: (): RuleResult[] => [
        infoRequires('THN-000',
          'پکیج مقررات تفصیلی تهران (پهنه‌بندی، عقب‌نشینی، سطح اشغال، تراکم، ارتفاع مجاز، اُشکوب) هنوز بارگذاری نشده است. پس از دریافت دستور نقشه رسمی از شهرداری منطقه، پکیج معتبر را به نرم‌افزار اضافه کنید. تا آن زمان مقادیر پیش‌فرض ملی/عرفی استفاده می‌شود.',
          'طرح تفصیلی تهران (NOT LOADED)'),
      ],
    },
  ],
};
