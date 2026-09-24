/**
 * Project management panel — ROADMAP Phase 5 ("Project management dashboard:
 * list, save/load/import/export").
 *
 * Thin UI over the core persistence module (`@archgenius/core` →
 * `storage/project-store.ts`), which already implements save/load/list/delete
 * against browser localStorage plus JSON (de)serialization. This component adds
 * no storage format and no engine behaviour: it lists what the store holds,
 * writes the current `Project` to it, and hands a chosen/imported `Project`
 * back to the app through `onLoaded`.
 *
 * Degrades gracefully: when `localStorage` is unavailable (SSR, privacy mode)
 * the list is empty, the mutating actions are disabled, and a note says so —
 * nothing throws.
 */
import { useCallback, useState } from 'react';
import {
  deleteProject,
  deserializeProject,
  listProjects,
  saveProject,
  serializeProject,
} from '@archgenius/core';
import type { Project } from '@archgenius/core';
import type { FormState } from './App';
import { StatusNote } from './components';
import { faNum, t, tf } from './i18n';

/** True when the browser exposes localStorage (false during SSR / when blocked). */
export function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

/** Deterministic yyyy/mm/dd in Persian digits (locale-independent for tests). */
export function formatSavedAt(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return faNum(d.toISOString().slice(0, 10));
}

export function projectToJson(project: Project): string {
  return serializeProject(project);
}

export type ImportResult =
  | { ok: true; project: Project }
  | { ok: false; error: string };

/**
 * Validate an imported JSON document before it is trusted as a project.
 * A malformed or foreign file is rejected with a message instead of being
 * half-applied to the form.
 */
