"""Shared schemas for API contract v0.2 (owned by Agent 4; adopted from Agent 5's
api/contract.py per review docs/reviews/contract_v0.2_review.md).

G7 rule: every numeric output is a Quantity (value + unit + kind), including coordinates
and thresholds. Fixed unit/kind constraints are enforced by validators below.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, model_validator

from bcnflood.schemas import Quantity, ValueKind

CONTRACT_VERSION = "0.2.0"
DATA_COMPLETENESS_PROVISIONAL_WARNING = (
    "PROVISIONAL: data_completeness is a placeholder until rainfall QC (M2-A1-01) lands")


def _check(q: Quantity, name: str, unit: str, kinds: set[ValueKind]) -> None:
    if q.unit != unit:
        raise ValueError(f"{name}: unit must be '{unit}', got '{q.unit}'")
    if q.kind not in kinds:
        raise ValueError(f"{name}: kind must be one of {sorted(k.value for k in kinds)}, "
                         f"got '{q.kind.value}'")


_SIM = {ValueKind.SIMULATED}


class DailySummaryV02(BaseModel):
    contract_version: Literal["0.2.0"] = CONTRACT_VERSION
    run_id: str
    date_local: date
    timezone: str
    window_utc: tuple[datetime, datetime]
    rainfall_volume: Quantity           # m3, simulated
    infiltration_volume: Quantity       # m3, simulated
    drainage_volume: Quantity           # m3, assumption (no APPROVED drainage data, G4)
    boundary_outflow_volume: Quantity   # m3, simulated
    storage_start: Quantity             # m3, simulated
    storage_end: Quantity               # m3, simulated
    mass_balance_error_rel: Quantity    # 1, simulated
    max_depth: Quantity                 # m, simulated
    data_completeness: Quantity         # 1 (fraction 0..1), assumption (provisional)
    status: Literal["SIMULATED", "INCOMPLETE", "NOT_RUN"]
    synthetic: bool
    warnings: list[str] = []

    @model_validator(mode="after")
    def _validate(self) -> DailySummaryV02:
        s, e = self.window_utc
        if s.tzinfo is None or e.tzinfo is None or s.utcoffset() or e.utcoffset():
            raise ValueError("window_utc must be timezone-aware UTC")
        if not e > s:
            raise ValueError("window_utc end must be after start")
        for n in ("rainfall_volume", "infiltration_volume", "boundary_outflow_volume",
                  "storage_start", "storage_end"):
            _check(getattr(self, n), n, "m3", _SIM)
        _check(self.drainage_volume, "drainage_volume", "m3", {ValueKind.ASSUMPTION})
        _check(self.mass_balance_error_rel, "mass_balance_error_rel", "1", _SIM)
        _check(self.max_depth, "max_depth", "m", _SIM)
        _check(self.data_completeness, "data_completeness", "1", {ValueKind.ASSUMPTION})
        dc = self.data_completeness.value
        if dc is not None:
            if not 0.0 <= dc <= 1.0:
                raise ValueError("data_completeness must be within [0, 1]")
            if DATA_COMPLETENESS_PROVISIONAL_WARNING not in self.warnings:
                raise ValueError("non-null data_completeness requires the PROVISIONAL warning")
        nums = [getattr(self, n).value for n in type(self).model_fields
                if isinstance(getattr(self, n), Quantity)]
        if self.status != "SIMULATED" and any(v is not None for v in nums):
            raise ValueError(f"status {self.status} requires all values null (no invented values)")
        if self.status == "SIMULATED" and any(v is None for v in nums):
            raise ValueError("status SIMULATED requires all values present")
        return self


class CellOutputV02(BaseModel):
    """Per-cell output. x_m/y_m/threshold_m are Quantities too (G7, no exemptions)."""
    contract_version: Literal["0.2.0"] = CONTRACT_VERSION
    cell_id: str
    x: Quantity                         # m (in crs), simulated (grid geometry)
    y: Quantity
    crs: str
    date_local: date
    max_depth: Quantity                 # m, simulated
    max_velocity: Quantity              # m/s, simulated
    time_of_max_utc: datetime | None
    duration_above_threshold: Quantity  # s, simulated
    threshold: Quantity                 # m, assumption (configured threshold)
    uncertainty: str
    provenance_run_id: str

    @model_validator(mode="after")
    def _validate(self) -> CellOutputV02:
        # Cell-centre coordinates are derived from the model grid (simulation geometry).
        _check(self.x, "x", "m", _SIM)
        _check(self.y, "y", "m", _SIM)
        _check(self.max_depth, "max_depth", "m", _SIM)
        _check(self.max_velocity, "max_velocity", "m/s", _SIM)
        _check(self.duration_above_threshold, "duration_above_threshold", "s", _SIM)
        _check(self.threshold, "threshold", "m", {ValueKind.ASSUMPTION})
        if self.time_of_max_utc is not None and (
                self.time_of_max_utc.tzinfo is None or self.time_of_max_utc.utcoffset()):
            raise ValueError("time_of_max_utc must be timezone-aware UTC")
        return self


GateState = Literal["PASSED", "FAILED", "PENDING", "UNKNOWN"]


class GateStatus(BaseModel):
    id: Literal["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]
    name: str
    status: GateState
    evidence: str = ""


class GateReport(BaseModel):
    source: str
    source_found: bool
    all_passed: bool
    gates: list[GateStatus]

    @model_validator(mode="after")
    def _validate(self) -> GateReport:
        ok = (self.source_found and len(self.gates) == 8
              and all(g.status == "PASSED" for g in self.gates))
        if self.all_passed != ok:
            raise ValueError("all_passed must be true iff file found and all 8 gates PASSED")
        return self


__all__ = ["CONTRACT_VERSION", "DATA_COMPLETENESS_PROVISIONAL_WARNING", "CellOutputV02",
           "DailySummaryV02", "GateReport", "GateState", "GateStatus"]
