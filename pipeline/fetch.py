"""Fetch sources into data/raw/ following the caching rules in CLAUDE.md.

    .venv/bin/python -m pipeline.fetch                 # all static sources older than 7 days
    .venv/bin/python -m pipeline.fetch --force         # refetch every static source
    .venv/bin/python -m pipeline.fetch --only bins,parks
    .venv/bin/python -m pipeline.fetch --live          # one snapshot of every live feed
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime

from .common import RAW, http_get, now_tpe, prune_snapshots, save_raw, tdx_get
from .sources import DT, SOURCES

STALE_DAYS = 7


def is_fresh(src: dict, name: str) -> bool:
    meta = RAW / src["source"] / f"{name}.meta.json"
    if not meta.exists():
        return False
    fetched = datetime.fromisoformat(json.loads(meta.read_text())["fetched_at"])
    return (now_tpe() - fetched).days < STALE_DAYS


def fetch_one(src: dict, force: bool = False) -> list[str]:
    """Fetch a source; returns list of log lines. Raises on failure (existing files untouched)."""
    live = src.get("live", False)
    base_meta = {k: src[k] for k in ("title", "agency", "problems") if k in src}
    out = []

    if src["kind"] == "tdx_hist":  # history never changes: only weekdays not cached yet are fetched, --force ignored
        from . import history
        out = history.fetch(history.weekdays_back(src["days"]), log=lambda s: None)
        bad = [x.strip() for x in out if x.lstrip().startswith("FAIL")]
        if bad:
            raise RuntimeError("; ".join(bad))
        return out

    if src["kind"] == "dt_multi":
        meta = json.loads(http_get(f"https://data.taipei/api/frontstage/tpeod/dataset.view?id={src['pid']}"))["payload"]
        res = [r for r in meta["resources"] if re.match(r"\d{4,5}", r["name"]) or re.search(r"\d{3}年\d{1,2}月", r["name"])]

        def period(r):  # 11509案件... -> 11509 ; 臺北市115年9月... -> 11509
            m = re.match(r"(\d{3})(\d{2})", r["name"])
            if m:
                return int(m.group(1) + m.group(2))
            m = re.search(r"(\d{3})年(\d{1,2})月", r["name"])
            return int(m.group(1)) * 100 + int(m.group(2)) if m else 0

        for r in sorted(res, key=period, reverse=True)[: src["count"]]:
            name = f"{src['key']}_{period(r)}"
            if not force and is_fresh(src, name):
                out.append(f"  skip {name} (fresh)")
                continue
            url = DT.format(pid=src["pid"], rid=r["rid"])
            body = http_get(url)
            save_raw(src["source"], name, src["ext"], body, {**base_meta, "source_url": url, "resource_name": r["name"], "period": period(r)})
            prune_snapshots(src["source"], name, src["ext"], keep=1)
            out.append(f"  ok   {name} {len(body):,}B")
        return out

    name = src["key"]
    if not live and not force and is_fresh(src, name):
        return [f"  skip {name} (fresh)"]
    if src["kind"] == "url":
        url = src["url"]
        body = http_get(url)
    elif src["kind"] == "dt":
        url = DT.format(pid=src["pid"], rid=src["rid"])
        body = http_get(url)
    elif src["kind"] == "tdx":
        url = "https://tdx.transportdata.tw/api/basic" + src["path"]
        body = tdx_get(src["path"])
    else:
        raise ValueError(src["kind"])
    if len(body) < 50:
        raise RuntimeError(f"suspiciously small response ({len(body)}B)")
    save_raw(src["source"], name, src["ext"], body, {**base_meta, "source_url": url, "live": live})
    if not live:
        prune_snapshots(src["source"], name, src["ext"], keep=2)
    return [f"  ok   {name} {len(body):,}B"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma separated source keys")
    ap.add_argument("--live", action="store_true", help="fetch live feeds instead of static sources")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)

    if a.only:
        keys = set(a.only.split(","))
        todo = [s for s in SOURCES if s["key"] in keys]
    else:
        todo = [s for s in SOURCES if bool(s.get("live")) == a.live]

    failed = 0
    for s in todo:
        t = time.time()
        print(f"[{s['key']}] {s['title']}", flush=True)
        try:
            for line in fetch_one(s, force=a.force):
                print(line, flush=True)
        except Exception as e:  # keep old files, continue with next source
            failed += 1
            print(f"  FAIL {e}", flush=True)
        print(f"  ({time.time() - t:.1f}s)", flush=True)
    print(f"done: {len(todo) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
