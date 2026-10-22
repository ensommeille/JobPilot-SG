"""Bounded activity evidence, separate from applicant-requirement comparisons.

These rules recognize related engineering work, not semantic equivalence of a
whole duty, authorship verification, proficiency, or applicant eligibility.
"""

import re
from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, Field

from app.job_extraction.models import TextFact
from app.job_extraction.quality import normalized
from app.skill_signals import is_uncertain_or_negative

MAX_EXPERIENCE_LENGTH = 10_000
MAX_UNITS = 120
MAX_UNIT_LENGTH = 2_500


class ResponsibilityMatch(BaseModel):
    responsibility: str
    job_evidence: str
    priority: Literal["primary", "secondary", "conditional", "unspecified"] = "unspecified"
    condition: TextFact | None = None
    outcome: Literal["related_evidence", "unknown"]
    reason: str
    activities: list[str] = Field(default_factory=list)
    profile_evidence: list[str] = Field(default_factory=list)


# A closed bridge prevents an action from borrowing an unrelated object later in
# the sentence: "Built a poster explaining APIs" is not API implementation.
_BRIDGE = (
    r"a|an|the|our|new|existing|multiple|several|custom|secure|scalable|reusable|"
    r"robust|production|simple|small|large|basic|complex|internal|automated|"
    r"and|testing|maintaining|developing|implementing|building|deploying|"
    r"[1-9]\d{0,3}"
)
_BUILD = r"build|built|building|develop(?:ed|ing|s)?|implement(?:ed|ing|s)?|creat(?:e|ed|ing)"
_SOFTWARE_OBJECT = (
    r"(?:web|mobile|desktop|software|backend|front[- ]?end|server[- ]side|client[- ]side)"
    r"\s+(?:applications?|apps?|systems?|services?|tools?|features?|components?|interfaces?)"
    r"|(?:applications?|apps?)\s+(?:for|with|using)\b"
)
_TECHNICAL_FEATURE = (
    r"(?:search|retrieval)\s+(?:tracing|pipelines?|systems?|features?|services?)|"
    r"(?:citation[- ]id|document|data|input)\s+validation|"
    r"(?:automatic|document|search|database)\s+indexing|"
    r"(?:role[- ]based|user|admin|management)\s+(?:workspaces?|dashboards?|portals?)|"
    r"(?:server[- ]enforced|role[- ]based|user)\s+access\s+control|"
    r"(?:user\s+)?authentication|authorization|"
    r"(?:persistent|automated)\s+workflows?|"
    r"(?:retry|validation|permission|session)\s+(?:handling|logic|checks?|management)"
)
_SOFTWARE_CONTEXT = re.compile(
    r"\b(?:software|apps?|applications?|code|coding|backend|frontend|server|"
    r"retrieval|indexing|idempotency|retries|database|containers?|docker|"
    r"bug\s+fixing|web\s+development)\b",
    re.I,
)
_NON_SOFTWARE_TEST = re.compile(
    r"\b(?:medical|clinical|chemical|chemistry|laboratory|circuits?|hardware|"
    r"soil|blood|specimens?|mechanical)\b",
    re.I,
)
_NON_SOFTWARE_API = re.compile(r"\b(?:pharmaceutical|chemical|active\s+ingredients?)\b", re.I)
_EXPLICIT_SOFTWARE_API = re.compile(r"\b(?:REST(?:ful)?|HTTP|software|endpoints?)\b", re.I)


def _action_object(verbs: str, objects: str) -> re.Pattern[str]:
    separator = r"(?:\s+|,\s*)"
    return re.compile(
        rf"\b(?:{verbs})\b{separator}(?:(?:{_BRIDGE}){separator}){{0,8}}(?:{objects})\b",
        re.I,
    )


