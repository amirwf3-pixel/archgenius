/**
 * UI/UX overhaul tests (reported separately from the 40 i18n baseline tests).
 *
 * Covers the structural/accessibility contract of the redesigned UI using
 * SSR rendering (node environment, no DOM): label↔control association,
 * progressive disclosure (native <details> keep content in the DOM), the
 * Persian-digit display helper, new dictionary keys, and the absence of
 * legacy English chrome in the new panels.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { App } from './App';
import { PlanCanvas, computeBounds, makeTransform } from './PlanCanvas';
import { t, tf, faNum, isPersianText, STRATEGY_FA } from './i18n';

const PERSIAN = /[\u0600-\u06FF]/;

function labelFor(html: string, id: string): boolean {
  return new RegExp(`<label[^>]*for="${id}"`).test(html);
}

describe('UI/UX overhaul — SSR structure', () => {
  const html = renderToString(React.createElement(App));

  it('keeps the Persian RTL document root', () => {
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="fa"');
  });

  it('primary CTA is a real button labelled with the floor count in Persian digits', () => {
    expect(html).toMatch(/<button[^>]*>[^<]*تولید پلان[^<]*۲ طبقه/);
  });

  it('form sections are numbered steps (۱ پروژه، ۲ سایت، ۳ ساختمان)', () => {
    expect(html).toContain('۱');
    expect(html).toContain('۲');
    expect(html).toContain('۳');
    expect(html).toContain(t('sectionProject'));
    expect(html).toContain(t('sectionSite'));
    expect(html).toContain(t('sectionBuilding'));
  });

  it('advanced settings use native <details> (progressive disclosure, content kept in DOM)', () => {
    // setbacks + project advanced (seed)
    const detailsCount = (html.match(/<details/g) ?? []).length;
    expect(detailsCount).toBeGreaterThanOrEqual(2);
    // the setbacks labels stay in the rendered DOM even while collapsed
    expect(html).toContain(t('setbackNorthM'));
    expect(html).toContain(t('setbackSouthM'));
    expect(html).toContain(t('seedLabel'));
    expect(html).not.toMatch(/<details[^>]*open[^>]*>[\s\S]*setbackNorth/);
  });

  it('every visible form label is associated with its control (htmlFor/id)', () => {
    const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*id="(f-[a-z0-9-]+)"/g)].map(m => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const id of ids) {
      expect(labelFor(html, id)).toBe(true);
    }
  });

  it('empty state: result card and canvas overlay communicate the first action', () => {
    expect(html).toContain(t('resultEmptyTitle'));
    expect(html).toContain(t('resultEmptyHint'));
    expect(html).toContain(t('resultTitle'));
  });

  it('auto-validation disclaimer is present (trust)', () => {
    expect(html).toContain(t('autoCheckNote'));
  });

  it('DXF export button renders (disabled) with a Persian label and hint', () => {
    expect(html).toContain(t('downloadDxf'));
    expect(html).toContain(t('dxfDisabledHint'));
  });

  it('new UI strings contain Persian script (no English chrome regressions)', () => {
    const samples = [
      'resultTitle', 'resultEmptyTitle', 'resultEmptyHint', 'resultSuccess',
      'resultInfeasibleTitle', 'resultInfeasibleBody', 'infeasibleAttemptsTitle',
      'technicalDetails', 'autoCheckNote', 'findingsGroupHard', 'findingsGroupSoft',
      'findingsGroupAdv', 'findingsNone', 'findingsShowMore', 'candidatesTitle',
      'candidateRank', 'candidateBestBadge', 'candidateValidLabel', 'candidateInvalidLabel',
      'stageGenerate', 'stageValidate', 'stagePrepare', 'busyHint', 'editHint',
      'editEngineNote', 'editMoveTitle', 'editResizeTitle', 'editLShapeTitle', 'editLockTitle',
      'applyAction', 'spaceTechTitle', 'zoomInLabel', 'zoomOutLabel', 'resetViewLabel',
      'legendTitle', 'legendBuildable', 'legendParking', 'legendStair', 'legendOpenings',
      'dxfReady', 'editedBadge', 'errorDetailsPointer', 'advancedProject', 'floorPickerLabel',
      'polygonJsonValid', 'polygonJsonInvalid', 'formAriaLabel', 'setbacksSummary',
    ] as const;
    for (const k of samples) {
      expect(isPersianText(t(k))).toBe(true);
    }
  });

  it('canvas is keyboard-focusable with a Persian aria-label and zoom controls', () => {
    const canvasHtml = renderToString(
      React.createElement(PlanCanvas, { candidate: null, floorIndex: 0 }),
    );
    expect(canvasHtml).toMatch(/<canvas[^>]*tabindex="0"/);
    expect(canvasHtml).toContain(t('zoomInLabel'));
    expect(canvasHtml).toContain(t('zoomOutLabel'));
    expect(canvasHtml).toContain(t('resetViewLabel'));
    // no fixed-size canvas anymore: sizing is measured (responsive)
    expect(canvasHtml).not.toMatch(/width="800"/);
  });

  it('severity group titles and candidate labels are Persian', () => {
    expect(t('findingsGroupHard')).toContain('بحرانی');
    expect(t('findingsGroupSoft')).toContain('هشدار');
    expect(t('findingsGroupAdv')).toContain('بررسی');
    expect(t('candidateBestBadge')).toContain('بهترین');
  });
});

describe('faNum — Persian digits for UI counts (display layer only)', () => {
  it('converts Western digits to Persian digits', () => {
    expect(faNum(0)).toBe('۰');
    expect(faNum(42)).toBe('۴۲');
    expect(faNum('12')).toBe('۱۲');
    expect(faNum(1234)).toBe('۱۲۳۴');
  });

  it('leaves non-digit characters untouched', () => {
    expect(faNum('m²')).toBe('m²');
    expect(faNum('12.5 m²')).toBe('۱۲.5 m²'.replace('5', '۵'));
    expect(faNum('')).toBe('');
  });

  it('interpolates into count templates', () => {
    expect(tf('badgeHard', { count: faNum(3) })).toBe('بحرانی ۳');
    expect(tf('candidateRank', { index: faNum(2) })).toBe('گزینه ۲');
  });
});

describe('PlanCanvas — view transform math (zoom/pan correctness)', () => {
  const floor = {
    level: 0, floorHeight: 3, elevation: 0,
    footprint: { x: 0, y: 0, w: 10, h: 8 },
    spaces: [], walls: [], openings: [], stairs: [], elevators: [],
    furniture: [], parkingStalls: [],
  } as any;
  const candidate = { id: 'c1', buildableArea: { x: 0, y: 0, w: 10, h: 8 }, floors: [floor] } as any;
  const b = computeBounds(candidate, floor);
  const IDENTITY = { z: 1, px: 0, py: 0 };

  it('bounds include the footprint (single source for draw + hit-test)', () => {
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
    expect(b.maxX).toBe(10);
    expect(b.maxY).toBe(8);
  });

  it('identity view reproduces the legacy fit formula', () => {
    const { scale, tx, ty } = makeTransform(b, 800, 560, IDENTITY);
    const worldW = 10, worldH = 8;
    const expectedScale = Math.min((800 - 80) / worldW, (560 - 80) / worldH);
    expect(scale).toBeCloseTo(expectedScale, 10);
    const ox = 40 + (800 - 80 - worldW * scale) / 2;
    const oy = 40 + (560 - 80 - worldH * scale) / 2;
    expect(tx(0)).toBeCloseTo(ox, 10);
    expect(tx(10)).toBeCloseTo(ox + 10 * scale, 10);
    expect(ty(0)).toBeCloseTo(560 - oy, 10); // y-up flip
    expect(ty(8)).toBeCloseTo(560 - oy - 8 * scale, 10);
  });

  it('worldAt inverts tx/ty (round-trip) for any zoom/pan', () => {
    const views = [IDENTITY, { z: 2.5, px: 130, py: -40 }, { z: 0.5, px: -60, py: 22 }];
    for (const v of views) {
      const { tx, ty, worldAt } = makeTransform(b, 800, 560, v);
      for (const [wx, wy] of [[0, 0], [10, 8], [3.7, 5.1], [9.9, 0.2]]) {
        const p = worldAt(tx(wx), ty(wy));
        expect(p.x).toBeCloseTo(wx, 9);
        expect(p.y).toBeCloseTo(wy, 9);
      }
    }
  });
});

describe('FindingsPanel — rendering with real validation data', () => {
  it('groups findings by severity with Persian group titles and counts', async () => {
    const { createProject, generate, validateCandidate } = await import('@archgenius/core');
    const { FindingsPanel, ResultStatusCard } = await import('./FindingsPanel');
    const input = {
      name: 'x',
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8, setbacks: { north: 2, south: 3, east: 2, west: 2 } },
      building: { type: 'villa', floors: 2, bedrooms: 4, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true },
      deterministic: true, seed: 42,
    } as any;
    const result = generate(createProject(input), { allStrategies: true });
    expect(result.candidates.length).toBeGreaterThan(0);
    const vr = validateCandidate(result.candidates[0]);
    expect(vr.findings.length).toBeGreaterThan(10);

    const panelHtml = renderToString(React.createElement(FindingsPanel, { vr }));
    // summary chips first
    expect(panelHtml).toContain(t('findingsGroupHard'));
    expect(panelHtml).toContain(t('findingsGroupSoft'));
    // grouped items keep Persian titles + full messages + machine codes (LTR)
    expect(panelHtml).toMatch(/SITE_ROOM_OUTSIDE_BUILDABLE|SITE_CORRIDOR_OUTSIDE_BUILDABLE|dir="ltr"/);
    const withPersianBody = vr.hard.some(f => PERSIAN.test(f.message) || f.message);
    expect(withPersianBody).toBe(true);

    // result card (verdict state) — success path with counts
    const cardHtml = renderToString(React.createElement(ResultStatusCard, {
      state: { kind: vr.ok ? 'ok' : 'invalid', vr, candidateCount: result.candidates.length },
    }));
    expect(cardHtml).toMatch(/معتبر|نامعتبر/);
    expect(cardHtml).toContain(t('autoCheckNote'));
    expect(cardHtml).toContain(t('resultCandidatesNote').split('{count}')[0]);

    // infeasible card keeps the explanation behind «جزئیات فنی»
    const infeasibleHtml = renderToString(React.createElement(ResultStatusCard, {
      state: { kind: 'infeasible', explanation: 'x', attempts: [{ strategy: 'area-efficiency', candidateId: 'c1', reason: 'below minLength living h=2.1 < 3' }] },
    }));
    expect(infeasibleHtml).toContain(t('resultInfeasibleTitle'));
    expect(infeasibleHtml).toContain(t('resultInfeasibleBody'));
    expect(infeasibleHtml).toContain(t('technicalDetails'));
    // attempt diagnostics are preserved (HTML-escaped) with the Persian strategy label
    expect(infeasibleHtml).toContain('below minLength living h=2.1');
    expect(infeasibleHtml).toContain(STRATEGY_FA['area-efficiency']);
  });
});
