/**
 * Tests for multi-version regulation pack loading (ROADMAP Phase 4).
 *
 * These guard three properties:
 *   1. CATALOGUE HONESTY — the registry lists exactly the packs that exist in
 *      this repo, and an edition's "source obtained" flag is derived from the
 *      real source registry rather than asserted by hand.
 *   2. NO SILENT SUBSTITUTION — an unknown pack, an unknown edition, or an
 *      edition whose Tier-1 document is missing throws PackLoadError instead of
 *      quietly returning a different rule set.
 *   3. DEFAULT PATH UNTOUCHED — `composePacks(input)` with no selection or pin
 *      returns exactly the packs it returned before this feature existed, so no
 *      threshold, source, or verification status can have moved.
 */
import { describe, it, expect } from 'vitest';
import { IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK } from './packs/ir-national-mbr.js';
import { SOURCE_REGISTRY_DEFAULTS } from './packs/source-registry.js';
import {
  PackLoadError,
  REGULATION_PACK_FAMILIES,
  defaultEditionFor,
  isKnownPack,
  listLoadableEditions,
  listPackEditions,
  listPackFamilies,
  listPackIds,
  loadPack,
  selectPacks,
} from './pack-registry.js';
import { buildDefaultPack, composePacks } from './engine.js';
import { generateLayouts } from '../generator/generator.js';
import type { ProjectInput } from '../model/project.js';

const SITE = {
  shape: 'rectangle', width: 18, length: 25,
  accessSide: 'south', streetWidth: 8,
  setbacks: { north: 3, south: 1.5, east: 2, west: 2 },
} as unknown as ProjectInput['site'];

const INPUT: ProjectInput = {
  name: 'pack-registry', deterministic: true, seed: 42,
  site: SITE,
  building: { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true, hasStorage: false },
};

/** The 1399 Mabhas-4 revision: registered, but its PDF is NOT in sources/. */
const MABHAS4_1399 = SOURCE_REGISTRY_DEFAULTS.find((s) => s.id === 't1-mabhas4-1399')!;
const EDITION_1399 = MABHAS4_1399.edition as string;

const countVerified = (rules: Array<{ status: string }>) =>
  rules.filter((r) => r.status === 'VERIFIED').length;

