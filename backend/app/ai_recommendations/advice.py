"""Deterministic action guidance derived from validated rows, never cached model edits."""

import re

from .claim_scope import zero_experience_entry_route
from .evidence_rules import PREFERRED, _education_timing
from .schemas import ActionAdvice, AdviceEvidence, BatchAssessment, EvidenceCounts, JobAssessment

STATE_ORDER = {"priority_apply": 0, "consider": 1, "check_first": 2, "not_priority": 3}
QUALIFICATIONS = {"education", "work_constraint"}
CORE = {"skill", "experience"}
REQUIRED = re.compile(r"\b(?:required|must|essential|mandatory|need to|at least)\b", re.I)
ACTIVITY = re.compile(
    r"\b(?:experience|built|build(?:ing|s)?|develop(?:ed|ing|s)?|"
    r"implement(?:ed|ing|s)?|deploy(?:ed|ing|s)?)\b",
    re.I,
)


def _preferred(row) -> bool:
    # An unrelated optional clause in a broad source span cannot change the
    # priority of this requirement. Both representations must explicitly agree.
    return (
        bool(PREFERRED.search(row.requirement))
        and bool(PREFERRED.search(row.jd_quote))
        and not (REQUIRED.search(row.requirement) or REQUIRED.search(row.jd_quote))
    )


def _evidence(index, row) -> AdviceEvidence:
    return AdviceEvidence(requirement_index=index, **row.model_dump())


def _activity_scope_missing(row) -> bool:
    return (
        row.category in CORE
        and row.outcome == "supported"
        and row.profile_field == "skills"
        and (row.category == "experience" or bool(ACTIVITY.search(row.requirement)))
    )


def _project(item: JobAssessment) -> tuple[JobAssessment, bool]:
    projected = item.model_copy(deep=True)
    adjusted = False
    for row in projected.requirements:
        note = None
        if _activity_scope_missing(row):
            row.outcome = "unknown"
            note = (
                "Conservative application review: a skills-list tool name does not establish "
                "the requested hands-on activity or experience. Add explicit activity evidence. "
                "The original AI assessment is preserved for review."
            )
        elif row.outcome == "unknown" and PREFERRED.search(row.jd_quote) and not _preferred(row):
            note = (
                "Optional wording in a broad or neighbouring source clause does not establish "
                "that this particular requirement is optional. Confirm its priority. "
                "The original AI assessment is preserved for review."
            )
        if note:
            adjusted = True
            row.reason = row.reason[: max(0, 1999 - len(note))].rstrip() + " " + note
    return projected, adjusted


def _core_supported(item: JobAssessment) -> int:
    # Repeating one Python skill under several requirements is one evidence basis,
    # not several independently established capabilities.
    return len(
        {
            (row.profile_field, " ".join((row.profile_quote or "").casefold().split()))
            for row in item.requirements
            if row.category in CORE
            and row.outcome == "supported"
            and not _preferred(row)
            and not _activity_scope_missing(row)
            and not zero_experience_entry_route(row.requirement)
        }
    )


def derive_advice(item: JobAssessment) -> ActionAdvice:
    """Separate eligibility gates from ordinary gaps in saved skill evidence.

    Responsibility uncertainty is not a missing applicant skill. Education-only
    overlap cannot make a role a priority, regardless of the model's raw rank.
    """
    item, _adjusted = _project(item)
    indexed = list(enumerate(item.requirements))
    critical = [
        (index, row)
        for index, row in indexed
        if row.category in QUALIFICATIONS | CORE
        and not _preferred(row)
        and not (row.category == "experience" and zero_experience_entry_route(row.requirement))
    ]
    gaps = [(index, row) for index, row in critical if row.outcome == "gap"]
    qualifications = [
        (index, row)
        for index, row in critical
        if row.category in QUALIFICATIONS and row.outcome == "unknown"
    ]
    core_unknown = [
        (index, row) for index, row in critical if row.category in CORE and row.outcome == "unknown"
    ]
    mandatory_unknown = [
        (index, row)
        for index, row in core_unknown
        if REQUIRED.search(row.requirement)
        or (
            PREFERRED.search(row.requirement)
            and REQUIRED.search(row.jd_quote)
            and not PREFERRED.search(row.jd_quote)
        )
    ]
    supported = _core_supported(item)
    if gaps:
        state, headline = "not_priority", "Lower priority for now"
        reasons = [
            "A stated applicant condition conflicts with your saved evidence: "
            + gaps[0][1].requirement[:160]
        ]
    elif qualifications:
        state, headline = "check_first", "Confirm eligibility before applying"
        reasons = ["Confirm this eligibility condition: " + qualifications[0][1].requirement[:160]]
    elif mandatory_unknown:
        state, headline = "check_first", "Confirm a required capability first"
        reasons = [
            "Evidence is missing for an explicitly required condition: "
            + mandatory_unknown[0][1].requirement[:160]
        ]
    elif supported == 0:
        state, headline = "not_priority", "Limited evidence of a relevant fit"
        reasons = [
            "No core skill or experience was established by the displayed evidence; this is a relevance limit, not an eligibility rejection."
        ]
    elif supported >= 2 and not core_unknown:
        state, headline = "priority_apply", "Worth prioritising"
        reasons = [
            "Multiple distinct core requirements have saved evidence; no unresolved applicant condition appears in this analysis."
        ]
    else:
        state, headline = "consider", "Worth considering"
        reasons = [
            "There is relevant saved evidence, while some capabilities remain unconfirmed."
            if core_unknown
            else "There is relevant saved evidence, but the basis is limited."
        ]
    positive = [
        row for _index, row in critical if row.outcome == "supported" and row.category in CORE
    ]
    if positive:
        prefix = (
            "Tool or skill evidence: "
            if positive[0].profile_field == "skills"
            else "Activity evidence: "
        )
        reasons.append(prefix + positive[0].requirement[:160])
    elif core_unknown and len(reasons) < 2:
        reasons.append("Capability needing evidence: " + core_unknown[0][1].requirement[:160])
    blockers = sorted(
        [*gaps, *qualifications, *core_unknown],
        key=lambda pair: (
            pair[1].outcome != "gap",
            pair[1].category not in QUALIFICATIONS,
            pair[0],
        ),
    )
    strengths = sorted(
        [
            (index, row)
            for index, row in indexed
            if row.outcome == "supported" and row.category in CORE | QUALIFICATIONS
        ],
        key=lambda pair: (pair[1].category not in CORE, _preferred(pair[1]), pair[0]),
    )
    return ActionAdvice(
        status=state,
        headline=headline,
        reasons=reasons,
        blockers=[_evidence(index, row) for index, row in blockers],
        strengths=[_evidence(index, row) for index, row in strengths],
        counts=EvidenceCounts(
            **{
                outcome: sum(row.outcome == outcome for row in item.requirements)
                for outcome in ("supported", "gap", "unknown")
            }
        ),
    )


def advice_for_batch(
    result: BatchAssessment, profile: dict
) -> tuple[dict[str, ActionAdvice], list]:
    advice = {str(item.job_id): derive_advice(item) for item in result.items}

    def ordering(item):
        timing_concern = any(
            _education_timing(row, profile.get("education") or "") for row in item.requirements
        )
        return (
            STATE_ORDER[advice[str(item.job_id)].status],
            bool(timing_concern),
            -_core_supported(item),
            -len(advice[str(item.job_id)].strengths),
            item.rank,
        )

    return advice, [item.job_id for item in sorted(result.items, key=ordering)]
