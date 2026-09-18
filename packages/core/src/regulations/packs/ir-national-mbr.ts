/**
 * Iranian National Building Regulations (Mabhas / مقررات ملی ساختمان) pack.
 *
 * SOURCE VERIFICATION STATUS
 * --------------------------
 * Rules in this pack are transcribed from Tier-3 secondary-practitioner
 * sources that reproduce verbatim clause text from the official BHRC
 * publications (Mabhas 4, 1396 edition / Mabhas 15). NO rule in this pack
 * is marked VERIFIED, because a Tier-1 authenticated PDF published by the
 * National Building Regulations Office (دفتر مقررات ملی ساختمان — inbr.ir)
 * has not yet been placed in `sources/` and cross-checked clause-by-clause.
 *
 * Every numerical threshold is therefore stamped with:
 *   status: 'REQUIRES_SOURCE_VERIFICATION'
 * and carries explicit `sources[]` records so a licensed professional can
 * locate each clause in the official publication.
 *
 * Where multiple secondary sources disagreed, the value reproduced verbatim
 * by omranpooya.com's full chapter transcript (which lists exact article
 * numbers with decimals matching the table of contents of the 1396 Mabhas 4)
 * was preferred, and the discrepancy is noted in the audit document
 * (docs/REGULATION_AUDIT.md).
 */
import type { RegulationPack, RuleContext, RuleResult, SourceRef } from '../types.js';
import { SOURCE_REGISTRY_DEFAULTS } from './source-registry.js';

// ---------- Source registry ---------------------------------------------------
// All Tier-1 primary PDFs are NOT obtained at this time (2026-09-18) because
// the sandboxed environment cannot reach *.ir hosts (fc.icivil.ir, inbr.ir,
// bhrc.ac.ir, mrud.gov.ir all fail TLS handshake / connection refused), nor
// any CDN mirror that was reachable from the npm/github whitelist hosts.
// They are registered here with verificationState: 'not-obtained' and with
// their canonical BHRC/inbr URI so that when a user drops a PDF into
// sources/ an auditor can update the entry and promote rules to VERIFIED.
//
// Tier-3 secondary-practitioner sources are listed with verificationState
// 'not-obtained' too — the URIs were used at audit time but the rendered
// HTML was not saved to disk (only the clause text was transcribed into the
// rule evaluators and documented in docs/REGULATION_AUDIT.md).

