"""Grounded model career direction and a concise application decision.

The model supplies career alignment, not an invented applicant biography. Every
displayed advantage reuses an independently validated requirement or activity.
"""

import re

from .claim_scope import activity_evidence_issue, skill_subject_evidence_issue
from .schemas import ApplicationRecommendation, JobAssessment

AUDIT_WORDS = re.compile(
    r"\b(?:evidence|supported|unsupported|unknown|verified|unverified|validation|audit|proof|unconfirmed)\b"
    r"|证据|未知|验证|校验|审计|待核对",
    re.I,
)
ADVISORY = re.compile(
    r"\b(?:confirm|check|prepare|consider|plan|highlight|strengthen|discuss|ensure|ask|would|could|may|before applying|be ready)\b",
    re.I,
)
NEGATIVE_PERSONAL = re.compile(
    r"\b(?:lack(?:s|ing)?|cannot|ineligible|not eligible|not qualified|no experience|"
    r"do not have|don't have|does not have|does not meet|fail(?:s)? to meet)\b",
    re.I,
)
PERSONAL_DECLARATION = re.compile(
    r"(?:^|[.;]\s*)(?:you\s+(?:have|are|can|know)|the applicant\s+(?:has|is)|"
    r"your\s+(?:experience|degree|skills|knowledge)\s+(?:is|are|includes?|proves?|demonstrates?))\b",
    re.I,
)
MONTHS = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b",
    re.I,
)


def _contains(text: str, original: str) -> bool:
    return " ".join(text.casefold().split()).rstrip(" .;:") in " ".join(original.casefold().split())


def _short(text: str) -> str:
    return " ".join(text.split()).strip(" .;:")[:210]


def _plain(text: str) -> bool:
    return bool(text.strip()) and not AUDIT_WORDS.search(text)


def _dates_match(text: str, source: str) -> bool:
    return set(re.findall(r"\d+", text)) <= set(re.findall(r"\d+", source)) and {
        month.casefold() for month in MONTHS.findall(text)
    } <= {month.casefold() for month in MONTHS.findall(source)}


def _row(item: JobAssessment, index: int):
    if index >= len(item.requirements):
        raise ValueError("invalid_evidence")
    return item.requirements[index]


def strength_sources(item: JobAssessment, point) -> list[tuple[str, str, str, str]]:
    """Return (category, field, original quote, validated local condition)."""
    row = _row(item, point.requirement_index)
    if point.basis == "condition":
        if point.condition_index is None or point.condition_index >= len(row.condition_checks):
            raise ValueError("invalid_evidence")
        condition = row.condition_checks[point.condition_index]
        if condition.outcome == "supported" and condition.profile_field and condition.profile_quote:
            return [
                (
                    row.category,
                    condition.profile_field,
                    condition.profile_quote,
                    condition.condition,
                )
            ]
        return []
    if point.condition_index is not None:
        raise ValueError("invalid_evidence")
    if point.basis == "requirement":
        if row.outcome == "supported" and row.profile_field and row.profile_quote:
            return [(row.category, row.profile_field, row.profile_quote, row.requirement)]
        return []
    return [
        ("experience", entry.profile_field, entry.profile_quote, "Hands-on project experience")
        for entry in item.related_evidence
        if entry.kind == "related_activity" and entry.requirement_index == point.requirement_index
    ]


def _safe_strength(text: str, source: tuple[str, str, str, str]) -> bool:
    category, field, quote, statement = source
    # A user-facing paraphrase cannot quietly add a new skill or turn academic
    # projects into commercial work. Short source/condition wording is sufficient.
    return (
        _plain(text)
        and (_contains(text, quote) or _contains(text, statement))
        and not activity_evidence_issue(text, category, field, quote)
        and not skill_subject_evidence_issue(text, category, quote)
        and _dates_match(text, quote + " " + statement)
    )


def _fallback_strength(source: tuple[str, str, str, str]) -> str:
    category, field, quote, statement = source
    if _plain(statement) and not activity_evidence_issue(statement, category, field, quote):
        return _short(statement)
    return (
        "Related project experience"
        if field == "experience"
        else "Relevant academic background"
        if field == "education"
        else "Relevant skills"
    )


def _attention(row, condition=None) -> str:
    pending = [check.condition for check in row.condition_checks if check.outcome != "supported"]
    text = (
        condition.condition if condition else "; ".join(pending[:2]) if pending else row.requirement
    )
    if row.category == "education":
        return "Check the role's study and graduation requirements before applying."
    if row.category == "work_constraint":
        return "Plan for the role's stated start date, hours and work location."
    if row.outcome == "gap":
        return "Consider the difference between this role's requirements and your stated situation."
    return (
        "Prepare to discuss: " + _short(text)[:180]
        if _plain(text)
        else "Prepare to discuss the role's specialist skills."
    )


