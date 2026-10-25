"""Independent wire-reference regressions: exact slicing, strict scope and AND coverage."""

from copy import deepcopy
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.ai_recommendations.citations import (
    ReferencedBatch,
    ReferencedRequirement,
    SourceRange,
    request_with_sources,
    resolve_assessment,
    source_catalog,
)
from app.ai_recommendations.prompts import (
    REFERENCE_BATCH_EXAMPLE,
    REFERENCE_ROW_EXAMPLE,
    SYSTEM_PROMPT,
)
from app.ai_recommendations.service import validate_assessment


def fixture_payload():
    return {
        "profile": {
            "education": "BSc Computing 2027",
            "experience": "Built REST APIs.\n"
            + "Reviewed intermediate project notes. " * 7
            + "\nUsed SQLite for storage; cross- encoder reranking; testsusing synthetic fixtures.",
            "skills": ["Python", "SQL"],
            "availability": "Available full-time for 12 weeks",
        },
        "preferences": {"keyword": "", "city": "", "job_type": ""},
        "jobs": [
            {
                "id": str(uuid4()),
                "title": "Full Stack Developer",
                "company": "Fixture",
                "description": "Use front\u2011end technologies. REST APIs and SQL databases are required.",
            },
            {
                "id": str(uuid4()),
                "title": "Other role",
                "company": "Fixture",
                "description": "Python required.",
            },
        ],
    }


def spans(catalog, *, field=None, owner=None, scope="profile"):
    return [
        value.source_id
        for value in catalog.values()
        if value.scope == scope
        and (field is None or value.field == field)
        and (owner is None or value.owner == owner)
    ]


def source_range(ids):
    return {"start_id": ids[0], "end_id": ids[-1]}


def wire(payload, catalog):
    jd = spans(catalog, scope="job", owner=payload["jobs"][0]["id"])
    exp = spans(catalog, field="experience")
    database_source = next(
        (
            key
            for key in exp
            if "SQLite" in catalog[key].text[catalog[key].start : catalog[key].end]
        ),
        exp[-1],
    )
    requirement = {
        "requirement": "REST APIs and SQL databases",
        "category": "skill",
        "outcome": "supported",
        "jd_source_range": source_range(jd),
        "profile_field": "experience",
        "profile_source_range": source_range(exp),
        "reason": "Separate source conditions have displayed project evidence.",
        "condition_operator": "all_of",
        "condition_checks": [
            {
                "condition": "REST APIs",
                "outcome": "supported",
                "profile_field": "experience",
                "profile_source_range": source_range([exp[0]]),
                "reason": "Built REST APIs.",
            },
            {
                "condition": "SQL databases",
                "outcome": "supported",
                "profile_field": "experience",
                "profile_source_range": source_range([database_source]),
                "reason": "Used SQLite for storage.",
            },
        ],
    }
    second = {
        "requirement": "Python",
        "category": "skill",
        "outcome": "unknown",
        "jd_source_range": source_range(
            spans(catalog, scope="job", owner=payload["jobs"][1]["id"])
        ),
        "profile_field": None,
        "profile_source_range": None,
        "reason": "Unconfirmed.",
        "condition_operator": "atomic",
        "condition_checks": [
            {
                "condition": "Python",
                "outcome": "unknown",
                "profile_field": None,
                "profile_source_range": None,
                "reason": "Unconfirmed.",
            }
        ],
    }
    return {
        "requires_review": True,
        "items": [
            {
                "job_id": job["id"],
                "rank": index + 1,
                "summary": "Investigate this role.",
                "requirements": [requirement if index == 0 else second],
                "warnings": [],
                "career_fit": {
                    "direction": "undetermined",
                    "proposed_verdict": "insufficient_information",
                    "summary": "No career judgment in this citation fixture.",
                    "jd_source_range": source_range(spans(catalog, scope="job", owner=job["id"])),
                    "profile_field": None,
                    "profile_source_range": None,
                    "job_focus": "Fixture",
                    "profile_focus": None,
                    "strengths": [],
                    "considerations": [],
                },
            }
            for index, job in enumerate(payload["jobs"])
        ],
    }


