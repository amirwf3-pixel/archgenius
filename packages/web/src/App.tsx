import React, { useMemo, useState, useEffect } from 'react';
import { createProject, generate, exportDXF, validateCandidate, Editing } from '@archgenius/core';
import type { ProjectInput, Project } from '@archgenius/core';
import type { LayoutCandidate } from '@archgenius/core';
import type { Space } from '@archgenius/core';
import { PlanCanvas } from './PlanCanvas';
import { CandidatesBar } from './CandidatesBar';
import { FindingsPanel, EditFindingsList, ResultStatusCard, PlanLegend } from './FindingsPanel';
import { RegulationExplorer } from './RegulationExplorer';
import type { ResultState } from './FindingsPanel';
import {
  Section, Field, NumField, SelectField, CheckField, Collapsible,
  StatusNote, Segmented, Metric,
  IconDownload, IconLock, IconUnlock, IconAlert, IconCube, IconCheckCircle,
} from './components';
import {
  t, tf, faNum, DIR, LOCALE, spaceLabel, spaceTypeFromLabel,
  STRATEGY_FA, STAIR_TYPE_FA, SHAPE_FA, SIDE_FA,
  translateEngineError, translateInfeasibleExplanation,
  APP_VERSION,
} from './i18n';

interface FormState {
  name: string;
  siteShape: 'rectangle' | 'l-shape' | 'polygon';
  siteWidth: number;
  siteLength: number;
  accessSide: 'south' | 'north' | 'east' | 'west';
  streetWidth: number;
  lNotchWidth: number;
  lNotchLength: number;
  lNotchCorner: 'north-east' | 'north-west' | 'south-east' | 'south-west';
  polygonJson: string;
  setbackNorth: number;
  setbackSouth: number;
  setbackEast: number;
  setbackWest: number;
  jurisdiction: string;
  city: string;
  parkingLayout: 'auto' | 'perpendicular' | 'parallel';
  buildingType: 'villa' | 'apartment';
  floors: number;
  bedrooms: number;
  masterBedrooms: number;
  bathrooms: number;
  wc: number;
  kitchenType: 'closed' | 'open' | 'semi-open';
  parkingSpaces: number;
  hasStair: boolean;
  hasElevator: boolean;
  hasStorage: boolean;
  seed: number;
}

const DEFAULT_STATE: FormState = {
  name: 'ویلای نمونه',
  siteShape: 'rectangle',
  // P16-A: 18x28 is the smallest stock default where the default 2-car
  // parking band fits for real (stalls inside buildable + 3.5 m aisle).
  siteWidth: 18,
  siteLength: 28,
  accessSide: 'south',
  streetWidth: 8,
  lNotchWidth: 5,
  lNotchLength: 6,
  lNotchCorner: 'north-east',
  polygonJson: '[{"x":0,"y":0},{"x":12,"y":0},{"x":12,"y":8},{"x":8,"y":8},{"x":8,"y":18},{"x":0,"y":18}]',
  setbackNorth: 2,
  setbackSouth: 3,
  setbackEast: 2,
  setbackWest: 2,
  jurisdiction: 'Tehran-Municipality-Default',
  city: 'Tehran',
  parkingLayout: 'auto',
  buildingType: 'villa',
  floors: 2,
  bedrooms: 3,
  masterBedrooms: 1,
  bathrooms: 2,
  wc: 1,
  kitchenType: 'closed',
  parkingSpaces: 2,
  hasStair: true,
  hasElevator: false,
  hasStorage: true,
  seed: 42,
};

type Stage = 'idle' | 'generate' | 'validate' | 'prepare';

/** Yield to the browser so the busy/stage UI can paint between real phases. */
const nextPaint = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
  else setTimeout(resolve, 16);
});

