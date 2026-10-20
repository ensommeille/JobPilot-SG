"""Opt-in project evidence is separate, source-backed, private and read-only."""

# Imported pytest fixtures are injected by their argument names.
# ruff: noqa: F811

from copy import deepcopy
from datetime import date, timedelta

import pytest
from sqlalchemy import event, func, select

from app.db.models import JobExtractionRun, UserProfile
from app.job_extraction.persistence import job_input
from app.job_extraction.quality import assess_quality
from tests.test_job_matching import sample as matching_sample  # noqa: F401
from tests.test_job_recommendations import clone
from tests.test_job_recommendations import live as recommendation_live  # noqa: F401
from tests.test_natural_recommendations import fact, prepare_job
from tests.test_profiles_applications_assistant import auth_headers
from tests.test_semantic_matching import schema

DEVELOPMENT = "Develop web applications."
TESTING = "Write automated software tests."
PROJECT = (
    "Built web applications for a class project. "
    "Implemented automated tests for the application."
)


def set_profile(client, fixture, *, experience=PROJECT, skills=()):
    response = client.put(
        "/profile", headers=fixture[0], json={"skills": list(skills), "experience": experience}
    )
    assert response.status_code == 200


def prepare_duties(db, fixture, *duties):
    duties = duties or (DEVELOPMENT, TESTING)
    prepare_job(
        db,
        fixture,
        " ".join(duties),
        duties=[fact(duty, duty) for duty in duties],
    )


def prepare_v2_duty(db, fixture, *, priority, condition=None):
    wording = DEVELOPMENT if condition is None else f"When assigned, {DEVELOPMENT.lower()}"
    data = schema(
        duties=[
            {"value": DEVELOPMENT, "evidence": wording, "priority": priority, "condition": condition}
        ]
    )
    _, job, run = fixture
    job.description = wording
    current = job_input(job)
    result = deepcopy(run.result_json)
    result.update(
        schema_version="job-extraction-v2",
        prompt_version="job-extraction-prompt-v2",
        source_id=current.source_id,
        external_id=current.external_id,
        source_url=current.source_url,
        input_hash=current.input_hash,
        extraction=data.model_dump(),
        quality=assess_quality(data, wording).model_dump(),
    )
    run.input_hash = current.input_hash
    run.input_json = current.model_dump()
    run.result_json = result
    db.commit()


def analyze(client, fixture, **payload):
    return client.post(f"/jobs/{fixture[1].id}/match-analysis", headers=fixture[0], json=payload)


def recommend(client, fixture, **payload):
    return client.post("/jobs/recommendations", headers=fixture[0], json=payload)


def related(report):
    return [row for row in report["responsibility_matches"] if row["outcome"] == "related_evidence"]


def test_default_contract_does_not_turn_duties_into_requirements(client, db, recommendation_live):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live, skills=["Python"])

    implicit = analyze(client, recommendation_live).json()
    explicit = analyze(client, recommendation_live, include_experience=False).json()
    assert implicit == explicit
    assert implicit["version"] == "evidence-overlap-v2"
    assert implicit["status"] == "unavailable"
    assert implicit["reason"] == "no_requirements"
    assert implicit["items"] == implicit["responsibility_matches"] == []
    report = recommend(client, recommendation_live).json()
    assert report == recommend(client, recommendation_live, include_experience=False).json()
    assert report["version"] == "evidence-discovery-v2"
    assert report["status"] == "no_evidence"
    assert report["excluded"] == {"no_requirements": 1}
    assert report["items"] == []


def test_opt_in_pairs_duty_and_project_quotes_without_fabricating_skill_support(
    client, db, recommendation_live
):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    response = analyze(client, recommendation_live, include_experience=True)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    analysis = response.json()
    assert analysis["status"] == "preliminary"
    assert analysis["reason"] is None
    assert analysis["items"] == []
    rows = related(analysis)
    assert len(rows) == 2
    assert {row["job_evidence"] for row in rows} == {DEVELOPMENT, TESTING}
    for row in rows:
        assert row["responsibility"] == row["job_evidence"]
        assert row["activities"]
        assert row["profile_evidence"]
        assert all(quote in PROJECT for quote in row["profile_evidence"])
        assert row["priority"] == "unspecified"
        assert row["condition"] is None
        assert "score" not in row

    response = recommend(client, recommendation_live, include_experience=True)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    report = response.json()
    assert report["status"] == "ready"
    assert report["matched"] == report["evaluated"] == report["scanned"] == 1
    item = report["items"][0]
    assert item["responsibility_matches"] == analysis["responsibility_matches"]
    assert item["supported"] == item["gaps"] == item["unknown"] == item["overlaps"] == []
    assert "score" not in item


