PHASE 28-A AutoCAD 2027 bisect kit — built from the ACTUAL v1.2.0 writer output (18x22 NE 7x9 L-shape plan, seed 42).

Method: the repo's own proven isolation ladder (packages/core/src/dxf/fixtures/isolation/,
where T2/W1 PASS and W2 FAIL isolated the LTYPE dash bug on 2026-09-19).

Open EACH file in AutoCAD 2027 in this order and record visible/empty:

1. A2-proven-base-reference.dxf  — the historically PASSING minimal file (control; must be VISIBLE)
2. E2-full-current-file.dxf      — the exact failing v1.2.0 output (expect EMPTY, reproduces the report)
3. B2-header-only.dxf            — proven base + our full HEADER (negative EXTMIN/integer reals/VIEW profile)
4. C2-tables-only.dxf            — +our full TABLES (VPORT-first, 46 layers, 3 LTYPEs, STYLE)
5. D2-blocks-only.dxf            — +our BLOCKS (*Model_Space/*Paper_Space, no groups 3/1)
6. F2-entities-first100.dxf      — +first 100 real ENTITIES (mm scale, negative coords)

Interpretation:
- If 3 is EMPTY: the HEADER profile is the culprit (negative $EXTMIN/$LIMMIN or integer-formatted reals).
- If 4 is EMPTY: the TABLES are the culprit (VPORT record / LAYER table size / LTYPE set).
- If 5 is EMPTY: the BLOCKS section is the culprit (missing groups 3/1/8).
- If 6 is EMPTY but 5 VISIBLE: the ENTITIES content is the culprit (mm scale / negative coords / a specific record);
  then bisect F2 by halving the entity count.
- The first EMPTY file in the ladder identifies the fatal section; its previous file identifies the last good state.
