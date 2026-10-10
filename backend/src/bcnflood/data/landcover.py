"""Rasterise OSM land cover onto the G2 DEM grid -> class, Manning n, Green-Ampt.

All parameter values come from config/manning_overland.json and
config/green_ampt_rawls1983.json, through config/landcover_param_lookup.json.
Output kind: ESTIMATE. See the lookup file for the assumptions (A1-A7).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import pathlib
from collections import Counter

import numpy as np
import rasterio
from rasterio.features import rasterize
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import linemerge, polygonize, transform, unary_union

from .osm import TO_25831

NODATA_F = -9999.0
SEALED_KS = 0.0



def _lines(g):
    """linemerge may return a MultiLineString; polygonize needs an iterable of lines."""
    return list(g.geoms) if hasattr(g, "geoms") else [g]

def _poly(e):
    if e["type"] == "way":
        c = [(p["lon"], p["lat"]) for p in e.get("geometry", [])]
        return Polygon(c) if len(c) >= 4 and c[0] == c[-1] else None
    mem = [m for m in e.get("members", []) if len(m.get("geometry", [])) > 1]
    outer = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in mem if m.get("role") == "outer"]
    inner = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
             for m in mem if m.get("role") == "inner"]
    po = list(polygonize(_lines(linemerge(outer)))) if outer else []
    if not po:
        return None
    g = unary_union(po)
    pi = list(polygonize(_lines(linemerge(inner)))) if inner else []
    return g.difference(unary_union(pi)) if pi else g


def build(dem="manifests/raw/g2/bcn_mdt05_25831.tif", raw="manifests/raw/g3",
          out="manifests/derived/landcover"):
    cfg = json.load(open("config/landcover_param_lookup.json"))
    man = json.load(open("config/manning_overland.json"))["surfaces"]
    ga = json.load(open("config/green_ampt_rawls1983.json"))["classes"]
    tagmap = {}
    for c in cfg["classes"]:
        if isinstance(c["osm"], list):
            for t in c["osm"]:
                tagmap[t] = c
    with rasterio.open(dem) as d:
        prof, tr, shp = d.profile, d.transform, d.shape
        inside = d.read(1) != d.nodata
    layers = {}  # order -> list[(geom, code)]
    for k in ("landuse", "natural", "leisure"):
        ways = [e for e in json.load(open(f"{raw}/landcover/osm_{k}_raw.json"))["elements"]
                if e["type"] == "way"]
        # relations re-fetched with 'out body geom' (members); 'out geom tags' drops them
        rels = json.load(open(f"{raw}/landcover/osm_{k}_relations_raw.json"))["elements"]
        for e in ways + rels:
            t = e.get("tags", {})
            c = tagmap.get(f"{k}={t.get(k)}")
            if not c:
                continue
            g = _poly(e)
            if g is None or g.is_empty:
                continue
            g = transform(TO_25831, g if g.is_valid else g.buffer(0))
            layers.setdefault(c["order"], []).append((g, c["code"]))
    hw = cfg["road_half_width_m"]
    for e in json.load(gzip.open(f"{raw}/osm_highways_raw.json.gz"))["elements"]:
        t = e.get("tags", {})
        if e["type"] != "way" or t.get("tunnel") in ("yes", "building_passage") \
                or t.get("covered") == "yes" or len(e.get("geometry", [])) < 2:
            continue
        h = t.get("highway")
        unp = h in cfg["unpaved_highway"] or t.get("surface") in cfg["unpaved_surface_values"]
        ln = transform(TO_25831, LineString([(p["lon"], p["lat"]) for p in e["geometry"]]))
        layers.setdefault(5, []).append((ln.buffer(hw.get(h, hw["default"]), cap_style="flat"),
                                         11 if unp else 10))
    bpath = "manifests/derived/osm/bcn_buildings_osm_25831.geojson.gz"
    for f in json.load(gzip.open(bpath))["features"]:
        layers.setdefault(6, []).append((shape(f["geometry"]), 12))
    cls = np.ones(shp, dtype="uint8")  # default urban_sealed
    for order in sorted(layers):
        # inside an order: paved roads drawn after unpaved
        shapes = sorted(layers[order], key=lambda x: x[1] == 10)
        rasterize(shapes, out_shape=shp, transform=tr, out=cls, all_touched=False)
    cls[~inside] = 0
    lut = {c["code"]: c for c in cfg["classes"]}
    n = np.full(shp, NODATA_F, "float32")
    ks = n.copy()
    psi = n.copy()
    por = n.copy()
    the = n.copy()
    for code, c in lut.items():
        m = cls == code
        n[m] = man[c["manning_surface"]]
        if c["soil"]:
            s = ga[c["soil"]]
            ks[m] = s["saturated_hydraulic_conductivity"]
            psi[m] = s["wetting_front_suction_head"]
            por[m] = s["porosity"]
            the[m] = s["effective_porosity"]
        else:
            ks[m] = SEALED_KS
    o = pathlib.Path(out)
    o.mkdir(parents=True, exist_ok=True)
    files = {}
    pf = dict(prof, compress="deflate", tiled=True)
    for name, arr, unit in [("class", cls, "class code"), ("manning_n", n, "s m^-1/3"),
                            ("ga_ks_cm_h", ks, "cm/h"), ("ga_psi_cm", psi, "cm"),
                            ("ga_porosity", por, "-"), ("ga_eff_porosity", the, "-")]:
        p = o / f"bcn_{name}_25831_5m.tif"
        kw = dict(pf, dtype=arr.dtype.name, nodata=0 if name == "class" else NODATA_F)
        with rasterio.open(p, "w", **kw) as w:
            w.write(arr, 1)
        files[name] = {"file": str(p), "unit": unit,
                       "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    cnt = Counter(cls[inside].ravel().tolist())
    tot = int(inside.sum())
    stats = {lut[k]["name"]: {"code": k, "cells": v, "km2": round(v * 25 / 1e6, 3),
                              "pct": round(100 * v / tot, 2)} for k, v in sorted(cnt.items())}
    rep = {"grid": {"crs": str(prof["crs"]), "res_m": 5, "shape": list(shp),
                    "transform": list(tr)[:6]},
           "inside_cells": tot, "unassigned_inside": int((cls[inside] == 0).sum()),
           "params_nodata_inside": {"manning_n": int((n[inside] == NODATA_F).sum()),
                                    "ga_ks": int((ks[inside] == NODATA_F).sum())},
           "class_stats": stats, "files": files}
    (o / "landcover_build_report.json").write_text(json.dumps(rep, indent=1))
    return rep


if __name__ == "__main__":
    r = build()
    print(json.dumps({k: v for k, v in r.items() if k != "files"}, indent=1))
