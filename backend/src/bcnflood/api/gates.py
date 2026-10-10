"""Release-gate status (read-only, owned by Agent 5). The gate file docs/release_gates.json is
maintained only by Agent 4. A missing file, missing gate or unrecognised status -> UNKNOWN."""
from __future__ import annotations

import json
import os
from pathlib import Path

from bcnflood.schemas.contract_v02 import GateReport, GateStatus

GATE_IDS = ("G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8")
GATE_NAMES = {"G1": "Rainfall", "G2": "Terrain", "G3": "Surface params", "G4": "Drainage",
              "G5": "Time", "G6": "Numerics", "G7": "Contract", "G8": "Sign-off"}
DEFAULT_GATE_FILE = Path(__file__).resolve().parents[3] / "docs" / "release_gates.json"


def gate_file() -> Path:
    return Path(os.environ.get("BCNFLOOD_GATES", DEFAULT_GATE_FILE))


def load_gates() -> GateReport:
    path = gate_file()
    try:
        raw = json.loads(path.read_text()).get("gates", {})
        found = isinstance(raw, dict)
    except (OSError, ValueError, AttributeError):
        raw, found = {}, False
    raw = raw if found else {}
    gates = []
    for gid in GATE_IDS:
        e = raw.get(gid, {})
        e = e if isinstance(e, dict) else {}
        st = e.get("status")
        st = st if st in ("PASSED", "FAILED", "PENDING") else "UNKNOWN"
        gates.append(GateStatus(id=gid, name=str(e.get("name") or GATE_NAMES[gid]), status=st,
                                evidence=str(e.get("evidence", ""))))
    return GateReport(source=str(path), source_found=found,
                      all_passed=found and all(g.status == "PASSED" for g in gates), gates=gates)
