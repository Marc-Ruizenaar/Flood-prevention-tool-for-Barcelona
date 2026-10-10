"""Drainage-capacity ASSUMPTION scenarios (Agent 2). Loads config/drainage_scenarios.json.

Every scenario is kind="assumption": no primary drainage data exists (manifest status MISSING).
Returned rates are SI [m/s] for ``Domain.drainage_capacity``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[3] / "config" / "drainage_scenarios.json"
MM_H = 1e-3 / 3600.0


@dataclass(frozen=True)
class DrainageScenario:
    name: str
    capacity_mm_h: float
    kind: str = "assumption"

    @property
    def capacity_m_s(self) -> float:
        return self.capacity_mm_h * MM_H


def load_scenarios(path: Path | str = DEFAULT_PATH) -> dict[str, DrainageScenario]:
    d = json.loads(Path(path).read_text())
    if d.get("kind") != "assumption" or d.get("unit") != "mm/h":
        raise ValueError("drainage scenarios must be kind=assumption with unit mm/h")
    out = {}
    for s in d["scenarios"]:
        if s.get("kind") != "assumption" or s["capacity_mm_h"] < 0:
            raise ValueError(f"invalid drainage scenario {s}")
        out[s["name"]] = DrainageScenario(s["name"], float(s["capacity_mm_h"]))
    return out
