"""Acceptance-runner safeguards use only controlled HTTP/provider test doubles."""

import asyncio
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

from app.llm import InvalidStructuredOutputError, StructuredGenerationResponse

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/validate_requirement_semantics.py"
spec = importlib.util.spec_from_file_location("semantic_acceptance_script", SCRIPT)
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


def case(case_id="wovenstack_software_data_automation"):
    return {"id": case_id, "source_url": acceptance.ALLOWED_URLS[case_id]}


def html(closed=False):
    marker = "<p>This position is already closed</p>" if closed else ""
    return f"""<html><body><nav>Unrelated navigation Python</nav>
    <h1 class="entry-title">Example Company – Example Intern</h1>
    <div class="isg-detail-container"><div class="isg-job-company">Example Company</div>
    {marker}<div class="isg-detail-grid"><dl>
    <dt>Location Name</dt><dd>Singapore</dd>
    <dt>Job Period</dt><dd>For At Least 6 Months</dd>
    <dt>Job Description</dt><dd><p>Python required.</p><p>Use HTTP.</p></dd>
    </dl></div></div><footer>Unrelated footer SQL</footer></body></html>"""


def source_client(handler=None):
    def default_handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(
                200, text="User-agent: *\nAllow: /", headers={"content-type": "text/plain"}
            )
        return httpx.Response(200, text=html(), headers={"content-type": "text/html"})

    return httpx.Client(
        transport=httpx.MockTransport(handler or default_handler), follow_redirects=False
    )


def collect(tmp_path, cases=None, handler=None):
    with source_client(handler) as client:
        return acceptance.collect_sources(
            cases or [case()], tmp_path, client=client, sleep=lambda _: None
        )


@pytest.mark.parametrize(
    "url",
    [
        "http://www.internsg.com/job/example/",
        "https://internsg.com/job/example/",
        "https://www.internsg.com.evil.test/job/example/",
        "https://user:secret@www.internsg.com/job/example/",
        "https://www.internsg.com:443/job/example/",
        "https://www.internsg.com/job/example/?redirect=other",
        "https://www.internsg.com/job/example/#fragment",
        "https://www.internsg.com/job/../admin/",
        "https://www.internsg.com/job/not-an-authorized-acceptance-source/",
    ],
)
def test_fixed_official_url_allowlist_rejects_other_destinations(url):
    with pytest.raises(ValueError):
        acceptance.validate_url(url)


def test_benchmark_has_exact_four_sources_plus_ilodia_and_default_is_not_live():
    cases = acceptance.load_cases()
    assert len(cases) == 5
    assert {entry["id"] for entry in cases} == set(acceptance.ALLOWED_URLS)
    assert acceptance.parse_args([]).live is False


def test_source_artifacts_separate_isolated_jd_from_whole_page_and_metadata(tmp_path):
    rows = collect(tmp_path)
    assert rows[0]["source_status"] == "no_closed_marker_observed"
    folder = Path(rows[0]["source_artifacts"])
    model_input = json.loads((folder / "model_input.json").read_text(encoding="utf-8"))
    assert model_input["description"] == "Python required.\nUse HTTP."
    assert "Unrelated" not in model_input["description"]
    assert "6 Months" not in model_input["description"]
    record = json.loads((folder / "source_record.json").read_text(encoding="utf-8"))
    assert record["known_fields"]["job_period"] == "For At Least 6 Months"
    assert "Unrelated footer SQL" in (folder / "source.html").read_text(encoding="utf-8")
    provenance = json.loads((folder / "source_provenance.json").read_text(encoding="utf-8"))
    assert provenance["input_hash"] == rows[0]["input_hash"]


def test_source_error_isolated_and_redirect_never_followed(tmp_path):
    requested = []
    first, second = case(), case("ilodia_retail")

    def handler(request):
        requested.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /")
        if str(request.url) == first["source_url"]:
            return httpx.Response(302, headers={"location": "https://evil.test/secret"})
        return httpx.Response(200, text=html(), headers={"content-type": "text/html"})

    rows = collect(tmp_path, [first, second], handler)
    assert rows[0]["source_status"] == "unavailable"
    assert rows[1]["source_status"] == "no_closed_marker_observed"
    assert all("evil.test" not in url for url in requested)


def test_robots_denial_prevents_job_fetch(tmp_path):
    requested = []

    def handler(request):
        requested.append(request.url.path)
        return httpx.Response(200, text="User-agent: *\nDisallow: /job/")

    rows = collect(tmp_path, handler=handler)
    assert rows[0]["source_status"] == "unavailable"
    assert requested == ["/robots.txt"]


