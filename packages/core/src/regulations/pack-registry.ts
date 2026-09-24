/**
 * Multi-version regulation pack loading — ROADMAP Phase 4 ("multi-version pack
 * loading").
 *
 * WHAT THIS MODULE IS
 *   A read-only catalogue of the regulation packs that actually exist in this
 *   repository, keyed by pack id and edition, plus a loader that resolves a
 *   requested (packId, edition) pair to a `RegulationPack`.
 *
 * WHAT THIS MODULE IS *NOT*
 *   It adds no rule, changes no threshold, changes no source, and changes no
 *   verification status. Every loadable edition returns the *same* pack object
 *   the engine already composes by default. The catalogue exists so a caller
 *   can ask for a specific edition by name and get either that exact edition or
 *   a loud, explainable error.
 *
 * TRUST PROPERTY (deliberate)
 *   Requesting an edition that is registered but whose Tier-1 document is NOT
 *   present/authenticated in `sources/` throws `EDITION_NOT_OBTAINED` instead
 *   of silently returning another edition. Substituting a different edition
 *   would report a rule set that is not the one the caller asked for — a false
 *   compliance claim. Failing loudly is the only honest option.
 */
import type { RegulationPack } from './types.js';
import { IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK } from './packs/ir-national-mbr.js';
import { SOURCE_REGISTRY_DEFAULTS } from './packs/source-registry.js';
// Lazy (call-time) use only — see `note on import cycle` at the bottom of the file.
import { buildDefaultPack } from './engine.js';

/** Whether a primary source document has been obtained *and* authenticated. */
export type PackEditionAvailability = 'available' | 'not-obtained';

export type PackLoadErrorCode =
  | 'UNKNOWN_PACK'          // pack id is not in the catalogue at all
  | 'UNKNOWN_EDITION'       // pack exists but has no such edition string
  | 'EDITION_NOT_OBTAINED'  // edition is registered but its source is missing
  | 'PACK_NOT_SELECTED';    // an edition pin names a pack that is not selected

/** Raised for every refused load, so callers can branch on `code`. */
export class PackLoadError extends Error {
  readonly code: PackLoadErrorCode;
  readonly packId: string;
  readonly edition?: string;
  /** Editions/packs that *were* usable — included so the message is actionable. */
  readonly available: readonly string[];

  constructor(
    code: PackLoadErrorCode,
    packId: string,
    edition: string | undefined,
    available: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = 'PackLoadError';
    this.code = code;
    this.packId = packId;
    this.edition = edition;
    this.available = available;
  }
}

export interface PackEditionEntry {
  packId: string;
  /** Exact `RegulationPack.edition` string of the pack this entry resolves to. */
  edition: string;
  effectiveDate?: string;
  /** Edition used when a caller does not name one. Exactly one per family. */
  isDefault: boolean;
  /** Can `loadPack` return rule content for this edition? */
  loadable: boolean;
  /** Is every Tier-1 document backing this edition present + authenticated in sources/? */
  sourceObtained: boolean;
  /** Human explanation of the edition's provenance / why it is not loadable. */
  note?: string;
  /** Returns the pack for this edition. Only valid when `loadable` is true. */
  load: () => RegulationPack;
}

export interface PackFamily {
  packId: string;
  jurisdiction: string;
  scope: RegulationPack['scope'];
  description?: string;
  /** All known editions, oldest → newest. */
  editions: PackEditionEntry[];
}

// ---------------------------------------------------------------------------
// Availability is DERIVED from the existing source registry — never restated
// here — so this catalogue cannot drift out of sync with sources/.
// ---------------------------------------------------------------------------

/** Fails fast at module init if a source id we depend on disappears. */
function registryEntry(sourceId: string) {
  const s = SOURCE_REGISTRY_DEFAULTS.find((x) => x.id === sourceId);
  if (!s) {
    throw new Error(`pack-registry: source-registry entry "${sourceId}" is missing`);
  }
  return s;
}

/** True only when *every* listed source is obtained-authenticated AND has a local file. */
function allSourcesObtained(...sourceIds: string[]): boolean {
  return sourceIds.every((id) => {
    const s = registryEntry(id);
    return s.verificationState === 'obtained-authenticated' && !!s.documentPath;
  });
}

/** The superseding Mabhas-4 edition is registered but its PDF is NOT in sources/. */
const MABHAS4_1399 = registryEntry('t1-mabhas4-1399');

