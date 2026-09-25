import { describe, it, expect } from 'vitest';
import {
  resolveMunicipality, municipalitiesIn, normalizeMunicipalityText, SUPPORTED_MUNICIPALITIES, DEFAULT_UI_JURISDICTION,
} from './municipality.js';
import {
  IR_KARAJ_STUB_PACK, IR_MASHHAD_STUB_PACK, IR_ISFAHAN_STUB_PACK, IR_SHIRAZ_STUB_PACK, MUNICIPAL_STUB_PACKS,
} from './packs/ir-municipal-stubs.js';
import { IR_TEHRAN_STUB_PACK, IR_NATIONAL_MBR_PACK } from './packs/ir-national-mbr.js';
import { SOURCE_REGISTRY_DEFAULTS } from './packs/source-registry.js';
import { composePacks, runPackRules, computeBuildableArea } from './engine.js';
import { listPackEditions, loadPack } from './pack-registry.js';
import type { ProjectInput } from '../model/project.js';

/**
 * ROADMAP.md:46 — jurisdiction-pack INFRASTRUCTURE only. No municipal rule,
 * threshold or verified status exists for any city; these tests pin that.
 */
const BASE: ProjectInput = {
  name: 'muni', deterministic: true, seed: 42,
  site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 } as ProjectInput['site'],
  building: { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true } as ProjectInput['building'],
};
const withCity = (city?: string, jurisdiction?: string, regulationJurisdiction?: string): ProjectInput => ({
  ...BASE,
  ...(regulationJurisdiction !== undefined ? { regulationJurisdiction } : {}),
  site: { ...BASE.site, ...(city !== undefined ? { city } : {}), ...(jurisdiction !== undefined ? { jurisdiction } : {}) },
});
const STUBS = [IR_KARAJ_STUB_PACK, IR_MASHHAD_STUB_PACK, IR_ISFAHAN_STUB_PACK, IR_SHIRAZ_STUB_PACK];

describe('resolveMunicipality — variants', () => {
  it.each([
    ['Tehran', 'tehran'], ['tehran', 'tehran'], ['TEHRAN', 'tehran'], ['تهران', 'tehran'], ['ir-tehran', 'tehran'], ['Tehran-Municipality-Default', 'tehran'],
    ['Karaj', 'karaj'], ['karaj', 'karaj'], ['کرج', 'karaj'], ['كرج', 'karaj'], ['ir-karaj', 'karaj'],
    ['Mashhad', 'mashhad'], ['مشهد', 'mashhad'], ['ir-mashhad', 'mashhad'],
    ['Isfahan', 'isfahan'], ['Esfahan', 'isfahan'], ['ESFAHAN', 'isfahan'], ['اصفهان', 'isfahan'], ['ir-isfahan', 'isfahan'],
    ['Shiraz', 'shiraz'], ['شیراز', 'shiraz'], ['شيراز', 'shiraz'], ['  shiraz  ', 'shiraz'],
  ])('%s → %s', (city, expected) => {
    expect(resolveMunicipality(withCity(city))).toBe(expected);
  });

  it('folds Arabic-script letter forms and drops ZWNJ/tatweel', () => {
    expect(normalizeMunicipalityText('كرج')).toBe('کرج');
    expect(normalizeMunicipalityText('شيراز')).toBe('شیراز');
    expect(normalizeMunicipalityText('اصـفهان')).toBe('اصفهان');
  });

  it('no / unsupported / non-string input → null', () => {
    expect(resolveMunicipality(withCity())).toBeNull();
    expect(resolveMunicipality(withCity(''))).toBeNull();
    expect(resolveMunicipality(withCity('Tabriz'))).toBeNull();
    expect(resolveMunicipality(withCity('ir-national'))).toBeNull();
    expect(resolveMunicipality(withCity(42 as unknown as string))).toBeNull();
  });
});

describe('resolveMunicipality — priority and conflicts (deterministic)', () => {
  it('regulationJurisdiction → site.jurisdiction → site.city', () => {
    expect(resolveMunicipality(withCity('Shiraz', 'Mashhad', 'Karaj'))).toBe('karaj');
    expect(resolveMunicipality(withCity('Shiraz', 'Mashhad'))).toBe('mashhad');
    expect(resolveMunicipality(withCity('Shiraz'))).toBe('shiraz');
    // An explicit (non-default) Tehran jurisdiction still wins over the city.
    expect(resolveMunicipality(withCity('Karaj', 'Tehran'))).toBe('tehran');
  });

  it('an unrecognised higher-priority field falls through to the next field', () => {
    expect(resolveMunicipality(withCity('Isfahan', 'unknown-municipality', 'ir-national'))).toBe('isfahan');
  });

  it('a field naming two municipalities is ambiguous and falls through', () => {
    expect(municipalitiesIn('Tehran / Karaj')).toEqual(['tehran', 'karaj']);
    expect(resolveMunicipality(withCity('Mashhad', 'Tehran-Karaj'))).toBe('mashhad');
    expect(resolveMunicipality(withCity('Shiraz and Esfahan'))).toBeNull();
  });

  it('is pure: same input → same output, input not mutated', () => {
    const p = withCity('Karaj', 'x', 'y');
    const snap = JSON.stringify(p);
    expect(resolveMunicipality(p)).toBe(resolveMunicipality(p));
    expect(JSON.stringify(p)).toBe(snap);
  });
});

