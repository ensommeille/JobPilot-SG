"""Integration-ready HTTP adapter for public InternSG job listings."""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup, Tag

try:
    from .models import (
        AdapterBatch,
        ItemFailure,
        JobRecord,
        RawJobItem,
        RunStatus,
        SourceConfig,
        SourceType,
    )
    from .normalization import (
        build_dedup_hash,
        infer_city,
        normalize_job_types,
        parse_listed_date,
        parse_salary,
        sha256_text,
    )
    from .source_adapter import SourceAdapter
except ImportError:  # pragma: no cover - permits `python scraper.py`
    from models import (
        AdapterBatch,
        ItemFailure,
        JobRecord,
        RawJobItem,
        RunStatus,
        SourceConfig,
        SourceType,
    )
    from normalization import (
        build_dedup_hash,
        infer_city,
        normalize_job_types,
        parse_listed_date,
        parse_salary,
        sha256_text,
    )
    from source_adapter import SourceAdapter


LOGGER = logging.getLogger(__name__)
PARSER_VERSION = "internsg-2026-08-v2"


class AdapterPolicyError(RuntimeError):
    """A source policy (host, HTTPS, robots, enabled state) rejected the crawl."""


class DetailParseError(ValueError):
    """The response is HTML but not a valid job detail under the adapter contract."""


def default_internsg_config() -> SourceConfig:
    return SourceConfig(
        source_id="internsg",
        name="InternSG",
        source_type=SourceType.HTML,
        base_url="https://www.internsg.com",
        allowed_hosts=frozenset({"internsg.com", "www.internsg.com"}),
        user_agent="JobPilot-SWE5006/0.2 (low-frequency academic project)",
    )


