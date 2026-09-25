/**
 * Municipality resolver — ROADMAP.md:46 infrastructure (jurisdiction packs).
 *
 * Pure and deterministic: maps a project's jurisdiction / city input to one of
 * the municipalities that have a (placeholder) local pack. It carries NO
 * regulatory data — it only decides which local pack is composed.
 *
 * Priority (first field that names exactly one supported municipality wins):
 *   1. project.regulationJurisdiction
 *   2. project.site.jurisdiction
 *   3. project.site.city
 * A field that is empty, names no supported municipality, or names MORE THAN
 * ONE supported municipality (ambiguous) contributes nothing and resolution
 * falls through to the next field. No match → null.
 *
 * UI default: the web form pre-fills the jurisdiction field with the exact
 * value DEFAULT_UI_JURISDICTION ("Tehran-Municipality-Default"). That value is
 * a form default, not a user choice, so it is WEAK: it yields Tehran only when
 * no lower-priority field names exactly one supported municipality. An
 * explicit Tehran value ("Tehran", "ir-tehran", "تهران", …) stays authoritative.
 *
 * Matching is case-insensitive substring matching on a normalised string
 * (the pre-existing behaviour for Tehran, e.g. "Tehran-Municipality-Default"
 * and "ir-tehran"), with English and Persian name variants. Arabic-script
 * code points commonly typed for Persian letters (ك / ي / ى) are folded to
 * their Persian forms, and ZWNJ / tatweel are removed.
 */
import type { ProjectInput } from '../model/project.js';

export type Municipality = 'tehran' | 'karaj' | 'mashhad' | 'isfahan' | 'shiraz';

/** Fixed order — also the order used when reporting ambiguity. */
export const SUPPORTED_MUNICIPALITIES: readonly Municipality[] = Object.freeze(['tehran', 'karaj', 'mashhad', 'isfahan', 'shiraz']);

/** Name variants (already normalised: lower-case, Persian letter forms). */
export const MUNICIPALITY_ALIASES: Readonly<Record<Municipality, readonly string[]>> = Object.freeze({
  tehran: Object.freeze(['tehran', 'تهران']),
  karaj: Object.freeze(['karaj', 'کرج']),
  mashhad: Object.freeze(['mashhad', 'مشهد']),
  isfahan: Object.freeze(['isfahan', 'esfahan', 'اصفهان']),
  shiraz: Object.freeze(['shiraz', 'شیراز']),
});

/** Lower-case, fold Arabic-script variants to Persian, drop ZWNJ/tatweel. */
export function normalizeMunicipalityText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u0643/g, '\u06A9') // Arabic kaf → Persian keheh
    .replace(/[\u064A\u0649]/g, '\u06CC') // Arabic yeh / alef maksura → Persian yeh
    .replace(/[\u200C\u0640]/g, '') // ZWNJ, tatweel
    .trim();
}

/** All supported municipalities named in one field (fixed order, no duplicates). */
export function municipalitiesIn(text: string | undefined | null): Municipality[] {
  if (typeof text !== 'string') return [];
  const n = normalizeMunicipalityText(text);
  if (!n) return [];
  return SUPPORTED_MUNICIPALITIES.filter((m) => MUNICIPALITY_ALIASES[m].some((a) => n.includes(a)));
}

/** The web form's pre-filled jurisdiction value (packages/web/src/App.tsx) — a weak default. */
export const DEFAULT_UI_JURISDICTION = 'Tehran-Municipality-Default';

const isUiDefaultJurisdiction = (f: unknown): boolean =>
  typeof f === 'string' && normalizeMunicipalityText(f) === normalizeMunicipalityText(DEFAULT_UI_JURISDICTION);

/**
 * Resolve the project's municipality, or null when none (or only ambiguous
 * input) is given. See the module comment for the exact priority rules.
 */
export function resolveMunicipality(project: Pick<ProjectInput, 'regulationJurisdiction'> & { site?: { jurisdiction?: string; city?: string } }): Municipality | null {
  const fields = [project?.regulationJurisdiction, project?.site?.jurisdiction, project?.site?.city];
  let weakDefault: Municipality | null = null;
  for (const f of fields) {
    if (isUiDefaultJurisdiction(f)) { weakDefault = 'tehran'; continue; }
    const hits = municipalitiesIn(f);
    if (hits.length === 1) return hits[0];
  }
  return weakDefault;
}
