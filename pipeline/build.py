"""Build the dashboard data from data/raw/ (reads local files only, never calls external APIs).

    .venv/bin/python -m pipeline.build

Writes dashboard/public/data/:
  villages.geojson    456 里：人口、六題指標、分數 s1..s6、融合指數 f、多重熱點 hot
  districts.geojson   12 區界 + 標籤點
  layers/*.json       精簡點圖層 {"cols": [...], "rows": [[lon, lat, ...], ...]}
  lines/*.geojson     道路路段、捷運、公車路線、人行道遮蔭
  poly/*.geojson      土壤液化潛勢
  bus_routes.json     路線表（班次、MRT 重疊、平日發車時刻）
  timeseries.json     陳情月趨勢、公車／建物／捷運年統計、見鼠週趨勢
  impact.json         六個成效模型的基準值與情境曲線（含假設與模擬資料標記）
  links.json          跨題目關聯：相關係數、共同熱點、機制與證據
  catalog.json        資料血緣：每個來源的擷取時間、筆數、是否模擬
  live/*.json         即時資料第一版（之後由 collect_live.py 更新）
"""
from __future__ import annotations

import gzip
import heapq
import io
import json
import re
import time
from collections import defaultdict
from glob import glob

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

from . import history
from . import live as livemod
from .common import RAW, now_tpe
from .geo import Villages, feature, geom_to_84, geom_to_97, lonlat_to_97, load_shp_zip, norm_name, write_json, xy_to_84
from .sources import SOURCES

OUT = livemod.OUT
T0 = time.time()

DOMAINS = {
    1: "樹蔭", 2: "清潔箱", 3: "鼠患", 4: "車流", 5: "公車", 6: "耐震",
}
HOT = 75  # a domain score >= 75 (top quartile) counts as a hotspot


def log(msg):
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


# ---------------------------------------------------------------- helpers
def read_csv(source, name):
    b = (RAW / source / f"{name}_latest.csv").read_bytes()
    for enc in ("utf-8-sig", "cp950", "big5"):
        try:
            return pd.read_csv(io.StringIO(b.decode(enc)), low_memory=False)
        except UnicodeDecodeError:
            continue
    raise ValueError(name)


def read_json(source, name, ext="json"):
    b = (RAW / source / f"{name}_latest.{ext}").read_bytes()
    if ext.endswith(".gz"):
        b = gzip.decompress(b)
    return json.loads(b.decode("utf-8-sig"))


def meta(source, name):
    p = RAW / source / f"{name}.meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


def num(s):
    return pd.to_numeric(s, errors="coerce")


def pct(a):
    """Percentile rank 0..1, NaN stays NaN."""
    a = np.asarray(a, float)
    out = np.full(a.shape, np.nan)
    m = ~np.isnan(a)
    if m.sum() > 1:
        r = pd.Series(a[m]).rank(method="average").to_numpy()
        out[m] = (r - 1) / (m.sum() - 1)
    return out


def spearman(a, b) -> float:
    """Spearman rank correlation on pairwise-complete values (no scipy)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = np.isfinite(a) & np.isfinite(b)
    if m.sum() < 3:
        return float("nan")
    ra = pd.Series(a[m]).rank().to_numpy()
    rb = pd.Series(b[m]).rank().to_numpy()
    return float(np.corrcoef(ra, rb)[0, 1])


def r(x, nd=3):
    if x is None:
        return None
    x = float(x)
    return None if np.isnan(x) else round(x, nd)


def counts(idx, n, w=None):
    idx = np.asarray(idx)
    m = idx >= 0
    return np.bincount(idx[m], weights=None if w is None else np.asarray(w, float)[m], minlength=n).astype(float)


def layer(path, cols, rows, **extra):
    size = write_json(OUT / "layers" / f"{path}.json", dict(cols=cols, rows=rows, **extra))
    log(f"  layers/{path}.json {len(rows):,} rows {size / 1e6:.2f} MB")


def fc(path, feats, **extra):
    size = write_json(OUT / path, dict(type="FeatureCollection", features=feats, **extra))
    log(f"  {path} {len(feats):,} features {size / 1e6:.2f} MB")


def dms(s):
    """121°29'29.7 -> 121.49158"""
    m = re.match(r"\s*(\d+)\D+(\d+)\D+([\d.]+)", str(s))
    if not m:
        try:
            return float(s)
        except ValueError:
            return np.nan
    d, mi, se = map(float, m.groups())
    return d + mi / 60 + se / 3600


# ---------------------------------------------------------------- base: villages + population
def base(V: Villages):
    df = read_csv("data_taipei", "population_age")
    df = df[df["性別"] == "計"]
    y = df["年份"].max()
    m = df[df["年份"] == y]["月份"].max()
    last = df[(df["年份"] == y) & (df["月份"] == m)].copy()
    code = last["區域代碼"].astype(str)
    dist_name = {c: norm_name(n) for c, n in zip(code, last["區域別"]) if len(c) == 8 and c != "63000000"}
    vil = last[code.str.len() == 11]
    a65 = [f"{a}歲數量" for a in range(65, 100)] + ["100歲以上"]
    pop, p65 = np.zeros(V.n), np.zeros(V.n)
    miss = []
    for c, name, tot, old in zip(vil["區域代碼"].astype(str), vil["區域別"], num(vil["總計"]), vil[a65].apply(num).sum(axis=1)):
        i = V.lookup(dist_name.get(c[:8], ""), name)
        if i < 0:
            miss.append(f"{dist_name.get(c[:8])}{name}")
            continue
        pop[i] += tot
        p65[i] += old
    log(f"population {y}年{m}月: {int(pop.sum()):,} people, 65+ {int(p65.sum()):,}, unmatched {miss}")
    return dict(pop=pop, p65=p65, period=f"{y}年{m}月", dist_code=dist_name)


