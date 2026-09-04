"""Batch isolation, atomic writes, and honest offline evaluation."""

import asyncio
import copy
import json
import os

import pytest

from app.job_extraction.cli import load_fixture_cases, main, run_offline
from app.job_extraction.evaluation import evaluate_predictions, fact_labels
from app.job_extraction.evaluation import main as evaluate_main
from app.job_extraction.models import JobExtractionSchema
from app.job_extraction.storage import assert_distinct_paths, atomic_write_json


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def test_offline_batch_succeeds_without_modifying_inputs(jobs, cases):
    original = copy.deepcopy(jobs)
    report = asyncio.run(run_offline(jobs, cases))
    assert report["execution_mode"] == "mock"
    assert report["extracted_count"] == report["needs_review_count"] == 5
    assert report["failed_count"] == 0
    assert jobs == original


def test_bad_duplicate_and_stale_inputs_are_isolated(jobs, cases):
    changed = {**jobs[1], "description": "Updated description"}
    report = asyncio.run(run_offline([jobs[0], jobs[0], changed, {}, "invalid"], cases))
    assert report["status"] == "partial"
    assert report["extracted_count"] == 1
    assert report["failed_count"] == 4
    assert [i["error_code"] for i in report["input_failures"]] == [
        "duplicate_input",
        "no_matching_mock_fixture",
        "invalid_input",
        "invalid_input",
    ]


def test_cli_roundtrip_and_evaluation(tmp_path, jobs):
    source = save(tmp_path / "jobs.json", jobs)
    before = source.read_bytes()
    output = tmp_path / "nested" / "extractions.json"
    evaluation = tmp_path / "evaluation.json"
    assert main(["--input", str(source), "--output", str(output)]) == 0
    assert evaluate_main(["--predictions", str(output), "--output", str(evaluation)]) == 0
    metrics = json.loads(evaluation.read_text(encoding="utf-8"))
    assert metrics["label_micro_f1"] == 1.0
    assert metrics["evaluation_kind"] == "mock_plumbing_check"
    assert metrics["eligible_for_model_quality_review"] is False
    assert source.read_bytes() == before


@pytest.mark.parametrize("records", [[], [{}], ["invalid"]])
def test_all_failed_or_empty_preserves_last_output(tmp_path, records):
    source = save(tmp_path / "jobs.json", records)
    output = save(tmp_path / "existing.json", {"previous": "keep"})
    before = output.read_bytes()
    assert main(["--input", str(source), "--output", str(output)]) == 1
    assert output.read_bytes() == before


def test_partial_cli_writes_explicit_failure_report(tmp_path, jobs):
    source = save(tmp_path / "jobs.json", [jobs[0], {}])
    output = tmp_path / "report.json"
    assert main(["--input", str(source), "--output", str(output)]) == 1
    assert json.loads(output.read_text(encoding="utf-8"))["status"] == "partial"


def test_cli_cannot_overwrite_input(tmp_path, jobs):
    source = save(tmp_path / "jobs.json", jobs)
    before = source.read_bytes()
    assert main(["--input", str(source), "--output", str(source)]) == 2
    assert source.read_bytes() == before


def test_cli_cannot_overwrite_custom_fixtures(tmp_path, jobs, cases):
    source = save(tmp_path / "jobs.json", jobs)
    fixture = save(tmp_path / "fixtures.json", {"notice": "test fixtures", "cases": cases})
    before = fixture.read_bytes()
    assert main(["--input", str(source), "--fixtures", str(fixture), "--output", str(fixture)]) == 2
    assert fixture.read_bytes() == before


def test_custom_fixtures_are_supported(tmp_path, jobs, cases):
    source = save(tmp_path / "jobs.json", jobs)
    fixture = save(tmp_path / "fixtures.json", {"notice": "test fixtures", "cases": cases})
    output = tmp_path / "out.json"
    assert main(["--input", str(source), "--fixtures", str(fixture), "--output", str(output)]) == 0
    assert (
        evaluate_main(
            [
                "--predictions",
                str(output),
                "--fixtures",
                str(fixture),
                "--output",
                str(tmp_path / "eval.json"),
            ]
        )
        == 0
    )


def test_duplicate_fixture_rejected(tmp_path, cases):
    fixture = save(tmp_path / "fixtures.json", {"cases": [cases[0], cases[0]]})
    with pytest.raises(ValueError):
        load_fixture_cases(fixture)


def test_duplicate_fixture_case_id_rejected(tmp_path, cases):
    duplicate_id = copy.deepcopy(cases[1])
    duplicate_id["case_id"] = cases[0]["case_id"]
    fixture = save(
        tmp_path / "fixtures.json",
        {"notice": "test fixtures", "cases": [cases[0], duplicate_id]},
    )
    with pytest.raises(ValueError):
        load_fixture_cases(fixture)


@pytest.mark.parametrize(
    "payload",
    [
        {"notice": "test", "cases": []},
        {"notice": "test", "cases": "not-a-list"},
        {"notice": "test", "cases": [{"case_id": "incomplete"}]},
        {"notice": "test", "cases": [], "unexpected": True},
    ],
)
def test_malformed_fixture_bundle_rejected(tmp_path, payload):
    fixture = save(tmp_path / "fixtures.json", payload)
    with pytest.raises(ValueError):
        load_fixture_cases(fixture)


