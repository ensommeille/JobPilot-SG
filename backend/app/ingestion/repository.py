"""Safe JSON snapshot repository for the PoC; production swaps in PostgreSQL."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from .models import JobRecord, SourceType, UpsertStats
    from .normalization import (
        build_dedup_hash,
        infer_city,
        normalize_job_types,
        parse_listed_date,
        parse_salary,
        sha256_text,
    )
except ImportError:  # pragma: no cover
    from models import JobRecord, SourceType, UpsertStats
    from normalization import (
        build_dedup_hash,
        infer_city,
        normalize_job_types,
        parse_listed_date,
        parse_salary,
        sha256_text,
    )


class SnapshotValidationError(ValueError):
    """Existing output is invalid; refusing to overwrite potentially useful data."""


class JsonJobRepository:
    """Merge successful items and atomically replace a validated JSON snapshot."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def upsert(self, records: list[JobRecord]) -> UpsertStats:
        existing = self._load()
        by_key = {(item.source_id, item.external_id): item for item in existing}
        items_new = items_updated = items_unchanged = 0

        for record in records:
            key = (record.source_id, record.external_id)
            previous = by_key.get(key)
            if previous is None:
                items_new += 1
                by_key[key] = record
            elif (
                previous.raw_hash == record.raw_hash
                and previous.parser_version == record.parser_version
            ):
                items_unchanged += 1
            else:
                items_updated += 1
                by_key[key] = record

        if records and (items_new or items_updated or not self.path.exists()):
            ordered = sorted(by_key.values(), key=lambda item: (item.source_id, item.external_id))
            self._atomic_write([item.to_dict() for item in ordered])

        return UpsertStats(
            items_new=items_new,
            items_updated=items_updated,
            items_unchanged=items_unchanged,
            total_stored=len(by_key),
        )

    def migrate_snapshot(self) -> int:
        """Validate and atomically rewrite a legacy snapshot to the current schema."""
        records = self._load()
        if self.path.exists():
            self._atomic_write([item.to_dict() for item in records])
        return len(records)

    def _load(self) -> list[JobRecord]:
        if not self.path.exists():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(payload, list):
                raise TypeError("top-level JSON must be a list")
            return [JobRecord.model_validate(self._migrate_legacy(item)) for item in payload]
        except (OSError, ValueError, TypeError) as exc:
            raise SnapshotValidationError(f"Refusing to overwrite invalid snapshot: {exc}") from exc

    @staticmethod
    def _migrate_legacy(item: Any) -> dict[str, Any]:
        if not isinstance(item, dict):
            raise TypeError("each job must be an object")
        data = dict(item)
        source = str(data.get("source") or "internsg")
        source_url = str(data.get("source_url") or "")
        slug = urlparse(source_url).path.rstrip("/").rsplit("/", 1)[-1]
        apply_id = re.search(r"/job-apply/(\d+)", str(data.get("apply_url") or ""))
        title = str(data.get("title") or "unknown")
        company = str(data.get("company") or "unknown")
        location = data.get("location")
        city = data.get("city") or infer_city(location)
        salary_min, salary_max, salary_currency, salary_period = parse_salary(data.get("allowance"))
        data.setdefault("source_id", source)
        data.setdefault("source_type", SourceType.HTML)
        data.setdefault(
            "external_id", apply_id.group(1) if apply_id else slug or sha256_text(source_url)[:16]
        )
        data.setdefault("city", city)
        data.setdefault("salary_min", salary_min)
        data.setdefault("salary_max", salary_max)
        data.setdefault("salary_currency", salary_currency)
        data.setdefault("salary_period", salary_period)
        data.setdefault("posted_at", parse_listed_date(data.get("date_listed")))
        raw_basis = "\n".join(
            str(data.get(key) or "")
            for key in ("title", "company", "description", "allowance", "date_listed")
        )
        data.setdefault("raw_hash", sha256_text(raw_basis))
        data.setdefault("dedup_hash", build_dedup_hash(source, title, company, city))
        data.setdefault("parser_version", "legacy-v0.1")
        old_job_type = data.get("job_type")
        if isinstance(old_job_type, str):
            data["job_type_raw"] = old_job_type
            data["job_type"] = normalize_job_types(old_job_type)
            data.setdefault("tags", normalize_job_types(old_job_type))
        data.setdefault("description", "Legacy record without description")
        return data

    def _atomic_write(self, payload: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
                temp_path = Path(handle.name)
            os.replace(temp_path, self.path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write audit artifacts without exposing partially written JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
