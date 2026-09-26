# JobPilot SG 后端核心与数据库进展报告 4

- **课程：** SWE5006 Designing Modern Software Systems Practice Module
- **负责人：** LIAO BINGFENG
- **完成日期：** 2026 年 9 月 25 日
- **范围：** M2 与 M3 采集数据的数据库集成

## 完成结论

本阶段已经把 M3 输出的标准化职位记录接入 M2 的关系数据库模型。系统现在可以将
`JobRecord` 写入 `JobSource`、`JobPosting` 和 `JobTag`，记录每次采集的 `CrawlRun`，并通过
管理员接口配置来源、手动触发采集和查看运行结果。重复输入不会创建重复职位，内容变化会
更新已有职位，采集失败不会删除此前已接受的数据。

截至本报告完成时，后端完整测试为 **202 passed**，分支覆盖率为 **92.19%**，Ruff 和
Semgrep 均无发现。服务还使用临时 SQLite 数据库完成了迁移、启动、健康检查、注册和登录的
本地冒烟验证。

为支持 M1 从本地 Vite 页面调用后端，本阶段还加入了环境变量控制的 CORS 来源白名单。默认仅
允许 `localhost:5173` 和 `127.0.0.1:5173`，部署环境可以通过 `CORS_ORIGINS` 覆盖。

## 数据库集成

新增的 SQLAlchemy repository 负责把 M3 的标准化结构转换为现有数据库结构。该转换保留了
职位来源、外部编号、薪资、日期、描述、哈希和状态，并明确处理了集成前发现的字段差异。

| 字段差异 | 处理方式 |
|---|---|
| M3 的 `source_id` 为字符串，数据库外键为 UUID | 每个采集适配器运行时使用数据库 `JobSource.id` 作为来源标识 |
| M3 的 `job_type` 可以包含多个值 | 第一个值写入可筛选的 `job_type`，所有值同时保存在职位标签关系中 |
| M3 的 `apply_url` 可以为空 | 缺失时使用公开的 `source_url`，满足数据库非空约束并保留可访问链接 |
| 重复采集与内容变化 | 先按来源和外部编号匹配；`raw_hash` 未变化时保持不变，变化时更新原记录 |

数据库写入由采集服务统一控制事务。职位写入完成后才提交运行结果。如果写入过程出现异常，
本次运行会被记录为失败，已经存在的有效职位不会被清空或覆盖。

## 管理员接口

| 接口 | 已完成行为 |
|---|---|
| `GET /sources` | 返回已配置的职位来源 |
| `POST /sources` | 创建经过 HTTPS 地址校验的来源，并防止来源名称重复 |
| `POST /sources/{id}/run` | 以限定数量同步执行一次采集，写入职位、运行统计和审计事件 |
| `GET /runs` | 分页返回采集运行历史 |
| `GET /runs/{id}` | 返回单次运行的状态、数量和结构化错误信息 |

所有来源和运行接口都要求管理员身份。普通求职者访问时返回 403，未登录访问时返回 401。
实际网络采集目前只允许启用的 InternSG HTML 来源；测试使用可注入的 fixture 适配器，不会访问
外部网站。

## 运行状态与审计

每次手动采集都会先创建 `running` 状态的 `CrawlRun`，结束后更新为 `succeeded`、`partial`
或 `failed`。系统保存发现、新增、更新和失败数量，以及失败阶段、异常类型、错误信息和是否可
重试。来源状态会相应更新为 `healthy`、`degraded` 或 `failed`。

创建来源和执行采集都会写入 `AuditLog`，记录操作人、实体、最终状态和数量。该数据已经可以
支持后续 M5 的审计查看接口和端到端验证。

## 验证结果

| 检查 | 结果 |
|---|---|
| Ruff 静态检查 | 通过，无发现 |
| Pytest 完整测试 | 202 passed |
| 分支覆盖率 | 92.19%，高于 85% CI 门槛 |
| Semgrep 安全扫描 | 通过，无阻断发现 |
| 数据库迁移 | SQLite 冒烟环境升级到最新版本成功 |
| 服务启动 | FastAPI 启动成功，`/health` 返回 200 |
| 认证冒烟测试 | 注册返回 201，登录返回 200 |
| 新接口发现 | OpenAPI 包含 `/sources`、`/sources/{id}/run`、`/runs` 和 `/runs/{id}` |

本机未安装 Docker，因此尚未在本机启动 Docker Compose PostgreSQL。数据库代码继续使用项目原有
SQLAlchemy 类型和 Alembic 迁移，GitHub CI 将负责 Linux、Python 3.13 和 Docker 构建验证。

## 对团队的影响

M3 可以继续维护采集和解析逻辑，不需要直接操作数据库。M1 在数据库中存在职位后，可以通过
现有 `/jobs` 接口读取真实数据并替换页面中的 mock 列表。M5 可以基于 `CrawlRun` 和
`AuditLog` 增加 PostgreSQL 集成测试及审计页面。M4 的 Provider PR 仍处于 Draft，本阶段没有
修改其代码或提前实现其负责的表单映射服务。

## 下一阶段

下一阶段是 M1 与 M2 的真实 API 数据联调，包括演示数据和前后端字段契约。M4 完成
`FormMappingGateway` 后，再进行表单映射服务的后端注入和持久化联调。

## 追踪信息

- GitHub Issue：[#11 Persist ingestion results and crawl runs in PostgreSQL](https://github.com/ensommeille/JobPilot-SG/issues/11)
- 开发分支：`feat/member2-ingestion-db-integration`
- 基准分支：`main` at `1eb24ee`
