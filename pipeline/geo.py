"""Spatial helpers: TWD97 <-> WGS84, village polygons, point-in-village assignment, compact output.

All metric work (distances, areas, buffers) happens in TWD97 / EPSG:3826 (meters).
Everything written for the dashboard is WGS84 rounded to 5 decimals (~1 m).
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import numpy as np
import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape

from .common import RAW

_to97 = Transformer.from_crs("EPSG:4326", "EPSG:3826", always_xy=True)
_to84 = Transformer.from_crs("EPSG:3826", "EPSG:4326", always_xy=True)


def lonlat_to_97(lon, lat):
    return _to97.transform(np.asarray(lon, float), np.asarray(lat, float))


def xy_to_84(x, y):
    return _to84.transform(np.asarray(x, float), np.asarray(y, float))


def geom_to_84(g):
    return shapely.transform(g, lambda a: np.column_stack(_to84.transform(a[:, 0], a[:, 1])))


def geom_to_97(g):
    return shapely.transform(g, lambda a: np.column_stack(_to97.transform(a[:, 0], a[:, 1])))


def load_shp_zip(path: Path) -> list[tuple[dict, object]]:
    """Read a zipped shapefile into [(record_dict, shapely_geom)] without extracting to disk."""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    stem = next(n[:-4] for n in names if n.lower().endswith(".shp"))
    r = shapefile.Reader(
        shp=io.BytesIO(z.read(stem + ".shp")),
        shx=io.BytesIO(z.read(stem + ".shx")),
        dbf=io.BytesIO(z.read(stem + ".dbf")),
        encoding="utf-8",
    )
    return [(rec.as_dict(), shape(shp.__geo_interface__)) for rec, shp in zip(r.records(), r.shapes())]


class Villages:
    """The 456 里 polygons (TWD97) with a spatial index for fast assignment."""

    def __init__(self):
        rows = load_shp_zip(RAW / "data_taipei" / "village_latest.zip")
        self.recs = [r for r, _ in rows]
        self.geoms = [shapely.make_valid(g) for _, g in rows]
        self.n = len(self.geoms)
        self.tree = shapely.STRtree(self.geoms)
        self.key = [(norm_name(r["TNAME"]), norm_name(r["VNAME"])) for r in self.recs]
        self.index = {k: i for i, k in enumerate(self.key)}
        self.area_m2 = np.array([g.area for g in self.geoms])
        self.rep = [g.representative_point() for g in self.geoms]

    def assign_xy(self, x, y) -> np.ndarray:
        """Village index for each TWD97 point, -1 when outside Taipei."""
        pts = shapely.points(np.asarray(x, float), np.asarray(y, float))
        out = np.full(len(pts), -1, dtype=int)
        pi, gi = self.tree.query(pts, predicate="within")
        out[pi] = gi
        return out

    def assign_lonlat(self, lon, lat) -> np.ndarray:
        x, y = lonlat_to_97(lon, lat)
        return self.assign_xy(x, y)

    # variant spellings found in agency files -> name used in the 里界圖
    ALIAS = {"糖部里": "糖蔀里", "糖廍里": "糖蔀里", "葫州里": "葫洲里"}

    def lookup(self, district: str, village: str) -> int:
        d, v = norm_name(district), norm_name(village)
        v = self.ALIAS.get(v, v)
        i = self.index.get((d, v), -1)
        if i < 0 and "?" in v:  # cp950 files turn rare characters (e.g. 糖廍里) into '?'
            hits = [k for k, (kd, kv) in enumerate(self.key) if kd == d and len(kv) == len(v)
                    and all(a == b or a == "?" for a, b in zip(v, kv))]
            i = hits[0] if len(hits) == 1 else -1
        return i


def norm_name(s: str) -> str:
    return str(s).strip().replace("台", "臺").replace("　", "")


def rnd(v, nd=5):
    if isinstance(v, float):
        return round(v, nd)
    if isinstance(v, (list, tuple)):
        return [rnd(x, nd) for x in v]
    return v


def feature(geom84, props: dict, nd: int = 5) -> dict:
    g = mapping(geom84)
    return {"type": "Feature", "properties": props, "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"], nd)}}


def clean(o):
    """Recursively turn NaN/inf and numpy scalars into JSON-safe values."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        f = float(o)
        return None if (np.isnan(f) or np.isinf(f)) else f
    return o


def write_json(path: Path, obj, pretty: bool = False) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(clean(obj), ensure_ascii=False, indent=1 if pretty else None, separators=None if pretty else (",", ":"),
                   allow_nan=False, default=_np_default)
    path.write_text(s)
    return len(s.encode())


def _np_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))