export function parseImportedProject(text: string): ImportResult {
  const invalid = (): ImportResult => ({ ok: false, error: t('pmImportInvalid') });
  let parsed: unknown;
  try {
    parsed = deserializeProject(text);
  } catch {
    return invalid();
  }
  if (!parsed || typeof parsed !== 'object') return invalid();
  const p = parsed as Partial<Project>;
  if (typeof p.id !== 'string' || p.id.length === 0) return invalid();
  if (!p.input || typeof p.input !== 'object') return invalid();
  const input = p.input as Project['input'];
  if (!input.site || typeof input.site !== 'object') return invalid();
  if (!input.building || typeof input.building !== 'object') return invalid();
  if (typeof input.site.width !== 'number' || typeof input.site.length !== 'number') return invalid();
  return { ok: true, project: parsed as Project };
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

/**
 * Map a stored/imported `Project` back onto the form.
 *
 * NOTE: `SiteInput` declares flat `setbackNorth?` fields while the engine reads
 * the nested `site.setbacks` object at runtime (App.tsx builds it that way).
 * Both shapes are accepted here so projects saved by either path restore.
 * Anything missing keeps the caller-supplied `base` value.
 */
export function formFromProject(project: Project, base: FormState): FormState {
  const input: any = project?.input ?? {};
  const site: any = input.site ?? {};
  const sb: any = site.setbacks ?? {};
  const b: any = input.building ?? {};
  const lShape: any = site.lShape ?? {};
  const polygon: any = site.polygon ?? {};

  return {
    ...base,
    name: typeof input.name === 'string' ? input.name : base.name,
    siteShape: site.shape ?? base.siteShape,
    siteWidth: num(site.width, base.siteWidth),
    siteLength: num(site.length, base.siteLength),
    accessSide: site.accessSide ?? base.accessSide,
    streetWidth: num(site.streetWidth, base.streetWidth),
    setbackNorth: num(sb.north ?? site.setbackNorth, base.setbackNorth),
    setbackSouth: num(sb.south ?? site.setbackSouth, base.setbackSouth),
    setbackEast: num(sb.east ?? site.setbackEast, base.setbackEast),
    setbackWest: num(sb.west ?? site.setbackWest, base.setbackWest),
    lNotchWidth: num(lShape.notchWidth, base.lNotchWidth),
    lNotchLength: num(lShape.notchLength, base.lNotchLength),
    lNotchCorner: lShape.notchCorner ?? base.lNotchCorner,
    polygonJson: Array.isArray(polygon.vertices) ? JSON.stringify(polygon.vertices) : base.polygonJson,
    jurisdiction: typeof site.jurisdiction === 'string' ? site.jurisdiction : base.jurisdiction,
    city: typeof site.city === 'string' ? site.city : base.city,
    parkingLayout: site.parkingLayout ?? base.parkingLayout,
    buildingType: b.type ?? base.buildingType,
    floors: num(b.floors, base.floors),
    bedrooms: num(b.bedrooms, base.bedrooms),
    masterBedrooms: num(b.masterBedrooms, base.masterBedrooms),
    bathrooms: num(b.bathrooms, base.bathrooms),
    wc: num(b.wc, base.wc),
    kitchenType: b.kitchenType ?? base.kitchenType,
    parkingSpaces: num(b.parkingSpaces, base.parkingSpaces),
    hasStair: bool(b.hasStair, base.hasStair),
    hasElevator: bool(b.hasElevator, base.hasElevator),
    hasStorage: bool(b.hasStorage, base.hasStorage),
    seed: num(input.seed, base.seed),
  };
}

/** Trigger a browser download of the project JSON. Returns false if unsupported. */
export function downloadProject(project: Project): boolean {
  try {
    if (typeof Blob === 'undefined' || typeof document === 'undefined') return false;
    const url = URL.createObjectURL(new Blob([projectToJson(project)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `archgenius-${project.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export interface ProjectManagerProps {
  /** The project currently in the app (null before the first generation). */
  project: Project | null;
  /** Called when the user picks a stored or imported project to restore. */
  onLoaded: (project: Project) => void;
}

export function ProjectManager({ project, onLoaded }: ProjectManagerProps) {
  const hasStorage = storageAvailable();
  const [saved, setSaved] = useState<Project[]>(() => (hasStorage ? listProjects() : []));
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const refresh = useCallback(() => {
    setSaved(hasStorage ? listProjects() : []);
  }, [hasStorage]);

  const onSave = () => {
    if (!project || !hasStorage) return;
    saveProject(project);
    refresh();
    setNote({ tone: 'ok', text: t('pmMsgSaved') });
  };

  const onLoad = (p: Project) => {
    onLoaded(p);
    setNote({ tone: 'ok', text: t('pmMsgLoaded') });
  };

  const onDelete = (id: string) => {
    if (!hasStorage) return;
    deleteProject(id);
    refresh();
    setNote({ tone: 'ok', text: t('pmMsgDeleted') });
  };

  const onExport = (p: Project) => {
    if (!downloadProject(p)) setNote({ tone: 'bad', text: t('pmExportFailed') });
  };

  const onImportFile = (file: File | undefined | null) => {
    if (!file || typeof FileReader === 'undefined') return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseImportedProject(String(reader.result ?? ''));
      if (!res.ok) {
        setNote({ tone: 'bad', text: res.error });
        return;
      }
      if (hasStorage) {
        saveProject(res.project);
        refresh();
      }
      setNote({ tone: 'ok', text: t('pmMsgImported') });
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-3 text-xs" data-project-manager="1">
      <p className="text-ink-400 leading-relaxed">{t('pmHint')}</p>

      {!hasStorage && <StatusNote tone="info">{t('pmNoStorage')}</StatusNote>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary !text-xs"
          onClick={onSave}
          disabled={!hasStorage || !project}
          data-pm-action="save"
        >
          {t('pmSave')}
        </button>
        <label className="btn-tertiary !text-xs !py-1.5 cursor-pointer" data-pm-action="import">
          {t('pmImport')}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onImportFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {!project && <StatusNote tone="info">{t('pmNeedProject')}</StatusNote>}

      {note && <StatusNote tone={note.tone}>{note.text}</StatusNote>}

      {saved.length === 0 ? (
        <StatusNote tone="info">{t('pmEmpty')}</StatusNote>
      ) : (
        <div className="space-y-2" data-pm-count={saved.length}>
          <div className="text-ink-400">{tf('pmSavedCount', { count: faNum(saved.length) })}</div>
          {saved.map((p) => (
            <div key={p.id} className="card !p-2 space-y-1.5" data-pm-project={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.input?.name ?? p.id}</div>
                  <div className="text-ink-400 ltr:text-left" dir="ltr">{p.id}</div>
                  <div className="text-ink-400">
                    {t('pmUpdated')}: {formatSavedAt(p.updatedAt)} ·{' '}
                    {faNum(p.input?.building?.floors ?? 0)} {t('pmFloors')} ·{' '}
                    {faNum(p.input?.site?.width ?? 0)}×{faNum(p.input?.site?.length ?? 0)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="btn-tertiary !text-xs !py-1" onClick={() => onLoad(p)} data-pm-load={p.id}>
                  {t('pmLoad')}
                </button>
                <button type="button" className="btn-tertiary !text-xs !py-1" onClick={() => onExport(p)} data-pm-export={p.id}>
                  {t('pmExport')}
                </button>
                <button
                  type="button"
                  className="btn-tertiary !text-xs !py-1"
                  onClick={() => onDelete(p.id)}
                  disabled={!hasStorage}
                  data-pm-delete={p.id}
                >
                  {t('pmDelete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
