"""No-network application drafts: exact sources, persistent caching and one call."""

import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from copy import deepcopy
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.ai_recommendations.runtime import AIRuntime
from app.answer_preparation.models import AnswerPreparation
from app.answer_preparation.schemas import AnswerChoice, AnswerField, FieldAnswer, SelectedDraft
from app.answer_preparation.service import WARM_FIELDS, _draft, _question_answer, prepare_answers
from app.autofill_assistant import get_form_plan_runtime
from app.core.config import get_settings
from app.db.base import Base
from app.db.models import JobPosting, JobSource, User, UserProfile
from app.llm import StructuredGenerationResponse
from app.main import app
from app.profiles.autofill_facts import build_autofill_profile
from tests.test_autofill_facts import seed_pdf
from tests.test_extension_auth import CLIENT, connect
from tests.test_profiles_applications_assistant import auth_headers

PAGE = "https://job-boards.greenhouse.io/fictional-qa/jobs/123"
SOURCE = ("Name: Avery Ng\nEmail: avery@example.com\nPhone: +65 8123 4567\nEducation\n"
          "Northern Institute — M.Tech. Software Engineering 2026 – Present\nProjects\n"
          "Built a course planner using Python and SQLite.\nSkills\nPython, SQL\n")
PROFILE = {"full_name": "Avery Ng", "contact_email": "avery@example.com", "skills": ["Python", "SQL"],
           "education": "Northern Institute — M.Tech. Software Engineering 2026 – Present",
           "experience": "Built a course planner using Python and SQLite."}


def seed_job(db, page=PAGE):
    source = JobSource(name="Fictional preparation fixtures", source_type="mock", base_url="https://example.test")
    db.add(source)
    db.flush()
    job = JobPosting(source_id=source.id, external_id=uuid4().hex, title="Fictional software internship",
                     company="Fictional QA", description="Build useful software tools with Python.",
                     apply_url=page, dedup_hash=uuid4().hex * 2, raw_hash="a" * 64, status="active")
    db.add(job)
    db.commit()
    return job


class Provider:
    is_mock = True

    def __init__(self):
        self.calls = []
        self.change = None
        self.delay = 0
        self.entered = self.release = None

    async def generate_structured(self, request):
        self.calls.append(request)
        if self.entered:
            self.entered.set()
            assert await asyncio.to_thread(self.release.wait, 5)
        if self.delay:
            await asyncio.sleep(self.delay)
        data = json.loads(request.messages[-1].content)
        profile = [row for row in data["source_catalog"] if row["source"] != "job"]
        experience = [row for row in profile if row["field"] == "experience"]
        jobs = [row for row in data["source_catalog"] if row["source"] == "job"]
        result = {"mappings": [], "drafts": [], "field_answers": []}
        question_profiles = [row for row in data["question_source_catalog"] if row["source"] != "job"]
        question_experience = [row for row in question_profiles if row["field"] == "experience"]
        question_jobs = [row for row in data["question_source_catalog"] if row["source"] == "job"]
        for field in data["fields"]:
            label = field["label"].casefold()
            item = {"field_id": field["id"], "disposition": "missing", "fact_key": None, "excerpts": []}
            if "contact" in label:
                item.update(disposition="saved_fact", fact_key="email")
            elif any(word in label for word in ("intro", "summary", "yourself", "additional information", "project", "experience", "why", "cover letter")) and question_profiles:
                selected = (question_experience or question_profiles)[0]
                item.update(disposition="resume_evidence", excerpts=[{"source_id": selected["source_id"], "text": selected["quote"]}])
                if ("why" in label or "cover letter" in label) and question_jobs:
                    item["disposition"] = "role_connection"
                    item["excerpts"].append({"source_id": question_jobs[0]["source_id"], "text": question_jobs[0]["quote"]})
            result["field_answers"].append(item)
        for kind in data["draft_kinds"]:
            selected = experience if kind in {"experience", "motivation"} else profile
            if selected and (kind != "motivation" or jobs):
                result["drafts"].append({"kind": kind, "profile_source_ids": [selected[0]["source_id"]],
                                         "job_source_ids": [jobs[0]["source_id"]] if kind == "motivation" else []})
        if self.change:
            result = self.change(result, data)
        return StructuredGenerationResponse(data=result, provider="mock", model="offline-plan", finish_reason="stop")


def runtime_for(provider, **kwargs):
    @asynccontextmanager
    async def factory():
        yield provider
    return AIRuntime(provider_factory=factory, **kwargs)


@pytest.fixture
def prepared_context(client, db):
    headers = auth_headers(client, "answer-fixture@example.com")
    client.put("/profile", headers=headers, json=PROFILE)
    user = db.scalar(select(User))
    document, file = seed_pdf(db, user, content=SOURCE)
    job = seed_job(db)
    provider = Provider()
    original = app.dependency_overrides.get(get_form_plan_runtime)
    app.dependency_overrides[get_form_plan_runtime] = lambda: runtime_for(provider)
    yield headers, user, document, file, job, provider
    if original is None:
        app.dependency_overrides.pop(get_form_plan_runtime, None)
    else:
        app.dependency_overrides[get_form_plan_runtime] = original


def post(client, db, context, fields=None, **changes):
    headers, user, _doc, _file, job, _provider = context
    payload = {"confirmed": True, "page_url": job.apply_url,
               "profile_fingerprint": build_autofill_profile(db, user)["fingerprint"],
               "fields": fields or [field.model_dump() for field in WARM_FIELDS]}
    payload.update(changes)
    return client.post("/browser-assistant/prepare-answers", headers=headers, json=payload)


def test_saved_facts_return_without_provider_or_cache_write(client, db, prepared_context):
    response = post(client, db, prepared_context, [{"id": "name", "label": "Full name", "kind": "text"}])
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["status"] == "ready" and result["execution_mode"] == "not_needed"
    assert result["answers"][0]["value"] == "Avery Ng" and result["answers"][0]["source"] == "saved"
    assert not prepared_context[-1].calls
    assert db.scalar(select(func.count()).select_from(AnswerPreparation)) == 0


def test_explicit_internship_period_copies_saved_availability_without_dates_or_model(client, db, prepared_context):
    availability = "Mid-October through mid-January; exact dates to be agreed"
    assert client.patch("/profile", headers=prepared_context[0],
                        json={"availability_period": availability}).status_code == 200
    result = post(client, db, prepared_context, [{"id": "period", "label": "Please indicate internship period*",
                                                "kind": "text", "maxLength": 255}]).json()
    assert result["answers"][0]["value"] == availability
    assert result["answers"][0]["fact_key"] == "availability"
    assert result["answers"][0]["source"] == "saved"
    assert not prepared_context[-1].calls
    assert db.scalar(select(func.count()).select_from(AnswerPreparation)) == 0


@pytest.mark.parametrize("label", ["Please indicate internship start date*", "Please indicate internship end date*",
                                  "Please indicate internship period and work permit status*"])
def test_internship_period_alias_does_not_guess_other_dates_or_declarations(label):
    from app.autofill_assistant import _rule_key
    assert _rule_key(label) != "availability"


@pytest.mark.parametrize("profile_lengths,job_lengths", [([213, 366, 171], [95, 81]), ([213, 232], [222, 251])])
def test_whole_source_budget_keeps_mandatory_evidence_and_drops_only_optional_complete_passages(profile_lengths, job_lengths):
    catalog = {}
    for source, lengths in (("profile", profile_lengths), ("job", job_lengths)):
        for index, length in enumerate(lengths):
            key = f"{source}.{index}"
            prefix = f"Built a fictional project {index}. " if source == "profile" else f"Role duty {index}. "
            catalog[key] = {"source": source, "field": "experience" if source == "profile" else "description",
                            "source_id": key, "quote": prefix + "x" * (length - len(prefix))}
    plan = SelectedDraft(kind="motivation", profile_source_ids=[f"profile.{i}" for i in range(len(profile_lengths))],
                         job_source_ids=[f"job.{i}" for i in range(len(job_lengths))])
    before_plan, before_catalog = deepcopy(plan), deepcopy(catalog)
    result = _draft(plan, catalog)
    quotes = [item["quote"] for item in result["citations"]]
    assert len(" ".join(quotes)) <= 700 and len(result["value"]) < 900
    ids = {item["source_id"] for item in result["citations"]}
    assert {"profile.0", "job.0"} <= ids and len(ids) < len(catalog)
    assert all(item["quote"] == catalog[item["source_id"]]["quote"] for item in result["citations"])
    assert plan == before_plan and catalog == before_catalog


