# Security Testing — Results & Before/After Evidence

Scans on `main`. Raw artifacts in this directory + GitHub Security tab + CI artifacts.

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
| PyJWT | 2.13.0 | 15 CVE | 2.15.1 |
| urllib3 | 2.7.0 | 3 CVE | 2.8.0 |
| certifi | 2026.7.22 | 2 CVE (compromised CA) | 2026.10.23 |

Remaining are toolchain-only (filelock/mcp/opentelemetry — pulled by `semgrep`/`pip-audit`, not project runtime deps).

## 3. SCA — Frontend (npm audit)

| Stage | Result |
|---|---|
| Before | **0 vulnerabilities** (`sca-npm-before.json`) |
| After | 0 |

## 4. DAST — OWASP ZAP baseline (partial — honest scope)

| Stage | Result |
|---|---|
| Before | not previously run |
| Current | baseline scan of the **public `/jobs` endpoint** (200 response) |

**Not yet covered**: login, profile, PDF, and application endpoints require authentication and are **not** exercised by this baseline. This is a public-endpoint baseline, **not** a full-stack DAST. Report artifact: `zap-report` (contains `zap_scan.html`).

## 5. Container scanning — Trivy

High-severity alerts: **39 before → 1 remaining**, classified honestly:

| Category | Items | Status |
|---|---|---|
| **Fixed** (dependency upgraded, re-scan shows no finding) | urllib3 2.7→2.8.0 (CVE-2026-97687/97689), setuptools 70.3→84.2.1 (CVE-2025-47273) | ✅ re-scanned clean |
| **Accepted risk** (`.trivyignore`, no upstream fix available) | 7 Debian OS-package CVEs (util-linux/ncurses/systemd/perl), msgpack (pip-vendored, not an app dep) | ⚠️ documented, not "fixed" |
| **Unresolved** (high, no fix version) | **CVE-2026-54369 (libacl1)** | ❌ open on main |

Evidence: GitHub Security tab → Code scanning (tool = Trivy), `.trivyignore` at repo root, `trivy-backend.sarif` SARIF.

## 6. IaC scanning — Checkov

| Stage | Result |
|---|---|
| Scope | scans **Dockerfiles** (`--framework dockerfile`) — not docker-compose |
| Report | `results_json.json` (artifact `checkov-report`) |

## Scan → fix → re-scan correspondence

| Scan | Initial report | Issue recorded | Fix commit / PR | Re-scan report |
|---|---|---|---|---|
| pip-audit | `sca-pip-before.json` (25 vulns) | PyJWT/urllib3/certifi | PR #58 | `sca-pip-after.json` (runtime cleared) |
| Semgrep | `sast-semgrep-before.json` (0) | — | — | 0 |
| npm audit | `sca-npm-before.json` (0) | — | — | 0 |
| Trivy | Code scanning (39 high) | urllib3/setuptools fixed; Debian+msgpack accepted; libacl1 open | PR #58, #61, #63, #64 | 1 high remaining (CVE-2026-54369) |

## Verification

Full backend suite: **1848 collected / 1847 passed, 1 skipped**, 90% branch coverage, no regression after dependency upgrades.