@pytest.mark.parametrize("text", ["not-json", "{}", "null"])
def test_cli_invalid_top_level(tmp_path, text):
    source = tmp_path / "invalid.json"
    source.write_text(text)
    assert main(["--input", str(source), "--output", str(tmp_path / "out.json")]) == 2


def test_missing_input_is_clean_error(tmp_path):
    assert main(["--input", str(tmp_path / "missing.json")]) == 2


def test_hardlink_input_protection(tmp_path):
    source = save(tmp_path / "source.json", {})
    alias = tmp_path / "alias.json"
    try:
        os.link(source, alias)
    except OSError:
        pytest.skip("Filesystem does not support hard links")
    with pytest.raises(ValueError):
        assert_distinct_paths(alias, source)


def test_atomic_replace_failure_preserves_old_file(tmp_path, monkeypatch):
    output = save(tmp_path / "out.json", {"old": True})
    before = output.read_bytes()

    def fail_replace(*args):
        raise OSError("simulated disk failure")

    monkeypatch.setattr(os, "replace", fail_replace)
    with pytest.raises(OSError):
        atomic_write_json(output, {"new": True})
    assert output.read_bytes() == before
    assert not list(tmp_path.glob(".extraction-*.tmp"))


def test_atomic_serialization_failure_preserves_old_file(tmp_path):
    output = save(tmp_path / "out.json", {"old": True})
    before = output.read_bytes()
    with pytest.raises(ValueError):
        atomic_write_json(output, {"invalid": float("nan")})
    assert output.read_bytes() == before
    assert not list(tmp_path.glob(".extraction-*.tmp"))


def test_evaluation_counts_missing_cases(jobs, cases):
    report = asyncio.run(run_offline(jobs[:1], cases))
    metrics = evaluate_predictions(cases, report)
    assert metrics["missing_prediction_count"] == 4
    assert metrics["schema_valid_rate"] == 0.2
    assert metrics["label_micro_recall"] < 1


def test_evaluation_counts_explicit_failed_prediction(jobs, cases):
    report = asyncio.run(run_offline(jobs[:1], cases))
    failed = report["results"][0]
    failed.update(status="failed", extraction=None, quality=None, error_code="provider_timeout")
    metrics = evaluate_predictions(cases, report)
    assert metrics["prediction_count"] == 1
    assert metrics["valid_extraction_count"] == 0
    assert metrics["label_micro_recall"] == 0


@pytest.mark.parametrize("change", ["duplicate", "stale", "unknown"])
def test_evaluation_rejects_invalid_prediction_identity(jobs, cases, change):
    report = asyncio.run(run_offline(jobs, cases))
    if change == "duplicate":
        report["results"].append(copy.deepcopy(report["results"][0]))
    elif change == "stale":
        report["results"][0]["input_hash"] = "a" * 64
    else:
        report["results"][0]["external_id"] = "other"
    with pytest.raises(ValueError):
        evaluate_predictions(cases, report)


def test_evaluation_rejects_empty_or_duplicate_case_set(cases):
    with pytest.raises(ValueError):
        evaluate_predictions([], {"execution_mode": "live", "results": []})
    with pytest.raises(ValueError):
        evaluate_predictions([cases[0], cases[0]], {"execution_mode": "live", "results": []})


def test_live_draft_annotations_still_not_quality_evidence(jobs, cases):
    report = asyncio.run(run_offline(jobs, cases))
    report["execution_mode"] = "live"
    for result in report["results"]:
        result["execution_mode"] = "live"
    assert evaluate_predictions(cases, report)["eligible_for_model_quality_review"] is False
    for case in cases:
        case["annotation_status"] = "human_reviewed"
    assert evaluate_predictions(cases, report)["eligible_for_model_quality_review"] is True
    report["results"][0]["execution_mode"] = "mock"
    with pytest.raises(ValueError, match="execution_mode"):
        evaluate_predictions(cases, report)


def test_empty_labels_have_undefined_metrics(empty_payload, cases):
    cases = [cases[0]]
    cases[0]["extraction"] = empty_payload
    metrics = evaluate_predictions(cases, {"execution_mode": "mock", "results": []})
    assert metrics["label_micro_precision"] is None
    assert metrics["label_micro_recall"] is None
    assert metrics["label_micro_f1"] is None
    assert metrics["evidence_coverage"] is None


def test_numeric_years_are_in_label_metrics(empty_payload):
    empty_payload["experience"]["minimum_years"] = {"value": 3, "evidence": "3 years"}
    assert ("experience.minimum_years", "3.0") in fact_labels(
        JobExtractionSchema.model_validate(empty_payload)
    )


def test_evaluation_cli_rejects_bad_predictions(tmp_path):
    source = save(tmp_path / "predictions.json", {})
    assert (
        evaluate_main(["--predictions", str(source), "--output", str(tmp_path / "eval.json")]) == 2
    )


@pytest.mark.parametrize(
    "report",
    [
        [],
        {},
        {"execution_mode": "unknown", "results": []},
        {"execution_mode": "live", "results": {}},
    ],
)
def test_evaluation_requires_explicit_well_formed_report(cases, report):
    with pytest.raises(ValueError):
        evaluate_predictions(cases, report)
