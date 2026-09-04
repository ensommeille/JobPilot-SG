"""Source Adapter contract used by the ingestion orchestrator."""

from __future__ import annotations

from abc import ABC, abstractmethod

try:  # Package import for the backend; fallback preserves `python scraper.py`.
    from .models import AdapterBatch, SourceConfig
except ImportError:  # pragma: no cover - exercised by CLI smoke tests
    from models import AdapterBatch, SourceConfig


class SourceAdapter(ABC):
    """All HTML/RSS/mock sources must satisfy this stable boundary."""

    @property
    @abstractmethod
    def config(self) -> SourceConfig:
        """Return immutable source identity and crawl policy."""

    @abstractmethod
    def collect(self, *, max_links: int, max_details: int) -> AdapterBatch:
        """Collect raw items without DB, LLM, scheduler, or audit side effects."""