@pytest.mark.parametrize("invalid", ["unknown", "duplicate", "job_as_profile", "skills_as_work"])
def test_over_budget_optional_reference_is_still_validated_before_it_can_be_omitted(invalid):
    catalog = {
        "profile": {"source": "profile", "field": "experience", "source_id": "profile",
                    "quote": "Built a fictional tool. " + "x" * 600},
        "other": {"source": "job" if invalid == "job_as_profile" else "profile",
                  "field": "skills" if invalid == "skills_as_work" else "experience",
                  "source_id": "other", "quote": "Python. " + "x" * 100},
    }
    extra = "missing" if invalid == "unknown" else "profile" if invalid == "duplicate" else "other"
    plan = SelectedDraft(kind="experience", profile_source_ids=["profile", extra], job_source_ids=[])
    with pytest.raises(ValueError, match="invalid_source_reference|tool_or_degree_is_not_experience"):
        _draft(plan, catalog)


def test_required_profile_and_job_sources_over_budget_fail_without_truncating_quotes():
    catalog = {key: {"source": source, "field": "experience" if source == "profile" else "description",
                     "source_id": key, "quote": "x" * length}
               for key, source, length in (("profile", "profile", 650), ("job", "job", 100))}
    before = deepcopy(catalog)
    with pytest.raises(ValueError, match="draft_sources_too_long"):
        _draft(SelectedDraft(kind="motivation", profile_source_ids=["profile"], job_source_ids=["job"]), catalog)
    assert catalog == before


def test_source_budget_version_uses_new_context_without_rewriting_old_cache(client, db, prepared_context, monkeypatch):
    from app.answer_preparation import service
    current_version = service.VERSION
    monkeypatch.setattr(service, "VERSION", "application-answers-v2-explicit-tasks")
    old = post(client, db, prepared_context).json()
    old_run = db.scalar(select(AnswerPreparation))
    before = deepcopy(old_run.cache_json)
    monkeypatch.setattr(service, "VERSION", current_version)
    current = post(client, db, prepared_context).json()
    assert current["preparation_id"] != old["preparation_id"]
    assert len(prepared_context[-1].calls) == 2
    db.refresh(old_run)
    assert old_run.cache_json == before and old_run.version == "application-answers-v2-explicit-tasks"


def answer_excerpt(data, field_id, text, disposition="resume_evidence"):
    row = next(row for row in data["question_source_catalog"] if row["source"] != "job" and text in row["quote"])
    return {"field_id": field_id, "disposition": disposition, "fact_key": None,
            "excerpts": [{"source_id": row["source_id"], "text": text}]}


def test_arbitrary_unlisted_question_reads_entire_selected_pdf_even_after_common_warm(client, db, prepared_context):
    headers, user, _document, file, job, provider = prepared_context
    line = "Awarded the fictional Open Computing Fellowship for a course planning project."
    file.text = SOURCE + "\nAwards\n" + line
    db.commit()
    assert client.post("/browser-assistant/prepare-answers/warm", headers=headers,
                       json={"confirmed": True, "job_id": str(job.id)}).json()["status"] == "ready"
    def choose_evidence(plan, data):
        plan["field_answers"] = [answer_excerpt(data, "award", line)]
        return plan
    provider.change = choose_evidence
    field = {"id": "award", "label": "Which fellowship recognizes your computing work?", "kind": "text", "draftable": False}
    first = post(client, db, prepared_context, [field]).json()
    assert first["analyzed_field_ids"] == ["award"] and first["status"] == "ready"
    assert first["answers"][0]["source"] == "ai_draft" and first["answers"][0]["value"] == line
    assert first["answers"][0]["citations"][0]["quote"] in file.text
    sent = json.loads(provider.calls[-1].messages[-1].content)
    assert sent["source_catalog"] == [] and sent["question_source_catalog"]
    assert any(line in row["quote"] for row in sent["question_source_catalog"])
    assert not sent["question_context_truncated"] and len(provider.calls) == 2
    original_profile = db.scalar(select(UserProfile)).experience
    cached = post(client, db, prepared_context, [field], cache_only=True).json()
    assert cached["answers"] == first["answers"] and cached["analyzed_field_ids"] == ["award"]
    assert len(provider.calls) == 2 and db.scalar(select(UserProfile)).experience == original_profile
    assert build_autofill_profile(db, user)["resume"]["id"] == str(prepared_context[2].id)


def test_known_missing_location_and_every_one_of_forty_questions_receive_model_dispositions(client, db, prepared_context):
    fields = [{"id": "location", "label": "Current location", "kind": "text", "maxLength": 100}]
    fields += [{"id": f"question-{i}", "label": f"Optional professional detail {i}", "kind": "text", "maxLength": 100} for i in range(39)]
    result = post(client, db, prepared_context, fields).json()
    assert len(prepared_context[-1].calls) == 1
    sent = json.loads(prepared_context[-1].calls[0].messages[-1].content)
    assert len(sent["fields"]) == 40 and sent["question_source_catalog"]
    assert result["analyzed_field_ids"] == [field["id"] for field in fields]
    assert len(result["answers"]) == 40
    assert all(answer["source"] == "pending_confirmation" and answer["value"] == "To be confirmed" for answer in result["answers"])
    assert post(client, db, prepared_context, fields).json()["reused"]
    assert len(prepared_context[-1].calls) == 1


def test_actual_questions_never_request_or_accept_unsolicited_common_drafts(client, db, prepared_context):
    fields = [{"id": "project", "label": "Describe a software project", "kind": "text"}]
    result = post(client, db, prepared_context, fields).json()
    assert result["answers"][0]["source"] == "ai_draft"
    sent = json.loads(prepared_context[-1].calls[0].messages[-1].content)
    assert sent["draft_tasks"] == sent["draft_kinds"] == sent["source_catalog"] == []
    assert sent["example_plan"]["drafts"] == [] and sent["question_source_catalog"]
    def unsolicited(plan, _data):
        plan["drafts"] = [{"kind": "intro", "profile_source_ids": ["unrequested-reference"], "job_source_ids": []}]
        return plan
    prepared_context[-1].change = unsolicited
    fields[0]["label"] = "Describe a relevant software project"
    rejected = post(client, db, prepared_context, fields).json()
    assert rejected["error_code"] == "invalid_answer_preparation" and rejected["answers"] == []


