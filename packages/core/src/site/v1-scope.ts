/**
 * V1 production planning scope — Rectangle site geometry ONLY.
 *
 * ArchGenius V1 plans rectangle sites only. L-shape and orthogonal-polygon planning
 * (`generator/l-shape.ts`, the multi-rect buildable path) is kept in the codebase but
 * DORMANT: the production entry points (`createProject`, `generate`) reject any
 * non-rectangular site deterministically instead of planning it, and a non-rectangular
 * site is NEVER converted into a rectangle.
 *
 * The dormant geometry stays reachable only through the explicit internal opt-in
 * `allowDormantSiteGeometry: true` (regression tests, golden fixtures) and through the
 * engine-level `generateLayouts()`, which this scope gate does not touch.
 */
import type { ProjectInput } from '../model/project.js';
import type { SiteShape } from '../model/site.js';

/** Site geometry types supported by V1 production planning. */
export const V1_SUPPORTED_SITE_SHAPES: readonly SiteShape[] = ['rectangle'];

/** Error code carried by every V1 scope rejection. */
export const UNSUPPORTED_SITE_GEOMETRY = 'UNSUPPORTED_SITE_GEOMETRY';

/** Thrown by the production entry points for a site outside the V1 planning scope. */
export class UnsupportedSiteGeometryError extends Error {
  readonly code = UNSUPPORTED_SITE_GEOMETRY;
  constructor(readonly shape: string, reason: string) {
    super(`${UNSUPPORTED_SITE_GEOMETRY}: ${reason}`);
    this.name = 'UnsupportedSiteGeometryError';
  }
}

/**
 * Deterministic V1 scope check. Returns null for a supported rectangle site, otherwise
 * the rejection reason. A missing `shape` keeps the existing `validateInput` meaning
 * (rectangle). A rectangle that also carries an `lShape` / `polygon` payload is rejected
 * as ambiguous rather than silently planned as a plain rectangle.
 */
export function v1SiteScopeViolation(site: ProjectInput['site'] | undefined | null): string | null {
  if (!site) return null; // missing site is reported by validateInput
  const shape = String((site as { shape?: unknown }).shape ?? 'rectangle');
  if (!(V1_SUPPORTED_SITE_SHAPES as readonly string[]).includes(shape)) {
    return `site.shape "${shape}" is not supported in ArchGenius V1 — V1 plans rectangle sites only; non-rectangular sites are rejected, never converted to a rectangle.`;
  }
  const extra = (['lShape', 'polygon'] as const).filter(k => (site as unknown as Record<string, unknown>)[k] != null);
  if (extra.length > 0) {
    return `site.shape "rectangle" carries non-rectangular geometry (${extra.join(', ')}) — ArchGenius V1 plans rectangle sites only and does not reinterpret that geometry as a rectangle.`;
  }
  return null;
}

/** True when the site is inside the V1 planning scope (a plain rectangle). */
export function isV1SupportedSite(site: ProjectInput['site'] | undefined | null): boolean {
  return v1SiteScopeViolation(site) === null;
}

/** Throws UnsupportedSiteGeometryError when the input is outside the V1 planning scope. */
export function assertV1SiteScope(input: ProjectInput): void {
  const reason = v1SiteScopeViolation(input?.site);
  if (reason !== null) {
    throw new UnsupportedSiteGeometryError(String((input.site as { shape?: unknown }).shape ?? 'rectangle'), reason);
  }
}
