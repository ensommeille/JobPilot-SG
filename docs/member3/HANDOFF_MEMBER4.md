# 给 Member 4 的对接说明

版本：0.1.0。日期：2026-08-31。状态：Member 3 已实现业务模块和共享接口第一版；真实 Provider 联调尚未完成。

## 你现在可以开始，不需要等岗位抽取写完

约定调用方式：

```python
response = await provider.generate_structured(request)
```

`request` 和 `response` 必须使用 `app.llm` 中的共享 DTO。Provider 只处理通用的 messages + JSON Schema，不导入 `JobExtractionSchema`，不负责写岗位抽取 prompt。

建议 Member 3 发送本模块整个目录，或者提交到团队仓库。Member 4 优先阅读：

1. `backend/app/llm/contracts.py`、`backend/app/llm/__init__.py`。
2. `docs/PROVIDER_CONTRACT.md`。
3. `examples/provider_request.json` 和 `examples/job_extraction.schema.json`。
4. `backend/app/llm/mock.py`、`tests/test_provider_contract.py`。

这些测试当前只核验共享 DTO 和 Mock，不代表已验证 Qwen/DeepSeek。Member 4 要为真实适配器另外加入 transport mock 单元测试和显式开启的少量真实 smoke test。

## Member 3 已经负责

- 岗位输入适配、提示词、抽取 schema。
- 业务字段校验和最多一次格式修复重试（默认总共最多两次逻辑调用）。
- 引文检查、质量诊断、人工复核状态。
- 岗位来源关联、抽取调用追踪、离线示例和测试。

## Member 4 负责

- `QwenProvider` / `DeepSeekProvider` 实现共享接口；复用或维护现有 `MockProvider`。
- 模型名、endpoint、凭据、客户端关闭与配置；真实 Provider 的 `is_mock=False`。
- 转换不同厂商请求/响应；解析 JSON 对象；映射 finish_reason、usage 和异常。
- 模型 JSON 模式能力检查；不支持时使用明确支持的 JSON 提示方案，或抛 `ProviderCapabilityError`，不能静默返回普通文本。
- 网络超时、限流和临时网络故障的有限重试；取消请求时释放资源。
- 自己的资料到表单映射 prompt/schema/置信度业务逻辑，不放进通用 Provider。

无需让 Member 3 再写一份 LLM API 调用，也不要让 Provider 理解“岗位学历/技能”字段。

## 最小联调顺序

1. 同意采用 contract `0.1.0`，保证团队只有一份共享 DTO。
2. Member 4 先用一个与岗位无关的简单 schema 测试接口，再用 `examples/provider_request.json` 测试嵌套岗位 schema。
3. 在后端启动位置创建真实 Provider，传给 `JobExtractionService(provider)`；无需改抽取 service。见 `examples/integration.py`。
4. 用一条公开 JD 做真实调用，检查模型名、usage、引用、失败分支；然后人工审核更广泛样本。没有完成这一步前，演示仍只能称离线 Mock。

没有 Key 时双方都可以继续开发和测试。不要通过聊天发送密钥；由后端配置环境变量或密钥管理。

## 与 Member 2 的边界

数据库/API 集成暂未实现。建议结果关联键包含 `source_id + external_id + input_hash + schema_version + prompt_version`；如果后端有内部 `job_id`，先用来源身份映射到 `job_id`，不能拿外部 ID 当数据库主键。

`raw_hash` 用于保留爬虫溯源；`input_hash` 覆盖本次抽取真正看到的内容。一次重试仍属于同一 `result_id`。当前服务不提供数据库去重或并发锁，最终持久化幂等、调用调度与并发预算需要后端实现。

`needs_review` 结果不能直接当成已确认的匹配条件。人工确认后，应由后端保存单独的审核状态/审核人/时间/修订，而不是把模型输出里的分数改高。

## 可以直接转发的话

> 我这边已制定公共 Provider contract v0.1.0，岗位抽取统一调用 `await provider.generate_structured(request)`。我负责 prompt、岗位 schema、字段校验和质量诊断；你负责 Qwen/DeepSeek 适配器、通用 JSON 输出、usage/错误映射及网络重试。Mock 已有参考实现。你不用等我继续写业务逻辑，按 contracts.py 和 PROVIDER_CONTRACT.md 开始即可；先确认接口，再一起跑一条真实 JD 联调。

