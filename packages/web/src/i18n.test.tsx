/**
 * Persian-first UI localization tests (v1.0.1+).
 *
 * Covers: Persian default dictionary, RTL document direction, Persian render
 * of the App, the severity/terminology glossary, finding-code titles, core
 * space-label translation, engine error translation, and the Persian
 * validation summary. Machine identifiers (codes, ids, strategy names) must
 * remain untranslated.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { App } from './App';
import {
  t, tf, DIR, LOCALE, SEVERITY_FA, STRATEGY_FA, STAIR_TYPE_FA, SPACE_TYPE_FA,
  FINDING_CODE_FA, findingCodeTitle, spaceLabel, spaceTypeFromLabel,
  persianSummary, translateEngineError, isPersianText,
  findingMessageFa, translateInfeasibleExplanation,
} from './i18n';
import { createProject, generate, validateCandidate } from '@archgenius/core';

const PERSIAN = /[\u0600-\u06FF]/;

describe('Persian default UI (localization layer)', () => {
  it('fa is the default locale and direction is rtl', () => {
    expect(LOCALE).toBe('fa');
    expect(DIR).toBe('rtl');
  });

  it('every dictionary string contains Persian script (no empty keys)', () => {
    const dict = t as unknown as Record<string, string>;
    const keys = Object.keys(FINDING_CODE_FA); // sanity that maps are non-empty
    expect(keys.length).toBeGreaterThan(30);
    // exercise a representative set of dictionary keys
    const samples = [
      'appName', 'sectionProject', 'sectionSite', 'sectionBuilding', 'sectionEditing',
      'sectionValidation', 'sectionSpaces', 'sectionStairs', 'generate', 'generating',
      'downloadDxf', 'validTitle', 'invalidTitle', 'canvasEmpty', 'errorInfeasible',
      'errorInvalidPolygon', 'hasStair', 'stairTread', 'stairLanding', 'noStairs',
      'metricUsable', 'metricCirculation', 'editFailed', 'generateFirst', 'selectPlaceholder',
    ] as const;
    for (const k of samples) {
      expect(isPersianText(t(k))).toBe(true);
      expect(t(k).length).toBeGreaterThan(0);
    }
  });

  it('placeholder interpolation works', () => {
    expect(tf('floorOf', { current: 1, total: 3 })).toBe('طبقهٔ 1 از 3');
    expect(tf('badgeHard', { count: 4 })).toContain('4');
  });
});

describe('RTL rendering', () => {
  it('App renders with dir="rtl" and lang="fa" on its root', () => {
    const html = renderToString(React.createElement(App));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="fa"');
  });

  it('index.html declares Persian RTL document', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/<html lang="fa" dir="rtl">/);
    expect(html).toContain('آرچ‌جنیوس');
  });
});

describe('Persian UI render (no legacy English chrome)', () => {
  const html = renderToString(React.createElement(App));

  it('contains Persian UI strings', () => {
    for (const fa of ['تولید پلان', 'اعتبارسنجی', 'راه‌پله', 'سایت', 'ساختمان', 'ویرایش', 'خروجی DXF', 'عقب‌نشینی']) {
      expect(html).toContain(fa);
    }
  });

  it('does NOT contain the old English UI strings', () => {
    for (const en of [
      'Project name', 'Seed (deterministic)', 'Access side', 'Site Shape',
      'Generate a plan first.', 'No plan generated yet', 'Click to select',
      'Validation —', 'Select Room', 'Move Room', 'Resize Safe', 'Set L-Shape',
      'Unlock All', 'Usable', 'Circulation</', 'Bedrooms', 'Stair</', 'Parking</',
    ]) {
      expect(html).not.toContain(en);
    }
  });
});

describe('terminology glossary (product requirement)', () => {
  it('severities use the required Persian terms', () => {
    expect(SEVERITY_FA.hard).toBe('خطای بحرانی');
    expect(SEVERITY_FA.soft).toBe('هشدار');
    expect(SEVERITY_FA.advisory).toBe('نیازمند بررسی');
  });

  it('stair terminology: راه‌پله / پاگرد / کف پله', () => {
    expect(t('hasStair')).toBe('راه‌پله');
    expect(t('stairLanding')).toBe('پاگرد');
    expect(t('stairTread')).toContain('کف پله');
    expect(t('stairRiser')).toContain('رایزر');
    expect(t('stairFlights')).toContain('بازو');
    expect(STAIR_TYPE_FA['u-stair']).toContain('دو بازو');
    expect(STAIR_TYPE_FA.straight).toBe('مستقیم');
    expect(STAIR_TYPE_FA['l-stair']).toContain('L');
  });

  it('all core strategies have Persian labels', () => {
    for (const s of ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning']) {
      expect(isPersianText(STRATEGY_FA[s])).toBe(true);
    }
  });
});

describe('finding codes: Persian titles, codes untranslated', () => {
  it('important stair/validation codes have Persian titles', () => {
    expect(findingCodeTitle('STAIR_MISSING')).toContain('راه‌پله');
    expect(findingCodeTitle('STAIR_CORE_MISALIGNED')).toContain('هستهٔ راه‌پله');
    expect(findingCodeTitle('CIRC_INACCESSIBLE_SPACE')).toContain('دسترس');
    expect(findingCodeTitle('MBH4-STAIR-002')).toContain('کف پله');
    expect(findingCodeTitle('GEO_OVERLAPPING_ROOMS')).toContain('هم‌پوشانی');
  });

  it('unknown codes fall back to the raw code (machine-readable, never mangled)', () => {
    expect(findingCodeTitle('SOME_FUTURE_CODE')).toBe('SOME_FUTURE_CODE');
  });

  it('every mapped title contains Persian script', () => {
    for (const [code, title] of Object.entries(FINDING_CODE_FA)) {
      expect(isPersianText(title)).toBe(true);
      // the code itself is preserved as a machine identifier in the map keys
      expect(code).toMatch(/^[A-Z0-9_-]+$/);
    }
  });
});

describe('core space labels → Persian', () => {
  it('translates every label the core placer can emit', () => {
    const cases: Record<string, string> = {
      'Living Room': 'نشیمن', 'Dining': 'غذاخوری', 'Kitchen': 'آشپزخانه',
      'Bedroom 1': 'اتاق خواب 1', 'Bedroom 12': 'اتاق خواب 12',
      'Master Bedroom': 'اتاق خواب مستر', 'Bathroom 2': 'سرویس بهداشتی 2',
      'Master Bathroom': 'سرویس مستر', 'Guest WC': 'توالت مهمان',
      'Corridor': 'راهرو', 'Stair Hall': 'هال راه‌پله', 'Entrance': 'ورودی',
      'Foyer': 'لابی ورودی', 'Storage': 'انباری', 'Parking': 'پارکینگ',
    };
    for (const [en, fa] of Object.entries(cases)) {
      expect(spaceLabel(en)).toBe(fa);
    }
  });

  it('unknown labels pass through unchanged (machine ids)', () => {
    expect(spaceLabel('some-machine-label')).toBe('some-machine-label');
    expect(spaceLabel('')).toBe('');
  });

  it('space types have Persian labels with code fallback', () => {
    expect(spaceTypeFromLabel({ type: 'stair-hall' })).toBe('هال راه‌پله');
    expect(spaceTypeFromLabel({ type: 'living' })).toBe('نشیمن');
    expect(spaceTypeFromLabel({ type: 'future-type' })).toBe('future-type');
    expect(Object.keys(SPACE_TYPE_FA).length).toBeGreaterThanOrEqual(20);
  });
});

describe('engine output helpers', () => {
  it('persianSummary reports valid/invalid with Persian counts', () => {
    const fake = { ok: false, hard: [1, 2], soft: [1], advisory: [1, 2, 3] } as any;
    const s = persianSummary(fake);
    expect(s).toContain('نامعتبر');
    expect(s).toContain('خطای بحرانی');
    expect(s).toContain('2');
    const ok = persianSummary({ ok: true, hard: [], soft: [1], advisory: [] } as any);
    expect(ok).toContain('معتبر');
    expect(ok).not.toContain('نامعتبر');
  });

  it('translateEngineError maps common core edit errors to Persian', () => {
    expect(translateEngineError('Space sp-1 is locked for position/geometry')).toContain('قفل');
    expect(translateEngineError('Move would place room outside buildable boundary')).toContain('محدودهٔ ساخت');
    expect(translateEngineError('Floor 3 not found')).toContain('پیدا نشد');
    // unknown engine text passes through verbatim (engine output is not mangled)
    expect(translateEngineError('Something novel failed: XYZ')).toBe('Something novel failed: XYZ');
  });
});

describe('end-to-end: Persian summary over a real generated candidate', () => {
  it('default program generates and summarizes in Persian', () => {
    const input = {
      name: 'ویلای نمونه',
      site: {
        shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8,
        setbacks: { north: 2, south: 3, east: 2, west: 2 },
      },
      building: {
        type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
        kitchenType: 'closed', parkingSpaces: 2, hasStair: true,
      },
      deterministic: true, seed: 42,
    } as any;
    const result = generate(createProject(input));
    expect(result.candidates.length).toBeGreaterThan(0);
    const vr = validateCandidate(result.candidates[0]);
    const summary = persianSummary(vr);
    expect(isPersianText(summary)).toBe(true);
    expect(summary).toMatch(/معتبر|نامعتبر/);
    // stairs exist and their codes have Persian titles
    const stairs = result.candidates[0].floors.flatMap((fl: any) => fl.stairs ?? []);
    expect(stairs.length).toBeGreaterThan(0);
    expect(isPersianText(STAIR_TYPE_FA[stairs[0].type])).toBe(true);
  });
});

describe('finding message translation (findingMessageFa)', () => {
  const fa = (code: string, message: string) => findingMessageFa({ code, message });

  it('HARD finding: CIRC_INACCESSIBLE_SPACE translates with room-name interpolation', () => {
    expect(fa('CIRC_INACCESSIBLE_SPACE', 'Space "Living Room" is not reachable from the entrance/circulation.'))
      .toBe('فضای «نشیمن» از ورودی/سیرکولاسیون قابل دسترس نیست.');
  });

  it('HARD finding: stair findings translate with floor numbers preserved', () => {
    const out = fa('STAIR_MISSING', 'Multi-floor building: floor 1 has no vertical circulation element (no stair) connecting it to the floor above.');
    expect(out).toContain('طبقهٔ 1');
    expect(out).toContain('راه‌پله');
    expect(isPersianText(out)).toBe(true);
  });

  it('SOFT findings translate (both CIRCULATION_EXCESSIVE template variants)', () => {
    expect(fa('CIRCULATION_EXCESSIVE', 'Circulation ratio 37.6% exceeds 35% — inefficient layout.'))
      .toBe('نسبت سیرکولاسیون 37.6٪ از ۳۵٪ فراتر است — چیدمان ناکارآمد.');
    expect(fa('CIRCULATION_EXCESSIVE', 'Circulation ratio 37.6% >35%'))
      .toBe('نسبت سیرکولاسیون 37.6٪ بیشتر از ۳۵٪ است.');
  });

  it('numeric/dimension interpolation is preserved verbatim (LTR runs)', () => {
    const out = fa('EXCESSIVE_RESIDUAL', 'Residual unassigned area 59.07 m² is >15% of footprint (165.00 m²).');
    expect(out).toContain('59.07');
    expect(out).toContain('165.00');
    expect(isPersianText(out)).toBe(true);
    expect(fa('ROOM_BAD_PROPORTION', 'Room "Master Bedroom" has bad proportion: 11.90 / 3.17 = 3.8.'))
      .toBe('فضای «اتاق خواب مستر» نسبت ابعاد نامناسب دارد: 11.90 / 3.17 = 3.8.');
  });

  it('furniture/door machine ids remain intact inside the Persian sentence', () => {
    expect(fa('FURNITURE_BLOCKS_DOOR', 'Furniture f-1 may block door door-1-0.'))
      .toBe('مبلمان f-1 ممکن است درِ door-1-0 را مسدود کند.');
    const doors = fa('DOOR_COLLISION', 'Doors door-1-3 and door-1-4 collide on wall wall-1-9.');
    expect(doors).toContain('door-1-3');
    expect(doors).toContain('door-1-4');
    expect(doors).toContain('wall-1-9');
  });

  it('multi-space message maps every label segment (Door of A / B)', () => {
    expect(fa('OPENING_DOOR_SWING_BLOCKED', 'Door of Corridor / Stair Hall may swing into obstruction.'))
      .toBe('درِ راهرو / هال راه‌پله ممکن است هنگام بازشدن به مانع برخورد کند.');
  });

  it('ADVISORY findings translate: DEF-SETBACK-001 and REG_RULE_UNVERIFIED', () => {
    expect(fa('DEF-SETBACK-001', 'Using default assumed setbacks; verify against municipal detailed plan.'))
      .toContain('عقب‌نشینی‌های پیش‌فرض');
    expect(fa('DEF-SETBACK-001', 'Using default assumed setbacks; verify against municipal detailed plan.'))
      .toContain('شهرداری');
    const reg = fa('REG_RULE_UNVERIFIED', 'DEF-SETBACK-001: Applied setbacks N=3 S=1.5 E=2 W=2 m. Site shape rectangle, siteArea 300.0 m², buildableArea 165.0 m².  — REQUIRES SOURCE VERIFICATION.');
    expect(reg).toContain('عقب‌نشینی‌های اعمال‌شده');
    expect(reg).toContain('N=3');
    expect(reg).toContain('S=1.5');
    expect(reg).toContain('300.0');
    expect(reg).toContain('165.0');
    expect(reg).toContain('نیازمند راستی‌آزمایی منبع');
  });

  it('ADVISORY: NOT_IMPLEMENTED frame and pack description translate; rule title preserved', () => {
    const msg = 'Rule "حداقل ارتفاع فضاهای اقامت (اطلاعی — مدل سه‌بعدی لازم است)" is marked NOT_IMPLEMENTED. Iranian National Building Code (Mabhas) clauses for residential construction. Rules marked VERIFIED have been cross-checked against Tier-1 BHRC PDFs held in sources/mabhas4-96.pdf and sources/mabhas-15.pdf (hashes recorded in source-registry). Findings with status VERIFIED are backed by clause, page, and snippet. Municipal parking/setback remain advisory and require local detailed plan.';
    const out = fa('MBH4-ROOM-003', msg);
    expect(out).toContain('قاعدهٔ «حداقل ارتفاع فضاهای اقامت');
    expect(out).toContain('پیاده‌سازی نشده');
    expect(out).toContain('مفاد مبحث‌های ملی ساختمان ایران');
    expect(out).not.toContain('Iranian National Building Code');
  });

  it('constraint messages: machine id intact, labels Persian, empty note drops the dash', () => {
    expect(fa('CONSTRAINT_PREFER_ADJACENT', 'Constraint p-din-kit-dining-0-004-kitchen-0-005: Dining prefer adjacent to Kitchen'))
      .toBe('قید p-din-kit-dining-0-004-kitchen-0-005: «غذاخوری» ترجیحاً باید مجاور «آشپزخانه» باشد');
    expect(fa('CONSTRAINT_DIRECT_ACCESS', 'Constraint c-1: Kitchen must be adjacent to Dining — service workflow'))
      .toBe('قید c-1: «آشپزخانه» باید مجاور «غذاخوری» باشد — service workflow');
    expect(fa('CONSTRAINT_MUST_ADJACENT', 'Constraint c-2: Kitchen must be adjacent to Dining — '))
      .toBe('قید c-2: «آشپزخانه» باید مجاور «غذاخوری» باشد');
  });

  it('unknown messages fall back to the original verbatim (no guessing)', () => {
    expect(fa('TOTALLY_NEW_CODE', 'Something novel the engine just learned to say.'))
      .toBe('Something novel the engine just learned to say.');
    expect(fa('CIRC_INACCESSIBLE_SPACE', 'format changed completely'))
      .toBe('format changed completely');
    expect(findingMessageFa({ message: '' })).toBe('');
  });

  it('site-shape enums inside messages map to Persian (REG_RULE_UNVERIFIED)', () => {
    const reg = fa('REG_RULE_UNVERIFIED', 'DEF-SETBACK-001: Applied setbacks N=3 S=1.5 E=2 W=2 m. Site shape rectangle, siteArea 300.0 m², buildableArea 165.0 m².  — REQUIRES SOURCE VERIFICATION.');
    expect(reg).toContain('شکل سایت مستطیل');
    expect(reg).not.toContain('rectangle');
    const site = fa('SITE_STAIR_OUTSIDE_BUILDABLE', 'Stair stair-core-main-0 outside buildable boundary — site shape polygon');
    expect(site).toContain('شکل سایت چندضلعی');
  });

  it('site containment (room/corridor outside buildable) — both template variants translate', () => {
    expect(fa('SITE_ROOM_OUTSIDE_BUILDABLE', 'Room "Bedroom 2" polygon outside buildable boundary — site shape rectangle, poly verts 4, area 26.0 not inside buildable polygon'))
      .toBe('چندضلعی اتاق «اتاق خواب 2» بیرون از محدودهٔ ساخت است — شکل سایت مستطیل، 4 رأس، مساحت 26.0 مترمربع داخل چندضلعی قابل‌ساخت نیست');
    expect(fa('SITE_CORRIDOR_OUTSIDE_BUILDABLE', 'Corridor "Corridor" polygon outside buildable boundary — site shape l-shape, poly verts 6, area 12.5 not inside buildable polygon'))
      .toBe('چندضلعی راهرو «راهرو» بیرون از محدودهٔ ساخت است — شکل سایت شکل L، 6 رأس، مساحت 12.5 مترمربع داخل چندضلعی قابل‌ساخت نیست');
    expect(fa('SITE_ROOM_OUTSIDE_BUILDABLE', 'Room "Master Bedroom" bounding rect outside buildable — site shape polygon, rect 1.5,2.0 3.0x4.0 not inside buildable polygon'))
      .toBe('مستطیل محیطی اتاق «اتاق خواب مستر» بیرون از محدودهٔ ساخت است — شکل سایت چندضلعی، مستطیل 1.5,2.0 3.0x4.0 داخل چندضلعی قابل‌ساخت نیست');
    expect(fa('SITE_CORRIDOR_OUTSIDE_BUILDABLE', 'Corridor "Corridor" bounding rect outside buildable — site shape rectangle, rect 0.0,0.0 1.2x3.4 not inside buildable polygon'))
      .toBe('مستطیل محیطی راهرو «راهرو» بیرون از محدودهٔ ساخت است — شکل سایت مستطیل، مستطیل 0.0,0.0 1.2x3.4 داخل چندضلعی قابل‌ساخت نیست');
  });

  it('site containment preserves every dynamic value (label, shape, verts, area, rect)', () => {
    const out = fa('SITE_ROOM_OUTSIDE_BUILDABLE', 'Room "Bathroom 1" polygon outside buildable boundary — site shape l-shape, poly verts 8, area 13.5 not inside buildable polygon');
    expect(out).toContain('سرویس بهداشتی 1');
    expect(out).toContain('شکل L');
    expect(out).toContain('8');
    expect(out).toContain('13.5');
    const out2 = fa('SITE_ROOM_OUTSIDE_BUILDABLE', 'Room "Dining" bounding rect outside buildable — site shape rectangle, rect 2.5,3.0 4.0x5.0 not inside buildable polygon');
    expect(out2).toContain('2.5,3.0');
    expect(out2).toContain('4.0x5.0');
    expect(out2).toContain('غذاخوری');
  });

  it('Persian finding-code titles for the two site containment codes', () => {
    expect(findingCodeTitle('SITE_ROOM_OUTSIDE_BUILDABLE')).toBe('فضا خارج از محدودهٔ ساخت');
    expect(findingCodeTitle('SITE_CORRIDOR_OUTSIDE_BUILDABLE')).toBe('راهرو خارج از محدودهٔ ساخت');
    expect(isPersianText(findingCodeTitle('SITE_ROOM_OUTSIDE_BUILDABLE'))).toBe(true);
    expect(isPersianText(findingCodeTitle('SITE_CORRIDOR_OUTSIDE_BUILDABLE'))).toBe(true);
  });

  it('already-Persian engine messages pass through untouched', () => {
    const msg = 'عقب‌نشینی‌ها، سطح اشغال همکف و تراکم تابع طرح تفصیلی منطقه/شهرداری هستند.';
    expect(fa('MUN-SET-001', msg)).toBe(msg);
  });
});

describe('INFEASIBLE explanation translation', () => {
  const exp = 'Phase13.2 INFEASIBLE: no geometrically valid candidate — 4/4 strategy attempts, 0 satisfy the minimum-geometry contract (every room w>0, h>0, area>0, polygon>=3 vertices, minWidth, minLength, minArea). First failure per strategy: daylight-orientation: below minArea master-bedroom area=8.4 < 12 ; area-efficiency: below minArea master-bedroom area=8.4 < 12. bestCandidate is null and no usable candidate is exposed; diagnostic candidates carry HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings. This result must NOT be treated as a normal architectural plan.';

  it('translates the fixed frame; per-strategy diagnostics stay verbatim', () => {
    const out = translateInfeasibleExplanation(exp);
    expect(out).toContain('هیچ گزینهٔ هندسی معتبری وجود ندارد');
    expect(out).toContain('4 از 4');
    expect(out).toContain('daylight-orientation: below minArea master-bedroom area=8.4 < 12');
    expect(out).toContain('bestCandidate برابر null');
    expect(out).not.toContain('no geometrically valid candidate');
    expect(out).not.toContain('must NOT be treated');
  });

  it('non-matching explanations pass through verbatim', () => {
    expect(translateInfeasibleExplanation('some other engine text')).toBe('some other engine text');
    expect(translateInfeasibleExplanation('')).toBe('');
  });
});

describe('engine edit-error translation (extended templates)', () => {
  it('resize/lock/L-shape/repair errors translate with machine values preserved', () => {
    expect(translateEngineError('Resize violates minWidth 2.15')).toContain('minWidth 2.15');
    expect(translateEngineError('Space sp-9 locked for size/geometry')).toContain('قفل');
    expect(translateEngineError('L-shape outside buildable')).toContain('محدودهٔ ساخت');
    expect(translateEngineError('Unresolvable overlap between locked rooms a-1 and b-2')).toContain('a-1');
    expect(translateEngineError('Resize area 8.40 < minArea 12')).toContain('8.40');
    expect(translateEngineError('Move results in invalid polygon: ring self-intersects')).toContain('چندضلعی نامعتبر');
  });
});

describe('end-to-end: real core findings translate to Persian', () => {
  it('every finding message of the default 15×20 plan becomes Persian', () => {
    const input = {
      name: 'ویلای نمونه',
      site: {
        shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8,
        setbacks: { north: 2, south: 3, east: 2, west: 2 },
      },
      building: {
        type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
        kitchenType: 'closed', parkingSpaces: 2, hasStair: true,
      },
      deterministic: true, seed: 42,
    } as any;
    const result = generate(createProject(input));
    expect(result.candidates.length).toBeGreaterThan(0);
    const vr = validateCandidate(result.candidates[0]);
    expect(vr.findings.length).toBeGreaterThan(10);
    const stillEnglish = vr.findings.filter(f => !isPersianText(findingMessageFa(f)));
    expect(stillEnglish.map(f => `${f.code}: ${findingMessageFa(f)}`)).toEqual([]);
  });

  it('the 12×18 / 4-bedroom plan translates ALL finding messages (zero English bodies)', () => {
    const input = {
      name: 'x',
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8, setbacks: { north: 2, south: 3, east: 2, west: 2 } },
      building: { type: 'villa', floors: 2, bedrooms: 4, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true },
      deterministic: true, seed: 42,
    } as any;
    const result = generate(createProject(input));
    // 12x18 4BD 2F may be infeasible (below-min geometry) after quality fixes — that's honest HARD; check translation for either valid or infeasible path
    if (result.candidates.length === 0) {
      expect(result.infeasible).toBeDefined();
      const diag = result.infeasible!.diagnosticCandidates[0];
      const vr = validateCandidate(diag as any);
      const stillEnglish = vr.findings.filter((f: any) => !isPersianText(findingMessageFa(f)));
      expect(stillEnglish.map((f: any) => `${f.code}: ${findingMessageFa(f)}`)).toEqual([]);
      return;
    }
    expect(result.candidates.length).toBeGreaterThan(0);
    const vr = validateCandidate(result.candidates[0] as any);
    expect(vr.findings.filter((f: any) => f.code === 'SITE_ROOM_OUTSIDE_BUILDABLE' || f.code === 'SITE_CORRIDOR_OUTSIDE_BUILDABLE').length).toBeGreaterThan(0);
    const stillEnglish = vr.findings.filter((f: any) => !isPersianText(findingMessageFa(f)));
    expect(stillEnglish.map((f: any) => `${f.code}: ${findingMessageFa(f)}`)).toEqual([]);
  });

  it('the 18×25 three-floor plan translates its HARD CIRC finding too', () => {
    const input = {
      name: 'x',
      site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8, setbacks: { north: 2, south: 3, east: 2, west: 2 } },
      building: { type: 'villa', floors: 3, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true },
      deterministic: true, seed: 42,
    } as any;
    const result = generate(createProject(input));
    // Phase 15 M2: every strategy for this fixture carries residual HARD findings, so the
    // honest gate demotes them to diagnostic-only. The i18n layer must translate the REAL
    // validator findings either way — diagnostics keep every finding verbatim.
    const plan = (result.bestCandidate ?? result.infeasible!.diagnosticCandidates[0]) as any;
    const vr = validateCandidate(plan);
    const hard = vr.findings.filter(f => f.severity === 'hard');
    expect(hard.length).toBeGreaterThan(0);
    for (const f of hard) expect(isPersianText(findingMessageFa(f))).toBe(true);
    const circ = hard.find(f => f.code === 'CIRC_INACCESSIBLE_SPACE');
    expect(circ).toBeTruthy();
    expect(findingMessageFa(circ!)).toMatch(/قابل دسترس نیست/);
  });
});
