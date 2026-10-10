"""Daily aggregation over a continuous run (Agent 2/5 boundary). Day windows are local-time
midnights converted to model seconds by the caller; state is never reset between days."""
from __future__ import annotations

from .local_inertial import Snapshot


def daily_summaries(snaps: list[Snapshot], day_edges: list[float]) -> list[dict]:
    by_t = {round(s.t, 6): s for s in snaps}
    out = []
    for a, b in zip(day_edges[:-1], day_edges[1:], strict=True):
        s0, s1 = by_t.get(round(a, 6)), by_t.get(round(b, 6))
        if s0 is None or s1 is None:
            out.append({"window": (a, b), "status": "INCOMPLETE"})
            continue
        inside = [s for s in snaps if a <= s.t <= b]
        r = s1.ledger.rain - s0.ledger.rain
        i = s1.ledger.infiltration - s0.ledger.infiltration
        d = s1.ledger.drainage - s0.ledger.drainage
        o = s1.ledger.outflow - s0.ledger.outflow
        err = abs((s1.storage - s0.storage) - (r - i - d - o)) / max(r, s0.storage, 1e-12)
        out.append({"window": (a, b), "status": "SIMULATED", "rain_m3": r, "infil_m3": i,
                    "drain_m3": d, "outflow_m3": o, "storage_start_m3": s0.storage,
                    "storage_end_m3": s1.storage, "mass_balance_error_rel": err,
                    "max_depth_m": max(s.max_depth for s in inside)})
    return out


def local_day_edges(start_day, end_day, t0_utc) -> list[float]:
    """Model-second edges of the Europe/Madrid local days start_day..end_day (inclusive),
    relative to model time 0 = t0_utc (aware datetime). Uses data.timewindows (DST-aware:
    23 h / 25 h days give 82800 / 90000 s windows)."""
    from bcnflood.data.timewindows import local_day_windows

    if t0_utc.tzinfo is None:
        raise ValueError("t0_utc must be timezone-aware")
    ws = local_day_windows(start_day, end_day)
    edges = [(w.start_utc - t0_utc).total_seconds() for w in ws]
    edges.append((ws[-1].end_utc - t0_utc).total_seconds())
    return edges


def local_daily_summaries(snaps: list[Snapshot], start_day, end_day, t0_utc) -> list[dict]:
    """daily_summaries over Madrid local days, each labelled with local_date and UTC window."""
    from bcnflood.data.timewindows import local_day_windows

    ws = local_day_windows(start_day, end_day)
    out = daily_summaries(snaps, local_day_edges(start_day, end_day, t0_utc))
    for d, w in zip(out, ws, strict=True):
        d["local_date"] = w.local_date.isoformat()
        d["window_utc"] = (w.start_utc.isoformat(), w.end_utc.isoformat())
        d["tz"] = w.tz
    return out
