"""Shared test fixtures; all tests are offline."""

import json
from pathlib import Path

import pytest

from app.job_extraction.cli import load_fixture_cases
from app.job_extraction.inputs import input_from_job
from app.llm import StructuredGenerationResponse


@pytest.fixture
def jobs():
    path = Path(__file__).resolve().parent / "fixtures" / "jobs.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def job(jobs):
    return input_from_job(jobs[0])


@pytest.fixture
def cases():
    return load_fixture_cases()


@pytest.fixture
def payload(cases):
    return cases[0]["extraction"]


@pytest.fixture
def v2_payload(payload):
    # A synthetic contract fixture, not an automatic semantic migration of stored v1 results.
    return {
        "summary": payload["summary"],
        "responsibilities": [
            {**item, "priority": "unspecified", "condition": None}
            for item in payload["responsibilities"]
        ],
        "requirement_groups": [
            {
                **item,
                "importance": importance,
                "operator": "all_of",
                "requirements": [{**item, "kind": kind, "qualifier": None}],
            }
            for field, importance, kind in (
                ("required_skills", "required", "skill"),
                ("preferred_skills", "preferred", "skill"),
                ("required_qualifications", "required", "qualification"),
                ("preferred_qualifications", "preferred", "qualification"),
                ("languages", "unspecified", "language"),
            )
            for item in payload[field]
        ],
        "education": payload["education"],
        "experience": payload["experience"],
        "work_constraints": {
            "schedule": None,
            "hours": None,
            "minimum_duration": None,
            "work_modes": [],
            "locations": [],
        },
    }


@pytest.fixture
def response(v2_payload):
    return StructuredGenerationResponse(
        data=v2_payload, provider="mock", model="fixture", finish_reason="stop"
    )


@pytest.fixture
def empty_payload():
    return {
        "summary": None,
        "responsibilities": [],
        "required_skills": [],
        "preferred_skills": [],
        "required_qualifications": [],
        "preferred_qualifications": [],
        "education": {"degree": None, "fields_of_study": [], "enrollment": None},
        "experience": {"requirement": None, "minimum_years": None},
        "languages": [],
    }
