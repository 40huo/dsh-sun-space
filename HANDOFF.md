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
| 生产定时 | ✅ 晨报周一 08:45 / 日报 18:30，指向生产会话 `session-1f42b48a` | schedule-8037f230 / f221eae6 |
| 插件（sun-space） | ✅ 双预设 + 5 工具 + Source 轮询 + 初始化检查面板 | lib/*.mjs（tsdown 构建） |
| 工作台 | ✅ 派活树 + 卡片直达子会话 + 定时/Journal 入口卡 | 截图见反思 2026-W45 |
| ask 决策卡 | ✅ 定时触发 → 原生询问卡 → 点选 → 分支路由 全链路实测 | 22:53-22:56 会话记录 |
| runbook | **v0.3**（§6 考勤过滤已生效、§10 派发预算+轮换触发线） | `sun-vault/90-Meta/runbook.md` |
| 单元测试 | ✅ 27 用例 | `pnpm test` |
| composition 自检 | ✅ verify.mjs（①dump-config 断言 ②tsc 严格 ③vitest ④roster 烟雾可选） | `pnpm verify` |

## 三、怎么启动/重启

```bash
# 实例启动（cwd 必须在 default-workspace，会话按工作区分桶）
cd /Users/40huo/Documents/deepseek-harness/default-workspace
~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh --profile web \
  --patch /Users/40huo/Workspace/dsh-sun-space/sun-space/cordis.patch.yml \
  --port 3081 --no-open
# token 在 /tmp/sun-dsh-web.log
```

- 改 **client.js**（浏览器半）→ 只需页面刷新（无需重启实例）
- 改 **宿主 TS**（router-tools/source 等）→ `cd sun-space && pnpm build` → 重启实例
- 改 **cordis.patch.yml** → 重启实例
- 每次改完：`pnpm verify`（composition 自检，30 秒）

## 四、关键机制速查

| 机制 | 要点 |
|---|---|
| 双预设 | sun-router（只分派）/ sun-worker（只执行）——工具白名单由组合保证；Worker 预设是内部组件（模式选择器中标注"无需手选"） |
| sun_route | 宿主薄包装：startActivation 直调（spec.request 包装！）、task_id 命名子会话、childId 回写任务笔记 |
| 子会话跳转 | 工作台卡片 → openSession(task.session 裸 uuid)；**测试必须用 cua/Playwright 真实点击**（el.click() 缺指针序列会静默无效） |
| 定时 | 业务定时全部在 DSH 原生 schedule（代码零 cron）；Source 只做 dws 轮询 diff（30min） |
| 初始化检查 | 工作台三行检查（vault/依赖插件/Router 会话）+ 引导按钮；注意 agentPresets/list 参数为**空 args**（不能包 request） |
| 时区 | updateFrontmatter 用本地时间拼接（toISOString 会差 8 小时，T-05 教训） |

## 五、已知问题 / 待办

1. **IM 轮询自动化**（P1-14）：钉钉回复 → 自动中继进 Router。目前手工中继。
2. **生产 schedule prompt 待更新**：把 SCHEDULE_TEMPLATES 里的 ask 卡版 prompt 同步到已创建的两个生产任务（schedule/edit patch.prompt）——周一首跑前建议执行。
3. 会话轮换触发线（catalog >50）已入 runbook v0.3 §10，观察首次自动触发。
4. 机器人应用（用户侧）：建成后接 dev connect（入站）+ 真推送 + 卡片回调三合一。
5. sun_vault_meta 时区显示问题（值正确、显示差 8h）待深挖。
6. HRM 档案表单（用户侧，截止 12-07）。

## 六、踩坑记录（勿重蹈）

1. **浏览器 immutable 缓存**：combo rev 非内容哈希——client.js 改后若 rev 未变，浏览器吃旧缓存体。用错误边界+标记元素判别新旧代码。
2. **el.click() 缺指针序列**：对 DSH 组件静默无效——UI 测试必须走 Playwright/cua 真实点击。
3. **网关参数形状**：各 remote 方法 args 形状不一（agentPresets/list 空对象、schedule/* 带 request、session/list 带 _request）——以实际探测为准，勿照搬。
4. **npx 构建产物与 repo 源码有漂移**：以运行时 lib 为契约源（startActivation 的 spec.request 包装差异）。
5. **会话按工作区分桶**：实例 boot cwd 决定会话存储桶——"会话列表空"先查桶再查数据。
