"""Reject unproven contradiction claims without altering saved model history."""

import re

from .schemas import BatchAssessment

NEGATIVE = re.compile(
    r"\b(?:no|without|lack(?:s)?)\s+(?:(?:prior|professional|production|commercial|hands-on)\s+)?(?:experience|knowledge|proficiency|familiarity)\b"
    r"|\b(?:cannot|unable\s+to|do\s+not\s+know|don't\s+know|have\s+never)\b|没有.{0,20}(?:经验|知识)|不具备|不会",
    re.I,
)
LEGACY_GAP_MARKER = (
    "No explicit contradictory profile evidence; missing information remains unknown."
)
CORRECTION_PREFIX = "Server evidence correction: a gap was not established by explicit contradictory profile evidence."


def unverified_gap_reason(category: str, requirement: str, field, quote) -> str:
    note = CORRECTION_PREFIX + " Missing information remains unknown; confirm the stated condition."
    if (
        category == "work_constraint"
        and field == "availability"
        and not re.search(r"\b(?:19|20)\d{2}\b", quote or "")
        and re.search(r"\bstart(?:s|ing)?\b", requirement, re.I)
    ):
        note += (
            " The saved availability does not specify a year. Confirm its year and the employer's "
            "exact start conditions; no start-date mismatch has been established."
        )
    return note


def correct_unverified_gaps(result: BatchAssessment) -> BatchAssessment:
    """A read-safe projection also repairs rows saved by the earlier validator.

    Only the precise former downgrade marker (or this rule's own marker) is
    eligible. Outcomes, sources and all unrelated explanations are preserved.
    """
    projected = result.model_copy(deep=True)
    for item in projected.items:
        corrected_availability = []
        for row in item.requirements:
            if row.outcome != "unknown" or not (
                LEGACY_GAP_MARKER in row.reason or row.reason.startswith(CORRECTION_PREFIX)
            ):
                continue
            row.reason = unverified_gap_reason(
                row.category, row.requirement, row.profile_field, row.profile_quote
            )
            if row.category == "work_constraint" and row.profile_field == "availability":
                corrected_availability.append(row)
        if corrected_availability and not any(row.outcome == "gap" for row in item.requirements):
            warnings = []
            for warning in item.warnings:
                if (
                    not warning.startswith(CORRECTION_PREFIX)
                    and re.search(
                        r"\b(?:conflicts?|mismatch|incompatible)\b|does not match", warning, re.I
                    )
                    and re.search(r"availab|\bstart(?:s|ing)?\b|\bbatch(?:es)?\b", warning, re.I)
                ):
                    warning = corrected_availability[0].reason
                if warning not in warnings:
                    warnings.append(warning)
            item.warnings = warnings
    return projected
