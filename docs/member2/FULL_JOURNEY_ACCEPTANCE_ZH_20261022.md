# M2 完整流程集成测试与修复（2026-10-22）

负责人：LIAO BINGFENG（M2，后端核心 / 数据库）。

## 结论

**本轮集成测试版的主流程通过；不等于 main / 团队部署已经全部交付。**

在真实运行的 FastAPI、数据库和构建后的网页之间，验证了注册登录、保存资料、真实岗位快照推荐、收藏、申请草稿、站内表单保存、答案回看、账号隔离和退出。没有用模拟 HTTP 响应替代业务接口。

测试整合了待审核的 #42 / #45、M2 的 #46 和本轮修复。这些分支没有被擅自合并到 GitHub main，也没有修改组员的分支。应先完成依赖分支的 review，再合并本轮 PR、更新团队运行环境并复测。

## 真实推荐测试的边界

- 真实来源：Stripe — Software Engineer, Intern，Singapore，外部编号 `8130883`；[公开岗位页](https://job-boards.greenhouse.io/stripe/jobs/8130883)。本轮只读访问官方 Greenhouse API 为 HTTP 200，返回的岗位描述与保存的 source.json 内容一致；不保证之后仍开放。
- 复用 #45 保存的实际 live 模型输出及其单独保存的来源绑定修订。原始模型记录没有覆盖；修订仍标为 `requires_human_review=true`。**没有新模型调用，也没有把修订说成正式人工批准。**
- 测试求职者为虚构普通账号，不使用组员个人简历。资料明确写了已完成的课堂 Web 应用及自动化测试项目，产生 **1 条相关项目活动建议**；岗位和资料引文逐一比对。
- 结果保留 0 条确认技能匹配及仍待核对的要求；不能将“相关建议”说成符合所有录用条件。
- AutoCAD 无关技能、仅有学习意愿的反例均不产生建议。

## 实际跑通的步骤

| 步骤 | 实测结果 |
| --- | --- |
| 注册 / 登录 | 网页创建独立普通测试账号并登录成功。 |
| 保存个人资料 | 在网页填写姓名、邮箱、电话、教育、项目经验和 Python；保存后 API 回读及刷新一致。 |
| 推荐 | 网页请求真实接口，1 个真实岗位完成比较、1 条相关活动建议；原文、项目证据及待人工复核提示可见。 |
| 收藏 | 在详情页收藏，刷新仍保留，收藏页可见。 |
| 真实岗位申请记录 | 使用现有 API 创建 `draft`，网页历史显示 Draft，`submitted_at=null`；再次创建返回 409。**没有声称已在 Stripe 投递，也没有勾选虚假的外站投递声明。** |
| 站内申请助手 | 单独使用明确标记的 JobPilot Sandbox 岗位；姓名、邮箱、教育预填，必填字段确认后才允许保存，动机由测试者手填。不是 Stripe 原站表单。 |
| 答案回看 | My Applications 可展开最终确认的答案；刷新后仍可见，接口内容与最终答案一致且带 `no-store`。 |
| 手机显示 | 390×844 与桌面检查通过，申请记录与答案没有横向溢出。 |
| 账号隔离 | 另一普通账号无法读取记录 / 答案，返回 404；无认证返回 401。 |
| 退出 | 等待服务端会话撤销后，本地凭据清除；旧凭据失效、私人记录不再可见。 |

**真实雇主网站的插件填表、CAPTCHA 和最终提交不属于这次端到端用例。** 原站提交始终不能由保存站内记录替代。现有扩展回归另外运行，不能用受控页面回归冒充本轮真实雇主投递。

## 本轮修复

1. **必填答案为空仍可保存。** 原后端只检查字段是否被标为已确认。已复现 10 个拒绝测试失败：null、空字符串、纯空白、空列表和空对象都可被错误保存。现在校验最终答案，编辑值优先于模型建议；空必填答案返回 422，不产生 Application 或 FormMappingRecord。新增回归还检查答案不随之后的 profile 修改而变化，以及重复保存不能增加记录。
2. **离线审阅环境丢失基础资料预填。** 原离线 runner 用 RuntimeError 禁止模型，导致整个映射接口返回 500，连规则能够直接填的姓名、邮箱都丢失。改为已有的 ProviderCapabilityError，继续禁止模型，同时保留直接映射；未知语义题留空。通过独立子进程回归和网页实测。
3. **增加可重复的完整流程验收。** runner 新增 `--with-demo-form`，只在其拥有的隔离数据库里加入既有 Sandbox 表单和随机密码的 bootstrap 管理账号；不触碰日常数据库。新增浏览器脚本和 GitHub Actions 完整流程 job，自动保存截图与检查记录。测试不保存账号密码或 token。

## 验证结果

- 整合集成树后端：**991 passed，1 skipped**，分支覆盖率 **90.84%**；跳过项为本机未安装 Docker CLI 的配置检查。
- 全量浏览器回归：**222 passed，6 skipped**；6 项为既有的需扩展 / 原站控件环境用例，不能当作已通过。
- 独立实际接口 + 构建网页：**10 组完整流程检查通过**。测试只连接 loopback；主动阻断可选 Google 字体并使用系统字体，不依赖第三方资源。只排除该确切字体地址被主动阻断的预期提示，其余网页错误仍会失败。
- Ruff、前端 lint / TypeScript / Vite build、前端依赖审计及 Git 空白检查通过。前端依赖审计 0 漏洞。
- 付费模型调用 **0**，雇主申请提交 **0**；业务 HTTP 响应无 Mock。
- GitHub CI 状态以本轮 PR 的实际检查为准；本地通过不替代远端通过。

## 复现

先安装后端运行依赖、frontend / extension 的 npm 依赖及 Playwright Chromium。在包含依赖分支的完整代码根目录运行（将路径替换为本机绝对路径）：

```bash
python scripts/local_review_workspace.py \
  --artifacts /ABS/JobPilot-SG/docs/member3/examples/stripe-source-review-20261021 \
  --workspace /ABS/new-disposable-journey-workspace \
  --port 18522 --web-origin http://127.0.0.1:15522 --with-demo-form
```

另一个终端：

```bash
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:18522 npm run build
npm run preview -- --host 127.0.0.1 --port 15522 --strictPort
```

第三个终端回到代码根目录：

```bash
JOURNEY_ALLOW_TEST_WRITES=disposable-local-only \
JOURNEY_REVIEW_WORKSPACE=/ABS/new-disposable-journey-workspace \
node scripts/verify_application_journey.mjs
```

每次运行创建新的虚构普通账号。验收截图和 verification.json 在忽略目录 `output/application-journey/`；远端 CI 上传为 `application-journey-evidence`。不要将隔离数据库、凭据或 token 提交。

## 还不能宣称完成的事项

真实抽取的独立人工语义审核、覆盖更多真实岗位 / 用户的推荐质量验收、待审核 PR 的合并、团队统一部署后的重复验收，以及最终报告 / PPT / 彩排证据，仍需分别确认。当前电脑原有 5173 / 8001 服务及日常数据库没有被这次隔离测试替换。
