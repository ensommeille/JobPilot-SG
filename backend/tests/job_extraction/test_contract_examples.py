"""Keep handoff artifacts synchronized with the executable contract."""

import json
from pathlib import Path

from app.job_extraction.models import JobExtractionSchema, JobExtractionSchemaV2
from app.job_extraction.prompts import build_messages
from app.llm import StructuredGenerationRequest

EXAMPLES = Path(__file__).resolve().parents[3] / "docs" / "member3" / "examples"


def test_exported_json_schema_is_current():
    schema = json.loads((EXAMPLES / "job_extraction.schema.json").read_text(encoding="utf-8"))
    assert schema == JobExtractionSchemaV2.model_json_schema()


def test_exported_legacy_schema_remains_current():
    schema = json.loads((EXAMPLES / "job_extraction.v1.schema.json").read_text(encoding="utf-8"))
    assert schema == JobExtractionSchema.model_json_schema()


def test_exported_request_is_current(job):
    data = json.loads((EXAMPLES / "provider_request.json").read_text(encoding="utf-8"))
    request = StructuredGenerationRequest.model_validate(data)
    assert request.messages == build_messages(job)
    assert request.output_schema == JobExtractionSchemaV2.model_json_schema()


def test_exported_legacy_request_retains_its_contract(job):
    data = json.loads((EXAMPLES / "provider_request.v1.json").read_text(encoding="utf-8"))
    request = StructuredGenerationRequest.model_validate(data)
    assert request.messages == build_messages(job, schema_version="job-extraction-v1")
    assert request.schema_name == "job_extraction_v1"
    assert request.output_schema == JobExtractionSchema.model_json_schema()
