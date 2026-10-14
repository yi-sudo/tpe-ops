"""Parse live feeds (raw snapshots in data/raw/) into the small JSON files the dashboard polls.

Used by build.py (one pass from the latest snapshots) and collect_live.py (loop).
Outputs under dashboard/public/data/live/:
  traffic.json  city + 內湖 KPIs, per-section congestion, per-VD flow (realtime)
  bus.json      buses on duty, positions, ETA-based waiting time
  rain.json     rain gauges
  series.json   ring buffer of KPI points for sparklines
  peak.json     內湖 weekday 07:00-09:30 15-min profile accumulated from VD snapshots
"""
from __future__ import annotations

import gzip
import json
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import numpy as np

from .common import RAW, ROOT, TPE, now_tpe
from .geo import Villages, write_json

OUT = ROOT / "dashboard" / "public" / "data"
LIVE = OUT / "live"
NS = {"t": "http://traffic.transportdata.tw/standard/traffic/schema/"}

# lane capacity assumptions (veh/h/lane), shown in the UI next to every V/C number
CAP_PER_LANE = {"2": 1600.0, "6": 900.0}
NEIHU_PEAK = ("07:00", "09:30")
SERIES_MAX = 2880  # points kept in series.json (2 days at 1 per minute)


def meta(source: str, name: str) -> dict:
    p = RAW / source / f"{name}.meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


# ---------------------------------------------------------------- static context
class TrafficContext:
    """VD + road section metadata needed to interpret live traffic."""

    def __init__(self, villages: Villages | None = None):
        V = villages or Villages()
        root = ET.parse(RAW / "tcgbusfs" / "vd_static_latest.xml").getroot()
        self.vd = {}
        for vd in root.iter(f"{{{NS['t']}}}VD"):
            def g(k):
                e = vd.find(f"t:{k}", NS)
                return e.text if e is not None else None
            lanes = sum(int(l.find("t:LaneNum", NS).text or 0) for l in vd.iter(f"{{{NS['t']}}}DetectionLink"))
            self.vd[g("VDID")] = dict(lon=float(g("PositionLon")), lat=float(g("PositionLat")), road=g("RoadName") or "",
                                     cls=g("RoadClass") or "6", lanes=max(lanes, 1))
        ids = list(self.vd)
        vi = V.assign_lonlat([self.vd[i]["lon"] for i in ids], [self.vd[i]["lat"] for i in ids])
        for i, v in zip(ids, vi):
            self.vd[i]["village"] = int(v)
            self.vd[i]["neihu"] = bool(v >= 0 and V.recs[v]["TNAME"] == "內湖區")

        sec = json.loads((RAW / "tdx" / "road_section_latest.json").read_text(encoding="utf-8-sig"))["Sections"]
        self.section = {}
        for s in sec:
            a, b = s.get("SectionStart") or {}, s.get("SectionEnd") or {}
            mid_lon = (a.get("PositionLon", 0) + b.get("PositionLon", 0)) / 2
            mid_lat = (a.get("PositionLat", 0) + b.get("PositionLat", 0)) / 2
            self.section[s["SectionID"]] = dict(name=s.get("SectionName", ""), road=s.get("RoadName", ""),
                                               cls=str(s.get("RoadClass", "")), km=float(s.get("SectionLength") or 0),
                                               lon=mid_lon, lat=mid_lat)
        sids = list(self.section)
        si = V.assign_lonlat([self.section[i]["lon"] for i in sids], [self.section[i]["lat"] for i in sids])
        for i, v in zip(sids, si):
            self.section[i]["neihu"] = bool(v >= 0 and V.recs[v]["TNAME"] == "內湖區")


# ---------------------------------------------------------------- parsers
def parse_vd_live(body: bytes) -> dict[str, dict]:
    """GetVDDATA.xml.gz -> {VDID: {vol5 (veh per 5 min, all lanes), spd (volume weighted), occ (mean %), lanes}}."""
    root = ET.fromstring(gzip.decompress(body))
    out = {}
    for d in root.iter("VDDevice"):
        lanes = []
        for l in d.iter("LaneData"):
            try:
                lanes.append((float(l.find("Volume").text), float(l.find("AvgSpeed").text), float(l.find("AvgOccupancy").text)))
            except (TypeError, ValueError, AttributeError):
                continue
        lanes = [x for x in lanes if x[0] >= 0 and x[1] >= 0 and x[2] >= 0]
        if not lanes:
            continue
        vol = sum(x[0] for x in lanes)
        spd = sum(x[0] * x[1] for x in lanes) / vol if vol > 0 else float(np.mean([x[1] for x in lanes]))
        out[d.find("DeviceID").text] = dict(vol5=vol, spd=spd, occ=float(np.mean([x[2] for x in lanes])), n=len(lanes))
    return out


def vd_exchange_time(body: bytes) -> str | None:
    root = ET.fromstring(gzip.decompress(body))
    e = root.find("ExchangeTime")
    if e is None or not e.text:
        return None
    return datetime.strptime(e.text, "%Y/%m/%dT%H:%M:%S").replace(tzinfo=TPE).isoformat(timespec="seconds")


