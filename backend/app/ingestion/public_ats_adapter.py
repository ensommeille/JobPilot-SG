"""Bounded, read-only adapters for public Greenhouse and Lever job boards.

The source URL is an exact API-board URL, never an arbitrary user-supplied URL.
Only published internship posts are retained. Application links are stored, not
fetched or submitted by this adapter.
"""

from __future__ import annotations

import html
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

from .models import (
    AdapterBatch,
    ItemFailure,
    JobRecord,
    RawJobItem,
    RunStatus,
    SourceConfig,
    SourceType,
)
from .normalization import build_dedup_hash, infer_city, normalize_job_types, sha256_text
from .source_adapter import SourceAdapter

PARSER_VERSION = "public-ats-2026-10-v1"
BOARD_PATHS = {
    "boards-api.greenhouse.io": ("greenhouse", re.compile(r"/v1/boards/([A-Za-z0-9_-]+)")),
    "api.lever.co": ("lever", re.compile(r"/v0/postings/([A-Za-z0-9_-]+)")),
    "api.eu.lever.co": ("lever", re.compile(r"/v0/postings/([A-Za-z0-9_-]+)")),
}


def public_ats_identity(value: str) -> tuple[str, str] | None:
    """Return (provider, board token) only for exact official HTTPS API URLs."""
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").casefold()
        port = parsed.port
    except ValueError:
        return None
    rule = BOARD_PATHS.get(host)
    if (
        parsed.scheme != "https"
        or port is not None
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not rule
    ):
        return None
    match = rule[1].fullmatch(parsed.path.rstrip("/"))
    return (rule[0], match.group(1)) if match else None


def _public_url(value: object, *, hosts: set[str]) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").casefold()
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or port is not None
        or parsed.username
        or parsed.password
        or host not in hosts
    ):
        return None
    return value


