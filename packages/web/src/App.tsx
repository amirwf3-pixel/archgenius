import React, { useMemo, useState } from 'react';
import { createProject, generate, exportDXF, validateCandidate } from '@archgenius/core';
import type { ProjectInput, Project } from '@archgenius/core';
import type { LayoutCandidate } from '@archgenius/core';
import { PlanCanvas } from './PlanCanvas';

interface FormState {
  name: string;
  siteWidth: number;
  siteLength: number;
  accessSide: 'south' | 'north' | 'east' | 'west';
  streetWidth: number;
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
}

const DEFAULT_STATE: FormState = {
  name: 'Sample Villa',
  siteWidth: 15,
  siteLength: 20,
  accessSide: 'south',
  streetWidth: 8,
  buildingType: 'villa',
  floors: 1,
  bedrooms: 2,
  masterBedrooms: 1,
  bathrooms: 2,
  wc: 1,
  kitchenType: 'closed',
  parkingSpaces: 2,
  hasStair: false,
  hasElevator: false,
  hasStorage: true,
};

export function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_STATE);
  const [project, setProject] = useState<Project | null>(null);
  const [candidate, setCandidate] = useState<LayoutCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(s => ({ ...s, [k]: v }));

  const onGenerate = () => {
    setBusy(true); setError(null);
    try {
      const input: ProjectInput = {
        name: form.name,
        site: {
          shape: 'rectangle',
          width: Number(form.siteWidth),
          length: Number(form.siteLength),
          accessSide: form.accessSide,
          streetWidth: Number(form.streetWidth),
          northRotationDeg: 0,
        },
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
        seed: 42,
      };
      const prj = createProject(input);
      const { candidates } = generate(prj);
      setProject(prj);
      setCandidate(candidates[0]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const vr = useMemo(() => candidate ? validateCandidate(candidate) : null, [candidate]);

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

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="h-14 border-b border-ink-700 flex items-center justify-between px-6 bg-ink-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-accent-500 flex items-center justify-center font-bold">A</div>
          <div>
            <div className="font-semibold tracking-wide">ArchGenius</div>
            <div className="text-[10px] text-ink-400 uppercase tracking-widest">AI Architectural Planning &middot; Professional AutoCAD System</div>
          </div>
        </div>
        <div className="text-xs text-ink-400 mono">v0.1.0 &middot; offline-first &middot; DXF R12</div>
      </header>

      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        {/* Left: parameters */}
        <aside className="col-span-3 border-r border-ink-700 overflow-y-auto p-4 space-y-4">
          <Section title="Project">
            <div className="field">
              <label>Project name</label>
              <input value={form.name} onChange={e => update('name', e.target.value)} />
            </div>
          </Section>

          <Section title="Site">
            <div className="grid grid-cols-2 gap-3">
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
          </Section>

          <Section title="Building">
            <div className="grid grid-cols-2 gap-3">
              <div className="field">
                <label>Type</label>
                <select value={form.buildingType} onChange={e => update('buildingType', e.target.value as any)}>
                  <option value="villa">Villa</option>
                  <option value="apartment">Apartment</option>
                </select>
              </div>
              <div className="field">
                <label>Floors</label>
                <input type="number" min={1} max={6} value={form.floors} onChange={e => {
                  const v = +e.target.value;
                  update('floors', v);
                  if (v > 1) update('hasStair', true);
                }} />
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
          </Section>

          <div className="sticky bottom-0 pt-2 bg-ink-900/80 backdrop-blur">
            <button className="btn-primary w-full" disabled={busy} onClick={onGenerate}>
              {busy ? 'Generating...' : 'Generate Layout →'}
            </button>
            {error && <div className="mt-2 text-xs text-bad border border-bad/40 bg-bad/10 p-2 rounded mono whitespace-pre-wrap">{error}</div>}
          </div>

          <div className="pt-4 border-t border-ink-700">
            <div className="text-[11px] text-ink-400 leading-relaxed">
              <div className="font-semibold text-ink-400 uppercase tracking-wider mb-1">Disclaimer</div>
              Default setbacks/parking values are <span className="text-warn">assumptions</span> and require municipality verification. Automated checks do not replace review by a licensed architect/engineer.
            </div>
          </div>
        </aside>

        {/* Center: plan preview */}
        <main className="col-span-6 flex flex-col border-r border-ink-700 bg-ink-900">
          <div className="h-12 border-b border-ink-700 flex items-center justify-between px-4">
            <div className="text-sm text-ink-400">
              <span className="text-slate-200 font-medium">Plan Preview</span>
              {candidate && <span className="ml-3 mono text-xs">strategy: {candidate.metadata.strategy}</span>}
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={!candidate} onClick={onDownloadDXF}>
                ⬇ Download DXF
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full h-full max-h-full">
              <PlanCanvas candidate={candidate} width={800} height={560} />
            </div>
          </div>
          {/* Metrics strip */}
          {candidate && (
            <div className="h-20 border-t border-ink-700 grid grid-cols-5 gap-px bg-ink-700 text-[11px]">
              <Metric label="Usable area" value={`${(candidate.metrics.usableAreaRatio * 100).toFixed(0)}%`} />
              <Metric label="Circulation" value={`${(candidate.metrics.circulationRatio * 100).toFixed(0)}%`} />
              <Metric label="Room area dev" value={`${(candidate.metrics.roomAreaDeviation * 100).toFixed(0)}%`} />
              <Metric label="Daylight" value={`${(candidate.metrics.daylightExposure * 100).toFixed(0)}%`} />
              <Metric label="Parking" value={`${(candidate.metrics.parkingFeasibility * 100).toFixed(0)}%`} />
            </div>
          )}
        </main>

        {/* Right: spaces / validation */}
        <aside className="col-span-3 overflow-y-auto p-4 space-y-4 bg-ink-900">
          <Section title="Validation">
            {!vr && <div className="text-xs text-ink-400">Generate a plan to run validation.</div>}
            {vr && (
              <div className="space-y-2 text-xs">
                <div className={`p-2 rounded border ${vr.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-bad/40 bg-bad/10 text-bad'}`}>
                  <div className="font-bold text-sm">{vr.ok ? 'VALID' : 'INVALID — HARD CONSTRAINT VIOLATION'}</div>
                  <div className="mono opacity-80">{vr.hard.length} hard · {vr.soft.length} soft · {vr.advisory.length} advisory</div>
                </div>
                {[...vr.hard, ...vr.soft, ...vr.advisory].slice(0, 40).map((f, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded border border-ink-700 bg-ink-800">
                    <span className={
                      f.severity === 'hard' ? 'badge-hard'
                        : f.severity === 'soft' ? 'badge-soft'
                          : 'badge-adv'
                    }>{f.severity}</span>
                    <div className="flex-1">
                      <div className="text-slate-200">{f.message}</div>
                      {f.ruleId && <div className="text-[10px] text-ink-400 mono">{f.code} · {f.ruleId}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {candidate && (
            <Section title="Spaces">
              <div className="text-xs space-y-1 mono">
                {candidate.floors[0].spaces.map(s => (
                  <div key={s.id} className="flex justify-between px-2 py-1 rounded hover:bg-ink-800">
                    <span>{s.label}</span>
                    <span className="text-ink-400">{s.area.toFixed(1)} m²</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {candidate && candidate.explanations.length > 0 && (
            <Section title="Design Explanation">
              <ul className="text-xs list-disc pl-4 space-y-1 text-slate-300">
                {candidate.explanations.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
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
      <div className="panel-header">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-900 p-3 flex flex-col justify-center">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="text-lg font-semibold text-slate-100 mono">{value}</div>
    </div>
  );
}
