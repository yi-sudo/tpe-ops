"""Check a TDX API key: get an access token and call one Taipei bus endpoint.

Usage:
    python3 tdx_check.py   # reads TDX_CLIENT_ID / TDX_CLIENT_SECRET from env or .env
"""
import json
import os
import urllib.parse
import urllib.request

TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
TEST_URL = "https://tdx.transportdata.tw/api/basic/v2/Bus/Route/City/Taipei?$top=1&$format=JSON"


def load_env(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")):
    if os.path.exists(path):
        for line in open(path):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v)


def get_token():
    load_env()
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": os.environ["TDX_CLIENT_ID"],
        "client_secret": os.environ["TDX_CLIENT_SECRET"],
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


if __name__ == "__main__":
    token = get_token()
    req = urllib.request.Request(TEST_URL, headers={"Authorization": f"Bearer {token}", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=30) as r:
        print("OK", r.status)
        print(json.dumps(json.load(r), ensure_ascii=False)[:500])
