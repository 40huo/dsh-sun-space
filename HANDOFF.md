# HANDOFF —— 新会话交接文档

> 新开 AI 会话（或人接手）时，把本文件全文丢给对方即可接续工作。
> 最后更新：2026-11-08 · 维护纪律：每次实质变更后更新本文件（借鉴 dsh-session-superagent 的 HANDOFF 实践）。

## 一、这个项目是什么

**Sun Space**：运行在 DeepSeek Harness 桌面版上的个人 AI 工作空间。Sun（Router）每天 08:45/18:30 定时执行晨报/日报流程，派 Worker 干活，全部落库到 Obsidian vault（`~/Workspace/sun-vault`）。

- 架构文档：[ARCHITECTURE.md](ARCHITECTURE.md)（设计定稿，含与 Super-agent 五模块的映射）
- 执行计划：[WORKPLAN.md](WORKPLAN.md)（含进度快照 2026-11-08）
- 插件源码：[sun-space/](sun-space/)（TypeScript/Cordis 插件，tsdown 构建）
- 知识库：`~/Workspace/sun-vault`（Obsidian vault，独立 git 仓库）

## 二、当前状态（2026-11-08）

| 模块 | 状态 | 证据 |
|---|---|---|
| 生产定时 | ✅ 晨报周一 08:45 / 日报 18:30 / **Watchdog 14:00+21:00** / **周复盘周五 17:00**，全部指向生产会话 `session-1f42b48a` | schedule-8037f230 / f221eae6 / 104a7328 / 5b5d6ebd |
| 插件（sun-space） | ✅ 双预设 + 5 工具 + Source 轮询 + 初始化检查面板 | lib/*.mjs（tsdown 构建） |
| 工作台 | ✅ **Router 会话上的 tab**（conversation.view 槽，v0.4.2）——派活树 + 定时任务列表/新建表单（target 自动绑）+ 初始化三态；侧栏入口已删，引导见 README | 浏览器 E2E |
| ask 决策卡 | ✅ 定时触发 → 原生询问卡 → 点选 → 分支路由 全链路实测 | 22:53-22:56 会话记录 |
| runbook | **v0.3**（§6 考勤过滤已生效、§10 派发预算+轮换触发线） | `sun-vault/90-Meta/runbook.md` |
| 架构文档 | **v0.4**（2026-11-08 对齐现实：原生 schedule 定时 / 工作台定稿 / 轮换与 sun_route 薄包装） | ARCHITECTURE.md 头部变更注记 |
| schemas.md | 契约修订：日期一律本地时间无时区后缀（时区显示 bug 根因） | `sun-vault/90-Meta/schemas.md` |
| 单元测试 | ✅ 40 用例（Watchdog 探活/TTL/resolveRead 分级白名单） | `pnpm test` |
| composition 自检 | ✅ verify.mjs（①dump-config 断言 ②tsc 严格 ③vitest ④roster 烟雾可选） | `pnpm verify` |
| npm 包分发 | ✅ **npm 公共包 `dsh-sun-space`**（latest 0.2.1，GPL-3.0-or-later）。发版双路线：①CI Trusted Publishing（tag 触发 `.github/workflows/publish.yml`，OIDC 无令牌，provenance 徽章已亮）②本机 bypass 令牌（~/.npmrc）。**踩坑三连**：pnpm12 构建白名单=`pnpm-workspace.yaml` 的 `allowBuilds:` 映射（package.json pnpm 字段已废弃、列表语法无效）；Trusted Publisher 需勾 **Allow npm publish**（stage/publish 两段权限，默认只放 stage）；npm 账号用通行密钥时 CLI 无法做高危动作（unpublish 等），需令牌或网页 |（发布后他机 `dsh plugin --profile web add dsh-sun-space` 即装；bundle.patch.yml 包名引用 + HOME 沙箱；临时 profile 端到端验证过；vault 路径动态发现）：bundle.patch.yml（包名引用 + HOME 沙箱）/ `pnpm pack` / `dsh plugin --profile web add`；临时 profile 端到端验证过（dump-config 含全部 sun-space 条目）；vault 路径动态发现（cwd 推 HOME → state.json vault 字段） | README"在其他电脑安装" |
| 下一阶段计划 | ✅ 落档 WORKPLAN.md §8（W-1 Watchdog → W-2 周复盘 → P3 启动） | WORKPLAN.md §8 |

## 三、怎么启动/重启

```bash
# 实例启动（cwd 必须在 default-workspace，会话按工作区分桶）
cd /Users/40huo/Documents/deepseek-harness/default-workspace
~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh --profile web \
  --patch /Users/40huo/Workspace/dsh-sun-space/sun-space/cordis.patch.yml \
  --port 3081 --no-open
# token 在 /tmp/sun-dsh-web.log
```

- 改 **client.js**（浏览器半）→ 只需页面刷新（无需重启实例）；工作台挂在 Router 会话的「工作台」tab（conversation.view 槽）
- 改 **宿主 TS**（router-tools/source 等）→ `cd sun-space && pnpm build` → 重启实例
- 改 **cordis.patch.yml** → 重启实例
- 每次改完：`pnpm verify`（composition 自检，30 秒）

## 四、关键机制速查

| 机制 | 要点 |
|---|---|
| 双预设 | sun-router（只分派）/ sun-worker（只执行）——工具白名单由组合保证；Worker 预设是内部组件（模式选择器中标注"无需手选"） |
| sun_route | 宿主薄包装：startActivation 直调（spec.request 包装！）、task_id 命名子会话、childId 回写任务笔记、可选 cwd 透传（见"Worker 跨目录"） |
| **会话 id 非常量** | **禁止硬编码 Router 会话 id**（v0.4.1 不变量）。唯一事实源：vault `90-Meta/system/state.json`；工作台解析链 = session/list(sun-router) → state.json 裁决 → updatedAt 最新；写回 = 创建按钮 session/prompt 自登记 + 晨报自检修正；verify --smoke ⑤ 断言 schedule target 对齐 |
| 子会话跳转 | 工作台卡片 → openSession(task.session 裸 uuid)；**测试必须用 cua/Playwright 真实点击**（el.click() 缺指针序列会静默无效） |
| 定时 | 业务定时全部在 DSH 原生 schedule（晨报/日报/Watchdog/周复盘，代码零 cron）；Source 只做 dws 轮询 diff（30min）。**三层分工**：任务 prompt 只写指令（薄引用 runbook §N）｜人格在 preset `persona.prefix`（补丁分发，零维护）｜规则在 runbook。**target 治理走程序化路径**：API target 有 `session`（固定已有会话）/`new_once`/`new` 三种，UI 只暴露后两个——**新增/改靶/删除用 `pnpm sun:schedule`（scripts/schedule-cli.mjs：list/add/retarget/rm，target 自动绑 state.json 解析出的当前 Router 会话，实测全通过）**；UI 面板用于查看/启停/改时间 |
| Worker 跨目录 | `sun_route` 可选 `cwd`（绝对路径，如仓库根）——沙箱可写区**自动跟随会话 cwd**（patch 里 `workspaceRoot` 只是无 cwd 时的兜底）；产物落库仍走 `sun_artifact_write`（vault 绝对路径，与 cwd 无关） |
| 初始化检查 | 三行检查（①vault ②依赖插件 ③Router 会话）**三项全绿才进看板**（只缺 ③ 也要出面板）；① 需要 ③ 的会话作 workspaceFiles scope；agentPresets/list 参数为**空 args** |
| cwd 语义 | session/list 的 cwd 是**工作区分桶路径**（boot cwd），不是 vault——"Router 会话落在知识库目录"是误解，别拿 cwd 过滤会话 |
| 时区 | 一律 `vault.ts` 的 `localDate()`/`localStamp()`（无时区后缀本地时间）；toISOString 是 UTC（差 8h/取错天）双坑 |

## 五、已知问题 / 待办（2026-11-08 重排，执行计划见 WORKPLAN.md §8）

**进行中（P3 启动，11-13 起）**
1. **P3-1 闲时任务**：归档（done>30d）、双链补全、周报素材；低频 schedule + skill"只整理不决策"。
2. **P3-2 需求/缺陷数据源调研**：等用户输入——公司工单系统哪家（钉钉项目/云效/Jira/自建）+ API 权限有无 → `dws api` raw 或自建只读命令。
3. **W-1/W-2 首次自然运行观察**：Watchdog 周一 11-09 14:00 首巡（Journal 补跑分支只在工作日真触发，周六验收未覆盖）；周复盘 11-14 17:00 首跑。

**挂起（阻塞/观察）**
5. IM 三合一（dev connect 入站 + 真推送 + 卡片回调）——等机器人应用建成即做。
6. ~~生产 schedule prompt 同步 ask 卡版~~——已核实完成（11-07 15:10 上会话已更新，schedule/list 里两个生产 prompt 均为 ask 卡版）。
7. 会话轮换触发线（catalog >50）——观察，W46 周复盘检视。
8. HRM 档案表单（用户侧，截止 12-07）。
9. vault 根目录有一空文件 `J-20261107.md`（0 字节杂物，非插件可写路径产物）——可删，留人决定。

## 六、踩坑记录（勿重蹈）

1. **浏览器 immutable 缓存**：combo rev 非内容哈希——client.js 改后若 rev 未变，浏览器吃旧缓存体。判别手段：工作台根节点 `data-wb-rev="vN"` 版本标记（不可见，Playwright/DevTools 可查，改 client.js 时同步 bump）+ 错误边界兜底。
2. **el.click() 缺指针序列**：对 DSH 组件静默无效——UI 测试必须走 Playwright/cua 真实点击。
3. **网关参数形状**：各 remote 方法 args 形状不一（agentPresets/list 空对象、schedule/* 带 request、session/list 带 _request）——以实际探测为准，勿照搬。
4. **npx 构建产物与 repo 源码有漂移**：以运行时 lib 为契约源（startActivation 的 spec.request 包装差异）。
5. **会话按工作区分桶**：实例 boot cwd 决定会话存储桶——"会话列表空"先查桶再查数据。
6. **schedule/create 契约**（typert 严格校验）：`request` 内是 `{title, prompt, timing, target}`——timing 为**嵌套** `{kind:'cron', cron:{expression, time_zone}}` 或 `{kind:'after', after_seconds}`；字段 snake_case 在 timing 内。schedule/list 返回的是读模型（平铺 expression/timeZone），勿照搬回写。
7. **脚本侧网关验收方法**：launch-token 交换（GET /?token=… 存 cookie）→ RPC 信封 `{type:'client-request', rpcId, method, payload:{args}}` 且 method 同时在 URL 路径 `/api/<method>`；`agentPresets/list` 空 args、`schedule/*` 包 `request`、`session/page` 包 `request.address={kind:'session',sessionId}`（读会话历史页，验收利器）；cookie jar 里旧实例的 `dsh-auth-<随机后缀>` 会残留，换实例重启后要清 jar。
6. **时间戳时区双坑**（2026-11-08 B-1 定案）：① 带时区偏移（`+08:00`）的 datetime 写进 frontmatter，Obsidian/Bases 会换算显示差 8h（文件值正确）——写入端一律无后缀本地时间 `YYYY-MM-DDTHH:mm`；② `toISOString()` 取"今天"是 UTC 日期，北京时间 0~8 点取到昨天——一律用 `vault.ts` 的 `localDate()`/`localStamp()`。
