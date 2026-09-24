/**
 * Phase 4 roadmap — Regulation Explorer tests.
 *
 * Pins the trust contract of the read-only regulation browser:
 *   1. a VERIFIED rule shows its status badge plus its reference/source;
 *   2. REQUIRES_SOURCE_VERIFICATION is visibly distinct and never "ok"-styled;
 *   3. NOT_IMPLEMENTED is framed as advisory, never as compliance;
 *   4. a missing/unknown status renders no badge and never crashes;
 *   5. the explorer lists EVERY rule of EVERY composed pack (no silent drops);
 *   6. FindingsPanel shows the status beside the ruleId only when present.
 *
 * SSR rendering (node environment, no DOM) — same pattern as ui.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { composePacks } from '@archgenius/core';
import type { ProjectInput, ValidationResult, Finding } from '@archgenius/core';
import { RuleStatusBadge } from './components';
import { RegulationExplorer } from './RegulationExplorer';
import { FindingsPanel } from './FindingsPanel';
import { RULE_STATUS_FA, t } from './i18n';

const PERSIAN = /[\u0600-\u06FF]/;

/**
 * Canonical 18×25 site. NOTE: the core reads `site.setbacks` as a nested
 * object at runtime (App.tsx builds the same shape via `const site: any`),
 * while `SiteInput` declares flat `setbackNorth?` fields — a pre-existing
 * core type/runtime mismatch. Core is frozen for this task, so mirror
 * App.tsx's cast rather than change the type.
 */
const SITE_18x25 = {
  shape: 'rectangle', width: 18, length: 25,
  accessSide: 'south', streetWidth: 8,
  setbacks: { north: 3, south: 1.5, east: 2, west: 2 },
} as unknown as ProjectInput['site'];

const INPUT: ProjectInput = {
  name: 'regression-explorer', deterministic: true, seed: 42,
  site: SITE_18x25,
  building: { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true, hasStorage: false },
};

const render = (el: React.ReactElement) => renderToString(el);

/**
 * Mirror React's SSR text escaping so raw source strings (some clauses contain
 * "<75", "&" etc.) can be compared against the rendered markup.
 */
const esc = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#x27;');

/** All rules of all packs the engine composes for INPUT — the completeness oracle. */
const ALL_PACKS = composePacks(INPUT);
const ALL_RULES = ALL_PACKS.flatMap(p => p.rules);

// ---------------------------------------------------------------------------
// 1-4. RuleStatusBadge
// ---------------------------------------------------------------------------

describe('RuleStatusBadge — status is never colour alone, never invented', () => {
  it('VERIFIED renders an ok-styled badge with a Persian label', () => {
    const html = render(React.createElement(RuleStatusBadge, { status: 'VERIFIED' }));
    expect(html).toContain('data-rule-status="VERIFIED"');
    expect(html).toContain('badge-ok');
    expect(html).toContain(RULE_STATUS_FA.VERIFIED);
    expect(PERSIAN.test(RULE_STATUS_FA.VERIFIED)).toBe(true);
  });

  it('REQUIRES_SOURCE_VERIFICATION is visibly distinct and NOT ok-styled', () => {
    const verified = render(React.createElement(RuleStatusBadge, { status: 'VERIFIED' }));
    const unverified = render(React.createElement(RuleStatusBadge, { status: 'REQUIRES_SOURCE_VERIFICATION' }));
    expect(unverified).toContain('data-rule-status="REQUIRES_SOURCE_VERIFICATION"');
    expect(unverified).toContain('badge-soft');
    expect(unverified).not.toContain('badge-ok');
    // distinct class AND distinct Persian wording
    expect(unverified).not.toContain(RULE_STATUS_FA.VERIFIED);
    expect(RULE_STATUS_FA.REQUIRES_SOURCE_VERIFICATION).not.toBe(RULE_STATUS_FA.VERIFIED);
    expect(verified).not.toBe(unverified);
  });

  it('NOT_IMPLEMENTED is framed as advisory/informational, never as compliance', () => {
    const html = render(React.createElement(RuleStatusBadge, { status: 'NOT_IMPLEMENTED' }));
    expect(html).toContain('data-rule-status="NOT_IMPLEMENTED"');
    expect(html).toContain('badge-adv');
    expect(html).not.toContain('badge-ok');
    // advisory framing: the Persian label itself says "not implemented (informational)"
    expect(RULE_STATUS_FA.NOT_IMPLEMENTED).toContain('پیاده‌سازی‌نشده');
    expect(RULE_STATUS_FA.NOT_IMPLEMENTED).toContain('اطلاعی');
  });

  it('DEPRECATED is muted and distinct from VERIFIED', () => {
    const html = render(React.createElement(RuleStatusBadge, { status: 'DEPRECATED' }));
    expect(html).toContain('data-rule-status="DEPRECATED"');
    expect(html).toContain('badge-neutral');
    expect(html).not.toContain('badge-ok');
  });

  it('missing status renders NO badge (never dressed up as verified)', () => {
    expect(render(React.createElement(RuleStatusBadge, { status: undefined }))).toBe('');
    expect(render(React.createElement(RuleStatusBadge, {}))).toBe('');
    expect(render(React.createElement(RuleStatusBadge, { status: '' }))).toBe('');
  });

  it('an unknown status string degrades gracefully instead of crashing', () => {
    const html = render(React.createElement(RuleStatusBadge, { status: 'SOMETHING_NEW' }));
    expect(html).toContain('data-rule-status="SOMETHING_NEW"');
    expect(html).toContain('SOMETHING_NEW');
    expect(html).toContain('badge-neutral');
    expect(html).not.toContain('badge-ok');
  });
});

