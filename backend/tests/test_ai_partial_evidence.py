"""Partial relevance stays cited and distinct from complete applicant requirements."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.ai_recommendations.advice import derive_advice
from app.ai_recommendations.citations import resolve_assessment, source_catalog
from app.ai_recommendations.prompts import SYSTEM_PROMPT
from app.ai_recommendations.runtime import PROMPT_VERSION
from app.ai_recommendations.service import validate_assessment
from tests.test_ai_source_references import fixture_payload, source_range, spans, wire


def partial_fixture():
    payload = fixture_payload()
    payload["jobs"][0]["description"] = (
        "Working knowledge of Python and Rust required.\n"
        "Penultimate-year computing student.\nAvailable full-time for 12 weeks."
    )
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    current = raw["items"][0]["requirements"][0]
    python = source_range([spans(catalog, field="skills")[0]])
    current.update(
        requirement="Working knowledge of Python and Rust required",
        outcome="unknown",
        profile_field="skills",
        profile_source_range=python,
        condition_operator="all_of",
        condition_checks=[
            {
                "condition": "Working knowledge of Python",
                "outcome": "supported",
                "profile_field": "skills",
                "profile_source_range": python,
                "reason": "Python is explicitly listed.",
            },
            {
                "condition": "Working knowledge of Rust",
                "outcome": "unknown",
                "profile_field": None,
                "profile_source_range": None,
                "reason": "Rust is not stated.",
            },
        ],
    )
    return payload, catalog, raw


def assessed(payload, catalog, raw):
    return validate_assessment(
        resolve_assessment(raw, payload, catalog), payload, allow_promotions=False
    ).items[0]


def test_partial_python_is_visible_without_supporting_the_full_and_or_raw_mutation():
    payload, catalog, raw = partial_fixture()
    original = deepcopy(raw)
    result = assessed(payload, catalog, raw)
    advice = derive_advice(result)
    assert result.requirements[0].outcome == "unknown"
    assert [check.outcome for check in result.requirements[0].condition_checks] == [
        "supported",
        "unknown",
    ]
    assert advice.counts.supported == 0 and not advice.strengths
    assert advice.status == "check_first" and "Relevant background" in advice.headline
    assert advice.related_evidence[0].profile_quote == "Python"
    assert advice.related_evidence[0].kind == "partial_condition"
    assert "Python" in advice.reasons[0] and "Rust" in advice.reasons[1]
    assert "0 supported" not in result.summary
    assert raw == original


def test_unknown_parent_never_promoted_even_when_every_check_has_evidence():
    payload, catalog, raw = partial_fixture()
    row = raw["items"][0]["requirements"][0]
    row["condition_checks"][1] = deepcopy(row["condition_checks"][0])
    result = assessed(payload, catalog, raw)
    assert all(check.outcome == "supported" for check in result.requirements[0].condition_checks)
    assert result.requirements[0].outcome == "unknown"
    assert derive_advice(result).counts.supported == 0


def test_activity_scope_is_applied_to_child_before_it_can_be_related_evidence():
    payload, catalog, raw = partial_fixture()
    row = raw["items"][0]["requirements"][0]
    row["condition_checks"][0]["condition"] = "Build systems using Python"
    result = assessed(payload, catalog, raw)
    assert result.requirements[0].condition_checks[0].outcome == "unknown"
    assert not derive_advice(result).related_evidence


def test_missing_parent_span_does_not_make_child_visible_as_supported():
    payload, catalog, raw = partial_fixture()
    row = raw["items"][0]["requirements"][0]
    row.update(profile_field=None, profile_source_range=None)
    assert not derive_advice(assessed(payload, catalog, raw)).related_evidence


@pytest.mark.parametrize("field", ["education", "skills", "experience"])
def test_computing_degree_python_or_api_project_does_not_prove_algorithms(field):
    payload, catalog, raw = partial_fixture()
    current = raw["items"][0]["requirements"][0]
    proof = source_range([spans(catalog, field=field)[0]])
    current.update(profile_field=field, profile_source_range=proof)
    current["condition_checks"][0].update(
        condition="Strong knowledge of data structures and algorithms",
        profile_field=field,
        profile_source_range=proof,
    )
    result = assessed(payload, catalog, raw)
    assert result.requirements[0].condition_checks[0].outcome == "unknown"
    assert not derive_advice(result).related_evidence


def test_partial_relevance_can_be_considered_without_manufacturing_full_support():
    payload, catalog, raw = partial_fixture()
    raw["items"][0]["requirements"][0]["requirement"] = "Working knowledge of Python and Rust"
    result = assessed(payload, catalog, raw)
    advice = derive_advice(result)
    assert advice.status == "consider" and advice.counts.supported == 0
    assert not advice.strengths and advice.related_evidence


def test_stretch_verdict_names_positive_evidence_and_technical_and_eligibility_limits():
    payload, catalog, raw = partial_fixture()
    result = assessed(payload, catalog, raw)
    template = result.requirements[0].model_copy(deep=True)
    for category, requirement in [
        ("education", "Penultimate-year computing student"),
        ("work_constraint", "Available full-time for 12 weeks"),
    ]:
        new = template.model_copy(
            update={
                "requirement": requirement,
                "category": category,
                "condition_checks": [],
                "profile_field": None,
                "profile_quote": None,
            }
        )
        result.requirements.append(new)
    advice = derive_advice(result)
    assert advice.headline == "Relevant background, but a stretch application"
    assert len(advice.reasons) == 2 and "Python" in advice.reasons[0]
    assert all(term in advice.reasons[1] for term in ["Rust", "Penultimate", "full-time"])
    assert advice.counts.supported == 0 and not advice.strengths


def test_related_actual_project_is_separate_from_full_requirement_and_duties_strength():
    payload, catalog, raw = partial_fixture()
    raw["items"][0]["related_evidence"] = [
        {
            "requirement_index": 0,
            "profile_field": "experience",
            "profile_source_range": source_range([spans(catalog, field="experience")[0]]),
        }
    ]
    result = assessed(payload, catalog, raw)
    advice = derive_advice(result)
    activity = next(entry for entry in advice.related_evidence if entry.kind == "related_activity")
    assert activity.profile_quote == "Built REST APIs."
    assert "not proof" in activity.reason and activity.condition_index is None
    assert advice.counts.supported == 0 and not advice.strengths
    assert advice.status != "priority_apply"


@pytest.mark.parametrize("attack", ["unknown", "cross_field", "bad_index", "extra_claim"])
def test_related_references_retain_strict_source_and_schema_guards(attack):
    payload, catalog, raw = partial_fixture()
    activity = {
        "requirement_index": 0,
        "profile_field": "experience",
        "profile_source_range": source_range([spans(catalog, field="experience")[0]]),
    }
    if attack == "unknown":
        activity["profile_source_range"] = source_range(["unissued"])
    elif attack == "cross_field":
        activity["profile_source_range"] = source_range(spans(catalog, field="education"))
    elif attack == "bad_index":
        activity["requirement_index"] = 1
    else:
        activity["claim"] = "Production expertise"
    raw["items"][0]["related_evidence"] = [activity]
    with pytest.raises((ValueError, ValidationError)):
        assessed(payload, catalog, raw)


@pytest.mark.parametrize(
    "experience", ["Python, Rust, SQL", "Backend project title", "Never built systems."]
)
def test_titles_tools_and_negated_actions_do_not_create_project_relevance(experience):
    payload, _, _ = partial_fixture()
    payload["profile"]["experience"] = experience
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    raw["items"][0]["related_evidence"] = [
        {
            "requirement_index": 0,
            "profile_field": "experience",
            "profile_source_range": source_range(spans(catalog, field="experience")),
        }
    ]
    assert not assessed(payload, catalog, raw).related_evidence


def test_current_prompt_preserves_atoms_and_separates_training_from_prior_qualifications():
    assert "v11" in PROMPT_VERSION
    assert "POSITIVE CONDITIONS" in SYSTEM_PROMPT
    assert "at most THREE" in SYSTEM_PROMPT and "related_evidence" in SYSTEM_PROMPT
    assert "training programme" in SYSTEM_PROMPT and "not a supported requirement" in SYSTEM_PROMPT
