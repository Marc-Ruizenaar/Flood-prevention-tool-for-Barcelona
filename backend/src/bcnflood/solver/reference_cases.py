"""M2-A2-02 Exact-solution reference cases (Agent 2). SYNTHETIC inputs only, pure NumPy.

Both cases are ``case(dx) -> CaseSetup`` callables for ``convergence`` and come with an
exact-solution function ``exact_depth(level, t)`` on the level's cell centres.

1. Kinematic-wave planar runoff (``KinematicPlane``)
   1D plane of length L [m], bed slope S0, Manning n, constant rain r [m/s] for t < t_rain.
   Kinematic wave (S_f = S0):  q = a h^{5/3},  a = sqrt(S0)/n.
   Rising limb / equilibrium (t <= t_rain), exact characteristic solution:
       h(x, t) = min(r t, (r x / a)^{3/5}),   equilibrium time t_e(x) = (r x / a)^{3/5} / r.
   Expected behaviour of the local-inertial solver: it retains the pressure-gradient and local
   acceleration terms that the kinematic wave drops, so it converges to the *local-inertial*
   solution, not to the kinematic one. The model-form gap scales like (dh/dx)/S0 and the
   inertial term; for the defaults (S0=0.01, n=0.05, r=50 mm/h, L=1000 m) dh/dx/S0 ~ 5e-3.
   Observed order is ~0.8-0.9 (L1, dx 50 -> 6.25 m) and does not change when a band around
   the equilibrium kink (x where t = t_e(x)) is excluded, so ~0.85 is the scheme's actual
   order on this case (Agent 3: passes the G6 threshold order >= 0.8). It is not a kink
   artefact. Compare
   cells away from the outlet sink (last cell, free outfall) and the closed upstream wall.
   STABILITY: use dt_max <= 2 s. With the M1 default dt_max=10 s the run is unstable at
   dx <= 12.5 m (alpha 0.7: L1 jumps to 1.2e-2 m, Fr 7.9); the depth-based CFL alone does not
   bound dt in the thin-film phase. Observed (alpha 0.7, dt_max 2 s, t=1800 s, L1 h):
   dx 50/25/12.5/6.25 m -> 6.76e-4, 3.97e-4, 2.31e-4, 1.33e-4 m, orders 0.77, 0.78, 0.80.

2. Thacker 1D planar surface in a parabolic bowl (``ThackerBowl``), frictionless.
   z(x) = h0 (x'^2/a^2 - 1), x' = x - L/2. Exact solution (derived for this solver's
   equations): velocity is spatially uniform, u(t) = B sin(w t), w = sqrt(2 g h0)/a,
       eta(x, t) = -(B w / g) cos(w t) x' + B^2 sin^2(w t) / (2 g),   h = max(eta - z, 0).
   CAUTION: this is an exact solution of the full shallow-water equations, NOT of the
   local-inertial ones. In conservative form the dropped term d(q^2/h)/dx = u^2 dh/dx is
   nonzero even though u is uniform, so the case measures the local-inertial model-form error
   (amplitude/phase damping of the oscillation) plus wet/dry front error. Observed on the
   default B=0.5 (Fr_bulk 0.23), alpha=0.35, dt_max=0.01, dx 0.08->0.01 m, t = 1 period:
   L1(h) = 1.38e-2, 1.20e-2, 1.15e-2, 1.14e-2 m (orders 0.20, 0.06, 0.01): an error floor,
   shrinking with B (B=0.0625: 2.37e-3 -> 3.68e-4 m). Use it to quantify the regime limit,
   not as an order-of-accuracy test. Initial condition at t=0 is eta = -(B w/g) x', u = 0
   (faces initialised to zero, consistent). Expect no clean order: error limited by model form,
   the moving shoreline (h_dry threshold,
   positivity limiter). Bulk Froude number Fr = B / sqrt(g h0).

Froude-number limitation (both cases, and Barcelona use): the local-inertial scheme drops
the convective acceleration d(q^2/h)/dx. It is appropriate for gradually varied, subcritical
flow with Fr below ~0.5 (de Almeida & Bates 2013, Water Resour. Res. 49). For Fr > ~0.5
(steep streets, hydraulic jumps, dam-break fronts) the momentum error grows with Fr^2 and the
scheme's semi-implicit friction becomes the only damping; results there are not verified by
these cases. A 1D dam break is therefore NOT used as a reference case: its Ritter/Stoker
solution is supercritical in the rarefaction (Fr up to 2), outside the scheme's regime.
`froude_max(level)` reports max Fr on wet faces so tests can confirm a case stays in regime.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .convergence import CaseSetup, LevelResult
from .local_inertial import Domain, G, State

MM_H = 1e-3 / 3600.0


def _centres(n: int, dx: float) -> np.ndarray:
    return (np.arange(n) + 0.5) * dx


@dataclass
class KinematicPlane:
    length: float = 1000.0
    width_cells_coarse: int = 2  # ny at the coarsest dx; scales with refinement
    dx_coarse: float = 50.0
    slope: float = 0.01
    manning_n: float = 0.05
    rain: float = 50 * MM_H
    t_rain: float = 3600.0
    t_end: float = 3600.0
    output_interval: float = 300.0

    @property
    def a(self) -> float:
        return np.sqrt(self.slope) / self.manning_n

    def equilibrium_time(self, x: float) -> float:
        return (self.rain * x / self.a) ** 0.6 / self.rain

    def __call__(self, dx: float) -> CaseSetup:
        nx = int(round(self.length / dx))
        ny = int(round(self.width_cells_coarse * self.dx_coarse / dx))
        if abs(nx * dx - self.length) > 1e-9 * self.length:
            raise ValueError("dx must divide length")
        x = _centres(nx, dx)
        z = np.tile(self.slope * (self.length - x), (ny, 1))
        outlet = np.zeros((ny, nx), bool)
        outlet[:, -1] = True
        dom = Domain(z=z, dx=dx, manning_n=self.manning_n, outlet=outlet)
        r, tr = self.rain, self.t_rain
        return CaseSetup(dom, State.dry((ny, nx)), lambda t: r if t < tr else 0.0,
                         self.t_end, self.output_interval, {"case": "kinematic_plane"})

    def exact_depth(self, lv: LevelResult, t: float) -> np.ndarray:
        if t > self.t_rain + 1e-9:
            raise ValueError("exact solution implemented for the rising/equilibrium phase only")
        ny, nx = lv.final_state.h.shape
        x = _centres(nx, lv.dx)
        h = np.minimum(self.rain * t, (self.rain * x / self.a) ** 0.6)
        return np.tile(h, (ny, 1))

    def kink_x(self, t: float) -> float:
        """x where t = t_e(x): r t = (r x / a)^{3/5}  ->  x = a (r t)^{5/3} / r."""
        return self.a * (self.rain * t) ** (5.0 / 3.0) / self.rain

    def compare_mask_kink(self, band_m: float = 100.0):
        """Mask fn: outlet band and |x - x_kink(t)| <= band_m excluded (diagnostic: the
        order is ~0.85 with or without this band)."""
        def fn(lv: LevelResult, t: float) -> np.ndarray:
            ny, nx = lv.final_state.h.shape
            x = _centres(nx, lv.dx)
            keep = (x < self.length - self.dx_coarse) & (np.abs(x - self.kink_x(t)) > band_m)
            return np.tile(keep, (ny, 1))
        return fn

    def compare_mask(self, lv: LevelResult) -> np.ndarray:
        """Exclude x within one coarse cell of the outlet (sink) boundary."""
        ny, nx = lv.final_state.h.shape
        x = _centres(nx, lv.dx)
        return np.tile(x < self.length - self.dx_coarse, (ny, 1))


@dataclass
class ThackerBowl:
    length: float = 4.0
    a: float = 1.0
    h0: float = 0.5
    b: float = 0.5  # velocity amplitude [m/s]; Fr = b/sqrt(g h0) = 0.23
    ny_coarse: int = 2
    dx_coarse: float = 0.08
    periods: float = 1.0
    outputs_per_period: int = 8

    @property
    def omega(self) -> float:
        return np.sqrt(2 * G * self.h0) / self.a

    @property
    def period(self) -> float:
        return 2 * np.pi / self.omega

    def bed(self, x):
        xp = x - self.length / 2
        return self.h0 * (xp**2 / self.a**2 - 1.0)

    def eta(self, x, t):
        xp = x - self.length / 2
        w, b = self.omega, self.b
        return -(b * w / G) * np.cos(w * t) * xp + b**2 * np.sin(w * t) ** 2 / (2 * G)

    def h_exact_1d(self, x, t):
        return np.maximum(self.eta(x, t) - self.bed(x), 0.0)

    def __call__(self, dx: float) -> CaseSetup:
        nx = int(round(self.length / dx))
        ny = int(round(self.ny_coarse * self.dx_coarse / dx))
        x = _centres(nx, dx)
        z = np.tile(self.bed(x), (ny, 1))
        dom = Domain(z=z, dx=dx, manning_n=0.0)
        s = State.dry((ny, nx))
        # cell-average of the exact initial depth (8-point Gauss-free midpoint subsampling)
        sub = (np.arange(16) + 0.5) / 16 * dx
        xs = (x[:, None] - dx / 2 + sub[None, :])
        s.h[:] = np.tile(self.h_exact_1d(xs, 0.0).mean(axis=1), (ny, 1))
        t_end = self.periods * self.period
        return CaseSetup(dom, s, lambda t: 0.0, t_end, t_end / (self.periods *
                         self.outputs_per_period), {"case": "thacker_1d"})

    def exact_depth(self, lv: LevelResult, t: float) -> np.ndarray:
        ny, nx = lv.final_state.h.shape
        dx = lv.dx
        x = _centres(nx, dx)
        sub = (np.arange(16) + 0.5) / 16 * dx
        xs = x[:, None] - dx / 2 + sub[None, :]
        return np.tile(self.h_exact_1d(xs, t).mean(axis=1), (ny, 1))


def froude_max(lv: LevelResult, h_min: float = 1e-3) -> float:
    """Max Froude number |q|/(h sqrt(g h)) on x-faces at the final state, faces with h>h_min."""
    s = lv.final_state
    hf = 0.5 * (s.h[:, 1:] + s.h[:, :-1])
    m = hf > h_min
    if not m.any():
        return 0.0
    return float((np.abs(s.qx[m]) / (hf[m] * np.sqrt(G * hf[m]))).max())
