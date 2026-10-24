"""Tests for the M3 normalized-record to M2 relational persistence bridge."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource
from app.ingestion.db_repository import SqlAlchemyJobRepository
from app.ingestion.models import JobRecord, JobStatus, SourceType


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


def test_recrawl_backfills_original_url_without_inventing_it(db: Session) -> None:
    source = JobSource(name="Legacy", source_type="mock", base_url="https://jobs.example.test")
    db.add(source)
    db.commit()
    repository = SqlAlchemyJobRepository(db, source)
    record = make_record(apply_url="https://jobs.example.test/apply")
    repository.upsert([record])
    db.commit()
    job = db.scalar(select(JobPosting))
    job.source_url = None
    db.commit()
    stats = repository.upsert([record])
    db.commit()
    assert stats.items_unchanged == 1
    assert job.source_url == record.source_url
    assert job.apply_url != job.source_url


def test_recrawl_migrates_a_legacy_identity_hash_without_recreating_job(db: Session) -> None:
    source = JobSource(name="Legacy ATS", source_type="json", base_url="https://jobs.example.test")
    db.add(source)
    db.commit()
    repository = SqlAlchemyJobRepository(db, source)
    repository.upsert([make_record()])
    db.commit()

    stats = repository.upsert([make_record(dedup_hash="b" * 64)])
    db.commit()

    jobs = list(db.scalars(select(JobPosting)).all())
    assert stats.items_updated == 1
    assert len(jobs) == 1
    assert jobs[0].external_id == "job-1"
    assert jobs[0].dedup_hash == "b" * 64


def test_legacy_hash_migration_does_not_claim_another_posting_identity(db: Session) -> None:
    source = JobSource(name="Legacy ATS", source_type="json", base_url="https://jobs.example.test")
    db.add(source)
    db.commit()
    repository = SqlAlchemyJobRepository(db, source)
    repository.upsert([make_record(), make_record(external_id="job-2", dedup_hash="b" * 64)])
    db.commit()

    recrawl = make_record(
        title="Renamed Internship",
        description="Updated details.",
        raw_hash="2" * 64,
        dedup_hash="b" * 64,
    )
    stats = repository.upsert([recrawl])
    db.commit()

    jobs = {job.external_id: job for job in db.scalars(select(JobPosting)).all()}
    assert stats.items_updated == 1
    assert len(jobs) == 2
    assert jobs["job-1"].title == "Renamed Internship"
    assert jobs["job-1"].dedup_hash == "a" * 64
    assert jobs["job-2"].dedup_hash == "b" * 64


def test_cross_source_duplicate_preserves_canonical_identity(db: Session) -> None:
    first = JobSource(name="First", source_type="mock", base_url="https://jobs.example.test")
    second = JobSource(name="Second", source_type="mock", base_url="https://other.example.test")
    db.add_all([first, second])
    db.commit()
    SqlAlchemyJobRepository(db, first).upsert([make_record()])
    db.commit()
    stats = SqlAlchemyJobRepository(db, second).upsert(
        [
            make_record(
                external_id="other-id",
                raw_hash="2" * 64,
                source_url="https://other.example.test/job/other-id",
            )
        ]
    )
    db.commit()
    job = db.scalar(select(JobPosting))
    assert stats.items_unchanged == 1
    assert job.source_id == first.id
    assert job.external_id == "job-1"
    assert job.source_url == "https://jobs.example.test/job/job-1"


def test_same_batch_duplicate_hash_preserves_first_canonical_posting(db: Session) -> None:
    source = JobSource(name="Batch", source_type="mock", base_url="https://jobs.example.test")
    db.add(source)
    db.commit()

    first = make_record()
    duplicate = make_record(
        external_id="job-2",
        source_url="https://jobs.example.test/job/job-2",
        raw_hash="2" * 64,
        description="A second listing with the same normalized identity.",
    )
    stats = SqlAlchemyJobRepository(db, source).upsert([first, duplicate])
    db.commit()

    jobs = list(db.scalars(select(JobPosting)).all())
    assert stats.items_new == 1
    assert stats.items_unchanged == 1
    assert len(jobs) == 1
    assert jobs[0].external_id == "job-1"
    assert jobs[0].source_url == first.source_url


def test_existing_same_source_hash_collision_keeps_original_external_id(db: Session) -> None:
    source = JobSource(name="Batch", source_type="mock", base_url="https://jobs.example.test")
    db.add(source)
    db.commit()
    repository = SqlAlchemyJobRepository(db, source)
    first = make_record()
    repository.upsert([first])
    db.commit()

    duplicate = make_record(
        external_id="job-2",
        source_url="https://jobs.example.test/job/job-2",
        raw_hash="2" * 64,
    )
    stats = repository.upsert([duplicate])
    db.commit()

    jobs = list(db.scalars(select(JobPosting)).all())
    assert stats.items_unchanged == 1
    assert len(jobs) == 1
    assert jobs[0].external_id == first.external_id
    assert jobs[0].source_url == first.source_url


def test_recrawl_updates_closed_status_even_when_content_hash_is_unchanged(db: Session):
    source = JobSource(
        name="Status recrawl", source_type="html", base_url="https://jobs.example.test"
    )
    db.add(source)
    db.commit()
    repository = SqlAlchemyJobRepository(db, source)
    active = make_record()
    repository.upsert([active])
    db.commit()
    closed = active.model_copy(update={"status": JobStatus.CLOSED})
    stats = repository.upsert([closed])
    db.commit()
    row = db.scalar(select(JobPosting))
    assert stats.items_updated == 1
    assert stats.items_unchanged == 0
    assert row.status == "closed"
    assert row.raw_hash == active.raw_hash
    assert repository.upsert([closed]).items_unchanged == 1
    # An explicit later source observation may reopen the canonical row, not duplicate it.
    assert repository.upsert([active]).items_updated == 1
    db.commit()
    assert row.status == "active"
