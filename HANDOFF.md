# HANDOFF —— 新会话交接文档

> 新开 AI 会话（或人接手）时，把本文件全文丢给对方即可接续工作。
> 最后更新：2026-11-25 · 维护纪律：每次实质变更后更新本文件（借鉴 dsh-session-superagent 的 HANDOFF 实践）。

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
| 插件（sun-space） | ✅ 双预设 + 5 个 sun_* 工具 + 初始化检查面板；**派发走官方委派工具实例 `sun_route`（组合声明；0.3.9 起不再手写包装调宿主内部接口 startActivation——见踩坑 17）**（dws 轮询 Source 已于 0.3.6 移除——不 AI native；外部感知由 Router 定时任务内按需 dws 查询） | lib/*.mjs（tsdown 构建） |
| 工作台（UI 名「孙学空间」） | ✅ **Router 会话上的 tab**（conversation.view 槽，三分栏 总览/定时任务/设置；新用户三步启用引导卡；定时任务模板速建；**派活树 v24：数据源 = 宿主 `session/projections` 的 `subagentCatalog`（子代理清单，label=task_id）+ session/list 的 `subagentTiming` join（运行中/已结束），vault 任务笔记仅作可选注解（读失败降级不缺树）——不再依赖今日 Journal，读错误显式化**；设置页显示 子智能体 N/50 轮换线）。**v25（0.3.8）**：状态文件按行分页读到 eof（旧实参 limit:8 截断，见踩坑 14）、解析失败记入调试对象 | ✅ 浏览器 E2E（v25，onboarding 测试实例：三步启用 → 一键初始化 → 完整工作台三页；`data-wb-rev="v25"`、`__sunSpaceDebug.errors` 为空） |
| ask 决策卡 | ✅ 定时触发 → 原生询问卡 → 点选 → 分支路由 全链路实测 | 22:53-22:56 会话记录 |
| runbook | **v0.3**（§6 考勤过滤已生效、§10 派发预算+轮换触发线） | `sun-vault/90-Meta/runbook.md` |
| 架构文档 | **v0.4.3**（2026-11-24：`sun_route` 回到官方委派工具实例，插件不调宿主内部接口；v0.4：原生 schedule 定时 / 工作台定稿 / 轮换） | ARCHITECTURE.md 头部变更注记 |
| schemas.md | 契约修订：日期一律本地时间无时区后缀（时区显示 bug 根因） | `sun-vault/90-Meta/schemas.md` |
| 单元测试 | ✅ 119 用例（0.3.9：+ session 字段事件回写、setFrontmatterField；0.3.8：+ 看门狗 `apply()` 全链路、`client.js` 解析链、`sun_state_write` 工具级、守卫拼写变体；此前 40） | `pnpm test` |
| composition 自检 | ✅ verify.mjs（①组合断言：开发态 dump-config **与分发态 bundle.patch.yml** 都要有官方委派工具实例 `sun_route`，且 src 内不得出现 `startActivation` 调用 ②tsc 严格 ③vitest ④构建新鲜度 ⑤实例烟雾可选） | `pnpm verify` |
| npm 包分发 | ✅ **npm 公共包 `dsh-sun-space`**（latest 0.3.9，GPL-3.0-or-later；0.3.8 及之前在宿主 ≥ 0.2.2-rc.3（桌面版 App）上 `sun_route` 派发即崩）。发版 = commit 后 `npm version patch` + push tag，CI Trusted Publishing 自动发布（OIDC 无令牌 + provenance + 三道闸：tag↔版本硬校验 / 已发布跳过 / actions 钉 SHA）。他机安装：`dsh plugin --profile web add dsh-sun-space`。踩坑：pnpm12 构建白名单= `pnpm-workspace.yaml` 的 `allowBuilds:` 映射（package.json pnpm 字段已废弃）；Trusted Publisher 须勾 **Allow npm publish**（stage 默认放行、publish 要显式授权）；通行密钥账号 CLI 无法做 unpublish 等高危动作（需令牌或网页）；校验步骤必须带 `working-directory: sun-space`（仓库根无 package.json） | README「在其他电脑安装」 |
| 下一阶段计划 | ✅ 落档 WORKPLAN.md §8（W-1 Watchdog → W-2 周复盘 → P3 启动） | WORKPLAN.md §8 |

## 三、怎么启动/重启

```bash
# 实例启动（cwd 必须在 default-workspace，会话按工作区分桶）
cd /Users/40huo/Documents/deepseek-harness/default-workspace
~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh --profile web \
  --patch /Users/40huo/Workspace/dsh-sun-space/sun-space/cordis.patch.yml \
  --port 3081 --no-open
# token 在 /tmp/sun-dsh-web.log
# 本机 vault 路径经~/.dsh/state/sun-space/config.json 映射（{vault: 绝对路径}，内容不入库）；不配置则用默认 ~/Workspace/sun-vault
```

- 改 **client.js**（浏览器半）→ 只需页面刷新（无需重启实例）；工作台挂在 Router 会话的「孙学空间」tab（conversation.view 槽）
- 改 **宿主 TS**（router-tools/source 等）→ `cd sun-space && pnpm build` → 重启实例
- 改 **cordis.patch.yml** → 重启实例
- 每次改完：`pnpm verify`（composition 自检，30 秒）
- **E2E 环境**（两套，都是隔离的，可放心跑）：
  - **rc.1**（npx 缓存里的旧宿主）：`~/Documents/dsh-onboard-demo`，自带凭证/会话/插件状态
    ```bash
    cd ~/Documents/dsh-onboard-demo
    DSH_HOME=$PWD/.dsh-home SUN_WATCHDOG_STALL_MS=25000 SUN_WATCHDOG_TICK_MS=5000 \
      ~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh --profile onboarding --port 3081 --no-open   # token 在启动输出首行
    ```
    profile 里装的是本地 tarball `builds/dsh-sun-space-0.3.8.tgz`（内容即仓库源码，仅版本号未 bump）。改代码后 `npm pack --pack-destination ~/Documents/dsh-onboard-demo/builds`，再 `dsh plugin --profile onboarding add <tgz>`——同路径覆盖 pnpm 可能不重新解析，换文件名或子目录更稳妥。
  - **npm 最新宿主**（2026-11-24 为 0.2.2-rc.5；npx 缓存 `~/.npm/_npx/63d4cff42d507497`）。**用完即删**——这个 home 里要放一份测试凭证的副本：
    ```bash
    T=~/Documents/dsh-onboard-demo; H=$T/rc5-home; W=$T/rc5-ws; mkdir -p $H $W
    cp -p $T/.dsh-home/.credentials.yaml $H/                    # 测试凭证
    cd $W && DSH_HOME=$H ~/.npm/_npx/63d4cff42d507497/node_modules/.bin/dsh plugin --profile web add $T/builds/<tgz>
    DSH_HOME=$H SUN_WATCHDOG_STALL_MS=25000 SUN_WATCHDOG_TICK_MS=5000 \
      ~/.npm/_npx/63d4cff42d507497/node_modules/.bin/dsh --profile web --port 3082 --no-open
    ```
  - 网关脚本鉴权同 verify ⑤；`session/create`、`session/prompt`、`workspace/create`、`session/projections` 的 args 要包一层 `request`（`session/list` 是 `_request`）；会话历史用 `session/page`（子会话地址为 `{kind:'subagent', parentSessionId, childSessionId, mode}`，其 id 是裸 UUID）。注意浏览器端读不到 `DSH_HOME` 里的状态目录（见 §五）。

## 四、关键机制速查

| 机制 | 要点 |
|---|---|
| 双预设 | sun-router（只分派）/ sun-worker（只执行）——工具白名单由组合保证；Worker 预设是内部组件（模式选择器中标注"无需手选"） |
| sun_route | **官方 `@deepseek-ai/dsh-tool-subagent` 的实例**（cordis.patch.yml / bundle.patch.yml 里组合声明：`provider: spawn`、`toolName: sun_route`、`agentPreset: sun-worker`、`maxDepth: 1`）——子代理预设与深度由组合钉死，未配 `allowedAgentPresets` 时模型不能改选；工具随宿主一起维护，插件不调任何宿主内部接口（0.3.9 起，见踩坑 17）。模型侧参数：`prompt`、`description`、`cwd`（rc.3 起另有 `name`）。**Router 人格约定：`description` 填小写 task_id**——宿主子代理清单的 label 就是它，工作台靠它把子代理行对上任务笔记。**`session` 字段回写**：`router-tools` 在预设作用域监听宿主事件 `session/event`，Router 会话每追加一条 `subagent/catalog {childId, label}` 就把 childId 写进 `50-Tasks/<TASK_ID>.md`（`setFrontmatterField` 只改那一行；同步落盘，先于派发返回）。返回值随宿主版本不同：rc.1 给子会话 id，rc.3 起只给名称——所以 id 不能指望模型自己回写 |
| **会话 id 非常量** | **禁止硬编码 Router 会话 id**（v0.4.1 不变量）。唯一事实源（v0.3.5 起）：插件状态 `~/.dsh/state/sun-space/state.json` 的 `vaults[].router`（一库一条 `{dir, router?}`；vault 内 `90-Meta/system/state.json` 废弃，过渡期只读兜底——routerSession 是本机会话 id，随 vault 跨机迁移必然失效，本就该住宿主状态）；工作台解析链 = session/list(sun-router) → 插件状态 vaults[].router 裁决 → 旧 vault 内 state.json 兜底 → updatedAt 最新；写回 = 初始化/补建指令 `sun_state_write {"router": true}` + 晨报自检 `sun_state_read` 比对修正；verify --smoke ⑤ 断言 schedule target 对齐 |
| 子会话跳转 | 工作台派活树 → openSession(宿主子代理清单里的子会话 id，裸 UUID)；任务笔记的 `session` 字段只是审计留痕，工作台不依赖它。**测试必须用 cua/Playwright 真实点击**（el.click() 缺指针序列会静默无效） |
| 定时 | 业务定时全部在 DSH 原生 schedule（晨报/日报/Watchdog/周复盘，代码零 cron）；dws 轮询 Source 已移除（0.3.6），外部感知由 Router 定时任务内按需 dws 查询，trigger 队列仅剩 watchdog 停滞事件。**三层分工**：任务 prompt 只写指令（薄引用 runbook §N）｜人格在 preset `persona.prefix`（补丁分发，零维护）｜规则在 runbook。**target 治理走程序化路径**：API target 有 `session`（固定已有会话）/`new_once`/`new` 三种，UI 只暴露后两个——**新增/改靶/删除用 `pnpm sun:schedule`（scripts/schedule-cli.mjs：list/add/retarget/rm，target 自动绑解析出的当前 Router 会话——插件状态 vaults[].router 裁决 → 旧 vault 内 state.json 兜底 → updatedAt；vault 解析与插件六级链同源——含 vaults 分桶与桶目录骨架探测；多实例时 `SUN_DSH_LOG` 指向对应 launch 日志）**；UI 面板用于查看/启停/改时间 |
| **孙学空间引导（v23）** | 两步启用（①插件确认 ②一键初始化：Router 会话 + 知识库，零审批）+ 补建骨架兜底 + 定时模板速建 + 跨工作区提示 + **预设复用（建会话时手选 Sun Router → 工作台认领本会话，"初始化知识库（本会话）"零新建）**；vault 解析六级（v0.3.2）：SUN_VAULT → config.json → **会话目录（含 90-Meta 骨架才算）** → **vaults 分桶登记（v0.3.5 起一库一条 `{dir, router?}`，一桶一 vault 多实例互不污染；首个 sun-router 会话在空目录/骨架目录创建时登记；旧 workspaces 自映射读兼容、写时迁移）** → 全局 vault 镜像 → 约定路径；无 cwd 调用方走 `vaultPathForHost()`（实例进程 cwd 查桶）；⑥ 兜底值**不落盘**（防幽灵登记，见踩坑 11）；**状态文件唯一化（v0.3.5）**：全系统只保留 `~/.dsh/state/sun-space/state.json`，vault 内 `90-Meta/system/state.json` 停写废弃（routerSession 迁至 `vaults[].router`）；**状态工具对**：`sun_state_read`（config/state/resolvedVault 诊断视图）+ `sun_state_write {"vault":true}`（分桶登记）/`{"router":true}`（本会话登记为该库 Router——晨报/Watchdog 自检修正落点，取代旧 sun_vault_write 改 state.json）；**伴生通知插件（v0.3.6，推荐非捆绑）**：`@lyhalal/dsh-notification-center` 一行命令独立安装（`dsh plugin --profile web add @lyhalal/dsh-notification-center`，自带 bundle 自激活）；**不可随包分发**——其 peer（`@deepseek-ai/dsh-client-*`）公共 npm 无稳定版仅预发道，做 dependencies 会让终端用户 `dsh plugin add dsh-sun-space` 解析失败（2026-11-19 CI 实测 ERR_PNPM_OUTDATED_LOCKFILE/resolve 失败）；sun_notify/钉钉通道/dws 轮询均已移除 |
| **发版方式** | GitHub Release 驱动：`npm version patch && git push --tags` → CI 自动 npm 发布 + gh release create（自动更新日志）；仓库工作流权限已设 read-write（GITHUB_TOKEN 建 Release 需要） |
| **Worker 实时看门狗** | `worker-watchdog.ts`（全局 scope，事件冒泡）：盯 sun-worker 委派子代理，`tools/post-execute` 刷新计时，无活动 >15 分钟（`SUN_WATCHDOG_STALL_MS` 可调/`SUN_WATCHDOG_DISABLED=1` 关闭）→ trigger 落盘 + urgent 通知 + interrupt 停掉 → settled 唤醒 Router。与 Watchdog 定时巡检互补：实时救火 + 定时清点。E2E 已验证（stall 触发→Router 被唤醒转述"被中途停止"） |
| Worker 跨目录 | `sun_route` 可选 `cwd`（官方工具参数；相对路径按调用者当前目录解析）——沙箱可写区**自动跟随会话 cwd**（patch 里 `workspaceRoot` 只是无 cwd 时的兜底）；产物落库仍走 `sun_artifact_write`（vault 绝对路径，与 cwd 无关） |
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
9. ~~vault 根目录有一空文件 `J-20261107.md`~~——该目录已清空，事项不存在（2026-11-24 核实）。
10. ~~**default-workspace 残留测试骨架**~~——已清理（2026-11-24 核实：default-workspace 仅剩 `backup-ungrouped-sessions`）。

**0.3.8 修复后仍待处理（2026-11-24 排查新增，未修；均已核实）**

- **浏览器端看不到 `DSH_HOME` 隔离的状态目录**：`client.js` 按 HOME 找 `~/.dsh/state/sun-space/`，服务端按 `DSH_HOME`——隔离实例里 `routerSource` 只能走「updatedAt 兜底」（onboarding 实例实测）。需让服务端把状态目录位置告知浏览器（发现文件或 RPC）。
- **runbook 不随包分发**：一键初始化让模型即兴写 runbook，产物没有编号章节，而定时模板引用 §3/§5/§6/§7/§10（新机器上四条定时任务指向空处）。建议 runbook/schemas 作为插件资源随包、初始化时原样落盘。
- **有内容无骨架的工作区做初始化**：`{"vault": true}` 被拒后骨架落到默认/配置库，而不是工作区——与界面「以当前工作区为知识库根」的文案不符。
- **没有 push/PR 的 CI**：`pnpm verify` 只能手跑；⑤ 烟雾的 Router 解析只按 updatedAt（不读登记）、日志路径写死。
- **触发文件无清理**：TTL 清理随 `source.ts` 一并删除，看门狗仍在写；`sun_read tasks` 每次读全部任务笔记、无过滤无上限。
- **守卫未覆盖**：`rm -r`（不带强制）、`find -delete`、`pwsh` 的 `Remove-Item -Recurse -Force`；守卫只检查 bash/pwsh/job_output，属纵深防御而非安全边界。
- **桌面版（宿主 rc.3）未实跑验证**：0.3.9 的原生派发在 rc.1、rc.5 上实测通过；rc.3 的官方工具契约与 rc.5 逐字一致，但没在真机上跑过——升级 0.3.9 后在 App 里点一次派发确认。
- **看门狗的 `interrupt` 仍调宿主内部接口**：rc.1 / rc.3 / rc.5 签名一致，但它和 `startActivation` 同属内部接口。若日后失效，表现是「停滞不再被停」，不会误停。
- **`description` 填 task_id 是提示词约定**：Router 不照约定时，工作台那一行显示「无任务注解」、`session` 不回写，派发本身不受影响。rc.1 / rc.5 各 2 次实测（测试指令里不提 description），Router 均照做。

## 六、踩坑记录（勿重蹈）

1. **浏览器 immutable 缓存**：combo rev 非内容哈希——client.js 改后若 rev 未变，浏览器吃旧缓存体。判别手段：工作台根节点 `data-wb-rev="vN"` 版本标记（不可见，Playwright/DevTools 可查，改 client.js 时同步 bump）+ 错误边界兜底。
2. **el.click() 缺指针序列**：对 DSH 组件静默无效——UI 测试必须走 Playwright/cua 真实点击。
3. **网关参数形状**：各 remote 方法 args 形状不一（agentPresets/list 空对象、schedule/* 带 request、session/list 带 _request）——以实际探测为准，勿照搬。
4. **宿主内部接口会随版本变**：本机同时存在三份宿主——npx 缓存 rc.1、桌面版 App rc.3、npm latest rc.5，`startActivation` 的参数在 rc.3 被摊平（见踩坑 17）。**插件只依赖面向模型的契约**：官方工具的组合配置、公开事件（`agent/created`、`session/event`、`tools/post-execute`）。
5. **会话按工作区分桶**：实例 boot cwd 决定会话存储桶——"会话列表空"先查桶再查数据。
6. **bundle 覆写基础行 = 运行中宿主拒绝一切管理操作**（已解决）：曾为 dws 白名单覆写 dsh-sandbox-policy 行，bundle-in-use 守卫（按 id+name 比对运行中条目）因此拒绝安装/升级/卸载。0.2.4 起 bundle.patch.yml 移除覆写（运行期管理畅通），白名单仅保留在本机开发态 cordis.patch.yml；他机 Worker 的 dws EPERM 由 persona 指示的 DWS_CONFIG_DIR 自愈兜底（实测凭证在 Keychain，换配置目录不丢认证）。教训：bundle 覆写基础组件行 = 与常驻组件绑定 id+name，管理操作永久撞 bundle-in-use——分发 patch 尽量只贡献自有行。
10. **包名改名必须同步 client 注册 id**：client.js 的 `__ModuleLoader__.load({ id: 'dsh-sun-space/client' })` 经 stripClientSuffix 对齐 package.json name 后注册 factory——id 与包名不一致时报 "loaded without registering"，客户端静默全挂（Failed to load plugins），服务端无任何报错。
10. **schedule/create 契约**（typert 严格校验）：`request` 内是 `{title, prompt, timing, target}`——timing 为**嵌套** `{kind:'cron', cron:{expression, time_zone}}` 或 `{kind:'after', after_seconds}`；字段 snake_case 在 timing 内。schedule/list 返回的是读模型（平铺 expression/timeZone），勿照搬回写。
10. **脚本侧网关验收方法**：launch-token 交换（GET /?token=… 存 cookie）→ RPC 信封 `{type:'client-request', rpcId, method, payload:{args}}` 且 method 同时在 URL 路径 `/api/<method>`；`agentPresets/list` 空 args、`schedule/*` 包 `request`、`session/page` 包 `request.address={kind:'session',sessionId}`（读会话历史页，验收利器）；cookie jar 里旧实例的 `dsh-auth-<随机后缀>` 会残留，换实例重启后要清 jar。
6. **时间戳时区双坑**（2026-11-08 B-1 定案）：① 带时区偏移（`+08:00`）的 datetime 写进 frontmatter，Obsidian/Bases 会换算显示差 8h（文件值正确）——写入端一律无后缀本地时间 `YYYY-MM-DDTHH:mm`；② `toISOString()` 取"今天"是 UTC 日期，北京时间 0~8 点取到昨天——一律用 `vault.ts` 的 `localDate()`/`localStamp()`。
11. **publishVaultState 固化兜底值 = 幽灵登记 + 全局单槽登记多实例交叉污染**（v0.3.2 修复，2026-11-12 homevault 会话定位）：① 启动期把解析结果（含兜底默认 `~/Workspace/sun-vault`）无条件写进 `state.json`，默认路径被固化成登记值 → 首会话登记被 first-wins 挡死、会话工作目录级永不生效——新开空工作区（homevault）识别到的永远是旧 vault 的幽灵（此幽灵此前还恰好遮住了第二个 bug）。② 即便登记成功，全局单槽 `vault` 字段在多实例并存时交叉污染：homevault 实例登记后，主实例明早 08:45 晨报会读错库（DSH 会话按实例 boot cwd 分桶，vault 却是全局一个）。修复：兜底值**不落盘**（仅显式 env/config 才写全局槽）+ **workspaces 分桶映射**（`state.json` 的 `workspaces[<桶cwd>]=<vault>`，一桶一 vault）+ 无 cwd 调用方（source/watchdog）走 `vaultPathForHost()` 按实例进程 cwd 查桶。教训一：把"解析结果"当"登记值"持久化前，先分清值来自显式配置还是兜底默认；教训二：DSH 是多实例分桶架构，跨会话共享状态必须按桶键控，全局单槽必污染。
12. **session/create 只传 cwd ≠ 入工作区**（v0.3.3 修复，2026-11-13 homevault 一键初始化定位）：`session/create` 契约是 `workspaceId` 或 `cwd` 二选一——`cwd` 只设置会话目录（文件桶 + header 都对），**不会** `attachSession` 进 workspace 的 `sessionIds`；UI 侧栏按 sessionIds 分组，网关建出来的会话于是显示为"未分组的会话"。正确姿势两步：`workspace/create {path}`（幂等解析目录 → workspaceId，工作区不存在则注册）→ `session/create {workspaceId, agentPreset}`（宿主只在 workspaceId 分支上 attachSession）。host 源码证据：dsh-api-session-controller `create()` 里 `if (workspace !== void 0) await workspace.attachSession(sessionId)`。教训：网关 RPC"看起来能用"（cwd 建出来的会话确实带对了目录）不等于契约语义完整——分组归属是另一层状态。
13. **`tools/post-execute` 的第一个参数是 ToolExecution，不是 agent**（0.3.8 修复）：看门狗在册表以 agent 对象为键、却拿 `exec` 去查 → 活动计时从不刷新 → 存活超阈值的 Worker 不论是否在干活都被 interrupt。修法：在册表以会话 id 为键（宿主 `Agent.id === session.id`），纳管/刷新/出册三个事件统一用 `sessionIdOf()` 取键。教训：E2E 只验「停滞会触发」不够，必须同时验「活跃不被误停」——驱动 `apply()` 三事件 handler 的用例已入 vitest；verify ② 的 tsc 清单也已改为取自 src 目录（手写清单曾漏掉 `worker-watchdog.ts`）。真实宿主对照（onboarding 实例，阈值调到 25s）：已发布的 0.3.7 上，活跃 Worker（每 5s 一次工具调用）在 25.8s 被中断；修复后 12 次调用全部跑完，静默用例仍在 27s 被中断。
14. **宿主 `workspaceFiles/read` 的 `range` 语义**：`offset` 从 1 起、`limit` 单位是**行**且上限 5000（超限直接报错、不夹取）、返回 `lines`/`eof`。旧实参 `limit: 8` 读 state.json——落盘格式下一条带 router 的登记就是 9 行，截断的 JSON 解析失败被 `catch` 吞掉 → 分桶登记与 `vaults[].router` 裁决静默失效、退到 updatedAt 兜底。修法：不传 limit、按 offset 翻页到 eof（`readPaged`），解析失败记入 `window.__sunSpaceDebug.errors`。回归：`tests/client.test.ts`（假宿主按行分页；`client.js` 首次可测——解析链挂在 `window.__sunSpaceDebug` 上）。教训：读小文件也别拍脑袋传 limit。
15. **`vaults[]` 的 dir 同时是第 ④ 级解析的桶键**（0.3.8 修复）：`{"router": true}` 曾按会话工作目录落键——在非 vault 目录（仓库根、已有文件的 boot 桶）里跑 Router 自检，会让该目录凭一条登记变成整个工作区生效的 vault 根，绕过 `{"vault": true}` 的候选门控。修法：登记落在解析后的生效 vault 根上（`vaultPath(cwd)`）——不改变任何会话的解析结果，`config.json` 把库外置时也登记得上。**存量注意**：0.3.7 及之前若已留下 `{dir: <非 vault 的工作目录>, router}` 条目，它仍会让该目录被当成 vault 根——从 state.json 删掉该条目即可。
16. **宿主右侧边栏边界有一条 10px 的隐形拖拽手柄**（`[data-width-handle=right]`，侧栏收起时也在）：横跨它的工作台按钮，几何中心被手柄截走，按中心点击静默无效（`document.elementsFromPoint` 可证）；侧栏 treeitem 的 locator click 超时同理。测试时点按钮左侧或用坐标点击，并用网关事件（`session/page`）确认动作真的发生——「点了」不等于「触发了」。
17. **不要绕过官方工具去调宿主内部接口**（0.3.9 修复；2026-11-24 桌面版派发崩溃）：0.3.8 及之前 `sun_route` 是手写包装，直接调 `ctx.subagents.startActivation({ …, request: { parent, … } })`。宿主 0.2.2-rc.3 把参数摊平成 `spec.parent`，包装在桌面版上一调即崩（`Cannot read properties of undefined (reading 'id')`，堆栈在 `dsh-subagent/lib/index.js` 的 `startActivation`）——而本机 npx 宿主还是 rc.1，E2E 全绿，完全测不出来。修法：回到 v0.1 的做法，`sun_route` 就是官方 `@deepseek-ai/dsh-tool-subagent` 的实例（组合里 `toolName: sun_route` + `agentPreset: sun-worker` + `maxDepth: 1`），删掉包装；`session` 字段改由预设作用域的 `session/event` 监听回写（宿主向 Router 会话追加 `subagent/catalog {childId, label}`）。官方工具的配置表在 rc.1 / rc.3 / rc.5 三版间一字未变，变的只有内部接口。教训一：**面向模型的契约才稳定，内部服务接口是宿主自己的实现细节**（README 原话：需要等待结果的程序调用方才直接用服务）；教训二：本机 npx 宿主可能落后于用户实际在用的版本（桌面版自带一份），E2E 至少覆盖「最旧」和「npm 最新」两端；教训三：诊断派发故障先解压会话日志取堆栈——`~/.dsh/sessions/<桶>/<会话>/session.v4.jsonl.zstd` 是多个 zstd 帧首尾相接，一次性解压只出第一帧，要按帧边界逐帧解。
18. **「卸载/更新要重启」是宿主对带预设插件的固有行为，与 patch 里的官方委派工具行无关**（2026-11-25 实测，rc.1 与 rc.5）：曾担心 `bundle.patch.yml` 里插入 `@deepseek-ai/dsh-tool-subagent` 实例会让插件「停不掉、无法更新」。用插件管理器的正式接口（`pluginManager/removeBundle` / `setBundleEnabled` / `installBundle`）对照实测：**卸载在任何状态下都成功**——未派发、只建了 Router 会话、派发过、Worker 正在跑，都没有 `bundle-in-use`；运行中的 Worker 不受影响、照常跑完；更新后不重启就能用新版派发。宿主返回里另有 `application: "restart-required"`（原因字段 `unmanaged-plugin`）：没派发过时卸载/装回是 `applied`，但在已装版本上直接装新版本、或进程里建过 Router 会话之后就变成 `restart-required`——**线上 0.3.8（patch 里没有官方工具行）逐项相同**。操作本身都成功（包已删/装、行已重新加载），只是旧预设树要等引用它的会话释放才销毁（注册表文档：「最后一个引用释放后才销毁插件树」；`unmanaged-plugin` 具体指什么没有进一步核实）。桌面版（rc.3）未测。教训：怀疑「某个改动导致停不掉」时，换一份不含该改动的构建做对照，比读源码猜快得多。
