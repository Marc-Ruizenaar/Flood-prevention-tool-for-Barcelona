"""G5: D5's missing half-hours (2026-10-03T21:30-23:00Z) must make local 3 and 4 Oct INCOMPLETE
in local-day aggregation (Agent 3). Uses the stored raw XEMA file; no network, no model run."""
import json
import pathlib
from datetime import UTC, date, datetime, timedelta

import pytest

tw = pytest.importorskip("bcnflood.data.timewindows")
RAW = (pathlib.Path(__file__).resolve().parents[1] / "manifests" / "raw" / "g1"
       / "xema_D5_20261001T22Z_20261007T22Z.json")


def _series():
    if not RAW.exists():
        pytest.skip("raw D5 file absent")
    d = json.loads(RAW.read_text())
    rows = d if isinstance(d, list) else d.get("records", d.get("data", d))
    ts, vals = [], []
    for r in rows:
        if str(r.get("codi_variable")) != "35":
            continue
        ts.append(datetime.fromisoformat(r["data_lectura"][:19]).replace(tzinfo=UTC))
        vals.append(float(r["valor_lectura"]))
    return ts, vals


def test_d5_gap_marks_3_and_4_oct_incomplete():
    ts, vals = _series()
    agg = tw.aggregate_by_local_day(ts, vals, timedelta(minutes=30), date(2026, 10, 2),
                                    date(2026, 10, 7))
    by = {a.local_date: a for a in agg}
    def complete(a):
        for k in ("complete", "is_complete"):
            if hasattr(a, k):
                return bool(getattr(a, k))
        return a.n_present == a.n_expected
    assert not complete(by[date(2026, 10, 3)])
    assert not complete(by[date(2026, 10, 4)])
    for k in (2, 5, 6, 7):
        assert complete(by[date(2026, 10, k)])
