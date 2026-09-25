"""PostgreSQL/SQLAlchemy persistence adapter for normalized ingestion records."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import JobPosting, JobSource, JobTag
from app.ingestion.models import JobRecord, UpsertStats


class SqlAlchemyJobRepository:
    """Upsert one source's normalized jobs without owning the transaction."""

    def __init__(self, db: Session, source: JobSource) -> None:
        self.db = db
        self.source = source

    def upsert(self, records: list[JobRecord]) -> UpsertStats:
        items_new = items_updated = items_unchanged = 0

        for record in records:
            job = self.db.scalar(
                select(JobPosting).where(
                    or_(
                        (
                            (JobPosting.source_id == self.source.id)
                            & (JobPosting.external_id == record.external_id)
                        ),
                        JobPosting.dedup_hash == record.dedup_hash,
                    )
                )
            )

            if job is None:
                job = JobPosting(source_id=self.source.id, external_id=record.external_id)
                self._copy_record(job, record)
                self.db.add(job)
                items_new += 1
            elif job.raw_hash == record.raw_hash:
                items_unchanged += 1
            else:
                self._copy_record(job, record)
                items_updated += 1

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
        job.description = record.description
        job.apply_url = record.apply_url or record.source_url
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
