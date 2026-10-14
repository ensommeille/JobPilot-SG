"""Synthetic evidence fixture for the isolated clean-deployment database only."""

import json
import os
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select

from app.db.models import Application, JobExtractionRun, JobPosting, JobSource, User
from app.db.session import SessionLocal
from app.job_extraction.models import ExtractionResult, JobExtractionSchema
from app.job_extraction.persistence import job_input
from app.job_extraction.quality import assess_quality

if os.environ.get("JOBPILOT_ACCEPTANCE_ONLY") != "fresh-disposable-database":
    raise SystemExit("Refusing: explicit fresh disposable database marker is missing")
with SessionLocal() as db:
    sources = list(db.scalars(select(JobSource)))
    fresh = (
        db.get_bind().dialect.name == "postgresql"
        and len(sources) == 1
        and sources[0].name == "JobPilot Sandbox"
        and sources[0].source_type == "sandbox"
        and db.scalar(select(func.count()).select_from(User)) == 1
        and db.scalar(select(func.count()).select_from(JobPosting)) == 2
        and db.scalar(select(func.count()).select_from(JobExtractionRun)) == 0
        and db.scalar(select(func.count()).select_from(Application)) == 0
    )
    if not fresh:
        raise SystemExit("Refusing: database is not a fresh PostgreSQL demo seed")
    source = JobSource(
        name="ACCEPTANCE ONLY - synthetic evidence, not a real employer",
        source_type="sandbox",
        base_url="https://acceptance.invalid",
    )
    db.add(source)
    db.flush()
    description = "Comfortable using Excel or Google Sheets for weekly reports."
    job = JobPosting(
        source_id=source.id,
        external_id="acceptance-only-excel",
        title="ACCEPTANCE ONLY - fictional reporting role",
        company="Synthetic acceptance fixture - do not apply",
        description=description,
        source_url="https://acceptance.invalid/job",
        apply_url="https://acceptance.invalid/apply",
        city="Singapore",
        job_type="internship",
        posted_at=date.today(),
        raw_hash="a" * 64,
        dedup_hash="c" * 64,
    )
    db.add(job)
    db.flush()
    data = JobExtractionSchema.model_validate(
        {
            "summary": None,
            "responsibilities": [],
            "required_skills": [
                {"value": "Comfortable using Excel or Google Sheets", "evidence": description}
            ],
            "preferred_skills": [],
            "required_qualifications": [],
            "preferred_qualifications": [],
            "languages": [],
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
            "experience": {"requirement": None, "minimum_years": None},
        }
    )
    item = job_input(job)
    now = datetime.now(UTC)
    # This isolated acceptance fixture exercises the live-result branch without
    # performing or claiming a model call. It must never enter a real data store.
    result = ExtractionResult.model_validate(
        {
            "result_id": str(uuid4()),
            "source_id": item.source_id,
            "external_id": item.external_id,
            "source_url": item.source_url,
            "input_hash": item.input_hash,
            "schema_version": "job-extraction-v1",
            "prompt_version": "job-extraction-prompt-v1",
            "contract_version": "0.1.0",
            "execution_mode": "live",
            "status": "needs_review",
            "extraction": data.model_dump(),
            "quality": assess_quality(data, description).model_dump(),
            "attempts": [
                {
                    "attempt": 1,
                    "request_id": "acceptance-fixture-no-model-call",
                    "outcome": "success",
                    "duration_ms": 0,
                    "provider": "SYNTHETIC ACCEPTANCE FIXTURE - NO MODEL CALLED",
                }
            ],
            "started_at": now.isoformat(),
            "finished_at": now.isoformat(),
        }
    )
    db.add(
        JobExtractionRun(
            job_id=job.id,
            status="needs_review",
            input_hash=item.input_hash,
            pipeline_hash="a" * 64,
            input_json=item.model_dump(),
            pipeline_json={"notice": "Synthetic acceptance only; no model call."},
            result_json=result.model_dump(),
            started_at=now,
            finished_at=now,
            expires_at=now + timedelta(hours=24),
        )
    )
    db.commit()
    print(json.dumps({"job_id": str(job.id), "synthetic": True, "model_calls": 0}))
