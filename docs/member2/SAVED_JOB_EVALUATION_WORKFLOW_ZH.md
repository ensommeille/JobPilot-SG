# 已采集岗位为什么一直显示“Unreviewed”

截至 2026-10-20，本机数据库有 171 个真实公开 ATS 岗位、2 个 sandbox 岗位，但 `job_extraction_runs` 为 0。爬取只保存原始职位描述；推荐接口不能把原文里出现的 Python 等关键词直接当作招聘要求，也不能据此宣称求职者合格。简历上传亦不会自动解析进 Skills。故页面反复出现“Unreviewed jobs to inspect”是如实暴露缺少抽取数据，不是刷新故障。

## 本次补上的入口

`backend/app/extract_saved_jobs.py` 可对**已经保存的真实公开岗位**做有上限的抽取，不再要求重新爬取。默认仅预览岗位 ID/标题，**不调用模型、不写数据库**。可用 `--job-type internship` 限定实习；单次最多 10 个。当前有效的真实抽取会被跳过；岗位原文变化或最新抽取失败后可以重新处理。sandbox/mock 岗位不会进入队列。

先在 `backend` 目录运行预览：

```bash
python -m app.extract_saved_jobs --actor-id <现有管理员 UUID> --job-type internship --limit 3
```

正式处理时，先由运营者在**自己的终端**设置数据库连接和服务端配置，再运行：

```bash
python -m app.extract_saved_jobs --actor-id <现有管理员 UUID> --job-type internship --limit 3 --allow-paid --prompt-key
```

程序会隐藏输入模型 API 密钥；不要把密钥粘贴到群聊、浏览器、GitHub、文档或命令参数中。`--allow-paid` 是明确的付费调用开关。当前适配器支持按服务商账号配置的 DeepSeek/Qwen；默认 DeepSeek。每个未缓存岗位至多一次生成请求，遇到鉴权失败或限流会停止。不要无估算地重复扩大批次。

抽取成功状态 `needs_review` 的意思是结构与引文通过机器检查，**并非招聘要求已由人类核实**。推荐页只给出带原文引文的初步对照；学位、年限、时间、地点、技能熟练度和复杂 AND/OR 条件仍须阅读原始职位页面。它不是录用、合格性或录取概率判断。

## 本机验证结果与剩余条件

本机预览已列出真实岗位，零模型请求，零抽取记录写入。当前没有配置 `LLM_API_KEY`，也没有现成本地模型，因此本次**没有执行收费的真实抽取**。要让页面出现可核查的初步对照，必须由有权限的运营者安全提供可用模型密钥，再在本机运行上述正式命令。无需把求职者简历发送给模型；抽取只处理公开职位描述。随后刷新“Find jobs for me”即可读取新记录。

同时修正了岗位类型归一化：`Internal Auditor` 不再因包含 `intern` 子串被误判成实习；既有错误记录需要重新爬取或单独纠正。
