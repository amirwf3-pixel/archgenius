/**
 * Phase 11 — Controlled Editing Types (CORE, not UI)
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

export type EditOperationKind = 'move' | 'resize' | 'lock' | 'unlock' | 'set-l-shape';

export interface MoveOperation {
  kind: 'move';
  floorLevel: number;
  spaceId: string;
  /** New origin or delta — we support absolute x,y */
  newX: number;
  newY: number;
}

export interface ResizeOperation {
  kind: 'resize';
  floorLevel: number;
  spaceId: string;
  newWidth: number;
  newHeight: number;
  /** Optional anchor corner: 'sw' (default) keeps SW fixed */
  anchor?: 'sw' | 'se' | 'nw' | 'ne' | 'center';
}

export interface LockOperation {
  kind: 'lock';
  floorLevel: number;
  spaceId: string;
  lockKind: 'position' | 'size' | 'geometry' | 'adjacency' | 'all';
}

export interface UnlockOperation {
  kind: 'unlock';
  floorLevel: number;
  spaceId: string;
  lockKind: 'position' | 'size' | 'geometry' | 'adjacency' | 'all';
}

export interface SetLShapeOperation {
  kind: 'set-l-shape';
  floorLevel: number;
  spaceId: string;
  notchWidth: number;
  notchLength: number;
  notchCorner: 'ne' | 'nw' | 'se' | 'sw';
}

export type EditOperation = MoveOperation | ResizeOperation | LockOperation | UnlockOperation | SetLShapeOperation;

export interface EditResult {
  success: boolean;
  candidate: LayoutCandidate | null;
  findings: Finding[];
  error?: string;
  /** For deterministic failure reporting */
  attemptedOperation: EditOperation;
}
