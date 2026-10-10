"""M2-A2-01 Grid / time-step convergence harness (Agent 2). Pure NumPy, no IO.

Does not modify the solver: every run goes through ``local_inertial.run`` unchanged.

Interface
---------
A *case* is any callable ``case(dx) -> CaseSetup`` that builds a fresh Domain/State/rain_fn for
cell size ``dx`` [m] (see ``reference_cases`` for examples). Grids at successive levels must
nest: level k uses ``dx0 / ratio**k`` and the fine cells tile the coarse cells exactly
(``ratio`` integer), so ``restrict`` can block-average fine fields onto the coarse grid.

    grid_study(case, dx0, levels=3, ratio=2, alpha=0.35, dt_max=2) -> Study (dx, dx/2, dx/4)
    (alpha > 0.35 or dt_max > 2 s raise NumericsLimitError unless override=True; G6)
    alpha_study(case, dx, alphas=(0.7, 0.35, 0.175), ...)      -> Study   (CFL refinement)
    fixed_dt_study(case, dx, dts=(...), ...)                    -> Study   (fixed dt refinement)

Each ``LevelResult`` carries snapshots at the common output times, the ledger, the relative
mass-balance error and per-level scalar metrics. Comparison helpers:

    restrict(field, factor)               block mean, (ny*f, nx*f) -> (ny, nx)
    norm_diff(a, b, dx, kind)             L1 / L2 (area-weighted, per unit area) or Linf
    successive_differences(study, ...)    ||u_k - R u_{k+1}|| between consecutive levels
    observed_order(e_coarse, e_fine, r)   log(e_c/e_f)/log(r)    (vs a reference/analytic)
    richardson_order(f1, f2, f3, r)       order from three levels of a scalar (no reference)
    relative_change(a, b)                 |a-b|/|b|  (e.g. peak depth between finest levels)

Units: SI (m, s, m^3). Fixed-dt refinement uses ``alpha=inf`` with ``dt_max=dt`` so that
``cfl_dt`` returns ``dt`` exactly (output times still truncate the last step before each output).
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np

from .local_inertial import (
    DEFAULT_ALPHA,
    DEFAULT_DT_MAX,
    Domain,
    Ledger,
    Snapshot,
    State,
    mass_balance_error,
    run,
)


@dataclass
class CaseSetup:
    domain: Domain
    state: State
    rain_fn: Callable[[float], float]
    t_end: float
    output_interval: float
    meta: dict = field(default_factory=dict)


@dataclass
class LevelResult:
    dx: float
    alpha: float
    dt_max: float
    snaps: list[Snapshot]
    ledger: Ledger
    final_state: State
    domain: Domain
    mass_balance_rel: float
    peak_depth: float  # max over output snapshots [m]
    peak_outflow_rate: float  # max over output intervals of outflow volume / interval [m^3/s]

    @property
    def times(self) -> np.ndarray:
        return np.array([s.t for s in self.snaps])


@dataclass
class Study:
    kind: str  # "grid" | "alpha" | "fixed_dt"
    levels: list[LevelResult]
    ratio: float  # refinement ratio between consecutive levels (dx or dt)


def run_level(case: Callable[[float], CaseSetup], dx: float, alpha: float = DEFAULT_ALPHA,
              dt_max: float = DEFAULT_DT_MAX, h_dry: float = 1e-6,
              override: bool = False) -> LevelResult:
    cs = case(dx)
    s0 = float(cs.state.h.sum() * cs.domain.dx**2)
    snaps, led = run(cs.domain, cs.state, cs.rain_fn, cs.t_end, cs.output_interval,
                     alpha=alpha, dt_max=dt_max, h_dry=h_dry, override=override)
    out = np.array([s.ledger.outflow for s in snaps])
    t = np.array([s.t for s in snaps])
    rates = np.diff(out) / np.diff(t) if len(t) > 1 else np.zeros(1)
    return LevelResult(dx=dx, alpha=alpha, dt_max=dt_max, snaps=snaps, ledger=led,
                       final_state=cs.state, domain=cs.domain,
                       mass_balance_rel=mass_balance_error(s0, snaps[-1].storage, led),
                       peak_depth=max(s.max_depth for s in snaps),
                       peak_outflow_rate=float(rates.max()))


def grid_study(case, dx0: float, levels: int = 3, ratio: int = 2, alpha: float = DEFAULT_ALPHA,
               dt_max: float = DEFAULT_DT_MAX, h_dry: float = 1e-6,
               override: bool = False) -> Study:
    """Run at dx0, dx0/ratio, ... (default dx, dx/2, dx/4) with the same alpha."""
    if int(ratio) != ratio or ratio < 2:
        raise ValueError("ratio must be an integer >= 2 for nested grids")
    res = [run_level(case, dx0 / ratio**k, alpha, dt_max, h_dry, override)
           for k in range(levels)]
    for c, f in zip(res[:-1], res[1:], strict=True):
        if f.final_state.h.shape != tuple(ratio * n for n in c.final_state.h.shape):
            raise ValueError(f"case does not nest: {c.final_state.h.shape} -> "
                             f"{f.final_state.h.shape} at ratio {ratio}")
    return Study("grid", res, float(ratio))


def alpha_study(case, dx: float, alphas: Sequence[float] = (0.7, 0.35, 0.175),
                dt_max: float = DEFAULT_DT_MAX, h_dry: float = 1e-6,
                override: bool = False) -> Study:
    """CFL-number refinement on a fixed grid. dt_max caps the dry/shallow-phase step.
    The default alphas include 0.7 (> G6 limit): pass override=True to run them."""
    res = [run_level(case, dx, a, dt_max, h_dry, override) for a in alphas]
    return Study("alpha", res, float(alphas[0] / alphas[1]) if len(alphas) > 1 else 1.0)


def fixed_dt_study(case, dx: float, dts: Sequence[float], h_dry: float = 1e-6) -> Study:
    """Fixed time-step refinement (no CFL adaptivity). Caller must keep dts stable.
    Uses alpha=inf, so it always runs under the G6 override (warning logged)."""
    res = [run_level(case, dx, float("inf"), dt, h_dry, True) for dt in dts]
    return Study("fixed_dt", res, float(dts[0] / dts[1]) if len(dts) > 1 else 1.0)


# ---------------------------------------------------------------- comparison helpers
def restrict(f: np.ndarray, factor: int) -> np.ndarray:
    """Block-mean a cell-centred field from a grid refined by `factor` onto the coarse grid
    (volume-conserving for depths)."""
    ny, nx = f.shape
    if ny % factor or nx % factor:
        raise ValueError(f"shape {f.shape} not divisible by {factor}")
    return f.reshape(ny // factor, factor, nx // factor, factor).mean(axis=(1, 3))


def norm_diff(a: np.ndarray, b: np.ndarray, dx: float | None = None, kind: str = "L1") -> float:
    """Discrete error norm of a-b. L1/L2 are cell means (area-weighted on a uniform grid,
    i.e. per unit area, so values are comparable across resolutions). Linf is the max."""
    d = np.abs(np.asarray(a, float) - np.asarray(b, float))
    if kind == "L1":
        return float(d.mean())
    if kind == "L2":
        return float(np.sqrt((d**2).mean()))
    if kind == "Linf":
        return float(d.max())
    raise ValueError(kind)


def _snap_at(lv: LevelResult, t: float) -> Snapshot:
    for s in lv.snaps:
        if abs(s.t - t) < 1e-6:
            return s
    raise KeyError(f"no snapshot at t={t} (have {lv.times.tolist()})")


def successive_differences(study: Study, t: float | None = None, kind: str = "L1") -> list[float]:
    """||h_k - R(h_{k+1})|| between consecutive levels at output time t (default: final)."""
    out = []
    for c, f in zip(study.levels[:-1], study.levels[1:], strict=True):
        tt = c.snaps[-1].t if t is None else t
        hc, hf = _snap_at(c, tt).h, _snap_at(f, tt).h
        if study.kind == "grid":
            hf = restrict(hf, int(round(c.dx / f.dx)))
        out.append(norm_diff(hc, hf, c.dx, kind))
    return out


def errors_vs_reference(study: Study, ref_fn: Callable[[LevelResult, float], np.ndarray],
                        t: float, kind: str = "L1", mask_fn=None) -> list[float]:
    """Error of each level against an exact solution. ref_fn(level, t) returns the exact
    cell-centred depth on that level's grid; mask_fn(level) optionally selects cells."""
    errs = []
    for lv in study.levels:
        h, href = _snap_at(lv, t).h, ref_fn(lv, t)
        if mask_fn is not None:
            m = mask_fn(lv)
            h, href = h[m], href[m]
        errs.append(norm_diff(h, href, lv.dx, kind))
    return errs


