/**
 * Project management panel tests — ROADMAP Phase 5 (list / save / load /
 * import / export).
 *
 * Covers the pure helpers (which carry the real logic) and the SSR rendering,
 * including graceful degradation when localStorage is unavailable. Same
 * renderToString pattern as ui.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { PROJECT_SCHEMA_VERSION } from '@archgenius/core';
import type { Project, ProjectInput } from '@archgenius/core';
import type { FormState } from './App';
import { App } from './App';
import {
  ProjectManager,
  formFromProject,
  formatSavedAt,
  parseImportedProject,
  projectToJson,
  storageAvailable,
} from './ProjectManager';
import { t } from './i18n';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
const BASE: FormState = {
  name: 'پروژهٔ پایه', siteShape: 'rectangle', siteWidth: 18, siteLength: 28,
  accessSide: 'south', streetWidth: 8, lNotchWidth: 5, lNotchLength: 6,
  lNotchCorner: 'north-east', polygonJson: '[]', setbackNorth: 2, setbackSouth: 3,
  setbackEast: 2, setbackWest: 2, jurisdiction: 'Tehran-Municipality-Default',
  city: 'Tehran', parkingLayout: 'auto', buildingType: 'villa', floors: 2,
  bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed',
  parkingSpaces: 2, hasStair: true, hasElevator: false, hasStorage: true, seed: 42,
};

const INPUT: ProjectInput = {
  name: 'ویلای ۱۸×۲۵', deterministic: true, seed: 7,
  site: {
    shape: 'rectangle', width: 18, length: 25, accessSide: 'north', streetWidth: 10,
    // the shape the engine actually reads at runtime (nested setbacks)
    setbacks: { north: 3, south: 1.5, east: 2.5, west: 2 },
    jurisdiction: 'ir-tehran', city: 'Tehran',
  } as unknown as ProjectInput['site'],
  building: {
    type: 'apartment', floors: 3, bedrooms: 4, masterBedrooms: 2, bathrooms: 3, wc: 2,
    kitchenType: 'open', parkingSpaces: 2, hasStair: true, hasElevator: true, hasStorage: false,
  },
};

const project = (id: string, updatedAt: number, input: ProjectInput = INPUT): Project => ({
  id, input, createdAt: updatedAt - 1000, updatedAt, schemaVersion: PROJECT_SCHEMA_VERSION,
});

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    _map: map,
  };
}

const g = globalThis as any;
const withStorage = (seed?: Record<string, string>) => { g.localStorage = fakeStorage(seed); };
const withoutStorage = () => { delete g.localStorage; };
const render = (el: React.ReactElement) => renderToString(el);

/** The save button's opening tag (attribute order is React's, so match the whole tag). */
const saveButton = (html: string) => html.match(/<button[^>]*data-pm-action="save"[^>]*>/)?.[0] ?? '';

afterEach(() => { delete g.localStorage; });

