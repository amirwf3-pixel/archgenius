# Regulation Source Audit — Iranian National Mabar Pack

**Last updated:** 2026-09-18 (Phase 2c — Primary Source Integration pass)
**Audit scope:** Every implemented rule in `packages/core/src/regulations/packs/ir-national-mbr.ts`
**Audit result:** **0 rules verified (Tier 1)** — no Tier-1 BHRC PDFs could be
obtained during Phase 2c because the sandboxed environment cannot reach
`*.ir` hosts (inbr.ir / bhrc.ac.ir / mrud.gov.ir / fc.icivil.ir / all
secondary-practitioner sites tested) due to TLS/egress filtering, and no
authorised CDN mirror was reachable over the npm/GitHub-only whitelist.
**11 active rules** remain `REQUIRES_SOURCE_VERIFICATION` (backed by Tier-3
verbatim-clause transcripts documented below). **7 rule slots are
`NOT_IMPLEMENTED`** placeholders (advisory only).

A machine-readable source registry now lives at
`packages/core/src/regulations/packs/source-registry.ts` with canonical Tier-1
entries (Mabhas 4 1399, Mabhas 4 1396, Mabhas 15 1392, Tehran Tarh Tafsili),
all currently flagged `verificationState: 'not-obtained'`. No source URL,
filename, hash, or clause text has been fabricated.

A helper CLI (`sources/register-source.js`) automates registering a PDF
when the user supplies one: it records the SHA-256 digest, sets
`verificationState: 'obtained-authenticated'`, and prints a reminder to
promote individual rules clause-by-clause.

Integrity tests in
`packages/core/src/regulations/packs/source-registry.test.ts` guard
against:
- any Tier-1 entry being marked `obtained-authenticated` without a
  document path and SHA-256 digest,
- any rule being marked `VERIFIED` without citing a Tier-1,
  obtained-authenticated source with an exact page number,
- silently fabricating "VERIFIED" status (currently 0 rules are
  VERIFIED; the test asserts this),
- local/parking/setback rules being promoted to HARD national findings.

---

## 1. Source Hierarchy & Evidence Standard

| Tier | Meaning | Used in this audit? |
|------|---------|---------------------|
| **1** | Official BHRC / Ministry of Roads & Urban Development PDF (inbr.ir) | ❌ No authenticated PDF placed in `sources/` at audit time |
| **2** | Officially-published reproductions of the authoritative edition (e.g. authorised printing houses) | ❌ None verified |
| **3** | Reputable secondary-practitioner sources (engineer blogs, exam-prep sites, engineering firms) that quote clause numbers **verbatim** | ✅ Used for discovery + clause-number verification; **cannot elevate a rule to VERIFIED** |

Per the task instructions, NO rule is marked `VERIFIED` in this audit.

### Sources consulted (Tier 3)

