"""Bounded, read-only adapters for public Greenhouse, Lever and Ashby boards.

The source URL is an exact API-board URL, never an arbitrary user-supplied URL.
Only explicitly Singapore-based, published early-career posts are retained.
Application links are stored, never fetched or submitted by this adapter.
"""

from __future__ import annotations

import html
import re
import time
from collections.abc import Callable
from datetime import UTC, date, datetime
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
from .normalization import normalize_job_types, sha256_text
from .source_adapter import SourceAdapter

PARSER_VERSION = "public-ats-2026-10-v2"
BOARD_PATHS = {
    "boards-api.greenhouse.io": ("greenhouse", re.compile(r"/v1/boards/([A-Za-z0-9_-]+)")),
    "api.lever.co": ("lever", re.compile(r"/v0/postings/([A-Za-z0-9_-]+)")),
    "api.eu.lever.co": ("lever", re.compile(r"/v0/postings/([A-Za-z0-9_-]+)")),
    "api.ashbyhq.com": ("ashby", re.compile(r"/posting-api/job-board/([A-Za-z0-9_.-]+)")),
}
LISTING_SUFFIXES = {"greenhouse": "/jobs?content=true", "lever": "?mode=json", "ashby": ""}


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
    if not match or match.group(1) in {".", ".."}:
        return None
    return rule[0], match.group(1)


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


def _career_types(title: str, record: dict) -> list[str]:
    """Seniority and commitment are separate: an internship may be FullTime."""
    if re.search(
        r"\b(?:senior|sr|staff|principal|lead|manager|director|head|chief)\b", title, re.I
    ):
        return []
    categories = record.get("categories")
    commitment = categories.get("commitment", "") if isinstance(categories, dict) else ""
    text = f"{title} {commitment} {record.get('employmentType') or ''}"
    result = []
    if re.search(r"\bintern(?:ship)?s?\b", text, re.I):
        result.append("internship")
    if re.search(r"\b(?:graduates?|new[ -]grads?)\b", title, re.I):
        result.append("graduate")
    if re.search(r"\b(?:junior|jr|entry[ -]level|early[ -]career)\b", title, re.I):
        result.append("entry-level")
    return result


def _locations(record: dict, provider: str) -> list[str]:
    """Read only source location fields, never infer Singapore from JD prose."""
    values: list[str] = []

    def add(value: object) -> None:
        if isinstance(value, str) and value.strip() and value.strip() not in values:
            values.append(value.strip())

    def address(value: object) -> None:
        if not isinstance(value, dict):
            return
        postal = value.get("postalAddress", value)
        if isinstance(postal, dict):
            add(postal.get("addressLocality"))
            country = postal.get("addressCountry")
            if isinstance(country, str) and country.casefold() in {"sg", "sgp", "singapore"}:
                add("Singapore")

    def array(value: object) -> list:
        return value if isinstance(value, list) else []

    location = record.get("location")
    if isinstance(location, dict):
        add(location.get("name"))
    else:
        add(location)
    if provider == "lever":
        categories = record.get("categories") or {}
        if isinstance(categories, dict):
            add(categories.get("location"))
            for value in array(categories.get("allLocations")):
                add(value)
        if isinstance(record.get("country"), str) and record["country"].casefold() == "sg":
            add("Singapore")
    elif provider == "ashby":
        address(record.get("address"))
        for secondary in array(record.get("secondaryLocations")):
            if isinstance(secondary, dict):
                add(secondary.get("location"))
                address(secondary.get("address"))
    elif provider == "greenhouse":
        for office in array(record.get("offices")):
            if isinstance(office, dict):
                add(office.get("location"))
                add(office.get("name"))
    return values


def _singapore(record: dict, provider: str) -> bool:
    return any(
        re.search(r"\bsingapore\b", value, re.I)
        and not re.search(r"\b(?:not|outside|excluding)\s+singapore\b", value, re.I)
        for value in _locations(record, provider)
    )