# ---------------------------------------------------------------- traffic
def traffic(ctx: TrafficContext) -> dict:
    road = json.loads((RAW / "tdx" / "road_live_latest.json").read_text(encoding="utf-8-sig"))
    vd_body = (RAW / "tcgbusfs" / "vd_live_latest.xml.gz").read_bytes()
    vd = parse_vd_live(vd_body)

    sections = {}
    for s in road["LiveTraffics"]:
        lvl = int(float(s.get("CongestionLevel", -99)))
        spd = float(s.get("TravelSpeed", -99))
        sections[s["SectionID"]] = [lvl if 1 <= lvl <= 6 else -1, round(spd, 1) if spd > 0 else -1]

    def summarize(ids):
        valid = [(sections[i][0], sections[i][1], ctx.section.get(i, {}).get("km", 0)) for i in ids if i in sections and sections[i][0] > 0]
        if not valid:
            return dict(n=0)
        km = sum(v[2] for v in valid) or 1
        los = {k: 0 for k in "ABCDEF"}
        for lvl, _, _ in valid:
            los["ABCDEF"[lvl - 1]] += 1
        spds = [v[1] for v in valid if v[1] > 0]
        return dict(n=len(valid), mean_speed=round(float(np.mean(spds)), 1) if spds else None,
                    congested_share=round(sum(v[2] for v in valid if v[0] >= 5) / km, 4), los=los)

    all_ids = list(sections)
    neihu_ids = [i for i in all_ids if ctx.section.get(i, {}).get("neihu")]

    vd_out, nh = {}, []
    for vid, v in vd.items():
        st = ctx.vd.get(vid)
        if not st:
            continue
        flow = v["vol5"] * 12  # veh/h
        cap = CAP_PER_LANE.get(st["cls"], 900.0) * st["lanes"]
        vc = flow / cap if cap else None
        vd_out[vid] = [round(flow), round(v["spd"], 1), round(v["occ"], 1), round(vc, 3) if vc is not None else None]
        if st["neihu"]:
            nh.append((flow, v["spd"], v["occ"], vc))

    neihu = summarize(neihu_ids)
    if nh:
        f = np.array([x[0] for x in nh])
        neihu.update(vd=len(nh), flow_vph=int(f.sum()),
                     vd_speed=round(float(np.average([x[1] for x in nh], weights=np.maximum(f, 1))), 1),
                     occ_mean=round(float(np.mean([x[2] for x in nh])), 1),
                     vc_mean=round(float(np.average([x[3] for x in nh], weights=np.maximum(f, 1))), 3))

    m_road, m_vd = meta("tdx", "road_live"), meta("tcgbusfs", "vd_live")
    return dict(
        fetched_at=max(m_road.get("fetched_at", ""), m_vd.get("fetched_at", "")),
        feeds=dict(road_live=dict(fetched_at=m_road.get("fetched_at"), src_time=road.get("SrcUpdateTime")),
                   vd_live=dict(fetched_at=m_vd.get("fetched_at"), src_time=vd_exchange_time(vd_body))),
        cap_per_lane=CAP_PER_LANE,
        city=summarize(all_ids),
        neihu=neihu,
        sections=sections,
        vd=vd_out,
    )


# ---------------------------------------------------------------- bus
def bus() -> dict:
    def load(name):
        return json.loads(gzip.decompress((RAW / "tcgbusfs" / f"{name}_latest.json.gz").read_bytes()).decode("utf-8-sig"))

    pos = load("bus_live")["BusInfo"]
    positions, speeds = [], []
    for b in pos:
        try:
            lon, lat, spd = float(b["Longitude"]), float(b["Latitude"]), float(b["Speed"])
        except (KeyError, ValueError):
            continue
        if not (121.3 < lon < 121.8 and 24.8 < lat < 25.3):
            continue
        positions.append([round(lon, 5), round(lat, 5), b.get("RouteID", ""), int(spd), int(b.get("Azimuth") or 0)])
        if b.get("DutyStatus") == "1" and spd > 0:
            speeds.append(spd)

    eta = load("bus_eta")["BusInfo"]
    sec = np.array([int(e["EstimateTime"]) for e in eta if e.get("EstimateTime") not in (None, "")])
    pos_eta = sec[sec >= 0]
    m_live, m_eta = meta("tcgbusfs", "bus_live"), meta("tcgbusfs", "bus_eta")
    return dict(
        fetched_at=max(m_live.get("fetched_at", ""), m_eta.get("fetched_at", "")),
        feeds=dict(bus_live=dict(fetched_at=m_live.get("fetched_at")), bus_eta=dict(fetched_at=m_eta.get("fetched_at"))),
        on_duty=len(positions),
        moving_speed=round(float(np.mean(speeds)), 1) if speeds else None,
        eta=dict(
            stops=int(len(sec)),
            with_eta=int(len(pos_eta)),
            within_3min=round(float((pos_eta <= 180).mean()), 4) if len(pos_eta) else None,
            mean_wait_min=round(float(pos_eta.mean() / 60), 1) if len(pos_eta) else None,
            p90_wait_min=round(float(np.percentile(pos_eta, 90) / 60), 1) if len(pos_eta) else None,
            not_departed=int((sec == -1).sum()),
            no_service=int(np.isin(sec, [-3, -4]).sum()),
        ),
        positions=positions,
    )