def validate_career_fit(item: JobAssessment, description: str, profile: dict) -> None:
    fit = item.career_fit
    if fit is None:
        return
    if not _contains(fit.jd_quote, description):
        raise ValueError("invalid_evidence")
    value = profile.get(fit.profile_field) if fit.profile_field else None
    originals = value if isinstance(value, list) else [value] if value else []
    if (fit.profile_field is None) != (fit.profile_quote is None):
        raise ValueError("invalid_evidence")
    if fit.profile_quote and (
        "[redacted]" in fit.profile_quote
        or not any(_contains(fit.profile_quote, original) for original in originals)
    ):
        raise ValueError("invalid_evidence")
    if fit.direction != "undetermined" and not fit.profile_quote:
        raise ValueError("invalid_evidence")
    for field, original in [("job_focus", fit.jd_quote), ("profile_focus", fit.profile_quote)]:
        focus = getattr(fit, field)
        if focus is not None and (
            not original or not focus.strip() or not _plain(focus) or not _contains(focus, original)
        ):
            # A presentation label is not a citation. Invalid paraphrases are
            # discarded, never promoted into a new applicant capability.
            setattr(fit, field, None)
            fit.server_adjusted = True
    valid = []
    for point in fit.strengths:
        sources = strength_sources(item, point)
        if not sources:
            fit.server_adjusted = True
            continue
        if not any(_safe_strength(point.text, source) for source in sources):
            point.text = _fallback_strength(sources[0])
            fit.server_adjusted = True
        valid.append(point)
    fit.strengths = valid
    for point in fit.considerations:
        row = _row(item, point.requirement_index)
        condition = None
        if point.condition_index is not None:
            if point.condition_index >= len(row.condition_checks):
                raise ValueError("invalid_evidence")
            condition = row.condition_checks[point.condition_index]
        outcome = condition.outcome if condition else row.outcome
        if (
            not _plain(point.text)
            or not _dates_match(point.text, row.jd_quote)
            or (
                outcome == "unknown"
                and (
                    not ADVISORY.search(point.text)
                    or NEGATIVE_PERSONAL.search(point.text)
                    or PERSONAL_DECLARATION.search(point.text)
                )
            )
        ):
            point.text = _attention(row, condition)
            fit.server_adjusted = True


def application_recommendation(
    item: JobAssessment,
    *,
    core_supported: int,
    related,
    conflicts,
    qualifications,
    mandatory_unknown,
    core_unknown,
) -> ApplicationRecommendation | None:
    fit = item.career_fit
    if fit is None:
        return None  # Historical records do not acquire a new model career judgment.
    core_relation = bool(core_supported) or any(
        item.requirements[entry.requirement_index].category in {"skill", "experience"}
        or entry.kind == "related_activity"
        for entry in related
    )
    if conflicts:
        verdict = "not_priority"
        summary = "Keep this role lower on your list because an important application condition conflicts with your situation."
    elif fit.direction == "low":
        verdict = "not_priority"
        summary = "This role is outside your main career focus, so keep it lower on your list."
    elif fit.direction == "undetermined" or not core_relation:
        verdict = "insufficient_information"
        summary = "A useful application recommendation is not available yet."
    elif (
        fit.direction == "direct"
        and fit.proposed_verdict == "priority_apply"
        and core_supported >= 2
        and not qualifications
        and not mandatory_unknown
    ):
        verdict = "priority_apply"
        summary = "This role is a good priority for your job search."
    else:
        verdict = "consider"
        summary = "This role is worth a try; highlight your related work and prepare for the specialist requirements."
    if fit.job_focus and fit.profile_focus:
        # Source focuses can be noun phrases OR complete performed actions.
        # Labels accommodate both without turning "Built ..." into a noun.
        focuses = (
            f"Role focus: {_short(fit.job_focus)}. Related background: {_short(fit.profile_focus)}."
        )
        if verdict == "not_priority" and not conflicts:
            summary = "Lower priority because the career directions differ. " + focuses
        elif verdict == "consider":
            summary = "Worth considering. " + focuses
        elif verdict == "priority_apply":
            summary = "Prioritise applying. " + focuses
    strength_labels = []
    for point in fit.strengths:
        sources = strength_sources(item, point)
        skill_quote = next(
            (
                source[2]
                for source in sources
                if source[1] == "skills" and len(source[2]) <= 120 and _plain(source[2])
            ),
            None,
        )
        # Read-time only: both batch and detail display the applicant's actual
        # named skill rather than the employer's entire OR-list of examples.
        strength_labels.append(_short(skill_quote) if skill_quote else point.text)
    strengths = list(dict.fromkeys(strength_labels))[:3]
    indexed_considerations = [(point.requirement_index, point.text) for point in fit.considerations]
    # The model chooses career direction and proposed action; the concise summary
    # expresses the final capped decision without adding unchecked biography claims.
    for index, row in [*conflicts, *qualifications, *mandatory_unknown, *core_unknown]:
        if not any(existing == index for existing, _text in indexed_considerations):
            indexed_considerations.append((index, _attention(row)))
    indexed_considerations.sort(
        key=lambda pair: (
            item.requirements[pair[0]].outcome != "gap",
            item.requirements[pair[0]].category not in {"education", "work_constraint"},
            pair[0] not in {index for index, _row in core_unknown},
        )
    )
    considerations = list(dict.fromkeys(text for _index, text in indexed_considerations))[:3]
    return ApplicationRecommendation(
        verdict=verdict, summary=summary, strengths=strengths, considerations=considerations
    )