describe('municipal stubs — honest placeholders only', () => {
  it('four stubs with the expected ids and codes', () => {
    expect(STUBS.map((p) => p.id)).toEqual(['ir-karaj-stub', 'ir-mashhad-stub', 'ir-isfahan-stub', 'ir-shiraz-stub']);
    expect(STUBS.map((p) => p.rules[0].ruleId)).toEqual(['KRJ-000', 'MSH-000', 'ISF-000', 'SHZ-000']);
  });

  it('each: exactly one advisory NOT_IMPLEMENTED rule, no thresholds/params/evaluator/sources, nothing VERIFIED', () => {
    for (const p of STUBS) {
      expect(p.scope).toBe('local');
      expect(p.rules).toHaveLength(1);
      const r = p.rules[0];
      expect(r.status).toBe('NOT_IMPLEMENTED');
      expect(r.severity).toBe('advisory');
      expect(r.scope).toBe('local');
      expect(r.thresholds).toBeUndefined();
      expect(r.params).toBeUndefined();
      expect(r.evaluate).toBeUndefined();
      expect(r.sources).toBeUndefined();
      expect(p.rules.some((x) => x.status === 'VERIFIED')).toBe(false);
      expect(p.description).toMatch(/NOT OBTAINED/);
      expect(r.reference).toMatch(/NOT OBTAINED/);
    }
  });

  it('source entries: not-obtained, with no URI / path / digest / edition / publisher', () => {
    for (const m of ['karaj', 'mashhad', 'isfahan', 'shiraz']) {
      const s = SOURCE_REGISTRY_DEFAULTS.find((x) => x.id === `t1-${m}-municipal-source`)!;
      expect(s).toBeDefined();
      expect(s.jurisdiction).toBe(`ir-${m}`);
      expect(s.verificationState).toBe('not-obtained');
      for (const k of ['uri', 'documentPath', 'digest', 'edition', 'publisher', 'publicationDate', 'effectiveDate', 'retrievedAt'] as const) {
        expect(s[k], `${s.id}.${k}`).toBeUndefined();
      }
      // The pack carries the very same registry object — not a restated copy.
      expect(MUNICIPAL_STUB_PACKS[m as 'karaj'].sourceRegistry).toEqual([s]);
    }
  });

  it('existing Tehran placeholder and national pack are untouched objects', () => {
    expect(IR_TEHRAN_STUB_PACK.rules.map((r) => r.ruleId)).toEqual(['THN-000']);
    expect(IR_NATIONAL_MBR_PACK.rules.filter((r) => r.scope === 'local').every((r) => r.status !== 'VERIFIED')).toBe(true);
  });

  it('engine output for a stub is a single advisory, passing, NOT_IMPLEMENTED missing-data note', () => {
    for (const p of STUBS) {
      const out = runPackRules([p], BASE, computeBuildableArea(BASE));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ pass: true, severity: 'advisory', code: p.rules[0].ruleId, status: 'NOT_IMPLEMENTED' });
      expect(out[0].message).toMatch(/NOT OBTAINED/);
    }
  });
});