# ---------------------------------------------------------------- rain
def rain() -> dict:
    j = json.loads((RAW / "wic" / "rain_live_latest.json").read_text(encoding="utf-8-sig"))
    m = meta("wic", "rain_live")
    fetched = datetime.fromisoformat(m["fetched_at"]) if m.get("fetched_at") else now_tpe()
    st = []
    for d in j.get("data", []):
        try:
            t = datetime.strptime(d["recTime"], "%Y%m%d%H%M").replace(tzinfo=TPE)
            r = float(d["rain"])
        except (KeyError, ValueError):
            continue
        stale = abs((fetched - t).total_seconds()) > 3 * 3600  # some gauges report broken timestamps
        st.append(dict(no=d["stationNo"], name=d["stationName"], rain=r, time=t.isoformat(timespec="minutes"), stale=stale))
    fresh = [s for s in st if not s["stale"]]
    return dict(fetched_at=m.get("fetched_at"), stations=st, n=len(st), fresh=len(fresh),
                max_rain=max((s["rain"] for s in fresh), default=0.0), raining=sum(1 for s in fresh if s["rain"] > 0))


# ---------------------------------------------------------------- series + peak profile
def append_series(t: dict, b: dict, r: dict) -> list:
    path = LIVE / "series.json"
    rows = json.loads(path.read_text()).get("rows", []) if path.exists() else []
    ts = int(now_tpe().timestamp())
    c, n = t.get("city", {}), t.get("neihu", {})
    row = [ts, c.get("mean_speed"), c.get("congested_share"), n.get("mean_speed"), n.get("congested_share"),
           n.get("flow_vph"), n.get("vc_mean"), b.get("on_duty"), b.get("moving_speed"),
           b.get("eta", {}).get("mean_wait_min"), r.get("max_rain")]
    if rows and ts - rows[-1][0] < 30:  # same minute -> replace
        rows[-1] = row
    else:
        rows.append(row)
    rows = rows[-SERIES_MAX:]
    write_json(path, dict(cols=["t", "city_speed", "city_cong", "neihu_speed", "neihu_cong", "neihu_flow", "neihu_vc",
                                "bus_on_duty", "bus_speed", "eta_wait", "rain_max"], rows=rows, is_mock=False))
    return rows


def update_peak(t: dict) -> None:
    """Accumulate 內湖 VD flow into weekday 15-minute bins inside the morning peak window."""
    now = now_tpe()
    if now.weekday() >= 5:
        return
    hm = now.strftime("%H:%M")
    if not (NEIHU_PEAK[0] <= hm < NEIHU_PEAK[1]):
        return
    path = LIVE / "peak.json"
    p = json.loads(path.read_text()) if path.exists() else dict(days={}, is_mock=False)
    day = now.strftime("%Y-%m-%d")
    b = f"{now.hour:02d}:{now.minute // 15 * 15:02d}"
    n = t.get("neihu", {})
    if not n.get("flow_vph"):
        return
    cell = p["days"].setdefault(day, {}).setdefault(b, dict(flow=0.0, speed=0.0, vc=0.0, k=0))
    k = cell["k"]
    cell["flow"] = (cell["flow"] * k + n["flow_vph"]) / (k + 1)
    cell["speed"] = (cell["speed"] * k + (n.get("vd_speed") or 0)) / (k + 1)
    cell["vc"] = (cell["vc"] * k + (n.get("vc_mean") or 0)) / (k + 1)
    cell["k"] = k + 1
    p["updated_at"] = now.isoformat(timespec="seconds")
    write_json(path, p)


def write_all(ctx: TrafficContext, series: bool = True) -> dict:
    """Recompute every live JSON from the latest raw snapshots. Each feed fails independently."""
    res = {}
    for name, fn in (("traffic", lambda: traffic(ctx)), ("bus", bus), ("rain", rain)):
        try:
            res[name] = fn()
            write_json(LIVE / f"{name}.json", {**res[name], "is_mock": False})
        except Exception as e:  # keep the previous file
            res[name] = {}
            print(f"  live/{name}.json FAIL {e}", flush=True)
    if series:
        append_series(res.get("traffic", {}), res.get("bus", {}), res.get("rain", {}))
        update_peak(res.get("traffic", {}))
    return res


def status(feeds: dict) -> None:
    write_json(LIVE / "status.json", dict(updated_at=now_tpe().isoformat(timespec="seconds"), feeds=feeds))


if __name__ == "__main__":
    r = write_all(TrafficContext())
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("sections", "vd", "positions", "stations")} for k, v in r.items()},
                     ensure_ascii=False, indent=1))