# ---------------------------------------------------------------- 01 樹蔭
def d1_shade(V, B):
    st = read_csv("tppkl", "trees_street")
    st = st[num(st.TWD97X).between(290000, 320000) & num(st.TWD97Y).between(2755000, 2795000)].copy()
    sx, sy = num(st.TWD97X).to_numpy(), num(st.TWD97Y).to_numpy()
    dbh = num(st.Diameter).clip(0, 200)
    cw = (1.5 + 0.18 * dbh).clip(1.5, 14).fillna(4.0).to_numpy()  # crown width (m) from DBH (cm), assumption
    sv = V.assign_xy(sx, sy)

    pk = read_csv("tppkl", "trees_park")
    pk = pk[num(pk.TWD97X).between(290000, 320000) & num(pk.TWD97Y).between(2755000, 2795000)]
    pv = V.assign_xy(num(pk.TWD97X), num(pk.TWD97Y))

    holes = read_csv("tppkl", "tree_holes")
    holes = holes[num(holes.TWD97X).between(290000, 320000) & num(holes.TWD97Y).between(2755000, 2795000)]

    sw = read_json("data_taipei", "sidewalk")
    polys = np.array([shapely.make_valid(shape(f["geometry"])) for f in sw["features"]], dtype=object)
    props = [f["properties"] for f in sw["features"]]
    L = np.array([float(p.get("SW_LENG_ItemValue") or 0) for p in props])
    L = np.where(L > 0, L, shapely.length(polys) / 2)
    W = np.array([float(p.get("SW_WTH_ItemValue") or 0) for p in props])
    tree = shapely.STRtree(polys)
    ti, pi = tree.query_nearest(shapely.points(sx, sy), max_distance=4.0, all_matches=False)
    shade_len = np.bincount(pi, weights=cw[ti], minlength=len(polys))
    shade_m = np.minimum(shade_len, L)
    ratio = shade_m / L
    rep = shapely.point_on_surface(polys)
    swv = V.assign_xy(shapely.get_x(rep), shapely.get_y(rep))
    log(f"01 street trees {len(st):,} (on sidewalks {len(ti):,}), park trees {len(pk):,}, sidewalks {len(polys):,}")

    # plantable: wide enough sidewalk (>= 3 m, assumption) with an unshaded gap; one new tree per 8 m
    SPACING, NEW_CW, MIN_W = 8.0, 6.0, 3.0
    slots = np.where(W >= MIN_W, np.floor((L - shade_m) / SPACING), 0).astype(int)

    parks = read_json("parks", "parks")
    plon = np.array([float(p.get("pm_Longitude") or 0) for p in parks])
    plat = np.array([float(p.get("pm_Latitude") or 0) for p in parks])
    parea = np.array([float(p.get("pm_LandPublicArea") or 0) for p in parks])
    pkv = V.assign_lonlat(plon, plat)

    n = V.n
    sw_m = counts(swv, n, L)
    sh_m = counts(swv, n, shade_m)
    shade = np.where(sw_m >= 200, sh_m / np.maximum(sw_m, 1), np.nan)
    gap = sw_m - sh_m
    km2 = V.area_m2 / 1e6
    p65d = B["p65"] / km2
    s1 = 100 * (0.5 * pct(1 - shade) + 0.3 * pct(p65d) + 0.2 * pct(gap))
    s1 = np.where(np.isnan(shade), np.nan, s1)

    # map layer: sidewalks colored by shade ratio
    simp = shapely.simplify(polys, 1.5)
    feats = [feature(geom_to_84(g), dict(s=round(float(ratio[k]), 2), w=round(float(W[k]), 1), v=int(swv[k])))
             for k, g in enumerate(simp) if not g.is_empty]
    fc("lines/sidewalks.geojson", feats)

    lon, lat = xy_to_84(sx, sy)
    layer("trees", ["lon", "lat", "cw"], [[round(a, 5), round(b, 5), int(round(c))] for a, b, c in zip(lon, lat, cw)])
    hl, ha = xy_to_84(num(holes.TWD97X), num(holes.TWD97Y))
    layer("tree_holes", ["lon", "lat"], [[round(a, 5), round(b, 5)] for a, b in zip(hl, ha)])

    # scenario curve: plant N trees greedily in the highest-priority villages' widest gaps
    order = sorted([k for k in range(len(polys)) if slots[k] > 0 and swv[k] >= 0 and not np.isnan(s1[swv[k]])],
                   key=lambda k: (-s1[swv[k]], -(L[k] - shade_m[k])))
    LOW = 0.20  # 缺蔭里：人行道遮蔭率 < 20%
    sh_village = sh_m.copy()
    curve, planted, added = [], 0, 0.0
    marks = list(range(0, 5001, 100))

    def snap(N):
        sr = np.where(sw_m >= 200, sh_village / np.maximum(sw_m, 1), np.nan)
        low = (sr < LOW) & ~np.isnan(sr)
        curve.append(dict(n=N, shaded_km=round((sh_village.sum()) / 1000, 2), added_km=round(added / 1000, 2),
                          city_shade=round(sh_village.sum() / sw_m.sum(), 4), low_villages=int(low.sum()),
                          low_elderly=int(B["p65"][low].sum())))

    snap(0)
    mi = 1
    for k in order:
        for _ in range(slots[k]):
            if mi >= len(marks):
                break
            gain = min(NEW_CW, max(0.0, L[k] - shade_m[k]))
            shade_m[k] += gain
            sh_village[swv[k]] += gain
            added += gain
            planted += 1
            if planted == marks[mi]:
                snap(planted)
                mi += 1
        if mi >= len(marks):
            break

    imp = dict(
        assumptions=[
            "樹冠寬（m）= 1.5 + 0.18 × 胸徑（cm），限制在 1.5–14 m",
            "離人行道 4 m 內的行道樹算作遮蔭該段人行道",
            f"人行道寬 ≥ {MIN_W:g} m 才能補植，每 {SPACING:g} m 一棵，新樹成樹後樹冠 {NEW_CW:g} m",
            f"缺蔭里：人行道遮蔭率 < {LOW:.0%}",
        ],
        baseline=dict(street_trees=int(len(st)), park_trees=int(len(pk)), tree_holes=int(len(holes)),
                      sidewalk_km=round(L.sum() / 1000, 1), shaded_km=round(float(np.minimum(shade_len, L).sum()) / 1000, 1),
                      plantable_slots=int(slots.sum())),
        curve=curve,
    )
    cols = dict(st=counts(sv, n), pt=counts(pv, n), sw=sw_m, shd=shade, gap=gap, slots=counts(swv, n, slots),
                park=counts(pkv, n, parea), s1=s1)
    ctx = dict(polys=polys, ratio=ratio, tree=tree)
    return cols, imp, ctx


# ---------------------------------------------------------------- shared transit context
def transit(V):
    """Bus routes / stops / shapes and MRT stations / lines (used by 02, 04, 05)."""
    routes_raw = read_json("tcgbusfs", "bus_route", "json.gz")["BusInfo"]
    stops_raw = read_json("tcgbusfs", "bus_stop", "json.gz")["BusInfo"]
    shapes_raw = read_json("tcgbusfs", "bus_shape", "json.gz")
    tt = read_json("tcgbusfs", "bus_timetable", "json.gz")["BusInfo"]

    deps = defaultdict(list)  # weekday (Tuesday, DateValue 3) departures by path
    for t in tt:
        if t.get("DateType") == "0" and t.get("DateValue") == "3":
            deps[t["PathAttributeId"]].append(t["DepartureTime"])

    def hw(s):
        s = (s or "").strip()
        if len(s) == 4 and s.isdigit():
            a, b = int(s[:2]), int(s[2:])
            if a > 0 and b >= a:
                return (a + b) / 2
        return None

    def mins(s):
        s = (s or "").strip()
        return int(s[:2]) * 60 + int(s[2:]) if len(s) == 4 and s.isdigit() else None

    routes = {}
    for x in routes_raw:
        rid = x["Id"]
        rt = routes.setdefault(rid, dict(id=rid, name=x["nameZh"], provider=x["providerName"], dep=x["departureZh"],
                                         dest=x["destinationZh"], paths=set(), first=x["goFirstBusTime"], last=x["goLastBusTime"],
                                         phw=hw(x["peakHeadway"]), ohw=hw(x["offPeakHeadway"])))
        rt["paths"].add(x["pathAttributeId"])
    for rt in routes.values():
        per_path = [sorted(deps[p]) for p in rt["paths"] if deps.get(p)]
        a, b = mins(rt["first"]), mins(rt["last"])
        if rt["phw"] and a is not None and b is not None and b > a:
            peak = sum(max(0, min(b, e) - max(a, s)) for s, e in ((420, 540), (1020, 1140)))
            off = (b - a) - peak
            trips = peak / rt["phw"] + off / (rt["ohw"] or rt["phw"] * 1.6)
            rt["trips_dir"] = round(trips, 1)
            rt["trip_src"] = "headway"
        elif per_path:
            rt["trips_dir"] = float(max(len(d) for d in per_path))
            rt["trip_src"] = "timetable"
        else:
            rt["trips_dir"] = None
            rt["trip_src"] = None
        rt["departures"] = max(per_path, key=len) if per_path else []

    # shapes: longest per (route, direction), lengths in km
    shp = {}
    for s in shapes_raw:
        try:
            g = shapely.from_wkt(s["wkt"])
        except Exception:
            continue
        g97 = geom_to_97(g)
        key = (s["RouteID"], s["GoBack"])
        if key not in shp or g97.length > shp[key].length:
            shp[key] = g97

    # MRT
    st = read_json("tdx", "metro_station")
    mrt = []
    rid_df = read_csv("tsis", "mrt_ridership")
    last = rid_df.iloc[-1]
    rider = {}
    for c in rid_df.columns[1:]:
        nm = norm_name(re.sub(r"(BR|BL|R|G|O|Y)$", "", c.split("/")[-1].strip()))
        rider[nm] = rider.get(nm, 0) + float(num(pd.Series([last[c]]))[0] or 0)
    for s in st:
        nm = norm_name(s["StationName"]["Zh_tw"])
        mrt.append(dict(id=s["StationID"], name=nm, lon=s["StationPosition"]["PositionLon"], lat=s["StationPosition"]["PositionLat"],
                        city=s.get("LocationCity", ""), daily=(rider.get(nm, 0) / 365) or None))
    mx, my = lonlat_to_97([m["lon"] for m in mrt], [m["lat"] for m in mrt])
    mv = V.assign_xy(mx, my)
    lines = read_json("tdx", "metro_shape")
    mrt_lines = [(l["LineID"], l["LineName"]["Zh_tw"], geom_to_97(shapely.from_wkt(l["Geometry"]))) for l in lines]
    mrt_buf = shapely.union_all([shapely.buffer(g, 300) for _, _, g in mrt_lines])

    for rt in routes.values():
        gs = [shp[k] for k in ((rt["id"], "0"), (rt["id"], "1"), (rt["id"], 0), (rt["id"], 1)) if k in shp]
        if gs:
            g = max(gs, key=lambda x: x.length)
            rt["km"] = g.length / 1000
            rt["overlap"] = shapely.intersection(g, mrt_buf).length / max(g.length, 1)
            rt["geom"] = g
        else:
            rt["km"], rt["overlap"], rt["geom"] = None, None, None

    # stops: unique physical locations in Taipei
    loc = {}
    for s in stops_raw:
        try:
            lon, lat = float(s["longitude"]), float(s["latitude"])
        except (KeyError, ValueError):
            continue
        L = loc.setdefault(s["stopLocationId"], dict(lon=lon, lat=lat, name=s["nameZh"], routes=set(), dirs=set()))
        L["routes"].add(s["routeId"])
        L["dirs"].add((s["routeId"], s["goBack"]))
    ids = list(loc)
    lx, ly = lonlat_to_97([loc[i]["lon"] for i in ids], [loc[i]["lat"] for i in ids])
    lv = V.assign_xy(lx, ly)
    stops = []
    for k, i in enumerate(ids):
        if lv[k] < 0:
            continue
        L = loc[i]
        passes = sum((routes.get(rid, {}).get("trips_dir") or 0) for rid, _ in L["dirs"])
        stops.append(dict(id=i, name=L["name"], lon=L["lon"], lat=L["lat"], x=lx[k], y=ly[k], v=int(lv[k]),
                          routes=len(L["routes"]), passes=passes))
    log(f"transit: routes {len(routes)}, stop locations in Taipei {len(stops):,}, MRT stations {len(mrt)} (Taipei {int((mv >= 0).sum())})")
    return dict(routes=routes, stops=stops, mrt=mrt, mx=mx, my=my, mv=mv, mrt_lines=mrt_lines, mrt_buf=mrt_buf)


