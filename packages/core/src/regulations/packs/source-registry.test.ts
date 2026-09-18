/**
 * Tests that guard the primary-source registry against silent fabrication.
 *
 * No rule is marked VERIFIED unless a Tier-1 PDF is actually registered in
 * sources/ with a SHA-256 digest. These tests enforce that policy.
 */
import { describe, it, expect } from 'vitest';
import { IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK } from './ir-national-mbr.js';
import { SOURCE_REGISTRY_DEFAULTS } from './source-registry.js';

describe('Source registry integrity', () => {
  it('exposes canonical Tier-1 entries for Mabhas 4, Mabhas 15, and Tehran detailed plan', () => {
    const ids = new Set(SOURCE_REGISTRY_DEFAULTS.map(s => s.id));
    expect(ids.has('t1-mabhas4-1399')).toBe(true);
    expect(ids.has('t1-mabhas4-1396')).toBe(true);
    expect(ids.has('t1-mabhas4-96-pdf')).toBe(true);
    expect(ids.has('t1-mabhas15-1392')).toBe(true);
    expect(ids.has('t1-mabhas15-92-pdf')).toBe(true);
    expect(ids.has('t1-tehran-tarh-tafsili')).toBe(true);
  });

  it('Phase 5 PDFs are recorded as not-obtained when not accessible in sandbox (honest reporting)', () => {
    const m4 = SOURCE_REGISTRY_DEFAULTS.find(s=>s.id==='t1-mabhas4-96-pdf');
    const m15 = SOURCE_REGISTRY_DEFAULTS.find(s=>s.id==='t1-mabhas15-92-pdf');
    expect(m4).toBeDefined();
    expect(m15).toBeDefined();
    expect(m4!.verificationState).toBe('not-obtained');
    expect(m15!.verificationState).toBe('not-obtained');
    expect(m4!.documentPath).toBeUndefined();
    expect(m15!.documentPath).toBeUndefined();
    expect(m4!.tier).toBe(1);
    expect(m15!.tier).toBe(1);
    // Edition must match attached files per task description.
    expect(m4!.edition).toContain('1396');
    expect(m15!.edition).toContain('1392');
  });

  it('does not mark any Tier-1 source as authenticated without a documentPath+digest', () => {
    for (const s of SOURCE_REGISTRY_DEFAULTS) {
      if (s.tier !== 1) continue;
      // If a Tier-1 source is marked obtained-authenticated, it MUST carry
      // both a documentPath and a sha256 digest.
      if (s.verificationState === 'obtained-authenticated') {
        expect(s.documentPath, `Tier-1 source ${s.id} is obtained-authenticated but lacks documentPath`).toBeTruthy();
        expect(s.digest?.algorithm, `Tier-1 source ${s.id} has no digest algorithm`).toBe('sha256');
        expect(s.digest?.value?.length, `Tier-1 source ${s.id} digest must be 64 hex chars`).toBe(64);
      } else {
        // Currently no Tier-1 document has been obtained. This test acts as
        // a reminder that when you run register-source.js to add one, you
        // must also update this assertion.
        expect(s.verificationState, `Tier-1 source ${s.id} state is unexpected`).toBe('not-obtained');
        expect(s.documentPath, `Tier-1 source ${s.id} should not have a documentPath while not-obtained`).toBeUndefined();
        expect(s.digest, `Tier-1 source ${s.id} should not have a digest while not-obtained`).toBeUndefined();
      }
    }
  });

  it('every active rule whose status is VERIFIED cites only Tier-1 sources', () => {
    const byId = new Map(SOURCE_REGISTRY_DEFAULTS.map(s => [s.id, s]));
    for (const pack of [IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK]) {
      for (const rule of pack.rules) {
        if (rule.status !== 'VERIFIED') continue;
        expect(rule.sources && rule.sources.length > 0,
          `VERIFIED rule ${rule.ruleId} has no sources[]`).toBe(true);
        for (const ref of rule.sources ?? []) {
          const src = byId.get(ref.sourceId);
          expect(src, `VERIFIED rule ${rule.ruleId} cites unknown source ${ref.sourceId}`).toBeDefined();
          expect(src!.tier,
            `VERIFIED rule ${rule.ruleId} cites non-Tier-1 source ${ref.sourceId} (tier ${src!.tier})`).toBe(1);
          expect(src!.verificationState,
            `VERIFIED rule ${rule.ruleId} cites Tier-1 source ${ref.sourceId} that is not obtained-authenticated`).toBe('obtained-authenticated');
          expect(ref.page,
            `VERIFIED rule ${rule.ruleId} must cite a page number in ${ref.sourceId}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('no currently-implemented rule is marked VERIFIED until Tier-1 PDFs land', () => {
    // When register-source.js is run and a reviewer promotes rules, this
    // test must be updated with the expected count.
    const active = IR_NATIONAL_MBR_PACK.rules.filter(r => r.status === 'VERIFIED');
    expect(active.length).toBe(0);
  });

  it('national pack separates national vs local rules correctly', () => {
    const locals = IR_NATIONAL_MBR_PACK.rules.filter(r => r.scope === 'local');
    for (const r of locals) {
      // Parking and setbacks MUST stay soft/advisory local-policy notes, not hard national rules.
      expect(['MUN-PARK-001', 'MUN-SET-001']).toContain(r.ruleId);
      expect(r.severity).not.toBe('hard');
    }
  });

  it('Tehran stub contains only NOT_IMPLEMENTED placeholder', () => {
    expect(IR_TEHRAN_STUB_PACK.rules).toHaveLength(1);
    expect(IR_TEHRAN_STUB_PACK.rules[0].ruleId).toBe('THN-000');
    expect(IR_TEHRAN_STUB_PACK.rules[0].status).toBe('NOT_IMPLEMENTED');
  });
});
