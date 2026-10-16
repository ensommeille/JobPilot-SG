"""Collect bounded public JD inputs; opt in to at most four unretried live extractions.

Default use never calls an LLM. Outputs stay under the repository's ignored
``output/`` directory. This script records source and model artifacts separately;
quote coverage never becomes an extraction-accuracy claim.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.ingestion.internsg_adapter import (  # noqa: E402
    InternSGAdapter,
    default_internsg_config,
)
from app.job_extraction.inputs import input_from_job  # noqa: E402
from app.job_extraction.models import SCHEMA_VERSION  # noqa: E402
from app.job_extraction.service import ExtractionConfig, JobExtractionService  # noqa: E402
from app.llm.config import LLMSettings, build_live_provider  # noqa: E402

BENCHMARK = REPO_ROOT / "docs/deliverables/fixtures/real_job_benchmarks_20261016.json"
OUTPUT_ROOT = REPO_ROOT / "output/semantics-acceptance-20261016"
MAX_LIVE_CALLS = 4
MAX_OUTPUT_TOKENS = 12_000
ALLOWED_URLS = {
    "wovenstack_software_data_automation": "https://www.internsg.com/job/wovenstack-software-engineering-intern-data-automation-ai-systems/",
    "cynapse_ml_computer_vision_11": "https://www.internsg.com/job/cynapse-pte-ltd-machine-learning-engineer-intern-computer-vision-ai-11/",
    "cynapse_ai_evaluation_quality_2": "https://www.internsg.com/job/cynapse-pte-ltd-ai-evaluation-quality-intern-2/",
    "strides_ai_closed": "https://www.internsg.com/job/strides-digital-artificial-intelligence-ai-intern/",
    "ilodia_retail": "https://www.internsg.com/job/ilodia-labs-pte-ltd-retail-e-commerce-operations-intern/",
}
_CLOSED = re.compile(r"\bthis position is already closed\b", re.IGNORECASE)


def validate_url(url: str) -> str:
    """Only canonical, credential-free official job URLs can reach the adapter."""
    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "www.internsg.com"
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(r"/job/[a-z0-9]+(?:-[a-z0-9]+)*/", parsed.path)
        or url not in ALLOWED_URLS.values()
    ):
        raise ValueError("source_url_outside_fixed_acceptance_allowlist")
    return url


def load_cases() -> list[dict[str, Any]]:
    benchmark = json.loads(BENCHMARK.read_text(encoding="utf-8"))
    cases = []
    seen = set()
    for entry in benchmark["cases"]:
        case_id = entry["id"]
        if case_id in seen or case_id not in ALLOWED_URLS:
            raise ValueError("invalid_or_duplicate_benchmark_id")
        seen.add(case_id)
        url = validate_url(entry["source_url"])
        if url != ALLOWED_URLS[case_id]:
            raise ValueError("benchmark_identity_mismatch")
        cases.append({"id": case_id, "source_url": url})
    if seen != set(ALLOWED_URLS) - {"ilodia_retail"}:
        raise ValueError("acceptance_benchmark_case_set_changed")
    cases.append({"id": "ilodia_retail", "source_url": ALLOWED_URLS["ilodia_retail"]})
    return cases


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def collect_source(adapter: InternSGAdapter, case: dict[str, Any], folder: Path) -> dict[str, Any]:
    url = validate_url(case["source_url"])
    if ALLOWED_URLS.get(case["id"]) != url:
        raise ValueError("benchmark_identity_mismatch")
    html = adapter.fetch_job_detail(url)  # Includes the existing fail-closed robots policy.
    raw_item = adapter.to_raw_item(html, url)
    job = raw_item.known_fields
    extraction_input = input_from_job(job.model_dump(mode="json"))
    closed = bool(_CLOSED.search(BeautifulSoup(html, "html.parser").get_text(" ", strip=True)))
    folder.mkdir(parents=True, exist_ok=False)
    (folder / "source.html").write_text(html, encoding="utf-8")
    write_json(folder / "source_record.json", raw_item.model_dump(mode="json"))
    write_json(folder / "model_input.json", extraction_input.model_dump(mode="json"))
    write_json(
        folder / "source_provenance.json",
        {
            "retrieved_at": datetime.now(UTC).isoformat(),
            "source_url": url,
            "html_sha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
            "input_hash": extraction_input.input_hash,
            "raw_hash": extraction_input.raw_hash,
            "model_input_boundary": "parser-isolated Job Description, title, company and source identity",
            "metadata_outside_model_description": [
                "location",
                "job_period",
                "status",
                "date_listed",
            ],
            "closed_marker_observed": closed,
            "human_semantic_review": "pending",
        },
    )
    return {
        "id": case["id"],
        "source_url": url,
        "source_status": "closed" if closed else "no_closed_marker_observed",
        "source_artifacts": str(folder),
        "input_hash": extraction_input.input_hash,
        "description_characters": len(extraction_input.description),
        "model_status": "not_requested",
    }


class CallBudgetProvider:
    """A final call-count fence in addition to both disabled retry loops."""

    def __init__(self, provider, maximum: int) -> None:
        if provider.is_mock:
            raise ValueError("mock_cannot_substitute_for_live_acceptance")
        self.provider = provider
        self.maximum = maximum
        self.calls = 0
        self.name = provider.name
        self.is_mock = False

    async def generate_structured(self, request):
        if self.calls >= self.maximum:
            raise RuntimeError("live_call_budget_exhausted")
        self.calls += 1
        return await self.provider.generate_structured(request)


async def extract_sources(
    rows: list[dict[str, Any]],
    *,
    live: bool,
    maximum: int,
    max_output_tokens: int,
) -> dict[str, Any]:
    if not 1 <= maximum <= MAX_LIVE_CALLS or not 1 <= max_output_tokens <= MAX_OUTPUT_TOKENS:
        raise ValueError("live_limits_outside_acceptance_budget")
    if not live:
        return {"status": "not_requested", "calls": 0}
    try:
        # Environment-only: a forgotten local .env is not a source of credentials here.
        settings = LLMSettings(_env_file=None)
        if settings.api_key is None or not settings.api_key.get_secret_value().strip():
            raise ValueError("live_key_not_configured")
        settings = settings.model_copy(
            update={"max_retries": 0, "timeout_seconds": 60.0, "thinking": "disabled"}
        )
        provider = build_live_provider(settings)
    except Exception:
        for row in rows:
            if row.get("source_status") not in {"unavailable", "closed"}:
                row["model_status"] = "live_not_configured"
        return {"status": "live_not_configured", "calls": 0}
    budget = None
    try:
        budget = CallBudgetProvider(provider, maximum)
        service = JobExtractionService(
            budget,
            ExtractionConfig(
                schema_version=SCHEMA_VERSION,
                max_validation_retries=0,
                provider_call_timeout_seconds=60.0,
                max_output_tokens=max_output_tokens,
            ),
        )
        for row in rows:
            if row.get("source_status") in {"closed", "unavailable"}:
                row["model_status"] = "skipped_source_ineligible"
                continue
            if row["id"] == "strides_ai_closed":
                row["model_status"] = "skipped_closed_negative_control"
                continue
            if budget.calls >= maximum:
                row["model_status"] = "skipped_call_budget"
                continue
            folder = Path(row["source_artifacts"])
            job = input_from_job(
                json.loads((folder / "model_input.json").read_text(encoding="utf-8"))
            )
            result = await service.extract(job)
            write_json(folder / "extraction_result.json", result.model_dump(mode="json"))
            row["model_status"] = result.status
            row["result_id"] = result.result_id
            row["model_result_path"] = str(folder / "extraction_result.json")
            row["error_code"] = result.error_code
            row["human_semantic_review"] = "pending"
        return {"status": "completed_needs_human_review", "calls": budget.calls}
    finally:
        await provider.aclose()


def collect_sources(cases: list[dict[str, Any]], run_dir: Path, *, client=None, sleep=time.sleep):
    config = default_internsg_config().model_copy(
        update={
            "timeout_seconds": 30.0,
            "retry_count": 0,
            "allowed_hosts": frozenset({"www.internsg.com"}),
        }
    )
    rows = []
    owns_client = client is None
    # Do not follow redirects: neither jobs nor robots may escape the official host.
    client = client or httpx.Client(
        headers={"User-Agent": config.user_agent, "Accept": "text/html"},
        timeout=httpx.Timeout(30.0),
        follow_redirects=False,
    )
    try:
        with InternSGAdapter(config=config, client=client) as adapter:
            for index, case in enumerate(cases):
                if index:
                    sleep(config.polite_delay_seconds)
                try:
                    rows.append(collect_source(adapter, case, run_dir / case["id"]))
                except Exception as exc:
                    # Class name only: HTTP exception text can contain response material.
                    rows.append(
                        {
                            "id": case["id"],
                            "source_status": "unavailable",
                            "model_status": "not_requested",
                            "error_type": type(exc).__name__,
                        }
                    )
    finally:
        if owns_client:
            client.close()
    return rows


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Explicitly authorize bounded provider calls using environment LLM settings.",
    )
    parser.add_argument(
        "--max-calls", type=int, choices=range(1, MAX_LIVE_CALLS + 1), default=MAX_LIVE_CALLS
    )
    parser.add_argument("--max-output-tokens", type=int, default=MAX_OUTPUT_TOKENS)
    args = parser.parse_args(argv)
    if not 1 <= args.max_output_tokens <= MAX_OUTPUT_TOKENS:
        parser.error("--max-output-tokens must be between 1 and 12000")
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    run_dir = OUTPUT_ROOT / datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    run_dir.mkdir(parents=True, exist_ok=False)
    started = datetime.now(UTC).isoformat()
    cases = load_cases()
    rows = collect_sources(cases, run_dir)
    provider_status = asyncio.run(
        extract_sources(
            rows, live=args.live, maximum=args.max_calls, max_output_tokens=args.max_output_tokens
        )
    )
    report = {
        "started_at": started,
        "finished_at": datetime.now(UTC).isoformat(),
        "schema_version": SCHEMA_VERSION,
        "live_requested": args.live,
        "provider": provider_status,
        "source_count": len(cases),
        "cases": rows,
        "acceptance": "human_semantic_review_pending",
        "accuracy": None,
    }
    write_json(run_dir / "status.json", report)
    print(
        json.dumps(
            {
                "status_file": str(run_dir / "status.json"),
                "provider": provider_status,
                "source_available": sum(row["source_status"] != "unavailable" for row in rows),
                "acceptance": report["acceptance"],
            }
        )
    )
    return int(
        provider_status["status"] == "live_not_configured"
        or any(
            row["source_status"] == "unavailable" or row["model_status"] == "failed" for row in rows
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
