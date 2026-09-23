PHASE 28-D — AutoCAD 2027 HEADER isolation ladder.

Established by Phase 28-C manual tests:
  G1 (minimum LINE)            -> OPENS, visible/editable (READ-ONLY warning acceptable).
  G2 (minimum POLYLINE)        -> OPENS, visible/editable.
  G3 (v1.2.0 HEADER + tables + LINE) -> BLACK/BLANK.
=> AutoCAD 2027 environment and base DXF structure are proven good; the failing
   construct is inside the current ArchGenius HEADER profile:
     $ACADVER, $INSBASE, $EXTMIN(-2500,-4600), $EXTMAX, $LIMMIN(-2500,-4600),
     $LIMMAX, $VIEWCTR, $VIEWSIZE, $VIEWDIR, $LUNITS  (exact values preserved
     from the v1.2.0 writer output in G3).

This ladder derives EVERY file from G3's bytes: the TABLES section, the ENTITIES
section and all other HEADER bytes are byte-identical to G3; each file removes
or rewrites exactly ONE header variable group:

  H0-acadver-only-control.dxf      ONLY $ACADVER kept (T2-class control header).
  H1-minus-INSBASE.dxf             removes $INSBASE (0.0,0.0,0.0).
  H2-minus-EXT-LIM.dxf             removes $EXTMIN/$EXTMAX/$LIMMIN/$LIMMAX.
  H3-minus-VIEW.dxf                removes $VIEWCTR/$VIEWSIZE/$VIEWDIR.
  H4-minus-LUNITS.dxf              removes $LUNITS (70 2).
  H5-EXT-LIM-positive-reals.dxf    keeps EXT/LIM but rewritten non-negative
                                   real-form: min 0.0/0.0/0.0, max
                                   18050.0/22050.0/0.0 (tests the NEGATIVE +
                                   INTEGER-FORMATTED extent values specifically).

All six verified: ezdxf strict readfile OK, recover 0 errors, audit 0 errors /
0 fixes; TABLES+ENTITIES byte-identical to G3; single LINE (0,0 -> 15000,15000
on layer A-WALL-EXT) inside every declared envelope.

TEST ORDER (AutoCAD 2027, local unblocked copies):
  1. H0-acadver-only-control.dxf
  2. H1-minus-INSBASE.dxf
  3. H2-minus-EXT-LIM.dxf
  4. H3-minus-VIEW.dxf
  5. H4-minus-LUNITS.dxf
  6. H5-EXT-LIM-positive-reals.dxf

INTERPRETATION (first file in this order that OPENS visible identifies the
culprit; everything still failing shares the fatal construct):
  H0 opens                        -> TABLES+LINE innocent (expected); continue.
  H1 opens                        -> $INSBASE is the culprit.
  H2 opens (after H1 failed)      -> the EXT/LIM group is the culprit
                                     (negative/integer-form values);
                                     H5 then decides:
                                       H5 opens -> negative values are fatal;
                                       H5 fails -> integer formatting is fatal.
  H3 opens (after H1/H2 failed)   -> the VIEW group ($VIEWCTR/$VIEWSIZE/
                                     $VIEWDIR) is the culprit.
  H4 opens (after H1-H3 failed)   -> $LUNITS is the culprit.
  None of H1..H5 opens            -> interaction between variables; a second
                                     round of pairwise removals will follow.

Record per file: opens normally? / geometry visible? / editable? /
"Press ENTER to continue"?