@pytest.mark.parametrize("tamper_source", [False, True])
def test_scope_rejection_preserves_other_answers_but_invalid_source_still_rejects_whole_batch(client, db, prepared_context, tamper_source):
    prepared_context[3].text = SOURCE + "\nProjects\nProject sponsored by Fictional Labs — 2026–Present\n"
    db.commit()
    def choose(plan, data):
        project = answer_excerpt(data, "project", "Built a course planner using Python and SQLite.")
        if tamper_source:
            project["excerpts"][0]["source_id"] = "qsrc.unissued-other-owner.0"
        plan["field_answers"] = [answer_excerpt(data, "company", "Fictional Labs"), project,
                                  {"field_id": "gpa", "disposition": "missing", "fact_key": None, "excerpts": []}]
        return plan
    prepared_context[-1].change = choose
    fields = [{"id": "company", "label": "Current company", "kind": "text"},
              {"id": "project", "label": "Describe a software project", "kind": "text"},
              {"id": "gpa", "label": "GPA", "kind": "text"}]
    first = post(client, db, prepared_context, fields).json()
    if tamper_source:
        assert first["error_code"] == "invalid_answer_preparation" and first["answers"] == []
        assert first["analyzed_field_ids"] == []
    else:
        assert first["error_code"] is None and first["status"] == "partial"
        assert first["analyzed_field_ids"] == ["project", "gpa"]
        assert first["omitted"] == [{"field_id": "company", "reason": "evidence_requires_confirmation"}]
        assert [(answer["field_id"], answer["source"]) for answer in first["answers"]] == [
            ("project", "ai_draft"), ("gpa", "pending_confirmation")]
    cached = post(client, db, prepared_context, fields, cache_only=True).json()
    assert cached["answers"] == first["answers"] and len(prepared_context[-1].calls) == 1


def test_explicit_missing_year_and_grade_text_get_pending_but_native_numeric_date_do_not(client, db, prepared_context):
    fields = [{"id": "year", "label": "Year of study", "kind": "text", "maxLength": 100},
              {"id": "gpa", "label": "GPA", "kind": "text", "maxLength": 100},
              {"id": "numeric-gpa", "label": "GPA out of 4", "kind": "number"},
              {"id": "start", "label": "Internship start date", "kind": "date"}]
    result = post(client, db, prepared_context, fields).json()
    assert [(answer["field_id"], answer["value"]) for answer in result["answers"]] == [("year", "To be confirmed"), ("gpa", "To be confirmed")]
    assert all(answer["source"] == "pending_confirmation" for answer in result["answers"])
    assert {item["field_id"] for item in result["omitted"]} == {"numeric-gpa", "start"}
    assert all(item["reason"] == "model_confirmed_missing" for item in result["omitted"])
    assert result["analyzed_field_ids"] == [field["id"] for field in fields]


def test_missing_does_not_claim_absence_when_pdf_coverage_is_truncated(client, db, prepared_context, monkeypatch):
    from app.answer_preparation import service
    monkeypatch.setattr(service, "MAX_QUESTION_PDF_CHARACTERS", 60)
    result = post(client, db, prepared_context, [{"id": "gpa", "label": "GPA", "kind": "text", "maxLength": 100}]).json()
    assert result["context_truncated"] and result["answers"] == []
    assert result["omitted"] == [{"field_id": "gpa", "reason": "context_truncated"}]
    assert result["status"] == "partial" and result["error_code"] is None


def test_broad_portfolio_question_can_use_literal_project_url_without_fabricating_a_personal_profile(client, db, prepared_context):
    raw_url = "github.com/avery-example/course-planner"
    prepared_context[3].text = SOURCE + "\nProject links\n" + raw_url
    db.commit()
    def select(plan, data):
        plan["field_answers"] = [answer_excerpt(data, data["fields"][0]["id"], raw_url)]
        return plan
    prepared_context[-1].change = select
    first = post(client, db, prepared_context, [{"id": "link", "label": "Github / Portfolio URL", "kind": "text", "maxLength": 200}]).json()
    assert first["answers"][0]["value"] == "https://" + raw_url
    assert raw_url in first["answers"][0]["citations"][0]["quote"]
    assert first["answers"][0]["source"] == "ai_draft" and first["analyzed_field_ids"] == ["link"]
    bad = post(client, db, prepared_context, [{"id": "profile-link", "label": "GitHub profile URL", "kind": "text", "maxLength": 200}]).json()
    assert bad["error_code"] is None and bad["analyzed_field_ids"] == []
    assert bad["omitted"] == [{"field_id": "profile-link", "reason": "evidence_requires_confirmation"}]
    assert not any(answer["source"] == "ai_draft" for answer in bad["answers"])


@pytest.mark.parametrize("attack", ["missing_disposition", "duplicate_disposition", "unknown_field", "unknown_source", "rewritten_answer", "job_as_applicant", "extra_field"])
def test_per_question_schema_and_exact_citations_cannot_be_bypassed(client, db, prepared_context, attack):
    def change(plan, data):
        item = answer_excerpt(data, "custom", "Built a course planner using Python and SQLite.")
        plan["field_answers"] = [item]
        if attack == "missing_disposition":
            plan["field_answers"] = []
        elif attack == "duplicate_disposition":
            plan["field_answers"].append(deepcopy(item))
        elif attack == "unknown_field":
            item["field_id"] = "another-form-question"
        elif attack == "unknown_source":
            item["excerpts"][0]["source_id"] = "qsrc.another-owner-or-pdf.0"
        elif attack == "rewritten_answer":
            item["excerpts"][0]["text"] = "Employed in production for ten years."
        elif attack == "job_as_applicant":
            row = next(row for row in data["question_source_catalog"] if row["source"] == "job")
            item["excerpts"] = [{"source_id": row["source_id"], "text": row["quote"]}]
        else:
            item["generated_prose"] = "Unverified extra claim"
        return plan
    prepared_context[-1].change = change
    field = {"id": "custom", "label": "Outline one practical achievement", "kind": "text"}
    first = post(client, db, prepared_context, [field]).json()
    assert first["error_code"] == "invalid_answer_preparation" and first["analyzed_field_ids"] == []
    assert first["answers"] == []
    assert post(client, db, prepared_context, [field]).json()["reused"]
    assert len(prepared_context[-1].calls) == 1


def typed_answer(label, quote, text, *, field_kind="text", entry_kind=None, section="document", disposition="resume_evidence", fact_key=None):
    field = AnswerField(id="typed", label=label, kind=field_kind, maxLength=1000)
    catalog = {"qsrc.test.0": {"source_id": "qsrc.test.0", "source": "resume", "field": section,
                               "entry_kind": entry_kind, "quote": quote}}
    selection = FieldAnswer(field_id="typed", disposition=disposition, fact_key=fact_key,
                            excerpts=[{"source_id": "qsrc.test.0", "text": text}] if disposition == "resume_evidence" else [])
    return field, selection, catalog


def cited_choice(label, quote, source_value, options, option_value, normalization="literal", *, kind="select", section="education", searchable=False):
    field, selection, catalog = typed_answer(label, quote, quote, field_kind=kind, section=section)
    field = AnswerField.model_validate({**field.model_dump(), "options": options, "searchable": searchable})
    selection.choice = AnswerChoice(option_value=option_value, source_value=source_value, normalization=normalization)
    return field, selection, catalog


@pytest.mark.parametrize("kind,expected", [("select", "opaque-school-7"), ("combobox", "Northern Institute")])
def test_cited_literal_choice_uses_the_real_opaque_option_and_combobox_label(kind, expected):
    field, selection, catalog = cited_choice("School", "Northern Institute — M.Tech. 2026–Present", "Northern Institute",
        [{"value": "opaque-school-7", "label": "Northern Institute"}], "opaque-school-7", kind=kind)
    answer = _question_answer(selection, field, {"values": {}}, catalog, False)["answer"]
    assert answer["value"] == expected and answer["source"] == "ai_draft" and answer["fact_key"] is None
    assert answer["citations"][0]["quote"] == catalog["qsrc.test.0"]["quote"]


@pytest.mark.parametrize("label,quote,source_value,normalization,option", [
    ("Degree", "Northern Institute — M.Tech. 2026–Present", "M.Tech.", "degree", {"value": "master-id", "label": "Master's Degree"}),
    ("Education start month", "Northern Institute — January 2026–December 2027", "January", "month", {"value": "month-id", "label": "Jan"}),
    ("Education start year", "Northern Institute — 2026–Present", "2026", "literal", {"value": "year-id", "label": "2026"}),
    ("Country of study", "Country of study: Singapore", "Singapore", "country", {"value": "country-id", "label": "Singapore"}),
    ("Country of study", "Country of study: SG", "SG", "country", {"value": "sg", "label": "SG"}),
])
def test_choice_normalizations_use_explicit_source_facts_only(label, quote, source_value, normalization, option):
    field, selection, catalog = cited_choice(label, quote, source_value, [option], option["value"], normalization)
    assert _question_answer(selection, field, {"values": {}}, catalog, False)["answer"]["value"] == option["value"]


