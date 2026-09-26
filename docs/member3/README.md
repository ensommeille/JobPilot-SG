# Member 3 — Ingestion and Job Extraction v1

This branch integrates the first tested Member 3 delivery into the backend modular monolith.

## Packages

- `backend/app/ingestion`: source contracts, InternSG adapter, deterministic normalization, JSON PoC repository, crawl-run report, and CLI.
- `backend/app/job_extraction`: source-neutral semantic extraction schema, prompts, evidence diagnostics, bounded repair, audit result, offline fixture runner, and evaluator.
- `backend/app/llm`: proposed shared structured-generation contract and deterministic MockProvider. Member 4 owns live provider implementations and must review this boundary before merge.

The LLM schema intentionally enriches deterministic job data rather than regenerating title, company, salary, dates, or location.

The local integration follow-up now includes extraction persistence and admin APIs.
See [Extraction persistence v1](EXTRACTION_PERSISTENCE_V1.md) for the current contract,
migration instructions, offline-only defaults and verification boundaries; see
[Offline integration v2](OFFLINE_INTEGRATION_V2.md) for dependency branch details.

## Verification

From `backend`:

```powershell
python -m pip install -e ".[dev]"
python -m ruff check .
python -m pytest
python -m app.job_extraction.cli --input tests/job_extraction/fixtures/jobs.json --output output/extractions.mock.json
```

The example command is Mock fixture replay. It makes no live LLM call and does not establish model accuracy. Every successful extraction remains `needs_review`.

See `HANDOFF_MEMBER4.md`, `PROVIDER_CONTRACT.md`, and `REVIEW_READINESS.md` in this directory.
