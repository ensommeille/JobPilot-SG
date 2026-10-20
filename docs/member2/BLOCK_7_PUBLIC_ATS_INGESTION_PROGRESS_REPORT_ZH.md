# M2 第 7 阶段进展：公开招聘接口扩充岗位数据

日期：2026-10-20　负责人：LIAO BINGFENG

## 本次做了什么

- 在原有 InternSG 采集与数据库流程之外，新增 Greenhouse Job Board API 和 Lever Postings API 两类公开岗位接口适配器。只允许指定的官方 HTTPS API 主机及路径，不抓登录页、个人资料或申请表，也不提交求职申请。
- 只导入地点明确包含 Singapore 的岗位，保存标题、雇主、职位描述、原始岗位链接、原始申请链接及来源；每次运行最多处理 100 条。不同岗位编号即使同名也分别保存。
- 接入既有管理员 Source / Crawl Run 流程、审计记录和幂等入库。接口失败保留原有岗位；只有完整且成功的非空清单，才会把该来源已消失的岗位标为 `closed`。限量抽样不会触发下架处理。
- 新增显式 `--apply` 的本地导入命令；不加这个标志只显示预览。每次执行均输出来源、发现数、新增数、更新数与失败数。

## 本机实测结果

| 来源 | 平台 | 当次发现的新加坡岗位 | 本次新增 |
|---|---|---:|---:|
| CSIT | Lever | 110 | 100（单次上限） |
| ShopBack | Lever | 23 | 23 |
| Stripe | Greenhouse | 48 | 48 |
| 合计 |  | 181 | 171 |

原有 2 条沙箱岗位保留，故本机数据库总数从 2 增至 **173**。所有新岗位的 `city` 均为 Singapore、原始申请链接均是 HTTPS。第二次运行三个来源均 `succeeded`，新增 0、更新 0、失败 0。公开 `GET /jobs` 实测返回 HTTP 200、`total=173`。最初 Stripe 请求路径有误，失败运行已留下审计记录；修正并重跑后成功新增 48 条。

代码验收：后端完整测试 **739 passed, 1 skipped**（跳过项因本机未安装 Docker CLI），Ruff 全绿。公开接口适配器另覆盖域名白名单、地点过滤、字段转换、同名岗位、429 不重试、重复运行、限量运行不误关闭及完整运行的下架处理。

## 组员如何复现

先按 `backend/README.md` 配好 PostgreSQL 与后端环境变量，并确保数据库中有管理员账户。在 `backend` 目录执行：

```bash
python -m app.ingestion.public_ats_cli \
  --source 'CSIT=https://api.lever.co/v0/postings/csit' \
  --source 'ShopBack=https://api.lever.co/v0/postings/shopback-2' \
  --source 'Stripe=https://boards-api.greenhouse.io/v1/boards/stripe' \
  --max-jobs 100
```

确认来源后，在同一命令中加 `--apply` 才会联网并写入数据库。此命令只作用于执行者自己的数据库；**本机新增的 171 条不会随着 Git 提交自动进入组员数据库**。仓库提交的是采集能力、测试和这份说明。

## 边界与下一步

- 原项目 proposal 把“大规模多平台爬取”列为范围外；本次是新增的、受限的公开 ATS 数据源，不代表“所有招聘平台”都已接通。LinkedIn、Indeed 等需登录或有访问限制的平台未采集。
- 这些新岗位在 Jobs 列表中可见，但没有自动创建“AI 岗位抽取”结果，因此以抽取证据为前提的个性化推荐不会立刻覆盖全部 171 条。真实模型批量抽取可能产生费用，需组内单独决定后按现有审批流程运行，不应把未抽取岗位说成已验证推荐。
- 新增来源没有 InternSG 专用的内嵌申请表或自动填表承诺；用户只能打开真实来源自行投递。外部岗位可能变化，演示前应重跑并检查原始链接。
- CSIT 本次有 110 条可见，但每次上限 100，剩余 10 条没有进入本机数据库。若要全量同步，需要另行设计分页/更高受控上限，而不是无限抓取。

公开接口说明：[Greenhouse Job Board API](https://docs.greenhouse.io/job-board)、[Lever Postings API](https://github.com/lever/postings-api/blob/master/README.md)。
