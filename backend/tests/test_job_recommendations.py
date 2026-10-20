"""Discovery is private, bounded and honest about coverage and unknowns."""

from copy import deepcopy
from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select

from app.db.models import JobExtractionRun, JobPosting, UserProfile
from app.job_extraction.models import JobExtractionSchema
from app.job_extraction.persistence import job_input
from app.job_extraction.quality import assess_quality
from app.job_matching import MatchItem, SkillOverlap
from app.job_recommendations import explicit_job_type_preference, specific_overlap_ids
from tests.test_job_matching import sample as matching_sample  # noqa: F401
from tests.test_profiles_applications_assistant import auth_headers


def request(client, fixture, **payload):
    return client.post("/jobs/recommendations", headers=fixture[0], json=payload)


@pytest.fixture
def live(client, db, matching_sample):  # noqa: F811
    sample = matching_sample
    client.put("/profile", headers=sample[0], json={"skills": ["Python", "SQL"]})
    run = sample[2]
    run.result_json = {**run.result_json, "execution_mode": "live"}
    sample[1].city = "Singapore"
    sample[1].job_type = "internship"
    db.commit()
    return sample


def clone(db, fixture, title="Second job"):
    _, job, run = fixture
    other = JobPosting(
        source_id=job.source_id,
        external_id=str(uuid4()),
        title=title,
        company=job.company,
        description=job.description,
        source_url=job.source_url,
        apply_url=job.apply_url,
        raw_hash="c" * 64,
        dedup_hash=uuid4().hex * 2,
    )
    db.add(other)
    db.flush()
    current = job_input(other)
    result = deepcopy(run.result_json)
    result.update(input_hash=current.input_hash, external_id=current.external_id)
    other_run = JobExtractionRun(
        job_id=other.id,
        status=run.status,
        input_hash=current.input_hash,
        pipeline_hash=run.pipeline_hash,
        input_json=current.model_dump(),
        pipeline_json={},
        result_json=result,
        started_at=run.started_at,
        expires_at=run.expires_at,
        finished_at=run.finished_at,
    )
    db.add(other_run)
    db.commit()
    return other, other_run


def test_ready_private_read_only_and_explicit_evidence(client, db, live):
    before = db.scalar(select(func.count()).select_from(JobExtractionRun))
    result = request(client, live)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    data = result.json()
    assert data["status"] == "ready"
    assert data["profile_skill_count"] == 2
    assert data["evaluated"] == data["scanned"] == data["matched"] == 1
    item = data["items"][0]
    assert [i["requirement"] for i in item["supported"]] == ["Python", "SQL"]
    assert item["supported"][0]["job_evidence"] == "Python required."
    assert item["supported"][0]["profile_evidence"] == "Python"
    assert len(item["unknown"]) == 2
    assert not item["gaps"]
    assert "score" not in item
    assert db.scalar(select(func.count()).select_from(JobExtractionRun)) == before


def test_auth_extra_fields_and_other_account(client, db, live):
    assert client.post("/jobs/recommendations", json={}).status_code == 401
    assert (
        client.post(
            "/jobs/recommendations", headers={"Authorization": "Bearer jpx_invalid"}, json={}
        ).status_code
        == 401
    )
    for body in [
        {"user_id": str(uuid4())},
        {"limit": 21},
        {"limit": True},
        {"keyword": "x" * 201},
        {"model": "x"},
    ]:
        assert request(client, live, **body).status_code == 422
    other = auth_headers(client, email="discovery-other@example.com")
    count = db.scalar(select(func.count()).select_from(UserProfile))
    assert (
        client.post("/jobs/recommendations", headers=other, json={}).json()["status"]
        == "profile_needed"
    )
    assert db.scalar(select(func.count()).select_from(UserProfile)) == count


@pytest.mark.parametrize("skills", [[], ["communication"], ["No Python"]])
def test_insufficient_profile_is_not_fake_personalization(client, live, skills):
    client.put("/profile", headers=live[0], json={"skills": skills})
    report = request(client, live).json()
    assert report["status"] == "profile_needed"
    assert report["items"] == []


