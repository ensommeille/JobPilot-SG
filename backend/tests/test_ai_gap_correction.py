"""Free corrections of rejected contradiction claims preserve immutable history."""

import hashlib
import json
from copy import deepcopy

from sqlalchemy import event, select

from app.ai_recommendations.citations import resolve_assessment, source_catalog
from app.ai_recommendations.gap_evidence import (
    CORRECTION_PREFIX,
    LEGACY_GAP_MARKER,
    correct_unverified_gaps,
)
from app.ai_recommendations.models import AIRecommendationRun
from app.ai_recommendations.schemas import BatchAssessment
from app.ai_recommendations.service import validate_assessment
from tests import test_ai_recommendations as shared
from tests.test_ai_source_references import fixture_payload, source_range, spans, wire

context = shared.context
provider = shared.provider
REQUIRED = "Start dates: October 2028 or January 2029"
WINDOW = "OCT 14 - JAN 14"
FALSE_REASON = "Saved dates conflict with January and do not match October."


def test_rejected_gap_replaces_the_unverified_claim_instead_of_appending_disclaimer():
    payload = fixture_payload()
    payload["profile"]["availability"] = WINDOW
    payload["jobs"][0]["description"] = REQUIRED
    data = {
        "requires_review": True,
        "items": [
            {
                "job_id": payload["jobs"][0]["id"],
                "rank": 1,
                "summary": "Review the sources.",
                "requirements": [
                    shared.requirement(
                        requirement=REQUIRED,
                        category="work_constraint",
                        outcome="gap",
                        jd_quote=REQUIRED,
                        profile_field="availability",
                        profile_quote=WINDOW,
                        reason=FALSE_REASON,
                    )
                ],
                "warnings": [
                    "Saved availability conflicts with the stated start batches.",
                    "Onsite attendance is not stated.",
                ],
            }
        ],
    }
    payload["jobs"] = payload["jobs"][:1]
    before = deepcopy(data)
    assessed = validate_assessment(data, payload, allow_promotions=False)
    row = assessed.items[0].requirements[0]
    assert row.outcome == "unknown" and row.reason.startswith(CORRECTION_PREFIX)
    assert "does not specify a year" in row.reason and "no start-date mismatch" in row.reason
    assert FALSE_REASON not in row.reason
    assert not any("availability conflicts" in warning for warning in assessed.items[0].warnings)
    assert "Onsite attendance is not stated." in assessed.items[0].warnings
    assert data == before


def test_unproven_gap_branch_is_unknown_before_condition_aggregation():
    payload = fixture_payload()
    payload["profile"]["availability"] = WINDOW
    payload["jobs"][0]["description"] = REQUIRED
    catalog = source_catalog(payload)
    raw = wire(payload, catalog)
    current = raw["items"][0]["requirements"][0]
    evidence = source_range(spans(catalog, field="availability"))
    current.update(
        requirement=REQUIRED,
        category="work_constraint",
        outcome="gap",
        reason=FALSE_REASON,
        profile_field="availability",
        profile_source_range=evidence,
        condition_operator="any_of",
    )
    for check in current["condition_checks"]:
        check.update(
            condition="Start in October or January",
            outcome="gap",
            profile_field="availability",
            profile_source_range=evidence,
        )
    before = deepcopy(raw)
    resolved = resolve_assessment(raw, payload, catalog)
    row = resolved["items"][0]["requirements"][0]
    assert row["outcome"] == "unknown" and row["reason"].startswith(CORRECTION_PREFIX)
    assert raw == before


def test_free_saved_batch_and_detail_return_same_corrected_reason_without_db_writes(
    client, db, context, provider
):
    profile = {**deepcopy(shared.PROFILE), "availability_period": WINDOW}
    assert client.put("/profile", headers=context.headers, json=profile).status_code == 200
    context.jobs[0].description += " " + REQUIRED
    db.commit()
    provider.data["items"][0]["requirements"][1] = shared.requirement(
        requirement=REQUIRED,
        category="work_constraint",
        outcome="unknown",
        jd_quote=REQUIRED,
        profile_field="availability",
        profile_quote=WINDOW,
        reason="Saved availability does not establish the start-date year.",
    )
    created = shared.post(client, context).json()
    run = db.scalar(select(AIRecommendationRun))
    legacy = deepcopy(run.result_json)
    row = legacy["items"][0]["requirements"][1]
    row.update(
        requirement=REQUIRED,
        category="work_constraint",
        outcome="unknown",
        profile_field="availability",
        profile_quote=WINDOW,
        reason=FALSE_REASON + " " + LEGACY_GAP_MARKER,
    )
    legacy["items"][0]["warnings"] = ["Saved availability conflicts with the stated start batches."]
    run.result_json = legacy
    db.commit()  # Synthetic test history only; no live business database is opened.
    before = json.dumps(run.result_json, sort_keys=True)
    before_hash = hashlib.sha256(before.encode()).hexdigest()
    statements = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    event.listen(db.get_bind(), "before_cursor_execute", record)
    try:
        batch = client.get(f"/ai-recommendations/{created['id']}", headers=context.headers).json()
        detail = client.get(
            f"/jobs/{context.jobs[0].id}/ai-assessment", headers=context.headers
        ).json()
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", record)
    corrected = batch["result"]["items"][0]["requirements"][1]
    assert corrected["outcome"] == "unknown" and corrected["reason"].startswith(CORRECTION_PREFIX)
    assert detail["assessment"]["requirements"][1] == corrected
    assert batch["advice"][str(context.jobs[0].id)] == detail["advice"]
    assert batch["result"]["items"][0]["warnings"] == detail["assessment"]["warnings"]
    assert not {"UPDATE", "INSERT", "DELETE"} & set(statements)
    assert len(provider.calls) == 1
    db.refresh(run)
    assert (
        hashlib.sha256(json.dumps(run.result_json, sort_keys=True).encode()).hexdigest()
        == before_hash
    )
    assert run.result_json["items"][0]["requirements"][1]["reason"].startswith(FALSE_REASON)


def test_unmarked_unknown_and_explicit_gap_are_not_reinterpreted():
    data = shared.answer([type("Job", (), {"id": shared.uuid4()})()])
    first = data["items"][0]["requirements"][0]
    first.update(
        outcome="gap",
        profile_field="experience",
        profile_quote="I cannot work onsite.",
        reason="Explicit saved contradiction.",
    )
    data["items"][0]["requirements"][1]["reason"] = "An unrelated unknown needs confirmation."
    batch = BatchAssessment.model_validate(data)
    assert correct_unverified_gaps(batch).model_dump() == batch.model_dump()
