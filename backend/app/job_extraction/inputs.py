"""Map existing scraper DTOs or JSON records without importing a particular scraper."""

from collections.abc import Mapping
from typing import Any

from .models import ExtractionInput


def input_from_job(job: Mapping[str, Any]) -> ExtractionInput:
    fields = (
        "source_id",
        "external_id",
        "source_url",
        "source_type",
        "title",
        "company",
        "description",
        "raw_hash",
    )
    return ExtractionInput.model_validate({key: job[key] for key in fields if key in job})


def input_from_raw_item(raw: Mapping[str, Any]) -> ExtractionInput:
    known = raw.get("known_fields")
    if not isinstance(known, Mapping):
        raise ValueError("RawJobItem.known_fields must be an object")
    result = input_from_job(known)
    for key in ("source_id", "external_id", "source_url", "source_type", "raw_hash"):
        if raw.get(key) != getattr(result, key):
            raise ValueError(f"RawJobItem identity mismatch: {key}")
    # Use the isolated JD, not navigation text or raw HTML. Preserve provenance separately.
    return result