def test_exact_source_slices_preserve_unicode_hyphens_pdf_spacing_and_intermediate_text():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    original = deepcopy(raw)
    resolved = resolve_assessment(raw, payload, catalog)
    row = resolved["items"][0]["requirements"][0]
    assert row["jd_quote"] == payload["jobs"][0]["description"]
    assert row["profile_quote"] == payload["profile"]["experience"]
    assert "front\u2011end" in row["jd_quote"]
    assert "cross- encoder" in row["profile_quote"] and "testsusing" in row["profile_quote"]
    assert "intermediate project notes" in row["profile_quote"]
    assert raw == original
    assert (
        validate_assessment(resolved, payload, allow_promotions=False)
        .items[0]
        .requirements[0]
        .outcome
        == "supported"
    )


@pytest.mark.parametrize(
    "attack",
    [
        "unknown",
        "other_input",
        "cross_job",
        "cross_field",
        "reversed",
        "legacy_array",
        "legacy_fields",
        "bad_range",
        "extra_quote",
        "cross_skill_entry",
        "too_long",
    ],
)
def test_invalid_or_noncontiguous_source_references_fail_closed(attack):
    payload = fixture_payload()
    if attack == "too_long":
        payload["profile"]["experience"] = ("A" * 300 + " ") * 15
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    row = raw["items"][0]["requirements"][0]
    if attack == "unknown":
        row["jd_source_range"] = source_range(["src_unissued"])
    elif attack == "other_input":
        other = deepcopy(payload)
        other["profile"]["availability"] += " tomorrow"
        row["jd_source_range"] = source_range(
            spans(source_catalog(other), scope="job", owner=payload["jobs"][0]["id"])
        )
    elif attack == "cross_job":
        row["jd_source_range"] = source_range(
            spans(catalog, scope="job", owner=payload["jobs"][1]["id"])
        )
    elif attack == "cross_field":
        row["profile_field"] = "education"
    elif attack == "reversed":
        current = row["profile_source_range"]
        row["profile_source_range"] = {"start_id": current["end_id"], "end_id": current["start_id"]}
    elif attack == "legacy_array":
        current = row["profile_source_range"]
        row["profile_source_range"] = [current["start_id"], current["end_id"]]
    elif attack == "legacy_fields":
        current = row.pop("profile_source_range")
        row["profile_source_ids"] = [current["start_id"], current["end_id"]]
    elif attack == "bad_range":
        key = row["profile_source_range"]["start_id"]
        catalog[key] = replace(catalog[key], end=999999)
    elif attack == "extra_quote":
        row["jd_quote"] = "Invented quotation"
    elif attack == "cross_skill_entry":
        row["profile_field"] = "skills"
        row["profile_source_range"] = source_range(spans(catalog, field="skills"))
    with pytest.raises((ValueError, ValidationError)):
        resolve_assessment(raw, payload, catalog)


def test_partial_and_is_unknown_without_upgrading_original_unknown_or_altering_source():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    row = raw["items"][0]["requirements"][0]
    database_condition = deepcopy(row["condition_checks"][1])
    row["condition_checks"][1].update(
        outcome="unknown", profile_field=None, profile_source_range=None
    )
    resolved = resolve_assessment(raw, payload, catalog)
    assert resolved["items"][0]["requirements"][0]["outcome"] == "unknown"
    assert "Not every necessary condition" in resolved["items"][0]["requirements"][0]["reason"]
    row["condition_checks"][1] = database_condition
    row["outcome"] = "unknown"
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "unknown"
    )


def test_or_can_keep_one_complete_evidenced_alternative_and_unspecified_stays_unknown():
    payload = fixture_payload()
    payload["jobs"][0]["description"] = "REST APIs or SQL databases are accepted."
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    row = raw["items"][0]["requirements"][0]
    row["requirement"] = "REST APIs or SQL databases"
    row["condition_operator"] = "any_of"
    row["condition_checks"][1].update(
        outcome="unknown", profile_field=None, profile_source_range=None
    )
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "supported"
    )
    row["condition_operator"] = "unspecified"
    assert (
        resolve_assessment(raw, payload, catalog)["items"][0]["requirements"][0]["outcome"]
        == "unknown"
    )


@pytest.mark.parametrize("missing", list(ReferencedRequirement.model_fields))
def test_every_internal_row_key_is_required(missing):
    row = deepcopy(REFERENCE_ROW_EXAMPLE)
    del row[missing]
    with pytest.raises(ValidationError):
        ReferencedRequirement.model_validate(row)


def test_catalog_wire_metadata_is_exactly_bound_to_the_sanitized_input():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    wire_input = request_with_sources(payload, catalog)
    assert wire_input["profile"] == payload["profile"]
    assert wire_input["jobs"] == payload["jobs"]
    for source in wire_input["source_catalog"]:
        span = catalog[source["source_id"]]
        assert source["text"] == span.text[source["start"] : source["end"]]


