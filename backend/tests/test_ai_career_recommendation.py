"""Model career direction is separate from strict applicant-condition outcomes."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.ai_recommendations.advice import derive_advice
from app.ai_recommendations.career import AUDIT_WORDS
from app.ai_recommendations.citations import resolve_assessment, source_catalog
from app.ai_recommendations.runtime import PROMPT_VERSION
from app.ai_recommendations.schemas import BatchAssessment, CareerFit
from app.ai_recommendations.service import validate_assessment
from tests import test_ai_recommendations as shared
from tests.ai_reference_fixtures import reference_fixture
from tests.test_ai_partial_evidence import partial_fixture
from tests.test_ai_source_references import fixture_payload, source_range, spans, wire

context = shared.context
provider = shared.provider


def model_career(payload, catalog, raw, *, direction="adjacent", verdict="consider"):
    fit = {
        "direction": direction,
        "proposed_verdict": verdict,
        "summary": "Your programming projects make this software role worth a try.",
        "jd_source_range": source_range(
            spans(catalog, scope="job", owner=payload["jobs"][0]["id"])
        ),
        "profile_field": "experience",
        "profile_source_range": source_range([spans(catalog, field="experience")[0]]),
        "job_focus": "Python",
        "profile_focus": "REST APIs",
        "strengths": [
            {"basis": "condition", "requirement_index": 0, "condition_index": 0, "text": "Python"}
        ],
        "considerations": [
            {
                "requirement_index": 0,
                "condition_index": 1,
                "text": "Prepare to discuss your Rust experience.",
            }
        ],
    }
    raw["items"][0]["career_fit"] = fit
    return fit


def evaluate(payload, catalog, raw):
    original = deepcopy(raw)
    result = validate_assessment(
        resolve_assessment(raw, payload, catalog), payload, allow_promotions=False
    )
    assert raw == original
    assessed = result.items[0]
    return assessed, derive_advice(assessed).application_recommendation


def test_partial_software_fit_is_consider_even_when_whole_conditions_remain_unknown():
    payload, catalog, raw = partial_fixture()
    model_career(payload, catalog, raw)
    result, application = evaluate(payload, catalog, raw)
    assert result.requirements[0].outcome == "unknown"
    assert (
        derive_advice(result).status == "check_first"
    )  # Legacy inspection state stays compatible.
    assert application.verdict == "consider" and application.strengths == ["Python"]
    assert "REST APIs" in application.summary and "Python" in application.summary
    assert "Rust" in application.considerations[0]
    assert not AUDIT_WORDS.search(
        " ".join([application.summary, *application.strengths, *application.considerations])
    )


def test_different_professional_direction_is_lower_priority_without_declaring_ineligibility():
    payload = fixture_payload()
    payload["jobs"][0]["description"] = "Coordinate hiring interviews and candidate communications."
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    row = raw["items"][0]["requirements"][0]
    row.update(
        requirement="Coordinate hiring interviews",
        outcome="unknown",
        category="experience",
        profile_field=None,
        profile_source_range=None,
        condition_operator="atomic",
        condition_checks=[
            {
                "condition": "Coordinate hiring interviews",
                "outcome": "unknown",
                "profile_field": None,
                "profile_source_range": None,
                "reason": "Not stated.",
            }
        ],
    )
    fit = model_career(payload, catalog, raw, direction="low", verdict="not_priority")
    fit.update(
        summary="This hiring-coordination role is less aligned with your software-project background.",
        job_focus="hiring interviews",
        profile_focus="REST APIs",
        strengths=[],
        considerations=[],
    )
    result, application = evaluate(payload, catalog, raw)
    assert application.verdict == "not_priority"
    assert "hiring interviews" in application.summary and "REST APIs" in application.summary
    assert not any(row.outcome == "gap" for row in result.requirements)
    assert not any(
        word in application.summary.lower() for word in ["ineligible", "lack", "unknown"]
    )


def test_missing_degree_detail_is_not_a_negative_qualification_claim_or_automatic_block():
    payload, catalog, raw = partial_fixture()
    item = raw["items"][0]
    education = deepcopy(item["requirements"][0])
    education.update(
        requirement="Penultimate-year computing student",
        category="education",
        outcome="unknown",
        profile_field=None,
        profile_source_range=None,
        condition_operator="atomic",
        condition_checks=[
            {
                "condition": "Penultimate-year student",
                "outcome": "unknown",
                "profile_field": None,
                "profile_source_range": None,
                "reason": "Not stated.",
            }
        ],
    )
    item["requirements"].append(education)
    fit = model_career(payload, catalog, raw)
    fit["considerations"].append(
        {
            "requirement_index": 1,
            "condition_index": 0,
            "text": "Check the required study year before applying.",
        }
    )
    result, application = evaluate(payload, catalog, raw)
    assert result.requirements[1].outcome == "unknown"
    assert application.verdict == "consider" and "study year" in application.considerations[0]


def test_one_language_atom_cannot_be_upgraded_into_priority_or_algorithms_strength():
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw, direction="direct", verdict="priority_apply")
    fit["strengths"][0]["text"] = "Strong algorithms expertise"
    fit["summary"] = "Your computing degree proves strong algorithms expertise."
    result, application = evaluate(payload, catalog, raw)
    assert application.verdict == "consider"
    assert not any(
        "algorithm" in text.lower() for text in [application.summary, *application.strengths]
    )
    assert "Python" in application.strengths[0]
    assert result.requirements[0].outcome == "unknown" and result.career_fit.server_adjusted


@pytest.mark.parametrize("direction,verdict", [("adjacent", "consider"), ("low", "not_priority")])
def test_source_focus_can_be_a_complete_action_phrase_without_broken_grammar(direction, verdict):
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw, direction=direction, verdict=verdict)
    fit["profile_focus"] = "Built REST APIs."
    _result, application = evaluate(payload, catalog, raw)
    assert "Related background: Built REST APIs." in application.summary
    assert "Role focus: Python." in application.summary
    assert (
        "Your Built" not in application.summary and "background in Built" not in application.summary
    )
    assert "APIs.." not in application.summary


def test_beneficial_core_requirement_cannot_manufacture_a_second_priority_basis():
    from tests.test_ai_action_advice import fact, item

    assessment = item([fact(text="Python"), fact(text="SQL familiarity is beneficial")])
    assessment.career_fit = CareerFit(
        direction="direct",
        proposed_verdict="priority_apply",
        summary="A possible priority.",
        jd_quote="Python",
        profile_field="skills",
        profile_quote="Python",
        job_focus="Python",
        profile_focus="Python",
        strengths=[],
        considerations=[],
    )
    application = derive_advice(assessment).application_recommendation
    assert (
        assessment.career_fit.proposed_verdict == "priority_apply"
        and application.verdict == "consider"
    )
    assert derive_advice(assessment).status == "consider"
    assessment.requirements[1].outcome = "unknown"
    assert derive_advice(assessment).application_recommendation.verdict == "consider"
    assert not any(
        "SQL" in note
        for note in derive_advice(assessment).application_recommendation.considerations
    )


def test_core_technology_cautions_precede_optional_tools_and_exclude_positive_python():
    from tests.test_ai_action_advice import fact, item

    algorithm = fact(outcome="unknown", text="Python and algorithms required")
    algorithm["condition_checks"] = [
        {
            "condition": "Python",
            "outcome": "supported",
            "profile_field": "skills",
            "profile_quote": "Python",
            "reason": "Listed.",
        },
        {
            "condition": "Algorithms",
            "outcome": "unknown",
            "profile_field": None,
            "profile_quote": None,
            "reason": "Not stated.",
        },
    ]
    fundamentals = fact(outcome="unknown", text="ML fundamentals")
    fundamentals["condition_checks"] = [
        {
            "condition": "Model evaluation",
            "outcome": "supported",
            "profile_field": "experience",
            "profile_quote": "Evaluated a model.",
            "reason": "Stated activity.",
        },
        {
            "condition": "Feature engineering",
            "outcome": "unknown",
            "profile_field": None,
            "profile_quote": None,
            "reason": "Not stated.",
        },
    ]
    assessment = item(
        [
            fact(),
            algorithm,
            fundamentals,
            fact(outcome="unknown", text="Cloud knowledge is a plus"),
            fact(category="responsibility", outcome="unknown", text="Deploy models"),
        ]
    )
    assessment.career_fit = CareerFit(
        direction="direct",
        proposed_verdict="consider",
        summary="A possible role.",
        jd_quote="Python",
        profile_field="skills",
        profile_quote="Python",
        job_focus="Python",
        profile_focus="Python",
        strengths=[],
        considerations=[
            {
                "requirement_index": 3,
                "condition_index": None,
                "text": "Prepare cloud platform examples.",
            },
            {
                "requirement_index": 4,
                "condition_index": None,
                "text": "Prepare deployment examples.",
            },
        ],
    )
    application = derive_advice(assessment).application_recommendation
    assert "Algorithms" in application.considerations[0]
    assert "Feature engineering" in application.considerations[1]
    assert all(
        "Python" not in note and "Model evaluation" not in note
        for note in application.considerations
    )
    assert len(application.considerations) == 3


def test_named_skill_projection_is_specific_and_does_not_rewrite_stored_career_fit():
    from tests.test_ai_action_advice import fact, item

    assessment = item(
        [
            {
                **fact(text="Familiarity with TensorFlow, PyTorch or HuggingFace"),
                "profile_quote": "PyTorch",
            }
        ]
    )
    assessment.career_fit = CareerFit(
        direction="direct",
        proposed_verdict="consider",
        summary="A possible role.",
        jd_quote=assessment.requirements[0].jd_quote,
        profile_field="skills",
        profile_quote="PyTorch",
        job_focus="PyTorch",
        profile_focus="PyTorch",
        strengths=[
            {
                "basis": "requirement",
                "requirement_index": 0,
                "condition_index": None,
                "text": "Familiarity with TensorFlow, PyTorch or HuggingFace",
            }
        ],
        considerations=[],
    )
    original = assessment.model_dump(mode="json")
    assert derive_advice(assessment).application_recommendation.strengths == ["PyTorch"]
    assert assessment.model_dump(mode="json") == original


def test_academic_project_is_not_relabelled_as_production_or_commercial_work():
    payload, catalog, raw = partial_fixture()
    raw["items"][0]["related_evidence"] = [
        {
            "requirement_index": 0,
            "profile_field": "experience",
            "profile_source_range": source_range([spans(catalog, field="experience")[0]]),
        }
    ]
    fit = model_career(payload, catalog, raw)
    fit["strengths"] = [
        {
            "basis": "related_activity",
            "requirement_index": 0,
            "condition_index": None,
            "text": "Production engineering experience",
        }
    ]
    fit["summary"] = "Your commercial production experience makes this role worth applying for."
    _result, application = evaluate(payload, catalog, raw)
    assert application.verdict == "consider"
    assert all(
        "production" not in text.lower() and "commercial" not in text.lower()
        for text in [application.summary, *application.strengths]
    )


@pytest.mark.parametrize("claim", ["advanced algorithms", "commercial production engineering"])
def test_arbitrary_summary_and_focus_cannot_turn_a_degree_into_extra_competence(claim):
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw)
    fit.update(
        profile_field="education",
        profile_source_range=source_range(spans(catalog, field="education")),
        profile_focus=claim,
        summary=f"Your {claim} background makes this role worth considering.",
        considerations=[],
    )
    result, application = evaluate(payload, catalog, raw)
    assert result.career_fit.profile_focus is None
    assert claim not in application.summary and application.verdict == "consider"


def test_unknown_condition_advice_cannot_assert_missing_qualification_or_add_dates():
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw)
    fit["considerations"][0]["text"] = "You cannot start on 22 June 2031."
    _result, application = evaluate(payload, catalog, raw)
    assert not any("2031" in text or "cannot" in text for text in application.considerations)
    assert "Rust" in application.considerations[0]


@pytest.mark.parametrize(
    "text",
    [
        "You lack production experience; prepare to discuss this role.",
        "You have production experience; prepare to discuss this role.",
        "The applicant is not qualified; consider another job.",
    ],
)
def test_advisory_suffix_cannot_smuggle_personal_claims_into_an_incomplete_condition(text):
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw)
    fit["considerations"][0]["text"] = text
    _result, application = evaluate(payload, catalog, raw)
    assert text not in application.considerations
    assert "Rust" in application.considerations[0]


@pytest.mark.parametrize(
    "attack", ["unknown_id", "cross_job", "cross_field", "index", "child_index", "extra"]
)
def test_career_judgment_preserves_strict_source_and_reference_boundaries(attack):
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw)
    if attack == "unknown_id":
        fit["profile_source_range"] = source_range(["unissued_source"])
    elif attack == "cross_job":
        fit["jd_source_range"] = source_range(
            spans(catalog, scope="job", owner=payload["jobs"][1]["id"])
        )
    elif attack == "cross_field":
        fit["profile_source_range"] = source_range(spans(catalog, field="education"))
    elif attack == "index":
        fit["strengths"][0]["requirement_index"] = 99
    elif attack == "child_index":
        fit["strengths"][0]["condition_index"] = 99
    else:
        fit["profile_quote"] = "A model-written citation is forbidden."
    with pytest.raises((ValueError, ValidationError)):
        evaluate(payload, catalog, raw)


def test_unsupported_condition_cannot_be_selected_as_a_strength():
    payload, catalog, raw = partial_fixture()
    fit = model_career(payload, catalog, raw)
    fit["strengths"][0].update(condition_index=1, text="Rust")
    _result, application = evaluate(payload, catalog, raw)
    assert not application.strengths


def test_historical_public_records_remain_readable_without_inventing_career_judgment():
    payload, catalog, raw = partial_fixture()
    public = resolve_assessment(raw, payload, catalog)
    for item in public["items"]:
        del item["career_fit"]
    result = BatchAssessment.model_validate(public)
    assert derive_advice(result.items[0]).application_recommendation is None
    assert "v11" in PROMPT_VERSION


def test_direct_fit_needs_distinct_core_ability_and_explicit_conflict_caps_priority():
    payload = fixture_payload()
    payload["jobs"][0]["description"] = "Python and SQL required."
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    rows = []
    for index, name in enumerate(["Python", "SQL"]):
        proof = source_range([spans(catalog, field="skills")[index]])
        rows.append(
            {
                "requirement": name,
                "category": "skill",
                "outcome": "supported",
                "jd_source_range": source_range(
                    spans(catalog, scope="job", owner=payload["jobs"][0]["id"])
                ),
                "profile_field": "skills",
                "profile_source_range": proof,
                "reason": "Explicit skill.",
                "condition_operator": "atomic",
                "condition_checks": [
                    {
                        "condition": name,
                        "outcome": "supported",
                        "profile_field": "skills",
                        "profile_source_range": proof,
                        "reason": "Explicit skill.",
                    }
                ],
            }
        )
    raw["items"][0]["requirements"] = rows
    fit = model_career(payload, catalog, raw, direction="direct", verdict="priority_apply")
    fit["considerations"] = []
    result = validate_assessment(
        resolve_assessment(raw, payload, catalog), payload, allow_promotions=False
    )
    assert derive_advice(result.items[0]).application_recommendation.verdict == "priority_apply"
    # Explicit contradiction is different from an omitted date or qualification.
    payload["profile"]["availability"] = "I cannot work full-time."
    payload["jobs"][0]["description"] += "\nFull-time work required."
    public = result.model_dump(mode="json")
    public["items"][0]["requirements"].append(
        {
            "requirement": "Full-time work required",
            "category": "work_constraint",
            "outcome": "gap",
            "jd_quote": "Full-time work required.",
            "profile_field": "availability",
            "profile_quote": "I cannot work full-time.",
            "reason": "Explicitly conflicting availability.",
        }
    )
    capped = validate_assessment(public, payload, allow_promotions=False)
    conflicted = next(item for item in capped.items if str(item.job_id) == payload["jobs"][0]["id"])
    assert derive_advice(conflicted).application_recommendation.verdict == "not_priority"


def test_new_application_advice_is_shared_by_batch_detail_and_free_cache_reads(
    client, context, provider
):
    import json

    def scripted(request):
        payload = json.loads(request.messages[-1].content)
        result = reference_fixture(shared.answer(context.jobs), payload)
        for item in result["items"]:
            current = item["requirements"][0]
            item["career_fit"].update(
                direction="direct",
                proposed_verdict="consider",
                job_focus="Python",
                profile_focus="Python",
                jd_source_range=current["jd_source_range"],
                profile_field=current["profile_field"],
                profile_source_range=current["profile_source_range"],
                strengths=[
                    {
                        "basis": "condition",
                        "requirement_index": 0,
                        "condition_index": 0,
                        "text": "Python",
                    }
                ],
            )
        return result

    provider.data = scripted
    batch = shared.post(client, context).json()
    assert batch["status"] == "succeeded" and batch["is_current"]
    key = str(context.jobs[0].id)
    application = batch["advice"][key]["application_recommendation"]
    assert application["verdict"] == "consider" and application["strengths"] == ["Python"]
    detail = client.get(f"/jobs/{key}/ai-assessment", headers=context.headers).json()
    assert detail["advice"]["application_recommendation"] == application
    repeated = shared.post(client, context).json()
    assert repeated["reused"] and len(provider.calls) == 1


def test_new_wire_response_requires_real_career_judgment_object():
    payload, catalog, raw = partial_fixture()
    del raw["items"][0]["career_fit"]
    with pytest.raises(ValidationError):
        resolve_assessment(raw, payload, catalog)
