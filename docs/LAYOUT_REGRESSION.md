# Layout regression harness

`packages/core/scripts/layout-regression.mjs` compares a **baseline** build with a
**candidate** build of `@archgenius/core`. Both builds get the same inputs, seeds and
options. The harness is a test tool only: it does not change generator, validator,
regulation, ranking or DXF behaviour.

## Case set

The inputs are defined in `packages/core/src/regression/layout-cases.ts` and guarded by
`layout-cases.test.ts`.

| Suite | Size | Source | How it is run |
|---|---|---|---|
| Benchmark | 128 rows (32 inputs × 4 strategies) | A verbatim copy of the Task 135 benchmark in `src/generator/stair-connector-hard-reduction.test.ts`: sites `rect`, `rectE`, `rect14`, `lshape`; programmes `b1`, `b2`, `b3lift`, `b4`; seeds 42 and 7 | Rows: `generateLayouts(input, STRATS, CURRENT)`. Best candidate: `generate(createProject(input), { ...CURRENT, allStrategies: true })` |
| Sweep | 560 cases (2240 strategy rows) | The Phase 15 stress matrix, `buildStressCases()` in `src/stress/matrix.ts` (70 sites × 8 programmes, seed 42) | Rows: `generateLayouts(input, STRATS, { upperFloorFrontPrivate: true })`, which are the options `generate()` passes by default. Best candidate: `generate(createProject(input), { allStrategies: true })` |

`layout-cases.test.ts` checks that the benchmark copy still reproduces the pinned Task 135
baseline: 128 rows, 110 valid, 74 HARD.

### Historical sweep size: 564, of which 560 are reproducible

Earlier ad-hoc sweeps reported **564** cases. Those scripts were untracked `/tmp` files and
have been lost. Only the **560** stress-matrix cases can be reproduced from the repository.
The other **4 cases are intentionally excluded**: they are not defined anywhere in the repo,
so they are neither reconstructed nor replaced with invented cases.

## What is compared

For every strategy row, the harness records:
- validity;
- HARD count and HARD finding-code counts;
- a snapshot hash of the whole candidate, with `metadata.generatedAt` zeroed;
- a geometry hash of the floors;
- parking stalls, placed and requested;
- stair footprints and stair-hall rectangles per floor;
- core alignment, meaning the stair and stair hall are identical on every floor that has a stair.

For every case's best candidate, it additionally records:
- FEASIBLE or INFEASIBLE status;
- strategy and geometry identity;
- an R12 DXF check (`$ACADVER` = `AC1009` and `validateDXFStructure`) and a DXF hash.

Each build is evaluated twice. Any difference between the two runs counts as a
determinism failure.

**Flagged as regressions (exit code 1):**
- valid → invalid;
- a HARD count increase, or a single HARD code's count increasing;
- a new HARD code;
- fewer parking stalls;
- a lost stair, fewer floors with a stair, or lost core alignment;
- a missing row or case;
- a best candidate going FEASIBLE → INFEASIBLE;
- a best candidate with more HARD findings, fewer stalls, a lost stair or lost core alignment;
- a best-candidate DXF that is not R12 or fails the structure check;
- non-determinism.

**Reported but not flagged:**
- changed rows;
- best-candidate identity or geometry changes;
- improvements.

## Usage

```sh
npm ci && npm run build
node packages/core/scripts/layout-regression.mjs --baseline <ref> --candidate <ref> \
  [--suite bench|sweep|all] [--out report.json]
# or: npm run regress:layout -w @archgenius/core -- --baseline <ref> --candidate <ref>
```

- Refs are git commits. Each one is built with `git archive` and `tsc` into
  `$TMPDIR/archgenius-layout-regression/<sha>`, and reused if already built.
- `--baseline-dist` / `--candidate-dist <dir>` point at an existing `packages/core/dist`
  instead of a ref.
- Inputs are always taken from the working-tree build.
- The full JSON report goes to `outputs/layout-regression-<base>-<cand>.json`
  (`outputs/` is gitignored).
- A full run takes about 4–5 minutes.

## Recorded result: `3f016e5` → `b80ab9e` (Task 187)

| | Baseline `3f016e5` | Candidate `b80ab9e` |
|---|---|---|
| Benchmark rows valid / HARD | 110 / 74 | 110 / 74 (0 rows changed) |
| Benchmark best feasible | 32 / 32 | 32 / 32 (32 best DXFs byte-identical) |
| Sweep rows valid / HARD | 359 / 35224 | 365 / 34985 |
| Sweep feasible / infeasible | 175 / 385 | 177 / 383 |
| Sweep row stalls / best stalls | 959 / 114 | 959 / 116 |
| Best DXF R12 AC1009 | 175 / 175 | 177 / 177 (175 byte-identical) |
| Determinism | OK | OK |

Only 6 sweep rows changed: `L3--U0-2f3bd` and `L3--U2-3f5bd`, strategies
`area-efficiency`, `functional-circulation` and `alternative-zoning`. Each went from invalid
to valid with 0 HARD, and both cases went from INFEASIBLE to FEASIBLE. No regressions.
