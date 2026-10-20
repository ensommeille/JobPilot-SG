"""Activity comparisons use actual project claims, not manufactured qualifications."""

import pytest

from app.job_extraction.models import ResponsibilityFact, TextFact
from app.responsibility_matching import (
    has_project_evidence,
    match_responsibilities,
    prepare_project_evidence,
)


def compare(duty, experience, *, description=None, value=None, **scope):
    fact = (
        ResponsibilityFact(value=value or duty, evidence=duty, **scope)
        if scope
        else TextFact(value=value or duty, evidence=duty)
    )
    return match_responsibilities([fact], description or duty, experience)[0]


@pytest.mark.parametrize(
    "duty,experience,activity",
    [
        (
            "Develop web applications.",
            "Built web applications for a class project.",
            "software_features",
        ),
        (
            "Write automated software tests.",
            "Implemented automated tests for the application.",
            "software_testing",
        ),
        (
            "Implement REST APIs.",
            "Developed REST APIs for a booking service.",
            "api_implementation",
        ),
        ("Fix software bugs.", "Fixed software bugs in a school project.", "software_debugging"),
        (
            "Deploy web applications.",
            "Deployed web applications to a staging environment.",
            "software_deployment",
        ),
        (
            "Build data pipelines.",
            "Implemented data pipelines for public transport records.",
            "data_automation",
        ),
        (
            "Develop web applications.",
            "I currently build web applications for the student club.",
            "software_features",
        ),
    ],
)
def test_recognized_actions_keep_exact_evidence(duty, experience, activity):
    row = compare(duty, experience)
    assert row.outcome == "related_evidence"
    assert row.reason == "related_activity"
    assert row.activities == [activity]
    assert row.responsibility == row.job_evidence == duty
    assert row.profile_evidence == [experience]
    assert has_project_evidence(experience)
    assert "supported" not in row.model_dump().values()


@pytest.mark.parametrize(
    "experience",
    [
        None,
        "",
        "Python, SQL, React",
        "Web development and automated testing",
        "Develop web applications.",
        "Write automated software tests.",
        "Job description: Built web applications.",
        "Job description:\nBuilt web applications.",
        "Example answer: Built web applications.",
        "I want to build web applications.",
        "I plan to develop web applications.",
        "I did not build web applications.",
        "I didn't build web applications.",
        "I never built web applications.",
        "I am learning to build web applications.",
        "Learning: Built web applications.",
        "My mentor built web applications.",
        "My colleague Alice built web applications.",
        "My team has built web applications.",
        "Observed a colleague who built web applications.",
        "If assigned, I would build web applications.",
        "Built a poster explaining APIs.",
        "Built API clients for a public service.",
        "Created API documentation.",
        "Developed APIs for pharmaceutical products.",
        "Used REST APIs to fetch public records.",
        "Built business workflows for employee onboarding.",
        "Developed a workshop for software engineers.",
        "Wrote automated tests for chemical specimens.",
        "25 automated tests.",
        "Built a poster; 25 automated tests.",
        "Develop web applications; I built a poster.",
        "Built.\nWeb applications.",
        "Built a poster. Web applications.",
        "Developed either web applications or data pipelines.",
    ],
)
def test_keywords_goals_copied_duties_and_other_peoples_work_are_not_projects(experience):
    assert not has_project_evidence(experience)
    row = compare("Develop web applications.", experience)
    assert row.outcome == "unknown"
    assert row.reason == "no_related_project_evidence"
    assert row.activities == row.profile_evidence == []


def test_attached_test_artifact_preserves_the_whole_implemented_project_claim():
    experience = (
        "Implemented retrieval tracing for a document search application; "
        "12 automated tests and two end-to-end demo checks."
    )
    row = compare("Write automated software tests.", experience)
    assert row.outcome == "related_evidence"
    assert row.activities == ["software_testing"]
    assert row.profile_evidence == [experience]


