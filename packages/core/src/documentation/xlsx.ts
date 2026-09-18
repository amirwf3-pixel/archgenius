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
    { field: 'Site Shape', value: docModel.site.shape, unit: '' },
    { field: 'Site Width', value: docModel.site.width, unit: 'm' },
    { field: 'Site Length', value: docModel.site.length, unit: 'm' },
    { field: 'Site Area', value: docModel.site.area, unit: 'm²' },
    { field: 'Buildable Area', value: (docModel.site as any).buildableArea ?? '', unit: 'm²' },
    { field: 'Buildable Rects', value: (docModel.site as any).buildableRects?.length ?? '', unit: '' },
    { field: 'Setbacks N/S/E/W', value: (docModel.site as any).setbacks ? `${(docModel.site as any).setbacks.north}/${(docModel.site as any).setbacks.south}/${(docModel.site as any).setbacks.east}/${(docModel.site as any).setbacks.west}` : '', unit: 'm' },
    { field: 'Jurisdiction', value: (docModel.site as any).jurisdiction ?? '', unit: '' },
    { field: 'City', value: (docModel.site as any).city ?? '', unit: '' },
    { field: 'Parking Layout', value: (docModel.site as any).parkingLayout ?? 'auto', unit: '' },
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

  // 07_Intelligence — Phase 9 whole-building
  const ws7 = wb.addWorksheet('07_Intelligence');
  ws7.columns = [
    { header: 'Metric', key: 'metric', width: 24 },
    { header: 'Raw', key: 'raw', width: 14 },
    { header: 'Normalized', key: 'norm', width: 12 },
    { header: 'Weight', key: 'weight', width: 10 },
    { header: 'Weighted', key: 'weighted', width: 12 },
    { header: 'Reason', key: 'reason', width: 70 },
    { header: 'Is Hard', key: 'isHard', width: 10 },
    { header: 'Is Heuristic', key: 'isHeuristic', width: 12 },
    { header: 'Is Evaluable', key: 'isEvaluable', width: 12 },
  ];
  ws7.getRow(1).font = { bold: true };
  if (docModel.intelligence) {
    const intel = docModel.intelligence;
    const scope = intel.intelligenceScope;
    ws7.addRow({ metric: 'Intelligence Scope', raw: scope, norm: '', weight: '', weighted: '', reason: `Whole-Building Intelligence — ${intel.floorCount} floors, all floors evaluated`, isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({ metric: 'Candidate ID', raw: intel.candidateId, norm: '', weight: '', weighted: '', reason: `Strategy ${intel.strategy} | Floors ${intel.floorCount}`, isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({ metric: 'Feasible', raw: intel.feasible ? 'yes' : 'no', norm: '', weight: '', weighted: '', reason: `Hard violations ${intel.hardViolations} — Hard validation scope: All ${docModel.building.floors} floors`, isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({ metric: 'Floor Count', raw: intel.floorCount, norm: '', weight: '', weighted: '', reason: 'First-class input, validated 1..10', isHard: '', isHeuristic: '', isEvaluable: 'yes' });
    ws7.addRow({ metric: 'Overall Quality (Whole-Building)', raw: intel.overallQuality, norm: intel.overallQuality, weight: 1, weighted: intel.overallQuality, reason: intel.wholeBuilding.tradeOff, isHard: 'no', isHeuristic: 'yes', isEvaluable: 'yes' });
    ws7.addRow({ metric: 'Avg Floor Quality', raw: intel.wholeBuilding.avgFloorQuality.overall, norm: intel.wholeBuilding.avgFloorQuality.overall, weight: 0.6, weighted: intel.wholeBuilding.avgFloorQuality.overall * 0.6, reason: 'Average of per-floor overall qualities', isHard: 'no', isHeuristic: 'yes', isEvaluable: 'yes' });
    ws7.addRow({ metric: 'Vertical Circulation', raw: intel.vertical.score, norm: intel.vertical.score, weight: 0.2, weighted: intel.vertical.score * 0.2, reason: `Connected=${intel.vertical.isConnected}, stairCount=${intel.vertical.stairCount}, continuity=${intel.vertical.stairContinuityScore}, alignment=${intel.vertical.stairAlignmentScore}`, isHard: 'no', isHeuristic: 'yes', isEvaluable: 'yes' });
    ws7.addRow({ metric: 'Stacking', raw: intel.stacking.score, norm: intel.stacking.score, weight: 0.12, weighted: intel.stacking.score * 0.12, reason: `Kitchen ${intel.stacking.kitchenStackingScore}, bathroom ${intel.stacking.bathroomStackingScore}, wet ${intel.stacking.wetAreaClusteringScore}, circ ${intel.stacking.circulationAlignmentScore}`, isHard: 'no', isHeuristic: 'yes', isEvaluable: 'yes' });
    ws7.addRow({ metric: 'Inter-Floor', raw: intel.interFloor.score, norm: intel.interFloor.score, weight: 0.08, weighted: intel.interFloor.score * 0.08, reason: `Entrance→vertical ${intel.interFloor.entranceToVerticalScore}, public/private ${intel.interFloor.publicPrivateTransitionScore}, bedroom ${intel.interFloor.bedroomDistributionScore}, access ${intel.interFloor.floorAccessScore}`, isHard: 'no', isHeuristic: 'yes', isEvaluable: 'yes' });
    ws7.addRow({ metric: 'Evaluable Weights Sum', raw: (intel.wholeBuilding as any).evaluableWeightsSum ?? 1, norm: '', weight: '', weighted: '', reason: 'Renormalized when N/A present, whole-building', isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({});
    ws7.addRow({ metric: 'Whole-Building Contributions', raw: '', norm: '', weight: '', weighted: '', reason: '', isHard: '', isHeuristic: '', isEvaluable: '' });
    for (const c of intel.contributions) {
      const rawDisplay = c.raw === null ? 'N/A — Not Evaluated' : c.raw;
      ws7.addRow({
        metric: c.metric,
        raw: rawDisplay as any,
        norm: c.normalized,
        weight: c.weight,
        weighted: c.weightedScore,
        reason: c.reason,
        isHard: c.isHard ? 'yes' : 'no',
        isHeuristic: c.isHeuristic ? 'yes' : 'no',
        isEvaluable: (c as any).isEvaluable ? 'yes' : 'no',
      });
    }
    ws7.addRow({});
    ws7.addRow({ metric: 'Strengths (Whole-Building)', raw: '', norm: '', weight: '', weighted: '', reason: '', isHard: '', isHeuristic: '', isEvaluable: '' });
    for (const s of intel.strengths) ws7.addRow({ metric: '', raw: s, norm: '', weight: '', weighted: '', reason: '', isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({});
    ws7.addRow({ metric: 'Weaknesses (Whole-Building)', raw: '', norm: '', weight: '', weighted: '', reason: '', isHard: '', isHeuristic: '', isEvaluable: '' });
    for (const w of intel.weaknesses) ws7.addRow({ metric: '', raw: w, norm: '', weight: '', weighted: '', reason: '', isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({});
    ws7.addRow({ metric: 'Trade-off (Whole-Building)', raw: intel.tradeOff, norm: '', weight: '', weighted: '', reason: '', isHard: '', isHeuristic: '', isEvaluable: '' });
    ws7.addRow({});
    ws7.addRow({ metric: 'Whole-Building Details', raw: intel.wholeBuilding.tradeOff, norm: '', weight: '', weighted: '', reason: intel.wholeBuilding.intelligenceScope, isHard: '', isHeuristic: '', isEvaluable: '' });
  }

  // 08_PerFloor — Phase 9 per-floor intelligence
  const ws8 = wb.addWorksheet('08_PerFloor');
  ws8.columns = [
    { header: 'Floor Level', key: 'floor', width: 12 },
    { header: 'Intelligence Scope', key: 'scope', width: 22 },
    { header: 'Overall Quality', key: 'overall', width: 14 },
    { header: 'Functional', key: 'functional', width: 12 },
    { header: 'Circulation', key: 'circulation', width: 12 },
    { header: 'Privacy', key: 'privacy', width: 12 },
    { header: 'Daylight', key: 'daylight', width: 12 },
    { header: 'Usability', key: 'usability', width: 12 },
    { header: 'Kitchen', key: 'kitchen', width: 12 },
    { header: 'Bedroom', key: 'bedroom', width: 12 },
    { header: 'EntranceService', key: 'entrance', width: 14 },
    { header: 'EvaluableWeightsSum', key: 'evaluable', width: 18 },
    { header: 'TradeOff', key: 'tradeoff', width: 60 },
  ];
  ws8.getRow(1).font = { bold: true };
  if (docModel.intelligence) {
    for (const pf of docModel.intelligence.perFloor) {
      ws8.addRow({
        floor: pf.floorLevel,
        scope: pf.intelligenceScope,
        overall: pf.overallQuality,
        functional: pf.quality.functional,
        circulation: pf.quality.circulation,
        privacy: pf.quality.privacy,
        daylight: pf.quality.daylight,
        usability: pf.quality.usability,
        kitchen: pf.quality.kitchen === null ? 'N/A' : pf.quality.kitchen,
        bedroom: pf.quality.bedroom,
        entrance: pf.quality.entranceService,
        evaluable: (pf.quality as any).evaluableWeightsSum,
        tradeoff: pf.tradeOff,
      });
    }
  }

  // 09_Vertical — Phase 9 vertical circulation + stacking
  const ws9 = wb.addWorksheet('09_Vertical');
  ws9.columns = [
    { header: 'Metric', key: 'metric', width: 24 },
    { header: 'Score', key: 'score', width: 12 },
    { header: 'Is Connected', key: 'connected', width: 14 },
    { header: 'Stair Count', key: 'stairCount', width: 12 },
    { header: 'Continuity', key: 'continuity', width: 12 },
    { header: 'Alignment', key: 'alignment', width: 12 },
    { header: 'Disconnected Floors', key: 'disconnected', width: 20 },
    { header: 'Findings', key: 'findings', width: 10 },
    { header: 'Is Heuristic', key: 'heuristic', width: 12 },
    { header: 'Reason', key: 'reason', width: 60 },
  ];
  ws9.getRow(1).font = { bold: true };
  if (docModel.intelligence) {
    const v = docModel.intelligence.vertical;
    ws9.addRow({
      metric: 'Vertical Circulation',
      score: v.score,
      connected: v.isConnected ? 'yes' : 'no',
      stairCount: v.stairCount,
      continuity: v.stairContinuityScore,
      alignment: v.stairAlignmentScore,
      disconnected: v.disconnectedFloors.join(', '),
      findings: v.findings,
      heuristic: v.isHeuristic ? 'yes' : 'no',
      reason: `Floor connectivity and stair continuity — whole-building ${docModel.building.floors} floors`,
    });
    const s = docModel.intelligence.stacking;
    ws9.addRow({
      metric: 'Stacking',
      score: s.score,
      connected: '',
      stairCount: '',
      continuity: s.kitchenStackingScore,
      alignment: s.circulationAlignmentScore,
      disconnected: `bathroom ${s.bathroomStackingScore}, wet ${s.wetAreaClusteringScore}, service ${s.serviceZoneAlignmentScore}`,
      findings: s.findings,
      heuristic: s.isHeuristic ? 'yes' : 'no',
      reason: 'Kitchen over kitchen, bathroom over bathroom, wet-area clustering, circulation alignment — heuristic',
    });
    const i = docModel.intelligence.interFloor;
    ws9.addRow({
      metric: 'Inter-Floor',
      score: i.score,
      connected: '',
      stairCount: '',
      continuity: i.entranceToVerticalScore,
      alignment: i.publicPrivateTransitionScore,
      disconnected: `bedroom ${i.bedroomDistributionScore}, service ${i.serviceDistributionScore}, access ${i.floorAccessScore}`,
      findings: i.findings,
      heuristic: i.isHeuristic ? 'yes' : 'no',
      reason: 'Entrance→vertical→upper, public/private, bedroom/service distribution, privacy — heuristic',
    });
  }

  // 11_Site — Phase 10 site/context intelligence
  const ws11 = wb.addWorksheet('11_Site');
  ws11.columns = [
    { header: 'Field', key: 'field', width: 24 },
    { header: 'Value', key: 'value', width: 30 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Source/Status', key: 'source', width: 30 },
    { header: 'Notes', key: 'notes', width: 50 },
  ];
  ws11.getRow(1).font = { bold: true };
  const siteMeta = (docModel.site as any);
  ws11.addRow({ field: 'Site Shape', value: siteMeta.shape, unit: '', source: 'Input', notes: 'rectangle, l-shape, polygon — V1 orthogonal only' });
  ws11.addRow({ field: 'Site Width', value: siteMeta.width, unit: 'm', source: 'Input', notes: 'Overall bounding width' });
  ws11.addRow({ field: 'Site Length', value: siteMeta.length, unit: 'm', source: 'Input', notes: 'Overall bounding length' });
  ws11.addRow({ field: 'Site Area', value: siteMeta.area, unit: 'm²', source: 'Computed', notes: `From ${siteMeta.shape} geometry` });
  ws11.addRow({ field: 'Buildable Area', value: siteMeta.buildableArea ?? '', unit: 'm²', source: 'Computed', notes: 'After setbacks, canonical buildable polygon' });
  ws11.addRow({ field: 'Buildable Bounding Rect', value: siteMeta.buildableBoundingRect ? `${siteMeta.buildableBoundingRect.x},${siteMeta.buildableBoundingRect.y} ${siteMeta.buildableBoundingRect.w}x${siteMeta.buildableBoundingRect.h}` : '', unit: 'm', source: 'Computed', notes: 'Bounding rect of buildable polygon' });
  ws11.addRow({ field: 'Buildable Rects Count', value: siteMeta.buildableRects?.length ?? 1, unit: '', source: 'Computed', notes: 'Decomposition for L-shape/polygon placement' });
  if (siteMeta.buildableRects) {
    siteMeta.buildableRects.forEach((r: any, i: number) => {
      ws11.addRow({ field: `Buildable Rect ${i}`, value: `${r.x},${r.y} ${r.w}x${r.h} area ${r.area}`, unit: 'm', source: 'Computed', notes: 'For site-aware placement' });
    });
  }
  ws11.addRow({ field: 'Access Side', value: siteMeta.accessSide, unit: '', source: 'Input', notes: '' });
  ws11.addRow({ field: 'Jurisdiction', value: siteMeta.jurisdiction ?? '', unit: '', source: 'Input', notes: 'Municipality identifier' });
  ws11.addRow({ field: 'City', value: siteMeta.city ?? '', unit: '', source: 'Input', notes: '' });
  ws11.addRow({ field: 'Parking Layout', value: siteMeta.parkingLayout ?? 'auto', unit: '', source: 'Input', notes: 'perpendicular, parallel, auto — site-aware fit checks' });
  ws11.addRow({});
  ws11.addRow({ field: 'Setbacks', value: '', unit: '', source: '', notes: 'User-defined design inputs — NOT legal requirements unless VERIFIED' });
  if (siteMeta.setbacks) {
    ws11.addRow({ field: 'Setback North', value: siteMeta.setbacks.north, unit: 'm', source: siteMeta.setbackSources?.find((s: any) => s.direction === 'north')?.source ?? 'default-assumption', notes: siteMeta.setbackSources?.find((s: any) => s.direction === 'north')?.reference ?? '' });
    ws11.addRow({ field: 'Setback South', value: siteMeta.setbacks.south, unit: 'm', source: siteMeta.setbackSources?.find((s: any) => s.direction === 'south')?.source ?? 'default-assumption', notes: siteMeta.setbackSources?.find((s: any) => s.direction === 'south')?.reference ?? '' });
    ws11.addRow({ field: 'Setback East', value: siteMeta.setbacks.east, unit: 'm', source: siteMeta.setbackSources?.find((s: any) => s.direction === 'east')?.source ?? 'default-assumption', notes: siteMeta.setbackSources?.find((s: any) => s.direction === 'east')?.reference ?? '' });
    ws11.addRow({ field: 'Setback West', value: siteMeta.setbacks.west, unit: 'm', source: siteMeta.setbackSources?.find((s: any) => s.direction === 'west')?.source ?? 'default-assumption', notes: siteMeta.setbackSources?.find((s: any) => s.direction === 'west')?.reference ?? '' });
  }
  ws11.addRow({});
  ws11.addRow({ field: 'Site Boundary Vertices', value: siteMeta.siteBoundary?.length ?? '', unit: '', source: 'Input/Canonical', notes: 'CCW polygon' });
  if (siteMeta.siteBoundary) {
    siteMeta.siteBoundary.forEach((v: any, i: number) => {
      ws11.addRow({ field: `Site Vertex ${i}`, value: `${v.x},${v.y}`, unit: 'm', source: 'Canonical', notes: '' });
    });
  }
  ws11.addRow({});
  ws11.addRow({ field: 'Buildable Boundary Vertices', value: siteMeta.buildableBoundary?.length ?? '', unit: '', source: 'Computed', notes: 'After setbacks, canonical for placement/validation' });
  if (siteMeta.buildableBoundary) {
    siteMeta.buildableBoundary.forEach((v: any, i: number) => {
      ws11.addRow({ field: `Buildable Vertex ${i}`, value: `${v.x},${v.y}`, unit: 'm', source: 'Computed', notes: '' });
    });
  }
  ws11.addRow({});
  ws11.addRow({ field: 'Site Validation', value: siteMeta.siteValidation?.isValid ? 'valid' : 'invalid', unit: '', source: 'Validation', notes: (siteMeta.siteValidation?.errors ?? []).join('; ') });
  ws11.addRow({});
  ws11.addRow({ field: 'L-Shape', value: siteMeta.lShape ? JSON.stringify(siteMeta.lShape) : '', unit: '', source: 'Input', notes: 'Overall W/L minus notch from corner' });
  ws11.addRow({ field: 'Polygon Vertices', value: siteMeta.polygonVertices ? `${siteMeta.polygonVertices.length} vertices` : '', unit: '', source: 'Input', notes: 'Orthogonal V1 only, 3..8 vertices, simple, no self-intersection' });
  if (siteMeta.polygonVertices) {
    siteMeta.polygonVertices.forEach((v: any, i: number) => {
      ws11.addRow({ field: `Polygon Input Vertex ${i}`, value: `${v.x},${v.y}`, unit: 'm', source: 'Input', notes: '' });
    });
  }

  // 10_Stacking details — Phase 9.1 improved: actual stacking evidence, not placeholder
  const ws10 = wb.addWorksheet('10_Stacking');
  ws10.columns = [
    { header: 'From Level', key: 'from', width: 12 },
    { header: 'To Level', key: 'to', width: 12 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'From Type', key: 'fromType', width: 16 },
    { header: 'To Type', key: 'toType', width: 16 },
    { header: 'Overlap', key: 'overlap', width: 12 },
    { header: 'Aligned', key: 'aligned', width: 10 },
    { header: 'Score Contribution', key: 'scoreContrib', width: 16 },
    { header: 'Is Heuristic', key: 'heuristic', width: 12 },
    { header: 'Reason', key: 'reason', width: 60 },
  ];
  ws10.getRow(1).font = { bold: true };
  if (docModel.intelligence) {
    const s = docModel.intelligence.stacking;
    // If details available, expose structured rows
    const details = (s as any).details as Array<{ fromLevel: number; toLevel: number; fromType: string; toType: string; overlap: number; aligned: boolean; reason: string }> | undefined;
    if (details && details.length > 0) {
      // Deterministic ordering already sorted in stacking.ts
      for (const d of details) {
        // Determine category from types
        let category = 'wet';
        if (d.fromType === 'kitchen' && d.toType === 'kitchen') category = 'kitchen';
        else if ((d.fromType.includes('bathroom') || d.fromType.includes('wc')) && (d.toType.includes('bathroom') || d.toType.includes('wc'))) category = 'bathroom';
        else if (['corridor', 'stair-hall', 'foyer', 'entrance'].includes(d.fromType) || ['corridor', 'stair-hall', 'foyer', 'entrance'].includes(d.toType)) category = 'circulation';
        else if (['storage', 'utility'].includes(d.fromType) || ['storage', 'utility'].includes(d.toType)) category = 'service';
        ws10.addRow({
          from: d.fromLevel,
          to: d.toLevel,
          category,
          fromType: d.fromType,
          toType: d.toType,
          overlap: d.overlap,
          aligned: d.aligned ? 'yes' : 'no',
          scoreContrib: d.aligned ? 'reward' : 'penalty',
          heuristic: s.isHeuristic ? 'yes' : 'no',
          reason: d.reason,
        });
      }
    } else {
      // Fallback: best structured evidence available, explicitly label limitations
      ws10.addRow({ from: '', to: '', category: '', fromType: '', toType: '', overlap: '', aligned: '', scoreContrib: '', heuristic: 'yes', reason: `Stacking score ${s.score} — kitchen ${s.kitchenStackingScore}, bathroom ${s.bathroomStackingScore}, wet ${s.wetAreaClusteringScore}, circ ${s.circulationAlignmentScore}, service ${s.serviceZoneAlignmentScore} — heuristic` });
      ws10.addRow({ from: '', to: '', category: '', fromType: '', toType: '', overlap: '', aligned: '', scoreContrib: '', heuristic: 'yes', reason: `Strengths: ${s.strengths.slice(0, 5).join(' | ')}` });
      ws10.addRow({ from: '', to: '', category: '', fromType: '', toType: '', overlap: '', aligned: '', scoreContrib: '', heuristic: 'yes', reason: `Weaknesses: ${s.weaknesses.slice(0, 5).join(' | ')}` });
      ws10.addRow({ from: '', to: '', category: '', fromType: '', toType: '', overlap: '', aligned: '', scoreContrib: '', heuristic: 'yes', reason: `Limitation: pair-level details not stored in this docModel version — strengths/weaknesses are best available evidence` });
    }
    // Add summary row
    ws10.addRow({});
    ws10.addRow({ from: '', to: '', category: 'summary', fromType: '', toType: '', overlap: s.score, aligned: '', scoreContrib: '', heuristic: 'yes', reason: `Overall stacking ${s.score}, kitchen ${s.kitchenStackingScore}, bathroom ${s.bathroomStackingScore}, wet ${s.wetAreaClusteringScore}, circ ${s.circulationAlignmentScore}, service ${s.serviceZoneAlignmentScore} — all floors ${docModel.building.floors}, bounded 100 details, deterministic` });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export function validateXLSX(buffer: Uint8Array): { ok: boolean; errors: string[]; sheets: string[] } {
  const errors: string[] = [];
  if (!buffer || buffer.length < 100) errors.push('XLSX too small');
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) errors.push('Missing ZIP header (XLSX should be zip)');
  return { ok: errors.length === 0, errors, sheets: ['01_Project', '02_Room_Schedule', '03_Area_Summary', '04_Openings', '05_QA', '06_Regulations', '07_Intelligence', '08_PerFloor', '09_Vertical', '10_Stacking', '11_Site'] };
}
