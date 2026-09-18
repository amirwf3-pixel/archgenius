/**
 * Tests that guard the primary-source registry against silent fabrication.
 *
 * Phase 5.2: Tier-1 PDFs ARE now present and authenticated.
 */

import { describe, it, expect } from 'vitest';
import { IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK } from './ir-national-mbr.js';
import { SOURCE_REGISTRY_DEFAULTS } from './source-registry.js';

describe('Source registry integrity — Phase 5.2', () => {
  it('exposes canonical Tier-1 entries for Mabhas 4, Mabhas 15, and Tehran detailed plan', () => {
    const ids = new Set(SOURCE_REGISTRY_DEFAULTS.map(s => s.id));
    expect(ids.has('t1-mabhas4-1399')).toBe(true);
    expect(ids.has('t1-mabhas4-1396')).toBe(true);
    expect(ids.has('t1-mabhas4-96-pdf')).toBe(true);
    expect(ids.has('t1-mabhas15-1392')).toBe(true);
    expect(ids.has('t1-mabhas15-92-pdf')).toBe(true);
    expect(ids.has('t1-tehran-tarh-tafsili')).toBe(true);
  });

  it('Phase 5.2 PDFs are recorded as obtained-authenticated with SHA-256 and documentPath', () => {
    const m4 = SOURCE_REGISTRY_DEFAULTS.find(s => s.id === 't1-mabhas4-96-pdf');
    const m15 = SOURCE_REGISTRY_DEFAULTS.find(s => s.id === 't1-mabhas15-92-pdf');
    const m4b = SOURCE_REGISTRY_DEFAULTS.find(s => s.id === 't1-mabhas4-1396');
    const m15b = SOURCE_REGISTRY_DEFAULTS.find(s => s.id === 't1-mabhas15-1392');
    expect(m4).toBeDefined();
    expect(m15).toBeDefined();
    expect(m4!.verificationState).toBe('obtained-authenticated');
    expect(m15!.verificationState).toBe('obtained-authenticated');
    expect(m4b!.verificationState).toBe('obtained-authenticated');
    expect(m15b!.verificationState).toBe('obtained-authenticated');
    expect(m4!.documentPath).toBe('sources/mabhas4-96.pdf');
    expect(m15!.documentPath).toBe('sources/mabhas-15.pdf');
    expect(m4!.tier).toBe(1);
    expect(m15!.tier).toBe(1);
    expect(m4!.edition).toContain('1396');
    expect(m15!.edition).toContain('1392');
    expect(m4!.digest!.value).toBe('ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6');
    expect(m15!.digest!.value).toBe('e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477');
    expect(m4!.digest!.value.length).toBe(64);
  });

  it('Tier-1 obtained-authenticated sources must have documentPath+digest', () => {
    for (const s of SOURCE_REGISTRY_DEFAULTS) {
      if (s.tier !== 1) continue;
      if (s.verificationState === 'obtained-authenticated') {
        expect(s.documentPath, `Tier-1 source ${s.id} lacks documentPath`).toBeTruthy();
        expect(s.digest?.algorithm, `Tier-1 source ${s.id} has no digest algorithm`).toBe('sha256');
        expect(s.digest?.value?.length, `Tier-1 source ${s.id} digest must be 64 hex chars`).toBe(64);
      }
    }
    // At least 4 Tier-1 sources should be authenticated now
    const auth = SOURCE_REGISTRY_DEFAULTS.filter(s => s.tier === 1 && s.verificationState === 'obtained-authenticated');
    expect(auth.length).toBeGreaterThanOrEqual(4);
  });

  it('every VERIFIED rule cites only Tier-1 obtained-authenticated sources with page', () => {
    const byId = new Map(SOURCE_REGISTRY_DEFAULTS.map(s => [s.id, s]));
    for (const pack of [IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK]) {
      for (const rule of pack.rules) {
        if (rule.status !== 'VERIFIED') continue;
        expect(rule.sources && rule.sources.length > 0, `VERIFIED rule ${rule.ruleId} has no sources[]`).toBe(true);
        for (const ref of rule.sources ?? []) {
          const src = byId.get(ref.sourceId);
          expect(src, `VERIFIED rule ${rule.ruleId} cites unknown source ${ref.sourceId}`).toBeDefined();
          expect(src!.tier, `VERIFIED rule ${rule.ruleId} cites non-Tier-1 source ${ref.sourceId} (tier ${src!.tier})`).toBe(1);
          expect(src!.verificationState, `VERIFIED rule ${rule.ruleId} cites Tier-1 source ${ref.sourceId} that is not obtained-authenticated`).toBe('obtained-authenticated');
          expect(ref.page, `VERIFIED rule ${rule.ruleId} must cite a page number in ${ref.sourceId}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('VERIFIED count matches Phase 5.2 audit (at least 9 rules)', () => {
    const active = IR_NATIONAL_MBR_PACK.rules.filter(r => r.status === 'VERIFIED');
    expect(active.length).toBeGreaterThanOrEqual(9);
    const ids = active.map(r => r.ruleId);
    expect(ids).toContain('MBH4-ROOM-001');
    expect(ids).toContain('MBH4-ROOM-007');
    expect(ids).toContain('MBH4-STAIR-003');
  });

  it('national pack separates national vs local rules correctly', () => {
    const locals = IR_NATIONAL_MBR_PACK.rules.filter(r => r.scope === 'local');
    for (const r of locals) {
      expect(['MUN-PARK-001', 'MUN-SET-001']).toContain(r.ruleId);
      expect(r.severity).not.toBe('hard');
      expect(r.status).toBe('REQUIRES_SOURCE_VERIFICATION');
    }
  });

  it('Tehran stub contains only NOT_IMPLEMENTED placeholder', () => {
    expect(IR_TEHRAN_STUB_PACK.rules).toHaveLength(1);
    expect(IR_TEHRAN_STUB_PACK.rules[0].ruleId).toBe('THN-000');
    expect(IR_TEHRAN_STUB_PACK.rules[0].status).toBe('NOT_IMPLEMENTED');
  });

  it('no VERIFIED rule has fabricated hash — digests match known PDFs', () => {
    const known = new Set([
      'ff5b351c7c1dd9b25d589cdc74cf7d9d91f539df79ee3222385ba1ab82a5a2b6',
      'e27e1d74e6ded86ecfe6399b524b612d2cf6fdd2da4c6a36df7d94a3ed6ea477',
    ]);
    for (const s of SOURCE_REGISTRY_DEFAULTS) {
      if (s.tier === 1 && s.verificationState === 'obtained-authenticated') {
        expect(known.has(s.digest!.value), `Unknown digest ${s.digest!.value} for ${s.id}`).toBe(true);
      }
    }
  });
});
