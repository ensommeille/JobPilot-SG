"""Narrow source checks and transparent prioritization, never employer eligibility decisions."""

import re

from .schemas import BatchAssessment, RequirementAssessment

UNDERGRADUATE = re.compile(
    r"\b(?:undergraduate|bachelor(?:'s|s)?|b\.?\s*(?:sc|eng|tech|comp|s|a)\.?)\b", re.I
)
GRADUATION_YEAR = re.compile(
    r"\b(?:graduat(?:e|es|ed|ing|ion)|complet(?:ed|ion)|expected)\b[^\d\n]{0,70}((?:19|20)\d{2})\b",
    re.I,
)
DATE_RANGE = re.compile(r"\b(?:19|20)\d{2}\s*[-–—]\s*((?:19|20)\d{2})\b")
PREFERRED = re.compile(r"\b(?:preferred|preferably|a plus|nice.to.have|optional|bonus)\b", re.I)


def _education_timing(row: RequirementAssessment, education: str) -> tuple[str, bool] | None:
    """Compare named undergraduate dates; a course range does not prove graduation."""
    requested = GRADUATION_YEAR.search(row.jd_quote)
    if (
        row.category != "education"
        or not requested
        or not UNDERGRADUATE.search(row.jd_quote)
        or PREFERRED.search(row.jd_quote)
        or len(education) > 4000
        or re.search(
            r"\b(?:master|postgraduate|graduate (?:degree|student)|phd|alternatively|m\.?\s*(?:sc|tech|eng|comp)\.?)\b",
            row.jd_quote,
            re.I,
        )
        or re.search(r"\bor\b", row.jd_quote[requested.end() :], re.I)
    ):
        return None
    entries = [line for line in re.split(r"[\n;]", education) if UNDERGRADUATE.search(line)]
    dates = []
    for entry in entries:
        explicit = GRADUATION_YEAR.search(entry)
        course = DATE_RANGE.search(entry)
        if not explicit and not course:
            return None  # Another undated undergraduate entry might satisfy the condition.
        dates.append(((explicit or course).group(1), explicit is not None))
    year = requested.group(1)
    if not dates or any(stated == year for stated, _ in dates):
        return None
    stated = ", ".join(sorted({value for value, _ in dates}))
    explicit = all(is_explicit for _, is_explicit in dates)
    qualifier = "explicit graduation/completion date" if explicit else "recorded course end date"
    return (
        f"Education timing needs confirmation: the JD specifies undergraduate graduation in {year}; "
        f"the saved undergraduate {qualifier} is {stated}. "
        + (
            "These explicit dates conflict; confirm the employer's condition before proceeding."
            if explicit
            else "A course date range does not establish degree completion or a graduation date. "
            "Do not assume eligibility; confirm this discrepancy before proceeding."
        ),
        explicit,
    )


def _compound_evidence(row: RequirementAssessment) -> None:
    """Correct only source-checkable, bounded cases, not arbitrary semantic entailment."""
    if row.category != "skill":
        return
    jd, quote = row.jd_quote.casefold(), (row.profile_quote or "").casefold().strip()
    if row.outcome == "supported" and (
        (
            re.search(r"\bgit\s+and\s+github\b", jd)
            and not all(re.search(r"\b" + name + r"\b", quote) for name in ("git", "github"))
        )
        or (
            re.search(r"\bpython\s+and\b", jd)
            and re.search(r"\b(?:pytorch|jax)\b", jd)
            and not (
                re.search(r"\bpython\b", quote)
                and re.search(r"\b(?:pytorch|jax|tensorflow|keras|flax|mxnet|torch)\b", quote)
            )
        )
        or (
            re.search(r"\bpython\s+and\s+interested\b", jd)
            and not (
                re.search(r"\bpython\b", quote)
                and re.search(r"\b(?:interest(?:ed)?|enthusiasm|enthusiastic)\b", quote)
            )
        )
    ):
        row.outcome = "unknown"
        row.reason = (
            "The displayed profile quote supports only one part of this AND condition; "
            "it does not establish the complete compound requirement."
        )
    # A teacher/student distillation experiment supports the explicitly listed generic
    # model-distillation alternative, not a separate video/domain-specific responsibility.
    if (
        row.outcome == "unknown"
        and row.profile_field == "experience"
        and re.search(r"\bmodel distillation\b", jd)
        and re.search(r",\s+or\s+", jd)
        and not re.search(r"\b(?:and|all|every|video|production)\b", jd)
        and all(
            re.search(r"\b" + token + r"\b", quote)
            for token in ("distillation", "teacher", "student")
        )
        and re.search(
            r"\b(?:evaluated|analy[sz]ed|trained|implemented|tested)\b.{0,70}\bdistillation\b",
            quote,
        )
        and not re.search(
            r"\b(?:no|not|never|without|read|reading|described|descriptions|planned|planning|intend|will|would|could|might)\b",
            quote,
        )
    ):
        row.outcome = "supported"
        row.reason = (
            "The quoted teacher/student distillation activity supports the listed model-distillation "
            "OR branch. This does not claim the other alternatives or domain-specific video work."
        )


def _hard_gap(row: RequirementAssessment) -> bool:
    return (
        row.outcome == "gap"
        and row.category in {"education", "work_constraint"}
        and not PREFERRED.search(row.jd_quote)
    )


def prioritize_assessment(result: BatchAssessment, profile: dict) -> BatchAssessment:
    """Keep model order except known hard conflicts; summaries reflect validated rows."""
    concerns = {}
    for item in result.items:
        notes = []
        for row in item.requirements:
            _compound_evidence(row)
            timing = _education_timing(row, profile.get("education") or "")
            if timing:
                note, explicit = timing
                row.outcome = "gap" if explicit else "unknown"
                row.profile_field = "education"
                row.profile_quote = profile["education"]
                row.reason = note
                notes.append(note)
            elif _hard_gap(row):
                notes.append(
                    "Explicit qualification conflict requiring review: " + row.requirement[:300]
                )
        concerns[str(item.job_id)] = notes
        for note in notes:
            if note not in item.warnings:
                item.warnings = [note, *item.warnings][:20]
        counts = {
            outcome: sum(row.outcome == outcome for row in item.requirements)
            for outcome in ("supported", "gap", "unknown")
        }
        supported = [
            row.requirement[:180] for row in item.requirements if row.outcome == "supported"
        ][:3]
        summary = (
            (notes[0] + " Lower priority until this condition is clarified. " if notes else "")
            + f"Evidence review: {counts['supported']} supported, {counts['gap']} explicit gaps, "
            + f"{counts['unknown']} needing confirmation."
            + (" Supported evidence: " + "; ".join(supported) + "." if supported else "")
            + " Review the individual conditions; technical relevance does not establish eligibility."
        )
        item.summary = summary[:3000]
    result.items.sort(key=lambda item: (bool(concerns[str(item.job_id)]), item.rank))
    for rank, item in enumerate(result.items, 1):
        item.rank = rank
    return result