describe('composePacks — each recognised city gets its OWN stub, never Tehran', () => {
  const localOf = (inp: ProjectInput) => composePacks(inp).filter((p) => p.scope === 'local');
  it.each([
    ['Karaj', IR_KARAJ_STUB_PACK], ['کرج', IR_KARAJ_STUB_PACK],
    ['Mashhad', IR_MASHHAD_STUB_PACK], ['مشهد', IR_MASHHAD_STUB_PACK],
    ['Isfahan', IR_ISFAHAN_STUB_PACK], ['Esfahan', IR_ISFAHAN_STUB_PACK], ['اصفهان', IR_ISFAHAN_STUB_PACK],
    ['Shiraz', IR_SHIRAZ_STUB_PACK], ['شیراز', IR_SHIRAZ_STUB_PACK],
  ])('%s', (city, pack) => {
    const local = localOf(withCity(city));
    expect(local).toEqual([pack]);
    expect(local[0]).toBe(pack);
    expect(local.some((p) => p.id === 'ir-tehran-stub')).toBe(false);
  });

  it('Tehran, no city and unrecognised city keep the Tehran placeholder (unchanged)', () => {
    for (const inp of [withCity('Tehran'), withCity('تهران'), withCity(), withCity('Tabriz')]) {
      expect(composePacks(inp).map((p) => p.id)).toEqual(['ir-default-v0.1', 'ir-national-mbr', 'ir-tehran-stub']);
      expect(composePacks(inp)[2]).toBe(IR_TEHRAN_STUB_PACK);
    }
  });

  it('non-Iranian projects still get no local pack', () => {
    expect(composePacks({ ...withCity('Karaj'), country: 'de' }).some((p) => p.scope === 'local')).toBe(false);
  });

  it('pack registry: four new families, loadable placeholders, source never obtained', () => {
    for (const p of STUBS) {
      const eds = listPackEditions(p.id);
      expect(eds).toHaveLength(1);
      expect(eds[0]).toMatchObject({ loadable: true, isDefault: true, sourceObtained: false });
      expect(loadPack(p.id)).toBe(p);
    }
    expect(SUPPORTED_MUNICIPALITIES).toEqual(['tehran', 'karaj', 'mashhad', 'isfahan', 'shiraz']);
  });
});

describe('web-form default jurisdiction is weak — an explicit city is not silently routed to Tehran', () => {
  const DEF = 'Tehran-Municipality-Default';
  const local = (inp: ProjectInput) => composePacks(inp).filter((p) => p.scope === 'local');
  const TEHRAN_DEFAULT_IDS = ['ir-default-v0.1', 'ir-national-mbr', 'ir-tehran-stub'];

  it('the constant is the exact web-form default value', () => {
    expect(DEFAULT_UI_JURISDICTION).toBe(DEF);
  });

  it.each([
    ['Karaj', IR_KARAJ_STUB_PACK],
    ['Mashhad', IR_MASHHAD_STUB_PACK],
    ['Isfahan', IR_ISFAHAN_STUB_PACK],
    ['Shiraz', IR_SHIRAZ_STUB_PACK],
  ])('default Tehran jurisdiction + city %s → its own stub', (city, pack) => {
    // Default in site.jurisdiction (what the web form sends) …
    expect(local(withCity(city, DEF))).toEqual([pack]);
    expect(local(withCity(city, DEF))[0]).toBe(pack);
    // … and in regulationJurisdiction, and in both.
    expect(local(withCity(city, undefined, DEF))[0]).toBe(pack);
    expect(local(withCity(city, DEF, DEF))[0]).toBe(pack);
  });

  it('default Tehran jurisdiction + city in Persian → its own stub', () => {
    expect(local(withCity('کرج', DEF))[0]).toBe(IR_KARAJ_STUB_PACK);
    expect(local(withCity('اصفهان', DEF))[0]).toBe(IR_ISFAHAN_STUB_PACK);
  });

  it('explicit Tehran jurisdiction + city Karaj → Tehran remains authoritative', () => {
    for (const tehran of ['Tehran', 'ir-tehran', 'تهران']) {
      expect(resolveMunicipality(withCity('Karaj', undefined, tehran))).toBe('tehran');
      expect(resolveMunicipality(withCity('Karaj', tehran))).toBe('tehran');
      expect(local(withCity('Karaj', undefined, tehran))[0]).toBe(IR_TEHRAN_STUB_PACK);
    }
  });

  it('explicit recognised regulationJurisdiction stays authoritative over the default and the city', () => {
    expect(resolveMunicipality(withCity('Shiraz', DEF, 'Karaj'))).toBe('karaj');
  });

  it('no city → existing Tehran stub behaviour (with or without the default)', () => {
    for (const inp of [withCity(), withCity(undefined, DEF), withCity(undefined, undefined, DEF)]) {
      expect(composePacks(inp).map((p) => p.id)).toEqual(TEHRAN_DEFAULT_IDS);
      expect(composePacks(inp)[2]).toBe(IR_TEHRAN_STUB_PACK);
    }
    expect(resolveMunicipality(withCity(undefined, DEF))).toBe('tehran');
  });

  it('default + unknown / ambiguous city → existing Tehran stub behaviour', () => {
    for (const city of ['Tabriz', 'Shiraz and Esfahan']) {
      expect(composePacks(withCity(city, DEF)).map((p) => p.id)).toEqual(TEHRAN_DEFAULT_IDS);
    }
  });

  it('default + explicit Tehran city → Tehran; only the exact default string is weak', () => {
    expect(resolveMunicipality(withCity('Tehran', DEF))).toBe('tehran');
    expect(resolveMunicipality(withCity('Karaj', '  tehran-municipality-default  '))).toBe('karaj');
    expect(resolveMunicipality(withCity('Karaj', 'Tehran-Municipality'))).toBe('tehran');
  });
});
