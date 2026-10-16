"""Read-only, deterministic evidence comparison. Never a hiring or eligibility decision."""

import re
import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db.models import JobExtractionRun, JobPosting, UserProfile
from app.db.session import get_db
from app.job_extraction.models import (
    ExtractionResult,
    JobExtractionSchemaV2,
    RequirementAtom,
    RequirementGroup,
    TextFact,
)
from app.job_extraction.persistence import ExtractionRequestError, job_input
from app.job_extraction.quality import (
    duration_evidence_supported,
    hours_evidence_supported,
    normalized,
)
from app.jobs.service import get_job
from app.skill_signals import is_uncertain_or_negative, mentions, positive_profile

router = APIRouter(tags=["job-matching"])
Database = Annotated[Session, Depends(get_db)]


class MatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SkillOverlap(BaseModel):
    skill_id: str
    label: str
    kind: Literal["specific", "general"]
    profile_evidence: str


class MatchCondition(BaseModel):
    kind: Literal["skill", "language", "trait", "interest", "qualification"]
    requirement: str
    qualifier: str | None = None
    qualifier_evidence: str | None = None
    outcome: Literal["supported", "gap", "unknown"]
    reason: str
    job_evidence: str
    profile_evidence: str | None = None
    skill_overlaps: list[SkillOverlap] = Field(default_factory=list)


class MatchItem(BaseModel):
    category: str
    requirement: str
    importance: Literal["required", "preferred", "unspecified"]
    outcome: Literal["supported", "gap", "unknown"]
    reason: str
    job_evidence: str
    profile_evidence: str | None = None
    profile_field: str | None = None
    skill_overlaps: list[SkillOverlap] = Field(default_factory=list)
    group_operator: Literal["all_of", "any_of", "unspecified"] | None = None
    conditions: list[MatchCondition] = Field(default_factory=list)


class MatchResponsibility(BaseModel):
    value: str
    evidence: str
    priority: Literal["primary", "secondary", "conditional", "unspecified"] = "unspecified"
    condition: TextFact | None = None


class MatchAnalysis(BaseModel):
    version: str = "evidence-overlap-v2"
    job_id: UUID
    status: Literal["preliminary", "unavailable"]
    reason: str | None = None
    extraction_id: UUID | None = None
    warnings: list[str] = Field(default_factory=list)
    items: list[MatchItem] = Field(default_factory=list)
    work_constraints: list[MatchItem] = Field(default_factory=list)
    summary: TextFact | None = None
    responsibilities: list[MatchResponsibility] = Field(default_factory=list)


# Only a closed set of atomic skill labels is comparable. Compound requirements,
# proficiency, alternatives and inferred years remain unknown.
ALIASES = {
    "python": "python",
    "javascript": "javascript",
    "js": "javascript",
    "typescript": "typescript",
    "ts": "typescript",
    "java": "java",
    "sql": "sql",
    "postgresql": "postgresql",
    "postgres": "postgresql",
    "mysql": "mysql",
    "react": "react",
    "react.js": "react",
    "reactjs": "react",
    "node.js": "node.js",
    "nodejs": "node.js",
    "html": "html",
    "css": "css",
    "git": "git",
    "docker": "docker",
    "kubernetes": "kubernetes",
    "fastapi": "fastapi",
    "django": "django",
    "flask": "flask",
    "c": "c",
    "c++": "c++",
    "c#": "c#",
    "go": "go",
    "golang": "go",
    "rust": "rust",
    "pytorch": "pytorch",
    "tensorflow": "tensorflow",
    "excel": "excel",
    "microsoft excel": "excel",
    "figma": "figma",
}


