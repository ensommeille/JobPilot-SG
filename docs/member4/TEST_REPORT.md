# M4 Form Assistant v1 — Test Report

Date: 2026-09-27. Scope: local, offline checks on the M4 feature branch.

| Check | Result | Evidence/limits |
| --- | --- | --- |
| Backend unit/API suite with branch coverage gate | PASS | 285 tests, 92.35% coverage, threshold 85% |
| M4 focused tests | PASS | Deterministic, semantic MockProvider, six provider error classes, invalid outputs, no-key fallback, demo API→persistence→history |
| Ruff | PASS | `ruff check .` |
| Frontend lint/build | PASS | `npm run lint`, `npm run build` |
| Backend Docker image | PASS | `docker build -t jobpilot-sg-backend-m4 ./backend` |
| Skeleton validation | PASS | `python scripts/check_skeleton.py` |
| Semgrep | PASS | 293 rules, 65 tracked targets including staged new mapping module, zero findings |
| pip-audit | PASS | No known vulnerabilities after updating local pip; local project package is not on PyPI |
| Browser E2E | PENDING | No real browser flow has been observed or asserted |
| Qwen/DeepSeek live smoke | REAL_PROVIDER_SMOKE_PENDING | No valid key configured; no paid calls or provider metrics claimed |

The API integration test seeds the M2 fixture, registers a user, stores profile data, fetches
bootstrap/form/job, requests mapping through the concrete gateway using a scripted `MockProvider`,
confirms every suggested field, persists the application/mapping, and reads history. This verifies
the backend path, not the browser UI or live vendor quality. CI status is separately tracked in the
Draft PR and must be green before review or merge.
