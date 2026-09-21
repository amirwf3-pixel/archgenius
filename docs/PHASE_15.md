# Phase 15 — Professional Residential Generation: Architecture & Release Record (M1–M8)

Status: **released after full M8 integration audit**. This document is the
authoritative map of what Phase 15 built, how it is gated, what has been
verified, and — equally important — what is *not* claimed. The stair/vertical
engine gets its own deep-dive in [`STAIR_ENGINE.md`](./STAIR_ENGINE.md); this
file covers the surrounding system and the final release audit.

---

## 1. Problem statement

Given a site (rectangular, L-shaped, or an arbitrary orthogonal polygon), a
building program (floors 1–3, bedroom/bathroom counts, kitchen type, parking),
an access side, and a deterministic seed, produce ranked residential layout
candidates whose **published** results are geometrically valid, circulate
correctly across floors, carry honest regulation-derived metadata, export to
AutoCAD-R12-compatible DXF, and are byte-reproducible. When the program
genuinely cannot be served by the site, the engine must say so — with
deterministic, evidence-backed infeasibility — rather than ship a broken plan.

The hard design rule of the whole phase: **never fake feasibility**. Every
repair path either produces a genuinely valid result or reports the failure.

## 2. Milestone map

| Milestone | Scope (delivered) |
|---|---|
| M1 | 560-case stress matrix (70 sites × 8 programs), harness in `src/stress/`, honest baseline, `run-stress` tooling. |
| M2 | Feasibility gate: candidate hard-finding audit, zero hard-invalid winners policy, capacity accounting, NC evidence capture. |
| M3 | Program allocation: `programming/program.ts` (`allocateBuildingProgram`, `programForFloor`) distributing public/private/wet program across floors with master-suite integrity; zero silently-dropped required rooms. |
| M4 | Topology solver: zone-ordered slicing over irregular regions, canonical snap grid for wall continuity, corridor spine construction, hall–corridor linking, orientation search primitives reused later by M7. |
| M5 | Circulation engine rewrite: `generator/openings.ts` intentional topology — street entry → foyer/hall → spine → rooms; one primary door per room (no room-through-room except en-suite, no redundant doors); `validation/circulation.ts` quality codes (`CIRC_ROOM_THROUGH_ROOM`, `CIRC_INVALID_ENTRY`, `CIRC_REDUNDANT_DOOR`, `CIRC_EXCESSIVE_PATH`, `CIRC_VERTICAL_DISCONNECTED`); component-bridging repair pass for circulation nodes; window/daylight attachment ranking. |
| M6 | Irregular-site decomposition: buildable-polygon tiling, L-shape/polygon region handling, hall-rescue repair (`generator.ts`), site-aware validator codes (`SITE_ROOM_OUTSIDE_BUILDABLE`, `SITE_WALL_OUTSIDE_BUILDABLE`, `SITE_FURNITURE_OUTSIDE_BUILDABLE`), polygon-aware proportional fallback diagnostics. |
| M7 | Professional vertical circulation: orientation-aware core search, building-level core anchor coherence, honest stair failure codes (`STAIR_INVALID_U_GEOMETRY`, `STAIR_INVALID_L_GEOMETRY`, `STAIR_LANDING_DISCONNECTED`, `STAIR_INVALID_ENTRANCE`, `STAIR_DOOR_COLLISION`, `STAIR_MISSING`), fake single-flight fallback deleted, L-stairs made selectable via the (u,v) travel-axis map, per-floor DXF stair labels. See `STAIR_ENGINE.md` §16–18. |
| M8 | Final integration & release QA: full 560-case audit (Parts A–E below), one proven validator defect fixed with regression tests, `docs/PHASE_15.md` (this file), `STAIR_ENGINE.md` §19. No new features. |

## 3. Pipeline architecture (current)

