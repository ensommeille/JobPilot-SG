# SWE5006 PRACTICE MODULE
# JobPilot SG：招聘信息聚合与 AI 智能网申助手
# 开发文档 / Development Document

版本 v0.2 · Proposal & Development Baseline

v0.2 变更要点：① 信息源确定为新加坡本地岗位（InternSG 主源 + 沙箱 fixture 源）；② 填表助手调整为分阶段——Phase 1 先做平台内置 AI Application Form Assistant，Phase 2 再扩展为 Chrome 浏览器插件，优先保证课程项目完成度；③（v0.2.1 分工调整）LLM 岗位抽取移交 Member 3（管道侧，其核心采集步骤已跑通、有富余产能），Member 4 聚焦 Form Assistant 与 Provider 接口（表单侧）；④（v0.2.1 补充）填表相关 /assistant/* 路由与结果入库归 M2，FormMappingService / DraftGenerationService 等 domain 服务归 M4；⑤ LLM 明确为 M3 岗位抽取与 M4 填表服务共同调用的共享 Provider 接口。

| 项目 | 内容 |
|---|---|
| 课程 / Module | SWE5006 Designing Modern Software Systems – Practice Module Project |
| 项目形态 | Web-based modular monolith + 定时采集流水线 + 平台内置 AI 填表助手（Phase 2 扩展为浏览器插件） |
| 团队规模 | 5 members：TANG YUCHEN / LIAO BINGFENG / ZHU PENGXU / LIN XINDA / LIAO CAN |
| 当前阶段 | Proposal 定稿 → 2026-08-28 前提交 |
| 核心原则 | Deterministic extraction + LLM assistance + Human-in-the-loop；AI 只辅助填写，不自动提交网申 |

依据：NUS-ISS SWE5006 Briefing（20 Aug 2026）中关于 Group Project、Proposal、Deliverables、Assessment 与 Progress Report 的要求；并参考同类产品（求职方舟 qiuzhifangzhou.com 的"岗位信息汇总 + AI 自动填网申 + 投递进度管理"形态）确定功能基线。

---

## 1. 项目定位与目标

**一句话定义**：系统通过定时采集任务与 LLM 抽取，将分散在新加坡各招聘渠道的岗位信息（InternSG 为主源）汇总为统一、实时更新的岗位库；求职者用标签与条件筛选心仪岗位后，平台内置的 AI Application Form Assistant 基于用户预先维护的个人资料与简历，以"AI 辅助映射 + 人工逐项确认"的方式自动填写网申表单，并回写完整投递档案。Phase 1 助手运行在平台内嵌表单上，Phase 2 将同一映射引擎扩展为 Chrome 浏览器插件以覆盖第三方网申页面。

**解决痛点**：
- 新加坡岗位信息分散在 InternSG、MyCareersFuture、LinkedIn、大学求职门户与各公司官网，存在严重信息差；校招/实习岗位时效性强，容易错过截止日期。
- 各公司网申表单字段相似但结构各异，求职者需要反复填写姓名、教育经历、实习经历等大量相同信息，耗时且易出错。
- AI 与自动化技术可用于打破信息差，但"全自动无人值守"的填表与提交存在误填、错投风险，必须由人做最终决定。

**核心价值**：一次维护资料、多处自动投递（打破信息差 + 消除重复劳动），同时通过 Human-in-the-loop 保证"AI 只提供建议与草稿，用户拥有最终控制权"。

**课程定位**：这是一个软件工程项目，LLM 是可替换组件（用于"抽取/规范化"与"表单字段映射"两个环节），不是整个系统。核心工程复杂度在于：多源采集流水线的健壮性与去重、LLM 结构化输出的可靠性控制、平台内置填表助手与后端之间的数据通道。

**阶段策略（重要）**：浏览器插件需要处理 DOM 兼容性、Manifest V3 生命周期、content script 注入、service worker 消息桥、跨域 iframe、动态表单与权限管理，复杂度高且依赖第三方站点。为保证项目完成度，**Phase 1 只做平台内置 AI 填表助手**（表单识别、映射引擎、确认面板均与站点无关），**Phase 2（MVP 稳定后）再把同一映射引擎封装为 Chrome 插件**。首期信息源为 InternSG（主源）+ 沙箱 fixture 源；不训练模型、不做无人值守投递、不要求 Kubernetes。

### 1.1 成功标准

- 用户能够注册、登录并维护个人资料与简历。
- 系统能够按调度（或手动触发）从 InternSG 与沙箱源采集岗位，经 LLM 抽取与去重后结构化入库。
- 岗位列表页能够按标签、城市、关键词、薪资、岗位类型筛选并分页展示。
- 用户能收藏岗位并记录/回写投递状态。
- 平台内置 AI 填表助手能在平台内嵌的（仿真）网申表单上识别表单，由 LLM 生成字段映射草稿，用户确认后自动填写；未确认的字段不填写，提交按钮必须由用户点击。
- 所有关键操作可追踪：crawl run、LLM response、human confirmation、application、timestamp。
- 项目本身具备 CI/CD、自动测试、SAST、dependency scan 与 Docker build。
- Phase 2 Chrome 插件作为 stretch goal，MVP 完成度不依赖它。

### 1.2 与 SWE5006 要求的对应

| 课程能力 | 本项目体现方式 | 主要证据/产物 |
|---|---|---|
| Agile Practices | Product Backlog、User Stories、Sprint Planning、Review、Retrospective | Backlog、Sprint artifacts、Progress Reports |
| Analysis & Design | Use Case、Domain Model、Sequence Diagram、模块边界、架构决策 | UML/architecture、ADR、接口设计 |
| Design Patterns | Strategy/Adapter/Template Method（Factory/Observer 按需）；"设计问题 → 模式 → 影响"说明 | 类图、设计问题与模式说明 |
| DevSecOps | CI、unit test、SAST、dependency scan、Docker build、安全 gate | GitHub Actions workflow、test report、scan output |

## 2. Scope：做什么 / 不做什么

| MVP / 必做 | Out of Scope / 第一版不做 |
|---|---|
| • 用户注册/登录与基础 RBAC（求职者 / Admin） | • 大规模多平台爬取（仅 InternSG + 沙箱源；MyCareersFuture 等留待扩展） |
| • JobSource 管理 + 定时/手动采集（InternSG 主源 + 沙箱 fixture 源） | • 浏览器插件（Phase 2 再做，先保证平台内置助手完成度） |
| • 采集 → 解析 → LLM 抽取 → 规范化 → 去重 → 入库 | • 简历自动优化/生成（仅维护资料与回填） |
| • 岗位列表卡片：职位、公司、城市、薪资、学历/经验、标签、截止、来源、外链 | • 全自动无人值守投递 / AI 自动点击"提交" |
| • 标签/关键词/城市/薪资/类型筛选 + 分页 | • 移动端 App / 小程序 |
| • 收藏与投递记录管理 | • 多租户、计费、内推码交易 |
| • 个人资料与简历管理（预填数据源） | • Fine-tuning、自训练模型 |
| • 平台内置 AI 填表助手：表单识别 → LLM 字段映射 → 人工确认 → 自动填写 → 回写投递 | • Multi-Agent / autonomous agent |
| • Admin 查看采集运行记录与审计日志 | • Kubernetes、复杂微服务 |
| • CI/CD + unit tests + SAST + dependency scan + Docker | • 以 LLM 输出作为最终投递决策（必须人工确认） |
| • 平台内嵌仿真网申表单 fixture（支撑助手演示） | • 生产级大规模并发与云部署 |

## 3. 用户角色与核心 Use Cases

### 3.1 用户角色

| 角色 | 权限 | 设计目的 |
|---|---|---|
| Job Seeker（求职者） | 浏览/筛选岗位、收藏、维护资料与简历、使用内置填表助手投递、查看自己的投递历史 | 核心业务用户；体现 Human-in-the-loop |
| Admin | 管理信息源与采集任务、查看系统级 audit 与运行状态 | 运维与审计角色；控制 scope，不做复杂 IAM |

### 3.2 MVP Use Cases

| ID | Use Case | Actor | 复杂度 | 验收结果 |
|---|---|---|---|---|
| UC01 | User Registration & Authentication | Job Seeker/Admin | 低 | 可注册、登录并获得角色权限 |
| UC02 | Browse & Filter Jobs | Job Seeker | 中 | 按标签/关键词/城市/薪资/类型筛选，分页展示 |
| UC03 | View Job Detail & External Link | Job Seeker | 低 | 展示完整岗位字段并可跳转原始页面 |
| UC04 | Favorite & Manage Favorites | Job Seeker | 低 | 收藏/取消收藏，收藏列表可见 |
| UC05 | Profile & Resume Management | Job Seeker | 中 | 维护预填资料、上传/管理简历文档 |
| UC06 | Scheduled Job Ingestion | System/Admin | 高 | 定时或手动触发采集（InternSG + 沙箱源），抽取、去重、增量更新入库 |
| UC07 | AI-Assisted Form Filling (In-Web Assistant) | Job Seeker/System | 高 | 识别平台内嵌网申表单 → LLM 映射 → 人工确认 → 填写 → 回写投递 |
| UC08 | Application Tracking & Audit | Job Seeker/Admin | 中 | 每次投递可追踪，Admin 可查看 audit 事件 |

## 4. 系统架构

建议：**Web-based Modular Monolith + 定时采集 Worker + 平台内置 AI 填表助手**。对 5 人课程项目而言，模块化单体比微服务更容易开发、测试、演示与撰写设计文档，同时仍能体现可维护性与可扩展性；采集任务作为 monolith 内的调度模块（APScheduler）运行，避免引入独立 worker 基础设施。

```
React Web UI (岗位浏览/筛选/收藏/资料 + 内置 AI 填表助手确认面板)
        │  REST/JSON over HTTPS
        ▼
              FastAPI Modular Monolith
        ├─ Auth / RBAC            ├─ Ingestion Orchestrator
        ├─ Job Query Service      ├─ Source Adapter (InternSG/RSS/HTML/Mock)
        ├─ Profile Service        ├─ LLM Extraction Service
        ├─ Application Service    ├─ Form Assistant Service (Phase 1 内置)
        └─ Audit Service          （Phase 2: 同一引擎封装为 Chrome 插件）
                           ▼
        Persistence: PostgreSQL (+ Redis 可选: 去重/限流)
        External: InternSG / 公开源 · LLM API
        GitHub Actions / Docker / Tests
```

### 4.1 核心运行流程

```
数据采集流: InternSG/沙箱源 → Adapter 抓取/解析 → LLM 抽取(JSON) → 规范化/去重 → PostgreSQL
            → Job Query API → React UI（列表/筛选/详情）
投递流:     User Profile → 平台内嵌网申表单（ApplicationForm）
            → Form Assistant 识别表单 → LLM 字段映射(草稿) → 用户逐项确认
            → 自动填写 → 用户点击提交 → 回写 Application
Phase 2:   同一映射引擎以 content script 形式运行于第三方网申页（Chrome 插件）
```

## 5. 技术选型

| 层 | 技术 | 用途 | 为什么选 | 替代方案/备注 |
|---|---|---|---|---|
| Frontend | React + TypeScript + Vite | 岗位列表/筛选/详情、收藏、资料管理、内置填表助手确认面板 | 生态成熟、组件化、适合多人协作 | 快速搭建，无需 SSR |
| Extension (Phase 2) | Chrome Extension MV3 + TypeScript | Phase 2：在第三方网申页复用填表引擎 | MV3 为当前标准；Phase 1 先在平台内置助手，规避 DOM/iframe/权限复杂度 | stretch goal，不进 MVP |
| Backend | Python + FastAPI | REST API、orchestration、采集调度、LLM 集成 | 与 LLM SDK、抓取库集成方便；类型与自动文档友好 | 保持 modular monolith |
| Database | PostgreSQL | 用户、岗位、标签、收藏、投递、audit | 关系清晰、事务可靠、适合结构化数据 | 本地开发用 Docker Compose |
| Cache/Queue | Redis（可选） | 去重缓存、采集限流 | 简单可靠；MVP 可用内存替代 | 采集频率低时可不引入 |
| ORM/Migration | SQLAlchemy + Alembic | 数据访问与 schema migration | 成熟且便于测试 | 避免手工改生产 schema |
| Scheduling | APScheduler | 定时采集任务 | 进程内调度，无需额外 worker | 量级扩大再换 Celery |
| Crawling | httpx + parsel（静态） / Playwright（动态，可选） | 抓取与解析 InternSG 及公开源页面/RSS | 轻量、可控；动态站点用 Playwright 兜底 | InternSG 主源 + 沙箱 fixture 源，演示优先 |
| LLM | 单一 LLM Provider API（Provider Strategy） | 岗位抽取/规范化、表单字段映射（内置助手与 Phase 2 插件共用） | 不自训模型，控制工期 | 同一共享接口被 M3 抽取与 M4 映射复用，可替换 |
| Auth | JWT + password hashing | 登录与角色控制 | 足够满足课程范围 | MVP 不做企业 SSO |
| Testing | pytest + httpx/TestClient + Playwright | service/API/unit/integration + 填表助手 E2E | Python/JS 生态一致 | 关键 service 必须有 unit tests |
| CI/CD | GitHub Actions | lint/test/SAST/dependency/build | 容易展示 automation pipeline | 不要求复杂云部署 |
| Container | Docker + Compose | 统一开发/演示环境 | 降低"我电脑能跑"问题 | DB/App 均可 Compose 启动 |
| Quality/Security | Ruff + Semgrep + pip-audit | lint/SAST/dependency scan | 自动化且结果可留档 | DAST 作为 stretch goal |

## 6. 后端模块与 API 设计

后端工作量控制原则：不做"大而全"的后台；把复杂度放在**采集流水线、LLM 结构化输出、填表助手编排与审计一致性**上。预计 20–25 个 API endpoint 足够。

### 6.1 Backend Modules

| 模块 | 职责 | 主要输入/输出 | Owner 建议 |
|---|---|---|---|
| Auth Service | 注册/登录、JWT、角色检查 | credentials → token | Member 2 |
| Job Query Service | 岗位检索、筛选、分页、详情 | filters → paginated jobs | Member 2 |
| Ingestion Orchestrator | 调度、运行状态机、增量更新 | source_id/trigger → crawl run | Member 3 |
| Source Adapter | 抓取/解析 InternSG、RSS、HTML、Mock 源，输出标准化条目 | source → raw items | Member 3 |
| LLM Extraction Service | 构造 prompt、调用 provider、校验结构化输出、置信度标注 | raw item → normalized JobPosting draft | Member 3（Provider 接口由 M4 统一维护） |
| Profile Service | 个人资料与简历文档管理 | profile/resume → stored data | Member 2 |
| Form Mapping Service（Domain） | FormMappingService / DraftGenerationService、表单识别与确认状态机（草稿→已确认→可应用）、mock、映射契约测试、prompt 版本（Phase 2 同一引擎供浏览器插件调用） | form_snapshot + profile → mapping draft（含 confidence） | Member 4 |
| Assistant API & Persistence | /assistant/* FastAPI router、DTO 映射与服务接线（注入 M4 的 domain services）、投递与映射结果入库、事务与错误处理 | mapping → Application / audit 记录 | Member 2 |
| Application Service | 投递记录与状态管理 | job+user → application | Member 2 |
| Audit Service | 记录关键状态变化与 actor | event → audit record | Member 5 |

### 6.2 API 草案（MVP）

```
# Auth
POST   /auth/register
POST   /auth/login
GET    /users/me

# Jobs
GET    /jobs?q=&tags=&city=&salary_min=&salary_max=&type=&page=
GET    /jobs/{id}
POST   /jobs/{id}/favorite
DELETE /jobs/{id}/favorite
GET    /favorites
POST   /jobs/{id}/applications        # 手动记录外部投递

# Profile
GET    /profile
PUT    /profile
POST   /profile/resumes               # 上传简历文档
GET    /profile/resumes

# Tags / Sources（Sources 为 Admin）
GET    /tags
GET    /sources
POST   /sources                       # 含 internsg 类型
POST   /sources/{id}/run              # 手动触发采集
GET    /runs
GET    /runs/{id}

# Form Assistant（Phase 1 平台内置；Phase 2 插件复用同一接口族）
GET    /assistant/bootstrap           # 版本/可用表单 fixture 列表
GET    /assistant/forms/{form_id}     # 平台内嵌网申表单结构
POST   /assistant/map-fields          # form_snapshot + profile → 映射草稿
POST   /assistant/applications        # 回写已确认提交的投递
GET    /assistant/mappings/{id}       # 查看某次映射的确认记录

# Admin
GET    /audit-logs
```

## 7. 数据模型

| Entity | 关键字段 | 关系 | 说明 |
|---|---|---|---|
| User | id, email, password_hash, role | 1:1 Profile; 1:N Application | Job Seeker / Admin |
| UserProfile | id, user_id, name, phone, email, education, experience, skills, links | 1:N ResumeDoc | 填表助手的数据源；可版本化（MVP 单版本） |
| ResumeDoc | id, profile_id, filename, file_path, uploaded_at | N:1 Profile | 简历文档；MVP 仅存文件元数据 |
| JobSource | id, name, type(internsg/rss/html/mock), base_url, schedule, enabled, status | 1:N CrawlRun | InternSG 主源 + 沙箱 fixture 源；Admin 管理 |
| JobPosting | id, source_id, external_id, title, company, city, salary_min/max, education, experience, job_type, tags, description, apply_url, posted_at, deadline, dedup_hash, raw_hash, status, created_at, updated_at | N:1 Source; 1:N Application; M:N Tag | 去重键 dedup_hash；raw_hash 用于增量更新 |
| JobTag | id, name, category | M:N JobPosting | 实习/全职、研发/产品/运营、城市等 |
| CrawlRun | id, source_id, status, started_at, finished_at, items_found, items_new, items_updated, items_failed, error_summary | N:1 Source | 每次采集运行可审计、可重放 |
| ApplicationForm | id, job_id, template_version, fields_json, is_fixture, created_at | 1:N Application | 平台内嵌网申表单（含仿真 fixture），字段结构供助手解析 |
| Favorite | id, user_id, job_id, created_at | N:1 User/JobPosting | 收藏 |
| Application | id, user_id, job_id, method(manual/assistant), status, applied_url, submitted_at, mapping_version, confirmation_json | N:1 User/JobPosting | 投递档案；记录确认与映射版本（Phase 2 增加 extension 方式） |
| AuditLog | id, actor_id, action, entity_type, entity_id, metadata, created_at | 独立 | 关键动作不可静默覆盖 |

## 8. 招聘信息聚合与 LLM 抽取设计（"数据出错"控制）

LLM 的定位：**在确定性解析不足时做补充抽取与规范化，不负责最终事实判定**。凡是可以用正则/规则确定的字段（薪资、截止日期、城市等），一律规则优先；LLM 只处理规则无法覆盖的语义字段，且必须经过 schema 校验与置信度评估。

### 8.1 采集流水线（每个 Source 独立执行）

```
Fetch (httpx/RSS) → Parse (parsel/RSS feed) → [LLM Extract] → Normalize → Dedup → Upsert → CrawlRun 记录
    失败重试×2、超时、源健康状态                     schema 校验失败 → 标记 extraction_failed
                                                    confidence < 阈值 → 字段置空，不阻塞入库
```

### 8.2 LLM 抽取输入/输出契约

```
INPUT
- source_type: internsg|rss|html|mock
- url
- raw_text / HTML 片段（截断到上限）
- 已知字段 hint（如从 URL/来源上下文得到的公司名）

OUTPUT (JSON, 由 Pydantic schema 强制校验)
{
  "title": "Software Engineer Intern",
  "company": "Example Tech Pte Ltd",
  "city": "Singapore",
  "salary_min": 1500, "salary_max": 2500,
  "education": "Undergraduate", "experience": "Internship",
  "job_type": ["Internship", "Engineering"],
  "deadline": "2026-10-31",
  "description_summary": "...",
  "confidence": {"title": 0.95, "salary_min": 0.6, "deadline": 0.4},
  "missing_fields": ["deadline"]
}
```

### 8.3 可靠性控制

- **Schema 校验**：后端校验 JSON 结构与类型；失败重试一次或标记 `extraction_failed`，不产生脏数据。
- **规则优先**：薪资、截止日期等确定性字段先走正则，LLM 结果仅作参考；两者冲突时以规则为准并记录。
- **置信度门槛**：confidence 低于阈值的字段置空（宁可缺失，不可瞎填），进入 Admin 审核视图（stretch）或保持 incomplete 标记。
- **去重与增量**：`dedup_hash = sha256(source_id + normalized(title) + company + city)`；`raw_hash` 变化才更新，幂等运行。
- **运行可审计**：每次采集生成 CrawlRun 记录（found/new/updated/failed），失败可手动重放。
- **源健康管理**：连续失败自动停用 Source 并提示 Admin。
- **合规**：InternSG 为新加坡政府实习平台，仅做公开信息只读采集，遵守 robots.txt 与服务条款；任何限制出现即退回沙箱源，不影响演示。
- **Fixture 先行**：先以 fixture HTML 跑通流水线，再接 InternSG 公开数据，降低外部不确定性。
- **LLM 可替换**：Provider Strategy + prompt version 记录，便于复盘同一页面为何产出不同结果。

## 9. AI 填表助手设计（Phase 1 平台内置；Phase 2 浏览器插件扩展）

助手定位：**把用户维护的资料"翻译"成网申表单的答案草稿，所有填写内容必须经用户确认，最终提交必须由用户点击**。AI 不自动提交，不自动点击，不静默覆盖用户输入。

**阶段划分（为保证完成度）**：Phase 1 助手运行在平台内嵌网申表单上（表单结构与助手自身均由我们掌控，可稳定演示）；浏览器插件涉及 DOM 兼容、Manifest V3 生命周期、content script、service worker 消息桥、跨域 iframe、动态表单与权限管理等大量外部不确定性，推迟到 Phase 2 实施。映射引擎与"表单来源"解耦，Phase 2 只需替换表单来源为第三方页面。

### 9.1 助手架构（Phase 1）

```
React UI ── Form Assistant 组件（表单解析展示 / 确认面板 / 填写进度）
    │ REST/JSON over HTTPS
FastAPI ── Form Assistant Service（映射编排、确认记录、投递回写）
    │
LLM FieldMapper (Strategy)  ← 与 LLM Extraction 共用 Provider 接口族
    │
平台内嵌网申表单（ApplicationForm，含仿真 fixture，字段结构 JSON）

Phase 2: 同一 mapping engine 以 content script + service worker 形态封装为 Chrome 插件，
         运行在第三方网申页；Form Assistant API 与映射契约不变
```

### 9.2 字段映射输入/输出契约

```
INPUT
- form_snapshot: [{field_id, label, placeholder, name, type, required, options, context}]
- profile_data: 用户资料（按字段最小化下发，仅填表所需）
- profile_resume: 简历文本（可选，用于教育/项目经历等长文本字段）

OUTPUT (JSON)
{
  "mapping": [
    {"field_id": "f_01", "label": "Full Name", "value": "Zhang San", "confidence": 0.98, "needs_review": false},
    {"field_id": "f_02", "label": "Education History", "value": "...", "confidence": 0.62, "needs_review": true}
  ],
  "unmapped_fields": ["f_09"],
  "missing_profile_fields": ["github"]
}
```

### 9.3 错误控制

- **Human-in-the-loop**：所有 `needs_review=true` 字段高亮并要求确认；未确认字段不填写；用户可逐项编辑。
- **不自动提交**：助手只填充表单，从不触发提交按钮的 click/submit；提交由用户完成。
- **失败降级**：无法识别的表单 → 提示手动填写；动态渲染的表单字段在渲染完成后重扫。
- **字段校验**：填写前按 required/type 校验，必填缺失字段提前提示，避免"提交了才发现没填"。
- **隐私最小化**：只向后端发送字段 label 与对应资料值（最小上下文）；浏览器端不持久化简历原文。
- **可追溯**：回写 Application 时记录 mapping_version、provider、confirmation 摘要，便于审计与复盘误填。

### 9.4 Phase 2 Chrome 插件扩展要点（推迟原因与预留设计）

| 复杂度来源 | 推迟处理方式 | 预留设计 |
|---|---|---|
| DOM 兼容性 | Phase 1 在自控表单上验证映射引擎 | FormSnapshot 抽象已隔离 DOM 细节 |
| Manifest V3 生命周期 / service worker | Phase 2 再实现 | 映射引擎为纯函数 + HTTP 接口，与宿主无关 |
| content script 注入与消息桥 | Phase 2 再实现 | 助手 API（/assistant/*）即插件的后端契约 |
| 跨域 iframe 表单 | Phase 2 处理（受限时降级提示） | 契约中保留 iframe 来源标记 |
| 动态表单（MutationObserver） | Phase 1 已在自控表单模拟动态渲染 | 重扫逻辑与映射引擎解耦 |
| 权限最小化（activeTab + 白名单） | Phase 2 再定 | 不在 MVP 申请 broad host permissions |

## 10. Design Patterns 与质量属性

| 设计问题 | Pattern | 拟应用位置 | 带来的质量属性 |
|---|---|---|---|
| 未来可能切换 LLM provider / 抽取与映射复用同一接口族 | Strategy | LLMExtractor / FieldMapper 接口 → OpenAI/Gemini/Mock | Extensibility, testability |
| 不同信息源（InternSG/RSS/HTML/Mock）输出格式各异，不应污染业务层 | Adapter | SourceAdapter 将原始内容转为标准化 Item DTO | Maintainability, adaptability |
| 采集流水线骨架固定、步骤可覆盖 | Template Method | IngestionPipeline：fetch→parse→extract→normalize→dedup→upsert | Reusability, consistency |
| 按源类型创建适配器/抽取器（可选） | Factory | SourceAdapterFactory / ExtractorFactory | Low coupling |
| 采集完成后触发审计/告警（可选） | Observer/Event | CrawlCompleted → AuditLogger / SourceHealthUpdater | Separation of concerns |

注意：不为"凑设计模式"强行使用 5 个。Proposal 先承诺 **Strategy + Adapter + Template Method**；Factory/Observer 只有在实现中确实解决问题时再保留。

### 10.1 非功能需求（NFR）

| NFR | 目标 | 设计手段 |
|---|---|---|
| Maintainability | 采集/LLM/Auth 可独立修改 | 模块边界、service interfaces、tests |
| Extensibility | 未来可新增信息源 / 扩展 Phase 2 插件 | Strategy + Adapter + FormSnapshot 抽象 |
| Reliability | 外部源/LLM 失败不丢数据，可重放 | CrawlRun 状态机、幂等去重、timeout、error handling |
| Performance | 岗位列表分页响应 ≤ 2s（1000 并发登录场景可接受 3s 登录） | 索引（city/tag/type/deadline）、分页、必要时 Redis 缓存 |
| Security | 最小权限、PII 最小化（PDPA 合规）、依赖扫描 | RBAC、secrets 管理、SAST/dependency scan、资料加密 |
| Auditability | 能还原每次采集与每次投递 | immutable-style audit event + timestamps + mapping_version |

## 11. DevSecOps Pipeline

```
Pull Request / Push
  ↓
Ruff / formatting check（Python）+ ESLint/Prettier（前端）
  ↓
pytest (unit + API + integration)
  ↓
Semgrep SAST
  ↓
pip-audit / dependency scan + npm audit
  ↓
Docker build（App + DB Compose 校验）
  ↓
[Optional] Playwright E2E（平台内嵌仿真网申表单 + 演示源）
  ↓
[Optional] deploy to demo environment
```

### 11.1 Pipeline Gate 建议

- Lint/test 失败：阻止 merge。
- High severity SAST finding：标记 failed 或 require review，团队在报告中说明 gate policy。
- Dependency vulnerability：记录 severity；高风险依赖不得静默忽略。
- Secrets：LLM API key 只放 GitHub Secrets/.env，不进入 repository。
- Docker image：成功 build 是演示环境一致性的最低要求。

## 12. 测试策略

| 测试层 | 对象 | 示例 | 负责人 |
|---|---|---|---|
| Unit Test | parser/extractor/dedup/mapper | InternSG/RSS/HTML → 标准化 Item；dedup_hash 一致性；字段映射 schema 校验 | M3/M4 |
| API Test | auth/jobs/favorites/profile/applications | 401/403、无效输入、happy path、筛选组合 | M2 |
| Integration Test | backend + 采集流水线 + DB | fixture HTML 能生成岗位；重复运行不产生重复数据 | M3 |
| LLM Contract Test | mock provider / 有限 live test | 抽取契约（M3）、映射契约（M4）：JSON 字段齐全；失败时 graceful handling | M3/M4 |
| Form Assistant E2E | Playwright + 平台内嵌仿真网申表单 | 中英文表单、必填校验、动态字段、确认面板编辑、提交由用户完成 | M1+M4 |
| Security Test | SAST/dependency/auth/PII | hardcoded secret、越权访问 audit、越权拉取他人资料 | M5 |
| End-to-End Demo | UI → 采集 → 筛选 → 助手填写 → 回写 | "演示源发布 3 个岗位 → 筛选出 1 个 → 内置助手在仿真表单确认填写 → 投递记录可见" | M1+全组 |

### 12.1 推荐 Demo 样本

1. 演示源（InternSG fixture / 公开 RSS）发布若干岗位 → 触发采集 → 列表出现新岗位（含字段缺失/低置信度案例）。
2. 平台内嵌仿真网申表单（课程自建 fixture 页面）：包含姓名、手机、邮箱、教育经历、期望薪资、下拉选择等字段 → 助手识别并映射 → 用户修正 1 个低置信度字段 → 确认填写 → 手动点击提交 → 回写投递记录。
3. 错误场景：LLM 服务不可用 → 抽取标记失败但已有数据不受影响；表单结构变化 → 助手提示降级为手动填写。

## 13. 系统安全设计

- **Authentication**：密码 hash；JWT 有过期时间；敏感 endpoint 必须鉴权；填表助手接口复用用户 JWT，不引入独立凭证体系。
- **Authorization**：Job Seeker 只能访问自己的 profile/application/favorites；Admin 才能管理 Source、查看全局 audit。
- **PII 保护（PDPA 合规）**：姓名、电话、简历等个人资料为最高敏感级数据——加密存储（或最小化存储）、日志脱敏、API 返回字段裁剪；演示数据一律使用虚构信息。
- **Secret Management**：LLM API key 不写入源码或日志。
- **抓取合规**：只采集 InternSG 公开信息与沙箱源，遵守 robots.txt/ToS；不绕过登录墙与反爬；对 URL/域名做白名单校验，防止 SSRF。
- **Input Handling**：限制 HTML 抓取大小；岗位描述渲染时做转义，防 XSS；上传简历限制类型/大小。
- **LLM Privacy**：提交给外部 LLM 的内容采用"最小上下文"（字段标签 + 对应值片段）；禁止上传真实个人敏感信息；记录发送内容摘要供审计。
- **Form Assistant 安全**：助手只操作平台内嵌表单，无第三方站点依赖；Phase 2 插件采用最小权限（activeTab + 白名单站点）、不存储简历原文、在插件侧二次校验映射结果的类型/长度。

## 14. 五人团队分工

原则：每人有主责模块，但所有成员共同参与 backlog、design review、integration、presentation 与 report。不要形成 5 个孤岛。

| 成员 | Primary Ownership | 主要任务 | 必须交付的证据 | 协作点 |
|---|---|---|---|---|
| Member 1（TANG YUCHEN） | Frontend / UX | React：登录、岗位列表/筛选、详情、收藏、资料页；填表助手确认面板 UI | UI screens、frontend tests、demo flow | 与 M2 定 API contract；与 M4 定确认面板交互 |
| Member 2（LIAO BINGFENG） | Backend Core / DB | FastAPI、Auth、Job Query、Profile、Application、DB schema/migrations | API、ER model、unit/API tests | 整合 M3/M4 service |
| Member 3（ZHU PENGXU） | Data Pipeline + LLM 抽取 | 采集调度、Source Adapter（InternSG/RSS/HTML/Mock）、去重、CrawlRun、Admin 运行视图；LLM 岗位抽取（经共享 Provider 接口调用，prompt、schema 校验、置信度标注、抽取评估样本） | adapter、fixture samples、integration tests、抽取契约测试与 prompt version | 与 M4 共享 Provider 接口，定 Item DTO/抽取契约边界 |
| Member 4（LIN XINDA） | LLM Provider + Form Assistant | 共享 Provider 接口（M3 岗位抽取与 M4 填表服务共同调用）、映射/草稿 prompt、FormMappingService / DraftGenerationService、确认状态机、mock；Phase 2 插件封装预留 | provider interface、映射 prompt version、LLM 映射测试、助手 E2E | 与 M3 共享接口并定边界；与 M2 定服务接口/入库边界；与 M1 定确认面板 |
| Member 5（LIAO CAN） | DevSecOps / QA / Audit | GitHub Actions、Docker、pip-audit、审计事件、Playwright E2E、演示环境 | pipeline YAML、scan/test evidence、audit 实现 | 全组 integration/release |

### 14.1 Cross-team 共同责任

- 每位成员至少负责/共同负责 1 个 user story 的 analysis → design → implementation → test 证据。
- 每个 Sprint 至少做一次 design/integration review，避免最后一周才合并。
- Presentation 按业务流程讲（采集 → 筛选 → 确认填写 → 回写），而不是 5 个人分别讲自己的代码。
- Peer assessment 看项目目标贡献，不是单纯累计工时，因此要保留可追踪的 commits、issues、review 和文档贡献。

## 15. WBS 与时间计划

课程 briefing 的关键节点：Proposal 28 Aug；Review 31 Aug；Project Conduct 从 1 Sep；Final Presentation 3–4 Nov；Final Report 10 Nov；项目期间 fortnightly progress report。约 10 man-days / participant（总计约 50 man-days）。

| 阶段 | 建议日期 | 重点 | 主要输出 | 预计人天 | Owner |
|---|---|---|---|---|---|
| P0 Proposal | 24–28 Aug | 冻结 scope、use cases、architecture、WBS（信息源 = InternSG + 沙箱源；助手 = 平台内置优先） | Project Proposal v1 | 2.5 | 全组；M2/M5 整合 |
| P1 Foundation | 1–13 Sep | repo、DB、auth、CI skeleton、UI shell、表单 fixture 初版 | 可登录 skeleton + CI | 8 | M1/M2/M5 |
| P2 Data Pipeline | 14–27 Sep | Source Adapter（InternSG + 沙箱）、采集调度、去重、岗位列表/筛选 UI | Source → Jobs 端到端 | 12 | M2/M3/M1 |
| P3 LLM 抽取增强 | 28 Sep–11 Oct | 抽取 prompt、schema 校验、置信度、检索/筛选增强（M4 提供 Provider 接口与评估方法支持） | 抽取质量 + 完整筛选 | 10 | M3 + M2 |
| P4 Form Assistant | 12–25 Oct | 表单识别、字段映射、确认面板、回写投递（平台内置 Phase 1） | 完整 E2E workflow（内置助手） | 10 | M1/M4/M2 |
| P5 Stabilize | 26 Oct–2 Nov | tests、demo data、bugfix、report evidence | release candidate | 7.5 | 全组 |
| Presentation | 3–4 Nov | live demo + architecture/design/pipeline | Final Presentation | — | 全组 |
| Final Report | 5–10 Nov | 吸收 presentation feedback，完成报告 | Project Report | — | 全组 |

Phase 2（Chrome 插件）：仅在 MVP 全部稳定后作为 stretch goal 实施；若时间不足，在 Final Report 中说明引擎已解耦、插件为既定演进方向。

### 15.1 Proposal 前四天任务（当前最优先）

- 24 Aug：确认项目 title（JobPilot SG）、problem statement、MVP scope、5 人角色与信息源范围（InternSG）。
- 25 Aug：完成 use cases、architecture、tech stack、NFR 与 design pattern 初稿。
- 26 Aug：完成 WBS/effort estimate、risks、DevSecOps plan；小组 review。
- 27 Aug：统一 Proposal 文案、检查 scope 是否过大、补架构图与必要 UML。
- 28 Aug：最终检查后提交；保留版本与提交证据。

## 16. SWE5006 Deliverables 对照表

| 课程要求 | 本项目对应产物 | 完成标准 |
|---|---|---|
| Working system | Web application（含平台内置 AI 填表助手；插件为 Phase 2） | 完整 E2E demo 可运行 |
| Code base | GitHub repository | 结构清晰、README、可复现 |
| Project Report | 架构、质量属性、设计决策、DevOps lifecycle | 有证据而非只描述 |
| Agile artifacts | Backlog、user stories、sprint plans/reviews/retrospectives、burndown | 与实际开发记录一致 |
| High-level design | Architecture + transition from analysis to design | use case → service/module/class 可追踪 |
| Detailed analysis/design | 关键 use case sequence/class design | 至少覆盖采集、LLM 抽取、填表助手确认流程 |
| Design patterns | Strategy + Adapter + Template Method（其余按实现） | 说明"设计问题→模式→影响" |
| Well-structured code + unit tests | service/module tests | 复杂行为类有测试 |
| DevOps pipeline + security | GitHub Actions、SAST、dependency scan、Docker | pipeline 运行证据可截图/导出 |

## 17. 风险与控制

| 风险 | 影响 | 控制措施 | 触发缩 scope 条件 |
|---|---|---|---|
| InternSG 源结构变化/不可用 | 采集失败、核心 flow 无法跑通 | InternSG Adapter + fixture 先行、源健康状态、失败重试 | 第 2 Sprint 末仍不稳定则只用沙箱源 |
| InternSG/公开源合规限制 | 项目被质疑或采集被禁 | 只读公开信息、遵守 robots/ToS、不绕反爬；PDPA 合规 | 任何平台方限制即移除该源，退回沙箱源 |
| LLM 抽取/映射不稳定 | 字段错误、表单填错 | schema 校验、规则优先、confidence、人工确认 | 若 API 频繁失败，demo 用稳定 provider + mock fallback |
| Phase 2 插件复杂度（DOM/MV3/content script/跨域 iframe/动态表单/权限） | 挤占主流程工期 | Phase 1 只做平台内置助手；映射引擎与表单来源解耦 | 插件不进入 Phase 1 范围，作为 stretch |
| 简历/资料 PII 泄露 | 隐私事故（PDPA） | 加密存储、日志脱敏、最小上下文、演示用虚构数据 | 不允许真实个人资料入库演示 |
| Scope 膨胀 | 无法按时完成 | 首期 InternSG + 沙箱源；禁止无人值守投递/移动端/插件 | 任一核心 UC 未稳定前不加 stretch goal |
| 成员整合困难 | 最后阶段冲突 | API contract、branch/PR、integration milestone | 每 Sprint 必须有可运行集成版本 |
| 测试不足 | 报告证据弱 | 关键 service/API 有 tests；CI 强制运行；Playwright E2E | 关键 workflow 无 test 不进入 RC |

## 18. MVP Definition of Done

- 用户可以注册、登录并维护个人资料与简历。
- 系统能按调度/手动从 InternSG 与沙箱源采集岗位，经抽取、去重后入库，列表页正确展示岗位卡片（职位/公司/城市/薪资/标签/截止/来源/外链）。
- 列表支持标签、关键词、城市、薪资、岗位类型筛选与分页。
- 用户能收藏岗位并记录投递状态；投递历史可查。
- 平台内置 AI 填表助手能在平台内嵌仿真网申表单上识别表单并生成映射草稿；低置信度字段高亮；未确认字段不填写；提交必须由用户点击。
- 助手回写的投递记录在平台可见，并记录 mapping_version 供审计。
- LLM 失败不导致采集数据丢失，UI 显示明确失败状态。
- Admin 能查看采集运行记录与关键 audit 事件。
- GitHub Actions 对 PR/push 运行 lint、tests、SAST、dependency scan、Docker build。
- 项目能通过一条准备好的 E2E demo script 在 presentation 中稳定演示。

### 18.1 Stretch Goals（只有 MVP 稳定后再做）

- **Chrome 插件（Phase 2）**：将填表引擎扩展至第三方网申页（content script + MV3 + service worker），复用 /assistant/* API 与映射契约。
- 更多新加坡公开源（如 MyCareersFuture）适配器。
- 第二个 LLM provider，展示 Strategy Pattern 的可替换性。
- 岗位订阅提醒（新岗位/截止前通知）。
- 简历文档解析导入（上传简历 → 抽取结构化资料，为 Profile 预填）。
- 投递数据分析（投递转化漏斗、岗位类型偏好）。

## 19. 接下来小组需要立即确认的事项

| 事项 | 当前建议 | 需要小组确认 |
|---|---|---|
| Project Title | JobPilot SG：招聘信息聚合与 AI 智能网申助手 | 是否采用正式英文名 |
| 信息源范围 | InternSG（主源）+ 沙箱 fixture 源 | 是否继续接入 MyCareersFuture 等公开源 |
| LLM Provider | 先抽象接口，实际只接 1 个 | 最终 provider/API key 由谁提供 |
| 填表助手目标 | 平台内置 AI 填表助手（Phase 1）；Chrome 插件推迟 Phase 2 | 确认平台内嵌仿真表单作为演示载体 |
| Frontend | React + TypeScript | 确认成员熟悉度 |
| Backend | FastAPI + PostgreSQL | 确认成员熟悉度 |
| 成员 Owner | TANG YUCHEN / LIAO BINGFENG / ZHU PENGXU / LIN XINDA / LIAO CAN（对应 M1–M5） | 已确认，见 §14 分工表 |
| Deployment | Docker-based demo；云部署可选 | 是否需要 AWS/其他云 |
| Git workflow | feature branch + PR + CI | 确认 branch/review 规则 |

## 附录 A：课程要求来源摘要

- Group Project 需要体现 Agile、software analysis/design、design patterns 与 DevSecOps automation 等课程能力。
- 主要 deliverables 包括 working system、code base、project report、architecture/design、quality attributes、DevOps lifecycle、pipeline/test scripts，以及 Agile artifacts。
- Proposal 需要包含 Project Title、Project Sponsor、Members、Overview、General Architecture（preferably monolithic）、Scope of Work、如何展示各课程能力、Effort Estimates。
- 课程建议约 10 man-days / participant；项目期间需 fortnightly progress report。
- 关键时间：Proposal 28 Aug 2026；Review 31 Aug；Presentation 3–4 Nov；Report 10 Nov。

— End of Document —
