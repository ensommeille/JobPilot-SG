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
def response(payload):
    return StructuredGenerationResponse(
        data=payload, provider="mock", model="fixture", finish_reason="stop"
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
