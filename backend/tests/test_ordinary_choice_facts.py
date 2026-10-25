"""Offline ordinary choices: selected education provenance and explicit preferences."""

import pytest
from sqlalchemy import select

from app.answer_preparation.schemas import AnswerField
from app.answer_preparation.service import _protected, _question_answer, _saved
from app.autofill_assistant import _rule_key
from app.db.models import User, UserProfile
from app.profiles.autofill_facts import (
    EXTRACTABLE_KEYS,
    MANUAL_PREFERENCE_KEYS,
    AutofillDetailsPatch,
    build_autofill_profile,
    reviewed_autofill_record,
)
from tests.test_answer_preparation import cited_choice
from tests.test_autofill_facts import seed_pdf
from tests.test_profiles_applications_assistant import auth_headers


def education_context(client, db, *, ending="Present", school="Northern University"):
    headers = auth_headers(client, "ordinary-fixture@example.com")
    user = db.scalar(select(User))
    quote = f"{school} — M.Tech. in Software Engineering 2026–{ending}"
    document, file = seed_pdf(db, user, content="Education\n" + quote + "\nSouthern Polytechnic — B.Eng. 2020–2024")
    output = {"education_context": quote, "facts": [
        {"key": "school", "value": school, "quote": quote},
        {"key": "degree", "value": "M.Tech.", "quote": quote},
    ]}
    file.suggestions = {"autofill_review": reviewed_autofill_record(output=output, text=file.text, sha256=file.sha256, reason="Offline fixture review")}
    db.commit()
    return headers, user, document, quote


def test_selected_education_projects_university_and_current_student_without_a_model(client, db):
    _headers, user, document, quote = education_context(client, db)
    result = build_autofill_profile(db, user)
    assert result["values"]["institution_type"] == "University"
    assert result["values"]["current_student"] == "Yes"
    for key in ("institution_type", "current_student"):
        assert result["sources"][key]["quote"] == quote
        assert result["sources"][key]["resume_id"] == str(document.id)
    assert not any(key in result["values"] for key in MANUAL_PREFERENCE_KEYS)
    assert not set(MANUAL_PREFERENCE_KEYS) & set(EXTRACTABLE_KEYS)
    assert not {"institution_type", "current_student"} & set(EXTRACTABLE_KEYS)


def test_education_choice_projection_respects_overrides_clears_and_never_infers_not_student(client, db):
    _headers, user, _document, _quote = education_context(client, db, ending="2027")
    assert "current_student" not in build_autofill_profile(db, user)["values"]
    profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user.id))
    profile.autofill_details = {"values": {"school": "Different Polytechnic"}}
    db.commit()
    result = build_autofill_profile(db, user)
    assert result["values"]["institution_type"] == "Polytechnic"
    assert "current_student" not in result["values"]
    profile.autofill_details = {"values": {"institution_type": "Others", "current_student": "No"}}
    db.commit()
    result = build_autofill_profile(db, user)
    assert result["values"]["institution_type"] == "Others" and result["values"]["current_student"] == "No"
    assert result["sources"]["current_student"]["source"] == "manual"
    profile.autofill_details = {"values": {"institution_type": None, "current_student": None}}
    db.commit()
    assert not {"institution_type", "current_student"} & build_autofill_profile(db, user)["values"].keys()


def test_saved_application_preferences_are_explicit_and_never_alias_graduation_or_other_facts():
    values = {"internship_commitment": "6 months, full time", "internship_type": "Credit Bearing",
              "fulltime_start_year": "2028", "job_discovery_source": "LinkedIn", "job_discovery_other": "A personally recorded channel"}
    patch = AutofillDetailsPatch(values=values)
    assert patch.values == values
    assert _rule_key("When would you be available to start a full-time role?") == "fulltime_start_year"
    field = AnswerField(id="job-year", label="When would you be available to start a full-time role?", kind="select",
                        options=[{"value": "job-2027", "label": "2027"}, {"value": "job-2028", "label": "2028"}])
    assert _saved(field, "fulltime_start_year", {"values": {"education_end_year": "2027"}}) is None
    answer = _saved(field, "fulltime_start_year", {"values": values, "sources": {}, "fingerprint": "a" * 64})
    assert answer["value"] == "job-2028"


def test_varsity_can_classify_the_reviewed_education_name_without_relaxing_arbitrary_literal_choices():
    quote = "National University of Singapore (NUS) — M.Tech. 2026–Present"
    field, selection, catalog = cited_choice("Varsity", quote, "National University of Singapore (NUS)",
        [{"value": "opaque-university", "label": "University"}, {"value": "opaque-poly", "label": "Polytechnic"}], "opaque-university")
    profile = {"values": {"school": "National University of Singapore (NUS)", "degree": "M.Tech."}}
    assert _question_answer(selection, field, profile, catalog, False)["answer"]["value"] == "opaque-university"
    selection.choice.option_value = "opaque-poly"
    with pytest.raises(ValueError):
        _question_answer(selection, field, profile, catalog, False)
    selection.choice.option_value = "opaque-university"
    catalog["qsrc.test.0"]["field"] = "experience"
    with pytest.raises(ValueError):
        _question_answer(selection, field, profile, catalog, False)


@pytest.mark.parametrize("label,quote,value,option", [
    ("When would you be available to start a full-time role?", "Northern University — M.Tech. 2026–2027", "2027", "2027"),
    ("How long is your commitment period for a full-time internship? (Mondays to Fridays, entire workday)", "Northern University — six months course duration", "six months", "six months"),
])
def test_education_and_course_dates_cannot_establish_personal_availability(label, quote, value, option):
    field, selection, catalog = cited_choice(label, quote, value, [{"value": "answer", "label": option}], "answer")
    with pytest.raises(ValueError, match="availability"):
        _question_answer(selection, field, {"values": {}}, catalog, False)


def test_current_student_yes_no_and_narrow_internship_category_are_ordinary_but_legal_choices_stay_protected():
    student = AnswerField(id="student", label="Still Student?", kind="select", options=[{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}])
    assert not _protected(student)
    answer = _saved(student, "current_student", {"values": {"current_student": "Yes"}, "sources": {}, "fingerprint": "a" * 64})
    assert answer["value"] == "yes"
    for label in ("Do you require a work permit?", "I agree to the privacy policy", "Citizenship/Visa Status"):
        assert _protected(AnswerField(id="protected", label=label, kind="select", options=student.options))
