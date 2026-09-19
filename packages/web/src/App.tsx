import React, { useMemo, useState, useEffect } from 'react';
import { createProject, generate, exportDXF, validateCandidate, buildDocumentation, Editing } from '@archgenius/core';
import type { ProjectInput, Project } from '@archgenius/core';
import type { LayoutCandidate } from '@archgenius/core';
import type { Space } from '@archgenius/core';
import { PlanCanvas } from './PlanCanvas';
import {
  t, tf, DIR, LOCALE, spaceLabel, spaceTypeFromLabel,
  SEVERITY_FA, STRATEGY_FA, STAIR_TYPE_FA, SHAPE_FA, SIDE_FA,
  findingCodeTitle, persianSummary, translateEngineError,
  findingMessageFa, translateInfeasibleExplanation,
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
  siteWidth: 15,
  siteLength: 20,
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
  const [error, setError] = useState<string | null>(null);

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

  const onGenerate = () => {
    setBusy(true); setError(null);
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
      // Phase 13.2: infeasible results expose NO usable candidate — surface the explicit
      // infeasible state instead of silently presenting a below-minimum plan.
      const result = generate(prj);
      setProject(prj);
      setCandidates(result.candidates);
      setSelectedIdx(0);
      setSelectedFloor(0);
      setEditedCandidate(result.candidates[0] ?? null);
      if (result.infeasible) {
        setError(`${t('errorInfeasible')}\n${translateInfeasibleExplanation(result.infeasible.explanation)}`);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const vr = useMemo(() => displayCandidate ? validateCandidate(displayCandidate) : null, [displayCandidate]);
  const doc = useMemo(() => {
    if (!project || !displayCandidate) return null;
    try {
      return buildDocumentation(project, displayCandidate);
    } catch {
      return null;
    }
  }, [project, displayCandidate]);

  const onDownloadDXF = () => {
    if (!displayCandidate || !project) return;
    const { dxf } = exportDXF(displayCandidate, project.input.name);
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.input.name.replace(/\s+/g, '_')}_archgenius.dxf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const floorCount = displayCandidate?.floors.length ?? form.floors;
  const currentFloor = displayCandidate?.floors[Math.max(0, Math.min(selectedFloor, (displayCandidate?.floors.length ?? 1) - 1))];
  const selectedSpace: Space | undefined = currentFloor?.spaces.find(s => s.id === selectedSpaceId);

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

  return (
    <div dir={DIR} lang={LOCALE} className="h-full flex flex-col overflow-x-hidden">
      <header className="h-14 border-b border-ink-700 flex items-center justify-between px-6 bg-ink-800 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-accent-500 flex items-center justify-center font-bold shrink-0">A</div>
          <div className="min-w-0">
            <div className="font-semibold truncate">ArchGenius — {t('appName')}</div>
            <div className="text-[10px] text-ink-400 truncate">{t('headerTagline')}</div>
          </div>
        </div>
        <div className="text-xs text-ink-400 shrink-0">{t('headerMeta')}</div>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden overflow-x-hidden">
        <aside className="col-span-3 border-e border-ink-700 overflow-y-auto overflow-x-hidden p-4 space-y-4 min-w-0">
          <Section title={t('sectionProject')}>
            <div className="field">
              <label>{t('projectName')}</label>
              <input value={form.name} onChange={e => update('name', e.target.value)} />
            </div>
            <div className="field">
              <label>{t('seedLabel')}</label>
              <input type="number" min={0} step={1} value={form.seed} onChange={e => update('seed', +e.target.value)} />
              <span className="text-[10px] text-ink-400">{t('seedHint')}</span>
            </div>
          </Section>

          <Section title={t('sectionSite')}>
            <div className="grid grid-cols-2 gap-3">
              <div className="field col-span-2">
                <label>{t('siteShape')}</label>
                <select value={form.siteShape} onChange={e => update('siteShape', e.target.value as any)}>
                  <option value="rectangle">{t('shapeRectangle')}</option>
                  <option value="l-shape">{t('shapeLShape')}</option>
                  <option value="polygon">{t('shapePolygon')}</option>
                </select>
                <span className="text-[9px] text-ink-400">{t('siteShapeHint')}</span>
              </div>
              <div className="field">
                <label>{t('widthM')}</label>
                <input type="number" min={5} step={0.5} value={form.siteWidth} onChange={e => update('siteWidth', +e.target.value)} />
              </div>
              <div className="field">
                <label>{t('lengthM')}</label>
                <input type="number" min={5} step={0.5} value={form.siteLength} onChange={e => update('siteLength', +e.target.value)} />
              </div>
              <div className="field">
                <label>{t('accessSide')}</label>
                <select value={form.accessSide} onChange={e => update('accessSide', e.target.value as any)}>
                  <option value="south">{SIDE_FA.south}</option>
                  <option value="north">{SIDE_FA.north}</option>
                  <option value="east">{SIDE_FA.east}</option>
                  <option value="west">{SIDE_FA.west}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('streetWidthM')}</label>
                <input type="number" min={3} step={0.5} value={form.streetWidth} onChange={e => update('streetWidth', +e.target.value)} />
              </div>
            </div>

            {form.siteShape === 'l-shape' && (
              <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                <div className="text-[11px] font-semibold text-accent-300">{t('lNotchTitle')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="field">
                    <label>{t('notchWidthM')}</label>
                    <input type="number" min={1} step={0.5} value={form.lNotchWidth} onChange={e => update('lNotchWidth', +e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('notchLengthM')}</label>
                    <input type="number" min={1} step={0.5} value={form.lNotchLength} onChange={e => update('lNotchLength', +e.target.value)} />
                  </div>
                  <div className="field col-span-2">
                    <label>{t('notchCorner')}</label>
                    <select value={form.lNotchCorner} onChange={e => update('lNotchCorner', e.target.value as any)}>
                      <option value="north-east">{SIDE_FA['north-east']}</option>
                      <option value="north-west">{SIDE_FA['north-west']}</option>
                      <option value="south-east">{SIDE_FA['south-east']}</option>
                      <option value="south-west">{SIDE_FA['south-west']}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {form.siteShape === 'polygon' && (
              <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                <div className="text-[11px] font-semibold text-accent-300">{t('polygonVertsTitle')}</div>
                <textarea dir="ltr" className="w-full h-24 bg-ink-900 border border-ink-700 rounded p-2 text-xs mono text-left" value={form.polygonJson} onChange={e => update('polygonJson', e.target.value)} />
              </div>
            )}

            <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
              <div className="text-[11px] font-semibold text-accent-300">{t('setbacksTitle')}</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="field"><label>{t('setbackNorthM')}</label><input type="number" min={0} step={0.5} value={form.setbackNorth} onChange={e => update('setbackNorth', +e.target.value)} /></div>
                <div className="field"><label>{t('setbackSouthM')}</label><input type="number" min={0} step={0.5} value={form.setbackSouth} onChange={e => update('setbackSouth', +e.target.value)} /></div>
                <div className="field"><label>{t('setbackEastM')}</label><input type="number" min={0} step={0.5} value={form.setbackEast} onChange={e => update('setbackEast', +e.target.value)} /></div>
                <div className="field"><label>{t('setbackWestM')}</label><input type="number" min={0} step={0.5} value={form.setbackWest} onChange={e => update('setbackWest', +e.target.value)} /></div>
              </div>
            </div>
          </Section>

          <Section title={t('sectionBuilding')}>
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>{t('buildingType')}</label>
                <select value={form.buildingType} onChange={e => update('buildingType', e.target.value as any)}>
                  <option value="villa">{t('typeVilla')}</option>
                  <option value="apartment">{t('typeApartment')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('floors')}</label>
                <input type="number" min={1} max={10} value={form.floors} onChange={e => { const v = Math.max(1, Math.min(10, +e.target.value || 1)); update('floors', v); if (v > 1) update('hasStair', true); }} />
              </div>
              <div className="field"><label>{t('bedrooms')}</label><input type="number" min={1} max={6} value={form.bedrooms} onChange={e => update('bedrooms', +e.target.value)} /></div>
              <div className="field"><label>{t('masterBedrooms')}</label><input type="number" min={0} max={2} value={form.masterBedrooms} onChange={e => update('masterBedrooms', +e.target.value)} /></div>
              <div className="field"><label>{t('bathrooms')}</label><input type="number" min={0} max={4} value={form.bathrooms} onChange={e => update('bathrooms', +e.target.value)} /></div>
              <div className="field"><label>{t('wc')}</label><input type="number" min={0} max={2} value={form.wc} onChange={e => update('wc', +e.target.value)} /></div>
              <div className="field">
                <label>{t('kitchen')}</label>
                <select value={form.kitchenType} onChange={e => update('kitchenType', e.target.value as any)}>
                  <option value="closed">{t('kitchenClosed')}</option>
                  <option value="open">{t('kitchenOpen')}</option>
                  <option value="semi-open">{t('kitchenSemiOpen')}</option>
                </select>
              </div>
              <div className="field"><label>{t('parkingSpaces')}</label><input type="number" min={0} max={6} value={form.parkingSpaces} onChange={e => update('parkingSpaces', +e.target.value)} /></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasStair || form.floors > 1} disabled={form.floors > 1} onChange={e => update('hasStair', e.target.checked)} /> {t('hasStair')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasElevator} onChange={e => update('hasElevator', e.target.checked)} /> {t('hasElevator')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasStorage} onChange={e => update('hasStorage', e.target.checked)} /> {t('hasStorage')}</label>
            </div>
          </Section>

          <div className="sticky bottom-0 pt-2 bg-ink-900/80 backdrop-blur">
            <button className="btn-primary w-full" disabled={busy} onClick={onGenerate}>
              {busy ? t('generating') : tf('generateWithParams', { floors: form.floors })}
            </button>
            {error && <div className="mt-2 text-xs text-bad border border-bad/40 bg-bad/10 p-2 rounded whitespace-pre-wrap">{error}</div>}
          </div>
        </aside>

        <main className="col-span-6 flex flex-col border-e border-ink-700 bg-ink-900 min-w-0 overflow-x-hidden">
          <div className="h-12 border-b border-ink-700 flex items-center justify-between px-4 min-w-0 gap-2">
            <div className="text-sm text-ink-400 min-w-0 truncate flex items-center gap-2">
              <span className="text-slate-200 font-medium">{tf('planTitle', { floors: floorCount, shape: SHAPE_FA[form.siteShape] ?? form.siteShape })}</span>
              {displayCandidate && <span className="text-xs">{t('strategyLabel')}: <span className="mono" dir="ltr">{displayCandidate.metadata.strategy}</span> · {STRATEGY_FA[displayCandidate.metadata.strategy] ?? ''} · {tf('floorOf', { current: selectedFloor + 1, total: floorCount })}</span>}
            </div>
            <div className="flex gap-2 shrink-0 items-center">
              {displayCandidate && displayCandidate.floors.length > 1 && (
                <select className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1" value={selectedFloor} onChange={e => { setSelectedFloor(+e.target.value); setSelectedSpaceId(null); }}>
                  {displayCandidate.floors.map((f, i) => <option key={i} value={i}>{tf('floorSelect', { index: i, level: f.level })}</option>)}
                </select>
              )}
              {candidates.length > 1 && (
                <select className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1 max-w-[180px]" value={selectedIdx} onChange={e => setSelectedIdx(+e.target.value)}>
                  {candidates.map((c, i) => <option key={c.id} value={i}>{tf('candidateSelect', { index: i + 1, strategy: STRATEGY_FA[c.metadata.strategy] ?? c.metadata.strategy })}</option>)}
                </select>
              )}
              <button className="btn-secondary" disabled={!displayCandidate} onClick={onDownloadDXF}>{t('downloadDxf')}</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-w-0 overflow-hidden">
            <div className="w-full h-full max-h-full min-w-0">
              <PlanCanvas candidate={displayCandidate} floorIndex={selectedFloor} width={800} height={560} selectedSpaceId={selectedSpaceId} onSelectSpace={setSelectedSpaceId} />
            </div>
          </div>
          {displayCandidate && (
            <div className="h-20 border-t border-ink-700 grid grid-cols-5 gap-px bg-ink-700 text-[11px] min-w-0">
              <Metric label={t('metricUsable')} value={`${(displayCandidate.metrics.usableAreaRatio * 100).toFixed(0)}%`} />
              <Metric label={t('metricCirculation')} value={`${(displayCandidate.metrics.circulationRatio * 100).toFixed(0)}%`} />
              <Metric label={t('metricRoomDev')} value={`${(displayCandidate.metrics.roomAreaDeviation * 100).toFixed(0)}%`} />
              <Metric label={t('metricDaylight')} value={`${(displayCandidate.metrics.daylightExposure * 100).toFixed(0)}%`} />
              <Metric label={t('metricValid')} value={displayCandidate.valid ? t('yes') : t('no')} />
            </div>
          )}
        </main>

        <aside className="col-span-3 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-ink-900 min-w-0">
          <Section title={t('sectionEditing')}>
            {!displayCandidate && <div className="text-xs text-ink-400">{t('generateFirst')}</div>}
            {displayCandidate && currentFloor && (
              <div className="space-y-3 text-xs">
                <div className="field">
                  <label>{tf('selectRoom', { floor: selectedFloor })}</label>
                  <select value={selectedSpaceId ?? ''} onChange={e => setSelectedSpaceId(e.target.value || null)} className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1">
                    <option value="">{t('selectPlaceholder')}</option>
                    {currentFloor.spaces.map(s => (
                      <option key={s.id} value={s.id}>{spaceLabel(s.label)} · {s.area.toFixed(1)}m² {s.locked?.position || s.locked?.geometry ? '🔒' : ''}</option>
                    ))}
                  </select>
                </div>

                {selectedSpace && (
                  <>
                    <div className="p-2 bg-ink-800 rounded border border-ink-700 space-y-1">
                      <div className="font-semibold text-slate-200">{spaceLabel(selectedSpace.label)} — {spaceTypeFromLabel(selectedSpace)}</div>
                      <div className="mono text-[10px]" dir="ltr">id: {selectedSpace.id}</div>
                      <div>{t('area')}: <span dir="ltr">{selectedSpace.area.toFixed(2)} m²</span> · {t('width')} × {t('height')}: <span dir="ltr">{selectedSpace.rect.w.toFixed(2)}×{selectedSpace.rect.h.toFixed(2)}</span></div>
                      <div>{t('shape')}: <span dir="ltr">{selectedSpace.shapeType ?? 'rectangle'}</span> · {t('verts')}: <span dir="ltr">{selectedSpace.polygon.length}</span></div>
                      <div>{t('privacy')}: <span dir="ltr">{selectedSpace.privacy}</span> · {t('zone')}: <span dir="ltr">{selectedSpace.zone}</span></div>
                      {selectedSpace.constraints && (
                        <div className="mt-1 p-1 bg-ink-900 rounded border border-ink-700">
                          <div className="font-semibold">{t('constraints')}</div>
                          <div dir="ltr" className="mono text-[10px]">minArea {selectedSpace.constraints.minArea ?? '-'} · target {selectedSpace.constraints.targetArea ?? '-'} · max {selectedSpace.constraints.maxArea ?? '-'}</div>
                          <div dir="ltr" className="mono text-[10px]">minW {selectedSpace.constraints.minWidth ?? '-'} · minL {selectedSpace.constraints.minLength ?? '-'} · aspect {selectedSpace.constraints.preferredAspectRatio ?? '-'}</div>
                        </div>
                      )}
                      {selectedSpace.locked && (
                        <div className="mt-1 p-1 bg-ink-900 rounded border border-warn/30">
                          <div className="font-semibold text-warn">{t('locked')}</div>
                          <div className="text-[10px]">{t('lockedPos')}: {selectedSpace.locked.position ? '✓' : '✗'} · {t('lockedSize')}: {selectedSpace.locked.size ? '✓' : '✗'} · {t('lockedGeom')}: {selectedSpace.locked.geometry ? '✓' : '✗'} · {t('lockedAdj')}: {selectedSpace.locked.adjacency ? '✓' : '✗'}</div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="field"><label dir="ltr">{t('moveX')}</label><input type="number" step={0.1} value={moveX} onChange={e => setMoveX(+e.target.value)} /></div>
                      <div className="field"><label dir="ltr">{t('moveY')}</label><input type="number" step={0.1} value={moveY} onChange={e => setMoveY(+e.target.value)} /></div>
                    </div>
                    <button className="btn-secondary w-full" onClick={doMove}>{t('moveRoom')}</button>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="field"><label>{t('width')}</label><input type="number" step={0.1} min={1} value={resizeW} onChange={e => setResizeW(+e.target.value)} /></div>
                      <div className="field"><label>{t('height')}</label><input type="number" step={0.1} min={1} value={resizeH} onChange={e => setResizeH(+e.target.value)} /></div>
                    </div>
                    <button className="btn-secondary w-full" onClick={doResize}>{t('resizeSafe')}</button>

                    <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                      <div className="font-semibold">{t('setLShape')}</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="field"><label>{t('notchWidthM')}</label><input type="number" step={0.1} min={0.5} value={notchW} onChange={e => setNotchW(+e.target.value)} /></div>
                        <div className="field"><label>{t('notchLengthM')}</label><input type="number" step={0.1} min={0.5} value={notchL} onChange={e => setNotchL(+e.target.value)} /></div>
                        <div className="field"><label>{t('notchCorner')}</label><select value={notchCorner} onChange={e => setNotchCorner(e.target.value as any)} className="w-full bg-ink-900 border border-ink-700 rounded px-1 py-1"><option value="ne">شمال‌شرقی (NE)</option><option value="nw">شمال‌غربی (NW)</option><option value="se">جنوب‌شرقی (SE)</option><option value="sw">جنوب‌غربی (SW)</option></select></div>
                      </div>
                      <button className="btn-secondary w-full" onClick={doSetLShape}>{t('setLShapeAction')}</button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button className="btn-secondary" onClick={() => doLock('position')}>{t('lockPos')}</button>
                      <button className="btn-secondary" onClick={() => doLock('size')}>{t('lockSize')}</button>
                      <button className="btn-secondary" onClick={() => doLock('all')}>{t('lockAll')}</button>
                      <button className="btn-secondary" onClick={() => doUnlock('all')}>{t('unlockAll')}</button>
                    </div>

                    {editError && <div className="mt-2 p-2 rounded border border-bad/40 bg-bad/10 text-bad text-xs whitespace-pre-wrap">{editError}</div>}
                    {editFindings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="font-semibold">{tf('validationAfterEdit', { count: editFindings.length })}</div>
                        {editFindings.slice(0, 15).map((f: any, i: number) => (
                          <div key={i} className="flex gap-1 p-1 rounded bg-ink-800 border border-ink-700 text-[10px]">
                            <span className={f.severity === 'hard' ? 'badge-hard' : f.severity === 'soft' ? 'badge-soft' : 'badge-adv'}>{SEVERITY_FA[f.severity] ?? f.severity}</span>
                            <span className="truncate">{findingCodeTitle(f.code)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Section>

          <Section title={tf('sectionValidation', { floors: floorCount })}>
            {!vr && <div className="text-xs text-ink-400">{t('generateToValidate')}</div>}
            {vr && (
              <div className="space-y-2 text-xs">
                <div className={`p-2 rounded border ${vr.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-bad/40 bg-bad/10 text-bad'}`}>
                  <div className="font-bold text-sm">{vr.ok ? t('validTitle') : t('invalidTitle')}</div>
                  <div className="opacity-80">{tf('summaryCounts', { hard: vr.hard.length, soft: vr.soft.length, advisory: vr.advisory.length })}</div>
                  <div className="mt-1 flex gap-1">
                    <span className="border border-bad/40 text-bad px-1 rounded text-[9px]">{tf('badgeHard', { count: vr.hard.length })}</span>
                    <span className="border border-warn/40 text-warn px-1 rounded text-[9px]">{tf('badgeSoft', { count: vr.soft.length })}</span>
                    <span className="border border-ink-600 text-ink-400 px-1 rounded text-[9px]">{tf('badgeAdv', { count: vr.advisory.length })}</span>
                  </div>
                </div>
                {[...vr.hard, ...vr.soft, ...vr.advisory].slice(0, 25).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded border border-ink-700 bg-ink-800 min-w-0 overflow-hidden">
                    <span className={f.severity === 'hard' ? 'badge-hard' : f.severity === 'soft' ? 'badge-soft' : 'badge-adv'}>{SEVERITY_FA[f.severity] ?? f.severity}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 break-words">{findingCodeTitle(f.code ?? f.ruleId ?? '')}</div>
                      <div className="break-words opacity-80">{findingMessageFa(f)}</div>
                      <div className="text-[10px] text-ink-400 mono truncate" dir="ltr">{f.code}{f.ruleId ? ` · ${f.ruleId}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {displayCandidate && (
            <Section title={tf('sectionStairs')}>
              <div className="text-xs space-y-2 max-h-64 overflow-y-auto">
                {displayCandidate.floors.every(fl => (fl.stairs ?? []).length === 0) && (
                  <div className="text-ink-400">{t('noStairs')}</div>
                )}
                {displayCandidate.floors.map(fl => (fl.stairs ?? []).map((st: any) => (
                  <div key={st.id} className="p-2 rounded bg-ink-800 border border-ink-700 space-y-1">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-200">{STAIR_TYPE_FA[st.type] ?? st.type} — {tf('stairFloor', { level: fl.level })}</span>
                      <span className="mono text-[10px] text-ink-400" dir="ltr">{st.id}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>{t('stairRisers')}: <span dir="ltr">{st.totalRisers}</span></span>
                      <span>{t('stairTread')}: <span dir="ltr">{((st.flights?.[0]?.treadDepth ?? st.treadDepth ?? st.tread ?? 0) * 1000).toFixed(0)}mm</span></span>
                      <span>{t('stairRiser')}: <span dir="ltr">{((st.flights?.[0]?.riserHeight ?? st.riserHeight ?? st.riser ?? 0) * 100).toFixed(1)}cm</span></span>
                      <span>{t('stairFlights')}: <span dir="ltr">{st.flights?.length ?? 0}</span></span>
                      <span>{t('stairLandings')}: <span dir="ltr">{st.landings?.length ?? 0}</span></span>
                    </div>
                    {(st.flights ?? []).length > 0 && (
                      <div className="text-[10px] text-ink-400">
                        {(st.flights ?? []).map((f: any) => `${f.riserCount}R/${f.treadCount}T × ${(f.treadDepth * 100).toFixed(0)}cm`).join(' + ')}
                      </div>
                    )}
                  </div>
                )))}
              </div>
            </Section>
          )}

          {displayCandidate && (
            <Section title={tf('sectionSpaces', { floor: selectedFloor })}>
              <div className="text-xs space-y-1 max-h-64 overflow-y-auto">
                {(displayCandidate.floors[selectedFloor]?.spaces ?? displayCandidate.floors[0].spaces).map(s => (
                  <div key={s.id} className={`flex justify-between px-2 py-1 rounded hover:bg-ink-800 cursor-pointer ${selectedSpaceId === s.id ? 'bg-accent-500/20 border border-accent-500/40' : ''}`} onClick={() => setSelectedSpaceId(s.id)}>
                    <span className="truncate ms-2">{spaceLabel(s.label)} {s.locked?.position ? '🔒' : ''}</span>
                    <span className="text-ink-400 shrink-0" dir="ltr">{s.area.toFixed(1)} m² · {s.polygon.length}v</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-header truncate">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-900 p-3 flex flex-col justify-center min-w-0">
      <div className="text-[10px] text-ink-400 truncate">{label}</div>
      <div className="text-lg font-semibold text-slate-100 truncate" dir="ltr">{value}</div>
    </div>
  );
}
