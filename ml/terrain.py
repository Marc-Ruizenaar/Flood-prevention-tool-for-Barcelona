"""DEM mosaic (AWS Terrarium z15) and terrain derivatives: slope, D8 flow accumulation, TWI,
depression depth, distance to sea. Plain numpy plus scipy.ndimage."""
from __future__ import annotations

import heapq
import math
import time

import numpy as np
import requests
from PIL import Image
from scipy import ndimage

from config import (DEM_URL, DEM_ZOOM, DEPRESSION_FLOOR_M, DOWNSAMPLE, MARGIN_E, MARGIN_N,
                    MARGIN_S, MARGIN_W, MIN_TAN_SLOPE, SEA_ELEV_M, SMOOTH_PX, TILE_DIR)
from geo import R_EARTH_M


def lonlat_to_tile_f(lon, lat, z):
    n = 2 ** z
    x = (np.asarray(lon, float) + 180.0) / 360.0 * n
    lat_r = np.radians(np.asarray(lat, float))
    y = (1.0 - np.arcsinh(np.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


def tile_f_to_lonlat(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def fetch_tile(z, x, y):
    TILE_DIR.mkdir(parents=True, exist_ok=True)
    path = TILE_DIR / f"{z}_{x}_{y}.png"
    if not path.exists():
        url = DEM_URL.format(z=z, x=x, y=y)
        last = None
        for attempt in range(4):
            try:
                r = requests.get(url, timeout=30)
                r.raise_for_status()
                path.write_bytes(r.content)
                break
            except Exception as e:  # network flake, retry
                last = e
                time.sleep(1.5 * (attempt + 1))
        else:
            raise RuntimeError(f"tile {z}/{x}/{y} failed: {last}")
    return path


def decode_terrarium(png_path) -> np.ndarray:
    a = np.asarray(Image.open(png_path).convert("RGB"), dtype=np.float64)
    return (a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0) - 32768.0


class Dem:
    """Downsampled mosaic plus the geotransform back to lon/lat."""

    def __init__(self, west, south, east, north):
        z = DEM_ZOOM
        fx0, fy0 = lonlat_to_tile_f(west, north, z)
        fx1, fy1 = lonlat_to_tile_f(east, south, z)
        self.tx0, self.ty0 = int(math.floor(fx0)), int(math.floor(fy0))
        self.tx1, self.ty1 = int(math.floor(fx1)), int(math.floor(fy1))
        rows = []
        for ty in range(self.ty0, self.ty1 + 1):
            row = [decode_terrarium(fetch_tile(z, tx, ty)) for tx in range(self.tx0, self.tx1 + 1)]
            rows.append(np.concatenate(row, axis=1))
        raw = np.concatenate(rows, axis=0)
        f = DOWNSAMPLE
        h, w = (raw.shape[0] // f) * f, (raw.shape[1] // f) * f
        self.dem = raw[:h, :w].reshape(h // f, f, w // f, f).mean(axis=(1, 3))
        lat_mid = tile_f_to_lonlat(self.tx0, (self.ty0 + self.ty1 + 1) / 2, z)[1]
        native = 2 * math.pi * R_EARTH_M * math.cos(math.radians(lat_mid)) / (256 * 2 ** z)
        self.cell = native * f

    def frac_pixel(self, lon, lat):
        """lon/lat -> (row, col) in downsampled pixel units (pixel centres at integers)."""
        fx, fy = lonlat_to_tile_f(lon, lat, DEM_ZOOM)
        col = (fx - self.tx0) * 256.0 / DOWNSAMPLE - 0.5
        row = (fy - self.ty0) * 256.0 / DOWNSAMPLE - 0.5
        return row, col


def priority_flood(dem: np.ndarray, eps: float = 1e-5):
    """Priority-flood with epsilon. Returns (filled, receiver, order).

    receiver[i] is the flat index of the cell that i drains to (-1 for outlets on the
    mosaic border). order is the pop order: every cell comes after its receiver.
    """
    h, w = dem.shape
    z = dem.ravel().tolist()
    filled = list(z)
    recv = [-2] * (h * w)
    heap: list[tuple[float, int]] = []
    for r in range(h):
        for c in (0, w - 1):
            i = r * w + c
            if recv[i] == -2:
                recv[i] = -1
                heap.append((z[i], i))
    for c in range(w):
        for r in (0, h - 1):
            i = r * w + c
            if recv[i] == -2:
                recv[i] = -1
                heap.append((z[i], i))
    heapq.heapify(heap)
    order: list[int] = []
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    pop, push = heapq.heappop, heapq.heappush
    while heap:
        zc, i = pop(heap)
        order.append(i)
        r, c = divmod(i, w)
        for dr, dc in nbrs:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w:
                j = rr * w + cc
                if recv[j] == -2:
                    recv[j] = i
                    nz = z[j]
                    if nz <= zc:
                        nz = zc + eps
                    filled[j] = nz
                    push(heap, (nz, j))
    return (np.array(filled).reshape(h, w), np.array(recv, dtype=np.int64),
            np.array(order, dtype=np.int64))


def flow_accumulation(recv: np.ndarray, order: np.ndarray) -> np.ndarray:
    r = recv.tolist()
    a = [1.0] * len(r)
    for i in reversed(order.tolist()):
        j = r[i]
        if j >= 0:
            a[j] += a[i]
    return np.array(a)


class Terrain:
    """All terrain layers for the mosaic, plus a sampler for lon/lat points."""

    def __init__(self, bbox):
        w, s, e, n = bbox
        d = Dem(w - MARGIN_W, s - MARGIN_S, e + MARGIN_E, n + MARGIN_N)
        self.dem_obj = d
        self.raw = d.dem
        smooth = ndimage.uniform_filter(self.raw, size=SMOOTH_PX, mode="nearest")
        gy, gx = np.gradient(smooth, d.cell)
        self.tan_slope = np.hypot(gx, gy)
        filled, recv, order = priority_flood(smooth)
        self.depression = np.maximum(0.0, filled - smooth - DEPRESSION_FLOOR_M)
        self.acc = flow_accumulation(recv, order).reshape(smooth.shape)
        a_specific = self.acc * d.cell                       # contributing area per unit width, m
        self.twi = np.log(a_specific / np.maximum(self.tan_slope, MIN_TAN_SLOPE))
        sea = self.raw <= SEA_ELEV_M
        self.sea_cells = int(sea.sum())
        if self.sea_cells:
            self.dist_sea = ndimage.distance_transform_edt(~sea) * d.cell
        else:
            self.dist_sea = np.full(self.raw.shape, np.nan)

    def sample(self, lon, lat):
        row, col = self.dem_obj.frac_pixel(lon, lat)
        coords = np.vstack([row, col])
        inside = ((row >= 0) & (row <= self.raw.shape[0] - 1) &
                  (col >= 0) & (col <= self.raw.shape[1] - 1))

        def s(a):
            return ndimage.map_coordinates(a, coords, order=1, mode="nearest")

        return {
            "elevation_m": s(self.raw),
            "slope_pct": s(self.tan_slope) * 100.0,
            "log_flow_acc": np.log1p(s(self.acc)),
            "twi": s(self.twi),
            "depression_depth_m": s(self.depression),
            "dist_sea_m": s(self.dist_sea),
            "inside": inside,
        }