| ID | Title | Publisher / Host | URL | Clause range reproduced | Retrieved |
|----|-------|------------------|-----|-------------------------|-----------|
| S-RES | مبحث چهار (۱۳۹۶) فصل ۷-۱-۱ تصرف‌های مسکونی (گروه م-۲) | omranpooya.com (verbatim chapter transcript with numbered sub-clauses 7-1-1-1…7-1-1-26) | https://omranpooya.com/construction/procedure/general-requirements/gr-7 | §7-1-1-3, §7-1-1-4, §7-1-1-8, §7-1-1-9, §7-1-1-10, §7-1-1-11, §7-1-1-12, §7-1-1-13, §7-1-1-14, §7-1-1-15, §7-1-1-18, §7-1-1-19 | 2026-09-18 |
| S-STAIR | مبحث چهار (۱۳۹۶) بند ۴-۵-۱-۷ راه‌پله‌ها (sub-clauses 1..8) | manexgroup.net (verbatim sub-clause quotations), cross-checked with hamyarnazer.com and sabzsaze.com | https://manexgroup.net/implementation-building-stairs/ | §4-5-1-7-1 (tread/2r+t), §4-5-1-7-3 (width 1.10 m), §4-5-1-7-4 (landing width), §4-5-1-7-5 (max 12 risers), §4-5-1-7-6 (headroom 2.05 m) | 2026-09-18 |
| S-HAB | مبحث چهار (۱۳۹۶) بند ۴-۵-۲-۲ فضاهای اقامت (الزامات عمومی) | sandbadstudio.ir (verbatim quotation of §4-5-2-2-1 through §4-5-2-2-5) | https://sandbadstudio.ir/bedroom-lvr-height/ | §4-5-2-2-1 (6.50 m²), §4-5-2-2-2 (2.15 m), §4-5-2-2-3 (2.40 m height) | 2026-09-18 |
| S-LIFT | مبحث پانزدهم (۱۳۹۲) بند ۱۵-۲-۱ الزامات اولیه انتخاب آسانسور | memaripedia.com (verbatim numbered clauses 15-2-1-2, -4, -9, -10, -11), cross-checked with cadkhoda-academy.ir and sabzsaze.com | https://memaripedia.com/mini-mabhas-15/ | §15-2-1-2 (>7 m), §15-2-1-4 (>21 m stretcher), §15-2-1-9 (wheelchair cab 1.4×1.1), §15-2-1-10 (stretcher cab 2.1×1.1), §15-2-1-11 (bed cab 2.4×1.4) | 2026-09-18 |
| S-DAY | مبحث چهار (۱۳۹۶) فصل ۶ — الزامات نورگیری و تهویه + بند ۷-۱-۱-۱۴ | memaripedia.com (general description), atnasr.ir (light-well dimensions), danesh-cad.blogfa.com (glazing ratios quoted with clause context) | https://memaripedia.com/مبحث-چهارم-مقررات-ملی-ساختمان/ | ch. 6 / جدول ۱-۶-۴ (glazing ratios 1/8, 1/7, 1/6, 1/5 based on depth + height), light-well 12 m²×3 m / 6 m²×2 m / 6%/3% of parcel, 7 m daylight depth | 2026-09-18 |

None of the above is a Tier-1 BHRC publication; all numerical values therefore remain
`status = REQUIRES_SOURCE_VERIFICATION`.

---

## 2. Complete Audit Table

The columns below follow the format specified in the task brief.
"Validation method" is either `footprint-check` (runs before floor-plan
generation, needs only project input) or `candidate-check` (runs after walls/
doors/windows are placed, inspects placed geometry).

### 2.1 Implemented (active) rules

