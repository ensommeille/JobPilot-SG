"""Question mapping copies existing facts; selected PDF bytes remain owner scoped."""

import asyncio
import base64
import hashlib
import io
import json
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from pydantic import ValidationError
from pypdf import PdfWriter
from sqlalchemy import select

from app.ai_recommendations.runtime import AIRuntime
from app.autofill_assistant import (
    MappingRequest,
    ResumeContentRequest,
    create_form_plan,
)
from app.core.config import get_settings
from app.db.models import ResumeDocument, User, UserProfile
from app.llm.contracts import StructuredGenerationResponse
from app.profiles.resume_models import ResumeFileContent
from tests.test_extension_auth import CLIENT, connect
from tests.test_profiles_applications_assistant import auth_headers

PAGE = "https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application"


class Provider:
    name = "mock"
    is_mock = True

    def __init__(self, data):
        self.data = data
        self.calls = []

    async def generate_structured(self, request):
        self.calls.append(request)
        return StructuredGenerationResponse(data=self.data, provider="mock", model="offline", finish_reason="stop")


def runtime_for(provider):
    @asynccontextmanager
    async def factory():
        yield provider

    return AIRuntime(provider_factory=factory, revision="offline-" + uuid4().hex)


def plan(fields, values, runtime=None, owner=None):
    payload = MappingRequest(page_url=PAGE, confirmed=True, fields=fields)
    return asyncio.run(create_form_plan(payload, {"values": values, "fingerprint": "f" * 64}, owner or uuid4().hex, runtime))


def test_existing_facts_cover_programming_languages_and_dates_without_model():
    result = plan([
        {"id": "skills", "label": "Programming languages", "kind": "text"},
        {"id": "start", "label": "Start Date of Internship", "kind": "date"},
        {"id": "arrangement", "label": "Please state part-time, full-time or any other work arrangements.", "kind": "text"},
    ], {"skills": "Python, Java", "internship_start_date": "2027-01-04", "work_arrangement": "full-time"})
    assert result["execution_mode"] == "not_needed"
    assert {row["fact_key"] for row in result["mappings"]} == {"skills", "internship_start_date", "work_arrangement"}


@pytest.mark.parametrize("label", ["Age", "Date of birth", "Do you require visa sponsorship?", "PDPA consent", "Why do you want to work here?", "Tell us something you are proud of", "Are you authorized to work in Singapore?"])
def test_personal_declarations_and_subjective_answers_are_never_mapped(label):
    provider = Provider({"mappings": []})
    result = plan([{"id": "sensitive", "label": label, "kind": "text"}], {"skills": "Python"}, runtime_for(provider))
    assert result["mappings"] == [] and provider.calls == []


@pytest.mark.parametrize("label", ["Highest degree", "Highest completed education", "Degree completed", "Awarded qualification"])
def test_in_progress_degree_does_not_answer_completion_questions(label):
    provider = Provider({"mappings": []})
    result = plan([{"id": "degree", "label": label, "kind": "text"}],
                  {"degree": "M.Tech."}, runtime_for(provider))
    assert result["mappings"] == [] and provider.calls == []


def test_work_preference_does_not_match_references_guard():
    provider = Provider({"mappings": [{"field_id": "arrangement", "fact_key": "work_arrangement",
                                      "question_quote": "Preferred work preference"}]})
    result = plan([{"id": "arrangement", "label": "Preferred work preference", "kind": "text"}],
                  {"work_arrangement": "full-time"}, runtime_for(provider))
    assert result["mappings"][0]["fact_key"] == "work_arrangement" and len(provider.calls) == 1


def test_unknown_mapping_uses_only_keys_not_contact_or_resume_and_reuses_same_owner_preview():
    provider = Provider({"mappings": [{"field_id": "contact", "fact_key": "email", "question_quote": "Best electronic contact"}]})
    runtime = runtime_for(provider)
    fields = [{"id": "contact", "label": "Best electronic contact", "kind": "text"}]
    owner = uuid4().hex
    result = plan(fields, {"email": "private@example.com"}, runtime, owner)
    assert result["mappings"] == [{"field_id": "contact", "fact_key": "email", "source": "model"}]
    sent = json.loads(provider.calls[0].messages[-1].content)
    assert sent["purpose"] == "form_mapping" and "email" in sent["fact_definitions"]
    assert "private@example.com" not in json.dumps(sent) and "resume" not in sent
    assert plan(fields, {"email": "private@example.com"}, runtime, owner)["reused"] is True
    assert len(provider.calls) == 1
    assert plan(fields, {"email": "private@example.com"}, runtime, uuid4().hex)["reused"] is False
    assert len(provider.calls) == 2


