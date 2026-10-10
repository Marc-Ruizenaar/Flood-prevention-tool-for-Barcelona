"""XEMA open-data adapter (Transparencia Catalunya Socrata ``nzvn-apee``).

Verified from the dataset column metadata (see manifests/g1_xema_evidence.md):
* ``data_lectura`` is UTC and labels the START of the interval.
* var 35 precipitation is mm per record; ``codi_base`` SH = 30 min, HO = hourly.
* ``codi_estat``: blank = validation not started, "T" = in validation, "V" = valid.
  Invalid values are not published.

Licence: Meteocat intellectual property (http://www.meteo.cat/wpweb/avis-legal/),
republished on Transparencia Catalunya.

This module only parses records. It does not aggregate by local day (that is
Agent 2's timewindows.py).
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

SOCRATA_URL = "https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json"
LICENCE = "Meteocat intellectual property - http://www.meteo.cat/wpweb/avis-legal/"
QC_LABELS = {"": "NOT_VALIDATED", "T": "IN_VALIDATION", "V": "VALID"}
BASE_STEP = {"SH": timedelta(minutes=30), "HO": timedelta(hours=1)}


@dataclass(frozen=True)
class XemaRecord:
    station: str
    variable: str
    start_utc: datetime  # interval start, aware UTC
    end_utc: datetime
    value: float
    qc: str  # NOT_VALIDATED | IN_VALIDATION | VALID

    @property
    def is_valid(self) -> bool:
        return self.qc == "VALID"


def parse_record(r: dict) -> XemaRecord:
    start = datetime.fromisoformat(r["data_lectura"]).replace(tzinfo=UTC)
    step = BASE_STEP[r["codi_base"]]
    estat = (r.get("codi_estat") or "").strip()
    if estat not in QC_LABELS:
        raise ValueError(f"unknown codi_estat {estat!r}")
    return XemaRecord(r["codi_estacio"], r["codi_variable"], start, start + step,
                      float(r["valor_lectura"]), QC_LABELS[estat])


def parse_records(rows: list[dict], variable: str | None = None) -> list[XemaRecord]:
    return [parse_record(r) for r in rows if variable is None or r["codi_variable"] == variable]


def fetch_rows(station: str, start_utc: datetime, end_utc: datetime,
               variable: str | None = None, timeout: int = 90) -> list[dict]:
    fmt = "%Y-%m-%dT%H:%M:%S"
    where = (f"codi_estacio='{station}' AND data_lectura >= "
             f"'{start_utc.astimezone(UTC).strftime(fmt)}' AND data_lectura < "
             f"'{end_utc.astimezone(UTC).strftime(fmt)}'")
    if variable:
        where += f" AND codi_variable='{variable}'"
    q = urllib.parse.urlencode({"$where": where, "$limit": 50000, "$order": "data_lectura"})
    with urllib.request.urlopen(f"{SOCRATA_URL}?{q}", timeout=timeout) as r:
        return json.load(r)


def missing_intervals(recs: list[XemaRecord], start_utc: datetime, end_utc: datetime,
                      step: timedelta = timedelta(minutes=30)) -> list[datetime]:
    have = {r.start_utc for r in recs}
    out, t = [], start_utc
    while t < end_utc:
        if t not in have:
            out.append(t)
        t += step
    return out
