"""Offline source-review binding, provenance, immutability and account boundaries."""

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.db.models import JobExtractionRun, JobPosting, JobSource
from app.job_extraction.models import ExtractionInput, JobExtractionSchemaV2
from app.job_extraction.quality import assess_quality
from app.job_matching import build_analysis
from tests.test_profiles_applications_assistant import auth_headers


def digest(value):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def group(quote, *, kind="qualification", importance="required", operator="all_of"):
    return {
        "value": quote,
        "evidence": quote,
        "importance": importance,
        "operator": operator,
        "requirements": [{"value": quote, "evidence": quote, "kind": kind, "qualifier": None}],
    }


def write_bundle(path, bundle):
    path.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def reviewed(client, db, tmp_path, monkeypatch):
    def forbid_live_provider(*_args, **_kwargs):
        raise AssertionError("Source-review acceptance must never construct a live provider")

    monkeypatch.setattr("app.llm.config.build_live_provider", forbid_live_provider)
    monkeypatch.delenv("JOB_EXTRACTION_LIVE_ENABLED", raising=False)
    headers = auth_headers(client)
    quotes = [
        "Python required.",
        "Currently pursuing a university degree.",
        "Programming experience through projects or classwork.",
        "Specialized frontend or backend knowledge balanced with general skills.",
        "Our team works in Java.",
        "Curious builder.",
        "Rigorous thinker.",
        "Adaptable problem solver.",
    ]
    description = "\n".join(quotes)
    source = JobSource(
        name="Synthetic source review", source_type="json", base_url="https://example.test"
    )
    db.add(source)
    db.flush()
    job = JobPosting(
        source_id=source.id,
        external_id="source-review",
        title="Synthetic Python internship",
        company="Offline fixture only",
        description=description,
        source_url="https://example.test/source-review",
        apply_url="https://example.test/apply",
        raw_hash="a" * 64,
        dedup_hash="b" * 64,
        city="Singapore",
        job_type="internship",
    )
    db.add(job)
    db.flush()
    original_input = ExtractionInput(
        source_id="external-source-alias",
        external_id=job.external_id,
        source_url=job.source_url,
        source_type="json",
        title=job.title,
        company=job.company,
        description=description,
        raw_hash=job.raw_hash,
    )
    original_payload = {
        "summary": {"value": quotes[0], "evidence": quotes[0]},
        "responsibilities": [],
        "requirement_groups": [
            group(quotes[0], kind="skill"),
            group(quotes[2]),
            group(quotes[3], kind="skill", importance="preferred", operator="any_of"),
            group(quotes[4], kind="skill", importance="unspecified", operator="any_of"),
        ],
        "education": {"degree": None, "fields_of_study": [], "enrollment": None},
        "experience": {"requirement": None, "minimum_years": None},
        "work_constraints": {
            "schedule": None,
            "hours": None,
            "minimum_duration": None,
            "work_modes": [],
            "locations": [],
        },
    }
    original_payload["requirement_groups"][0]["requirements"][0]["value"] = "Python"
    original_payload["requirement_groups"][3]["requirements"][0]["value"] = "Java"
    now = datetime.now(UTC)
    # A synthetic stored live-shaped record tests import/provenance validation;
    # no provider or model is invoked to create any fixture in this module.
    result = {
        "result_id": str(uuid4()),
        "source_id": original_input.source_id,
        "external_id": original_input.external_id,
        "source_url": original_input.source_url,
        "input_hash": original_input.input_hash,
        "raw_hash": original_input.raw_hash,
        "schema_version": "job-extraction-v2",
        "prompt_version": "job-extraction-prompt-v2",
        "contract_version": "0.1.0",
        "execution_mode": "live",
        "status": "needs_review",
        "extraction": original_payload,
        "quality": assess_quality(
            JobExtractionSchemaV2.model_validate(original_payload), description
        ).model_dump(),
        "error_code": None,
        "attempts": [
            {
                "attempt": 1,
                "request_id": "offline-fixture",
                "outcome": "needs_review",
                "duration_ms": 1,
                "provider": "offline-fixture",
            }
        ],
        "started_at": now.isoformat(),
        "finished_at": now.isoformat(),
    }
    raw_text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    corrected = deepcopy(original_payload)
    operations = []

    def operation(kind, path, before, quote, value=None):
        item = {
            "op": kind,
            "path": path,
            "before": deepcopy(before),
            "reason": "Source-bound offline test correction",
            "source_quote": quote,
            "source_start": description.index(quote),
            "source_end": description.index(quote) + len(quote),
        }
        if kind != "remove":
            item["value"] = deepcopy(value)
        operations.append(item)

    enrollment = {"value": quotes[1], "evidence": quotes[1]}
    operation("replace", "/education/enrollment", None, quotes[1], enrollment)
    corrected["education"]["enrollment"] = enrollment
    required = {"value": "required", "evidence": quotes[0]}
    operation(
        "replace", "/requirement_groups/0/requirements/0/qualifier", None, quotes[0], required
    )
    corrected["requirement_groups"][0]["requirements"][0]["qualifier"] = required
    experience = {"value": "projects or classwork", "evidence": quotes[2]}
    operation(
        "replace", "/requirement_groups/1/requirements/0/qualifier", None, quotes[2], experience
    )
    corrected["requirement_groups"][1]["requirements"][0]["qualifier"] = experience
    specialized = group(quotes[3], importance="preferred", operator="unspecified")
    operation(
        "replace",
        "/requirement_groups/2",
        corrected["requirement_groups"][2],
        quotes[3],
        specialized,
    )
    corrected["requirement_groups"][2] = specialized
    operation("remove", "/requirement_groups/3", corrected["requirement_groups"][3], quotes[4])
    corrected["requirement_groups"].pop(3)
    for quote in quotes[5:]:
        trait = group(quote, kind="trait", importance="unspecified", operator="unspecified")
        operation("add", "/requirement_groups/-", None, quote, trait)
        corrected["requirement_groups"].append(trait)

    bundle = {
        "kind": "jobpilot-source-review-v1",
        "job_id": str(job.id),
        "source_id": str(source.id),
        "input": original_input.model_dump(mode="json"),
        "original_result_text": raw_text,
        "corrected_extraction": corrected,
        "corrected_sha256": digest(corrected),
        "review_manifest": {
            "review_kind": "coding_agent_source_comparison",
            "approval_status": "proposed_local_correction_requires_user_review",
            "original_live_result_id": result["result_id"],
            "original_live_result_file_sha256": hashlib.sha256(raw_text.encode()).hexdigest(),
            "input_hash": original_input.input_hash,
            "additional_requests_for_corrections": 0,
            "historical_teammate_run_modified": False,
            "operations": operations,
        },
    }
    run = JobExtractionRun(
        id=UUID(result["result_id"]),
        job_id=job.id,
        status="needs_review",
        input_hash=original_input.input_hash,
        pipeline_hash="c" * 64,
        input_json=original_input.model_dump(mode="json"),
        pipeline_json={},
        result_json=result,
        started_at=now,
        finished_at=now,
        expires_at=now + timedelta(minutes=1),
    )
    db.add(run)
    db.commit()
    path = tmp_path / "review.json"
    write_bundle(path, bundle)
    monkeypatch.setenv("JOBPILOT_REVIEW_BUNDLE", str(path))
    return headers, job, run, bundle, path