@pytest.mark.parametrize("quote", [
    "Southern University — B.Eng. January 2020–December 2024",
    "Northern Institute — B.Eng. January 2020–December 2024",
    "Northern Institute — M.Tech. 2026–Present\nSouthern University — B.Eng. January 2020–December 2024",
])
def test_education_choice_cannot_borrow_another_degree_month_or_year(quote):
    field, selection, catalog = cited_choice("Education start month", quote, "January",
        [{"value": "1", "label": "January"}], "1", "month")
    profile = {"values": {"school": "Northern Institute", "degree": "M.Tech."}}
    with pytest.raises(ValueError):
        _question_answer(selection, field, profile, catalog, False)


def test_education_choice_uses_one_current_entry_without_changing_saved_school_spelling():
    field, selection, catalog = cited_choice("Education start month", "Northern Institute — M.Tech. January 2026–Present", "January",
        [{"value": "1", "label": "January"}], "1", "month")
    profile = {"values": {"school": "Northern Institute (NI)", "degree": "M.Tech."}}
    before = deepcopy(profile)
    assert _question_answer(selection, field, profile, catalog, False)["answer"]["value"] == "1"
    assert profile == before


@pytest.mark.parametrize("label,quote,source_value,normalization,options,selected", [
    ("Degree", "M.Tech. 2026–Present", "M.Tech.", "degree", [{"value": "m1", "label": "Master's Degree"}, {"value": "m2", "label": "Master of Technology"}], "m1"),
    ("Education start month", "January 2026–December 2027", "January", "month", [{"value": "1", "label": "January"}, {"value": "jan", "label": "Jan"}], "1"),
    ("Education end year", "M.Tech. 2026–Present", "2026", "literal", [{"value": "2026", "label": "2026"}], "2026"),
    ("Year of study", "M.Tech. 2026–Present", "2026", "literal", [{"value": "1", "label": "Year 1"}], "1"),
    ("GPA", "GPA: 3.8/4.0", "3.8/4.0", "literal", [{"value": "highest", "label": "4.0"}], "highest"),
    ("Country of study", "Country of study: SG", "SG", "country", [{"value": "opaque", "label": "Singapore"}], "opaque"),
    ("Country of study", "Country of study: US", "US", "country", [{"value": "US", "label": "China"}], "US"),
    ("Degree", "M.Tech. 2026–Present", "M.Tech.", "degree", [{"value": "msc", "label": "Master of Science"}], "msc"),
    ("School", "Northern Institute", "Northern Institute", "literal", [{"value": "other", "label": "Other Institute"}], "other"),
    ("School", "Northern Institute", "Northern Institute", "literal", [{"value": "a", "label": "Northern Institute"}, {"value": "b", "label": "Northern Institute"}], "a"),
    ("School", "Northern Institute", "Northern Institute", "literal", [{"value": "actual", "label": "Northern Institute"}], "invented-id"),
])
def test_choice_ambiguity_unseen_options_and_unproved_qualifications_require_confirmation(label, quote, source_value, normalization, options, selected):
    field, selection, catalog = cited_choice(label, quote, source_value, options, selected, normalization)
    with pytest.raises(ValueError):
        _question_answer(selection, field, {"values": {}}, catalog, False)


@pytest.mark.parametrize("label,quote,source_value,section", [
    ("School", "Northern Institute — M.Tech. 2026–Present", "Northern Institute", "education"),
    ("Where are you currently based?", "Avery Ng\nExample City | +65 8123 4567 | avery@example.test", "Example City", "document"),
])
def test_searchable_choice_prepares_only_a_cited_literal_query_not_an_invented_option(label, quote, source_value, section):
    field, selection, catalog = cited_choice(label, quote, source_value, [], None, kind="combobox", section=section, searchable=True)
    answer = _question_answer(selection, field, {"values": {}}, catalog, False)["answer"]
    assert answer["value"] == source_value and source_value in answer["citations"][0]["quote"]
    field.searchable = False
    with pytest.raises(ValueError, match="searchable"):
        _question_answer(selection, field, {"values": {}}, catalog, False)


def test_missing_choice_metadata_can_prepare_the_same_exact_header_city_query_without_changing_model_plan(client, db, prepared_context):
    prepared_context[3].text = "Avery Ng\nSingapore⋄+65 8123 4567⋄avery@example.test\n" + SOURCE
    db.commit()
    def choose(plan, data):
        plan["field_answers"] = [answer_excerpt(data, "city", "Singapore")]
        assert plan["field_answers"][0].get("choice") is None
        return plan
    prepared_context[-1].change = choose
    field = {"id": "city", "label": "Where are you currently based?", "kind": "combobox", "searchable": True,
             "optionsPending": True, "options": []}
    result = post(client, db, prepared_context, [field]).json()
    assert result["answers"][0]["value"] == "Singapore" and result["answers"][0]["source"] == "ai_draft"
    assert result["analyzed_field_ids"] == ["city"]
    assert "Singapore" in result["answers"][0]["citations"][0]["quote"]
    assert post(client, db, prepared_context, [field], cache_only=True).json()["answers"] == result["answers"]
    assert len(prepared_context[-1].calls) == 1
    direct, selection, catalog = cited_choice("Where are you currently based?",
        "Avery Ng\nSingapore | +65 8123 4567 | avery@example.test", "Singapore", [], None,
        kind="combobox", section="document", searchable=True)
    selection.excerpts[0].text = "Singapore"
    selection.choice = None
    before = deepcopy(selection)
    assert _question_answer(selection, direct, {"values": {}}, catalog, False)["answer"]["value"] == "Singapore"
    assert selection == before and selection.choice is None


@pytest.mark.parametrize("kind,searchable,options,text,multiple", [
    ("select", True, [], "Northern Institute", False),
    ("combobox", False, [], "Northern Institute", False),
    ("combobox", True, [{"value": "school", "label": "Northern Institute"}], "Northern Institute", False),
    ("combobox", True, [], "Northern Institute", True),
    ("combobox", True, [], "A" * 241, False),
    ("combobox", True, [], "Northern Institute\nAnother campus", False),
    ("combobox", True, [], "I am currently based in Singapore", False),
    ("combobox", True, [], "Built a planning workflow using Python.", False),
])
def test_missing_choice_fallback_never_selects_closed_options_or_uses_multiple_long_or_narrative_excerpts(kind, searchable, options, text, multiple):
    quote = text + "\nIndependent excerpt"
    field, selection, catalog = typed_answer("School", quote, text, field_kind=kind, section="education")
    field = AnswerField.model_validate({**field.model_dump(), "options": options, "searchable": searchable})
    if multiple:
        selection = FieldAnswer.model_validate({**selection.model_dump(), "excerpts": [
            *[excerpt.model_dump() for excerpt in selection.excerpts],
            {"source_id": "qsrc.test.0", "text": "Independent excerpt"}]})
    with pytest.raises(ValueError, match="explicit_evidence_mapping"):
        _question_answer(selection, field, {"values": {}}, catalog, False)


def test_missing_choice_fallback_keeps_school_location_and_ongoing_date_scope_guards():
    field, selection, catalog = cited_choice("Where are you currently based?", "Northern Institute, Singapore", "Singapore",
        [], None, kind="combobox", searchable=True)
    selection.choice = None
    selection.excerpts[0].text = "Singapore"
    with pytest.raises(ValueError, match="residence"):
        _question_answer(selection, field, {"values": {}}, catalog, False)
    field, selection, catalog = cited_choice("Education end year", "Northern Institute — M.Tech. 2026–Present", "2026",
        [], None, kind="combobox", searchable=True)
    selection.choice = None
    selection.excerpts[0].text = "2026"
    with pytest.raises(ValueError, match="end_date"):
        _question_answer(selection, field, {"values": {}}, catalog, False)


