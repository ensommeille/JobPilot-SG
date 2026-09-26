"""Real InternSG parsing through M2 persistence and public APIs, without network."""

import httpx
import pytest
from sqlalchemy import select

from app.db.models import User, UserRole
from app.ingestion.internsg_adapter import InternSGAdapter, default_internsg_config
from app.ingestion.service import get_source_adapter_factory
from app.main import app


@pytest.mark.parametrize("failure_mode", ["invalid_html", "unavailable", "robots_denied"])
def test_real_adapter_database_round_trip(client, db, fixture_text, failure_mode):
    credentials = {"email": "pipeline@example.com", "password": "OfflinePipelinePassword123!"}
    assert client.post("/auth/register", json=credentials).status_code == 201
    user = db.scalar(select(User).where(User.email == credentials["email"]))
    user.role = UserRole.ADMIN
    db.commit()
    token = client.post("/auth/login", json=credentials).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post(
        "/sources",
        headers=headers,
        json={
            "name": "InternSG offline acceptance",
            "source_type": "html",
            "base_url": "https://www.internsg.com",
            "enabled": True,
        },
    )
    assert response.status_code == 201
    source_id = response.json()["id"]
    state = {"html": fixture_text("detail_complete.html"), "fail": False}
    requested = []

    def transport(request):
        assert request.url.host == "www.internsg.com"
        requested.append(request.url.path)
        if request.url.path == "/robots.txt":
            denied = state["fail"] and failure_mode == "robots_denied"
            return httpx.Response(
                200, text="User-agent: *\nDisallow: /" if denied else "User-agent: *\nAllow: /"
            )
        if request.url.path == "/jobs/":
            return httpx.Response(
                200, text=fixture_text("listing.html"), headers={"Content-Type": "text/html"}
            )
        assert request.url.path == "/job/example-one/"
        if state["fail"] and failure_mode == "unavailable":
            return httpx.Response(503)
        html = fixture_text("detail_invalid.html") if state["fail"] else state["html"]
        return httpx.Response(200, text=html, headers={"Content-Type": "text/html"})

    with httpx.Client(transport=httpx.MockTransport(transport)) as http_client:

        def factory(source):
            config = default_internsg_config().model_copy(
                update={
                    "source_id": str(source.id),
                    "retry_count": 0,
                }
            )
            return InternSGAdapter(config, client=http_client, sleep=lambda _: None)

        app.dependency_overrides[get_source_adapter_factory] = lambda: factory
        try:

            def run():
                result = client.post(
                    f"/sources/{source_id}/run",
                    headers=headers,
                    json={"max_links": 1, "max_details": 1},
                )
                assert result.status_code == 201
                return result.json()

            first = run()
            assert first["status"] == "succeeded", first["error_summary"]
            assert first["items_new"] == 1
            page = client.get("/jobs").json()
            assert page["total"] == 1
            job = page["items"][0]
            job_id = job["id"]
            assert job["source"]["id"] == source_id
            assert job["title"] == "Software Engineer Intern"
            assert job["salary_min"] == 1000
            assert job["salary_max"] == 1500
            assert job["posted_at"] == "2026-08-24"
            assert "reliable service" in job["description"]
            assert job["source_url"] == "https://www.internsg.com/job/example-one/"
            extracted = client.post(f"/jobs/{job_id}/extractions", headers=headers, json={})
            assert extracted.status_code == 201
            extraction_id = extracted.json()["id"]
            assert extracted.json()["result"]["execution_mode"] == "mock"
            assert client.post(f"/jobs/{job_id}/favorite", headers=headers).status_code == 201

            second = run()
            assert second["items_new"] == second["items_updated"] == 0
            state["html"] = state["html"].replace("reliable service", "reliable Python service")
            third = run()
            assert third["items_updated"] == 1
            updated = client.get(f"/jobs/{job_id}").json()
            assert "Python service" in updated["description"]
            assert (
                client.get(f"/extractions/{extraction_id}", headers=headers).json()["is_stale"]
                is True
            )
            favorites = client.get("/favorites", headers=headers).json()
            assert favorites["total"] == 1
            assert favorites["items"][0]["job"]["id"] == job_id

            state["fail"] = True
            failed = run()
            assert failed["status"] == "failed"
            assert failed["items_failed"] >= 1
            assert client.get("/jobs").json()["total"] == 1
            assert client.get(f"/jobs/{job_id}").json()["description"] == updated["description"]
            assert client.get("/runs", headers=headers).json()["total"] == 4
        finally:
            app.dependency_overrides.pop(get_source_adapter_factory, None)
    assert "/robots.txt" in requested
