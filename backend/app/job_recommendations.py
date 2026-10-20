"""Bounded, evidence-led discovery. No LLM calls, persisted scores or eligibility claims."""

import re
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload

from app.auth.dependencies import CurrentUser
from app.db.models import JobExtractionRun, JobPosting, UserProfile
from app.job_matching import Database, MatchItem, build_analysis
from app.skill_signals import mentions, positive_profile

router = APIRouter(tags=["job-recommendations"])
CANDIDATE_LIMIT = 500
_INTERNSHIP_INTENT = re.compile(
    r"\b(?:seeking|looking for|applying for|available for)\b"
    r"[^.;:!?\n]{0,120}\b(?:internship|intern role|intern position)\b",
    re.IGNORECASE,
)
_NEGATED_INTENT = re.compile(r"\b(?:not|never|no longer|except|after|before)\b", re.IGNORECASE)
_INVALID_INTENT_PREFIX = re.compile(
    r"\b(?:not|never|no longer|previously|formerly|was|were)\s*$", re.IGNORECASE
)


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    keyword: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=120)
    job_type: str = Field(default="", max_length=80)
    limit: int = Field(default=10, ge=1, le=20)


class Recommendation(BaseModel):
    job_id: UUID
    title: str
    company: str
    city: str | None
    job_type: str | None
    supported: list[MatchItem]
    gaps: list[MatchItem]
    unknown: list[MatchItem]
    overlaps: list[MatchItem] = Field(default_factory=list)
    work_constraints: list[MatchItem] = Field(default_factory=list)


class RecommendationReport(BaseModel):
    version: str = "evidence-discovery-v2"
    status: Literal["ready", "profile_needed", "no_candidates", "no_evidence", "no_matches"]
    scanned: int = 0
    evaluated: int = 0
    truncated: bool = False
    matched: int = 0
    profile_skill_count: int = 0
    preferred_job_type: Literal["internship"] | None = None
    excluded: dict[str, int] = Field(default_factory=dict)
    items: list[Recommendation] = Field(default_factory=list)


def specific_overlap_ids(items: list[MatchItem]) -> set[str]:
    return {
        overlap.skill_id
        for item in items
        for overlap in item.skill_overlaps
        if overlap.kind == "specific"
    }


def explicit_job_type_preference(profile: UserProfile | None) -> Literal["internship"] | None:
    """Use only an affirmative job-search/availability statement, not a past role."""
    if profile is None:
        return None
    for text in (profile.resume_summary or "", profile.availability_period or ""):
        for match in _INTERNSHIP_INTENT.finditer(text):
            prefix = text[max(0, match.start() - 20) : match.start()]
            if not _NEGATED_INTENT.search(match.group()) and not _INVALID_INTENT_PREFIX.search(
                prefix
            ):
                return "internship"
    return None


@router.post("/jobs/recommendations", response_model=RecommendationReport)
def recommend(
    payload: RecommendationRequest, response: Response, db: Database, user: CurrentUser
) -> RecommendationReport:
    response.headers["Cache-Control"] = "no-store"
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    affirmative = positive_profile(profile.skills) if profile else {}
    specific_profile_ids = {
        mention.skill_id
        for text in (profile.skills if profile else [])
        for mention in mentions(text)
        if mention.skill_id in affirmative and mention.kind == "specific"
    }
    profile_skill_count = len(specific_profile_ids)
    preference = explicit_job_type_preference(profile)
    if not profile_skill_count:
        return RecommendationReport(
            status="profile_needed",
            profile_skill_count=0,
            preferred_job_type=preference,
        )
    today = datetime.now(timezone(timedelta(hours=8))).date()
    conditions = [
        JobPosting.status == "active",
        or_(JobPosting.deadline.is_(None), JobPosting.deadline >= today),
    ]
    if payload.keyword:
        conditions.append(
            or_(
                func.lower(JobPosting.title).contains(payload.keyword.lower(), autoescape=True),
                func.lower(JobPosting.company).contains(payload.keyword.lower(), autoescape=True),
            )
        )
    if payload.city:
        conditions.append(func.lower(JobPosting.city) == payload.city.lower())
    if payload.job_type:
        conditions.append(func.lower(JobPosting.job_type) == payload.job_type.lower())
    jobs = list(
        db.scalars(
            select(JobPosting)
            .options(joinedload(JobPosting.source))
            .where(*conditions)
            .order_by(
                JobPosting.posted_at.desc().nulls_last(),
                JobPosting.created_at.desc(),
                JobPosting.id,
            )
            .limit(CANDIDATE_LIMIT + 1)
        )
    )
    report = RecommendationReport(
        status="no_candidates",
        truncated=len(jobs) > CANDIDATE_LIMIT,
        profile_skill_count=profile_skill_count,
        preferred_job_type=preference,
    )
    jobs = jobs[:CANDIDATE_LIMIT]
    report.scanned = len(jobs)
    if not jobs:
        return report
    # One latest run per candidate, without N+1 lookups or older-success fallback.
    ranked = (
        select(
            JobExtractionRun.id,
            func.row_number()
            .over(
                partition_by=JobExtractionRun.job_id,
                order_by=(JobExtractionRun.started_at.desc(), JobExtractionRun.id.desc()),
            )
            .label("position"),
        )
        .where(JobExtractionRun.job_id.in_([job.id for job in jobs]))
        .subquery()
    )
    runs = {
        run.job_id: run
        for run in db.scalars(
            select(JobExtractionRun)
            .join(ranked, ranked.c.id == JobExtractionRun.id)
            .where(ranked.c.position == 1)
        )
    }
    ordered = []
    for index, job in enumerate(jobs):
        run = runs.get(job.id)
        analysis = build_analysis(job, run, profile)
        reason = analysis.reason
        if analysis.status == "preliminary" and run.result_json.get("execution_mode") == "mock":
            reason = "mock_extraction"
        if reason:
            report.excluded[reason] = report.excluded.get(reason, 0) + 1
            continue
        report.evaluated += 1
        supported = [i for i in analysis.items if i.outcome == "supported"]
        concrete = specific_overlap_ids(analysis.items)
        if not concrete:
            continue
        exact = specific_overlap_ids(supported)
        gaps = [i for i in analysis.items if i.outcome == "gap"]
        overlaps = [i for i in analysis.items if i.outcome == "unknown" and i.skill_overlaps]
        item = Recommendation(
            job_id=job.id,
            title=job.title,
            company=job.company,
            city=job.city,
            job_type=job.job_type,
            supported=supported,
            gaps=gaps,
            unknown=[i for i in analysis.items if i.outcome == "unknown"],
            overlaps=overlaps,
            work_constraints=analysis.work_constraints,
        )
        # Distinct exact skill entries are stronger evidence than partial mentions,
        # whose qualifiers or compound conditions remain unknown. Neither is a
        # proficiency claim. Generic traits, aliases and model-assigned priorities
        # cannot inflate rank; explicit gaps still take precedence.
        type_mismatch = preference is not None and (job.job_type or "").casefold() != preference
        ordered.append(((bool(gaps), type_mismatch, -len(exact), -len(concrete), index), item))
    ordered.sort(key=lambda pair: pair[0])
    report.matched = len(ordered)
    report.items = [item for _, item in ordered[: payload.limit]]
    report.status = "ready" if ordered else "no_matches" if report.evaluated else "no_evidence"
    return report