def test_based_question_cannot_bypass_scope_using_school_or_phone_prefix():
    for quote, candidate in [("Northern Institute, Example City", "Example City"), ("Phone: +65 8123 4567", "+65")]:
        field, selection, catalog = cited_choice("Where are you currently based?", quote, candidate, [], None,
                                                kind="combobox", section="education", searchable=True)
        with pytest.raises(ValueError):
            _question_answer(selection, field, {"values": {}}, catalog, False)


@pytest.mark.parametrize("attack", ["source_value", "source_id", "extra_choice_key"])
def test_choice_source_boundary_and_schema_remain_strict_for_the_entire_batch(client, db, prepared_context, attack):
    def choose(plan, data):
        item = answer_excerpt(data, "school", "Northern Institute")
        item["choice"] = {"option_value": "school-id", "source_value": "Northern Institute", "normalization": "literal"}
        if attack == "source_value":
            item["choice"]["source_value"] = "An invented institution"
        elif attack == "source_id":
            item["excerpts"][0]["source_id"] = "qsrc.another-user-or-pdf.0"
        else:
            item["choice"]["ignore_validation"] = True
        plan["field_answers"] = [item]
        return plan
    prepared_context[-1].change = choose
    field = {"id": "school", "label": "School", "kind": "select", "options": [{"value": "school-id", "label": "Northern Institute"}]}
    result = post(client, db, prepared_context, [field]).json()
    assert result["error_code"] == "invalid_answer_preparation" and result["answers"] == []
    assert result["analyzed_field_ids"] == [] and len(prepared_context[-1].calls) == 1


def test_choice_model_reads_pdf_for_missing_profile_fact_and_reuses_cache(client, db, prepared_context):
    def choose(plan, data):
        item = answer_excerpt(data, "school", "Northern Institute")
        item["choice"] = {"option_value": "school-id", "source_value": "Northern Institute", "normalization": "literal"}
        plan["field_answers"] = [item]
        return plan
    prepared_context[-1].change = choose
    field = {"id": "school", "label": "School", "kind": "select", "options": [{"value": "school-id", "label": "Northern Institute"}]}
    result = post(client, db, prepared_context, [field]).json()
    assert result["answers"][0]["value"] == "school-id" and result["answers"][0]["source"] == "ai_draft"
    assert result["analyzed_field_ids"] == ["school"]
    assert post(client, db, prepared_context, [field], cache_only=True).json()["answers"] == result["answers"]
    assert len(prepared_context[-1].calls) == 1
    field["options"][0]["value"] = "new-site-option-id"
    changed = post(client, db, prepared_context, [field], cache_only=True).json()
    assert changed["answers"] == [] and changed["analyzed_field_ids"] == []
    assert len(prepared_context[-1].calls) == 1


def test_saved_degree_fact_retains_priority_over_model_choice_and_pdf(client, db, prepared_context):
    updated = client.patch("/profile/autofill-details", headers=prepared_context[0], json={"values": {"degree": "M.Tech."}})
    assert updated.status_code == 200
    field = {"id": "degree", "label": "Degree", "kind": "select", "options": [{"value": "master-id", "label": "Master's Degree"}]}
    result = post(client, db, prepared_context, [field]).json()
    assert result["answers"][0]["value"] == "master-id" and result["answers"][0]["source"] == "saved"
    assert not prepared_context[-1].calls


@pytest.mark.parametrize("label", ["Work authorization", "Privacy consent", "Have you graduated?", "Can you work in Singapore?"])
def test_choice_preparation_does_not_guess_declarations_or_qualifications_even_with_forged_flags(client, db, prepared_context, label):
    field = {"id": "protected", "label": label, "kind": "select", "manualOnly": False,
             "options": [{"value": "qualified", "label": "Qualified"}, {"value": "other", "label": "Other"}]}
    result = post(client, db, prepared_context, [field]).json()
    assert result["answers"] == [] and result["omitted"][0]["reason"] == "personal_or_qualification_question"
    assert not prepared_context[-1].calls


@pytest.mark.parametrize("label,quote,text,kind,entry_kind,section", [
    ("Current company", "Software Engineer, Fictional Labs — Jan 2025–Present", "Fictional Labs", "text", "work", "experience"),
    ("Current location", "Currently based in Singapore", "Singapore", "text", None, "document"),
    ("GPA", "Northern Institute — GPA: 3.8/4.0", "3.8/4.0", "text", None, "education"),
    ("GPA out of 4", "Northern Institute — GPA: 3.8/4.0", "3.8", "number", None, "education"),
    ("Year of study", "Year 1 M.Tech. Software Engineering", "Year 1", "text", None, "education"),
])
def test_specific_facts_require_direct_literal_evidence(label, quote, text, kind, entry_kind, section):
    field, selection, catalog = typed_answer(label, quote, text, field_kind=kind, entry_kind=entry_kind, section=section)
    result = _question_answer(selection, field, {"values": {}}, catalog, False)
    assert result["answer"]["value"] == text and result["model_analyzed"]
    assert result["answer"]["citations"][0]["quote"] == quote


@pytest.mark.parametrize("label", ["Current location *", "Current city"])
@pytest.mark.parametrize("separator", [" | ", "⋄"])
def test_broad_location_accepts_only_the_literal_pre_section_contact_header_location(label, separator):
    quote = "Avery Ng\n" + separator.join(["Example City", "+65 8123 4567", "avery@example.test"])
    field, selection, catalog = typed_answer(label, quote, "Example City")
    catalog["qsrc.test.0"]["pre_section_header"] = True
    result = _question_answer(selection, field, {"values": {}}, catalog, False)
    assert result["answer"]["value"] == "Example City"
    assert result["answer"]["citations"][0]["quote"] == quote


@pytest.mark.parametrize("label,quote,text,section", [
    ("Current location", "Avery Ng\nSchool: Fictional Institute, Example City\n+65 8123 4567 | avery@example.test", "Example City", "document"),
    ("Current location", "Fictional Institute, Example City\n+65 8123 4567 | avery@example.test", "Example City", "education"),
    ("Current location", "Fictional Labs, Example City\n+65 8123 4567 | avery@example.test", "Example City", "experience"),
    ("Current location", "Avery Ng\n+65 8123 4567 | avery@example.test", "+65", "document"),
    ("Current location", "Avery Ng\nExample City | +65 8123 4567 | avery@example.test", "Avery Ng", "document"),
    ("Country of residence", "Avery Ng\nExample Country | +65 8123 4567 | avery@example.test", "Example Country", "document"),
    ("Current country", "Avery Ng\nExample Country | +65 8123 4567 | avery@example.test", "Example Country", "document"),
])
def test_contact_header_exception_never_infers_school_work_phone_name_or_legal_residence(label, quote, text, section):
    field, selection, catalog = typed_answer(label, quote, text, section=section)
    catalog["qsrc.test.0"]["pre_section_header"] = section == "document"
    with pytest.raises(ValueError):
        _question_answer(selection, field, {"values": {}}, catalog, False)


