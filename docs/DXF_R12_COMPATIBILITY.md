# DXF R12 ASCII Compatibility (AC1009) — Conservative Writer

## 1. Goal
Emit genuine R12 ASCII DXF with visible, editable modelspace geometry (walls/rooms/doors/windows/furniture/stairs/dims/text) inside a sane envelope. The browser download path (Blob via `writeDXF`) must be byte-identical to `exportDXF()` string and render without black/empty view in AutoCAD.

## 1.5 Status update (Phase 22-B, 2026-09)

The initial-view profile described below was briefly removed by commit 00a6b57
("minimal header" experiment), which re-introduced the black/empty AutoCAD open
(generated report below for the historical record). Phase 22-B restored it in
`packages/core/src/dxf/writer.ts`: $INSBASE, $EXTMIN/$EXTMAX, $LIMMIN/$LIMMAX,
$VIEWCTR/$VIEWSIZE, $VIEWDIR (0,0,1), $LUNITS 2 — computed from the emitted-entity
envelope — plus the VPORT-first table with *ACTIVE. The genuinely invalid R13+
variables ($DWGCODEPAGE, $SCREENSIZE, $INSUNITS, $MEASUREMENT) remain forbidden.
The VPORT record omits the optional 73/74 flags so the LTYPE dash-X regression
guards (which ban 49/73/74 across TABLES) stay intact and untouched.

## 1.6 Status update (Phase 28-E, 2026-09) — minimal proven header replaces P22-B

Real AutoCAD 2027 isolation (Phase 28-C G1/G2/G3 + Phase 28-D H0..H5 ladders,
files preserved under outputs/p28c-autocad-isolation/ and
outputs/p28d-autocad-header-isolation/) proved:

- G1/G2/H0 — HEADER with ONLY `$ACADVER` — open VISIBLE and EDITABLE
  (the browser-download READ-ONLY warning is a Mark-of-the-Web artifact and is
  accepted, not a defect).
- G3 — the full P22-B header ($INSBASE, $EXTMIN/$EXTMAX, $LIMMIN/$LIMMAX,
  $VIEWCTR/$VIEWSIZE, $VIEWDIR, $LUNITS) — opens BLACK/BLANK.
- H1..H5 — removing ANY ONE variable group still opens BLACK/BLANK: every
  header variable beyond `$ACADVER` participates in the failure.
- The P22-B VPORT table is equally rejected by AutoCAD 2027 (present in every
  failing file, absent from every passing fixture T2/W1).

