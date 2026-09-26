"""Provider-injected batch entry point; no environment, transport or database ownership."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.llm import LLMProvider

from .inputs import input_from_job
from .service import ExtractionConfig, JobExtractionService


async def extract_batch(
    records: list[Any],
    provider: LLMProvider,
    *,
    max_items: int = 20,
    config: ExtractionConfig | None = None,
) -> dict[str, Any]:
    """Extract sequentially with isolated input failures and bounded work.

    The caller creates and closes the provider and decides how to persist results.
    No factory is called implicitly. Passing a live provider can incur API costs.
    Results retain their input index; all successful extractions require review.
    """
    if type(max_items) is not int or not 1 <= max_items <= 100:
        raise ValueError("max_items must be an integer between 1 and 100")
    if not isinstance(records, list) or len(records) > max_items:
        raise ValueError("Expected a list within the explicit batch limit")
    service = JobExtractionService(provider, config)
    seen = set()
    results = []
    failures = []
    for index, record in enumerate(records):
        try:
            if not isinstance(record, dict):
                raise ValueError("Expected a job object")
            job = input_from_job(record)
        except (ValueError, ValidationError, TypeError):
            failures.append({"input_index": index, "error_code": "invalid_input"})
            continue
        identity = (job.source_id, job.external_id, job.input_hash)
        if identity in seen:
            failures.append({"input_index": index, "error_code": "duplicate_input"})
            continue
        seen.add(identity)
        result = await service.extract(job)
        results.append({"input_index": index, "result": result.model_dump(mode="json")})
    extracted = sum(item["result"]["status"] == "needs_review" for item in results)
    failed = len(records) - extracted
    return {
        "status": "completed_with_review"
        if extracted and not failed
        else "partial"
        if extracted
        else "failed",
        "input_count": len(records),
        "extracted_count": extracted,
        "failed_count": failed,
        "needs_review_count": extracted,
        "results": results,
        "input_failures": failures,
    }
