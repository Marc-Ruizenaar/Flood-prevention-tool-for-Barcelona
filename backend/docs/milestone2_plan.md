# Milestone 2 Plan: Barcelona Flood Physics Engine

Author: Agent 4 (Orchestrator). Date: 2026-10-09 (Europe/Madrid). Baseline: commit 3b3fbe5 (M1 + synthetic benchmark, 16/16 tests, ruff clean).

Status: **RELEASE GATE CLOSED.** This milestone covers no Barcelona simulation and releases no Barcelona results.

## 1. Agent roles (reconciled)

The spec copy used in M1 was truncated, and M1 *assumed* the roles of Agents 3 and 5. These roles are reconciled against the agent profiles:

| Agent | Role | Owned paths (derived from repo layout) |
|---|---|---|
| 1 | Data & Geospatial | `src/bcnflood/data/`, `manifests/`, `config/` (data sources and adapter config) |
| 2 | Hydrology & Math physics engine (local-inertial) | `src/bcnflood/solver/` |
| 3 | Scientific Auditor | `tests/` (all except `tests/test_api.py`), `docs/audit/` (new) |
| 4 | Orchestrator | `src/bcnflood/schemas/`, `docs/` (plans, reports, except `docs/audit/` and `docs/api/`), release gate, merges |
| 5 | Viz & Integration QA / API contract | `src/bcnflood/api/`, `tests/test_api.py`, `docs/api/` (new) |

Rules: an agent writes only inside its own paths. Changes to shared schemas go to Agent 4 as a request. Agent 2 does not edit tests to make them pass. Agent 3 does not edit the solver. A test for a module is written by Agent 3 (or by Agent 5 for the API) against the interface the owner exposes.

## 2. Goals

1. Get the Barcelona inputs to verified status, or record why they are blocked: rainfall (time zone, units, QC), DEM, land cover/soil, buildings, drainage.
2. Build the conversion from a Europe/Madrid local day to a UTC window, including DST.
3. Add grid-resolution and time-step sensitivity (convergence) evidence for the solver.
4. Have the M1 synthetic benchmark audited independently.
5. Freeze the API contract for runs and daily summaries, with provenance labels.
6. Define and automate the release gates (below).

## 3. Release gates (all must be PASSED before any Barcelona simulation or result release)

| Gate | Condition | Evidence owner |
|---|---|---|
| G1 Rainfall | The rainfall dataset is APPROVED in `manifests/datasets.json`. Time zone, units and QC flags are verified against Meteocat metadata/API. | A1, audited by A3 |
| G2 Terrain | A DEM is APPROVED with known CRS (EPSG:25831), vertical datum and resolution, and its BCN coverage is checked. | A1, audited by A3 |
| G3 Surface params | Land cover, imperviousness, Manning n and Green-Ampt parameters are APPROVED or explicitly labelled ESTIMATE/ASSUMPTION with sources. | A1 |
| G4 Drainage | Drainage is APPROVED data, **or** each run is labelled an ASSUMPTION scenario with a capacity sweep, and Marc signs this off. | A1 / Marc |
| G5 Time | The local-day to UTC conversion is implemented and tested (incl. DST transition days). Daily outputs use local days. | A1, A3 |
| G6 Numerics | The synthetic benchmark audit PASSED. Grid and Δt convergence tests PASSED within the stated tolerances. Mass balance < 1e-9. | A2, A3 |
| G7 Contract | The API contract is frozen. Every numeric output carries a unit and kind (measurement/estimate/assumption/simulated). No invented values. | A5, A3 |
| G8 Sign-off | Agent 3 audit report PASSED for G1–G7. Agent 4 approves. Marc approves the first Barcelona run. | A3, A4, Marc |

Until G1–G8 pass, API run endpoints keep returning 409/501, and `DailySummary.status` stays `NOT_RUN`.

## 4. Tasks

### Agent 1: Data & Geospatial (`src/bcnflood/data/`, `manifests/`, `config/`)

