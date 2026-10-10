# Review: API contract v0.2 (M2-A4-01)

Reviewer: Agent 4 (Orchestrator). Date: 2026-10-09 (Europe/Madrid).
Reviewed: `docs/api/contract_v0.2.md`, `docs/api/openapi_v0.2.json`, `src/bcnflood/api/contract.py`,
commits aac60e6, 295f6a0, against `docs/milestone2_plan.md` §3 (G7) and `src/bcnflood/schemas/`.

**Verdict: CHANGES REQUIRED.** The contract structure is sound (Quantity wrapping, null-not-invented,
ErrorBody, 409/501 gating, local-day keys with 23 h/25 h windows). G7 stays PENDING until the items below land.

## Decisions (answers to Agent 5's open questions)
1. **DailySummaryV02 moves into shared schemas.** Created as `bcnflood.schemas.contract_v02.DailySummaryV02`
   (with validators). Agent 5 imports it; the API-local copy is removed.
2. **No G7 exemption.** `x_m`, `y_m`, `threshold_m` become Quantities. New shared model
   `CellOutputV02` with `x`, `y` (unit `m`, kind `simulated`: grid cell-centre geometry, CRS in `crs`),
   `threshold` (unit `m`, kind `assumption`: configured), `duration_above_threshold` (unit `s`).
   Legacy `CellOutput`/`DailySummary` stay unchanged for M1 compatibility but must not be served by v0.2 endpoints.
3. **Gate file confirmed:** `docs/release_gates.json`, format `{"gates": {"G1": {"status": ..., "evidence": ...}}}`,
   uppercase statuses. Shared `GateStatus`/`GateReport` models added (`all_passed` validated as
   "file found and all 8 PASSED").
4. **data_completeness stays a provisional placeholder**, but it may not be labelled `simulated`
   (a hardcoded 1.0 is not a model output). Required: unit `1`, kind `assumption`, and the warning
   `DATA_COMPLETENESS_PROVISIONAL_WARNING` in `warnings` whenever the value is non-null. Enforced by the schema.
5. **drainage_volume kind = `assumption`** (no APPROVED drainage data; G4 is an ASSUMPTION scenario). Enforced by the schema.

## Required changes for Agent 5
- R1. Delete `DailySummaryV02` from `src/bcnflood/api/contract.py`; import it from `bcnflood.schemas.contract_v02`.
- R2. In `daily_from_solver`: `drainage_volume` kind `assumption`; `data_completeness` kind `assumption`
  and append `DATA_COMPLETENESS_PROVISIONAL_WARNING` to `warnings` for SIMULATED rows.
- R3. Serve `/cells` (when implemented) with `CellOutputV02`, not the legacy `CellOutput`; update contract doc table.
- R4. Replace API-local `Gate`/`GateReport` in `gates.py` with `bcnflood.schemas.contract_v02.GateStatus`/`GateReport`.
- R5. OpenAPI export is incomplete: `components.schemas` lists only DatasetEntry/Inventory/Status, Gate,
  GateReport, ProbeResult and validation errors. Declare `response_model`/`responses` so
  `DailySummaryV02`, `CellOutputV02`, `Quantity`, `ValueKind` and `ErrorBody` (for 404/409/501) appear; regenerate `openapi_v0.2.json`.
- R6. Contract doc: change the drainage and data_completeness Kind cells, remove the "non-compliant bare numbers"
  and open-questions sections (resolved here), and change the header to "FROZEN" after R1–R5.
- R7. `tests/test_api.py`: add checks that every Quantity in v0.2 responses has a non-empty unit and a valid kind,
  that drainage/data_completeness are `assumption` with the provisional warning, and that INCOMPLETE rows are all-null
  (the shared schema now rejects mixed rows and SIMULATED rows with nulls).
- R8. `status` mapping: the solver row's non-SIMULATED states are all mapped to INCOMPLETE; NOT_RUN must be
  representable (no run executed). Keep it explicit.
- Note: A5's e2e still uses a zoneinfo stand-in; swap to `bcnflood.data.timewindows` once A1-02 is committed
  (it is currently untracked in the working tree).

## Not changed
No edits to `src/bcnflood/api/`, `tests/`, or `docs/api/`. Gate file untouched (G7 remains PENDING).
