"""Import actual model artifacts into a fresh, disposable PostgreSQL demo only.

This rebinds source IDs/input hashes for the new database, retaining the model
payload and original audit metadata. It does not represent another model call.
Run via docker exec with JOBPILOT_ACCEPTANCE_ONLY=fresh-disposable-database.
"""

import argparse
import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select

from app.db.models import Application, JobExtractionRun, JobPosting, JobSource, User
from app.db.session import SessionLocal
from app.ingestion.internsg_adapter import InternSGAdapter, default_internsg_config
from app.job_extraction.models import ExtractionInput, ExtractionResult
from app.job_extraction.persistence import job_input


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get("JOBPILOT_ACCEPTANCE_ONLY") != "fresh-disposable-database":
        raise SystemExit("Refusing: disposable database marker missing")
    bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
    if bundle.get("kind") != "actual-model-artifacts-for-disposable-acceptance":
        raise SystemExit("Refusing: unexpected acceptance bundle")
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
            raise SystemExit("Refusing: not a fresh PostgreSQL demo seed")
        source = JobSource(
            name="ACCEPTANCE ONLY - InternSG source replay",
            source_type="html",
            base_url="https://www.internsg.com",
        )
        db.add(source)
        db.flush()
        config = default_internsg_config().model_copy(update={"source_id": str(source.id)})
        jobs = {}
        with InternSGAdapter(config) as adapter:
            for row in bundle["cases"]:
                original_input = ExtractionInput.model_validate(row["input"])
                parsed = adapter.parse_job_detail(row["html"], original_input.source_url)
                if (parsed.title, parsed.company, parsed.description) != (
                    original_input.title,
                    original_input.company,
                    original_input.description,
                ):
                    raise SystemExit("Refusing: parser input differs from saved model input")
                job = JobPosting(
                    source_id=source.id,
                    source=source,
                    external_id=parsed.external_id,
                    title=parsed.title,
                    company=parsed.company,
                    description=parsed.description,
                    source_url=parsed.source_url,
                    apply_url=parsed.apply_url or parsed.source_url,
                    city=parsed.city,
                    job_type=parsed.job_type[0] if parsed.job_type else None,
                    posted_at=parsed.posted_at,
                    deadline=parsed.deadline,
                    status=parsed.status.value,
                    raw_hash=parsed.raw_hash,
                    dedup_hash=parsed.dedup_hash,
                )
                db.add(job)
                db.flush()
                jobs[row["id"]] = {
                    "job_id": str(job.id),
                    "status": job.status,
                    "model_artifact_imported": False,
                }
                if row.get("result") is None:
                    continue
                original = ExtractionResult.model_validate(row["result"])
                if (
                    original.input_hash != original_input.input_hash
                    or original.source_id != original_input.source_id
                    or original.external_id != original_input.external_id
                    or original.source_url != original_input.source_url
                    or original.execution_mode != "live"
                    or original.status != "needs_review"
                ):
                    raise SystemExit("Refusing: model artifact/input hash mismatch")
                current = job_input(job)
                # Only the envelope changes. Source-backed semantic payload remains exact.
                rebound = original.model_copy(
                    update={
                        "source_id": current.source_id,
                        "external_id": current.external_id,
                        "input_hash": current.input_hash,
                        "raw_hash": current.raw_hash,
                    }
                )
                rebound = ExtractionResult.model_validate(rebound.model_dump())
                pipeline = {
                    "kind": "replayed_actual_live_artifact_for_disposable_acceptance",
                    "original_result_id": original.result_id,
                    "original_input_hash": original.input_hash,
                    "original_source_id": original.source_id,
                    "database_identity_rebound": True,
                    "new_model_calls": 0,
                    "human_semantic_review": "pending",
                }
                now = datetime.now(UTC)
                db.add(
                    JobExtractionRun(
                        job_id=job.id,
                        status=original.status,
                        input_hash=current.input_hash,
                        pipeline_hash=hashlib.sha256(
                            json.dumps(pipeline, sort_keys=True).encode()
                        ).hexdigest(),
                        input_json=current.model_dump(mode="json"),
                        pipeline_json=pipeline,
                        result_json=rebound.model_dump(mode="json"),
                        error_code=original.error_code,
                        started_at=now,
                        finished_at=now,
                        expires_at=now + timedelta(hours=24),
                    )
                )
                jobs[row["id"]]["model_artifact_imported"] = True
        db.commit()
        print(
            json.dumps(
                {
                    "jobs": jobs,
                    "new_model_calls": 0,
                    "notice": "Actual model artifact replay; isolated test deployment; human review pending.",
                }
            )
        )


if __name__ == "__main__":
    main()