def analyze(client, reviewed, **payload):
    return client.post(f"/jobs/{reviewed[1].id}/match-analysis", headers=reviewed[0], json=payload)


def recommend(client, reviewed, **payload):
    return client.post("/jobs/recommendations", headers=reviewed[0], json=payload)


def test_default_off_keeps_original_stale_guard(client, reviewed, monkeypatch):
    monkeypatch.delenv("JOBPILOT_REVIEW_BUNDLE")
    response = analyze(client, reviewed)
    assert response.status_code == 200
    assert response.json()["reason"] == "stale_extraction"
    assert response.json()["source_review"] is None


def test_valid_review_is_visible_and_preserves_original_rows(client, db, reviewed):
    headers, job, run, _, _ = reviewed
    before = deepcopy((run.result_json, run.input_json, run.pipeline_json, run.input_hash))
    assert (
        client.put("/profile", headers=headers, json={"skills": ["Python", "Java"]}).status_code
        == 200
    )
    response = analyze(client, reviewed)
    assert response.status_code == 200
    report = response.json()
    assert report["status"] == "preliminary"
    provenance = report["source_review"]
    assert provenance["kind"] == "agent_source_review"
    assert provenance["original_result_id"] == str(run.id)
    assert provenance["input_hash"] == run.input_hash
    assert provenance["requires_human_review"] is True
    assert "not another model generation" in provenance["notice"]
    assert any(
        item["requirement"] == "Currently pursuing a university degree." for item in report["items"]
    )
    assert not any("Our team works in Java" in item["requirement"] for item in report["items"])
    assert not any(
        overlap["skill_id"] == "java"
        for item in report["items"]
        for overlap in item["skill_overlaps"]
    )
    discovery = recommend(client, reviewed).json()
    assert discovery["source_review_count"] == discovery["evaluated"] == 1
    assert discovery["items"][0]["source_review"] == provenance
    assert not any("original_result_text" in key for key in provenance)
    db.expire_all()
    persisted = db.get(JobExtractionRun, run.id)
    assert (
        persisted.result_json,
        persisted.input_json,
        persisted.pipeline_json,
        persisted.input_hash,
    ) == before
    assert db.scalar(select(func.count()).select_from(JobExtractionRun)) == 1
    assert db.get(JobPosting, job.id).description == reviewed[3]["input"]["description"]


def test_zero_matches_still_reports_reviewed_source(client, reviewed):
    client.put("/profile", headers=reviewed[0], json={"skills": ["Java"]})
    report = recommend(client, reviewed).json()
    assert report["status"] == "no_matches"
    assert report["items"] == []
    assert report["source_review_count"] == report["evaluated"] == 1


