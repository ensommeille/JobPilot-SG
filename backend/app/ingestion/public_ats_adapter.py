"""Bounded Singapore-only collection from documented public ATS job-board APIs."""

from __future__ import annotations

import html
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from app.ingestion.models import (
    AdapterBatch,
    ItemFailure,
    JobRecord,
    RawJobItem,
    RunStatus,
    SourceConfig,
    SourceType,
)
from app.ingestion.normalization import normalize_job_types, sha256_text
from app.ingestion.source_adapter import SourceAdapter

PARSER_VERSION = "public-ats-v1"
_GREENHOUSE = re.compile(r"/v1/boards/([a-z0-9][a-z0-9-]*)")
_LEVER = re.compile(r"/v0/postings/([a-z0-9][a-z0-9-]*)")


def ats_provider(base_url: str) -> str:
    """Accept only canonical HTTPS board API roots; never fetch arbitrary admin URLs."""
    parsed = urlparse(base_url)
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid public ATS API URL")
    host = (parsed.hostname or "").casefold()
    path = parsed.path.rstrip("/")
    if host == "boards-api.greenhouse.io" and _GREENHOUSE.fullmatch(path):
        return "greenhouse"
    if host == "api.lever.co" and _LEVER.fullmatch(path):
        return "lever"
    raise ValueError("Unsupported public ATS API URL")


def _plain_text(value: str) -> str:
    return BeautifulSoup(html.unescape(value), "html.parser").get_text("\n", strip=True)


def _public_https_url(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Missing public job URL")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Job URL must be public HTTPS")
    host = parsed.hostname.casefold()
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
        raise ValueError("Job URL must be public HTTPS")
    return value


