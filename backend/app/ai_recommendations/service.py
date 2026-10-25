"""Bounded raw-text recall, minimized inputs, strict citations and once-only paid batches."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from collections import Counter
from datetime import timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.db.models import JobPosting, JobSource, User, UserProfile
from app.ingestion.locks import database_now
from app.ingestion.schedule import utc_timestamp
from app.jobs.provenance import is_public_job
from app.llm import LLMProviderError, Message, StructuredGenerationRequest

from .advice import advice_for_batch, derive_advice
from .candidate_recall import role_adjustment
from .career import validate_career_fit
from .citations import ReferencedBatch, request_with_sources, resolve_assessment, source_catalog
from .claim_scope import performed_actions, skill_subject_evidence_issue
from .evidence_rules import prioritize_assessment
from .gap_evidence import NEGATIVE, correct_unverified_gaps, unverified_gap_reason
from .models import AIRecommendationRun
from .prompts import SYSTEM_PROMPT
from .runtime import PROMPT_VERSION, AIRuntime
from .schemas import (
    BatchAssessment,
    Candidate,
    CandidatePreview,
    JobAssessmentReport,
    RecommendationReport,
    RecommendationRequest,
)

MAX_SCAN = 1000
LEASE_SECONDS = 180
STOPWORDS = frozenset(
    [
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "using",
        "used",
        "built",
        "have",
        "has",
        "was",
        "were",
        "are",
        "into",
        "project",
        "projects",
        "experience",
        "skills",
        "software",
        "work",
        "working",
        "university",
        "education",
        "engineering",
        "development",
        "application",
        "applications",
        "system",
        "systems",
    ]
)
EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}")
URL = re.compile(
    r"https?://[^\s<>]+|www\.[^\s<>]+|\b[A-Za-z0-9.-]+\.(?:com|org|net|io|dev|edu|sg|co)\b(?:/[^\s<>]*)?",
    re.I,
)
PHONE = re.compile(r"(?<!\w)\+?\d[\d ()+.-]{5,}\d(?!\w)")
YEARS = re.compile(r"\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b", re.I)
YEAR_RANGE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*\d+(?:\.\d+)?\s*(?:years?|yrs?)\b", re.I
)
DURATIONS = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?:consecutive\s+)?(hours?|weeks?|months?|days?)\b", re.I
)


def _canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _digest(value) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _clean(text: str | None, identifiers: list[str]) -> str | None:
    if text is None:
        return None
    result = text
    for value in sorted(set(identifiers), key=len, reverse=True):
        if value and len(value.strip()) > 1:
            result = re.sub(
                r"(?<!\w)" + re.escape(value.strip()) + r"(?!\w)", "[redacted]", result, flags=re.I
            )
    result = EMAIL.sub("[redacted]", result)
    result = URL.sub("[redacted]", result)

    def phone(match):
        value = match.group().strip()
        date_part = r"(?:19|20)\d{2}(?:[./-](?:0?[1-9]|1[0-2]))?(?:[./-](?:0?[1-9]|[12]\d|3[01]))?"
        if re.fullmatch(date_part + r"(?:\s*[-–—]\s*" + date_part + r")?\.?", value):
            return match.group()
        digits = re.sub(r"\D", "", value)
        return (
            "[redacted]"
            if len(digits) >= 9 or (len(digits) == 8 and digits[0] in "689")
            else match.group()
        )

    return PHONE.sub(phone, result)


def reviewed_profile(db: Session, user: User) -> tuple[dict, list[str]]:
    profile = db.scalar(
        select(UserProfile)
        .where(UserProfile.user_id == user.id)
        .execution_options(populate_existing=True)
    )
    identifiers = [user.email]
    if profile is None:
        return {
            "education": None,
            "experience": None,
            "skills": [],
            "availability": None,
        }, identifiers
    identifiers += [
        value for value in (profile.full_name, profile.contact_email, profile.phone) if value
    ]
    return {
        "education": _clean(profile.education, identifiers),
        "experience": _clean(profile.experience, identifiers),
        "skills": [_clean(value, identifiers) for value in profile.skills],
        "availability": _clean(profile.availability_period, identifiers),
    }, identifiers


def _ready(profile: dict) -> bool:
    return any(
        value and str(value).replace("[redacted]", "").strip()
        for value in [profile["education"], profile["experience"], *profile["skills"]]
    )


def _candidates(
    db: Session, user: User, *, job_ids=None, keyword="", city="", job_type="", limit=5
):
    profile, identifiers = reviewed_profile(db, user)
    today = database_now(db).astimezone(timezone(timedelta(hours=8))).date()
    filters = [
        JobPosting.status == "active",
        or_(JobPosting.deadline.is_(None), JobPosting.deadline >= today),
        JobSource.enabled.is_(True),
        JobSource.source_type.not_in(("mock", "sandbox")),
    ]
    if keyword:
        filters.append(
            or_(
                func.lower(JobPosting.title).contains(keyword.lower(), autoescape=True),
                func.lower(JobPosting.company).contains(keyword.lower(), autoescape=True),
            )
        )
    if city:
        filters.append(func.lower(JobPosting.city) == city.casefold())
    if job_type:
        filters.append(func.lower(JobPosting.job_type) == job_type.casefold())
    query = (
        select(JobPosting)
        .options(joinedload(JobPosting.source))
        .join(JobSource, JobPosting.source_id == JobSource.id)
        .where(*filters)
    )
    if job_ids:
        jobs = [
            job for job in db.scalars(query.where(JobPosting.id.in_(job_ids))) if is_public_job(job)
        ]
        by_id = {job.id: job for job in jobs}
        if set(by_id) != set(job_ids):
            raise HTTPException(422, "invalid_candidates")
        return [by_id[key] for key in job_ids], profile, identifiers, len(jobs), False
    jobs = list(
        db.scalars(
            query.order_by(
                JobPosting.posted_at.desc().nulls_last(),
                JobPosting.created_at.desc(),
                JobPosting.id,
            ).limit(MAX_SCAN + 1)
        )
    )
    truncated = len(jobs) > MAX_SCAN
    jobs = [job for job in jobs[:MAX_SCAN] if is_public_job(job)]
    texts = [(job.title + "\n" + job.description).casefold() for job in jobs]
    phrases = [
        value.casefold() for value in profile["skills"] if value and "[redacted]" not in value
    ]
    tokens = (
        set(
            re.findall(
                r"[a-z][a-z0-9+#.-]{1,60}",
                " ".join(
                    [profile["experience"] or "", profile["education"] or "", *profile["skills"]]
                ).casefold(),
            )
        )
        - STOPWORDS
    )
    tokens = {token for token in tokens if not token.isdecimal() and token != "redacted"}
    document_tokens = [set(re.findall(r"[a-z][a-z0-9+#.-]{1,60}", text)) for text in texts]
    frequencies = Counter(token for words in document_tokens for token in words if token in tokens)
    scored = []
    for index, (job, text, words) in enumerate(zip(jobs, texts, document_tokens, strict=True)):
        score = sum(math.log(1 + len(jobs) / (1 + frequencies[token])) for token in tokens & words)
        score += sum(4 for phrase in phrases if phrase in text)
        review_priority, role_points = role_adjustment(job.title, profile)
        scored.append((review_priority, -(score + role_points), index, job))
    scored.sort(key=lambda row: row[:3])
    return [row[3] for row in scored[:limit]], profile, identifiers, len(jobs), truncated


def candidate_preview(db: Session, user: User, **filters) -> CandidatePreview:
    jobs, profile, _identifiers, scanned, truncated = _candidates(db, user, **filters)
    return CandidatePreview(
        candidates=[candidate(job) for job in jobs],
        profile_ready=_ready(profile),
        scanned=scanned,
        truncated=truncated,
    )


def candidate(job: JobPosting) -> Candidate:
    return Candidate(
        id=job.id, title=job.title, company=job.company, city=job.city, job_type=job.job_type
    )


def _contains(quote: str, text: str) -> bool:
    return " ".join(quote.split()) in " ".join(text.split())


def _append_reason(row, note: str) -> None:
    row.reason = row.reason[: 1999 - len(note)].rstrip() + " " + note


def validate_assessment(
    data: dict,
    payload: dict,
    *,
    allow_promotions: bool = True,
    _validate_components: bool = True,
    _condition_context: bool = False,
) -> BatchAssessment:
    result = BatchAssessment.model_validate(data)
    jobs = {job["id"]: job for job in payload["jobs"]}
    if (
        len(result.items) != len(jobs)
        or {str(item.job_id) for item in result.items} != set(jobs)
        or {item.rank for item in result.items} != set(range(1, len(jobs) + 1))
    ):
        raise ValueError("invalid_evidence")
    for item in result.items:
        source = jobs[str(item.job_id)]["description"]
        for row in item.requirements:
            if not _contains(row.jd_quote, source):
                raise ValueError("invalid_evidence")
            fields = payload["profile"]
            field = fields.get(row.profile_field) if row.profile_field else None
            originals = field if isinstance(field, list) else [field] if field else []
            if row.profile_quote and not any(
                _contains(row.profile_quote, original) for original in originals
            ):
                raise ValueError("invalid_evidence")
            if row.outcome == "supported" and (
                not row.profile_quote or not row.profile_field or "[redacted]" in row.profile_quote
            ):
                raise ValueError("invalid_evidence")
            if _condition_context and row.outcome == "supported":
                subject_issue = skill_subject_evidence_issue(
                    row.requirement, row.category, row.profile_quote
                )
                if subject_issue:
                    row.outcome, row.reason = "unknown", subject_issue
            if row.outcome == "gap" and (
                not row.profile_quote or not NEGATIVE.search(row.profile_quote)
            ):
                row.outcome = "unknown"
                row.reason = unverified_gap_reason(
                    row.category, row.requirement, row.profile_field, row.profile_quote
                )
            if row.outcome == "supported" and row.category == "work_constraint":
                quote = row.profile_quote or ""
                constraint = row.requirement if _condition_context else row.jd_quote
                timing_inferred = row.profile_field == "education" or (
                    row.profile_field != "availability"
                    and not re.search(
                        r"\b(?:availab(?:le|ility)|can (?:work|start)|able to work)\b", quote, re.I
                    )
                )
                requested_duration = {
                    (number, unit.casefold().rstrip("s"))
                    for number, unit in DURATIONS.findall(constraint)
                }
                stated_duration = {
                    (number, unit.casefold().rstrip("s"))
                    for number, unit in DURATIONS.findall(quote)
                }
                qualifiers_missing = any(
                    re.search(pattern, constraint, re.I) and not re.search(pattern, quote, re.I)
                    for pattern in (r"\bfull[ -]?time\b", r"\bpart[ -]?time\b", r"\bon[ -]?site\b")
                )
                if (
                    timing_inferred
                    or not requested_duration <= stated_duration
                    or qualifiers_missing
                ):
                    row.outcome = "unknown"
                    _append_reason(
                        row,
                        "The displayed evidence does not explicitly establish every availability condition. "
                        "Course/project dates are not availability; a broad period does not prove a "
                        "specific duration, full-time hours or onsite attendance.",
                    )
            if row.outcome == "supported" and row.category == "experience":
                # A range's upper bound is not a required minimum. Keep the
                # condition local instead of borrowing years from a neighbour.
                local = row.requirement
                requested = [float(value) for value in YEAR_RANGE.findall(local)]
                rest = YEAR_RANGE.sub("", local)
                requested += [float(value) for value in YEARS.findall(rest)]
                stated = [float(value) for value in YEARS.findall(row.profile_quote or "")]
                if (
                    requested
                    and max(requested) > 0
                    and (not stated or max(stated) < max(requested))
                ):
                    row.outcome = "unknown"
                    _append_reason(
                        row,
                        "Explicit corresponding years are not established; dates are not converted into experience years.",
                    )
            if row.outcome == "supported" and row.category == "education":
                education_condition = row.requirement if _condition_context else row.jd_quote
                levels = [
                    (3, r"\b(?:doctor(?:ate|al)?|ph\.?\s*d\.?|d\.?\s*phil)\b"),
                    (2, r"\b(?:master(?:'s|s)?|m\.?\s*(?:sc|eng|tech|comp|phil|s)\.?)\b"),
                    (1, r"\b(?:bachelor(?:'s|s)?|b\.?\s*(?:sc|eng|tech|comp|s|a)\.?)\b"),
                    (0, r"\bdiploma\b"),
                ]
                degree = re.compile(
                    "|".join(pattern for _, pattern in levels)
                    + r"|degree|enrolled|pursuing|student",
                    re.I,
                )
                numbers = re.findall(r"\b20\d{2}\b", education_condition)
                requested = [
                    level
                    for level, pattern in levels
                    if re.search(pattern, education_condition, re.I)
                ]
                stated = [
                    level
                    for level, pattern in levels
                    if re.search(pattern, row.profile_quote or "", re.I)
                ]
                in_progress = re.search(
                    r"enrolled|pursuing|student|studying|expected", row.profile_quote or "", re.I
                )
                permits_progress = re.search(
                    r"enrolled|pursuing|student|studying|currently", education_condition, re.I
                )
                if (
                    not degree.search(row.profile_quote or "")
                    or any(year not in (row.profile_quote or "") for year in numbers)
                    or (requested and (not stated or max(stated) < min(requested)))
                    or (in_progress and not permits_progress)
                ):
                    row.outcome = "unknown"
                    _append_reason(
                        row, "Complete explicit education/date evidence is not established."
                    )
            if _validate_components:
                for check in row.condition_checks:
                    # Reuse the same evidence guards for each atomic condition.
                    # Its local wording supplies scope; the cited JD stays the
                    # original exact passage, never a model-written substitute.
                    atom = {
                        "requires_review": True,
                        "items": [
                            {
                                "job_id": str(item.job_id),
                                "rank": 1,
                                "summary": "Atomic evidence review",
                                "warnings": [],
                                "requirements": [
                                    {
                                        "requirement": check.condition,
                                        "category": row.category,
                                        "outcome": check.outcome,
                                        "jd_quote": row.jd_quote,
                                        "profile_field": check.profile_field,
                                        "profile_quote": check.profile_quote,
                                        "reason": check.reason,
                                    }
                                ],
                            }
                        ],
                    }
                    validated = validate_assessment(
                        atom,
                        {"profile": fields, "jobs": [jobs[str(item.job_id)]]},
                        allow_promotions=False,
                        _validate_components=False,
                        _condition_context=True,
                    )
                    child = validated.items[0].requirements[0]
                    shown = (
                        child.profile_field == row.profile_field
                        and child.profile_quote
                        and row.profile_quote
                        and _contains(child.profile_quote, row.profile_quote)
                    )
                    check.outcome = child.outcome if shown else "unknown"
                    check.reason = child.reason[:1000]
                if row.outcome == "supported" and row.condition_checks and row.condition_operator:
                    evidence = [check.outcome == "supported" for check in row.condition_checks]
                    sufficient = (
                        any(evidence)
                        if row.condition_operator == "any_of"
                        else all(evidence)
                        if row.condition_operator in {"atomic", "all_of"}
                        else False
                    )
                    if not sufficient:
                        row.outcome = "unknown"
                        _append_reason(
                            row,
                            "The validated atomic evidence does not establish the full condition.",
                        )
        for related in item.related_evidence:
            if related.requirement_index >= len(item.requirements):
                raise ValueError("invalid_evidence")
            parent = item.requirements[related.requirement_index]
            original = payload["profile"].get(related.profile_field)
            originals = original if isinstance(original, list) else [original] if original else []
            if related.jd_quote != parent.jd_quote or not any(
                _contains(related.profile_quote, text) for text in originals
            ):
                raise ValueError("invalid_evidence")
            if related.kind == "partial_condition":
                if related.condition_index is None or related.condition_index >= len(
                    parent.condition_checks
                ):
                    raise ValueError("invalid_evidence")
                check = parent.condition_checks[related.condition_index]
                if (
                    check.outcome != "supported"
                    or related.profile_field != check.profile_field
                    or related.profile_quote != check.profile_quote
                ):
                    raise ValueError("invalid_evidence")
            elif related.profile_field != "experience" or not performed_actions(
                related.profile_quote
            ):
                raise ValueError("invalid_evidence")
        validate_career_fit(item, source, fields)
    result = prioritize_assessment(
        result,
        payload["profile"],
        allow_promotions=allow_promotions,
        condition_context=_condition_context,
    )
    for item in result.items:
        validate_career_fit(item, jobs[str(item.job_id)]["description"], payload["profile"])
    return correct_unverified_gaps(BatchAssessment.model_validate(result.model_dump()))


def expire_run(db: Session, run: AIRecommendationRun) -> AIRecommendationRun:
    now = database_now(db)
    if run.status == "running" and utc_timestamp(run.expires_at) <= now:
        db.execute(
            update(AIRecommendationRun)
            .where(
                AIRecommendationRun.id == run.id,
                AIRecommendationRun.status == "running",
                AIRecommendationRun.expires_at <= now,
            )
            .values(status="failed", error_code="lease_expired", owner_token=None, finished_at=now)
            .execution_options(synchronize_session=False)
        )
        db.commit()
        db.refresh(run)
    return run


def read_run(db: Session, user: User, run_id: UUID) -> AIRecommendationRun:
    run = db.scalar(
        select(AIRecommendationRun).where(
            AIRecommendationRun.id == run_id, AIRecommendationRun.user_id == user.id
        )
    )
    if run is None:
        raise HTTPException(404, "AI recommendation run not found")
    return expire_run(db, run)


def _run_is_current(db: Session, user: User, run: AIRecommendationRun) -> bool:
    """Validate the entire displayed batch against current inputs, without rewriting it."""
    pipeline = run.pipeline_json
    if (
        run.user_id != user.id
        or pipeline.get("prompt_version") != PROMPT_VERSION
        or pipeline.get("execution_mode") not in {"live", "mock"}
        or not isinstance(pipeline.get("model"), str)
    ):
        return False
    profile, identifiers = reviewed_profile(db, user)
    if run.input_json.get("profile") != profile:
        return False
    saved_jobs = run.input_json.get("jobs", [])
    if not saved_jobs:
        return False
    today = database_now(db).astimezone(timezone(timedelta(hours=8))).date()
    for saved in saved_jobs:
        try:
            job_id = UUID(saved["id"])
        except (ValueError, KeyError, TypeError):
            return False
        job = db.scalar(
            select(JobPosting)
            .options(joinedload(JobPosting.source))
            .where(JobPosting.id == job_id)
            .execution_options(populate_existing=True)
        )
        if (
            job is None
            or job.status != "active"
            or (job.deadline is not None and job.deadline < today)
            or not job.source.enabled
            or not is_public_job(job)
            or saved
            != {
                "id": str(job.id),
                "title": _clean(job.title, identifiers),
                "company": _clean(job.company, identifiers),
                "description": _clean(job.description, identifiers),
            }
        ):
            return False
    return True


def present(
    run: AIRecommendationRun, *, reused: bool, db: Session, user: User
) -> RecommendationReport:
    pipeline = run.pipeline_json
    is_current = _run_is_current(db, user, run)
    advice, display_order = {}, []
    result = (
        correct_unverified_gaps(BatchAssessment.model_validate(run.result_json))
        if run.status == "succeeded"
        else None
    )
    if run.status == "succeeded" and is_current:
        advice, display_order = advice_for_batch(result, run.input_json["profile"])
    return RecommendationReport(
        id=run.id,
        status=run.status,
        reused=reused,
        is_current=is_current,
        input_hash=run.input_hash,
        provider=pipeline["provider"],
        model=pipeline["model"],
        prompt_version=pipeline["prompt_version"],
        execution_mode=pipeline["execution_mode"],
        profile_skill_count=len(run.input_json["profile"]["skills"]),
        candidates=run.candidates_json,
        result=result,
        advice=advice,
        display_order=display_order,
        error_code=run.error_code,
        usage=run.usage_json or {},
        started_at=run.started_at,
        expires_at=run.expires_at,
        finished_at=run.finished_at,
    )


def job_assessment(db: Session, user: User, job_id: UUID) -> JobAssessmentReport:
    """Read an existing matching item across batches; never reserve or run a model.

    Historical batch rank is retained as source context, not a global job rank.
    The bounded user history scan and current-input checks also allow a completed
    batch to be reused before a new single-job POST could incur a separate charge.
    """
    job = db.get(JobPosting, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    today = database_now(db).astimezone(timezone(timedelta(hours=8))).date()
    if (
        job.status != "active"
        or (job.deadline is not None and job.deadline < today)
        or not job.source.enabled
        or not is_public_job(job)
    ):
        return JobAssessmentReport(job_id=job_id, status="unavailable", reason="job_unavailable")
    profile, identifiers = reviewed_profile(db, user)
    if not _ready(profile):
        return JobAssessmentReport(job_id=job_id, status="unavailable", reason="profile_needed")
    current_job = {
        "id": str(job.id),
        "title": _clean(job.title, identifiers),
        "company": _clean(job.company, identifiers),
        "description": _clean(job.description, identifiers),
    }
    context_hash = _digest(
        {
            "profile": profile,
            "job": current_job,
            "prompt_version": PROMPT_VERSION,
            "revision": {
                "raw_hash": job.raw_hash,
                "source_id": str(job.source_id),
                "external_id": job.external_id,
            },
        }
    )
    fallback = JobAssessmentReport(
        job_id=job_id, status="not_analyzed", reason="no_saved_analysis", context_hash=context_hash
    )
    for run in db.scalars(
        select(AIRecommendationRun)
        .where(AIRecommendationRun.user_id == user.id)
        .order_by(AIRecommendationRun.started_at.desc(), AIRecommendationRun.id.desc())
        .limit(100)
    ):
        saved_jobs = run.input_json.get("jobs", [])
        saved = next((item for item in saved_jobs if item.get("id") == str(job_id)), None)
        if saved is None:
            continue
        pipeline = run.pipeline_json
        if (
            saved != current_job
            or run.input_json.get("profile") != profile
            or pipeline.get("prompt_version") != PROMPT_VERSION
            or pipeline.get("execution_mode") not in {"live", "mock"}
            or not isinstance(pipeline.get("model"), str)
        ):
            if fallback.status == "not_analyzed":
                fallback = JobAssessmentReport(
                    job_id=job_id,
                    status="outdated",
                    reason="inputs_changed",
                    context_hash=context_hash,
                )
            continue
        base = {
            "job_id": job_id,
            "context_hash": context_hash,
            "source_run_id": run.id,
            "execution_mode": pipeline["execution_mode"],
            "model": pipeline["model"],
            "finished_at": run.finished_at,
        }
        if run.status == "succeeded":
            try:
                batch = correct_unverified_gaps(BatchAssessment.model_validate(run.result_json))
                assessed = next(item for item in batch.items if item.job_id == job_id)
                if len(batch.items) != len(saved_jobs) or {
                    str(item.job_id) for item in batch.items
                } != {item["id"] for item in saved_jobs}:
                    raise ValueError("invalid_saved_analysis")
            except (ValidationError, ValueError, StopIteration):
                if fallback.status in {"not_analyzed", "outdated"}:
                    fallback = JobAssessmentReport(
                        **base, status="failed", reason="invalid_saved_analysis"
                    )
                continue
            return JobAssessmentReport(
                **base, status="available", assessment=assessed, advice=derive_advice(assessed)
            )
        if fallback.status in {"not_analyzed", "outdated"}:
            if run.status == "running" and utc_timestamp(run.expires_at) > database_now(db):
                fallback = JobAssessmentReport(**base, status="running", reason="analysis_running")
            else:
                fallback = JobAssessmentReport(
                    **base, status="failed", reason=run.error_code or "lease_expired"
                )
    return fallback


async def execute(db: Session, *, user: User, payload: RecommendationRequest, runtime: AIRuntime):
    jobs, profile, identifiers, _scanned, _truncated = _candidates(
        db,
        user,
        job_ids=payload.job_ids,
        keyword=payload.keyword,
        city=payload.city,
        job_type=payload.job_type,
    )
    if not _ready(profile):
        raise HTTPException(422, "profile_needed")
    if not jobs:
        raise HTTPException(422, "no_candidates")
    # Never truncate away a later contradiction to fit a model request.
    if any(len(job.description) > 40000 for job in jobs):
        raise HTTPException(422, "candidate_text_too_long")
    model_input = {
        "profile": profile,
        "preferences": {
            key: _clean(getattr(payload, key), identifiers)
            for key in ("keyword", "city", "job_type")
        },
        "jobs": [
            {
                "id": str(job.id),
                "title": _clean(job.title, identifiers),
                "company": _clean(job.company, identifiers),
                "description": _clean(job.description, identifiers),
            }
            for job in sorted(jobs, key=lambda item: str(item.id))
        ],
    }
    pipeline = runtime.snapshot()
    identity = {
        "input": model_input,
        "pipeline": pipeline,
        "revisions": [
            {
                "id": str(job.id),
                "raw_hash": job.raw_hash,
                "source_id": str(job.source_id),
                "external_id": job.external_id,
            }
            for job in sorted(jobs, key=lambda item: str(item.id))
        ],
    }
    input_hash = _digest(identity)
    existing = db.scalar(
        select(AIRecommendationRun).where(
            AIRecommendationRun.user_id == user.id, AIRecommendationRun.input_hash == input_hash
        )
    )
    if existing is not None:
        return expire_run(db, existing), True
    now, owner = database_now(db), uuid4()
    run = AIRecommendationRun(
        user_id=user.id,
        input_hash=input_hash,
        status="running",
        owner_token=owner,
        input_json=model_input,
        pipeline_json=pipeline,
        candidates_json=[candidate(job).model_dump(mode="json") for job in jobs],
        started_at=now,
        expires_at=now + timedelta(seconds=max(LEASE_SECONDS, runtime.timeout_seconds + 60)),
    )
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(AIRecommendationRun).where(
                AIRecommendationRun.user_id == user.id, AIRecommendationRun.input_hash == input_hash
            )
        )
        if existing is None:
            raise HTTPException(409, "cache_claim_conflict") from None
        return expire_run(db, existing), True
    run_id = run.id
    generated, result, error = None, None, None
    catalog = source_catalog(model_input)
    wire_input = request_with_sources(model_input, catalog)

    async def call_once():
        async with runtime.provider_factory() as provider:
            if provider.is_mock != runtime.is_mock:
                raise ValueError("provider_mode_mismatch")
            return await provider.generate_structured(
                StructuredGenerationRequest(
                    request_id=str(run_id),
                    messages=[
                        Message(role="system", content=SYSTEM_PROMPT),
                        Message(role="user", content=_canonical(wire_input)),
                    ],
                    schema_name="ai_recommendation_ranges_v1",
                    output_schema=ReferencedBatch.model_json_schema(),
                    max_output_tokens=runtime.max_output_tokens,
                )
            )

    try:
        generated = await asyncio.wait_for(call_once(), timeout=runtime.timeout_seconds)
        if generated.finish_reason != "stop" or generated.data is None:
            error = "incomplete_output"
        else:
            resolved = resolve_assessment(generated.data, model_input, catalog)
            result = validate_assessment(resolved, model_input, allow_promotions=False)
    except ValidationError:
        error = "invalid_output"
    except ValueError as exc:
        error = "invalid_evidence" if str(exc) == "invalid_evidence" else "invalid_output"
    except TimeoutError:
        error = "provider_timeout"
    except asyncio.CancelledError:
        error = "cancelled"
    except LLMProviderError as exc:
        allowed = {
            "provider_error",
            "provider_authentication_error",
            "provider_insufficient_balance",
            "provider_invalid_request",
            "provider_rate_limit",
            "provider_timeout",
            "provider_capability_error",
            "invalid_structured_output",
        }
        error = exc.code if exc.code in allowed else "provider_error"
    except Exception:
        error = "unexpected_provider_error"
    finished = database_now(db)
    values = {
        "status": "failed" if error else "succeeded",
        "result_json": result.model_dump(mode="json") if result else None,
        "error_code": error,
        "owner_token": None,
        "finished_at": finished,
        "usage_json": generated.usage.model_dump() if generated else None,
    }
    if generated:
        values["pipeline_json"] = {
            **pipeline,
            "provider": generated.provider,
            "model": generated.model,
        }
    changed = db.execute(
        update(AIRecommendationRun)
        .where(
            AIRecommendationRun.id == run_id,
            AIRecommendationRun.owner_token == owner,
            AIRecommendationRun.status == "running",
            AIRecommendationRun.expires_at > finished,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    run = db.get(AIRecommendationRun, run_id, populate_existing=True)
    if changed.rowcount != 1:
        run = expire_run(db, run)
    return run, False
