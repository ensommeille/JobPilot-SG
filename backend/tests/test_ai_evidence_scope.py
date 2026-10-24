"""Offline scope regressions use invented people, tools and duties."""

from copy import deepcopy

import pytest

from app.ai_recommendations.advice import derive_advice
from app.ai_recommendations.citations import resolve_assessment, source_catalog
from app.ai_recommendations.service import validate_assessment
from tests.test_ai_action_advice import fact, item
from tests.test_ai_recommendation_semantics import evaluate, row
from tests.test_ai_source_references import fixture_payload, source_range, spans, wire


def test_degree_abbreviations_do_not_split_their_major_and_dates():
    payload = fixture_payload()
    education = (
        "Northern Institute — M.Tech. in Software Engineering 2026–Present\n"
        "Southern University — B.Eng. in Computing 2022–2026"
    )
    payload["profile"]["education"] = education
    catalog = source_catalog(payload)
    entries = [catalog[key] for key in spans(catalog, field="education")]
    assert [part.text[part.start : part.end] for part in entries] == education.splitlines()
    raw = wire(payload, catalog)
    required = "Pursuing a master's degree in software engineering"
    payload["jobs"][0]["description"] = required
    catalog = source_catalog(payload)
    current = raw["items"][0]["requirements"][0]
    education_range = source_range([spans(catalog, field="education")[0]])
    current.update(
        requirement=required,
        category="education",
        condition_operator="atomic",
        jd_source_range=source_range(spans(catalog, scope="job", owner=payload["jobs"][0]["id"])),
        profile_field="education",
        profile_source_range=education_range,
        condition_checks=[
            {
                "condition": "Pursuing a related master's degree",
                "outcome": "supported",
                "profile_field": "education",
                "profile_source_range": education_range,
                "reason": "The complete education entry records the degree and current status.",
            }
        ],
    )
    # The input identity changed, so refresh the other job's input-bound ID too.
    second = raw["items"][1]["requirements"][0]
    second["jd_source_range"] = source_range(
        spans(catalog, scope="job", owner=payload["jobs"][1]["id"])
    )
    resolved = resolve_assessment(raw, payload, catalog)
    assessed = validate_assessment(resolved, payload, allow_promotions=False)
    condition = assessed.items[0].requirements[0]
    assert condition.outcome == "supported"
    assert condition.profile_quote == education.splitlines()[0]
    assert "M.Tech." in condition.profile_quote and "Present" in condition.profile_quote


@pytest.mark.parametrize(
    "required",
    [
        "Used BuilderKit to build automations",
        "Build and train models using a framework",
        "Deploy services using a container tool",
        "Experience with application development",
    ],
)
def test_named_skill_is_not_raw_assessment_evidence_of_an_activity(required):
    assessed, original = evaluate([row(required, quote="BuilderKit")], skills=["BuilderKit"])
    assert assessed.items[0].requirements[0].outcome == "unknown"
    assert "hands-on activity" in assessed.items[0].requirements[0].reason
    assert original["items"][0]["requirements"][0]["outcome"] == "supported"


def test_project_heading_and_evaluation_do_not_prove_building_and_training():
    title = "Research Project — Tensor Library, Model Architectures"
    for quote in (title, "Evaluated models on an annotated dataset."):
        assessed, _ = evaluate(
            [
                row(
                    "Build and train models",
                    category="responsibility",
                    quote=quote,
                    field="experience",
                )
            ],
            experience=quote,
        )
        assert assessed.items[0].requirements[0].outcome == "unknown"


def test_explicit_build_and_train_actions_stay_supported_but_not_from_training_data():
    required = "Build and train models"
    quote = "Built and trained small models in a coursework project."
    assessed, _ = evaluate(
        [row(required, category="responsibility", quote=quote, field="experience")],
        experience=quote,
    )
    assert assessed.items[0].requirements[0].outcome == "supported"
    quote = "Built a viewer for training datasets."
    assessed, _ = evaluate(
        [row(required, category="responsibility", quote=quote, field="experience")],
        experience=quote,
    )
    assert assessed.items[0].requirements[0].outcome == "unknown"


def test_familiarity_with_a_named_tool_remains_supported():
    assessed, _ = evaluate(
        [row("Familiarity with BuilderKit", quote="BuilderKit")], skills=["BuilderKit"]
    )
    assert assessed.items[0].requirements[0].outcome == "supported"


