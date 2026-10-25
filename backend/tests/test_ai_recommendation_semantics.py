"""Synthetic semantic boundary regressions; no personal CV and no model/network calls."""

from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.ai_recommendations import runtime
from app.ai_recommendations.models import AIRecommendationRun
from app.ai_recommendations.prompts import ROW_EXAMPLE, SYSTEM_PROMPT
from app.ai_recommendations.schemas import RequirementAssessment
from app.ai_recommendations.service import validate_assessment
from tests import test_ai_recommendations as shared

context = shared.context
provider = shared.provider
post = shared.post

COHORT = (
    "Full-time undergraduate student studying computer science or a related field, graduating 2028"
)
EDUCATION = "M.Tech. in Software Engineering 2026 – Present\nB.Eng. in Computer Science 2022 – 2026"
DISTILLATION = (
    "Have hands on experience with diffusion models, flow-based models, model distillation, "
    "reinforcement learning, preference optimization, or related post-training techniques"
)
EXPERIMENT = "Evaluated a teacher model and a student model; analyzed distillation settings in a research project."


def row(jd, *, category="skill", outcome="supported", quote="Python", field="skills"):
    return {
        "requirement": jd,
        "category": category,
        "outcome": outcome,
        "jd_quote": jd,
        "profile_field": field if quote else None,
        "profile_quote": quote,
        "reason": "Synthetic scripted assessment for a boundary test.",
    }


def evaluate(rows, *, education=EDUCATION, experience=EXPERIMENT, skills=None):
    """Put each assessed condition in a separate job to exercise stable batch priority."""
    data = {"requires_review": True, "items": []}
    payload = {
        "profile": {
            "education": education,
            "experience": experience,
            "skills": skills or ["Python", "Git"],
        },
        "jobs": [],
    }
    for rank, condition in enumerate(rows, 1):
        job_id = str(uuid4())
        payload["jobs"].append({"id": job_id, "description": condition["jd_quote"]})
        data["items"].append(
            {
                "job_id": job_id,
                "rank": rank,
                "summary": "Strong fit. The degree condition is uncertain even when supported.",
                "requirements": [condition],
                "warnings": [],
            }
        )
    original = deepcopy(data)
    result = validate_assessment(data, payload)
    assert data == original  # Validation creates a new result; raw provider output is preserved.
    return result, original


def test_course_dates_trigger_review_priority_without_inventing_degree_completion():
    assessed, raw = evaluate(
        [
            row(
                COHORT, category="education", outcome="unknown", quote=EDUCATION, field="education"
            ),
            row("Python required"),
        ]
    )
    assert str(assessed.items[-1].job_id) == raw["items"][0]["job_id"]
    condition = assessed.items[-1].requirements[0]
    assert condition.outcome == "unknown"
    assert "2028" in condition.reason and "2026" in condition.reason
    assert "does not establish degree completion" in condition.reason
    assert "Strong fit" not in assessed.items[-1].summary
    assert assessed.items[-1].summary.startswith("Education timing needs confirmation")
    assert "Lower priority" in assessed.items[-1].summary


def test_explicit_different_undergraduate_graduation_date_is_a_quoted_gap():
    education = "B.Eng. in Computing, graduated in 2026.\nM.Tech. 2026 – Present"
    assessed, _ = evaluate(
        [row(COHORT, category="education", outcome="unknown", quote=education, field="education")],
        education=education,
    )
    condition = assessed.items[0].requirements[0]
    assert condition.outcome == "gap"
    assert condition.profile_quote == education
    assert "explicit graduation/completion date" in condition.reason
    assert "These explicit dates conflict" in condition.reason


