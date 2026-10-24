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
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource, User, UserProfile
from app.ingestion.locks import database_now
from app.ingestion.schedule import utc_timestamp
from app.llm import LLMProviderError, Message, StructuredGenerationRequest

from .evidence_rules import prioritize_assessment
from .models import AIRecommendationRun
from .prompts import SYSTEM_PROMPT
from .runtime import AIRuntime
from .schemas import (
    BatchAssessment,
    Candidate,
    CandidatePreview,
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
NEGATIVE = re.compile(
    r"\b(?:no|without|lack(?:s)?)\s+(?:(?:prior|professional|production|commercial|hands-on)\s+)?(?:experience|knowledge|proficiency|familiarity)\b"
    r"|\b(?:cannot|unable\s+to|do\s+not\s+know|don't\s+know|have\s+never)\b|没有.{0,20}(?:经验|知识)|不具备|不会",
    re.I,
)
YEARS = re.compile(r"\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b", re.I)


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
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    identifiers = [user.email]
    if profile is None:
        return {"education": None, "experience": None, "skills": []}, identifiers
    identifiers += [
        value for value in (profile.full_name, profile.contact_email, profile.phone) if value
    ]
    return {
        "education": _clean(profile.education, identifiers),
        "experience": _clean(profile.experience, identifiers),
        "skills": [_clean(value, identifiers) for value in profile.skills],
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
    query = select(JobPosting).join(JobSource, JobPosting.source_id == JobSource.id).where(*filters)
    if job_ids:
        jobs = list(db.scalars(query.where(JobPosting.id.in_(job_ids))))
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
    jobs = jobs[:MAX_SCAN]
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
        scored.append((-score, index, job))
    scored.sort(key=lambda row: (row[0], row[1]))
    return [row[2] for row in scored[:limit]], profile, identifiers, len(jobs), truncated


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


def validate_assessment(data: dict, payload: dict) -> BatchAssessment:
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
            if row.outcome == "gap" and (
                not row.profile_quote or not NEGATIVE.search(row.profile_quote)
            ):
                row.outcome = "unknown"
                _append_reason(
                    row,
                    "No explicit contradictory profile evidence; missing information remains unknown.",
                )
            if row.outcome == "supported" and row.category == "experience":
                requested = [float(value) for value in YEARS.findall(row.jd_quote)]
                stated = [float(value) for value in YEARS.findall(row.profile_quote or "")]
                if requested and (not stated or max(stated) < max(requested)):
                    row.outcome = "unknown"
                    _append_reason(
                        row,
                        "Explicit corresponding years are not established; dates are not converted into experience years.",
                    )
            if row.outcome == "supported" and row.category == "education":
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
                numbers = re.findall(r"\b20\d{2}\b", row.jd_quote)
                requested = [
                    level for level, pattern in levels if re.search(pattern, row.jd_quote, re.I)
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
                    r"enrolled|pursuing|student|studying|currently", row.jd_quote, re.I
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
    result = prioritize_assessment(result, payload["profile"])
    return BatchAssessment.model_validate(result.model_dump())


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


def present(run: AIRecommendationRun, *, reused: bool) -> RecommendationReport:
    pipeline = run.pipeline_json
    return RecommendationReport(
        id=run.id,
        status=run.status,
        reused=reused,
        input_hash=run.input_hash,
        provider=pipeline["provider"],
        model=pipeline["model"],
        prompt_version=pipeline["prompt_version"],
        execution_mode=pipeline["execution_mode"],
        profile_skill_count=len(run.input_json["profile"]["skills"]),
        candidates=run.candidates_json,
        result=run.result_json,
        error_code=run.error_code,
        usage=run.usage_json or {},
        started_at=run.started_at,
        expires_at=run.expires_at,
        finished_at=run.finished_at,
    )


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

    async def call_once():
        async with runtime.provider_factory() as provider:
            if provider.is_mock != runtime.is_mock:
                raise ValueError("provider_mode_mismatch")
            return await provider.generate_structured(
                StructuredGenerationRequest(
                    request_id=str(run_id),
                    messages=[
                        Message(role="system", content=SYSTEM_PROMPT),
                        Message(role="user", content=_canonical(model_input)),
                    ],
                    schema_name="ai_recommendation_v1",
                    output_schema=BatchAssessment.model_json_schema(),
                    max_output_tokens=runtime.max_output_tokens,
                )
            )

    try:
        generated = await asyncio.wait_for(call_once(), timeout=runtime.timeout_seconds)
        if generated.finish_reason != "stop" or generated.data is None:
            error = "incomplete_output"
        else:
            result = validate_assessment(generated.data, model_input)
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
