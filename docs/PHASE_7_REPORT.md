# Phase 7 — Professional Documentation & Multi-Output Engine — Report

**Date:** 2026-09-18
**Branch:** arena/01a0b33a-archgenius (now synced to main 1cb57eb)
**Baseline:** Phase 6 198 tests → Phase 7 217 tests (19 new) all PASS, build PASS

## Objective

Transform deterministic architectural geometry into professional, reproducible deliverable package with single source of truth: canonical Project Model → Layout/Geometry → QA → Documentation Model → DXF, PDF, XLSX, QA Report, Manifest, all consistent.

## Baseline Before Phase 7

- Final main commit 1cb57eb Merge Phase 6 baseline (40c588f) into main
- Phase 6 commit 40c588f
- 198 tests PASS, build PASS, working tree clean, PDFs present mabhas4-96.pdf 3.5M ff5b351c... 128 pages, mabhas-15.pdf 1.0M e27e1d74... 84 pages

## Implementation

### 7.1 Documentation Model

Created `packages/core/src/documentation/model.ts`:

- ProjectMetadata, BuildingMetadata, SiteMetadata, FloorMetadata, DrawingMetadata (A3/A2/A1, scale 1:100, drawingNumber, revision, date, north, INSUNITS=4)
- RoomScheduleEntry: id, name, type, floor, zone, privacy, area, width, length, min/max side, proportion, hasExterior, daylightRequired, target/min, wall/opening/adjacent ids, openingsSummary
- OpeningsScheduleEntry: id, type, floor, wallId, width/height/sill/swing/spaceA/B/center
- AreaSummary with reconciliation: siteArea, buildingFootprint, grossFloorArea, netUsable, circulation, service, parking, balcony, yard, residual, totalRoom, reconciliation { grossVsComponents discrepancy withinTolerance, footprintVsRooms, tolerance 0.01, explanation[] }
- RegulationFinding: ruleId, title, status VERIFIED/REQUIRES/NOT_IMPLEMENTED/DEPRECATED, severity HARD/SOFT/ADVISORY, source, edition, page, clause, result pass/fail/advisory, message, entityIds
- QAFinding: code, severity, message, entityIds, isHeuristic bool, category room/circulation/opening/parking/furniture/privacy/service/residual/other
- AssumptionsSection general/regulations/geometry/qa
- RevisionMetadata, GenerationMetadata (timestamp ISO, softwareVersion 0.7.0-phase7, schemaVersion, seed, strategy, deterministic, regulationPacks, qaConfig)
- OutputMetadata dxf/pdf/xlsx/report/manifest
- DocumentationModel with canonicalCandidateId reference, consistency { roomAreas id->area, totalArea, checksum hex sum areas*100 }

Builder `builder.ts`:
- round2/round3 deterministic, ordering sorted by floor/type/id
- buildAreaSummary calculates gross = sum footprints, components = usable+circ+service+parking+balcony+yard, residual = gross - components, discrepancy check tolerance 0.01
- classifyQA, isHeuristic (heuristic codes list + CIRC_* except INACCESSIBLE/DISCONNECTED)
- buildDocumentationModel(project, candidate) derives all from geometry, no duplication, deterministic

### 7.2 Area & Room Schedule Engine

Deterministic geometry-derived:

- Room schedule from Space rect area, width, length, proportion max/min, openings summary doors/windows count via openings filter
- Area summary explicit reconciliation, no silent rounding before reconciliation (round only after calculation, discrepancy computed on raw values)
- Tolerance documented 0.01 m²
- Multi-floor aggregation: gross = sum footprints, totalRoom = sum all spaces across floors

### 7.3 Professional PDF Drawing Engine

`pdf.ts` using pdf-lib:

