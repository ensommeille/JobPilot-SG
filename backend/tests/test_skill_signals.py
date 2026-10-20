"""Explicit mentions are evidence of named skills, not qualifications or suitability."""

from dataclasses import FrozenInstanceError

import pytest

from app.skill_signals import SkillMention, is_uncertain_or_negative, mentions, positive_profile


def ids(text):
    return [item.skill_id for item in mentions(text)]


def test_real_job_prose_and_verbatim_terms():
    text = "Comfortable using MS Excel. Basic knowledge of AutoCAD. Canva, CapCut or Adobe Creative Suite."
    found = mentions(text)
    assert [item.skill_id for item in found] == [
        "excel",
        "autocad",
        "canva",
        "capcut",
        "adobe_creative_suite",
    ]
    assert [item.term for item in found] == [
        "MS Excel",
        "AutoCAD",
        "Canva",
        "CapCut",
        "Adobe Creative Suite",
    ]
    assert all(item.kind == "specific" for item in found)
    assert not is_uncertain_or_negative(text)


def test_named_data_engineering_tools_from_a_technical_profile():
    skills = [
        "Pandas",
        "NumPy",
        "scikit-learn",
        "Matplotlib",
        "REST APIs",
        "Linux",
        "Apache Spark",
        "Hadoop",
        "Kafka",
    ]
    assert set(positive_profile(skills)) == {
        "pandas",
        "numpy",
        "scikit_learn",
        "matplotlib",
        "rest_api",
        "linux",
        "spark",
        "hadoop",
        "kafka",
    }
    assert ids("Experience with Pandas, NumPy, scikit-learn, Spark and Kafka required.") == [
        "pandas",
        "numpy",
        "scikit_learn",
        "spark",
        "kafka",
    ]


def test_anonymized_software_data_profile_has_full_named_skill_coverage():
    skills = [
        "Python",
        "SQL",
        "Java",
        "Pandas",
        "NumPy",
        "scikit-learn",
        "Excel",
        "Power BI",
        "Matplotlib",
        "FastAPI",
        "Vue 3",
        "REST APIs",
        "MySQL",
        "MongoDB",
        "Git",
        "Docker",
        "Linux",
        "Spark",
        "Hadoop",
        "Kafka",
        "Data Analysis",
    ]
    assert len(positive_profile(skills)) == len(skills)


def test_ordinary_spark_and_pandas_are_not_technical_skill_evidence():
    assert ids("Spark curiosity and protect pandas in the wild.") == []
    assert positive_profile(["Learning Spark", "No experience with Kafka"]) == {}


@pytest.mark.parametrize(
    "text, expected",
    [
        ("JS and JavaScript, then JS", ["javascript"]),
        ("Node.js with React.js and Postgres", ["node.js", "react", "postgresql"]),
        (
            "Book-keeping, accounting and Google Sheets",
            ["bookkeeping", "accounting", "google_sheets"],
        ),
        (
            "Electronic medical records and clinic management systems; ultrasound",
            ["electronic_medical_records", "clinic_management_systems", "ultrasound"],
        ),
        ("Photoshop and Lightroom", ["photoshop", "lightroom"]),
        ("MS Office and Microsoft Office Suite", ["microsoft_office"]),
        ("Basic knowledge of AutoCAD", ["autocad"]),
        ("Experienced in Python, SQL or Java", ["python", "sql", "java"]),
        ("Google\nSheets", ["google_sheets"]),
    ],
)
def test_aliases_and_compound_mentions(text, expected):
    assert ids(text) == expected


@pytest.mark.parametrize(
    "text, expected",
    [
        ("C++ and C#", ["c++", "c#"]),
        ("C programming and C++ with C#", ["c", "c++", "c#"]),
        ("JavaScript", ["javascript"]),
        ("React Native", ["react_native"]),
        ("WordPress", ["wordpress"]),
        ("Microsoft Office", ["microsoft_office"]),
        ("Adobe Creative Suite", ["adobe_creative_suite"]),
        ("MS Word and WordPress", ["microsoft_word", "wordpress"]),
        ("NoSQL", []),
        ("MySQL", ["mysql"]),
        ("Pythonic, JavaScripted, Excelled, accountingish", []),
        ("React.foo and xPython and C++++", []),
    ],
)
def test_no_substrings_or_parent_child_inferences(text, expected):
    assert ids(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "We go to the office and excel at teamwork.",
        "Go beyond expectations and Excel in your career.",
        "Give us your word and react to requests.",
        "Take a flask with a ruby; use a swift response to rust.",
        "Grade C and category C applicants; work in R&D.",
        "A, B, C",
        "Our office is bright and your word matters.",
        "Use word of mouth to spread the word. Work in office today.",
        "Worked in office",
        "Experience in office",
        "Experience working in office",
        "Office experience required",
        "Comfortable in office",
    ],
)
def test_ambiguous_ordinary_words_do_not_create_specific_skills(text):
    assert not [item for item in mentions(text) if item.kind == "specific"]


