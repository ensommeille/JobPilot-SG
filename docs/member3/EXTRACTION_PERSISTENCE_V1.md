# 岗位抽取持久化与管理员接口 v1

日期：2026-09-26。实现位于本地 `feat/member3-pipeline-integration-v2`，尚未推送。
依赖的 M2/M4 分支见 `OFFLINE_INTEGRATION_V2.md`。本文取代其中“抽取持久化待定义”的旧边界说明。

## 这一版做了什么

岗位按原流程采集入库；管理员再手动触发独立抽取，结果进入独立数据库表。
原始 JD、薪资和岗位状态不会被 AI 结果覆盖。采集不自动触发模型。
本版 API 默认且仅配置 `mock-empty-v1`：不访问模型、不读取 LLM 密钥。
Mock 返回空结构，用于验证权限、存储和接口，不代表识别出了岗位技能；空结果仍需人工复核。
原有离线 fixture CLI、抽取 schema 与公共 Provider contract 0.1.0 均保持不变。

## 数据与迁移

新增 `job_postings.source_url`（可空），保存原始详情页 URL；`apply_url` 仍表示申请入口。
旧数据不会用申请 URL 自动填充来源。重新采集可补齐来源，即使 raw_hash 未变化。
跨来源 dedup_hash 命中时保留原岗位来源与 external_id，不把第二来源内容覆盖进第一来源身份。
这只是保留单一规范来源，不是完整的多来源映射功能。

新增 `job_extraction_runs`：

- UUID 主键，关联岗位与触发管理员。
- 输入快照（含原始 JD 和详情 URL）、input_hash、运行配置快照与 pipeline_hash。
- running / needs_review / failed 状态，结构化 ExtractionResult、错误码和 UTC 时间。
- 唯一 active_key 防止同一岗位同时抽取；expires_at 用于中断后的显式恢复。

迁移链：`20260909_0001 -> 20260926_0002`。部署新代码前，先备份目标数据库，确认
DATABASE_URL 指向预期环境，再在 backend 目录运行 `.venv\Scripts\python.exe -m alembic upgrade head`。
本次仅在测试生成的 SQLite 文件上执行迁移，未升级用户或团队的真实数据库。
回退到上一版本会删除抽取历史表和 source_url 列；不要在有需保留数据的环境中直接 downgrade。

## 接口约定

全部接口要求管理员 Bearer token，未登录 401、普通用户 403。请求不能传密钥、模型 URL 或 Provider。

- `POST /jobs/{job_id}/extractions`，JSON `{}` 或 `{"force": true}`。
  新运行返回 201；复用返回 200，`reused=true` 且 ID 不变。
  同步等待该岗位的抽取完成，不是后台队列。HTTP 201 表示运行记录已创建，必须继续检查 status。
- `GET /jobs/{job_id}/extractions?page=1&page_size=20`：按时间倒序查询历史，page_size 上限 100。
- `GET /extractions/{run_id}`：查询一条记录。
- `POST /extractions/{run_id}/recover`：仅允许把已过期的 running 记录标为 failed / extraction_interrupted。
  不删除旧结果、不自动重试。未过期或已结束返回 409。

记录响应包含 `status`、`result`、`error_code`、`is_stale`、`is_current_pipeline`、
`pipeline`、输入/配置哈希和 UTC 时间。输入快照留在数据库用于核验，不在此响应重复返回整份 JD。

明确错误：岗位/记录不存在 404；缺来源 URL 返回 422 / missing_source_url_recrawl_required；
JD 超过现有 40,000 字符等输入限制返回 422 / invalid_stored_extraction_input；
已有同岗位运行返回 409 / extraction_already_running。

## 复用、过期和失败规则

复用必须同时满足同岗位、同 input_hash、同 pipeline_hash、旧记录 needs_review。
input_hash 覆盖抽取输入，不单凭原页面 raw_hash 判断。
pipeline_hash 覆盖 Provider、模型、配置修订、调用配置和 prompt/schema/quality/contract 版本。
更换模型端点、模型修订或 fixture 内容时，服务端必须更新 profile_revision；不得复用旧配置标签。
`force=true` 只跳过缓存，不跳过权限或并发保护。

内容改变后，旧结果仍可查询但 is_stale=true；运行期间岗位变化也按此规则处理。
配置版本变化单独体现为 is_current_pipeline=false。消费者不能只拿时间最新的一条：
应选择 needs_review、is_stale=false、is_current_pipeline=true 的记录，再进行人工复核。
needs_review 不等于已批准；quality.score 是证据覆盖诊断，不是准确率或可信概率。

失败产生独立记录，不覆盖上一份有效结果；失败记录不参与缓存。
Provider 生命周期由运行时工厂管理，鉴权、结构错误和异常均以错误码记录，不保存原始异常文本或密钥。
默认 Mock 运行可用于离线演示，但不得把 Mock 结果当作真实模型效果对外汇报。

## 并发与中断

运行前用数据库唯一约束取得岗位租约，提交 running 记录后再调用 Provider，不在调用期间持有写事务。
两个独立会话的冲突请求不能同时调用模型。每次创建/结束/复用记录写入现有 AuditLog。
进程崩溃可能留下 running；过期后由管理员 recover，再决定是否重新触发。
恢复与正常结束使用条件更新，迟到的旧进程不能覆盖已恢复的记录。
本版不保证崩溃场景“模型恰好调用一次”；未来开启付费模型时，还需预算和供应商请求幂等策略。

## 团队接入与验证

本机最终验证：Python 3.12.7，265 项测试通过，包含分支的覆盖率 92.37%（阈值 85%）。
全后端 Ruff lint、10 个新增 Python 文件的格式检查、pip check 和 git diff --check 通过。
SQLite 迁移升级/回退/再升级、Alembic check 的 ORM 一致性检查通过。
仍有一条依赖弃用提示：Starlette 的 httpx TestClient 集成后续需要迁移。
未运行实际 PostgreSQL、Docker、Semgrep、依赖漏洞扫描或远端 CI；本轮未推送、未合并 main。

M2 无需重新设计这套表和接口，但合并时应保留这一迁移链，不另建同名表。
M4 继续只实现公共 Provider；将来启用真实模型时由服务端运行时工厂统一管理创建/关闭，
并显式设置 profile_revision、provider、model、is_mock；当前接口没有开通付费模式。
M1 可使用 /jobs 新增的可空 source_url；抽取管理接口仅管理员可调用，不改变普通求职者权限。
M5 应复核实际 PostgreSQL、Docker 和 Linux CI；本机 SQLite 通过不代表生产数据库已经验证。

测试入口（backend 目录）：

```powershell
$testTempRoot = Join-Path $env:TEMP ('jobpilot-m3-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testTempRoot | Out-Null
$env:PYTEST_DEBUG_TEMPROOT = $testTempRoot
.venv\Scripts\python.exe -m pytest -q --cov=app --cov-branch --cov-fail-under=85
.venv\Scripts\python.exe -m ruff check .
```

定向测试文件：test_persistence_api.py、test_concurrency.py、test_migration.py，
以及 ingestion/test_api_pipeline.py。覆盖采集到结果查询、权限、复用、强制重跑、失效、
故障保护、两个会话的租约竞争、迟到结果保护、迁移升级/回退/再升级与模型元数据一致性。
PostgreSQL 仅测试了不连接数据库的迁移 SQL 生成；未调用模型 API。
