# Iranian Regulation Engine — Architecture & Rule Inventory

> Status: **DRAFT — REQUIRES SOURCE VERIFICATION**. Every rule in this pack is
> transcribed from publicly-available secondary sources (engineer-practitioner
> summaries, continuing-education material, forum Q&A) and must be verified
> against the official *Mabhas* publications of the Iranian National Building
> Code (INBC / مقررات ملی ساختمان) issued by the *Road, Housing & Urban
> Development Research Center (BHRC)* before being used for permitting.

---

## 1. Architecture

The engine is organised around **versioned `RegulationPack`s** (one per
publication) each containing an ordered list of `RegulationRule`s. The pipeline
selects which packs apply based on:

1. `project.site.country` (currently only `"IR"`).
2. `project.regulationJurisdiction` (e.g. `"ir-national"`, `"ir-tehran"`).
3. `project.regulationPacks[]` (user-selected override list).

Each rule carries structured metadata:

| Field | Purpose |
|---|---|
| `ruleId` | Stable code (e.g. `MBH4-ROOM-001`). |
| `jurisdiction` | `ir-national` or `ir-tehran`, etc. |
| `scope` | `national` \| `local`. |
| `title`, `category` | Human label + area (setback/stair/room/…). |
| `reference` | Article/clause citation (e.g. *Mabhas 4, §4-5-6-2-1*). |
| `edition` | Publication edition (e.g. `1399` / "2020 3rd rev."). |
| `effectiveDate` | ISO date. |
| `status` | `ACTIVE` \| `DRAFT` \| `REQUIRES_SOURCE_VERIFICATION` \| `DEPRECATED`. |
| `severity` | `hard` \| `soft` \| `advisory`. |
| `params` | Numeric parameters (minWidth, area, ratio, …) that drive the default evaluator. |
| `evaluate(ctx)` | Returns `RuleResult[]` with pass/fail + human message + numeric value. |

The evaluator receives a `RuleContext` that exposes the project, footprint,
and helper helpers (site dimensions, total bedroom count, etc.). Evaluators
produce findings that are merged into `candidate.findings` by `validateLayout`
— no double-reporting, severity preserved.

**Offline-first**: all packs are bundled as TypeScript modules under
`packages/core/src/regulations/packs/` and loaded at import time. A future
"update from official registry" feature can fetch signed JSON packs over the
network; the initial install works with no connectivity.

### Jurisdiction layering

1. **National packs** apply everywhere in Iran. They encode minimum dimensions,
   stair/elevator mandates, daylight/window requirements, and ceiling heights
   from *Mabhas 4* (General Building Requirements), *Mabhas 15* (Elevators),
   and *Mabhas 3/14* (fire/egress — limited subset for V1).
2. **Local packs** (Tehran, Karaj, Isfahan, …) layer on top: setbacks
   (عقب‌نشینی), ground-floor coverage (سطح اشغال), floor-area ratio (تراکم),
   parking ratios per unit, and light-well sizes. These V1 ships as
   **skeletons with stub rules marked `REQUIRES_SOURCE_VERIFICATION`**,
   because each detailed plan (طرح تفصیلی) varies by zone and needs an
   authenticated municipal publication.

### Finding routing

* `HARD` violations block feasible layouts only when the rule is `ACTIVE`
  *and* its clause is unambiguous (e.g. stair width < 1.10 m, bathroom
  smallest side < 1.10 m).
* `SOFT` indicates likely professional-review issues (e.g. bedroom < 9 m²
  when unit < 75 m²).
* `ADVISORY` reports unverified defaults and "consider …" notes.

Every output finding carries the `ruleId` and `reference` so a professional
can look up the clause.

---

## 2. Sources (secondary, all REQUIRE PRIMARY VERIFICATION)

