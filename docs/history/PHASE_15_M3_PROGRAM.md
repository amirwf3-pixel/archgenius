# Phase 15 — M3: Professional Multi-Floor Program Distribution

Branch `arena/01a0c047-archgenius`. Builds on M1 (harness `a433ae4`) and M2 (honest gate `de97875`).

## What M3 solves

Before M3 every floor received the *entire* requested program (floors blindly duplicated
bedrooms/baths), the entry sequence (entrance→foyer→guest-wc) existed only as a side
effect of one horizontal-spur patch, and rooms the placer could not host were **silently
dropped** — producing plans that were validator-green but architecturally wrong
(phantom upper-floor entrances, orphan bedrooms, oversized rooms eating leftovers).

M3 fixes the distribution at the topological/program level:

## Implementation

1. **Building-level allocation** (`programming/program.ts` — `allocateBuildingProgram` +
   `programForFloor`). The whole-building program is resolved once per generation and
   distributed deterministically:
   - Ground floor of a multi-floor villa: public + service only (living, dining, kitchen,
     entry sequence, parking, stair) — **zero bedrooms**.
   - Private program (bedrooms, master suites, baths) distributed over the upper floors:
     total bedrooms balanced round-robin (occupied floors differ by ≤ 1, lower floors
     preferred, trailing floors stay circulation-only rather than holding a hole between
     occupied storeys); master suites placed one per occupied floor, each **paired with
     its master bath on that same floor**; shared baths round-robin over occupied floors;
     the family room exists **exactly once** building-wide.
   - Apartments keep the documented V1 full-unit-per-floor policy (explicitly intentional,
     not duplication).
   - `programForFloor` takes the allocation as a REQUIRED 4th parameter — the old
     optional-default path (which silently re-derived full program per floor) is gone;
     tsc surfaces any missed threading.

2. **Per-floor assignment threaded through the pipeline** (`generator.ts`): each floor is
   built from its assigned slice (`buildFloorSiteAware(..., alloc)`), the candidate carries
   `programRequirements` (per-floor program snapshot, identical across strategies —
   asserted in tests), and entrance-recovery fallbacks are gated by `floorHasEntranceSpec`
   so no floor can ever *fabricate* an entrance it was not assigned (phantom upper-floor
   doors eliminated at the source).

3. **Entry sequence is generative, not opportunistic** (`placer.ts`):
   - Public-band front **entry gallery**: when living+dining are placed, the remaining
     public program cells (entrance, foyer, guest-room, family-room, balcony) plus the
     guest-wc form a proportional one-dimensional row across the band front, sized from
     program minima/targets (never stretch-to-fill; never below a cell's contract minArea —
     the strip grows for the binding cell, or the layout falls back). Living/dining get the
     remaining field only if their minima survive (`neededBelow` guard).
   - **T-entry stack** for narrow bands (vertical-spine dayl layouts): entrance spans the
     band front at full width, entry cells stack on the corridor-side half, and the foyer
     runs along the other half from the entrance down to the living-field edge — the only
     rectangular topology satisfying the *perpendicular* entrance→foyer and foyer→living
     graph adjacencies simultaneously. Splits are cm-rounded with the side column absorbing
     slack so the band tiles exactly (no floating-point seams; precedent for the rounding
     exists in the living/dining stack branch). This is what turned previously "too narrow
     for the entry sequence" 12-wide urban sites into genuine wins instead of drops.
   - Guest-wc never stands alone as a gallery (isolated-wc junk rejected by design); it
     joins as a sibling cell or stacks under the foyer inside the l-spur front column.
   - Where the band truly cannot host the sequence, rooms are **not dropped**: they hit
     the completeness rule below and the plan is rejected — INFEASIBLE is now often a
     *narrower* verdict than "feasible with missing rooms", and M4 band-capacity work is
     what converts them back to wins.

4. **Program-completeness validation** (`validation/program-completeness.ts`, HARD):
   every assigned room type with `placed < required` (corridor/stair-hall/elevator-hall
   exempt) emits `ARCH_PROGRAM_UNPLACED`. It is merged into candidate findings and flows
   through the untouched M2 gate — zero validator weakening, no artificial PASS.

5. **Candidates are judged building-level** — the M2 gate already demotes per-candidate;
   M3's allocation makes the *program* itself building-level, and ranking already
   optimizes the whole candidate. No floor-by-floor isolation was introduced.

## Verification

- **Core suite 686/686** (35 files, incl. new `phase15_3.test.ts`: allocation invariants
  over a 144-point floors×bedrooms×masters×baths sweep, balance/monotonicity,
  master↔master-bath pairing, apartment V1, same-allocation-across-strategies, phantom
  entrance absence, ground-floor privacy zoning, stair-hall on every floor of usable
  winners, completeness-rule structural contract, decimal/asymmetric determinism).
  **Web suite 64/64**, `typecheck` + root `build` clean.
- **560-case harness**: feasible **180** (M2: 165; +22 gained, 7 lost, all 7 losses are
  cases whose M2 feasibility was a silent-drop false pass — e.g. missing guest-wc / foyer —
  now honestly INFEASIBLE pending M4 band capacity). **Hard-winners 0** (gate unchanged).
  Cohorts: single 125/350 (was 128 — flips to honesty), multi **55/210 (was 37, +18 —
  every 3-floor 5-bedroom extreme-duplication program at 14-wide+ sites now feasible)**,
  rect 178/448. DXF sample 126/126 valid+deterministic.
- Determinism: candidate ids and per-room areas byte-identical across runs.
- Representative outputs inspected: 15×20-2F (entry gallery realized: entrance 3.6 /
  foyer 4.3 / guest-wc 3.1 on F0, bedrooms 14.0–14.8 + master bath 9.8 on F1, stair core
  coherent both floors), 15.5×22 and 15.5×22.25-east (decimal + asymmetric, hard=0),
  20×30-2F (now feasible via alt; oversized living 101.9 flagged as M4 residual-balance
  territory), 18×25-2F (explicit INFEASIBLE: dayl center-dining MBH4-DYL, alt orphan
  bedroom — band topology, M4), 12×18 (honest NC — dayl stack leaves living 10.3 < 12
  min; capacity math, M4), 8×25 (INFEASIBLE — program > capacity, proven genuine).

## Deliberately NOT done (deferred, unchanged)

- M4: general band/carve capacity (fixed 2-rect carve, adaptive spine offset, gallery
  subsets for very narrow bands; residual-area balance like the 20×30 living 101.9).
- M5: circulation (stair-hall BFS loophole, openings). M6: narrow/asymmetric + envelope
  clamp. M7: multi-floor stair anchor refinement (M3 reuses the existing stair system as
  mandated). M8: full-560 acceptance targets + ROADMAP.md.
- No footprint hacks, no validator weakening, no DXF-writer change, no UI redesign.
- The obsolete M2-era expectation "12×18-2F entry suites feasible" was re-derived
  honestly (suite tests assert the dual-branch contract: real winner if present, else
  explicit INFEASIBLE with all diagnostic rooms positive/min-satisfying) — restoring
  feasibility there is M4's job, not a fixture excuse.
