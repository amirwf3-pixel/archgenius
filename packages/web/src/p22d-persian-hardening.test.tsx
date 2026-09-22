/**
 * P22-D regression tests — Persian UI hardening.
 *
 * Locks in the four Phase 22-C findings:
 *   1. every engine-emitted finding code carries a Persian human-readable title
 *      (the machine code itself stays untranslated);
 *   2. MBH4-ROOM-* finding messages show Persian room labels, never raw English
 *      labels like "Bedroom 1" (dimensions/technical values stay verbatim);
 *   3. known engine exceptions translate to Persian via translateEngineError;
 *   4. the header version is derived from the release package.json (no stale
 *      hard-coded version).
 * Plus: the FindingsPanel renders no accidental English outside the intentional
 * allowlist (machine codes, entity ids, units, numbers).
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './App';
import { FindingsPanel } from './FindingsPanel';
import {
  FINDING_CODE_FA,
  findingCodeTitle,
  findingMessageFa,
  translateEngineError,
  isPersianText,
} from './i18n';
import { createProject, generate, validateLayout } from '@archgenius/core';

const PERSIAN = /[\u0600-\u06FF]/;
const dir = path.dirname(fileURLToPath(import.meta.url));
const rootVersion = JSON.parse(
  fs.readFileSync(path.join(dir, '../../../package.json'), 'utf-8'),
).version as string;

const CASE_B = {
  site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 },
  building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: false },
  seed: 42,
} as any;

/** Engine-emitted finding codes harvested across a deterministic scenario battery. */
function harvestEmittedCodes(): Set<string> {
  const scenarios = [
    CASE_B,
    { site: { shape: 'rectangle', width: 14, length: 22, accessSide: 'south', streetWidth: 8 }, building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStorage: false }, seed: 42 },
    { site: { shape: 'rectangle', width: 13.7, length: 21.4, accessSide: 'east', streetWidth: 8 }, building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'semi-open', parkingSpaces: 0, hasStorage: false }, seed: 42 },
    // honest-infeasible scenario (exercises NC-path diagnostics)
    { site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8 }, building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStorage: false }, seed: 42 },
    // stress scenario (apartment type, open kitchen, storage)
    { site: { shape: 'rectangle', width: 15, length: 26, accessSide: 'south', streetWidth: 8 }, building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'open', parkingSpaces: 1, hasStair: true, hasStorage: true }, seed: 42 },
  ];
  const codes = new Set<string>();
  for (const input of scenarios) {
    const res: any = generate(createProject(input));
    if (res.bestCandidate) {
      const vr: any = validateLayout(res.bestCandidate);
      for (const f of [...vr.hard, ...vr.soft, ...vr.advisory]) if (f.code) codes.add(f.code);
    } else if (res.infeasible) {
      for (const a of res.infeasible.attempts ?? []) {
        for (const mt of (a.reason ?? '').matchAll(/[A-Z][A-Z0-9]+(?:[-_][A-Z0-9]+)+/g)) codes.add(mt[0]);
      }
    }
  }
  return codes;
}