@pytest.mark.parametrize(
    "change,reason",
    [
        ("missing", "missing_extraction"),
        ("stale", "stale_extraction"),
        ("invalid", "invalid_extraction"),
        ("failed", "extraction_failed"),
        ("running", "extraction_running"),
        ("mock", "mock_extraction"),
    ],
)
def test_unavailable_exclusions(client, db, live, change, reason):
    _, job, run = live
    if change == "missing":
        db.delete(run)
    elif change == "stale":
        job.description += " Changed."
    elif change == "invalid":
        run.result_json = {}
    elif change == "mock":
        run.result_json = {**run.result_json, "execution_mode": "mock"}
    else:
        run.status = change
        if change == "running":
            run.active_key = str(uuid4())
            run.finished_at = None
    db.commit()
    report = request(client, live).json()
    assert report["status"] == "no_evidence"
    assert report["excluded"] == {reason: 1}


def test_filters_are_literal_and_expired_closed_jobs_are_excluded(client, db, live):
    assert (
        request(client, live, keyword="FICTIONAL", city="singapore", job_type="internship").json()[
            "status"
        ]
        == "ready"
    )
    for body in [{"keyword": "%"}, {"city": "London"}, {"job_type": "full-time"}]:
        assert request(client, live, **body).json()["status"] == "no_candidates"
    live[1].deadline = date.today() - timedelta(days=2)
    db.commit()
    assert request(client, live).json()["scanned"] == 0
    live[1].deadline = None
    live[1].status = "closed"
    db.commit()
    assert request(client, live).json()["scanned"] == 0


def test_no_overlap_and_profile_refresh(client, live):
    client.put("/profile", headers=live[0], json={"skills": ["Docker"]})
    assert request(client, live).json()["status"] == "no_matches"
    client.put("/profile", headers=live[0], json={"skills": ["Python"]})
    assert request(client, live).json()["status"] == "ready"


def test_rank_prefers_no_gaps_and_has_stable_limit(client, db, live):
    client.put("/profile", headers=live[0], json={"skills": ["Python", "SQL", "No Java"]})
    other, run = clone(db, live)
    value = deepcopy(run.result_json)
    value["extraction"]["required_skills"] = value["extraction"]["required_skills"][:1]
    run.result_json = value
    db.commit()
    data = request(client, live, limit=1).json()
    assert data["matched"] == 2
    assert data["items"][0]["job_id"] == str(other.id)
    assert request(client, live, limit=1).json() == data


def test_rank_prefers_exact_skill_evidence_over_more_partial_mentions(client, db, live):
    client.put("/profile", headers=live[0], json={"skills": ["Python", "SQL", "Docker"]})
    partial_job, partial_run = clone(db, live, title="More partial mentions")
    partial_job.description = (
        "Advanced Python required. Advanced SQL required. Advanced Docker required."
    )
    extraction = deepcopy(partial_run.result_json["extraction"])
    extraction["required_skills"] = [
        {"value": skill, "evidence": f"Advanced {skill} required."}
        for skill in ("Python", "SQL", "Docker")
    ]
    extraction["preferred_skills"] = []
    current = job_input(partial_job)
    partial_run.input_hash = current.input_hash
    partial_run.input_json = current.model_dump()
    partial_run.result_json = {
        **partial_run.result_json,
        "input_hash": current.input_hash,
        "extraction": extraction,
        "quality": assess_quality(
            JobExtractionSchema.model_validate(extraction), partial_job.description
        ).model_dump(),
    }
    db.commit()

    report = request(client, live).json()
    assert report["status"] == "ready"
    assert report["matched"] == 2
    assert report["items"][0]["job_id"] == str(live[1].id)
    assert len(report["items"][0]["supported"]) == 2
    assert report["items"][1]["job_id"] == str(partial_job.id)
    assert len(report["items"][1]["overlaps"]) == 3


