"""Reject explicitly synthetic provenance, without guessing from job titles.

This is a fixture guard, not a claim that a public URL has been verified live.
Source adapters and their stored source URL remain the provenance record.
"""

import ipaddress
from urllib.parse import urlsplit

from app.db.models import JobPosting


def is_public_http_url(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").casefold().rstrip(".")
        if parsed.scheme not in {"http", "https"} or not host or parsed.username or parsed.password:
            return False
        if host in {"localhost", "example.com", "example.net", "example.org"} or host.endswith(
            (
                ".localhost",
                ".local",
                ".test",
                ".invalid",
                ".example",
                ".example.com",
                ".example.net",
                ".example.org",
            )
        ):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return "." in host
    except ValueError:
        return False


def is_public_job(job: JobPosting) -> bool:
    """A public source and the actual posting must both have non-fixture origins."""
    if job.source.source_type.casefold() in {"mock", "sandbox"}:
        return False
    if not is_public_http_url(job.source.base_url):
        return False
    if not is_public_http_url(job.source_url or job.apply_url):
        return False
    # Some sources offer email application, so only HTTP(S) apply links carry a host.
    if job.apply_url and job.apply_url.casefold().startswith(("http:", "https:")):
        return is_public_http_url(job.apply_url)
    return True
