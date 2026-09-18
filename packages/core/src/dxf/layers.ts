/**
 * DXF layer definitions for architectural output.
 *
 * Colors use AutoCAD Color Index (ACI) numbers.
 */
export interface LayerDef {
  name: string;
  color: number; // ACI
  lineweight: number; // in 1/100 mm
  linetype: string; // e.g. 'CONTINUOUS'
  description?: string;
}

export const LAYERS: LayerDef[] = [
  { name: 'A-GRID',       color: 1, lineweight: 18, linetype: 'CENTER',     description: 'Axis grid lines' },
  { name: 'A-AXIS',       color: 1, lineweight: 18, linetype: 'CENTER',     description: 'Axis lines' },
  { name: 'A-AXIS-TEXT',  color: 1, lineweight: 18, linetype: 'CONTINUOUS', description: 'Axis labels' },
  { name: 'A-WALL-EXT',   color: 7, lineweight: 50, linetype: 'CONTINUOUS', description: 'Exterior walls' },
  { name: 'A-WALL-INT',   color: 7, lineweight: 30, linetype: 'CONTINUOUS', description: 'Interior walls' },
  { name: 'A-WALL-CORE',  color: 7, lineweight: 40, linetype: 'CONTINUOUS', description: 'Core walls (stair/elevator)' },
  { name: 'A-WALL-SERVICE', color: 7, lineweight: 25, linetype: 'CONTINUOUS', description: 'Service/wet area walls' },
  { name: 'A-WALL-PART',  color: 7, lineweight: 18, linetype: 'CONTINUOUS', description: 'Partition walls' },
  { name: 'A-COLUMN',     color: 7, lineweight: 50, linetype: 'CONTINUOUS', description: 'Structural columns' },
  { name: 'A-DOOR',       color: 3, lineweight: 25, linetype: 'CONTINUOUS', description: 'Doors + swing arcs' },
  { name: 'A-WINDOW',     color: 4, lineweight: 25, linetype: 'CONTINUOUS', description: 'Windows' },
  { name: 'A-STAIR',      color: 6, lineweight: 25, linetype: 'CONTINUOUS', description: 'Stairs' },
  { name: 'A-STAIR-TREAD',color: 8, lineweight: 18, linetype: 'CONTINUOUS', description: 'Stair tread / riser lines' },
  { name: 'A-STAIR-DIR',  color: 6, lineweight: 25, linetype: 'CONTINUOUS', description: 'Stair up/down direction arrows' },
  { name: 'A-PARKING',    color: 8, lineweight: 25, linetype: 'CONTINUOUS', description: 'Parking stalls/aisles' },
  { name: 'A-SANITARY',   color: 3, lineweight: 18, linetype: 'CONTINUOUS', description: 'Sanitary fixtures' },
  { name: 'A-FURN',       color: 8, lineweight: 18, linetype: 'CONTINUOUS', description: 'Furniture' },
  { name: 'A-ROOM',       color: 7, lineweight: 18, linetype: 'CONTINUOUS', description: 'Room labels / area tags' },
  { name: 'A-HATCH',      color: 8, lineweight: 13, linetype: 'CONTINUOUS', description: 'Floor hatches' },
  { name: 'A-DIMS',       color: 2, lineweight: 18, linetype: 'CONTINUOUS', description: 'Dimensions' },
  { name: 'A-TEXT',       color: 7, lineweight: 18, linetype: 'CONTINUOUS', description: 'General text annotations' },
  { name: 'A-NORTH',      color: 7, lineweight: 25, linetype: 'CONTINUOUS', description: 'North arrow' },
  { name: 'A-TITLE',      color: 7, lineweight: 35, linetype: 'CONTINUOUS', description: 'Title block / border' },
  { name: 'A-BLDG-OUT',   color: 9, lineweight: 13, linetype: 'DASHED',     description: 'Buildable area outline (helper)' },
  { name: '0',            color: 7, lineweight: 25, linetype: 'CONTINUOUS', description: 'Default layer' },
];

export function layerByName(name: string): LayerDef {
  return LAYERS.find(l => l.name === name) ?? LAYERS[LAYERS.length - 1];
}