```
ProjectInput ─► createProject ─► pipeline.generate
                    │
                    ├─ site/            buildable polygon, frontage, access side
                    ├─ programming/     building → per-floor allocations (M3)
                    ├─ generator/       candidate construction (per strategy):
                    │    ├─ generator.ts      orchestration, hall rescue/anchor, repairs
                    │    ├─ vertical-core.ts  core orientation search + CoreAnchor (M7)
                    │    ├─ stair-solver.ts   types, flight splitting, landings
                    │    ├─ openings.ts       intentional circulation topology (M5)
                    │    ├─ furniture.ts        post-final-space furniture pass
                    │    └─ walls.ts            shared-edge wall model, snap grid
                    ├─ validation/      findings (hard findings veto publication)
                    │    ├─ capacity.ts         demand vs buildable (M1/M2)
                    │    ├─ circulation.ts      graph + quality checks (M5/M8)
                    │    ├─ stair.ts            vertical validity (M7)
                    │    ├─ geometry/ site/     containment & tiling honesty (M6)
                    │    └─ MBH4 packs           regulation-derived dimension floors
                    ├─ ranking          compareCandidates (hardCount-tiered)
                    └─ dxf/             writer.ts (R12), verify.ts (parser)
```

Infeasible candidates are never published; the `infeasible` report keeps the
best *diagnostic* rendering (proportional fallback) plus per-attempt hard-finding
evidence, so every NC case carries a machine-readable reason.

## 4. Gating philosophy

1. **Hard findings veto.** A candidate with any `hard` finding cannot become
   the winner. Stress harness enforces 0 hard-invalid winners across all 560.
2. **Determinism everywhere.** Fixed seed ⇒ identical candidate ordering, ids,
   geometry, findings and DXF bytes. `deterministic: true` removes all
   nondeterministic sources (no `Date.now`, no unseeded `Math.random`).
3. **Honest failure over rescue.** Fakes are banned at three sites: fake
   single-flight stairs (deleted in M7), silently dropped program rooms
   (accounted per-floor since M3), and geometric repairs that snap footprints
   together (M7 anchor relocation is bounded and reports when it fails).
4. **Regulation claims are floor-only, never compliance guarantees.** MBH4-derived
   minimums are cited where the pack supplies them and flagged unverified
   otherwise (see §7).

## 5. M8 release audit — method and results

Harness: full-run classification + per-winner structural audit over all 560
matrix cases (seed 42), executed twice (pre-fix and post-fix); DXF audits via
`validateDXFStructure` + `parseDxf` + raw entity scan; determinism via full
re-runs plus a 3-seed × repeat-equality probe on 18×25-2F, 15.5×22-2F,
12×18-2F.

### A. 560-case outcome ledger (post-fix)

| Metric | Value |
|---|---|
| Cases | 560 (350 single-floor, 210 multi-floor) |
| Feasible winners | **207** (single 150, multi 57; rect 187, L 15, polygon 5) |
| Hard-invalid winners | **0** |
| Harness exceptions | **0** |
| Infeasible, all evidence-backed | 353 |
| NC bucket: genuine capacity (demand > buildable, floor-coverage ratio ≥ 1) | 77 (proven subset) |
| NC bucket: circulation/topology limitation | 196 |
| NC bucket: vertical-circulation limitation | 133 |
| NC bucket: program-fit topology (min-area/room-rule only) | 20 |
| NC bucket: geometric defect | **0 in published winners**; 4 cases where the *diagnostic* fallback rendering spills outside the polygon and the validator flags it (correct behavior) |
| validator defect / implementation bug | **0 outstanding** (1 validator defect found & fixed — §6) |

Every NC case has an explicit deterministic reason: per-strategy hard-finding
code sets captured in `outputs/stress-report.json` (`ncAudit[]` with
`worstFloorRatio` + reason string) plus the 7-bucket classification in
`outputs/m8-audit.json`. Zero unexplained failures.

### B. Geometry/circulation audit — all 207 winners, every floor

Rooms+corridors contained in buildable polygon (interior-tested corners with
production `rectInsidePolygon`): **0 violations**. Space pairwise overlaps
(rooms, corridors; hall-vs-room containment handled separately): **0**.
Zero-area: **0**. Sub-0.5 m sliver rooms: **0**. Wall self/cross overlap
(collinear different-pair duplicate walls, corner miters and butt-joint stubs
excluded as by-design): **0**. Openings: every door references a real wall,
fits the segment, spans two spaces (street entrances legitimately span one):
**0 invalid**. Furniture inside owner and off corridors/stairs: **0 violations**.
Program completeness — every `assignedProgram` type present at count: **0
unaccounted rooms**. Door-graph reachability mirroring validator semantics
(upper floors seeded from vertical halls): **0 unreachable**. Room-through-room
and dead-end hards: **0** (by construction: winners carry zero hard findings).

### C. Vertical-circulation audit — 135 multi-floor winners, 135 stair floors

