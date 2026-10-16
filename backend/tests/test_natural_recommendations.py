"""Natural skill overlap stays partial, source-backed, private and read-only."""

# Imported pytest fixtures are injected by their argument names.
# ruff: noqa: F811

from copy import deepcopy
from datetime import date, timedelta

import pytest
from sqlalchemy import event, func, select

from app.db.models import JobExtractionRun, UserProfile
from app.job_extraction.models import JobExtractionSchema
from app.job_extraction.persistence import job_input
from app.job_extraction.quality import assess_quality
from tests.test_job_matching import sample as matching_sample  # noqa: F401
from tests.test_job_recommendations import clone
from tests.test_job_recommendations import live as recommendation_live  # noqa: F401


def fact(value, evidence=None):
    return {"value": value, "evidence": evidence or f"{value} required."}


def prepare_job(db, fixture, description, *, required=(), preferred=(), duties=()):
    """Update only the in-memory fixture, including all source freshness fields."""
    _, job, run = fixture
    job.description = description
    data = JobExtractionSchema.model_validate(
        {
            "summary": None,
            "responsibilities": list(duties),
            "required_skills": list(required),
            "preferred_skills": list(preferred),
            "required_qualifications": [],
            "preferred_qualifications": [],
            "languages": [],
            "education": {"degree": None, "enrollment": None, "fields_of_study": []},
            "experience": {"requirement": None, "minimum_years": None},
        }
    )
    current = job_input(job)
    result = deepcopy(run.result_json)
    result.update(
        source_id=current.source_id,
        external_id=current.external_id,
        source_url=current.source_url,
        input_hash=current.input_hash,
        extraction=data.model_dump(),
        quality=assess_quality(data, description).model_dump(),
    )
    run.input_hash = current.input_hash
    run.input_json = current.model_dump()
    run.result_json = result
    db.commit()
    return fixture


def set_skills(client, fixture, skills):
    response = client.put("/profile", headers=fixture[0], json={"skills": skills})
    assert response.status_code == 200


def analyze(client, fixture):
    response = client.post(f"/jobs/{fixture[1].id}/match-analysis", headers=fixture[0], json={})
    assert response.status_code == 200
    return response.json()


def recommend(client, fixture):
    response = client.post("/jobs/recommendations", headers=fixture[0], json={})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def overlap_ids(item):
    return {overlap["skill_id"] for overlap in item["skill_overlaps"]}


def test_natural_alternative_is_partial_with_original_profile_evidence(
    client, db, recommendation_live
):
    wording = "Comfortable using Excel or Google Sheets for simple reports."
    profile_text = "I used Microsoft Excel to prepare weekly sales reports."
    prepare_job(
        db,
        recommendation_live,
        wording,
        required=[fact("Comfortable using Excel or Google Sheets", wording)],
    )
    set_skills(client, recommendation_live, [profile_text])

    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert item["job_evidence"] == wording
    assert overlap_ids(item) == {"excel"}
    overlap = item["skill_overlaps"][0]
    assert set(overlap) == {"skill_id", "label", "kind", "profile_evidence"}
    assert overlap["label"]
    assert overlap["kind"] == "specific"
    assert overlap["profile_evidence"] == profile_text

    report = recommend(client, recommendation_live)
    assert report["status"] == "ready"
    assert report["matched"] == report["evaluated"] == 1
    recommendation = report["items"][0]
    assert recommendation["overlaps"] == [item]
    assert recommendation["supported"] == []
    assert recommendation["unknown"] == [item]
    assert recommendation["gaps"] == []


@pytest.mark.parametrize(
    "wording,profile_text,expected",
    [
        (
            "Basic knowledge of AutoCAD is required.",
            "I used AutoCAD for a school drafting project.",
            {"autocad"},
        ),
        (
            "Familiar with design tools such as Canva, Photoshop or Illustrator.",
            "I make social media posters in Canva.",
            {"canva"},
        ),
    ],
)
def test_natural_tool_requirements_only_report_shared_tools(
    client, db, recommendation_live, wording, profile_text, expected
):
    prepare_job(db, recommendation_live, wording, required=[fact(wording, wording)])
    set_skills(client, recommendation_live, [profile_text])
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert overlap_ids(item) == expected
    assert recommend(client, recommendation_live)["items"][0]["overlaps"] == [item]


