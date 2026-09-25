/**
 * Municipal placeholder packs — ROADMAP.md:46 infrastructure ONLY.
 *
 * Karaj, Mashhad, Isfahan and Shiraz have NO municipal regulation source in
 * sources/. Each pack therefore ships exactly one rule, status NOT_IMPLEMENTED,
 * severity advisory, with no thresholds, no params, no evaluator and no source
 * citation. The engine turns a NOT_IMPLEMENTED rule into a single advisory
 * missing-data notice (title + pack description); nothing here is a
 * requirement and nothing may be presented as compliance.
 *
 * The existing Tehran placeholder (IR_TEHRAN_STUB_PACK) is unchanged.
 */
import type { RegulationPack, RegulationSource } from '../types.js';
import type { Municipality } from '../municipality.js';
import { SOURCE_REGISTRY_DEFAULTS } from './source-registry.js';

function registrySource(id: string): RegulationSource {
  const s = SOURCE_REGISTRY_DEFAULTS.find((x) => x.id === id);
  if (!s) throw new Error(`ir-municipal-stubs: source-registry entry "${id}" is missing`);
  return s;
}

function municipalStub(
  m: Exclude<Municipality, 'tehran'>,
  code: string,
  nameEn: string,
  nameFa: string,
): RegulationPack {
  const src = registrySource(`t1-${m}-municipal-source`);
  return {
    id: `ir-${m}-stub`,
    jurisdiction: `${nameEn} (placeholder — municipal source not obtained)`,
    scope: 'local',
    edition: 'not-implemented',
    description:
      `Placeholder for ${nameEn} municipal regulations. The ${nameEn} municipal source pack is NOT OBTAINED: ` +
      'no municipal document is held in sources/, so no municipal rule, threshold or requirement is shipped. ' +
      'Setbacks, coverage, density, height and parking must be confirmed with the municipality.',
    sourceRegistry: [src],
    rules: [
      {
        ruleId: code,
        jurisdiction: `ir-${m}`,
        scope: 'local',
        title: `پکیج مقررات شهرداری ${nameFa} دریافت نشده است (منبع رسمی موجود نیست)`,
        description: `منبع مقررات شهرداری ${nameFa} در مخزن موجود نیست؛ هیچ قاعده، مقدار یا الزام شهرداری اعمال نمی‌شود.`,
        category: 'setback',
        severity: 'advisory',
        status: 'NOT_IMPLEMENTED',
        reference: `${nameEn} municipal source — NOT OBTAINED`,
        family: 'local-municipality',
      },
    ],
  };
}

export const IR_KARAJ_STUB_PACK: RegulationPack = municipalStub('karaj', 'KRJ-000', 'Karaj', 'کرج');
export const IR_MASHHAD_STUB_PACK: RegulationPack = municipalStub('mashhad', 'MSH-000', 'Mashhad', 'مشهد');
export const IR_ISFAHAN_STUB_PACK: RegulationPack = municipalStub('isfahan', 'ISF-000', 'Isfahan', 'اصفهان');
export const IR_SHIRAZ_STUB_PACK: RegulationPack = municipalStub('shiraz', 'SHZ-000', 'Shiraz', 'شیراز');

/** Placeholder pack per non-Tehran municipality (Tehran keeps IR_TEHRAN_STUB_PACK). */
export const MUNICIPAL_STUB_PACKS: Readonly<Record<Exclude<Municipality, 'tehran'>, RegulationPack>> = Object.freeze({
  karaj: IR_KARAJ_STUB_PACK,
  mashhad: IR_MASHHAD_STUB_PACK,
  isfahan: IR_ISFAHAN_STUB_PACK,
  shiraz: IR_SHIRAZ_STUB_PACK,
});
