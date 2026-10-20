"""Deterministic, explicit skill mentions; never proficiency or hiring judgments.

The vocabulary is deliberately closed and inspectable. Aliases mean the same named
skill, not related products: Office does not establish Excel, for example. Unknown
terms produce no signal. ``mentions`` is lexical, so callers must check the complete
source fact with ``is_uncertain_or_negative`` before treating a JD as affirmative.
"""

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

# Existing extraction/profile contract limits; fail closed instead of truncating
# text that might contain a later contradiction. No provider or schema dependency.
MAX_TEXT_LENGTH = 40_000
MAX_PROFILE_ENTRIES = 100
MAX_PROFILE_ENTRY_LENGTH = 100


@dataclass(frozen=True)
class SkillMention:
    skill_id: str
    label: str
    kind: Literal["specific", "general"]
    term: str


# Each row is (stable ID, display label, exact aliases). The label is also an
# alias. Longer names are matched first, and overlapping names are never inferred.
_SPECIFIC = (
    ("python", "Python", ()),
    ("javascript", "JavaScript", ("JS",)),
    ("typescript", "TypeScript", ("TS",)),
    ("java", "Java", ()),
    ("c", "C", ("C programming", "C language")),
    ("c++", "C++", ()),
    ("c#", "C#", ("C sharp",)),
    ("go", "Go", ("Golang", "Go programming", "Go language")),
    ("r", "R", ("R programming", "R language")),
    ("rust", "Rust", ("Rust programming",)),
    ("swift", "Swift", ("Swift programming",)),
    ("kotlin", "Kotlin", ()),
    ("php", "PHP", ()),
    ("ruby", "Ruby", ("Ruby programming",)),
    ("sql", "SQL", ()),
    ("pandas", "Pandas", ()),
    ("numpy", "NumPy", ()),
    ("scikit_learn", "scikit-learn", ("scikit learn", "sklearn")),
    ("matplotlib", "Matplotlib", ()),
    ("rest_api", "REST API", ("REST APIs", "RESTful API", "RESTful APIs")),
    ("linux", "Linux", ()),
    ("spark", "Apache Spark", ("Spark",)),
    ("hadoop", "Apache Hadoop", ("Hadoop",)),
    ("kafka", "Apache Kafka", ("Kafka",)),
    ("postgresql", "PostgreSQL", ("Postgres",)),
    ("mysql", "MySQL", ()),
    ("sqlite", "SQLite", ()),
    ("mongodb", "MongoDB", ()),
    ("react_native", "React Native", ("React-Native",)),
    ("react", "React", ("React.js", "ReactJS")),
    ("node.js", "Node.js", ("NodeJS", "Node JS")),
    ("vue", "Vue.js", ("Vue", "VueJS")),
    ("html", "HTML", ("HTML5",)),
    ("css", "CSS", ("CSS3",)),
    ("git", "Git", ()),
    ("docker", "Docker", ()),
    ("kubernetes", "Kubernetes", ()),
    ("fastapi", "FastAPI", ()),
    ("django", "Django", ()),
    ("flask", "Flask", ()),
    ("pytorch", "PyTorch", ()),
    ("tensorflow", "TensorFlow", ()),
    ("autocad", "AutoCAD", ("Auto CAD",)),
    ("solidworks", "SolidWorks", ()),
    ("revit", "Revit", ("Autodesk Revit",)),
    ("sketchup", "SketchUp", ()),
    ("matlab", "MATLAB", ()),
    ("excel", "Microsoft Excel", ("MS Excel", "Excel")),
    ("google_sheets", "Google Sheets", ()),
    (
        "microsoft_office",
        "Microsoft Office",
        ("MS Office", "Microsoft Office Suite", "MS Office Suite", "Office"),
    ),
    ("microsoft_word", "Microsoft Word", ("MS Word", "Word")),
    ("powerpoint", "Microsoft PowerPoint", ("MS PowerPoint", "PowerPoint")),
    ("google_docs", "Google Docs", ()),
    ("google_slides", "Google Slides", ()),
    ("google_workspace", "Google Workspace", ()),
    ("power_bi", "Power BI", ("Microsoft Power BI",)),
    ("tableau", "Tableau", ()),
    ("figma", "Figma", ()),
    ("canva", "Canva", ()),
    ("capcut", "CapCut", ("Cap Cut",)),
    ("adobe_creative_suite", "Adobe Creative Suite", ()),
    ("adobe_creative_cloud", "Adobe Creative Cloud", ()),
    ("photoshop", "Adobe Photoshop", ("Photoshop",)),
    ("lightroom", "Adobe Lightroom", ("Lightroom",)),
    ("illustrator", "Adobe Illustrator", ("Illustrator",)),
    ("indesign", "Adobe InDesign", ("InDesign",)),
    ("premiere_pro", "Adobe Premiere Pro", ("Premiere Pro",)),
    ("after_effects", "Adobe After Effects", ("After Effects",)),
    ("davinci_resolve", "DaVinci Resolve", ()),
    ("wordpress", "WordPress", ()),
    ("shopify", "Shopify", ()),
    ("salesforce", "Salesforce", ()),
    ("hubspot", "HubSpot", ()),
    ("quickbooks", "QuickBooks", ()),
    ("xero", "Xero", ()),
    ("accounting", "Accounting", ()),
    ("bookkeeping", "Bookkeeping", ("Book keeping", "Book-keeping")),
    ("financial_reporting", "Financial reporting", ()),
    ("financial_analysis", "Financial analysis", ()),
    ("accounts_payable", "Accounts payable", ()),
    ("accounts_receivable", "Accounts receivable", ()),
    ("bank_reconciliation", "Bank reconciliation", ()),
    ("payroll", "Payroll", ()),
    ("data_entry", "Data entry", ()),
    ("data_analysis", "Data analysis", ()),
    ("copywriting", "Copywriting", ()),
    ("content_creation", "Content creation", ()),
    ("social_media_management", "Social media management", ()),
    ("digital_marketing", "Digital marketing", ()),
    (
        "search_engine_optimization",
        "Search engine optimization",
        ("Search engine optimisation", "SEO"),
    ),
    ("graphic_design", "Graphic design", ()),
    ("video_editing", "Video editing", ()),
    ("photography", "Photography", ()),
    ("electronic_medical_records", "Electronic medical records", ("Electronic medical record",)),
    ("electronic_health_records", "Electronic health records", ("Electronic health record",)),
    ("clinic_management_systems", "Clinic management systems", ("Clinic management system",)),
    ("ultrasound", "Ultrasound", ()),
    ("patient_care", "Patient care", ()),
    ("medical_billing", "Medical billing", ()),
    ("appointment_scheduling", "Appointment scheduling", ()),
    ("inventory_management", "Inventory management", ()),
    ("customer_service", "Customer service", ()),
)

