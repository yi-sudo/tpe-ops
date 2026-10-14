"""Keep the live feeds fresh for the dashboard.

Each live source in sources.py is fetched on its own `interval`, saved as a raw snapshot
(CLAUDE.md 資料快取規則), then dashboard/public/data/live/*.json is rebuilt from the latest snapshots.
A failed fetch keeps the previous files; the failure is shown in live/status.json.

    .venv/bin/python -m pipeline.collect_live              # run until Ctrl-C
    .venv/bin/python -m pipeline.collect_live --once       # one round, then exit
    .venv/bin/python -m pipeline.collect_live --keep-days 3
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import timedelta

from . import live
from .common import RAW, now_tpe
from .fetch import fetch_one
from .sources import SOURCES


def prune_live(src: dict, keep_days: float) -> int:
    """Delete raw live snapshots older than keep_days (the series in live/ keep the history)."""
    cutoff = (now_tpe() - timedelta(days=keep_days)).strftime("%Y%m%d-%H%M")
    gone = 0
    for p in (RAW / src["source"]).glob(f"{src['key']}_2*.{src['ext']}"):
        stamp = p.name[len(src["key"]) + 1:].split(".")[0]
        if stamp < cutoff:
            p.unlink()
            gone += 1
    return gone


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--keep-days", type=float, default=3.0, help="raw live snapshots older than this are deleted")
    a = ap.parse_args(argv)

    feeds = [s for s in SOURCES if s.get("live")]
    state = {s["key"]: dict(title=s["title"], interval=s["interval"], last_ok=None, last_error=None, error=None, next_at=0.0)
             for s in feeds}
    ctx = live.TrafficContext()
    plan = ", ".join(f"{s['key']}/{s['interval']}s" for s in feeds)
    print(f"collect_live: {plan}", flush=True)

    last_prune = 0.0
    while True:
        due = [s for s in feeds if time.time() >= state[s["key"]]["next_at"]]
        for s in due:
            st = state[s["key"]]
            st["next_at"] = time.time() + s["interval"]
            try:
                fetch_one(s)
                st["last_ok"] = now_tpe().isoformat(timespec="seconds")
                st["error"] = None
            except Exception as e:  # keep old files, report in status.json
                st["last_error"] = now_tpe().isoformat(timespec="seconds")
                st["error"] = str(e)[:200]
                print(f"  FAIL {s['key']}: {e}", flush=True)
        if due:
            live.write_all(ctx, series=True)
            live.status({k: {**v, "next_at": None} for k, v in state.items()})
            ok = [s["key"] for s in due if not state[s["key"]]["error"]]
            print(f"{now_tpe():%H:%M:%S} updated {', '.join(ok) or '-'}", flush=True)
        if time.time() - last_prune > 3600:
            for s in feeds:
                prune_live(s, a.keep_days)
            last_prune = time.time()
        if a.once:
            return 0
        time.sleep(5)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