@pytest.mark.parametrize(
    "suffix",
    [
        "12 automated tests required.",
        "12 automated tests planned.",
        "12 automated tests to be written.",
        "the company has 12 automated tests.",
        "12 automated tests by my mentor.",
        "12 automated tests were provided by the instructor.",
        "12 automated tests copied from a tutorial.",
    ],
)
def test_unperformed_test_artifacts_do_not_borrow_project_actions(suffix):
    row = compare("Write automated software tests.", "Built web applications; " + suffix)
    assert row.outcome == "unknown"
    assert row.activities == []


def test_performed_verb_cannot_be_borrowed_across_a_semicolon():
    row = compare("Develop web applications.", "Develop web applications; I created API clients.")
    assert row.outcome == "unknown"


@pytest.mark.parametrize(
    "duty,experience",
    [
        ("Write automated software tests.", "Built web applications for a class project."),
        ("Implement REST APIs.", "Integrated API clients in a web application."),
        ("Use AI-assisted coding tools.", "Built web applications using an AI model."),
        ("Conduct market research.", "Implemented data pipelines for a research project."),
        ("Maintain inventory records.", "Implemented data pipelines for a research project."),
        ("Review a tutorial explaining how to build web applications.", "Built web applications."),
        (
            "Develop APIs for pharmaceutical products and chemical manufacturing.",
            "Built REST APIs.",
        ),
    ],
)
def test_different_activities_are_not_interchangeable(duty, experience):
    row = compare(duty, experience)
    assert row.outcome == "unknown"
    assert row.profile_evidence == []


@pytest.mark.parametrize(
    "quote,description,reason",
    [
        ("Develop web applications.", "Prepare retail displays.", "source_unverified"),
        (
            "develop web applications.",
            "Do not develop web applications.",
            "source_context_uncertain",
        ),
        (
            "develop web applications.",
            "Learn to develop web applications.",
            "source_context_uncertain",
        ),
        (
            "develop web applications.",
            "When assigned, develop web applications.",
            "scope_unverified",
        ),
        ("develop web applications.", "If needed, develop web applications.", "scope_unverified"),
        (
            "Develop web applications.",
            "Secondary duty: Develop web applications.",
            "scope_unverified",
        ),
        (
            "Develop web applications.",
            "Optional responsibilities:\nDevelop web applications.",
            "scope_unverified",
        ),
        (
            "Develop web applications.",
            "If the production team requests assistance:\nDevelop web applications.",
            "scope_unverified",
        ),
        (
            "Develop web applications.",
            "Develop web applications. This duty is optional.",
            "scope_unverified",
        ),
        (
            "Develop web applications only once management approves the prototype.",
            "Develop web applications only once management approves the prototype.",
            "scope_unverified",
        ),
        ("web applications", "Develop web applications.", "unsupported_activity"),
    ],
)
def test_source_quote_must_preserve_activity_and_surrounding_scope(quote, description, reason):
    row = compare(quote, "Built web applications for a class project.", description=description)
    assert row.outcome == "unknown"
    assert row.reason == reason


def test_paraphrase_cannot_invent_an_action_missing_from_the_quote():
    row = compare(
        "Attend team meetings.",
        "Built web applications for a class project.",
        value="Develop web applications.",
    )
    assert row.reason == "unsupported_activity"
    assert row.outcome == "unknown"


def test_clipped_source_action_cannot_change_reviewing_a_tutorial_into_building():
    row = compare(
        "build web applications.",
        "Built web applications.",
        description="Review a tutorial explaining how to build web applications.",
    )
    assert row.outcome == "unknown"
    assert row.activities == []


def test_negative_duplicate_quote_cannot_become_affirmative():
    row = compare(
        "Develop web applications.",
        "Built web applications for a class project.",
        description="Develop web applications. Never Develop web applications.",
    )
    assert row.outcome == "unknown"
    assert row.reason == "source_context_uncertain"


