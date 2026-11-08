# Sun Space

运行在 DeepSeek Harness 桌面版上的个人 AI 工作空间：**Sun**（Router）每天定时执行晨报/日报流程，派 Worker 干活，全部落库到 Obsidian vault。

## 怎么用

**Sun 的一切管理界面都在 Router 会话的「工作台」tab 上**（会话顶部与"对话 / 轨迹 / 上下文"并列）：

1. 启动实例（见 [HANDOFF.md](HANDOFF.md) §三）
2. 在侧栏打开 **Sun Router 会话**（sun-router 预设的那个；没有的话，随便开一个会话 → 顶部「工作台」tab → 点「创建 Router 会话」即可自动创建并初始化）
3. 顶部切到 **「工作台」tab**，你会看到：
   - **派活树**：当日任务与状态（待确认派发 / 进行中 / 等你确认 / 已完成），点任务卡直达执行该任务的 Worker 会话；"等你确认"的任务卡会以琥珀色标出
   - **定时任务**：当前生效的 cron 任务列表（target 已自动绑定本会话），以及**新增定时任务表单**——填标题、cron（五段：分 时 日 月 周，时区固定 Asia/Shanghai）、任务指令（建议写"按 runbook §N 执行…"的薄引用格式），点「创建」即自动绑定 Router 会话，无需手选执行位置
   - **今日 Journal** 入口（用 Obsidian 打开 vault 查看）

在其他会话（普通会话 / Worker 会话）打开「工作台」tab 会显示跳转引导——Sun 的管理面只在当前 Router 会话上；Router 会话轮换后（>30 天或子智能体过多，见 runbook §10），新 Router 会话自动继承工作台。

## 命令行（可选）

界面覆盖不到的操作（改靶、批量查看、脚本化）：

```bash
cd sun-space
pnpm sun:schedule list      # 全部定时任务 + target 对齐标记
pnpm sun:schedule add --title "..." --cron "0 9 * * 1-5" --prompt "..."
pnpm sun:schedule retarget <id>   # 把 UI 建的任务改靶到当前 Router 会话
pnpm sun:schedule rm <id>
```

## 文档

| 文档 | 内容 |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构设计（v0.4.1：会话 id 非常量不变量、定时三层分工、工作台形态定稿） |
| [WORKPLAN.md](WORKPLAN.md) | 执行计划与进度快照 |
| [HANDOFF.md](HANDOFF.md) | 新会话交接：启动命令、机制速查、踩坑记录 |
| 知识库 vault | `~/Workspace/sun-vault`（Obsidian 打开；runbook / memory / Journal / 50-Tasks 都在这里） |