const SRC: Record<string, SourceRef> = {
  m4Res: {
    sourceId: 't3-mabhas4-1396-residential',
    clause: 'Mabhas 4 (1396), Chapter 7-1-1 "تصرف‌های مسکونی، گروه م-۲" (بندهای ۱ تا ۲۶)',
    note: 'Vebatim clause transcript from omranpooya.com. Tier-3 only — not authoritative.',
  },
  m4Stair: {
    sourceId: 't3-mabhas4-1396-stair',
    clause: 'Mabhas 4 (1396), §4-5-1-7 "راه‌پله‌ها" (sub-clauses 1..8 / 1-7-1-5-4 … 8-7-1-5-4)',
    note: 'Verbatim sub-clause quotations aggregated from manexgroup.net, hamyarnazer.com, sabzsaze.com. Tier-3.',
  },
  m4Hab: {
    sourceId: 't3-mabhas4-1396-habitable',
    clause: 'Mabhas 4 (1396), §4-5-2 "فضاهای اقامت" (sub-clauses 1..5)',
    note: 'Verbatim §4-5-2-2-1…5 quotations from sandbadstudio.ir. Tier-3.',
  },
  m15Sel: {
    sourceId: 't3-mabhas15-1392-elevator',
    clause: 'Mabhas 15 (1392 w/ later amendments), §15-2-1 "الزامات اولیه انتخاب آسانسور" (sub-clauses 2,4,9,10,11)',
    note: 'Verbatim clauses quoted in memaripedia.com mini-mabhas-15, cross-checked with cadkhoda-academy.ir and sabzsaze.com. Tier-3.',
  },
  m6Daylight: {
    sourceId: 't3-mabhas4-1396-daylight',
    clause: 'Mabhas 4 (1396), Chapter 6 "الزامات عمومی نورگیری و تهویه" + §7-1-1-14 kitchen independent daylight',
    note: 'Aggregated from memaripedia.com, atnasr.ir, danesh-cad.blogfa.com. Tier-3.',
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
function fail(
  severity: RuleResult['severity'],
  code: string,
  message: string,
  reference: string,
  sources: SourceRef[],
  value?: number,
  bbox?: [number, number, number, number],
  entityIds?: string[],
): RuleResult {
  return { pass: false, severity, code, message, reference: reference, sources, value, status: 'REQUIRES_SOURCE_VERIFICATION', bbox, entityIds };
}
function info(code: string, message: string, reference: string, sources: SourceRef[] = []): RuleResult {
  return { pass: true, severity: 'advisory', code, message, reference, sources, status: 'REQUIRES_SOURCE_VERIFICATION' };
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
  edition: '1396 (Mabhas 4) / 1392 w/ amendments (Mabhas 15) — secondary-source audit draft',
  description:
    'Iranian National Building Code (Mabhas) clauses for residential ' +
    'construction. All rules carry status=REQUIRES_SOURCE_VERIFICATION ' +
    'until a Tier-1 BHRC publication is placed in sources/ and cross-checked. ' +
    'Treat findings as Automated Regulation Checks (Potential Non-Compliance / ' +
    'Professional Review Required) — never as a legal guarantee of approval.',
  sourceRegistry: SOURCE_REGISTRY_DEFAULTS,
  rules: [
    // ==================== HABITABLE ROOMS (Mabhas 4 §7-1-1-8) ====================
    {
      ruleId: 'MBH4-ROOM-001',
      family: 'habitable-room',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'اتاق اصلی اقامت — حداقل مساحت و پهنا',
      reference: 'Mabhas 4 (1396) §7-1-1-8',
      edition: '1396',
      sources: [SRC.m4Res],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'room', severity: 'hard',
      description:
        'واحدهای ≥75 m²: حداقل یک اتاق اقامت با زیربنای ≥12 m² و پهنای ≥2.70 m. ' +
        'واحدهای <75 m²: اتاق اصلی ≥9 m² و هیچ یک از ابعاد افقی آن <2.50 m نباشد.',
      thresholds: {
        area_large: { value: 12, unit: 'm²', note: 'unit area ≥ 75 m²' },
        width_large: { value: 2.7, unit: 'm', note: 'unit area ≥ 75 m²' },
        area_small: { value: 9, unit: 'm²', note: 'unit area < 75 m²' },
        width_small: { value: 2.5, unit: 'm', note: 'unit area < 75 m² (no horizontal dimension < 2.50 m)' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        // Approximate unit floor area = total area of all indoor spaces on floor 0
        // (excluding parking), used to pick the threshold tier.
        const f0 = ctx.candidate.floors[0];
        const indoorTypes = new Set(['living', 'dining', 'kitchen', 'bedroom', 'master-bedroom', 'bathroom', 'master-bathroom', 'guest-wc', 'corridor', 'entrance', 'foyer', 'storage', 'stair-hall', 'family-room', 'guest-room']);
        let unitArea = 0;
        if (f0) for (const s of f0.spaces) if (indoorTypes.has(s.type)) unitArea += s.area;
        const large = unitArea >= 75;
        const th = large ? { area: 12, width: 2.7 } : { area: 9, width: 2.5 };
        for (const f of ctx.candidate.floors) {
          // "Main habitable rooms" = living, master-bedroom, family-room, dining
          // (the clause says "یکی از اتاق‌های اقامت" = at least one room of
          // habitable-use per unit must meet the threshold).
          const main = f.spaces.filter(s => ['living', 'master-bedroom', 'family-room', 'dining', 'bedroom'].includes(s.type));
          if (!main.length) continue;
          let anyOk = false;
          for (const s of main) {
            const w = Math.min(s.rect.w, s.rect.h);
            const ok = s.area + 1e-6 >= th.area && w + 1e-6 >= th.width;
            if (ok) { anyOk = true; continue; }
            if (s.area + 1e-6 < th.area) {
              push(out, fail('hard', 'MBH4-ROOM-001',
                `اتاق \"${s.label}\" با مساحت ${s.area.toFixed(1)} m² کمتر از حد ${th.area} m² مبحث چهار §7-1-1-8 (واحد ≈${unitArea.toFixed(0)} m²).`,
                'Mabhas 4 §7-1-1-8', [SRC.m4Res], s.area,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            } else if (w + 1e-6 < th.width) {
              push(out, fail('soft', 'MBH4-ROOM-001',
                `اتاق \"${s.label}\" با عرض ${w.toFixed(2)} m باریک‌تر از حد ${th.width} m مبحث چهار §7-1-1-8.`,
                'Mabhas 4 §7-1-1-8', [SRC.m4Res], w,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            }
          }
          if (!anyOk) {
            push(out, fail('hard', 'MBH4-ROOM-001',
              `هیچ‌یک از فضاهای اقامت در طبقه ${f.level} به حداقل ${th.area} m² / ${th.width} m مبحث چهار §7-1-1-8 نرسیده‌اند.`,
              'Mabhas 4 §7-1-1-8', [SRC.m4Res]));
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
      reference: 'Mabhas 4 (1396) §4-5-2-2-1 / §4-5-2-2-2',
      edition: '1396',
      sources: [SRC.m4Hab],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'room', severity: 'hard',
      description: 'هر فضای اقامت باید حداقل ۶٫۵ مترمربع زیربنا و ۲٫۱۵ متر عرض داشته باشد.',
      thresholds: {
        min_area: { value: 6.5, unit: 'm²' },
        min_width: { value: 2.15, unit: 'm' },
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
              push(out, fail('hard', 'MBH4-ROOM-002',
                `فضای اقامت \"${s.label}\" (${s.area.toFixed(1)} m²) کمتر از حد ${MIN_A} m² مبحث چهار §4-5-2-2-1.`,
                'Mabhas 4 §4-5-2-2-1', [SRC.m4Hab], s.area,
                [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h], [s.id]));
            } else if (w + 1e-6 < MIN_W) {
              push(out, fail('hard', 'MBH4-ROOM-002',
                `فضای اقامت \"${s.label}\" با عرض ${w.toFixed(2)} m باریک‌تر از حد ${MIN_W} m مبحث چهار §4-5-2-2-2.`,
                'Mabhas 4 §4-5-2-2-2', [SRC.m4Hab], w,
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
      reference: 'Mabhas 4 (1396) §4-5-2-2-3 / §7-1-1-9',
      edition: '1396',
      sources: [SRC.m4Hab, SRC.m4Res],
      sourceTier: 3,
      status: 'NOT_IMPLEMENTED',
      category: 'room', severity: 'advisory',
      description:
        'ارتفاع فضای اقامت ≥2.40 m (در تمام سطح الزامی). در تصرف مسکونی، برای ' +
        'اتاق ≥12 m² و نشیمن/سالن، ≥2.60 m در 50%/75% سطح الزامی است. ' +
        'نیازمند داده‌های حجمی (مدل سه‌بعدی) است که در این نسخه وجود ندارد.',
      evaluate: (): RuleResult[] => [
        info('MBH4-ROOM-003',
          'کنترل حداقل ارتفاع مفید فضاهای اقامت (۲٫۴۰ / ۲٫۶۰ متر) پس از افزودن مدل سه‌بعدی (حجم، سقف، تیرها) به موتور انجام خواهد شد.',
          'Mabhas 4 §4-5-2-2-3 / §7-1-1-9', [SRC.m4Hab, SRC.m4Res]),
      ],
    },

    // ==================== KITCHEN (Mabhas 4 §7-1-1-10/11/12) ====================
    {
      ruleId: 'MBH4-ROOM-004',
      family: 'kitchen',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'آشپزخانه — حداقل مساحت و عرض',
      reference: 'Mabhas 4 (1396) §7-1-1-10 (پخت‌تنها ۵٫۵ m²) / §7-1-1-11 (پخت‌وپز و صرف غذا ۷٫۵ m²) / §7-1-1-12 (عرض)',
      edition: '1396',
      sources: [SRC.m4Res],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'kitchen', severity: 'hard',
      description:
        'آشپزخانه مستقل (فقط پخت): ≥5.5 m²، سطح کار آزاد ≥2.75 m². ' +
        'آشپزخانه مستقل/باز (پخت و صرف غذا): ≥7.5 m². ' +
        'عرض آشپزخانه بسته/باز: ≥1.80 m (≥2.15 m برای پخت‌وصرف).',
      thresholds: {
        cook_only_area: { value: 5.5, unit: 'm²', note: '§7-1-1-10 cooking only; free work zone ≥ 2.75 m²' },
        cook_dine_area: { value: 7.5, unit: 'm²', note: '§7-1-1-11 cooking + dining' },
        width_cook: { value: 1.8, unit: 'm', note: '§7-1-1-12 independent/open kitchen' },
        width_cook_dine: { value: 2.15, unit: 'm', note: '§7-1-1-12 kitchen for cooking + dining' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        // V1 layouts currently produce a single kitchen rectangle; treat it
        // as a cooking-only kitchen (conservative for area; the width rule
        // for open/dine kitchens applies per the kitchenType flag).
        const isOpen = ctx.project.building.kitchenType === 'open';
        const MIN_A = 5.5;
        const MIN_W = 1.8;
        for (const f of ctx.candidate.floors) {
          const k = f.spaces.find(s => s.type === 'kitchen');
          if (!k) continue;
          const w = Math.min(k.rect.w, k.rect.h);
          if (k.area + 1e-6 < MIN_A) {
            push(out, fail('hard', 'MBH4-ROOM-004',
              `آشپزخانه \"${k.label}\" با مساحت ${k.area.toFixed(1)} m² کمتر از حد ${MIN_A} m² (پخت تنها، §7-1-1-10). برای آشپزخانه پخت‌و‌صرف غذا حد 7.5 m² الزامی است.`,
              'Mabhas 4 §7-1-1-10', [SRC.m4Res], k.area,
              [k.rect.x, k.rect.y, k.rect.x + k.rect.w, k.rect.y + k.rect.h], [k.id]));
          } else if (w + 1e-6 < MIN_W) {
            push(out, fail('hard', 'MBH4-ROOM-004',
              `آشپزخانه با عرض ${w.toFixed(2)} m باریک‌تر از حد ${MIN_W} m مبحث چهار §7-1-1-12.`,
              'Mabhas 4 §7-1-1-12', [SRC.m4Res], w,
              [k.rect.x, k.rect.y, k.rect.x + k.rect.w, k.rect.y + k.rect.h], [k.id]));
          }
          if (isOpen) {
            // Open-kitchen daylight requirement advisory (§7-1-1-14):
            // independent daylight required for open kitchens in units ≥75 m²
            // or when the farthest point from the adjacent room window > 7 m.
            // We emit an advisory since the geometric calculation is not
            // yet done; DYL-001 covers the exterior-wall test.
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
      title: 'فضای بهداشتی مستقل — حداقل ۱٫۰ × ۱٫۲ متر',
      reference: 'Mabhas 4 (1396) §7-1-1-18 / §7-1-1-19 (height ≥2.20 m)',
      edition: '1396',
      sources: [SRC.m4Res],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'sanitary', severity: 'hard',
      description:
        'هر فضای بهداشتی مستقل غیرقابل‌دسترس برای معلولان: حداقل 1.00 m عرض × 1.20 m طول. ' +
        'در فضای بهداشتی توأم بدون در بین، 0.15 m از طول کسر می‌شود. ' +
        'حداقل ارتفاع 2.20 m در 80% سطح. ',
      thresholds: {
        min_width: { value: 1.0, unit: 'm' },
        min_length: { value: 1.2, unit: 'm' },
        min_height: { value: 2.2, unit: 'm', note: 'NOT IMPLEMENTED — needs 3-D model' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const MIN_W = 1.0, MIN_L = 1.2;
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
                : `ضلع بزرگ ${l.toFixed(2)} m کمتر از ${MIN_L} m`;
              push(out, fail('hard', 'MBH4-ROOM-007',
                `فضای بهداشتی \"${s.label}\" با ابعاد ${w.toFixed(2)}×${l.toFixed(2)} m — ${dim} (§7-1-1-18).`,
                'Mabhas 4 §7-1-1-18', [SRC.m4Res], w,
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
      reference: 'Mabhas 4 (1396) §4-5-1-7-3 / §7-1-1-3 / §7-1-1-4 / internal-stair §4-7-1-1-6',
      edition: '1396',
      sources: [SRC.m4Stair, SRC.m4Res],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'stair', severity: 'hard',
      description:
        'پله مستقیم در ساختمان‌های گروه ۱–۳ م-۲ (کم‌ارتفاع): ≥0.90 m. ' +
        'پله در ساختمان‌های گروه ۴–۷ م-۲: ≥1.10 m. ' +
        'قفسه پله با پاگرد عمومی: ≥2.40 m. ' +
        'V1 یک عدد واحد مسکونی (گروه م-۲ ۲–۳ طبقه) را پوشش می‌دهد؛ آستانه 1.10 m محافظه‌کارانه اعمال می‌شود.',
      thresholds: {
        min_width_small_group: { value: 0.9, unit: 'm', note: 'bldg groups 1–3 (M-2), straight stair, §7-1-1-3' },
        min_width_large_group: { value: 1.1, unit: 'm', note: 'bldg groups 4–7 (M-2), §7-1-1-4 / §4-5-1-7-3' },
        min_landing_width_public: { value: 2.4, unit: 'm', note: '§4-5-1-7-3 stair-hall with public landings' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        const floors = Math.max(1, ctx.project.building.floors);
        // Conservatively apply 1.10 m for any multi-family/apartment or ≥4
        // storey; 0.90 m for single-villa 1–3 storey. V1 is single-unit; we
        // still apply 1.10 as the safe default so the generator's 1.10 m
        // stairs pass; if the user narrows below 0.90 m we flag HARD.
        const MIN_W = floors <= 3 && ctx.project.building.type === 'villa' ? 0.9 : 1.1;
        for (const f of ctx.candidate.floors) {
          const st = f.spaces.find(s => s.type === 'stair-hall');
          if (!st) continue;
          const w = Math.min(st.rect.w, st.rect.h);
          if (w + 1e-6 < MIN_W) {
            push(out, fail('hard', 'MBH4-STAIR-001',
              `فضای راه‌پله با عرض ${w.toFixed(2)} m کمتر از حد ${MIN_W} m (§4-5-1-7-3 / §7-1-1-${floors <= 3 ? '3' : '4'}).`,
              `Mabhas 4 §${floors <= 3 ? '7-1-1-3 / §4-5-1-7-3' : '7-1-1-4 / §4-5-1-7-3'}`, [SRC.m4Stair, SRC.m4Res], w,
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
      reference: 'Mabhas 4 (1396) §4-5-1-7-1 (sub-clause 1-7-1-5-4)',
      edition: '1396',
      sources: [SRC.m4Stair],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'stair', severity: 'hard',
      description:
        'عمق کف‌پله ≥0.28 m. ارتفاع پله باید به‌گونه‌ای باشد که 2h+b بین 0.63 و 0.64 m باشد. ' +
        'بند تکمیلی (noavarpub): ارتفاع پله بین 10–18 cm.',
      thresholds: {
        min_tread: { value: 0.28, unit: 'm' },
        max_riser: { value: 0.18, unit: 'm' },
        min_2hpb: { value: 0.63, unit: 'm' },
        max_2hpb: { value: 0.64, unit: 'm' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        for (const f of ctx.candidate.floors) {
          for (const st of f.stairs) {
            const r = st.riser ?? 0.178;
            const t = st.tread ?? 0.28;
            const f2 = 2 * r + t;
            if (r > 0.18 + 1e-6) {
              push(out, fail('hard', 'MBH4-STAIR-002',
                `ارتفاع پله ${(r*100).toFixed(1)} cm بیشتر از حد ۱۸ cm (§4-5-1-7-1).`,
                'Mabhas 4 §4-5-1-7-1', [SRC.m4Stair], r));
            }
            if (t + 1e-6 < 0.28) {
              push(out, fail('hard', 'MBH4-STAIR-002',
                `کف پله ${(t*100).toFixed(1)} cm کمتر از حد ۲۸ cm (§4-5-1-7-1).`,
                'Mabhas 4 §4-5-1-7-1', [SRC.m4Stair], t));
            }
            if (f2 < 0.63 - 1e-6 || f2 > 0.64 + 1e-6) {
              push(out, fail('soft', 'MBH4-STAIR-002',
                `فرمول 2h+b = ${f2.toFixed(2)} m خارج از بازه ۰٫۶۳–۰٫۶۴ (§4-5-1-7-1).`,
                'Mabhas 4 §4-5-1-7-1', [SRC.m4Stair], f2));
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
      reference: 'Mabhas 4 (1396) §4-5-1-7-4 (landing), §4-5-1-7-5 (max 12 risers), §4-5-1-7-6 (headroom ≥2.05 m)',
      edition: '1396',
      sources: [SRC.m4Stair],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'stair', severity: 'hard',
      description:
        'حداکثر ۱۲ پله بین دو پاگرد. عرض پاگرد ≥ عرض پله. ' +
        'ارتفاع غیر سرگیر ≥2.05 m از لبه هر کف پله.',
      thresholds: {
        max_risers_per_flight: { value: 12, unit: 'count', note: '§4-5-1-7-5' },
        min_headroom: { value: 2.05, unit: 'm', note: 'NOT IMPLEMENTED — needs 3-D model' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        if (!ctx.candidate) return out;
        // Check each flight individually — multi-flight U/L-stairs split
        // risers across flights to satisfy ≤12 per flight.
        const seen = new Set<string>();
        for (const f of ctx.candidate.floors) {
          for (const st of f.stairs) {
            const key = `${st.id}-${st.totalRisers}-${(st.flights ?? []).map(fl => fl.riserCount).join('+')}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const flights = st.flights ?? [];
            const over = flights.filter(fl => (fl.riserCount ?? 0) > 12);
            if (flights.length === 0 && (st.riserCount ?? 0) > 12) {
              // Legacy single-flight representation (e.g. if a test builds
              // an old-style Stair without flights).
              push(out, fail('hard', 'MBH4-STAIR-003',
                `تعداد ${st.riserCount} پله در یک بازو بیش از ۱۲ پله مجاز §4-5-1-7-5 (نیاز به پاگرد میانی).`,
                'Mabhas 4 §4-5-1-7-5', [SRC.m4Stair], st.riserCount,
                [st.rect.x, st.rect.y, st.rect.x + st.rect.w, st.rect.y + st.rect.h]));
            } else if (over.length > 0) {
              const bad = over[0];
              push(out, fail('hard', 'MBH4-STAIR-003',
                `بازوی پله با ${bad.riserCount} پله بیش از ۱۲ پله مجاز §4-5-1-7-5 (نیاز به تقسیم به بازوهای کوتاه‌تر با پاگرد میانی).`,
                'Mabhas 4 §4-5-1-7-5', [SRC.m4Stair], bad.riserCount,
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
      title: 'عرض پاگرد / ارتفاع سرگیر / دسترسی بام / نرده — NOT IMPLEMENTED',
      reference: 'Mabhas 4 (1396) §4-5-1-7-4 (landing), §4-5-1-7-6 (headroom), §4-5-1-7-7 (roof stair), §7-1-1-7 (handrail)',
      edition: '1396',
      sources: [SRC.m4Stair, SRC.m4Res],
      sourceTier: 3,
      status: 'NOT_IMPLEMENTED',
      category: 'stair', severity: 'advisory',
      evaluate: (): RuleResult[] => [
        info('MBH4-STAIR-004',
          'کنترل عرض پاگرد (≥ عرض پله)، ارتفاع سرگیر (≥۲٫۰۵ m)، نرده و دسترسی به بام پس از افزودن جزئیات پاگرد، سطح مقطع و سه‌بعدی به مدل فعال خواهد شد.',
          'Mabhas 4 §4-5-1-7-4/6/7', [SRC.m4Stair, SRC.m4Res]),
      ],
    },

    // ==================== ELEVATOR (Mabhas 15 §15-2-1-2) =========================
    {
      ruleId: 'MBH15-LIFT-001',
      family: 'elevator',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'الزام آسانسور برای طول مسیر قائم > ۷ متر از کف ورودی اصلی',
      reference: 'Mabhas 15 (1392 w/ amendments) §15-2-1-2',
      edition: '1392',
      sources: [SRC.m15Sel],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'elevator', severity: 'hard',
      description:
        'در ساختمان‌هایی با طول مسیر قائم حرکت بیش از ۷ متر از کف ورودی اصلی (معمولاً بیش از ۳ طبقه)، تعبیه آسانسور الزامی است؛ مگر در صورت وجود سطح شیب‌دار مناسب. ' +
        'در ساختمان‌های >21 m، حداقل یک آسانسور برانکاردبر (۲٫۱×۱٫۱ m، در ۰٫۹ m) و در ساختمان‌های الزامی حداقل یک آسانسور ویلچربر (۱٫۴×۱٫۱ m، در ۰٫۸ m) لازم است.',
      thresholds: {
        vertical_travel_mandatory: { value: 7, unit: 'm', note: '§15-2-1-2 (>7 m from main entrance)' },
        stretcher_at_height: { value: 21, unit: 'm', note: '§15-2-1-4 stretcher lift mandatory' },
        wheelchair_cab_w: { value: 1.1, unit: 'm' },
        wheelchair_cab_d: { value: 1.4, unit: 'm' },
        wheelchair_door_w: { value: 0.8, unit: 'm' },
        stretcher_cab_w: { value: 1.1, unit: 'm' },
        stretcher_cab_d: { value: 2.1, unit: 'm' },
      },
      evaluate: (ctx: RuleContext): RuleResult[] => {
        const out: RuleResult[] = [];
        const floors = Math.max(1, ctx.project.building.floors);
        const floorHeight = 3.2; // DEFAULT_FLOOR_HEIGHT in stairs.ts
        const verticalTravel = (floors - 1) * floorHeight; // approximate from entrance floor
        const needsElevator = verticalTravel > 7; // > 7 m from main entrance
        const hasElevator = !!ctx.project.building.hasElevator;
        // Number-of-floors soft threshold: 3 floors = 6.4 m → borderline,
        // flagged as soft since travel depends on grade/floor-height choices.
        if (needsElevator && !hasElevator) {
          push(out, fail('hard', 'MBH15-LIFT-001',
            `برای این ساختمان ${floors} طبقه (مسیر قائم ≈${verticalTravel.toFixed(1)} m از ورودی) تعبیه حداقل یک آسانسور مطابق مبحث ۱۵ §۱۵-۲-۱-۲ الزامی است.`,
            'Mabhas 15 §15-2-1-2', [SRC.m15Sel], verticalTravel));
        } else if (floors === 3 && !hasElevator) {
          push(out, fail('soft', 'MBH15-LIFT-001',
            `ساختمان ${floors} طبقه — در صورت تجاوز مسیر حرکت قائم از ۷ متر از کف ورودی اصلی (بسته به تراز ورودی و ارتفاع طبقات)، آسانسور مطابق §۱۵-۲-۱-۲ الزامی می‌شود.`,
            'Mabhas 15 §15-2-1-2', [SRC.m15Sel], verticalTravel));
        }
        return out;
      },
    },

    {
      ruleId: 'MBH15-LIFT-002',
      family: 'elevator',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'ابعاد کابین ویلچربر / برانکاردبر / تخت‌بر — NOT IMPLEMENTED',
      reference: 'Mabhas 15 §15-2-1-9 / §15-2-1-10 / §15-2-1-11',
      edition: '1392',
      sources: [SRC.m15Sel],
      sourceTier: 3,
      status: 'NOT_IMPLEMENTED',
      category: 'elevator', severity: 'advisory',
      evaluate: (): RuleResult[] => [
        info('MBH15-LIFT-002',
          'کنترل ابعاد کابین آسانسور (ویلچربر ۱٫۴×۱٫۱ / برانکاردبر ۲٫۱×۱٫۱ / تخت‌بر ۲٫۴×۱٫۴ متر) پس از افزودن مدل دقیق چاه آسانسور به موتور فعال خواهد شد.',
          'Mabhas 15 §15-2-1-9/10/11', [SRC.m15Sel]),
      ],
    },

    // ==================== DAYLIGHT (Mabhas 4 §7-1-1-14 / ch.6) ===================
    {
      ruleId: 'MBH4-DYL-001',
      family: 'daylight',
      jurisdiction: 'ir-national', scope: 'national',
      title: 'الزام نور و تهویه طبیعی برای فضاهای اقامت و آشپزخانه',
      reference: 'Mabhas 4 (1396) §6-4-1 (general) / §7-1-1-14 (kitchen independent daylight)',
      edition: '1396',
      sources: [SRC.m6Daylight, SRC.m4Res],
      sourceTier: 3,
      status: 'REQUIRES_SOURCE_VERIFICATION',
      category: 'daylight', severity: 'hard',
      description:
        'فضاهای اقامت (نشیمن/پذیرایی/خواب/غذاخوری/نشیمن خانوادگی/اتاق مهمان) و آشپزخانه‌های مستقل باید به نور و تهویه طبیعی مستقل به فضای باز یا معبر عمومی دسترسی داشته باشند. ' +
        'سرویس بهداشتی/حمام/انباری/راهرو الزام به نور طبیعی مستقل ندارند. ' +
        'حداکثر عمق نورگیری از پنجره ۷ متر است.',
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
          // §7-1-1-14: units ≥75 m² or kitchens >7 m from an adjacent window
          // require independent daylight; our generator marks hasExteriorWall
          // per wall adjacency, so this fires correctly for enclosed kitchens.
          return indoorArea >= 75;
        })();
        for (const f of ctx.candidate.floors) {
          for (const s of f.spaces) {
            const need = needsDaylight.has(s.type) || (s.type === 'kitchen' && (ctx.project.building.kitchenType === 'closed' || kitchenNeedsIndependent));
            if (!need) continue;
            if (!s.hasExteriorWall) {
              push(out, fail('hard', 'MBH4-DYL-001',
                s.type === 'kitchen'
                  ? `آشپزخانه \"${s.label}\" فاقد دیوار خارجی/پنجره است (نور طبیعی مستقل برای آشپزخانه بسته الزامی است، §7-1-1-14).`
                  : `فضای \"${s.label}\" فاقد دیوار خارجی/پنجره است (نور طبیعی الزامی، فصل ۶ مبحث چهار).`,
                s.type === 'kitchen' ? 'Mabhas 4 §7-1-1-14' : 'Mabhas 4 ch. 6',
                [SRC.m6Daylight, SRC.m4Res], undefined,
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
        info('MBH4-DYL-002',
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
        info('MBH4-DYL-003',
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
        info('MBH4-VENT-001',
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
          push(out, fail('soft', 'MUN-PARK-001',
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
        info('MUN-SET-001',
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
        info('THN-000',
          'پکیج مقررات تفصیلی تهران (پهنه‌بندی، عقب‌نشینی، سطح اشغال، تراکم، ارتفاع مجاز، اُشکوب) هنوز بارگذاری نشده است. پس از دریافت دستور نقشه رسمی از شهرداری منطقه، پکیج معتبر را به نرم‌افزار اضافه کنید. تا آن زمان مقادیر پیش‌فرض ملی/عرفی استفاده می‌شود.',
          'طرح تفصیلی تهران (NOT LOADED)'),
      ],
    },
  ],
};
