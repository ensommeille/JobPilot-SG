# Sprint 1 — DevSecOps Evidence

Owner: LIAO CAN (M5 · DevSecOps / QA / Audit) · Sprint 1 (1–13 Sep 2026)

## Pipeline runs (GitHub Actions workflow `CI`)

| Run | Commit | Event | Branch | Result | Evidence |
|---|---|---|---|---|---|
| #4 | `58ddac6` | PR #1 opened | feat/member3-ingestion-extraction-v1 | ❌ failed | `run-04-pr1-failed.png` |
| #5 | `ff59e38` | push (CI gate fixes) | feat/member3-ingestion-extraction-v1 | ✅ pass | — |
| #6 | `ff59e38` | PR #1 synchronize | feat/member3-ingestion-extraction-v1 | ✅ pass | `run-06-pr1-green.png` |
| #7–#10 | `b418fec` / `dab0af0` / `2867f73` | push | M2 branches (backend-core / job-api / profile-application) | ✅ pass | Actions → CI #7–#10 |
| #11 | `edda860` | push to `main` (merge PR #1) | main | ✅ pass | `run-11-main-after-merge-green.png` |

## What failed in run #4 and how it was fixed (commit `ff59e38`)

Two independent causes, both tooling/rule issues rather than application-logic defects:

1. **Semgrep false positive** — rule `python.lang.compatibility.python37.python37-compatibility-importlib2`
   flagged `from importlib.resources import files` in `app/job_extraction/cli.py` and `evaluation.py`.
   The rule targets Python < 3.7 compatibility; this project requires `requires-python >= 3.11`.
   → suppressed inline with `# nosemgrep: python37-compatibility-importlib2` (rationale in commit message).
2. **pip-audit toolchain finding** — `pip 26.1.2` (PYSEC-2026-3721, fixed in 26.2). The vulnerable package
   was `pip` itself in the CI environment, not a project dependency.
   → CI now runs `python -m pip install --upgrade pip` before `pip-audit`.

Also: `actions/checkout` v4 → v5, `actions/setup-python` v5 → v6 (Node.js 20 deprecation warnings on runners).

## Local verification (M5, Windows 11, Python 3.13)

| Scope | pytest | ruff | semgrep `--error` |
|---|---|---|---|
| `main` @ `edda860` (after PR #1 merge) | 161 passed | clean | 0 findings |
| Integration dry-run: PR #1 + M2 final branch merged (pyproject dependency union) | 193 passed | clean | 0 findings |

The dry-run confirmed that the only cross-branch conflict is `backend/pyproject.toml` dependencies (resolved as a
union of both sides), so M2 can rebase onto `main` and re-run the suite before opening the final PR.

## Coverage note

`app.job_extraction` + `app.llm` statement coverage 100% (556 statements, 0 missed) and
statement+branch 99.86% (689/690, one partial branch in `evaluation.py` 64→67) were reproduced locally with
`pytest --cov=app.job_extraction --cov=app.llm --cov-branch`. **CI does not yet measure coverage** — adding a
coverage step/gate is tracked as the next M5 improvement so the number becomes pipeline evidence rather than a
local-only measurement.