# Keep this extension local to implementation activity: writing documentation,
# requirements or reviews must not borrow the preceding word "software".
_BUILD_SOFTWARE = _action_object(
    _BUILD + r"|writ(?:e|es|ing)|wrote",
    _SOFTWARE_OBJECT + r"|software(?=\s*(?:[.!?,;]|$)|\s+(?:that|which|for|with|using)\b)",
)
_BUILD_FEATURE = _action_object(_BUILD, _TECHNICAL_FEATURE)
_BUILD_API = _action_object(
    _BUILD,
    r"(?:rest(?:ful)?\s+)?apis?(?!\s+(?:clients?|consumers?|requests?|calls?|tests?|"
    r"documentation|specifications?|designs?)\b)|application\s+programming\s+interfaces?",
)
_TEST_VERBS = (
    r"writ(?:e|ing)|wrote|implement(?:ed|ing)?|creat(?:e|ed|ing)|run|ran|execut(?:e|ed|ing)"
)
_TEST_ARTIFACT = _action_object(
    _TEST_VERBS,
    r"(?:(?:automated|unit|integration|end[- ]to[- ]end|regression|software|api)\s+){1,3}"
    r"tests?(?:\s+(?:cases?|suites?))?",
)
_TEST_SOFTWARE = _action_object(r"test(?:ed|ing|s)?", _SOFTWARE_OBJECT)
_COUNTED_TESTS = re.compile(
    r"\b[1-9]\d{0,4}\s+(?:automated|unit|integration|end[- ]to[- ]end|regression)"
    r"\s+(?:software\s+)?tests?\b",
    re.I,
)
_DEBUG = _action_object(
    r"fix(?:ed|ing|es)?|resolv(?:e|ed|ing)|debug(?:ged|ging)?",
    r"(?:(?:software|code|application|app)\s+)?bugs?|"
    r"(?:software|code|application|app)\s+(?:defects?|errors?)",
)
_DEPLOY = _action_object(
    r"deploy(?:ed|ing|s)?|releas(?:e|ed|ing)|publish(?:ed|ing)?",
    _SOFTWARE_OBJECT + r"|(?:web|cloud|software|backend|application)\s+services?|containers?",
)
_AUTOMATE_DATA = _action_object(
    _BUILD + r"|automat(?:e|ed|ing)",
    r"(?:data|etl|elt|ingestion|data[- ]processing)\s+(?:pipelines?|workflows?)",
)
_FUTURE_OR_OBSERVATION = re.compile(
    r"\b(?:plan(?:ned|s)?|planning|want(?:ed|s)?|hop(?:e|ed|ing)|aim(?:ed|ing)?|"
    r"intend(?:ed|ing)?|aspir(?:e|ing))\s+to\b"
    r"|\b(?:will|would|could|should|shall|may|might|can)\s+(?:\w+\s+){0,2}"
    r"(?:build|develop|implement|create|write|run|test|deploy|fix|automate)\b"
    r"|\b(?:if|unless|hypothetical|proposed|proposal|planned|wish|wishlist)\b"
    r"|\b(?:observed|watched|shadowed|read\s+about|tutorial\s+(?:on|about))\b"
    r"|\b(?:team|teammate|colleague|mentor|supervisor|instructor|manager|others?)\s+"
    r"(?:alone\s+)?(?:built|developed|implemented|created|wrote|ran|tested|deployed|fixed)\b",
    re.I,
)
_EXPLICIT_NEGATION = re.compile(
    r"\b(?:no|not|never|without|none|cannot|unable|lack|lacks|lacked|lacking)\b"
    r"|\b(?:did|do|does|have|has|had|was|were|is|are|can|could)n['’]t\b",
    re.I,
)
_ALTERNATIVE = re.compile(r"\b(?:or|either)\b|或者|或是|二选一|二選一", re.I)
_PAST_ACTION = re.compile(
    r"^(?:built|developed|implemented|created|wrote|ran|executed|tested|fixed|"
    r"resolved|debugged|deployed|released|published|automated)\b",
    re.I,
)
_FIRST_PERSON = re.compile(
    r"^\s*(?:I|we)\s+(?:(?:have|had)\s+)?(?:regularly\s+|currently\s+)?$", re.I
)
_NONCLAIM_SECTION = re.compile(
    r"\b(?:job\s+description|job\s+requirements|example(?:\s+answer)?|sample(?:\s+resume)?|"
    r"future\s+plans|career\s+goals|wishlist|quoted\s+text)\s*:",
    re.I,
)
_CONDITIONAL_SCOPE = re.compile(
    r"\b(?:if|unless|when\s+(?:needed|assigned|required|requested)|as\s+(?:needed|required)|"
    r"subject\s+to|provided\s+that|may\s+(?:also\s+)?(?:be\s+asked|help|assist)|"
    r"depending\s+on|only\s+(?:once|when|if|after|with)|upon\s+approval)\b",
    re.I,
)
_SECONDARY_SCOPE = re.compile(r"\b(?:secondary|occasional|occasionally|optional)\b", re.I)


def _units(text: str) -> list[str]:
    """Keep original excerpts, including punctuation; never join separate claims."""
    return [
        piece.strip() for piece in re.split(r"(?<=[.!?])\s+|[\r\n]+|[•●]\s*", text) if piece.strip()
    ]


