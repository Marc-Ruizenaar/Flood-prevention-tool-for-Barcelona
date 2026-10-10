"""Local-inertial 2D surface-flow solver (Bates et al. 2010; de Almeida et al. 2012 form).

Owned by Agent 2 (Hydrology & Mathematics). Pure NumPy, no API/IO dependencies.

Units: SI throughout. z, h, eta [m]; q unit-width discharge [m^2/s]; rain/infil/drain rates [m/s];
dx [m]; dt [s]; Manning n [s m^-1/3].

Momentum (per face, semi-implicit friction):
    q^{n+1} = (q^n - g h_f dt dEta/dx) / (1 + g dt n^2 |q^n| / h_f^{7/3})
    h_f = max(eta_i, eta_j) - max(z_i, z_j)   (flow depth at face)
Continuity:
    h^{n+1} = h^n + dt (r - f - d) - dt (dqx/dx + dqy/dy)
Stability: dt = alpha * dx / sqrt(g * h_max), alpha in (0, 1].
Boundaries: closed (zero flux) everywhere, except cells flagged `outlet` whose depth is
removed each step and booked as boundary outflow (free-outfall sink).
Positivity: outgoing face fluxes of a cell are scaled down so a cell cannot lose more than it
holds in one step (mass-conserving limiter).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

G = 9.81


@dataclass
class GreenAmpt:
    k_sat: float  # m/s
    psi: float  # m
    delta_theta: float  # -

    def capacity(self, f_cum: np.ndarray) -> np.ndarray:
        """Potential infiltration rate f = K (1 + psi*dtheta / F) [m/s]."""
        f = np.asarray(f_cum, float)
        with np.errstate(divide="ignore"):
            ratio = np.where(f > 0, self.psi * self.delta_theta / np.where(f > 0, f, 1.0), np.inf)
        k = np.asarray(self.k_sat, float)
        with np.errstate(invalid="ignore"):
            cap = k * (1.0 + ratio)  # F=0 -> infinite capacity (all ponded water infiltrates)
        return np.where(k > 0, cap, 0.0)  # Ks=0 (sealed) never infiltrates; avoids 0*inf=NaN


@dataclass
class Domain:
    z: np.ndarray  # bed elevation [m], shape (ny, nx)
    dx: float
    manning_n: float | np.ndarray
    outlet: np.ndarray | None = None  # bool mask
    drainage_capacity: float | np.ndarray = 0.0  # m/s sink rate cap
    infiltration: GreenAmpt | None = None
    pervious: np.ndarray | None = None  # bool mask; infiltration applies only here


@dataclass
class State:
    h: np.ndarray
    qx: np.ndarray  # (ny, nx-1)
    qy: np.ndarray  # (ny-1, nx)
    f_cum: np.ndarray  # cumulative infiltrated depth [m]
    t: float = 0.0

    @classmethod
    def dry(cls, shape: tuple[int, int]) -> State:
        ny, nx = shape
        return cls(np.zeros(shape), np.zeros((ny, nx - 1)), np.zeros((ny - 1, nx)),
                   np.zeros(shape))

    def copy(self) -> State:
        return State(self.h.copy(), self.qx.copy(), self.qy.copy(), self.f_cum.copy(), self.t)


@dataclass
class Ledger:
    """Cumulative volumes [m^3]."""
    rain: float = 0.0
    infiltration: float = 0.0
    drainage: float = 0.0
    outflow: float = 0.0
    steps: int = 0
    clip: float = 0.0  # volume added by the h>=0 round-off clip (booked as a source)
    numerics_override: bool = False  # True if run with alpha/dt_max beyond G6 limits

    def copy(self) -> Ledger:
        return Ledger(self.rain, self.infiltration, self.drainage, self.outflow, self.steps,
                      self.clip, self.numerics_override)


@dataclass
class Snapshot:
    t: float
    storage: float
    ledger: Ledger
    max_depth: float
    wet_cells: int
    h: np.ndarray = field(repr=False)


def _face_flux(q, eta_a, eta_b, z_a, z_b, n, dt, dx, h_dry):
    hf = np.maximum(eta_a, eta_b) - np.maximum(z_a, z_b)
    wet = hf > h_dry
    slope = (eta_b - eta_a) / dx
    hf_s = np.where(wet, hf, 1.0)
    qn = (q - G * hf_s * dt * slope) / (1.0 + G * dt * n**2 * np.abs(q) / hf_s ** (7.0 / 3.0))
    return np.where(wet, qn, 0.0)


def step(dom: Domain, s: State, dt: float, rain_rate: float, led: Ledger,
         h_dry: float = 1e-6, acc: dict | None = None) -> None:
    """One step. If `acc` (dict of (ny, nx) arrays) is given, per-cell depths [m] are
    accumulated in place: in_W/in_E/in_N/in_S (lateral inflow by face; row 0 = north),
    lat_out, infil, drain, outflow, clip. Results are unchanged."""
    dx, area = dom.dx, dom.dx * dom.dx
    z = dom.z
    eta = z + s.h
    n = dom.manning_n
    # face n from the arithmetic mean of n^2 (friction term uses n^2)
    nx_face = n if np.isscalar(n) else np.sqrt(0.5 * (n[:, 1:] ** 2 + n[:, :-1] ** 2))
    ny_face = n if np.isscalar(n) else np.sqrt(0.5 * (n[1:, :] ** 2 + n[:-1, :] ** 2))
    s.qx = _face_flux(s.qx, eta[:, :-1], eta[:, 1:], z[:, :-1], z[:, 1:], nx_face, dt, dx, h_dry)
    s.qy = _face_flux(s.qy, eta[:-1, :], eta[1:, :], z[:-1, :], z[1:, :], ny_face, dt, dx, h_dry)

    # positivity limiter: outgoing volume per cell <= available water
    out = np.zeros_like(s.h)
    out[:, :-1] += np.maximum(s.qx, 0)
    out[:, 1:] += np.maximum(-s.qx, 0)
    out[:-1, :] += np.maximum(s.qy, 0)
    out[1:, :] += np.maximum(-s.qy, 0)
    out_depth = out * dt / dx
    scale = np.where(out_depth > s.h, s.h / np.maximum(out_depth, 1e-300), 1.0)
    s.qx = np.where(s.qx > 0, s.qx * scale[:, :-1], s.qx * scale[:, 1:])
    s.qy = np.where(s.qy > 0, s.qy * scale[:-1, :], s.qy * scale[1:, :])

    div = np.zeros_like(s.h)
    div[:, :-1] -= s.qx
    div[:, 1:] += s.qx
    div[:-1, :] -= s.qy
    div[1:, :] += s.qy
    h = s.h + dt * div / dx
    if acc is not None:
        k = dt / dx
        px, py = np.maximum(s.qx, 0) * k, np.maximum(s.qy, 0) * k
        mx, my = np.maximum(-s.qx, 0) * k, np.maximum(-s.qy, 0) * k
        acc["in_W"][:, 1:] += px
        acc["in_E"][:, :-1] += mx
        acc["in_N"][1:, :] += py
        acc["in_S"][:-1, :] += my
        acc["lat_out"][:, :-1] += px
        acc["lat_out"][:, 1:] += mx
        acc["lat_out"][:-1, :] += py
        acc["lat_out"][1:, :] += my
    neg = h < 0.0  # round-off only (~1e-17); limiter ensures positivity. Booked in ledger.
    if neg.any():
        led.clip += float(-h[neg].sum()) * area
        if acc is not None:
            acc["clip"] += np.where(neg, -h, 0.0)
        h = np.where(neg, 0.0, h)

    # sources/sinks (operator split, each limited by available water)
    h += rain_rate * dt
    if np.isscalar(rain_rate):
        led.rain += rain_rate * dt * area * h.size
    else:  # per-cell rain field [m/s], shape (ny, nx)
        led.rain += float(np.sum(rain_rate)) * dt * area
    if dom.infiltration is not None:
        cap = dom.infiltration.capacity(s.f_cum) * dt
        if dom.pervious is not None:
            cap = np.where(dom.pervious, cap, 0.0)
        inf = np.minimum(cap, h)
        h -= inf
        s.f_cum += inf
        led.infiltration += inf.sum() * area
        if acc is not None:
            acc["infil"] += inf
    dcap = np.asarray(dom.drainage_capacity) * dt
    if np.any(dcap > 0):
        dr = np.minimum(dcap, h)
        h -= dr
        led.drainage += dr.sum() * area
        if acc is not None:
            acc["drain"] += dr
    if dom.outlet is not None:
        led.outflow += h[dom.outlet].sum() * area
        if acc is not None:
            acc["outflow"][dom.outlet] += h[dom.outlet]
        h[dom.outlet] = 0.0
    s.h = h
    s.t += dt
    led.steps += 1


def cfl_dt(dom: Domain, s: State, alpha: float, dt_max: float) -> float:
    hmax = float(s.h.max())
    if hmax <= 1e-9:
        return dt_max
    return min(dt_max, alpha * dom.dx / np.sqrt(G * hmax))


DEFAULT_ALPHA = 0.35
DEFAULT_DT_MAX = 2.0  # s. M1 used 0.7 / 10 s: unstable for dx <= 12.5 m (audit D1)
ALPHA_LIMIT = DEFAULT_ALPHA  # G6 condition (Agent 3): hard limits unless override=True
DT_MAX_LIMIT = DEFAULT_DT_MAX


class NumericsLimitError(ValueError):
    pass


def check_numerics(alpha: float, dt_max: float, override: bool = False) -> None:
    """G6: alpha > 0.35 or dt_max > 2 s is an error unless override=True (then a warning)."""
    if alpha != alpha or dt_max != dt_max:  # NaN never allowed, even with override
        raise NumericsLimitError(f"alpha={alpha} / dt_max={dt_max}: NaN")
    if not (alpha <= ALPHA_LIMIT) or not (dt_max <= DT_MAX_LIMIT) or not (alpha > 0) \
            or not (dt_max > 0):
        msg = (f"alpha={alpha} / dt_max={dt_max} s exceed G6 limits "
               f"(alpha<={ALPHA_LIMIT}, dt_max<={DT_MAX_LIMIT} s)")
        if not override:
            raise NumericsLimitError(msg + "; pass override=True for verification studies")
        import warnings
        warnings.warn("OVERRIDE: " + msg, RuntimeWarning, stacklevel=3)


def piecewise_rain(times, rates):
    """Piecewise-constant rain: rates[i] [m/s] on [times[i], times[i+1]); 0 outside.
    The callable carries `.breakpoints`, which run() uses to cut steps exactly."""
    times = np.asarray(times, float)
    rates = np.asarray(rates, float)
    if times.ndim != 1 or len(times) != len(rates) + 1 or np.any(np.diff(times) <= 0):
        raise ValueError("times must be increasing with len(rates)+1 entries")

    def fn(t):
        i = np.searchsorted(times, t, side="right") - 1
        return float(rates[i]) if 0 <= i < len(rates) else 0.0
    fn.breakpoints = times.tolist()
    return fn


def run(dom: Domain, s: State, rain_fn, t_end: float, output_interval: float,
        alpha: float = DEFAULT_ALPHA, dt_max: float = DEFAULT_DT_MAX, h_dry: float = 1e-6,
        breakpoints=None, override: bool = False):
    """Advance to t_end, landing exactly on every output time and every rain breakpoint
    (from `breakpoints` or `rain_fn.breakpoints`). rain_fn(t) -> rate [m/s], piecewise
    constant between breakpoints, evaluated at step start. Returns snapshots incl. t0."""
    check_numerics(alpha, dt_max, override)
    over = not (alpha <= ALPHA_LIMIT and dt_max <= DT_MAX_LIMIT)
    bps = breakpoints if breakpoints is not None else getattr(rain_fn, "breakpoints", ())
    bps = sorted(b for b in bps if s.t + 1e-9 < b < t_end - 1e-9)
    bi = 0
    led = Ledger(numerics_override=over)
    area = dom.dx**2
    snaps = [Snapshot(s.t, float(s.h.sum() * area), led.copy(), float(s.h.max()),
                      int((s.h > 0.01).sum()), s.h.copy())]
    next_out = s.t + output_interval
    while s.t < t_end - 1e-9:
        while bi < len(bps) and bps[bi] <= s.t + 1e-9:
            bi += 1
        nb = bps[bi] - s.t if bi < len(bps) else np.inf
        dt = min(cfl_dt(dom, s, alpha, dt_max), next_out - s.t, t_end - s.t, nb)
        step(dom, s, dt, rain_fn(s.t), led, h_dry)
        if s.t >= next_out - 1e-9 or s.t >= t_end - 1e-9:
            s.t = round(s.t, 6)
            snaps.append(Snapshot(s.t, float(s.h.sum() * area), led.copy(), float(s.h.max()),
                                  int((s.h > 0.01).sum()), s.h.copy()))
            next_out += output_interval
    return snaps, led


def mass_balance_error(storage0: float, storage1: float, led: Ledger) -> float:
    """Relative error: (dS - (R + clip - I - D - O)) / max(R, storage0, tiny)."""
    expected = led.rain + led.clip - led.infiltration - led.drainage - led.outflow
    return abs((storage1 - storage0) - expected) / max(led.rain, storage0, 1e-12)
