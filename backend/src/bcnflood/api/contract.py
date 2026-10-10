"""API-side mapping to contract v0.2 (owned by Agent 5). The models are imported from the shared
schemas (bcnflood.schemas.contract_v02, owned by Agent 4); this module holds no duplicates."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel

from bcnflood.schemas import Quantity, ValueKind
from bcnflood.schemas.contract_v02 import (
    CONTRACT_VERSION,
    DATA_COMPLETENESS_PROVISIONAL_WARNING,
    CellOutputV02,
    DailySummaryV02,
)

__all__ = ["CONTRACT_VERSION", "CellOutputV02", "DailySummaryV02", "TimeseriesPointV02",
           "TimeseriesV02", "daily_from_solver", "not_run_daily", "q"]

SIM, ASSUMP = ValueKind.SIMULATED, ValueKind.ASSUMPTION
SYNTHETIC_WARNING = "SYNTHETIC input, not Barcelona data"


def q(v, unit: str, kind: ValueKind = SIM) -> Quantity:
    return Quantity(value=None if v is None else float(v), unit=unit, kind=kind)


class TimeseriesPointV02(BaseModel):
    time_utc: datetime
    depth: Quantity            # m, simulated
    domain_storage: Quantity   # m3, simulated


class TimeseriesV02(BaseModel):
    contract_version: str = CONTRACT_VERSION
    run_id: str
    cell_id: str
    x: Quantity                # m, simulated (cell centre, crs below)
    y: Quantity
    crs: str
    synthetic: bool
    points: list[TimeseriesPointV02]
    warnings: list[str] = []


def _daily(run_id, date_local, timezone, window_utc, synthetic, status, vals, warnings):
    g = (lambda k: vals[k]) if vals else (lambda k: None)
    return DailySummaryV02(
        run_id=run_id, date_local=date_local, timezone=timezone, window_utc=window_utc,
        rainfall_volume=q(g("rain_m3"), "m3"), infiltration_volume=q(g("infil_m3"), "m3"),
        drainage_volume=q(g("drain_m3"), "m3", ASSUMP),
        boundary_outflow_volume=q(g("outflow_m3"), "m3"),
        storage_start=q(g("storage_start_m3"), "m3"), storage_end=q(g("storage_end_m3"), "m3"),
        mass_balance_error_rel=q(g("mass_balance_error_rel"), "1"),
        max_depth=q(g("max_depth_m"), "m"),
        data_completeness=q(1.0 if vals else None, "1", ASSUMP),
        status=status, synthetic=synthetic, warnings=warnings)


def daily_from_solver(row: dict, *, run_id: str, date_local: date, timezone: str,
                      window_utc: tuple[datetime, datetime], synthetic: bool,
                      drainage_capacity_m_s: float | None) -> DailySummaryV02:
    """Map one solver.daily.daily_summaries row. Values are copied verbatim, never derived.
    Solver SIMULATED -> SIMULATED; any other solver state -> INCOMPLETE (all values null)."""
    w = [SYNTHETIC_WARNING] if synthetic else []
    w.append(f"ASSUMPTION drainage scenario: capacity {drainage_capacity_m_s} m/s")
    if row.get("status") == "SIMULATED":
        w.append(DATA_COMPLETENESS_PROVISIONAL_WARNING)
        return _daily(run_id, date_local, timezone, window_utc, synthetic, "SIMULATED", row, w)
    return _daily(run_id, date_local, timezone, window_utc, synthetic, "INCOMPLETE", None,
                  w + ["Solver output does not cover this local day"])


def not_run_daily(*, run_id: str, date_local: date, timezone: str,
                  window_utc: tuple[datetime, datetime]) -> DailySummaryV02:
    """No run has been executed for this day: status NOT_RUN, every value null."""
    return _daily(run_id, date_local, timezone, window_utc, False, "NOT_RUN", None,
                  ["No simulation executed for this day"])
