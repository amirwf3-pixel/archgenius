/**
 * Task 153 — the existing core `hasBalcony` capability exposed in the UI.
 *
 *   - The Balcony toggle renders, is labelled in Persian, and defaults OFF.
 *   - OFF: the engine input is exactly the pre-Task-153 input (hasBalcony=false) and the
 *     default plans/DXF are byte-identical (pinned sha256 from HEAD 84bff39).
 *   - ON: `hasBalcony: true` reaches createProject through the existing input path and the
 *     existing core balcony (Task 152) appears.
 *   - The two balcony findings have Persian titles and message translations.
 *   - Saved projects round-trip the flag.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { createHash } from 'node:crypto';
import { createProject, generate, exportDXF, validateCandidate } from '@archgenius/core';
import type { Project } from '@archgenius/core';
import { App, DEFAULT_STATE, buildProjectInput } from './App';
import type { FormState } from './App';
import { formFromProject } from './ProjectManager';
import { t, findingCodeTitle, findingMessageFa, isPersianText } from './i18n';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const on: FormState = { ...DEFAULT_STATE, hasBalcony: true };

describe('Task 153: Balcony toggle', () => {
  const html = renderToString(React.createElement(App));
  const input = html.match(/<input[^>]*id="f-balcony"[^>]*>/)?.[0] ?? '';

  it('renders a checkbox bound to f-balcony with the Persian label «بالکن»', () => {
    expect(t('hasBalcony')).toBe('بالکن');
    expect(input).toContain('type="checkbox"');
    expect(html).toMatch(/<label[^>]*for="f-balcony"/);
    expect(html).toContain('بالکن');
  });

  it('defaults OFF', () => {
    expect(DEFAULT_STATE.hasBalcony).toBe(false);
    expect(input).not.toMatch(/\schecked(=|\s|>)/);
  });
});

describe('Task 153: form → core input binding', () => {
  it('OFF: engine input is exactly the pre-Task-153 input (hasBalcony=false)', () => {
    expect(buildProjectInput(DEFAULT_STATE)).toEqual({
      name: 'ویلای نمونه',
      site: {
        shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8, northRotationDeg: 0,
        setbacks: { north: 2, south: 3, east: 2, west: 2 },
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
    delete legacy.hasBalcony;
    expect(buildProjectInput(legacy).building.hasBalcony).toBe(false);
  });

  it('ON: hasBalcony=true reaches the core input; nothing else changes', () => {
    const a = buildProjectInput(DEFAULT_STATE);
    const b = buildProjectInput(on);
    expect(b.building.hasBalcony).toBe(true);
    expect(createProject(b).input.building.hasBalcony).toBe(true);
    expect({ ...b, building: { ...b.building, hasBalcony: false } }).toEqual(a);
    expect(b.building.hasYard).toBe(false); // yard stays untouched
  });
});

describe('Task 153: generation through the UI input path', () => {
  it('OFF: default plans + DXF are byte-identical to HEAD 84bff39 (pinned)', () => {
    const r = generate(createProject(buildProjectInput(DEFAULT_STATE)), { allStrategies: true });
    const got = r.candidates.map(c => `${c.metadata.strategy}:${sha(exportDXF(c, DEFAULT_STATE.name).dxf)}`);
    expect(got).toEqual([
      'functional-circulation:bd7df1bf3cc6a9a0a26fd5262637ec9b9c01985136caef95e2407bf1c90848d0',
      'alternative-zoning:089d28d8dd529a610bf346acfbc425a4845322486a4b197bec6c42b541c3ce17',
    ]);
    for (const c of r.candidates) {
      expect(c.floors.flatMap(f => f.spaces).some(s => s.type === 'balcony')).toBe(false);
    }
  });

  it('ON: the existing bounded core balcony appears (≈4 m², with a door), deterministically', () => {
    const gen = () => generate(createProject(buildProjectInput(on)), { allStrategies: true });
    const r = gen();
    expect(r.bestCandidate).not.toBeNull();
    const best = r.bestCandidate!;
    const bal = best.floors.flatMap(f => f.spaces.filter(s => s.type === 'balcony').map(s => ({ f, s })));
    expect(bal.length).toBe(1);
    expect(bal[0].s.area).toBeCloseTo(4, 1);
    expect(bal[0].f.openings.some(o => o.type === 'door' && (o.spaceA === bal[0].s.id || o.spaceB === bal[0].s.id))).toBe(true);
    expect(validateCandidate(best).findings.filter(x => String(x.code).startsWith('BALCONY_'))).toEqual([]);
    const dxf = exportDXF(best, 'x').dxf;
    expect(dxf).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    expect(sha(exportDXF(gen().bestCandidate!, 'x').dxf)).toBe(sha(dxf));
  });
});

describe('Task 153: Persian balcony findings', () => {
  it('titles', () => {
    for (const code of ['BALCONY_NO_ACCESS', 'BALCONY_OVERSIZED']) {
      expect(findingCodeTitle(code)).not.toBe(code);
      expect(isPersianText(findingCodeTitle(code))).toBe(true);
    }
    expect(findingCodeTitle('BALCONY_NO_ACCESS')).toContain('بالکن');
    expect(findingCodeTitle('BALCONY_OVERSIZED')).toContain('بالکن');
  });

  it('real engine messages are translated (values preserved)', () => {
    const best = generate(createProject(buildProjectInput(on)), { allStrategies: true }).bestCandidate!;
    const c = structuredClone(best);
    const fl = c.floors.find(f => f.spaces.some(s => s.type === 'balcony'))!;
    const bal = fl.spaces.find(s => s.type === 'balcony')!;
    fl.openings = fl.openings.filter(o => !(o.type !== 'window' && (o.spaceA === bal.id || o.spaceB === bal.id)));
    bal.area = 108.8;
    const fs = validateCandidate(c).findings.filter(x => String(x.code).startsWith('BALCONY_'));
    expect(fs.map(f => f.code).sort()).toEqual(['BALCONY_NO_ACCESS', 'BALCONY_OVERSIZED']);
    for (const f of fs) {
      const fa = findingMessageFa(f);
      expect(fa).not.toBe(f.message);
      expect(isPersianText(fa)).toBe(true);
      expect(fa).toContain(bal.id);
    }
    const over = findingMessageFa(fs.find(f => f.code === 'BALCONY_OVERSIZED')!);
    expect(over).toContain('108.80');
    expect(over).toContain('7.00');
  });
});

describe('Task 153: saved projects round-trip the flag', () => {
  const prj = (hasBalcony?: boolean): Project => {
    const input = buildProjectInput(DEFAULT_STATE);
    if (hasBalcony === undefined) delete (input.building as any).hasBalcony;
    else input.building.hasBalcony = hasBalcony;
    return { id: 'p', input, createdAt: 0, updatedAt: 0 } as unknown as Project;
  };
  it('true → ON, false/missing → OFF', () => {
    expect(formFromProject(prj(true), DEFAULT_STATE).hasBalcony).toBe(true);
    expect(formFromProject(prj(false), DEFAULT_STATE).hasBalcony).toBe(false);
    expect(formFromProject(prj(undefined), DEFAULT_STATE).hasBalcony).toBe(false);
  });
});