def test_duty_without_a_known_verb_still_cannot_be_supported_by_a_bare_tool():
    assessed, _ = evaluate(
        [row("Experiment with a tool", category="responsibility", quote="BuilderKit")],
        skills=["BuilderKit"],
    )
    assert assessed.items[0].requirements[0].outcome == "unknown"


def test_students_and_graduates_is_not_reinterpreted_as_two_simultaneous_degrees():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    current = raw["items"][0]["requirements"][0]
    current.update(
        requirement="Open to students and graduates",
        category="education",
        condition_operator="atomic",
    )
    current["condition_checks"] = current["condition_checks"][:1]
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "supported"
    )


def test_related_nouns_and_negated_actions_are_not_performed_activity_evidence():
    for quote in ("Model evaluation project", "I did not evaluate models."):
        assessed, _ = evaluate(
            [row("Evaluate models", category="responsibility", quote=quote, field="experience")],
            experience=quote,
        )
        assert assessed.items[0].requirements[0].outcome == "unknown"
    quote = "Built API services without external frameworks."
    assessed, _ = evaluate(
        [row("Develop API services", category="responsibility", quote=quote, field="experience")],
        experience=quote,
    )
    assert assessed.items[0].requirements[0].outcome == "supported"


@pytest.mark.parametrize("operator", ["atomic", "any_of"])
def test_clear_and_cannot_be_weakly_supported_by_atomic_or_alternative_checks(operator):
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    current = raw["items"][0]["requirements"][0]
    current["condition_operator"] = operator
    if operator == "atomic":
        current["condition_checks"] = current["condition_checks"][:1]
    original = deepcopy(raw)
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "unknown"
    )
    assert raw == original


def test_a_genuine_or_keeps_one_complete_supported_branch():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    current = raw["items"][0]["requirements"][0]
    current["requirement"] = "REST APIs or SQL databases"
    current["condition_operator"] = "any_of"
    current["condition_checks"][1].update(
        outcome="unknown", profile_field=None, profile_source_range=None
    )
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "supported"
    )


def test_parenthetical_or_does_not_erase_outer_and():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    current = raw["items"][0]["requirements"][0]
    current["requirement"] = "REST APIs and databases (SQL or NoSQL)"
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "supported"
    )


def test_unknown_ordinary_skill_with_real_overlap_is_consider_not_eligibility_block():
    assessed = item([fact(), fact("skill", "unknown", "Familiarity with a second framework")])
    original = assessed.model_dump()
    advice = derive_advice(assessed)
    assert advice.status == "consider" and advice.counts.unknown == 1
    assert len(advice.reasons) <= 2
    assert "Familiarity with a second framework" in advice.blockers[0].requirement
    assert assessed.model_dump() == original


def test_unknown_mandatory_skill_or_time_still_needs_confirmation():
    for category, required in (
        ("skill", "Security clearance is mandatory"),
        ("work_constraint", "Onsite for six months"),
    ):
        assert (
            derive_advice(item([fact(), fact(category, "unknown", required)])).status
            == "check_first"
        )


def test_neighbouring_required_word_does_not_turn_an_ordinary_skill_into_a_gate():
    ordinary = fact("skill", "unknown", "Familiarity with cloud tools")
    ordinary["jd_quote"] = "At least one project is required. Familiarity with cloud tools."
    assert derive_advice(item([fact(), ordinary])).status == "consider"


def test_zero_to_three_fresh_graduate_route_is_not_a_missing_years_blocker():
    required = "0–3 years of software development experience (fresh graduates welcome)"
    assessed, _ = evaluate([row(required, category="experience", outcome="unknown", quote=None)])
    experience = assessed.items[0].requirements[0]
    assert experience.outcome == "unknown"  # No invented actual duration.
    assert "not a positive minimum-years barrier" in experience.reason
    advice = derive_advice(item([fact(), experience.model_dump()]))
    assert advice.status == "consider" and not advice.blockers


def test_positive_experience_range_uses_lower_bound_not_upper_bound():
    required = "1–3 years of development experience"
    quote = "2 years of development experience."
    assessed, _ = evaluate(
        [row(required, category="experience", quote=quote, field="experience")], experience=quote
    )
    assert assessed.items[0].requirements[0].outcome == "supported"
    quote = "1 year of development experience."
    assessed, _ = evaluate(
        [
            row(
                "At least 3 years of experience",
                category="experience",
                quote=quote,
                field="experience",
            )
        ],
        experience=quote,
    )
    assert assessed.items[0].requirements[0].outcome == "unknown"