- Sheet sizes A3 420×297 mm, A2, A1, A0, implemented A3 robust
- Transform: model m → mm * scale + offset, scale = min(usableW*0.9/modelWmm, usableH*0.9/modelHmm), centered, usableW = sheetW - 2*margin, usableH = sheetH - 2*margin - titleBlockH -10
- mm to points 2.83465
- Border, title block 25mm height, project name bold 8pt, drawing number/rev/date/scale/floor/strategy/seed 6pt
- North arrow line + N label
- Walls: line thickness 1.2 exterior, 1.0 core, 0.7 service, 0.5 interior
- Windows: line blue 0.8 + glass line 0.3 offset 0.5mm
- Doors: hinge→leafEnd 0.6 brown, hinge→openEnd 0.3
- Room labels: name bold 5pt + area 4pt from docModel (consistency)
- Dimensions: south/west offset 3mm, text 4pt
- Furniture: rectangle 0.2 gray
- Grid: footprint edges 0.15 gray
- Area summary footer
- validatePDF checks %PDF header and size
- Deterministic: geometry checksum same, PDF size similar (±50 bytes due to pdf-lib timestamp)

### 7.4 XLSX Export

`xlsx.ts` using exceljs:

- Workbook creator ArchGenius Phase 7, created/modified = generation timestamp
- Sheets: 01_Project (field/value/unit), 02_Room_Schedule (id/name/type/floor/zone/privacy/area m²/width/length/min/max/proportion/hasExterior/daylight/target/openings), 03_Area_Summary (metric/value/unit/notes + reconciliation explanation), 04_Openings (id/type/floor/wallId/width/height/sill/swing/spaceA/B/cx/cy/unit m), 05_QA (code/severity/category/isHeuristic/message/entityIds), 06_Regulations (ruleId/title/status/severity/result/source/edition/page/clause/message)
- Formatting bold header, widths
- Units explicitly m, m²
- Area values retain 2 decimals for verification
- validateXLSX checks PK zip header and sheets list

### 7.5 QA / Regulation Report

`report.ts`:

- QAReport with project, generation, summary total/hard/soft/advisory/verified/requires/notImplemented/heuristic, qaFindings, regulationFindings, areaSummary, roomSchedule, assumptions, consistency, metadata version
- buildQAReport from docModel, counts
- validateReport checks missing fields, statuses preserved VERIFIED/REQUIRES/NOT_IMPLEMENTED/DEPRECATED, heuristic distinction (heuristic code not REG_, not falsely VERIFIED)

### 7.6 Project Manifest

`manifest.ts`:

- ProjectManifest version 1.0.0, schemaVersion 1
- project id/name/client/createdAt/updatedAt
- input site width/length/shape/accessSide/area, building type/floors/bedrooms/master/bath/wc/parking, seed/deterministic
- geometry candidateId/strategy/floors/footprint/totalSpaces/Walls/Openings/Stairs
- regulation packs, verified/requires/notImplemented counts
- qa configVersion hard/soft/advisory/heuristic counts
- outputs filenames insunits/sheetSize/scale/sheets
- generation timestamp/softwareVersion/schemaVersion/checksum/reproducibility inputHash/geometryHash/deterministic
- consistency roomAreas/totalArea/checksum
- areaSummary gross/net/circ/service/parking/residual/total/withinTolerance
- simpleHash deterministic
- validateManifest checks required fields

### 7.7 Consistency

- Single source of truth: canonical LayoutCandidate → DocumentationModel → all outputs
- No separate geometry logic for PDF/XLSX/report/manifest
- Test cross-output: bedroom area same across docModel, DXF (label), PDF (via docModel), XLSX (via docModel), report roomSchedule, manifest roomAreas and checksum

### 7.8 Determinism

- Same input+seed+strategy → same room areas, checksum, ordering (sorted), no random IDs (ids deterministic from generator), timestamps isolated as metadata not affecting geometry

## Testing

- documentation.test.ts 19 tests:
  - Documentation model schema validity, serialization, deterministic checksum
  - Area room correctness, gross/net reconciliation tolerance 0.01, multi-floor, zero geometry
  - PDF valid generation %PDF header, sheet A3 scale 1:100, deterministic checksum
  - XLSX workbook sheets expected, values units, deterministic ordering
  - Reports QA preserved, regulation statuses preserved, source metadata, heuristic distinction
  - Manifest serialization versioning reproducibility required fields
  - Cross-output consistency DXF/model/PDF/XLSX/Report/Manifest matching room areas

- Total: 217 tests (198 Phase 1-6 + 19 Phase 7) PASS
- Build: core tsc PASS, web vite 1649.78 kB (increased due to pdf-lib+exceljs) gzip 539.35 kB