| # | Source used | INBC Mabhas | Topics |
|---|---|---|---|
| S1 | `atnasr.ir` — *حداقل ابعاد اتاق خواب (بر اساس مبحث 4)* | Mabhas 4, §4-7-1 / §4-5-6 | Bedroom min area/width by unit size; ceiling heights |
| S2 | `atnasr.ir` — *ابعاد و اندازه‌های استاندارد آشپزخانه* | Mabhas 4, §4-5-5 | Closed / open / wall-kitchen min area and corridor |
| S3 | `hamyarnazer.com` — *ضوابط طراحی سرویس بهداشتی* | Mabhas 4, §4-5-6-2 | WC/bath smallest side, accessible WC, W.C. ceiling 2.10 m |
| S4 | `azaretesal.com` — *خلاصه مبحث چهارم* | Mabhas 4, §4-5-1 / §4-5-6 / §4-5-7 | Entry 1.4×1.4; habitable rooms min 6.5 m² / 2.15 m width; stair 1.10 m; riser ≤0.18 m, tread ≥0.28 m, 2h+b 0.63-0.64; max 12 risers per flight |
| S5 | `hamyarnazer.com` — *چکیده ضوابط راه پله* | Mabhas 4, §4-5-1-7 / §4-5-4-7 | Stair min width 1.10 m; landing ≥ stair width; riser ≤18 cm, tread ≥28 cm |
| S6 | `refahelevator.com`, `memaripedia.com` — *مبحث ۱۵* | Mabhas 15, §15-2-2 / §15-1-9 / §15-1-10 | Elevator mandatory when vertical travel > 7 m (typically ≥ 4 storeys); wheelchair-accessible cab 1.4×1.1 m, door 0.8 m; min cab 1.1×1.4 m for small residential |
| S7 | `mohandesan.org`, `madista.blogfa.com`, `banatarh.com` | Mabhas 4, §4-10-3 / §4-8-3 | Light-well (hayat-khalvat/patio) min 12 m² @ 3 m width for main rooms, 6 m² @ 2 m for kitchens, ≥6% site area for parcels ≤ 200 m²; glazing ≥ 1/7 of floor area for habitable rooms |
| S8 | `2nabsh.com`, `civilejra.ir` | Praxis / municipality guidance | Parking bay min 2.5×5.0 m; 1 parking per residential unit typical; clear parking height ≥ 2.20 m |

All eight sources are practitioner-run websites and are **not official BHRC
publications**; every rule derived from them is therefore emitted with
`status: REQUIRES_SOURCE_VERIFICATION` until a primary-source PDF of the
relevant *Mabhas* edition is loaded into the pack registry.

---

## 3. Rule inventory for Phase 2 (national pack only)

`ir-national-mbr-v1` — Iranian National Building Regs (Mabhas) bundle.
All rules `status: REQUIRES_SOURCE_VERIFICATION` until primary sources loaded.

### 3.1 Room dimensions (Mabhas 4, spaces)

| RuleId | Category | Check | Severity | Source |
|---|---|---|---|---|
| `MBH4-ROOM-001` | room | At least one "main habitable room" ≥ 12 m², min width ≥ 2.70 m when unit ≥ 75 m² (≥ 9 m² / ≥ 2.50 m when unit < 75 m²) | hard | S1, S4, S10 |
| `MBH4-ROOM-002` | room | Other habitable rooms min area 6.5 m², min width 2.40 m | hard | S4, S10 |
| `MBH4-ROOM-003` | room | Bedroom min ceiling: ≥50 % area ≥ 2.60 m, remainder ≥ 2.40 m; living ≥75 % area ≥ 2.60 m | hard | S1 (note: 2.60 m for ≥12 m² rooms) |
| `MBH4-ROOM-004` | room | Kitchen closed: min area 5.5 m², min width 1.80 m, work zone ≥ 2.75 m² with ≥ 0.90 m clear in front of cabinets | hard | S2 |
| `MBH4-ROOM-005` | room | Kitchen w/ dining: min 7.5 m², min width 2.10 m | soft | S2 |
| `MBH4-ROOM-006` | room | Wall kitchen (single-wall): min counter length ≥ 3.0 m, work zone ≥ 1.10 m² | soft | S2 |
| `MBH4-ROOM-007` | room | Bathroom / WC: smallest finished side ≥ 1.10 m, ceiling ≥ 2.10 m | hard | S3 |
| `MBH4-ROOM-008` | room | Accessible bathroom (when required): 1.50 × 1.70 m | advisory | S3 |
| `MBH4-ROOM-009` | room | Main entrance vestibule/landing ≥ 1.40 × 1.40 m | hard | S4 |
| `MBH4-ROOM-010` | room | Corridor clear width ≥ 1.20 m | soft | S4 (commonly enforced; V1 uses 1.5 m so we only soft-warn) |

### 3.2 Stairs (Mabhas 4)