def _source_action_prefix(prefix: str) -> bool:
    prefix = prefix.lstrip("-*• ")
    prefix = re.sub(r"^(?:if|when|as|provided\s+that)[^;.!?]{1,120},\s*", "", prefix, flags=re.I)
    prefix = re.sub(r"^(?:you|we)\s+(?:(?:will|shall|must|may)\s+)?", "", prefix, flags=re.I)
    prefix = re.sub(
        r"^(?:(?:assist|help|support|participate|contribute)(?:ing)?\s+(?:(?:in|with|to)\s+)?)+",
        "",
        prefix,
        flags=re.I,
    )
    prefix = re.sub(
        r"^(?:(?:developing|testing|maintaining|building|implementing|deploying)"
        r"(?:,\s*|\s+and\s+|\s*))+$",
        "",
        prefix,
        flags=re.I,
    )
    return not prefix.strip()


def _claim_match(
    pattern: re.Pattern[str], text: str, source: bool, *, negative: bool = False
) -> bool:
    return any(
        negative
        or (
            _source_action_prefix(text[: match.start()])
            if source
            else (
                bool(_PAST_ACTION.match(match.group())) and not text[: match.start()].strip("-*• ")
            )
            or bool(_FIRST_PERSON.fullmatch(text[: match.start()]))
        )
        for match in pattern.finditer(text)
    )


def _counted_test_artifact(text: str) -> bool:
    """An attached project artifact is related evidence, not proof tests were run."""
    head, separator, tail = text.partition(";")
    if not separator or not _COUNTED_TESTS.match(tail.strip()):
        return False
    if re.search(
        r"\b(?:required|planned|target|expected|needed|todo|goal|upcoming|copied|provided)\b"
        r"|to\s+be|\bby\s+(?:my\s+|the\s+)?(?:mentor|colleague|team|instructor|supervisor)",
        tail,
        re.I,
    ):
        return False
    return bool(
        _claim_match(_BUILD_SOFTWARE, head, False)
        or _claim_match(_BUILD_API, head, False)
        or (_claim_match(_BUILD_FEATURE, head, False) and _SOFTWARE_CONTEXT.search(head))
    )


def _activities(text: str, *, source: bool = False, negative: bool = False) -> set[str]:
    found: set[str] = set()
    if _claim_match(_BUILD_SOFTWARE, text, source, negative=negative) or (
        _claim_match(_BUILD_FEATURE, text, source, negative=negative)
        and _SOFTWARE_CONTEXT.search(text)
    ):
        found.add("software_features")
    if (
        source
        and re.match(r"(?:support|assist\s+(?:in|with))\s+feature\s+development\b", text, re.I)
        and _SOFTWARE_CONTEXT.search(text)
    ):
        found.add("software_features")
    if _claim_match(_BUILD_API, text, source, negative=negative) and (
        not _NON_SOFTWARE_API.search(text) or _EXPLICIT_SOFTWARE_API.search(text)
    ):
        found.add("api_implementation")
    if not _NON_SOFTWARE_TEST.search(text) and (
        _claim_match(_TEST_ARTIFACT, text, source, negative=negative)
        or _claim_match(_TEST_SOFTWARE, text, source, negative=negative)
        or (not source and _counted_test_artifact(text))
    ):
        found.add("software_testing")
    if _claim_match(_DEBUG, text, source, negative=negative) or (
        source
        and re.match(r"(?:support|assist\s+(?:in|with))\b", text, re.I)
        and re.search(r"\bbug\s+fixing\b", text, re.I)
    ):
        found.add("software_debugging")
    if _claim_match(_DEPLOY, text, source, negative=negative):
        found.add("software_deployment")
    if _claim_match(_AUTOMATE_DATA, text, source, negative=negative):
        found.add("data_automation")
    if negative and re.search(r"\b(?:web|software|application|app)\s+development\b", text, re.I):
        found.add("software_features")
    return found