@pytest.mark.parametrize("mapping", [
    {"field_id": "other", "fact_key": "email", "question_quote": "Best electronic contact"},
    {"field_id": "contact", "fact_key": "invented", "question_quote": "Best electronic contact"},
    {"field_id": "contact", "fact_key": "email", "question_quote": "Different question"},
    {"field_id": "contact", "fact_key": "email", "question_quote": "Best electronic contact", "answer": "made up"},
])
def test_invalid_model_maps_fail_closed_and_are_not_automatically_retried(mapping):
    provider = Provider({"mappings": [mapping]})
    runtime = runtime_for(provider)
    fields = [{"id": "contact", "label": "Best electronic contact", "kind": "text"}]
    owner = uuid4().hex
    result = plan(fields, {"email": "private@example.com"}, runtime, owner)
    assert result["mappings"] == [] and result["error_code"] == "form_mapping_failed"
    assert plan(fields, {"email": "private@example.com"}, runtime, owner)["reused"] is True
    assert len(provider.calls) == 1


def test_no_known_answer_and_manual_only_never_reach_the_model():
    provider = Provider({"mappings": []})
    runtime = runtime_for(provider)
    result = plan([{"id": "school", "label": "School", "kind": "text"}], {}, runtime)
    assert result["mappings"] == []
    result = plan([{"id": "x", "label": "Explain this", "kind": "text", "manualOnly": True}], {"email": "x@example.com"}, runtime)
    assert result["mappings"] == [] and provider.calls == []


@pytest.mark.parametrize("confirmed", [False, 1, "true", None])
def test_explicit_actions_reject_coerced_confirmation(confirmed):
    with pytest.raises(ValidationError):
        MappingRequest(page_url=PAGE, confirmed=confirmed, fields=[{"id": "x", "label": "Name", "kind": "text"}])
    with pytest.raises(ValidationError):
        ResumeContentRequest(page_url=PAGE, confirmed=confirmed, resume_id=str(uuid4()), sha256="a" * 64)


def _pdf(db, user):
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    data = io.BytesIO()
    writer.write(data)
    raw = data.getvalue()
    doc = ResumeDocument(profile_id=profile.id, filename="offline-resume.pdf", storage_key=uuid4().hex,
                         content_type="application/pdf", size_bytes=len(raw))
    db.add(doc)
    db.flush()
    digest = hashlib.sha256(raw).hexdigest()
    db.add(ResumeFileContent(resume_id=doc.id, content=raw, sha256=digest,
                            extraction_status="parsed", page_count=1, text="Offline fixture", suggestions={}))
    db.commit()
    return doc, digest, raw


def test_selected_owned_pdf_can_be_reused_without_exposing_general_file_access(client, db, monkeypatch):
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])
    owner = auth_headers(client, "autofill-owner@example.com")
    other = auth_headers(client, "autofill-other@example.com")
    client.get("/profile", headers=owner)
    client.get("/profile", headers=other)
    users = {u.email: u for u in db.scalars(select(User))}
    doc, digest, raw = _pdf(db, users["autofill-owner@example.com"])
    restricted, _ = connect(client, owner)
    selected = client.patch("/profile/autofill-details", headers=owner, json={"resume_id": str(doc.id)})
    assert selected.status_code == 200
    payload = {"page_url": PAGE, "resume_id": str(doc.id), "sha256": digest, "confirmed": True}
    result = client.post("/browser-assistant/resume-content", headers=restricted, json=payload)
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert base64.b64decode(result.json()["base64"]) == raw
    assert result.json()["page_url"] == PAGE
    assert client.get("/profile/resumes", headers=restricted).status_code == 401
    assert client.get(f"/profile/resumes/{doc.id}/content", headers=restricted).status_code == 401
    assert client.post("/browser-assistant/resume-content", headers=other, json=payload).status_code == 409
    assert client.post("/browser-assistant/resume-content", headers=restricted, json={**payload, "sha256": "b" * 64}).status_code == 409
    assert client.post("/browser-assistant/resume-content", headers=restricted, json={**payload, "page_url": PAGE + "?evil=1"}).status_code == 422
    assert client.post("/browser-assistant/resume-content", headers=restricted, json={**payload, "resume_id": str(uuid4())}).status_code == 409
    client.delete(f"/profile/resumes/{doc.id}", headers=owner)
    assert client.post("/browser-assistant/resume-content", headers=restricted, json=payload).status_code == 409


def test_fact_profile_requires_auth_and_respects_owner(client):
    assert client.get("/browser-assistant/autofill-profile").status_code == 401
    owner = auth_headers(client, "facts-owner@example.com")
    other = auth_headers(client, "facts-other@example.com")
    client.put("/profile", headers=owner, json={"given_name": "Avery", "family_name": "Ng"})
    mine = client.get("/browser-assistant/autofill-profile", headers=owner)
    assert mine.status_code == 200 and mine.headers["cache-control"] == "no-store"
    assert mine.json()["values"]["given_name"] == "Avery"
    assert "given_name" not in client.get("/browser-assistant/autofill-profile", headers=other).json()["values"]