def _plain(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return BeautifulSoup(html.unescape(value), "html.parser").get_text(" ", strip=True)


def _internship(title: str, record: dict) -> bool:
    categories = record.get("categories")
    commitment = categories.get("commitment", "") if isinstance(categories, dict) else ""
    return bool(re.search(r"\bintern(?:ship)?\b", f"{title} {commitment}", re.I))


class PublicATSAdapter(SourceAdapter):
    def __init__(
        self,
        config: SourceConfig,
        *,
        provider: str,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        identity = public_ats_identity(config.base_url)
        if (
            config.source_type is not SourceType.JSON
            or identity is None
            or identity[0] != provider
            or config.allowed_hosts != frozenset({urlparse(config.base_url).hostname})
        ):
            raise ValueError("Invalid public ATS source policy")
        self._config = config
        self.provider = provider
        self.board = identity[1]
        self._sleep = sleep
        self._now = now or (lambda: datetime.now(UTC))
        self._owns_client = client is None
        self.client = client or httpx.Client(
            headers={"User-Agent": config.user_agent, "Accept": "application/json"},
            timeout=httpx.Timeout(config.timeout_seconds),
            follow_redirects=False,
        )
        self._robots: RobotFileParser | None = None

    @property
    def config(self) -> SourceConfig:
        return self._config

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def _get(self, url: str) -> httpx.Response:
        parsed = urlparse(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in self.config.allowed_hosts
            or parsed.port is not None
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Request is outside the configured ATS host")
        if self.config.enforce_robots and not url.endswith("/robots.txt"):
            if self._robots is None:
                robots_url = f"https://{parsed.hostname}/robots.txt"
                try:
                    response = self.client.get(robots_url)
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    if self.config.robots_fail_closed:
                        raise ValueError("ATS robots policy unavailable") from exc
                    parser = RobotFileParser()
                    parser.parse([])
                else:
                    parser = RobotFileParser()
                    parser.parse(response.text.splitlines())
                self._robots = parser
            if not self._robots.can_fetch(self.config.user_agent, url):
                raise ValueError("ATS robots policy disallows this request")
        for attempt in range(self.config.retry_count + 1):
            try:
                response = self.client.get(url)
                # A redirect is not followed, even if an API provider changes hosts.
                if response.is_redirect:
                    raise ValueError("ATS API redirected unexpectedly")
                response.raise_for_status()
                return response
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt == self.config.retry_count:
                    raise
                self._sleep(0.5 * (attempt + 1))
        raise AssertionError("unreachable")

    def _json(self, url: str) -> object:
        response = self._get(url)
        if "application/json" not in response.headers.get("content-type", "").casefold():
            raise ValueError("ATS response is not JSON")
        if len(response.content) > 10_000_000:
            raise ValueError("ATS response exceeds 10 MB")
        return response.json()

    def collect(self, *, max_links: int, max_details: int) -> AdapterBatch:
        if not 1 <= max_details <= max_links <= 100:
            raise ValueError("Invalid collection limits")
        started = self._now()
        items: list[RawJobItem] = []
        failures: list[ItemFailure] = []
        discovered = attempted = 0
        listing_accessible = False
        url = self.config.base_url + (
            "/jobs?content=true" if self.provider == "greenhouse" else "?mode=json"
        )
        try:
            if not self.config.enabled:
                raise ValueError("Source is disabled")
            data = self._json(url)
            jobs = (
                data.get("jobs")
                if self.provider == "greenhouse" and isinstance(data, dict)
                else data
            )
            if not isinstance(jobs, list):
                raise ValueError("ATS listing has an unexpected shape")
            listing_accessible = True
            candidates = [
                job
                for job in jobs
                if isinstance(job, dict)
                and _internship(str(job.get("title") or job.get("text") or ""), job)
            ]
            discovered = len(candidates)
            for job in candidates[:max_links][:max_details]:
                attempted += 1
                if attempted > 1:
                    self._sleep(self.config.polite_delay_seconds)
                try:
                    items.append(self._item(job))
                except (ValueError, TypeError, KeyError) as exc:
                    failures.append(
                        ItemFailure(
                            url=url, stage="parse", error_type=type(exc).__name__, message=str(exc)
                        )
                    )
        except (httpx.HTTPError, ValueError) as exc:
            failures.append(
                ItemFailure(
                    url=url,
                    stage="listing",
                    error_type=type(exc).__name__,
                    message=str(exc),
                    retryable=isinstance(exc, httpx.TransportError),
                )
            )
        status = (
            RunStatus.PARTIAL
            if items and failures
            else RunStatus.FAILED
            if failures
            else RunStatus.SUCCEEDED
        )
        return AdapterBatch(
            source_id=self.config.source_id,
            status=status,
            listing_accessible=listing_accessible,
            discovered_count=discovered,
            attempted_count=attempted,
            items=items,
            failures=failures,
            started_at=started,
            finished_at=self._now(),
        )

    def _item(self, job: dict) -> RawJobItem:
        if self.provider == "greenhouse":
            external_id = str(job["id"])
            if not external_id.isascii() or not external_id.isdecimal():
                raise ValueError("Greenhouse post has an invalid ID")
            title = _plain(job.get("title"))
            original = _public_url(
                job.get("absolute_url"), hosts={"boards.greenhouse.io", "job-boards.greenhouse.io"}
            )
            # Greenhouse can use a custom company URL. Do not fetch arbitrary domains;
            # construct the canonical hosted board URL from the verified board/id.
            source_url = (
                original or f"https://job-boards.greenhouse.io/{self.board}/jobs/{external_id}"
            )
            apply_url = source_url
            location = (
                _plain((job.get("location") or {}).get("name"))
                if isinstance(job.get("location"), dict)
                else ""
            )
            raw_html = html.unescape(str(job.get("content") or ""))
            description = _plain(raw_html)
            job_type_raw = "Internship"
        else:
            external_id = str(job["id"])
            if not re.fullmatch(r"[A-Za-z0-9-]+", external_id):
                raise ValueError("Lever post has an invalid ID")
            title = _plain(job.get("text"))
            hosts = {"jobs.lever.co", "jobs.eu.lever.co"}
            source_url = _public_url(job.get("hostedUrl"), hosts=hosts)
            apply_url = _public_url(job.get("applyUrl"), hosts=hosts)
            if not source_url or not apply_url:
                raise ValueError("Lever hosted/apply URL is not a supported HTTPS form")
            categories = job.get("categories") or {}
            location = _plain(categories.get("location")) if isinstance(categories, dict) else ""
            job_type_raw = (
                _plain(categories.get("commitment")) if isinstance(categories, dict) else ""
            )
            raw_html = str(job.get("description") or "")
            description = _plain(job.get("descriptionPlain") or raw_html)
        if not external_id or not title or not description:
            raise ValueError("ATS post is missing ID, title or description")
        city = infer_city(location)
        raw_text = f"{title}\n{description}"
        record = JobRecord(
            source=self.provider,
            source_id=self.config.source_id,
            source_type=SourceType.JSON,
            external_id=external_id,
            source_url=source_url,
            title=title,
            company=self.config.name,
            location=location or None,
            city=city,
            job_type=normalize_job_types(job_type_raw or title),
            job_type_raw=job_type_raw,
            description=description,
            apply_url=apply_url,
            raw_hash=sha256_text(raw_text),
            dedup_hash=build_dedup_hash(self.config.source_id, title, self.config.name, city),
            parser_version=PARSER_VERSION,
        )
        return RawJobItem(
            source_id=self.config.source_id,
            source_type=SourceType.JSON,
            external_id=external_id,
            source_url=source_url,
            raw_text=raw_text,
            raw_html=raw_html or None,
            raw_hash=record.raw_hash,
            known_fields=record,
            fetched_at=self._now(),
        )