@pytest.mark.parametrize("label,quote,text,entry_kind,section", [
    ("Current company", "Intern at Former Labs — May–Aug 2024", "Former Labs", "work", "experience"),
    ("Current company", "Project sponsored by Fictional Labs — 2025–Present", "Fictional Labs", "project", "experience"),
    ("Current company", "Former Labs — 2024\nCurrent Labs — 2025–Present", "Former Labs", "work", "experience"),
    ("Current location", "Northern Institute, Singapore. Phone +65 8000 0000", "Singapore", None, "document"),
    ("Current location", "School: Singapore\nCurrently based in London", "Singapore", None, "document"),
    ("Year of study", "M.Tech. Software Engineering 2026–2027 expected", "2026", None, "education"),
    ("Current degree GPA", "Bachelor's degree GPA: 3.8/4.0", "3.8/4.0", None, "education"),
    ("Master's GPA", "Bachelor's degree GPA: 3.8/4.0", "3.8/4.0", None, "education"),
    ("GPA", "GPA: 3.8/4.0", "3.8", None, "education"),
    ("Describe models you trained", "Skills: Python, PyTorch", "PyTorch", None, "skills"),
    ("Describe a software project", "Skills: Python, PyTorch", "PyTorch", None, "skills"),
])
def test_related_locations_dates_project_organisations_and_tool_names_do_not_establish_missing_facts(label, quote, text, entry_kind, section):
    field, selection, catalog = typed_answer(label, quote, text, entry_kind=entry_kind, section=section)
    with pytest.raises(ValueError):
        _question_answer(selection, field, {"values": {}}, catalog, False)


@pytest.mark.parametrize("label", ["Current company", "GPA", "Year of study"])
@pytest.mark.parametrize("disposition", ["saved_fact", "role_connection"])
def test_specific_factual_scope_cannot_be_bypassed_by_another_disposition(label, disposition):
    field, selection, catalog = typed_answer(label, "Northern Institute, 2027", "Northern Institute",
                                              disposition=disposition, fact_key="school" if disposition == "saved_fact" else None)
    if disposition == "role_connection":
        selection = FieldAnswer.model_validate({**selection.model_dump(), "excerpts": [
            {"source_id": "qsrc.test.0", "text": "Northern Institute"}, {"source_id": "job", "text": "Build tools"}]})
        catalog["job"] = {"source_id": "job", "source": "job", "field": "description", "quote": "Build tools"}
    with pytest.raises(ValueError):
        _question_answer(selection, field, {"values": {"school": "Northern Institute"}, "sources": {}, "fingerprint": "a" * 64}, catalog, False)


def test_warm_form_and_new_session_reuse_one_source_bound_bundle(client, db, prepared_context):
    headers, user, document, file, job, provider = prepared_context
    before = deepcopy(file.suggestions)
    warm = client.post("/browser-assistant/prepare-answers/warm", headers=headers,
                       json={"confirmed": True, "job_id": str(job.id), "resume_id": str(document.id)}).json()
    assert warm["status"] == "ready" and warm["execution_mode"] == "mock" and len(provider.calls) == 1
    actual = post(client, db, prepared_context, [{"id": "custom-summary", "label": "Brief introduction", "kind": "text", "draftable": True}]).json()
    assert actual["preparation_id"] == warm["preparation_id"] and len(provider.calls) == 2
    assert actual["analyzed_field_ids"] == ["custom-summary"]
    assert post(client, db, prepared_context, [{"id": "custom-summary", "label": "Brief introduction", "kind": "text", "draftable": True}]).json()["reused"]
    assert len(provider.calls) == 2
    answer = actual["answers"][0]
    assert answer["source"] == "ai_draft" and answer["fact_key"] is None and answer["citations"]
    for citation in answer["citations"]:
        assert citation["quote"] in SOURCE or citation["quote"] in PROFILE["experience"]
    db.refresh(file, attribute_names=["suggestions"])
    assert file.suggestions == before
    assert db.scalar(select(UserProfile.experience)) == PROFILE["experience"]
    sent = json.loads(provider.calls[0].messages[-1].content)
    assert sent["purpose"] == "application_answers" and "avery@example.com" not in json.dumps(sent)
    assert "+65 8123 4567" not in json.dumps(sent)


def test_warm_explicitly_requests_drafts_when_unknown_mapping_fields_is_empty(client, db, prepared_context):
    client.post("/browser-assistant/prepare-answers/warm", headers=prepared_context[0],
                json={"confirmed": True, "job_id": str(prepared_context[4].id)})
    request = prepared_context[-1].calls[0]
    data = json.loads(request.messages[-1].content)
    assert data["fields"] == []
    assert {task["kind"] for task in data["draft_tasks"] if task["required"]} == {"intro", "experience", "motivation"}
    assert {row["kind"] for row in data["example_plan"]["drafts"]} == {"intro", "experience", "motivation"}
    issued = {row["source_id"] for row in data["source_catalog"]}
    assert all(set(row["profile_source_ids"] + row["job_source_ids"]) <= issued for row in data["example_plan"]["drafts"])
    assert "fields=[] means no mapping questions; it DOES NOT" in request.messages[0].content
    assert "Return exactly {mappings:[],drafts:[]}" not in request.messages[0].content


def test_empty_plan_does_not_succeed_when_source_backed_drafts_were_requested(client, db, prepared_context):
    provider = prepared_context[-1]
    provider.change = lambda _plan, _data: {"mappings": [], "drafts": [], "field_answers": []}
    first = post(client, db, prepared_context).json()
    assert first["error_code"] == "invalid_answer_preparation"
    assert not any(answer["source"] == "ai_draft" for answer in first["answers"])
    second = post(client, db, prepared_context, cache_only=True).json()
    assert second["reused"] and len(provider.calls) == 1


def test_wrapped_project_bullet_is_one_exact_activity_passage_not_a_tool_header(client, db, prepared_context):
    profile = db.scalar(select(UserProfile))
    bullet = "•Built a retrieval project with cross-\nencoder reranking and versioned indexing\nof active versions."
    profile.experience = "Project Experience\nProject title\nPython, PyTorch, SQL\n" + bullet
    prepared_context[3].text = "Projects\n" + profile.experience + "\nSkills\nPython"
    db.commit()
    client.post("/browser-assistant/prepare-answers/warm", headers=prepared_context[0],
                json={"confirmed": True, "job_id": str(prepared_context[4].id)})
    sent = json.loads(prepared_context[-1].calls[0].messages[-1].content)
    experience = [row for row in sent["source_catalog"] if row["field"] == "experience"]
    assert experience and any(row["quote"] == bullet for row in experience)
    assert all(row["quote"] not in {"Project Experience", "Project title", "Python, PyTorch, SQL"} for row in experience)
    assert all(len(row["quote"]) <= 300 for row in sent["source_catalog"] if row["source"] == "job")
    sample = next(row for row in sent["example_plan"]["drafts"] if row["kind"] == "experience")
    by_id = {row["source_id"]: row for row in experience}
    assert all(by_id[key]["quote"] == bullet for key in sample["profile_source_ids"])


@pytest.mark.parametrize("page", [PAGE, "https://www.internsg.com/job-apply/123/",
    "https://jobs.lever.co/fictional/abc-123/apply",
    "https://jobs.ashbyhq.com/fictional/11111111-2222-4333-8444-555555555555/application"])
def test_four_canonical_sources_are_supported(client, db, prepared_context, page):
    prepared_context[4].apply_url = page
    db.commit()
    assert post(client, db, prepared_context).status_code == 200


@pytest.mark.parametrize("page", ["https://jobs.lever.co.attacker.test/a/b/apply", PAGE + "?unexpected=1", "http://www.internsg.com/job-apply/123"])
def test_noncanonical_pages_cannot_trigger_preparation(client, db, prepared_context, page):
    assert post(client, db, prepared_context, page_url=page).status_code == 422
    assert not prepared_context[-1].calls


@pytest.mark.parametrize("label,kind,options", [
    ("Do you require visa sponsorship?", "select", [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]),
    ("PDPA consent", "text", []), ("Highest completed degree", "text", []),
    ("Years of experience", "number", []), ("Date of birth", "date", []),
])
def test_qualifications_and_declarations_are_never_guessed(client, db, prepared_context, label, kind, options):
    result = post(client, db, prepared_context, [{"id": "sensitive", "label": label, "kind": kind,
                                                "draftable": True, "options": options}]).json()
    assert result["answers"] == [] and result["omitted"][0]["reason"] == "personal_or_qualification_question"
    assert not prepared_context[-1].calls