// ---------------------------------------------------------------------------
// parseImportedProject
// ---------------------------------------------------------------------------
describe('parseImportedProject — never half-applies a foreign or broken file', () => {
  it('accepts a well-formed exported project', () => {
    const p = project('imp-1', 1_000);
    const res = parseImportedProject(projectToJson(p));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.project).toEqual(p);
  });

  it('rejects malformed JSON', () => {
    const res = parseImportedProject('{ this is not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(t('pmImportInvalid'));
  });

  it.each([
    ['empty object', '{}'],
    ['array', '[]'],
    ['missing input', '{"id":"x"}'],
    ['missing site', '{"id":"x","input":{"building":{}}}'],
    ['missing building', '{"id":"x","input":{"site":{"width":1,"length":1}}}'],
    ['non-numeric site', '{"id":"x","input":{"site":{"width":"a","length":1},"building":{}}}'],
    ['empty id', '{"id":"","input":{"site":{"width":1,"length":1},"building":{}}}'],
    ['scalar', '"hello"'],
  ])('rejects %s', (_label, text) => {
    const res = parseImportedProject(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(t('pmImportInvalid'));
  });
});

// ---------------------------------------------------------------------------
// formFromProject
// ---------------------------------------------------------------------------
describe('formFromProject — maps a stored project back onto the form', () => {
  it('restores site, setbacks, building and seed from the nested-setbacks shape', () => {
    const f = formFromProject(project('p', 1), BASE);
    expect(f.name).toBe('ویلای ۱۸×۲۵');
    expect(f.siteWidth).toBe(18);
    expect(f.siteLength).toBe(25);
    expect(f.accessSide).toBe('north');
    expect(f.streetWidth).toBe(10);
    expect(f.setbackNorth).toBe(3);
    expect(f.setbackSouth).toBe(1.5);
    expect(f.setbackEast).toBe(2.5);
    expect(f.setbackWest).toBe(2);
    expect(f.city).toBe('Tehran');
    expect(f.jurisdiction).toBe('ir-tehran');
    expect(f.buildingType).toBe('apartment');
    expect(f.floors).toBe(3);
    expect(f.bedrooms).toBe(4);
    expect(f.masterBedrooms).toBe(2);
    expect(f.bathrooms).toBe(3);
    expect(f.wc).toBe(2);
    expect(f.kitchenType).toBe('open');
    expect(f.parkingSpaces).toBe(2);
    expect(f.hasStair).toBe(true);
    expect(f.hasElevator).toBe(true);
    expect(f.hasStorage).toBe(false);
    expect(f.seed).toBe(7);
  });

  it('also accepts the flat setbackNorth field shape', () => {
    const flat = project('p', 1, {
      ...INPUT,
      site: { shape: 'rectangle', width: 12, length: 20, accessSide: 'east', setbackNorth: 4, setbackWest: 1 } as unknown as ProjectInput['site'],
    });
    const f = formFromProject(flat, BASE);
    expect(f.setbackNorth).toBe(4);
    expect(f.setbackWest).toBe(1);
    expect(f.accessSide).toBe('east');
  });

  it('keeps the base value for anything the project does not carry', () => {
    const sparse = {
      id: 'sparse', createdAt: 1, updatedAt: 1, schemaVersion: PROJECT_SCHEMA_VERSION,
      input: { name: 'کم‌داده', site: { width: 10 }, building: { floors: 5 } },
    } as unknown as Project;
    const f = formFromProject(sparse, BASE);
    expect(f.name).toBe('کم‌داده');
    expect(f.siteWidth).toBe(10);
    expect(f.floors).toBe(5);
    // untouched fields fall back
    expect(f.siteLength).toBe(BASE.siteLength);
    expect(f.setbackSouth).toBe(BASE.setbackSouth);
    expect(f.kitchenType).toBe(BASE.kitchenType);
    expect(f.seed).toBe(BASE.seed);
    expect(f.lNotchCorner).toBe(BASE.lNotchCorner);
    expect(f.polygonJson).toBe(BASE.polygonJson);
  });

  it('survives a project with no input at all', () => {
    const empty = { id: 'e', createdAt: 1, updatedAt: 1, schemaVersion: PROJECT_SCHEMA_VERSION } as unknown as Project;
    expect(() => formFromProject(empty, BASE)).not.toThrow();
    expect(formFromProject(empty, BASE).siteWidth).toBe(BASE.siteWidth);
  });

  it('restores l-shape and polygon payloads when present', () => {
    const p = project('p', 1, {
      ...INPUT,
      site: {
        shape: 'l-shape', width: 20, length: 30, accessSide: 'south',
        lShape: { width: 20, length: 30, notchWidth: 6, notchLength: 7, notchCorner: 'south-west' },
        polygon: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
      } as unknown as ProjectInput['site'],
    });
    const f = formFromProject(p, BASE);
    expect(f.siteShape).toBe('l-shape');
    expect(f.lNotchWidth).toBe(6);
    expect(f.lNotchLength).toBe(7);
    expect(f.lNotchCorner).toBe('south-west');
    expect(JSON.parse(f.polygonJson)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
describe('formatSavedAt / storageAvailable', () => {
  it('renders a deterministic Persian-digit date', () => {
    expect(formatSavedAt(Date.parse('2026-09-24T00:00:00Z'))).toBe('۲۰۲۶-۰۹-۲۴');
    expect(formatSavedAt(undefined)).toBe('—');
    expect(formatSavedAt(Number.NaN)).toBe('—');
  });

  it('reports storage availability from the environment', () => {
    withoutStorage();
    expect(storageAvailable()).toBe(false);
    withStorage();
    expect(storageAvailable()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------
describe('ProjectManager — rendering', () => {
  it('shows the empty state when nothing is saved', () => {
    withStorage();
    const html = render(React.createElement(ProjectManager, { project: null, onLoaded: () => {} }));
    expect(html).toContain('data-project-manager="1"');
    expect(html).toContain(t('pmEmpty'));
    expect(html).toContain(t('pmNeedProject'));
  });

  it('lists every saved project with id, name and Persian digits', () => {
    withStorage({
      'archgenius:project:p-1': projectToJson(project('p-1', Date.parse('2026-09-24T00:00:00Z'))),
      'archgenius:project:p-2': projectToJson(project('p-2', Date.parse('2026-01-02T00:00:00Z'))),
    });
    const html = render(React.createElement(ProjectManager, { project: project('cur', 5), onLoaded: () => {} }));
    expect(html).toContain('data-pm-count="2"');
    expect(html).toContain('data-pm-project="p-1"');
    expect(html).toContain('data-pm-project="p-2"');
    expect(html).toContain('ویلای ۱۸×۲۵');
    expect(html).toContain('۲۰۲۶-۰۹-۲۴');
    // Persian digits for the site dimensions
    expect(html).toContain('۱۸');
    expect(html).toContain('۲۵');
    // the three per-row actions
    expect(html).toContain('data-pm-load="p-1"');
    expect(html).toContain('data-pm-export="p-1"');
    expect(html).toContain('data-pm-delete="p-1"');
  });

  it('disables save when there is no current project, enables it when there is', () => {
    withStorage();
    const off = render(React.createElement(ProjectManager, { project: null, onLoaded: () => {} }));
    expect(saveButton(off)).toContain('disabled');
    const on = render(React.createElement(ProjectManager, { project: project('cur', 1), onLoaded: () => {} }));
    expect(saveButton(on)).toBeTruthy();
    expect(saveButton(on)).not.toContain('disabled');
  });

  it('degrades gracefully with no localStorage: no crash, no list, save disabled', () => {
    withoutStorage();
    const html = render(React.createElement(ProjectManager, { project: project('cur', 1), onLoaded: () => {} }));
    expect(html).toContain(t('pmNoStorage'));
    expect(html).toContain(t('pmEmpty'));
    expect(saveButton(html)).toContain('disabled');
    expect(html).not.toContain('data-pm-project=');
  });

  it('exposes an import control wired to a JSON file input', () => {
    withStorage();
    const html = render(React.createElement(ProjectManager, { project: null, onLoaded: () => {} }));
    expect(html).toContain('data-pm-action="import"');
    expect(html).toContain('type="file"');
    expect(html).toContain('application/json');
  });
});

// ---------------------------------------------------------------------------
// mounted in the app
// ---------------------------------------------------------------------------
describe('ProjectManager is mounted in the app shell', () => {
  beforeEach(() => { withoutStorage(); });

  it('renders inside the App with its own section', () => {
    const html = render(React.createElement(App));
    expect(html).toContain('data-project-manager="1"');
    expect(html).toContain(t('pmTitle'));
    expect(html).toContain('id="projects"');
  });
});
