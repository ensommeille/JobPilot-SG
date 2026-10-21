# 已入库真实岗位抽取与推荐验证（2026-10-21）

本记录只针对 JobPilot SG 课程项目。没有发送任何真实雇主申请，也没有使用真实求职者简历或个人资料。API key、模型原始响应和完整测试账号凭据均未写入仓库。

## 1. 边界与结果

| 项目 | 实测结果 |
| --- | --- |
| 已入库公开岗位 | Stripe — Software Engineer, Intern；JobPilot 岗位 ID `5af9041f-5781-4c4e-bdc4-3a17f5dfc0ec`；本地状态 `active` |
| 模型调用 | 经单独授权，DeepSeek 生成请求 **1 次**，无重试；只发送该公开岗位描述 |
| 抽取运行 | ID `0ca75d5b-41cd-4bf4-8a95-aaf52d9e8527`；`execution_mode=live`；`status=needs_review`；`error_code=null` |
| 输入新鲜度 | 运行记录和结果的 input hash 均与当前数据库中的岗位输入一致 |
| 机械证据检查 | 37/37 条引文能在入库 JD 中找到，质量记录无机械错误；**不等于语义准确率 100%** |
| Provider 用量 | 3,512 input tokens、2,049 output tokens；未独立核实实际金额 |
| 外部岗位当前是否仍开放 | **本轮未重新核验**；`active` 仅为本地数据库状态 |

旧运行中的 `experience:extra_forbidden` 仍是历史失败记录，不能当作成功抽取。PR #42 在 prompt 中明确了 schema 所需的 `experience` 形状；严格校验本身没有放宽。以上新运行是在该修改之后得到的。

## 2. 原文与抽取逐项对照

| 入库 JD 的原话（节选） | 本次模型抽取 | 初步审阅 |
| --- | --- | --- |
| “A strong fundamental understanding of computer science through pursuit of a Bachelor’s or Master’s degree in computer science, math, or a related discipline.” | 必需的 CS 基础；另记学历在读、专业方向。 | 基本对应，但必须保留“在攻读”，不能解读为已获学位。 |
| “Experience and familiarity with programming, either through side projects or classwork.” | 必需的编程经验/熟悉度要求组。 | 要求组已捕获；独立的 `experience.requirement` 却为 `null`，需确认下游是否遗漏这一维度。 |
| “Experience from previous internships or other multi-person projects, including open source contributions, that demonstrate evaluating and receiving feedback …” | 必需的合作项目/反馈经历要求组。 | 同样在要求组中，但独立 experience 字段为空；需人工复核。 |
| “Ability to leverage AI tools … while applying rigorous critical thinking … to review, refine, and validate all outputs.” | 一个 `all_of` 组，包含 AI 工具使用和审慎复核两项。 | 保留了同时满足的条件，不能简化成“用过 AI”。 |
| “At least 1 year of university education, or equivalent work experience.” | 优先条件 `any_of`。 | 正确保留“或”，不是一律要求一年工作经验。 |
| “We work mostly in Ruby, Java, Javascript, Go, and Scala.” | 没有把这些语言提升为硬性应聘技能。 | 这是团队技术栈说明，并非明确写出的申请资格；保守处理合理。 |
| 入库描述没有每周工时、远程/现场模式或最短实习周期。 | `work_constraints` 相应字段为空。 | 正确表示“未知”，不能推断为兼职或远程。 |
| 概述引文讲跨技术栈工作、端到端负责；另一条职责原文才讲 “Write software that will be used in production”。 | 概述值合并了“编写生产软件”，却只引用前一段概述。 | **仍待修正/审核**：引文本身未覆盖概述中所有断言，不能只靠 37/37 的字符串匹配判定语义正确。 |

共抽出 5 条职责、5 组最低要求和 5 组优先条件。上述 `required`、`preferred`、`all_of`、`any_of` 仍是模型初稿标签，尚未经人类正式批准。

## 3. 普通求职者与 Docker 浏览器验证

用更新后的后端和修复依赖后的前端构建隔离 Docker 服务，连接本机测试数据库；容器没有配置模型密钥。使用明确标记为 synthetic 的测试求职者资料登录，在 Jobs 页按 Stripe / internship 筛选：

- 登录、Jobs 推荐、岗位详情和 `match-analysis` 请求均为 HTTP 200。
- 3 个候选岗位中，1 个有当前 live 抽取，另 2 个缺少有效抽取。
- 推荐状态 `no_matches`，推荐数 **0**；没有为了凑数量降低具体技能交集门槛。
- Stripe 详情显示 **15 条待核对、0 条确认匹配、0 条明确差距**。这是合成资料与该 JD 的保守结果，不是“真实用户成功推荐”。
- 没有点击或模拟任何雇主申请的最终提交。

本机截图留在 `outputs/jobpilot-eval-20261021/`，未随 PR 上传，避免把本机截图误当团队公共验收环境。若需要公共演示证据，应在团队统一部署后重新截取。

## 4. 尚未通过的门槛

1. 人工审核概述引文与 `experience.requirement` 空值，并逐条确认要求优先级和 AND/OR 语义。
2. 若要证明“有具体技能交集时可以推荐”，应另选 JD 明确要求 Python/SQL 等技能的公开岗位，例如已入库的 ShopBack Operations Automation Engineer Intern。下一次付费模型调用需要**另行授权**；不能对旧结果自动重试。
3. PR #42 是抽取修复草稿；PR #43 是独立的前端依赖安全修复，GitHub CI 已通过。两项 PR 截至本记录编写时都未合并，不能称为 main 分支或团队部署已完成。
