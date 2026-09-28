/**
 * Task 187 — guards for the layout regression harness case set (see layout-cases.ts and
 * scripts/layout-regression.mjs). These checks pin the case set only; they do not compare
 * builds.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts } from '../generator/generator.js';
import {
  benchmarkInputs, sweepInputs, BENCHMARK_OPTIONS, BENCHMARK_STRATEGIES, BENCHMARK_ROW_COUNT,
  SWEEP_CASE_COUNT, HISTORICAL_SWEEP_CASE_COUNT, SWEEP_EXCLUDED_HISTORICAL_CASES,
} from './layout-cases.js';

describe('layout regression harness — case set', () => {
  it('benchmark: 32 inputs × 4 strategies = 128 rows, unique ids, Task 135 order', () => {
    const b = benchmarkInputs();
    expect(b).toHaveLength(32);
    expect(b.length * BENCHMARK_STRATEGIES.length).toBe(BENCHMARK_ROW_COUNT);
    expect(new Set(b.map(x => x.id)).size).toBe(32);
    expect(b[0].id).toBe('rect/b1/42');
    expect(b[31].id).toBe('lshape/b4/7');
    expect(Object.values(BENCHMARK_OPTIONS).filter(v => v === true)).toHaveLength(20);
  });

  it('benchmark copy reproduces the Task 135 pinned baseline (128 rows, 110 valid / 74 HARD)', () => {
    let rows = 0, valid = 0, hard = 0;
    for (const { input } of benchmarkInputs()) {
      for (const c of generateLayouts(input, [...BENCHMARK_STRATEGIES], { ...BENCHMARK_OPTIONS })) {
        rows++;
        if (c.valid) valid++;
        hard += c.findings.filter(f => f.severity === 'hard').length;
      }
    }
    expect({ rows, valid, hard }).toEqual({ rows: 128, valid: 110, hard: 74 });
  }, 120_000);

  it('sweep: exactly the 560-case stress matrix; the 4 historical extras are excluded, not invented', () => {
    const s = sweepInputs();
    expect(s).toHaveLength(SWEEP_CASE_COUNT);
    expect(SWEEP_CASE_COUNT).toBe(560);
    expect(HISTORICAL_SWEEP_CASE_COUNT).toBe(564);
    expect(SWEEP_EXCLUDED_HISTORICAL_CASES).toBe(4);
    expect(new Set(s.map(x => x.id)).size).toBe(560);
    expect(s.map(x => x.id)).toContain('R20x15--U0-2f3bd');
    expect(JSON.stringify(sweepInputs())).toBe(JSON.stringify(s));
  });
});
