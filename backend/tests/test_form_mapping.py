"""Offline M4 mapping rules, LLM contract, privacy and API integration tests."""

from __future__ import annotations

import asyncio
import json
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.assistant.gateway import LiveFormMappingGateway, get_form_mapping_gateway
from app.assistant.mapping import ProfileFormMappingService
from app.assistant.schemas import FormSnapshotField
from app.demo_seed import seed_demo
from app.llm.contracts import (
    InvalidStructuredOutputError,
    LLMProviderError,
    ProviderAuthenticationError,
    ProviderCapabilityError,
    ProviderRateLimitError,
    ProviderTimeoutError,
    StructuredGenerationResponse,
)
from app.llm.mock import MockProvider
from app.main import app


def field(field_id: str, label: str, kind: str = "text", **kwargs: Any) -> FormSnapshotField:
    return FormSnapshotField.model_validate(
        {"field_id": field_id, "label": label, "type": kind, **kwargs}
    )


def response(
    field_id: str, value: str | None, confidence: float = 0.8, **extra: Any
) -> StructuredGenerationResponse:
    data = {"field_id": field_id, "value": value, "confidence": confidence, "needs_review": False}
    data.update(extra)
    return StructuredGenerationResponse(
        data=data, provider="mock", model="fixture", finish_reason="stop"
    )


def run(
    fields: list[FormSnapshotField], profile: dict[str, Any], provider: MockProvider | None = None
):
    service = ProfileFormMappingService(provider_factory=(lambda: provider) if provider else None)
    return asyncio.run(service.map_fields(form_snapshot=fields, profile_data=profile))


def test_direct_name_email_phone_links_education_and_skills_do_not_call_llm() -> None:
    provider = MockProvider([])
    draft = run(
        [
            field("f1", "Full Name"),
            field("f2", "Email Address", "email"),
            field("f3", "Phone Number", "tel"),
            field("f4", "LinkedIn Profile URL", "url"),
            field("f5", "Education", "textarea"),
            field("f6", "Relevant Skills"),
        ],
        {
            "full_name": "Lin Xinda",
            "contact_email": "xinda@example.test",
            "phone": "+65 8123 4567",
            "links": {"LinkedIn": "https://linkedin.com/in/xinda"},
            "education": "MTech Software Engineering",
            "skills": ["Python", "SQL"],
        },
        provider,
    )
    assert [item.value for item in draft.mapping] == [
        "Lin Xinda",
        "xinda@example.test",
        "+65 8123 4567",
        "https://linkedin.com/in/xinda",
        "MTech Software Engineering",
        "Python, SQL",
    ]
    assert all(item.confidence == 0.95 and not item.needs_review for item in draft.mapping)
    assert provider.requests == []


def test_missing_profile_and_unsupported_fields_are_not_guessed() -> None:
    draft = run(
        [
            field("name", "Candidate Name"),
            field("salary", "Expected Salary"),
            field("degree", "Degree"),
            field("nationality", "Nationality"),
        ],
        {"education": "University graduate"},
    )
    assert draft.mapping == []
    assert draft.unmapped_fields == ["name", "salary", "degree", "nationality"]
    assert draft.missing_profile_fields == ["full_name", "education.degree"]


def test_exact_context_can_identify_field_but_incidental_context_cannot() -> None:
    draft = run(
        [
            field("actual", "Your answer", context="Full name"),
            field("incidental", "Reference contact", context="A full name may be needed later"),
        ],
        {"full_name": "Lin Xinda"},
    )
    assert [item.field_id for item in draft.mapping] == ["actual"]
    assert draft.unmapped_fields == ["incidental"]


def test_semantic_question_calls_provider_with_only_relevant_evidence() -> None:
    provider = MockProvider([response("why", "I enjoy building reliable software.", 0.98)])
    draft = run(
        [field("why", "Why are you interested in this role?", "textarea")],
        {
            "full_name": "Private Person",
            "phone": "PRIVATE_PHONE",
            "contact_email": "private@example.test",
            "links": {"github": "https://example.test/private"},
            "education": "Software engineering student",
            "experience": "Python API coursework",
            "skills": ["Python"],
        },
        provider,
    )
    assert len(provider.requests) == 1
    request = provider.requests[0]
    assert request.schema_name == "form_field_draft"
    # The live DeepSeek flash smoke test exhausted the former 600-token budget.
    assert request.max_output_tokens >= 2048
    assert request.output_schema["required"] == ["field_id", "value", "confidence", "needs_review"]
    payload = json.loads(request.messages[1].content)
    assert set(payload["profile_evidence"]) == {"education", "experience", "skills"}
    assert "PRIVATE_PHONE" not in request.messages[1].content
    assert "private@example.test" not in request.messages[1].content
    assert "Private Person" not in request.messages[1].content
    assert draft.mapping[0].confidence == 0.79
    assert draft.mapping[0].needs_review is True


@pytest.mark.parametrize(
    "bad_data",
    [
        {"field_id": "why", "value": 5, "confidence": 0.8, "needs_review": True},
        {
            "field_id": "why",
            "value": "answer",
            "confidence": 0.8,
            "needs_review": True,
            "extra": "x",
        },
        {"field_id": "unknown", "value": "answer", "confidence": 0.8, "needs_review": True},
        {"field_id": "why", "value": "answer", "confidence": -0.5, "needs_review": True},
    ],
)
def test_invalid_business_output_falls_back_to_manual(bad_data: dict[str, Any]) -> None:
    provider = MockProvider(
        [
            StructuredGenerationResponse(
                data=bad_data, provider="mock", model="fixture", finish_reason="stop"
            )
        ]
    )
    draft = run([field("why", "Why us?", "textarea")], {"skills": ["Python"]}, provider)
    assert draft.mapping == []
    assert draft.unmapped_fields == ["why"]


