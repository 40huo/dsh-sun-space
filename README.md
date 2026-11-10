# Sun Space

运行在 DeepSeek Harness 桌面版上的个人 AI 工作空间：**Sun**（Router）每天定时执行晨报/日报流程，派 Worker 干活，全部落库到 Obsidian vault。

## 怎么用

**Sun 的一切管理界面都在 Router 会话的「孙学空间」tab 上**（会话顶部与"对话 / 轨迹 / 上下文"并列）：

1. 启动实例（见 [HANDOFF.md](HANDOFF.md) §三）
2. 在侧栏打开 **Sun Router 会话**（sun-router 预设的那个；没有的话，随便开一个会话 → 顶部「孙学空间」tab → 点「创建 Router 会话」即可自动创建并初始化）
3. 顶部切到 **「孙学空间」tab**，你会看到：
   - **派活树**：当日任务与状态（待确认派发 / 进行中 / 等你确认 / 已完成），点任务卡直达执行该任务的 Worker 会话；"等你确认"的任务卡会以琥珀色标出
   - **定时任务**：当前生效的 cron 任务列表（target 已自动绑定本会话），以及**新增定时任务表单**——填标题、cron（五段：分 时 日 月 周，时区固定 Asia/Shanghai）、任务指令（建议写"按 runbook §N 执行…"的薄引用格式），点「创建」即自动绑定 Router 会话，无需手选执行位置
   - **今日 Journal** 入口（用 Obsidian 打开 vault 查看）

在其他会话（普通会话 / Worker 会话）打开「孙学空间」tab 会显示跳转引导——Sun 的管理面只在当前 Router 会话上；Router 会话轮换后（>30 天或子智能体过多，见 runbook §10），新 Router 会话自动继承工作台。

## 在其他电脑安装（npm 包分发）

本插件以 npm 包形态分发（构建产物随包，目标机器**无需构建**）：

```bash
# 目标机器：直接从 npm 安装（推荐）
dsh plugin --profile web add dsh-sun-space

# 或指定版本
dsh plugin --profile web add dsh-sun-space@0.2.0

# 本机打包（发新版时）
cd sun-space && npm publish   # 包名 dsh-sun-space，需 npm 登录

# CI 发版（Trusted Publishing，无令牌）：本仓库已配 .github/workflows/publish.yml，
# 在 npm 包 Settings → Trusted Publisher 登记 40huo/dsh-sun-space / publish.yml 后，
# 打 tag 即自动构建发布：
cd sun-space && npm version patch && git push --tags

# 目标机器前置（一次性）
# ① 安装同版本 dsh 与 pnpm  ② dws 安装并 dws auth login
# ③ 准备知识库：Obsidian 打开 ~/Workspace/sun-vault（含 90-Meta 骨架；没有也没关系，工作台初始化检查会引导）

# 也可用本地 tarball（离线/发版前验证）
# npm pack 生成 dsh-sun-space-<版本>.tgz 后：
dsh plugin --profile web add ./dsh-sun-space-<版本>.tgz

# 启动实例——注意：不再需要 --patch 参数，插件已在 profile 里
dsh --profile web --port 3081 --no-open
```

安装后打开 Router 会话 → 「孙学空间」tab，初始化检查会自动定位知识库（约定布局 `~/Workspace/sun-vault`，或以 `90-Meta/system/state.json` 的 `vault` 字段为准——自定义位置由 Router 写入该字段即可）。生产定时任务不随插件分发，按上文薄引用写法在工作台「新增定时任务」表单重建（晨报 08:45 / 日报 18:30 / Watchdog 14:00+21:00 / 周复盘 周五 17:00，工作日）。

也可从 GitHub 直装（同内容）：`dsh plugin --profile web add github:40huo/dsh-sun-space#path:sun-space`——`lib/` 不进 git，此路线会在安装时构建，pnpm 拦截 prepare 脚本时按提示在 profile 的 `pnpm-workspace.yaml` 加 `allowBuilds` 后重跑。

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

## License

GPL-3.0-or-later——详见 [LICENSE](LICENSE)。
