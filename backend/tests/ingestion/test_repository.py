from __future__ import annotations

import json

import pytest

from app.ingestion.models import JobRecord, SourceType
from app.ingestion.normalization import build_dedup_hash, sha256_text
from app.ingestion.repository import JsonJobRepository, SnapshotValidationError


def make_record(description: str = "Initial description") -> JobRecord:
    raw_hash = sha256_text(description)
    return JobRecord(
        source="internsg",
        source_id="internsg",
        source_type=SourceType.HTML,
        external_id="example-one",
        source_url="https://www.internsg.com/job/example-one/",
        title="Software Engineer Intern",
        company="Example Pte Ltd",
        city="Singapore",
        description=description,
        raw_hash=raw_hash,
        dedup_hash=build_dedup_hash(
            "internsg", "Software Engineer Intern", "Example Pte Ltd", "Singapore"
        ),
        parser_version="test-v1",
    )


def test_upsert_is_idempotent_and_updates_only_changed_raw_content(tmp_path) -> None:
    path = tmp_path / "jobs.json"
    repository = JsonJobRepository(path)

    first = repository.upsert([make_record()])
    unchanged = repository.upsert([make_record()])
    updated = repository.upsert([make_record("Changed description")])

    assert (first.items_new, first.items_updated) == (1, 0)
    assert unchanged.items_unchanged == 1
    assert updated.items_updated == 1
    assert json.loads(path.read_text(encoding="utf-8"))[0]["description"] == "Changed description"


def test_empty_failed_batch_never_replaces_last_success(tmp_path) -> None:
    path = tmp_path / "jobs.json"
    repository = JsonJobRepository(path)
    repository.upsert([make_record()])
    before = path.read_bytes()

    stats = repository.upsert([])

    assert path.read_bytes() == before
    assert stats.total_stored == 1


def test_invalid_existing_snapshot_is_preserved(tmp_path) -> None:
    path = tmp_path / "jobs.json"
    path.write_text("not-json", encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(SnapshotValidationError):
        JsonJobRepository(path).upsert([make_record()])

    assert path.read_bytes() == before


def test_parser_version_change_reprocesses_unchanged_raw_content(tmp_path) -> None:
    path = tmp_path / "jobs.json"
    repository = JsonJobRepository(path)
    first = make_record()
    repository.upsert([first])

    newer_parser = first.model_copy(update={"parser_version": "test-v2"})
    stats = repository.upsert([newer_parser])

    assert stats.items_updated == 1
    assert json.loads(path.read_text(encoding="utf-8"))[0]["parser_version"] == "test-v2"


def test_legacy_snapshot_is_atomically_migrated_to_current_contract(tmp_path) -> None:
    path = tmp_path / "jobs.json"
    path.write_text(
        json.dumps(
            [
                {
                    "source": "internsg",
                    "source_url": "https://www.internsg.com/job/old-slug/",
                    "title": "Old title",
                    "company": "Old company",
                    "description": "Old description",
                    "job_type": "Intern/TS",
                    "location": "One North, Singapore",
                    "allowance": "$900 - 1,100 monthly",
                    "date_listed": "24 Aug 2026",
                    "apply_url": "https://www.internsg.com/job-apply/98765",
                }
            ]
        ),
        encoding="utf-8",
    )
    count = JsonJobRepository(path).migrate_snapshot()
    migrated = json.loads(path.read_text(encoding="utf-8"))[0]

    assert count == 1
    assert migrated["external_id"] == "98765"
    assert migrated["city"] == "Singapore"
    assert migrated["salary_min"] == 900
    assert migrated["salary_max"] == 1100
    assert migrated["posted_at"] == "2026-08-24"
    assert migrated["job_type"] == ["internship", "temporary"]
    assert migrated["parser_version"] == "legacy-v0.1"