@pytest.mark.parametrize(
    "failure",
    [
        ProviderAuthenticationError("secret"),
        ProviderRateLimitError("secret"),
        ProviderTimeoutError("secret"),
        ProviderCapabilityError("secret"),
        InvalidStructuredOutputError("invalid JSON"),
        LLMProviderError("secret"),
    ],
)
def test_all_provider_failures_preserve_direct_fields(failure: Exception) -> None:
    provider = MockProvider([failure])
    draft = run(
        [field("name", "Full Name"), field("why", "Why us?", "textarea")],
        {"full_name": "Lin Xinda", "skills": ["Python"]},
        provider,
    )
    assert [item.field_id for item in draft.mapping] == ["name"]
    assert draft.unmapped_fields == ["why"]


def test_no_provider_and_no_evidence_are_manual_fallback() -> None:
    no_provider = run([field("why", "Why us?", "textarea")], {"skills": ["Python"]})
    no_evidence = run([field("why", "Why us?", "textarea")], {})
    assert no_provider.unmapped_fields == ["why"]
    assert no_provider.missing_profile_fields == []
    assert no_evidence.unmapped_fields == ["why"]
    assert no_evidence.missing_profile_fields == ["education/experience/skills"]


def test_provider_cleanup_failure_does_not_discard_mapping() -> None:
    class FailingCloseProvider(MockProvider):
        async def aclose(self) -> None:
            raise OSError("cleanup failed")

    provider = FailingCloseProvider([response("why", "I enjoy Python development.")])
    draft = run([field("why", "Why us?", "textarea")], {"skills": ["Python"]}, provider)
    assert draft.mapping[0].field_id == "why"


def test_duplicate_field_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match="unique"):
        run([field("name", "Full Name"), field("name", "Email")], {})


def test_select_value_must_match_option_exactly() -> None:
    draft = run(
        [field("school", "School", "select", options=["NUS", "NTU"])],
        {"education": {"school": "Other University"}},
    )
    assert draft.mapping == []
    assert draft.unmapped_fields == ["school"]


def test_production_gateway_without_key_is_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    gateway = LiveFormMappingGateway()
    draft = gateway.map_fields(
        form_snapshot=[field("name", "Full Name"), field("why", "Why us?", "textarea")],
        profile_data={"full_name": "Lin Xinda", "skills": ["Python"]},
    )
    assert [item.field_id for item in draft.mapping] == ["name"]
    assert draft.unmapped_fields == ["why"]


def test_demo_bootstrap_map_confirm_persist_history_with_real_gateway(
    client: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # MockProvider exercises the concrete M4 gateway and M2 persistence, without a paid call.
    provider = MockProvider(
        [
            response("experience", "I developed and tested Python APIs.", 0.67),
            response("motivation", "I want to apply my Python skills to this role.", 0.71),
        ]
    )
    monkeypatch.setattr("app.assistant.gateway.build_live_provider", lambda: provider)
    seed_demo(
        db,
        admin_email="demo@example.com",
        admin_password="demo-password-123",
        today=date(2026, 9, 27),
    )
    registration = client.post(
        "/auth/register", json={"email": "applicant@example.com", "password": "test-password-123"}
    )
    assert registration.status_code == 201
    login = client.post(
        "/auth/login", json={"email": "applicant@example.com", "password": "test-password-123"}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    updated = client.put(
        "/profile",
        headers=headers,
        json={
            "full_name": "Lin Xinda",
            "contact_email": "applicant@example.com",
            "education": "MTech Software Engineering",
            "experience": "Python API coursework",
            "skills": ["Python", "SQL"],
        },
    )
    assert updated.status_code == 200
    bootstrap = client.get("/assistant/bootstrap").json()
    form_id = bootstrap["forms"][0]["id"]
    job_id = bootstrap["forms"][0]["job_id"]
    assert client.get(f"/jobs/{job_id}").status_code == 200
    snapshot = client.get(f"/assistant/forms/{form_id}").json()["fields_json"]
    mapped = client.post(
        "/assistant/map-fields",
        headers=headers,
        json={"form_id": form_id, "form_snapshot": snapshot},
    )
    assert mapped.status_code == 200
    draft = mapped.json()
    assert [item["field_id"] for item in draft["mapping"]] == [
        "full_name",
        "contact_email",
        "education",
        "experience",
        "motivation",
    ]
    assert all(item["needs_review"] for item in draft["mapping"][3:])
    assert len(provider.requests) == 2
    persisted = client.post(
        "/assistant/applications",
        headers=headers,
        json={
            "job_id": job_id,
            "form_id": form_id,
            "mapping_version": "mapping-v1",
            "provider": "mock",
            "prompt_version": "form-mapping-v1",
            "mapping_draft": draft,
            "confirmed_field_ids": [item["field_id"] for item in draft["mapping"]],
        },
    )
    assert persisted.status_code == 201
    mapping_id = persisted.json()["mapping"]["id"]
    assert client.get(f"/assistant/mappings/{mapping_id}", headers=headers).status_code == 200
    history = client.get("/applications", headers=headers).json()
    assert history["total"] == 1
    assert history["items"][0]["job"]["id"] == job_id
    assert app.dependency_overrides.get(get_form_mapping_gateway) is None