Flights over the 12-riser cap: **0**. Missing landings between flights: **0**.
Landing/flight overlap: **0**. Core misaligned across floors: **0**. Stair
footprint outside its hall: **0**. Stair validator hard findings on winners:
**0**. Explicit falsification probe: `totalRisers ≥ 18 && flights.length === 1`
(a single 18-riser flight — the banned pre-M7 fake): **0 occurrences**; every
≥18-riser floor is split (observed families: 18→9+9, 19→10+9, 24→12+12,
25→9+8+8).

### D. DXF audit — all 207 winners + 126-case sampled cohort

`validateDXFStructure`: **0 invalid**. NaN/Infinity scan (raw values + full
text): **0**. Entities on undeclared layers: **0**. Exact-duplicate entity
ratio > 10%: **0** winners. Winners with stairs export an `A-STAIR*` layer
with per-flight tread lines, hatched landing, and the per-floor label
`NF · NR @ r×t · Fi→Fj <type> ent.<side>`; winners with furniture export the
furniture layer; rooms/windows/doors/labels present: **0 missing**. R12 ASCII
only, writer compatibility logic untouched in M8. Determinism: **126/126**
sample byte-identical across double runs (stress harness) and **207/207**
winners byte-identical in the audit re-run.

### E. Determinism

Same-seed re-runs: 207/207 identical candidate ordering, space ids+rects,
stair riser sequences and footprints, findings lists, DXF byte hashes.
Multi-seed probe (18×25-2F, 15.5×22-2F, 12×18-2F × seeds {1,42,7}, doubled):
18/18 repeat-equal; for these clean rectangular sites the winner is
seed-stable (same layout across seeds), confirming ranking is not seed-noise.

### F. Visual QA (rendered and inspected, not just validated)

Targets: 12×18, 15.5×22-2F, 18×25-2F, 18×25-3F, 8×25-2F, 10×30-2F, wide-L
3F, plus-shaped 20×16-2F, 14×20-2F, decimal 13.4×18.7-2F, and two irregular
polygon sites. Verdicts (M7 renders re-confirmed post-M8; only excluded case
is P7--U2, see §6): proportioned rooms with usable furniture envelopes;
foyer-anchored entry sequences; corridors serving rooms directly; stair cores
adjacent to circulation with landings at both floor levels and identical
footprints stacked floor-to-floor; window-bearing façades on habitable rooms;
parking/yard kept off habitable frontage; no slivers or mystery strips.
Narrow (8×25, 10×30) and irregular cases honestly report NC where the program
cannot be served — their plans were *not* passed.

## 6. Defect found and fixed during M8 (the only source change)

**Upper-floor circulation seeds hid isolated vertical halls.**
`validation/circulation.ts` seeded the reachability BFS from *every*
circulation space whenever a floor had no entrance/foyer. On upper floors that
fallback let a floor whose stair hall had **no door onto anything** still pass:
reachability was proven from the corridor side, while the person actually
arriving from the stair landing was sealed into the hall. The audit caught one
published winner of this class (`P7--U2-3f5bd`, third floor: hall and spine
corridor share only a 0.40 m butt edge — below the 0.9 m door span, so both
the M5 spine-link and the 2b bridge pass correctly declined to place a door);
the probe matrix caught the same class in `P7wideL-3F`.

Fix: on `level > 0`, when no entrance/foyer exists, the BFS seeds from the
stair/elevator halls (the real arrival point). A floor can no longer count
corridors as "reachable" that the stair cannot open into. Two regression tests
added (`validation/circulation.test.ts`, M8 describe). No other validator
semantics touched.

Consequence, stated plainly: feasible count moved 208 → **207**; two probe
cases moved from "FEAS" to honest NC with `CIRC_INACCESSIBLE_SPACE` evidence.
This is a correctness improvement, not a regression: those two plans were
broken before and are now refused. The generator's hall↔spine link geometry
itself (short-edge refusal) is left as a genuine limitation — forcing a 0.9 m
door into a 0.4 m edge is exactly the faking this phase forbids.

## 7. Regulation honesty (audited across all Phase 15 changes)

- The engine **never claims code compliance, municipality approval, or
  construction-readiness**. Docs and code comments speak in terms of
  MBH4-derived *minimum dimension packs* and *quality heuristics*.
- Dimension floors used (room minimum areas, door widths, corridor minimums,
  stair geometry) come from the checked-in MBH4 citation pack. Values without
  a verified source are marked unverified in code (`SOURCE: unverified`) and
  must not be advertised as regulation.
