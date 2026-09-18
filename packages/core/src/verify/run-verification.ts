/**
 * Rigorous verification harness for Phase 1 vertical slice.
 *
 * Generates several realistic residential scenarios, checks geometric
 * correctness, writes DXF files, runs a structural DXF parser over them
 * to verify required layers/entities/sections, and reports problems.
 */
import { createProject, generate, exportDXF, validateCandidate } from '../pipeline.js';
import type { ProjectInput } from '../model/project.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseDxf } from '../dxf/verify.js';

const OUT = '/home/user/archgenius/verify-output';
mkdirSync(OUT, { recursive: true });

interface Scenario {
  name: string;
  input: ProjectInput;
}

const scenarios: Scenario[] = [
  {
    name: '01-2bed-villa',
    input: {
      name: '2-Bedroom Villa',
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 6 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      deterministic: true, seed: 1,
    },
  },
  {
    name: '02-3bed-villa',
    input: {
      name: '3-Bedroom Villa',
      site: { shape: 'rectangle', width: 15, length: 22, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStorage: true },
      deterministic: true, seed: 42,
    },
  },
  {
    name: '03-3bed-2story',
    input: {
      name: '3-Bedroom 2-Story Villa',
      site: { shape: 'rectangle', width: 14, length: 20, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: true },
      deterministic: true, seed: 7,
    },
  },
  {
    name: '04-apartment-floor',
    input: {
      name: 'Apartment Floor (2 units per floor simulated as larger villa footprint)',
      site: { shape: 'rectangle', width: 20, length: 25, accessSide: 'south', streetWidth: 10 },
      building: { type: 'apartment', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'open', parkingSpaces: 2, hasStair: true, hasElevator: true, hasStorage: true },
      deterministic: true, seed: 100,
    },
  },
  {
    name: '05-narrow-site',
    input: {
      name: 'Narrow Frontage (8m × 25m)',
      site: { shape: 'rectangle', width: 8, length: 25, accessSide: 'south', streetWidth: 6 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      deterministic: true, seed: 2024,
    },
  },
  {
    name: '06-small-1bed',
    input: {
      name: 'Small 1-Bedroom Starter Villa',
      site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 6 },
      building: { type: 'villa', floors: 1, bedrooms: 1, masterBedrooms: 1, bathrooms: 1, wc: 0, kitchenType: 'open', parkingSpaces: 1 },
      deterministic: true, seed: 55,
    },
  },
];

interface ScenarioReport {
  name: string;
  error?: string;
  valid?: boolean;
  hard?: number;
  soft?: number;
  advisory?: number;
  dxfSize?: number;
  dxfSections?: string[];
  dxfLayers?: Record<string, number>;
  dxfIssues?: string[];
  issues: string[];
  spaceCount?: number;
  wallCount?: number;
  doorCount?: number;
  windowCount?: number;
  entranceCount?: number;
  parkingCount?: number;
  stairCount?: number;
}

const reports: ScenarioReport[] = [];

