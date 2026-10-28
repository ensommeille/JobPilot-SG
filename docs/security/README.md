# Security Testing — Results & Before/After Evidence

Evidence snapshot: **28 October 2026**, `main` at [`66eacc9`](https://github.com/ensommeille/JobPilot-SG/commit/66eacc9de6a6972bd06d19aaebf2e06d2a3c5f7f). The [CI run](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693753) and [Security Scans run](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693826) succeeded. Their green status does not mean zero findings: ZAP and Checkov are advisory, and Trivy's count is not printed in its job log. See [the final-report evidence insert](REPORT_INSERT_20261028.md) for a concise account and exact artifact links. GitHub artifacts may expire; download them for the report while available.

## 1. SAST — Semgrep

| Stage | Result |
|---|---|
| Before | **0 findings** (`sast-semgrep-before.json`) |
| After | 0 findings (no code change needed) |

## 2. SCA — Backend (pip-audit)

| Stage | Result |
|---|---|
| Before | **25 vulnerabilities / 6 packages** (`sca-pip-before.json`) |
| After | `pip-audit .` on project runtime: **0 known vulnerabilities** in the 28 October CI log. The earlier `sca-pip-after.json` includes **5 findings in 3 CI-toolchain packages** (`filelock`, `mcp`, `opentelemetry-api`); it is not a zero-finding whole-environment result. |

Fixed (project runtime deps, PR #58):

| Package | Before | Findings | Fixed to |
|---|---|---|---|
| PyJWT | 2.13.0 | 15 CVE | 2.15.1 |
| urllib3 | 2.7.0 | 3 CVE | 2.8.0 |
| certifi | 2026.7.22 | 2 CVE | 2026.10.23 |

The five entries in the earlier whole-environment after-snapshot are toolchain-only (`filelock`/`mcp`/`opentelemetry-api`, pulled by CI tools); they do not appear in the project-scoped `pip-audit .` result.

## 3. SCA — Frontend (npm audit)

| Stage | Result |
|---|---|
| Before | **0 vulnerabilities** (`sca-npm-before.json`) |
| After | 0 |

## 4. DAST — OWASP ZAP baseline

| Stage | Result |
|---|---|
| Target | public `GET /jobs` endpoint (200) — not the 404-only scan it was before |
| Before | 2 Low (missing `X-Content-Type-Options` and `Cross-Origin-Resource-Policy`) + 1 Info, from the team's earlier register |
| Fix | [PR #67](https://github.com/ensommeille/JobPilot-SG/pull/67) added security-header middleware in `backend/app/main.py` |
| Re-scan | [28 October ZAP artifact](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693826/artifacts/12787872108): **0 FAIL / 1 WARN / 67 PASS**. The remaining `Storable and Cacheable Content` warning concerns 404 responses for `/`, `/robots.txt` and `/sitemap.xml`; keep it open. |

Not yet covered (needs auth): login, profile, PDF, application endpoints. This is a **public-endpoint baseline**, not a full-stack DAST. Report artifact: `zap-report` (set via `artifact_name`).

## 5. Container scanning — Trivy

The team's earlier register reported **39 HIGH before → 1 unignored HIGH after**, but this was superseded by an actual [PR #68 Trivy SARIF artifact](https://github.com/ensommeille/JobPilot-SG/actions/runs/40691560445/artifacts/12816284892): **2 HIGH** (`CVE-2026-54369` in `libacl1`; `CVE-2026-114613` in `msgpack`). The SARIF contains 125 findings across all severities because the action reports all severities in SARIF, despite the configured `HIGH,CRITICAL` scan input. Eleven IDs in [`.trivyignore`](../../.trivyignore) are excluded from displayed findings; they are **suppressed, not fixed**.

| Category | Items | Status |
|---|---|---|
| **Previously reported fixed** (dependency upgraded) | urllib3 2.7→2.8.0, setuptools 70.3→84.2.1 | Check current SARIF before closing |
| **Suppressed in the scan** (`.trivyignore`) | 7 Debian OS-package CVEs and 4 vendored-package advisories | ⚠️ exclusions, **not** fixes; risk owner/acceptance still needs team sign-off |
| **Unresolved** (HIGH, no fix version) | **CVE-2026-54369 — libacl1 (symlink-traversal privilege escalation)** | ❌ open |
| **New on PR #68 first scan** (HIGH, fix version listed) | **CVE-2026-114613 — msgpack 1.1.2**, vendored inside pip 26.2.2; no standalone runtime `msgpack` distribution | Runtime pip removed in PR #68; re-scan pending |

**CVE-2026-54369** (`libacl1`, HIGH) is recorded in the team's earlier register as having no fixed version. The backend container now runs as non-root, but that does not patch `libacl1`. Assign a risk owner, inspect the current SARIF and re-scan when a base-image update becomes available. Do not mark the issue closed from a green scan job alone.

**CVE-2026-114613** was traced to `/usr/local/lib/python3.13/site-packages/pip/_vendor/msgpack/`, not a JobPilot runtime dependency. A disposable container showed `pip` 26.2.2 vendoring msgpack 1.1.2 and no standalone `msgpack` distribution. [PR #68](https://github.com/ensommeille/JobPilot-SG/pull/68) removes pip after installing the application. The modified image built; `app.main` imported and `alembic --version` ran while both pip and msgpack were absent. Treat the issue as **fix implemented, re-scan pending** until the next Trivy SARIF confirms it.

## 6. IaC scanning — Checkov

| Stage | Result |
|---|---|
| Scope | scans **Dockerfiles** (`--framework dockerfile`) |
| Report | `results_json.json` (artifact `checkov-report`) |
| Before | **90 passed, 4 failed** (CKV_DOCKER_2 HEALTHCHECK ×2, CKV_DOCKER_3 non-root user ×2), from the earlier register |
| Fix | HEALTHCHECK + non-root `USER` added to both backend and frontend Dockerfiles |
| Re-scan | [28 October Checkov artifact](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693826/artifacts/12788340825): **113 passed, 0 failed, 0 parsing errors** |

## Scan → fix → re-scan correspondence

| Scan | Initial | Issue | Fix PR | Re-scan |
|---|---|---|---|---|
| pip-audit | `sca-pip-before.json` (25) | PyJWT/urllib3/certifi | #58 | Project-scoped CI audit: 0; older whole-environment JSON: 5 toolchain findings |
| Semgrep | 0 | — | — | 0 |
| npm audit | 0 | — | — | 0 |
| Trivy | 39 HIGH (earlier summary; raw pre-fix SARIF not retained here) | deps fixed/suppressed; new pip-vendored msgpack finding | #58, #61, #63, #64, #68 | PR #68 first SARIF: 2 HIGH; post-pip-removal re-scan pending |
| Checkov | 90 pass / 4 fail | HEALTHCHECK + USER | #67 | 113 pass / 0 fail on 28 October |
| ZAP | 2 Low + 1 Info | security headers | #67 | 0 FAIL / 1 WARN / 67 PASS on 28 October |

## Verification

Latest CI: **1,848 passed**, 1 warning, **90.11%** branch-aware coverage; [coverage XML](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693753/artifacts/12787589015). Semgrep: 293 rules, 119 targets, 0 findings; [SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693753/artifacts/12788311573). Backend Ruff [SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40622693753/artifacts/12788396786). Frontend ESLint and npm audit passed (log only on this commit); npm audit found 0 vulnerabilities. This branch adds downloadable JUnit XML, frontend ESLint JSON and Trivy SARIF artifacts; do not describe them as produced until its CI succeeds.

**Open:** `CVE-2026-54369` (`libacl1`, HIGH) remains unresolved. The new pip-vendored msgpack finding is fixed in the Dockerfile but awaits re-scan. Non-root containers reduce exposure but do not patch `libacl1`. The team must assign a risk owner and re-scan after an upstream fix. The 1 ZAP warning remains open. Authenticated endpoints and external employer sites were not DAST-scanned. The teacher's auto-caption “TASD” is not an additional scan; the configured tool is **DAST with OWASP ZAP**.

**IaC scope:** Docker Compose and Dockerfiles define reproducible **local** containers. Checkov scans Dockerfiles only. No cloud network, managed database, compute platform, secrets store or autoscaling has been provisioned as code. See [deployment/IAC_STATUS.md](../deployment/IAC_STATUS.md).

Links: PRs [#58](https://github.com/ensommeille/JobPilot-SG/pull/58), [#61](https://github.com/ensommeille/JobPilot-SG/pull/61), [#63](https://github.com/ensommeille/JobPilot-SG/pull/63), [#64](https://github.com/ensommeille/JobPilot-SG/pull/64), [#66](https://github.com/ensommeille/JobPilot-SG/pull/66). Security Scans workflow: `.github/workflows/security-scans.yml`.