**M2-A1-01 XEMA rainfall verification**
- Deliverables: XEMA adapter in `src/bcnflood/data/xema.py` (open-data mirror, plus the official API once a key exists). Manifest entry updated with timestamp TZ, units and `codi_estat` QC handling evidenced from Meteocat variable/station metadata.
- Acceptance: TZ and units are confirmed from a primary source (cited in the manifest probes). QC flags are mapped, and invalid or provisional records are excluded or flagged. D5 gaps on 3 Oct are reported. Status is moved to APPROVED or REJECTED with reasons.
- Depends on: Meteocat API key from Marc (recommended for the primary-source check). M2-A1-02.

**M2-A1-02 Local-day to UTC conversion**
- Deliverables: `src/bcnflood/data/timewindows.py`, which maps a local date (Europe/Madrid, zoneinfo) to a [start, end) UTC window. Also a function for aggregating series by local day.
- Acceptance: Agent 3 tests pass for normal days (UTC+2 window 22:00Z–22:00Z), the 23 h day (last Sunday of March) and the 25 h day (last Sunday of October). The 3–7 Oct 2026 daily totals are recomputed by local day.
- Depends on: none.

**M2-A1-03 DEM acquisition**
- Deliverables: the working ICGC MET (2 m/5 m) endpoint, or the IGN MDT WCS fallback, clipped to a BCN AOI in EPSG:25831. Manifest entry with resolution, vertical datum and coverage.
- Acceptance: a raster loads, has the correct CRS and a NoData mask, and its elevation range is plausible (0 to about 512 m, Tibidabo). The datum is documented. Status is APPROVED or CONDITIONAL with reasons.
- Depends on: none (network). An ICGC contact/endpoint from Marc if no public route exists.

**M2-A1-04 Buildings, land cover, soil**
- Deliverables: a retry of Catastro INSPIRE BU WFS and Barcelona Open Data (with backoff, or an alternative network path). SIOSE vector download (not WMS). Pedotransfer Green-Ampt and Manning tables in `config/`.
- Acceptance: each dataset has a manifest status and probe evidence. Derived parameters are labelled ESTIMATE with citations.
- Depends on: network reachability (may need Marc).

**M2-A1-05 Drainage data search / assumption scenario spec**
- Deliverables: a manifest entry for BCASA sewer capacity (request status), or an ASSUMPTION scenario definition (capacity sweep, e.g. 0/10/20/30 mm/h equivalent) in `config/`.
- Acceptance: the drainage entry is never marked APPROVED without a primary source. The scenario spec is explicitly labelled ASSUMPTION.
- Depends on: Marc (BCASA data request, or sign-off on assumption scenarios).

### Agent 2: Hydrology & Math (`src/bcnflood/solver/`)

**M2-A2-01 Convergence harness**
- Deliverables: solver-side utilities to run a case at Δx, Δx/2, Δx/4 and at α ∈ {0.7, 0.35, 0.175}, or with fixed Δt refinement. Includes restriction/comparison helpers. Pure NumPy, no IO.
- Acceptance: the interface is documented. Agent 3 can drive it from tests. It does not change existing results (16/16 still pass, bit-identical).
- Depends on: none.

**M2-A2-02 Analytic reference cases**
- Deliverables: a kinematic-wave planar runoff case and a Thacker (or 1D dam-break with the local-inertial-appropriate regime) case setup in the solver package, with documented expected behaviour.
- Acceptance: the observed convergence order is reported to Agent 3. The limitation for Fr > ~0.5 is documented.
- Depends on: M2-A2-01.

**M2-A2-03 Raster input interface**
- Deliverables: a solver entry point that takes validated arrays (z, n, Green-Ampt fields, drainage, mask, buildings-as-blocked) and a rainfall time series/field, with no data fetching.
- Acceptance: the shapes and units are validated. Synthetic tests pass. No Barcelona run is executed.
- Depends on: an Agent 4 schema decision on raster inputs. M2-A1-03 (format only).

### Agent 3: Scientific Auditor (`tests/` excl. `test_api.py`, `docs/audit/`)

