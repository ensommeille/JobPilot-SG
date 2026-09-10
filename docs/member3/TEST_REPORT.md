# 第一版验证记录

初次验证：2026-08-31。加固复核：2026-09-04。环境：Windows，Python 3.12.7，Pydantic 2.12.3，pytest 8.4.2，pytest-cov 6.3.0，Ruff 0.16.4。

## 已执行结果

- 新模块：**141 passed**。全部离线，不调用真实模型。
- 新模块覆盖率：语句覆盖 100%；合并语句与分支覆盖 **99.86%**（556 条语句、134 个分支，1 个未覆盖分支）。范围是 `app.job_extraction` 与 `app.llm`，不含 wrapper、文档或外部客户端。
- 原 InternSG 爬虫：**19 passed**，未改原爬虫源代码。
- Ruff 静态检查与格式检查通过。
- 内置五条 JD 的 Mock 演示：5 条有效抽取、0 条失败、5 条均需人工审核。
- 从原爬虫 `output/jobs.json` 读取同一五条记录：Mock 演示通过，输入没有被改写。
- Wheel 打包和独立安装目录导入/运行验证通过，包内 fixture 可读。
- 无缓存/构建副本的 review-ready ZIP 已解压并重跑：**141 passed**。
- Mock 评估输出 `evaluation_kind=mock_plumbing_check`、`eligible_for_model_quality_review=false`。

原爬虫快照 SHA256，前后相同：

```text
B7DE19C0B9E8928E554956DE332D57F98117D87832AE55999C24150179468B80
```

`output/coverage.xml` 是自动生成的覆盖率记录；`output/extractions.mock.json` 和 `output/evaluation.mock.json` 是可查看示例。

## 尚未验证

Qwen/DeepSeek 实际 API 能力、模型语义准确率、真实 token 费用/延迟、数据库持久化、审核 UI、团队整体 E2E 和 GitHub CI 均未在本次测试中执行。3.11 的 CI 配置已提供，但本机实际执行的是 3.12.7。

Mock 是回放同一套草稿标注，所以其 precision/recall/F1 为 1 只说明数据流接通，不是“AI 抽取准确率 100%”。引用存在检查也不是语义正确性验证。

测试降低已知风险，不能保证未来合并绝不出问题。合并前仍应确认共享 DTO 只有一份，Member 4 完成真实 Provider 合同测试，Member 2 完成持久化/审核集成。

