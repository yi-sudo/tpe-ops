"""TDX 歷史 VD -> 內湖平日晨峰 15 分鐘曲線（取代 impact.json "4" 的模擬曲線）。

    .venv/bin/python -m pipeline.history --days 10                  # 最近 10 個平日（已存的日期不重抓）
    .venv/bin/python -m pipeline.history --dates 2026-10-13         # 指定日期
    .venv/bin/python -m pipeline.history --summary                  # 只彙整已存的日期，不連網

TDX 歷史 API 一次回一整天全臺北約 650 支 VD 的逐分鐘資料（NDJSON，約 93 萬筆、1.1 GB，約 100 秒）。
實測 $filter、$select、$skip 都被忽略（只有 $top 有效），所以每天只發 1 次請求、用串流讀完整個檔案，
在本機只留內湖區 VD、台北時間 06:45–09:45 的原始紀錄。檔案不是依時間排序（同一分鐘的紀錄最晚
約 2 小時後才出現），所以不能讀到晨峰之後就提早關閉連線。

原始快取（CLAUDE.md 資料快取規則；歷史資料不會變，已存的日期不重抓，失敗不寫檔）：
  data/raw/tdx/vd_hist_{YYYYMMDD}.ndjson.gz     篩選後的原始紀錄，一行一筆，內容與 API 回應相同
  data/raw/tdx/vd_hist_{YYYYMMDD}.meta.json     source_url、fetched_at、record_count、is_mock、篩選條件、掃描統計
  data/raw/tdx/vd_hist.meta.json                總表（日期、期間、總筆數），給資料目錄用
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import numpy as np
import requests

from .common import RAW, TPE, UA, _throttle, now_tpe, tdx_token

HIST_URL = "https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei"
DIR = RAW / "tdx"
NAME = "vd_hist"
TITLE = "TDX 歷史 VD（內湖晨峰）"
DAYS = 10  # weekdays averaged into the profile

BINS = ["07:00", "07:15", "07:30", "07:45", "08:00", "08:15", "08:30", "08:45", "09:00", "09:15"]
KEEP = ("06:45", "09:45")  # raw window kept on disk (Taipei time): one bin of margin on each side

# 平日的國定假日（逢週六於前一個上班日補假、逢週日於次一個上班日補假），晨峰不具代表性，不抓：
# 9/25 中秋節、9/28 教師節、10/9 國慶日補假、10/26 臺灣光復節補假、12/25 行憲紀念日
HOLIDAYS = {"2026-09-25", "2026-09-28", "2026-10-09", "2026-10-26", "2026-12-25"}

# ---- data-quality rules (applied in read_day / aggregate_day / profile; the same text goes to the UI) ----
# ErrorDiags observed 2026-09-29..10-13 (no published definition found): diag102+106 carry -99 for every value;
# diag201+203+205 count vehicles with speed and occupancy 0; diag202 has speed but no vehicles; diag107 only
# appears with the frozen timestamps of 2026-10-02 (DataCollectTime stuck at 07:01 for an hour, 60 records per VD
# on the same minute). diag303 flags a whole VD for whole days, but its values match the same lane on unflagged
# days (flow ratio p10/50/90 0.94/1.00/1.04 over 128 lane-days, same spread as clean lanes day to day, values not
# stuck), so it is kept. Apart from 10-02 every VD reports every minute once the whole file is read.
OK_DIAGS = {"diag0", "diag303"}
MAX_LANE_VPM = 50  # veh per lane per minute (3,000 veh/h/lane is physically impossible)
MIN_MINUTES = 5  # valid minutes a lane needs in every 15-minute bin to be used that day
ABNORMAL_DAY = 0.75  # a day whose mean peak V/C is below 75 % of the median day is left out
RULES = [
    "VD 狀態碼（Status）不是 0 的紀錄捨棄；同一 VD 同一分鐘重複的紀錄只留一筆",
    "車道診斷碼（ErrorDiags）含 diag0、diag303 以外代碼的車道分鐘捨棄（diag102/106 為缺值 −99、diag201/203/205 有車數但車速與佔有率為 0、"
    "diag202 有車速但車數為 0、diag107 只和時間戳異常一起出現）；diag303 是整支 VD 整天被標記，實測流量、車速、佔有率和同一車道"
    "未標記的日子一致，所以保留",
    f"單一車道每分鐘超過 {MAX_LANE_VPM} 輛（3,000 輛/時）視為異常值捨棄",
    f"車道當天要在 10 個時段都至少有 {MIN_MINUTES} 分鐘有效資料、且晨峰期間有車通過，才算有效車道",
    "VD 當天的有效車道要達靜態車道數的一半以上，否則當天不用",
    "流量 = 有效分鐘的平均車數 × 60（資料為每分鐘車數）；V/C = 有效車道流量 ÷（有效車道數 × 每車道容量）",
    "部分車道無效時，以有效車道的 V/C 乘上全斷面容量（靜態車道數）推估該 VD 流量",
    "只用每個採用日都有效的 VD（固定樣本），各天、各時段才可比較；內湖 V/C 為各 VD 等權平均",
    f"晨峰平均 V/C 低於中位數 {int(ABNORMAL_DAY * 100)}% 的日子視為異常（假日、颱風、資料中斷），不納入平均",
]

RE_T = re.compile(rb'"DataCollectTime"\s*:\s*"([^"]+)"')
RE_ID = re.compile(rb'"VDID"\s*:\s*"([^"]+)"')


def _utc(day: date, hm: str) -> str:
    """Taipei wall time on `day` -> TDX UTC timestamp string ('2026-10-12T23:00:00+00:00')."""
    h, m = map(int, hm.split(":"))
    t = datetime(day.year, day.month, day.day, h, m, tzinfo=TPE)
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def weekdays_back(n: int, today: date | None = None) -> list[date]:
    """The last n working weekdays before today (a day's archive is published the next morning)."""
    d = today or now_tpe().date()
    out = []
    while len(out) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in HOLIDAYS:
            out.append(d)
    return out


def path_for(day: date):
    return DIR / f"{NAME}_{day:%Y%m%d}.ndjson.gz", DIR / f"{NAME}_{day:%Y%m%d}.meta.json"


def _day_of(p) -> str:
    """vd_hist_20261013.ndjson.gz -> '2026-10-13'"""
    d = p.name.split("_")[-1].split(".")[0]
    return f"{d[:4]}-{d[4:6]}-{d[6:]}"


def neihu_vds() -> dict[str, dict]:
    from .live import TrafficContext
    return {k: v for k, v in TrafficContext().vd.items() if v["neihu"]}


# ---------------------------------------------------------------- fetch
def fetch_day(day: date, ids: set[str]) -> dict:
    """Stream one whole day of TDX historical VD and keep 內湖 records inside KEEP. Writes files only on success."""
    url = f"{HIST_URL}?Dates={day:%Y-%m-%d}&$format=JSON"
    k0, k1 = _utc(day, KEEP[0]), _utc(day, KEEP[1])
    for _ in range(4):
        _throttle(url)
        r = requests.get(url, headers={**UA, "Authorization": f"Bearer {tdx_token()}", "Accept-Encoding": "gzip"},
                         stream=True, timeout=(30, 300))
        if r.status_code == 429:
            r.close()
            time.sleep(float(r.headers.get("Retry-After", 30)) + 1)
            continue
        r.raise_for_status()
        break
    else:
        raise RuntimeError("still rate limited after 4 tries")

    t0 = time.time()
    kept = []
    lines = nbytes = late = 0
    max_t, first_t, max_lag, kept_lag = "", None, 0.0, 0.0
    try:
        for line in r.iter_lines(chunk_size=1 << 16):
            if not line:
                continue
            lines += 1
            nbytes += len(line)
            m = RE_T.search(line)
            if not m:
                continue
            t = m.group(1).decode()
            first_t = first_t or t
            lag = 0.0
            if t > max_t:
                max_t = t
            elif t < max_t:  # out of order: minutes behind the newest record seen so far
                lag = (datetime.fromisoformat(max_t) - datetime.fromisoformat(t)).total_seconds() / 60
                max_lag = max(max_lag, lag)
                late += lag > 2
            if k0 <= t < k1:
                mi = RE_ID.search(line)
                if mi and mi.group(1).decode() in ids:
                    kept.append(line.lstrip(b"\xef\xbb\xbf"))
                    kept_lag = max(kept_lag, lag)
    finally:
        r.close()

    if not kept:
        raise RuntimeError(f"no 內湖 records between {KEEP[0]} and {KEEP[1]} (archive not published yet?)")
    times = sorted(RE_T.search(x).group(1).decode() for x in kept)
    if times[0] > _utc(day, "07:05") or times[-1] < _utc(day, "09:25"):
        raise RuntimeError(f"window not covered ({times[0]} .. {times[-1]})")

    body = gzip.compress(b"\n".join(kept) + b"\n")
    data_p, meta_p = path_for(day)
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = data_p.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(data_p)
    meta = dict(
        name=f"{NAME}_{day:%Y%m%d}", source="tdx", title=TITLE, agency="交通部", problems=[4],
        source_url=url, fetched_at=now_tpe().isoformat(timespec="seconds"), record_count=len(kept), bytes=len(body),
        is_mock=False, date=day.isoformat(),
        filter=f"內湖區 {len(ids)} 支 VD，台北時間 {KEEP[0]}–{KEEP[1]}（依 DataCollectTime）；API 不支援 $filter，在本機篩選",
        vd_found=len({RE_ID.search(x).group(1) for x in kept}),
        scan=dict(lines_read=lines, bytes_read=nbytes, seconds=round(time.time() - t0, 1), first_time=first_t, last_time=max_t,
                  late_records=late, max_lag_min=round(max_lag, 1), kept_max_lag_min=round(kept_lag, 1)),
    )
    meta_p.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    return meta


def write_summary() -> dict | None:
    metas = [json.loads(p.read_text()) for p in sorted(DIR.glob(f"{NAME}_2*.meta.json"))]
    if not metas:
        return None
    dates = [m["date"] for m in metas]
    s = dict(
        name=NAME, source="tdx", title=TITLE, agency="交通部", problems=[4],
        source_url=f"{HIST_URL}?Dates={{YYYY-MM-DD}}&$format=JSON",
        fetched_at=max(m["fetched_at"] for m in metas), record_count=sum(m["record_count"] for m in metas),
        bytes=sum(m["bytes"] for m in metas), is_mock=False, dates=dates,
        period=f"{dates[0]}～{dates[-1]} 平日 {KEEP[0]}–{KEEP[1]}（{len(dates)} 天）",
        skipped_holidays=sorted(h for h in HOLIDAYS if dates[0] <= h <= dates[-1]),
        note="每天一檔，只存內湖區 VD 晨峰前後的原始紀錄；歷史資料不會變，已存的日期不重抓",
    )
    (DIR / f"{NAME}.meta.json").write_text(json.dumps(s, ensure_ascii=False, indent=1))
    return s


def fetch(days: list[date], log=print) -> list[str]:
    ids = set(neihu_vds())
    out = []
    for d in sorted(days):
        data_p, meta_p = path_for(d)
        if data_p.exists() and meta_p.exists():
            out.append(f"  skip {d} (cached)")
        else:
            try:
                m = fetch_day(d, ids)
                sc = m["scan"]
                out.append(f"  ok   {d} {m['record_count']:,} records, {m['vd_found']} VD; read {sc['lines_read']:,} lines "
                           f"({sc['bytes_read'] / 1e6:,.0f} MB) in {sc['seconds']}s; late {sc['late_records']:,} "
                           f"(max lag {sc['max_lag_min']} min, kept records {sc['kept_max_lag_min']} min)")
            except Exception as e:  # nothing written for this day; older files untouched
                out.append(f"  FAIL {d}: {e}")
        log(out[-1])
    write_summary()
    return out


# ---------------------------------------------------------------- aggregate
def _bin_of(t_utc: str) -> int:
    t = datetime.fromisoformat(t_utc).astimezone(TPE)
    m = t.hour * 60 + t.minute - 7 * 60
    return m // 15 if 0 <= m < 15 * len(BINS) else -1


def read_day(path, vds: dict[str, dict]):
    """cells[vid][lane][bin] -> [(volume, speed)] valid lane-minutes; lanes[vid] -> lanes reported in the window."""
    cells = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    lanes = defaultdict(set)
    seen = set()
    st = dict(records=0, status=0, dup=0, lane_minutes=0, diag=0, outlier=0)
    with gzip.open(path, "rb") as f:
        for line in f:
            rec = json.loads(line)
            vid, t = rec["VDID"], rec["DataCollectTime"]
            b = _bin_of(t) if vid in vds else -1
            if b < 0:
                continue
            st["records"] += 1
            if (vid, t[:16]) in seen:
                st["dup"] += 1
                continue
            seen.add((vid, t[:16]))
            if rec.get("Status", 0) != 0:
                st["status"] += 1
                continue
            for lf in rec.get("LinkFlows") or []:
                for ln in lf.get("Lanes") or []:
                    lane = (lf.get("LinkID"), ln.get("LaneID"))
                    lanes[vid].add(lane)
                    st["lane_minutes"] += 1
                    if not set(ln.get("ErrorDiags") or ["diag0"]) <= OK_DIAGS:
                        st["diag"] += 1
                        continue
                    vol = sum(v.get("Volume") or 0 for v in ln.get("Vehicles") or [])
                    if not 0 <= vol <= MAX_LANE_VPM:
                        st["outlier"] += 1
                        continue
                    spd = ln.get("Speed") or 0
                    cells[vid][lane][b].append((vol, spd if 0 < spd <= 150 else 0))
    # completeness: VD-minutes of the 07:00–09:30 window with no record, over the VDs that reported at all
    st["expected"] = len({v for v, _ in seen}) * 15 * len(BINS)
    st["missing"] = st["expected"] - len(seen)
    return cells, lanes, st


def aggregate_day(path, vds: dict[str, dict], cap_per_lane: dict[str, float]) -> dict:
    """One cached day -> per VD and 15-minute bin: V/C, cross-section flow (veh/h), volume-weighted speed (km/h)."""
    cells, lanes, st = read_day(path, vds)
    nb = len(BINS)
    per_vd, rejected = {}, {}
    for vid, meta in vds.items():
        if not lanes.get(vid):
            rejected[vid] = "no records"
            continue
        ok = [ln for ln in sorted(lanes[vid]) if all(len(cells[vid][ln][b]) >= MIN_MINUTES for b in range(nb))
              and sum(v for b in range(nb) for v, _ in cells[vid][ln][b]) > 0]
        if 2 * len(ok) < meta["lanes"]:
            rejected[vid] = f"valid lanes {len(ok)}/{meta['lanes']}"
            continue
        cpl = cap_per_lane.get(meta["cls"], 900.0)
        flow, speed, vc = [], [], []
        for b in range(nb):
            f = sum(60.0 * np.mean([v for v, _ in cells[vid][ln][b]]) for ln in ok)  # valid lanes only
            vs = [(v, s) for ln in ok for v, s in cells[vid][ln][b] if v > 0 and s > 0]
            vc.append(f / (cpl * len(ok)))
            flow.append(vc[-1] * cpl * meta["lanes"])  # whole cross-section (static lanes), same capacity as live.py
            speed.append(sum(v * s for v, s in vs) / sum(v for v, _ in vs) if vs else None)
        per_vd[vid] = dict(flow=flow, speed=speed, vc=vc, cap=cpl * meta["lanes"], lanes_ok=len(ok),
                           lanes_data=len(lanes[vid]), lanes_static=meta["lanes"])
    return dict(per_vd=per_vd, rejected=rejected, stats=st)


def _summarize(a: dict, vids: list[str]) -> dict:
    """內湖 totals per bin over a fixed VD set: total flow, mean V/C (each VD weight 1), flow-weighted V/C and speed."""
    out = dict(flow=[], vc=[], vc_fw=[], speed=[])
    for b in range(len(BINS)):
        f = np.array([a["per_vd"][v]["flow"][b] for v in vids])
        c = np.array([a["per_vd"][v]["vc"][b] for v in vids])
        s = [(a["per_vd"][v]["flow"][b], a["per_vd"][v]["speed"][b]) for v in vids if a["per_vd"][v]["speed"][b]]
        out["flow"].append(float(f.sum()))
        out["vc"].append(float(c.mean()))
        out["vc_fw"].append(float(np.average(c, weights=np.maximum(f, 1))))
        out["speed"].append(sum(x * y for x, y in s) / sum(x for x, _ in s) if s else None)
    return out


def _r(xs, nd):
    return [None if x is None else (round(x) if nd == 0 else round(float(x), nd)) for x in xs]


def profile(days: int = DAYS, vds: dict[str, dict] | None = None, cap_per_lane: dict[str, float] | None = None) -> dict | None:
    """Average the most recent `days` cached weekdays into the impact.json "4" profile; None when nothing is cached."""
    files = [p for p in sorted(DIR.glob(f"{NAME}_2*.ndjson.gz"))
             if _day_of(p) not in HOLIDAYS and date.fromisoformat(_day_of(p)).weekday() < 5][-days:]
    if not files:
        return None
    if cap_per_lane is None:
        from .live import CAP_PER_LANE as cap_per_lane
    vds = vds or neihu_vds()
    aggs = {_day_of(p): aggregate_day(p, vds, cap_per_lane) for p in files}

    # abnormal days: each day's mean peak V/C (over its own valid VDs) against the median day
    level = {d: float(np.mean(_summarize(a, list(a["per_vd"]))["vc"])) if a["per_vd"] else 0.0 for d, a in aggs.items()}
    med = float(np.median(list(level.values())))
    used = [d for d in aggs if level[d] >= ABNORMAL_DAY * med]

    def why(d):
        st = aggs[d]["stats"]
        if not aggs[d]["per_vd"]:  # nothing passed the completeness rules: a feed problem, not a quiet morning
            return (f"資料異常：晨峰 {st['missing'] / max(st['expected'], 1):.0%} 的 VD 分鐘沒有資料、"
                    f"{st['dup']:,} 筆時間戳重複，沒有 VD 通過完整度檢查")
        return f"晨峰平均 V/C 為中位數的 {level[d] / med:.0%}"
    excluded = {d: why(d) for d in aggs if d not in used}
    if not used:
        return None

    # fixed panel: VDs valid on every used day
    panel = sorted(set.intersection(*(set(aggs[d]["per_vd"]) for d in used)))
    if not panel:
        return None
    day_rows = {d: _summarize(aggs[d], panel) for d in used}

    def mean_days(key):
        return [float(np.mean([day_rows[d][key][b] for d in used])) for b in range(len(BINS))]

    vc, vc_fw, flow = mean_days("vc"), mean_days("vc_fw"), mean_days("flow")
    speed = [float(np.mean(xs)) if (xs := [day_rows[d]["speed"][b] for d in used if day_rows[d]["speed"][b]]) else None
             for b in range(len(BINS))]
    peak_vc = max(vc)
    vd_vc, vd_cap, vd_speed = {}, {}, {}
    for v in panel:
        rows = [aggs[d]["per_vd"][v] for d in used]
        vd_vc[v] = _r([np.mean([r["vc"][b] for r in rows]) for b in range(len(BINS))], 3)
        vd_cap[v] = round(rows[0]["cap"])
        vd_speed[v] = _r([np.mean(xs) if (xs := [r["speed"][b] for r in rows if r["speed"][b]]) else None
                          for b in range(len(BINS))], 1)

    rejected = defaultdict(dict)
    for d in used:
        for v, why in aggs[d]["rejected"].items():
            rejected[v][d] = why
    partial = sorted({v for d in used for v in panel if aggs[d]["per_vd"][v]["lanes_ok"] < vds[v]["lanes"]})
    return dict(
        bins=BINS,
        vc=_r(vc, 4),
        mult=_r([x / peak_vc for x in vc], 4),
        peak_vc=round(peak_vc, 4),
        vc_fw=_r(vc_fw, 4),
        flow=_r(flow, 0),
        speed=_r(speed, 1),
        days=[dict(date=d, vc=_r(day_rows[d]["vc"], 4), flow=_r(day_rows[d]["flow"], 0), speed=_r(day_rows[d]["speed"], 1))
              for d in used],
        vd_vc=vd_vc,
        vd_cap=vd_cap,
        vd_speed=vd_speed,
        source=f"TDX 歷史 VD，{used[0]}～{used[-1]} 共 {len(used)} 個平日（內湖區 {len(panel)} 支 VD，逐分鐘資料彙整為 15 分鐘）",
        period=f"{used[0]}～{used[-1]}",
        quality=dict(
            rules=RULES,
            vd_total=len(vds),
            vd_panel=len(panel),
            vd_valid_per_day={d: len(a["per_vd"]) for d, a in aggs.items()},
            vd_rejected={v: rejected[v] for v in sorted(rejected)},
            vd_partial_lanes=partial,
            dropped_per_day={d: a["stats"] for d, a in aggs.items()},  # records / lane-minutes seen and dropped per rule
            excluded_days=excluded,
            skipped_holidays=sorted(h for h in HOLIDAYS if used[0] <= h <= used[-1]),
        ),
    )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=DAYS, help="most recent N working weekdays")
    ap.add_argument("--dates", help="comma separated YYYY-MM-DD instead of --days")
    ap.add_argument("--summary", action="store_true", help="only aggregate the cached days")
    a = ap.parse_args(argv)
    if not a.summary:
        days = [date.fromisoformat(x) for x in a.dates.split(",")] if a.dates else weekdays_back(a.days)
        fetch(days, log=lambda s: print(s, flush=True))
    p = profile(days=a.days)
    if p is None:
        print("no cached history")
        return 1
    print(p["source"])
    print("bins   ", " ".join(f"{b:>6}" for b in p["bins"]))
    print("vc     ", " ".join(f"{x:6.3f}" for x in p["vc"]))
    print("vc_fw  ", " ".join(f"{x:6.3f}" for x in p["vc_fw"]))
    print("speed  ", " ".join(f"{x:6.1f}" if x is not None else "     -" for x in p["speed"]))
    print("flow   ", " ".join(f"{x:6d}" for x in p["flow"]))
    q = p["quality"]
    print("peak_vc", p["peak_vc"], "| panel", q["vd_panel"], "of", q["vd_total"], "| valid VD/day", q["vd_valid_per_day"])
    print("excluded days", q["excluded_days"], "| partial-lane VDs", q["vd_partial_lanes"])
    print("rejected", q["vd_rejected"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
