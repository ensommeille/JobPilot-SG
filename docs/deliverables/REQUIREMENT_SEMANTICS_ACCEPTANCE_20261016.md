# 真实岗位抽取、匹配与推荐解释：本轮交付

本轮代码和隔离 Docker 功能验证已完成；**模型语义验收尚未通过，仍需人工复核**。这是项目功能验收，所有 profile 都是合成测试输入，与组员个人求职、投递条件无关。

## 代码基线与本轮新增

附件中的分支、提交和 PR 线索帮助找回了远端 `feat/course-closeout@e2fe853`（Draft PR #29）。本机最初只看到 `64a4f30`，不能把它当作包含 578 项测试修复的版本。拉取后确认：中文“想学／正在学 Python”与独立完整行 Canva 引用修复已经在 `e2fe853`，本轮保留，并未重复实现或冒领。

新工作在 `feat/extraction-semantics-v2`，以 `e2fe853` 为基线。PR #29 不改动、不合并。旧版报告和原始模型结果均保留。

## 采用的数据结构

- 保留严格的 v1 读取模型，新增 v2；schema、prompt 与 payload 必须对应。旧抽取不迁移、不覆盖，新 pipeline 不复用 v1 缓存。
- `requirement_groups` 保留完整语句、证据、required/preferred/unspecified 及 all_of/any_of/unspecified；每个条件单独有 value、evidence、kind 和 qualifier。kind 区分具体技能、语言、一般特质、兴趣／学习意愿、其他资格。
- 职责保留 `priority`（primary/secondary/conditional/unspecified）和独立条件证据。数据结构可以表达主次，但模型的主次判断仍需复核。
- `work_constraints` 包括 schedule、hours、minimum_duration、work_modes、locations。工时和周期保留数值、原单位及 PT 等条件范围；工作模式明确允许或禁止。未知用 null/[]。天数可保留在 schedule 中，目前没有独立 days-per-week 数值字段。
- 工时／周期追加数值与单位证据校验。例如 4 days/week 不能支持 4 hours/week，三个月不能换成 90 天。原始输出保留；消费者对不支持的数值显示 requires review。

完整契约和 v1/v2 示例见 `docs/member3/examples/EXTRACTION_V2_CONTRACT.md`。

## 匹配与排序规则

1. 只有肯定表达、且被识别为具体技能的 profile 信号贡献交集。学习目标、兴趣、特质和语言不满足门槛。
2. 至少存在一个具体技能交集才展示推荐；不凑数量。排序保持：无明确缺口在前，再按不同具体技能交集数和发布时间排序。模型 required/preferred 不参与排序。
3. 技能按 canonical ID 去重。相同普通话条件跨类别出现也不增加分数；不同限定条件仍保留。
4. 复合组逐条件解释，整体保持 unknown。即使模型漏拆 SQL，只剩一个 Python 子条件，也不能凭这个子条件把“Python 和 SQL”判为 supported。
5. 工作约束单独展示，不计入技能条件数量或排序。岗位事实存在也不代表人的时间／地点可行；五类比较均明确 unknown。通用岗位列表不再把未知地点填成 Singapore。
6. 缺失、失败、Mock、失效或最新抽取不可用时不回退旧成功结果。关闭／过期岗位不推荐。本轮另修复了 InternSG 明确关闭状态的采集和持久化，包括内容 hash 相同但状态变化的情况。

## 原文基准与实际提取并排对照

下表的原文和模型列为便于阅读的中文释义。实际响应没有被人工改写成“正确答案”；可按下文 run ID 和原始文件核对。

