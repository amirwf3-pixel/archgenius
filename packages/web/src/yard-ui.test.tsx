/**
 * Task 155 — the existing core `hasYard` capability (Task 154) exposed in the UI.
 *
 *   - The Yard toggle renders, is labelled «حیاط», and defaults OFF.
 *   - OFF: the engine input is exactly the pre-Task-155 input (hasYard=false) and the
 *     default plans/DXF are byte-identical (same pinned sha256 as the Task 153 guard).
 *   - ON: `hasYard: true` reaches createProject unchanged and the Task 154 yard appears.
 *   - YARD_INVALID / YARD_NO_ACCESS have Persian titles and message translations.
 *   - Saved projects round-trip the flag.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { createHash } from 'node:crypto';
import { createProject, generate, exportDXF, validateCandidate } from '@archgenius/core';
import type { Project, LayoutCandidate } from '@archgenius/core';
import { App, DEFAULT_STATE, buildProjectInput } from './App';
import type { FormState } from './App';
import { formFromProject } from './ProjectManager';
import { t, findingCodeTitle, findingMessageFa, isPersianText } from './i18n';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const on: FormState = { ...DEFAULT_STATE, hasYard: true };
const yardsOf = (c: LayoutCandidate) => c.floors.flatMap(f => f.spaces.filter(s => s.type === 'yard').map(s => ({ f, s })));

describe('Task 155: Yard toggle', () => {
  const html = renderToString(React.createElement(App));
  const input = html.match(/<input[^>]*id="f-yard"[^>]*>/)?.[0] ?? '';

  it('renders a checkbox bound to f-yard with the Persian label «حیاط»', () => {
    expect(t('hasYard')).toBe('حیاط');
    expect(input).toContain('type="checkbox"');
    expect(html).toMatch(/<label[^>]*for="f-yard"/);
    expect(html).toContain('حیاط');
  });

  it('defaults OFF (balcony toggle still present and OFF)', () => {
    expect(DEFAULT_STATE.hasYard).toBe(false);
    expect(input).not.toMatch(/\schecked(=|\s|>)/);
    expect(html).toMatch(/<input[^>]*id="f-balcony"/);
  });
});

describe('Task 155: form → core input binding', () => {
  it('OFF: engine input is exactly the pre-Task-155 input (hasYard=false)', () => {
    expect(buildProjectInput(DEFAULT_STATE)).toEqual({
      name: 'ویلای نمونه',
      site: {
        shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8, northRotationDeg: 0,
        setbackNorth: 2, setbackSouth: 3, setbackEast: 2, setbackWest: 2,
        jurisdiction: 'Tehran-Municipality-Default', city: 'Tehran', parkingLayout: 'auto',
      },
      building: {
        type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed',
        parkingSpaces: 2, hasStair: true, hasElevator: false, hasStorage: true, hasBalcony: false, hasYard: false,
      },
      deterministic: true, seed: 42,
    });
  });

  it('a legacy form state without the field is treated as OFF', () => {
    const legacy = { ...DEFAULT_STATE } as FormState;
    delete legacy.hasYard;
    expect(buildProjectInput(legacy).building.hasYard).toBe(false);
    expect(buildProjectInput(legacy)).toEqual(buildProjectInput(DEFAULT_STATE));
  });

  it('ON: hasYard=true reaches the core input unchanged; nothing else changes', () => {
    const a = buildProjectInput(DEFAULT_STATE);
    const b = buildProjectInput(on);
    expect(b.building.hasYard).toBe(true);
    expect(createProject(b).input.building.hasYard).toBe(true);
    expect({ ...b, building: { ...b.building, hasYard: false } }).toEqual(a);
    expect(b.building.hasBalcony).toBe(false); // balcony untouched
  });
});

describe('Task 155: generation through the UI input path', () => {
  it('OFF: default plans + DXF are byte-identical (pinned, same as Task 153 guard)', () => {
    const r = generate(createProject(buildProjectInput(DEFAULT_STATE)), { allStrategies: true });
    const got = r.candidates.map(c => `${c.metadata.strategy}:${sha(exportDXF(c, DEFAULT_STATE.name).dxf)}`);
    expect(got).toEqual([
      'functional-circulation:bd7df1bf3cc6a9a0a26fd5262637ec9b9c01985136caef95e2407bf1c90848d0',
      'alternative-zoning:089d28d8dd529a610bf346acfbc425a4845322486a4b197bec6c42b541c3ce17',
    ]);
    for (const c of r.candidates) expect(yardsOf(c)).toEqual([]);
  });

  it('ON: the existing Task 154 yard appears (ground floor, 20 m², open-air), deterministically', () => {
    const gen = () => generate(createProject(buildProjectInput(on)), { allStrategies: true });
    const r = gen();
    expect(r.bestCandidate).not.toBeNull();
    const best = r.bestCandidate!;
    const ys = yardsOf(best);
    expect(ys.length).toBe(1);
    expect(ys[0].f.level).toBe(0);
    expect(ys[0].s.area).toBeCloseTo(20, 1);
    expect(ys[0].f.walls.some(w => w.spaceIds.includes(ys[0].s.id))).toBe(false);
    const vr = validateCandidate(best);
    expect(vr.findings.filter(x => String(x.code).startsWith('YARD_'))).toEqual([]);
    expect(vr.hard).toEqual([]);
    const dxf = exportDXF(best, 'x').dxf;
    expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    expect(sha(exportDXF(gen().bestCandidate!, 'x').dxf)).toBe(sha(dxf));
  });
});

describe('Task 155: Persian yard findings', () => {
  const best = generate(createProject(buildProjectInput(on)), { allStrategies: true }).bestCandidate!;
  const yardFindings = (mut: (c: LayoutCandidate, s: any) => void) => {
    const c = structuredClone(best);
    const s = c.floors[0].spaces.find(x => x.type === 'yard')!;
    mut(c, s);
    return validateCandidate(c).findings.filter(x => String(x.code).startsWith('YARD_'));
  };
  const latinWords = (s: string, id: string) => s.split(id).join('').match(/[A-Za-z]{2,}/g) ?? [];

  it('titles', () => {
    expect(findingCodeTitle('YARD_INVALID')).toBe('نامعتبر بودن حیاط');
    expect(findingCodeTitle('YARD_NO_ACCESS')).toBe('نبود دسترسی به حیاط');
  });

  it('real YARD_INVALID messages are fully translated (values + id preserved)', () => {
    const under = yardFindings((c, s) => {
      const liv = c.floors[0].spaces.find(x => x.type === 'living')!;
      s.rect = { ...s.rect, x: liv.rect.x, y: liv.rect.y };
    });
    const small = yardFindings((_c, s) => { s.area = 5; });
    const big = yardFindings((_c, s) => { s.area = 60; });
    for (const fs of [under, small, big]) {
      const f = fs.find(x => x.code === 'YARD_INVALID')!;
      expect(f).toBeDefined();
      const fa = findingMessageFa(f);
      expect(isPersianText(fa)).toBe(true);
      expect(fa).toContain('yard-0-000');
      expect(latinWords(fa, 'yard-0-000')).toEqual([]);
    }
    expect(findingMessageFa(under.find(x => x.code === 'YARD_INVALID')!)).toContain('زیر فضاهای ساختمان');
    const s = findingMessageFa(small.find(x => x.code === 'YARD_INVALID')!);
    expect(s).toContain('5.00'); expect(s).toContain('کمتر از حداقل برنامه (10 مترمربع)');
    const b = findingMessageFa(big.find(x => x.code === 'YARD_INVALID')!);
    expect(b).toContain('60.00'); expect(b).toContain('35.00');
  });

  it('every YARD_INVALID sub-problem has a translation (multi-problem list)', () => {
    const msg = "Floor 1: yard 'yard-0-000' is invalid: not on the ground floor (level 1); outside the buildable area; "
      + 'under or overlapping building spaces; overlapping parking; on the street side of the building; '
      + 'area 5.00 m² below the program minimum 10 m²; area 60.00 m² above the program cap 35.00 m²';
    const fa = findingMessageFa({ code: 'YARD_INVALID', message: msg });
    expect(latinWords(fa, 'yard-0-000')).toEqual([]);
    expect(fa.split('؛ ').length).toBe(7);
    expect(fa).toContain('طبقهٔ 1');
  });

  it('an unknown sub-problem stays verbatim (never guessed)', () => {
    const fa = findingMessageFa({ code: 'YARD_INVALID', message: "Floor 0: yard 'y' is invalid: something new; overlapping parking" });
    expect(fa).toContain('something new');
    expect(fa).toContain('دارای هم‌پوشانی با پارکینگ');
  });

  it('real YARD_NO_ACCESS message is translated', () => {
    const fs = yardFindings((c, s) => {
      const g = c.floors[0], r = s.rect, t0 = 0.3;
      const ring = [
        { x: r.x - t0, y: r.y - t0, w: r.w + 2 * t0, h: t0 }, { x: r.x - t0, y: r.y + r.h, w: r.w + 2 * t0, h: t0 },
        { x: r.x - t0, y: r.y, w: t0, h: r.h }, { x: r.x + r.w, y: r.y, w: t0, h: r.h },
      ];
      ring.forEach((rr, i) => g.spaces.push({ ...structuredClone(g.spaces[0]), id: `blk-${i}`, type: 'storage', rect: rr, polygon: [], area: rr.w * rr.h }));
    });
    const f = fs.find(x => x.code === 'YARD_NO_ACCESS')!;
    expect(f).toBeDefined();
    const fa = findingMessageFa(f);
    expect(fa).toContain('yard-0-000');
    expect(fa).toContain('قابل دسترسی نیست');
    expect(latinWords(fa, 'yard-0-000')).toEqual([]);
  });
});

describe('Task 155: saved projects round-trip the flag', () => {
  const prj = (hasYard?: boolean): Project => {
    const input = buildProjectInput(DEFAULT_STATE);
    if (hasYard === undefined) delete (input.building as any).hasYard;
    else input.building.hasYard = hasYard;
    return { id: 'p', input, createdAt: 0, updatedAt: 0 } as unknown as Project;
  };
  it('true → ON, false/missing → OFF; form → input → form is stable', () => {
    expect(formFromProject(prj(true), DEFAULT_STATE).hasYard).toBe(true);
    expect(formFromProject(prj(false), DEFAULT_STATE).hasYard).toBe(false);
    expect(formFromProject(prj(undefined), DEFAULT_STATE).hasYard).toBe(false);
    const back = formFromProject({ id: 'p', input: buildProjectInput(on), createdAt: 0, updatedAt: 0 } as unknown as Project, DEFAULT_STATE);
    expect(buildProjectInput(back)).toEqual(buildProjectInput(on));
  });
});
