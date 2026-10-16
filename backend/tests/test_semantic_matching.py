"""New v2 semantic boundaries, using synthetic fixtures rather than employer data."""

# Imported pytest fixtures are injected by their argument names.
# ruff: noqa: F811

from copy import deepcopy
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.job_extraction.models import JobExtractionSchema, JobExtractionSchemaV2
from app.job_extraction.persistence import job_input
from app.job_extraction.quality import assess_quality
from app.job_matching import compare, compare_work_constraints
from app.job_recommendations import specific_overlap_ids
from tests.test_job_matching import sample as matching_sample  # noqa: F401


def atom(value, *, kind="skill", evidence=None, qualifier=None):
    return {"kind": kind, "value": value, "evidence": evidence or value, "qualifier": qualifier}


def group(*atoms, operator="all_of", value=None, evidence=None):
    label = value or " and ".join(item["value"] for item in atoms)
    return {
        "value": label,
        "evidence": evidence or label,
        "importance": "required",
        "operator": operator,
        "requirements": list(atoms),
    }


def schema(*groups, constraints=None, duties=None, summary=None):
    return JobExtractionSchemaV2.model_validate(
        {
            "summary": summary,
            "responsibilities": duties or [],
            "requirement_groups": list(groups),
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
            "experience": {"requirement": None, "minimum_years": None},
            "work_constraints": {
                "schedule": None,
                "hours": None,
                "minimum_duration": None,
                "work_modes": [],
                "locations": [],
                **(constraints or {}),
            },
        }
    )


def compare_data(data, description, skills):
    return compare(SimpleNamespace(extraction=data), description, SimpleNamespace(skills=skills))


@pytest.mark.parametrize("operator", ["all_of", "any_of", "unspecified"])
@pytest.mark.parametrize("skills", [["Python"], ["Python", "SQL"]])
def test_compound_retains_each_condition_without_claiming_complete_satisfaction(operator, skills):
    source = "Python and SQL required."
    data = schema(group(atom("Python"), atom("SQL"), operator=operator, evidence=source))
    item = compare_data(data, source, skills)[0]
    assert item.outcome == "unknown"
    assert item.group_operator == operator
    assert [condition.requirement for condition in item.conditions] == ["Python", "SQL"]
    assert [condition.outcome for condition in item.conditions] == ["unknown", "unknown"]
    assert specific_overlap_ids([item]) == {value.casefold() for value in skills}
    if skills == ["Python"]:
        assert item.conditions[1].skill_overlaps == []
        assert item.conditions[1].profile_evidence is None


@pytest.mark.parametrize(
    "label,source",
    [
        ("Python and SQL", "Python required.\nSQL required."),
        ("Python", "Python required.\nSQL required."),
        ("Python or SQL", "Python required.\nSQL required."),
        ("Advanced Python", "Python required."),
    ],
)
def test_model_omitting_a_group_condition_cannot_make_whole_group_supported(label, source):
    data = schema(group(atom("Python", evidence="Python required."), value=label, evidence=source))
    item = compare_data(data, source, ["Python"])[0]
    assert item.outcome == "unknown"
    assert item.conditions[0].outcome == "unknown"
    assert specific_overlap_ids([item]) == {"python"}


@pytest.mark.parametrize(
    "label,source",
    [
        ("Interest in Python", "Python required."),
        ("Python", "Python required.\nNo prior Python knowledge needed."),
    ],
)
def test_child_quote_cannot_hide_group_interest_or_negative_wording(label, source):
    data = schema(group(atom("Python", evidence="Python required."), value=label, evidence=source))
    item = compare_data(data, source, ["Python"])[0]
    assert item.outcome == "unknown"
    assert item.skill_overlaps == []


@pytest.mark.parametrize("kind", ["interest", "trait", "qualification", "language"])
def test_non_skill_atoms_cannot_borrow_a_concrete_skill_name_for_ranking(kind):
    source = "Python required."
    data = schema(group(atom("Python", kind=kind, evidence=source), evidence=source))
    item = compare_data(data, source, ["Python"])[0]
    assert item.outcome == "unknown"
    assert item.skill_overlaps == []
    assert specific_overlap_ids([item]) == set()


def test_model_skill_label_does_not_turn_a_general_trait_into_a_ranked_skill():
    source = "Communication required."
    data = schema(group(atom("Communication", evidence=source), evidence=source))
    item = compare_data(data, source, ["Communication", "Python"])[0]
    assert item.skill_overlaps == []
    assert item.outcome == "unknown"


@pytest.mark.parametrize("entry", ["想学 Python", "正在学 Python", "Currently learning Python"])
def test_v2_uses_existing_learning_goal_guard_without_treating_it_as_a_new_fix(entry):
    source = "Python required."
    data = schema(group(atom("Python", evidence=source), evidence=source))
    assert compare_data(data, source, [entry])[0].skill_overlaps == []


