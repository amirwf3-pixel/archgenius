/**
 * Phase 7.4 — XLSX Export
 *
 * Professional workbook with sheets:
 * 01_Project, 02_Room_Schedule, 03_Area_Summary, 04_Openings, 05_QA, 06_Regulations
 * Uses exceljs, deterministic ordering, explicit units.
 */

import ExcelJS from 'exceljs';
import type { DocumentationModel } from './model.js';

export async function generateXLSX(docModel: DocumentationModel): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ArchGenius Phase 7';
  wb.created = new Date(docModel.generation.timestamp);
  wb.modified = new Date(docModel.generation.timestamp);

  // 01_Project
  const ws1 = wb.addWorksheet('01_Project');
  ws1.columns = [
    { header: 'Field', key: 'field', width: 25 },
    { header: 'Value', key: 'value', width: 40 },
    { header: 'Unit', key: 'unit', width: 10 },
  ];
  const projectRows = [
    { field: 'Project ID', value: docModel.project.id, unit: '' },
    { field: 'Project Name', value: docModel.project.name, unit: '' },
    { field: 'Client', value: docModel.project.client ?? '', unit: '' },
    { field: 'Description', value: docModel.project.description ?? '', unit: '' },
    { field: 'Created At', value: new Date(docModel.project.createdAt).toISOString(), unit: '' },
    { field: 'Schema Version', value: docModel.project.schemaVersion, unit: '' },
    { field: 'Site Width', value: docModel.site.width, unit: 'm' },
    { field: 'Site Length', value: docModel.site.length, unit: 'm' },
    { field: 'Site Area', value: docModel.site.area, unit: 'm²' },
    { field: 'Access Side', value: docModel.site.accessSide, unit: '' },
    { field: 'Building Type', value: docModel.building.type, unit: '' },
    { field: 'Floors', value: docModel.building.floors, unit: '' },
    { field: 'Bedrooms', value: docModel.building.bedrooms, unit: '' },
    { field: 'Master Bedrooms', value: docModel.building.masterBedrooms, unit: '' },
    { field: 'Bathrooms', value: docModel.building.bathrooms, unit: '' },
    { field: 'WC', value: docModel.building.wc, unit: '' },
    { field: 'Kitchen Type', value: docModel.building.kitchenType, unit: '' },
    { field: 'Parking Spaces', value: docModel.building.parkingSpaces, unit: '' },
    { field: 'Seed', value: docModel.generation.seed, unit: '' },
    { field: 'Strategy', value: docModel.generation.strategy, unit: '' },
    { field: 'Deterministic', value: docModel.generation.deterministic ? 'true' : 'false', unit: '' },
    { field: 'Software Version', value: docModel.generation.softwareVersion, unit: '' },
    { field: 'Generation Timestamp', value: docModel.generation.timestamp, unit: 'ISO' },
  ];
  projectRows.forEach(r => ws1.addRow(r));
  ws1.getRow(1).font = { bold: true };

  // 02_Room_Schedule
  const ws2 = wb.addWorksheet('02_Room_Schedule');
  ws2.columns = [
    { header: 'ID', key: 'id', width: 15 },
    { header: 'Name', key: 'name', width: 20 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Floor', key: 'floor', width: 8 },
    { header: 'Zone', key: 'zone', width: 12 },
    { header: 'Privacy', key: 'privacy', width: 12 },
    { header: 'Area', key: 'area', width: 12 },
    { header: 'Area Unit', key: 'areaUnit', width: 10 },
    { header: 'Width', key: 'width', width: 10 },
    { header: 'Length', key: 'length', width: 10 },
    { header: 'Min Side', key: 'minSide', width: 10 },
    { header: 'Max Side', key: 'maxSide', width: 10 },
    { header: 'Proportion', key: 'proportion', width: 12 },
    { header: 'Has Exterior', key: 'hasExterior', width: 12 },
    { header: 'Daylight Req', key: 'daylight', width: 12 },
    { header: 'Target Area', key: 'target', width: 12 },
    { header: 'Openings', key: 'openings', width: 20 },
  ];
  ws2.getRow(1).font = { bold: true };
  for (const r of docModel.roomSchedule) {
    ws2.addRow({
      id: r.id,
      name: r.name,
      type: r.type,
      floor: r.floor,
      zone: r.zone,
      privacy: r.privacy,
      area: r.area,
      areaUnit: 'm²',
      width: r.width,
      length: r.length,
      minSide: r.minSide,
      maxSide: r.maxSide,
      proportion: r.proportion,
      hasExterior: r.hasExteriorWall ? 'yes' : 'no',
      daylight: r.daylightRequired ? 'yes' : 'no',
      target: r.targetArea,
      openings: r.openingsSummary,
    });
  }

  // 03_Area_Summary
  const ws3 = wb.addWorksheet('03_Area_Summary');
  ws3.columns = [
    { header: 'Metric', key: 'metric', width: 25 },
    { header: 'Value', key: 'value', width: 15 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  ws3.getRow(1).font = { bold: true };
  const a = docModel.areaSummary;
  const areaRows = [
    { metric: 'Site Area', value: a.siteArea, unit: 'm²', notes: 'width*length' },
    { metric: 'Building Footprint', value: a.buildingFootprint, unit: 'm²', notes: 'ground floor' },
    { metric: 'Gross Floor Area', value: a.grossFloorArea, unit: 'm²', notes: 'sum footprints' },
    { metric: 'Net Usable Area', value: a.netUsableArea, unit: 'm²', notes: 'non-circ' },
    { metric: 'Circulation Area', value: a.circulationArea, unit: 'm²', notes: 'corridor+stair+entrance' },
    { metric: 'Service Area', value: a.serviceArea, unit: 'm²', notes: 'bath+wc+storage' },
    { metric: 'Parking Area', value: a.parkingArea, unit: 'm²', notes: '' },
    { metric: 'Balcony Area', value: a.balconyArea, unit: 'm²', notes: '' },
    { metric: 'Yard Area', value: a.yardArea, unit: 'm²', notes: '' },
    { metric: 'Residual Area', value: a.residualArea, unit: 'm²', notes: 'footprint - assigned' },
    { metric: 'Total Room Area', value: a.totalRoomArea, unit: 'm²', notes: 'sum all spaces' },
    { metric: 'Gross vs Components Discrepancy', value: a.reconciliation.grossVsComponents.discrepancy, unit: 'm²', notes: `tolerance ${a.reconciliation.tolerance}` },
    { metric: 'Within Tolerance', value: a.reconciliation.grossVsComponents.withinTolerance ? 'yes' : 'no', unit: '', notes: '' },
  ];
  areaRows.forEach(r => ws3.addRow(r));
  ws3.addRow({});
  ws3.addRow({ metric: 'Reconciliation Explanation', value: '', unit: '', notes: '' });
  a.reconciliation.explanation.forEach(exp => ws3.addRow({ metric: '', value: '', unit: '', notes: exp }));

  // 04_Openings
  const ws4 = wb.addWorksheet('04_Openings');
  ws4.columns = [
    { header: 'ID', key: 'id', width: 15 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Floor', key: 'floor', width: 8 },
    { header: 'Wall ID', key: 'wallId', width: 15 },
    { header: 'Width', key: 'width', width: 10 },
    { header: 'Height', key: 'height', width: 10 },
    { header: 'Sill', key: 'sill', width: 10 },
    { header: 'Swing', key: 'swing', width: 10 },
    { header: 'Space A', key: 'spaceA', width: 15 },
    { header: 'Space B', key: 'spaceB', width: 15 },
    { header: 'Center X', key: 'cx', width: 10 },
    { header: 'Center Y', key: 'cy', width: 10 },
    { header: 'Unit', key: 'unit', width: 8 },
  ];
  ws4.getRow(1).font = { bold: true };
  for (const o of docModel.openingsSchedule) {
    ws4.addRow({
      id: o.id,
      type: o.type,
      floor: o.floor,
      wallId: o.wallId,
      width: o.width,
      height: o.height,
      sill: o.sill,
      swing: o.swing ?? '',
      spaceA: o.spaceA ?? '',
      spaceB: o.spaceB ?? '',
      cx: o.center.x,
      cy: o.center.y,
      unit: 'm',
    });
  }

  // 05_QA
  const ws5 = wb.addWorksheet('05_QA');
  ws5.columns = [
    { header: 'Code', key: 'code', width: 20 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Category', key: 'category', width: 12 },
    { header: 'Is Heuristic', key: 'heuristic', width: 12 },
    { header: 'Message', key: 'message', width: 60 },
    { header: 'Entity IDs', key: 'entities', width: 30 },
  ];
  ws5.getRow(1).font = { bold: true };
  for (const q of docModel.qaFindings) {
    ws5.addRow({
      code: q.code,
      severity: q.severity,
      category: q.category,
      heuristic: q.isHeuristic ? 'yes' : 'no',
      message: q.message,
      entities: (q.entityIds ?? []).join(', '),
    });
  }

  // 06_Regulations
  const ws6 = wb.addWorksheet('06_Regulations');
  ws6.columns = [
    { header: 'Rule ID', key: 'ruleId', width: 18 },
    { header: 'Title/Code', key: 'title', width: 20 },
    { header: 'Status', key: 'status', width: 25 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Result', key: 'result', width: 10 },
    { header: 'Source', key: 'source', width: 25 },
    { header: 'Edition', key: 'edition', width: 15 },
    { header: 'Page', key: 'page', width: 8 },
    { header: 'Clause', key: 'clause', width: 20 },
    { header: 'Message', key: 'message', width: 60 },
  ];
  ws6.getRow(1).font = { bold: true };
  for (const r of docModel.regulationFindings) {
    ws6.addRow({
      ruleId: r.ruleId,
      title: r.title,
      status: r.status,
      severity: r.severity,
      result: r.result,
      source: r.source,
      edition: r.edition,
      page: r.page ?? '',
      clause: r.clause ?? '',
      message: r.message,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export function validateXLSX(buffer: Uint8Array): { ok: boolean; errors: string[]; sheets: string[] } {
  const errors: string[] = [];
  if (!buffer || buffer.length < 100) errors.push('XLSX too small');
  // Check PK header (zip)
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) errors.push('Missing ZIP header (XLSX should be zip)');
  return { ok: errors.length === 0, errors, sheets: ['01_Project', '02_Room_Schedule', '03_Area_Summary', '04_Openings', '05_QA', '06_Regulations'] };
}