- **Headroom: `NOT_IMPLEMENTED` / advisory metadata only.** Stair model carries
  headroom-relevant numbers (riser, tread, floor height) for downstream human
  review; no validator treats headroom as passed or failed.
- Riser/tread ranges are ergonomic + pack-derived floors, not a claim any
  specific jurisdiction is satisfied.
- DXF is a representation for review; the output is **not** a permit set.

## 8. Known limitations (release-time, honest)

1. **Feasible ceiling 207/560 (37.0%)** — deliberate. Capacity-proven NCs (77),
   narrow-site circulation impossibilities, vertical-core placement
   infeasibility on small/irregular sites. Not chased; not a bug backlog.
2. Multi-floor upper floors with two or more parallel corridors can leave the
   stair hall touching only a butt edge (see §6) → refused; a full fix means
   co-designing spine width and core anchor, which is future work.
3. Elevators are programmatic halls (`elevator-hall` spaces + anchor
   coherence) — no shaft geometry, no cab, no door timing modeled.
4. Headroom (§7), ramp/stair-pressurization/acoustics/fire egress *counts*
   beyond MBH4 minimums: out of scope, not claimed.
5. Curved/non-orthogonal sites unsupported (all decomposition assumes
   axis-aligned rectangles and orthogonal polygons).
6. `L`-stair remains rare: it wins only when the hall shape genuinely forces a
   turn; straight and U cover the mainstream cases.
7. Diagnostics rendering (proportional fallback) can place rooms outside the
   buildable polygon — flagged hard, never published; treat the plan image as
   evidence of failure, not a design.
8. Parking is single-row rectangular packing; no driveway ramps or tandem logic.
9. DXF is R12-ASCII conservative by design (no LTYPE definitions beyond
   compatibility set, no paper-space layouts); downstream styling is expected.

## 9. Genuine NC families (why infeasible ≠ broken)

| Family | Count (of 353) | Deterministic signature |
|---|---|---|
| Capacity (demand > buildable) | 77 proven (⊂ families below) | `capacity.worstFloorRatio ≥ 1` from `capacityFor` accounting |
| Circulation/topology infeasible | 196 | `CIRC_*`, `CONSTRAINT_MUST_ADJACENT`, `CONSTRAINT_DIRECT_ACCESS` on every strategy |
| Vertical-circulation infeasible | 133 | `STAIR_MISSING` / `STAIR_*` geometry failures / `CIRC_VERTICAL_DISCONNECTED` on every strategy |
| Program-fit topology only | 20 | `ROOM_CONSTRAINT_MIN_AREA`, `MBH4-ROOM-001`, `ARCH_PROGRAM_UNPLACED` with capacity < 1 |
| Geometric defect (published plans) | 0 | — |

No NC case lacks an evidence trail; `outputs/stress-report.json` `ncAudit[]`
carries the per-case reason string and full code sets.

## 10. Release gates — final run (2026-09-22)

| Gate | Result |
|---|---|
| Core unit tests | **726/726** (37 files; includes +2 new M8 circulation tests) |
| Web tests | **64/64** |
| `tsc -b` core+web | clean |
| Production builds (`npm run build -ws`) | ok |
| 560-case stress | 207F / 0 hard-invalid / 0 harness errors |
| DXF sample (126) | valid 126/126, deterministic 126/126 |
| M8 winner audit (B/C/D/E) | 0 violations in every class |
| m7probe vertical matrix (16) | 8F / 0 issue / 8 honest NC / 0 errors |
| Visual QA | 10 targets rendered & inspected (§5F) |
| Determinism multi-seed | 18/18 repeat-equal, 3/3 sites seed-stable winners |
| Working tree | commit `Phase 15 M8: final integration and release hardening`, pushed, remote == HEAD |

Reproduction: `npm run build -w @archgenius/core && node packages/core/dist/stress/run-stress.js`
(560-case), `node outputs/m8-audit.mjs` (audit harness),
`node_modules/.bin/vitest run --root packages/core`.

*Phase 15 closes here. Verified claims: geometry validity, circulation
correctness, vertical integrity, DXF structure, determinism, and honest
infeasibility — all on the 560-case matrix. Unverified and disclaimed:
jurisdictional compliance, headroom, elevator hardware, construction
readiness.*
