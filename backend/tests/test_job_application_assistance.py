"""Public capabilities cannot claim a connection or invent an application URL."""

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.browser_assistant import ATSEvidenceRequest, DraftRequest
from app.jobs.application_channels import application_assistance, supported_application_type
from app.jobs.schemas import JobRead


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://www.internsg.com/job-apply/123/", "internsg_extension"),
        ("https://internsg.com/job-apply/123", "internsg_extension"),
        ("https://job-boards.greenhouse.io/example/jobs/123", "ats_extension"),
        ("https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101", "ats_extension"),
        ("https://boards.greenhouse.io/example/jobs/123?gh_jid=123", "ats_extension"),
        ("https://jobs.lever.co/example/role-123/apply", "ats_extension"),
        ("https://jobs.eu.lever.co/example/role-123/apply/", "ats_extension"),
        ("https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application", "ats_extension"),
    ],
)
def test_public_hint_and_authenticated_adapter_use_same_exact_pages(url, expected):
    assert DraftRequest(page_url=url, field_ids=["applicant_name"]).page_url == url
    assert application_assistance(url, status="active", deadline=None) == expected
    if expected == "ats_extension":
        assert ATSEvidenceRequest(page_url=url, evidence_keys=["linkedin"]).page_url == url


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://job-boards.greenhouse.io.evil.example/example/jobs/123", "manual_external"),
        ("https://job-boards.eu.greenhouse.io.evil.example/example/jobs/123", "manual_external"),
        ("https://job-boards.eu.greenhouse.io/example/jobs/123?gh_jid=456", "manual_external"),
        ("https://boards.greenhouse.io/example/jobs/123?gh_jid=456", "manual_external"),
        ("https://jobs.lever.co/example/role-123", "manual_external"),
        ("https://jobs.ashbyhq.com.evil.example/board/dec35151-7bee-45ae-b088-a04986145d93/application", "manual_external"),
        ("https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application?fake=1", "manual_external"),
        ("https://jobs.ashbyhq.com/goventi/not-a-uuid/application", "manual_external"),
        ("https://jobs.example.com/application", "manual_external"),
        ("https://www.internsg.com/job/example-role/", "manual_external"),
        ("https://user:password@jobs.lever.co/example/role/apply", "unavailable"),
        ("http://www.internsg.com/job-apply/123/", "unavailable"),
        ("javascript:alert(1)", "unavailable"),
        ("https://www.internsg.com\\@evil.example/job-apply/123", "unavailable"),
    ],
)
def test_near_matches_never_claim_supported_filling(url, expected):
    assert supported_application_type(url) is None
    with pytest.raises(ValidationError):
        DraftRequest(page_url=url, field_ids=["applicant_name"])
    assert application_assistance(url, status="active", deadline=None) == expected


def test_closed_incomplete_or_expired_jobs_do_not_offer_filling():
    url = "https://www.internsg.com/job-apply/123/"
    today = date(2026, 10, 24)
    for status in ("closed", "incomplete"):
        assert application_assistance(url, status=status, deadline=None, today=today) == "unavailable"
    assert application_assistance(
        url, status="active", deadline=date(2026, 10, 23), today=today
    ) == "unavailable"
    assert application_assistance(
        url, status="active", deadline=today, today=today
    ) == "internsg_extension"


def test_public_hint_is_derived_and_contains_no_account_or_connection_claim():
    now = datetime.now(UTC)
    payload = {
        "id": uuid4(), "external_id": "example", "title": "Example role", "company": "Example",
        "city": "Singapore", "salary_min": None, "salary_max": None,
        "salary_currency": None, "salary_period": None, "education": None, "experience": None,
        "job_type": "internship", "description": "An example job description.",
        "apply_url": "https://jobs.example.com/application", "source_url": None,
        "posted_at": None, "deadline": None, "status": "active", "assistant_form_available": False,
        "source": {"id": uuid4(), "name": "Example source", "source_type": "json",
                   "base_url": "https://jobs.example.com"},
        "tags": [], "created_at": now, "updated_at": now,
        "application_assistance": "ats_extension",
    }
    data = JobRead.model_validate(payload).model_dump(mode="json")
    assert data["application_assistance"] == "manual_external"
    assert not {"profile", "user_id", "connected", "extension_id", "token"} & set(data)
