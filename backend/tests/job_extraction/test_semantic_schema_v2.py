"""Versioned semantic contracts and history safety; all model output is scripted."""

import asyncio
import copy

import pytest
from pydantic import ValidationError

from app.job_extraction.cli import run_offline
from app.job_extraction.evaluation import evaluate_predictions, fact_labels
from app.job_extraction.models import (
    DurationFact,
    ExtractionResult,
    FixtureCase,
    HoursFact,
    JobExtractionSchema,
    JobExtractionSchemaV2,
    ResponsibilityFact,
    WorkModeFact,
)
from app.job_extraction.quality import (
    assess_quality,
    duration_evidence_supported,
    hours_evidence_supported,
)
from app.job_extraction.runtime import ExtractionRuntime
from app.job_extraction.service import ExtractionConfig, JobExtractionService
from app.llm import MockProvider, StructuredGenerationResponse


@pytest.fixture
def empty_v2():
    return {
        "summary": None,
        "responsibilities": [],
        "requirement_groups": [],
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


def fact(value, evidence=None):
    return {"value": value, "evidence": evidence or value}


def group(value, atoms, operator="all_of", importance="required"):
    return {
        **fact(value),
        "importance": importance,
        "operator": operator,
        "requirements": [{**fact(label), "kind": kind, "qualifier": None} for kind, label in atoms],
    }


def response(payload):
    return StructuredGenerationResponse(
        data=payload, provider="mock", model="scripted-contract", finish_reason="stop"
    )


def extract(job, payload, version="job-extraction-v2"):
    return asyncio.run(
        JobExtractionService(
            MockProvider([response(payload)]),
            ExtractionConfig(schema_version=version, max_validation_retries=0),
        ).extract(job)
    )


def test_new_default_contract_is_v2_and_rejects_unversioned_legacy_output(job, empty_payload):
    service = JobExtractionService(
        MockProvider([response(empty_payload)]), ExtractionConfig(max_validation_retries=0)
    )
    result = asyncio.run(service.extract(job))
    assert result.schema_version == "job-extraction-v2"
    assert result.status == "failed"
    assert result.error_code == "schema_validation_failed"
    assert result.extraction is None


def test_explicit_v1_replay_retains_legacy_payload_and_quality_version(job, payload):
    result = extract(job, payload, "job-extraction-v1")
    assert result.status == "needs_review"
    assert isinstance(result.extraction, JobExtractionSchema)
    assert result.extraction.model_dump() == payload
    assert result.prompt_version == "job-extraction-prompt-v1"
    assert result.quality.quality_version == "evidence-coverage-v1"
    assert "requirement_groups" not in result.extraction.model_dump()


@pytest.mark.parametrize(
    "key",
    [
        "summary",
        "responsibilities",
        "requirement_groups",
        "education",
        "experience",
        "work_constraints",
    ],
)
def test_all_v2_root_keys_required(empty_v2, key):
    del empty_v2[key]
    with pytest.raises(ValidationError):
        JobExtractionSchemaV2.model_validate(empty_v2)


def test_v2_unknown_constraints_stay_unknown(empty_v2):
    data = JobExtractionSchemaV2.model_validate(empty_v2)
    assert data.work_constraints.model_dump() == {
        "schedule": None,
        "hours": None,
        "minimum_duration": None,
        "work_modes": [],
        "locations": [],
    }
    assert data.requirement_groups == []


def test_primary_conditional_duties_and_source_scope_are_preserved(empty_v2):
    empty_v2["responsibilities"] = [
        {
            **fact("Maintain stock", "Primary duties: maintain stock"),
            "priority": "primary",
            "condition": None,
        },
        {
            **fact("Support social media", "When time permits, support social media"),
            "priority": "conditional",
            "condition": fact("When time permits"),
        },
    ]
    data = JobExtractionSchemaV2.model_validate(empty_v2)
    assert data.responsibilities[0].priority == "primary"
    assert data.responsibilities[1].condition.value == "When time permits"
    labels = fact_labels(data)
    assert ("responsibilities.primary", "maintain stock") in labels
    assert ("responsibilities.condition|support social media", "when time permits") in labels


@pytest.mark.parametrize(
    "priority,condition",
    [
        ("conditional", None),
        ("primary", fact("If time permits")),
        ("unspecified", fact("If needed")),
    ],
)
def test_conditional_duties_cannot_lose_or_hide_scope(priority, condition):
    with pytest.raises(ValidationError):
        ResponsibilityFact(**fact("Support design"), priority=priority, condition=condition)


def test_compound_and_alternative_requirements_keep_each_atom(empty_v2):
    empty_v2["requirement_groups"] = [
        group("Python and SQL", [("skill", "Python"), ("skill", "SQL")]),
        group(
            "PyTorch or TensorFlow",
            [("skill", "PyTorch"), ("skill", "TensorFlow")],
            "any_of",
            "preferred",
        ),
    ]
    data = JobExtractionSchemaV2.model_validate(empty_v2)
    assert data.requirement_groups[0].operator == "all_of"
    assert [atom.value for atom in data.requirement_groups[0].requirements] == ["Python", "SQL"]
    assert data.requirement_groups[1].operator == "any_of"
    assert data.requirement_groups[1].importance == "preferred"


def test_skill_language_interest_and_trait_remain_distinct(empty_v2):
    empty_v2["requirement_groups"] = [
        group("Python", [("skill", "Python")]),
        group("Mandarin", [("language", "Mandarin")]),
        group("Interest in AI", [("interest", "Interest in AI")]),
        group("Good teamwork", [("trait", "Good teamwork")]),
    ]
    data = JobExtractionSchemaV2.model_validate(empty_v2)
    assert [item.requirements[0].kind for item in data.requirement_groups] == [
        "skill",
        "language",
        "interest",
        "trait",
    ]
    assert len(fact_labels(data)) == 8  # Four statements and four typed atoms.


def test_duplicate_atoms_rejected_but_distinct_components_preserved(empty_v2):
    empty_v2["requirement_groups"] = [
        group("Python and python", [("skill", "Python"), ("skill", " python ")])
    ]
    with pytest.raises(ValidationError, match="Duplicate"):
        JobExtractionSchemaV2.model_validate(empty_v2)


def test_qualifiers_remain_independently_source_backed(empty_v2):
    requirement = group("Advanced Python", [("skill", "Python")])
    requirement["requirements"][0]["qualifier"] = fact("Advanced")
    empty_v2["requirement_groups"] = [requirement]
    quality = assess_quality(JobExtractionSchemaV2.model_validate(empty_v2), "Advanced Python")
    assert quality.evidence_matched == quality.total_claims == 3
    assert quality.requires_review is True
    assert quality.quality_version == "evidence-coverage-v2"


def test_hours_duration_modes_retain_pt_scope_units_and_prohibition(empty_v2):
    condition = fact("Part-time applicants")
    empty_v2["work_constraints"] = {
        "schedule": fact("Monday to Friday, 10am to 7pm"),
        "hours": {
            "minimum": 20,
            "maximum": None,
            "unit": "hours_per_week",
            "evidence": "At least 20 hours per week",
            "condition": condition,
        },
        "minimum_duration": {
            "value": 3,
            "unit": "months",
            "evidence": "At least 3 months",
            "condition": condition,
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
        "locations": [fact("Singapore")],
    }
    data = JobExtractionSchemaV2.model_validate(empty_v2)
    assert data.work_constraints.minimum_duration.value == 3
    assert data.work_constraints.minimum_duration.unit == "months"
    assert data.work_constraints.hours.condition.value == "Part-time applicants"
    assert [mode.allowed for mode in data.work_constraints.work_modes] == [False, False]
    source = "Monday to Friday, 10am to 7pm. Part-time applicants: At least 20 hours per week; At least 3 months. No remote or hybrid work. Singapore."
    quality = assess_quality(data, source)
    assert quality.evidence_matched == quality.total_claims
    # A source quote finding all facts still does not establish semantic accuracy.
    assert quality.requires_review is True


@pytest.mark.parametrize(
    "minimum,maximum,unit",
    [
        (None, None, "hours_per_week"),
        (40, 20, "hours_per_week"),
        (25, None, "hours_per_day"),
        (True, None, "hours_per_week"),
        (-1, None, "hours_per_week"),
        (20, None, "days"),
    ],
)
def test_invalid_hours_are_rejected(minimum, maximum, unit):
    with pytest.raises(ValidationError):
        HoursFact(minimum=minimum, maximum=maximum, unit=unit, evidence="20 hours", condition=None)


@pytest.mark.parametrize("value,unit", [(0, "months"), (-1, "days"), (True, "weeks"), (3, "hours")])
def test_invalid_duration_is_rejected(value, unit):
    with pytest.raises(ValidationError):
        DurationFact(value=value, unit=unit, evidence="3 months", condition=None)


def test_mode_requires_boolean_not_truthy_string():
    with pytest.raises(ValidationError):
        WorkModeFact(value="remote", allowed="false", evidence="No remote work", condition=None)


@pytest.mark.parametrize(
    "quote,minimum,maximum,unit,expected",
    [
        ("At least 4 days a week", 4, None, "hours_per_week", False),
        ("Monday to Friday, 10am to 7pm", 45, None, "hours_per_week", False),
        ("At least 20 hours per week", 20, None, "hours_per_week", True),
        ("20h/week", 20, None, "hours_per_week", True),
        ("20-30 hours weekly", 20, 30, "hours_per_week", True),
        ("8 working hours a day", 8, None, "hours_per_day", True),
        ("20 hours per day", 20, None, "hours_per_week", False),
        ("20 hours per week", 25, None, "hours_per_week", False),
    ],
)
def test_hours_require_explicit_numeric_hour_and_period_units(
    quote, minimum, maximum, unit, expected
):
    item = HoursFact(minimum=minimum, maximum=maximum, unit=unit, evidence=quote, condition=None)
    assert hours_evidence_supported(item, quote) is expected


def test_hours_quote_must_still_exist_in_description():
    item = HoursFact(
        minimum=20,
        maximum=None,
        unit="hours_per_week",
        evidence="20 hours per week",
        condition=None,
    )
    assert hours_evidence_supported(item, "Four days a week") is False


@pytest.mark.parametrize(
    "quote,value,unit,expected",
    [
        ("At least 3 months", 3, "months", True),
        ("3-month internship", 3, "months", True),
        ("At least 3 days", 3, "months", False),
        ("At least 12 weeks", 3, "months", False),
        ("At least 3 months", 4, "months", False),
    ],
)
def test_duration_retains_explicit_number_and_original_unit(quote, value, unit, expected):
    item = DurationFact(value=value, unit=unit, evidence=quote, condition=None)
    assert duration_evidence_supported(item, quote) is expected


def test_numeric_unit_errors_flag_review_even_when_quote_coverage_is_perfect(empty_v2):
    source = "At least 4 days a week, for at least 3 days."
    empty_v2["work_constraints"]["hours"] = {
        "minimum": 4,
        "maximum": None,
        "unit": "hours_per_week",
        "evidence": "At least 4 days a week",
        "condition": None,
    }
    empty_v2["work_constraints"]["minimum_duration"] = {
        "value": 3,
        "unit": "months",
        "evidence": "at least 3 days",
        "condition": None,
    }
    data = JobExtractionSchemaV2.model_validate(empty_v2)
    quality = assess_quality(data, source)
    assert quality.score == 1.0
    assert quality.requires_review is True
    assert {issue.code for issue in quality.issues} >= {
        "numeric_hours_not_supported",
        "numeric_duration_not_supported",
    }
    assert (
        data.work_constraints.hours.minimum == 4
    )  # Audit data is preserved, never silently corrected.
    assert data.work_constraints.minimum_duration.unit == "months"


def test_all_v2_fact_quotes_and_conditions_are_checked(empty_v2):
    empty_v2["responsibilities"] = [
        {
            **fact("Support design"),
            "priority": "conditional",
            "condition": fact("Invented condition"),
        }
    ]
    empty_v2["work_constraints"]["minimum_duration"] = {
        "value": 3,
        "unit": "months",
        "evidence": "3 months",
        "condition": fact("Invented scope"),
    }
    quality = assess_quality(
        JobExtractionSchemaV2.model_validate(empty_v2), "Support design for 3 months"
    )
    missing = {
        issue.field for issue in quality.issues if issue.code == "evidence_not_in_description"
    }
    assert missing == {
        "responsibilities.0.condition",
        "work_constraints.minimum_duration.condition",
    }


def test_quoted_interest_and_language_do_not_become_semantically_correct_skills(empty_v2):
    empty_v2["requirement_groups"] = [
        group("Interest in AI", [("skill", "Interest in AI")]),
        group("Mandarin", [("skill", "Mandarin")]),
    ]
    quality = assess_quality(
        JobExtractionSchemaV2.model_validate(empty_v2), "Interest in AI. Mandarin."
    )
    assert quality.score == 1.0
    assert {issue.code for issue in quality.issues} >= {
        "interest_classified_as_skill",
        "language_classified_as_skill",
    }
    assert quality.requires_review is True


@pytest.mark.parametrize("version", ["job-extraction-v1", "job-extraction-v2"])
def test_result_rejects_version_payload_mismatch(job, payload, empty_v2, version):
    result = extract(job, payload, "job-extraction-v1").model_dump()
    result["schema_version"] = version
    result["prompt_version"] = "job-extraction-prompt-" + version.rsplit("-", 1)[-1]
    result["extraction"] = empty_v2 if version == "job-extraction-v1" else payload
    with pytest.raises(ValidationError, match="Schema version"):
        ExtractionResult.model_validate(result)


def test_prompt_schema_versions_must_correspond_even_for_failed_runs(job, empty_v2):
    result = extract(job, empty_v2).model_dump()
    result["prompt_version"] = "job-extraction-prompt-v1"
    with pytest.raises(ValidationError, match="versions must correspond"):
        ExtractionResult.model_validate(result)


def test_fixture_version_cannot_silently_relabel_legacy(cases, empty_v2):
    item = copy.deepcopy(cases[0])
    item["extraction"] = empty_v2
    with pytest.raises(ValidationError, match="Fixture schema version"):
        FixtureCase.model_validate(item)


def test_v2_fixture_replay_keeps_mode_and_version(jobs, cases, empty_v2):
    case = copy.deepcopy(cases[0])
    case.update(schema_version="job-extraction-v2", extraction=empty_v2)
    report = asyncio.run(run_offline(jobs[:1], [case]))
    assert report["results"][0]["schema_version"] == "job-extraction-v2"
    assert report["results"][0]["execution_mode"] == "mock"
    assert report["results"][0]["status"] == "needs_review"


def test_classification_and_omissions_are_separate_from_evidence(jobs, cases, empty_v2):
    case = copy.deepcopy(cases[0])
    gold = copy.deepcopy(empty_v2)
    gold["requirement_groups"] = [
        group("Mandarin", [("language", "Mandarin")]),
        group("Python", [("skill", "Python")]),
    ]
    case.update(schema_version="job-extraction-v2", extraction=gold)
    predicted = copy.deepcopy(gold)
    predicted["requirement_groups"].pop()
    predicted["requirement_groups"][0]["requirements"][0]["kind"] = "skill"
    report = asyncio.run(run_offline(jobs[:1], [{**case, "extraction": predicted}]))
    metrics = evaluate_predictions([case], report)
    assert metrics["exact_fact_value_coverage"] == 0.5
    assert metrics["classification_correctness_on_exact_values"] == 0
    assert metrics["missing_label_count"] > 0
    assert metrics["case_disagreements"][0]["uncovered_fact_values"] == ["python"]
    assert metrics["eligible_for_model_quality_review"] is False


def test_swapped_skill_qualifiers_are_not_identical_evaluation_labels(empty_v2):
    empty_v2["requirement_groups"] = [
        group("Python", [("skill", "Python")]),
        group("SQL", [("skill", "SQL")]),
    ]
    empty_v2["requirement_groups"][0]["requirements"][0]["qualifier"] = fact("Advanced")
    empty_v2["requirement_groups"][1]["requirements"][0]["qualifier"] = fact("Basic")
    before = fact_labels(JobExtractionSchemaV2.model_validate(empty_v2))
    empty_v2["requirement_groups"][0]["requirements"][0]["qualifier"] = fact("Basic")
    empty_v2["requirement_groups"][1]["requirements"][0]["qualifier"] = fact("Advanced")
    after = fact_labels(JobExtractionSchemaV2.model_validate(empty_v2))
    assert {value for _, value in before} == {value for _, value in after}
    assert before != after
    assert ("qualifier.skill|python", "advanced") in before
    assert ("qualifier.skill|sql", "advanced") in after


def test_pipeline_fingerprint_changes_with_schema_version():
    assert ExtractionRuntime().snapshot()["schema_version"] == "job-extraction-v2"
    legacy = ExtractionRuntime(config=ExtractionConfig(schema_version="job-extraction-v1"))
    assert legacy.snapshot()["schema_version"] == "job-extraction-v1"
    assert legacy.snapshot()["prompt_version"] == "job-extraction-prompt-v1"
    assert legacy.snapshot()["quality_version"] == "evidence-coverage-v1"
    assert legacy.snapshot() != ExtractionRuntime().snapshot()
