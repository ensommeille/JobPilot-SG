"""Offline integration demo: replay source-bound draft annotations, never call a model."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from importlib.resources import files  # nosemgrep: python37-compatibility-importlib2
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from app.llm import MockProvider, StructuredGenerationResponse

from .inputs import input_from_job
from .models import FixtureBundle
from .service import JobExtractionService
from .storage import assert_distinct_paths, atomic_write_json


def load_fixture_cases(path: Path | None = None) -> list[dict[str, Any]]:
    raw = (
        path.read_text(encoding="utf-8")
        if path
        else files("app.job_extraction")
        .joinpath("fixtures/demo_cases.json")
        .read_text(encoding="utf-8")
    )
    payload = FixtureBundle.model_validate(json.loads(raw))
    return [case.model_dump(mode="json") for case in payload.cases]


async def run_offline(records: list[Any], cases: list[dict[str, Any]]) -> dict[str, Any]:
    lookup = {(case["source_id"], case["external_id"], case["input_hash"]): case for case in cases}
    results = []
    failures = []
    seen = set()
    for index, record in enumerate(records):
        try:
            if not isinstance(record, dict):
                raise ValueError("Record must be an object")
            job = input_from_job(record)
        except (ValidationError, ValueError):
            failures.append({"input_index": index, "error_code": "invalid_input"})
            continue
        key = (job.source_id, job.external_id, job.input_hash)
        if key in seen:
            failures.append({"input_index": index, "error_code": "duplicate_input"})
            continue
        seen.add(key)
        case = lookup.get(key)
        if case is None:
            failures.append(
                {
                    "input_index": index,
                    "error_code": "no_matching_mock_fixture",
                    "source_id": job.source_id,
                    "external_id": job.external_id,
                }
            )
            continue
        provider = MockProvider(
            [
                StructuredGenerationResponse(
                    data=case["extraction"],
                    provider="mock",
                    model="scripted-fixture-v1",
                    finish_reason="stop",
                )
            ]
        )
        result = await JobExtractionService(provider).extract(job)
        results.append(result.model_dump(mode="json"))
    failed = len(failures) + sum(item["status"] == "failed" for item in results)
    successful = sum(item["status"] == "needs_review" for item in results)
    status = (
        "completed_with_review"
        if successful and not failed
        else "partial"
        if successful
        else "failed"
    )
    return {
        "run_id": str(uuid4()),
        "execution_mode": "mock",
        "status": status,
        "notice": "Offline fixture replay, NOT LLM inference or evidence of model accuracy.",
        "annotation_status": "draft_requires_human_review",
        "finished_at": datetime.now(UTC).isoformat(),
        "input_count": len(records),
        "extracted_count": successful,
        "failed_count": failed,
        "needs_review_count": successful,
        "results": results,
        "input_failures": failures,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, required=True, help="Existing scraper JSON list; never modified"
    )
    parser.add_argument("--output", type=Path, default=Path("output/extractions.mock.json"))
    parser.add_argument(
        "--fixtures", type=Path, help="Explicit fixture set bound to source input hashes"
    )
    args = parser.parse_args(argv)
    try:
        protected = [args.input]
        if args.fixtures:
            protected.append(args.fixtures)
        else:
            protected.append(
                Path(str(files("app.job_extraction").joinpath("fixtures/demo_cases.json")))
            )
        assert_distinct_paths(args.output, *protected)
        records = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise ValueError("Input JSON must be a list of job objects")
        report = asyncio.run(run_offline(records, load_fixture_cases(args.fixtures)))
        # An empty or wholly failed batch preserves the last output snapshot.
        if report["extracted_count"]:
            atomic_write_json(args.output, report)
        print("Mode: MOCK (scripted fixture replay, no model API calls)")
        print(
            f"Status: {report['status']}; extracted={report['extracted_count']}; failed={report['failed_count']}"
        )
        print(f"Needs human review: {report['needs_review_count']}")
        if report["extracted_count"]:
            print(f"Output: {args.output.resolve()}")
        else:
            print("No valid results; previous output was not changed.")
        for failure in report["input_failures"]:
            print(f"Input {failure['input_index']}: {failure['error_code']}")
        return 0 if report["status"] == "completed_with_review" else 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        # Do not print provider responses, credentials, or source content on an error path.
        print(
            f"Unable to process input/output ({type(exc).__name__}); check paths and JSON contracts.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