def test_v2_reuses_existing_canva_line_boundary_fix():
    quote = "Basic Canva skills, an eye for clear layouts and familiarity with spreadsheets"
    source = quote + "\nWilling to learn, ask questions and communicate progress"
    data = schema(group(atom("Canva", evidence=quote), evidence=quote))
    item = compare_data(data, source, ["Canva"])[0]
    assert specific_overlap_ids([item]) == {"canva"}
    assert item.outcome == "unknown"


def test_qualifier_is_retained_and_does_not_become_verified_proficiency():
    source = "Advanced Python required."
    qualifier = {"value": "Advanced", "evidence": "Advanced Python required."}
    data = schema(group(atom("Python", evidence=source, qualifier=qualifier), evidence=source))
    item = compare_data(data, source, ["Python"])[0]
    assert item.outcome == "unknown"
    assert item.conditions[0].qualifier == "Advanced"
    assert item.conditions[0].qualifier_evidence == source
    assert specific_overlap_ids([item]) == {"python"}


@pytest.mark.parametrize("missing", ["group", "atom", "qualifier"])
def test_unbacked_group_atom_or_qualifier_does_not_contribute_overlap(missing):
    source = "Advanced Python required."
    data = schema(
        group(
            atom(
                "Python",
                evidence="Not in source" if missing == "atom" else source,
                qualifier={
                    "value": "Advanced",
                    "evidence": "Not in source" if missing == "qualifier" else source,
                },
            ),
            evidence="Not in source" if missing == "group" else source,
        )
    )
    assert compare_data(data, source, ["Python"])[0].skill_overlaps == []


def test_language_aliases_and_cross_field_duplicates_have_no_extra_row_or_rank():
    source = "Python required. Mandarin required."
    data = schema(
        group(atom("Python", evidence="Python required."), evidence="Python required."),
        group(
            atom("Mandarin", kind="skill", evidence="Mandarin required."),
            evidence="Mandarin required.",
        ),
        group(
            atom("Mandarin Chinese", kind="language", evidence="Mandarin required."),
            evidence="Mandarin required.",
        ),
    )
    items = compare_data(data, source, ["Python", "Mandarin"])
    assert len(items) == 2
    assert specific_overlap_ids(items) == {"python"}
    assert (
        len(
            [
                condition
                for item in items
                for condition in item.conditions
                if "Mandarin" in condition.requirement
            ]
        )
        == 1
    )


def test_distinct_skill_ids_deduplicate_across_groups_and_aliases():
    source = "JavaScript required. JS preferred."
    data = schema(
        group(atom("JavaScript", evidence="JavaScript required."), evidence="JavaScript required."),
        group(atom("JS", evidence="JS preferred."), evidence="JS preferred."),
    )
    items = compare_data(data, source, ["JavaScript"])
    assert specific_overlap_ids(items) == {"javascript"}


def test_source_constraints_keep_scope_but_availability_always_remains_unknown():
    source = (
        "Part-time applicants work 24 hours per week, Monday to Friday. "
        "Commit at least 3 months. No remote or hybrid work. Based in Singapore."
    )
    data = schema(
        constraints={
            "schedule": {"value": "Monday to Friday", "evidence": "Monday to Friday"},
            "hours": {
                "minimum": 24.0,
                "maximum": 24.0,
                "unit": "hours_per_week",
                "evidence": "24 hours per week",
                "condition": {"value": "Part-time applicants", "evidence": "Part-time applicants"},
            },
            "minimum_duration": {
                "value": 3.0,
                "unit": "months",
                "evidence": "at least 3 months",
                "condition": None,
            },
            "work_modes": [
                {
                    "value": "remote",
                    "allowed": False,
                    "evidence": "No remote or hybrid work",
                    "condition": None,
                },
                {
                    "value": "hybrid",
                    "allowed": False,
                    "evidence": "No remote or hybrid work",
                    "condition": None,
                },
            ],
            "locations": [{"value": "Singapore", "evidence": "Based in Singapore"}],
        }
    )
    items = compare_work_constraints(data, source)
    assert len(items) == 5
    assert all(item.outcome == "unknown" and not item.skill_overlaps for item in items)
    assert all("No feasibility conclusion" in item.reason for item in items)
    assert "Part-time applicants" in items[1].requirement
    assert "3 months" in items[2].requirement
    assert "remote: not allowed" in items[3].requirement
    assert "hybrid: not allowed" in items[3].requirement


def test_missing_constraints_are_explicit_unknown_for_v2_and_legacy():
    legacy = JobExtractionSchema.model_validate(
        {
            "summary": None,
            "responsibilities": [],
            "required_skills": [],
            "preferred_skills": [],
            "required_qualifications": [],
            "preferred_qualifications": [],
            "languages": [],
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
            "experience": {"requirement": None, "minimum_years": None},
        }
    )
    for data in (schema(), legacy):
        items = compare_work_constraints(data, "Python required.")
        assert len(items) == 5
        assert all(item.outcome == "unknown" and "not stated" in item.requirement for item in items)
        assert all("Singapore" not in item.requirement for item in items)