@pytest.mark.parametrize(
    "requirement,skills",
    [
        ("Excel", ["I use Microsoft Office for coursework."]),
        ("Microsoft Office", ["I prepare spreadsheets in Excel."]),
    ],
)
def test_office_suite_does_not_imply_excel_or_reverse(
    client, db, recommendation_live, requirement, skills
):
    prepare_job(
        db,
        recommendation_live,
        f"{requirement} required.",
        required=[fact(requirement)],
    )
    set_skills(client, recommendation_live, skills)
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert item["skill_overlaps"] == []
    assert recommend(client, recommendation_live)["items"] == []


def test_atomic_support_gaps_and_unknowns_keep_their_legacy_meanings(
    client, db, recommendation_live
):
    prepare_job(
        db,
        recommendation_live,
        "Python required. Java required. SQL required.",
        required=[fact("Python"), fact("Java"), fact("SQL")],
    )
    set_skills(client, recommendation_live, ["Python", "No Java"])
    analysis = analyze(client, recommendation_live)
    assert [item["outcome"] for item in analysis["items"]] == ["supported", "gap", "unknown"]
    assert overlap_ids(analysis["items"][0]) == {"python"}
    assert analysis["items"][0]["profile_evidence"] == "Python"
    assert analysis["items"][1]["skill_overlaps"] == []

    item = recommend(client, recommendation_live)["items"][0]
    assert [row["requirement"] for row in item["supported"]] == ["Python"]
    assert [row["requirement"] for row in item["gaps"]] == ["Java"]
    assert [row["requirement"] for row in item["unknown"]] == ["SQL"]
    assert item["overlaps"] == []


def test_duties_alone_cannot_become_requirements(client, db, recommendation_live):
    wording = "Prepare reports in Excel and create posters in Canva."
    prepare_job(db, recommendation_live, wording, duties=[fact(wording, wording)])
    set_skills(client, recommendation_live, ["Excel", "Canva"])
    analysis = analyze(client, recommendation_live)
    assert analysis["status"] == "unavailable"
    assert analysis["reason"] == "no_requirements"
    report = recommend(client, recommendation_live)
    assert report["status"] == "no_evidence"
    assert report["excluded"] == {"no_requirements": 1}
    assert report["items"] == []


@pytest.mark.parametrize(
    "description,evidence",
    [
        ("No Python required.", "No Python required."),
        ("No Python required.", "Python"),
        ("No Python experience is required for this internship.", "Python"),
        ("This internship does not require Python.", "Python"),
    ],
)
def test_negative_source_context_cannot_support_even_a_clipped_quote(
    client, db, recommendation_live, description, evidence
):
    prepare_job(db, recommendation_live, description, required=[fact("Python", evidence)])
    set_skills(client, recommendation_live, ["Python"])
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert item["skill_overlaps"] == []
    assert recommend(client, recommendation_live)["status"] == "no_matches"


@pytest.mark.parametrize(
    "description,evidence",
    [
        ("Advanced Python required.", "Python required."),
        ("Advanced Python required.", "Python"),
        ("Python and SQL required.", "Python"),
    ],
)
def test_clipped_conditions_remain_partial(client, db, recommendation_live, description, evidence):
    prepare_job(db, recommendation_live, description, required=[fact("Python", evidence)])
    set_skills(client, recommendation_live, ["Python"])
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert overlap_ids(item) == {"python"}
    recommendation = recommend(client, recommendation_live)["items"][0]
    assert recommendation["supported"] == []
    assert recommendation["overlaps"] == [item]


@pytest.mark.parametrize(
    "description,evidence",
    [
        ("Prepare weekly reports.", "Prepare weekly reports."),
        ("Canva required. Prepare weekly reports.", "Prepare weekly reports."),
        ("Canva required.", "Experience with Canva is required."),
    ],
)
def test_hallucinated_label_or_quote_cannot_borrow_unrelated_evidence(
    client, db, recommendation_live, description, evidence
):
    prepare_job(db, recommendation_live, description, required=[fact("Canva", evidence)])
    set_skills(client, recommendation_live, ["Canva"])
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert item["skill_overlaps"] == []
    assert recommend(client, recommendation_live)["items"] == []


