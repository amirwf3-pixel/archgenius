/**
 * Lightweight DXF structural parser for verification.
 *
 * Supports ASCII DXF (R12 and later) pair parsing. Returns sections found,
 * entity counts by layer, and header variables. This is for QA only.
 */

export interface ParsedDxf {
  sections: Set<string>;
  entitiesByLayer: Record<string, number>;
  layers: Set<string>;
  /** Entity types by count. */
  entityTypes: Record<string, number>;
  headerVars: Record<string, string>;
  errors: string[];
}

/** Parse a DXF ASCII string. Supports CRLF and LF line endings. */
export function parseDxf(src: string): ParsedDxf {
  const result: ParsedDxf = {
    sections: new Set(),
    entitiesByLayer: {},
    layers: new Set(),
    entityTypes: {},
    headerVars: {},
    errors: [],
  };

  // Normalize: some DXF writers use \r\n, some \n.
  const lines = src.split(/\r?\n/);
  // Group into (code, value) pairs.
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeLine = lines[i].trim();
    if (codeLine === '' && i === lines.length - 1) break;
    const code = parseInt(codeLine, 10);
    if (Number.isNaN(code)) continue;
    const value = lines[i + 1];
    pairs.push({ code, value });
  }

  let currentSection = '';
  let inEntities = false;
  let inTables = false;
  let currentEntity: { type: string; layer: string } | null = null;
  let expectingLayerName = false;

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    const v = value.trim();
    if (code === 0) {
      if (v === 'SECTION') {
        // Next pair is (2, NAME)
        const next = pairs[i + 1];
        if (next && next.code === 2) {
          currentSection = next.value.trim();
          result.sections.add(currentSection);
          inEntities = currentSection === 'ENTITIES';
          inTables = currentSection === 'TABLES';
          i++; // consume the "2 NAME" pair
        }
      } else if (v === 'ENDSEC') {
        currentSection = '';
        inEntities = false;
        inTables = false;
        currentEntity = null;
      } else if (inEntities) {
        // Start new entity
        currentEntity = { type: v, layer: '0' };
        result.entityTypes[v] = (result.entityTypes[v] ?? 0) + 1;
      } else if (inTables && v === 'LAYER') {
        expectingLayerName = true;
      } else {
        currentEntity = null;
        expectingLayerName = false;
      }
      continue;
    }
    if (currentSection === 'HEADER' && code === 9) {
      // Next pair is the value of this header variable.
      const next = pairs[i + 1];
      if (next) result.headerVars[v] = next.value.trim();
      continue;
    }
    if (inEntities && currentEntity) {
      if (code === 8) {
        currentEntity.layer = v;
        result.entitiesByLayer[v] = (result.entitiesByLayer[v] ?? 0) + 0; // ensure key exists
      }
      // When we hit code 0 next iteration, we'll commit this entity.
      // We increment count when we leave the entity; but for simplicity count
      // when we hit code 0 *for the next entity*. To avoid missing the last
      // entity, track a "pending" flag:
    }
    if (inTables && expectingLayerName && code === 2) {
      result.layers.add(v);
      expectingLayerName = false;
    }
  }

  // Count entities by layer by walking pairs more carefully.
  // Re-scan entities section counting per (0,type) then reading (8,layer) before next (0,type).
  let entSec = false;
  let curType: string | null = null;
  let curLayer = '0';
  const commit = () => {
    if (curType) {
      result.entitiesByLayer[curLayer] = (result.entitiesByLayer[curLayer] ?? 0) + 1;
    }
  };
  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    const v = value.trim();
    if (code === 0 && v === 'SECTION') {
      const nxt = pairs[i + 1];
      if (nxt && nxt.code === 2 && nxt.value.trim() === 'ENTITIES') { entSec = true; i++; curType = null; continue; }
    }
    if (code === 0 && v === 'ENDSEC') {
      if (entSec) { commit(); entSec = false; curType = null; }
      continue;
    }
    if (!entSec) continue;
    if (code === 0) {
      commit();
      curType = v;
      curLayer = '0';
    } else if (code === 8) {
      curLayer = v;
    }
  }

  if (!result.sections.has('EOF') && src.trim().endsWith('EOF')) result.sections.add('EOF');

  return result;
}