def test_conditional_source_is_related_only_when_its_scope_is_preserved():
    duty = "If time permits, develop web applications."
    condition = TextFact(value="If time permits", evidence="If time permits")
    row = compare(
        duty,
        "Built web applications for a class project.",
        priority="conditional",
        condition=condition,
    )
    assert row.outcome == "related_evidence"
    assert row.reason == "related_conditional_activity"
    assert row.priority == "conditional"
    assert row.condition == condition
    assert row.job_evidence == duty


def test_unverified_conditional_evidence_fails_closed():
    row = compare(
        "Develop web applications.",
        "Built web applications for a class project.",
        priority="conditional",
        condition=TextFact(value="If approved", evidence="If approved"),
    )
    assert row.outcome == "unknown"
    assert row.reason == "source_unverified"


def test_secondary_duty_and_mixed_scope_are_retained_without_full_coverage_claim():
    duty = "Develop web applications and maintain mobile applications."
    row = compare(
        duty,
        "Built web applications for a class project.",
        priority="secondary",
        condition=None,
    )
    assert row.outcome == "related_evidence"
    assert row.priority == "secondary"
    assert row.responsibility == duty
    assert row.activities == ["software_features"]


def test_conflicting_project_claims_fail_closed_for_the_same_activity():
    experience = "Built web applications. Never built web applications."
    assert not has_project_evidence(experience)
    assert compare("Develop web applications.", experience).outcome == "unknown"


@pytest.mark.parametrize(
    "denial",
    [
        "I have no experience building web applications.",
        "I have no experience in web development.",
    ],
)
def test_explicit_contradiction_in_gerund_or_noun_form_also_vetoes(denial):
    experience = "Built web applications. " + denial
    assert not has_project_evidence(experience)
    assert compare("Develop web applications.", experience).outcome == "unknown"


def test_repeated_projects_keep_one_original_excerpt_per_activity():
    experience = "Built web applications for a class project. Built web applications for a club."
    row = compare("Develop web applications.", experience)
    assert row.activities == ["software_features"]
    assert row.profile_evidence == ["Built web applications for a class project."]


def test_multiple_activities_return_separate_original_evidence_without_rewriting():
    first = "Built web applications for a class project."
    second = "Implemented automated tests for the application."
    row = compare(
        "Develop web applications. Write automated software tests.", first + "\n" + second
    )
    assert row.activities == ["software_features", "software_testing"]
    assert row.profile_evidence == [first, second]


def test_assisted_conjoined_duties_keep_explicit_shared_activity_objects():
    duty = "Assist in developing, testing and maintaining web applications."
    experience = "Built web applications. Implemented automated tests for the application."
    row = compare(duty, experience)
    assert row.outcome == "related_evidence"
    assert row.activities == ["software_features", "software_testing"]
    assert row.job_evidence == duty


@pytest.mark.parametrize(
    "experience",
    [
        "Built web applications. " + "x" * 10_000,
        "Built web applications.\n" * 121,
        "Built web applications with " + "x" * 2_500,
    ],
)
def test_bounds_fail_closed_instead_of_truncating_possible_late_negation(experience):
    assert not has_project_evidence(experience)


def test_only_experience_is_compared_no_file_provider_or_network_dependency():
    assert match_responsibilities([], "", "Built web applications.") == []


def test_prepared_evidence_reuses_exact_results_without_a_global_cache():
    duty = "Develop web applications."
    facts = [TextFact(value=duty, evidence=duty)]
    experience = "Built web applications for a class project."
    prepared = prepare_project_evidence(experience)
    assert match_responsibilities(facts, duty, experience) == match_responsibilities(
        facts, duty, None, project_evidence=prepared
    )
    assert (
        match_responsibilities(facts, duty, experience, project_evidence={})[0].outcome == "unknown"
    )
    assert match_responsibilities(facts, duty, None)[0].outcome == "unknown"
