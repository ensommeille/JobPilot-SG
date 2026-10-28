# Security Testing — Results & Before/After Evidence

Scans on `main`. Raw artifacts in this directory + GitHub Security tab + CI artifacts.

## 1. SAST — Semgrep

| Stage | Result |
|---|---|
| Before | **0 findings** (`sast-semgrep-before.json`) |
| After | 0 findings (no code change needed) |

## 2. SCA — Backend (pip-audit)

| Stage | Result |
|---|---|
| Before | **25 vulnerabilities / 6 packages** (`sca-pip-before.json`) |
| After | **project runtime cleared** (`sca-pip-after.json`) |

Fixed (project runtime deps, PR #58):

| Package | Before | Findings | Fixed to |
|---|---|---|---|
| PyJWT | 2.13.0 | 15 CVE | 2.15.1 |
| urllib3 | 2.7.0 | 3 CVE | 2.8.0 |
| certifi | 2026.7.22 | 2 CVE | 2026.10.23 |

Remaining are toolchain-only (filelock/mcp/opentelemetry — pulled by `semgrep`/`pip-audit`).

## 3. SCA — Frontend (npm audit)

| Stage | Result |
|---|---|
| Before | **0 vulnerabilities** (`sca-npm-before.json`) |
| After | 0 |

## 4. DAST — OWASP ZAP baseline

| Stage | Result |
|---|---|
| Target | public `GET /jobs` endpoint (200) — not the 404-only scan it was before |
| Findings | 2 Low (missing `X-Content-Type-Options` and `Cross-Origin-Resource-Policy`) + 1 Info |
| Fix | security-header middleware added in `backend/app/main.py` |

Not yet covered (needs auth): login, profile, PDF, application endpoints. This is a **public-endpoint baseline**, not a full-stack DAST. Report artifact: `zap-report` (set via `artifact_name`).

## 5. Container scanning — Trivy

High-severity alerts: **39 before → 1 remaining**, classified:

| Category | Items | Status |
|---|---|---|
| **Fixed** (dependency upgraded, re-scan clean) | urllib3 2.7→2.8.0, setuptools 70.3→84.2.1 | ✅ |
| **Accepted risk** (`.trivyignore`, no upstream fix / vendored copy) | 7 Debian OS-package CVEs (util-linux/ncurses/systemd/perl), msgpack (pip-vendored, not an app dep), plus the base image's vendored urllib3/setuptools copies | ⚠️ documented, **not** "fixed" |
| **Unresolved** (HIGH, no fix version) | **CVE-2026-54369 — libacl1 (symlink-traversal privilege escalation)** | ❌ open |

**CVE-2026-54369** (libacl1 2.3.2-2+b1, HIGH, no Fixed Version):
- Impact: symlink-traversal privilege escalation in libacl functions. JobPilot does not call `getfacl`/`setfacl`/libacl APIs, so the application path is not exercised.
- Mitigation: containers now run as a non-root user (see §6), reducing the escalation surface.
- Re-check: re-run `apt-get upgrade` + Trivy once Debian backports a fix.

## 6. IaC scanning — Checkov

| Stage | Result |
|---|---|
| Scope | scans **Dockerfiles** (`--framework dockerfile`) |
| Report | `results_json.json` (artifact `checkov-report`) |
| Result | **90 passed, 4 failed** (CKV_DOCKER_2 HEALTHCHECK ×2, CKV_DOCKER_3 non-root user ×2) |
| Fix | HEALTHCHECK + non-root `USER` added to both backend and frontend Dockerfiles |

## Scan → fix → re-scan correspondence

| Scan | Initial | Issue | Fix PR | Re-scan |
|---|---|---|---|---|
| pip-audit | `sca-pip-before.json` (25) | PyJWT/urllib3/certifi | #58 | `sca-pip-after.json` (cleared) |
| Semgrep | 0 | — | — | 0 |
| npm audit | 0 | — | — | 0 |
| Trivy | 39 high | deps fixed / accepted / 1 unresolved | #58, #61, #63, #64 | 1 high (CVE-2026-54369) |
| Checkov | 90 pass / 4 fail | HEALTHCHECK + USER | (this PR) | pending re-scan |
| ZAP | 2 Low | security headers | (this PR) | pending re-scan |

## Verification

Full backend suite: **1848 passed**, 90.08% branch coverage, no regression after dependency upgrades.

Links: PRs [#58](https://github.com/ensommeille/JobPilot-SG/pull/58), [#61](https://github.com/ensommeille/JobPilot-SG/pull/61), [#63](https://github.com/ensommeille/JobPilot-SG/pull/63), [#64](https://github.com/ensommeille/JobPilot-SG/pull/64), [#66](https://github.com/ensommeille/JobPilot-SG/pull/66). Security Scans workflow: `.github/workflows/security-scans.yml`.