def test_data_internship_uses_named_cv_like_tools_not_only_generic_python(client, db, live):
    response = client.put(
        "/profile",
        headers=live[0],
        json={"skills": ["Python", "SQL", "Pandas", "NumPy", "Kafka"]},
    )
    assert response.status_code == 200
    data_job, data_run = clone(db, live, title="Data engineering internship")
    data_job.description = "Pandas required. NumPy required. Kafka required."
    extraction = JobExtractionSchema.model_validate(
        {
            "summary": None,
            "responsibilities": [],
            "required_skills": [
                {"value": skill, "evidence": f"{skill} required."}
                for skill in ("Pandas", "NumPy", "Kafka")
            ],
            "preferred_skills": [],
            "required_qualifications": [],
            "preferred_qualifications": [],
            "languages": [],
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
            "experience": {"requirement": None, "minimum_years": None},
        }
    )
    current = job_input(data_job)
    data_run.input_hash = current.input_hash
    data_run.input_json = current.model_dump()
    data_run.result_json = {
        **data_run.result_json,
        "input_hash": current.input_hash,
        "extraction": extraction.model_dump(),
        "quality": assess_quality(extraction, data_job.description).model_dump(),
    }
    db.commit()

    report = request(client, live).json()
    assert report["status"] == "ready"
    assert report["profile_skill_count"] == 5
    assert report["items"][0]["job_id"] == str(data_job.id)
    assert {item["requirement"] for item in report["items"][0]["supported"]} == {
        "Pandas",
        "NumPy",
        "Kafka",
    }


def test_explicit_internship_goal_breaks_equal_evidence_tie(client, db, live):
    full_time, _ = clone(db, live, title="Newer full-time role")
    full_time.job_type = "full-time"
    full_time.created_at = live[1].created_at + timedelta(seconds=5)
    db.commit()
    assert request(client, live).json()["items"][0]["job_id"] == str(full_time.id)

    response = client.put(
        "/profile",
        headers=live[0],
        json={
            "skills": ["Python", "SQL"],
            "resume_summary": "Seeking a software engineering internship.",
            "availability_period": "Available for an internship in summer 2030.",
        },
    )
    assert response.status_code == 200
    report = request(client, live).json()
    assert report["status"] == "ready"
    assert report["preferred_job_type"] == "internship"
    assert report["items"][0]["job_id"] == str(live[1].id)
    assert report["items"][1]["job_id"] == str(full_time.id)


@pytest.mark.parametrize(
    "summary,availability,expected",
    [
        ("Seeking a software internship.", None, "internship"),
        (None, "Available for a full-time, on-site internship next summer.", "internship"),
        ("Completed a data internship; seeking a full-time role.", None, None),
        ("Not seeking an internship.", None, None),
        ("Seeking a full-time role after an internship.", None, None),
        (None, "Not available for an internship.", None),
        (None, "Previously available for an internship.", None),
    ],
)
def test_only_explicit_affirmative_internship_intent_is_used(summary, availability, expected):
    profile = UserProfile(resume_summary=summary, availability_period=availability)
    assert explicit_job_type_preference(profile) == expected


def test_latest_failed_run_does_not_fall_back(client, db, live):
    old = live[2]
    db.add(
        JobExtractionRun(
            job_id=live[1].id,
            status="failed",
            input_hash=old.input_hash,
            pipeline_hash="d" * 64,
            input_json={},
            pipeline_json={},
            started_at=old.started_at + timedelta(seconds=1),
            expires_at=old.expires_at,
            finished_at=old.finished_at,
        )
    )
    db.commit()
    assert request(client, live).json()["excluded"] == {"extraction_failed": 1}


def test_candidate_bound_and_constant_query_count(client, db, live, monkeypatch):
    import app.job_recommendations as module

    monkeypatch.setattr(module, "CANDIDATE_LIMIT", 2)
    clone(db, live)
    clone(db, live)
    queries = []

    def capture(*args):
        queries.append(args[2])

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        report = request(client, live).json()
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert report["truncated"] is True
    assert report["scanned"] == 2
    assert len(queries) <= 5


def test_duplicate_aliases_do_not_inflate_rank():
    def item(label, importance, skill_id):
        return MatchItem(
            category="required_skills",
            requirement=label,
            importance=importance,
            outcome="supported",
            reason="",
            job_evidence="",
            skill_overlaps=[
                SkillOverlap(
                    skill_id=skill_id, label=label, kind="specific", profile_evidence=label
                )
            ],
        )

    assert specific_overlap_ids(
        [
            item("JavaScript", "required", "javascript"),
            item("JS", "required", "javascript"),
            item("JavaScript", "preferred", "javascript"),
            item("SQL", "preferred", "sql"),
        ]
    ) == {"javascript", "sql"}