def observed_order(e_coarse: float, e_fine: float, ratio: float = 2.0) -> float:
    if e_fine <= 0 or e_coarse <= 0:
        return float("nan")
    return float(np.log(e_coarse / e_fine) / np.log(ratio))


def orders(errs: Sequence[float], ratio: float = 2.0) -> list[float]:
    return [observed_order(a, b, ratio) for a, b in zip(errs[:-1], errs[1:], strict=True)]


def richardson_order(f1: float, f2: float, f3: float, ratio: float = 2.0) -> float:
    """Observed order from a scalar at coarse (f1), medium (f2), fine (f3) levels."""
    d1, d2 = f1 - f2, f2 - f3
    if d2 == 0 or d1 / d2 <= 0:
        return float("nan")
    return float(np.log(d1 / d2) / np.log(ratio))


def relative_change(a: float, b: float) -> float:
    return float(abs(a - b) / max(abs(b), 1e-300))


def gci(f1: float, f2: float, f3: float, ratio: float = 2.0, fs: float = 1.25,
        p: float | None = None) -> dict:
    """Roache grid convergence index from coarse f1, medium f2, fine f3 (scalar, e.g. peak
    depth or total volume). Uses observed order p (Richardson) unless p is given.
    Returns p, fine-grid GCI (relative), and the Richardson extrapolate."""
    if p is None:
        p = richardson_order(f1, f2, f3, ratio)
    e21 = abs((f2 - f3) / f3) if f3 else float("nan")
    gci_fine = fs * e21 / (ratio**p - 1) if p == p and p > 0 else float("nan")
    f_ext = f3 + (f3 - f2) / (ratio**p - 1) if p == p and p > 0 else float("nan")
    return {"p": p, "gci_fine": gci_fine, "f_extrapolated": f_ext, "rel_change_fine": e21}


def kink_band_mask(x_centres: np.ndarray, x_kink: float, band_m: float) -> np.ndarray:
    """True where |x - x_kink| > band_m. Diagnostic only: excluding the equilibrium kink does
    not change the observed order (~0.85 with or without the band, Agent 3), so the
    sub-first order is the scheme's own order on this case, not a kink artefact."""
    return np.abs(x_centres - x_kink) > band_m