_GENERAL = (
    ("communication", "Communication", ("Communication skills",)),
    ("teamwork", "Teamwork", ("Team work", "Team player")),
    ("attention_to_detail", "Attention to detail", ("Detail-oriented", "Detail oriented")),
    ("interpersonal_skills", "Interpersonal skills", ()),
    ("time_management", "Time management", ()),
    ("problem_solving", "Problem solving", ("Problem-solving",)),
    ("organizational_skills", "Organizational skills", ("Organisational skills",)),
    ("adaptability", "Adaptability", ()),
    ("leadership", "Leadership", ()),
    ("critical_thinking", "Critical thinking", ()),
)


def _key(value: str) -> str:
    return " ".join(value.casefold().split())


_ALIASES = {
    _key(alias): (skill_id, label, kind)
    for kind, rows in (("specific", _SPECIFIC), ("general", _GENERAL))
    for skill_id, label, aliases in rows
    for alias in (label, *aliases)
}
_PATTERN = re.compile(
    r"(?<![\w+#.])(?:"
    + "|".join(
        re.escape(alias).replace(r"\ ", r"\s+")
        for alias in sorted(_ALIASES, key=lambda value: (-len(value), value))
    )
    + r")(?![\w+#]|\.\w)",
    re.IGNORECASE,
)