@pytest.mark.parametrize(
    "text, expected",
    [
        ("C", ["c"]),
        ("R", ["r"]),
        ("Go", ["go"]),
        ("Experience with Go and Python", ["go", "python"]),
        ("Python, R", ["python", "r"]),
        ("Knowledge of C required", ["c"]),
        ("Comfortable using Excel", ["excel"]),
        ("Excel formulas and Word documents", ["excel", "microsoft_word"]),
        ("Proficient in React", ["react"]),
        ("Rust programming", ["rust"]),
        ("Excel, Word, PowerPoint", ["excel", "microsoft_word", "powerpoint"]),
        ("Excel and Word", ["excel", "microsoft_word"]),
        ("Comfortable using Word and Excel", ["microsoft_word", "excel"]),
        ("Comfortable using Office", ["microsoft_office"]),
        ("Proficient in Office", ["microsoft_office"]),
        ("Experience in Office software", ["microsoft_office"]),
        ("Excel and Office", ["excel", "microsoft_office"]),
    ],
)
def test_explicit_context_disambiguates_names(text, expected):
    assert ids(text) == expected


@pytest.mark.parametrize(
    "entry,skill_id",
    [
        ("Excel (Advanced)", "excel"),
        ("Excel (basic)", "excel"),
        ("Go (Intermediate)", "go"),
        ("React (beginner level)", "react"),
    ],
)
def test_standalone_proficiency_tags_preserve_named_skill_and_original_evidence(entry, skill_id):
    assert ids(entry) == [skill_id]
    assert positive_profile([entry]) == {skill_id: entry}
    assert mentions(entry)[0].term == entry.split(" (")[0]


@pytest.mark.parametrize(
    "text",
    [
        "We excel (advanced teams)",
        "Excel (advanced teams)",
        "Go (advanced) to the office",
        "I excel (Advanced)",
        "Office (advanced building)",
    ],
)
def test_parentheses_do_not_turn_ordinary_prose_into_a_proficiency_tag(text):
    assert not [item for item in mentions(text) if item.kind == "specific"]


@pytest.mark.parametrize("entry", ["Excel (learning)", "No experience with Excel (Advanced)"])
def test_proficiency_annotations_do_not_override_negative_or_learning_evidence(entry):
    assert positive_profile(["Excel (Advanced)", entry]) == {}


def test_general_signals_remain_distinct():
    found = mentions("Communication skills, teamwork and attention to detail; AutoCAD.")
    assert [(item.skill_id, item.kind) for item in found] == [
        ("communication", "general"),
        ("teamwork", "general"),
        ("attention_to_detail", "general"),
        ("autocad", "specific"),
    ]


@pytest.mark.parametrize(
    "text",
    [
        "No experience with Python",
        "No Python experience required",
        "Python is not required",
        "I do not know AutoCAD",
        "I don't know Python",
        "I haven’t used Canva",
        "Without SQL",
        "Want to learn Excel",
        "Interested in accounting",
        "Planning to learn AutoCAD",
        "Currently learning Python",
        "Studying Java",
        "Willing to learn CapCut",
        "Python: none",
        "Little experience in SQL",
        "Unsure about Python",
        "Python training will be provided",
    ],
)
def test_negative_and_learning_contexts_are_not_affirmative(text):
    assert is_uncertain_or_negative(text)
    assert positive_profile([text]) == {}


@pytest.mark.parametrize(
    "text",
    [
        "Basic knowledge of AutoCAD",
        "Comfortable using MS Excel",
        "Learned Python at school",
        "Python for machine learning",
        "Deep learning with Python",
        "Canva and CapCut",
    ],
)
def test_affirmative_mentions_do_not_claim_mastery(text):
    assert not is_uncertain_or_negative(text)
    assert positive_profile([text])


def test_lexical_mentions_preserve_negation_for_callers_to_check():
    assert ids("No experience with Python or SQL required") == ["python", "sql"]
    assert is_uncertain_or_negative("No experience with Python or SQL required")


def test_profile_uses_original_affirmative_evidence():
    original = "  Comfortable using MS Excel and Google Sheets  "
    result = positive_profile([original, "Excel", "Basic knowledge of AutoCAD"])
    assert result == {
        "excel": original,
        "google_sheets": original,
        "autocad": "Basic knowledge of AutoCAD",
    }


