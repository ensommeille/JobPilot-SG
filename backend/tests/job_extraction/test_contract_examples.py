"""Keep handoff artifacts synchronized with the executable contract."""

import json
from pathlib import Path

from app.job_extraction.models import JobExtractionSchema
from app.job_extraction.prompts import build_messages
from app.llm import StructuredGenerationRequest

EXAMPLES = Path(__file__).resolve().parents[3] / "docs" / "member3" / "examples"


def test_exported_json_schema_is_current():
    schema = json.loads((EXAMPLES / "job_extraction.schema.json").read_text(encoding="utf-8"))
    assert schema == JobExtractionSchema.model_json_schema()


def test_exported_request_is_current(job):
    data = json.loads((EXAMPLES / "provider_request.json").read_text(encoding="utf-8"))
    request = StructuredGenerationRequest.model_validate(data)
    assert request.messages == build_messages(job)
    assert request.output_schema == JobExtractionSchema.model_json_schema()
