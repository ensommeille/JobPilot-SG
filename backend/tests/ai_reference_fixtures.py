"""Adapt existing readable scripted fixtures to the internal reference wire format.

This is test-only exact lookup, not production quote repair. Unknown/incorrect
fixture quotations deliberately become unissued IDs so rejection tests persist.
Independent reference-security tests construct wire responses directly.
"""

from copy import deepcopy


def reference_fixture(data, payload):
    if "source_catalog" not in payload:
        return data
    data = deepcopy(data)
    catalog = payload["source_catalog"]

    def ids(quote, scope, owner, field):
        if quote is None:
            return None
        candidates = [
            source
            for source in catalog
            if source["scope"] == scope
            and (scope != "job" or source["job_id"] == owner)
            and (scope != "profile" or source["profile_field"] == field)
        ]
        entries = sorted({source["entry_index"] for source in candidates})
        for entry in entries:
            if scope == "job":
                original = next(
                    (job["description"] for job in payload["jobs"] if job["id"] == owner), ""
                )
            else:
                original = payload["profile"].get(field)
                original = original[entry] if isinstance(original, list) else original or ""
            start = original.find(quote)
            if start < 0:
                continue
            selected = [
                source["source_id"]
                for source in candidates
                if source["entry_index"] == entry
                and source["end"] > start
                and source["start"] < start + len(quote)
            ]
            if selected:
                return {"start_id": selected[0], "end_id": selected[-1]}
        return {"start_id": "unissued_fixture_source", "end_id": "unissued_fixture_source"}

    for job in data.get("items", []):
        if "career_fit" not in job:
            job["career_fit"] = {
                "direction": "undetermined",
                "proposed_verdict": "insufficient_information",
                "summary": "A career recommendation is not available for this scripted fixture.",
                "jd_source_range": ids(
                    next(
                        (
                            item["description"]
                            for item in payload["jobs"]
                            if item["id"] == job["job_id"]
                        ),
                        "",
                    ),
                    "job",
                    job["job_id"],
                    "description",
                ),
                "profile_field": None,
                "profile_source_range": None,
                "job_focus": "Fixture",
                "profile_focus": None,
                "strengths": [],
                "considerations": [],
            }
        for row in job.get("requirements", []):
            if "jd_source_range" in row:
                continue
            if "jd_quote" in row:
                row["jd_source_range"] = ids(
                    row.pop("jd_quote"), "job", job.get("job_id"), "description"
                )
            if "profile_quote" in row:
                row["profile_source_range"] = ids(
                    row.pop("profile_quote"), "profile", "profile", row.get("profile_field")
                )
            row["condition_operator"] = "atomic"
            row["condition_checks"] = [
                {
                    "condition": row.get("requirement", "Fixture condition"),
                    "outcome": row.get("outcome", "unknown"),
                    "profile_field": row.get("profile_field"),
                    "profile_source_range": row.get("profile_source_range"),
                    "reason": row.get("reason", "Fixture evidence"),
                }
            ]
    return data
