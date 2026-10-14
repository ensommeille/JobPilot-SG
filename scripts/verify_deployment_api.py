"""Exercise a disposable local deployment; never contacts an employer or model.

Requires an explicitly synthetic, source-backed recommendation fixture already in
the test database. Test accounts remain available for subsequent browser checks.
"""

import argparse
import base64
import hashlib
import json
import re
import secrets
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID


class NoRedirect(HTTPRedirectHandler):
    """Never forward an acceptance credential to another location."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def local_origin(value):
    """Accept only an explicit loopback origin, with no URL decorations."""
    parsed = urlsplit(value)
    if (
        value != value.strip()
        or any(ord(char) < 32 for char in value)
        or parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.port is None
        or not 1 <= parsed.port <= 65535
    ):
        raise ValueError("Use an HTTP localhost or 127.0.0.1 origin with an explicit port only")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:18200")
    parser.add_argument("--web-origin", default="http://127.0.0.1:15173")
    parser.add_argument("--fixture-job-id", required=True)
    parser.add_argument("--extension-client-id", required=True)
    parser.add_argument("--allow-test-writes", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("output/deployment-acceptance"))
    args = parser.parse_args()
    if not args.allow_test_writes:
        parser.error("Requires --allow-test-writes for the disposable local test database")
    try:
        args.api = local_origin(args.api)
        args.web_origin = local_origin(args.web_origin)
        args.fixture_job_id = str(UUID(args.fixture_job_id))
    except ValueError as error:
        parser.error(str(error))
    if not re.fullmatch("[a-p]{32}", args.extension_client_id):
        parser.error("Invalid Chrome extension client ID")
    opener = build_opener(NoRedirect())
    checks = []

    def request(method, path, body=None, token=None, status=200, extra_headers=None):
        headers = {"Content-Type": "application/json", **(extra_headers or {})}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        item = Request(
            args.api.rstrip("/") + path,
            method=method,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            response = opener.open(item, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            assert response.status == status, (
                f"{method} {path}: {response.status}, expected {status}"
            )
            payload = response.read()
            return json.loads(payload) if payload else None

    for path in ("/", "/profile", "/jobs", f"/jobs/{args.fixture_job_id}"):
        with opener.open(args.web_origin + path, timeout=15) as page:
            html = page.read().decode()
            assert page.status == 200 and '<div id="root">' in html
    asset = re.search(r'<script[^>]+src="(/assets/[^\"]+\.js)"', html)
    assert asset, "Built frontend JavaScript was not found"
    with opener.open(args.web_origin + asset.group(1), timeout=15) as bundle:
        assert args.api in bundle.read().decode(), "Frontend contains the wrong built API address"
    preflight = Request(
        args.api + "/profile",
        method="OPTIONS",
        headers={
            "Origin": args.web_origin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    with opener.open(preflight, timeout=15) as response:
        assert response.status == 200
        assert response.headers["Access-Control-Allow-Origin"] == args.web_origin
    checks.append("Nginx SPA fallback, compiled API address and CORS preflight")
    request("GET", "/health")
    fixture = request("GET", f"/jobs/{args.fixture_job_id}")
    assert fixture["title"].startswith("ACCEPTANCE ONLY"), "Refuse a non-test fixture"
    checks.append("health and explicitly synthetic job readable")
    accounts = []

    def new_account(suffix):
        email = f"acceptance-{secrets.token_hex(6)}-{suffix}@example.com"
        password = secrets.token_urlsafe(24)
        request("POST", "/auth/register", {"email": email, "password": password}, status=201)
        logged = request("POST", "/auth/login", {"email": email, "password": password})
        accounts.append({"email": email, "password": password})
        return logged["access_token"]

    first = new_account("a")
    second = new_account("b")
    profile = {
        "full_name": "Fictional Clean Deployment Applicant",
        "contact_email": "acceptance-contact@example.com",
        "phone": "+65 8000 0000",
        "education": "Fictional computing course",
        "experience": "Fictional student project",
        "skills": ["I used Microsoft Excel to prepare weekly sales reports."],
        "links": {},
        "resume_summary": "My own fictional introduction.",
        "availability_period": "January to March 2027",
        "nationality": "cn",
        "study_country": "sg",
    }
    request("PUT", "/profile", profile, first)
    saved = request("GET", "/profile", token=first)
    assert all(saved[field] == value for field, value in profile.items())
    checks.append("register/login/profile save/read on PostgreSQL")
    report = request("POST", "/jobs/recommendations", {}, first)
    assert report["status"] == "ready"
    match = next(item for item in report["items"] if item["job_id"] == args.fixture_job_id)
    assert match["supported"] == [] and match["overlaps"]
    assert match["overlaps"][0]["profile_evidence"] == profile["skills"][0]
    assert request("POST", "/jobs/recommendations", {}, second)["status"] == "profile_needed"
    request("POST", "/jobs/recommendations", {}, status=401)
    checks.append("natural-language overlap is partial, private and source-backed")
    verifier = secrets.token_urlsafe(32)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    grant = request(
        "POST",
        "/auth/extension/authorize",
        {
            "client_id": args.extension_client_id,
            "challenge": challenge,
            "confirmed": True,
        },
        first,
        extra_headers={"Origin": args.web_origin},
    )
    exchange = {"client_id": args.extension_client_id, "code": grant["code"], "verifier": verifier}
    session = request("POST", "/auth/extension/exchange", exchange)
    extension = session["access_token"]
    request("POST", "/auth/extension/exchange", exchange, status=401)
    request("GET", "/profile", token=extension, status=401)
    fields = [
        "applicant_name",
        "applicant_email",
        "applicant_contact",
        "applicant_period",
        "applicant_summary",
    ]

    def draft(job_number, token=extension):
        return request(
            "POST",
            "/browser-assistant/draft",
            {
                "page_url": f"https://www.internsg.com/job-apply/{job_number}/",
                "field_ids": fields,
            },
            token,
        )

    for job_number in (271036, 271037):
        result = draft(job_number)
        assert result["values"]["applicant_contact"] == profile["phone"]
        assert result["values"]["applicant_summary"] == profile["resume_summary"]
        assert result["countries"] == {"nationality": "cn", "campus": "sg"}
        assert result["submission_supported"] is False and result["requires_review"] is True
    checks.append("PKCE single-use grant, restricted session, two-job draft reuse")
    changed = {
        **profile,
        "phone": "+65 8111 1111",
        "resume_summary": "Revised fictional introduction.",
        "skills": ["I use Python for coursework."],
    }
    request("PUT", "/profile", changed, first)
    assert draft(271038)["values"]["applicant_contact"] == changed["phone"]
    assert request("POST", "/jobs/recommendations", {}, first)["status"] == "no_matches"
    cleared = {
        **changed,
        "phone": None,
        "resume_summary": None,
        "availability_period": None,
        "nationality": None,
        "study_country": None,
        "skills": [],
    }
    request("PUT", "/profile", cleared, first)
    result = draft(271039)
    assert set(result["values"]) == {"applicant_name", "applicant_email"}
    assert result["countries"] == {"nationality": None, "campus": None}
    assert request("POST", "/jobs/recommendations", {}, first)["status"] == "profile_needed"
    checks.append("updated/cleared profile immediately replaces reuse values without reconnect")
    assert request("GET", "/profile", token=second)["resume_summary"] is None
    request("POST", "/auth/logout", token=first, status=204)
    request("GET", "/auth/extension/session", token=extension, status=401)
    request("GET", "/profile", token=first, status=401)
    request("GET", "/profile", token=second)
    checks.append("logout revokes old extension and isolates the other account")
    # Restore the fictional profile by signing in, for subsequent manual browser checks.
    first = request("POST", "/auth/login", accounts[0])["access_token"]
    request("PUT", "/profile", profile, first)
    history = request("GET", "/applications", token=first)
    assert not (history.get("items", []) if isinstance(history, dict) else history)
    checks.append("no application record created; no employer or model request made")
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "test-credentials.json").write_text(
        json.dumps(accounts, indent=2), encoding="utf-8"
    )
    result = {
        "api": args.api,
        "fixture_job_id": args.fixture_job_id,
        "synthetic_fixture": True,
        "checks": checks,
        "passed": len(checks),
        "model_calls": 0,
        "employer_submissions": 0,
    }
    (args.output / "api-report.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
