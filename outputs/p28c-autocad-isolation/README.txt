PHASE 28-C AutoCAD 2027 isolation set — textbook-conservative R12 ASCII, CRLF, no BOM.

Context (real-AutoCAD evidence so far):
- v1.2.0 full files + bisect variants A2-F2  -> open black/blank.
- v1.0.2 file                                 -> black/blank + "Press ENTER to continue".
- Historical real-AutoCAD verdicts (2026-09-19 isolation T2/W1/W2):
    T2/W1 (no dash elements, no R13+ header vars, NO VPORT)   -> PASS (visible)
    W2 (dash elements 49/74 present)                          -> FAIL
    R13+ header vars ($SCREENSIZE/$DWGCODEPAGE)               -> "Press ENTER" prompt class
- v1.0.2 re-inspection: it still contains BOTH fatal classes
    (LTYPE CENTER/DASHED with 49/74 dash elements, and $DWGCODEPAGE/$SCREENSIZE)
  -> its 2027 failure is internally explained.
- Every 2027-failing ArchGenius file (v1.2.0 + A2-F2) shares exactly one
  construct absent from every historically-PASSing file: the P22-B VPORT table
  (plus $INSBASE/$VIEWDIR header vars, added in the same commit 5cd20ce).
- NOTE: the historical PASS files (T2/W1) predate the VPORT table; the VPORT
  profile has NEVER passed a real AutoCAD test.

Open the three files IN THIS ORDER in AutoCAD 2027 (each from a local,
unblocked path; Properties -> Unblock before first open):

1. G1-minimum-single-LINE.dxf
   Bare minimum R12: header $ACADVER only, NO tables at all, one LINE on
   layer 0, positive coordinates 100..900.
   Isolates: AutoCAD 2027's baseline willingness to load ANY minimal DXF.
   - If G1 FAILS (black / Press ENTER): the problem is EXTERNAL to
     ArchGenius (AutoCAD 2027 environment / open method / security settings) -
     no writer change can fix it.
   - If G1 opens visible: continue.

2. G2-minimum-polyline-rect.dxf
   G1 + one closed POLYLINE rectangle (66/70 flags, 4 VERTEX + SEQEND).
   Isolates: polyline entity syntax acceptance in 2027.

3. G3-current-header-plus-LINE.dxf
   The EXACT v1.2.0 HEADER section (byte-verbatim: $INSBASE, negative
   $EXTMIN/$LIMMIN, $VIEWCTR/$VIEWSIZE, $VIEWDIR, $LUNITS) + conservative
   LTYPE/LAYER/STYLE tables WITHOUT a VPORT table + one LINE inside the
   header extents.
   Isolates: the current writer's HEADER profile alone (integer-formatted
   reals, negative extents, view variables) with everything else textbook.
   - If G3 FAILS while G1/G2 open: the HEADER profile is the culprit;
     compare against v1.0.2's header ($DWGCODEPAGE/$SCREENSIZE absent here)
     to pinpoint the variable.
   - If G3 OPENS: the HEADER is innocent, pointing back at the TABLES -
     i.e., the VPORT table (test next: repo fixture
     packages/core/src/dxf/fixtures/isolation/T2-A-plus-LTYPE-3x-minimal-CONTINUOUS.dxf
     which PASSED historically, then A2 from the p28-dxf-bisect kit which adds
     the VPORT table; the T2-vs-A2 pair is the direct VPORT discrimination).
