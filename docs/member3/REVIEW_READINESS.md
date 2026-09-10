# Review Readiness — Job Extraction v0.1

复核日期：2026-09-04。结论：在 Member 3 当前负责范围内，没有遗留的已知高危问题；可以交给 Member 4 做接口确认和真实 Provider 联调。这个结论不等于“整个项目没有漏洞”，因为真实模型客户端、数据库和 UI 尚不在本目录内。

## 本轮已解决

- 公共 Provider 仍然是领域无关接口，岗位抽取不会自行实现第二套 Qwen/DeepSeek 客户端。
- 请求 schema 和响应 data 必须是根节点 object，且只能包含有限、合法 JSON 值；拒绝 datetime、bytes、NaN、Infinity、数组和 JSON 文本冒充对象。
- Provider 名称、请求 ID、模型名、错误码和审计字段设置长度/格式边界。未知的 Provider 自定义错误码统一降级为 `provider_error`，避免把密钥或敏感文本写入结果。
- Consumer 会重新校验 Provider DTO 的快照，不能通过“先构造合法 DTO，随后修改内部 dict”绕过边界。
- Provider 配置在构造时重新校验并复制；非法 `name`/`is_mock` 在任何调用前失败。
- 审计结果严格检查当前 schema/prompt/contract 版本、SHA-256、UUID v4、UTC 时间、结束时间顺序、连续 attempt 编号，以及成功/失败字段一致性。
- Mock fixture 顶层、case、annotation status、唯一 case ID 和唯一来源身份都严格校验；过期输入依旧按 hash 拒绝。
- 评估文件必须明确声明 mock/live，且每条预测与顶层模式一致，不能混入 Mock 后被误称为 live。
- 经验证据中的经验年数支持 `3 years`、`3+ years`、`3 or more years` 等明确下限；`2–3 years` 一类范围会标记歧义，不能把上限误当最低年限。
- 抽取 schema 新增 required/preferred qualifications，作品集、执照、认证、工作许可和可用性不再被迫冒充技能。
- 输出仍为人工复核状态；证据覆盖率不是模型概率，不存在靠阈值自动放行。

## 有意不重复的字段

薪资、地点、职位类型、公司、标题、发布时间和申请地址已有确定性的爬虫字段，本模块不会让 LLM 重新生成并覆盖它们。抽取结果是 enrichment，使用来源身份和 input hash 与原岗位关联。这是减少冲突和幻觉的设计，不是字段遗漏。

## 仍需 Member 4 / Member 2 联调

以下事项无法由离线代码替代，因此应作为合并验收项，不应伪装成已经完成：

- Member 4：Qwen/DeepSeek 的真实 JSON Schema 支持程度、SDK 响应解析、finish reason、usage、超时、取消、限流和传输重试上限。
- 双方：一条授权的真实调用，以及人工审阅的多来源样本评估；当前五条 Mock 只能证明接线。
- Member 2：内部 job_id 映射、数据库唯一约束/迁移、幂等 upsert、并发锁或队列、审核状态与 API。
- Member 1：在 UI 中展示证据和 `needs_review`，禁止把草稿抽取直接呈现为已确认事实。
- 团队：在最终仓库中只保留一份 `app.llm` DTO，运行 Python 3.11/3.12 CI 和全项目 E2E。

## Codex 审查时应如何判断

合理的审查意见应区分“本模块中的缺陷”和“尚未接入的外部组件”。如果审查要求在这里加入 Qwen 客户端、数据库或表单映射，应先对照职责边界，避免重复实现。若指出具体可复现的 schema、校验、异常或兼容性问题，应添加最小失败测试后修复。

已知限制仍然透明保留：40,000 字符是字符边界而不是 token 预算；文本不会静默截断；精确标签评估会惩罚合法同义词；证据出现不证明语义蕴含；文件快照不提供多进程写锁。生产并发和持久化必须由后端负责。

## 交付状态

- 141 项离线测试通过，语句覆盖 100%，语句+分支综合覆盖 99.86%。
- Ruff 检查与格式检查通过。
- 原 InternSG 数据文件 SHA256 保持 `B7DE19C0B9E8928E554956DE332D57F98117D87832AE55999C24150179468B80`。
- Mock：5 条成功、0 条失败、5 条全部需要人工复核。
- 加固后的 wheel 已重新构建，并在隔离目录完成导入验证。
- 干净交付 ZIP 已排除 output/build/egg-info/cache，解压后 141 项测试通过。

构建、pytest 临时目录和缓存均已列入 `.gitignore` 与 `.rgignore`，Ruff 也显式排除这些目录。当前执行环境拒绝递归删除命令，因此原工作目录中可能仍能看到它们；正常 Git 提交和 Codex/ripgrep 检索不会包含。优先发送 `output/jobpilot_job_extraction-v0.1-review-ready.zip`，不要手工压缩整个工作目录。

