"""Opt-in, source-bound local revisions; original model records stay unchanged."""

import hashlib
import json
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import JobExtractionRun, JobPosting

from .models import ExtractionInput, ExtractionResult, JobExtractionSchemaV2
from .quality import assess_quality

NOTICE = (
    "Uses an agent-authored local revision checked against the bound job description. "
    "The original model output is retained. Human review is still required; "
    "this is not another model generation or a hiring decision."
)


class InvalidSourceReview(ValueError):
    """A configured target must fail closed rather than use an unverified revision."""


class SourceReviewProvenance(BaseModel):
    kind: Literal["agent_source_review"] = "agent_source_review"
    original_result_id: UUID
    input_hash: str
    corrected_sha256: str
    requires_human_review: Literal[True] = True
    notice: str = NOTICE


class ReviewBundle(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["jobpilot-source-review-v1"]
    job_id: UUID
    source_id: UUID
    input: dict
    original_result_text: str = Field(min_length=1, max_length=1_000_000)
    corrected_extraction: dict
    corrected_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    review_manifest: dict


def canonical_sha256(value: dict) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _require(condition: bool) -> None:
    if not condition:
        raise InvalidSourceReview("invalid_source_review")


def _index(token: str, items: list) -> int:
    _require(bool(re.fullmatch(r"0|[1-9]\d*", token)))
    index = int(token)
    _require(index < len(items))
    return index


def _parent(document: dict, path: str):
    _require(isinstance(path, str) and path.startswith("/") and "~" not in path)
    tokens = path.split("/")[1:]
    _require(bool(tokens) and all(tokens))
    parent = document
    for token in tokens[:-1]:
        if isinstance(parent, list):
            parent = parent[_index(token, parent)]
        else:
            _require(isinstance(parent, dict) and token in parent)
            parent = parent[token]
    return parent, tokens[-1]


def _check_operation_evidence(value, quote: str) -> None:
    if isinstance(value, dict):
        if "evidence" in value:
            evidence = value["evidence"]
            _require(isinstance(evidence, str) and bool(evidence) and evidence in quote)
        for child in value.values():
            _check_operation_evidence(child, quote)
    elif isinstance(value, list):
        for child in value:
            _check_operation_evidence(child, quote)


def _replay(original: dict, manifest: dict, description: str) -> dict:
    operations = manifest.get("operations")
    _require(isinstance(operations, list) and len(operations) == 8)
    document = deepcopy(original)
    for operation in operations:
        _require(isinstance(operation, dict))
        kind = operation.get("op")
        keys = {"op", "path", "before", "reason", "source_quote", "source_start", "source_end"}
        _require(kind in {"replace", "remove", "add"})
        _require(set(operation) == keys | ({"value"} if kind != "remove" else set()))
        quote = operation["source_quote"]
        start, end = operation["source_start"], operation["source_end"]
        _require(isinstance(quote, str) and bool(quote))
        _require(type(start) is int and type(end) is int and 0 <= start < end <= len(description))
        _require(description[start:end] == quote)
        _require(isinstance(operation["reason"], str) and bool(operation["reason"].strip()))
        _check_operation_evidence(operation["before"], quote)
        parent, token = _parent(document, operation["path"])
        if kind == "add":
            _require(operation["path"] == "/requirement_groups/-")
            _require(isinstance(parent, list) and operation["before"] is None)
            _check_operation_evidence(operation["value"], quote)
            parent.append(deepcopy(operation["value"]))
            continue
        if isinstance(parent, list):
            key = _index(token, parent)
        else:
            _require(isinstance(parent, dict) and token in parent)
            key = token
        _require(parent[key] == operation["before"])
        if kind == "remove":
            del parent[key]
        else:
            _check_operation_evidence(operation["value"], quote)
            parent[key] = deepcopy(operation["value"])
    return document


def resolve_source_review(
    job: JobPosting, run: JobExtractionRun | None
) -> tuple[JobExtractionSchemaV2, SourceReviewProvenance] | None:
    """Only the server's explicit bundle can map an original source alias to a local UUID.

    This validates the original input identity separately from that mapping; it never
    changes a model result's identity, payload, execution mode, or historical row.
    """
    configured = os.environ.get("JOBPILOT_REVIEW_BUNDLE")
    if not configured:
        return None
    try:
        path = Path(configured)
        _require(path.stat().st_size <= 2_000_000)
        bundle = ReviewBundle.model_validate_json(path.read_bytes())
        if bundle.job_id != job.id:
            # A wrong local mapping for this exact original is a broken target,
            # not permission to silently fall back to its unreviewed result.
            _require(
                run is None or str(run.id) != bundle.review_manifest.get("original_live_result_id")
            )
            return None
        manifest = bundle.review_manifest
        _require(run is not None and run.job_id == job.id and run.status == "needs_review")
        original_data = json.loads(bundle.original_result_text)
        original = ExtractionResult.model_validate(original_data)
        source = ExtractionInput.model_validate(bundle.input)
        _require(original.schema_version == "job-extraction-v2")
        _require(original.status == "needs_review" and original.execution_mode == "live")
        _require(
            hashlib.sha256(bundle.original_result_text.encode("utf-8")).hexdigest()
            == manifest.get("original_live_result_file_sha256")
        )
        _require(manifest.get("review_kind") == "coding_agent_source_comparison")
        _require(
            manifest.get("approval_status") == "proposed_local_correction_requires_user_review"
        )
        corrections = manifest.get("additional_requests_for_corrections")
        _require(type(corrections) is int and corrections == 0)
        _require(manifest.get("historical_teammate_run_modified") is False)
        _require(str(run.id) == original.result_id == manifest.get("original_live_result_id"))
        _require(run.result_json == original_data and run.input_json == bundle.input)
        _require(
            source.input_hash == original.input_hash == run.input_hash == manifest.get("input_hash")
        )
        _require(
            original.source_id == source.source_id
            and original.external_id == source.external_id
            and original.source_url == source.source_url
            and original.raw_hash == source.raw_hash
        )
        _require(
            job.source_id == bundle.source_id
            and job.source.source_type == source.source_type
            and job.external_id == source.external_id
            and job.source_url == source.source_url
            and job.title == source.title
            and job.company == source.company
            and job.description == source.description
            and job.raw_hash == source.raw_hash
        )
        _require(canonical_sha256(bundle.corrected_extraction) == bundle.corrected_sha256)
        replayed = _replay(original_data["extraction"], manifest, source.description)
        _require(replayed == bundle.corrected_extraction)
        payload = JobExtractionSchemaV2.model_validate(bundle.corrected_extraction)
        quality = assess_quality(payload, source.description)
        _require(not quality.issues and quality.score == 1.0)
        return payload, SourceReviewProvenance(
            original_result_id=UUID(original.result_id),
            input_hash=source.input_hash,
            corrected_sha256=bundle.corrected_sha256,
        )
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError):
        raise InvalidSourceReview("invalid_source_review") from None
