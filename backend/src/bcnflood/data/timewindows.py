"""Europe/Madrid local-day <-> UTC windows (M2-A1-02, gate G5).

All windows are half-open ``[start_utc, end_utc)`` and are computed with
:mod:`zoneinfo`, so DST transition days come out as 23 h (last Sunday of March)
and 25 h (last Sunday of October) long. Never use fixed offsets.

Interface (consumed by Agent 3 tests and Agent 5 integration):

* ``local_day_window(day, tz=LOCAL_TZ) -> LocalDayWindow``
* ``local_day_windows(start_day, end_day) -> list[LocalDayWindow]`` (inclusive)
* ``local_day_of(ts_utc) -> date``
* ``expected_intervals(day, step) -> int``
* ``aggregate_by_local_day(timestamps_utc, values, step, start_day, end_day,
  label="start") -> list[DailyAggregate]``

Timestamps passed in must be timezone-aware. Naive datetimes raise ``ValueError``.
Callers that hold naive source timestamps must first attach the source time zone
explicitly (for example with ``assume_utc``), which keeps the assumption visible.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Europe/Madrid")

IntervalLabel = Literal["start", "end"]


@dataclass(frozen=True)
class LocalDayWindow:
    local_date: date
    start_utc: datetime  # inclusive
    end_utc: datetime  # exclusive
    tz: str = "Europe/Madrid"

    @property
    def duration(self) -> timedelta:
        return self.end_utc - self.start_utc

    @property
    def hours(self) -> float:
        return self.duration.total_seconds() / 3600.0

    def contains(self, ts: datetime) -> bool:
        ts = _require_aware(ts).astimezone(UTC)
        return self.start_utc <= ts < self.end_utc


@dataclass
class DailyAggregate:
    local_date: date
    window: LocalDayWindow
    total: float
    n_records: int
    n_expected: int
    complete: bool
    missing: int = 0
    flags: list[str] = field(default_factory=list)


def _require_aware(ts: datetime) -> datetime:
    if ts.tzinfo is None or ts.tzinfo.utcoffset(ts) is None:
        raise ValueError(
            f"naive datetime {ts!r}: attach the source time zone explicitly (e.g. assume_utc)"
        )
    return ts


def assume_utc(ts: datetime) -> datetime:
    """Mark a naive source timestamp as UTC (explicit, auditable assumption)."""
    if ts.tzinfo is not None:
        raise ValueError("timestamp already timezone-aware")
    return ts.replace(tzinfo=UTC)


def local_day_window(day: date, tz: ZoneInfo = LOCAL_TZ) -> LocalDayWindow:
    """UTC window ``[start, end)`` of the local calendar day ``day`` in ``tz``."""
    if isinstance(day, datetime):
        raise TypeError("pass a datetime.date, not a datetime")
    start_local = datetime.combine(day, time(0, 0), tzinfo=tz)
    end_local = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=tz)
    return LocalDayWindow(
        local_date=day,
        start_utc=start_local.astimezone(UTC),
        end_utc=end_local.astimezone(UTC),
        tz=str(tz.key),
    )


def local_day_windows(
    start_day: date, end_day: date, tz: ZoneInfo = LOCAL_TZ
) -> list[LocalDayWindow]:
    """Windows for every local day from ``start_day`` to ``end_day`` inclusive."""
    if end_day < start_day:
        raise ValueError("end_day before start_day")
    n = (end_day - start_day).days + 1
    return [local_day_window(start_day + timedelta(days=i), tz) for i in range(n)]


def local_day_of(ts: datetime, tz: ZoneInfo = LOCAL_TZ) -> date:
    """Local calendar day an aware instant falls in."""
    return _require_aware(ts).astimezone(tz).date()


def expected_intervals(day: date, step: timedelta, tz: ZoneInfo = LOCAL_TZ) -> int:
    """Number of ``step`` intervals in the local day (46/48/50 for 30 min)."""
    w = local_day_window(day, tz)
    q, r = divmod(w.duration, step)
    if r:
        raise ValueError(f"step {step} does not divide day length {w.duration}")
    return int(q)


def aggregate_by_local_day(
    timestamps: Sequence[datetime],
    values: Sequence[float | None],
    step: timedelta,
    start_day: date,
    end_day: date,
    label: IntervalLabel = "start",
    tz: ZoneInfo = LOCAL_TZ,
) -> list[DailyAggregate]:
    """Sum interval values (e.g. mm per 30 min) per local day.

    ``label`` says whether each timestamp marks the start or the end of its
    accumulation interval; the interval's *start* instant decides its day.
    ``None``/NaN values count as missing. Duplicate interval starts raise.
    Days with any missing interval get ``complete=False`` and an
    ``INCOMPLETE`` flag; the total is then a lower bound, never gap-filled.
    """
    if len(timestamps) != len(values):
        raise ValueError("timestamps and values differ in length")
    if label not in ("start", "end"):
        raise ValueError("label must be 'start' or 'end'")
    windows = local_day_windows(start_day, end_day, tz)
    seen: set[datetime] = set()
    sums = {w.local_date: 0.0 for w in windows}
    counts = {w.local_date: 0 for w in windows}
    for ts, v in zip(timestamps, values, strict=True):
        t0 = _require_aware(ts).astimezone(UTC)
        if label == "end":
            t0 = t0 - step
        if t0 in seen:
            raise ValueError(f"duplicate interval starting {t0.isoformat()}")
        seen.add(t0)
        if v is None or v != v:  # None or NaN
            continue
        d = t0.astimezone(tz).date()
        if d in sums:
            sums[d] += float(v)
            counts[d] += 1
    out = []
    for w in windows:
        n_exp = expected_intervals(w.local_date, step, tz)
        n = counts[w.local_date]
        flags = []
        if n < n_exp:
            flags.append("INCOMPLETE")
        if w.hours != 24:
            flags.append(f"DST_DAY_{int(w.hours)}H")
        out.append(
            DailyAggregate(
                local_date=w.local_date,
                window=w,
                total=round(sums[w.local_date], 6),
                n_records=n,
                n_expected=n_exp,
                complete=n == n_exp,
                missing=n_exp - n,
                flags=flags,
            )
        )
    return out


def iter_utc_steps(window: LocalDayWindow, step: timedelta) -> Iterable[datetime]:
    t = window.start_utc
    while t < window.end_utc:
        yield t
        t += step
