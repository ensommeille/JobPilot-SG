# Security Testing — Results & Before/After Evidence

Scans run 2026-10-27 on `main`. Raw artifacts in this directory + GitHub Security tab + CI artifacts.

## 1. SAST — Semgrep

| Stage | Result |
|---|---|
| Before | **0 findings** (`sast-semgrep-before.json`, `semgrep --config=auto`) |
| After | 0 findings (no code change needed) |

## 2. SCA — Backend (pip-audit)

| Stage | Result |
|---|---|
| Before | **25 vulnerabilities across 6 packages** (`sca-pip-before.json`) |
| After | **project runtime vulnerabilities cleared** (`sca-pip-after.json`) |

Fixed (project runtime deps):

| Package | Before | Findings | Fixed to |
|---|---|---|---|
| PyJWT | 2.13.0 | 15 CVE (incl. GHSA-pxh4) | 2.15.1 |
| urllib3 | 2.7.0 | 3 CVE | 2.8.0 |
| certifi | 2026.7.22 | 2 CVE (compromised CA) | 2026.10.23 |

Remaining are toolchain-only (filelock/mcp/opentelemetry, pulled by `semgrep`/`pip-audit`, not project runtime deps).

## 3. SCA — Frontend (npm audit)

| Stage | Result |
|---|---|
| Before | **0 vulnerabilities** (`sca-npm-before.json`) |
| After | 0 |

## 4. DAST — OWASP ZAP baseline (new, added to CI)

| Stage | Result |
|---|---|
| Before | not previously run — added `zaproxy/action-baseline` job |
| Baseline scan | runs against the full stack; no blocking highs (`fail_action: warn`, `allow_issue_writing: false`) |

Evidence: CI artifact `zap-report` (zap_scan.html) on every `Security Scans` run.

## 5. Container scanning — Trivy (new, added to CI)

| Stage | Result |
|---|---|
| Before | **100 open alerts (39 high)** |
| After | Python-dep highs fixed (urllib3→2.8.0, setuptools bumped, msgpack is toolchain-only); **35 Debian base-image highs remain — no upstream fix** (`apt-get upgrade` reports `0 upgraded`) |

The 35 remaining highs are OS-package CVEs in `python:3.13-slim` (util-linux, login, mount, ncurses, libsystemd, libudev, perl-base) whose `Fixed Version` is empty — Debian has not backported fixes. They are not application code.

Evidence: GitHub Security tab → Code scanning (tool = Trivy), + `trivy-backend.sarif` SARIF upload.

## 6. IaC scanning — Checkov (new, added to CI)

| Stage | Result |
|---|---|
| Baseline | scans `docker-compose.yml` + `Dockerfile`s (`--framework dockerfile`) |

Evidence: CI artifact `checkov-report` (checkov json) on every `Security Scans` run.

## Verification

Full backend suite after dependency upgrades: **1847 passed, 1 skipped** (no regression). All `Security Scans` jobs green on `main`.