# These names are also ordinary words/letters. A bare skill-list entry is allowed;
# in prose they need nearby tool/language context, not capitalization alone.
_AMBIGUOUS = frozenset(
    {
        "c",
        "r",
        "go",
        "word",
        "excel",
        "office",
        "react",
        "rust",
        "swift",
        "ruby",
        "flask",
        "illustrator",
        "ts",
        "spark",
        "pandas",
    }
)
_BEFORE_CONTEXT = re.compile(
    r"\b(?:using|use|uses|used|skills?|tools?|languages?|technologies|"
    r"programming|coding|software|knowledge|experience|proficiency|proficient|"
    r"familiar|familiarity|competent|comfortable|confident|know|knows|learn|learning|"
    r"studying|taught|unfamiliar|inexperienced|interested|interests?|lack|lacking|"
    r"unsure|uncertain|neither|nor|no|not|without)(?:\s+(?:working\s+)?(?:of|with|in|using|about))?"
    r"\s*(?:[:=]\s*)?$",
    re.IGNORECASE,
)
_AFTER_CONTEXT = re.compile(
    r"^\s*(?:programming|language|code|coding|development|developer|framework|"
    r"software|skills?|knowledge|experience|proficiency|required|preferred|"
    r"spreadsheets?|formulas?|macros?|pivot\s+tables?|documents?|suite)\b"
    r"|^\s*[:=(\[-]?\s*(?:(?:is|are|was|were)\s+)?"
    r"(?:no|none|not|never|unfamiliar|unknown|learning|studying)\b",
    re.IGNORECASE,
)
_LIST_SEPARATOR = re.compile(r"^\s*(?:[,/|&;+]|\band\b|\bor\b|\bnor\b)\s*$", re.IGNORECASE)
_CHINESE_UNCERTAIN = re.compile(
    r"不会|不會|没有|沒有|不懂|不了解|不熟悉|尚未|未学|未學|"
    r"(?:想|正在)[学學]|学习|學習"
)
_OFFICE_TOOL_BEFORE = re.compile(
    r"\b(?:using|use|uses|used|software|tools?|"
    r"proficient\s+in|knowledge\s+of|familiar\s+with|experience\s+with)\s*$",
    re.IGNORECASE,
)
_OFFICE_TOOL_AFTER = re.compile(
    r"^\s+(?:software|suite|applications?|programs?|tools?)\b", re.IGNORECASE
)
_LEVEL_ANNOTATION = re.compile(
    r"^\s*\(\s*(?:basic|beginner|intermediate|advanced|expert|proficient)"
    r"(?:\s+level)?\s*\)\s*[.!;]?\s*$",
    re.IGNORECASE,
)


def _ambiguity_status(text: str, match: re.Match[str]) -> bool | None:
    """True means explicit context, False an ordinary use, None needs list context."""
    term = _key(match.group())
    if term not in _AMBIGUOUS:
        return True
    if text.strip(" \t\r\n.:;!()[]") == match.group():
        return True
    before, after = text[: match.start()], text[match.end() :]
    # The profile selector uses standalone tags such as "Excel (Advanced)".
    # Recognize the named tool without validating the user's claimed level; do
    # not broaden this to ordinary prose such as "We excel (advanced teams)".
    if not before.strip() and _LEVEL_ANNOTATION.fullmatch(after):
        return True
    # Common verb/location uses remain ordinary words even around context words.
    if term == "excel" and re.match(r"\s+(?:at|in)\b", after, re.IGNORECASE):
        return False
    if term == "go" and re.match(
        r"\s+(?:to|for|with|ahead|beyond|back|through|over)\b", after, re.IGNORECASE
    ):
        return False
    if term == "react" and re.match(
        r"\s+(?:to|with|quickly|appropriately)\b", after, re.IGNORECASE
    ):
        return False
    if term == "word" and re.match(
        r"\s+(?:of\s+(?:mouth|advice)|processing)\b", after, re.IGNORECASE
    ):
        return False
    if term in {"word", "office", "illustrator", "flask", "ruby", "rust", "swift"} and re.search(
        r"\b(?:a|an|the|our|your|their|this|that)\s+$", before, re.IGNORECASE
    ):
        return False
    if term in {"c", "r", "ts"} and match.group() != match.group().upper():
        return False
    if term == "c" and re.search(
        r"\b(?:grade|category|class|vitamin|hepatitis)\s+$", before, re.IGNORECASE
    ):
        return False
    if term == "r" and re.match(r"\s*&", after):
        return False
    if _CHINESE_UNCERTAIN.search(before[-60:]) or _CHINESE_UNCERTAIN.search(after[:60]):
        return True
    if term == "office":
        if _OFFICE_TOOL_BEFORE.search(before[-60:]) or _OFFICE_TOOL_AFTER.search(after[:60]):
            return True
        if is_uncertain_or_negative(before[-60:] + " Office " + after[:60]) and (
            _BEFORE_CONTEXT.search(before[-60:]) or _AFTER_CONTEXT.search(after[:60])
        ):
            return True
        if re.search(r"\b(?:in|at|to|from)\s*$", before, re.IGNORECASE):
            return False
        return None
    if _BEFORE_CONTEXT.search(before[-60:]) or _AFTER_CONTEXT.search(after[:60]):
        return True
    return None