def test_missing_text_can_be_pending_but_dates_numbers_and_short_fields_stay_empty(client, db, prepared_context):
    result = post(client, db, prepared_context, [
        {"id": "salary", "label": "Expected salary", "kind": "text", "draftable": True},
        {"id": "start", "label": "Internship start date", "kind": "date", "draftable": True},
        {"id": "number", "label": "Expected salary", "kind": "number", "draftable": True},
        {"id": "short", "label": "Notice period", "kind": "text", "draftable": True, "maxLength": 4},
    ]).json()
    assert [(row["field_id"], row["value"], row["source"]) for row in result["answers"]] == [
        ("salary", "To be confirmed", "pending_confirmation")]
    assert len(result["omitted"]) == 3 and len(prepared_context[-1].calls) == 1
    assert all(row["reason"] == "model_confirmed_missing" for row in result["omitted"])


def test_unknown_question_mapping_copies_saved_fact_and_is_persistent(client, db, prepared_context):
    fields = [{"id": "contact", "label": "Best electronic contact", "kind": "text"}]
    first = post(client, db, prepared_context, fields).json()
    assert first["answers"][0]["value"] == PROFILE["contact_email"]
    assert first["answers"][0]["source"] == "saved" and first["answers"][0]["fact_key"] == "email"
    assert post(client, db, prepared_context, fields).json()["reused"]
    assert len(prepared_context[-1].calls) == 1


def test_verified_question_mapping_reuses_across_sources_but_role_drafts_do_not(client, db, prepared_context):
    provider = prepared_context[-1]
    fields = [{"id": "first-site-contact", "label": "Best electronic contact", "kind": "text"}]
    first = post(client, db, prepared_context, fields).json()
    other_page = "https://jobs.lever.co/another-fixture/abc-123/apply"
    fields[0]["id"] = "different-dom-id"
    second = post(client, db, prepared_context, fields, page_url=other_page, cache_only=True).json()
    assert second["reused"] and second["answers"][0]["field_id"] == "different-dom-id"
    assert second["answers"][0]["value"] == first["answers"][0]["value"] and len(provider.calls) == 1
    repeated = post(client, db, prepared_context, fields, page_url=other_page).json()
    assert repeated["answers"][0]["source"] == "saved" and len(provider.calls) == 1
    # Common drafts are tied to the actual job/page, not shared as fact mappings.
    other = post(client, db, prepared_context, page_url=other_page, cache_only=True).json()
    assert all(answer["source"] != "ai_draft" for answer in other["answers"])


def test_relevant_project_experience_is_a_grounded_draft_not_guessed_employment(client, db, prepared_context):
    result = post(client, db, prepared_context, [{"id": "project", "label": "Describe your relevant project experience",
                                                "kind": "text", "draftable": True}]).json()
    answer = result["answers"][0]
    assert answer["source"] == "ai_draft" and "Built a course planner" in answer["value"]
    assert "employed" not in answer["value"] and "graduated" not in answer["value"]


def test_lever_exact_additional_information_reuses_warmed_intro(client, db, prepared_context):
    headers, _user, _doc, _file, job, provider = prepared_context
    job.apply_url = "https://jobs.lever.co/fictional/abc-123/apply"
    db.commit()
    warm = client.post("/browser-assistant/prepare-answers/warm", headers=headers,
                       json={"confirmed": True, "job_id": str(job.id)}).json()
    result = post(client, db, prepared_context, [{"id": "comments", "label": "Additional information *",
                                                "kind": "text", "draftable": True}]).json()
    assert result["answers"][0]["source"] == "ai_draft"
    assert result["analyzed_field_ids"] == ["comments"] and warm["status"] == "ready"
    assert post(client, db, prepared_context, [{"id": "comments", "label": "Additional information *",
                                               "kind": "text", "draftable": True}]).json()["reused"]
    assert len(provider.calls) == 2


def test_single_paragraph_long_jd_keeps_exact_job_citations_for_motivation(client, db, prepared_context):
    job = prepared_context[4]
    job.description = " ".join(["Build useful software tools with Python and review their behaviour."] * 30)
    db.commit()
    result = post(client, db, prepared_context).json()
    motivation = next(answer for answer in result["answers"] if answer["field_id"] == "motivation")
    assert motivation["source"] == "ai_draft"
    cites = [cite for cite in motivation["citations"] if cite["source"] == "job"]
    assert cites and all(cite["quote"] in job.description and len(cite["quote"]) <= 700 for cite in cites)
    sent = json.loads(prepared_context[-1].calls[0].messages[-1].content)
    assert any(source["source"] == "job" for source in sent["question_source_catalog"])


@pytest.mark.parametrize("label,kind", [("Why us?", "motivation"), ("Describe a relevant project", "experience")])
def test_supported_narrative_labels_hit_the_warm_common_drafts(client, db, prepared_context, label, kind):
    headers, _user, _doc, _file, job, provider = prepared_context
    warm = client.post("/browser-assistant/prepare-answers/warm", headers=headers,
                       json={"confirmed": True, "job_id": str(job.id)}).json()
    result = post(client, db, prepared_context, [{"id": "narrative", "label": label,
                                                "kind": "text", "draftable": True}]).json()
    assert next(answer for answer in warm["answers"] if answer["field_id"] == kind)["citations"]
    assert result["analyzed_field_ids"] == ["narrative"]
    assert result["answers"][0]["source"] == "ai_draft" and len(provider.calls) == 2


@pytest.mark.parametrize("mutation", ["question", "options", "profile", "pdf", "job"])
def test_cache_changes_when_material_inputs_change(client, db, prepared_context, mutation):
    fields = [{"id": "contact", "label": "Best electronic contact", "kind": "text"}]
    if mutation == "job":
        fields.append({"id": "role", "label": "Why are you interested in this role?", "kind": "text", "draftable": True})
    first = post(client, db, prepared_context, fields).json()
    if mutation == "question":
        fields[0]["label"] = "Your preferred electronic contact"
    elif mutation == "options":
        fields[0]["options"] = [{"value": "choice", "label": "Different observed choice"}]
    elif mutation == "profile":
        client.patch("/profile", headers=prepared_context[0], json={"skills": ["Python", "SQL", "Git"]})
    elif mutation == "pdf":
        prepared_context[3].sha256 = "b" * 64
        db.commit()
    else:
        prepared_context[4].description = "Different real input description for offline testing."
        db.commit()
    second = post(client, db, prepared_context, fields).json()
    assert not second["reused"] and len(prepared_context[-1].calls) == 2
    if mutation in {"profile", "pdf", "job"}:
        assert second["preparation_id"] != first["preparation_id"]


@pytest.mark.parametrize("attack", ["unknown_source", "extra_prose", "skills_as_work", "job_as_profile"])
def test_model_cannot_invent_answers_sources_or_action_claims(client, db, prepared_context, attack):
    provider = prepared_context[-1]
    def change(plan, data):
        if attack == "extra_prose":
            plan["drafts"][0]["answer"] = "I have five years of paid employment."
        else:
            target = next(draft for draft in plan["drafts"] if draft["kind"] == "experience")
            source = ("unissued-source" if attack == "unknown_source" else next(
                source["source_id"] for source in data["source_catalog"]
                if (source["field"] == "skills" if attack == "skills_as_work" else source["source"] == "job")))
            target["profile_source_ids"] = [source]
        return plan
    provider.change = change
    body = {"confirmed": True, "job_id": str(prepared_context[4].id)}
    first = client.post("/browser-assistant/prepare-answers/warm", headers=prepared_context[0], json=body).json()
    assert first["error_code"] == "invalid_answer_preparation"
    assert all(answer["source"] in {"saved", "pending_confirmation"} for answer in first["answers"])
    assert next(answer for answer in first["answers"] if answer["field_id"] == "experience")["value"] == PROFILE["experience"]
    assert client.post("/browser-assistant/prepare-answers/warm", headers=prepared_context[0], json=body).json()["reused"]
    assert len(provider.calls) == 1