class InternSGAdapter(SourceAdapter):
    """InternSG implementation isolated behind the shared SourceAdapter boundary."""

    BASE_URL = "https://www.internsg.com"  # Backward-compatible constants.
    LISTING_URL = f"{BASE_URL}/jobs/"
    USER_AGENT = default_internsg_config().user_agent

    def __init__(
        self,
        config: SourceConfig | None = None,
        *,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._config = config or default_internsg_config()
        if self._config.source_type is not SourceType.HTML:
            raise ValueError("InternSGAdapter requires source_type=html")
        self._sleep = sleep
        self._now = now or (lambda: datetime.now(UTC))
        self._owns_client = client is None
        self.client = client or httpx.Client(
            headers={"User-Agent": self._config.user_agent, "Accept": "text/html"},
            timeout=httpx.Timeout(self._config.timeout_seconds),
            follow_redirects=True,
        )
        self._robots: RobotFileParser | None = None

    @property
    def config(self) -> SourceConfig:
        return self._config

    def __enter__(self) -> InternSGAdapter:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def collect(self, *, max_links: int = 20, max_details: int = 5) -> AdapterBatch:
        """Collect a bounded batch and return structured successes and failures."""
        if not 1 <= max_links <= 100:
            raise ValueError("max_links must be between 1 and 100")
        if not 1 <= max_details <= max_links:
            raise ValueError("max_details must be between 1 and max_links")

        started_at = self._now()
        if not self.config.enabled:
            failure = self._failure(
                self.config.base_url, "listing", AdapterPolicyError("source is disabled")
            )
            return self._batch(started_at, False, 0, 0, [], [failure])

        try:
            listing_html = self.fetch_listing_page(page=1)
            links = self.extract_job_links(listing_html, max_links=max_links)
        except (httpx.HTTPError, AdapterPolicyError, ValueError) as exc:
            stage = (
                "robots"
                if isinstance(exc, AdapterPolicyError) and "robots" in str(exc).casefold()
                else "listing"
            )
            return self._batch(
                started_at, False, 0, 0, [], [self._failure(self.LISTING_URL, stage, exc)]
            )

        if not links:
            failure = self._failure(
                self.LISTING_URL, "listing", DetailParseError("no job links discovered")
            )
            return self._batch(started_at, True, 0, 0, [], [failure])

        LOGGER.info("Found %d job links", len(links))
        items: list[RawJobItem] = []
        failures: list[ItemFailure] = []
        attempted = 0
        for index, url in enumerate(links[:max_details], start=1):
            if index > 1:
                self._sleep(self.config.polite_delay_seconds)
            attempted += 1
            LOGGER.info("Fetching %d/%d: %s", index, min(max_details, len(links)), url)
            try:
                html = self.fetch_job_detail(url)
                items.append(self.to_raw_item(html, url))
                LOGGER.info("Parsed: %s", items[-1].known_fields.title)
            except (httpx.HTTPError, AdapterPolicyError) as exc:
                failures.append(self._failure(url, "fetch", exc))
                LOGGER.error("Fetch failed for %s: %s", url, exc)
            except (DetailParseError, ValueError) as exc:
                failures.append(self._failure(url, "parse", exc))
                LOGGER.error("Parse failed for %s: %s", url, exc)

        return self._batch(started_at, True, len(links), attempted, items, failures)

    def fetch_listing_page(self, page: int = 1) -> str:
        if page < 1:
            raise ValueError("page must be at least 1")
        base = f"{self.config.base_url}/jobs/"
        url = base if page == 1 else f"{base}page/{page}/"
        self._validate_fetch_url(url, path_prefix="/jobs/")
        self._ensure_robots_allowed(url)
        LOGGER.info("Fetching listing page: %s", url)
        return self._fetch_html(url)

    def extract_job_links(self, html: str, max_links: int = 20) -> list[str]:
        """Extract bounded, unique, same-site public job-detail URLs."""
        if max_links < 1:
            raise ValueError("max_links must be positive")
        soup = BeautifulSoup(html, "html.parser")
        anchors: Iterable[Tag] = soup.select("a.job-listing-row[href]")
        if not anchors:
            anchors = soup.select('a[href*="/job/"]')

        links: list[str] = []
        seen: set[str] = set()
        for anchor in anchors:
            href = anchor.get("href")
            if not isinstance(href, str):
                continue
            url = urljoin(self.config.base_url, href).split("#", 1)[0]
            try:
                self._validate_fetch_url(url, path_prefix="/job/")
            except AdapterPolicyError:
                LOGGER.warning("Ignoring out-of-policy job link: %s", url)
                continue
            if url in seen:
                continue
            seen.add(url)
            links.append(url)
            if len(links) == max_links:
                break
        return links

    def fetch_job_detail(self, url: str) -> str:
        self._validate_fetch_url(url, path_prefix="/job/")
        self._ensure_robots_allowed(url)
        return self._fetch_html(url)

    def parse_job_detail(self, html: str, url: str) -> JobRecord:
        """Parse and validate deterministic fields; malformed pages fail closed."""
        self._validate_fetch_url(url, path_prefix="/job/")
        soup = BeautifulSoup(html, "html.parser")
        container = soup.select_one(".isg-detail-container")
        if container is None:
            raise DetailParseError("job detail container not found")
        facts = self._definition_values(soup)

        company = self._required_text(soup.select_one(".isg-job-company"), "company")
        heading = self._required_text(soup.select_one("h1.entry-title"), "heading")
        title = self._title_from_heading(heading, company)
        if not title:
            raise DetailParseError("title not found")
        description = facts.get("Job Description")
        if not description:
            raise DetailParseError("job description not found")

        job_type_node = soup.select_one(".isg-job-facts .badge-info") or soup.select_one(
            ".isg-job-facts .badge"
        )
        job_type_raw = self._text(job_type_node)
        allowance = self._text(soup.select_one(".isg-job-pay"))
        location = facts.get("Location Name") or facts.get("Address")
        city = infer_city(location)
        salary_min, salary_max, salary_currency, salary_period = parse_salary(allowance)

        apply_url = self._link(soup.select_one(".isg-apply-card a.btn-apply[href]"))
        apply_id = re.search(r"/job-apply/(\d+)", apply_url or "")
        external_id = (
            apply_id.group(1) if apply_id else urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
        )
        if not external_id:
            raise DetailParseError("external_id could not be derived from URL")
        raw_text = f"{heading}\n{container.get_text(chr(10), strip=True)}"
        raw_hash = sha256_text(raw_text)

        return JobRecord(
            source="internsg",
            source_id=self.config.source_id,
            source_type=self.config.source_type,
            external_id=external_id,
            source_url=url,
            title=title,
            company=company,
            location=location,
            city=city,
            job_type=normalize_job_types(job_type_raw),
            job_type_raw=job_type_raw,
            job_period=facts.get("Job Period"),
            allowance=allowance,
            salary_min=salary_min,
            salary_max=salary_max,
            salary_currency=salary_currency,
            salary_period=salary_period,
            date_listed=facts.get("Date Listed"),
            posted_at=parse_listed_date(facts.get("Date Listed")),
            education=None,
            experience=facts.get("Experience Level"),
            tags=normalize_job_types(job_type_raw),
            description=description,
            apply_url=apply_url,
            raw_hash=raw_hash,
            dedup_hash=build_dedup_hash(self.config.source_id, title, company, city),
            parser_version=PARSER_VERSION,
        )

    def to_raw_item(self, html: str, url: str) -> RawJobItem:
        record = self.parse_job_detail(html, url)
        soup = BeautifulSoup(html, "html.parser")
        container = soup.select_one(".isg-detail-container")
        assert container is not None  # parse_job_detail already enforces this.
        heading = self._required_text(soup.select_one("h1.entry-title"), "heading")
        raw_text = f"{heading}\n{container.get_text(chr(10), strip=True)}"
        return RawJobItem(
            source_id=self.config.source_id,
            source_type=self.config.source_type,
            external_id=record.external_id,
            source_url=url,
            raw_text=raw_text,
            raw_html=str(container),
            raw_hash=record.raw_hash,
            known_fields=record,
            fetched_at=self._now(),
        )

    def _request(self, url: str) -> httpx.Response:
        response: httpx.Response | None = None
        for attempt in range(self.config.retry_count + 1):
            try:
                response = self.client.get(url)
            except httpx.TransportError as exc:
                if attempt == self.config.retry_count:
                    raise
                LOGGER.warning(
                    "Transport error for %s (%s); retrying %d/%d",
                    url,
                    exc,
                    attempt + 1,
                    self.config.retry_count,
                )
                self._sleep(0.5 * (attempt + 1))
                continue

            if response.status_code in {500, 502, 503, 504} and attempt < self.config.retry_count:
                LOGGER.warning(
                    "HTTP %d for %s; retrying %d/%d",
                    response.status_code,
                    url,
                    attempt + 1,
                    self.config.retry_count,
                )
                self._sleep(0.5 * (attempt + 1))
                continue
            # Do not retry 403/429: surface access control/rate limiting immediately.
            response.raise_for_status()
            return response
        assert response is not None
        response.raise_for_status()
        return response

    def _fetch_html(self, url: str) -> str:
        response = self._request(url)
        content_type = response.headers.get("content-type", "").casefold()
        if "html" not in content_type:
            raise DetailParseError(f"expected HTML, received {content_type!r}")
        return response.text

    def _ensure_robots_allowed(self, url: str) -> None:
        if not self.config.enforce_robots:
            return
        if self._robots is None:
            robots_url = f"{self.config.base_url}/robots.txt"
            parser = RobotFileParser()
            parser.set_url(robots_url)
            try:
                response = self._request(robots_url)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    parser.parse([])
                elif self.config.robots_fail_closed:
                    raise AdapterPolicyError(f"robots policy unavailable: {exc}") from exc
                else:
                    LOGGER.warning("robots policy unavailable; source policy allows fallback")
                    parser.parse([])
            except httpx.HTTPError as exc:
                if self.config.robots_fail_closed:
                    raise AdapterPolicyError(f"robots policy unavailable: {exc}") from exc
                LOGGER.warning("robots policy unavailable; source policy allows fallback")
                parser.parse([])
            else:
                parser.parse(response.text.splitlines())
            self._robots = parser
        if not self._robots.can_fetch(self.config.user_agent, url):
            raise AdapterPolicyError(f"robots.txt disallows {url}")

    def _validate_fetch_url(self, url: str, *, path_prefix: str) -> None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme != "https" or host not in self.config.allowed_hosts:
            raise AdapterPolicyError(f"URL is outside HTTPS host allowlist: {url}")
        if not parsed.path.startswith(path_prefix):
            raise AdapterPolicyError(f"URL path is outside adapter scope: {url}")

    def _batch(
        self,
        started_at: datetime,
        listing_accessible: bool,
        discovered: int,
        attempted: int,
        items: list[RawJobItem],
        failures: list[ItemFailure],
    ) -> AdapterBatch:
        status = RunStatus.SUCCEEDED
        if failures and items:
            status = RunStatus.PARTIAL
        elif failures and not items:
            status = RunStatus.FAILED
        return AdapterBatch(
            source_id=self.config.source_id,
            status=status,
            listing_accessible=listing_accessible,
            discovered_count=discovered,
            attempted_count=attempted,
            items=items,
            failures=failures,
            started_at=started_at,
            finished_at=self._now(),
        )

    @staticmethod
    def _failure(url: str, stage: str, exc: Exception) -> ItemFailure:
        retryable = isinstance(exc, (httpx.TransportError, httpx.TimeoutException))
        return ItemFailure(
            url=url,
            stage=stage,  # type: ignore[arg-type]
            error_type=type(exc).__name__,
            message=str(exc),
            retryable=retryable,
        )

    @staticmethod
    def _definition_values(soup: BeautifulSoup) -> dict[str, str]:
        values: dict[str, str] = {}
        for term in soup.select(".isg-detail-grid dt"):
            description = term.find_next_sibling("dd")
            key = term.get_text(" ", strip=True)
            value = description.get_text("\n", strip=True) if description else ""
            if key and value:
                values[key] = value
        return values

    def _link(self, node: Tag | None) -> str | None:
        if node is None or not isinstance(node.get("href"), str):
            return None
        value = urljoin(self.config.base_url, node["href"])
        parsed = urlparse(value)
        return value if parsed.scheme in {"http", "https"} and parsed.hostname else None

    @staticmethod
    def _text(node: Tag | None) -> str | None:
        if node is None:
            return None
        value = node.get_text(" ", strip=True)
        return value or None

    @classmethod
    def _required_text(cls, node: Tag | None, field_name: str) -> str:
        value = cls._text(node)
        if not value:
            raise DetailParseError(f"{field_name} not found")
        return value

    @staticmethod
    def _title_from_heading(heading: str | None, company: str | None) -> str | None:
        if not heading:
            return None
        if company:
            pattern = rf"^{re.escape(company)}\s*[-–—]\s*"
            candidate = re.sub(pattern, "", heading, count=1, flags=re.IGNORECASE)
            if candidate != heading:
                return candidate.strip() or None
        parts = re.split(r"\s+[-–—]\s+", heading, maxsplit=1)
        return parts[1].strip() if len(parts) == 2 else heading.strip() or None
