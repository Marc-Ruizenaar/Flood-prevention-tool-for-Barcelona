"""M2-A3-03 local-day -> UTC windows (Agent 3), gate G5. Interface from data/timewindows.py."""
from datetime import UTC, date, datetime, timedelta

import pytest

tw = pytest.importorskip("bcnflood.data.timewindows")
H = timedelta(hours=1)


@pytest.mark.parametrize("d,start,hours", [
    (date(2026, 10, 2), datetime(2026, 10, 1, 22, tzinfo=UTC), 24),
    (date(2026, 10, 3), datetime(2026, 10, 2, 22, tzinfo=UTC), 24),
    (date(2026, 10, 7), datetime(2026, 10, 6, 22, tzinfo=UTC), 24),
    (date(2026, 3, 29), datetime(2026, 3, 28, 23, tzinfo=UTC), 23),   # spring forward
    (date(2026, 10, 25), datetime(2026, 10, 24, 22, tzinfo=UTC), 25),  # fall back
    (date(2026, 1, 15), datetime(2026, 1, 14, 23, tzinfo=UTC), 24),   # winter UTC+1
])
def test_window(d, start, hours):
    w = tw.local_day_window(d)
    assert w.start_utc == start and w.end_utc - w.start_utc == hours * H
    assert w.start_utc.utcoffset() == timedelta(0)


def test_oct_2_to_7_contiguous():  # scope 2-7 Oct 2026 (Marc, 2026-10-09)
    ws = tw.local_day_windows(date(2026, 10, 2), date(2026, 10, 7))
    assert len(ws) == 6
    assert ws[0].start_utc == datetime(2026, 10, 1, 22, tzinfo=UTC)
    assert ws[-1].end_utc == datetime(2026, 10, 7, 22, tzinfo=UTC)
    assert all(a.end_utc == b.start_utc for a, b in zip(ws[:-1], ws[1:], strict=True))


@pytest.mark.parametrize("d,n", [(date(2026, 3, 29), 46), (date(2026, 10, 25), 50),
                                 (date(2026, 10, 3), 48)])
def test_expected_30min_intervals(d, n):
    assert tw.expected_intervals(d, timedelta(minutes=30)) == n


def test_naive_rejected():
    with pytest.raises(ValueError):
        tw.local_day_of(datetime(2026, 10, 3, 23, 30))


def test_local_day_of_late_utc_evening():
    # 22:30Z on 3 Oct is 00:30 CEST on 4 Oct; a UTC-assumed implementation gives 3 Oct
    assert tw.local_day_of(datetime(2026, 10, 3, 22, 30, tzinfo=UTC)) == date(2026, 10, 4)
