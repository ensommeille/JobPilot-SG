"""Conservative evidence scope checks, not a general language entailment engine."""

import re

# These are action scopes, not technology names. A named tool can establish
# familiarity without establishing that the person performed a requested action.
ACTION_FAMILIES = {
    "build": r"\b(?:built|build(?:ing|s)?|creat(?:e|ed|ing|es)|construct(?:ed|ing|s)?|develop(?:ed|ing|s)?|implement(?:ed|ing|s|ation)?)\b",
    "train": r"\btrain(?:ed|ing|s)?\b(?!\s+(?:data|datasets?|sets?|examples?)\b)",
    "fine-tune": r"\bfine[\s\-\u2011]?tun(?:e|ed|ing|es)\b",
    "optimise": r"\boptimi[sz](?:e|ed|ing|es|ation|ations)\b",
    "evaluate": r"\b(?:evaluat(?:e|ed|ing|es|ion|ions)|assess(?:ed|ing|es|ment)?)\b",
    "deploy": r"\bdeploy(?:ed|ing|s|ment|ments)?\b",
    "design": r"\bdesign(?:ed|ing|s)?\b",
    "maintain": r"\bmaintain(?:ed|ing|s)?\b",
    "test": r"\btest(?:ed|ing|s)?\b",
    "debug": r"\b(?:debug(?:ged|ging|s)?|troubleshoot(?:ing|s)?|troubleshot)\b",
    "integrate": r"\bintegrat(?:e|ed|ing|es|ion)\b",
    "write": r"\b(?:writ(?:e|ing|es)|wrote|written)\b",
    "use": r"\b(?:used|using|uses?)\b",
}
KNOWLEDGE_SCOPE = re.compile(
    r"^\s*(?:familiarity|familiar|knowledge|understanding|proficien(?:t|cy)|"
    r"strong foundation|foundational knowledge|basic understanding)\b",
    re.I,
)
NEGATED_ACTIVITY = re.compile(
    r"\b(?:not|never|without|cannot|unable|planned|planning|intend|would|could|might|"
    r"didn['’]t|don['’]t|haven['’]t|hasn['’]t|hadn['’]t|couldn['’]t)"
    r"(?:\s+\w+){0,2}\s*$",
    re.I,
)
FRESH_GRADUATES = re.compile(
    r"\b(?:fresh|new|recent)\s+graduates?\b.{0,45}\b(?:welcome|apply|accepted|eligible)\b"
    r"|\b(?:welcome|open)\b.{0,35}\b(?:fresh|new|recent)\s+graduates?\b",
    re.I,
)
ZERO_RANGE = re.compile(r"\b0\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:years?|yrs?)\b", re.I)


def actions(text: str) -> set[str]:
    return {name for name, pattern in ACTION_FAMILIES.items() if re.search(pattern, text, re.I)}


def performed_actions(text: str) -> set[str]:
    patterns = {
        **ACTION_FAMILIES,
        "build": ACTION_FAMILIES["build"].replace("|ation", ""),
        "optimise": r"\boptimi[sz](?:e|ed|ing|es)\b",
        "evaluate": r"\b(?:evaluat(?:e|ed|ing|es)|assess(?:ed|ing|es)?)\b",
        "deploy": r"\bdeploy(?:ed|ing|s)?\b",
        "integrate": r"\bintegrat(?:e|ed|ing|es)\b",
    }
    return {
        name
        for name, pattern in patterns.items()
        if any(
            not NEGATED_ACTIVITY.search(text[max(0, match.start() - 55) : match.start()])
            for match in re.finditer(pattern, text, re.I)
        )
    }


def activity_evidence_issue(requirement: str, category: str, field, quote) -> str | None:
    """Only lower a concrete activity claim; do not infer a person's ability."""
    required = actions(requirement)
    if KNOWLEDGE_SCOPE.search(requirement) and category != "responsibility":
        return None
    experience_claim = category in {"experience", "responsibility"} or bool(
        re.search(r"\bexperience\b", requirement, re.I)
    )
    if not required and not experience_claim:
        return None
    if field != "experience":
        return (
            "A named tool or education entry does not establish the requested hands-on activity. "
            "An explicit experience passage is needed."
        )
    if not quote:
        return (
            "The displayed passage does not explicitly establish the requested performed activity."
        )
    if not required:
        if performed_actions(quote) or re.search(r"\bexperience\b", quote, re.I):
            return None
        return "A technology list or heading does not establish the requested hands-on experience."
    # 'Using Python' describes the means of a build/train activity. Requiring
    # a second literal 'used' would reject an equivalent 'built ... with Python'.
    if len(required) > 1:
        required.discard("use")
    # Preserve alternatives: this scope check cannot decide which complete OR
    # branch is intended. Per-branch checks below still validate concrete actions.
    if re.search(r"\bor\b", requirement, re.I):
        return None
    missing = required - performed_actions(quote)
    if missing:
        return (
            "The displayed experience passage does not establish every requested action ("
            + ", ".join(sorted(missing))
            + "). Tool lists, project headings and related activities are not performance evidence."
        )
    return None


def compound_scope_issue(requirement: str, operator: str, category: str) -> str | None:
    """Protect an explicit outer AND without parsing arbitrary mixed expressions.

    This uses the assessed condition, never neighbouring text from a long JD
    range. Parenthetical alternatives do not replace the outer conjunction.
    """
    # Eligibility prose often uses inclusive 'students and graduates' or names
    # disciplines joined by 'and'. This bounded applicant-capability check must
    # not reinterpret those as simultaneous personal qualifications.
    if category not in {"skill", "experience", "responsibility"}:
        return None
    depth, outside = 0, []
    for char in requirement:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            outside.append(char)
    text = "".join(outside)
    has_and = bool(re.search(r"\band\b", text, re.I))
    has_or = bool(re.search(r"\bor\b", text, re.I))
    if has_and and (operator not in {"all_of", "unspecified"} or has_or):
        return (
            "The stated condition contains an AND or mixed AND/OR scope that these checks "
            "do not faithfully establish. A single branch cannot support the whole condition."
        )
    return None


def zero_experience_entry_route(text: str) -> bool:
    """An explicit zero-year/fresh-graduate route is not a positive years minimum."""
    return bool(ZERO_RANGE.search(text) and FRESH_GRADUATES.search(text))
