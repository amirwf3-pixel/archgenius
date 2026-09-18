/**
 * Simple local-storage based project persistence (browser) and JSON
 * serialization for Node / file-based use. Projects are plain data so
 * JSON.serialize / JSON.parse work directly.
 */
import type { Project } from '../model/project.js';

const STORAGE_PREFIX = 'archgenius:project:';

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  return JSON.parse(json) as Project;
}

/** Save a project to browser localStorage (if available). */
export function saveProject(project: Project): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_PREFIX + project.id, serializeProject(project));
}

export function loadProject(id: string): Project | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_PREFIX + id);
  if (!raw) return null;
  try { return deserializeProject(raw); } catch { return null; }
}

export function listProjects(): Project[] {
  if (typeof localStorage === 'undefined') return [];
  const out: Project[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX)) {
      const raw = localStorage.getItem(k);
      if (raw) {
        try { out.push(deserializeProject(raw)); } catch { /* ignore */ }
      }
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_PREFIX + id);
}
