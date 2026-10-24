"""Real-source recall and conservative evidence boundaries, entirely offline."""

import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.ai_recommendations.models import AIRecommendationRun
from app.jobs.provenance import is_public_http_url
from tests import test_ai_recommendations as shared
from tests.test_ai_recommendation_semantics import evaluate, row

context = shared.context
provider = shared.provider


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:1234/job",
        "https://localhost/jobs",
        "https://[::1]/job",
        "https://fixtures.example.test/job",
        "https://example.org/job",
        "https://example.invalid/job",
        "https://192.168.1.2/job",
        "https://board.local/job",
        "https://board.example/job",
        "file:///tmp/job",
        "https://user:pass@jobs.ashbyhq.com/x",
    ],
)
def test_known_nonpublic_provenance_is_not_a_real_candidate(url):
    assert not is_public_http_url(url)


@pytest.mark.parametrize("field", ["base_url", "source_url", "apply_url", "source_type"])
def test_fake_origin_cannot_reach_preview_explicit_or_automatic_model_call(
    client, db, context, provider, field
):
    job = context.jobs[0]
    if field == "base_url":
        job.source.base_url = "https://fake.example.test"
    elif field == "source_type":
        job.source.source_type = "sandbox"
    else:
        setattr(job, field, "http://127.0.0.1:9000/fake-job")
    db.commit()
    preview = client.get("/jobs/ai-recommendations/candidates", headers=context.headers)
    assert preview.status_code == 200 and preview.json()["candidates"] == []
    for selected in ([str(job.id)], None):
        response = shared.post(client, context, job_ids=selected)
        assert response.status_code == 422
    assert provider.calls == []
    assert db.scalars(select(AIRecommendationRun)).all() == []


def test_genuine_testing_role_is_kept_and_default_post_automatically_selects_five(
    client, db, context, provider
):
    jobs = [*context.jobs, *shared.seed_jobs(db, 4)]
    jobs[0].title = "Software Testing Engineer Intern"
    # The source NAME is intentionally not trusted as provenance metadata.
    jobs[0].source.name = "Sandbox testing tools hiring board"
    irrelevant = shared.seed_jobs(db, 2)
    irrelevant[0].title = "Quantitative Researcher (PhD)"
    irrelevant[1].title = "Sales Intern"
    for job in irrelevant:
        job.description = "Python required. Computing using Python. Build and test APIs."
    saved = deepcopy(shared.PROFILE)
    saved["education"] = "BEng in Computer Science"
    saved["experience"] = "Built software backend services using Python and REST APIs."
    assert client.put("/profile", headers=context.headers, json=saved).status_code == 200
    db.commit()

    def answer_selected(request):
        body = json.loads(request.messages[-1].content)
        return shared.answer([SimpleNamespace(id=job["id"]) for job in body["jobs"]])

    provider.data = answer_selected
    response = client.post(
        "/jobs/ai-recommendations", headers=context.headers, json={"confirmed": True}
    )
    assert response.status_code == 201 and response.json()["status"] == "succeeded"
    assert {item["id"] for item in response.json()["candidates"]} == {str(job.id) for job in jobs}
    assert len(provider.calls) == 1
    repeated = client.post(
        "/jobs/ai-recommendations", headers=context.headers, json={"confirmed": True}
    )
    assert repeated.status_code == 200 and repeated.json()["reused"]
    assert repeated.json()["id"] == response.json()["id"]
    assert len(provider.calls) == 1


@pytest.mark.parametrize(
    "experience",
    [
        "Annotated data, performed quality checks, and evaluated model outputs.",
        "Used existing data pipelines for annotation and model evaluation.",
        "Planned to build data pipelines.",
        "Never built data pipelines.",
        "Built Python APIs and evaluated models.",
        "Built Python APIs using existing data pipelines.",
        "I didn't build data pipelines.",
        "I didn’t build data pipelines.",
    ],
)
@pytest.mark.parametrize("category", ["skill", "experience", "responsibility"])
def test_related_data_work_cannot_become_infrastructure_building(experience, category):
    assessed, _ = evaluate(
        [
            row(
                "Build data pipelines for model training",
                category=category,
                quote=experience,
                field="experience",
            )
        ],
        experience=experience,
    )
    fact = assessed.items[0].requirements[0]
    assert fact.outcome == "unknown"
    assert "do not by themselves prove infrastructure construction" in fact.reason
    assert "0 supported" in assessed.items[0].summary


@pytest.mark.parametrize(
    ("jd", "experience"),
    [
        ("Build data pipelines", "Built data pipelines for a research project."),
        ("Develop ML infrastructure", "Developed machine learning infrastructure."),
        ("Design distributed systems", "Designed distributed systems for a class project."),
        ("Build data pipelines or ML infrastructure", "Built data pipelines for research."),
    ],
)
def test_corresponding_explicit_construction_is_preserved(jd, experience):
    assessed, _ = evaluate([row(jd, quote=experience, field="experience")], experience=experience)
    assert assessed.items[0].requirements[0].outcome == "supported"


def test_one_object_cannot_establish_an_infrastructure_and_condition():
    experience = "Built data pipelines for a project."
    assessed, _ = evaluate(
        [row("Build data pipelines and ML infrastructure", quote=experience, field="experience")],
        experience=experience,
    )
    assert assessed.items[0].requirements[0].outcome == "unknown"


@pytest.mark.parametrize("outcome", ["supported", "unknown"])
@pytest.mark.parametrize(
    ("jd", "experience"),
    [
        ("Build data pipelines or curate datasets", "Curated research datasets."),
        (
            "Build data pipelines or ML infrastructure and communicate findings",
            "Built data pipelines and communicated findings.",
        ),
    ],
)
def test_narrow_construction_guard_does_not_decide_unparsed_or_alternatives(
    jd, experience, outcome
):
    assessed, _ = evaluate(
        [row(jd, outcome=outcome, quote=experience, field="experience")],
        experience=experience,
    )
    assert assessed.items[0].requirements[0].outcome == outcome


@pytest.mark.parametrize("source_state", ["disabled", "mock", "sandbox"])
def test_browse_excludes_nonlive_sources_in_totals_and_pagination(
    client, db, context, source_state
):
    hidden = shared.seed_jobs(db, 2)
    if source_state == "disabled":
        hidden[0].source.enabled = False
    else:
        hidden[0].source.source_type = source_state
    db.commit()
    response = client.get("/jobs", params={"page_size": 1}).json()
    assert response["total"] == response["pages"] == 1
    assert response["items"][0]["id"] == str(context.jobs[0].id)
