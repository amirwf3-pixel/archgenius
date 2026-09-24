/**
 * DXF layer definitions for architectural output.
 *
 * Colors use AutoCAD Color Index (ACI) numbers.
 *
 * P16-D-B lineweight standard (1/100 mm, valid ISO 128 / AutoCAD pen values):
 *   50  structure       — exterior/core walls, columns (heaviest plot pen)
 *   35  primary walls   — interior walls, title-block border
 *   25  openings/site   — doors, windows, stairs, parking, site, north
 *   20  partitions      — lightweight partitions, just above annotation
 *   18  annotation      — dimensions, text, room labels, stair detail
 *   13  helpers         — grid, axes, buildable/setback outlines
 *    9  halftone fills  — hatches (lightest)
 * Lineweights are layer-table metadata: R12 (AC1009) has no group-370
 * lineweight record, so the pen assignment travels with the layer
 * definitions and is applied by any CAD tool that plots by layer name.
 */
export interface LayerDef {
  name: string;
  color: number; // ACI
  lineweight: number; // in 1/100 mm
  linetype: string; // e.g. 'CONTINUOUS'
  description?: string;
}

export const LAYERS: LayerDef[] = [
  { name: 'A-GRID',       color: 1, lineweight: 13, linetype: 'CENTER',     description: 'Axis grid lines' },
  { name: 'A-AXIS',       color: 1, lineweight: 13, linetype: 'CENTER',     description: 'Axis lines' },
  { name: 'A-AXIS-TEXT',  color: 1, lineweight: 18, linetype: 'CONTINUOUS', description: 'Axis labels' },
  { name: 'A-WALL-EXT',   color: 7, lineweight: 50, linetype: 'CONTINUOUS', description: 'Exterior walls' },
  { name: 'A-WALL-INT',   color: 7, lineweight: 35, linetype: 'CONTINUOUS', description: 'Interior walls' },
  { name: 'A-WALL-CORE',  color: 7, lineweight: 50, linetype: 'CONTINUOUS', description: 'Core walls (stair/elevator)' },
  { name: 'A-WALL-SERVICE', color: 7, lineweight: 25, linetype: 'CONTINUOUS', description: 'Service/wet area walls' },
  { name: 'A-WALL-PART',  color: 7, lineweight: 20, linetype: 'CONTINUOUS', description: 'Partition walls' },
  { name: 'A-COLUMN',     color: 7, lineweight: 50, linetype: 'CONTINUOUS', description: 'Structural columns' },
  { name: 'A-DOOR',       color: 3, lineweight: 25, linetype: 'CONTINUOUS', description: 'Doors + swing arcs' },
  { name: 'A-WINDOW',     color: 4, lineweight: 25, linetype: 'CONTINUOUS', description: 'Windows' },
  { name: 'A-STAIR',      color: 6, lineweight: 25, linetype: 'CONTINUOUS', description: 'Stairs' },
  { name: 'A-STAIR-TREAD',color: 8, lineweight: 18, linetype: 'CONTINUOUS', description: 'Stair tread / riser lines' },
  { name: 'A-STAIR-DIR',  color: 6, lineweight: 18, linetype: 'CONTINUOUS', description: 'Stair up/down direction arrows' },
  { name: 'A-PARKING',    color: 8, lineweight: 25, linetype: 'CONTINUOUS', description: 'Parking stalls/aisles' },
  { name: 'A-SANITARY',   color: 3, lineweight: 18, linetype: 'CONTINUOUS', description: 'Sanitary fixtures' },
  { name: 'A-FURN',       color: 8, lineweight: 18, linetype: 'CONTINUOUS', description: 'Furniture' },
  { name: 'A-ROOM',       color: 7, lineweight: 18, linetype: 'CONTINUOUS', description: 'Room labels / area tags' },
  { name: 'A-HATCH',      color: 8, lineweight: 9,  linetype: 'CONTINUOUS', description: 'Floor hatches' },
  { name: 'A-DIMS',       color: 2, lineweight: 18, linetype: 'CONTINUOUS', description: 'Dimensions' },
  { name: 'A-TEXT',       color: 7, lineweight: 18, linetype: 'CONTINUOUS', description: 'General text annotations' },
  { name: 'A-NORTH',      color: 7, lineweight: 25, linetype: 'CONTINUOUS', description: 'North arrow' },
  { name: 'A-TITLE',      color: 7, lineweight: 35, linetype: 'CONTINUOUS', description: 'Title block / border' },
  { name: 'A-BLDG-OUT',   color: 9, lineweight: 13, linetype: 'DASHED',     description: 'Buildable area outline (helper)' },
  { name: 'A-SITE',       color: 3, lineweight: 25, linetype: 'DASHED',     description: 'Site boundary' },
  { name: 'A-SETBACK',    color: 2, lineweight: 13, linetype: 'DASHED',     description: 'Setback lines' },
  { name: '0',            color: 7, lineweight: 25, linetype: 'CONTINUOUS', description: 'Default layer' },
];

/**
 * Multi-section detail layers. OPT-IN: these are written to the LAYER table
 * only when DXFOptions.sections is requested, so the default drawing (and its
 * pinned golden bytes) is unchanged. Same R12 layer-record fields as LAYERS.
 */
export const SECTION_LAYERS: LayerDef[] = [
  { name: 'A-SECT-WALL',    color: 7, lineweight: 50, linetype: 'CONTINUOUS', description: 'Section: cut walls' },
  { name: 'A-SECT-OPENING', color: 4, lineweight: 25, linetype: 'CONTINUOUS', description: 'Section: openings in cut walls' },
  { name: 'A-SECT-STAIR',   color: 6, lineweight: 25, linetype: 'CONTINUOUS', description: 'Section: stair riser/tread profile + landings' },
  { name: 'A-SECT-LIFT',    color: 5, lineweight: 25, linetype: 'CONTINUOUS', description: 'Section: lift shaft outline' },
  { name: 'A-SECT-LEVEL',   color: 8, lineweight: 13, linetype: 'CONTINUOUS', description: 'Section: storey level lines' },
  { name: 'A-SECT-TEXT',    color: 7, lineweight: 18, linetype: 'CONTINUOUS', description: 'Section: titles + level labels' },
  { name: 'A-SECT-MARK',    color: 1, lineweight: 25, linetype: 'CENTER',     description: 'Section cut markers on the ground plan' },
];

export function layerByName(name: string): LayerDef {
  return LAYERS.find(l => l.name === name) ?? LAYERS[LAYERS.length - 1];
}
