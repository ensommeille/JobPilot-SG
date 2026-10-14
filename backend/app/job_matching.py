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
from app.job_extraction.models import ExtractionResult
from app.job_extraction.persistence import ExtractionRequestError, job_input
from app.job_extraction.quality import normalized
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


class MatchAnalysis(BaseModel):
    version: str = "evidence-overlap-v2"
    job_id: UUID
    status: Literal["preliminary", "unavailable"]
    reason: str | None = None
    extraction_id: UUID | None = None
    warnings: list[str] = Field(default_factory=list)
    items: list[MatchItem] = Field(default_factory=list)


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


def compare(
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
