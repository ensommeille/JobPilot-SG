# SWE5006 final report insert — DevSecOps evidence (28 October 2026)

This section is ready for the team's final report **after the team confirms the reviewed commit and downloads the cited artifacts**. The latest numbers below are from [PR #68](https://github.com/ensommeille/JobPilot-SG/pull/68) verified code revision [`f5aaf0b`](https://github.com/ensommeille/JobPilot-SG/commit/f5aaf0bf00312d6b0897c7cbc3e615ee20411996), [CI run 40692607191](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191) and [Security Scans run 40692607160](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160). Earlier results are labeled as such. This is a dated PR snapshot, not a claim about a later release or merged `main`.

## English text for the report

Our GitHub Actions CI validated the repository structure and Docker Compose configuration, ran backend Ruff linting, 1,848 backend unit/API tests (90.11% branch-aware coverage), Semgrep SAST (0 findings across 293 rules and 119 targets), project-scoped `pip-audit` (no known vulnerabilities), frontend ESLint, build and npm audit (0 vulnerabilities at the configured threshold), extension checks, an isolated application journey and a Docker smoke check. The downloadable reports are separated from log-only outcomes below; a passing run does not mean every security finding is resolved.

| Evidence | Downloadable report or run log |
|---|---|
| Backend lint | [Ruff SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12817203417) |
| Frontend lint | [ESLint JSON](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12818166120) |
| Unit/API tests | [JUnit XML](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12817982107), [coverage XML](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12817767841), [job log](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191) |
| SAST | [Semgrep SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191/artifacts/12816789688) |
| DAST | [ZAP report](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12816629618) |
| Container scanning | [Trivy SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818355372) |
| Dockerfile policy | [Checkov JSON](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818275545) |
| Dependency scans and Docker smoke | [CI run logs](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607191); no dedicated downloadable result for these checks |

The separate Security Scans workflow ran an OWASP ZAP baseline against the public `/jobs` API, Checkov against the two Dockerfiles, and Trivy against the backend image. Checkov improved from a previously recorded 90 passes/4 failures to [113 passes/0 failures](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818275545) after both Dockerfiles gained a health check and non-root user in [PR #67](https://github.com/ensommeille/JobPilot-SG/pull/67). The same PR added HTTP security headers; the [ZAP re-scan](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12816629618) reported 0 failures, 1 remaining cacheability warning on 404 pages and 67 passes. Its target and spider scope do not cover authenticated features or employer sites. The [first downloadable Trivy SARIF on PR #68](https://github.com/ensommeille/JobPilot-SG/actions/runs/40691560445/artifacts/12816284892) contained **2 HIGH** findings: the previously reported `libacl1` issue and a newly detected pip-vendored `msgpack` issue. PR #68 removed pip from the runtime image after installation. The downloaded [post-fix SARIF](https://github.com/ensommeille/JobPilot-SG/actions/runs/40692607160/artifacts/12818355372) contains **1 HIGH**, only `libacl1`; the image-exposure finding for pip-vendored msgpack is closed on this commit. Eleven other IDs remain suppressed by `.trivyignore`, not fixed.

Our security triage keeps the before-scan files, the fix pull requests and re-scan links together in [`docs/security/README.md`](README.md). The initial `pip-audit` snapshot contained 25 findings across six packages; after [PR #58](https://github.com/ensommeille/JobPilot-SG/pull/58), the project-scoped CI audit found none. An older whole-environment after-snapshot still contains five findings in three CI-toolchain packages, so it is not used as evidence of a clean whole environment. The remaining ZAP warning and the reported `libacl1` issue stay open for owner review and re-scanning. Scan success is not the same as vulnerability closure.

Our deployment definitions are Dockerfiles and Docker Compose. They make the local database, Redis, backend, frontend and optional scheduler reproducible; `docker compose config -q` passed on 28 October and also runs in CI. This is **local declarative deployment**, not verified cloud infrastructure as code. We have not provisioned cloud network, managed storage, secrets, autoscaling or a release environment from Terraform/Pulumi. The Checkov job tests Dockerfile policy, not a cloud IaC plan. Details and a future cloud-IaC boundary are in [`docs/deployment/IAC_STATUS.md`](../deployment/IAC_STATUS.md).

## 中文核对版（不要作为另一组测试结果）

截至 2026 年 10 月 28 日，PR #68 的 CI 记录显示：后端 1,848 项测试通过、分支覆盖率 90.11%；Semgrep 扫描 293 条规则、119 个目标，发现 0 项；项目依赖的 `pip-audit .` 没有已知漏洞；前端 lint、构建和 npm audit 通过。Ruff、JUnit、覆盖率、Semgrep、ESLint、ZAP、Trivy 和 Checkov 都已有上表的可下载产物；依赖扫描和 Docker smoke 目前主要看运行日志。PR 仍待团队评审合并，不能说这些结果已经在合并后的 `main` 上验证。

安全复扫中，Checkov 为 113 通过、0 失败；ZAP 为 0 失败、1 项低风险警告、67 通过。ZAP 只扫了本地临时环境的公开 `/jobs`，不能写成整站 DAST。PR #68 第一次可下载的 Trivy SARIF 显示 **2 项 HIGH**：`libacl1` 原有问题和 pip 内附带的 `msgpack` 新问题。移除运行时 pip 后的 SARIF 只剩 **1 项 HIGH（libacl1）**，所以本次镜像的 msgpack 暴露已解决；另外 11 个被忽略的 ID 仍不等于漏洞修复。视频字幕里的“TASD”应按工作流核实为 **DAST / OWASP ZAP**，不是新测试名称。

Docker Compose 和 Dockerfile 证明本地容器部署可复现，不能写成已经实现云资源 IaC。最终报告应放上此处的运行链接、下载后的报告附件、修复 PR 及未关闭风险，并按实际最后一次运行更新数字。