describe('P22-D — every engine-emitted finding code has a Persian title', () => {
  it('static required set (Phase 22-C audit) all have Persian titles', () => {
    const required = [
      'CONSTRAINT_DIRECT_ACCESS', 'CONSTRAINT_MUST_SEPARATED', 'CONSTRAINT_PREFER_ADJACENT',
      'CONSTRAINT_PREFER_SEPARATED', 'CONSTRAINT_PRIVACY', 'DEF-PARK-001', 'DEF-SETBACK-001',
      'GEO_ROOMS_OVERLAP', 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION', 'HARD_RULE_VIOLATION',
      'INTERFLOOR_ACCESS_MISSING', 'INTERFLOOR_CIRCULATION_MISSING', 'INTERFLOOR_ENTRANCE_VERTICAL_LONG',
      'INTERFLOOR_PRIVACY_WEAK', 'REG_FAKE_TEST', 'ROOM_CONSTRAINT_ASPECT_RATIO',
      'ROOM_CONSTRAINT_MAX_AREA', 'ROOM_CONSTRAINT_MIN_AREA', 'ROOM_CONSTRAINT_MIN_LENGTH',
      'ROOM_CONSTRAINT_MIN_WIDTH', 'SITE_FURNITURE_OUTSIDE_BUILDABLE', 'SITE_FURNITURE_OUTSIDE_ROOM',
      'SITE_GEOM_INVALID', 'SITE_INSUFFICIENT_BUILDABLE', 'SITE_INVALID_POLYGON',
      'SITE_OPENING_HOST_WALL_OUTSIDE', 'SITE_OPENING_OUTSIDE_BUILDABLE', 'SITE_PARKING_OUTSIDE_SITE',
      'SITE_PARKING_OVERLAPS_BUILDING', 'SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE', 'SITE_STAIR_OUTSIDE_BUILDABLE',
      'SITE_WALL_OUTSIDE_BUILDABLE', 'SITE_ZERO_AREA', 'STACKING_INEFFICIENT',
      'VERT_CIRC_INVALID_STAIR', 'VERT_CIRC_MISALIGNED', 'VERT_CIRC_MISSING_STAIR',
    ];
    for (const code of required) {
      expect(FINDING_CODE_FA[code], `missing FINDING_CODE_FA title for ${code}`).toBeDefined();
      expect(isPersianText(findingCodeTitle(code)), `title for ${code} is not Persian`).toBe(true);
    }
  });

  it('dynamically emitted codes across the scenario battery all have Persian titles', () => {
    const codes = harvestEmittedCodes();
    expect(codes.size).toBeGreaterThan(20);
    const missing = [...codes].filter(c => !FINDING_CODE_FA[c] || !isPersianText(findingCodeTitle(c)));
    expect(missing, `codes without Persian titles: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('P22-D — MBH4-ROOM messages use Persian room labels', () => {
  it('replaces quoted English room labels, keeps dimensions verbatim', () => {
    const out = findingMessageFa({
      code: 'MBH4-ROOM-001',
      message: 'اتاق "Bedroom 1" با عرض 2.50 m باریک‌تر از حد 2.7 m مبحث چهار §7-1-1-8.',
    });
    expect(out).toContain('اتاق خواب 1');
    expect(out).not.toContain('"Bedroom 1"');
    expect(out).toContain('2.50 m');
    expect(out).toContain('2.7 m');
    expect(out).toContain('§7-1-1-8');
  });
  it('maps master rooms and leaves unknown labels untouched', () => {
    const out = findingMessageFa({
      code: 'MBH4-ROOM-002',
      message: 'اتاق "Master Bedroom" با مساحت کافی است.',
    });
    expect(out).toContain('اتاق خواب مستر');
    const unknown = findingMessageFa({ code: 'MBH4-ROOM-001', message: 'اتاق "Panic Room" تست.' });
    expect(unknown).toContain('"Panic Room"');
  });
});

describe('P22-D — engine exceptions translate before display', () => {
  it('known engine exceptions render in Persian', () => {
    for (const msg of [
      'Move would place room outside buildable boundary',
      'Space bedroom-0-003 is locked for position/geometry',
      'Floor 2 not found',
      'Move results in invalid polygon: self-intersection',
    ]) {
      const out = translateEngineError(msg);
      expect(isPersianText(out), `"${msg}" did not translate`).toBe(true);
      expect(out).not.toBe(msg);
    }
  });
});

describe('P22-D — header version derives from package.json', () => {
  it('SSR header shows the release version, never the stale hard-coded one', () => {
    const html = renderToString(React.createElement(App));
    expect(html).toContain(`v${rootVersion}`);
    expect(html).not.toContain('v1.0.1');
    expect(rootVersion).not.toBe('1.0.1');
  });
});

describe('P22-D — FindingsPanel has no accidental English', () => {
  // Intentional technical tokens: finding codes (underscore/hyphen/dot forms),
  // regulation status words (VERIFIED, NOT_IMPLEMENTED), entity ids, source file
  // paths, units/numbers — everything the i18n contract documents as untranslated.
  const ALLOW = new RegExp([
    '[A-Z][A-Z0-9_]+(?:[-._][A-Z0-9]+)*',          // codes + acronyms: MBH4-ROOM-001, ROOM_DAYLIGHT_QUALITY, VERIFIED
    '\\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+-\\d+-\\d+',  // entity ids: kitchen-0-005
    '\\b[a-z][a-z0-9-]*/[a-z0-9.\\-]+',            // source paths: sources/mabhas4-96.pdf
    '\\b[a-z0-9]+(?:-[a-z0-9]+)*\\.(?:pdf|json|ts|md)\\b',
    '\\b[a-z]+(?:-[a-z0-9]+){1,3}\\b',             // hyphenated technical tokens: source-registry
    '\\b\\d+(?:\\.\\d+)?\\s*(?:m|m²|mm|%|m2)\\b',
    '[0-9]+',
    '§[0-9\\-()§\\s]+',
    '[·:;()\\u060C,.%\\s\\u200c«»-]',
  ].join('|'), 'g');

  function stripAllowlisted(s: string): string {
    return s.replace(ALLOW, ' ');
  }

  it('rendered findings on a real validation contain Persian text outside the allowlist', () => {
    const res: any = generate(createProject(CASE_B));
    const vr: any = validateLayout(res.bestCandidate);
    const html = renderToString(React.createElement(FindingsPanel, { vr }, null));
    const texts = (html.match(/>([^<>]+)</g) ?? []).map(s => s.slice(1, -1).trim()).filter(t => t.length > 0);
    expect(texts.length).toBeGreaterThan(10);
    const english: string[] = [];
    for (const t of texts) {
      const rest = stripAllowlisted(t).replace(/[\u0600-\u06FF\uFB8A\u067E\u0686\u06AF\u06CC]/g, '');
      if (/[A-Za-z]{2,}/.test(rest)) english.push(t);
    }
    expect(english, `accidental English strings: ${JSON.stringify(english)}`).toEqual([]);
  });

  it('duplicate code chip is rendered once (MBH4-ROOM-001 · MBH4-ROOM-001 regression)', () => {
    const res: any = generate(createProject(CASE_B));
    const vr: any = validateLayout(res.bestCandidate);
    const html = renderToString(React.createElement(FindingsPanel, { vr }, null));
    expect(html).not.toContain('MBH4-ROOM-001 · MBH4-ROOM-001');
  });
});