@pytest.mark.parametrize(
    ("jd", "education"),
    [
        (COHORT, "B.Eng. Computer Science, expected graduation 2028"),
        (COHORT, "M.Tech. in Software Engineering 2026 – Present"),
        (COHORT, "B.Eng. Computer Science"),
        (COHORT, EDUCATION + "\nBSc second degree, dates not provided"),
        (COHORT + ", preferred", EDUCATION),
        ("Undergraduate graduating 2028 or a master's student", EDUCATION),
        ("Undergraduate graduating 2028 or an MSc student", EDUCATION),
        ("Undergraduate graduating 2028 or equivalent experience", EDUCATION),
    ],
)
def test_missing_dates_matching_cohort_and_alternative_education_do_not_become_conflicts(
    jd, education
):
    assessed, raw = evaluate(
        [
            row(jd, category="education", outcome="unknown", quote=education, field="education"),
            row("Python required"),
        ],
        education=education,
    )
    assert str(assessed.items[0].job_id) == raw["items"][0]["job_id"]
    assert assessed.items[0].requirements[0].outcome == "unknown"
    assert not assessed.items[0].warnings


def test_explicit_work_constraint_gap_is_lower_priority_but_missing_availability_is_not():
    experience = "I cannot work full-time."
    assessed, raw = evaluate(
        [
            row(
                "Full-time availability required",
                category="work_constraint",
                outcome="gap",
                quote=experience,
                field="experience",
            ),
            row(
                "Available for twelve weeks", category="work_constraint", outcome="gap", quote=None
            ),
            row("Python required"),
        ],
        experience=experience,
    )
    assert [str(item.job_id) for item in assessed.items] == [
        raw["items"][i]["job_id"] for i in (1, 2, 0)
    ]
    assert [item.rank for item in assessed.items] == [1, 2, 3]
    assert assessed.items[0].requirements[0].outcome == "unknown"
    assert assessed.items[-1].requirements[0].outcome == "gap"


@pytest.mark.parametrize(
    ("jd", "quote"),
    [
        ("Knowledge of Git and GitHub", "Git"),
        ("Knowledge of Git and GitHub", "GitHub"),
        (
            "Proficient in Python and have hands-on experience with PyTorch, JAX, or another modern machine learning framework",
            "Python",
        ),
    ],
)
def test_single_skill_quote_cannot_support_the_complete_explicit_and_condition(jd, quote):
    assessed, _ = evaluate([row(jd, quote=quote)], skills=[quote])
    assert assessed.items[0].requirements[0].outcome == "unknown"
    assert "AND condition" in assessed.items[0].requirements[0].reason


def test_source_contiguous_quote_covering_git_and_github_is_preserved():
    experience = "Built a project using Git and GitHub."
    assessed, _ = evaluate(
        [row("Knowledge of Git and GitHub", quote=experience, field="experience")],
        experience=experience,
    )
    assert assessed.items[0].requirements[0].outcome == "supported"


def test_longer_git_quote_does_not_establish_the_github_half():
    experience = "Used Git in a project."
    assessed, _ = evaluate(
        [row("Knowledge of Git and GitHub", quote=experience, field="experience")],
        experience=experience,
    )
    assert assessed.items[0].requirements[0].outcome == "unknown"


def test_teacher_student_experiment_supports_the_generic_or_branch():
    assessed, _ = evaluate(
        [row(DISTILLATION, outcome="unknown", quote=EXPERIMENT, field="experience")]
    )
    condition = assessed.items[0].requirements[0]
    assert condition.outcome == "supported"
    assert "OR branch" in condition.reason
    assert "domain-specific video work" in condition.reason


@pytest.mark.parametrize(
    ("jd", "quote", "category"),
    [
        (DISTILLATION, "Read an article mentioning distillation.", "skill"),
        (
            DISTILLATION,
            "Evaluated a teacher and a student model; no distillation was performed.",
            "skill",
        ),
        (
            DISTILLATION,
            "Analyzed descriptions of teacher and student distillation, but never ran it.",
            "skill",
        ),
        (DISTILLATION + " and production deployment", EXPERIMENT, "skill"),
        (DISTILLATION + " for video generation", EXPERIMENT, "skill"),
        ("Develop model distillation or video diffusion research", EXPERIMENT, "responsibility"),
    ],
)
def test_or_rule_does_not_promote_mentions_compound_conditions_or_specialized_duties(
    jd, quote, category
):
    assessed, _ = evaluate(
        [row(jd, category=category, outcome="unknown", quote=quote, field="experience")],
        experience=quote,
    )
    assert assessed.items[0].requirements[0].outcome == "unknown"


