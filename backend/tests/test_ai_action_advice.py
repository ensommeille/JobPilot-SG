"""One current AI assessment across list/detail; synthetic inputs, no network."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, select

from app.ai_recommendations.advice import advice_for_batch, derive_advice
from app.ai_recommendations.models import AIRecommendationRun
from app.ai_recommendations.runtime import get_ai_runtime
from app.ai_recommendations.schemas import BatchAssessment
from app.ai_recommendations.service import validate_assessment
from app.main import app
from tests import test_ai_recommendations as shared
from tests.test_profiles_applications_assistant import auth_headers

context = shared.context
provider = shared.provider


def item(rows, *, rank=1):
    return BatchAssessment.model_validate(
        {
            "requires_review": True,
            "items": [
                {
                    "job_id": "2353ac08-2abd-4480-9cf0-02f4e6e38d21",
                    "rank": rank,
                    "summary": "Strongest possible recommendation, regardless of missing evidence.",
                    "requirements": rows,
                    "warnings": [],
                }
            ],
        }
    ).items[0]


def fact(category="skill", outcome="supported", text="Python required"):
    return shared.requirement(
        category=category,
        outcome=outcome,
        requirement=text,
        jd_quote=text,
        profile_field="experience" if category == "experience" else "skills",
        profile_quote="Built API services."
        if category == "experience"
        else "SQL"
        if "SQL" in text
        else "Python",
    )


@pytest.mark.parametrize(
    ("rows", "status"),
    [
        ([fact("education")], "not_priority"),
        ([fact(outcome="unknown")], "check_first"),
        ([fact()], "consider"),
        ([fact(), fact(text="SQL required")], "priority_apply"),
        ([fact(), fact("experience", text="Experience building APIs")], "priority_apply"),
        ([fact(), fact("education", "unknown", "Undergraduate graduating 2028")], "check_first"),
        ([fact(), fact("work_constraint", "unknown", "Full-time for twelve weeks")], "check_first"),
        ([fact(), fact("education", "gap", "PhD required")], "not_priority"),
        ([fact(), fact("skill", "gap", "C++ required")], "not_priority"),
        (
            [
                fact(),
                fact(text="SQL required"),
                fact("responsibility", "unknown", "Build a new platform"),
            ],
            "priority_apply",
        ),
        (
            [fact(), fact(text="SQL required"), fact("skill", "unknown", "Rust preferred")],
            "priority_apply",
        ),
        (
            [
                fact(),
                fact(text="SQL required"),
                fact("skill", "unknown", "Python required; Rust preferred"),
            ],
            "check_first",
        ),
        ([fact(), fact("skill", "gap", "Rust preferred")], "consider"),
    ],
)
def test_action_states_use_conditions_and_core_evidence_not_summary(rows, status):
    assessed = item(rows)
    original = assessed.model_dump(mode="json")
    advice = derive_advice(assessed)
    assert advice.status == status
    assert advice.version == "action-advice-v3"
    assert assessed.model_dump(mode="json") == original
    assert sum(advice.counts.model_dump().values()) == len(rows)
    for evidence in [*advice.blockers, *advice.strengths]:
        projected = evidence.model_dump(exclude={"requirement_index", "reason"})
        original_row = rows[evidence.requirement_index]
        assert projected == {key: value for key, value in original_row.items() if key != "reason"}
        assert evidence.reason.startswith(original_row["reason"])


def test_eligibility_blockers_appear_before_unknown_core_and_duties_are_not_gaps():
    assessed = item(
        [
            fact("skill", "unknown", "C++ required"),
            fact("responsibility", "unknown", "Build a trading platform"),
            fact("work_constraint", "unknown", "Full-time for twelve weeks"),
        ]
    )
    advice = derive_advice(assessed)
    assert [e.requirement_index for e in advice.blockers] == [2, 0]
    assert advice.counts.gap == 0
    assert advice.status == "check_first"


def test_repeating_one_python_evidence_does_not_manufacture_a_priority():
    assessed = item([fact(), fact(text="Use Python in projects")])
    advice = derive_advice(assessed)
    assert advice.counts.supported == 2
    assert advice.status == "consider"


def test_supported_duty_is_not_a_core_strength_or_a_priority_claim():
    assessed = item([fact("responsibility", "supported", "Build a new platform")])
    original = assessed.model_dump(mode="json")
    advice = derive_advice(assessed)
    assert advice.status == "not_priority" and advice.strengths == []
    assert advice.counts.supported == 1  # Evidence counts are not a match score.
    assert assessed.model_dump(mode="json") == original


@pytest.mark.parametrize(
    "requirement",
    [
        "Used tools to build applications",
        "Experience with application development",
        "Deployed services using a platform",
        "Implemented workflow automation",
    ],
)
def test_bare_skill_name_cannot_prove_a_specific_activity_in_action_projection(requirement):
    assessed = item(
        [
            {
                **fact(text=requirement),
                "profile_field": "skills",
                "profile_quote": "BuilderKit",
            }
        ]
    )
    original = assessed.model_dump(mode="json")
    advice = derive_advice(assessed)
    assert advice.status == "not_priority" and advice.strengths == []
    assert advice.counts.supported == 0 and advice.counts.unknown == 1
    assert advice.blockers[0].outcome == "unknown"
    assert "skills-list tool name" in advice.blockers[0].reason
    assert len(advice.reasons) <= 2
    assert assessed.model_dump(mode="json") == original


def test_pure_tool_familiarity_stays_supported_without_claiming_an_activity():
    assessed = item(
        [
            {
                **fact(text="Familiarity with BuilderKit"),
                "profile_quote": "BuilderKit",
            }
        ]
    )
    original = assessed.model_dump(mode="json")
    advice = derive_advice(assessed)
    assert advice.status == "consider" and advice.counts.supported == 1
    assert len(advice.strengths) == 1 and advice.blockers == []
    assert assessed.model_dump(mode="json") == original


def test_explicit_activity_quote_in_experience_is_not_a_bare_skill_list():
    assessed = item(
        [
            {
                **fact(text="Built application tools"),
                "profile_field": "experience",
                "profile_quote": "Built application tools in a course project.",
            }
        ]
    )
    assert derive_advice(assessed).counts.supported == 1


def test_neighbouring_optional_clause_cannot_hide_an_unknown_core_requirement():
    unknown = {
        **fact(outcome="unknown", text="Understanding of model fundamentals"),
        "jd_quote": "Understanding of model fundamentals. Familiarity with cloud platforms is a plus.",
        "profile_field": None,
        "profile_quote": None,
    }
    assessed = item([fact(), unknown])
    original = assessed.model_dump(mode="json")
    advice = derive_advice(assessed)
    assert advice.status == "consider"  # Ordinary unknown skills are not hard eligibility gates.
    assert [row.requirement_index for row in advice.blockers] == [1]
    assert "does not establish" in advice.blockers[0].reason
    assert assessed.model_dump(mode="json") == original


def test_optional_requires_this_requirement_and_its_source_to_agree():
    preferred = {
        **fact(outcome="unknown", text="Cloud experience preferred"),
        "jd_quote": "Cloud experience preferred.",
        "profile_field": None,
        "profile_quote": None,
    }
    advice = derive_advice(item([fact(), preferred]))
    assert advice.status == "consider" and advice.blockers == []
    preferred["jd_quote"] = "Cloud experience is required."
    assert derive_advice(item([fact(), preferred])).status == "check_first"


def test_display_order_does_not_call_a_zero_evidence_raw_first_rank_top_choice():
    first = item([fact(outcome="unknown")])
    second = deepcopy(first)
    second.job_id = shared.uuid4()
    second.rank = 2
    second.requirements = [type(first.requirements[0]).model_validate(fact())]
    batch = BatchAssessment(requires_review=True, items=[first, second])
    original = batch.model_dump(mode="json")
    advice, ordered = advice_for_batch(batch, {})
    assert ordered == [second.job_id, first.job_id]
    assert advice[str(first.job_id)].status == "check_first"
    assert batch.model_dump(mode="json") == original


def test_supported_duties_cannot_boost_the_display_order_tiebreak():
    first = item(
        [
            fact(),
            fact("responsibility", "supported", "Build a platform"),
            fact("responsibility", "supported", "Improve a platform"),
        ]
    )
    second = item(
        [
            fact(text="SQL required"),
            {
                **fact("education", "supported", "BSc required"),
                "profile_field": "education",
                "profile_quote": "BSc Computing",
            },
        ]
    )
    second.job_id, second.rank = shared.uuid4(), 2
    batch = BatchAssessment(requires_review=True, items=[first, second])
    advice, ordered = advice_for_batch(batch, {})
    assert advice[str(first.job_id)].counts.supported > advice[str(second.job_id)].counts.supported
    assert len(advice[str(first.job_id)].strengths) == 1
    assert len(advice[str(second.job_id)].strengths) == 2
    assert ordered == [second.job_id, first.job_id]


def test_free_detail_reuses_the_existing_five_job_batch_and_never_writes_or_calls(
    client, db, context, provider
):
    context.jobs += shared.seed_jobs(db, 4)
    provider.data = shared.answer(context.jobs)
    created = shared.post(client, context).json()
    assert created["status"] == "succeeded" and len(provider.calls) == 1
    assert created["is_current"] is True
    before = deepcopy(db.scalar(select(AIRecommendationRun)).result_json)
    statements = []

    def record(_conn, _cursor, statement, _params, _context, _many):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    event.listen(db.get_bind(), "before_cursor_execute", record)
    try:
        for job in context.jobs:
            response = client.get(f"/jobs/{job.id}/ai-assessment", headers=context.headers)
            assert response.status_code == 200
            shared.assert_private(response)
            report = response.json()
            assert report["status"] == "available"
            assert report["source_run_id"] == created["id"]
            assert report["assessment"] == next(
                row for row in created["result"]["items"] if row["job_id"] == str(job.id)
            )
            assert report["advice"] == created["advice"][str(job.id)]
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", record)
    assert not set(statements) & {"INSERT", "UPDATE", "DELETE", "REPLACE"}
    assert db.scalar(select(AIRecommendationRun)).result_json == before
    assert len(provider.calls) == 1


@pytest.mark.parametrize("changed", ["profile", "jd", "pipeline"])
def test_detail_never_relabels_an_outdated_saved_analysis_as_current(
    client, db, context, provider, changed
):
    shared.post(client, context)
    if changed == "profile":
        assert (
            client.put(
                "/profile", headers=context.headers, json={**shared.PROFILE, "skills": ["Java"]}
            ).status_code
            == 200
        )
    elif changed == "jd":
        context.jobs[0].description += " New applicant condition."
        db.commit()
    else:
        saved = db.scalar(select(AIRecommendationRun))
        saved.pipeline_json = {**saved.pipeline_json, "prompt_version": "legacy-version"}
        db.commit()
    response = client.get(f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers)
    assert response.json()["status"] == "outdated"
    assert response.json()["assessment"] is None and response.json()["advice"] is None
    assert len(provider.calls) == 1


def test_other_accounts_and_unanalysed_jobs_do_not_receive_private_results(
    client, db, context, provider
):
    shared.post(client, context)
    path = f"/jobs/{context.jobs[0].id}/ai-assessment"
    assert client.get(path).status_code == 401
    other = auth_headers(client, "other-detail-reader@example.com")
    assert client.put("/profile", headers=other, json=shared.PROFILE).status_code == 200
    response = client.get(path, headers=other).json()
    assert response["status"] == "not_analyzed" and response["source_run_id"] is None
    another = shared.seed_jobs(db)[0]
    response = client.get(f"/jobs/{another.id}/ai-assessment", headers=context.headers).json()
    assert response["status"] == "not_analyzed" and response["assessment"] is None
    assert len(provider.calls) == 1


def test_reading_an_expired_lease_does_not_repair_or_write_the_run(client, db, context, provider):
    created = shared.post(client, context).json()
    run = db.scalar(select(AIRecommendationRun))
    run.status = "running"
    run.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    run.result_json = None
    db.commit()
    report = client.get(f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers).json()
    assert report["source_run_id"] == created["id"]
    assert report["status"] == "failed" and report["reason"] == "lease_expired"
    db.refresh(run)
    assert run.status == "running" and len(provider.calls) == 1


def test_unrelated_job_change_does_not_prevent_current_batch_item_reuse(
    client, db, context, provider
):
    context.jobs += shared.seed_jobs(db)
    provider.data = shared.answer(context.jobs)
    created = shared.post(client, context).json()
    context.jobs[1].description += " Changed other job."
    db.commit()
    report = client.get(f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers).json()
    assert report["status"] == "available" and report["source_run_id"] == created["id"]
    assert len(provider.calls) == 1


def test_free_detail_does_not_depend_on_model_configuration(client, context, provider):
    shared.post(client, context)
    original = app.dependency_overrides[get_ai_runtime]

    def disabled():
        raise AssertionError("Free detail must not acquire the paid runtime dependency")

    app.dependency_overrides[get_ai_runtime] = disabled
    try:
        response = client.get(f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers)
        assert response.json()["status"] == "available"
    finally:
        app.dependency_overrides[get_ai_runtime] = original
    assert len(provider.calls) == 1


def test_saved_availability_is_minimized_sent_and_explicitly_citable(client, db, context, provider):
    availability = "Available full-time for 12 weeks."
    saved = {
        **shared.PROFILE,
        "availability_period": availability
        + " Contact private-candidate@example.com, +65 8123 4567.",
    }
    assert client.put("/profile", headers=context.headers, json=saved).status_code == 200
    context.jobs[0].description = availability
    db.commit()
    provider.data["items"][0]["requirements"] = [
        shared.requirement(
            category="work_constraint",
            requirement=availability,
            jd_quote=availability,
            profile_field="availability",
            profile_quote=availability,
        )
    ]
    created = shared.post(client, context).json()
    assert created["status"] == "succeeded"
    assert created["prompt_version"] == "ai-recommendation-v9-evidence-scope"
    assessed = created["result"]["items"][0]["requirements"][0]
    assert assessed["outcome"] == "supported" and assessed["profile_field"] == "availability"
    payload = json.loads(provider.calls[0].messages[-1].content)
    assert payload["profile"]["availability"].startswith(availability)
    assert "private-candidate@example.com" not in json.dumps(payload)
    assert "+65 8123 4567" not in json.dumps(payload)
    assert "nationality" not in payload["profile"] and "contact_email" not in payload["profile"]


@pytest.mark.parametrize(
    ("jd", "field", "quote"),
    [
        ("Available from 2027 to 2028", "education", "BSc Computing 2027 to 2028"),
        ("Available full-time", "availability", "May to August 2027"),
        ("Available for 12 weeks", "availability", "May to August 2027"),
        ("Available onsite for 12 weeks", "availability", "Available for 12 weeks"),
    ],
)
def test_saved_dates_or_broad_period_do_not_invent_every_availability_condition(jd, field, quote):
    assessed = item(
        [
            shared.requirement(
                category="work_constraint",
                requirement=jd,
                jd_quote=jd,
                profile_field=field,
                profile_quote=quote,
            )
        ]
    )
    data = {"requires_review": True, "items": [assessed.model_dump(mode="json")]}
    profile = {"education": None, "experience": None, "skills": [], "availability": None}
    profile[field] = quote
    result = validate_assessment(
        data, {"profile": profile, "jobs": [{"id": str(assessed.job_id), "description": jd}]}
    )
    assert result.items[0].requirements[0].outcome == "unknown"
    assert (
        "does not explicitly establish every availability condition"
        in result.items[0].requirements[0].reason
    )


def test_legacy_v4_stays_historical_when_saved_availability_was_not_compared(
    client, db, context, provider
):
    shared.post(client, context)
    run = db.scalar(select(AIRecommendationRun))
    original = deepcopy(run.result_json)
    run.pipeline_json = {
        **run.pipeline_json,
        "prompt_version": "ai-recommendation-v4-role-recall-evidence",
    }
    profile = {
        key: value for key, value in run.input_json["profile"].items() if key != "availability"
    }
    run.input_json = {**run.input_json, "profile": profile}
    db.commit()
    response = client.get(
        f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers
    ).json()
    assert response["status"] == "outdated" and response["assessment"] is None
    historic = client.get(f"/ai-recommendations/{run.id}", headers=context.headers).json()
    assert historic["result"] == original and historic["advice"] == {}
    assert len(provider.calls) == 1


def test_unspecified_saved_availability_is_explicitly_null_in_minimized_input(
    client, context, provider
):
    assert (
        client.put(
            "/profile",
            headers=context.headers,
            json={**shared.PROFILE, "availability_period": None},
        ).status_code
        == 200
    )
    assert shared.post(client, context).json()["status"] == "succeeded"
    payload = json.loads(provider.calls[0].messages[-1].content)
    assert "availability" in payload["profile"] and payload["profile"]["availability"] is None


@pytest.mark.parametrize(
    "changed", ["profile", "availability", "jd", "closed", "expired", "disabled", "pipeline"]
)
def test_historical_batch_keeps_raw_evidence_but_never_current_advice_after_inputs_change(
    client, db, context, provider, changed
):
    created = shared.post(client, context).json()
    assert created["is_current"] is True and created["advice"] and created["display_order"]
    if changed in {"profile", "availability"}:
        saved = {**shared.PROFILE}
        if changed == "profile":
            saved["skills"] = ["Java"]
        else:
            saved["availability_period"] = "Available in December 2027."
        assert client.put("/profile", headers=context.headers, json=saved).status_code == 200
    elif changed == "jd":
        context.jobs[0].description += " A new applicant condition."
    elif changed == "closed":
        context.jobs[0].status = "closed"
    elif changed == "expired":
        context.jobs[0].deadline = datetime.now(shared.NOW_SG).date() - timedelta(days=1)
    elif changed == "disabled":
        context.jobs[0].source.enabled = False
    else:
        run = db.scalar(select(AIRecommendationRun))
        run.pipeline_json = {**run.pipeline_json, "prompt_version": "legacy-version"}
    db.commit()
    response = client.get(f"/ai-recommendations/{created['id']}", headers=context.headers)
    assert response.status_code == 200
    historic = response.json()
    assert historic["is_current"] is False
    assert historic["advice"] == {} and historic["display_order"] == []
    assert historic["result"] == created["result"]
    assert len(provider.calls) == 1


def test_current_batch_get_exposes_the_same_advice_without_a_model_dependency(
    client, context, provider
):
    created = shared.post(client, context).json()
    original = app.dependency_overrides[get_ai_runtime]

    def forbidden():
        raise AssertionError("Reading batch currentness must not acquire a paid runtime")

    app.dependency_overrides[get_ai_runtime] = forbidden
    try:
        report = client.get(f"/ai-recommendations/{created['id']}", headers=context.headers).json()
    finally:
        app.dependency_overrides[get_ai_runtime] = original
    assert report["is_current"] is True
    assert report["advice"] == created["advice"]
    assert report["display_order"] == created["display_order"]
    assert len(provider.calls) == 1