| 样本 | 原文基准 | 实际模型提取 | 匹配与解释 | 错误／遗漏 |
|---|---|---|---|---|
| [Wovenstack 软件／AI 系统](https://www.internsg.com/job/wovenstack-software-engineering-intern-data-automation-ai-systems/) | Python 能力、浏览器自动化及多项 Web 条件；额外工作取决于团队需要 | 分组保留条件与工具替代，也保留条件性职责 | Python-only 只有 python 交集，完整条件 unknown | 摘要引文拼接了非连续片段；部分嵌套替代条件仍放在一个字符串里；资格地域不能当办公地点 |
| [Cynapse AI Evaluation](https://www.internsg.com/job/cynapse-pte-ltd-ai-evaluation-quality-intern-2/) | AI 兴趣不等于编程要求；至少四天／周、三个月 | 兴趣单独分类；周期保留 months；但把四天错误写成四小时 | Python-only 不产生推荐；单位 guard 隐藏不受支持的小时数，提示复核 | 职责全标 primary 缺少依据；部分入职时段／日期弹性未结构化；分类仍有错误或争议 |
| [Ilodia 零售对照](https://www.internsg.com/job/ilodia-labs-pte-ltd-retail-e-commerce-operations-intern/) | 核心履约与条件性创意／项目工作分开；Canva、布局、表格是复合条件；普通话一条；PT 条件有范围 | 16 职责和六条招聘条件仍有表示；普通话只作 language；PT 每周二十小时／三个月及禁止 remote/hybrid 已结构化 | Canva-only 只有 canva 交集；布局、表格、普通话与可行性不宣称满足 | 后五条项目职责主次仍待复核；部分实际操作能力误分 trait；翻译工具许可未独立表示 |
| [Cynapse ML](https://www.internsg.com/job/cynapse-pte-ltd-machine-learning-engineer-intern-computer-vision-ai-11/) 与 [Strides AI](https://www.internsg.com/job/strides-digital-artificial-intelligence-ai-intern/) | 抓取时官方页面有明确关闭标记 | 跳过付费抽取 | 生产 parser 输出 closed，入库后不出现在推荐或可见详情 | 关闭状态是采集事实；不拿这些样本声称当前开放岗位的模型准确性 |

本轮真实来源抓取于 2026-10-16 06:03 UTC 左右；未观察到关闭标记不等于保证岗位仍开放。

### 分开记录的测量

独立 Codex 初审以本次确切 description 建立事后选定事实单位，**不是预先注册的完整测试集，也不是人工批准**：

| 样本 | 所选事实在 value 中有表示 | 招聘语句分类初审 | 其他维度 |
|---|---|---|---|
| Wovenstack | 20/20 | 12 correct / 0 error / 0 review | 引文 66/67；主次与嵌套逻辑另审，不能因此称语义全对 |
| Cynapse Evaluation | 18/21 | 6 correct / 1 error / 3 review | 引文 39/39 仍有天数变小时错误；时段／弹性有遗漏 |
| Ilodia | 30/30 | 4 correct / 1 error / 1 review | 引文 52/52 仍有操作能力分类、职责主次和许可表示问题 |

以上分母按样本的职责、招聘语句和选定工作事实建立，不能相加或换算成统一“准确率”。逐事实路径、source 行号、分类／主次／逻辑问题见 `fixtures/real_job_semantic_audit_20261016.json`。人工候选基准见 `fixtures/real_job_benchmarks_20261016.json`，实际结果的匹配对照见 `fixtures/real_job_matching_results_20261016.json`。

推荐解释单独检查了：交集来源是否可追溯、部分命中是否仍 unknown、未命中条件是否可见、未知可行性是否明示、是否出现无交集填充。三个实际输出 × 四类合成 profile 的离线比较符合这些规则；Docker 页面另验证 Python-only、Canva-only、学习意愿、关闭源和错误单位。**这是解释规则检查，不是招聘适配准确率。**

## 验证结果与实际环境

- 最终本地完整后端：**721 passed**，分支覆盖率约 **93%**，一个既有 Starlette/httpx 弃用警告。
- 完整浏览器回归：**195 passed，6 skipped**。跳过的是需安装扩展／真实站点控件资源的既有用例；这些测试主要采用受控接口数据，不能单独证明实际模型质量。
- 前端 TypeScript/Vite 构建、ESLint、后端 Ruff 和 Git 空白检查通过。
- 独立 Compose 项目 `jobpilot-semantics-20261016` 已重建。网页 `http://127.0.0.1:15176`，API `http://127.0.0.1:18316`；使用独立 PostgreSQL 数据卷及端口，不覆盖旧环境。
- 三份真实模型结果回放到新库。仅对数据库来源 UUID 和输入 hash 作有记录的 envelope 重绑，语义 payload、原请求审计和原始文件保留，回放不产生新模型调用。
- `scripts/verify_semantics_deployment.mjs` **5 组无 HTTP Mock 的接口／页面检查通过**，包含桌面和移动端溢出检查、实际页面截图、合成账号登录和上述匹配反例。
- DeepSeek `deepseek-flash` 实际调用 **3 次**，每例一次、无重试。全部保持 `needs_review`。未进行雇主投递、云端部署或任何组员个人条件判断。

有两类中途环境问题已纠正：Windows 公共 Temp／长路径权限导致的 pytest setup 失败，改用可写短目录后全量通过；浏览器源码契约测试须在 Vite 运行，Docker 则另用无 Mock 脚本验证。失败运行未计入通过数。

## 原始证据与复现

原始来源、模型输入和未改写响应在本机忽略目录：

`output/semantics-acceptance-20261016/20261016T060330247717Z/`

三个真实 result ID：`9b660a93-6ec1-477b-ad4c-3266b6ac7d39`、`d23bc79c-0cb9-40fa-893b-1d06485bafec`、`fb6a7f4d-022c-4dcb-bb32-be7b16213c6c`。原始质量记录生成在数值 guard 补充前，保留原件；报告中的重评诊断与原始记录明确分开。

JUnit／覆盖率在 `output/semantics-backend-junit.xml`、`output/semantics-coverage.xml`；实际页面证明在 `output/semantics-deployment/verification.json` 和同目录 PNG。这些本机证据没有冒充 GitHub CI 或云端验证。

复现命令：后端运行 `python -m pytest --cov=app --cov-branch`；前端运行 `npm run lint` 和 `npm run build`；浏览器按照 `extension/playwright.config.js` 启动 Vite。真实来源脚本为 `scripts/validate_requirement_semantics.py`：默认无模型调用，只有显式 `--live` 且安全注入 `LLM_API_KEY`、`LLM_MODEL=deepseek-flash` 等环境设置才执行。不得把凭据放进提交、报告或前端。

## 仍未解决的边界

模型仍会误分类、臆测主次、漏掉限定或把嵌套逻辑留在字符串中。普通话不再重复计分不代表所有抽取语义已正确。数值 guard 保守且不是通用语义证明器，陌生表达可能进入人工复核；具体技能词表有限，也可能漏召回。

地点／周期等页面元数据尚未作为有独立来源字段的模型输入；只在元数据存在的信息不计本次 description 抽取遗漏。后续若扩展输入，需要同时版本化证据来源，不能简单拼接后隐藏出处。

完成独立人工标注和更多领域样本之前，不宣称 AI／软件推荐已经完成质量验收。本轮交付的是可复现的候选实现、通过的本地／Docker 功能检查，以及明确保留的失败证据。
