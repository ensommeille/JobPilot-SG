"""Clipped model quotes must preserve source meaning and token boundaries."""

from types import SimpleNamespace

import pytest

from app.job_extraction.models import JobExtractionSchema
from app.job_matching import compare, quote_contexts, skill_overlaps
from app.skill_signals import positive_profile


def analysis(label, quote, description, skills):
    data = JobExtractionSchema.model_validate(
        {
            "summary": None,
            "responsibilities": [],
            "required_skills": [{"value": label, "evidence": quote}],
            "preferred_skills": [],
            "required_qualifications": [],
            "preferred_qualifications": [],
            "languages": [],
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
            "experience": {"requirement": None, "minimum_years": None},
        }
    )
    return compare(SimpleNamespace(extraction=data), description, SimpleNamespace(skills=skills))[0]


@pytest.mark.parametrize(
    "label,quote,description",
    [
        ("Java", "Java", "JavaScript required."),
        ("Python", "Python", "Pythonic style is preferred."),
        ("C", "C", "C++ required."),
        ("Excel", "excel", "We excel at teamwork."),
        ("Go", "Go", "Go beyond expectations."),
        ("React", "React", "React to customer feedback."),
        ("Microsoft Office", "Office", "Work at the Office."),
    ],
)
def test_clipped_words_are_not_skills_or_gaps(label, quote, description):
    assert skill_overlaps(label, quote, description, positive_profile([label])) == []
    for skills in ([label], [f"No {label}"]):
        item = analysis(label, quote, description, skills)
        assert item.outcome == "unknown"
        assert item.skill_overlaps == []


@pytest.mark.parametrize(
    "description",
    [
        "Python, SQL required.",
        "Comfortable using Python.",
        "Extensive Python knowledge.",
        "Python development experience.",
        "Python for at least three years.",
    ],
)
def test_clipped_compound_or_qualified_context_is_only_overlap(description):
    item = analysis("Python", "Python", description, ["Python"])
    assert item.outcome == "unknown"
    assert [overlap.skill_id for overlap in item.skill_overlaps] == ["python"]


def test_complete_quote_does_not_borrow_next_sentence_negation():
    description = "Python required. No Java needed."
    assert quote_contexts(description, "Python required.") == ["Python required."]
    item = analysis("Python", "Python required.", description, ["Python"])
    assert item.outcome == "supported"


def test_conflicting_duplicate_quote_contexts_fail_closed():
    description = "Python required. No Python needed for support roles."
    item = analysis("Python", "Python", description, ["Python"])
    assert item.outcome == "unknown"
    assert item.skill_overlaps == []


def test_complete_jd_line_does_not_borrow_learning_goal_from_next_bullet():
    quote = "Basic Canva skills, an eye for clear layouts and familiarity with spreadsheets"
    description = quote + "\nWilling to learn, ask questions and communicate progress"
    item = analysis(quote, quote, description, ["Canva"])
    assert item.outcome == "unknown"  # Compound requirements are not proven.
    assert [overlap.skill_id for overlap in item.skill_overlaps] == ["canva"]
    assert item.job_evidence == quote


def test_duplicate_complete_line_does_not_hide_a_negative_context():
    description = "Canva required\nNo Canva required"
    item = analysis("Canva", "Canva required", description, ["Canva"])
    assert item.outcome == "unknown"
    assert item.skill_overlaps == []


def test_unrelated_valid_skill_cannot_rescue_clipped_longer_token():
    assert quote_contexts("JavaScript required; Java preferred.", "JavaS") == []


def test_unknown_and_neither_statements_never_become_positive():
    for description in ("Neither Python nor SQL is required.", "Python requirements are unknown."):
        item = analysis("Python", "Python", description, ["Python"])
        assert item.outcome == "unknown"
        assert item.skill_overlaps == []
