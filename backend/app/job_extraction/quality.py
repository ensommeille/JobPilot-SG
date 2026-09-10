"""Conservative evidence checks. Quote presence does not establish semantic entailment."""

import re
import unicodedata
from collections.abc import Iterator

from .models import JobExtractionSchema, NumberFact, QualityIssue, QualityReport, TextFact


def normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def iter_facts(data: JobExtractionSchema) -> Iterator[tuple[str, TextFact | NumberFact]]:
    if data.summary:
        yield "summary", data.summary
    for field in (
        "responsibilities",
        "required_skills",
        "preferred_skills",
        "required_qualifications",
        "preferred_qualifications",
        "languages",
    ):
        for index, fact in enumerate(getattr(data, field)):
            yield f"{field}.{index}", fact
    for index, fact in enumerate(data.education.fields_of_study):
        yield f"education.fields_of_study.{index}", fact
    for field in ("degree", "enrollment"):
        fact = getattr(data.education, field)
        if fact:
            yield f"education.{field}", fact
    for field in ("requirement", "minimum_years"):
        fact = getattr(data.experience, field)
        if fact:
            yield f"experience.{field}", fact


def assess_quality(data: JobExtractionSchema, description: str) -> QualityReport:
    source = normalized(description)
    facts = list(iter_facts(data))
    issues: list[QualityIssue] = []
    matched = 0
    for path, fact in facts:
        if normalized(fact.evidence) not in source:
            issues.append(QualityIssue(code="evidence_not_in_description", field=path))
        else:
            matched += 1
        if isinstance(fact, NumberFact):
            evidence = fact.evidence.casefold()
            years = re.findall(
                r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:\+|or\s+more|minimum)?\s*(?:years?|yrs?)\b",
                evidence,
            )
            if fact.value not in [float(value) for value in years]:
                issues.append(QualityIssue(code="numeric_years_not_supported", field=path))
            if re.search(
                r"\d+(?:\.\d+)?\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?\s*(?:years?|yrs?)\b", evidence
            ):
                issues.append(QualityIssue(code="ambiguous_numeric_years_range", field=path))
    if not facts:
        issues.append(QualityIssue(code="no_extracted_claims", field="extraction"))
    elif data.summary is None:
        issues.append(QualityIssue(code="summary_missing", field="summary"))
    # Missing optional facts are not penalized; score is evidence coverage, not confidence probability.
    return QualityReport(
        score=round(matched / len(facts), 4) if facts else None,
        total_claims=len(facts),
        evidence_matched=matched,
        issues=issues,
    )
