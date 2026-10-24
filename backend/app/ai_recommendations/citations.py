"""Strict input-bound references resolved to contiguous, exact source quotations."""

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from .claim_scope import activity_evidence_issue, compound_scope_issue
from .gap_evidence import NEGATIVE, unverified_gap_reason
from .schemas import StrictModel

ProfileField = Literal["education", "experience", "skills", "availability"]
Outcome = Literal["supported", "gap", "unknown"]


class SourceRange(StrictModel):
    start_id: str = Field(min_length=1, max_length=128)
    end_id: str = Field(min_length=1, max_length=128)


class ConditionCheck(StrictModel):
    condition: str = Field(min_length=1, max_length=1000)
    outcome: Outcome
    profile_field: ProfileField | None
    profile_source_range: SourceRange | None
    reason: str = Field(min_length=1, max_length=1000)


class ReferencedRequirement(StrictModel):
    requirement: str = Field(min_length=1, max_length=2000)
    category: Literal[
        "skill", "responsibility", "education", "experience", "work_constraint", "other"
    ]
    outcome: Outcome
    jd_source_range: SourceRange
    profile_field: ProfileField | None
    profile_source_range: SourceRange | None
    reason: str = Field(min_length=1, max_length=2000)
    condition_operator: Literal["atomic", "all_of", "any_of", "unspecified"]
    condition_checks: list[ConditionCheck] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def atomic_shape(self):
        if self.condition_operator == "atomic" and len(self.condition_checks) != 1:
            raise ValueError("An atomic condition has exactly one check")
        if self.condition_operator in {"all_of", "any_of"} and len(self.condition_checks) < 2:
            raise ValueError("A compound condition needs its separate branches")
        return self


class ReferencedJob(StrictModel):
    job_id: UUID
    rank: int = Field(ge=1, le=5, strict=True)
    summary: str = Field(min_length=1, max_length=3000)
    requirements: list[ReferencedRequirement] = Field(min_length=1, max_length=25)
    warnings: list[str] = Field(max_length=20)


class ReferencedBatch(StrictModel):
    requires_review: Literal[True]
    items: list[ReferencedJob] = Field(min_length=1, max_length=5)

    @model_validator(mode="before")
    @classmethod
    def explicit_review(cls, data):
        if isinstance(data, dict) and data.get("requires_review") is not True:
            raise ValueError("requires_review must be JSON true")
        return data


@dataclass(frozen=True)
class SourceSpan:
    source_id: str
    scope: str
    owner: str
    field: str
    entry: int
    ordinal: int
    start: int
    end: int
    text: str


def _segments(text: str):
    """Bounded short spans; retain original offsets and all intervening characters."""
    start = 0
    while start < len(text):
        boundary = min(start + 240, len(text))
        preferred = next(re.finditer(r"\n|[.!?;:]\s+", text[start:boundary]), None)
        if preferred:
            boundary = start + preferred.end()
        elif boundary < len(text):
            space = text.rfind(" ", start + 60, boundary)
            if space > start:
                boundary = space + 1
        left, right = start, boundary
        while left < right and text[left].isspace():
            left += 1
        while right > left and text[right - 1].isspace():
            right -= 1
        if left < right:
            yield left, right
        start = boundary


def source_catalog(payload: dict) -> dict[str, SourceSpan]:
    identity = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()[:20]
    catalog = {}

    def add(scope, owner, field, entry, text):
        if not text:
            return
        # Degree abbreviations contain full stops. Splitting there lets the
        # model select a date/major without its degree context. Education lines
        # remain complete; wrapped lines can still share a contiguous range.
        segments = (
            ((m.start(), m.end()) for m in re.finditer(r"[^\r\n]+", text))
            if scope == "profile" and field == "education"
            else _segments(text)
        )
        for ordinal, (start, end) in enumerate(segments):
            if scope == "profile" and "[redacted]" in text[start:end]:
                continue
            binding = f"{identity}|{scope}|{owner}|{field}|{entry}|{start}|{end}"
            source_id = "src_" + hashlib.sha256(binding.encode()).hexdigest()[:24]
            catalog[source_id] = SourceSpan(
                source_id, scope, owner, field, entry, ordinal, start, end, text
            )

    for field, value in payload["profile"].items():
        values = value if isinstance(value, list) else [value]
        for entry, text in enumerate(values):
            add("profile", "profile", field, entry, text)
    for job in payload["jobs"]:
        add("job", job["id"], "description", 0, job["description"])
    return catalog


def request_with_sources(payload: dict, catalog: dict[str, SourceSpan]) -> dict:
    return {
        **payload,
        "source_catalog": [
            {
                "source_id": span.source_id,
                "scope": span.scope,
                "job_id": span.owner if span.scope == "job" else None,
                "profile_field": span.field if span.scope == "profile" else None,
                "entry_index": span.entry,
                "start": span.start,
                "end": span.end,
                "text": span.text[span.start : span.end],
            }
            for span in catalog.values()
        ],
    }