def test_default_never_constructs_provider_even_with_an_environment_key(tmp_path, monkeypatch):
    rows = collect(tmp_path)
    monkeypatch.setenv("LLM_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(
        acceptance, "build_live_provider", lambda _: pytest.fail("unexpected paid call")
    )
    status = asyncio.run(
        acceptance.extract_sources(rows, live=False, maximum=4, max_output_tokens=12000)
    )
    assert status == {"status": "not_requested", "calls": 0}


def test_live_without_key_does_not_fall_back_to_mock(tmp_path, monkeypatch):
    rows = collect(tmp_path)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setattr(
        acceptance, "build_live_provider", lambda _: pytest.fail("missing-key provider constructed")
    )
    status = asyncio.run(
        acceptance.extract_sources(rows, live=True, maximum=4, max_output_tokens=12000)
    )
    assert status == {"status": "live_not_configured", "calls": 0}
    assert rows[0]["model_status"] == "live_not_configured"


class ControlledProvider:
    """An offline double, used solely to test orchestration and artifact integrity."""

    name = "controlled-provider-test-double"
    is_mock = False

    def __init__(self, invalid=False):
        self.requests = []
        self.closed = False
        self.invalid = invalid

    async def generate_structured(self, request):
        self.requests.append(request)
        if self.invalid:
            raise InvalidStructuredOutputError("test invalid response")
        return StructuredGenerationResponse(
            provider=self.name,
            model="offline-test-only",
            finish_reason="stop",
            data={
                "summary": None,
                "responsibilities": [],
                "requirement_groups": [],
                "education": {"degree": None, "fields_of_study": [], "enrollment": None},
                "experience": {"requirement": None, "minimum_years": None},
                "work_constraints": {
                    "schedule": None,
                    "hours": None,
                    "minimum_duration": None,
                    "work_modes": [],
                    "locations": [],
                },
            },
        )

    async def aclose(self):
        self.closed = True


def test_live_budget_no_retry_and_actual_result_saved(tmp_path, monkeypatch):
    rows = collect(tmp_path, [case(), case("ilodia_retail"), case("strides_ai_closed")])
    provider = ControlledProvider()
    captured = []

    def build(settings):
        captured.append(settings)
        return provider

    monkeypatch.setenv("LLM_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(acceptance, "build_live_provider", build)
    status = asyncio.run(
        acceptance.extract_sources(rows, live=True, maximum=1, max_output_tokens=12000)
    )
    assert status["calls"] == 1
    assert captured[0].max_retries == 0
    assert captured[0].timeout_seconds == 60
    assert captured[0].thinking == "disabled"
    assert provider.closed
    assert provider.requests[0].max_output_tokens == 12000
    assert provider.requests[0].schema_name == "job_extraction_v2"
    result = json.loads(Path(rows[0]["model_result_path"]).read_text(encoding="utf-8"))
    assert result["status"] == "needs_review"
    assert result["input_hash"] == rows[0]["input_hash"]
    assert result["extraction"]["requirement_groups"] == []
    assert "test-not-a-real-key" not in json.dumps(result)
    assert rows[1]["model_status"] == "skipped_call_budget"
    assert rows[2]["model_status"] == "skipped_closed_negative_control"


def test_invalid_provider_output_has_one_attempt_and_no_repair(tmp_path, monkeypatch):
    rows = collect(tmp_path)
    provider = ControlledProvider(invalid=True)
    monkeypatch.setenv("LLM_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(acceptance, "build_live_provider", lambda _: provider)
    status = asyncio.run(
        acceptance.extract_sources(rows, live=True, maximum=4, max_output_tokens=4000)
    )
    assert status["calls"] == len(provider.requests) == 1
    result = json.loads(Path(rows[0]["model_result_path"]).read_text(encoding="utf-8"))
    assert result["status"] == "failed"
    assert len(result["attempts"]) == 1
    assert result["error_code"] == "invalid_structured_output"


def test_fresh_closed_marker_skips_otherwise_eligible_case(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /")
        return httpx.Response(200, text=html(closed=True), headers={"content-type": "text/html"})

    rows = collect(tmp_path, handler=handler)
    provider = ControlledProvider()
    monkeypatch.setenv("LLM_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(acceptance, "build_live_provider", lambda _: provider)
    status = asyncio.run(
        acceptance.extract_sources(rows, live=True, maximum=4, max_output_tokens=4000)
    )
    assert rows[0]["source_status"] == "closed"
    assert rows[0]["model_status"] == "skipped_source_ineligible"
    assert status["calls"] == 0
    assert provider.requests == []


@pytest.mark.parametrize("maximum,tokens", [(0, 4000), (5, 4000), (4, 12001)])
def test_budget_limits_fail_before_provider(maximum, tokens):
    with pytest.raises(ValueError):
        asyncio.run(
            acceptance.extract_sources([], live=True, maximum=maximum, max_output_tokens=tokens)
        )