for (const sc of scenarios) {
  const rep: ScenarioReport = { name: sc.name, issues: [] };
  try {
    const prj = createProject(sc.input);
    const { candidates } = generate(prj);
    const cand = candidates[0];
    const vr = validateCandidate(cand);
    rep.valid = vr.ok;
    rep.hard = vr.hard.length;
    rep.soft = vr.soft.length;
    rep.advisory = vr.advisory.length;

    const f0 = cand.floors[0];
    rep.spaceCount = f0.spaces.length;
    rep.wallCount = f0.walls.length;
    rep.doorCount = f0.openings.filter(o => o.type === 'door').length;
    rep.windowCount = f0.openings.filter(o => o.type === 'window').length;
    rep.entranceCount = f0.openings.filter(o => o.type === 'entrance').length;
    rep.parkingCount = f0.parkingStalls.length;
    rep.stairCount = f0.stairs.length;

    // Check expected rooms
    const types = new Set(f0.spaces.map(s => s.type));
    const mustHave = ['corridor', 'kitchen', 'living'];
    // Ground-floor/public floor
    const groundNeedsBedrooms = sc.input.building.floors === 1 || sc.input.building.type !== 'villa';
    if (groundNeedsBedrooms && sc.input.building.bedrooms >= 1 && !types.has('bedroom') && !types.has('master-bedroom')) {
      rep.issues.push('Missing bedroom spaces on ground floor');
    }
    if (sc.input.building.wc >= 1 && !types.has('guest-wc')) rep.issues.push('Missing guest-wc');
    const needsBath = sc.input.building.bathrooms >= 1;
    if (needsBath && groundNeedsBedrooms && !types.has('bathroom') && !types.has('master-bathroom'))
      rep.issues.push('Missing bathroom');
    // Upper floor (for multi-floor villas) must have bedrooms + stair
    if (sc.input.building.floors > 1 && sc.input.building.type === 'villa') {
      const f1 = cand.floors[1];
      if (!f1) rep.issues.push('Missing upper floor');
      else {
        const upTypes = new Set(f1.spaces.map(s => s.type));
        if (!upTypes.has('stair-hall')) rep.issues.push('Upper floor missing stair-hall');
        if (!upTypes.has('bedroom') && !upTypes.has('master-bedroom')) rep.issues.push('Upper floor missing bedrooms');
        if (sc.input.building.bathrooms >= 1 && !upTypes.has('bathroom') && !upTypes.has('master-bathroom')) rep.issues.push('Upper floor missing bathroom');
      }
    }
    if (rep.entranceCount === 0) rep.issues.push('No entrance door placed');
    if (sc.input.building.floors === 1 && rep.windowCount === 0) rep.issues.push('No windows placed');

    // Rooms outside footprint
    for (const s of f0.spaces) {
      const fp = f0.footprint;
      if (s.rect.x < fp.x - 0.01 || s.rect.y < fp.y - 0.01 ||
          s.rect.x + s.rect.w > fp.x + fp.w + 0.01 ||
          s.rect.y + s.rect.h > fp.y + fp.h + 0.01) {
        rep.issues.push(`Room ${s.label} outside footprint`);
      }
    }

    // Negative / zero area rooms
    for (const s of f0.spaces) {
      if (s.area <= 0 || s.rect.w <= 0 || s.rect.h <= 0) rep.issues.push(`Degenerate room ${s.label}`);
    }

    // DXF
    const { dxf, validation } = exportDXF(cand, sc.input.name);
    rep.dxfSize = dxf.length;
    if (!validation.ok) rep.dxfIssues = validation.errors;
    const parsed = parseDxf(dxf);
    rep.dxfSections = Array.from(parsed.sections);
    rep.dxfLayers = parsed.entitiesByLayer;
    const req = ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'];
    for (const s of req) if (!parsed.sections.has(s)) rep.issues.push(`DXF missing ${s} section`);
    const reqLayers = ['A-WALL-EXT', 'A-WALL-INT', 'A-DOOR', 'A-WINDOW', 'A-ROOM', 'A-DIMS', 'A-TITLE'];
    for (const l of reqLayers) {
      if (!parsed.entitiesByLayer[l]) rep.issues.push(`DXF missing entities on layer ${l}`);
    }
    if (!dxf.trim().endsWith('EOF')) rep.issues.push('DXF does not end with EOF');

    if (!vr.ok) {
      rep.issues.push(...vr.hard.map(h => `HARD: ${h.code}: ${h.message}`));
    }

    writeFileSync(join(OUT, `${sc.name}.dxf`), dxf, 'utf8');
    writeFileSync(join(OUT, `${sc.name}.report.json`), JSON.stringify({
      ...rep,
      hardFindings: vr.hard.map(h => ({ code: h.code, msg: h.message })),
      softFindings: vr.soft.slice(0, 10).map(f => ({ code: f.code, msg: f.message })),
      rooms: f0.spaces.map(s => ({ label: s.label, w: +s.rect.w.toFixed(2), h: +s.rect.h.toFixed(2), area: +s.area.toFixed(2) })),
    }, null, 2), 'utf8');
  } catch (e: any) {
    rep.error = e?.stack ?? String(e);
  }
  reports.push(rep);
}

console.log('=== VERIFICATION RESULTS ===\n');
let totalIssues = 0;
for (const r of reports) {
  console.log(`\n## ${r.name}`);
  if (r.error) { console.log('  ERROR:', r.error.split('\n')[0]); totalIssues++; continue; }
  console.log(`  valid=${r.valid}  hard=${r.hard}  soft=${r.soft}  adv=${r.advisory}`);
  console.log(`  spaces=${r.spaceCount}  walls=${r.wallCount}  doors=${r.doorCount}  windows=${r.windowCount}  entrance=${r.entranceCount}  parking=${r.parkingCount}  stair=${r.stairCount}`);
  console.log(`  dxf: ${r.dxfSize} bytes, sections=[${(r.dxfSections ?? []).join(', ')}]`);
  console.log(`  dxf layers:`, Object.entries(r.dxfLayers ?? {}).map(([k, v]) => `${k}=${v}`).join('  '));
  if (r.issues.length) {
    for (const i of r.issues) { console.log('  -', i); totalIssues++; }
  } else {
    console.log('  no issues');
  }
}
console.log('\n=== TOTAL ISSUES:', totalIssues, '===');
process.exit(totalIssues > 0 ? 1 : 0);