# ---------------------------------------------------------------- 02 清潔箱
def d2_bins(V, B, T, food_xy):
    bins = read_csv("data_taipei", "bins")
    blon, blat = num(bins["經度"]).to_numpy(), num(bins["緯度"]).to_numpy()
    bx, by = lonlat_to_97(blon, blat)
    bv = V.assign_xy(bx, by)

    # demand points with weights (relative foot-traffic units, assumption)
    pts, w, kind, vill = [], [], [], []
    for s in T["stops"]:
        pts.append((s["x"], s["y"])); w.append(float(s["routes"])); kind.append("bus"); vill.append(s["v"])
    for k, m in enumerate(T["mrt"]):
        if T["mv"][k] >= 0:
            pts.append((T["mx"][k], T["my"][k])); w.append((m["daily"] or 20000) / 1000); kind.append("mrt"); vill.append(int(T["mv"][k]))
    fx, fy, fv = food_xy
    cell = defaultdict(list)
    for x, y, v in zip(fx, fy, fv):
        if v >= 0:
            cell[(int(x // 100), int(y // 100))].append((x, y, v))
    for c in cell.values():
        a = np.array([(p[0], p[1]) for p in c])
        pts.append(tuple(a.mean(axis=0))); w.append(0.25 * len(c)); kind.append("food"); vill.append(c[0][2])
    mk = read_csv("data_taipei", "vendor_markets")
    mlon, mlat = mk["GTag_longitude"].map(dms).to_numpy(), mk["GTag_latitude"].map(dms).to_numpy()
    mkx, mky = lonlat_to_97(mlon, mlat)
    mkv = V.assign_xy(mkx, mky)
    for x, y, v in zip(mkx, mky, mkv):
        if v >= 0:
            pts.append((x, y)); w.append(10.0); kind.append("market"); vill.append(int(v))
    P = np.array(pts)
    w = np.array(w)
    vill = np.array(vill)
    geoms = shapely.points(P[:, 0], P[:, 1])
    tree = shapely.STRtree(geoms)
    R = 150.0
    bin_pts = shapely.points(bx[bv >= 0], by[bv >= 0])
    _, near = tree.query(bin_pts, predicate="dwithin", distance=R)
    covered = np.zeros(len(P), bool)
    covered[near] = True
    log(f"02 bins {int((bv >= 0).sum())}, demand points {len(P):,}, demand covered {w[covered].sum() / w.sum():.1%}")

    # greedy max-coverage: where would K new bins add the most uncovered demand?
    ci, di = tree.query(geoms, predicate="dwithin", distance=R)
    nb = defaultdict(list)
    for a, b in zip(ci, di):
        nb[a].append(b)
    cov = covered.copy()
    heap = [(-w[nb[c]][~cov[nb[c]]].sum(), c) for c in nb]
    heapq.heapify(heap)
    total = w.sum()
    picks, curve = [], [dict(k=0, covered=round(float(w[cov].sum() / total), 4))]
    while heap and len(picks) < 300:
        g, c = heapq.heappop(heap)
        real = w[nb[c]][~cov[nb[c]]].sum()
        if real <= 0:
            continue
        if heap and -heap[0][0] > real + 1e-9:
            heapq.heappush(heap, (-real, c))
            continue
        cov[nb[c]] = True
        picks.append((c, real))
        k = len(picks)
        if k % 10 == 0 or k <= 10:
            curve.append(dict(k=k, covered=round(float(w[cov].sum() / total), 4)))
    plon, plat = xy_to_84(P[[c for c, _ in picks], 0], P[[c for c, _ in picks], 1])
    layer("bin_candidates", ["lon", "lat", "gain", "kind", "v", "rank"],
          [[round(a, 5), round(b, 5), round(g, 1), kind[c], int(vill[c]), i + 1] for i, ((c, g), a, b) in enumerate(zip(picks, plon, plat))])

    # per-bin demand -> simulated fill rate (MOCK: no open fill-level sensor data)
    bd = np.zeros(len(bin_pts))
    di2, bi2 = shapely.STRtree(bin_pts).query(geoms, predicate="dwithin", distance=R)  # (demand idx, bin idx)
    np.add.at(bd, bi2, w[di2])
    p90 = np.percentile(bd[bd > 0], 90) if (bd > 0).any() else 1
    fill = np.clip(0.25 + 1.5 * bd / p90, 0.15, 3.0)  # bins filled per day
    bl, bb = blon[bv >= 0], blat[bv >= 0]
    addr = bins["地址"].astype(str).to_numpy()[bv >= 0]
    layer("bins", ["lon", "lat", "fill_per_day", "v", "addr"],
          [[round(a, 5), round(b, 5), round(f, 2), int(v), ad] for a, b, f, v, ad in zip(bl, bb, fill, bv[bv >= 0], addr)],
          fill_is_mock=True)
    fixed = 2.0 * len(fill)  # 每天固定收 2 次（假設）
    dynamic = np.maximum(fill / 0.8, 1 / 3).sum()  # 滿 80% 才收，最少 3 天收一次
    overflow_fixed = int((fill > 2.0).sum())

    n = V.n
    dem = counts(vill, n, w)
    dem_cov = counts(vill[covered], n, w[covered])
    km2 = V.area_m2 / 1e6
    ucd = (dem - dem_cov) / km2
    s2 = 100 * pct(ucd)
    stop_w = np.array(kind) == "bus"
    busy = stop_w & (w >= 10)
    imp = dict(
        assumptions=[
            f"清潔箱服務半徑 {R:g} m",
            "需求權重：公車站 = 停靠路線數；捷運站 = 日均進站人次 ÷ 1000；餐飲 = 每家 0.25（100 m 網格合併）；攤販集中場 = 10",
            "動態清運：固定排程每天收 2 次；依滿溢度則滿 80% 才收、最少 3 天收一次",
        ],
        mock=["各清潔箱的每日填滿速度（依周邊需求推估，沒有開放的滿溢感測資料）"],
        baseline=dict(bins=int((bv >= 0).sum()), demand_points=int(len(P)), covered=round(float(w[covered].sum() / total), 4),
                      bus_stops=int(stop_w.sum()), bus_stops_covered=round(float(covered[stop_w].mean()), 4),
                      busy_stops=int(busy.sum()), busy_stops_uncovered=int((busy & ~covered).sum()),
                      fixed_pickups=round(fixed), dynamic_pickups=round(float(dynamic)), overflow_bins_fixed=overflow_fixed),
        curve=curve,
    )
    cols = dict(bins=counts(bv, n), dem=dem, cov=np.where(dem > 0, dem_cov / np.maximum(dem, 1e-9), np.nan), ucd=ucd, s2=s2)
    ctx = dict(P=P, w=w, kind=np.array(kind), covered=covered, bx=bx[bv >= 0], by=by[bv >= 0], markets=(mlon, mlat, mkv, mk))
    return cols, imp, ctx


# ---------------------------------------------------------------- 03 鼠患
def d3_rats(V, B, food, markets):
    n = V.n
    km2 = V.area_m2 / 1e6
    rr = read_csv("ratdar", "ratradar")
    rlon, rlat = num(rr["經度"]).to_numpy(), num(rr["緯度"]).to_numpy()
    rv = V.assign_lonlat(rlon, rlat)
    sight = (rr["類型"] == "鼠蹤").to_numpy() & (rv >= 0)
    bait = (rr["類型"] == "毒餌").to_numpy() & (rv >= 0)
    rats = counts(rv[sight], n)

    gt = read_csv("data_taipei", "garbage_truck")
    glon, glat = num(gt["經度"]).to_numpy(), num(gt["緯度"]).to_numpy()
    gv = V.assign_lonlat(glon, glat)
    arrive = num(gt["抵達時間"]).fillna(0).astype(int).to_numpy()
    leave = num(gt["離開時間"]).fillna(0).astype(int).to_numpy()
    dwell = np.clip((leave // 100 * 60 + leave % 100) - (arrive // 100 * 60 + arrive % 100), 0, 60)
    trucks = counts(gv, n)

    mh = read_csv("data_taipei", "rain_manholes")
    hx, hy = num(mh["X坐標"]).to_numpy(), num(mh["Y坐標"]).to_numpy()
    ok = np.isfinite(hx) & np.isfinite(hy)
    hv = V.assign_xy(hx[ok], hy[ok])
    manholes = counts(hv, n)

    flon, flat, fv, fdf = food
    foodc = counts(fv, n)
    mlon, mlat, mkv, mk = markets
    mkt = counts(mkv, n)

    # dengue vector survey (Breteau index) by 里, mean of the cached months
    bi_sum, bi_n = np.zeros(n), np.zeros(n)
    months = []
    for p in sorted(glob(str(RAW / "data_taipei" / "dengue_vector_1*_latest.csv"))):
        d = pd.read_csv(p, encoding="utf-8-sig")
        months.append(p.split("dengue_vector_")[1][:5])
        for dist, vil, bi in zip(d["區別"], d["里別"], num(d["布氏指數"])):
            i = V.lookup(dist, vil)
            if i >= 0 and np.isfinite(bi):
                bi_sum[i] += bi
                bi_n[i] += 1
    bi = np.where(bi_n > 0, bi_sum / np.maximum(bi_n, 1), np.nan)

    dens = lambda a: a / km2
    pop_d = B["pop"] / km2
    bi_p = pct(bi)
    bi_p = np.where(np.isnan(bi_p), 0.5, bi_p)
    W = dict(food=0.35, truck=0.20, manhole=0.15, market=0.10, bi=0.10, pop=0.10)
    risk = (W["food"] * pct(dens(foodc)) + W["truck"] * pct(dens(trucks)) + W["manhole"] * pct(dens(manholes))
            + W["market"] * pct(mkt) + W["bi"] * bi_p + W["pop"] * pct(pop_d))
    rat_d = dens(rats)
    rho = spearman(risk, rat_d)
    rho_food = spearman(dens(foodc), rat_d)
    s3 = 100 * (0.5 * pct(risk) + 0.5 * pct(rat_d))

    # lift curve: treat the highest-risk area first (effort ~ area), share of reports captured.
    # random targeting captures reports in proportion to area; the oracle orders by observed report density.
    def lift_curve(key):
        o = np.argsort(-key)
        a = np.cumsum(km2[o]) / km2.sum()
        c = np.cumsum(rats[o]) / max(rats.sum(), 1)
        return np.concatenate([[0], a]), np.concatenate([[0], c])

    ma, mc = lift_curve(risk)
    oa, oc = lift_curve(rat_d)
    grid = np.round(np.arange(0, 1.0001, 0.02), 2)
    lift = [dict(area=float(g), model=round(float(np.interp(g, ma, mc)), 4), oracle=round(float(np.interp(g, oa, oc)), 4)) for g in grid]
    top20 = float(np.interp(0.2, ma, mc))
    log(f"03 rat sightings in Taipei {int(sight.sum())}, risk-vs-reports Spearman {rho:.2f}, top 20% risk area captures {top20:.0%}")

    layer("rats", ["lon", "lat", "time", "type", "v"],
          [[round(a, 5), round(b, 5), t, ty, int(v)] for a, b, t, ty, v, m in
           zip(rlon, rlat, rr["通報時間"].astype(str), rr["類型"].astype(str), rv, sight | bait) if m])
    layer("restaurants", ["lon", "lat", "v"], [[round(a, 5), round(b, 5), int(v)] for a, b, v in zip(flon, flat, fv) if v >= 0])
    layer("garbage_truck", ["lon", "lat", "arrive", "dwell", "v", "route"],
          [[round(a, 5), round(b, 5), f"{t // 100:02d}:{t % 100:02d}", int(dw), int(v), ro] for a, b, t, dw, v, ro in
           zip(glon, glat, arrive, dwell, gv, gt["路線"].astype(str)) if v >= 0])
    hl, ha = xy_to_84(hx[ok], hy[ok])
    layer("manholes", ["lon", "lat"], [[round(a, 5), round(b, 5)] for a, b, v in zip(hl, ha, hv) if v >= 0])
    layer("markets", ["lon", "lat", "name", "hours", "v"],
          [[round(a, 5), round(b, 5), f"{s}{x}", f"{h1}–{h2}", int(v)] for a, b, s, x, h1, h2, v in
           zip(mlon, mlat, mk["stitle"], mk["xbody"].astype(str), mk["xstartTime"], mk["xendTime"], mkv) if v >= 0 and np.isfinite(a)])

    weekly = (pd.to_datetime(rr.loc[sight, "通報時間"], errors="coerce").dt.to_period("W-SUN").dt.start_time
              .value_counts().sort_index())
    imp = dict(
        assumptions=[
            "風險權重：餐飲密度 0.35、垃圾車停靠點密度 0.20、雨水人孔密度 0.15、攤販集中場 0.10、病媒蚊布氏指數 0.10、人口密度 0.10",
            "用見鼠地圖通報驗證，不參與權重；通報有民眾回報偏誤",
            "防治人力與處理面積成正比；隨機分配時涵蓋的通報比例等於面積比例",
            "集中防治（投藥、清潔、封堵）在處理區使通報減少 30%",
        ],
        baseline=dict(sightings=int(sight.sum()), bait_reports=int(bait.sum()), restaurants=int((fv >= 0).sum()),
                      truck_stops=int((gv >= 0).sum()), manholes=int(ok.sum()), markets=int((mkv >= 0).sum()),
                      spearman_risk_reports=r(rho, 3), spearman_food_reports=r(rho_food, 3), top20_captured=round(top20, 4),
                      dengue_months=months, efficacy=0.30, first_report=str(rr.loc[sight, "通報時間"].min()),
                      last_report=str(rr.loc[sight, "通報時間"].max())),
        weights=W,
        lift=lift,
    )
    cols = dict(rats=rats, rat_d=rat_d, food=foodc, trk=trucks, mh=manholes, mkt=mkt, bi=bi, risk=risk, s3=s3)
    ts = dict(rat_weekly=[[str(k.date()), int(v)] for k, v in weekly.items()])
    return cols, imp, ts


# ---------------------------------------------------------------- 04 車流
def calibrate_bpr(days, beta=4):
    """Network-level BPR fit on every day × 15-min bin: mean speed = v_free / (1 + alpha·(V/C)^beta), least squares.
    For a fixed alpha the best v_free is closed form, so only alpha is scanned."""
    x = np.array([d["vc"] for d in days], float).ravel()
    v = np.array([np.nan if s is None else s for d in days for s in d["speed"]], float)
    ok = np.isfinite(x) & np.isfinite(v) & (v > 0)
    x, v = x[ok], v[ok]
    best = None
    for a in np.arange(0.01, 10.0, 0.01):
        g = 1 / (1 + a * x ** beta)
        vf = (v * g).sum() / (g * g).sum()
        e = float(((vf * g - v) ** 2).mean())
        if best is None or e < best[0]:
            best = (e, a, vf)
    e, a, vf = best
    return dict(alpha=round(float(a), 2), v_free=round(float(vf), 1), beta=beta, n=int(ok.sum()), rmse=round(e ** 0.5, 2))


def d4_traffic(V, B, T, ctx: livemod.TrafficContext):
    n = V.n
    shapes = read_json("tdx", "road_section_shape")["SectionShapes"]
    geoms97, feats = {}, []
    for s in shapes:
        try:
            g = shapely.from_wkt(s["Geometry"])
        except Exception:
            continue
        sid = s["SectionID"]
        m = ctx.section.get(sid, {})
        g97 = geoms97[sid] = geom_to_97(g)
        # section names are "road(nodeA到nodeB)": add travel direction + the 里 at the midpoint so rows are readable
        a, b = shapely.get_coordinates(g97)[[0, -1]]
        dx, dy = b - a
        heading = ("北向" if dy > 0 else "南向") if abs(dy) >= abs(dx) else ("東向" if dx > 0 else "西向")
        mid = g97.interpolate(0.5, normalized=True)
        vi = V.assign_xy([mid.x], [mid.y])[0]
        feats.append(feature(g, dict(id=sid, name=m.get("name", ""), road=m.get("road", ""), cls=m.get("cls", ""),
                                     km=round(m.get("km", 0), 2), nh=int(bool(m.get("neihu"))), dir=heading,
                                     vill=V.recs[vi]["VNAME"] if vi >= 0 else "")))
    fc("lines/road_sections.geojson", feats)

    # congestion per village from every cached road_live snapshot (more snapshots -> more stable)
    snaps = sorted(glob(str(RAW / "tdx" / "road_live_2*.json")))
    lvl_sum, lvl_n = defaultdict(float), defaultdict(int)
    for p in snaps:
        for s in json.loads(open(p, encoding="utf-8-sig").read())["LiveTraffics"]:
            lv = int(float(s.get("CongestionLevel", -99)))
            if 1 <= lv <= 6:
                lvl_sum[s["SectionID"]] += 1.0 if lv >= 5 else 0.0
                lvl_n[s["SectionID"]] += 1
    sids = [s for s in geoms97 if lvl_n.get(s)]
    tree = shapely.STRtree([geoms97[s] for s in sids])
    vi, si = tree.query(V.geoms, predicate="intersects")
    cong_len, tot_len, nsec = np.zeros(n), np.zeros(n), np.zeros(n)
    for v, k in zip(vi, si):
        sid = sids[k]
        ln = shapely.intersection(V.geoms[v], geoms97[sid]).length
        share = lvl_sum[sid] / lvl_n[sid]
        cong_len[v] += ln * share
        tot_len[v] += ln
        nsec[v] += 1
    cong = np.where(tot_len > 50, cong_len / np.maximum(tot_len, 1), np.nan)
    s4 = 100 * pct(cong)

    vd = [[round(v["lon"], 5), round(v["lat"], 5), k, v["road"], v["cls"], v["lanes"], int(v["neihu"])] for k, v in ctx.vd.items()]
    layer("vd", ["lon", "lat", "id", "road", "cls", "lanes", "neihu"], vd)

    # 內湖 morning-peak profile: real TDX historical VD (pipeline/history.py) when cached, otherwise the MOCK curve
    nh = {k: v for k, v in ctx.vd.items() if v["neihu"]}
    cap = sum(livemod.CAP_PER_LANE.get(v["cls"], 900.0) * v["lanes"] for v in nh.values())
    shift = dict(shift_from=["07:45", "08:00", "08:15", "08:30", "08:45"], shift_to=["07:00", "07:15", "07:30", "09:00", "09:15"])
    hist = history.profile(vds=nh, cap_per_lane=livemod.CAP_PER_LANE)
    params = dict(alpha=0.15, beta=4, v_free=50, km_per_vd=0.6, fuel_l_per_vh=0.8, co2_per_l=2.26)
    if hist:
        hm = meta("tdx", "vd_hist")
        profile = dict(hist, is_mock=False, fetched_at=hm.get("fetched_at"), **shift)
        mock = []
        cal = calibrate_bpr(hist["days"])
        params.update(alpha=cal["alpha"], v_free=cal["v_free"], calib=dict(cal, alpha0=params["alpha"], v_free0=params["v_free"]))
        v0 = params["calib"]["v_free0"] / (1 + params["calib"]["alpha0"] * hist["peak_vc"] ** 4)
        spd = [s for s in hist["speed"] if s]
        prof_note = [f"晨峰曲線：{hist['source']}；V/C = 有效車道 15 分鐘流量 ÷（有效車道數 × 每車道容量），內湖 V/C 為各 VD 等權平均",
                     f"路網層級 BPR：以 {cal['n']} 個實測時段（{len(hist['days'])} 個平日 × 每 15 分鐘）的平均車速對平均 V/C 校準，"
                     f"α = {cal['alpha']:g}、自由車速 {cal['v_free']:g} km/h，車速誤差 RMSE {cal['rmse']:g} km/h"
                     f"（教科書值 α = 0.15、50 km/h 算出的尖峰車速 {v0:.0f} km/h，實測只有 {min(spd):.0f}–{max(spd):.0f} km/h）"]
        bpr_note = f"BPR 延滯函數 t = t0 × (1 + {cal['alpha']:g} × (V/C)^4)，V/C 與車流取內湖 {len(hist['vd_vc'])} 支 VD 的平均與總和"
    else:
        profile = dict(bins=history.BINS, mult=[0.62, 0.74, 0.86, 0.95, 1.00, 0.98, 0.90, 0.78, 0.66, 0.58], peak_vc=0.98,
                       is_mock=True, **shift)
        mock = ["內科晨峰 15 分鐘車流曲線（執行 pipeline.history 抓 TDX 歷史 VD 後自動改用真實資料）"]
        prof_note = ["自由車速 50 km/h（未校準）"]
        bpr_note = "BPR 延滯函數 t = t0 × (1 + 0.15 × (V/C)^4)"
    bus_through = sum(1 for rt in T["routes"].values() if rt["geom"] is not None and any(
        rt["geom"].distance(geoms97[s]) < 30 for s in geoms97 if ctx.section.get(s, {}).get("neihu")))
    log(f"04 sections {len(feats)}, snapshots {len(snaps)}, 內湖 VD {len(nh)} capacity {cap:,.0f} veh/h, bus routes through 內湖 sections {bus_through}")
    log(f"04 peak profile: {hist['source']}, peak V/C {hist['peak_vc']}" if hist else "04 peak profile: MOCK (no data/raw/tdx/vd_hist_*)")
    imp = dict(
        assumptions=[
            bpr_note,
            f"車道容量：快速道路 {livemod.CAP_PER_LANE['2']:g}、一般道路 {livemod.CAP_PER_LANE['6']:g} 輛/小時/車道",
            *prof_note,
            "每支 VD 代表 0.6 km 路段；延滯 = 車次 × 0.6 km ×（1 / 模型車速 − 1 / 自由車速）",
            "彈性工時：07:45–09:00 的車流移到 07:00–07:45 與 09:00–09:30（依剩餘容量分配）",
            "減量：每個時段等比例減少進入內湖的車流（交通車、共乘、轉乘大眾運輸等）",
            "壅塞延滯每車小時多耗油 0.8 公升，每公升汽油 2.26 kg CO2e",
        ],
        mock=mock,
        params=params,
        neihu=dict(vd=len(nh), cap_vph=round(cap), sections=sum(1 for s in ctx.section.values() if s.get("neihu")),
                   bus_routes=bus_through),
        profile=profile,
        snapshots=len(snaps),
    )
    cols = dict(sec=nsec, cong=cong, s4=s4)
    return cols, imp, geoms97


# ---------------------------------------------------------------- 05 公車
def d5_bus(V, B, T, sec97, traffic_live):
    n = V.n
    stops = T["stops"]
    sv = np.array([s["v"] for s in stops])
    passes = counts(sv, n, [s["passes"] for s in stops])
    nstops = counts(sv, n)
    ppc = np.where(B["pop"] > 300, passes / np.maximum(B["pop"], 1) * 1000, np.nan)
    rep = np.array([(p.x, p.y) for p in V.rep])
    dmin = np.sqrt(((rep[:, None, 0] - T["mx"][None, :]) ** 2 + (rep[:, None, 1] - T["my"][None, :]) ** 2)).min(axis=1)
    r65 = np.where(B["pop"] > 0, B["p65"] / np.maximum(B["pop"], 1), np.nan)
    s5 = 100 * (0.4 * pct(-np.nan_to_num(ppc, nan=np.nanmedian(ppc))) + 0.3 * pct(dmin) + 0.3 * pct(r65))
    s5 = np.where(B["pop"] > 300, s5, np.nan)

    routes = T["routes"]
    cong_ids = {sid for sid, v in traffic_live.get("sections", {}).items() if v[0] >= 5}
    cong_geo = shapely.union_all([sec97[s] for s in cong_ids if s in sec97]) if cong_ids else None
    table, feats = [], []
    for rt in routes.values():
        if rt["geom"] is None or not rt["trips_dir"]:
            continue
        vkm = 2 * rt["trips_dir"] * rt["km"]
        through_cong = bool(cong_geo is not None and rt["geom"].distance(cong_geo) < 25)
        table.append(dict(id=rt["id"], name=rt["name"], provider=rt["provider"], from_=rt["dep"], to=rt["dest"],
                          km=round(rt["km"], 1), trips_dir=rt["trips_dir"], trip_src=rt["trip_src"], vkm=round(vkm),
                          overlap=round(rt["overlap"], 3), first=rt["first"], last=rt["last"], cong=through_cong,
                          departures=rt["departures"]))
        g = geom_to_84(shapely.simplify(rt["geom"], 20))
        feats.append(feature(g, dict(id=rt["id"], name=rt["name"], trips=rt["trips_dir"], ovl=round(rt["overlap"], 2))))
    fc("lines/bus_routes.geojson", feats)
    write_json(OUT / "bus_routes.json", dict(routes=sorted(table, key=lambda x: -x["vkm"]), is_mock=False))

    layer("bus_stops", ["lon", "lat", "id", "name", "routes", "passes", "v"],
          [[round(s["lon"], 5), round(s["lat"], 5), s["id"], s["name"], s["routes"], round(s["passes"]), s["v"]] for s in stops])
    layer("mrt", ["lon", "lat", "id", "name", "daily", "v"],
          [[round(m["lon"], 5), round(m["lat"], 5), m["id"], m["name"], round(m["daily"]) if m["daily"] else None, int(v)]
           for m, v in zip(T["mrt"], T["mv"])])
    fc("lines/mrt.geojson", [feature(geom_to_84(shapely.simplify(g, 5)), dict(id=i, name=nm)) for i, nm, g in T["mrt_lines"]])

    red = [t for t in table if t["overlap"] >= 0.6]
    tot_vkm = sum(t["vkm"] for t in table)
    red_vkm = sum(t["vkm"] for t in red)
    cold = np.where(~np.isnan(s5), s5, -1)
    cold_order = [int(i) for i in np.argsort(-cold) if cold[i] >= 0]
    log(f"05 routes with shape+trips {len(table)}, vehicle-km/day {tot_vkm:,.0f}, MRT-overlap>=60% routes {len(red)} ({red_vkm:,.0f} vkm)")
    imp = dict(
        assumptions=[
            "平日班次：有尖離峰班距的路線用班距推算（尖峰 07–09、17–19），其餘用時刻表週二發車數",
            "與捷運重疊：路線軌跡落在捷運路線 300 m 內的比例；≥ 60% 視為高重疊",
            "營運成本每車公里 NT$80；DRTS 小巴營運速度 18 km/h，每個冷區里每天需 12 車小時",
            "駕駛排班：連續駕駛 4 小時至少休息 30 分鐘、每日駕駛不超過 10 小時（參考汽車運輸業管理規則）",
        ],
        baseline=dict(routes=len(table), vkm_day=round(tot_vkm), redundant_routes=len(red), redundant_vkm=round(red_vkm),
                      stop_locations=len(stops), mrt_stations=int((T["mv"] >= 0).sum()),
                      routes_through_congestion=sum(1 for t in table if t["cong"])),
        params=dict(cost_per_vkm=80, drts_speed=18, drts_hours_per_village=12, drive_block_h=4, rest_min=30, max_drive_h=10),
        cold_villages=cold_order[:60],
    )
    cols = dict(stops=nstops, pass_=passes, ppc=ppc, mrt_km=dmin / 1000, s5=s5)
    return cols, imp


# ---------------------------------------------------------------- 06 耐震
def d6_seismic(V, B):
    n = V.n
    km2 = V.area_m2 / 1e6
    liq = read_json("soil", "liquefaction", "geojson")
    cls_area = {c: np.zeros(n) for c in ("1", "2", "3")}
    feats = []
    tree = shapely.STRtree(V.geoms)
    for f in liq["features"]:
        c = str(f["properties"]["class"])
        g84 = shapely.make_valid(shape(f["geometry"]))
        g97 = geom_to_97(g84)
        for v in tree.query(g97, predicate="intersects"):
            cls_area[c][v] += shapely.intersection(V.geoms[v], g97).area
        feats.append(feature(geom_to_84(shapely.simplify(g97, 8)), dict(c=int(c))))
    fc("poly/liquefaction.geojson", feats)
    liq3 = cls_area["3"] / V.area_m2
    liq2 = cls_area["2"] / V.area_m2

    fa = read_csv("data_taipei", "fire_access")
    fire = np.zeros(n)
    miss, matched = [], 0
    code_name = BASE["dist_code"]
    for code, vil in zip(fa["行政區代碼"].astype(str), fa["里別"].astype(str)):
        names = re.findall(r"[^、，,\s]+?里", vil) or [vil]  # "文祥里、三愛里" / "中坡里中行里" -> each 里
        hits = [V.lookup(code_name.get(code[:8], ""), nm) for nm in names]
        hits = [h for h in hits if h >= 0]
        for h in hits:
            fire[h] += 1 / len(hits)  # a site listed under several 里 is split between them
        if hits:
            matched += 1
        else:
            miss.append(f"{code}{vil}")

    hy = read_csv("data_taipei", "hydrants")
    hx, hyy = num(hy["97X座標"]).to_numpy(), num(hy["97Y座標"]).to_numpy()
    ok = np.isfinite(hx) & np.isfinite(hyy)
    hv = V.assign_xy(hx[ok], hyy[ok])
    hyd = counts(hv, n)
    hl, ha = xy_to_84(hx[ok], hyy[ok])
    layer("hydrants", ["lon", "lat", "v"], [[round(a, 5), round(b, 5), int(v)] for a, b, v in zip(hl, ha, hv) if v >= 0])

    r65 = np.where(B["pop"] > 0, B["p65"] / np.maximum(B["pop"], 1), np.nan)
    hyd_d = hyd / km2
    liq_score = liq3 + 0.5 * liq2
    s6 = 100 * (0.35 * pct(liq_score) + 0.25 * pct(r65) + 0.20 * pct(fire) + 0.20 * pct(-hyd_d))
    s6 = np.where(B["pop"] > 300, s6, np.nan)
    exposed = B["p65"] * liq_score
    order = np.argsort(-np.nan_to_num(s6, nan=-1))
    cum = np.cumsum(exposed[order]) / max(exposed.sum(), 1)
    curve = [dict(k=k, share=round(k / n, 3), captured=round(float(cum[k - 1]), 4)) for k in range(1, n + 1) if k % 5 == 0 or k == n]

    bs = read_csv("tsis", "buildings_stats")
    last = bs.iloc[-1]
    old_share = float(num(pd.Series([last["屋齡別/30年以上數量[棟]"]]))[0]) / float(num(pd.Series([last["總數量[棟]"]]))[0])
    ea = read_csv("data_taipei", "elderly_alone")
    q = ea["年/季"].iloc[-1]
    alone = {norm_name(d): int(v) for d, v in zip(ea[ea["年/季"] == q]["行政區"], num(ea[ea["年/季"] == q]["總人數"]))}
    log(f"06 liquefaction polygons {len(feats)}, fire-access sites matched {matched}/{len(fa)} (miss {miss[:5]}), hydrants in Taipei {int(hyd.sum()):,}")
    imp = dict(
        assumptions=[
            "風險權重：土壤液化潛勢（高 + 0.5 × 中，面積比）0.35、65 歲以上比例 0.25、搶救困難地區數 0.20、消防栓密度（反向）0.20",
            "暴露長者 = 65 歲以上人口 × 液化潛勢面積比",
            "沒有逐棟屋齡與結構開放資料，屋齡只用全市統計",
        ],
        baseline=dict(liq_polygons=len(feats), fire_sites=len(fa), fire_matched=matched, hydrants=int(hyd.sum()),
                      old_building_share=round(old_share, 4), buildings=int(num(pd.Series([last["總數量[棟]"]]))[0]),
                      building_year=str(last["統計期"]), exposed_elderly=round(float(exposed.sum())),
                      elderly_alone_quarter=str(q).strip(), elderly_alone=alone),
        curve=curve,
    )
    cols = dict(liq3=liq3, liq2=liq2, fire=fire, hyd=hyd, hyd_d=hyd_d, exp65=exposed, s6=s6)
    return cols, imp


# ---------------------------------------------------------------- petitions + statistics
PETITION_MAP = {
    1: ["路樹修剪維護、路燈遷移", "路樹處理（派工）", "人行道維護"],
    2: ["路面清潔（含行人果皮箱、菸蒂、狗便）", "鄰里無主垃圾清運（派工）", "垃圾車清運及服務事項"],
    3: ["排水溝疏通", "雨水下水道側溝清淤（派工）", "溝蓋遺失、鬆動、被打開", "餐飲業者食品衛生（不領取檢舉獎金）", "餐飲業者食品衛生（領取檢舉獎金）"],
    4: ["交通號誌異常（派工）", "交通動線規劃問題", "交通管制疏導", "交通號（標）誌設置問題"],
    5: ["公車問題", "公車、計程車、復康巴士問題"],
    6: ["建築物使用管理、違建查報及拆除（含防火巷占用、固定式騎樓障礙物）", "施工管理及建築損鄰", "消防安全管理（含防災、搶救、火災調查及消防通道）"],
}


def timeseries():
    files = sorted(glob(str(RAW / "data_taipei" / "petitions_1*_latest.csv")))
    df = pd.concat([pd.read_csv(p, encoding="utf-8-sig", usecols=["案件次類別", "受理日期", "結案日期"], low_memory=False) for p in files])
    df["month"] = df["受理日期"].astype(str).str[:6]
    keep = df["month"].value_counts()
    months = sorted(m for m, c in keep.items() if c >= 10000)
    df = df[df["month"].isin(months)]
    t0 = pd.to_datetime(df["受理日期"].astype(str).str[:8], format="%Y%m%d", errors="coerce")
    t1 = pd.to_datetime(df["結案日期"].astype(str).str[:8], format="%Y%m%d", errors="coerce")
    df["days"] = (t1 - t0).dt.days
    sub2dom = {s: d for d, subs in PETITION_MAP.items() for s in subs}
    df["dom"] = df["案件次類別"].map(sub2dom)
    pet = {}
    for d in DOMAINS:
        x = df[df["dom"] == d]
        by = x.groupby("month").size().reindex(months, fill_value=0)
        pet[d] = dict(monthly=[int(v) for v in by], total=int(len(x)), median_days=r(x["days"].median(), 1),
                      categories={s: int((x["案件次類別"] == s).sum()) for s in PETITION_MAP[d]})
    total = df.groupby("month").size().reindex(months, fill_value=0)

    def annual(source, name, col):
        t = read_csv(source, name)
        yrs = [int(str(s).replace("年", "")) + 1911 for s in t["統計期"]]
        return [[y, float(v)] for y, v in zip(yrs, num(t[col])) if np.isfinite(v)]

    bs = read_csv("tsis", "buildings_stats")
    old = [[int(str(s).replace("年", "")) + 1911, float(o) / float(a) if a else None]
           for s, o, a in zip(bs["統計期"], num(bs["屋齡別/30年以上數量[棟]"]), num(bs["總數量[棟]"]))]
    mr = read_csv("tsis", "mrt_ridership")
    mrt_total = [[int(str(s).replace("年", "")) + 1911, float(v)] for s, v in zip(mr["統計期"], mr.iloc[:, 1:].apply(num).sum(axis=1))]
    ea = read_csv("data_taipei", "elderly_alone")
    alone = ea.groupby("年/季", sort=False)["總人數"].apply(lambda s: int(num(s).sum()))
    log(f"petitions {len(files)} files, months {months[0]}..{months[-1]}, mapped {int(df['dom'].notna().sum()):,} of {len(df):,}")
    return dict(
        months=[f"{m[:4]}-{m[4:]}" for m in months],
        petitions_total=[int(v) for v in total],
        petitions=pet,
        bus_daily_riders=annual("tsis", "bus_stats", "平均每日客運人次[人次]"),
        bus_vkm=annual("tsis", "bus_stats", "行駛車公里[公里]"),
        old_building_share=[x for x in old if x[0] >= 1990 and x[1] is not None],
        mrt_entries=[x for x in mrt_total if x[1] > 0],
        elderly_alone=[[str(k).strip(), int(v)] for k, v in alone.items()],
    )


# ---------------------------------------------------------------- links between problems
MECHANISMS = [
    (2, 3, "餐飲與垃圾是老鼠的食物來源：清潔箱不足、垃圾車停靠點多的地方，見鼠通報也多。", ["環保局", "衛生局", "產業局"]),
    (4, 5, "公車和一般車流共用道路：路段壅塞直接拉長公車行車時間與候車時間。", ["交通局", "公運處"]),
    (1, 5, "從家走到公車站的路上有沒有樹蔭，影響長者是否願意搭公車。", ["工務局公園處", "公運處"]),
    (1, 2, "樹穴、清潔箱、候車亭都在同一條人行道上，要一起規劃空間。", ["工務局新工處", "工務局公園處", "環保局"]),
    (5, 6, "高齡、離捷運遠的里，平常靠公車，地震時也最難疏散。", ["公運處", "社會局", "消防局"]),
    (1, 6, "高齡人口同時是熱傷害和地震的高風險族群。", ["社會局", "工務局公園處", "都發局"]),
    (4, 6, "搶救困難地區若遇上壅塞路段，消防車更難抵達。", ["消防局", "交通局"]),
    (3, 6, "下水道與人孔是鼠類通道；液化區地震後管線受損，鼠患可能擴散。", ["工務局衛工處", "工務局水利處", "衛生局"]),
]


def links(score_cols, cols, d1ctx, d2ctx, T, imp):
    S = pd.DataFrame({d: score_cols[d] for d in DOMAINS})
    rho = S.corr(method="spearman", min_periods=30)
    hot = {d: set(np.where(np.nan_to_num(S[d].to_numpy(), nan=-1) >= HOT)[0]) for d in DOMAINS}
    mat = [[r(rho.loc[a, b], 3) for b in DOMAINS] for a in DOMAINS]
    jac = [[r(len(hot[a] & hot[b]) / max(len(hot[a] | hot[b]), 1), 3) for b in DOMAINS] for a in DOMAINS]

    # evidence metrics
    polys, ratio, sw_tree = d1ctx["polys"], d1ctx["ratio"], d1ctx["tree"]
    sx = np.array([s["x"] for s in T["stops"]])
    sy = np.array([s["y"] for s in T["stops"]])
    si, pi = sw_tree.query_nearest(shapely.points(sx, sy), max_distance=25, all_matches=False)
    stop_shade = ratio[pi]
    bi, bpi = sw_tree.query_nearest(shapely.points(d2ctx["bx"], d2ctx["by"]), max_distance=25, all_matches=False)
    P, w, kind, covered = d2ctx["P"], d2ctx["w"], d2ctx["kind"], d2ctx["covered"]
    busy = (kind == "bus") & (w >= 10)
    ev = {
        (2, 3): [dict(label="餐飲密度與見鼠通報密度（里）Spearman ρ", value=imp[3]["baseline"]["spearman_food_reports"]),
                 dict(label="風險模型前 20% 的里涵蓋的見鼠通報", value=imp[3]["baseline"]["top20_captured"], unit="%")],
        (4, 5): [dict(label="行經 E/F 級壅塞路段的公車路線（擷取當下）", value=imp[5]["baseline"]["routes_through_congestion"], unit="條"),
                 dict(label="行經內湖 VD 路段的公車路線", value=imp[4]["neihu"]["bus_routes"], unit="條")],
        (1, 5): [dict(label="旁邊人行道遮蔭率 < 20% 的公車站", value=r(float((stop_shade < 0.2).mean()), 4), unit="%"),
                 dict(label="有對應到人行道的公車站", value=int(len(si)), unit="站")],
        (1, 2): [dict(label="位在遮蔭率 < 20% 人行道上的清潔箱", value=r(float((ratio[bpi] < 0.2).mean()), 4) if len(bpi) else None, unit="%"),
                 dict(label="停靠 ≥ 10 條路線但 150 m 內沒有清潔箱的公車站", value=int((busy & ~covered).sum()), unit="站")],
        (5, 6): [dict(label="公車冷區與耐震高風險同時是熱點的里", value=len(hot[5] & hot[6]), unit="里")],
        (1, 6): [dict(label="樹蔭與耐震同時是熱點的里", value=len(hot[1] & hot[6]), unit="里"),
                 dict(label="65 歲以上比例與耐震分數 Spearman ρ",
                      value=r(spearman(cols["r65"], score_cols[6]), 3))],
        (4, 6): [dict(label="有搶救困難地區且路段壅塞為熱點的里", value=int(sum(1 for v in hot[4] if cols["fire"][v] > 0)), unit="里")],
        (3, 6): [dict(label="鼠患與耐震同時是熱點的里", value=len(hot[3] & hot[6]), unit="里")],
    }
    edges = []
    for a, b, mech, ag in MECHANISMS:
        edges.append(dict(a=a, b=b, rho=r(rho.loc[a, b], 3), jaccard=jac[a - 1][b - 1], co_hot=len(hot[a] & hot[b]),
                          mechanism=mech, agencies=ag, evidence=ev.get((a, b), [])))
    log("links: " + ", ".join(f"{e['a']}-{e['b']} ρ={e['rho']} J={e['jaccard']}" for e in edges))
    return dict(domains=DOMAINS, hot_threshold=HOT, spearman=mat, jaccard=jac,
                hot_counts={d: len(hot[d]) for d in DOMAINS}, edges=edges)


# ---------------------------------------------------------------- catalog / lineage
def catalog(outputs, peak_mock=True):
    items = []
    for s in SOURCES:
        metas = sorted(glob(str(RAW / s["source"] / f"{s['key']}*.meta.json")))
        # monthly files (dt_multi) are listed one by one; per-day history files are summarised by {key}.meta.json
        pat = r"\.meta\.json" if s["kind"] == "tdx_hist" else r"(_\d+)?\.meta\.json"
        metas = [m for m in metas if re.fullmatch(re.escape(s["key"]) + pat, m.split("/")[-1])]
        for mp in metas:
            m = json.loads(open(mp).read())
            items.append(dict(key=m["name"], group=s["key"], title=s["title"], agency=s["agency"], problems=s["problems"],
                              source=s["source"], fetched_at=m.get("fetched_at"), record_count=m.get("record_count"),
                              bytes=m.get("bytes"), url=m.get("source_url"), live=bool(s.get("live")),
                              interval=s.get("interval"), is_mock=m.get("is_mock", False), period=m.get("period")))
    mocks = [
        dict(key="bin_fill", title="清潔箱每日填滿速度", problems=[2], reason="沒有開放的滿溢感測資料，依周邊人流需求推估",
             used_in=["layers/bins.json", "impact.json"]),
    ]
    if peak_mock:
        mocks.append(dict(key="neihu_peak_profile", title="內科晨峰 15 分鐘車流曲線", problems=[4],
                          reason="需要平日 07:00–09:30 的 VD 歷史序列；執行 pipeline.history 抓 TDX 歷史 VD 後自動改用真實資料",
                          used_in=["impact.json"]))
    # output size at build time (live files keep changing; the collector rewrites them every minute)
    outputs = [dict(o, bytes=(OUT / o["file"]).stat().st_size if (OUT / o["file"]).exists() else None) for o in outputs]
    return dict(built_at=now_tpe().isoformat(timespec="seconds"), sources=items, outputs=outputs, mock=mocks)


# ---------------------------------------------------------------- main
BASE: dict = {}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    V = Villages()
    log(f"villages {V.n}")
    B = base(V)
    BASE.update(B)

    # shared point sets
    rs = read_csv("data_taipei", "restaurants")
    flon, flat = num(rs["Longitude"]).to_numpy(), num(rs["Latitude"]).to_numpy()
    fx, fy = lonlat_to_97(flon, flat)
    fv = V.assign_xy(fx, fy)

    T = transit(V)
    tctx = livemod.TrafficContext(V)
    lv = livemod.write_all(tctx, series=True)

    c1, i1, ctx1 = d1_shade(V, B)
    c2, i2, ctx2 = d2_bins(V, B, T, (fx, fy, fv))
    c3, i3, ts3 = d3_rats(V, B, (flon, flat, fv, rs), ctx2["markets"])
    c4, i4, sec97 = d4_traffic(V, B, T, tctx)
    c5, i5 = d5_bus(V, B, T, sec97, lv.get("traffic", {}))
    c6, i6 = d6_seismic(V, B)

    km2 = V.area_m2 / 1e6
    r65 = np.where(B["pop"] > 0, B["p65"] / np.maximum(B["pop"], 1), np.nan)
    cols = dict(pop=B["pop"], p65=B["p65"], r65=r65, dens=B["pop"] / km2, **c1, **c2, **c3, **c4, **c5, **c6)
    # scores are published with 1 decimal; hot flags, co-hot sets and correlations use the published values,
    # so recounting from villages.geojson gives the same numbers as links.json and impact.json
    score = {d: np.round(c[f"s{d}"], 1) for d, c in zip(DOMAINS, (c1, c2, c3, c4, c5, c6))}
    cols.update({f"s{d}": score[d] for d in DOMAINS})
    S = np.column_stack([score[d] for d in DOMAINS])
    with np.errstate(all="ignore"):
        fusion = np.nanmean(S, axis=1)
    hot = (np.nan_to_num(S, nan=-1) >= HOT).sum(axis=1)
    cols.update(f=fusion, hot=hot)

    # villages.geojson (coverage-simplified so neighbours keep shared edges)
    simp = shapely.coverage_simplify(np.array(V.geoms, dtype=object), 6)
    ND = dict(pop=0, p65=0, dens=0, st=0, pt=0, sw=0, gap=0, slots=0, park=0, bins=0, dem=1, ucd=1, rats=0, food=0, trk=0, mh=0, fire=1,
              mkt=0, sec=0, stops=0, pass_=0, hyd=0, exp65=0, hyd_d=1, rat_d=2, mrt_km=2, f=1, hot=0,
              s1=1, s2=1, s3=1, s4=1, s5=1, s6=1)
    feats = []
    for i in range(V.n):
        rec = V.recs[i]
        p = dict(i=i, id=str(rec["CPTVID"]), v=rec["VNAME"], d=rec["TNAME"], km2=round(float(km2[i]), 3))
        for k, arr in cols.items():
            val = arr[i]
            nd = ND.get(k, 3)
            key = "pass" if k == "pass_" else k
            p[key] = None if not np.isfinite(val) else (int(round(val)) if nd == 0 else round(float(val), nd))
        feats.append(feature(geom_to_84(simp[i]), p))
    fc("villages.geojson", feats, meta=dict(population_period=B["period"], hot_threshold=HOT, domains=DOMAINS))

    dist = load_shp_zip(RAW / "data_taipei" / "district_latest.zip")
    dfeats = []
    for rec, g in dist:
        pt = g.representative_point()
        lon, lat = xy_to_84([pt.x], [pt.y])
        dfeats.append(feature(geom_to_84(shapely.simplify(shapely.make_valid(g), 10)),
                              dict(name=rec["TNAME"], lon=round(float(lon[0]), 5), lat=round(float(lat[0]), 5))))
    fc("districts.geojson", dfeats)

    imp = {1: i1, 2: i2, 3: i3, 4: i4, 5: i5, 6: i6}
    lk = links(score, cols, ctx1, ctx2, T, imp)
    write_json(OUT / "links.json", lk)
    ts = timeseries()
    ts.update(ts3)
    write_json(OUT / "timeseries.json", ts)

    # city-level summary for the overview
    order = np.argsort(-np.nan_to_num(fusion, nan=-1))
    imp_out = {str(k): v for k, v in imp.items()}
    imp_out["fusion"] = dict(
        top=[dict(i=int(i), v=V.recs[i]["VNAME"], d=V.recs[i]["TNAME"], f=round(float(fusion[i]), 1), hot=int(hot[i]),
                  s=[None if not np.isfinite(score[d][i]) else round(float(score[d][i])) for d in DOMAINS]) for i in order[:40]],
        multi_hot=int((hot >= 3).sum()),
        multi_hot_pop=int(B["pop"][hot >= 3].sum()),
    )
    write_json(OUT / "impact.json", imp_out)

    # lineage: every file the dashboard reads and the raw sources (or other outputs) it is computed from.
    # The 里 join (village) is listed only for villages.geojson; layers carry it as their `v` column.
    stops = ["bus_stop", "bus_route", "bus_timetable"]  # stop locations + weekday passes
    demand = [*stops, "metro_station", "mrt_ridership", "restaurants", "vendor_markets"]  # 02 foot-traffic demand points
    outputs = [
        dict(file="villages.geojson", inputs=["village", "population_age", "trees_street", "trees_park", "sidewalk", "parks", "bins",
                                              "bus_stop", "bus_route", "bus_timetable", "metro_station", "mrt_ridership", "restaurants",
                                              "vendor_markets", "garbage_truck", "rain_manholes", "ratradar", "dengue_vector",
                                              "road_section", "road_section_shape", "road_live", "liquefaction", "fire_access", "hydrants"]),
        dict(file="links.json", inputs=["villages.geojson"]),
        dict(file="impact.json", inputs=["villages.geojson", "tree_holes", "vd_static", "buildings_stats", "elderly_alone", "bus_shape",
                                         "metro_shape", *([] if i4["profile"]["is_mock"] else ["vd_hist"])]),
        dict(file="timeseries.json", inputs=["petitions", "bus_stats", "buildings_stats", "mrt_ridership", "elderly_alone", "ratradar"]),
        dict(file="districts.geojson", inputs=["district"]),
        dict(file="bus_routes.json", inputs=["bus_route", "bus_shape", "bus_timetable", "metro_shape", "road_section_shape", "road_live"]),
        dict(file="lines/bus_routes.geojson", inputs=["bus_route", "bus_shape", "bus_timetable", "metro_shape"]),
        dict(file="lines/mrt.geojson", inputs=["metro_shape"]),
        dict(file="lines/sidewalks.geojson", inputs=["sidewalk", "trees_street"]),
        dict(file="lines/road_sections.geojson", inputs=["road_section_shape", "road_section"]),
        dict(file="poly/liquefaction.geojson", inputs=["liquefaction"]),
        dict(file="layers/trees.json", inputs=["trees_street"]),
        dict(file="layers/tree_holes.json", inputs=["tree_holes"]),
        dict(file="layers/bins.json", inputs=["bins", *demand]),
        dict(file="layers/bin_candidates.json", inputs=["bins", *demand]),
        dict(file="layers/rats.json", inputs=["ratradar"]),
        dict(file="layers/restaurants.json", inputs=["restaurants"]),
        dict(file="layers/garbage_truck.json", inputs=["garbage_truck"]),
        dict(file="layers/markets.json", inputs=["vendor_markets"]),
        dict(file="layers/manholes.json", inputs=["rain_manholes"]),
        dict(file="layers/vd.json", inputs=["vd_static", "road_section"]),
        dict(file="layers/bus_stops.json", inputs=stops),
        dict(file="layers/mrt.json", inputs=["metro_station", "mrt_ridership"]),
        dict(file="layers/hydrants.json", inputs=["hydrants"]),
        dict(file="live/traffic.json", inputs=["road_live", "vd_live", "vd_static", "road_section"]),
        dict(file="live/bus.json", inputs=["bus_live", "bus_eta"]),
        dict(file="live/rain.json", inputs=["rain_live"]),
        dict(file="live/series.json", inputs=["live/traffic.json", "live/bus.json", "live/rain.json"]),
    ]
    write_json(OUT / "catalog.json", catalog(outputs, peak_mock=i4["profile"]["is_mock"]))
    log("done")


if __name__ == "__main__":
    main()