@pytest.mark.parametrize("reverse", [False, True])
def test_negation_and_learning_conflicts_veto_canonical_skill_regardless_of_order(reverse):
    entries = [
        "JavaScript",
        "No experience with JS",
        "AutoCAD",
        "Planning to learn AutoCAD",
        "Comfortable using MS Excel",
        "Bookkeeping",
    ]
    if reverse:
        entries.reverse()
    assert positive_profile(entries) == {
        "excel": "Comfortable using MS Excel",
        "bookkeeping": "Bookkeeping",
    }


def test_mixed_unsafe_profile_entry_is_conservatively_vetoed_in_full():
    assert positive_profile(["Python", "SQL", "Python but no SQL"]) == {}


@pytest.mark.parametrize(
    "negative",
    [
        "Excel: none",
        "Excel is not familiar",
        "Excel (learning)",
        "Interested in Excel",
        "I am unfamiliar with Excel",
        "I lack Excel",
        "Uncertain about Excel",
        "Never taught Excel",
        "Interests in Excel",
    ],
)
def test_ambiguous_name_with_negative_suffix_vetoes_conflicting_entry(negative):
    assert ids(negative) == ["excel"]
    assert positive_profile(["Excel", negative]) == {}


@pytest.mark.parametrize(
    "entry",
    [
        "Canva or CapCut",
        "Either Canva or CapCut",
        "Canva and/or CapCut",
        "Canva and-or CapCut",
    ],
)
def test_profile_alternatives_do_not_assert_both_skills(entry):
    assert positive_profile([entry]) == {}
    assert positive_profile(["Canva", entry, "Python"]) == {"python": "Python"}


def test_job_alternatives_still_produce_lexical_mentions():
    assert ids("Excel or Google Sheets") == ["excel", "google_sheets"]
    assert not is_uncertain_or_negative("Excel or Google Sheets")


@pytest.mark.parametrize(
    "entry,skill",
    [
        ("不会 Python", "Python"),
        ("想学 Python", "Python"),
        ("想學 Python", "Python"),
        ("我正在学 Python", "Python"),
        ("我正在學 Python", "Python"),
        ("正在学习 Python", "Python"),
        ("没有 Excel 经验", "Excel"),
        ("不會 Python", "Python"),
        ("正在學習 Python", "Python"),
        ("沒有 Excel 經驗", "Excel"),
        ("Interests in Python", "Python"),
    ],
)
def test_chinese_negation_and_learning_or_plural_interests_cannot_support_profile(entry, skill):
    assert is_uncertain_or_negative(entry)
    assert positive_profile([entry]) == {}
    assert positive_profile([skill, entry]) == {}


@pytest.mark.parametrize(
    "entry,skills",
    [
        ("I know neither Python nor SQL", ["Python", "SQL"]),
        ("Python is unknown to me", ["Python"]),
        ("Python experience: zero", ["Python"]),
        ("Python knowledge is zero", ["Python"]),
        ("Python experience = 0", ["Python"]),
        ("I know neither Excel nor Word", ["Excel", "Word"]),
        ("Excel is unknown to me", ["Excel"]),
        ("No Office", ["Office"]),
        ("Interests in Office", ["Office"]),
        ("Office is unknown to me", ["Office"]),
        ("Neither Office nor Excel", ["Office", "Excel"]),
    ],
)
def test_explicit_absence_vetoes_all_conflicting_named_skills(entry, skills):
    assert is_uncertain_or_negative(entry)
    assert positive_profile([entry]) == {}
    assert positive_profile([*skills, entry]) == {}


def test_unknown_tools_and_acronyms_do_not_create_skills():
    assert mentions("UnlistedTool, AP, AR, CMS, EMR, CAD, PS, CC, RPA") == []
    assert positive_profile(["UnlistedTool", "an enthusiastic candidate"]) == {}


def test_profile_contract_limits_fail_closed_without_losing_late_conflicts():
    assert positive_profile(["Python"] * 100 + ["No Python"]) == {}
    assert positive_profile(["Python", "x" * 101 + " no Python"]) == {}
    assert positive_profile(["Python", None]) == {}
    assert mentions("Python" + " " * 40_000) == []
    assert is_uncertain_or_negative("Python" + " " * 40_000)


def test_result_is_immutable():
    item = mentions("Python")[0]
    assert isinstance(item, SkillMention)
    with pytest.raises(FrozenInstanceError):
        item.label = "Expert"