def _resolve_list_context(text: str, candidates: list[re.Match[str]]) -> list[bool | None]:
    """Resolve adjacent skill lists in linear passes, without recursive matching."""
    accepted = [_ambiguity_status(text, match) for match in candidates]
    groups: list[list[int]] = []
    for index, match in enumerate(candidates):
        if index and _LIST_SEPARATOR.fullmatch(text[candidates[index - 1].end() : match.start()]):
            groups[-1].append(index)
        else:
            groups.append([index])
    for group in groups:
        first, last = candidates[group[0]], candidates[group[-1]]
        # A complete list such as "Excel, Word" is itself explicit tool context.
        bare_list = not text[: first.start()].strip(" \t\r\n.:;!()[]") and not text[
            last.end() :
        ].strip(" \t\r\n.:;!()[]")
        if bare_list or any(accepted[index] is True for index in group):
            for index in group:
                if accepted[index] is None:
                    accepted[index] = True
    return accepted


def mentions(text: str) -> list[SkillMention]:
    """Return deduplicated named skills in source order, with verbatim matched terms.

    This function does not interpret negation, alternatives, proficiency, years,
    or suitability. In particular, mentioning two alternatives does not establish
    that both are requirements. Oversized input returns no evidence.
    """
    if not text or len(text) > MAX_TEXT_LENGTH:
        return []
    candidates = list(_PATTERN.finditer(text))
    accepted = _resolve_list_context(text, candidates)
    result: dict[str, SkillMention] = {}
    for match, resolved in zip(candidates, accepted, strict=True):
        if resolved is not True:
            continue
        skill_id, label, kind = _ALIASES[_key(match.group())]
        result.setdefault(skill_id, SkillMention(skill_id, label, kind, match.group()))
    return list(result.values())


_UNCERTAIN = re.compile(
    r"\b(?:no|not|never|without|none|cannot|unable|lack|lacks|lacked|lacking|"
    r"unfamiliar|inexperienced|unsure|uncertain|unknown|neither|nor|maybe|possibly|might|"
    r"interested|interests?|learning|studying|learner)\b"
    r"|\b(?:do|does|did|can|could|would|has|have|had|is|are|was|were)n['’]t\b"
    r"|\bwon['’]t\b"
    r"|\b(?:to|will|shall|should|must)\s+(?:learn|study)\b"
    r"|\b(?:limited|little|zero)\s+(?:experience|knowledge|proficiency)\b"
    r"|\b(?:experience|knowledge|proficiency)\s*[:=-]?\s*(?:is\s+)?(?:zero|0)\b"
    r"|\b(?:training\s+(?:is\s+|will\s+be\s+)?provided|will\s+be\s+(?:trained|taught))\b",
    re.IGNORECASE,
)
_LEARNING_NOUNS = re.compile(
    r"\b(?:(?:machine|deep|reinforcement)\s+learning|learning\s+management\s+systems?)\b",
    re.IGNORECASE,
)
_PROFILE_ALTERNATIVES = re.compile(r"\b(?:or|either)\b|或者|或是|二选一|二選一", re.IGNORECASE)


def is_uncertain_or_negative(text: str) -> bool:
    """Conservatively reject an entire fact/entry containing unsafe claim wording.

    This is intentionally not a grammatical negation resolver. Mixed affirmative
    and negative clauses need manual review. Basic knowledge is affirmative;
    wanting or planning to learn is not. Domain nouns such as machine learning
    do not themselves signal learning-only experience.
    """
    if len(text) > MAX_TEXT_LENGTH:
        return True
    normalized = unicodedata.normalize("NFKC", text)
    normalized = _LEARNING_NOUNS.sub("", normalized)
    return bool(_UNCERTAIN.search(normalized) or _CHINESE_UNCERTAIN.search(normalized))


def positive_profile(skills: list[str]) -> dict[str, str]:
    """Map explicit affirmative skills to their original profile-entry evidence.

    Any uncertain/negative entry or ambiguous alternative vetoes its named skills
    across the entire list, even if another entry is affirmative. Mixed entries are
    conservatively vetoed in full. Keep the first original affirmative entry; never manufacture a claim
    of mastery or rewrite the user's words. Invalid legacy input fails closed.
    """
    if len(skills) > MAX_PROFILE_ENTRIES or any(
        not isinstance(entry, str) or len(entry) > MAX_PROFILE_ENTRY_LENGTH for entry in skills
    ):
        return {}
    affirmative: dict[str, str] = {}
    vetoed: set[str] = set()
    for entry in skills:
        found = mentions(entry)
        if is_uncertain_or_negative(entry) or _PROFILE_ALTERNATIVES.search(entry):
            vetoed.update(item.skill_id for item in found)
        else:
            for item in found:
                affirmative.setdefault(item.skill_id, entry)
    return {
        skill_id: evidence for skill_id, evidence in affirmative.items() if skill_id not in vetoed
    }
