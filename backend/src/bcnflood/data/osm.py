"""G3 fallback / M2-A1-07: OSM buildings and street segments for Barcelona.

FALLBACK SOURCE: used because Catastro INSPIRE BU WFS failed (timeouts / HTTP 400).
Data (c) OpenStreetMap contributors, ODbL 1.0. Raw Overpass responses are in
manifests/raw/g3/ (not committed, they are large; sha256 recorded).
Outputs are gzipped GeoJSON in EPSG:25831 and EPSG:4326.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import pathlib

from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.ops import linemerge, polygonize, transform, unary_union

LICENCE = "ODbL 1.0 - (c) OpenStreetMap contributors"
TO_25831 = Transformer.from_crs("EPSG:4326", "EPSG:25831", always_xy=True).transform



def _lines(g):
    """linemerge may return a MultiLineString; polygonize needs an iterable of lines."""
    return list(g.geoms) if hasattr(g, "geoms") else [g]

def _coords(geom):
    return [(p["lon"], p["lat"]) for p in geom]


def buildings(raw: dict):
    for e in raw["elements"]:
        tags = e.get("tags", {})
        g = None
        if e["type"] == "way" and len(e.get("geometry", [])) >= 4:
            c = _coords(e["geometry"])
            if c[0] == c[-1]:
                g = Polygon(c)
        elif e["type"] == "relation":
            outer = [LineString(_coords(m["geometry"])) for m in e.get("members", [])
                     if m.get("role") == "outer" and len(m.get("geometry", [])) >= 2]
            inner = [LineString(_coords(m["geometry"])) for m in e.get("members", [])
                     if m.get("role") == "inner" and len(m.get("geometry", [])) >= 2]
            po = list(polygonize(_lines(linemerge(outer)))) if outer else []
            pi = list(polygonize(_lines(linemerge(inner)))) if inner else []
            if po:
                g = unary_union(po)
                if pi:
                    g = g.difference(unary_union(pi))
        if g is None or g.is_empty:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        if isinstance(g, (Polygon, MultiPolygon)) and not g.is_empty:
            yield {"osm_type": e["type"], "osm_id": e["id"], "building": tags.get("building"),
                   "levels": tags.get("building:levels"), "name": tags.get("name")}, g


def streets(raw: dict):
    for e in raw["elements"]:
        if e["type"] != "way" or len(e.get("geometry", [])) < 2:
            continue
        t = e.get("tags", {})
        yield {"osm_id": e["id"], "name": t.get("name"), "highway": t.get("highway"),
               "area": t.get("area") == "yes"}, LineString(_coords(e["geometry"]))


def write(features, path: str, crs: str) -> dict:
    urn = f"urn:ogc:def:crs:{crs.replace(':', '::')}"
    fc = {"type": "FeatureCollection", "name": pathlib.Path(path).name,
          "crs": {"type": "name", "properties": {"name": urn}},
          "licence": LICENCE, "label": "FALLBACK (OSM), CONDITIONAL",
          "features": [{"type": "Feature", "properties": p, "geometry": mapping(g)}
                       for p, g in features]}
    data = json.dumps(fc, separators=(",", ":")).encode()
    pathlib.Path(path).write_bytes(gzip.compress(data, mtime=0))
    b = pathlib.Path(path).read_bytes()
    return {"file": path, "crs": crs, "n_features": len(fc["features"]), "bytes": len(b),
            "sha256": hashlib.sha256(b).hexdigest()}


def build(raw_dir="manifests/raw/g3", out_dir="manifests/derived/osm") -> dict:
    raw_dir, out = pathlib.Path(raw_dir), pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rep = {"licence": LICENCE, "raw": []}
    for name in ("osm_buildings_raw.json", "osm_highways_raw.json",
                 "osm_building_relations_raw.json"):
        b = (raw_dir / name).read_bytes()
        rep["raw"].append({"file": str(raw_dir / name), "bytes": len(b),
                           "sha256": hashlib.sha256(b).hexdigest(),
                           "osm3s": json.loads(b)["osm3s"]})
    braw = json.loads((raw_dir / "osm_buildings_raw.json").read_bytes())
    hraw = json.loads((raw_dir / "osm_highways_raw.json").read_bytes())
    # 'out geom tags' omits relation members; relations come from an 'out body geom' query
    rels = json.loads((raw_dir / "osm_building_relations_raw.json").read_bytes())["elements"]
    braw["elements"] = [e for e in braw["elements"] if e["type"] != "relation"] + rels
    bl = list(buildings(braw))
    st = list(streets(hraw))
    rep["outputs"] = [
        write(bl, str(out / "bcn_buildings_osm_4326.geojson.gz"), "EPSG:4326"),
        write([(p, transform(TO_25831, g)) for p, g in bl],
              str(out / "bcn_buildings_osm_25831.geojson.gz"), "EPSG:25831"),
        write(st, str(out / "bcn_streets_osm_4326.geojson.gz"), "EPSG:4326"),
        write([(p, transform(TO_25831, g)) for p, g in st],
              str(out / "bcn_streets_osm_25831.geojson.gz"), "EPSG:25831"),
    ]
    rep["buildings_area_km2"] = sum(transform(TO_25831, g).area for _, g in bl) / 1e6
    rep["streets_length_km"] = sum(transform(TO_25831, g).length for _, g in st) / 1e3
    from collections import Counter
    rep["highway_classes"] = dict(Counter(p["highway"] for p, _ in st).most_common())
    rep["dropped_building_elements"] = len(braw["elements"]) - len(bl)
    (out / "osm_build_report.json").write_text(json.dumps(rep, indent=1))
    return rep


if __name__ == "__main__":
    r = build()
    print(json.dumps({k: v for k, v in r.items() if k != "highway_classes"}, indent=1))
