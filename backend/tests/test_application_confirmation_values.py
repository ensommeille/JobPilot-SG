"""An acknowledgement must not turn an empty required answer into a saved record."""

import pytest
from sqlalchemy import func, select

from app.db.models import Application, FormMappingRecord
from tests.test_profiles_applications_assistant import (  # noqa: F401
    application_context,
    auth_headers,
)


def confirmation_payload(job, form):
    return {
        "job_id": str(job.id),
        "form_id": str(form.id),
        "mapping_version": "mapping-v1",
        "provider": "offline-test",
        "prompt_version": "confirmation-regression-v1",
        "mapping_draft": {
            "mapping": [
                {"field_id": "name", "label": "Full name", "value": "Fictional Applicant", "confidence": 0.95, "needs_review": False},
                {"field_id": "email", "label": "Email", "value": "fictional@example.com", "confidence": 0.95, "needs_review": False},
            ],
        },
        "confirmed_field_ids": ["name", "email"],
        "edited_values": {},
    }


@pytest.mark.parametrize("value", [None, "", " \t\n", [], {}])
@pytest.mark.parametrize("edited", [False, True])
def test_empty_required_final_value_is_rejected_atomically(
    client, db, application_context, value, edited
):
    job, form = application_context
    headers = auth_headers(client)
    payload = confirmation_payload(job, form)
    if edited:
        payload["edited_values"] = {"email": value}
    else:
        payload["mapping_draft"]["mapping"][1]["value"] = value
    response = client.post("/assistant/applications", headers=headers, json=payload)
    assert response.status_code == 422
    assert db.scalar(select(func.count()).select_from(Application)) == 0
    assert db.scalar(select(func.count()).select_from(FormMappingRecord)) == 0


def test_edited_answer_takes_precedence_and_saved_answers_survive_profile_changes(
    client, db, application_context
):
    job, form = application_context
    headers = auth_headers(client)
    payload = confirmation_payload(job, form)
    payload["mapping_draft"]["mapping"][1]["value"] = None
    payload["edited_values"] = {"email": "reviewed@example.com", "note": "My reviewed answer"}
    created = client.post("/assistant/applications", headers=headers, json=payload)
    assert created.status_code == 201
    application_id = created.json()["application"]["id"]
    assert client.put("/profile", headers=headers, json={"full_name": "Changed Profile"}).status_code == 200
    saved = client.get(f"/applications/{application_id}/answers", headers=headers)
    assert saved.status_code == 200
    assert [answer["value"] for answer in saved.json()["answers"]] == [
        "Fictional Applicant", "reviewed@example.com", "My reviewed answer"
    ]
    assert client.post("/assistant/applications", headers=headers, json=payload).status_code == 409
    assert db.scalar(select(func.count()).select_from(Application)) == 1
    assert db.scalar(select(func.count()).select_from(FormMappingRecord)) == 1
