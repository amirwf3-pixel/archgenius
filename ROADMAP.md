# ArchGenius — Roadmap

## Phase 1 — Foundation (this milestone)
- [x] Repository scaffold (monorepo, TS, workspaces)
- [x] Domain model types (Project, Site, Building, Space, Wall, Opening, Floor, Layout)
- [x] Geometry primitives (Vec2, Rect, Polygon, overlap, area, distance)
- [x] Regulation abstraction (Rule, Pack, Severity, engine)
- [x] Validation abstraction (Finding, severity categories, validator pipeline)
- [x] DXF writer abstraction (ASCII R12, layers, LINE/TEXT/CIRCLE/ARC/LWPOLYLINE/HATCH/INSERT)
- [x] Testing infrastructure (Vitest, test categories)
- [x] ARCHITECTURE.md / DECISIONS.md / ROADMAP.md
- [x] Project persistence (JSON serializable model)

## Phase 2 — Real MVP engine (first working slice, this milestone)
- [x] Rectangular site input (width, length, north, access side, street width)
- [x] Parametric building input (villa / apartment, floors, units, bedrooms, baths, WCs, kitchen, parking, stair, elevator)
- [x] Space programming (derive rooms, target/min areas, adjacency)
- [x] Buildable-area from setbacks (stub regulation pack)
- [x] Deterministic slice-based layout generation for rectangular rooms
- [x] Wall generation (external + internal, thickness-aware, merged shared walls)
- [x] Door placement (entrance + internal doors on circulation)
- [x] Window placement on exterior walls
- [x] Stair placement (single rectangular flight in V1)
- [x] Parking placement (rectangular stalls on access side)
- [x] Geometric validation (overlap, zero-area, invalid dims, disconnected circulation)
- [x] Real DXF export with proper layers, walls, doors, windows, room labels, dimensions
- [x] Basic React UI: parameter form + canvas preview + DXF download
- [x] Automated tests (geometry, programming, generator, DXF structure)

## Phase 3 — Optimization & multiple candidates
- [ ] Three candidate strategies (efficiency / circulation / orientation)
- [ ] Scoring metrics (usable-area ratio, circulation ratio, wasted area, adjacency satisfaction, etc.)
- [ ] Deterministic optimization (penalty-driven local search / re-slicing)
- [ ] Multi-floor vertical circulation validation (stair/elevator alignment)
- [ ] Non-rectangular rooms (L-shape / rectilinear polygons)

## Phase 4 — Regulation packs
- [ ] National pack: Iran MBR (Mabhas-e 4 — residential requirements) — sourced
- [ ] Jurisdiction packs: Tehran, Karaj, Mashhad, Isfahan, Shiraz
- [ ] Zoning / setback / coverage / density / parking ratios
- [ ] Regulation explorer UI with source references
- [ ] Versioned pack loading & traceability

## Phase 5 — Professional deliverables & UI
- [ ] PDF sheet generation (title block, scaled plan, room schedule)
- [x] XLSX space schedule (implementation planned for Phase 5)
- [ ] Design report (Markdown/HTML/PDF) with assumptions, constraints, metrics, warnings
- [ ] Project management dashboard (list, save/load/import/export)
- [ ] Plan inspection UI (click room → dimensions, area, warnings)
- [ ] Better canvas preview (panning, zoom, dimension display, hatch)
- [ ] North arrow, grid axes, title block in DXF

## Phase 6 — Advanced cases & polish
- [ ] Irregular (L/T/U-shaped) sites
- [ ] Multi-unit apartments (per-unit layouts, shared cores)
- [ ] Balconies, storage rooms, utility, yard/courtyard
- [ ] Furniture placement (sanitary fixtures, kitchen blocks)
- [ ] Elevator shaft geometry
- [ ] Multi-section details
- [ ] Comprehensive regression suite & golden DXF fixtures
- [ ] Accessibility checks
- [ ] Performance profiling for large buildings

## Non-goals (for the foreseeable future)
- Image/PDF/DXF import
- Raster-to-CAD
- 3D visualization / BIM
- Commercial / hospital / educational / industrial typologies
- Cloud-dependent AI as a required component
