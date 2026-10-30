# Security Testing — Results & Before/After Evidence

Evidence snapshot: **28 October 2026**, [PR #68](https://github.com/ensommeille/JobPilot-SG/pull/68) verified code revision [`f5aaf0b`](https://github.com/ensommeille/JobPilot-SG/commit/f5aaf0bf00312d6b0897c7cbc3e615ee20411996). Its [CI run](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191) and [Security Scans run](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160) both completed successfully. The pre-fix comparison uses `main` at [`66eacc9`](https://github.com/ensommeille/JobPilot-SG/commit/66eacc9de6a6972bd06d19aaebf2e06d2a3c5f7f) and PR #68's first image scan. Green jobs do not mean zero findings: ZAP and Checkov are advisory, and Trivy's count must be read from SARIF. See [the final-report evidence insert](REPORT_INSERT_20261028.md) for exact artifact links. GitHub artifacts may expire; download them for the report while available.

## 1. SAST — Semgrep

| Stage | Result |
|---|---|
| Before | **0 findings** (`sast-semgrep-before.json`) |
| After | 0 findings (no code change needed) |

## 2. SCA — Backend (pip-audit)

| Stage | Result |
|---|---|
| Before | **25 vulnerabilities / 6 packages** (`sca-pip-before.json`) |
| After | `pip-audit .` on project runtime: **0 known vulnerabilities** in the [PR #68 CI log](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191). The earlier `sca-pip-after.json` includes **5 findings in 3 CI-toolchain packages** (`filelock`, `mcp`, `opentelemetry-api`); it is not a zero-finding whole-environment result. |

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
| Re-scan | [PR #68 ZAP artifact](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12816629618): **0 FAIL / 1 WARN / 67 PASS**. The remaining `Storable and Cacheable Content` warning concerns spidered 404 responses; keep it open. |

Not yet covered (needs auth): login, profile, PDF, application endpoints. This is a **public-endpoint baseline**, not a full-stack DAST. Report artifact: `zap-report` (set via `artifact_name`).

## 5. Container scanning — Trivy

The team's earlier register reported **39 HIGH before → 1 unignored HIGH after**, but this was superseded by an actual [PR #68 Trivy SARIF artifact](https://github.com/ensommeille/JobPilot-SG/actions/runs/40691560445/artifacts/12816284892): **2 HIGH** (`CVE-2026-54369` in `libacl1`; `CVE-2026-114613` in `msgpack`). The SARIF contains 125 findings across all severities because the action reports all severities in SARIF, despite the configured `HIGH,CRITICAL` scan input. Eleven IDs in [`.trivyignore`](../../.trivyignore) are excluded from displayed findings; they are **suppressed, not fixed**.

| Category | Items | Status |
|---|---|---|
| **Previously reported fixed** (dependency upgraded) | urllib3 2.7→2.8.0, setuptools 70.3→84.2.1 | Not among the HIGH results in the PR #68 after-scan |
| **Suppressed in the scan** (`.trivyignore`) | 7 Debian OS-package CVEs and 4 vendored-package advisories | ⚠️ exclusions, **not** fixes; risk owner/acceptance still needs team sign-off |
| **Unresolved** (HIGH, no fix version) | **CVE-2026-54369 — libacl1 (symlink-traversal privilege escalation)** | ❌ open |
| **New on PR #68 first scan** (HIGH, fix version listed) | **CVE-2026-114613 — msgpack 1.1.2**, vendored inside pip 26.2.2; no standalone runtime `msgpack` distribution | Runtime pip removed in PR #68; absent from the [after-scan SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818355372) |

**CVE-2026-54369** (`libacl1`, HIGH) is recorded in the team's earlier register as having no fixed version. The backend container now runs as non-root, but that does not patch `libacl1`. Assign a risk owner, inspect the current SARIF and re-scan when a base-image update becomes available. Do not mark the issue closed from a green scan job alone.

**CVE-2026-114613** was traced to `/usr/local/lib/python3.13/site-packages/pip/_vendor/msgpack/`, not a JobPilot runtime dependency. A disposable container showed `pip` 26.2.2 vendoring msgpack 1.1.2 and no standalone `msgpack` distribution. [PR #68](https://github.com/ensommeille/JobPilot-SG/pull/68) removes pip after installing the application. The modified image built; `app.main` imported and `alembic --version` ran while both pip and msgpack were absent. The [first SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40691560445/artifacts/12816284892) had **2 HIGH** among 125 total results; the [post-fix SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818355372) has **1 HIGH** (`libacl1`) among 121 total results. Both artifacts were downloaded and parsed locally. This closes the **image-exposure finding for pip-vendored msgpack** on this commit; it does not prove the upstream package itself is fixed.

## 6. IaC scanning — Checkov

| Stage | Result |
|---|---|
| Scope | scans **Dockerfiles** (`--framework dockerfile`) |
| Report | `results_json.json` (artifact `checkov-report`) |
| Before | **90 passed, 4 failed** (CKV_DOCKER_2 HEALTHCHECK ×2, CKV_DOCKER_3 non-root user ×2), from the earlier register |
| Fix | HEALTHCHECK + non-root `USER` added to both backend and frontend Dockerfiles |
| Re-scan | [PR #68 Checkov artifact](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818275545): **113 passed, 0 failed, 0 parsing errors** |

## Scan → fix → re-scan correspondence

| Scan | Initial | Issue | Fix PR | Re-scan |
|---|---|---|---|---|
| pip-audit | `sca-pip-before.json` (25) | PyJWT/urllib3/certifi | #58 | Project-scoped CI audit: 0; older whole-environment JSON: 5 toolchain findings |
| Semgrep | 0 | — | — | 0 |
| npm audit | 0 | — | — | 0 |
| Trivy | 39 HIGH (earlier summary; raw pre-fix SARIF not retained here) | deps fixed/suppressed; new pip-vendored msgpack finding | #58, #61, #63, #64, #68 | PR #68 SARIF: 2 HIGH before pip removal → 1 HIGH after; `libacl1` stays open |
| Checkov | 90 pass / 4 fail | HEALTHCHECK + USER | #67 | 113 pass / 0 fail on 28 October |
| ZAP | 2 Low + 1 Info | security headers | #67 | 0 FAIL / 1 WARN / 67 PASS on 28 October |

## Verification

Latest PR CI: **1,848 passed**, 1 warning, **90.11%** branch-aware coverage; The downloaded [JUnit XML](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12817982107) was parsed as 1,848 tests, 0 failures, 0 errors and 0 skips. [Coverage XML](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12817767841) is also downloadable. Semgrep: 293 rules, 119 targets, 0 findings; [SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12816789688). Backend Ruff [SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12817203417). Frontend ESLint [JSON](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12818166120) is downloadable; lint/build/npm audit passed, with npm audit reporting 0 vulnerabilities. The [Trivy SARIF ZIP](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818355372) is also downloadable and was parsed for the HIGH count above.

**Open:** `CVE-2026-54369` (`libacl1`, HIGH) remains unresolved after the 28 October PR re-scan. Non-root containers reduce exposure but do not patch `libacl1`. The team must assign a risk owner and re-scan after an upstream fix. The 1 ZAP warning remains open. Authenticated endpoints and external employer sites were not DAST-scanned. The teacher's auto-caption “TASD” is not an additional scan; the configured tool is **DAST with OWASP ZAP**.

**IaC scope:** Docker Compose and Dockerfiles define reproducible **local** containers. Checkov scans Dockerfiles only. No cloud network, managed database, compute platform, secrets store or autoscaling has been provisioned as code. See [deployment/IAC_STATUS.md](../deployment/IAC_STATUS.md).

Links: PRs [#58](https://github.com/ensommeille/JobPilot-SG/pull/58), [#61](https://github.com/ensommeille/JobPilot-SG/pull/61), [#63](https://github.com/ensommeille/JobPilot-SG/pull/63), [#64](https://github.com/ensommeille/JobPilot-SG/pull/64), [#66](https://github.com/ensommeille/JobPilot-SG/pull/66). Security Scans workflow: `.github/workflows/security-scans.yml`.