// ---------------------------------------------------------------------------
// 1. Catalogue honesty
// ---------------------------------------------------------------------------
describe('pack registry — catalogue lists only what the repo actually has', () => {
  it('lists exactly the shipped packs, in declaration order', () => {
    expect(listPackIds()).toEqual([
      'ir-default-v0.1', 'ir-national-mbr', 'ir-tehran-stub',
      'ir-karaj-stub', 'ir-mashhad-stub', 'ir-isfahan-stub', 'ir-shiraz-stub',
    ]);
    expect(listPackFamilies().map((f) => f.packId)).toEqual(listPackIds());
    expect(isKnownPack('ir-national-mbr')).toBe(true);
    expect(isKnownPack('ir-tehran')).toBe(false);
    expect(isKnownPack('ir-karaj')).toBe(false);
  });

  it('marks exactly one loadable default edition per family', () => {
    for (const family of REGULATION_PACK_FAMILIES) {
      const defaults = family.editions.filter((e) => e.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].loadable).toBe(true);
      expect(defaults[0].packId).toBe(family.packId);
      // every edition belongs to its own family
      for (const e of family.editions) expect(e.packId).toBe(family.packId);
    }
  });

  it('derives source availability from the real source registry, not from hand-written claims', () => {
    const obtained = (id: string) => {
      const s = SOURCE_REGISTRY_DEFAULTS.find((x) => x.id === id)!;
      return s.verificationState === 'obtained-authenticated' && !!s.documentPath;
    };
    // sanity: the Phase-5.2 PDFs really are present, and the 1399 one really is not
    expect(obtained('t1-mabhas4-1396')).toBe(true);
    expect(obtained('t1-mabhas15-1392')).toBe(true);
    expect(obtained('t1-mabhas4-1399')).toBe(false);
    expect(MABHAS4_1399.documentPath ?? null).toBeNull();

    const national = listPackEditions('ir-national-mbr');
    expect(national).toHaveLength(2);
    const shipped = national.find((e) => e.loadable)!;
    expect(shipped.edition).toBe(IR_NATIONAL_MBR_PACK.edition);
    expect(shipped.sourceObtained).toBe(true);

    const tehran = listPackEditions('ir-tehran-stub');
    expect(tehran).toHaveLength(1);
    expect(tehran[0].loadable).toBe(true);          // advisory placeholder IS loadable
    expect(tehran[0].sourceObtained).toBe(false);  // …but no municipal source exists

    const def = listPackEditions('ir-default-v0.1');
    expect(def).toHaveLength(1);
    expect(def[0].sourceObtained).toBe(false);     // engineering assumption
  });

  it('registers the superseding 1399 revision as NOT loadable', () => {
    expect(EDITION_1399).toBeTruthy();
    const entry = listPackEditions('ir-national-mbr').find((e) => e.edition === EDITION_1399)!;
    expect(entry).toBeDefined();
    expect(entry.loadable).toBe(false);
    expect(entry.sourceObtained).toBe(false);
    expect(entry.isDefault).toBe(false);
    // the default must never be the unobtainable revision
    expect(defaultEditionFor('ir-national-mbr')).toBe(IR_NATIONAL_MBR_PACK.edition);
    expect(listLoadableEditions('ir-national-mbr')).toEqual([IR_NATIONAL_MBR_PACK.edition]);
  });

  it('returns no editions for an unknown pack instead of throwing on discovery', () => {
    expect(listPackEditions('ir-karaj')).toEqual([]);
    expect(listLoadableEditions('ir-karaj')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Loading + no silent substitution
// ---------------------------------------------------------------------------
describe('loadPack — resolves the requested edition or refuses loudly', () => {
  it('returns the identical shipped pack object for the national default edition', () => {
    expect(loadPack('ir-national-mbr')).toBe(IR_NATIONAL_MBR_PACK);
    expect(loadPack('ir-national-mbr', IR_NATIONAL_MBR_PACK.edition)).toBe(IR_NATIONAL_MBR_PACK);
    expect(loadPack('ir-tehran-stub')).toBe(IR_TEHRAN_STUB_PACK);
  });

  it('builds the assumption pack fresh each call, matching buildDefaultPack()', () => {
    const a = loadPack('ir-default-v0.1');
    const b = loadPack('ir-default-v0.1');
    expect(a).not.toBe(b);
    expect(a.id).toBe('ir-default-v0.1');
    expect(a.edition).toBe('draft-v0.1');
    expect(a.rules.map((r) => r.ruleId)).toEqual(buildDefaultPack().rules.map((r) => r.ruleId));
    // every rule stays unverified — loading cannot upgrade a status
    expect(a.rules.every((r) => r.status === 'REQUIRES_SOURCE_VERIFICATION')).toBe(true);
  });

  it('throws UNKNOWN_PACK for a pack that does not exist', () => {
    let err: unknown;
    try { loadPack('ir-karaj'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PackLoadError);
    expect(err).toBeInstanceOf(Error);
    const e = err as PackLoadError;
    expect(e.code).toBe('UNKNOWN_PACK');
    expect(e.packId).toBe('ir-karaj');
    expect(e.available).toEqual(listPackIds());
    expect(e.message).toContain('Known packs');
  });

  it('throws UNKNOWN_EDITION rather than returning another edition', () => {
    let err: unknown;
    try { loadPack('ir-national-mbr', '1385'); } catch (e) { err = e; }
    const e = err as PackLoadError;
    expect(e).toBeInstanceOf(PackLoadError);
    expect(e.code).toBe('UNKNOWN_EDITION');
    expect(e.message).toContain('1385');
    expect(e.available).toContain(IR_NATIONAL_MBR_PACK.edition);
  });

  it('throws EDITION_NOT_OBTAINED for the registered-but-missing 1399 revision', () => {
    let err: unknown;
    try { loadPack('ir-national-mbr', EDITION_1399); } catch (e) { err = e; }
    const e = err as PackLoadError;
    expect(e).toBeInstanceOf(PackLoadError);
    expect(e.code).toBe('EDITION_NOT_OBTAINED');
    expect(e.edition).toBe(EDITION_1399);
    expect(e.available).toEqual([IR_NATIONAL_MBR_PACK.edition]);
    // the message must name the missing source, not blame the caller
    expect(e.message).toContain('sources/');
    expect(e.message).toContain('Refusing to substitute');
  });

  it('never upgrades rule status or rule count through loading', () => {
    const before = { n: IR_NATIONAL_MBR_PACK.rules.length, v: countVerified(IR_NATIONAL_MBR_PACK.rules) };
    loadPack('ir-national-mbr');
    loadPack('ir-national-mbr', IR_NATIONAL_MBR_PACK.edition);
    expect(IR_NATIONAL_MBR_PACK.rules.length).toBe(before.n);
    expect(countVerified(IR_NATIONAL_MBR_PACK.rules)).toBe(before.v);
    expect(before.n).toBe(17);
    expect(before.v).toBe(9);
    expect(IR_TEHRAN_STUB_PACK.rules.every((r) => r.status === 'NOT_IMPLEMENTED')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Default composition unchanged
// ---------------------------------------------------------------------------
describe('composePacks — default behaviour is byte-identical to before this feature', () => {
  it('still composes default + national + local placeholder, 20 rules', () => {
    const packs = composePacks(INPUT);
    expect(packs.map((p) => p.id)).toEqual(['ir-default-v0.1', 'ir-national-mbr', 'ir-tehran-stub']);
    expect(packs.map((p) => p.edition)).toEqual([
      'draft-v0.1',
      IR_NATIONAL_MBR_PACK.edition,
      IR_TEHRAN_STUB_PACK.edition,
    ]);
    expect(packs.reduce((n, p) => n + p.rules.length, 0)).toBe(20);
    // same objects, not copies
    expect(packs[1]).toBe(IR_NATIONAL_MBR_PACK);
    expect(packs[2]).toBe(IR_TEHRAN_STUB_PACK);
  });

  it('ignores an empty selection and an empty pin map', () => {
    const withEmpty: ProjectInput = { ...INPUT, regulationPacks: [], regulationPackEditions: {} };
    expect(composePacks(withEmpty).map((p) => p.id)).toEqual(composePacks(INPUT).map((p) => p.id));
  });

  it('selectPacks returns the defaults untouched when nothing is requested', () => {
    const defaults = [buildDefaultPack(), IR_NATIONAL_MBR_PACK];
    const out = selectPacks(defaults, undefined, undefined);
    expect(out).not.toBe(defaults);           // fresh array
    expect(out[0]).toBe(defaults[0]);         // same pack objects
    expect(out[1]).toBe(defaults[1]);
    expect(selectPacks(defaults, null, null).map((p) => p.id)).toEqual(defaults.map((p) => p.id));
  });
});

// ---------------------------------------------------------------------------
// 4. Explicit selection / edition pinning
// ---------------------------------------------------------------------------
describe('composePacks — explicit selection and edition pinning', () => {
  it('restricts to the requested pack ids, preserving order', () => {
    const one = composePacks({ ...INPUT, regulationPacks: ['ir-national-mbr'] });
    expect(one.map((p) => p.id)).toEqual(['ir-national-mbr']);
    expect(one[0]).toBe(IR_NATIONAL_MBR_PACK);

    const ordered = composePacks({ ...INPUT, regulationPacks: ['ir-national-mbr', 'ir-default-v0.1'] });
    expect(ordered.map((p) => p.id)).toEqual(['ir-national-mbr', 'ir-default-v0.1']);
  });

  it('collapses duplicate ids so findings are not doubled', () => {
    const dup = composePacks({ ...INPUT, regulationPacks: ['ir-national-mbr', 'ir-national-mbr'] });
    expect(dup).toHaveLength(1);
  });

  it('throws UNKNOWN_PACK for a requested pack that does not exist', () => {
    let err: unknown;
    try { composePacks({ ...INPUT, regulationPacks: ['ir-tehran'] }); } catch (e) { err = e; }
    expect((err as PackLoadError).code).toBe('UNKNOWN_PACK');
  });

  it('accepts a pin to the edition that is actually shipped', () => {
    const pinned = composePacks({
      ...INPUT,
      regulationPackEditions: { 'ir-national-mbr': IR_NATIONAL_MBR_PACK.edition },
    });
    expect(pinned.map((p) => p.id)).toEqual(['ir-default-v0.1', 'ir-national-mbr', 'ir-tehran-stub']);
    expect(pinned[1]).toBe(IR_NATIONAL_MBR_PACK);
  });

  it('refuses a pin to the 1399 revision instead of falling back to 1396', () => {
    let err: unknown;
    try {
      composePacks({ ...INPUT, regulationPackEditions: { 'ir-national-mbr': EDITION_1399 } });
    } catch (e) { err = e; }
    expect((err as PackLoadError).code).toBe('EDITION_NOT_OBTAINED');
  });

  it('refuses a pin naming a pack that is not in the selection', () => {
    let err: unknown;
    try {
      composePacks({
        ...INPUT,
        regulationPacks: ['ir-national-mbr'],
        regulationPackEditions: { 'ir-tehran-stub': IR_TEHRAN_STUB_PACK.edition },
      });
    } catch (e) { err = e; }
    const e = err as PackLoadError;
    expect(e.code).toBe('PACK_NOT_SELECTED');
    expect(e.available).toEqual(['ir-national-mbr']);
  });

  it('is deterministic — repeated calls agree on ids, editions and rule order', () => {
    const snapshot = (p: ProjectInput) => composePacks(p)
      .map((pk) => `${pk.id}@${pk.edition}:${pk.rules.map((r) => r.ruleId).join('|')}`);
    const a = snapshot({ ...INPUT, regulationPacks: ['ir-national-mbr', 'ir-tehran-stub'] });
    const b = snapshot({ ...INPUT, regulationPacks: ['ir-national-mbr', 'ir-tehran-stub'] });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 5. Live through the real generator path (generator.ts calls composePacks)
// ---------------------------------------------------------------------------
describe('pack loading is live end-to-end through generateLayouts', () => {
  it('records the composed packs on candidate metadata, unchanged by default', () => {
    const candidates = generateLayouts(INPUT, ['alternative-zoning']);
    expect(candidates.length).toBeGreaterThan(0);
    const best = candidates[0];
    expect(best.metadata.regulationPacks.map((p) => p.id))
      .toEqual(['ir-default-v0.1', 'ir-national-mbr', 'ir-tehran-stub']);
    expect(best.metadata.regulationPacks.find((p) => p.id === 'ir-national-mbr')!.edition)
      .toBe(IR_NATIONAL_MBR_PACK.edition);
    expect(best.findings.filter((f) => f.severity === 'hard')).toHaveLength(0);
    expect(best.valid).toBe(true);
  });

  it('honours an explicit pack selection without changing the default run', () => {
    const selected = generateLayouts({ ...INPUT, regulationPacks: ['ir-national-mbr'] }, ['alternative-zoning']);
    expect(selected[0].metadata.regulationPacks.map((p) => p.id)).toEqual(['ir-national-mbr']);

    const baseline = generateLayouts(INPUT, ['alternative-zoning']);
    expect(baseline[0].metadata.regulationPacks).toHaveLength(3);
  });

  it('fails the whole run rather than generating against the wrong rule set', () => {
    expect(() => generateLayouts(
      { ...INPUT, regulationPackEditions: { 'ir-national-mbr': EDITION_1399 } },
      ['alternative-zoning'],
    )).toThrow(PackLoadError);
  });
});
