"""Small role-aware recall adjustments, never qualification decisions.

Raw skill overlap still recalls unfamiliar roles. These weights stop a repeated
generic tool such as Python from outweighing clearly evidenced work domains.
"""

import re

SOFTWARE = re.compile(
    r"\b(?:software|back[ -]?end|front[ -]?end|full[ -]?stack|web (?:app|application|develop)|"
    r"rest(?:ful)? api|microservice|spring boot|django|react|java|golang)\b",
    re.I,
)
ML = re.compile(
    r"\b(?:machine learning|deep learning|model distillation|distillation|pytorch|tensorflow|"
    r"neural network|computer vision|data scien(?:ce|tist)|model evaluat\w*)\b",
    re.I,
)
COMMERCIAL = re.compile(
    r"\b(?:sales|marketing|business development|lead generation|customer acquisition)\b", re.I
)
DOCTORAL = re.compile(r"\b(?:ph\.?\s*d\.?|doctor(?:ate|al)?)\b", re.I)


def role_adjustment(title: str, profile: dict) -> tuple[int, int]:
    """Return review-priority bucket and relevance points, without excluding unknowns."""
    evidence = "\n".join(
        [
            profile.get("education") or "",
            profile.get("experience") or "",
            *profile.get("skills", []),
        ]
    )
    technical = bool(SOFTWARE.search(evidence) or ML.search(evidence))
    points = 0
    if SOFTWARE.search(evidence) and SOFTWARE.search(title):
        points += 16
    if ML.search(evidence) and ML.search(title):
        points += 16
    if technical and COMMERCIAL.search(title) and not COMMERCIAL.search(evidence):
        points -= 12
    # A clearly named PhD role merits later investigation when no doctoral
    # evidence was supplied. Absence is NOT a rejection or an asserted gap.
    later_review = int(bool(DOCTORAL.search(title)) and not DOCTORAL.search(evidence))
    return later_review, points