def _resolve(source_range, catalog, *, scope, owner, field) -> str | None:
    if source_range is None:
        return None
    try:
        first = catalog[source_range.start_id]
        last = catalog[source_range.end_id]
    except (KeyError, TypeError):
        raise ValueError("invalid_evidence") from None
    if (
        any(
            span.scope != scope
            or span.owner != owner
            or span.field != field
            or span.entry != first.entry
            or span.text != first.text
            or not 0 <= span.start < span.end <= len(span.text)
            for span in (first, last)
        )
        or first.ordinal > last.ordinal
        or first.start > last.start
        or first.end > last.end
    ):
        raise ValueError("invalid_evidence")
    quote = first.text[first.start : last.end]
    if len(quote) > 4000 or "[redacted]" in quote:
        raise ValueError("invalid_evidence")
    return quote


def _profile_quote(field, source_range, catalog):
    if (field is None) != (source_range is None):
        raise ValueError("invalid_evidence")
    return _resolve(source_range, catalog, scope="profile", owner="profile", field=field)


def resolve_assessment(data: dict, payload: dict, catalog: dict[str, SourceSpan]) -> dict:
    """Resolve only issued IDs; never search/fuzzily align model-written quotations."""
    checked = ReferencedBatch.model_validate(data)
    expected = {job["id"] for job in payload["jobs"]}
    if (
        len(checked.items) != len(expected)
        or {str(job.job_id) for job in checked.items} != expected
    ):
        raise ValueError("invalid_evidence")
    result = {"requires_review": True, "items": []}
    for item in checked.items:
        rows = []
        for row in item.requirements:
            jd_quote = _resolve(
                row.jd_source_range,
                catalog,
                scope="job",
                owner=str(item.job_id),
                field="description",
            )
            profile_quote = _profile_quote(row.profile_field, row.profile_source_range, catalog)
            outcomes = []
            unproven_gap = False
            for condition in row.condition_checks:
                proof = _profile_quote(
                    condition.profile_field, condition.profile_source_range, catalog
                )
                if condition.outcome == "supported" and not proof:
                    raise ValueError("invalid_evidence")
                shown = (
                    proof is not None
                    and profile_quote is not None
                    and condition.profile_field == row.profile_field
                    and " ".join(proof.split()) in " ".join(profile_quote.split())
                )
                scoped = not activity_evidence_issue(
                    condition.condition, row.category, condition.profile_field, proof
                )
                contradicted = condition.outcome != "gap" or bool(proof and NEGATIVE.search(proof))
                unproven_gap |= condition.outcome == "gap" and not contradicted
                outcomes.append(
                    condition.outcome if shown and scoped and contradicted else "unknown"
                )
            if row.condition_operator in {"atomic", "all_of"}:
                aggregate = (
                    "supported"
                    if all(value == "supported" for value in outcomes)
                    else "gap"
                    if "gap" in outcomes
                    else "unknown"
                )
            elif row.condition_operator == "any_of":
                aggregate = (
                    "supported"
                    if "supported" in outcomes
                    else "gap"
                    if all(value == "gap" for value in outcomes)
                    else "unknown"
                )
            else:
                aggregate = "unknown"
            outcome, reason = row.outcome, row.reason
            if unproven_gap and outcome in {"gap", "unknown"}:
                outcome = "unknown"
                reason = unverified_gap_reason(
                    row.category, row.requirement, row.profile_field, profile_quote
                )
            scope_issue = compound_scope_issue(
                row.requirement, row.condition_operator, row.category
            )
            activity_issue = activity_evidence_issue(
                row.requirement, row.category, row.profile_field, profile_quote
            )
            if outcome == "supported" and (scope_issue or activity_issue):
                outcome = "unknown"
                note = " " + (scope_issue or activity_issue)
                reason = reason[: 2000 - len(note)] + note
            if outcome in {"supported", "gap"} and aggregate != outcome:
                outcome = "unknown"
                note = " Not every necessary condition has corresponding evidence in the displayed contiguous profile source."
                reason = reason[: 2000 - len(note)] + note
            rows.append(
                {
                    "requirement": row.requirement,
                    "category": row.category,
                    "outcome": outcome,
                    "jd_quote": jd_quote,
                    "profile_field": row.profile_field,
                    "profile_quote": profile_quote,
                    "reason": reason,
                }
            )
        result["items"].append(
            {
                "job_id": str(item.job_id),
                "rank": item.rank,
                "summary": item.summary,
                "requirements": rows,
                "warnings": item.warnings,
            }
        )
    return result
