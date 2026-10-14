"""Shared helpers for fetching and caching raw data.

Every fetch writes three things under data/raw/{source}/ (see CLAUDE.md 資料快取規則):
  {name}_{YYYYMMDD-HHMM}.{ext}   timestamped snapshot
  {name}_latest.{ext}            copy of the newest successful snapshot
  {name}.meta.json               source_url, fetched_at, record_count, is_mock, ...
A failed fetch never touches existing files.
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / ".cache"
TPE = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (taipei_gogo data pipeline)"}

# minimum seconds between requests to the same host
HOST_INTERVAL = {
    "tdx.transportdata.tw": 13.0,  # 5 requests / minute
    "data.taipei": 0.5,
}
_last_hit: dict[str, float] = {}


def now_tpe() -> datetime:
    return datetime.now(TPE)


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)


def _throttle(url: str) -> None:
    host = url.split("/")[2]
    gap = HOST_INTERVAL.get(host, 0.3)
    wait = _last_hit.get(host, 0) + gap - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_hit[host] = time.time()


def http_get(url: str, headers: dict | None = None, timeout: int = 120, retries: int = 3) -> bytes:
    last = None
    for attempt in range(retries):
        _throttle(url)
        try:
            r = requests.get(url, headers={**UA, **(headers or {})}, timeout=timeout)
            if r.status_code == 429:
                time.sleep(float(r.headers.get("Retry-After", 20)) + 1)
                continue
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries} tries: {url}: {last}")


# ---------------------------------------------------------------- TDX
def tdx_token() -> str:
    """Return a cached TDX access token (valid 24h), refreshing when close to expiry."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / "tdx_token.json"
    if cache.exists():
        c = json.loads(cache.read_text())
        if c.get("expires_at", 0) - time.time() > 600:
            return c["access_token"]
    load_env()
    r = requests.post(
        "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.environ["TDX_CLIENT_ID"],
            "client_secret": os.environ["TDX_CLIENT_SECRET"],
        },
        timeout=30,
    )
    r.raise_for_status()
    tok = r.json()
    cache.write_text(json.dumps({"access_token": tok["access_token"], "expires_at": time.time() + tok["expires_in"]}))
    os.chmod(cache, 0o600)
    return tok["access_token"]


def tdx_get(path: str) -> bytes:
    url = "https://tdx.transportdata.tw/api/basic" + path
    return http_get(url, headers={"Authorization": f"Bearer {tdx_token()}", "Accept-Encoding": "gzip"})


# ---------------------------------------------------------------- saving
def count_records(body: bytes, ext: str) -> int | None:
    try:
        data = gzip.decompress(body) if ext.endswith(".gz") else body
        if ext.startswith("json") or ext.startswith("geojson"):
            j = json.loads(data)
            if isinstance(j, list):
                return len(j)
            if isinstance(j, dict):
                if "features" in j:
                    return len(j["features"])
                for v in j.values():
                    if isinstance(v, list):
                        return len(v)
                    if isinstance(v, dict):
                        for vv in v.values():
                            if isinstance(vv, list):
                                return len(vv)
            return None
        if ext.startswith("csv"):
            for enc in ("utf-8-sig", "big5", "cp950"):
                try:
                    return max(data.decode(enc).count("\n") - 1, 0)
                except UnicodeDecodeError:
                    continue
    except Exception:
        return None
    return None


def save_raw(source: str, name: str, ext: str, body: bytes, meta: dict, keep_snapshot: bool = True) -> Path:
    d = RAW / source
    d.mkdir(parents=True, exist_ok=True)
    ts = now_tpe()
    latest = d / f"{name}_latest.{ext}"
    if keep_snapshot:
        snap = d / f"{name}_{ts:%Y%m%d-%H%M}.{ext}"
        snap.write_bytes(body)
        shutil.copyfile(snap, latest)
    else:
        latest.write_bytes(body)
    m = {
        "name": name,
        "source": source,
        "fetched_at": ts.isoformat(timespec="seconds"),
        "bytes": len(body),
        "record_count": count_records(body, ext),
        "is_mock": False,
        **meta,
    }
    (d / f"{name}.meta.json").write_text(json.dumps(m, ensure_ascii=False, indent=1))
    return latest


def prune_snapshots(source: str, name: str, ext: str, keep: int) -> None:
    """Keep only the newest `keep` timestamped snapshots of a static source."""
    snaps = sorted(p for p in (RAW / source).glob(f"{name}_2*.{ext}"))
    for p in snaps[:-keep]:
        p.unlink()