The production writer therefore emits the MINIMAL header ($ACADVER AC1009 only)
and no VPORT table; AutoCAD fits the view to the drawing extents automatically.
`validateDXFStructure` now enforces exactly this profile (forbidden: the nine
view variables, VPORT/*ACTIVE, and the R13+ variables).

## 1.7 Status update (Phase 28-F, 2026-09) — AutoCAD 2027 manual verification PASSED

The Phase 28-E writer output was manually verified in AutoCAD 2027 by the
product owner:

- File: `outputs/p28e-regenerated/v1.2.1-L-NE-18x22.dxf` (18×22 L-shape,
  minimal-header profile).
- Result: **opens correctly → geometry visible → fully editable.**
- The browser-download READ-ONLY warning appears and is ACCEPTED — it is a
  Mark-of-the-Web artifact of downloaded files, not a DXF defect.

This closes the 2026-09 AutoCAD-2027 black/blank regression chain: the P22-B
view-variable/VPORT profile (v1.1.0-format and v1.2.0-format) is replaced by
the minimal `$ACADVER`-only header proven by the Phase 28-C/28-D isolation
ladders and confirmed by this manual verification. `validateDXFStructure`
permanently enforces the proven profile.

## 2. Root Cause — Why Browser Download Was Black/Empty (diagnosed 2026-09-19)

### Header R13+ variables in AC1009
The writer emitted `$DWGCODEPAGE` (ANSI_1252) and `$SCREENSIZE` (1024×768) in the HEADER. Both are **R13+** (AC1012+) and invalid for AC1009. AutoCAD R12 parser treats them as unknown but some viewers/ezdxf prompt `Enter` and abort initial view, leaving modelspace black. Audit with ezdxf reported 0 findings because ezdxf is tolerant, but real AutoCAD requires strict R12.

Fix: removed `$DWGCODEPAGE` and `$SCREENSIZE` entirely. Conservative header now only:
- `$ACADVER` AC1009
- `$INSBASE` 0,0,0
- `$EXTMIN` / `$EXTMAX` (real envelope in mm, 30 present)
- `$LIMMIN` / `$LIMMAX` (same as extents, 30 present)
- `$VIEWCTR` 10/20/30 (center of extents)
- `$VIEWSIZE` 40 (view height = envelope height × 1.15, covers full drawing)
- `$VIEWDIR` 0,0,1
- `$LUNITS` 2 (decimal)

No `$INSUNITS`, `$MEASUREMENT`, `$DWGCODEPAGE`, `$SCREENSIZE`.

### Missing 30 (elevation) on 2D points
`emitLine` emitted 10/20 + 11/21 but no 30/31. R12 readers expect 10/20/30 for every point, even if 0. Missing elevation caused entities to be considered 3D with undefined Z, sometimes culled. Similarly `emitArc` 10/20 lacked 30, `emitText` lacked 30/31, `POLYLINE` header lacked elevation 30 and `VERTEX` lacked 42 (bulge).

Fix: every point now `10 x 20 y 30 0` (+ `11/21/31` for second point), `VERTEX` includes `42 0.0`, `POLYLINE` header includes `10/20/30 0` + `70` closed flag + `66` vertices-follow + `40/41` start/end width 0 + `71/72` curve fit.

### TABLES order — VPORT must be first
Previously `TABLES` injected VPORT after STYLE, order was `LTYPE → LAYER → STYLE → VPORT → VIEW → UCS → APPID → DIMSTYLE`. For R12, the canonical order is `VPORT → LTYPE → LAYER → STYLE → VIEW → UCS → APPID → DIMSTYLE` and `VPORT *ACTIVE` must appear immediately after `2 TABLES` so the viewer honours `$VIEWCTR/$VIEWSIZE`. Out-of-order VPORT caused initial view to be ignored (black).

Fix: tables injection now inserts `TABLE VPORT` with `*ACTIVE` (70 0, 10 0 20 0, 11 1 21 1, 12 vCx 22 vCy, 40 viewH, 41 aspect, 42 50, 43 0, 44 0, 50 0, 51 0, 71 0, 72 100, 73 1, 74 1, 75 1, 76 1, 77 0, 78 0) directly after `2 TABLES`, then LTYPE (CONTINUOUS, CENTER x25.4, DASHED x25.4 with 72=65), then LAYER (26 layers, no 370), then STYLE txt, then VIEW/UCS empty, APPID ACAD, DIMSTYLE STANDARD (41/42/43/44/50/51 etc.) before `ENDSEC`. Verified via `ezdxf` file structure docs (HEADER first, VPORT 10/20 11/21 12/22 40 41).

### Section ordering / EOF / handles / ownership / layers / text / viewport / extents / units / coordinates
- Sections strictly `HEADER → TABLES → BLOCKS → ENTITIES`, each `ENDSEC`, final `EOF`.
- No handles (5) or ownership (360) — R13+ codes absent.
- All 26 layers present (`A-WALL-EXT`, `A-WALL-INT`, `A-DOOR`, `A-WINDOW`, `A-ROOM`, etc.) with ACI colors, linetype `CENTER` scaled x25.4 for mm (50.8, 19.05).
- Text: `STYLE` is `txt` (SHX), every `TEXT` value passed through `dxfSafeText` (Persian transliterated, ASCII ≤0x7e, 72=0).
- Viewport: `*ACTIVE` covers drawing via `viewH = max(envelope.height, envelope.width/aspect) *1.15`, center at envelope midpoint, aspect 1024/768.
- Extents: header `$EXTMIN/$EXTMAX` = entity envelope (mm), `$LIMMIN/$LIMMAX` same, validated that every `LINE`/`VERTEX` point lies inside.
- Units: `$LUNITS 2` decimal, coordinates in mm (m×1000), no `$INSUNITS`.

## 3. Writer Sections (`packages/core/src/dxf/writer.ts`)
- `b` starts `0 SECTION 2 HEADER` with `$ACADVER AC1009` + placeholder `$EXTMIN 1e20` (later replaced).
- Tracks `extMin/extMax` via `track()`.
- Emitters: `emitLine`, `emitArc`, `emitText`, `emitPolyline`/`emitVertex`/`emitSeqend` with 30/31/42.
- `final` header rebuilt at end with real extents, `$LIMMIN/$LIMMAX`, `$VIEWCTR/$VIEWSIZE`, `$VIEWDIR`, `$LUNITS`, no R13 vars.
- Tables, Blocks (`*Model_Space`, `*Paper_Space` at 0,0,0 with handle 8/62), Entities, then `HEADER` splice + `TABLES` splice.
- `validateDXFStructure` now checks `$VIEWCTR/$VIEWSIZE/$EXTMIN/$EXTMAX/$LIMMIN/$LIMMAX` present, `$SCREENSIZE/$DWGCODEPAGE/$INSUNITS/$MEASUREMENT` absent, `*ACTIVE`, `VPORT`, `APPID`, `DIMSTYLE` present, and no 370.

## 4. Browser Download Path
`packages/web/src/App.tsx` does `new Blob([dxf], {type: 'application/dxf'})` via `URL.createObjectURL` and `a.download`. The diagnostic `check_dxf.mjs` compares `exportDXF()` string vs `Blob` text — must be byte-identical (CRLF preserved, no UTF-8 BOM). No transformation, no base64.

## 5. Regression Test
`packages/core/src/dxf/envelope.test.ts` — “Downloaded DXF must contain visible modelspace geometry inside sane envelope”:
- Generates 15.5×22 south 6m 1F 3BD (the failing scenario).
- Calls `exportDXF` and `writeDXF`, asserts byte-identical.
- Asserts header conservative vars, no R13 vars, `*ACTIVE` first.
- Computes header envelope vs entity envelope, asserts `$EXTMIN < $EXTMAX`, `VIEWCTR` inside, `VIEWSIZE` covers envelope via `viewW = viewH * aspect`.
- Asserts every `LINE` point inside header envelope (no geometry outside view).
- Notes `AutoCAD display verification unavailable in CI — this test proves structural visibility, not application rendering`.

## 6. Verification
- `npm test` : `validateDXFStructure` ok, `R12Analysis` passes for 15×22/18×25/15×20, LTYPE 72=65, no 370, `txt` font, ASCII-safe, entity vocab strict, deterministic bytes.
- Manual ezdxf audit: 0, but ezdxf is permissive — real proof is the envelope test above + conservative header (no R13 vars).
- AutoCAD live verification: **unavailable in this sandbox** (no AutoCAD install). The writer maximizes conservative R12 (header minimal, VPORT first, 30/31 on all points, mm scale) to maximize compatibility; the envelope test is the strongest in-repo proxy.

## 7. Remaining Limitations
- `$VIEWDIR` is fixed 0,0,1 (top view) — sufficient for 2D plan.
- No `$MEASUREMENT` (R13) — units are mm via `$LUNITS 2` and coordinate scale.
- No handles — R12 does not require them.
- Persian text is transliterated — no Unicode in DXF (R12 is 7-bit).
