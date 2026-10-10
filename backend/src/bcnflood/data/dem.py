"""G2: IGN/CNIG MDT05 (5 m DTM) via IDEE WCS 2.0.1, clipped to Barcelona municipality.

ICGC MET2 has no public raw-value WCS reachable from the box (WMS only renders
images; datacloud.icgc.cat times out), so the IGN fallback is used.

Pipeline: GetCoverage Elevacion4258_5 (ETRS89 geographic, int16 GeoTIFF) in
tiles -> merge -> reproject to EPSG:25831 on an exact 5 m grid (bilinear) ->
mask outside the municipality polygon (NoData=-9999, float32).
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import time
import urllib.request
from datetime import UTC, datetime

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_geom
from shapely.geometry import mapping, shape

WCS = "https://servicios.idee.es/wcs-inspire/mdt"
COVERAGE = "Elevacion4258_5"
DST_CRS = "EPSG:25831"
RES = 5.0
NODATA = -9999.0


def _sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _get(url: str, dest: pathlib.Path, retries: int = 4) -> None:
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                dest.write_bytes(r.read())
            with rasterio.open(dest):
                return
        except Exception:  # noqa: BLE001
            if i == retries - 1:
                raise
            time.sleep(2 ** (i + 1))


def build(boundary_geojson: str, raw_dir: str, out_tif: str, ntiles: int = 3) -> dict:
    raw = pathlib.Path(raw_dir)
    raw.mkdir(parents=True, exist_ok=True)
    geom4326 = shape(json.load(open(boundary_geojson))["features"][0]["geometry"])
    lon0, lat0, lon1, lat1 = geom4326.bounds
    m = 0.005
    lon0, lat0, lon1, lat1 = lon0 - m, lat0 - m, lon1 + m, lat1 + m
    tiles, probes = [], []
    lons = np.linspace(lon0, lon1, ntiles + 1)
    lats = np.linspace(lat0, lat1, ntiles + 1)
    for i in range(ntiles):
        for j in range(ntiles):
            url = (f"{WCS}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID={COVERAGE}"
                   f"&FORMAT=image/tiff&SUBSET=Lat({lats[j]:.5f},{lats[j+1]:.5f})"
                   f"&SUBSET=Long({lons[i]:.5f},{lons[i+1]:.5f})")
            p = raw / f"mdt05_tile_{i}{j}.tif"
            t = datetime.now(UTC).isoformat(timespec="seconds")
            _get(url, p)
            tiles.append(p)
            probes.append({"url": url, "fetched_at_utc": t, "file": str(p),
                           "bytes": p.stat().st_size, "sha256": _sha(p)})
    srcs = [rasterio.open(p) for p in tiles]
    src_crs = srcs[0].crs
    mosaic, mtrans = merge(srcs)
    src_nodata = srcs[0].nodata
    for s in srcs:
        s.close()
    geom = shape(transform_geom("EPSG:4326", DST_CRS, mapping(geom4326)))
    x0, y0, x1, y1 = geom.bounds
    x0, y0 = np.floor(x0 / RES) * RES - RES, np.floor(y0 / RES) * RES - RES
    x1, y1 = np.ceil(x1 / RES) * RES + RES, np.ceil(y1 / RES) * RES + RES
    w, h = int((x1 - x0) / RES), int((y1 - y0) / RES)
    transform = from_origin(x0, y1, RES, RES)
    dst = np.full((h, w), NODATA, dtype="float32")
    reproject(mosaic[0].astype("float32"), dst, src_transform=mtrans, src_crs=src_crs,
              src_nodata=src_nodata, dst_transform=transform, dst_crs=DST_CRS,
              dst_nodata=NODATA, resampling=Resampling.bilinear)
    outside = geometry_mask([mapping(geom)], (h, w), transform, invert=False)
    dst[outside] = NODATA
    prof = dict(driver="GTiff", height=h, width=w, count=1, dtype="float32", crs=DST_CRS,
                transform=transform, nodata=NODATA, compress="deflate", tiled=True)
    pathlib.Path(out_tif).parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_tif, "w", **prof) as o:
        o.write(dst, 1)
    valid = dst != NODATA
    v = dst[valid]
    return {"source_crs": str(src_crs), "source_dtype": "int16", "src_nodata": src_nodata,
            "tiles": probes, "out": out_tif, "out_sha256": _sha(pathlib.Path(out_tif)),
            "shape": [h, w], "bounds_25831": [x0, y0, x1, y1],
            "boundary_area_km2": geom.area / 1e6,
            "valid_cells": int(valid.sum()), "valid_area_km2": valid.sum() * RES * RES / 1e6,
            "elev_min": float(v.min()), "elev_max": float(v.max()),
            "elev_p01": float(np.percentile(v, 1)), "elev_p99": float(np.percentile(v, 99)),
            "n_le_0": int((v <= 0).sum())}


if __name__ == "__main__":
    r = build("manifests/raw/g2/bcn_boundary_osm_nominatim.json", "manifests/raw/g2/tiles",
              "manifests/raw/g2/bcn_mdt05_25831.tif")
    json.dump(r, open("manifests/raw/g2/dem_build_report.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in r.items() if k != "tiles"}, indent=1))
