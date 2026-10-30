"""Verify an explicitly selected HTTPS demo with optional synthetic account writes.

Passwords and tokens stay in memory. No employer submission or model call is made.
"""

import argparse
import json
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--allow-test-writes", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    parsed = urlsplit(args.base_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        parser.error("Use a plain HTTPS deployment origin")
    origin = args.base_url.rstrip("/")
    opener = build_opener(NoRedirect())
    checks = []

    def request(method, path, body=None, token=None, expected=200):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(
            origin + path,
            method=method,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            response = opener.open(req, timeout=30)
        except HTTPError as error:
            response = error
        with response:
            if response.status != expected:
                raise RuntimeError(f"{method} {path}: {response.status}, expected {expected}")
            raw = response.read()
            return raw, response.headers

    for path in ("/", "/jobs", "/profile"):
        raw, _ = request("GET", path)
        assert b'id="root"' in raw, f"SPA document missing: {path}"
    asset = re.search(r'<script[^>]+src="(/assets/[^\"]+\.js)"', raw.decode())
    assert asset, "Built frontend bundle missing"
    bundle, bundle_headers = request("GET", asset.group(1))
    assert bundle and "javascript" in bundle_headers.get("Content-Type", "")
    checks.append("Trusted HTTPS, built frontend entry bundle and SPA deep links")
    health, headers = request("GET", "/api/health")
    assert json.loads(health) == {"status": "ok"}
    assert headers.get("X-Content-Type-Options") == "nosniff"
    jobs, _ = request("GET", "/api/jobs?page=1&page_size=5")
    jobs = json.loads(jobs)
    assert isinstance(jobs["items"], list)
    checks.append("API health, security header and public jobs endpoint through HTTPS ingress")
    request("GET", "/api/profile", expected=401)
    checks.append("Unauthenticated private profile rejected")

    if args.allow_test_writes:
        accounts = []
        for _ in range(2):
            credentials = {
                "email": f"cloud-smoke-{secrets.token_hex(8)}@example.com",
                "password": secrets.token_urlsafe(30),
            }
            registered, _ = request("POST", "/api/auth/register", credentials, expected=201)
            logged, _ = request("POST", "/api/auth/login", credentials)
            token = json.loads(logged)["access_token"]
            user, _ = request("GET", "/api/users/me", token=token)
            assert json.loads(user)["id"] == json.loads(registered)["id"]
            accounts.append(token)
        marker = f"Fictional Cloud Smoke {secrets.token_hex(6)}"
        request("PUT", "/api/profile", {"full_name": marker, "skills": ["Python"]}, accounts[0])
        saved, headers = request("GET", "/api/profile", token=accounts[0])
        assert json.loads(saved)["full_name"] == marker
        assert headers.get("Cache-Control") == "no-store"
        other, _ = request("GET", "/api/profile", token=accounts[1])
        assert json.loads(other)["full_name"] != marker
        checks.append("Two synthetic registrations, login, identity and private profile isolation")

    result = {
        "checkedAtUtc": datetime.now(UTC).isoformat(),
        "baseUrl": origin,
        "passed": True,
        "testWrites": args.allow_test_writes,
        "checks": checks,
        "visibleJobCount": len(jobs["items"]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