**M2-A3-01 Audit of the M1 synthetic benchmark** (priority)
- Deliverables: `docs/audit/m2_synthetic_benchmark_audit.md` as an AgentReport with PASSED/FAILED per test.
- Scope: independent re-derivation of the local-inertial update and the Green-Ampt formula. The mass-ledger definition and denominator. Whether the 1e-9 tolerance is meaningful given the conservative-by-construction scheme, with independent ledger checks. The depression sill test (0.5007 m vs ±0.02 m). The midnight restart equivalence. Checks for tautological tests. Seeds and determinism.
- Acceptance: every M1 test is classified (valid / weak / invalid), with fixes requested from the owners. Results are reproduced from a clean checkout of 3b3fbe5.
- Depends on: none.

**M2-A3-02 Grid and time-step sensitivity tests**
- Deliverables: `tests/test_convergence.py`, which uses the M2-A2-01 harness and the M2-A2-02 cases.
- Acceptance: the tolerances are stated beforehand (e.g. relative change in peak depth/outflow < 5% between the two finest levels, observed order ≥ ~1 against the analytic case). Mass balance < 1e-9 at all levels.
- Depends on: M2-A2-01, M2-A2-02.

**M2-A3-03 Time-window tests**
- Deliverables: `tests/test_timewindows.py` (DST days, 3–7 Oct windows, aggregation completeness flags).
- Acceptance: covers G5. Fails on naive or UTC-assumed implementations.
- Depends on: M2-A1-02 interface.

**M2-A3-04 Data audit**
- Deliverables: `docs/audit/m2_data_audit.md`, covering the review of the G1–G4 manifest evidence.
- Acceptance: each gate is marked PASSED/FAILED with reasons.
- Depends on: M2-A1-01, -03, -04, -05.

### Agent 5: Viz & Integration QA / API contract (`src/bcnflood/api/`, `tests/test_api.py`, `docs/api/`)

**M2-A5-01 API contract freeze**
- Deliverables: `docs/api/contract_v0.2.md` plus the OpenAPI export. Endpoints: /datasets, /runs (POST gated), /runs/{id}, /runs/{id}/daily, /cells. Error bodies follow `ErrorBody`.
- Acceptance: every numeric output field carries `Quantity` (unit + kind). Gated endpoints return 409 with the gate status while gates are closed.
- Depends on: Agent 4 schema review.

**M2-A5-02 Gate status endpoint**
- Deliverables: a read-only `GET /gates` that reports G1–G8 status (from a gate file maintained by Agent 4).
- Acceptance: tests in `tests/test_api.py` cover the closed state. Run creation is refused when any gate ≠ PASSED.
- Depends on: M2-A5-01.

**M2-A5-03 Integration QA (synthetic only)**
- Deliverables: an end-to-end test from the synthetic config through the solver stub to the API daily summary, with the local-day labels from M2-A1-02.
- Acceptance: uses synthetic inputs only. Values are traceable to the solver output. No invented numbers.
- Depends on: M2-A1-02, M2-A2-03.

### Agent 4: Orchestrator (`src/bcnflood/schemas/`, `docs/`)
- M2-A4-01: schema additions (raster input spec, gate status model), reviewed with A2/A5.
- M2-A4-02: maintain the gate file and merge only owner-path-clean commits.

## 5. Needs Marc

1. **Meteocat XEMA API key** (X-Api-Key), for primary-source verification of TZ, units and QC (G1).
2. **AEMET OpenData API key**, as a cross-check source.
3. **Socrata app token** (Transparència Catalunya), optional, to avoid 429 rate limits.
4. **Drainage**: a BCASA sewer capacity data request, **or** sign-off that M2/M3 runs use labelled ASSUMPTION drainage scenarios (G4).
5. **DEM**: confirmation of the ICGC download route or account, or acceptance of the IGN MDT fallback (G2).
6. **Network**: Barcelona Open Data and Catastro time out from the box. Either allow an alternative network path, or supply the files manually.
7. **Original full spec**: to confirm the role reconciliation in §1.
8. **Final approval** of the first Barcelona run (G8).

## 6. Order of work
Parallel start: M2-A3-01, M2-A1-02, M2-A1-03, M2-A2-01, M2-A5-01. Then: A3-03, A2-02 → A3-02, A1-01/04/05 → A3-04, A5-02/03. Gate review at the end of M2. No Barcelona run in M2 unless G1–G8 pass.
