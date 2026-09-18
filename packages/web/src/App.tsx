import React, { useMemo, useState } from 'react';
import { createProject, generate, exportDXF, validateCandidate, buildDocumentation } from '@archgenius/core';
import type { ProjectInput, Project } from '@archgenius/core';
import type { LayoutCandidate } from '@archgenius/core';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidate = candidates[selectedIdx] ?? null;

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(s => ({ ...s, [k]: v }));

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
      const { candidates: cands } = generate(prj);
      setProject(prj);
      setCandidates(cands);
      setSelectedIdx(0);
      setSelectedFloor(0);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const vr = useMemo(() => candidate ? validateCandidate(candidate) : null, [candidate]);
  const doc = useMemo(() => {
    if (!project || !candidate) return null;
    try {
      return buildDocumentation(project, candidate);
    } catch {
      return null;
    }
  }, [project, candidate]);

  const onDownloadDXF = () => {
    if (!candidate || !project) return;
    const { dxf } = exportDXF(candidate, project.input.name);
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.input.name.replace(/\s+/g, '_')}.dxf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const floorCount = candidate?.floors.length ?? form.floors;

  return (
    <div className="h-full flex flex-col overflow-x-hidden">
      <header className="h-14 border-b border-ink-700 flex items-center justify-between px-6 bg-ink-800 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded bg-accent-500 flex items-center justify-center font-bold shrink-0">A</div>
          <div className="min-w-0">
            <div className="font-semibold tracking-wide truncate">ArchGenius</div>
            <div className="text-[10px] text-ink-400 uppercase tracking-widest truncate">AI Architectural Planning · Phase 10 Site/Context Intelligence — A-SITE/A-BLDG-OUT/A-SETBACK</div>
          </div>
        </div>
        <div className="text-xs text-ink-400 mono shrink-0">v0.10.0-phase10 · offline-first · DXF R12 site-aware · Deterministic</div>
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
              <span className="text-[10px] text-ink-400">Same input+seed → same output</span>
            </div>
          </Section>

          <Section title="Site — Phase 10 Shape Selector">
            <div className="grid grid-cols-2 gap-3">
              <div className="field col-span-2">
                <label>Site Shape *</label>
                <select value={form.siteShape} onChange={e => update('siteShape', e.target.value as any)}>
                  <option value="rectangle">Rectangle</option>
                  <option value="l-shape">L-Shape</option>
                  <option value="polygon">Polygon (orthogonal V1)</option>
                </select>
                <span className="text-[9px] text-ink-400">Rectangle regression identical, L-shape genuine, Polygon affects placement</span>
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
                <div className="text-[11px] font-semibold text-accent-300">L-Shape Notch Inputs</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="field">
                    <label>Notch Width (m)</label>
                    <input type="number" min={1} step={0.5} value={form.lNotchWidth} onChange={e => update('lNotchWidth', +e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Notch Length (m)</label>
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
                <div className="text-[9px] text-ink-400">Overall W/L minus rectangular notch from corner — deterministic decomposition into 2 rects</div>
              </div>
            )}

            {form.siteShape === 'polygon' && (
              <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
                <div className="text-[11px] font-semibold text-accent-300">Polygon Vertex Editor (orthogonal V1, 3..8 verts)</div>
                <textarea className="w-full h-24 bg-ink-900 border border-ink-700 rounded p-2 text-xs mono" value={form.polygonJson} onChange={e => update('polygonJson', e.target.value)} />
                <div className="text-[9px] text-ink-400">JSON array of {"{x,y}"} CCW, finite, no duplicate consecutive, no zero-length, no self-intersection, max 8 verts, EPS 1e-6m</div>
              </div>
            )}

            <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-2">
              <div className="text-[11px] font-semibold text-accent-300">Setbacks — User-Defined Design Inputs</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="field">
                  <label>North (m)</label>
                  <input type="number" min={0} step={0.5} value={form.setbackNorth} onChange={e => update('setbackNorth', +e.target.value)} />
                </div>
                <div className="field">
                  <label>South (m)</label>
                  <input type="number" min={0} step={0.5} value={form.setbackSouth} onChange={e => update('setbackSouth', +e.target.value)} />
                </div>
                <div className="field">
                  <label>East (m)</label>
                  <input type="number" min={0} step={0.5} value={form.setbackEast} onChange={e => update('setbackEast', +e.target.value)} />
                </div>
                <div className="field">
                  <label>West (m)</label>
                  <input type="number" min={0} step={0.5} value={form.setbackWest} onChange={e => update('setbackWest', +e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <span className="border border-warn/40 text-warn text-[9px] px-1 rounded">REQUIRES_SOURCE_VERIFICATION</span>
                <span className="text-[9px] text-ink-400">Unless Tier-1 verified — NOT legal</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="field">
                <label>Jurisdiction</label>
                <input value={form.jurisdiction} onChange={e => update('jurisdiction', e.target.value)} placeholder="Tehran-Municipality" />
              </div>
              <div className="field">
                <label>City</label>
                <input value={form.city} onChange={e => update('city', e.target.value)} />
              </div>
              <div className="field col-span-2">
                <label>Parking Layout</label>
                <select value={form.parkingLayout} onChange={e => update('parkingLayout', e.target.value as any)}>
                  <option value="auto">Auto (perpendicular → parallel)</option>
                  <option value="perpendicular">Perpendicular</option>
                  <option value="parallel">Parallel</option>
                </select>
              </div>
            </div>

            {doc?.site && (
              <div className="mt-3 p-2 bg-ink-800 rounded border border-ink-700 space-y-1 text-[10px]">
                <div className="font-semibold">Site Validation Feedback</div>
                <div>Shape: {(doc.site as any).shape} · Area: {doc.site.area}m² · Buildable: {(doc.site as any).buildableArea}m²</div>
                <div>Rects: {(doc.site as any).buildableRects?.length} · Vertices: {(doc.site as any).siteBoundary?.length}</div>
                <div>Valid: {(doc.site as any).siteValidation?.isValid ? 'yes' : 'no'} {(doc.site as any).siteValidation?.errors?.join('; ')}</div>
                <div className="flex flex-wrap gap-1">
                  {(doc.site as any).setbackSources?.map((s: any, i: number) => (
                    <span key={i} className="border border-ink-600 px-1 rounded text-[9px]">{s.direction} {s.value}m {s.source} {s.status}</span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title="Building — Phase 10 (Floors 1..10)">
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Type</label>
                <select value={form.buildingType} onChange={e => update('buildingType', e.target.value as any)}>
                  <option value="villa">Villa</option>
                  <option value="apartment">Apartment</option>
                </select>
              </div>
              <div className="field">
                <label>Floors (1..10) *</label>
                <input type="number" min={1} max={10} value={form.floors} onChange={e => {
                  const v = Math.max(1, Math.min(10, +e.target.value || 1));
                  update('floors', v);
                  if (v > 1) update('hasStair', true);
                }} />
                <span className="text-[9px] text-ink-400">First-class, bounded, no explosion</span>
              </div>
              <div className="field">
                <label>Bedrooms</label>
                <input type="number" min={1} max={6} value={form.bedrooms} onChange={e => update('bedrooms', +e.target.value)} />
              </div>
              <div className="field">
                <label>Master bedrooms</label>
                <input type="number" min={0} max={2} value={form.masterBedrooms} onChange={e => update('masterBedrooms', +e.target.value)} />
              </div>
              <div className="field">
                <label>Bathrooms</label>
                <input type="number" min={0} max={4} value={form.bathrooms} onChange={e => update('bathrooms', +e.target.value)} />
              </div>
              <div className="field">
                <label>Guest WC</label>
                <input type="number" min={0} max={2} value={form.wc} onChange={e => update('wc', +e.target.value)} />
              </div>
              <div className="field">
                <label>Kitchen</label>
                <select value={form.kitchenType} onChange={e => update('kitchenType', e.target.value as any)}>
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                  <option value="semi-open">Semi-open</option>
                </select>
              </div>
              <div className="field">
                <label>Parking spaces</label>
                <input type="number" min={0} max={6} value={form.parkingSpaces} onChange={e => update('parkingSpaces', +e.target.value)} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasStair || form.floors > 1} disabled={form.floors > 1} onChange={e => update('hasStair', e.target.checked)} /> Stair</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasElevator} onChange={e => update('hasElevator', e.target.checked)} /> Elevator</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasStorage} onChange={e => update('hasStorage', e.target.checked)} /> Storage</label>
            </div>
            {form.floors > 1 && <div className="mt-2 text-[10px] text-warn border border-warn/30 rounded px-2 py-1">Multi-floor: {form.floors} floors, whole-building intelligence + site-aware placement</div>}
          </Section>

          <div className="sticky bottom-0 pt-2 bg-ink-900/80 backdrop-blur">
            <button className="btn-primary w-full" disabled={busy} onClick={onGenerate}>
              {busy ? 'Generating...' : `Generate ${form.floors}F ${form.siteShape} Layout →`}
            </button>
            {error && <div className="mt-2 text-xs text-bad border border-bad/40 bg-bad/10 p-2 rounded mono whitespace-pre-wrap">{error}</div>}
          </div>

          <div className="pt-4 border-t border-ink-700">
            <div className="text-[11px] text-ink-400 leading-relaxed">
              <div className="font-semibold text-ink-400 uppercase tracking-wider mb-1">Disclaimer — Phase 10</div>
              Site setbacks are <span className="text-warn">USER-DEFINED DESIGN INPUTS</span> — NOT legal unless VERIFIED Tier-1 with source ID/SHA256/page/clause/snippet. Parking fit is deterministic geometric — perpendicular/parallel alternatives, no overlap site/buildable/building/other stalls. All rooms/walls/openings/furniture/circulation/stair/parking inside buildable. L-shape deterministic decomposition. Polygon orthogonal V1 only, 3..8 verts. Buildable geometry canonical.
            </div>
          </div>
        </aside>

        <main className="col-span-6 flex flex-col border-r border-ink-700 bg-ink-900 min-w-0 overflow-x-hidden">
          <div className="h-12 border-b border-ink-700 flex items-center justify-between px-4 min-w-0 gap-2">
            <div className="text-sm text-ink-400 min-w-0 truncate flex items-center gap-2">
              <span className="text-slate-200 font-medium">Plan Preview — {floorCount}F {form.siteShape} — A-SITE/A-BLDG-OUT/A-SETBACK</span>
              {candidate && <span className="mono text-xs">strategy: {candidate.metadata.strategy} | cand {selectedIdx + 1}/{candidates.length} | floor {selectedFloor + 1}/{floorCount}</span>}
            </div>
            <div className="flex gap-2 shrink-0 items-center">
              {candidate && candidate.floors.length > 1 && (
                <select className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1" value={selectedFloor} onChange={e => setSelectedFloor(+e.target.value)}>
                  {candidate.floors.map((f, i) => <option key={i} value={i}>Floor {i} (Level {f.level})</option>)}
                </select>
              )}
              {candidates.length > 1 && (
                <select className="text-xs bg-ink-800 border border-ink-700 rounded px-2 py-1 max-w-[180px]" value={selectedIdx} onChange={e => setSelectedIdx(+e.target.value)}>
                  {candidates.map((c, i) => <option key={c.id} value={i}>{i + 1}: {c.metadata.strategy}</option>)}
                </select>
              )}
              <button className="btn-secondary" disabled={!candidate} onClick={onDownloadDXF}>⬇ DXF ({floorCount}F site)</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-w-0 overflow-hidden">
            <div className="w-full h-full max-h-full min-w-0">
              <PlanCanvas candidate={candidate} floorIndex={selectedFloor} width={800} height={560} />
            </div>
          </div>
          {candidate && (
            <div className="h-20 border-t border-ink-700 grid grid-cols-5 gap-px bg-ink-700 text-[11px] min-w-0">
              <Metric label="Usable area" value={`${(candidate.metrics.usableAreaRatio * 100).toFixed(0)}%`} />
              <Metric label="Circulation" value={`${(candidate.metrics.circulationRatio * 100).toFixed(0)}%`} />
              <Metric label="Room area dev" value={`${(candidate.metrics.roomAreaDeviation * 100).toFixed(0)}%`} />
              <Metric label="Daylight" value={`${(candidate.metrics.daylightExposure * 100).toFixed(0)}%`} />
              <Metric label="Parking" value={`${(candidate.metrics.parkingFeasibility * 100).toFixed(0)}%`} />
            </div>
          )}
          {doc?.site && (
            <div className="h-6 border-t border-ink-700 flex items-center px-3 text-[10px] text-ink-400 bg-ink-800 gap-2">
              <span className="border border-ok/40 text-ok px-1 rounded">SITE</span>
              <span className="truncate">Shape {(doc.site as any).shape} · Area {doc.site.area}m² · Buildable {(doc.site as any).buildableArea}m² · Rects {(doc.site as any).buildableRects?.length} · Setbacks N{(doc.site as any).setbacks?.north} S{(doc.site as any).setbacks?.south} E{(doc.site as any).setbacks?.east} W{(doc.site as any).setbacks?.west} · Jurisdiction {(doc.site as any).jurisdiction} · Parking {(doc.site as any).parkingLayout}</span>
            </div>
          )}
          {doc?.intelligence && (
            <>
              <div className="h-6 border-t border-ink-700 flex items-center px-3 text-[10px] text-ink-400 bg-ink-800 gap-2">
                <span className="border border-warn/40 text-warn px-1 rounded">HEURISTIC</span>
                <span className="truncate">{doc.intelligence.intelligenceScope} — Floors {doc.intelligence.floorCount} — Whole { (doc.intelligence.overallQuality*100).toFixed(0)}% — Vertical { (doc.intelligence.vertical.score*100).toFixed(0)}% {doc.intelligence.vertical.isConnected?'Connected':'DISCONNECTED'} — Stacking { (doc.intelligence.stacking.score*100).toFixed(0)}% — InterFloor { (doc.intelligence.interFloor.score*100).toFixed(0)}% — AvgFloor { (doc.intelligence.wholeBuilding.avgFloorQuality.overall*100).toFixed(0)}%</span>
              </div>
              <div className="h-24 border-t border-ink-700 grid grid-cols-9 gap-px bg-ink-700 text-[10px] min-w-0 overflow-x-auto">
                <Metric label="Feasible" value={doc.intelligence.feasible ? 'YES' : `NO (${doc.intelligence.hardViolations})`} />
                <Metric label="Whole" value={`${(doc.intelligence.overallQuality * 100).toFixed(0)}%`} />
                <Metric label="Avg Floor" value={`${(doc.intelligence.wholeBuilding.avgFloorQuality.overall * 100).toFixed(0)}%`} />
                <Metric label="Vertical" value={`${(doc.intelligence.vertical.score * 100).toFixed(0)}% ${doc.intelligence.vertical.isConnected?'✓':'✗'}`} />
                <Metric label="Stacking" value={`${(doc.intelligence.stacking.score * 100).toFixed(0)}%`} />
                <Metric label="InterFloor" value={`${(doc.intelligence.interFloor.score * 100).toFixed(0)}%`} />
                <Metric label="Kitchen" value={doc.intelligence.quality.kitchen === null ? 'N/A' : `${(doc.intelligence.quality.kitchen * 100).toFixed(0)}%`} />
                <Metric label="Floors" value={`${doc.intelligence.floorCount}`} />
                <Metric label="Stairs" value={`${doc.intelligence.vertical.stairCount}`} />
              </div>
            </>
          )}
        </main>

        <aside className="col-span-3 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-ink-900 min-w-0">
          <Section title={`Validation — ${floorCount}F Site-Aware`}>
            {!vr && <div className="text-xs text-ink-400">Generate a plan to run validation.</div>}
            {vr && (
              <div className="space-y-2 text-xs">
                <div className={`p-2 rounded border ${vr.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-bad/40 bg-bad/10 text-bad'}`}>
                  <div className="font-bold text-sm">{vr.ok ? 'VALID — Site-Aware' : 'INVALID — HARD'}</div>
                  <div className="mono opacity-80">{vr.hard.length} hard · {vr.soft.length} soft · {vr.advisory.length} advisory — Site {form.siteShape}</div>
                </div>
                {[...vr.hard, ...vr.soft, ...vr.advisory].slice(0, 30).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded border border-ink-700 bg-ink-800 min-w-0 overflow-hidden">
                    <span className={f.severity === 'hard' ? 'badge-hard' : f.severity === 'soft' ? 'badge-soft' : 'badge-adv'}>{f.severity}</span>
                    {f.code.startsWith('SITE_') && <span className="border border-ok/40 text-ok text-[9px] px-1 rounded shrink-0">SITE</span>}
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-200 break-words">{f.message}</div>
                      {f.ruleId && <div className="text-[10px] text-ink-400 mono truncate">{f.code} · {f.ruleId}</div>}
                      {!f.ruleId && <div className="text-[10px] text-ink-400 mono truncate">{f.code}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {doc?.site && (
            <Section title={`Site/Context — ${doc.site.shape} — Buildable ${(doc.site as any).buildableArea}m²`}>
              <div className="space-y-2 text-xs">
                <div className="p-2 bg-ink-800 rounded border border-ink-700">
                  <div className="font-semibold">Buildable Geometry Canonical</div>
                  <div className="text-[10px] text-ink-400">Original site boundary, applied setbacks, buildable boundary/area/rect — source/status per setback</div>
                  <div className="mt-1 mono text-[10px]">Site {doc.site.area}m² → Buildable {(doc.site as any).buildableArea}m² after setbacks N{(doc.site as any).setbacks?.north} S{(doc.site as any).setbacks?.south} E{(doc.site as any).setbacks?.east} W{(doc.site as any).setbacks?.west}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(doc.site as any).setbackSources?.map((s: any, i: number) => (
                      <span key={i} className={`border px-1 rounded text-[9px] ${s.status === 'VERIFIED' ? 'border-ok/40 text-ok' : 'border-warn/40 text-warn'}`}>{s.direction} {s.value}m {s.source} {s.status}</span>
                    ))}
                  </div>
                </div>
                <div className="p-2 bg-ink-800 rounded border border-ink-700">
                  <div className="font-semibold">DXF Layers</div>
                  <div className="text-[10px] text-ink-400">A-SITE site boundary polygon, A-BLDG-OUT buildable boundary, A-SETBACK setback lines — ground floor yOff 0, per-floor A-FLOOR-n-A-SITE etc — INSUNITS=4 mm</div>
                  <div className="mt-1 text-[10px]">Drawing: {doc.drawing.drawingNumber} — Site shape affects placement, rooms contained in buildable, parking geometric fit</div>
                </div>
              </div>
            </Section>
          )}

          {candidate && (
            <Section title={`Spaces — Floor ${selectedFloor} / ${candidate.floors.length}`}>
              <div className="text-xs space-y-1 mono max-h-64 overflow-y-auto">
                {(candidate.floors[selectedFloor]?.spaces ?? candidate.floors[0].spaces).map(s => (
                  <div key={s.id} className="flex justify-between px-2 py-1 rounded hover:bg-ink-800">
                    <span className="truncate mr-2">{s.label} [{s.type}]</span>
                    <span className="text-ink-400 shrink-0">{s.area.toFixed(1)} m²</span>
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