// ---------------------------------------------------------------------------
// 5. RegulationExplorer — completeness + source references
// ---------------------------------------------------------------------------

describe('RegulationExplorer — read-only, complete, source-referenced', () => {
  const html = render(React.createElement(RegulationExplorer, { input: INPUT }));

  it('lists every composed pack', () => {
    expect(ALL_PACKS.length).toBeGreaterThan(0);
    for (const p of ALL_PACKS) expect(html).toContain(p.id);
  });

  it('does NOT silently drop rules — one row per rule of every pack', () => {
    const rows = html.match(/data-rule-id="/g) ?? [];
    expect(rows.length).toBe(ALL_RULES.length);
    for (const r of ALL_RULES) expect(html).toContain(`data-rule-id="${r.ruleId}"`);
  });

  it('a VERIFIED rule shows its status badge, reference and source clause/page', () => {
    const verified = ALL_RULES.find(r => r.status === 'VERIFIED' && r.reference && r.sources?.[0]?.clause);
    expect(verified).toBeTruthy();
    expect(html).toContain('data-rule-status="VERIFIED"');
    expect(html).toContain(verified!.ruleId);
    expect(html).toContain(esc(verified!.reference!));
    expect(html).toContain(esc(verified!.sources![0].clause));
    if (typeof verified!.sources![0].page === 'number') {
      expect(html).toContain(t('regPage'));
    }
  });

  it('REQUIRES_SOURCE_VERIFICATION rules appear and are distinguishable from VERIFIED', () => {
    const unverified = ALL_RULES.filter(r => r.status === 'REQUIRES_SOURCE_VERIFICATION');
    expect(unverified.length).toBeGreaterThan(0);
    expect(html).toContain('data-rule-status="REQUIRES_SOURCE_VERIFICATION"');
    expect(html.match(/data-rule-status="REQUIRES_SOURCE_VERIFICATION"/g)!.length).toBe(unverified.length);
  });

  it('NOT_IMPLEMENTED rules appear with advisory framing', () => {
    const ni = ALL_RULES.filter(r => r.status === 'NOT_IMPLEMENTED');
    expect(ni.length).toBeGreaterThan(0);
    expect(html.match(/data-rule-status="NOT_IMPLEMENTED"/g)!.length).toBe(ni.length);
    expect(html).toContain(RULE_STATUS_FA.NOT_IMPLEMENTED);
  });

  it('renders source tier when present', () => {
    const tiered = ALL_RULES.find(r => typeof r.sourceTier === 'number');
    expect(tiered).toBeTruthy();
    expect(html).toContain(t('regSourceTier'));
  });

  it('states explicitly that presence is not compliance', () => {
    expect(html).toContain(t('regComplianceNote'));
    expect(html).toContain(t('regExplorerHint'));
  });

  it('rules with no recorded source degrade to an explicit note, not a blank cell', () => {
    const noSource = ALL_RULES.find(r => !r.sources || r.sources.length === 0);
    expect(noSource).toBeTruthy();
    expect(html).toContain(t('regSourceNone'));
  });

  it('is Persian/RTL and does not leak untranslated English labels', () => {
    expect(PERSIAN.test(t('regExplorerTitle'))).toBe(true);
    expect(PERSIAN.test(t('regExplorerHint'))).toBe(true);
    expect(PERSIAN.test(t('regComplianceNote'))).toBe(true);
    expect(PERSIAN.test(t('regSourceNone'))).toBe(true);
    expect(PERSIAN.test(t('regNoReference'))).toBe(true);
  });

  it('handles a null input without crashing (nothing generated yet)', () => {
    const empty = render(React.createElement(RegulationExplorer, { input: null }));
    expect(empty).toContain(t('regExplorerEmpty'));
    expect(empty).not.toContain('data-rule-id="');
  });
});

// ---------------------------------------------------------------------------
// 6. FindingsPanel — status beside the ruleId, only when present
// ---------------------------------------------------------------------------

function vr(findings: Finding[]): ValidationResult {
  return {
    ok: findings.every(f => f.severity !== 'hard'),
    findings,
    hard: findings.filter(f => f.severity === 'hard'),
    soft: findings.filter(f => f.severity === 'soft'),
    advisory: findings.filter(f => f.severity === 'advisory'),
  };
}

describe('FindingsPanel — rule status beside ruleId', () => {
  it('shows the status badge for a finding that carries one', () => {
    const html = render(React.createElement(FindingsPanel, {
      vr: vr([{ code: 'MBH4-ROOM-001', ruleId: 'MBH4-ROOM-001', severity: 'advisory', message: 'x', entityIds: [], status: 'VERIFIED' } as Finding]),
    }));
    expect(html).toContain('MBH4-ROOM-001');
    expect(html).toContain('data-rule-status="VERIFIED"');
  });

  it('renders no badge for a finding without a status, and does not crash', () => {
    const html = render(React.createElement(FindingsPanel, {
      vr: vr([{ code: 'GEO_SELF_INTERSECT', severity: 'advisory', message: 'y', entityIds: [] } as Finding]),
    }));
    expect(html).toContain('GEO_SELF_INTERSECT');
    expect(html).not.toContain('data-rule-status=');
  });
});