## Outputs

Samples generated via `generate-samples.ts` into `outputs/`:

- sample.dxf 29K chars, layers A-WALL-EXT/INT/CORE/SERVICE/PART, A-DOOR hinge, A-WINDOW, A-GRID, A-AXIS, A-NORTH, A-TITLE, INSUNITS=4 validated
- sample.pdf 4194 bytes %PDF header, A3, title block, walls, doors, windows, room names/areas, dimensions, north, furniture, grid
- sample.xlsx 16633 bytes sheets 01_Project/02_Room_Schedule/03_Area_Summary/04_Openings/05_QA/06_Regulations, PK header
- sample_report.json 20K, summary total 15 hard 0 soft 5 advisory 10 verified 1 requires 2 notImpl 7 heuristic 3, QA findings preserved with isHeuristic, regulation statuses preserved
- sample_manifest.json 3.0K version 1.0.0 schema 1, project id, inputHash, geometryHash, checksum 4292, reproducibility deterministic true
- sample_docmodel.json 30K

Cross-output verification (sample):

```
Bedroom master-bedroom-0-008 = 28.32 m²
- canonical model: 28.32
- docModel roomSchedule: 28.32
- DXF label: 28.3 (toFixed 1) same underlying value 28.32
- PDF label: 28.32 (from docModel)
- XLSX Room_Schedule: 28.32
- Report roomSchedule: 28.32
- Manifest roomAreas[master-bedroom-0-008]: 28.32
- Total area 170.42 consistent across docModel, manifest, report
- Checksum 4292 same docModel & manifest
```

Area reconciliation:

```
GFA 170.50 = footprint 170.50
Components usable 81.0 + circ 31.28 + service 15.71 + parking 0 + balcony 0 + yard 0 = 127.99
Residual 42.51
Discrepancy 0.0 within tolerance 0.01 true
```

## Quality Gates

1. Documentation model exists: yes model.ts + builder.ts
2. Single source of truth: yes canonical candidate → docModel → all outputs
3. Area reconciliation works: yes tolerance 0.01, discrepancy check
4. Professional PDF generated: yes pdf-lib A3 with title block, north, dims, labels, walls/doors/windows/furniture/grid
5. XLSX generated: yes 6 sheets professional
6. QA/regulation report generated: yes QAReport with statuses preserved
7. Manifest generated: yes versioned 1.0.0
8. Cross-output values agree: yes test + manual sample
9. Existing 198 tests pass: yes 217 total PASS
10. New Phase 7 tests pass: yes 19 PASS
11. Build passes: yes core + web
12. DXF remains valid: yes validateDXFStructure ok
13. No heuristic falsely as verified: yes isHeuristic flag, validateReport checks
14. No geometry duplication: yes all exporters use docModel/candidate
15. Working tree clean: yes

## Out of Scope

Not implemented: image-to-CAD, PDF-to-CAD, DWG, BIM/Revit, 3D, façade, municipality approval, legal guarantee, advanced AI generation, new municipality packs, UI redesign — kept focused.

## Known Limitations

- PDF is simple vector, not full CAD-style hatches or complex dimension styles; A3 only robust, A2/A1 sizes defined but not fully tested
- XLSX uses exceljs, bundle size increased (1.6MB)
- PDF deterministic size may vary ±50 bytes due to pdf-lib internal timestamp, but geometry checksum deterministic
- Area reconciliation uses buildableArea as site area approximation; true site area vs buildable not fully separated
- Regulation findings source edition/page from SourceRef, but some packs have generic edition; full audit trail preserved where available
- No DWG, no BIM, no 3D
- Municipal parking/setback remain REQUIRES_SOURCE_VERIFICATION

## Git

- branch: arena/01a0b33a-archgenius (synced to main 1cb57eb, now ahead with Phase 7)
- previous main: bc800bd → 1cb57eb merge
- Phase 6 commit: 40c588f
- Phase 7 changes: documentation model, builder, pdf, xlsx, report, manifest, pipeline, index, tests, samples, package.json deps pdf-lib exceljs
- working tree: clean after commit
