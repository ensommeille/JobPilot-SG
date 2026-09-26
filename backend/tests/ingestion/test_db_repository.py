"""Tests for the M3 normalized-record to M2 relational persistence bridge."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource
from app.ingestion.db_repository import SqlAlchemyJobRepository
from app.ingestion.models import JobRecord, SourceType


def make_record(**overrides: object) -> JobRecord:
    payload: dict[str, object] = {
        "source": "sandbox",
        "source_id": "sandbox",
        "source_type": SourceType.MOCK,
        "external_id": "job-1",
        "source_url": "https://jobs.example.test/job/job-1",
        "title": "Backend Engineer Intern",
        "company": "Example Pte Ltd",
        "city": "Singapore",
        "job_type": ["internship", "temporary"],
        "salary_min": 1500,
        "salary_max": 2200,
        "salary_currency": "SGD",
        "salary_period": "monthly",
        "posted_at": date(2026, 9, 20),
        "description": "Build and test backend APIs.",
        "apply_url": None,
        "raw_hash": "1" * 64,
        "dedup_hash": "a" * 64,
        "parser_version": "test-v1",
        "tags": ["internship", "python"],
    }
    payload.update(overrides)
    return JobRecord.model_validate(payload)


def test_upsert_maps_normalized_records_and_is_idempotent(db: Session) -> None:
    source = JobSource(
        name="Sandbox",
        source_type="mock",
        base_url="https://jobs.example.test",
    )
    db.add(source)
    db.commit()

    repository = SqlAlchemyJobRepository(db, source)
    first = repository.upsert([make_record()])
    db.commit()
    second = repository.upsert([make_record()])
    db.commit()

    assert first.model_dump() == {
        "items_new": 1,
        "items_updated": 0,
        "items_unchanged": 0,
        "total_stored": 1,
    }
    assert second.items_unchanged == 1
    jobs = list(db.scalars(select(JobPosting)).all())
    assert len(jobs) == 1
    assert jobs[0].job_type == "internship"
    assert jobs[0].apply_url == "https://jobs.example.test/job/job-1"
    assert {tag.name for tag in jobs[0].tags} == {
        "internship",
        "temporary",
        "python",
    }
    assert {(tag.name, tag.category) for tag in jobs[0].tags} == {
        ("internship", "employment"),
        ("temporary", "employment"),
        ("python", "general"),
    }


def test_upsert_updates_by_source_external_id_when_content_changes(db: Session) -> None:
    source = JobSource(
        name="Sandbox",
        source_type="mock",
        base_url="https://jobs.example.test",
    )
    db.add(source)
    db.commit()
    repository = SqlAlchemyJobRepository(db, source)
    repository.upsert([make_record()])
    db.commit()

    stats = repository.upsert(
        [
            make_record(
                title="Senior Backend Engineer Intern",
                raw_hash="2" * 64,
                dedup_hash="b" * 64,
                job_type=["internship"],
                tags=["fastapi"],
            )
        ]
    )
    db.commit()

    jobs = list(db.scalars(select(JobPosting)).all())
    assert stats.items_updated == 1
    assert stats.total_stored == 1
    assert len(jobs) == 1
    assert jobs[0].title == "Senior Backend Engineer Intern"
    assert jobs[0].raw_hash == "2" * 64
    assert {tag.name for tag in jobs[0].tags} == {"internship", "fastapi"}