def clean(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def compare_skill(label: str, evidence: str, skills: list[str]) -> tuple[str, str, str | None]:
    key = ALIASES.get(clean(label))
    if key is None:
        return "unknown", "Complex or unsupported skill wording requires manual review.", None
    # Do not claim completeness when the quoted requirement includes qualifications
    # or alternative skills. Quote presence alone does not prove entailment.
    if re.search(
        r"\b(no|not|without|or|either|years?|advanced|expert|proficien\w*|strong)\b", evidence, re.I
    ):
        return "unknown", "The requirement includes conditions that need manual review.", None
    variants = [alias for alias, canonical in ALIASES.items() if canonical == key]
    if not any(
        re.search(r"(?<![\w+#.])" + re.escape(alias) + r"(?![\w+#.])", clean(evidence))
        for alias in variants
    ):
        return "unknown", "The quote does not explicitly name this skill.", None
    positive, negative = [], []
    for value in skills:
        text = clean(value)
        if ALIASES.get(text) == key:
            positive.append(value)
        match = re.fullmatch(r"no (?:experience (?:with|in) |knowledge of )?(.+)", text)
        if match and ALIASES.get(match[1]) == key:
            negative.append(value)
    if positive and negative:
        return "unknown", "Your skill entries conflict; update your profile.", None
    if positive:
        return (
            "supported",
            "The same skill is explicitly listed in your profile; proficiency is not verified.",
            positive[0],
        )
    if negative:
        return (
            "gap",
            "Your profile explicitly states no experience/knowledge of this skill.",
            negative[0],
        )
    return (
        "unknown",
        "This skill is not explicitly listed. Missing information is not a proven gap.",
        None,
    )


def quote_contexts(description: str, quote: str) -> list[str]:
    """Keep surrounding sentence conditions when the extractor quotes a short term."""
    text, needle = normalized(description), normalized(quote)
    if not needle:
        return []
    # InternSG's plain-text JD uses separate lines for list items. A unique
    # complete line is a self-contained quote; do not borrow an unrelated
    # learning/negation bullet after whitespace normalization. Duplicates and
    # clipped quotes retain the conservative full-context path below.
    if text.count(needle) == 1 and any(
        normalized(line) == needle for line in description.splitlines()
    ):
        return [needle]
    contexts = []
    start = 0
    while (position := text.find(needle, start)) >= 0:
        end = position + len(needle)
        start = end
        # A model quote clipped out of JavaScript or C++ is not evidence of Java/C.
        if (
            re.match(r"\w", needle[0]) and position and re.match(r"[\w+#.]", text[position - 1])
        ) or (re.match(r"\w", needle[-1]) and re.match(r"[\w+#]|\.\w", text[end:])):
            continue
        if len(contexts) == 16:
            return []  # Ambiguous, frequently repeated short quotes fail closed.
        left = list(re.finditer(r"[.!?;](?:\s|$)", text[:position]))
        # A complete quoted sentence must not borrow conditions from the next one.
        if needle[-1] in ".!?;" and (end == len(text) or text[end].isspace()):
            stop = end
        else:
            right = re.search(r"[.!?;](?:\s|$)", text[end:])
            stop = end + right.end() if right else len(text)
        contexts.append(text[left[-1].end() if left else 0 : stop])
    return contexts


def skill_overlaps(
    label: str, evidence: str, description: str, profile: dict[str, str]
) -> list[SkillOverlap]:
    contexts = quote_contexts(description, evidence)
    if not contexts or any(is_uncertain_or_negative(text) for text in [label, evidence, *contexts]):
        return []
    # Both model label and source quote must explicitly name the skill. Neither
    # semantic similarity nor a nearby unrelated sentence supplies missing evidence.
    quoted = {mention.skill_id for mention in mentions(evidence)}
    contextual = [{mention.skill_id for mention in mentions(text)} for text in contexts]
    return [
        SkillOverlap(
            skill_id=mention.skill_id,
            label=mention.label,
            kind=mention.kind,
            profile_evidence=profile[mention.skill_id],
        )
        for mention in mentions(label)
        if mention.skill_id in quoted
        and mention.skill_id in profile
        and all(mention.skill_id in ids for ids in contextual)
    ]


def atomic_skill_context(label: str, context: str) -> bool:
    """Only an unqualified, single-skill source sentence can retain legacy support/gap."""
    key = ALIASES.get(clean(label))
    if key is None:
        return False
    sentence = clean(context).strip(" .!?;")
    return any(
        sentence == alias + suffix
        for alias, canonical in ALIASES.items()
        if canonical == key
        for suffix in ("", " required", " preferred", " is required", " is preferred")
    )


def _compare_legacy(
    result: ExtractionResult, description: str, profile: UserProfile | None
) -> list[MatchItem]:
    data = result.extraction
    if data is None:
        return []
    rows = []
    for category, importance in [
        ("required_skills", "required"),
        ("preferred_skills", "preferred"),
        ("required_qualifications", "required"),
        ("preferred_qualifications", "preferred"),
        ("languages", "unspecified"),
    ]:
        rows.extend((category, importance, fact) for fact in getattr(data, category))
    for name in ("degree", "enrollment"):
        if fact := getattr(data.education, name):
            rows.append(("education", "unspecified", fact))
    rows.extend(("education", "unspecified", fact) for fact in data.education.fields_of_study)
    if data.experience.requirement:
        rows.append(("experience", "unspecified", data.experience.requirement))
    elif data.experience.minimum_years:
        rows.append(("experience", "unspecified", data.experience.minimum_years))
    items = []
    profile_skills = profile.skills if profile else []
    affirmative = positive_profile(profile_skills)
    # Keep affirmative entries before cross-entry vetoes to distinguish an
    # explicit negative from contradictory natural-language profile statements.
    individually_affirmed = {
        skill_id for entry in profile_skills for skill_id in positive_profile([entry])
    }
    for category, importance, fact in rows:
        outcome, reason, proof = (
            "unknown",
            "Requires manual comparison; this offline version does not infer qualifications.",
            None,
        )
        field = None
        overlaps = []
        if not normalized(fact.evidence) or normalized(fact.evidence) not in normalized(
            description
        ):
            reason = "Extraction evidence is not present in the current job description."
        elif category.endswith("_skills"):
            outcome, reason, proof = compare_skill(str(fact.value), fact.evidence, profile_skills)
            overlaps = skill_overlaps(str(fact.value), fact.evidence, description, affirmative)
            if outcome == "gap" and any(
                mention.skill_id in individually_affirmed for mention in mentions(str(fact.value))
            ):
                outcome, reason, proof = (
                    "unknown",
                    "Your skill entries conflict; update your profile.",
                    None,
                )
            contexts = quote_contexts(description, fact.evidence)
            if outcome in {"supported", "gap"} and (
                not contexts
                or any(not atomic_skill_context(str(fact.value), text) for text in contexts)
            ):
                outcome, reason, proof = (
                    "unknown",
                    "The complete source sentence includes conditions that need manual review.",
                    None,
                )
            if outcome == "supported" and not overlaps:
                outcome, reason, proof = (
                    "unknown",
                    "The full quote context or profile contains uncertainty or conflicting evidence.",
                    None,
                )
            if overlaps and outcome != "supported":
                # Mention overlap is useful for discovery, not proof of the full requirement.
                outcome = "unknown"
                reason = (
                    "Shared skill mentions only. Proficiency, years, alternatives and any other "
                    "conditions in this requirement remain unverified."
                )
                proof = " | ".join(dict.fromkeys(item.profile_evidence for item in overlaps))
            field = "skills" if proof else None
        items.append(
            MatchItem(
                category=category,
                requirement=str(fact.value),
                importance=importance,
                outcome=outcome,
                reason=reason,
                job_evidence=fact.evidence,
                profile_evidence=proof,
                profile_field=field,
                skill_overlaps=overlaps,
            )
        )
    return items


def _source_present(evidence: str, description: str) -> bool:
    return bool(normalized(evidence)) and normalized(evidence) in normalized(description)


def _language_identity(value: str) -> str:
    """Deduplicate language aliases without erasing written/spoken qualifications."""
    value = clean(value)
    if value in {"mandarin", "mandarin chinese", "putonghua", "普通话", "普通話"}:
        return "mandarin"
    if value in {"english", "英语", "英語"}:
        return "english"
    return value


def _narrow_atomic_group(group: RequirementGroup, description: str) -> bool:
    """One model atom does not prove the source group has only one condition."""
    if len(group.requirements) != 1 or group.operator != "all_of":
        return False
    atom = group.requirements[0]
    if atom.kind != "skill" or atom.qualifier is not None:
        return False
    contexts = quote_contexts(description, group.evidence)
    return (
        atomic_skill_context(atom.value, group.value)
        and atomic_skill_context(atom.value, group.evidence)
        and bool(contexts)
        and all(atomic_skill_context(atom.value, text) for text in contexts)
    )


def _compare_group_atom(
    atom: RequirementAtom, group: RequirementGroup, description: str, skills: list[str]
) -> MatchCondition:
    qualifier = atom.qualifier.value if atom.qualifier else None
    condition = MatchCondition(
        kind=atom.kind,
        requirement=atom.value,
        qualifier=qualifier,
        qualifier_evidence=atom.qualifier.evidence if atom.qualifier else None,
        outcome="unknown",
        reason="This condition requires manual comparison; it does not establish suitability.",
        job_evidence=atom.evidence,
    )
    if not _source_present(group.evidence, description) or not _source_present(
        atom.evidence, description
    ):
        condition.reason = "Extraction evidence is not present in the current job description."
        return condition
    if atom.qualifier and not _source_present(atom.qualifier.evidence, description):
        condition.reason = "The extracted qualifier is not supported by a current source quote."
        return condition
    if atom.kind != "skill":
        condition.reason = (
            "Language, traits, interests and qualifications are not established by saved skill "
            "mentions and do not contribute to the recommendation rank."
        )
        return condition
    if any(is_uncertain_or_negative(text) for text in (group.value, group.evidence)):
        condition.reason = (
            "The complete requirement group contains negative, uncertain or learning-only "
            "wording. A clipped child quote cannot establish affirmative skill evidence."
        )
        return condition
    # Only explicit concrete skills contribute. A model labelling a general trait
    # as a skill does not turn it into a concrete skill, nor does a language field.
    condition.skill_overlaps = [
        item
        for item in skill_overlaps(atom.value, atom.evidence, description, positive_profile(skills))
        if item.kind == "specific"
    ]
    outcome, reason, proof = compare_skill(atom.value, atom.evidence, skills)
    contexts = quote_contexts(description, atom.evidence)
    if (
        _narrow_atomic_group(group, description)
        and contexts
        and all(atomic_skill_context(atom.value, text) for text in contexts)
        and (outcome == "gap" or condition.skill_overlaps)
    ):
        # Preserve the original narrow meaning: matching an exact named entry
        # still verifies neither proficiency nor the employer's complete needs.
        affirmed = {skill_id for entry in skills for skill_id in positive_profile([entry])}
        contradictory = outcome == "gap" and any(
            item.skill_id in affirmed for item in mentions(atom.value)
        )
        if not contradictory:
            condition.outcome, condition.reason, condition.profile_evidence = outcome, reason, proof
    if condition.skill_overlaps and condition.outcome != "supported":
        condition.outcome = "unknown"
        condition.reason = (
            "Shared concrete skill names only. The qualifier, proficiency and complete "
            "compound requirement remain unverified."
        )
        condition.profile_evidence = " | ".join(
            dict.fromkeys(item.profile_evidence for item in condition.skill_overlaps)
        )
    return condition


def _compare_v2(data: JobExtractionSchemaV2, description: str, profile) -> list[MatchItem]:
    skills = profile.skills if profile else []
    items = []
    seen_languages: set[tuple[str, str]] = set()
    for group in data.requirement_groups:
        conditions = []
        for atom in group.requirements:
            if atom.kind == "language" or _language_identity(atom.value) in {"mandarin", "english"}:
                key = (
                    _language_identity(atom.value),
                    clean(atom.qualifier.value) if atom.qualifier else "",
                )
                if key in seen_languages:
                    continue
                seen_languages.add(key)
            conditions.append(_compare_group_atom(atom, group, description, skills))
        if not conditions:
            continue
        overlaps = {
            overlap.skill_id: overlap
            for condition in conditions
            for overlap in condition.skill_overlaps
        }
        # Even when all names overlap, AND/OR and qualifiers are not automatically
        # satisfied. Keep the original group text and every separate condition.
        narrow = _narrow_atomic_group(group, description)
        outcome = conditions[0].outcome if narrow else "unknown"
        reason = (
            conditions[0].reason
            if narrow
            else (
                "Compound requirement: only the named skill intersections below are established. "
                "The complete AND/OR conditions and qualifiers require manual confirmation."
            )
        )
        proof = (
            " | ".join(dict.fromkeys(c.profile_evidence for c in conditions if c.profile_evidence))
            or None
        )
        items.append(
            MatchItem(
                category="requirement_groups",
                requirement=group.value,
                importance=group.importance,
                outcome=outcome,
                reason=reason,
                job_evidence=group.evidence,
                profile_evidence=proof,
                profile_field="skills" if proof else None,
                skill_overlaps=list(overlaps.values()),
                group_operator=group.operator,
                conditions=conditions,
            )
        )
    extra = []
    for name in ("degree", "enrollment"):
        if fact := getattr(data.education, name):
            extra.append(("education", fact))
    extra.extend(("education", fact) for fact in data.education.fields_of_study)
    if data.experience.requirement:
        extra.append(("experience", data.experience.requirement))
    elif data.experience.minimum_years:
        extra.append(("experience", data.experience.minimum_years))
    for category, fact in extra:
        items.append(
            MatchItem(
                category=category,
                requirement=str(fact.value),
                importance="unspecified",
                outcome="unknown",
                reason=(
                    "Requires manual comparison; saved skill mentions do not establish "
                    "education or experience."
                    if _source_present(fact.evidence, description)
                    else "Extraction evidence is not present in the current job description."
                ),
                job_evidence=fact.evidence,
            )
        )
    return items


def compare(
    result: ExtractionResult, description: str, profile: UserProfile | None
) -> list[MatchItem]:
    if isinstance(result.extraction, JobExtractionSchemaV2):
        return _compare_v2(result.extraction, description, profile)
    return _compare_legacy(result, description, profile)


def compare_work_constraints(data, description: str) -> list[MatchItem]:
    """Display source conditions separately; never infer a person's availability."""
    constraints = data.work_constraints if isinstance(data, JobExtractionSchemaV2) else None
    facts: dict[str, tuple[str | None, str]] = {
        name: (None, "")
        for name in ("schedule", "hours", "minimum_duration", "work_modes", "locations")
    }
    review_reasons: dict[str, str] = {}
    if constraints:
        if constraints.schedule:
            facts["schedule"] = (constraints.schedule.value, constraints.schedule.evidence)
        if constraints.hours:
            hours = constraints.hours
            lower = f"{hours.minimum:g}" if hours.minimum is not None else "unknown"
            upper = f"{hours.maximum:g}" if hours.maximum is not None else "unknown"
            scope = f"; {hours.condition.value}" if hours.condition else ""
            facts["hours"] = (
                f"{lower}–{upper} {hours.unit.replace('_', ' ')}{scope}",
                "\n".join(
                    dict.fromkeys(
                        [hours.evidence] + ([hours.condition.evidence] if hours.condition else [])
                    )
                ),
            )
            if not hours_evidence_supported(hours, description):
                facts["hours"] = ("Hours: extracted number/unit requires review", facts["hours"][1])
                review_reasons["hours"] = (
                    "Unknown: the model's hours number/unit is not supported by the quoted "
                    "source. Days per week are not hours per week; no conversion or feasibility "
                    "claim is made. Review the original quote."
                )
        if constraints.minimum_duration:
            duration = constraints.minimum_duration
            scope = f"; {duration.condition.value}" if duration.condition else ""
            facts["minimum_duration"] = (
                f"At least {duration.value:g} {duration.unit}{scope}",
                "\n".join(
                    dict.fromkeys(
                        [duration.evidence]
                        + ([duration.condition.evidence] if duration.condition else [])
                    )
                ),
            )
            if not duration_evidence_supported(duration, description):
                facts["minimum_duration"] = (
                    "Minimum duration: extracted number/unit requires review",
                    facts["minimum_duration"][1],
                )
                review_reasons["minimum_duration"] = (
                    "Unknown: the model's duration number/unit is not supported by the quoted "
                    "source. No conversion of days, weeks or months is assumed. Review the "
                    "original quote."
                )
        if constraints.work_modes:
            facts["work_modes"] = (
                "; ".join(
                    f"{mode.value}: {'allowed' if mode.allowed else 'not allowed'}"
                    + (f" ({mode.condition.value})" if mode.condition else "")
                    for mode in constraints.work_modes
                ),
                "\n".join(
                    dict.fromkeys(
                        evidence
                        for mode in constraints.work_modes
                        for evidence in [mode.evidence]
                        + ([mode.condition.evidence] if mode.condition else [])
                    )
                ),
            )
        if constraints.locations:
            facts["locations"] = (
                "Extracted location reference: "
                + "; ".join(fact.value for fact in constraints.locations)
                + " (workplace unverified)",
                "\n".join(dict.fromkeys(fact.evidence for fact in constraints.locations)),
            )
            review_reasons["locations"] = (
                "Unknown: this unverified location reference may describe candidate eligibility "
                "rather than the workplace. Neither workplace nor user-location feasibility is "
                "established. No feasibility conclusion is made."
            )
    result = []
    for name, (value, evidence) in facts.items():
        present = value is not None
        # Each quote may be a separate source line; don't require their join to occur.
        verified = present and all(
            _source_present(line, description) for line in evidence.splitlines()
        )
        reason = (
            "Unknown: the source states this condition, but the profile supplies no verified "
            "availability or location evidence. No feasibility conclusion is made."
            if verified
            else "Unknown: this condition was not stated or extracted; do not infer availability or location."
            if not present
            else "Unknown: the extracted condition's evidence is not present in the current source."
        )
        if name in review_reasons:
            reason = review_reasons[name]
        result.append(
            MatchItem(
                category=f"work_constraints.{name}",
                requirement=value
                if present
                else f"{name.replace('_', ' ').capitalize()}: not stated",
                importance="unspecified",
                outcome="unknown",
                reason=reason,
                job_evidence=evidence,
            )
        )
    return result


@router.post("/jobs/{job_id}/match-analysis", response_model=MatchAnalysis)
def analyze(
    job_id: UUID, payload: MatchRequest, response: Response, db: Database, user: CurrentUser
):
    response.headers["Cache-Control"] = "no-store"
    job = get_job(db, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    run = db.scalar(
        select(JobExtractionRun)
        .where(JobExtractionRun.job_id == job_id)
        .order_by(JobExtractionRun.started_at.desc(), JobExtractionRun.id.desc())
        .limit(1)
    )
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    return build_analysis(job, run, profile)


def build_analysis(
    job: JobPosting, run: JobExtractionRun | None, profile: UserProfile | None
) -> MatchAnalysis:
    """Shared read-only validation for detail analysis and discovery."""
    report = MatchAnalysis(job_id=job.id, status="unavailable")
    if run is None:
        report.reason = "missing_extraction"
        return report
    report.extraction_id = run.id
    if run.status != "needs_review":
        report.reason = "extraction_" + run.status
        return report
    try:
        current = job_input(job)
        result = ExtractionResult.model_validate(run.result_json)
    except (ValidationError, ExtractionRequestError):
        report.reason = "invalid_extraction"
        return report
    if (
        run.input_hash != current.input_hash
        or result.input_hash != current.input_hash
        or result.source_id != current.source_id
        or result.external_id != current.external_id
        or result.source_url != current.source_url
    ):
        report.reason = "stale_extraction"
        return report
    if result.status != "needs_review":
        report.reason = "invalid_extraction"
        return report
    report.summary = result.extraction.summary
    report.responsibilities = [
        MatchResponsibility.model_validate(fact.model_dump())
        for fact in result.extraction.responsibilities
    ]
    report.work_constraints = compare_work_constraints(result.extraction, job.description)
    report.items = compare(result, job.description, profile)
    report.warnings = [
        "Extracted requirements have not been human-verified. All comparisons are preliminary.",
        "Skill mentions are not proof of the complete requirement. No eligibility decision or match percentage.",
    ]
    if result.execution_mode == "mock":
        report.warnings.append(
            "Requirements come from a mock extraction; treat this as a demonstration."
        )
    if profile is None or not profile.skills:
        report.warnings.append(
            "Add explicit skills to your JobPilot profile; missing skills remain unknown."
        )
    if not report.items:
        report.reason = "no_requirements"
        return report
    report.status = "preliminary"
    return report
