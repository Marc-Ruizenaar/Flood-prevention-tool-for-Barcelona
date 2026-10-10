"""G1 evidence: raw XEMA open-data (Socrata nzvn-apee) downloads with provenance.

Downloads raw station records + dataset/variable/station metadata, saves them
verbatim under manifests/raw/g1/ and writes a provenance JSON (URL, query,
fetch time UTC, sha256, bytes). No transformation of values happens here.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime

BASE = "https://analisi.transparenciacatalunya.cat"
DATA = f"{BASE}/resource/nzvn-apee.json"
STATIONS = ("X4", "X8", "D5", "WU")
UTC_FROM, UTC_TO = "2026-10-01T22:00:00", "2026-10-07T22:00:00"  # local 2-7 Oct (CEST)


def _get(url: str, retries: int = 4, timeout: int = 90) -> tuple[bytes, int]:
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read(), r.status
        except Exception:  # noqa: BLE001 - retry with backoff, re-raise at end
            if i == retries - 1:
                raise
            time.sleep(2 ** (i + 1))
    raise RuntimeError("unreachable")


def fetch(out_dir: str = "manifests/raw/g1") -> dict:
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    jobs = {
        "nzvn-apee_metadata.json": f"{BASE}/api/views/nzvn-apee.json",
        "variables_4fb2-n3yi.json": f"{BASE}/resource/4fb2-n3yi.json?$limit=5000",
        "stations_yqwd-vj5e.json": f"{BASE}/resource/yqwd-vj5e.json?$limit=5000",
    }
    for s in STATIONS:
        where = (f"codi_estacio='{s}' AND data_lectura >= '{UTC_FROM}' "
                 f"AND data_lectura < '{UTC_TO}'")
        q = urllib.parse.urlencode({"$where": where, "$limit": 50000,
                                    "$order": "data_lectura,codi_variable"})
        jobs[f"xema_{s}_20261001T22Z_20261007T22Z.json"] = f"{DATA}?{q}"
    files = []
    for name, url in jobs.items():
        t = datetime.now(UTC).isoformat(timespec="seconds")
        body, status = _get(url)
        (out / name).write_bytes(body)
        files.append({"file": f"{out_dir}/{name}", "url": url, "http_status": status,
                      "fetched_at_utc": t, "bytes": len(body),
                      "sha256": hashlib.sha256(body).hexdigest()})
    prov = {"source": "Transparencia Catalunya Socrata mirror of Meteocat XEMA",
            "query_window_utc": [UTC_FROM, UTC_TO], "stations": list(STATIONS),
            "files": files}
    (out / "provenance.json").write_text(json.dumps(prov, indent=1))
    return prov


if __name__ == "__main__":
    fetch()