export function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_STATE);
  const [project, setProject] = useState<Project | null>(null);
  const [candidates, setCandidates] = useState<LayoutCandidate[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedFloor, setSelectedFloor] = useState(0);
  const [editedCandidate, setEditedCandidate] = useState<LayoutCandidate | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFindings, setEditFindings] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);
  const [dxfNote, setDxfNote] = useState<string | null>(null);
  const [infeasibleExplanation, setInfeasibleExplanation] = useState<string | null>(null);
  const [infeasibleAttempts, setInfeasibleAttempts] = useState<Array<{ strategy: string; candidateId: string; reason: string }>>([]);

  // Move/resize local state
  const [moveX, setMoveX] = useState<number>(0);
  const [moveY, setMoveY] = useState<number>(0);
  const [resizeW, setResizeW] = useState<number>(4);
  const [resizeH, setResizeH] = useState<number>(4);
  const [notchW, setNotchW] = useState<number>(1);
  const [notchL, setNotchL] = useState<number>(1);
  const [notchCorner, setNotchCorner] = useState<'ne' | 'nw' | 'se' | 'sw'>('ne');

  const candidate = candidates[selectedIdx] ?? null;
  const displayCandidate = editedCandidate ?? candidate;

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(s => ({ ...s, [k]: v }));

  // When base candidate changes, reset edited
  useEffect(() => {
    if (candidate) {
      setEditedCandidate(candidate);
      setSelectedSpaceId(null);
      setEditError(null);
      setEditFindings([]);
    }
  }, [candidate?.id, selectedIdx]);

  // When selected space changes, sync move/resize inputs
  useEffect(() => {
    if (!displayCandidate || !selectedSpaceId) return;
    const floor = displayCandidate.floors[Math.max(0, Math.min(selectedFloor, displayCandidate.floors.length - 1))];
    if (!floor) return;
    const sp = floor.spaces.find(s => s.id === selectedSpaceId);
    if (!sp) return;
    setMoveX(sp.rect.x);
    setMoveY(sp.rect.y);
    setResizeW(sp.rect.w);
    setResizeH(sp.rect.h);
  }, [selectedSpaceId, selectedFloor, displayCandidate?.id]);

  // Auto-dismiss the DXF success note
  useEffect(() => {
    if (!dxfNote) return;
    const id = setTimeout(() => setDxfNote(null), 5000);
    return () => clearTimeout(id);
  }, [dxfNote]);

  // Inline validation for the polygon JSON (same rule the generator applies)
  const polygonJsonValid = useMemo(() => {
    if (form.siteShape !== 'polygon') return true;
    try {
      return Array.isArray(JSON.parse(form.polygonJson));
    } catch {
      return false;
    }
  }, [form.siteShape, form.polygonJson]);

  const onGenerate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccessNote(null);
    setDxfNote(null);
    setInfeasibleExplanation(null);
    setInfeasibleAttempts([]);
    setStage('generate');
    await nextPaint(); // paint the busy state before the synchronous engine work
    try {
      let polygonVertices: any = undefined;
      if (form.siteShape === 'polygon') {
        try {
          const parsed = JSON.parse(form.polygonJson);
          if (Array.isArray(parsed)) polygonVertices = parsed;
        } catch {
          throw new Error(t('errorInvalidPolygon'));
        }
      }

      const site: any = {
        shape: form.siteShape,
        width: Number(form.siteWidth),
        length: Number(form.siteLength),
        accessSide: form.accessSide,
        streetWidth: Number(form.streetWidth),
        northRotationDeg: 0,
        setbacks: {
          north: Number(form.setbackNorth),
          south: Number(form.setbackSouth),
          east: Number(form.setbackEast),
          west: Number(form.setbackWest),
        },
        jurisdiction: form.jurisdiction || undefined,
        city: form.city || undefined,
        parkingLayout: form.parkingLayout,
      };
      if (form.siteShape === 'l-shape') {
        site.lShape = {
          width: Number(form.siteWidth),
          length: Number(form.siteLength),
          notchWidth: Number(form.lNotchWidth),
          notchLength: Number(form.lNotchLength),
          notchCorner: form.lNotchCorner,
        };
      }
      if (form.siteShape === 'polygon' && polygonVertices) {
        site.polygon = { vertices: polygonVertices };
      }

      const input: ProjectInput = {
        name: form.name,
        site,
        building: {
          type: form.buildingType,
          floors: Number(form.floors),
          bedrooms: Number(form.bedrooms),
          masterBedrooms: Number(form.masterBedrooms),
          bathrooms: Number(form.bathrooms),
          wc: Number(form.wc),
          kitchenType: form.kitchenType,
          parkingSpaces: Number(form.parkingSpaces),
          hasStair: form.hasStair || Number(form.floors) > 1,
          hasElevator: form.hasElevator,
          hasStorage: form.hasStorage,
          hasBalcony: false,
          hasYard: false,
        },
        deterministic: true,
        seed: Number(form.seed) || 42,
      };
      const prj = createProject(input);
      // allStrategies: expose the engine's full deterministic best-first
      // ranking for review — ranking order is decided by the core, untouched.
      const result = generate(prj, { allStrategies: true });
      setProject(prj);
      setCandidates(result.candidates);
      setSelectedIdx(0);
      setSelectedFloor(0);
      setEditedCandidate(result.candidates[0] ?? null);
      setStage('validate');
      await nextPaint(); // validation of the displayed candidate runs in the vr memo
      setStage('prepare');
      await nextPaint();
      // Phase 13.2: infeasible results expose NO usable candidate — surface the explicit
      // infeasible state instead of silently presenting a below-minimum plan.
      if (result.infeasible) {
        setError(`${t('errorInfeasible')}`);
        setInfeasibleExplanation(translateInfeasibleExplanation(result.infeasible.explanation));
        setInfeasibleAttempts(result.infeasible.attempts);
      } else {
        setSuccessNote(result.candidates.length > 1
          ? tf('resultCandidatesNote', { count: faNum(result.candidates.length) })
          : t('resultSuccess'));
      }
    } catch (e: any) {
      setError(translateEngineError(e?.message ?? String(e)));
    } finally {
      setBusy(false);
      setStage('idle');
    }
  };

  const vr = useMemo(() => displayCandidate ? validateCandidate(displayCandidate) : null, [displayCandidate]);

  // Read-only validation summary per candidate (for the candidate cards)
  const candValidations = useMemo(() => candidates.map(c => validateCandidate(c)), [candidates]);

  const resultState: ResultState = useMemo(() => {
    if (infeasibleExplanation !== null) {
      return { kind: 'infeasible', explanation: infeasibleExplanation, attempts: infeasibleAttempts };
    }
    if (!displayCandidate || !vr) return { kind: 'empty' };
    return { kind: vr.ok ? 'ok' : 'invalid', vr, candidateCount: candidates.length };
  }, [infeasibleExplanation, infeasibleAttempts, displayCandidate, vr, candidates.length]);

  const onDownloadDXF = () => {
    if (!displayCandidate || !project) return;
    let dxf: string;
    try {
      // May refuse candidates with hard site-envelope geometry violations.
      dxf = exportDXF(displayCandidate, project.input.name).dxf;
    } catch (e) {
      setError(translateEngineError(e instanceof Error ? e.message : String(e)));
      setDxfNote(null);
      return;
    }
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.input.name.replace(/\s+/g, '_')}_archgenius.dxf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setDxfNote(t('dxfReady'));
  };

  const floorCount = displayCandidate?.floors.length ?? form.floors;
  const currentFloor = displayCandidate?.floors[Math.max(0, Math.min(selectedFloor, (displayCandidate?.floors.length ?? 1) - 1))];
  const selectedSpace: Space | undefined = currentFloor?.spaces.find(s => s.id === selectedSpaceId);
  const isEdited = displayCandidate != null && candidate != null && displayCandidate !== candidate;

  const handleEditResult = (res: any) => {
    if (res.success) {
      setEditedCandidate(res.candidate);
      setEditError(null);
      setEditFindings(res.findings ?? []);
    } else {
      setEditError(`${t('editFailed')} ${translateEngineError(res.error ?? '')}`);
      setEditFindings(res.findings ?? []);
    }
  };

  const doMove = () => {
    if (!displayCandidate || !selectedSpaceId || !currentFloor) return;
    const op = { floorLevel: currentFloor.level, spaceId: selectedSpaceId, newX: moveX, newY: moveY };
    const res = Editing.moveRoom(displayCandidate, op);
    handleEditResult(res);
  };

  const doResize = () => {
    if (!displayCandidate || !selectedSpaceId || !currentFloor) return;
    const op = { floorLevel: currentFloor.level, spaceId: selectedSpaceId, newWidth: resizeW, newHeight: resizeH };
    const res = Editing.resizeRoom(displayCandidate, op);
    handleEditResult(res);
  };

  const doSetLShape = () => {
    if (!displayCandidate || !selectedSpaceId || !currentFloor) return;
    const op = { floorLevel: currentFloor.level, spaceId: selectedSpaceId, notchWidth: notchW, notchLength: notchL, notchCorner };
    const res = Editing.setLShape(displayCandidate, op);
    handleEditResult(res);
  };

  const doLock = (kind: 'position' | 'size' | 'all') => {
    if (!displayCandidate || !selectedSpaceId || !currentFloor) return;
    const op = { floorLevel: currentFloor.level, spaceId: selectedSpaceId, lockKind: kind as any };
    const res = Editing.lockRoom(displayCandidate, op);
    handleEditResult(res);
  };

  const doUnlock = (kind: 'position' | 'size' | 'all') => {
    if (!displayCandidate || !selectedSpaceId || !currentFloor) return;
    const op = { floorLevel: currentFloor.level, spaceId: selectedSpaceId, lockKind: kind as any };
    const res = Editing.unlockRoom(displayCandidate, op);
    handleEditResult(res);
  };

  const shapeOptions = [
    { value: 'rectangle', label: t('shapeRectangle') },
    { value: 'l-shape', label: t('shapeLShape') },
    { value: 'polygon', label: t('shapePolygon') },
  ];

  return (
    <div dir={DIR} lang={LOCALE} className="h-full flex flex-col overflow-x-hidden">
      <header className="sticky top-0 z-30 h-14 border-b border-ink-700 flex items-center justify-between px-4 sm:px-6 bg-ink-800/95 backdrop-blur min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-accent-500 flex items-center justify-center font-bold shrink-0" aria-hidden="true">A</div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">ArchGenius — {t('appName')}</h1>
            <p className="text-[10px] text-ink-400 truncate">{t('headerTagline')}</p>
          </div>
        </div>
        <div className="text-[10px] sm:text-xs text-ink-400 shrink-0 hidden sm:block">{tf('headerMeta', { version: APP_VERSION })}</div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 lg:overflow-hidden">
        {/* ------------------------------------------------ panels: input */}
        <aside className="lg:col-span-3 border-b lg:border-b-0 lg:border-e border-ink-700 lg:overflow-y-auto p-4 space-y-4 min-w-0" aria-label={t('formAriaLabel')}>
          <Section id="project" step={1} title={t('sectionProject')}>
            <Field id="f-name" label={t('projectName')}>
              <input id="f-name" value={form.name} disabled={busy} onChange={e => update('name', e.target.value)} />
            </Field>
            <Collapsible title={t('advancedProject')}>
              <NumField id="f-seed" label={t('seedLabel')} value={form.seed} min={0} step={1} disabled={busy}
                onChange={v => update('seed', v)} hint={t('seedHint')} />
            </Collapsible>
          </Section>

          <Section id="site" step={2} title={t('sectionSite')}>
            <div className="grid grid-cols-2 gap-3">
              <SelectField id="f-shape" className="col-span-2" label={t('siteShape')} value={form.siteShape}
                disabled={busy} onChange={v => update('siteShape', v as any)} options={shapeOptions} hint={t('siteShapeHint')} />
              <NumField id="f-width" label={t('widthM')} value={form.siteWidth} min={5} step={0.5} disabled={busy}
                onChange={v => update('siteWidth', v)} />
              <NumField id="f-length" label={t('lengthM')} value={form.siteLength} min={5} step={0.5} disabled={busy}
                onChange={v => update('siteLength', v)} />
              <SelectField id="f-access" label={t('accessSide')} value={form.accessSide} disabled={busy}
                onChange={v => update('accessSide', v as any)}
                options={(['south', 'north', 'east', 'west'] as const).map(s => ({ value: s, label: SIDE_FA[s] }))} />
              <NumField id="f-street" label={t('streetWidthM')} value={form.streetWidth} min={3} step={0.5} disabled={busy}
                onChange={v => update('streetWidth', v)} />
            </div>

            {form.siteShape === 'l-shape' && (
              <div className="card">
                <div className="text-[11px] font-semibold text-accent-300">{t('lNotchTitle')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <NumField id="f-notchw" label={t('notchWidthM')} value={form.lNotchWidth} min={1} step={0.5} disabled={busy}
                    onChange={v => update('lNotchWidth', v)} />
                  <NumField id="f-notchl" label={t('notchLengthM')} value={form.lNotchLength} min={1} step={0.5} disabled={busy}
                    onChange={v => update('lNotchLength', v)} />
                  <SelectField id="f-notchc" className="col-span-2" label={t('notchCorner')} value={form.lNotchCorner} disabled={busy}
                    onChange={v => update('lNotchCorner', v as any)}
                    options={(['north-east', 'north-west', 'south-east', 'south-west'] as const).map(c => ({ value: c, label: SIDE_FA[c] }))} />
                </div>
              </div>
            )}

            {form.siteShape === 'polygon' && (
              <Field
                id="f-polyjson"
                label={t('polygonVertsTitle')}
                error={polygonJsonValid ? undefined : t('polygonJsonInvalid')}
                hint={polygonJsonValid ? t('polygonJsonValid') : undefined}
              >
                <textarea
                  id="f-polyjson" dir="ltr" className="w-full h-24 text-left"
                  value={form.polygonJson} disabled={busy}
                  aria-invalid={!polygonJsonValid}
                  onChange={e => update('polygonJson', e.target.value)}
                />
              </Field>
            )}

            <Collapsible
              title={t('setbacksTitle')}
              subtitle={tf('setbacksSummary', { n: form.setbackNorth, s: form.setbackSouth, e: form.setbackEast, w: form.setbackWest })}
            >
              <div className="grid grid-cols-2 gap-2">
                <NumField id="f-sbn" label={t('setbackNorthM')} value={form.setbackNorth} min={0} step={0.5} disabled={busy}
                  onChange={v => update('setbackNorth', v)} />
                <NumField id="f-sbs" label={t('setbackSouthM')} value={form.setbackSouth} min={0} step={0.5} disabled={busy}
                  onChange={v => update('setbackSouth', v)} />
                <NumField id="f-sbe" label={t('setbackEastM')} value={form.setbackEast} min={0} step={0.5} disabled={busy}
                  onChange={v => update('setbackEast', v)} />
                <NumField id="f-sbw" label={t('setbackWestM')} value={form.setbackWest} min={0} step={0.5} disabled={busy}
                  onChange={v => update('setbackWest', v)} />
              </div>
            </Collapsible>
          </Section>

          <Section id="building" step={3} title={t('sectionBuilding')}>
            <div className="grid grid-cols-2 gap-3">
              <SelectField id="f-btype" label={t('buildingType')} value={form.buildingType} disabled={busy}
                onChange={v => update('buildingType', v as any)}
                options={[{ value: 'villa', label: t('typeVilla') }, { value: 'apartment', label: t('typeApartment') }]} />
              <NumField id="f-floors" label={t('floors')} value={form.floors} min={1} max={10} step={1} disabled={busy}
                onChange={v => { const c = Math.max(1, Math.min(10, v || 1)); update('floors', c); if (c > 1) update('hasStair', true); }} />
              <NumField id="f-bed" label={t('bedrooms')} value={form.bedrooms} min={1} max={6} step={1} disabled={busy}
                onChange={v => update('bedrooms', v)} />
              <NumField id="f-master" label={t('masterBedrooms')} value={form.masterBedrooms} min={0} max={2} step={1} disabled={busy}
                onChange={v => update('masterBedrooms', v)} />
              <NumField id="f-bath" label={t('bathrooms')} value={form.bathrooms} min={0} max={4} step={1} disabled={busy}
                onChange={v => update('bathrooms', v)} />
              <NumField id="f-wc" label={t('wc')} value={form.wc} min={0} max={2} step={1} disabled={busy}
                onChange={v => update('wc', v)} />
              <SelectField id="f-kitchen" label={t('kitchen')} value={form.kitchenType} disabled={busy}
                onChange={v => update('kitchenType', v as any)}
                options={[{ value: 'closed', label: t('kitchenClosed') }, { value: 'open', label: t('kitchenOpen') }, { value: 'semi-open', label: t('kitchenSemiOpen') }]} />
              <NumField id="f-parking" label={t('parkingSpaces')} value={form.parkingSpaces} min={0} max={6} step={1} disabled={busy}
                onChange={v => update('parkingSpaces', v)} />
            </div>
            <div className="grid grid-cols-2 gap-1 pt-1">
              <CheckField id="f-stair" label={t('hasStair')} checked={form.hasStair || form.floors > 1}
                disabled={busy || form.floors > 1} onChange={v => update('hasStair', v)}
                title={form.floors > 1 ? t('stairRequiredHint') : undefined} />
              <CheckField id="f-elevator" label={t('hasElevator')} checked={form.hasElevator} disabled={busy}
                onChange={v => update('hasElevator', v)} />
              <CheckField id="f-storage" label={t('hasStorage')} checked={form.hasStorage} disabled={busy}
                onChange={v => update('hasStorage', v)} />
            </div>
          </Section>

          {/* primary CTA — the ONE primary action of the app */}
          <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-ink-900/95 backdrop-blur border-t border-ink-700 z-10 space-y-2">
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={onGenerate}>
              {busy
                ? <><span className="spinner" aria-hidden="true" />{t('generating')}</>
                : tf('generateWithParams', { floors: faNum(form.floors) })}
            </button>
            {busy && (
              <div className="text-center text-xs text-ink-400" role="status" aria-live="polite">
                {stage === 'generate' && t('stageGenerate')}
                {stage === 'validate' && t('stageValidate')}
                {stage === 'prepare' && t('stagePrepare')}
              </div>
            )}
            {!busy && error && (
              <StatusNote tone="bad">
                {error}
                <span className="block text-[10px] text-ink-400">{t('errorDetailsPointer')}</span>
              </StatusNote>
            )}
            {!busy && !error && successNote && <StatusNote tone="ok">{successNote}</StatusNote>}
          </div>
        </aside>

        {/* ------------------------------------------------ canvas */}
        <main className="lg:col-span-6 lg:flex lg:flex-col border-b lg:border-b-0 lg:border-e border-ink-700 bg-ink-900 min-w-0">
          <div className="min-h-12 border-b border-ink-700 flex flex-wrap items-center justify-between gap-2 px-3 py-2 min-w-0">
            <div className="text-sm text-ink-400 min-w-0 truncate flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-slate-200 font-medium">{tf('planTitle', { floors: faNum(floorCount), shape: SHAPE_FA[form.siteShape] ?? form.siteShape })}</span>
              {displayCandidate && (
                <>
                  {vr && (vr.ok
                    ? <span className="badge-ok"><IconCheckCircle className="w-3 h-3" />{t('validTitle')}</span>
                    : <span className="badge-hard"><IconAlert className="w-3 h-3" />{t('invalidTitle')}</span>)}
                  {isEdited && <span className="badge-neutral">{t('editedBadge')}</span>}
                  <span className="text-xs text-ink-400">
                    {t('strategyLabel')}: <span className="mono ltr" dir="ltr">{displayCandidate.metadata.strategy}</span> · {STRATEGY_FA[displayCandidate.metadata.strategy] ?? ''}
                  </span>
                </>
              )}
            </div>
            <div className="flex gap-2 shrink-0 items-center flex-wrap">
              {displayCandidate && displayCandidate.floors.length > 1 && (
                <Segmented
                  ariaLabel={t('floorPickerLabel')}
                  value={selectedFloor}
                  onChange={i => { setSelectedFloor(i); setSelectedSpaceId(null); }}
                  options={displayCandidate.floors.map((f, i) => ({ value: i, label: faNum(i + 1) }))}
                />
              )}
              <button type="button" className="btn-secondary" disabled={!displayCandidate} onClick={onDownloadDXF}
                title={!displayCandidate ? t('dxfDisabledHint') : t('downloadDxfHint')}>
                <IconDownload className="w-3.5 h-3.5" />
                {t('downloadDxf')}
              </button>
              {/* DXF success feedback — persistent live region so screen readers
                  announce it when it appears; auto-dismisses after 5s. */}
              <div role="status" aria-live="polite" className="min-w-0">
                {dxfNote && <StatusNote tone="ok">{dxfNote}</StatusNote>}
              </div>
            </div>
          </div>

          {candidates.length > 1 && (
            <CandidatesBar candidates={candidates} validations={candValidations} selectedIdx={selectedIdx} onSelect={setSelectedIdx} />
          )}

          <div className="relative h-[56vh] min-h-[320px] lg:h-auto lg:flex-1 lg:min-h-0 p-3">
            <PlanCanvas
              candidate={displayCandidate}
              floorIndex={selectedFloor}
              selectedSpaceId={selectedSpaceId}
              onSelectSpace={setSelectedSpaceId}
            />
            {!displayCandidate && !busy && (
              <div className="absolute inset-0 p-6 flex flex-col items-center justify-center gap-2 text-center pointer-events-none">
                <IconCube className="w-10 h-10 text-ink-500" />
                <div className="text-sm font-semibold text-ink-400">{t('resultEmptyTitle')}</div>
                <p className="text-xs text-ink-400 max-w-sm leading-6">{t('resultEmptyHint')}</p>
                <p className="text-[10px] text-ink-400">{t('canvasPanHint')}</p>
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 bg-ink-900/75 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3 z-20" role="status" aria-live="polite">
                <span className="spinner-accent !w-6 !h-6" aria-hidden="true" />
                <div className="text-sm text-slate-200">
                  {stage === 'generate' && t('stageGenerate')}
                  {stage === 'validate' && t('stageValidate')}
                  {stage === 'prepare' && t('stagePrepare')}
                </div>
                <div className="text-[11px] text-ink-400">{t('busyHint')}</div>
              </div>
            )}
          </div>

          {displayCandidate && (
            <>
              <PlanLegend />
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-px bg-ink-700 border-t border-ink-700 text-[11px] min-w-0">
                <Metric label={t('metricUsable')} value={`${(displayCandidate.metrics.usableAreaRatio * 100).toFixed(0)}%`} />
                <Metric label={t('metricCirculation')} value={`${(displayCandidate.metrics.circulationRatio * 100).toFixed(0)}%`} />
                <Metric label={t('metricRoomDev')} value={`${(displayCandidate.metrics.roomAreaDeviation * 100).toFixed(0)}%`} />
                <Metric label={t('metricDaylight')} value={`${(displayCandidate.metrics.daylightExposure * 100).toFixed(0)}%`} />
                <Metric label={t('metricValid')} value={vr?.ok ? t('validTitle') : t('invalidTitle')} tone={vr?.ok ? 'ok' : 'bad'} />
              </div>
            </>
          )}
        </main>

        {/* ------------------------------------------------ results / findings / editing */}
        <aside className="lg:col-span-3 lg:overflow-y-auto p-4 space-y-4 bg-ink-900 min-w-0">
          <Section id="result" title={t('resultTitle')}>
            <ResultStatusCard state={resultState} />
          </Section>

          <Section id="validation" title={tf('sectionValidation', { floors: faNum(floorCount) })}>
            {!vr && <StatusNote tone="info">{t('generateToValidate')}</StatusNote>}
            {vr && <FindingsPanel vr={vr} />}
          </Section>

          {/* Phase 4 roadmap: read-only regulation explorer (packs, rule status, sources). */}
          <Section id="regulations" title={t('regExplorerTitle')}>
            <RegulationExplorer input={project?.input ?? null} />
          </Section>

          <Section id="editing" title={t('sectionEditing')}>
            {!displayCandidate && <StatusNote tone="info">{t('generateFirst')}</StatusNote>}
            {displayCandidate && !selectedSpace && <StatusNote tone="info">{t('editHint')}</StatusNote>}
            {displayCandidate && currentFloor && selectedSpace && (
              <div className="space-y-3 text-xs">
                {/* selected space — identity card */}
                <div className="card !p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200 truncate">{spaceLabel(selectedSpace.label)}</span>
                    <span className="badge-neutral shrink-0">{spaceTypeFromLabel(selectedSpace)}</span>
                  </div>
                  <div className="text-ink-400 leading-6">
                    {t('area')}: <span className="ltr" dir="ltr">{selectedSpace.area.toFixed(2)} m²</span>
                    {' · '}
                    {t('width')} × {t('height')}: <span className="ltr" dir="ltr">{selectedSpace.rect.w.toFixed(2)}×{selectedSpace.rect.h.toFixed(2)}</span>
                  </div>
                  <div className="finding-tech">{selectedSpace.id}</div>
                  {selectedSpace.locked && (selectedSpace.locked.position || selectedSpace.locked.size || selectedSpace.locked.geometry) && (
                    <div className="flex flex-wrap gap-1">
                      {selectedSpace.locked.position && <span className="badge-soft"><IconLock className="w-2.5 h-2.5" />{t('lockedPos')}</span>}
                      {selectedSpace.locked.size && <span className="badge-soft"><IconLock className="w-2.5 h-2.5" />{t('lockedSize')}</span>}
                      {selectedSpace.locked.geometry && <span className="badge-soft"><IconLock className="w-2.5 h-2.5" />{t('lockedGeom')}</span>}
                    </div>
                  )}
                </div>

                {/* move */}
                <div className="card !p-2.5">
                  <div className="text-[11px] font-semibold text-slate-300">{t('editMoveTitle')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField id="f-mx" label={t('moveX')} value={moveX} step={0.1} onChange={setMoveX} dir="ltr" />
                    <NumField id="f-my" label={t('moveY')} value={moveY} step={0.1} onChange={setMoveY} dir="ltr" />
                  </div>
                  <button type="button" className="btn-secondary w-full !text-xs" onClick={doMove}>{t('applyAction')}</button>
                </div>

                {/* resize */}
                <div className="card !p-2.5">
                  <div className="text-[11px] font-semibold text-slate-300">{t('editResizeTitle')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumField id="f-rw" label={t('width')} value={resizeW} step={0.1} min={1} onChange={setResizeW} dir="ltr" />
                    <NumField id="f-rh" label={t('height')} value={resizeH} step={0.1} min={1} onChange={setResizeH} dir="ltr" />
                  </div>
                  <button type="button" className="btn-secondary w-full !text-xs" onClick={doResize}>{t('applyAction')}</button>
                </div>

                {/* L-shape — advanced, collapsed by default */}
                <Collapsible title={t('editLShapeTitle')} className="bg-ink-800/60 border border-ink-700 rounded-md">
                  <div className="grid grid-cols-3 gap-2">
                    <NumField id="f-nw" label={t('notchWidthM')} value={notchW} step={0.1} min={0.5} onChange={setNotchW} />
                    <NumField id="f-nl" label={t('notchLengthM')} value={notchL} step={0.1} min={0.5} onChange={setNotchL} />
                    <SelectField id="f-nc" label={t('notchCorner')} value={notchCorner} onChange={v => setNotchCorner(v as 'ne' | 'nw' | 'se' | 'sw')}
                      options={[
                        { value: 'ne', label: SIDE_FA['north-east'] },
                        { value: 'nw', label: SIDE_FA['north-west'] },
                        { value: 'se', label: SIDE_FA['south-east'] },
                        { value: 'sw', label: SIDE_FA['south-west'] },
                      ]} />
                  </div>
                  <button type="button" className="btn-secondary w-full !text-xs" onClick={doSetLShape}>{t('applyAction')}</button>
                </Collapsible>

                {/* locks */}
                <div className="card !p-2.5">
                  <div className="text-[11px] font-semibold text-slate-300">{t('editLockTitle')}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" className="btn-tertiary !text-xs !py-1.5" onClick={() => doLock('position')}><IconLock className="w-3 h-3" />{t('lockedPos')}</button>
                    <button type="button" className="btn-tertiary !text-xs !py-1.5" onClick={() => doLock('size')}><IconLock className="w-3 h-3" />{t('lockedSize')}</button>
                    <button type="button" className="btn-tertiary !text-xs !py-1.5" onClick={() => doLock('all')}><IconLock className="w-3 h-3" />{t('lockAllLabel')}</button>
                    <button type="button" className="btn-tertiary !text-xs !py-1.5" onClick={() => doUnlock('all')}><IconUnlock className="w-3 h-3" />{t('unlockAllLabel')}</button>
                  </div>
                </div>

                {/* technical space details — preserved, progressively disclosed */}
                <Collapsible title={t('spaceTechTitle')} className="bg-ink-800/60 border border-ink-700 rounded-md">
                  <div className="text-ink-400 leading-6">
                    {t('shape')}: <span className="ltr" dir="ltr">{selectedSpace.shapeType ?? 'rectangle'}</span>
                    {' · '}
                    {t('verts')}: <span className="ltr" dir="ltr">{selectedSpace.polygon.length}</span>
                  </div>
                  <div className="text-ink-400 leading-6">
                    {t('privacy')}: <span className="ltr" dir="ltr">{selectedSpace.privacy}</span>
                    {' · '}
                    {t('zone')}: <span className="ltr" dir="ltr">{selectedSpace.zone}</span>
                  </div>
                  {selectedSpace.constraints && (
                    <div>
                      <div className="font-semibold text-slate-300">{t('constraints')}</div>
                      <div dir="ltr" className="mono text-[10px] leading-5">minArea {selectedSpace.constraints.minArea ?? '-'} · target {selectedSpace.constraints.targetArea ?? '-'} · max {selectedSpace.constraints.maxArea ?? '-'}</div>
                      <div dir="ltr" className="mono text-[10px] leading-5">minW {selectedSpace.constraints.minWidth ?? '-'} · minL {selectedSpace.constraints.minLength ?? '-'} · aspect {selectedSpace.constraints.preferredAspectRatio ?? '-'}</div>
                    </div>
                  )}
                  {selectedSpace.locked && (
                    <div className="text-[10px] text-ink-400">
                      {t('lockedPos')}: {selectedSpace.locked.position ? '✓' : '✗'} · {t('lockedSize')}: {selectedSpace.locked.size ? '✓' : '✗'} · {t('lockedGeom')}: {selectedSpace.locked.geometry ? '✓' : '✗'} · {t('lockedAdj')}: {selectedSpace.locked.adjacency ? '✓' : '✗'}
                    </div>
                  )}
                </Collapsible>

                {editError && (
                  <div className="p-2 rounded border border-bad/40 bg-bad/10 text-bad text-xs whitespace-pre-wrap" role="alert">{editError}</div>
                )}
                <EditFindingsList findings={editFindings} />
                <p className="text-[10px] text-ink-400 leading-5">{t('editEngineNote')}</p>
              </div>
            )}
          </Section>

          {displayCandidate && (
            <Section id="stairs" title={t('sectionStairs')}>
              <div className="text-xs space-y-2 max-h-64 overflow-y-auto">
                {displayCandidate.floors.every(fl => (fl.stairs ?? []).length === 0) && (
                  <StatusNote tone="info">{t('noStairs')}</StatusNote>
                )}
                {displayCandidate.floors.map(fl => (fl.stairs ?? []).map((st: any) => (
                  <div key={st.id} className="p-2 rounded bg-ink-800 border border-ink-700 space-y-1">
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-semibold text-slate-200 truncate">{STAIR_TYPE_FA[st.type] ?? st.type} — {tf('stairFloor', { level: faNum(fl.level) })}</span>
                      <span className="mono text-[10px] text-ink-400 ltr shrink-0" dir="ltr">{st.id}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>{t('stairRisers')}: <span className="ltr" dir="ltr">{st.totalRisers}</span></span>
                      <span>{t('stairTread')}: <span className="ltr" dir="ltr">{((st.flights?.[0]?.treadDepth ?? st.treadDepth ?? st.tread ?? 0) * 1000).toFixed(0)}mm</span></span>
                      <span>{t('stairRiser')}: <span className="ltr" dir="ltr">{((st.flights?.[0]?.riserHeight ?? st.riserHeight ?? st.riser ?? 0) * 100).toFixed(1)}cm</span></span>
                      <span>{t('stairFlights')}: <span className="ltr" dir="ltr">{st.flights?.length ?? 0}</span></span>
                      <span>{t('stairLandings')}: <span className="ltr" dir="ltr">{st.landings?.length ?? 0}</span></span>
                    </div>
                    {(st.flights ?? []).length > 0 && (
                      <div className="text-[10px] text-ink-400 ltr" dir="ltr">
                        {(st.flights ?? []).map((f: any) => `${f.riserCount}R/${f.treadCount}T × ${(f.treadDepth * 100).toFixed(0)}cm`).join(' + ')}
                      </div>
                    )}
                  </div>
                )))}
              </div>
            </Section>
          )}

          {displayCandidate && (
            <Section id="spaces" title={tf('sectionSpaces', { floor: faNum(selectedFloor) })}>
              <ul className="text-xs space-y-1 max-h-64 overflow-y-auto">
                {(displayCandidate.floors[selectedFloor]?.spaces ?? displayCandidate.floors[0].spaces).map(s => (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={selectedSpaceId === s.id}
                      onClick={() => setSelectedSpaceId(s.id)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border transition-colors text-start ${
                        selectedSpaceId === s.id
                          ? 'bg-accent-500/20 border-accent-500/50 text-slate-100'
                          : 'border-transparent hover:bg-ink-800 text-slate-300'
                      }`}
                    >
                      <span className="truncate flex items-center gap-1">
                        {spaceLabel(s.label)}
                        {(s.locked?.position || s.locked?.geometry || s.locked?.size) && <IconLock className="w-3 h-3 text-warn shrink-0" />}
                      </span>
                      <span className="text-ink-400 shrink-0 ltr mono text-[10px]" dir="ltr">{s.area.toFixed(1)} m² · {s.polygon.length}v</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
