/**
 * Phase 7.3 — Professional PDF Drawing Engine
 *
 * Generates real printable architectural PDF using pdf-lib.
 * Geometry derived from same canonical model used by DXF.
 * Deterministic coordinate transform from model (m) to sheet (mm).
 */

import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import type { DocumentationModel, SheetSize } from './model.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';

// Sheet dimensions in mm (ISO)
const SHEET_SIZES: Record<SheetSize, { w: number; h: number }> = {
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
  A0: { w: 1189, h: 841 },
};

interface Transform {
  scale: number; // model m -> sheet mm
  offsetX: number;
  offsetY: number;
  // Model origin (south-west) to sheet
}

function createTransform(footprint: Rect, sheetW: number, sheetH: number, margin: number, titleBlockH: number): Transform {
  // Usable area for plan: sheet minus margins and title block
  const usableW = sheetW - margin * 2;
  const usableH = sheetH - margin * 2 - titleBlockH - 10; // 10mm gap
  // Model size in meters, convert to mm: *1000
  const modelWmm = footprint.w * 1000;
  const modelHmm = footprint.h * 1000;
  // Scale to fit usable area, with 10% padding
  const scaleX = (usableW * 0.9) / modelWmm;
  const scaleY = (usableH * 0.9) / modelHmm;
  const scale = Math.min(scaleX, scaleY);
  // Center
  const planW = modelWmm * scale;
  const planH = modelHmm * scale;
  const offsetX = margin + (usableW - planW) / 2 - footprint.x * 1000 * scale;
  const offsetY = margin + titleBlockH + 10 + (usableH - planH) / 2 - footprint.y * 1000 * scale;
  return { scale, offsetX, offsetY };
}

function modelToSheet(x: number, y: number, t: Transform): { x: number; y: number } {
  // x,y in meters -> mm * scale + offset
  return {
    x: x * 1000 * t.scale + t.offsetX,
    y: y * 1000 * t.scale + t.offsetY,
  };
}

