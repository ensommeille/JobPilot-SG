"""PostgreSQL/SQLAlchemy persistence adapter for normalized ingestion records."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource, JobTag
from app.ingestion.models import JobRecord, UpsertStats


class SqlAlchemyJobRepository:
    """Upsert one source's normalized jobs without owning the transaction."""

    def __init__(self, db: Session, source: JobSource) -> None:
        self.db = db
        self.source = source

    def upsert(self, records: list[JobRecord], *, seen_at: datetime | None = None) -> UpsertStats:
        items_new = items_updated = items_unchanged = 0
        seen_at = seen_at or datetime.now(UTC)
        seen_dedup: set[str] = set()
        seen_key: set[tuple] = set()

        for record in records:
            key = (self.source.id, record.external_id)
            if record.dedup_hash in seen_dedup or key in seen_key:
                # Duplicate within this batch: the first occurrence is canonical.
                # Without this, two identical postings flush to the same dedup_hash
                # and trip the UNIQUE constraint.
                items_unchanged += 1
                continue
            seen_dedup.add(record.dedup_hash)
            seen_key.add(key)
            job = self.db.scalar(
                select(JobPosting).where(
                    JobPosting.source_id == self.source.id,
                    JobPosting.external_id == record.external_id,
                )
            )
            if job is None:
                job = self.db.scalar(
                    select(JobPosting).where(JobPosting.dedup_hash == record.dedup_hash)
                )

            if job is None:
                job = JobPosting(source_id=self.source.id, external_id=record.external_id)
                self._copy_record(job, record)
                job.last_seen_at = seen_at
                self.db.add(job)
                items_new += 1
                # SessionLocal has autoflush=False. Flush within the transaction so
                # later records see this identity instead of failing at batch end.
                self.db.flush()
            elif job.source_id != self.source.id or job.external_id != record.external_id:
                # A matching hash never authorizes replacing another posting's
                # canonical source/external ID, even within the same source.
                items_unchanged += 1
            else:
                before = self._snapshot(job)
                previous_hash = job.dedup_hash
                hash_available = self._hash_available(job, record.dedup_hash)
                self._copy_record(job, record)
                job.last_seen_at = seen_at
                if not hash_available:
                    # Existing legacy duplicates may already claim the v2 key.
                    # Update content but never violate the unique identity index.
                    job.dedup_hash = previous_hash
                if self._snapshot(job) == before:
                    items_unchanged += 1
                else:
                    items_updated += 1
                self.db.flush()

        self.db.flush()
        total_stored = (
            self.db.scalar(
                select(func.count())
                .select_from(JobPosting)
                .where(JobPosting.source_id == self.source.id)
            )
            or 0
        )
        return UpsertStats(
            items_new=items_new,
            items_updated=items_updated,
            items_unchanged=items_unchanged,
            total_stored=total_stored,
        )

    def _hash_available(self, job: JobPosting, dedup_hash: str) -> bool:
        if job.dedup_hash == dedup_hash:
            return True
        owner = self.db.scalar(select(JobPosting).where(JobPosting.dedup_hash == dedup_hash))
        return owner is None or owner.id == job.id

    def close_missing(self, external_ids: set[str]) -> int:
        """Close vanished postings after a complete, successful API listing only."""
        if not external_ids:
            return 0  # A transient empty feed must not close every stored job.
        jobs = self.db.scalars(
            select(JobPosting).where(
                JobPosting.source_id == self.source.id,
                JobPosting.status == "active",
                JobPosting.external_id.not_in(external_ids),
            )
        ).all()
        for job in jobs:
            job.status = "closed"
        return len(jobs)

    def _copy_record(self, job: JobPosting, record: JobRecord) -> None:
        job.external_id = record.external_id
        job.title = record.title
        job.company = record.company
        job.city = record.city
        job.salary_min = record.salary_min
        job.salary_max = record.salary_max
        job.salary_currency = record.salary_currency
        job.salary_period = record.salary_period
        job.education = record.education
        job.experience = record.experience
        job.job_type = record.job_type[0] if record.job_type else None
        previous_description = job.description
        job.description = record.description
        if record.description_blocks is not None:
            job.description_blocks = record.description_blocks
        elif previous_description != record.description:
            job.description_blocks = None
        job.apply_url = record.apply_url or record.source_url
        job.source_url = record.source_url
        job.posted_at = record.posted_at
        job.deadline = record.deadline
        job.dedup_hash = record.dedup_hash
        job.raw_hash = record.raw_hash
        job.status = record.status.value
        employment_tags = self._resolve_tags(record.job_type, category="employment")
        employment_names = {name.casefold() for name in record.job_type}
        general_tags = self._resolve_tags(
            [name for name in record.tags if name.casefold() not in employment_names],
            category="general",
        )
        job.tags = [*employment_tags, *general_tags]

    @staticmethod
    def _snapshot(job: JobPosting) -> tuple:
        # Description hashes deliberately do not cover location, URLs or other metadata.
        fields = (
            "external_id",
            "title",
            "company",
            "city",
            "salary_min",
            "salary_max",
            "salary_currency",
            "salary_period",
            "education",
            "experience",
            "job_type",
            "description",
            "description_blocks",
            "apply_url",
            "source_url",
            "posted_at",
            "deadline",
            "dedup_hash",
            "raw_hash",
            "status",
        )
        return (
            *(getattr(job, field) for field in fields),
            frozenset((tag.name.casefold(), tag.category) for tag in job.tags),
        )

    def _resolve_tags(self, names: list[str], *, category: str) -> list[JobTag]:
        unique_names: list[str] = []
        seen: set[str] = set()
        for name in names:
            normalized = name.strip()
            key = normalized.casefold()
            if normalized and key not in seen:
                seen.add(key)
                unique_names.append(normalized)
        tags: list[JobTag] = []
        for name in unique_names:
            tag = self.db.scalar(
                select(JobTag).where(
                    func.lower(JobTag.name) == name.casefold(),
                    JobTag.category == category,
                )
            )
            if tag is None:
                tag = JobTag(name=name, category=category)
                self.db.add(tag)
                self.db.flush()
            tags.append(tag)
        return tags
