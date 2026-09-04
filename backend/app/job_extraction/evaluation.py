"""Evaluate supplied predictions against reviewed annotations; never generate predictions here."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .cli import load_fixture_cases
from .models import ExtractionResult, JobExtractionSchema
from .storage import assert_distinct_paths, atomic_write_json


def fact_labels(data: JobExtractionSchema) -> set[tuple[str, str]]:
    labels: set[tuple[str, str]] = set()
    for field in (
        "responsibilities",
        "required_skills",
        "preferred_skills",
        "required_qualifications",
        "preferred_qualifications",
        "languages",
    ):
        labels.update((field, " ".join(f.value.casefold().split())) for f in getattr(data, field))
    labels.update(
        ("education.fields_of_study", " ".join(f.value.casefold().split()))
        for f in data.education.fields_of_study
    )
    for field in ("degree", "enrollment"):
        fact = getattr(data.education, field)
        if fact:
            labels.add((f"education.{field}", " ".join(fact.value.casefold().split())))
    if data.experience.minimum_years:
        labels.add(("experience.minimum_years", str(float(data.experience.minimum_years.value))))
    return labels


def evaluate_predictions(cases: list[dict[str, Any]], report: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(report, dict) or report.get("execution_mode") not in {"mock", "live"}:
        raise ValueError("Prediction report requires an explicit mock or live execution_mode")
    if not isinstance(report.get("results"), list):
        raise ValueError("Prediction report results must be a list")
    expected = {(c["source_id"], c["external_id"], c["input_hash"]): c for c in cases}
    if len(expected) != len(cases) or not cases:
        raise ValueError("Evaluation needs a nonempty unique case set")
    predictions: dict[tuple[str, str, str], ExtractionResult] = {}
    for item in report["results"]:
        result = ExtractionResult.model_validate(item)
        key = (result.source_id, result.external_id, result.input_hash)
        if key not in expected or key in predictions:
            raise ValueError("Unexpected, stale, or duplicate prediction")
        if result.execution_mode != report["execution_mode"]:
            raise ValueError("Prediction execution_mode must match the report")
        predictions[key] = result
    tp = fp = fn = valid = evidence_found = evidence_total = 0
    for key, case in expected.items():
        gold = fact_labels(JobExtractionSchema.model_validate(case["extraction"]))
        result = predictions.get(key)
        prediction: set[tuple[str, str]] = set()
        if result and result.extraction is not None and result.status != "failed":
            valid += 1
            prediction = fact_labels(result.extraction)
            if result.quality:
                evidence_found += result.quality.evidence_matched
                evidence_total += result.quality.total_claims
        tp += len(gold & prediction)
        fp += len(prediction - gold)
        fn += len(gold - prediction)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    mock = report["execution_mode"] == "mock"
    reviewed = all(c.get("annotation_status") == "human_reviewed" for c in cases)
    return {
        "evaluation_kind": "mock_plumbing_check"
        if mock
        else "live_predictions_against_annotations",
        "eligible_for_model_quality_review": not mock and reviewed and valid > 0,
        "annotation_status": "human_reviewed" if reviewed else "draft_requires_human_review",
        "case_count": len(cases),
        "prediction_count": len(predictions),
        "valid_extraction_count": valid,
        "missing_prediction_count": len(cases) - len(predictions),
        "schema_valid_rate": valid / len(cases),
        "label_micro_precision": precision,
        "label_micro_recall": recall,
        "label_micro_f1": f1,
        "evidence_coverage": evidence_found / evidence_total if evidence_total else None,
        "limitations": [
            "Mock replay against its own fixtures measures wiring, not model accuracy.",
            "Draft annotations require independent human review before quality claims.",
            "Exact normalized label matching penalizes valid paraphrases; review disagreements manually.",
            "Summary and free-text experience requirement semantics are not evaluated.",
            "Evidence coverage uses supplied quality reports; it is not a hallucination-rate metric.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--output", type=Path, default=Path("output/evaluation.json"))
    args = parser.parse_args(argv)
    try:
        protected = [args.predictions]
        if args.fixtures:
            protected.append(args.fixtures)
        else:
            from importlib.resources import files

            protected.append(
                Path(str(files("app.job_extraction").joinpath("fixtures/demo_cases.json")))
            )
        assert_distinct_paths(args.output, *protected)
        report = json.loads(args.predictions.read_text(encoding="utf-8"))
        result = evaluate_predictions(load_fixture_cases(args.fixtures), report)
        atomic_write_json(args.output, result)
        print(f"Evaluation: {result['evaluation_kind']}; cases={result['case_count']}")
        print(f"Eligible for model quality review: {result['eligible_for_model_quality_review']}")
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Evaluation failed ({type(exc).__name__}).")
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