@pytest.mark.parametrize(
    "tamper",
    [
        "original_text",
        "input",
        "corrected_hash",
        "corrected_payload",
        "before",
        "source_span",
        "operation_count",
        "operation_path",
        "source_mapping",
        "job_mapping",
        "original_id",
        "record_id",
        "record_result",
        "record_input",
        "record_hash",
        "job_description",
        "job_title",
        "job_company",
        "job_url",
        "job_external_id",
        "job_raw_hash",
        "job_source_type",
    ],
)
def test_invalid_target_review_fails_closed(client, db, reviewed, tamper):
    _, job, run, bundle, path = reviewed
    if tamper == "original_text":
        bundle["original_result_text"] += "\n"
    elif tamper == "input":
        bundle["input"]["description"] += " altered"
    elif tamper == "corrected_hash":
        bundle["corrected_sha256"] = "0" * 64
    elif tamper == "corrected_payload":
        bundle["corrected_extraction"]["experience"]["requirement"] = {
            "value": "Invented",
            "evidence": "Python required.",
        }
        bundle["corrected_sha256"] = digest(bundle["corrected_extraction"])
    elif tamper == "before":
        bundle["review_manifest"]["operations"][0]["before"] = "wrong"
    elif tamper == "source_span":
        bundle["review_manifest"]["operations"][0]["source_start"] += 1
    elif tamper == "operation_count":
        bundle["review_manifest"]["operations"].pop()
    elif tamper == "operation_path":
        bundle["review_manifest"]["operations"][0]["path"] = "/../extraction"
    elif tamper == "source_mapping":
        bundle["source_id"] = str(uuid4())
    elif tamper == "job_mapping":
        bundle["job_id"] = str(uuid4())
    elif tamper == "original_id":
        bundle["review_manifest"]["original_live_result_id"] = str(uuid4())
    elif tamper == "record_id":
        run.id = uuid4()
    elif tamper == "record_result":
        changed = deepcopy(run.result_json)
        changed["extraction"]["education"]["enrollment"] = {
            "value": "Changed",
            "evidence": "Python required.",
        }
        run.result_json = changed
    elif tamper == "record_input":
        run.input_json = {**run.input_json, "company": "Changed"}
    elif tamper == "record_hash":
        run.input_hash = "0" * 64
    elif tamper == "job_source_type":
        job.source.source_type = "mock"
    else:
        attribute = {"job_url": "source_url", "job_raw_hash": "raw_hash"}.get(
            tamper, tamper.removeprefix("job_")
        )
        setattr(job, attribute, "0" * 64 if attribute == "raw_hash" else "Changed")
    db.commit()
    write_bundle(path, bundle)
    response = analyze(client, reviewed)
    assert response.status_code == 200
    assert response.json()["reason"] == "invalid_source_review"
    assert response.json()["source_review"] is None
    client.put("/profile", headers=reviewed[0], json={"skills": ["Python"]})
    report = recommend(client, reviewed).json()
    assert report["source_review_count"] == 0
    assert report["items"] == []
    assert report["excluded"] == {"invalid_source_review": 1}


def test_unrelated_job_keeps_original_behavior_even_when_target_manifest_is_bad(reviewed):
    bundle, path = reviewed[3:]
    bundle["review_manifest"]["operations"] = []
    write_bundle(path, bundle)
    unrelated = JobPosting(id=uuid4())
    assert build_analysis(unrelated, None, None).reason == "missing_extraction"


def test_mock_cannot_be_promoted_by_a_review(client, db, reviewed):
    _, _, run, bundle, path = reviewed
    raw = json.loads(bundle["original_result_text"])
    raw["execution_mode"] = "mock"
    text = json.dumps(raw, ensure_ascii=False)
    bundle["original_result_text"] = text
    bundle["review_manifest"]["original_live_result_file_sha256"] = hashlib.sha256(
        text.encode()
    ).hexdigest()
    run.result_json = raw
    db.commit()
    write_bundle(path, bundle)
    assert analyze(client, reviewed).json()["reason"] == "invalid_source_review"
    client.put("/profile", headers=reviewed[0], json={"skills": ["Python"]})
    assert recommend(client, reviewed).json()["items"] == []


def test_ordinary_account_can_compare_but_cannot_write_or_read_extraction_history(client, reviewed):
    headers, job, run, _, _ = reviewed
    assert client.post(f"/jobs/{job.id}/match-analysis", json={}).status_code == 401
    assert client.post("/jobs/recommendations", json={}).status_code == 401
    assert analyze(client, reviewed).status_code == 200
    assert client.get(f"/jobs/{job.id}/extractions", headers=headers).status_code == 403
    assert client.get(f"/extractions/{run.id}", headers=headers).status_code == 403
    assert client.post(f"/jobs/{job.id}/extractions", headers=headers, json={}).status_code == 403
    assert analyze(client, reviewed, source_review={"kind": "client_supplied"}).status_code == 422
    assert recommend(client, reviewed, source_review={"kind": "client_supplied"}).status_code == 422