@pytest.mark.parametrize("value", ["true", "false", 1, 0, None, [], {}])
def test_experience_switch_is_strict_on_both_endpoints(client, recommendation_live, value):
    assert analyze(client, recommendation_live, include_experience=value).status_code == 422
    assert recommend(client, recommendation_live, include_experience=value).status_code == 422


@pytest.mark.parametrize("extra", [{"user_id": "another"}, {"model": "paid"}, {"experience": PROJECT}])
def test_opt_in_does_not_accept_client_identity_model_or_unsaved_experience(
    client, recommendation_live, extra
):
    assert analyze(client, recommendation_live, include_experience=True, **extra).status_code == 422
    assert recommend(client, recommendation_live, include_experience=True, **extra).status_code == 422


@pytest.mark.parametrize(
    "experience",
    [
        None,
        "",
        "Python, Java, web applications, automated tests.",
        "I plan to build web applications and write automated tests.",
        "Currently learning to build web applications.",
        "I have never built web applications or implemented automated tests.",
        "Job description: Develop web applications. Write automated software tests.",
    ],
)
def test_bare_terms_learning_plans_and_copied_duties_do_not_gate_recommendations(
    client, db, recommendation_live, experience
):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live, experience=experience)
    report = recommend(client, recommendation_live, include_experience=True).json()
    assert report["status"] == "profile_needed"
    assert report["items"] == []
    analysis = analyze(client, recommendation_live, include_experience=True).json()
    assert related(analysis) == []
    assert all(not row["profile_evidence"] for row in analysis["responsibility_matches"])


def test_project_only_profile_is_opt_in_and_uses_current_saved_experience(
    client, db, recommendation_live
):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    assert recommend(client, recommendation_live).json()["status"] == "profile_needed"
    assert recommend(client, recommendation_live, include_experience=True).json()["status"] == "ready"
    set_profile(client, recommendation_live, experience="Currently learning to build web applications.")
    assert recommend(client, recommendation_live, include_experience=True).json()["status"] == "profile_needed"
    assert related(analyze(client, recommendation_live, include_experience=True).json()) == []


def test_authentication_and_account_isolation_apply_to_project_evidence(
    client, db, recommendation_live
):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    job_url = f"/jobs/{recommendation_live[1].id}/match-analysis"
    for url in [job_url, "/jobs/recommendations"]:
        assert client.post(url, json={"include_experience": True}).status_code == 401
        assert client.post(
            url, headers={"Authorization": "Bearer invalid"}, json={"include_experience": True}
        ).status_code == 401
    other = auth_headers(client, email="project-evidence-other@example.com")
    before = db.scalar(select(func.count()).select_from(UserProfile))
    report = client.post(job_url, headers=other, json={"include_experience": True}).json()
    assert related(report) == []
    assert all(not row["profile_evidence"] for row in report["responsibility_matches"])
    assert "class project" not in str(report)
    discovery = client.post("/jobs/recommendations", headers=other, json={"include_experience": True}).json()
    assert discovery["status"] == "profile_needed"
    assert discovery["items"] == []
    assert db.scalar(select(func.count()).select_from(UserProfile)) == before


@pytest.mark.parametrize(
    "description,evidence",
    [
        ("Organise office supplies.", DEVELOPMENT),
        ("Organise office supplies.", "Organise office supplies."),
        ("Develop marketing campaigns.", "Develop marketing campaigns."),
    ],
)
def test_invented_or_unrelated_source_cannot_borrow_project_evidence(
    client, db, recommendation_live, description, evidence
):
    prepare_job(db, recommendation_live, description, duties=[fact(DEVELOPMENT, evidence)])
    set_profile(client, recommendation_live)
    report = analyze(client, recommendation_live, include_experience=True).json()
    assert related(report) == []
    assert all(not row["profile_evidence"] for row in report["responsibility_matches"])
    assert recommend(client, recommendation_live, include_experience=True).json()["items"] == []


