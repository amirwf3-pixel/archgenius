import { createProject, exportAll, exportDXF } from '../pipeline.js';
import type { ProjectInput } from '../model/project.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const input: ProjectInput = {
    name: 'Sample_Villa_Phase7',
    site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8, northRotationDeg: 0 },
    building: {
      type: 'villa',
      floors: 1,
      bedrooms: 2,
      masterBedrooms: 1,
      bathrooms: 1,
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 1,
      hasStair: false,
      hasStorage: true,
    },
    deterministic: true,
    seed: 42,
  };
  const prj = createProject(input);
  const { bestCandidate } = (await import('../pipeline.js')).generate(prj);
  // Phase 13.2: infeasible results expose no usable candidate — refuse to generate samples.
  if (!bestCandidate) {
    throw new Error('Sample project produced no geometrically valid candidate (INFEASIBLE) — refusing to generate sample outputs.');
  }
  const { docModel, dxf, pdf, xlsx, report, manifest } = await exportAll(prj, bestCandidate);

  // Portable output directory: relative to the current working directory (repo root when run
  // as a dev utility). The `outputs/` directory is gitignored.
  const outDir = join(process.cwd(), 'outputs');
  const { mkdirSync } = await import('fs');
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'sample.dxf'), dxf, 'utf8');
  writeFileSync(join(outDir, 'sample.pdf'), pdf);
  writeFileSync(join(outDir, 'sample.xlsx'), xlsx);
  writeFileSync(join(outDir, 'sample_report.json'), JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(join(outDir, 'sample_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(outDir, 'sample_docmodel.json'), JSON.stringify(docModel, null, 2), 'utf8');

  console.log('Generated samples:');
  console.log(`DXF: ${dxf.length} chars, layers validated`);
  console.log(`PDF: ${pdf.length} bytes`);
  console.log(`XLSX: ${xlsx.length} bytes`);
  console.log(`Report: ${report.qaFindings.length} QA, ${report.regulationFindings.length} regs`);
  console.log(`Manifest: ${manifest.manifestVersion}, checksum ${manifest.consistency.checksum}`);
  console.log(`Room areas:`, docModel.consistency.roomAreas);
  console.log(`Total area: ${docModel.consistency.totalArea}`);
}

main().catch(e => { console.error(e); process.exit(1); });
