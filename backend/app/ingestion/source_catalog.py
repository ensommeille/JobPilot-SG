"""Reviewed public source definitions; importing this module does no network or DB work.

Intervals are defaults for the explicit opt-in scheduler, not an instruction to
start it. ATS providers and employer boards remain separate identities.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import SourceType


@dataclass(frozen=True)
class SourceCatalogEntry:
    key: str
    name: str
    source_type: SourceType
    base_url: str
    interval_hours: int
    max_links: int = 20
    max_details: int = 20


DEFAULT_SOURCE_CATALOG: tuple[SourceCatalogEntry, ...] = (
    SourceCatalogEntry(
        "ashby-blocktech",
        "BlockTech",
        SourceType.JSON,
        "https://api.ashbyhq.com/posting-api/job-board/blocktech",
        6,
    ),
    SourceCatalogEntry(
        "ashby-cantina",
        "Cantina",
        SourceType.JSON,
        "https://api.ashbyhq.com/posting-api/job-board/cantina",
        6,
    ),
    SourceCatalogEntry(
        "greenhouse-straitsx",
        "StraitsX",
        SourceType.JSON,
        "https://boards-api.greenhouse.io/v1/boards/straitsx",
        6,
    ),
    SourceCatalogEntry(
        "greenhouse-graviton",
        "Graviton Research Capital - Campus",
        SourceType.JSON,
        "https://boards-api.greenhouse.io/v1/boards/globalcampus",
        6,
    ),
    SourceCatalogEntry(
        "greenhouse-stripe",
        "Stripe",
        SourceType.JSON,
        "https://boards-api.greenhouse.io/v1/boards/stripe",
        6,
    ),
    SourceCatalogEntry(
        "lever-csit",
        "CSIT",
        SourceType.JSON,
        "https://api.lever.co/v0/postings/csit",
        6,
    ),
    SourceCatalogEntry(
        "lever-shopback",
        "ShopBack",
        SourceType.JSON,
        "https://api.lever.co/v0/postings/shopback-2",
        6,
    ),
    SourceCatalogEntry(
        "internsg",
        "InternSG",
        SourceType.HTML,
        "https://www.internsg.com/jobs/",
        24,
        max_links=10,
        max_details=5,
    ),
)


def catalog_source(key: str) -> SourceCatalogEntry:
    """Resolve an explicit reviewed source key without fetching anything."""
    for entry in DEFAULT_SOURCE_CATALOG:
        if entry.key == key:
            return entry
    raise ValueError(f"Unknown catalog source: {key}")
