# Security Testing Evidence — SAST & SCA

Scans run 2026-10-27 on `main` (PR #57 head). Raw reports in this directory.

## SAST (Semgrep)

| Stage | Result |
|---|---|
| Before | 0 findings (`semgrep --config=auto`, SARIF: `sast-semgrep-before.json`) |
| After | 0 findings (no code change required) |

## SCA — Backend (pip-audit)

| Stage | Result |
|---|---|
| Before | 25 known vulnerabilities across 6 packages (`sca-pip-before.json`) |
| After | project runtime vulnerabilities cleared (`sca-pip-after.json`) |

Before — project runtime dependencies (20 findings, fixed):

| Package | Version (before) | Findings | Fixed version |
|---|---|---|---|
| PyJWT | 2.13.0 | 15 (CVE-2026-101917 … 102275, GHSA-pxh4-856f-4h89) | 2.15.1 |
| urllib3 | 2.7.0 | 3 (CVE-2026-97687/97688/97689) | 2.8.0 |
| certifi | 2026.7.22 | 2 (GHSA-6q48-6c7w-9gw2, compromised CA) | 2026.10.23 |

Before — toolchain-only dependencies (not project runtime, pulled in by `semgrep` / `pip-audit`):

| Package | Findings | Note |
|---|---|---|
| filelock | 3 | CI tooling |
| mcp | 1 | Semgrep dependency (noted in `.github/workflows/ci.yml`) |
| opentelemetry-api | 1 | CI tooling |

Fix applied in `backend/pyproject.toml`: `PyJWT>=2.15`, `urllib3>=2.8`, `certifi>=2026.10.19`.

## SCA — Frontend (npm audit)

| Stage | Result |
|---|---|
| Before | 0 vulnerabilities (`sca-npm-before.json`) |
| After | 0 vulnerabilities |

## Verification

Full backend suite after the dependency upgrades: **1847 passed, 1 skipped** (no regression).