@pytest.mark.parametrize("change,reason", [("stale", "stale_extraction"), ("mock", "mock_extraction")])
def test_project_evidence_cannot_rescue_stale_or_mock_extractions(
    client, db, recommendation_live, change, reason
):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    if change == "stale":
        recommendation_live[1].description += " Changed responsibilities."
    else:
        run = recommendation_live[2]
        run.result_json = {**run.result_json, "execution_mode": "mock"}
    db.commit()
    analysis = analyze(client, recommendation_live, include_experience=True).json()
    assert related(analysis) == []
    report = recommend(client, recommendation_live, include_experience=True).json()
    assert report["items"] == []
    assert report["excluded"] == {reason: 1}


def test_latest_failed_run_does_not_fall_back_to_old_project_evidence(
    client, db, recommendation_live
):
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    old = recommendation_live[2]
    db.add(
        JobExtractionRun(
            job_id=recommendation_live[1].id,
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
    report = analyze(client, recommendation_live, include_experience=True).json()
    assert report["reason"] == "extraction_failed"
    assert report["responsibility_matches"] == []
    assert recommend(client, recommendation_live, include_experience=True).json()["excluded"] == {
        "extraction_failed": 1
    }


@pytest.mark.parametrize("priority", ["secondary", "conditional"])
def test_secondary_or_conditional_duty_cannot_alone_admit_a_recommendation(
    client, db, recommendation_live, priority
):
    condition = fact("When assigned", "When assigned") if priority == "conditional" else None
    prepare_v2_duty(db, recommendation_live, priority=priority, condition=condition)
    set_profile(client, recommendation_live)
    report = analyze(client, recommendation_live, include_experience=True).json()
    rows = report["responsibility_matches"]
    assert len(rows) == 1
    assert rows[0]["priority"] == priority
    assert rows[0]["condition"] == condition
    assert recommend(client, recommendation_live, include_experience=True).json()["items"] == []


def test_repeating_duties_or_projects_does_not_beat_a_newer_equivalent_job(
    client, db, recommendation_live
):
    older = recommendation_live
    other_job, other_run = clone(db, older)
    newer = (older[0], other_job, other_run)
    older[1].posted_at = date.today() - timedelta(days=2)
    newer[1].posted_at = date.today() - timedelta(days=1)
    prepare_duties(db, older, DEVELOPMENT, "Build web applications.")
    prepare_duties(db, newer, DEVELOPMENT)
    set_profile(client, older, experience=f"{PROJECT}\n{PROJECT}")
    report = recommend(client, older, include_experience=True).json()
    assert report["matched"] == 2
    assert [item["job_id"] for item in report["items"]] == [str(newer[1].id), str(older[1].id)]
    assert recommend(client, older, include_experience=True).json() == report


@pytest.mark.parametrize(
    "older_requirements,older_duties,newer_requirements,newer_duties,expected_older_first",
    [
        (["Java"], [DEVELOPMENT, TESTING], [], [DEVELOPMENT], False),
        (["Python"], [DEVELOPMENT], [], [DEVELOPMENT, TESTING], True),
    ],
    ids=["project-activities-do-not-override-explicit-gaps", "skills-rank-before-activity-count"],
)
def test_project_evidence_does_not_override_existing_gap_and_skill_ranking(
    client,
    db,
    recommendation_live,
    older_requirements,
    older_duties,
    newer_requirements,
    newer_duties,
    expected_older_first,
):
    older = recommendation_live
    other_job, other_run = clone(db, older)
    newer = (older[0], other_job, other_run)
    older[1].posted_at = date.today() - timedelta(days=2)
    newer[1].posted_at = date.today() - timedelta(days=1)
    for fixture, requirements, duties in [
        (older, older_requirements, older_duties),
        (newer, newer_requirements, newer_duties),
    ]:
        facts = [fact(value) for value in requirements]
        prepare_job(
            db,
            fixture,
            " ".join([*(row["evidence"] for row in facts), *duties]),
            required=facts,
            duties=[fact(value, value) for value in duties],
        )
    set_profile(client, older, skills=["Python", "No Java"])
    report = recommend(client, older, include_experience=True).json()
    assert report["matched"] == 2
    expected = [older, newer] if expected_older_first else [newer, older]
    assert [item["job_id"] for item in report["items"]] == [str(fixture[1].id) for fixture in expected]


def test_model_cannot_erase_a_source_condition_to_admit_a_job(client, db, recommendation_live):
    description = "When assigned, develop web applications."
    prepare_job(
        db,
        recommendation_live,
        description,
        duties=[fact(DEVELOPMENT, "develop web applications.")],
    )
    set_profile(client, recommendation_live)
    assert recommend(client, recommendation_live, include_experience=True).json()["items"] == []


def test_project_comparison_is_read_only_and_never_calls_a_provider(
    client, db, recommendation_live, monkeypatch
):
    from app.llm.mock import MockProvider
    from app.llm.openai_compatible import OpenAICompatibleChatProvider

    async def unexpected_provider_call(*args, **kwargs):
        raise AssertionError("Evidence comparison must not invoke a provider")

    monkeypatch.setattr(MockProvider, "generate_structured", unexpected_provider_call)
    monkeypatch.setattr(OpenAICompatibleChatProvider, "generate_structured", unexpected_provider_call)
    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    before = deepcopy(recommendation_live[2].result_json)
    before_runs = db.scalar(select(func.count()).select_from(JobExtractionRun))
    before_profiles = db.scalar(select(func.count()).select_from(UserProfile))
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        assert related(analyze(client, recommendation_live, include_experience=True).json())
        assert recommend(client, recommendation_live, include_experience=True).json()["status"] == "ready"
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert statements
    assert not {"INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER"}.intersection(statements)
    db.expire_all()
    assert recommendation_live[2].result_json == before
    assert db.scalar(select(func.count()).select_from(JobExtractionRun)) == before_runs
    assert db.scalar(select(func.count()).select_from(UserProfile)) == before_profiles


def test_project_recommendations_keep_the_candidate_bound_and_constant_query_count(
    client, db, recommendation_live, monkeypatch
):
    import app.job_recommendations as module

    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live)
    clone(db, recommendation_live)
    clone(db, recommendation_live)
    monkeypatch.setattr(module, "CANDIDATE_LIMIT", 2)
    queries = []

    def capture(*args):
        queries.append(args[2])

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        report = recommend(client, recommendation_live, include_experience=True).json()
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert report["truncated"] is True
    assert report["scanned"] == report["evaluated"] == report["matched"] == 2
    assert len(queries) <= 5


def test_project_text_is_parsed_once_per_opt_in_request_not_per_candidate_or_legacy_request(
    client, db, recommendation_live, monkeypatch
):
    import app.job_recommendations as recommendations
    import app.responsibility_matching as matching

    prepare_duties(db, recommendation_live)
    set_profile(client, recommendation_live, skills=["Python"])
    clone(db, recommendation_live)
    clone(db, recommendation_live)
    original_prepare = recommendations.prepare_project_evidence
    original_parse = matching._project_evidence
    calls = {"prepare": 0, "parse": 0}

    def count_prepare(experience):
        calls["prepare"] += 1
        return original_prepare(experience)

    def count_parse(experience):
        calls["parse"] += 1
        return original_parse(experience)

    monkeypatch.setattr(recommendations, "prepare_project_evidence", count_prepare)
    monkeypatch.setattr(matching, "_project_evidence", count_parse)

    legacy = recommend(client, recommendation_live, include_experience=False).json()
    assert legacy["scanned"] == 3
    assert legacy["excluded"] == {"no_requirements": 3}
    assert calls == {"prepare": 0, "parse": 0}

    report = recommend(client, recommendation_live, include_experience=True).json()
    assert report["scanned"] == report["evaluated"] == report["matched"] == 3
    assert calls == {"prepare": 1, "parse": 1}

    # A second request reads the changed profile, including an empty parsed result;
    # neither old personal evidence nor per-candidate re-parsing may leak through.
    set_profile(
        client,
        recommendation_live,
        experience="Currently learning to build web applications.",
        skills=["Python"],
    )
    updated = recommend(client, recommendation_live, include_experience=True).json()
    assert updated["scanned"] == updated["evaluated"] == 3
    assert updated["items"] == []
    assert calls == {"prepare": 2, "parse": 2}

    assert recommend(client, recommendation_live).json() == legacy
    assert calls == {"prepare": 2, "parse": 2}
