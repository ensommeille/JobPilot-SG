"""Output validation and compatibility with scraper JSON records."""

import pytest
from pydantic import ValidationError

from app.job_extraction.inputs import input_from_job, input_from_raw_item
from app.job_extraction.models import ExtractionInput, JobExtractionSchema, NumberFact, TextFact


def test_fixtures_match_source_hashes(jobs, cases):
    assert [input_from_job(j).input_hash for j in jobs] == [c["input_hash"] for c in cases]


def test_unknown_values_allowed(empty_payload):
    data = JobExtractionSchema.model_validate(empty_payload)
    assert data.education.degree is None
    assert data.experience.minimum_years is None


def test_all_keys_required(payload):
    del payload["languages"]
    with pytest.raises(ValidationError):
        JobExtractionSchema.model_validate(payload)


def test_extra_keys_rejected(payload):
    payload["confidence"] = 0.99
    with pytest.raises(ValidationError):
        JobExtractionSchema.model_validate(payload)


@pytest.mark.parametrize("value", ["3", True, -1, 81, float("nan"), float("inf")])
def test_years_reject_invalid_values(value):
    with pytest.raises(ValidationError):
        NumberFact(value=value, evidence="3 years")


def test_numeric_json_integer_is_supported():
    assert NumberFact(value=3, evidence="3 years").value == 3.0


@pytest.mark.parametrize("value,evidence", [("", "JD"), ("x", "  "), ("x" * 1001, "JD")])
def test_text_fact_limits(value, evidence):
    with pytest.raises(ValidationError):
        TextFact(value=value, evidence=evidence)


def test_duplicates_are_case_and_whitespace_insensitive(empty_payload):
    empty_payload["required_skills"] = [
        {"value": "UI Design", "evidence": "UI Design"},
        {"value": "ui  design", "evidence": "UI Design"},
    ]
    with pytest.raises(ValidationError, match="Duplicate"):
        JobExtractionSchema.model_validate(empty_payload)


def test_required_preferred_overlap_rejected(empty_payload):
    empty_payload["required_skills"] = [{"value": "UI Design", "evidence": "UI Design"}]
    empty_payload["preferred_skills"] = [{"value": "ui  design", "evidence": "UI Design"}]
    with pytest.raises(ValidationError, match="both required and preferred"):
        JobExtractionSchema.model_validate(empty_payload)


def test_required_preferred_qualification_overlap_rejected(empty_payload):
    empty_payload["required_qualifications"] = [
        {"value": "Portfolio", "evidence": "Portfolio required"}
    ]
    empty_payload["preferred_qualifications"] = [
        {"value": "portfolio", "evidence": "Portfolio preferred"}
    ]
    with pytest.raises(ValidationError, match="both required and preferred"):
        JobExtractionSchema.model_validate(empty_payload)


@pytest.mark.parametrize(
    "field", ["title", "company", "description", "source_id", "external_id", "source_url"]
)
def test_input_hash_covers_extraction_identity_and_content(job, field):
    changed = ExtractionInput.model_validate({**job.model_dump(), field: "changed"})
    assert changed.input_hash != job.input_hash


def test_legacy_hash_does_not_control_input_hash(job):
    changed = job.model_copy(update={"raw_hash": "a" * 64})
    assert changed.input_hash == job.input_hash


def test_unknown_job_columns_do_not_break_mapping(jobs):
    assert input_from_job({**jobs[0], "future_column": "ok"}) == input_from_job(jobs[0])


@pytest.mark.parametrize("description", ["", "  ", "x" * 40001], ids=["empty", "blank", "too_long"])
def test_empty_or_oversized_description_rejected(jobs, description):
    with pytest.raises(ValidationError):
        input_from_job({**jobs[0], "description": description})


def test_raw_item_uses_isolated_description(jobs):
    known = jobs[0]
    raw = {
        key: known[key]
        for key in ("source_id", "source_type", "external_id", "source_url", "raw_hash")
    }
    raw.update(known_fields=known, raw_text="navigation", raw_html="<script>irrelevant</script>")
    assert input_from_raw_item(raw).description == known["description"]
    raw["external_id"] = "other-job"
    with pytest.raises(ValueError, match="identity mismatch"):
        input_from_raw_item(raw)


@pytest.mark.parametrize("known", [None, [], "invalid"])
def test_raw_item_rejects_missing_known_fields(known):
    with pytest.raises(ValueError):
        input_from_raw_item({"known_fields": known})