@pytest.mark.parametrize(
    "skills",
    [
        ["Python", "No Python"],
        ["I use Python in projects.", "No experience with Python"],
        ["Python", "Currently learning Python"],
        ["Currently learning Python"],
        ["想学 Python"],
        ["我正在学 Python"],
    ],
)
def test_profile_negation_learning_and_contradictions_suppress_overlap(
    client, db, recommendation_live, skills
):
    prepare_job(db, recommendation_live, "Python required.", required=[fact("Python")])
    set_skills(client, recommendation_live, skills)
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert item["skill_overlaps"] == []
    report = recommend(client, recommendation_live)
    assert report["status"] == "profile_needed"
    assert report["items"] == []


def test_general_skills_cannot_gate_discovery_even_with_an_unrelated_concrete_profile_skill(
    client, db, recommendation_live
):
    wording = "Good communication and teamwork skills required."
    prepare_job(db, recommendation_live, wording, required=[fact(wording, wording)])
    set_skills(client, recommendation_live, ["Excel", "Communication", "Teamwork"])
    item = analyze(client, recommendation_live)["items"][0]
    assert item["outcome"] == "unknown"
    assert item["skill_overlaps"]
    assert all(overlap["kind"] == "general" for overlap in item["skill_overlaps"])
    report = recommend(client, recommendation_live)
    assert report["status"] == "no_matches"
    assert report["items"] == []


@pytest.mark.parametrize(
    "older_required,older_preferred,newer_required,newer_preferred,skills,older_first",
    [
        (["Python"], [], ["Python", "SQL", "Java"], [], ["Python", "SQL", "No Java"], True),
        ([], ["Python", "SQL"], ["Python"], [], ["Python", "SQL"], True),
        (["Python"], [], [], ["Python"], ["Python"], False),
        (["JavaScript", "JS"], [], ["JavaScript"], [], ["JS"], False),
        (
            ["Python", "Communication", "Teamwork"],
            [],
            ["Python"],
            [],
            ["Python", "Communication", "Teamwork"],
            False,
        ),
    ],
    ids=[
        "gaps-before-overlap-count",
        "distinct-skills-before-recency",
        "importance-does-not-rank",
        "synonyms-do-not-inflate",
        "general-skills-do-not-rank",
    ],
)
def test_ranking_uses_gaps_then_distinct_specific_skills_then_recency(
    client,
    db,
    recommendation_live,
    older_required,
    older_preferred,
    newer_required,
    newer_preferred,
    skills,
    older_first,
):
    other_job, other_run = clone(db, recommendation_live)
    older = recommendation_live
    newer = (older[0], other_job, other_run)
    older[1].posted_at = date.today() - timedelta(days=2)
    newer[1].posted_at = date.today() - timedelta(days=1)
    for fixture, required, preferred in [
        (older, older_required, older_preferred),
        (newer, newer_required, newer_preferred),
    ]:
        rows = [fact(value) for value in required]
        optional = [fact(value, f"{value} preferred.") for value in preferred]
        description = " ".join(row["evidence"] for row in [*rows, *optional])
        prepare_job(db, fixture, description, required=rows, preferred=optional)
    set_skills(client, older, skills)

    report = recommend(client, older)
    assert report["matched"] == 2
    expected = [older, newer] if older_first else [newer, older]
    assert [item["job_id"] for item in report["items"]] == [str(row[1].id) for row in expected]
    assert recommend(client, older) == report


def test_natural_analysis_and_discovery_execute_no_database_writes(client, db, recommendation_live):
    wording = "Comfortable using Excel or Google Sheets."
    prepare_job(db, recommendation_live, wording, required=[fact(wording, wording)])
    set_skills(client, recommendation_live, ["I use Excel for weekly reports."])
    before_runs = db.scalar(select(func.count()).select_from(JobExtractionRun))
    before_profiles = db.scalar(select(func.count()).select_from(UserProfile))
    before_result = deepcopy(recommendation_live[2].result_json)
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.lstrip().split(None, 1)[0].upper())

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        assert analyze(client, recommendation_live)["items"][0]["skill_overlaps"]
        assert recommend(client, recommendation_live)["status"] == "ready"
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)

    assert statements
    assert not {"INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER"}.intersection(
        statements
    )
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(JobExtractionRun)) == before_runs
    assert db.scalar(select(func.count()).select_from(UserProfile)) == before_profiles
    assert recommendation_live[2].result_json == before_result
