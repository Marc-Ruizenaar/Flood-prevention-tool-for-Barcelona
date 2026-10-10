"""Shared Pydantic schemas (owned by Agent 4 / Integration; changes need review)."""
from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class DatasetStatus(StrEnum):
    APPROVED = "APPROVED"
    CONDITIONAL = "CONDITIONAL"
    REJECTED = "REJECTED"
    MISSING = "MISSING"
    PENDING = "PENDING"


class ValueKind(StrEnum):
    """Epistemic class of a value (spec rule 5)."""
    MEASUREMENT = "measurement"
    ESTIMATE = "estimate"
    ASSUMPTION = "assumption"
    SIMULATED = "simulated"
    OBSERVED_OUTCOME = "observed_outcome"  # evaluation only, never an input


class ProbeResult(BaseModel):
    url: str
    http_status: int | None = Field(None, description="None = connection failed/timeout")
    probed_at: datetime
    note: str = ""


class DatasetEntry(BaseModel):
    id: str
    name: str
    category: Literal["rainfall", "radar", "dem", "land_cover", "buildings", "roads",
                      "soil", "drainage", "boundary"]
    provider: str
    status: DatasetStatus
    access: str
    units: str | None = None
    crs: str | None = None
    vertical_datum: str | None = None
    spatial_resolution: str | None = None
    temporal_resolution: str | None = None
    covers_2026_10_03_to_07: bool | None = Field(None, description="None = not verified")
    probes: list[ProbeResult] = []
    warnings: list[str] = []
    licence: str | None = None


class DatasetInventory(BaseModel):
    schema_version: str
    generated_at: datetime
    period_local: tuple[date, date]
    timezone: str
    datasets: list[DatasetEntry]


class InfiltrationParams(BaseModel):
    model: Literal["green_ampt", "none"] = "green_ampt"
    k_sat_m_s: float = Field(ge=0, description="Saturated hydraulic conductivity [m/s]")
    psi_m: float = Field(ge=0, description="Wetting-front suction head [m]")
    delta_theta: float = Field(ge=0, le=1, description="Moisture deficit [-]")


class SimulationConfig(BaseModel):
    config_version: str = "0.1.0"
    crs: str = Field("EPSG:25831", description="Projected CRS in metres (ETRS89 / UTM 31N)")
    dx_m: float = Field(gt=0)
    start_utc: datetime
    end_utc: datetime
    output_interval_s: float = Field(gt=0)
    cfl_alpha: float = Field(0.7, gt=0, le=1)
    manning_n: float = Field(gt=0, description="s m^-1/3")
    infiltration: InfiltrationParams | None = None
    drainage_capacity_m_s: float = Field(0.0, ge=0)
    h_dry_m: float = Field(1e-6, ge=0)
    report_timezone: str = "Europe/Madrid"


class Quantity(BaseModel):
    value: float | None
    unit: str
    kind: ValueKind


class CellOutput(BaseModel):
    cell_id: str
    x_m: float
    y_m: float
    crs: str
    date_local: date
    max_depth: Quantity
    max_velocity: Quantity
    time_of_max_utc: datetime | None
    duration_above_threshold_s: Quantity
    threshold_m: float
    uncertainty: str
    provenance_run_id: str


class DailySummary(BaseModel):
    date_local: date
    timezone: str
    window_utc: tuple[datetime, datetime]
    rainfall_volume_m3: float
    infiltration_volume_m3: float
    drainage_volume_m3: float
    boundary_outflow_volume_m3: float
    storage_start_m3: float
    storage_end_m3: float
    mass_balance_error_rel: float
    max_depth_m: float
    wet_cells_max: int
    data_completeness: float = Field(ge=0, le=1)
    kind: ValueKind = ValueKind.SIMULATED
    status: Literal["SIMULATED", "INCOMPLETE", "NOT_RUN"]
    warnings: list[str] = []


class AgentStatus(StrEnum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    PASSED = "PASSED"
    FAILED = "FAILED"


class AgentReport(BaseModel):
    agent: Literal["agent1_data", "agent2_hydrology", "agent3_audit", "agent4_orchestrator",
                   "agent5_api"]
    task_id: str
    status: AgentStatus
    summary: str
    artifacts_changed: list[str]
    tests_run: int
    tests_passed: int
    tests_failed: int
    blocking_issues: list[str]
    assumptions: list[str]
    next_actions: list[str]


class ErrorBody(BaseModel):
    error: str
    detail: str
    status_code: int
