/**
 * Phase 8 - Candidate Optimization
 *
 * Uses existing deterministic strategies, improves evaluation/comparison, preserves diverse top with labels reflecting real behavior.
 */

import type { LayoutCandidate } from '../../model/layout.js';
import type { OptimizationResult } from '../types.js';
import { evaluateCandidates } from '../evaluation.js';
import { buildOptimizationResult } from '../comparison.js';

export { evaluateCandidates } from '../evaluation.js';
export { buildOptimizationResult, compareCandidates } from '../comparison.js';

export function optimizeCandidates(candidates: LayoutCandidate[]): OptimizationResult {
  // Hard-first filtering is inside evaluateCandidates sorting
  const evaluations = evaluateCandidates(candidates);
  return buildOptimizationResult(evaluations);
}

// Re-export evaluations for convenience
export * from '../types.js';