def test_model_days_per_week_cannot_be_displayed_as_verified_hours():
    source = "Able to work at least 4 days a week."
    data = schema(
        constraints={
            "hours": {
                "minimum": 4.0,
                "maximum": None,
                "unit": "hours_per_week",
                "evidence": source,
                "condition": None,
            }
        }
    )
    item = compare_work_constraints(data, source)[1]
    assert item.outcome == "unknown"
    assert item.requirement == "Hours: extracted number/unit requires review"
    assert "Days per week are not hours per week" in item.reason
    assert item.job_evidence == source
    assert data.work_constraints.hours.minimum == 4.0  # Raw result is not rewritten.


def test_model_duration_unit_mismatch_is_flagged_without_rewriting_raw_result():
    source = "Commit at least 3 weeks."
    data = schema(
        constraints={
            "minimum_duration": {
                "value": 3.0,
                "unit": "months",
                "evidence": source,
                "condition": None,
            }
        }
    )
    item = compare_work_constraints(data, source)[2]
    assert item.outcome == "unknown"
    assert item.requirement == "Minimum duration: extracted number/unit requires review"
    assert "No conversion" in item.reason
    assert item.job_evidence == source
    assert data.work_constraints.minimum_duration.unit == "months"


def upgrade_fixture(db, fixture, data, source):
    _, job, run = fixture
    job.description = source
    current = job_input(job)
    result = deepcopy(run.result_json)
    result.update(
        input_hash=current.input_hash,
        schema_version="job-extraction-v2",
        prompt_version="job-extraction-prompt-v2",
        execution_mode="live",
        extraction=data.model_dump(),
        quality=assess_quality(data, source).model_dump(),
    )
    run.input_hash = current.input_hash
    run.input_json = current.model_dump()
    run.result_json = result
    db.commit()


def test_v2_http_exposes_conditions_duties_and_constraints_without_mutation(
    client, db, matching_sample
):
    fixture = matching_sample
    source = "Python and SQL required. Primary: build APIs. If time permits, write docs."
    data = schema(
        group(atom("Python"), atom("SQL"), evidence="Python and SQL required."),
        summary={"value": "Build APIs", "evidence": "build APIs"},
        duties=[
            {
                "value": "Build APIs",
                "evidence": "Primary: build APIs.",
                "priority": "primary",
                "condition": None,
            },
            {
                "value": "Write docs",
                "evidence": "If time permits, write docs.",
                "priority": "conditional",
                "condition": {"value": "If time permits", "evidence": "If time permits"},
            },
        ],
    )
    upgrade_fixture(db, fixture, data, source)
    client.put("/profile", headers=fixture[0], json={"skills": ["Python"]})
    before = deepcopy(fixture[2].result_json)
    response = client.post(f"/jobs/{fixture[1].id}/match-analysis", headers=fixture[0], json={})
    assert response.status_code == 200
    report = response.json()
    assert report["items"][0]["outcome"] == "unknown"
    assert len(report["items"][0]["conditions"]) == 2
    assert [duty["priority"] for duty in report["responsibilities"]] == ["primary", "conditional"]
    assert report["responsibilities"][1]["condition"]["value"] == "If time permits"
    assert report["summary"]["value"] == "Build APIs"
    assert len(report["work_constraints"]) == 5
    suggestion = client.post("/jobs/recommendations", headers=fixture[0], json={}).json()
    assert suggestion["status"] == "ready"
    assert len(suggestion["items"][0]["work_constraints"]) == 5
    assert suggestion["items"][0]["supported"] == []
    assert fixture[2].result_json == before


@pytest.mark.parametrize("kind", ["interest", "trait", "language"])
def test_v2_non_skill_only_does_not_pass_http_specific_intersection_gate(
    client, db, matching_sample, kind
):
    source = "Python required."
    data = schema(group(atom("Python", kind=kind, evidence=source), evidence=source))
    upgrade_fixture(db, matching_sample, data, source)
    client.put("/profile", headers=matching_sample[0], json={"skills": ["Python"]})
    report = client.post("/jobs/recommendations", headers=matching_sample[0], json={}).json()
    assert report["status"] == "no_matches"
    assert report["items"] == []


@pytest.mark.parametrize("change", ["mock", "failed", "stale", "expired"])
def test_v2_keeps_existing_recommendation_exclusion_guards(client, db, matching_sample, change):
    source = "Python required."
    data = schema(group(atom("Python", evidence=source), evidence=source))
    upgrade_fixture(db, matching_sample, data, source)
    client.put("/profile", headers=matching_sample[0], json={"skills": ["Python"]})
    _, job, run = matching_sample
    if change == "mock":
        run.result_json = {**run.result_json, "execution_mode": "mock"}
    elif change == "failed":
        run.status = "failed"
    elif change == "stale":
        job.description += " Updated."
    else:
        job.deadline = date.today() - timedelta(days=2)
    db.commit()
    report = client.post("/jobs/recommendations", headers=matching_sample[0], json={}).json()
    assert report["items"] == []
    assert report["status"] in {"no_evidence", "no_candidates"}
