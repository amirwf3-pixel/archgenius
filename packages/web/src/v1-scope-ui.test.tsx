/**
 * V1 scope (UI) — rectangle is the only site geometry offered and planned.
 *
 *   - the site-shape selector offers rectangle only (L-shape / polygon hidden, dormant);
 *   - a non-rectangular form state (e.g. restored from an older saved project) is still
 *     built verbatim and rejected by the core with UNSUPPORTED_SITE_GEOMETRY — never
 *     converted to a rectangle — and the rejection is shown in Persian.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { createProject, generate } from '@archgenius/core';
import { App, DEFAULT_STATE, buildProjectInput } from './App';
import type { FormState } from './App';
import { translateEngineError, isPersianText } from './i18n';

function shapeSelect(html: string): string {
  const m = html.match(/<select[^>]*id="f-shape"[^>]*>([\s\S]*?)<\/select>/);
  expect(m).not.toBeNull();
  return m![1];
}

describe('V1 scope — rectangle-only site geometry in the UI', () => {
  it('the site-shape selector offers rectangle only', () => {
    const html = renderToString(<App />);
    const options = [...shapeSelect(html).matchAll(/<option[^>]*value="([^"]+)"/g)].map(m => m[1]);
    expect(options).toEqual(['rectangle']);
  });

  it('the default rectangle form plans through the unchanged pipeline', () => {
    const r = generate(createProject(buildProjectInput(DEFAULT_STATE)), { allStrategies: true });
    expect(r.bestCandidate).not.toBeNull();
  });

  for (const shape of ['l-shape', 'polygon'] as const) {
    it(`a ${shape} form state is rejected (not converted) with a Persian message`, () => {
      const form: FormState = { ...DEFAULT_STATE, siteShape: shape };
      const input = buildProjectInput(form);
      expect(input.site.shape).toBe(shape);
      let msg = '';
      try { createProject(input); } catch (e: any) { msg = e?.message ?? String(e); }
      expect(msg).toMatch(/^UNSUPPORTED_SITE_GEOMETRY: /);
      const fa = translateEngineError(msg);
      expect(isPersianText(fa)).toBe(true);
      expect(fa).toContain(shape);
      expect(fa).not.toContain('UNSUPPORTED_SITE_GEOMETRY');
    });
  }
});