def test_cache_only_never_reserves_and_timeout_failure_is_not_retried(client, db, prepared_context):
    first = post(client, db, prepared_context, cache_only=True).json()
    assert first["error_code"] == "preparation_not_cached"
    assert db.scalar(select(func.count()).select_from(AnswerPreparation)) == 0
    provider = prepared_context[-1]
    provider.delay = .1
    app.dependency_overrides[get_form_plan_runtime] = lambda: runtime_for(provider, timeout_seconds=.01)
    failed = post(client, db, prepared_context).json()
    assert failed["error_code"] == "answer_preparation_timeout" and len(provider.calls) == 1
    assert post(client, db, prepared_context).json()["error_code"] == "answer_preparation_timeout"
    assert len(provider.calls) == 1


def test_disabled_runtime_does_not_poison_cache_or_prevent_first_enabled_call(client, db, prepared_context):
    provider = prepared_context[-1]
    app.dependency_overrides[get_form_plan_runtime] = lambda: None
    disabled = post(client, db, prepared_context).json()
    assert disabled["error_code"] == "answer_model_unavailable"
    assert db.scalar(select(func.count()).select_from(AnswerPreparation)) == 0
    assert not provider.calls
    app.dependency_overrides[get_form_plan_runtime] = lambda: runtime_for(provider)
    enabled = post(client, db, prepared_context).json()
    assert enabled["status"] == "ready" and len(provider.calls) == 1


@pytest.mark.parametrize("label", ["What is your work status in Singapore?", "Right to work", "Work permit details",
                                  "Immigration status", "If others, please indicate", "If other, please specify",
                                  "If you selected “Other” in the last question, please specify below:"])
def test_forged_client_flags_cannot_make_declarations_or_orphan_other_questions_draftable(client, db, prepared_context, label):
    result = post(client, db, prepared_context, [{"id": "email", "label": label, "kind": "text",
                                                "manualOnly": False, "draftable": True}]).json()
    assert result["answers"] == [] and result["omitted"][0]["reason"] == "personal_or_qualification_question"
    assert not prepared_context[-1].calls


@pytest.mark.parametrize("has_job", [True, False])
def test_cover_letter_reuses_common_grounded_draft_without_inventing_employer_context(client, db, prepared_context, has_job):
    headers, _user, _doc, _file, job, provider = prepared_context
    page = PAGE if has_job else "https://job-boards.greenhouse.io/other-qa/jobs/987"
    if has_job:
        assert client.post("/browser-assistant/prepare-answers/warm", headers=headers,
                           json={"confirmed": True, "job_id": str(job.id)}).status_code == 200
    result = post(client, db, prepared_context, [{"id": "cover_letter_text", "label": "Cover Letter", "kind": "text", "draftable": True}], page_url=page).json()
    answer = result["answers"][0]
    assert answer["source"] == "ai_draft" and answer["value"] != "To be confirmed"
    assert any(cite["source"] == "job" for cite in answer["citations"]) is has_job
    assert len(provider.calls) == (2 if has_job else 1)


def test_wrong_owner_fingerprint_or_selected_attachment_cannot_reuse_private_cache(client, db, prepared_context):
    headers, user, document, _file, job, provider = prepared_context
    first = post(client, db, prepared_context).json()
    other = auth_headers(client, "other-answer-fixture@example.com")
    payload = {"confirmed": True, "job_id": str(job.id), "profile_fingerprint": first["profile_fingerprint"]}
    assert client.post("/browser-assistant/prepare-answers/warm", headers=other, json=payload).status_code == 409
    assert client.post("/browser-assistant/prepare-answers/warm", headers=headers,
                       json={"confirmed": True, "job_id": str(job.id), "resume_id": str(uuid4())}).status_code == 409
    assert len(provider.calls) == 1
    assert build_autofill_profile(db, user)["resume"]["id"] == str(document.id)


def test_restricted_extension_grant_can_prepare_but_cannot_change_profile(client, db, prepared_context, monkeypatch):
    monkeypatch.setattr(get_settings(), "extension_client_ids", [CLIENT])
    headers, user, _doc, _file, job, _provider = prepared_context
    restricted, _ = connect(client, headers)
    body = {"confirmed": True, "job_id": str(job.id), "profile_fingerprint": build_autofill_profile(db, user)["fingerprint"]}
    assert client.post("/browser-assistant/prepare-answers/warm", headers=restricted, json=body).status_code == 200
    assert client.patch("/profile", headers=restricted, json={"full_name": "Other"}).status_code == 401


@pytest.mark.parametrize("confirmed", [False, 1, "true", None])
def test_confirmation_is_not_coerced(client, db, prepared_context, confirmed):
    assert post(client, db, prepared_context, confirmed=confirmed).status_code == 422
    assert not prepared_context[-1].calls


@pytest.mark.parametrize("warm_only", [False, True])
def test_concurrent_warm_and_form_claim_only_one_call_then_reuse_after_session_restart(tmp_path, warm_only):
    engine = create_engine(f"sqlite+pysqlite:///{(tmp_path / 'answers-concurrent.sqlite').as_posix()}",
                           connect_args={"check_same_thread": False, "timeout": 5})
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        user = User(email="concurrent-answers@example.com", password_hash="offline-only")
        db.add(user)
        db.flush()
        db.add(UserProfile(user_id=user.id, **PROFILE))
        db.commit()
        seed_pdf(db, user, content=SOURCE)
        seed_job(db)
        user_id = user.id
    provider = Provider()
    provider.entered, provider.release = threading.Event(), threading.Event()
    runtime = runtime_for(provider)
    def run(fields, cache_only=False, warm=False):
        with Session(engine, expire_on_commit=False) as db:
            return asyncio.run(prepare_answers(db, db.get(User, user_id), PAGE, fields, runtime, cache_only=cache_only, warm=warm))
    fields = [AnswerField(id="gpa" if warm_only else "actual-intro", label="GPA" if warm_only else "Tell us about yourself", kind="text", draftable=True)]
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(run, WARM_FIELDS, False, warm_only)
            assert provider.entered.wait(5)
            for cache_only in (False, True):
                running = run(fields, cache_only)
                assert running["status"] == "preparing" and running["reused"]
                assert len(provider.calls) == 1
            provider.release.set()
            assert first.result(timeout=5)["status"] == "ready"
        cached = run(fields, cache_only=warm_only)
        if warm_only:
            assert cached["status"] == "partial" and cached["analyzed_field_ids"] == []
            assert cached["answers"] == [] and cached["omitted"][0]["reason"] == "question_analysis_not_cached"
        else:
            assert cached["status"] == "ready"
        assert cached["reused"] and len(provider.calls) == 1
    finally:
        provider.release.set()
        engine.dispose()


def test_new_migration_keeps_existing_profile_and_has_one_head(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{(tmp_path / 'answers-migration.sqlite').as_posix()}"
    monkeypatch.setattr(get_settings(), "database_url", url)
    config = Config("alembic.ini")
    command.upgrade(config, "20261024_0011")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users(id,email,password_hash,role,is_active) VALUES(:id,'migration@example.com','test','job_seeker',1)"), {"id": "1"*32})
    command.upgrade(config, "head")
    assert "answer_preparations" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "20261025_0012"
        assert connection.scalar(text("SELECT count(*) FROM users")) == 1
    command.downgrade(config, "20261024_0011")
    assert "answer_preparations" not in inspect(engine).get_table_names()
    engine.dispose()