| RuleId | Category | Check | Severity | Source |
|---|---|---|---|---|
| `MBH4-STAIR-001` | stair | Stair clear width ≥ 1.10 m (general use) | hard | S4, S5 |
| `MBH4-STAIR-002` | stair | Riser height ≤ 0.18 m; tread depth ≥ 0.28 m; 2r+t formula 0.63–0.64 | hard | S4, S5 |
| `MBH4-STAIR-003` | stair | Max 12 risers per flight before a landing | hard | S5 |
| `MBH4-STAIR-004` | stair | Landing min width ≥ stair width; mid-landing in front of apartment door ≥ 1.20 m | hard | S5, S8 |
| `MBH4-STAIR-005` | stair | Stairwell headroom ≥ 2.05 m above nosing | soft | S5 |

### 3.3 Elevator (Mabhas 15)

| RuleId | Category | Check | Severity | Source |
|---|---|---|---|---|
| `MBH15-LIFT-001` | access | At least one elevator required when vertical travel from main entrance > 7 m (≈ ≥ 4 occupied levels above entrance) | hard | S6 |
| `MBH15-LIFT-002` | access | Where elevator is required, at least one wheelchair-accessible cab: ≥ 1.40 × 1.10 m clear, door ≥ 0.80 m, relevelling system | hard | S6, S4 |
| `MBH15-LIFT-003` | access | Where travel > 21 m: at least one stretcher-accessible (barankard-bar) cab ≥ 2.10 × 1.10 m, door ≥ 0.90 m | soft | S6 |
| `MBH15-LIFT-004` | access | Where > 4 units per floor: ≥ 2 elevators (even if one suffices for capacity) | soft | S8 |

### 3.4 Parking (praxis / typical municipality bylaw)

| RuleId | Category | Check | Severity | Source |
|---|---|---|---|---|
| `MUN-PARK-001` | parking | One parking bay per residential unit | soft | S8 |
| `MUN-PARK-002` | parking | Bay clear dimensions ≥ 2.50 × 5.00 m (perpendicular); accessible bay ≥ 3.50 m wide | soft | S8 |
| `MUN-PARK-003` | parking | Aisle width ≥ 5.50 m for perpendicular 90° parking, ≥ 3.00 m for parallel | advisory | S8 (varies by municipality) |
| `MUN-PARK-004` | parking | Parking clear height ≥ 2.20 m | soft | S8 |

### 3.5 Daylight / light wells (Mabhas 4)

| RuleId | Category | Check | Severity | Source |
|---|---|---|---|---|
| `MBH4-DYL-001` | daylight | Living, dining, bedrooms must have direct natural light via exterior window or qualifying light well (bathrooms/storage/corridor exempt) | hard | S2, S7 |
| `MBH4-DYL-002` | daylight | Glazing area (openable + fixed) ≥ 1/7 of floor area for habitable rooms | soft | S7, S4 (4-10-1-5-4: "یک‌هفتم سطح کف") |
| `MBH4-DYL-003` | daylight | Light well for main rooms: min area 12 m², min side ≥ 3 m (parcels > 200 m²) or 6 % of site area (parcels ≤ 200 m², min side 2 m) | advisory | S7 |
| `MBH4-DYL-004` | daylight | Light well for kitchen: min 6 m², min side 2 m or 3 % of site area for parcels ≤ 200 m² | advisory | S7 |

### 3.6 Setbacks / coverage (placeholder only)

National Mabhas does not prescribe setbacks; they are the municipality's
domain via the detailed plan (طرح تفصیلی). We emit one advisory rule:

| RuleId | Category | Check | Severity | Source |
|---|---|---|---|---|
| `MUN-SET-001` | setback | "Setbacks and ground-coverage ratios are governed by the local detailed plan; verify with the issuing municipality." | advisory | — |

---

## 4. What this PR does NOT implement (yet)

- Fire-resistance ratings, compartmentation, egress travel distances (Mabhas 3).
- Structural/loading (Mabhas 6–10).
- Mechanical/electrical/plumbing (Mabhas 14, 16, 17).
- Energy (Mabhas 19).
- Accessibility (Mabhas 21 — partial: only accessible WC + elevator cab).
- Seismic (Mabhas 28 — outside V1 architecture scope).
- Any municipal pack beyond the placeholder setback/coverage/parking
  skeleton (Tehran detailed-plan zones are too specific to guess).

These are listed in-code as `NOT_IMPLEMENTED` future pack files.

---

## 5. Tests

For every implemented rule we will add a Vitest case that:

1. Constructs a `ProjectInput` that violates exactly that rule.
2. Runs `generateLayouts` + `validateLayout`.
3. Asserts the expected `Finding{code, severity}` appears.
4. Constructs a compliant variant and asserts the finding does NOT appear.

Test file: `packages/core/src/regulations/packs/ir-national-mbr.test.ts`.