/** The catalogue. Static data + closures only; no state, no I/O. */
export const REGULATION_PACK_FAMILIES: readonly PackFamily[] = Object.freeze([
  {
    packId: 'ir-default-v0.1',
    jurisdiction: 'unknown-iranian-municipality',
    scope: 'default',
    description:
      'Engineering-default assumption pack (setbacks / parking). Loadable, but its ' +
      'values are heuristics: no regulatory document supports them.',
    editions: [
      {
        packId: 'ir-default-v0.1',
        edition: 'draft-v0.1',
        isDefault: true,
        loadable: true,
        // No Tier-1 document exists for an assumption pack, by definition.
        sourceObtained: false,
        note: 'Rules carry status REQUIRES_SOURCE_VERIFICATION; never presented as compliance.',
        load: () => buildDefaultPack(),
      },
    ],
  },
  {
    packId: 'ir-national-mbr',
    jurisdiction: 'Islamic Republic of Iran — National (Mabhas / مقررات ملی ساختمان)',
    scope: 'national',
    description:
      'Iranian National Building Code (Mabhas 4 / Mabhas 15) residential rules. ' +
      'The shipped edition is the one whose Tier-1 PDFs are held in sources/.',
    editions: [
      {
        packId: 'ir-national-mbr',
        edition: IR_NATIONAL_MBR_PACK.edition,
        effectiveDate: IR_NATIONAL_MBR_PACK.effectiveDate,
        isDefault: true,
        loadable: true,
        sourceObtained: allSourcesObtained('t1-mabhas4-1396', 't1-mabhas15-1392'),
        note:
          'Shipped edition — backed by sources/mabhas4-96.pdf (ویرایش سوم ۱۳۹۶) and ' +
          'sources/mabhas-15.pdf (۱۳۹۲), both obtained-authenticated with SHA-256 digests.',
        load: () => IR_NATIONAL_MBR_PACK,
      },
      {
        packId: 'ir-national-mbr',
        // Edition string taken verbatim from the source registry entry.
        edition: MABHAS4_1399.edition ?? '1399',
        isDefault: false,
        loadable: false,
        sourceObtained: false,
        note:
          'Superseding revision registered in the source registry ' +
          `(verificationState "${MABHAS4_1399.verificationState}", documentPath ` +
          `${MABHAS4_1399.documentPath ?? 'none'}) but the PDF is NOT in sources/. ` +
          'No rule content is shipped for it: requesting this edition fails loudly ' +
          'rather than returning the 1396/1392 rules.',
        load: () => {
          throw new PackLoadError(
            'EDITION_NOT_OBTAINED',
            'ir-national-mbr',
            MABHAS4_1399.edition ?? '1399',
            [],
            `Edition "${MABHAS4_1399.edition}" of pack "ir-national-mbr" has no primary source in sources/.`,
          );
        },
      },
    ],
  },
  {
    packId: 'ir-tehran-stub',
    jurisdiction: 'Tehran (placeholder — pending official detailed plan)',
    scope: 'local',
    description:
      'Placeholder for Tehran municipality detailed-plan rules. Loadable, but every ' +
      'rule is NOT_IMPLEMENTED and emits only an advisory note.',
    editions: [
      {
        packId: 'ir-tehran-stub',
        edition: IR_TEHRAN_STUB_PACK.edition,
        effectiveDate: IR_TEHRAN_STUB_PACK.effectiveDate,
        isDefault: true,
        loadable: true,
        sourceObtained: allSourcesObtained('t1-tehran-tarh-tafsili'),
        note:
          'Loadable as an advisory placeholder only. Tehran setback/coverage/height/FAR ' +
          'rules are NOT shipped (the detailed plan is not in sources/).',
        load: () => IR_TEHRAN_STUB_PACK,
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function listPackFamilies(): PackFamily[] {
  return [...REGULATION_PACK_FAMILIES];
}

export function listPackIds(): string[] {
  return REGULATION_PACK_FAMILIES.map((f) => f.packId);
}

export function isKnownPack(packId: string): boolean {
  return REGULATION_PACK_FAMILIES.some((f) => f.packId === packId);
}

/** All editions of a pack, oldest → newest. Empty array for an unknown pack. */
export function listPackEditions(packId: string): PackEditionEntry[] {
  const family = REGULATION_PACK_FAMILIES.find((f) => f.packId === packId);
  return family ? [...family.editions] : [];
}

/** Loadable editions only — what a caller can actually ask for. */
export function listLoadableEditions(packId: string): string[] {
  return listPackEditions(packId).filter((e) => e.loadable).map((e) => e.edition);
}

function requireFamily(packId: string, edition?: string): PackFamily {
  const family = REGULATION_PACK_FAMILIES.find((f) => f.packId === packId);
  if (!family) {
    throw new PackLoadError(
      'UNKNOWN_PACK',
      packId,
      edition,
      listPackIds(),
      `Unknown regulation pack "${packId}". Known packs: ${listPackIds().join(', ')}.`,
    );
  }
  return family;
}

/**
 * The edition used when a caller does not name one: the family's newest
 * *loadable* edition (a registered-but-unobtainable revision is never a
 * default, because it has no rule content).
 */
export function defaultEditionFor(packId: string): string {
  const family = requireFamily(packId);
  const explicit = family.editions.find((e) => e.isDefault && e.loadable);
  if (explicit) return explicit.edition;
  const fallback = [...family.editions].reverse().find((e) => e.loadable);
  if (!fallback) {
    throw new PackLoadError(
      'EDITION_NOT_OBTAINED',
      packId,
      undefined,
      [],
      `Pack "${packId}" has no loadable edition — no primary source is available.`,
    );
  }
  return fallback.edition;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Resolve (packId, edition?) to a `RegulationPack`.
 *
 * Omitting `edition` yields the family default. Any refusal raises
 * `PackLoadError` with an actionable message; it never returns a different
 * edition than the one requested.
 */
export function loadPack(packId: string, edition?: string): RegulationPack {
  const family = requireFamily(packId, edition);
  const entry =
    edition === undefined
      ? family.editions.find((e) => e.isDefault && e.loadable) ??
        [...family.editions].reverse().find((e) => e.loadable)
      : family.editions.find((e) => e.edition === edition);

  if (!entry) {
    throw new PackLoadError(
      'UNKNOWN_EDITION',
      packId,
      edition,
      family.editions.map((e) => e.edition),
      `Pack "${packId}" has no edition "${edition}". ` +
        `Known editions: ${family.editions.map((e) => `"${e.edition}"`).join(', ')}.`,
    );
  }
  if (!entry.loadable) {
    throw new PackLoadError(
      'EDITION_NOT_OBTAINED',
      packId,
      entry.edition,
      listLoadableEditions(packId),
      `Edition "${entry.edition}" of pack "${packId}" is registered but NOT loadable — ` +
        `its primary source is not present/authenticated in sources/. ` +
        `Loadable editions: ${listLoadableEditions(packId).map((e) => `"${e}"`).join(', ') || 'none'}. ` +
        `Refusing to substitute another edition: that would report a rule set the caller did not request.`,
    );
  }
  return entry.load();
}

/**
 * Apply an explicit pack selection / edition pinning on top of the packs the
 * engine composed by default.
 *
 * - `requestedIds` undefined/empty AND no pins ⇒ returns the defaults untouched
 *   (this is the path every existing caller takes — behaviour is unchanged).
 * - `requestedIds` given ⇒ exactly those packs, in that order; a pack already
 *   in the default set is reused as-is, otherwise it is loaded by id. Duplicates
 *   are collapsed (a duplicate would double every finding).
 * - `editionPins` ⇒ replaces the pack with that exact edition. A pin naming an
 *   unknown pack, an unknown edition, or a pack that is not in the selection
 *   throws — a silently ignored pin would change the rule set under audit.
 */
export function selectPacks(
  defaultPacks: readonly RegulationPack[],
  requestedIds?: readonly string[] | null,
  editionPins?: Record<string, string> | null,
): RegulationPack[] {
  const pins = editionPins ?? undefined;
  const pinKeys = pins ? Object.keys(pins) : [];
  const ids = requestedIds ?? undefined;
  const hasIds = !!ids && ids.length > 0;
  if (!hasIds && pinKeys.length === 0) return [...defaultPacks];

  let out: RegulationPack[];
  if (hasIds) {
    const seen = new Set<string>();
    out = [];
    for (const id of ids!) {
      if (seen.has(id)) continue;
      seen.add(id);
      const existing = defaultPacks.find((p) => p.id === id);
      out.push(existing ?? loadPack(id));
    }
  } else {
    out = [...defaultPacks];
  }

  for (const id of pinKeys) {
    const edition = pins![id];
    const idx = out.findIndex((p) => p.id === id);
    if (idx < 0) {
      throw new PackLoadError(
        'PACK_NOT_SELECTED',
        id,
        edition,
        out.map((p) => p.id),
        `Edition pin for pack "${id}" was requested but that pack is not in the selected set ` +
          `[${out.map((p) => p.id).join(', ')}]. Refusing to ignore the pin: the rule set ` +
          `would no longer match what was requested.`,
      );
    }
    out[idx] = loadPack(id, edition);
  }
  return out;
}

/**
 * Note on the import cycle: `engine.ts` imports `selectPacks` from here and this
 * module imports `buildDefaultPack` from `engine.ts`. `buildDefaultPack` is a
 * hoisted function declaration and is only ever called from inside `load()` at
 * call time — never during module evaluation — so the cycle is inert.
 */