def _posted_at(record: dict, provider: str) -> date | None:
    value = record.get("publishedAt") if provider == "ashby" else record.get("first_published")
    try:
        if isinstance(value, str):
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        if provider == "lever" and isinstance(record.get("createdAt"), (int, float)):
            return datetime.fromtimestamp(record["createdAt"] / 1000, UTC).date()
    except (ValueError, OverflowError, OSError):
        pass
    return None


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
        self._listing_url = config.base_url + LISTING_SUFFIXES[provider]
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

    def _request(self, url: str, *, max_bytes: int) -> httpx.Response:
        # Stream a bounded body; checking response.content after client.get is too late.
        with self.client.stream("GET", url) as response:
            if response.is_redirect:
                raise ValueError("ATS API redirected unexpectedly")
            response.raise_for_status()
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError("ATS response exceeds the configured byte limit")
                chunks.append(chunk)
            return httpx.Response(
                response.status_code,
                headers={
                    key: value
                    for key, value in response.headers.items()
                    if key.casefold() not in {"content-encoding", "content-length"}
                },
                content=b"".join(chunks),
                request=response.request,
            )

    def _get(self, url: str) -> httpx.Response:
        parsed = urlparse(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in self.config.allowed_hosts
            or parsed.port is not None
            or parsed.username
            or parsed.password
            or url != self._listing_url
        ):
            raise ValueError("Request is outside the configured public ATS listing")
        # Ashby documents this exact GET as its public Job Postings API:
        # https://developers.ashbyhq.com/docs/public-job-posting-api
        # Its host-level robots.txt returned 401 on 23 Oct 2026. Only this
        # canonical API URL uses the published-API contract; no HTML/private
        # endpoint is allowed, and API 401/403/redirects still fail closed.
        if self.config.enforce_robots and self.provider != "ashby":
            if self._robots is None:
                robots_url = f"https://{parsed.hostname}/robots.txt"
                try:
                    response = self._request(robots_url, max_bytes=64_000)
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
                return self._request(url, max_bytes=10_000_000)
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
        url = self._listing_url
        try:
            if not self.config.enabled:
                raise ValueError("Source is disabled")
            data = self._json(url)
            jobs = (
                data.get("jobs")
                if self.provider in {"greenhouse", "ashby"} and isinstance(data, dict)
                else data
            )
            if not isinstance(jobs, list):
                raise ValueError("ATS listing has an unexpected shape")
            listing_accessible = True
            candidates = [
                job
                for job in jobs
                if isinstance(job, dict)
                and (self.provider != "ashby" or job.get("isListed") is True)
                and _singapore(job, self.provider)
                and _career_types(str(job.get("title") or job.get("text") or ""), job)
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
                job.get("absolute_url"),
                hosts={
                    "boards.greenhouse.io",
                    "job-boards.greenhouse.io",
                    "job-boards.eu.greenhouse.io",
                },
            )
            # Greenhouse can use a custom company URL. Do not fetch arbitrary domains;
            # construct the canonical hosted board URL from the verified board/id.
            source_url = (
                original or f"https://job-boards.greenhouse.io/{self.board}/jobs/{external_id}"
            )
            apply_url = source_url
            raw_html = html.unescape(str(job.get("content") or ""))
            description = _plain(raw_html)
            job_type_raw = title
        elif self.provider == "lever":
            external_id = job["id"]
            if not isinstance(external_id, str) or not re.fullmatch(r"[A-Za-z0-9-]+", external_id):
                raise ValueError("Lever post has an invalid ID")
            title = _plain(job.get("text"))
            hosts = {"jobs.lever.co", "jobs.eu.lever.co"}
            source_url = _public_url(job.get("hostedUrl"), hosts=hosts)
            apply_url = _public_url(job.get("applyUrl"), hosts=hosts)
            if not source_url or not apply_url:
                raise ValueError("Lever hosted/apply URL is not a supported HTTPS form")
            categories = job.get("categories") or {}
            job_type_raw = (
                _plain(categories.get("commitment")) if isinstance(categories, dict) else ""
            )
            raw_html = str(job.get("description") or "")
            description = _plain(job.get("descriptionPlain") or raw_html)
        else:
            external_id = job["id"]
            if not isinstance(external_id, str) or not re.fullmatch(r"[A-Za-z0-9-]+", external_id):
                raise ValueError("Ashby post has an invalid ID")
            title = _plain(job.get("title"))
            source_url = _public_url(job.get("jobUrl"), hosts={"jobs.ashbyhq.com"})
            apply_url = _public_url(job.get("applyUrl"), hosts={"jobs.ashbyhq.com"})
            expected = f"/{self.board}/{external_id}"
            if (
                not source_url
                or not apply_url
                or urlparse(source_url).path.rstrip("/") != expected
                or urlparse(apply_url).path.rstrip("/")
                not in {expected + "/application", expected + "/apply"}
            ):
                raise ValueError("Ashby hosted/apply URL does not match this board and posting")
            raw_html = str(job.get("descriptionHtml") or "")
            description = _plain(job.get("descriptionPlain") or raw_html)
            job_type_raw = _plain(job.get("employmentType"))
        if not external_id or not title or not description:
            raise ValueError("ATS post is missing ID, title or description")
        if not _singapore(job, self.provider) or not (career_types := _career_types(title, job)):
            raise ValueError("ATS post is outside the Singapore early-career scope")
        location = "; ".join(_locations(job, self.provider))
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
            city="Singapore",
            job_type=list(dict.fromkeys([*career_types, *normalize_job_types(job_type_raw)])),
            job_type_raw=job_type_raw,
            description=description,
            apply_url=apply_url,
            raw_hash=sha256_text(raw_text),
            # Published ATS IDs identify postings even when title and city are identical.
            # A title change must not create a new identity for the same posting.
            dedup_hash=sha256_text(
                f"public-ats-posting-v1\x1f{self.provider}\x1f{self.board}\x1f{external_id}"
            ),
            parser_version=PARSER_VERSION,
            posted_at=_posted_at(job, self.provider),
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