def test_summary_is_regenerated_from_validated_degree_outcome_without_false_uncertainty():
    education = "M.Tech. in Software Engineering, enrolled 2026 – Present"
    assessed, _ = evaluate(
        [
            row(
                "Pursuing a master's degree in software engineering",
                category="education",
                quote=education,
                field="education",
            )
        ],
        education=education,
    )
    assert assessed.items[0].requirements[0].outcome == "supported"
    assert "Limited evidence of a relevant fit" in assessed.items[0].summary
    assert "0 supported" not in assessed.items[0].summary
    assert "uncertain" not in assessed.items[0].summary


def test_new_prompt_uses_new_cache_identity_and_preserves_legacy_result(
    client, db, context, provider, monkeypatch
):
    current = runtime.PROMPT_VERSION
    monkeypatch.setattr(runtime, "PROMPT_VERSION", "ai-recommendation-v1")
    original = post(client, context).json()
    monkeypatch.setattr(runtime, "PROMPT_VERSION", current)
    revised = post(client, context).json()
    assert original["status"] == revised["status"] == "succeeded"
    assert original["id"] != revised["id"]
    assert original["input_hash"] != revised["input_hash"]
    assert revised["prompt_version"] == current
    assert len(provider.calls) == 2
    assert db.scalar(select(func.count()).select_from(AIRecommendationRun)) == 2
    legacy = client.get(f"/ai-recommendations/{original['id']}", headers=context.headers).json()
    assert legacy["result"] == original["result"]
    assert legacy["prompt_version"] == "ai-recommendation-v1"


def test_maximum_length_model_reason_remains_valid_after_a_conservative_downgrade():
    condition = row("An unstated ability", outcome="gap", quote=None)
    condition["reason"] = "x" * 2000
    assessed, _ = evaluate([condition])
    fact = assessed.items[0].requirements[0]
    assert fact.outcome == "unknown"
    assert len(fact.reason) <= 2000
    assert fact.reason.startswith("Server evidence correction:")
    assert "Missing information remains unknown; confirm the stated condition." in fact.reason
    assert "x" * 100 not in fact.reason
    assert type(assessed).model_validate(assessed.model_dump(mode="json")) == assessed


@pytest.mark.parametrize("category", ["skill", "work_constraint", "responsibility"])
@pytest.mark.parametrize(
    "missing",
    [key for key, field in RequirementAssessment.model_fields.items() if field.is_required()],
)
def test_every_category_requires_every_row_key_without_defaults(category, missing):
    condition = {**ROW_EXAMPLE, "category": category}
    del condition[missing]
    with pytest.raises(ValidationError):
        RequirementAssessment.model_validate(condition)


def test_prompt_complete_row_example_matches_the_actual_strict_schema():
    assert set(ROW_EXAMPLE) == {
        key for key, field in RequirementAssessment.model_fields.items() if field.is_required()
    }
    assert RequirementAssessment.model_validate(ROW_EXAMPLE).outcome == "unknown"
    assert "EVERY responsibility and work_constraint" in SYSTEM_PROMPT
    assert "ALL NINE keys" in SYSTEM_PROMPT


@pytest.mark.parametrize("quote", ["Python", "PyTorch", "Built Python APIs."])
def test_python_and_framework_requires_both_branches_in_the_displayed_quote(quote):
    jd = "Proficient in Python and have hands-on experience with PyTorch, JAX, or another modern machine learning framework"
    assessed, _ = evaluate([row(jd, quote=quote, field="experience")], experience=quote)
    assert assessed.items[0].requirements[0].outcome == "unknown"


def test_python_and_framework_allows_an_explicit_alternative_in_a_complete_quote():
    quote = "Built a Python research project using TensorFlow."
    jd = "Proficient in Python and have hands-on experience with PyTorch, JAX, or another modern machine learning framework"
    assessed, _ = evaluate([row(jd, quote=quote, field="experience")], experience=quote)
    assert assessed.items[0].requirements[0].outcome == "supported"


def test_python_skill_does_not_establish_a_separate_interest_in_large_scale_ml():
    jd = "Are proficient in Python and interested in building reliable systems for large-scale machine learning"
    assessed, _ = evaluate([row(jd, quote="Python")])
    assert assessed.items[0].requirements[0].outcome == "unknown"
