"""Grid topology helpers (Agent 2): sea-outlet mask, connected components, roof routing.
Pure NumPy (no scipy on the box). 4-connectivity throughout."""
from __future__ import annotations

import numpy as np


def _neighbours_any(m: np.ndarray) -> np.ndarray:
    """True where any 4-neighbour of the cell is True."""
    o = np.zeros_like(m)
    o[1:, :] |= m[:-1, :]
    o[:-1, :] |= m[1:, :]
    o[:, 1:] |= m[:, :-1]
    o[:, :-1] |= m[:, 1:]
    return o


def flood_fill(allowed: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """Cells in `allowed` 4-connected to `seeds & allowed`."""
    cur = seeds & allowed
    while True:
        nxt = cur | (_neighbours_any(cur) & allowed)
        if (nxt == cur).all():
            return cur
        cur = nxt


def sea_outlet_mask(dem_m: np.ndarray, active: np.ndarray | None = None,
                    sea_level_m: float = 0.0, sea_side: str = "outside") -> np.ndarray:
    """Outlet cells = active cells with DEM <= sea_level_m that are connected (through such
    cells) to the sea. Seeds: active low cells on the domain edge or adjacent to inactive
    (NoData) cells when sea_side == "outside" (the clipped DEM has the sea as NoData); or a
    given side "north"/"south"/"east"/"west" edge row/column. ASSUMPTION: sea at 0 m."""
    ny, nx = dem_m.shape
    act = np.ones((ny, nx), bool) if active is None else active
    low = act & np.isfinite(dem_m) & (dem_m <= sea_level_m)
    seed = np.zeros((ny, nx), bool)
    if sea_side == "outside":
        seed[0, :] = seed[-1, :] = True
        seed[:, 0] = seed[:, -1] = True
        seed |= _neighbours_any(~act)
    else:
        sl = {"north": (0, slice(None)), "south": (-1, slice(None)),
              "west": (slice(None), 0), "east": (slice(None), -1)}[sea_side]
        seed[sl] = True
    return flood_fill(low, seed)


def label_components(mask: np.ndarray) -> np.ndarray:
    """4-connected labels (>=0) for True cells, -1 elsewhere (min-label propagation)."""
    big = np.iinfo(np.int64).max
    lab = np.where(mask, np.arange(mask.size).reshape(mask.shape), big)
    while True:
        new = lab.copy()
        new[1:, :] = np.minimum(new[1:, :], np.where(mask[1:, :], lab[:-1, :], big))
        new[:-1, :] = np.minimum(new[:-1, :], np.where(mask[:-1, :], lab[1:, :], big))
        new[:, 1:] = np.minimum(new[:, 1:], np.where(mask[:, 1:], lab[:, :-1], big))
        new[:, :-1] = np.minimum(new[:, :-1], np.where(mask[:, :-1], lab[:, 1:], big))
        new = np.where(mask, new, big)
        if (new == lab).all():
            break
        lab = new
    out = np.full(mask.shape, -1, np.int64)
    _, inv = np.unique(lab[mask], return_inverse=True)
    out[mask] = inv
    return out


class RoofRouter:
    """Downspout ASSUMPTION (no source): rain on each connected building block is spread
    equally over the open active cells 4-adjacent to that block. Blocks with no open
    neighbour keep their rain as `unrouted` (booked, reported)."""
    label = "assumption"

    def __init__(self, building: np.ndarray, open_: np.ndarray):
        self.lab = label_components(building)
        self.bidx = np.flatnonzero(building)
        self.blab = self.lab.ravel()[self.bidx]
        ncomp = int(self.blab.max()) + 1 if self.bidx.size else 0
        ny, nx = building.shape
        pairs = []
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ys, xs = np.nonzero(building)
            ry, rx = ys + dy, xs + dx
            ok = (ry >= 0) & (ry < ny) & (rx >= 0) & (rx < nx)
            ys, xs, ry, rx = ys[ok], xs[ok], ry[ok], rx[ok]
            ok = open_[ry, rx]
            pairs.append(np.stack([self.lab[ys[ok], xs[ok]], ry[ok] * nx + rx[ok]], 1))
        p = np.unique(np.concatenate(pairs) if pairs else np.zeros((0, 2), int), axis=0)
        self.pc, self.pr = p[:, 0], p[:, 1]
        cnt = np.bincount(self.pc, minlength=ncomp).astype(float)
        self.w = 1.0 / cnt[self.pc] if p.size else np.zeros(0)
        self.has_rx = cnt > 0
        self.ncomp = ncomp
        self.shape = building.shape

    def route(self, field_on_buildings: np.ndarray) -> tuple[np.ndarray, float]:
        """field [m/s] on building cells -> (added rate field on receivers [m/s],
        unrouted rate sum over cells [m/s * cells])."""
        add = np.zeros(self.shape).ravel()
        if self.ncomp == 0:
            return add.reshape(self.shape), 0.0
        comp = np.bincount(self.blab, field_on_buildings.ravel()[self.bidx],
                           minlength=self.ncomp)
        unrouted = float(comp[~self.has_rx].sum())
        np.add.at(add, self.pr, comp[self.pc] * self.w)
        return add.reshape(self.shape), unrouted


def boundary_cells(active: np.ndarray) -> np.ndarray:
    """Active cells on the array edge or 4-adjacent to an inactive (NoData) cell."""
    e = _neighbours_any(~active)
    e[0, :] = e[-1, :] = True
    e[:, 0] = e[:, -1] = True
    return active & e


def river_edge_outlets(dem_m: np.ndarray, active: np.ndarray, max_elev_m: float = 10.0,
                       sea: np.ndarray | None = None) -> dict:
    """Free-outflow (critical-depth) edge cells for the Llobregat (SW) and Besos (NE) sides.

    Method (ASSUMPTION, documented, read-only on the DEM; no external source):
      1. boundary cells = active cells adjacent to NoData / array edge (municipal clip edge);
      2. keep those with DEM <= max_elev_m (low-lying river plains; Collserola ridge edges
         lie far above this and stay CLOSED);
      3. drop sea-outlet cells and their neighbours (coast handled by sea_outlet_mask);
      4. split by position relative to the active-area centroid (row 0 = north):
         north-east quadrant -> "besos", south-west quadrant -> "llobregat"; low boundary
         cells elsewhere (coast/port) are not river outlets.
    CONDITIONAL: runoff entering from outside the municipality (upstream catchments of the
    Llobregat, Besos and Collserola beyond the boundary) is ignored.
    Returns {"besos": mask, "llobregat": mask, "all": mask, "kind": "assumption"}."""
    if sea is None:
        sea = sea_outlet_mask(np.where(active, dem_m, np.nan), active)
    low = boundary_cells(active) & (dem_m <= max_elev_m) & ~sea & ~_neighbours_any(sea)
    ys, xs = np.nonzero(active)
    cy, cx = ys.mean(), xs.mean()
    yy, xx = np.mgrid[:dem_m.shape[0], :dem_m.shape[1]]
    besos = low & (yy < cy) & (xx > cx)
    llob = low & (yy > cy) & (xx < cx)
    return {"besos": besos, "llobregat": llob, "all": besos | llob, "kind": "assumption",
            "method": f"boundary & DEM<={max_elev_m:.1f} m & not sea, NE/SW of centroid"}
