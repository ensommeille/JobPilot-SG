"""Public application assistance hints, never authorization or form-readiness claims."""

import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlsplit

ApplicationAssistance = Literal[
    "internsg_extension", "ats_extension", "manual_external", "unavailable"
]


def safe_https_url(value: str | None) -> str | None:
    if not value or any(ord(char) <= 32 or ord(char) == 127 for char in value) or "\\" in value:
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
            or "." not in parsed.hostname
        ):
            return None
        hostname = parsed.hostname.encode("idna").decode("ascii")
        if len(hostname) > 253 or any(
            not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
            for label in hostname.split(".")
        ):
            return None
    except (ValueError, UnicodeError):
        return None
    return value


def supported_application_type(value: str) -> Literal["internsg", "ats"] | None:
    """Match the same exact canonical pages used by the authenticated assistant."""
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.fragment:
            return None
        internsg = (
            parsed.netloc in {"www.internsg.com", "internsg.com"}
            and bool(re.fullmatch(r"/job-apply/[0-9]+/?", parsed.path))
            and not parsed.query
        )
        greenhouse_path = re.fullmatch(r"/[A-Za-z0-9_-]+/jobs/([0-9]+)/?", parsed.path)
        greenhouse = (
            parsed.netloc in {
                "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io", "boards.greenhouse.io"
            }
            and bool(greenhouse_path)
            and (not parsed.query or parsed.query == f"gh_jid={greenhouse_path.group(1)}")
        )
        lever = (
            parsed.netloc in {"jobs.lever.co", "jobs.eu.lever.co"}
            and bool(re.fullmatch(r"/[A-Za-z0-9_-]+/[A-Za-z0-9-]+/apply/?", parsed.path))
            and not parsed.query
        )
        ashby = (
            parsed.netloc == "jobs.ashbyhq.com"
            and bool(re.fullmatch(
                r"/[A-Za-z0-9_-]+/[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}/application/?",
                parsed.path,
            ))
            and not parsed.query
        )
    except ValueError:
        return None
    return "internsg" if internsg else "ats" if greenhouse or lever or ashby else None


def application_assistance(
    apply_url: str | None, *, status: str, deadline: date | None, today: date | None = None
) -> ApplicationAssistance:
    current_day = today or datetime.now(timezone(timedelta(hours=8))).date()
    if status != "active" or (deadline is not None and deadline < current_day):
        return "unavailable"
    if not safe_https_url(apply_url):
        return "unavailable"
    supported = supported_application_type(apply_url)
    if supported == "internsg":
        return "internsg_extension"
    if supported == "ats":
        return "ats_extension"
    return "manual_external"
