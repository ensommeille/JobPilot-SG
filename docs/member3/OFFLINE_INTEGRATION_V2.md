# Member 3 offline integration handoff

Date: 2026-09-26. Scope: local integration only, no paid model calls.

Follow-up: extraction persistence and admin APIs are now implemented locally;
see `EXTRACTION_PERSISTENCE_V1.md` for the current contract. The results and
remaining-work statements below describe the earlier offline integration checkpoint.

## Branch and dependencies

Implementation branch: `feat/member3-pipeline-integration-v2`.
This is an integration worktree, separate from the original V1 checkout.
It includes main `1eb24ee`, M2 ingestion `2d6b4d40` (PR #12), M2 demo
bootstrap `74abaf0a` (PR #14), and M4 providers `d710c09e` (PR #10).
These dependencies were merged locally; this does not merge their GitHub PRs.
The `.env.example` conflict was resolved by retaining both CORS and LLM examples.
No credentials were copied or configured.

## What was added

- `backend/app/job_extraction/batch.py`: async `extract_batch(records, provider)`.
  It accepts scraper JobRecord dictionaries, delegates to the existing extraction
  service, and uses the shared Provider contract 0.1.0 unchanged.
- `backend/tests/ingestion/test_api_pipeline.py`: actual InternSG HTML parser,
  admin source/run APIs, SQLite repository, public jobs API and favorites in one
  offline acceptance test, with three failure scenarios.
- `backend/tests/job_extraction/test_provider_integration.py`: actual Qwen and
  DeepSeek adapters through mocked HTTP into the M3 nested extraction schema.
  Covers success, schema repair, invalid output, authentication failure,
  truncation, invalid/duplicate input, batch limits, failure isolation and cancellation.

## Batch contract

```python
from app.job_extraction.batch import extract_batch

# provider is supplied by the caller, not constructed by the extraction module.
report = await extract_batch(records, provider, max_items=20)
```

`max_items` is an integer from 1 to 100; oversized batches are rejected before
any calls, not silently truncated. The default is 20. Processing is sequential.
Duplicates are identified by `(source_id, external_id, input_hash)` within one
batch; changed content is a different input. No cross-run cache is implied.

Report keys: `status`, `input_count`, `extracted_count`, `failed_count`,
`needs_review_count`, `results`, `input_failures`.
Each result wraps `input_index` and the existing `ExtractionResult`; invalid or
duplicate inputs appear in `input_failures` with only index and error code.
Status is `completed_with_review`, `partial`, or `failed`; empty input is failed.
Provider errors remain failed results. Cancellation propagates to the caller.

The caller owns provider creation/cleanup, authorization, cost budget, and result
storage. This entry point does not load `.env`, create HTTP clients, mutate input,
write files, or write AI output into the jobs database. A live provider supplied
by a caller CAN incur costs; the tests only supply mocked transports/test doubles.
The existing offline fixture CLI remains unchanged.

## Proven by the offline acceptance tests

- Parsed title, description, salary and date reach `/jobs` with the DB source UUID.
- Repeating the crawl adds no duplicate job; changed description updates the same ID.
- A favorite remains attached to that ID after the update.
- Invalid detail HTML, HTTP 503 and robots denial produce failed crawl runs while
  preserving the previously stored job. Test dependency overrides are cleaned up.
- Both concrete providers carry the extraction JSON schema into their request.
  Business validation rejects malformed output and applies bounded repair.
- Valid results always require human review. Evidence coverage is not accuracy.

The real provider classes report `execution_mode=live` by their contract even
when their HTTP transport is mocked in a test. Such test output is NOT evidence
that a live model was invoked or evaluated. Test model names are placeholders.

## Reproduce on Windows PowerShell

Local verification: Python 3.12.7; 247 tests passed, including 22 new integration
and batch cases. Coverage including branches: 91.80% (85% gate passed).
The batch entry point has 100% statement/branch coverage. Whole-tree Ruff lint
passed; all three new Python files passed Ruff format checking.
One existing dependency warning remains: Starlette deprecates its httpx-based
TestClient integration. No tests were skipped or disabled to obtain this result.
Linux/Python 3.13 CI has not been run for these unpushed additions.

Run inside this worktree's `backend` directory, using its isolated `.venv`:

```powershell
.venv\Scripts\python.exe -m pytest tests/ingestion/test_api_pipeline.py tests/job_extraction/test_provider_integration.py -q
.venv\Scripts\python.exe -m ruff check .

# Use a fresh temporary root if the machine's old pytest directory has ACL issues.
$testTempRoot = Join-Path $env:TEMP ('jobpilot-m3-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testTempRoot | Out-Null
$env:PYTEST_DEBUG_TEMPROOT = $testTempRoot
.venv\Scripts\python.exe -m pytest -q --cov=app --cov-branch --cov-fail-under=85
```

## Boundaries and next team decisions

This verifies two integration boundaries, not a deployed end-to-end product.
The source run API still persists deterministic parsed fields; it does not
automatically invoke AI extraction. AI persistence/schema and triggering need
agreement with M2 before adding migrations or changing the API transaction.
Do not reconstruct `source_url` from `/jobs`: that response lacks the original
detail URL. Supply original JobRecord data to extraction until provenance
persistence is agreed with M2.

Not verified here: real model accuracy/billing, live InternSG access, PostgreSQL,
Docker, frontend integration, scheduler, Semgrep and dependency security audit.
No remote push or merge was performed. The integrated baseline has 17 existing
files that fail a whole-tree Ruff format check; these unrelated files were not
reformatted. Whole-tree Ruff lint and formatting of the new files are separate checks.

Before opening a clean M3 PR, coordinate merging the dependency PRs, then move
only the M3 additions onto current main. Do not blindly replace teammates' branches
with this local integration branch. M4 reviews Provider compatibility; M2 reviews
data mapping and the future extraction storage decision; M5 reruns Linux CI,
security scans and PostgreSQL/Docker checks.