def _project_evidence(experience: str | None) -> dict[str, str]:
    if not isinstance(experience, str) or not experience.strip():
        return {}
    if len(experience) > MAX_EXPERIENCE_LENGTH:
        return {}
    # Quoted/copied examples are not personal claims. Rather than guessing where
    # such a section ends, ask the user to separate it from their project account.
    if _NONCLAIM_SECTION.search(experience):
        return {}
    units = _units(experience)
    if len(units) > MAX_UNITS or any(len(unit) > MAX_UNIT_LENGTH for unit in units):
        return {}
    evidence: dict[str, str] = {}
    vetoed: set[str] = set()
    for unit in units:
        activities = _activities(unit)
        if _EXPLICIT_NEGATION.search(unit):
            vetoed.update(_activities(unit, negative=True))
        if (
            is_uncertain_or_negative(unit)
            or _FUTURE_OR_OBSERVATION.search(unit)
            or _ALTERNATIVE.search(unit)
        ):
            continue
        for activity in sorted(activities):
            evidence.setdefault(activity, unit)
    return {activity: quote for activity, quote in evidence.items() if activity not in vetoed}


def has_project_evidence(experience: str | None) -> bool:
    """Whether saved experience contains a recognized, affirmative activity claim."""
    return bool(_project_evidence(experience))


def prepare_project_evidence(experience: str | None) -> dict[str, str]:
    """Prepare evidence once for a request; callers must not accept it from clients."""
    return _project_evidence(experience)


def _nearby_scope(description: str, evidence: str) -> list[str]:
    """Preserve an immediately preceding scope heading or attached scope sentence."""
    found: list[str] = []
    lines = [line.strip() for line in description.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if normalized(evidence) in normalized(line) and index:
            previous = lines[index - 1]
            if previous.endswith(":") and (
                _CONDITIONAL_SCOPE.search(previous) or _SECONDARY_SCOPE.search(previous)
            ):
                found.append(previous)
    full, needle = normalized(description), normalized(evidence)
    if needle:
        for occurrence in re.finditer(re.escape(needle), full):
            following = re.match(
                r"\s*(?:This|That|The)\s+(?:duty|task|activity|work|responsibility)\b[^.!?]{0,180}",
                full[occurrence.end() :],
                re.I,
            )
            if following:
                found.append(following.group())
    return found


def match_responsibilities(
    responsibilities: Sequence[TextFact],
    description: str,
    experience: str | None,
    *,
    project_evidence: dict[str, str] | None = None,
) -> list[ResponsibilityMatch]:
    """Pair related activities, preserving complete duty scope and original quotes."""
    # Delayed import avoids a cycle when job_matching exposes this additive model.
    from app.job_matching import quote_contexts

    projects = _project_evidence(experience) if project_evidence is None else project_evidence
    rows: list[ResponsibilityMatch] = []
    for fact in responsibilities:
        row = ResponsibilityMatch(
            responsibility=fact.value,
            job_evidence=fact.evidence,
            priority=getattr(fact, "priority", "unspecified"),
            condition=getattr(fact, "condition", None),
            outcome="unknown",
            reason="no_related_project_evidence",
        )
        rows.append(row)
        contexts = quote_contexts(description, fact.evidence)
        if not contexts or (
            row.condition and normalized(row.condition.evidence) not in normalized(description)
        ):
            row.reason = "source_unverified"
            continue
        source_contexts = list(contexts)
        contexts.extend(_nearby_scope(description, fact.evidence))
        if any(
            is_uncertain_or_negative(text)
            or re.search(r"\b(?:learn|study|train)\s+(?:how\s+)?to\b", text, re.I)
            for text in (fact.evidence, *contexts)
        ):
            row.reason = "source_context_uncertain"
            continue
        if (
            any(_CONDITIONAL_SCOPE.search(context) for context in contexts)
            and row.priority != "conditional"
        ) or (
            any(_SECONDARY_SCOPE.search(context) for context in contexts)
            and row.priority not in {"secondary", "conditional"}
        ):
            row.reason = "scope_unverified"
            continue
        # Never invent an activity from the model's paraphrase, a clipped noun, or
        # an action in a neighboring sentence. Each complete source unit stands alone.
        activities = {
            activity
            for unit in _units(fact.evidence)
            for activity in _activities(unit, source=True)
        }
        for context in source_contexts:
            contextual_activities = {
                activity for unit in _units(context) for activity in _activities(unit, source=True)
            }
            activities.intersection_update(contextual_activities)
        if not activities:
            row.reason = "unsupported_activity"
            continue
        shared = sorted(activities.intersection(projects))
        if not shared:
            continue
        row.outcome = "related_evidence"
        row.activities = shared
        row.profile_evidence = list(dict.fromkeys(projects[activity] for activity in shared))
        row.reason = (
            "related_conditional_activity" if row.priority == "conditional" else "related_activity"
        )
    return rows
