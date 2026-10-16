"""Conservative evidence checks. Quote presence does not establish semantic entailment."""

import re
import unicodedata
from collections.abc import Iterator

from .models import (
    DurationFact,
    ExtractionPayload,
    HoursFact,
    JobExtractionSchemaV2,
    NumberFact,
    QualityIssue,
    QualityReport,
    TextFact,
    WorkModeFact,
    quality_version_for,
)

EvidenceFact = TextFact | NumberFact | HoursFact | DurationFact | WorkModeFact


def normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def hours_evidence_supported(fact: HoursFact, description: str) -> bool:
    """Require a stated number AND hour/period unit; never convert days or clock times.

    This deliberately conservative check validates numeric/unit provenance, not the
    interpretation of minimum/maximum, scope, feasibility or the full sentence.
    Unrecognized natural wording remains for manual review instead of being trusted.
    """
    quote = normalized(fact.evidence)
    if not quote or quote not in normalized(description):
        return False
    pattern = re.compile(
        r"(?<![\d.])(?P<first>\d+(?:\.\d+)?)\s*"
        r"(?:(?:-|–|—|to)\s*(?P<second>\d+(?:\.\d+)?)\s*)?"
        r"(?:working\s+)?(?:hours?|hrs?|h)\b\s*"
        r"(?:(?:per|a|each|every|/)\s*(?P<period>weeks?|wks?|days?)\b|(?P<adverb>weekly|daily)\b)",
        re.I,
    )
    supported = set()
    for match in pattern.finditer(quote):
        period = (match["period"] or match["adverb"]).casefold()
        unit = "hours_per_week" if period.startswith(("week", "wk")) else "hours_per_day"
        if unit == fact.unit:
            supported.add(float(match["first"]))
            if match["second"]:
                supported.add(float(match["second"]))
    return all(value is None or value in supported for value in (fact.minimum, fact.maximum))


def duration_evidence_supported(fact: DurationFact, description: str) -> bool:
    """Check the literal number and original duration unit, without conversion."""
    quote = normalized(fact.evidence)
    if not quote or quote not in normalized(description):
        return False
    pattern = re.compile(
        r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:-|–|—)?\s*(days?|weeks?|months?|years?)\b",
        re.I,
    )
    return any(
        float(value) == fact.value and unit.casefold().rstrip("s") == fact.unit.rstrip("s")
        for value, unit in pattern.findall(quote)
    )


def iter_facts(data: ExtractionPayload) -> Iterator[tuple[str, EvidenceFact]]:
    if data.summary:
        yield "summary", data.summary
    if isinstance(data, JobExtractionSchemaV2):
        for index, fact in enumerate(data.responsibilities):
            yield f"responsibilities.{index}", fact
            if fact.condition:
                yield f"responsibilities.{index}.condition", fact.condition
        for index, group in enumerate(data.requirement_groups):
            yield f"requirement_groups.{index}", group
            for position, atom in enumerate(group.requirements):
                path = f"requirement_groups.{index}.requirements.{position}"
                yield path, atom
                if atom.qualifier:
                    yield f"{path}.qualifier", atom.qualifier
        constraints = data.work_constraints
        for field in ("schedule", "hours", "minimum_duration"):
            fact = getattr(constraints, field)
            if fact is not None:
                yield f"work_constraints.{field}", fact
                if isinstance(fact, (HoursFact, DurationFact)) and fact.condition:
                    yield f"work_constraints.{field}.condition", fact.condition
        for field in ("work_modes", "locations"):
            for index, fact in enumerate(getattr(constraints, field)):
                yield f"work_constraints.{field}.{index}", fact
                if isinstance(fact, WorkModeFact) and fact.condition:
                    yield f"work_constraints.{field}.{index}.condition", fact.condition
    else:
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


def assess_quality(data: ExtractionPayload, description: str) -> QualityReport:
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
        if isinstance(fact, HoursFact) and not hours_evidence_supported(fact, description):
            issues.append(QualityIssue(code="numeric_hours_not_supported", field=path))
        if isinstance(fact, DurationFact) and not duration_evidence_supported(fact, description):
            issues.append(QualityIssue(code="numeric_duration_not_supported", field=path))
    if not facts:
        issues.append(QualityIssue(code="no_extracted_claims", field="extraction"))
    elif data.summary is None:
        issues.append(QualityIssue(code="summary_missing", field="summary"))
    if isinstance(data, JobExtractionSchemaV2):
        for index, group in enumerate(data.requirement_groups):
            for position, atom in enumerate(group.requirements):
                path = f"requirement_groups.{index}.requirements.{position}"
                if atom.kind == "skill" and re.search(
                    r"\b(?:interest(?:ed)?\s+in|willing(?:ness)?\s+to\s+learn|eager\s+to\s+learn|learning\s+intention)\b",
                    atom.value,
                    re.I,
                ):
                    issues.append(QualityIssue(code="interest_classified_as_skill", field=path))
                if atom.kind == "skill" and re.fullmatch(
                    r"(?:fluent\s+|spoken\s+|written\s+)?(?:mandarin|english|chinese|tamil|malay|japanese|korean|french|german|spanish)(?:\s+(?:language|proficiency))?",
                    atom.value,
                    re.I,
                ):
                    issues.append(QualityIssue(code="language_classified_as_skill", field=path))
    # Missing optional facts are not penalized; score is evidence coverage, not confidence probability.
    return QualityReport(
        quality_version=quality_version_for(
            "job-extraction-v2" if isinstance(data, JobExtractionSchemaV2) else "job-extraction-v1"
        ),
        score=round(matched / len(facts), 4) if facts else None,
        total_claims=len(facts),
        evidence_matched=matched,
        issues=issues,
    )