export async function generatePDF(docModel: DocumentationModel, candidate: LayoutCandidate): Promise<Uint8Array> {
  const sheetSize = docModel.drawing.sheetSize;
  const sheet = SHEET_SIZES[sheetSize];
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([sheet.w * 2.83465, sheet.h * 2.83465]); // mm to points (1mm = 2.83465pt)
  const { width: pageW, height: pageH } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Margins in mm
  const margin = 10;
  const titleBlockH = 25;

  // Transform based on first floor footprint
  const footprint = candidate.floors[0].footprint;
  const transform = createTransform(footprint, sheet.w, sheet.h, margin, titleBlockH);

  // Helper to convert mm to points
  const mmToPt = (mm: number) => mm * 2.83465;

  // Draw border
  page.drawRectangle({
    x: mmToPt(margin),
    y: mmToPt(margin),
    width: mmToPt(sheet.w - margin * 2),
    height: mmToPt(sheet.h - margin * 2),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  // Title block
  const tbY = margin;
  const tbH = titleBlockH;
  const tbW = sheet.w - margin * 2;
  page.drawRectangle({
    x: mmToPt(margin),
    y: mmToPt(tbY),
    width: mmToPt(tbW),
    height: mmToPt(tbH),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  // Title block text
  const tbText = [
    `${docModel.project.name} — ${docModel.drawing.title}`,
    `Drawing: ${docModel.drawing.drawingNumber} | Rev: ${docModel.drawing.revision} | Date: ${docModel.drawing.date} | Scale: ${docModel.drawing.scale} | Floor: ${docModel.drawing.floor} | Strategy: ${docModel.generation.strategy}`,
    `Sheet: ${sheetSize} | Units: ${docModel.drawing.units} (DXF INSUNITS=${docModel.drawing.insunits}) | North: ${docModel.drawing.northRotationDeg}° | Seed: ${docModel.generation.seed}`,
  ];
  tbText.forEach((txt, i) => {
    page.drawText(txt, {
      x: mmToPt(margin + 2),
      y: mmToPt(tbY + tbH - 4 - i * 6),
      size: i === 0 ? 8 : 6,
      font: i === 0 ? boldFont : font,
      color: rgb(0, 0, 0),
    });
  });

  // North arrow (simple)
  const northX = sheet.w - margin - 15;
  const northY = margin + tbH + 10 + (sheet.h - margin * 2 - tbH - 10) * 0.8;
  page.drawLine({
    start: { x: mmToPt(northX), y: mmToPt(northY) },
    end: { x: mmToPt(northX), y: mmToPt(northY + 10) },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  page.drawText('N', {
    x: mmToPt(northX - 2),
    y: mmToPt(northY + 12),
    size: 8,
    font: boldFont,
  });

  // Draw plan geometry for each floor (only first floor for A3 simplicity, but loop)
  for (const fl of candidate.floors) {
    if (fl.level !== docModel.drawing.floor) continue; // only selected floor
    // Walls
    for (const w of fl.walls) {
      const s = modelToSheet(w.start.x, w.start.y, transform);
      const e = modelToSheet(w.end.x, w.end.y, transform);
      // Thickness visual: line width based on kind
      let thickness = 0.5;
      if (w.kind === 'exterior') thickness = 1.2;
      else if (w.kind === 'core') thickness = 1.0;
      else if (w.kind === 'service') thickness = 0.7;
      page.drawLine({
        start: { x: mmToPt(s.x), y: mmToPt(s.y) },
        end: { x: mmToPt(e.x), y: mmToPt(e.y) },
        thickness,
        color: rgb(0, 0, 0),
      });
    }

    // Openings
    for (const o of fl.openings) {
      const c = modelToSheet(o.center.x, o.center.y, transform);
      if (o.type === 'window') {
        // Window as small rectangle
        const halfW = (o.width * 1000 * transform.scale) / 2;
        // Perpendicular offset? Simplify: draw line
        const dir = o.wallDir;
        const perp = { x: -dir.y, y: dir.x };
        // Approximate window line
        const p1 = modelToSheet(o.center.x - dir.x * o.width / 2, o.center.y - dir.y * o.width / 2, transform);
        const p2 = modelToSheet(o.center.x + dir.x * o.width / 2, o.center.y + dir.y * o.width / 2, transform);
        page.drawLine({
          start: { x: mmToPt(p1.x), y: mmToPt(p1.y) },
          end: { x: mmToPt(p2.x), y: mmToPt(p2.y) },
          thickness: 0.8,
          color: rgb(0, 0.4, 0.8),
        });
        // Glass line
        const off = 0.5;
        const g1 = { x: p1.x + perp.x * off, y: p1.y + perp.y * off };
        const g2 = { x: p2.x + perp.x * off, y: p2.y + perp.y * off };
        page.drawLine({
          start: { x: mmToPt(g1.x), y: mmToPt(g1.y) },
          end: { x: mmToPt(g2.x), y: mmToPt(g2.y) },
          thickness: 0.3,
          color: rgb(0, 0.4, 0.8),
        });
      } else {
        // Door: leaf + arc
        if (o.hinge && o.leafEnd) {
          const h = modelToSheet(o.hinge.x, o.hinge.y, transform);
          const le = modelToSheet(o.leafEnd.x, o.leafEnd.y, transform);
          page.drawLine({
            start: { x: mmToPt(h.x), y: mmToPt(h.y) },
            end: { x: mmToPt(le.x), y: mmToPt(le.y) },
            thickness: 0.6,
            color: rgb(0.6, 0.2, 0),
          });
          // Arc approximated as 3 segments
          if (o.openEnd) {
            const oe = modelToSheet(o.openEnd.x, o.openEnd.y, transform);
            // Draw arc from leafEnd to openEnd around hinge (quarter circle)
            // Simplified: draw line from hinge to openEnd dashed? We'll draw open leaf
            page.drawLine({
              start: { x: mmToPt(h.x), y: mmToPt(h.y) },
              end: { x: mmToPt(oe.x), y: mmToPt(oe.y) },
              thickness: 0.3,
              color: rgb(0.6, 0.2, 0),
            });
          }
        }
      }
    }

    // Spaces: room labels + areas (from documentation model for consistency)
    for (const rs of docModel.roomSchedule.filter(r => r.floor === fl.level)) {
      const cx = rs.width / 2 + fl.spaces.find(s => s.id === rs.id)!.rect.x;
      const cy = rs.length / 2 + fl.spaces.find(s => s.id === rs.id)!.rect.y;
      const pt = modelToSheet(cx, cy, transform);
      page.drawText(rs.name, {
        x: mmToPt(pt.x - 10),
        y: mmToPt(pt.y + 2),
        size: 5,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      page.drawText(`${rs.area.toFixed(2)} m²`, {
        x: mmToPt(pt.x - 10),
        y: mmToPt(pt.y - 3),
        size: 4,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }

    // Dimensions: outer footprint
    const fp = fl.footprint;
    const s1 = modelToSheet(fp.x, fp.y, transform);
    const s2 = modelToSheet(fp.x + fp.w, fp.y, transform);
    const s3 = modelToSheet(fp.x, fp.y + fp.h, transform);
    // South dimension line
    page.drawLine({
      start: { x: mmToPt(s1.x), y: mmToPt(s1.y - 3) },
      end: { x: mmToPt(s2.x), y: mmToPt(s2.y - 3) },
      thickness: 0.3,
      color: rgb(0, 0, 0),
    });
    page.drawText(`${fp.w.toFixed(2)} m`, {
      x: mmToPt((s1.x + s2.x) / 2 - 5),
      y: mmToPt(s1.y - 6),
      size: 4,
      font,
    });
    // West dimension
    page.drawLine({
      start: { x: mmToPt(s1.x - 3), y: mmToPt(s1.y) },
      end: { x: mmToPt(s3.x - 3), y: mmToPt(s3.y) },
      thickness: 0.3,
      color: rgb(0, 0, 0),
    });
    page.drawText(`${fp.h.toFixed(2)} m`, {
      x: mmToPt(s1.x - 12),
      y: mmToPt((s1.y + s3.y) / 2),
      size: 4,
      font,
    });

    // Furniture
    for (const furn of fl.furniture) {
      const r = furn.rect;
      const p1 = modelToSheet(r.x, r.y, transform);
      const p2 = modelToSheet(r.x + r.w, r.y, transform);
      const p3 = modelToSheet(r.x + r.w, r.y + r.h, transform);
      const p4 = modelToSheet(r.x, r.y + r.h, transform);
      // Draw rectangle
      page.drawLine({ start: { x: mmToPt(p1.x), y: mmToPt(p1.y) }, end: { x: mmToPt(p2.x), y: mmToPt(p2.y) }, thickness: 0.2, color: rgb(0.5, 0.5, 0.5) });
      page.drawLine({ start: { x: mmToPt(p2.x), y: mmToPt(p2.y) }, end: { x: mmToPt(p3.x), y: mmToPt(p3.y) }, thickness: 0.2, color: rgb(0.5, 0.5, 0.5) });
      page.drawLine({ start: { x: mmToPt(p3.x), y: mmToPt(p3.y) }, end: { x: mmToPt(p4.x), y: mmToPt(p4.y) }, thickness: 0.2, color: rgb(0.5, 0.5, 0.5) });
      page.drawLine({ start: { x: mmToPt(p4.x), y: mmToPt(p4.y) }, end: { x: mmToPt(p1.x), y: mmToPt(p1.y) }, thickness: 0.2, color: rgb(0.5, 0.5, 0.5) });
    }

    // Grid
    const gridLines = [
      { x1: fp.x, y1: fp.y, x2: fp.x, y2: fp.y + fp.h },
      { x1: fp.x + fp.w, y1: fp.y, x2: fp.x + fp.w, y2: fp.y + fp.h },
      { x1: fp.x, y1: fp.y, x2: fp.x + fp.w, y2: fp.y },
      { x1: fp.x, y1: fp.y + fp.h, x2: fp.x + fp.w, y2: fp.y + fp.h },
    ];
    for (const gl of gridLines) {
      const p1 = modelToSheet(gl.x1, gl.y1, transform);
      const p2 = modelToSheet(gl.x2, gl.y2, transform);
      page.drawLine({
        start: { x: mmToPt(p1.x), y: mmToPt(p1.y) },
        end: { x: mmToPt(p2.x), y: mmToPt(p2.y) },
        thickness: 0.15,
        color: rgb(0.7, 0.7, 0.7),
      });
    }
  }

  // Footer: area summary
  const area = docModel.areaSummary;
  const summaryText = `GFA: ${area.grossFloorArea} m² | Usable: ${area.netUsableArea} | Circ: ${area.circulationArea} | Service: ${area.serviceArea} | Parking: ${area.parkingArea} | Residual: ${area.residualArea} | Total Rooms: ${area.totalRoomArea}`;
  page.drawText(summaryText, {
    x: mmToPt(margin),
    y: mmToPt(margin + tbH + 2),
    size: 5,
    font,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export function validatePDF(pdfBytes: Uint8Array): { ok: boolean; errors: string[]; size: number } {
  const errors: string[] = [];
  if (!pdfBytes || pdfBytes.length < 100) errors.push('PDF too small');
  const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
  if (!header.startsWith('%PDF')) errors.push('Missing PDF header');
  return { ok: errors.length === 0, errors, size: pdfBytes.length };
}