class PublicATSAdapter(SourceAdapter):
    """One read-only listing request per run, with per-item validation and no form calls."""

    def __init__(
        self,
        config: SourceConfig,
        *,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        if config.source_type is not SourceType.API:
            raise ValueError("PublicATSAdapter requires source_type=api")
        self.provider = ats_provider(config.base_url)
        expected_host = (
            "boards-api.greenhouse.io" if self.provider == "greenhouse" else "api.lever.co"
        )
        if config.allowed_hosts != frozenset({expected_host}):
            raise ValueError("ATS host policy does not match the API URL")
        self._config = config
        self._now = now or (lambda: datetime.now(UTC))
        self._sleep = sleep
        self._owns_client = client is None
        self.client = client or httpx.Client(
            headers={"User-Agent": config.user_agent, "Accept": "application/json"},
            timeout=httpx.Timeout(config.timeout_seconds),
            follow_redirects=False,
        )

    @property
    def config(self) -> SourceConfig:
        return self._config

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def collect(self, *, max_links: int, max_details: int) -> AdapterBatch:
        if not 1 <= max_links <= 100 or not 1 <= max_details <= max_links:
            raise ValueError("Limits must satisfy 1 <= max_details <= max_links <= 100")
        started = self._now()
        if not self.config.enabled:
            return self._batch(started, False, 0, 0, [], [
                self._failure(self.config.base_url, "listing", ValueError("Source disabled"))
            ])

        try:
            payload = self._fetch_listing()
            if self.provider == "greenhouse" and not isinstance(payload, dict):
                raise ValueError("ATS response is not an object")
            jobs = payload.get("jobs") if self.provider == "greenhouse" else payload
            if not isinstance(jobs, list):
                raise ValueError("ATS response has no jobs array")
        except (httpx.HTTPError, ValueError) as exc:
            return self._batch(started, False, 0, 0, [], [
                self._failure(self.config.base_url, "listing", exc)
            ])

        singapore_jobs = [job for job in jobs if isinstance(job, dict) and self._in_singapore(job)]
        sort_key = "updated_at" if self.provider == "greenhouse" else "createdAt"
        singapore_jobs.sort(key=lambda job: str(job.get(sort_key) or ""), reverse=True)
        selected = singapore_jobs[:max_links][:max_details]
        items: list[RawJobItem] = []
        failures: list[ItemFailure] = []
        for job in selected:
            try:
                items.append(self._to_raw_item(job))
            except (TypeError, ValueError) as exc:
                failures.append(self._failure(self.config.base_url, "parse", exc))
        return self._batch(started, True, len(singapore_jobs), len(selected), items, failures)

    def _fetch_listing(self) -> Any:
        params = {"content": "true"} if self.provider == "greenhouse" else {"mode": "json"}
        url = f"{self.config.base_url}/jobs" if self.provider == "greenhouse" else self.config.base_url
        for attempt in range(self.config.retry_count + 1):
            try:
                response = self.client.get(url, params=params)
                if response.status_code in {500, 502, 503, 504} and attempt < self.config.retry_count:
                    self._sleep(0.5 * (attempt + 1))
                    continue
                response.raise_for_status()  # 403/429 are never retried.
                if "json" not in response.headers.get("content-type", "").casefold():
                    raise ValueError("ATS endpoint did not return JSON")
                return response.json()
            except httpx.TransportError:
                if attempt == self.config.retry_count:
                    raise
                self._sleep(0.5 * (attempt + 1))
        raise RuntimeError("Unreachable ATS retry state")

    def _in_singapore(self, job: dict[str, Any]) -> bool:
        if self.provider == "greenhouse":
            location = job.get("location") or {}
            values = [location.get("name") if isinstance(location, dict) else None]
        else:
            categories = job.get("categories") or {}
            if not isinstance(categories, dict):
                return False
            values = [categories.get("location"), *(categories.get("allLocations") or [])]
        return any(isinstance(value, str) and "singapore" in value.casefold() for value in values)

    def _to_raw_item(self, job: dict[str, Any]) -> RawJobItem:
        external_id = str(job.get("id") or "").strip()
        if not external_id:
            raise ValueError("ATS job has no id")
        if self.provider == "greenhouse":
            title = str(job.get("title") or "").strip()
            location_value = job.get("location") or {}
            if not isinstance(location_value, dict):
                raise ValueError("ATS job has invalid location data")
            location = str(location_value.get("name") or "").strip()
            description = _plain_text(str(job.get("content") or ""))
            source_url = _public_https_url(job.get("absolute_url"))
            apply_url = source_url
            commitment = title
        else:
            title = str(job.get("text") or "").strip()
            categories = job.get("categories") or {}
            if not isinstance(categories, dict):
                raise ValueError("ATS job has invalid categories")
            location = str(categories.get("location") or "").strip()
            sections = [str(job.get("descriptionPlain") or "")]
            lists = job.get("lists") or []
            if not isinstance(lists, list):
                raise ValueError("ATS job has invalid description sections")
            for section in lists:
                if isinstance(section, dict):
                    sections.append(f"{section.get('text') or ''}\n{_plain_text(str(section.get('content') or ''))}")
            description = "\n\n".join(section.strip() for section in sections if section.strip())
            source_url = _public_https_url(job.get("hostedUrl"))
            apply_url = _public_https_url(job.get("applyUrl"))
            commitment = str(categories.get("commitment") or title)
        if not title or not description:
            raise ValueError("ATS job is missing a title or description")
        if not self._in_singapore(job):
            raise ValueError("ATS job is outside Singapore")
        if (
            len(external_id) > 255
            or len(title) > 300
            or len(source_url) > 2048
            or len(apply_url) > 2000
        ):
            raise ValueError("ATS job exceeds database field limits")
        description = description[:20000]
        raw_text = f"{title}\n{description}"
        raw_hash = sha256_text(raw_text)
        job_types = normalize_job_types(commitment)
        record = JobRecord(
            source=self.provider,
            source_id=self.config.source_id,
            source_type=SourceType.API,
            external_id=external_id,
            source_url=source_url,
            title=title,
            company=self.config.name,
            location=location,
            city="Singapore",
            job_type=job_types,
            job_type_raw=commitment,
            description=description,
            apply_url=apply_url,
            raw_hash=raw_hash,
            dedup_hash=sha256_text(f"{self.config.source_id}\x1f{external_id}"),
            parser_version=PARSER_VERSION,
            tags=job_types,
        )
        return RawJobItem(
            source_id=self.config.source_id,
            source_type=SourceType.API,
            external_id=external_id,
            source_url=source_url,
            raw_text=raw_text,
            raw_hash=raw_hash,
            known_fields=record,
            fetched_at=self._now(),
        )

    def _batch(
        self,
        started_at: datetime,
        accessible: bool,
        discovered: int,
        attempted: int,
        items: list[RawJobItem],
        failures: list[ItemFailure],
    ) -> AdapterBatch:
        status = RunStatus.SUCCEEDED
        if failures:
            status = RunStatus.PARTIAL if items else RunStatus.FAILED
        return AdapterBatch(
            source_id=self.config.source_id,
            status=status,
            listing_accessible=accessible,
            discovered_count=discovered,
            attempted_count=attempted,
            items=items,
            failures=failures,
            started_at=started_at,
            finished_at=self._now(),
        )

    @staticmethod
    def _failure(url: str, stage: str, exc: Exception) -> ItemFailure:
        return ItemFailure(
            url=url,
            stage=stage,  # type: ignore[arg-type]
            error_type=type(exc).__name__,
            message=str(exc),
            retryable=isinstance(exc, (httpx.TransportError, httpx.TimeoutException)),
        )
