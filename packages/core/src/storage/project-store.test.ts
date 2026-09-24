/**
 * Focused tests for the project store (ROADMAP Phase 5 — project management).
 *
 * The module itself predates this feature; it was previously unreachable from
 * the public API. These pin the contract the UI now depends on: round-trip
 * fidelity, list ordering, tolerance of corrupt/foreign entries, and safe
 * no-ops when localStorage is absent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deleteProject,
  deserializeProject,
  listProjects,
  loadProject,
  saveProject,
  serializeProject,
} from './project-store.js';
import { PROJECT_SCHEMA_VERSION } from '../model/project.js';
import type { Project, ProjectInput } from '../model/project.js';

/** Minimal in-memory stand-in for window.localStorage. */
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

const INPUT: ProjectInput = {
  name: 'ویلای نمونه',
  deterministic: true,
  seed: 42,
  site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 },
  building: { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true },
};

const project = (id: string, updatedAt: number): Project => ({
  id,
  input: { ...INPUT, name: id },
  createdAt: updatedAt - 1000,
  updatedAt,
  schemaVersion: PROJECT_SCHEMA_VERSION,
});

const g = globalThis as any;
let installed: any;

beforeEach(() => {
  installed = fakeStorage();
  g.localStorage = installed;
});

afterEach(() => {
  delete g.localStorage;
});

describe('project store — save / load round-trip', () => {
  it('stores and returns an identical project', () => {
    const p = project('p-1', 1_000);
    saveProject(p);
    expect(loadProject('p-1')).toEqual(p);
  });

  it('serializes to stable, re-parsable JSON', () => {
    const p = project('p-2', 2_000);
    const json = serializeProject(p);
    expect(json).toContain('"id": "p-2"');
    expect(deserializeProject(json)).toEqual(p);
    // idempotent — same input, same bytes
    expect(serializeProject(deserializeProject(json))).toBe(json);
  });

  it('keys entries by project id under the archgenius prefix', () => {
    saveProject(project('abc', 10));
    expect(installed._map.has('archgenius:project:abc')).toBe(true);
  });

  it('returns null for an unknown id', () => {
    expect(loadProject('missing')).toBeNull();
  });
});

describe('project store — listing', () => {
  it('lists saved projects newest-first', () => {
    saveProject(project('old', 100));
    saveProject(project('new', 300));
    saveProject(project('mid', 200));
    expect(listProjects().map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });

  it('ignores unrelated keys and entries that fail to parse', () => {
    installed.setItem('some-other-app:key', '{"id":"x"}');
    installed.setItem('archgenius:project:broken', '{not json');
    saveProject(project('good', 5));
    const list = listProjects();
    expect(list.map((p) => p.id)).toEqual(['good']);
  });

  it('is empty when nothing was saved', () => {
    expect(listProjects()).toEqual([]);
  });
});

describe('project store — delete and absent storage', () => {
  it('deletes a single project and leaves the others', () => {
    saveProject(project('keep', 1));
    saveProject(project('drop', 2));
    deleteProject('drop');
    expect(loadProject('drop')).toBeNull();
    expect(listProjects().map((p) => p.id)).toEqual(['keep']);
  });

  it('deleting an unknown id is a no-op', () => {
    saveProject(project('keep', 1));
    deleteProject('nope');
    expect(listProjects()).toHaveLength(1);
  });

  it('every entry point no-ops safely when localStorage is unavailable', () => {
    delete g.localStorage;
    expect(listProjects()).toEqual([]);
    expect(loadProject('anything')).toBeNull();
    expect(() => saveProject(project('p', 1))).not.toThrow();
    expect(() => deleteProject('p')).not.toThrow();
  });
});
