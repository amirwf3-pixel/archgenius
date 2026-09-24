# Accessibility checks (standalone, advisory)

`validateAccessibility(candidate)` (exported from `@archgenius/core`, source
`packages/core/src/validation/accessibility.ts`) runs a deterministic 2D
**step-free route** analysis on a generated candidate.

## Status — read first

- The repository contains **no verified accessibility requirement**. There is no
  accessible route width, door clear width, turning circle, ramp slope,
  level-change rule, or clause saying which buildings must be accessible.
- Every finding is therefore `severity: advisory` with
  `status: REQUIRES_SOURCE_VERIFICATION`. It is never HARD or soft, and it never
  claims compliance.
- **Getting no findings is not an accessibility PASS.** Clear widths, door
  widths, turning spaces, thresholds and ramps are not assessed.
- The validator is **standalone**. It is not merged into `validateLayout()`,
  `validateCandidate()` or `candidate.findings`, so generation, feasibility,
  ranking, reports and DXF output are unchanged. Callers opt in explicitly.

## Route model (no thresholds involved)

| Element | Rule |
|---|---|
| Origin | Ground-floor openings of type `entrance` on an `exterior` wall that faces the floor's access (street) side. The facade test is the same `wallSide()` check over the building bounding box that `validateCirculation` uses. If the floor has no access side recorded, any exterior `entrance` opening qualifies. The origin is the interior space on that wall (`spaceIds[0]`, otherwise `spaceIds[1]`), unless it is `parking`, `yard` or `balcony`. Every qualifying door gives an origin. Unlike `validateCirculation`, which only accepts entrance, foyer, corridor, stair-hall, living or dining behind the street door, any other interior room type is accepted. |
| Same-floor edge | A `door` / `entrance` / `sliding-door` opening whose wall joins two spaces. Uses the same door graph as `validateCirculation`. |
| Vertical edge | Only an elevator shaft stacked exactly (same `coreId`, same rect) on both floors, joined through its elevator-hall spaces. **A stair is never step-free.** |
| Exempt spaces | `parking`, `yard`, `balcony`. Uses the same exemption set as `CIRC_INACCESSIBLE_SPACE`. |

## Finding codes

| Code | Meaning | Source status |
|---|---|---|
| `ACC_STEP_FREE_NO_ORIGIN` | No street entrance was found, so step-free access is **undetermined**. The result is never an empty pass. | No source; geometric only |
| `ACC_FLOOR_NOT_STEP_FREE` | No space on a floor can be reached without stairs. The message gives the reason: no elevator, the elevator doesn't serve this floor, or the landing is unreachable. `value` is the floor level. | No source; geometric only |
| `ACC_SPACE_NOT_STEP_FREE` | A space can't be reached without stairs, on a floor that is otherwise reached. | No source; geometric only |
| `ACC_ACCESSIBLE_SANITARY_ABSENT` | No sanitary space (`bathroom`, `master-bathroom`, `guest-wc`) that can be reached step-free fits 1.70 × 1.50 m. | The **dimension** is VERIFIED: Mabhas 4 (1396) §4-5-6-2-1, PDF p75, from the national pack's source registry. **Applicability** is REQUIRES_SOURCE_VERIFICATION. |

## Limitations

- The analysis is topological. Door and corridor clear widths along the route are not checked, because no verified value exists.
- The sanitary check measures the room rectangle (gross size), not the clear floor area around fixtures.
- Door swing, landing clearance in front of the elevator, thresholds and level changes are not modelled.
- The wheelchair lift cabin and door figures (Mabhas 15 §15-2-1-9) belong to `MBH15-LIFT-002`, which stays `NOT_IMPLEMENTED`.
- A general corridor-width clause (Mabhas 4 §7-1-1-6, 0.90 m) exists in the source registry. It was deliberately not added as a rule: it is not accessibility-specific, and the existing 1.10 m `CIRC_CORRIDOR_TOO_NARROW` design check already covers it.
