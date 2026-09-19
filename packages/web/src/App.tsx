import React, { useMemo, useState, useEffect } from 'react';
import { createProject, generate, exportDXF, validateCandidate, buildDocumentation, Editing } from '@archgenius/core';
import type { ProjectInput, Project } from '@archgenius/core';
import type { LayoutCandidate } from '@archgenius/core';
import type { Space } from '@archgenius/core';
import { PlanCanvas } from './PlanCanvas';

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
  name: 'Sample Villa',
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
          throw new Error('Invalid polygon JSON — must be array of {x,y}');
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
        setError(`INFEASIBLE — no geometrically valid candidate for this site/program.\n${result.infeasible.explanation}`);
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
    a.download = `${project.input.name.replace(/\s+/g, '_')}_phase11.dxf`;
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
      setEditError(res.error ?? 'Edit failed');
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
    <div className="h-full flex flex-col overflow-x-hidden">
      <header className="h-14 border-b border-ink-700 flex items-center justify-between px-6 bg-ink-800 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-accent-500 flex items-center justify-center font-bold shrink-0">A</div>
          <div className="min-w-0">
            <div className="font-semibold tracking-wide truncate">ArchGenius</div>
            <div className="text-[10px] text-ink-400 uppercase tracking-widest truncate">Parametric Planning & Constraint-Aware Editing · Phase 11 — Polygon Canonical · Bounded Repair · Locking</div>
          </div>
        </div>
        <div className="text-xs text-ink-400 mono shrink-0">v0.11.0-phase11 · offline-first · DXF R12 polygon · Deterministic</div>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden overflow-x-hidden">
        <aside className="col-span-3 border-r border-ink-700 overflow-y-auto overflow-x-hidden p-4 space-y-4 min-w-0">
          <Section title="Project">
            <div className="field">
              <label>Project name</label>
              <input value={form.name} onChange={e => update('name', e.target.value)} />
            </div>
            <div className="field">
              <label>Seed (deterministic)</label>
              <input type="number" min={0} step={1} value={form.seed} onChange={e => update('seed', +e.target.value)} />
              <span className="text-[10px] text-ink-400">Same input+seed+edits → same output</span>
            </div>
          </Section>

          <Section title="Site — Phase 11 Polygon Canonical">
            <div className="grid grid-cols-2 gap-3">
              <div className="field col-span-2">
                <label>Site Shape *</label>
                <select value={form.siteShape} onChange={e => update('siteShape', e.target.value as any)}>
                  <option value="rectangle">Rectangle</option>
                  <option value="l-shape">L-Shape</option>
                  <option value="polygon">Polygon (orthogonal 3..8 verts)</option>
                </select>
                <span className="text-[9px] text-ink-400">Buildable polygon authoritative, placement respects buildableBoundary</span>
              </div>
              <div className="field">
                <label>Width (m)</label>
                <input type="number" min={5} step={0.5} value={form.siteWidth} onChange={e => update('siteWidth', +e.target.value)} />
              </div>
              <div className="field">
                <label>Length (m)</label>
                <input type="number" min={5} step={0.5} value={form.siteLength} onChange={e => update('siteLength', +e.target.value)} />
              </div>
              <div className="field">
                <label>Access side</label>
                <select value={form.accessSide} onChange={e => update('accessSide', e.target.value as any)}>
                  <option value="south">South</option>
                  <option value="north">North</option>
                  <option value="east">East</option>
                  <option value="west">West</option>
                </select>
              </div>
              <div className="field">
                <label>Street width (m)</label>
                <input type="number" min={3} step={0.5} value={form.streetWidth} onChange={e => update('streetWidth', +e.target.value)} />
              </div>
            </div>

            {form.siteShape === 'l-shape' && (
              <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                <div className="text-[11px] font-semibold text-accent-300">L-Shape Notch</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="field">
                    <label>Notch W (m)</label>
                    <input type="number" min={1} step={0.5} value={form.lNotchWidth} onChange={e => update('lNotchWidth', +e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Notch L (m)</label>
                    <input type="number" min={1} step={0.5} value={form.lNotchLength} onChange={e => update('lNotchLength', +e.target.value)} />
                  </div>
                  <div className="field col-span-2">
                    <label>Notch Corner</label>
                    <select value={form.lNotchCorner} onChange={e => update('lNotchCorner', e.target.value as any)}>
                      <option value="north-east">North-East</option>
                      <option value="north-west">North-West</option>
                      <option value="south-east">South-East</option>
                      <option value="south-west">South-West</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {form.siteShape === 'polygon' && (
              <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                <div className="text-[11px] font-semibold text-accent-300">Polygon Vertices (CCW orthogonal)</div>
                <textarea className="w-full h-24 bg-ink-900 border border-ink-700 rounded p-2 text-xs mono" value={form.polygonJson} onChange={e => update('polygonJson', e.target.value)} />
              </div>
            )}

            <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
              <div className="text-[11px] font-semibold text-accent-300">Setbacks — User-Defined</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="field"><label>North (m)</label><input type="number" min={0} step={0.5} value={form.setbackNorth} onChange={e => update('setbackNorth', +e.target.value)} /></div>
                <div className="field"><label>South (m)</label><input type="number" min={0} step={0.5} value={form.setbackSouth} onChange={e => update('setbackSouth', +e.target.value)} /></div>
                <div className="field"><label>East (m)</label><input type="number" min={0} step={0.5} value={form.setbackEast} onChange={e => update('setbackEast', +e.target.value)} /></div>
                <div className="field"><label>West (m)</label><input type="number" min={0} step={0.5} value={form.setbackWest} onChange={e => update('setbackWest', +e.target.value)} /></div>
              </div>
            </div>
          </Section>

          <Section title="Building — 1..10F">
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Type</label>
                <select value={form.buildingType} onChange={e => update('buildingType', e.target.value as any)}>
                  <option value="villa">Villa</option>
                  <option value="apartment">Apartment</option>
                </select>
              </div>
              <div className="field">
                <label>Floors (1..10)</label>
                <input type="number" min={1} max={10} value={form.floors} onChange={e => { const v = Math.max(1, Math.min(10, +e.target.value || 1)); update('floors', v); if (v > 1) update('hasStair', true); }} />
              </div>
              <div className="field"><label>Bedrooms</label><input type="number" min={1} max={6} value={form.bedrooms} onChange={e => update('bedrooms', +e.target.value)} /></div>
              <div className="field"><label>Master</label><input type="number" min={0} max={2} value={form.masterBedrooms} onChange={e => update('masterBedrooms', +e.target.value)} /></div>
              <div className="field"><label>Bathrooms</label><input type="number" min={0} max={4} value={form.bathrooms} onChange={e => update('bathrooms', +e.target.value)} /></div>
              <div className="field"><label>WC</label><input type="number" min={0} max={2} value={form.wc} onChange={e => update('wc', +e.target.value)} /></div>
              <div className="field">
                <label>Kitchen</label>
                <select value={form.kitchenType} onChange={e => update('kitchenType', e.target.value as any)}>
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                  <option value="semi-open">Semi-open</option>
                </select>
              </div>
              <div className="field"><label>Parking</label><input type="number" min={0} max={6} value={form.parkingSpaces} onChange={e => update('parkingSpaces', +e.target.value)} /></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasStair || form.floors > 1} disabled={form.floors > 1} onChange={e => update('hasStair', e.target.checked)} /> Stair</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasElevator} onChange={e => update('hasElevator', e.target.checked)} /> Elevator</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasStorage} onChange={e => update('hasStorage', e.target.checked)} /> Storage</label>
            </div>
          </Section>

          <div className="sticky bottom-0 pt-2 bg-ink-900/80 backdrop-blur">
            <button className="btn-primary w-full" disabled={busy} onClick={onGenerate}>
              {busy ? 'Generating...' : `Generate ${form.floors}F ${form.siteShape} →`}
            </button>
            {error && <div className="mt-2 text-xs text-bad border border-bad/40 bg-bad/10 p-2 rounded mono whitespace-pre-wrap">{error}</div>}
          </div>
        </aside>

        <main className="col-span-6 flex flex-col border-r border-ink-700 bg-ink-900 min-w-0 overflow-x-hidden">
          <div className="h-12 border-b border-ink-700 flex items-center justify-between px-4 min-w-0 gap-2">
            <div className="text-sm text-ink-400 min-w-0 truncate flex items-center gap-2">
              <span className="text-slate-200 font-medium">Plan — {floorCount}F {form.siteShape} — Polygon Canonical</span>
              {displayCandidate && <span className="mono text-xs">strategy: {displayCandidate.metadata.strategy} | floor {selectedFloor + 1}/{floorCount}</span>}
            </div>
            <div className="flex gap-2 shrink-0 items-center">
              {displayCandidate && displayCandidate.floors.length > 1 && (
                <select className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1" value={selectedFloor} onChange={e => { setSelectedFloor(+e.target.value); setSelectedSpaceId(null); }}>
                  {displayCandidate.floors.map((f, i) => <option key={i} value={i}>Floor {i} (Level {f.level})</option>)}
                </select>
              )}
              {candidates.length > 1 && (
                <select className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1 max-w-[180px]" value={selectedIdx} onChange={e => setSelectedIdx(+e.target.value)}>
                  {candidates.map((c, i) => <option key={c.id} value={i}>{i + 1}: {c.metadata.strategy}</option>)}
                </select>
              )}
              <button className="btn-secondary" disabled={!displayCandidate} onClick={onDownloadDXF}>⬇ DXF Polygon</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-w-0 overflow-hidden">
            <div className="w-full h-full max-h-full min-w-0">
              <PlanCanvas candidate={displayCandidate} floorIndex={selectedFloor} width={800} height={560} selectedSpaceId={selectedSpaceId} onSelectSpace={setSelectedSpaceId} />
            </div>
          </div>
          {displayCandidate && (
            <div className="h-20 border-t border-ink-700 grid grid-cols-5 gap-px bg-ink-700 text-[11px] min-w-0">
              <Metric label="Usable" value={`${(displayCandidate.metrics.usableAreaRatio * 100).toFixed(0)}%`} />
              <Metric label="Circulation" value={`${(displayCandidate.metrics.circulationRatio * 100).toFixed(0)}%`} />
              <Metric label="Room dev" value={`${(displayCandidate.metrics.roomAreaDeviation * 100).toFixed(0)}%`} />
              <Metric label="Daylight" value={`${(displayCandidate.metrics.daylightExposure * 100).toFixed(0)}%`} />
              <Metric label="Valid" value={displayCandidate.valid ? 'YES' : 'NO'} />
            </div>
          )}
        </main>

        <aside className="col-span-3 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-ink-900 min-w-0">
          <Section title="Editing — Phase 11">
            {!displayCandidate && <div className="text-xs text-ink-400">Generate a plan first.</div>}
            {displayCandidate && currentFloor && (
              <div className="space-y-3 text-xs">
                <div className="field">
                  <label>Select Room (Floor {selectedFloor})</label>
                  <select value={selectedSpaceId ?? ''} onChange={e => setSelectedSpaceId(e.target.value || null)} className="w-full bg-ink-800 border border-ink-700 rounded px-2 py-1">
                    <option value="">— Select —</option>
                    {currentFloor.spaces.map(s => (
                      <option key={s.id} value={s.id}>{s.label} [{s.type}] {s.area.toFixed(1)}m² {s.locked?.position || s.locked?.geometry ? '🔒' : ''}</option>
                    ))}
                  </select>
                </div>

                {selectedSpace && (
                  <>
                    <div className="p-2 bg-ink-800 rounded border border-ink-700 space-y-1">
                      <div className="font-semibold text-slate-200">{selectedSpace.label} — {selectedSpace.type}</div>
                      <div className="mono text-[10px]">id: {selectedSpace.id}</div>
                      <div>Area: {selectedSpace.area.toFixed(2)} m² (polygon canonical) · Rect {selectedSpace.rect.w.toFixed(2)}×{selectedSpace.rect.h.toFixed(2)}</div>
                      <div>Shape: {selectedSpace.shapeType ?? 'rectangle'} · Verts: {selectedSpace.polygon.length}</div>
                      <div>Privacy: {selectedSpace.privacy} · Zone: {selectedSpace.zone}</div>
                      {selectedSpace.constraints && (
                        <div className="mt-1 p-1 bg-ink-900 rounded border border-ink-700">
                          <div className="font-semibold">Constraints</div>
                          <div>minArea {selectedSpace.constraints.minArea ?? '-'} · target {selectedSpace.constraints.targetArea ?? '-'} · max {selectedSpace.constraints.maxArea ?? '-'}</div>
                          <div>minW {selectedSpace.constraints.minWidth ?? '-'} · minL {selectedSpace.constraints.minLength ?? '-'} · aspect {selectedSpace.constraints.preferredAspectRatio ?? '-'}</div>
                        </div>
                      )}
                      {selectedSpace.locked && (
                        <div className="mt-1 p-1 bg-ink-900 rounded border border-warn/30">
                          <div className="font-semibold text-warn">Locked</div>
                          <div>pos:{String(!!selectedSpace.locked.position)} size:{String(!!selectedSpace.locked.size)} geom:{String(!!selectedSpace.locked.geometry)} adj:{String(!!selectedSpace.locked.adjacency)}</div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="field"><label>Move X</label><input type="number" step={0.1} value={moveX} onChange={e => setMoveX(+e.target.value)} /></div>
                      <div className="field"><label>Move Y</label><input type="number" step={0.1} value={moveY} onChange={e => setMoveY(+e.target.value)} /></div>
                    </div>
                    <button className="btn-secondary w-full" onClick={doMove}>Move Room (Core API)</button>

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="field"><label>Width</label><input type="number" step={0.1} min={1} value={resizeW} onChange={e => setResizeW(+e.target.value)} /></div>
                      <div className="field"><label>Height</label><input type="number" step={0.1} min={1} value={resizeH} onChange={e => setResizeH(+e.target.value)} /></div>
                    </div>
                    <button className="btn-secondary w-full" onClick={doResize}>Resize Safe (Core API)</button>

                    <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                      <div className="font-semibold">Set L-Shape</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="field"><label>Notch W</label><input type="number" step={0.1} min={0.5} value={notchW} onChange={e => setNotchW(+e.target.value)} /></div>
                        <div className="field"><label>Notch L</label><input type="number" step={0.1} min={0.5} value={notchL} onChange={e => setNotchL(+e.target.value)} /></div>
                        <div className="field"><label>Corner</label><select value={notchCorner} onChange={e => setNotchCorner(e.target.value as any)} className="w-full bg-ink-900 border border-ink-700 rounded px-1 py-1"><option value="ne">NE</option><option value="nw">NW</option><option value="se">SE</option><option value="sw">SW</option></select></div>
                      </div>
                      <button className="btn-secondary w-full" onClick={doSetLShape}>Set L-Shape (Core)</button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button className="btn-secondary" onClick={() => doLock('position')}>🔒 Pos</button>
                      <button className="btn-secondary" onClick={() => doLock('size')}>🔒 Size</button>
                      <button className="btn-secondary" onClick={() => doLock('all')}>🔒 All</button>
                      <button className="btn-secondary" onClick={() => doUnlock('all')}>🔓 Unlock All</button>
                    </div>

                    {editError && <div className="mt-2 p-2 rounded border border-bad/40 bg-bad/10 text-bad text-xs mono whitespace-pre-wrap">{editError}</div>}
                    {editFindings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="font-semibold">Validation after edit ({editFindings.length})</div>
                        {editFindings.slice(0, 15).map((f: any, i: number) => (
                          <div key={i} className="flex gap-1 p-1 rounded bg-ink-800 border border-ink-700 text-[10px]">
                            <span className={f.severity === 'hard' ? 'badge-hard' : f.severity === 'soft' ? 'badge-soft' : 'badge-adv'}>{f.severity}</span>
                            <span className="truncate">{f.code}: {f.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Section>

          <Section title={`Validation — ${floorCount}F`}>
            {!vr && <div className="text-xs text-ink-400">Generate to validate.</div>}
            {vr && (
              <div className="space-y-2 text-xs">
                <div className={`p-2 rounded border ${vr.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-bad/40 bg-bad/10 text-bad'}`}>
                  <div className="font-bold text-sm">{vr.ok ? 'VALID' : 'INVALID — HARD'}</div>
                  <div className="mono opacity-80">{vr.hard.length} hard · {vr.soft.length} soft · {vr.advisory.length} advisory</div>
                  <div className="mt-1 flex gap-1">
                    <span className="border border-bad/40 text-bad px-1 rounded text-[9px]">HARD {vr.hard.length}</span>
                    <span className="border border-warn/40 text-warn px-1 rounded text-[9px]">SOFT {vr.soft.length}</span>
                    <span className="border border-ink-600 text-ink-400 px-1 rounded text-[9px]">ADV {vr.advisory.length}</span>
                  </div>
                </div>
                {[...vr.hard, ...vr.soft, ...vr.advisory].slice(0, 25).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded border border-ink-700 bg-ink-800 min-w-0 overflow-hidden">
                    <span className={f.severity === 'hard' ? 'badge-hard' : f.severity === 'soft' ? 'badge-soft' : 'badge-adv'}>{f.severity}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 break-words">{f.message}</div>
                      <div className="text-[10px] text-ink-400 mono truncate">{f.code}{f.ruleId ? ` · ${f.ruleId}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {displayCandidate && (
            <Section title={`Spaces — Floor ${selectedFloor}`}>
              <div className="text-xs space-y-1 mono max-h-64 overflow-y-auto">
                {(displayCandidate.floors[selectedFloor]?.spaces ?? displayCandidate.floors[0].spaces).map(s => (
                  <div key={s.id} className={`flex justify-between px-2 py-1 rounded hover:bg-ink-800 cursor-pointer ${selectedSpaceId === s.id ? 'bg-accent-500/20 border border-accent-500/40' : ''}`} onClick={() => setSelectedSpaceId(s.id)}>
                    <span className="truncate mr-2">{s.label} [{s.type}] {s.locked?.position ? '🔒' : ''}</span>
                    <span className="text-ink-400 shrink-0">{s.area.toFixed(1)} m² · {s.polygon.length}v</span>
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
      <div className="text-[10px] uppercase tracking-wider text-ink-400 truncate">{label}</div>
      <div className="text-lg font-semibold text-slate-100 mono truncate">{value}</div>
    </div>
  );
}
