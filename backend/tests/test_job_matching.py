"""Offline matching must not equate absent evidence with an applicant deficiency."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.models import JobExtractionRun, JobPosting, JobSource, UserProfile
from app.job_extraction.models import JobExtractionSchema
from app.job_extraction.persistence import job_input
from app.job_extraction.quality import assess_quality
from app.job_matching import compare_skill
from tests.test_profiles_applications_assistant import auth_headers


@pytest.fixture
def sample(client, db):
    headers = auth_headers(client)
    source = JobSource(name="Matching fixture", source_type="mock", base_url="https://example.test")
    db.add(source)
    db.flush()
    job = JobPosting(
        source_id=source.id,
        external_id="matching",
        title="Fictional developer",
        company="Fixture only",
        description="Python required. Java required. SQL preferred. Degree required.",
        source_url="https://example.test/job",
        apply_url="https://example.test/apply",
        raw_hash="a" * 64,
        dedup_hash="b" * 64,
    )
    db.add(job)
    db.flush()
    data = JobExtractionSchema.model_validate(
        {
            "summary": None,
            "responsibilities": [],
            "required_skills": [
                {"value": "Python", "evidence": "Python required."},
                {"value": "Java", "evidence": "Java required."},
            ],
            "preferred_skills": [{"value": "SQL", "evidence": "SQL preferred."}],
            "required_qualifications": [],
            "preferred_qualifications": [],
            "languages": [],
            "education": {
                "degree": {"value": "Degree", "evidence": "Degree required."},
                "enrollment": None,
                "fields_of_study": [],
            },
            "experience": {"requirement": None, "minimum_years": None},
        }
    )
    item = job_input(job)
    now = datetime.now(UTC)
    result = {
        "result_id": str(uuid4()),
        "source_id": item.source_id,
        "external_id": item.external_id,
        "source_url": item.source_url,
        "input_hash": item.input_hash,
        "schema_version": "job-extraction-v1",
        "prompt_version": "job-extraction-prompt-v1",
        "contract_version": "0.1.0",
        "execution_mode": "mock",
        "status": "needs_review",
        "extraction": data.model_dump(),
        "quality": assess_quality(data, job.description).model_dump(),
        "attempts": [
            {
                "attempt": 1,
                "request_id": "fixture",
                "outcome": "success",
                "duration_ms": 1,
                "provider": "mock",
            }
        ],
        "started_at": now.isoformat(),
        "finished_at": now.isoformat(),
    }
    run = JobExtractionRun(
        job_id=job.id,
        status="needs_review",
        input_hash=item.input_hash,
        pipeline_hash="a" * 64,
        input_json=item.model_dump(),
        pipeline_json={},
        result_json=result,
        started_at=now,
        finished_at=now,
        expires_at=now + timedelta(minutes=1),
    )
    db.add(run)
    db.commit()
    return headers, job, run


def request(client, sample, **body):
    return client.post(f"/jobs/{sample[1].id}/match-analysis", headers=sample[0], json=body)


@pytest.mark.parametrize(
    "skill",
    ["Pandas", "NumPy", "scikit-learn", "Kafka", "Vue 3", "Power BI", "Data Analysis"],
)
def test_named_technical_skill_comparison_keeps_qualifiers_unknown(skill):
    assert compare_skill(skill, f"{skill} required.", [skill])[0] == "supported"
    assert compare_skill(skill, f"Advanced {skill} required.", [skill])[0] == "unknown"


def test_supported_gap_unknown_with_evidence_and_no_writes(client, db, sample):
    client.put(
        "/profile", headers=sample[0], json={"skills": ["Python", "No experience with Java"]}
    )
    count = db.scalar(select(func.count()).select_from(JobExtractionRun))
    response = request(client, sample)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    report = response.json()
    assert report["status"] == "preliminary"
    assert [item["outcome"] for item in report["items"]] == [
        "supported",
        "gap",
        "unknown",
        "unknown",
    ]
    assert report["items"][0]["profile_evidence"] == "Python"
    assert report["items"][1]["profile_evidence"] == "No experience with Java"
    assert any("mock" in warning for warning in report["warnings"])
    assert "score" not in report
    assert db.scalar(select(func.count()).select_from(JobExtractionRun)) == count


def test_current_account_only_and_missing_profile_is_not_created(client, db, sample):
    client.put("/profile", headers=sample[0], json={"skills": ["Python"]})
    other = auth_headers(client, email="other-match@example.com")
    before = db.scalar(select(func.count()).select_from(UserProfile))
    report = client.post(f"/jobs/{sample[1].id}/match-analysis", headers=other, json={}).json()
    assert all(item["outcome"] == "unknown" for item in report["items"])
    assert db.scalar(select(func.count()).select_from(UserProfile)) == before
    assert request(client, sample, user_id=str(uuid4())).status_code == 422
    assert request(client, sample, model="anything").status_code == 422
    assert client.post(f"/jobs/{sample[1].id}/match-analysis", json={}).status_code == 401


@pytest.mark.parametrize(
    "change,reason",
    [
        ("description", "stale_extraction"),
        ("invalid", "invalid_extraction"),
        ("failed", "extraction_failed"),
        ("missing", "missing_extraction"),
        ("empty", "no_requirements"),
    ],
)
def test_unavailable_states(client, db, sample, change, reason):
    _, job, run = sample
    if change == "description":
        job.description += " New requirements."
    elif change == "invalid":
        run.result_json = {}
    elif change == "failed":
        run.status = "failed"
    elif change == "missing":
        db.delete(run)
    else:
        result = dict(run.result_json)
        result["extraction"] = {
            **result["extraction"],
            "required_skills": [],
            "preferred_skills": [],
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
        }
        run.result_json = result
    db.commit()
    report = request(client, sample).json()
    assert report["status"] == "unavailable"
    assert report["reason"] == reason
    assert report["items"] == []


def test_quote_mismatch_cannot_support_match(client, db, sample):
    client.put("/profile", headers=sample[0], json={"skills": ["Python"]})
    result = dict(sample[2].result_json)
    result["extraction"]["required_skills"][0]["evidence"] = "Invented Python requirement"
    sample[2].result_json = result
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(sample[2], "result_json")
    db.commit()
    assert request(client, sample).json()["items"][0]["outcome"] == "unknown"


@pytest.mark.parametrize(
    "label,evidence,skills,outcome",
    [
        ("Python", "Python required", ["python"], "supported"),
        ("JavaScript", "JavaScript required", ["JS"], "supported"),
        ("Java", "Java required", ["JavaScript"], "unknown"),
        ("C", "C required", ["C++"], "unknown"),
        ("Python", "Python required", ["Python", "No Python"], "unknown"),
        ("Python", "Python or Java required", ["Python"], "unknown"),
        ("Python", "No Python required", ["Python"], "unknown"),
        ("Python", "Advanced Python required", ["Python"], "unknown"),
        ("Python and SQL", "Python and SQL required", ["Python"], "unknown"),
        ("Python", "Java required", ["Python"], "unknown"),
        ("Python", "Python required", [], "unknown"),
        ("Python", "Python required", ["No experience with Python"], "gap"),
    ],
)
def test_atomic_comparison(label, evidence, skills, outcome):
    assert compare_skill(label, evidence, skills)[0] == outcome