def test_complete_prompt_example_includes_every_item_key_and_matches_strict_reference_schema():
    parsed = ReferencedBatch.model_validate(deepcopy(REFERENCE_BATCH_EXAMPLE))
    assert set(REFERENCE_BATCH_EXAMPLE) == set(ReferencedBatch.model_fields)
    assert set(REFERENCE_BATCH_EXAMPLE["items"][0]) == set(type(parsed.items[0]).model_fields)
    assert parsed.items[0].warnings == []
    assert "NEVER use category=availability" in SYSTEM_PROMPT
    assert "FINAL BOUNDED SELF-CHECK, ONCE" in SYSTEM_PROMPT


@pytest.mark.parametrize("index", range(5))
def test_warnings_cannot_be_omitted_from_any_item(index):
    batch = deepcopy(REFERENCE_BATCH_EXAMPLE)
    batch["items"] = [deepcopy(batch["items"][0]) for _ in range(5)]
    for position, job in enumerate(batch["items"], 1):
        job["job_id"], job["rank"] = str(uuid4()), position
    del batch["items"][index]["warnings"]
    with pytest.raises(ValidationError) as failure:
        ReferencedBatch.model_validate(batch)
    assert failure.value.errors()[0]["loc"] == ("items", index, "warnings")


def test_availability_is_a_profile_field_but_not_an_allowed_category():
    row = deepcopy(REFERENCE_ROW_EXAMPLE)
    row["category"] = "availability"
    with pytest.raises(ValidationError):
        ReferencedRequirement.model_validate(row)
    row["category"] = "work_constraint"
    row["profile_field"] = "availability"
    row["profile_source_range"] = source_range(["replace-with-issued-id"])
    assert ReferencedRequirement.model_validate(row).profile_field == "availability"


@pytest.mark.parametrize(("operator", "count"), [("atomic", 2), ("all_of", 1), ("any_of", 1)])
def test_operator_shape_errors_remain_rejected_instead_of_coerced(operator, count):
    row = deepcopy(REFERENCE_ROW_EXAMPLE)
    row["condition_operator"] = operator
    row["condition_checks"] = [deepcopy(row["condition_checks"][0]) for _ in range(count)]
    with pytest.raises(ValidationError):
        ReferencedRequirement.model_validate(row)


def test_profile_catalog_omits_redacted_segment_without_reindexing_or_hiding_its_text():
    payload = fixture_payload()
    payload["profile"]["experience"] = "Built REST APIs.\n[redacted]\nUsed SQLite."
    catalog = source_catalog(payload)
    experience = [span for span in catalog.values() if span.field == "experience"]
    assert [span.ordinal for span in experience] == [0, 2]
    assert all("[redacted]" not in span.text[span.start : span.end] for span in experience)
    raw = wire(payload, catalog)
    with pytest.raises(ValueError, match="invalid_evidence"):
        resolve_assessment(raw, payload, catalog)


def test_job_range_crossing_redacted_text_is_rejected_too():
    payload = fixture_payload()
    payload["jobs"][0]["description"] = "REST required.\n[redacted]\nSQL databases preferred."
    catalog = source_catalog(payload)
    with pytest.raises(ValueError, match="invalid_evidence"):
        resolve_assessment(wire(payload, catalog), payload, catalog)


def test_single_segment_range_uses_identical_endpoints_and_returns_its_exact_source():
    payload = fixture_payload()
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    reference = source_range([spans(catalog, field="skills")[0]])
    row = raw["items"][1]["requirements"][0]
    row.update(outcome="supported", profile_field="skills", profile_source_range=reference)
    row["condition_checks"][0].update(
        outcome="supported", profile_field="skills", profile_source_range=reference
    )
    result = resolve_assessment(raw, payload, catalog)
    assert reference["start_id"] == reference["end_id"]
    assert result["items"][1]["requirements"][0]["profile_quote"] == "Python"
    assert result["items"][1]["requirements"][0]["outcome"] == "supported"


@pytest.mark.parametrize("missing", ["start_id", "end_id"])
def test_range_endpoints_are_required_without_defaults(missing):
    value = {"start_id": "source", "end_id": "source"}
    del value[missing]
    with pytest.raises(ValidationError):
        SourceRange.model_validate(value)


def test_range_extra_offsets_are_rejected_instead_of_overriding_issued_boundaries():
    with pytest.raises(ValidationError):
        SourceRange.model_validate({"start_id": "source", "end_id": "source", "start": 0})