| ruleId | family | regulation (exact title) | edition | clause | jurisdiction | source | tier | requirement | value | unit | condition | validation | status |
|--------|--------|--------------------------|---------|--------|--------------|--------|------|-------------|-------|------|-----------|------------|--------|
| **MBH4-ROOM-001** | habitable-room | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §7-1-1-8 | ir-national | S-RES | 3 | At least one habitable room per unit meets the minimum size/width for that unit tier | area=12, width=2.7 **or** area=9, width=2.5 | m² / m | ≥75 m² unit → 12/2.7; <75 m² unit → 9/2.5 | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-ROOM-002** | habitable-room | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §4-5-2-2-1 / §4-5-2-2-2 | ir-national | S-HAB | 3 | Every habitable space must meet the universal floor-area and width minimums | area=6.5, width=2.15 | m² / m | All habitable rooms (living, dining, bedrooms, family-room, guest-room) | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-ROOM-004** | kitchen | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §7-1-1-10 (cook-only 5.5 m²) / §7-1-1-11 (cook+dine 7.5 m²) / §7-1-1-12 (width 1.80 m / 2.15 m) | ir-national | S-RES | 3 | Independent kitchen min area and width; wider threshold when cooking+dining | area≥5.5 (cook-only), area≥7.5 (cook+dine), width≥1.8 / ≥2.15 | m² / m | V1 applies cook-only thresholds conservatively; cook+dine dimensions noted in description | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-ROOM-007** | sanitary | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §7-1-1-18 (1.00×1.20 m) / §7-1-1-19 (height 2.20 m) | ir-national | S-RES | 3 | Independent (non-accessible) sanitary space minimum dimensions; 0.15 m length reduction for combined WC/bath without door between | width≥1.00, length≥1.20; height≥2.20 over 80% of area | m | All independent bathrooms, master baths, guest-WCs. Accessible (wheelchair) dimensions not yet modelled. | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-STAIR-001** | stair | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §4-5-1-7-3 / §7-1-1-3 (groups 1–3 M-2: 0.90 m straight) / §7-1-1-4 (groups 4–7 M-2: 1.10 m) / §4-7-1-1-6 (internal stair 0.90 m) | ir-national | S-STAIR + S-RES | 3 | Minimum clear stair width depends on building group/use | ≥0.90 (villa ≤3 storey) / ≥1.10 (multi-family / ≥4 storey); public stair-hall ≥2.40 | m | V1 conservatively applies 1.10 m for anything beyond single-villa ≤3 storey. | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-STAIR-002** | stair | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §4-5-1-7-1 (sub-clause 1-7-1-5-4) | ir-national | S-STAIR | 3 | Tread depth and riser height must satisfy 2r+t ∈ [0.63, 0.64]; riser ≤0.18 m; tread ≥0.28 m | tread≥0.28, riser≤0.18, 2r+t∈[0.63,0.64] | m | All stair flights | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-STAIR-003** | stair | مبحث چهارم — الزامات عمومی ساختمان | 1396 | §4-5-1-7-5 (max 12 risers between landings); §4-5-1-7-4 landing ≥ stair width; §4-5-1-7-6 headroom ≥2.05 m | ir-national | S-STAIR | 3 | Maximum 12 risers between two landings | max 12 risers/flight | count | Landing width and headroom checks are listed as NOT_IMPLEMENTED (need 2-D landing geometry and 3-D model) | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH15-LIFT-001** | elevator | مبحث پانزدهم — آسانسورها و پله‌برقی | 1392 (w/ later amendments) | §15-2-1-2 (>7 m travel = mandatory); §15-2-1-4 (>21 m = stretcher lift); ramp exception noted in text | ir-national | S-LIFT | 3 | Mandatory elevator when vertical travel from main entrance >7 m (≈3 occupied storeys) except where an accessible ramp is provided; >21 m additionally requires a stretcher lift (2.1×1.1 m, door 0.9 m); wheelchair cab 1.4×1.1 m (door 0.8 m) when elevator is mandatory | travel>7 → HARD; 3-storey (~6.4 m) → SOFT (borderline, depends on grade/floor height) | m | Soft at exactly 3 storeys; wheelchair/stretcher cab dimensions are listed as NOT_IMPLEMENTED (need elevator-shaft model) | footprint-check | REQUIRES_SOURCE_VERIFICATION |
| **MBH4-DYL-001** | daylight | مبحث چهارم — الزامات عمومی ساختمان | 1396 | ch. 6 (general) / §7-1-1-14 (kitchen independent daylight for units ≥75 m² or kitchen >7 m from adjacent window) | ir-national | S-DAY + S-RES | 3 | Habitable rooms (living/dining/bedrooms/family-room/guest-room) and independent kitchens must have an exterior wall (access to natural light/ventilation); WC/bath/corridor/storage exempt | must have exterior wall = true | boolean | Exemption for kitchens in small units (<75 m², open-plan, within 7 m of an adjacent room's window) is approximated | candidate-check | REQUIRES_SOURCE_VERIFICATION |
| **MUN-PARK-001** | parking | **NOT A NATIONAL RULE** — municipal detailed plan (طرح تفصیلی) | n/a | n/a | local/municipal | local-parking-assumption | 3 | Parking ratios are municipality/zone-specific; "1 bay/unit" is common praxis in many Tehran/other districts but is NOT a national Mabhas rule | default 1 bay/unit (soft advisory only) | stalls/unit | User must verify against municipal instruction (دستور نقشه) | footprint-check | REQUIRES_SOURCE_VERIFICATION |
| **MUN-SET-001** | setback | **NOT A NATIONAL RULE** — municipal detailed plan / building-permit instruction (دستور نقشه) | n/a | n/a | local/municipal | local-setback-assumption | 3 | Setback, ground coverage, and FAR are purely municipal parameters that vary by zoning district (e.g. Tehran R-110, R-120, R-160, …) | (advisory only — values used are defaults in the buildable-area engine, not enforced as national) | n/a | Always emitted as advisory to remind the user | footprint-check | REQUIRES_SOURCE_VERIFICATION |

### 2.2 NOT_IMPLEMENTED rule slots (advisory-only)

| ruleId | family | clause | why NOT_IMPLEMENTED |
|--------|--------|--------|---------------------|
| **MBH4-ROOM-003** | habitable-room | §4-5-2-2-3 (2.40 m), §7-1-1-9 (2.60 m over 50%/75% for rooms ≥12 m² and living-room) | Requires a 3-D model (ceiling heights, dropped beams, door-head clearance); not available in V1 footprint/plan model |
| **MBH4-STAIR-004** | stair | §4-5-1-7-4 (landing ≥ stair width), §4-5-1-7-6 (headroom ≥2.05 m), §4-5-1-7-7 (roof-access stair in 4+ storey bldgs), §7-1-1-7 (handrail) | Requires explicit landing geometry, 3-D headroom, and roof-stair modelling |
| **MBH15-LIFT-002** | elevator | §15-2-1-9 (wheelchair cab 1.4×1.1 / door 0.8), §15-2-1-10 (stretcher cab 2.1×1.1 / door 0.9), §15-2-1-11 (bed cab 2.4×1.4 / door 1.3) | Requires elevator-shaft and cabin modelling; V1 only has an `hasElevator` boolean |
| **MBH4-DYL-002** | daylight | ch.6, جدول ۱-۶-۴ (glazing ratios 1/8, 1/7, 1/6, 1/5 of floor depending on opposite-wall distance and window-head height); max daylight depth 7 m | Cannot be simplified to a fixed ratio; requires operable-window area calculation, opposite-wall distance measurement, and window-head height |
| **MBH4-DYL-003** | daylight | ch.6 / §5-9 (light-well dimensions: 12 m²×3 m main rooms / 6 m²×2 m kitchen / 6% and 3% of parcel for ≤200 m² sites / 6 m and 4 m opposite-window separation) | Requires light-well/patio geometry modelling; V1 generates only the building footprint, not yards |
| **MBH4-VENT-001** | ventilation | §7-1-1-15 (kitchen operable vent area ≥ 1/16 of kitchen floor) | Requires operable-opening area (separate from glazing); not yet modelled |
| **THN-000** | local-municipality | Tehran Detailed Plan (طرح تفصیلی تهران) — latest ablaghiyeh | No authoritative Tehran district pack loaded; placeholder emits a single advisory |

---

## 3. Rules Corrected During This Audit

### MBH4-ROOM-007 (sanitary minimum dimensions)

- **Pre-audit value:** smallest side ≥ 1.10 m (single threshold, HARD).
- **Source of the previous value:** secondary summary at hamyarnazer.com summarising §4-5-6-2-1 in one sentence.
- **Verbatim-clause evidence (S-RES, §7-1-1-18):**
  > "هر فضای بهداشتی مستقل … دارای حداقل ۰۰/۱ متر عرض و ۲۰/۱ متر طول باشد."
  > (Each independent sanitary space must be at least 1.00 m wide and 1.20 m long.)
  > "در فضاهای بهداشتی توام بدون وجود \"در\" میان آن‌ها، مقدار 15/0 متر از حداقل طول فوق کاسته می‌شود."
- **Correction applied:** The rule now checks both dimensions (width ≥1.00 m AND length ≥1.20 m). The previous 1.10 m "smallest side" simplification is removed because the clause specifies different minima per axis (1.00 width, 1.20 length). Severity remains HARD.
- **Caveat:** accessible (wheelchair) WC (1.50×1.70 m per §4-7-4) is NOT yet modelled — no accessibility flag exists on the project input.
- **Regression test:** `MBH4-ROOM-007` test case in `ir-national-mbr.test.ts` asserts that every HARD finding references §7-1-1-18.

### MBH4-ROOM-001 / MBH4-ROOM-002 separation

- **Pre-audit value:** the single ROOM-001 rule checked ALL habitable rooms against a single threshold (12 m²×2.7 m / 9 m²×2.5 m depending on unit size), conflating two distinct clauses.
- **Correction:** split into:
  - ROOM-001 (§7-1-1-8): "at least one room per unit" rule for the main room (the 12/9 m² × 2.7/2.5 m thresholds).
  - ROOM-002 (§4-5-2-2): the universal 6.50 m² × 2.15 m minimum that applies to EVERY habitable space.
- This correctly surfaces that, for example, a 10.8 m² dining room in a 95 m² unit fails the main-room threshold (12 m²) but comfortably passes the general 6.5 m² minimum — it's the absence of a ≥12 m² main room on that floor that is the violation, not the dining room's absolute area.

### MBH4-STAIR-001 (stair width) building-group sensitivity

- **Pre-audit value:** hard-coded ≥1.10 m for every stair.
- **Correction (audited):** §7-1-1-3 allows 0.90 m for straight stairs in M-2 groups 1–3 (low-rise / single-unit buildings). §7-1-1-4 mandates 1.10 m for groups 4–7. The rule now applies 0.90 m for `type=villa` with ≤3 storeys, 1.10 m otherwise. The 2.40 m public stair-hall landing width is listed as NOT_IMPLEMENTED.

### MBH4-ROOM-004 (kitchen) dual thresholds

- **Pre-audit value:** 5.5 m² × 1.8 m (single threshold).
- **Correction:** §7-1-1-10 (cook-only: 5.5 m² + 2.75 m² free work zone), §7-1-1-11 (cook+dine: 7.5 m²), §7-1-1-12 (width: 1.80 m / 2.15 m for cook+dine). V1 models a single kitchen rectangle so the cook-only threshold is applied; cook+dine thresholds are documented for future enhancement.

### MBH15-LIFT-001 trigger (vertical travel, not floor count)

- **Pre-audit value:** `floors >= 4` → HARD; `floors === 3` → soft.
- **Correction:** rule now computes vertical travel from main entrance as `(floors - 1) × floorHeight` and fires HARD when travel >7 m (the actual clause trigger). The 3-storey case is SOFT because with the generator's 3.2 m floor height it gives ~6.4 m (borderline; depends on grade/floor-height). This is closer to the actual §15-2-1-2 wording ("بیش از ۷ متر از کف ورودی اصلی") without claiming perfect accuracy.

### Stair duplicate finding fixed
- Pre-audit: the same 18-riser/flight violation was reported once per floor (duplicate) because each Floor object carries its own copy of the stair. Added geometry-based dedup key so a single HARD per unique staircase geometry is emitted.

### Source metadata now stamped on every Finding
- Findings now carry `sources[]`, `reference`, and `status` fields through to the validator/UI, so the UI can display the audit trail and the REQUIRES_SOURCE_VERIFICATION badge on every regulation finding.
- Pre-generation (footprint-check) findings no longer overwrite the rule's own `reference` field with a generic "Default assumption pack" string.

---

## 4. Conflicts / Discrepancies Found

| Topic | Conflict | Resolution in code |
|-------|----------|--------------------|
| Stair tread minimum | Some secondary sites quote 30 cm; manexgroup.com and hamyarnazer.com quote verbatim §4-5-1-7-1: "حداقل اندازه عمق کف‌پله 0.28 متر است" | 28 cm adopted (matches the verbatim clause quote) |
| Tread + 2×riser range | Some sites say 63–65 cm; manexgroup.com quotes verbatim 0.63–0.64 m | 0.63–0.64 m adopted (matches the verbatim clause quote); values outside this are SOFT because other sources mention multiple empirical formulas (b−h=12, b+h=48) |
| Bathroom min side | Older web summaries say 1.10 m smallest side; the verbatim residential clause §7-1-1-18 says 1.00 × 1.20 m | 1.00 × 1.20 m adopted. The 1.50×1.70 m accessible WC is NOT modelled (requires accessibility flag). |
| Kitchen min area | atnasr.ir quotes 5.5 m² closed kitchen; the verbatim clause distinguishes cook-only (5.5 m²) vs cook+dine (7.5 m²) | 5.5 m² applied (V1 single kitchen rectangle, dining modelled as separate room); 7.5 m² documented for future |
| Stair max-risers-per-flight | Widely cited as "max 12 risers" in practitioner sources; manexgroup.com quotes verbatim §4-5-1-7-5: "حداکثر تعداد پله‌های بین دو پاگرد باید 12 پله باشد" | 12 adopted (verbatim quote) |
| Elevator trigger | Many sites paraphrase as "≥4 storeys = elevator"; memaripedia/sabzsaze quote verbatim §15-2-1-2: "ساختمان‌های با طول مسیر قائم حرکت بیش از ۷ متر از کف ورودی اصلی (معمولاً بیش از سه طبقه)" | Vertical travel distance used; 3-storey borderline flagged as SOFT because the clause says "more than 7 m", not "≥4 storeys" |
| Glazing ratio | Some sites say 1/7 of floor area; danesh-cad.blogfa.com quotes clauses giving tiered ratios 1/8, 1/7, 1/6, 1/5 depending on opposite-wall distance and window-head height | Rule kept as NOT_IMPLEMENTED; not reduced to a fixed constant (per task instruction §F) |
| Parking ratio | Many practitioner sites state "1 bay/unit" as a universal rule; there is no national clause to this effect | Marked as MUN-PARK-001 (soft advisory), explicitly labelled as municipal-policy praxis, not national |

---

## 5. Unverified Rules (complete list — none are VERIFIED)

Every active rule in §2.1 is `REQUIRES_SOURCE_VERIFICATION`. Rules move to
`VERIFIED` only after a Tier-1 authenticated BHRC PDF (from inbr.ir or the
official publication CD) is placed in `sources/` and a reviewer signs off on
each clause.

### What is needed to promote any rule to VERIFIED

1. An authenticated PDF of the relevant Mabhas (most importantly **Mabhas 4,
   1399 revised edition** — the latest at time of writing; also **Mabhas 15**
   latest revision) saved under `sources/`.
2. A clause-by-clause sign-off comparing the code's thresholds against the
   PDF (highlighting/annotated screenshots acceptable).
3. Where the 1396 edition values differ from a newer revision, update the
   edition field on the source registry entry and add a new rule for the
   new edition (or add an edition-gate in the evaluator).

---

## 6. Rules Deliberately NOT IMPLEMENTED

The following topics are intentionally left as advisory slots (with
`NOT_IMPLEMENTED` status) because the current plan geometric model does not
capture the required information, or because they require municipality-level
input that the user has not supplied:

1. **Ceiling heights / headroom under beams / mezzanines** (requires 3-D model).
2. **Accessible (wheelchair) WC 1.50×1.70 m** (requires accessibility flag + larger bathroom geometry).
3. **Stair landing width, stair headroom, handrail, roof-access stair** (require landing geometry, 3-D, and roof model).
4. **Elevator cab dimensions (wheelchair/stretcher/bed)** — require elevator-shaft model.
5. **Glazing ratios (1/8, 1/7, 1/6, 1/5 depending on depth)** — requires operable-opening area and opposite-wall distance measurement; will NOT be implemented as a fixed constant per task instruction §F.
6. **Light-well/patio dimensions** (12 m²×3 m, 6 m²×2 m, 6%/3% parcel rules, 6 m/4 m opposite-window distances) — requires light-well geometry.
7. **Kitchen ventilation opening ≥1/16 floor area** — requires operable-opening area.
8. **Tehran (or any municipality) detailed-plan pack** — setbacks, coverage, FAR, height districts, parking minima, encroachment (اشکوب), balcony bonuses — NOT INVENTED.
9. **Parking bay dimensions** (2.50×5.00 m, accessible 3.50 m, height ≥2.20 m) — current parking module is in `generator/parking.ts`; dimensions used there should be audited against the municipal transportation/access code before being flagged as a rule.
10. **Door widths** (entrance 1.05 m for stretcher corridors per §7-4-3, room doors 0.80 m, accessible 0.90 m) — not yet modelled as explicit checks.
11. **Corridor widths** (0.90 m per §4-7-1-1-6 internal corridors; larger for public corridors per building group) — partially enforced by the planner's `CORRIDOR_W` constant but not exposed as a regulation rule.
12. **Entrance vestibule** (1.40×1.40 m, depth 1.40 m, area 2 m², per §7-1-1-1) — not modelled.
13. **Handrails, guards (جان‌پناه)** (1.10 m height, ≤11 cm baluster spacing) — not modelled.
14. **Other Mabhas than 4 and 15** (Mabhas 3 — fire egress; Mabhas 9 — seismic; Mabhas 16 — mechanical; Mabhas 19 — energy; etc.) — out of scope for Phase 2.

---

## 7. Missing Authoritative Sources (Tier 1)

| Document | Edition | Used for | Status |
|----------|---------|----------|--------|
| مبحث چهارم مقررات ملی ساختمان — الزامات عمومی ساختمان | 1399 (latest revision at audit date; 1396 still in wide use) | ROOM/STAIR/DYL/KITCHEN/SANITARY rules | Not present in `sources/`; download attempted from fc.icivil.ir failed (TLS/network restricted in sandbox). Must be obtained manually from inbr.ir or BHRC authorised distributors |
| مبحث پانزدهم — آسانسورها و پله‌برقی | 1392 with later amendments (مبحث ۱۵ الحاقی) | LIFT rules | Same as above |
| طرح تفصیلی شهر تهران (آخرین ابلاغیه) | current ablaghiyeh | Tehran pack | Municipal document; varies by district; user must supply with their permit instruction |
| Approved municipality detailed plan for the specific parcel | current | Setbacks/coverage/FAR/parking | User-supplied per project |

---

## 8. Recommended Next Regulation Work

In priority order:

1. **Obtain Tier-1 PDFs** for Mabhas 4 (latest edition) and Mabhas 15; place in
   `sources/` with a clear edition/filename convention, then promote rules
   from `REQUIRES_SOURCE_VERIFICATION` to `VERIFIED` one-by-one as clauses
   are signed off.
2. **Implement 3-D ceiling-height model** (ROOM-003 ceiling heights 2.40/2.60 m;
   STAIR-004 headroom 2.05 m; sanitary 2.20 m).
3. **Add elevator-shaft geometry** and cab-size checks (MBH15-LIFT-002).
4. **Add landing geometry** to stair generation so landing width / headroom /
   intermediate-landing placement can be validated; once landing exists the
   planner should also split long flights automatically when >12 risers.
5. **Add accessible-WC flag** on ProjectInput so 1.50×1.70 accessible WC
   dimensions can be enforced when required.
6. **Implement window/opening area model** (frame vs. glazing vs. operable
   sash), then implement DYL-002 with the tiered glazing ratio (NOT a fixed
   1/7 constant).
7. **Implement light-well/patio geometry and the 6-m/4-m opposing-window
   separation rules** once yards/patios are added to the site model.
8. **Design a municipality-pack loader** that reads a signed JSON pack
   (setbacks, coverage, FAR, parking, height) per parcel when the user
   provides their `dastor naqsheh` (permit instruction); until then the
   Tehran stub stays NOT_IMPLEMENTED.
9. **Add door-width and corridor-width rule slots** with explicit clause
   references.
10. **Mabhas 3 (fire egress / exit widths)** is the highest-impact missing
    regulation family for multi-storey residential; add once an egress
    graph/occupant-load calculation exists.

---

## 9. Phase 2c additions — primary-source integration infrastructure

### Mechanism added

1. **`RegulationSource` fields extended** with:
   - `documentPath` (path relative to the repo, e.g. `sources/mabhas-4-1399.pdf`)
   - `uri` (canonical publisher URL)
   - `digest: { algorithm: 'sha256', value }` (tamper-evident)
   - `verificationState: 'obtained-authenticated' | 'obtained-unauthenticated' | 'not-obtained'`
   - `SourceRef.snippet` and `SourceRef.page` for per-clause traceability.
2. **`sources/register-source.js` CLI** — one command to register a PDF:
   ```bash
   node sources/register-source.js t1-mabhas4-1399 sources/mabhas-4-1399.pdf
   ```
   computes SHA-256, writes it into `source-registry.ts`, and sets
   `verificationState: 'obtained-authenticated'`.
3. **Integrity tests** (6 new tests in `source-registry.test.ts`):
   - Tier-1 canonical entries exist (Mabhas 4, Mabhas 15, Tehran).
   - `obtained-authenticated` entries MUST carry documentPath + sha256 digest.
   - While `not-obtained`, they MUST NOT carry documentPath/digest
     (prevents "phantom verified" states).
   - No `VERIFIED` rule may cite anything other than a Tier-1,
     obtained-authenticated source with a page number.
   - Currently 0 rules are VERIFIED (test asserts count).
   - National-vs-local separation: MUN-PARK-001 and MUN-SET-001 remain
     non-HARD local-policy notes.
   - Tehran stub is exactly one NOT_IMPLEMENTED placeholder.
4. **`sources/README.md`** rewritten to describe the promotion workflow.

### Primary documents obtained during Phase 2c

**None.** Network egress in the sandbox blocks access to Iranian hosts and
no CDN mirror or GitHub repository carrying authenticated Mabhas PDFs was
reachable over the npm/GitHub whitelist. The audit did NOT download,
fabricate, or backfill any PDF. Tier-1 entries in the registry are set up
with `verificationState: 'not-obtained'` and a canonical URI ready for when
the user (or a future network-permitted session) supplies the
authenticated PDF.

### Rules promoted to VERIFIED during Phase 2c

**0** — no Tier-1 document was obtained; integrity tests enforce that no
rule can be flipped to VERIFIED without a cited Tier-1,
obtained-authenticated source with a page number.

### Corrections made during Phase 2c

Beyond the source-registry mechanism itself, one bug was corrected that
surfaced while preparing the audit harness: the South-band entrance
doorway calculation had a coordinate-system bug that placed the entrance
door at `x=9.15` (inside a wall-end) instead of centred over the
entry-spur column. This was a pre-existing geometry bug in the openings
placer; it was fixed as part of this phase because it produced a
circulation error on the 3-bed-villa scenario that would mask
regulation-engine results. No regulation threshold values were changed.

### Remaining authoritative-source gaps (action required for VERIFIED status)

| Source | Needed for rules | Recommended acquisition |
|--------|------------------|-------------------------|
| `sources/mabhas-4-1399.pdf` (latest) | All MBH4-* rules | Download from https://inbr.ir/ or the BHRC authorised distributor; register with `node sources/register-source.js t1-mabhas4-1399 …` |
| `sources/mabhas-4-1396.pdf` | Cross-reference for clause numbers used in current code | Archive copy of the 1396 edition for clause-number stability |
| `sources/mabhas-15.pdf` | MBH15-LIFT-001 and future cab-size rules | Same as above |
| Tehran Tarh Tafsili (project-specific PDF) | THN-* local rules | User supplies with their `dastoor naqsheh` for each parcel |

After any PDF is placed and registered, the auditor must go rule-by-rule
and fill in `page:` numbers and `verifiedAt`, flip status to
`'VERIFIED'`, and add compliant / boundary / non-compliant / exception
tests for each newly verified rule.

---

## 10. Product Phrasing Compliance Checked

All user-facing rule messages and advisory notes were reviewed against the
"critical product rule":

- ❌ "100% code compliant" — NOT used anywhere.
- ❌ "legally approved" / "municipality approved" — NOT used.
- ❌ "guaranteed permit" / "guaranteed compliance" — NOT used.
- ✅ Messages use phrases such as: "کمتر از حد" (below threshold), "الزامی است"
  (is required), "پس از افزودن مدل … فعال خواهد شد" (will activate once the
  … model is added), "مستلزم استعلام از شهرداری" (requires municipal inquiry).
- ✅ Every finding carries `status: REQUIRES_SOURCE_VERIFICATION` or
  `status: NOT_IMPLEMENTED` so the UI can badge it accordingly.
- ✅ MUN-PARK-001 and MUN-SET-001 explicitly state that they are NOT national
  rules and must be verified against the municipal detailed plan.
- ✅ THN-000 explicitly tells the user that the Tehran pack is not loaded.
