# dsh-cabinet-mode 借鉴报告

> 面向 Sun Space 的设计吸收分析 · 2026-11-07 · 基于 [luodaoyi/dsh-cabinet-mode](https://github.com/luodaoyi/dsh-cabinet-mode) v0.5.3（README 全文 + 两张真实运行截图实读）
> 结论先行：**UI 的"派活树"数据哲学与启动模式选择的工程做法直接可用**；多角色/Agent Team 部分按约定不采纳。

---

## 1. 项目速览

| 项 | 内容 |
|----|------|
| 是什么 | 一个 DSH bundle：声明 `cabinet` 预设（内阁模式）+ 右侧栏"Cabinet"面板（client 半），展示 Lead/阁臣两级派活树 |
| 版本锚点 | 明确 target DSH **0.2.2-rc.1**（与我们运行实例同版本），无硬版本门禁但给出兼容矩阵 |
| 形态 | 两行声明：`preset-cabinet`（agent-preset）+ `cabinet-ui`（client Loader 行）；插件列表**整体复用官方 Standard Mode 的 22 行**，只换 persona 与加面板 |
| 数据通道 | 面板**只读两个既有通道**：`api-session/status`（运行状态）+ `agentTeam` 会话投影（名册与任务板）——**零新增服务、零新协议** |
| 可信度实践 | 明确的"已验证/未验证"分清单、120 条回归用例（官方组件 + fixtures，无真实模型调用）、`verify.mjs` 组合自检（断言包字段/预设声明/22 行插件/`--dump-config` exit 0） |

## 2. 借鉴点一：启动时的模式选择

cabinet 在"新模式如何出现在选模式流程里"上做了完整闭环，逐项对照我们的现状：

| # | cabinet 的做法 | Sun Space 现状 | 采纳建议 |
|---|---------------|---------------|---------|
| 1 | **bundle 图标即模式身份**：明朝首辅画像作为 `icon.svg` 随包分发，出现在模式选择卡片 | `sun-space/package.json` 无 icon 字段 | **P2 采纳**：把左侧栏用的太阳 SVG 落成 `icon.svg`，manifest 声明为 bundle icon |
| 2 | **预设卡片 + 只读配置视图**：Settings → Agent presets 显示"内阁模式"卡片，配置只读可看 | 双预设已在选模式菜单与 roster API 出现，但无卡片身份感（无图标/无中文描述呈现调优） | **P2 采纳**：preset `name/description` 已就绪，补 icon 即可；卡片为官方渲染无需自研 |
| 3 | **order 编排**：cabinet order 5，插在标准模式之后 | sun-router/worker order 10/11 | 已对齐（我们排在其后语义合理），无需改 |
| 4 | **会话内模式锁定**：会话产出输出后模式即锁定，Web 端预设配置只读 | 依赖 DSH 原生行为 | 无需动作（原生保证） |
| 5 | **新会话流程的引导**：安装后"重启 → 新会话 → 模式选择器 → 侧栏 + 打开面板"写进文档并作为验收路径 | 我们的验证路径散在 WORKPLAN | **文档采纳**：把这条路径写进 WORKPLAN P1-16 验收清单 |

**不借鉴**：它的安装矩阵（插件市场/tarball/脚本三路 + 回滚）对个人自用过重；我们已有 `--patch` 开发流，未来发布时再回头抄市场索引做法（raw JSON index URL 格式、market-index 分支机制已记录在案）。

## 3. 借鉴点二：UI 展示（Cabinet 面板解剖）

对两张真实截图（light/dark）逐元素拆解，共 8 个可迁移模式：

### 3.1 派活树 = 组织架构连线（最值得抄）
Lead 卡片在顶部，**真实的树形连接线**（垂直线 → 水平导轨 → 各成员卡片顶部），下面按成员分列卡片网格。我们的 Router/Worker 是完全同构的两级：Router 卡在上、当日 Worker 卡在下、任务笔记挂在各 Worker 名下。**这不是"多角色"设计，是"派活关系"可视化——正是我们 50-Tasks 数据的天然视图。**

### 3.2 摘要计数器行
面板头部一行：`成员 9 · 待办 0 · 进行中 2 · 已完成 11`。一秒读懂全局。→ Sun 面板用 `50-Tasks` frontmatter 实时统计（proposed/running/need-confirm/done 四数）。

### 3.3 状态语义三色 + 点动画
- 灰点=空闲/待办、**绿点+呼吸动画=干活中**、琥珀=启动中、红=失败
- 任务：灰待办 / **蓝进行中（卡片左侧蓝色竖条 accent）** / 绿已完成
- 底部**图例**常驻，颜色语义自解释
→ Sun 任务 status 枚举恰好四态，直接映射：proposed=灰、running=蓝、need-confirm=琥珀（cabinet 没有的状态，加）、done=绿。

### 3.4 "谁在干活"优先级
运行中的成员整行**绿色底色 + 点脉冲**，空闲成员视觉退后。对应 Sun：running 任务的 Worker 卡片高亮，need-confirm 任务卡片**琥珀描边**（比 cabinet 多一层"等你"语义——这是 personal agent 与团队面板的最大差异点）。

### 3.5 卡片信息密度
每张成员卡：圆形头像 + 名字 + 状态标签 + **当前模型 id**（模型透明度）。每张任务卡：状态点 + 标题 + `Owner: xxx` chip + `task-N` id chip + `等待 1` 可展开 chip（依赖计数）。
→ Sun 任务卡映射：status 点 + `T-YYYYMMDD-NN` + source chip（dd-todo/tb/conv）+ confirmations 次数 chip + journal 反链。

### 3.6 未分派组（dark 截图新发现）
右侧独立卡片"**未分派 (3)**"收纳无 Owner 的任务。→ Sun 的 `proposed` 任务正好是"晨报已生成、等待确认派发"的未分派态，可视化位置成立。

### 3.7 依赖边（SVG 曲线）
`blockedBy` 依赖画三次贝塞尔曲线：完成=实线绿、进行中=向 blocker 流动的虚线（对方在跑时更快更亮）、待办=静态灰虚线；曲线**被卡片内容遮罩**不压文字，`prefers-reduced-motion` 时动画静止、静态线保留，明暗主题自适应。
→ Sun v1 任务依赖数据少，**采纳其降级哲学**：先用 chip 表达依赖（就像我们已有的 journal 反链），SVG 边列为 P3 可选。

### 3.8 零新协议纪律（最核心的工程决策）
> "The panel reads two existing data channels only … It adds no service and no protocol."

面板是**既有数据的纯视图**。这与我们架构 §3.4 的判断完全同向：Sun 面板只读 vault frontmatter（我们已有的"数据库"）+ DSH 会话状态，**不为面板建任何新数据通道**。cabinet 用 agentTeam 投影，我们用 50-Tasks——角色相同。

## 4. 映射到 Sun Space：落地清单（P2 面板改造方案）

| 优先级 | 改动 | 依据 |
|--------|------|------|
| **P2-1** | 工作台主区从 4 张静态卡改为**派活树视图**：Router 卡（顶部）→ 当日 Worker 卡行 → 任务笔记卡挂在对应 Worker 下；组织连线用 CSS border 画（v1 不上 SVG） | §3.1 |
| **P2-2** | 头部摘要计数器：读 50-Tasks frontmatter 统计四态 + 今日通知数 | §3.2 |
| **P2-3** | 三色 + 琥珀状态系统 + 底部图例；running 行高亮、need-confirm 琥珀描边 | §3.3/3.4 |
| **P2-4** | 任务卡信息位：id、source chip、confirmations、journal 反链；proposed 收进"未分派"组 | §3.5/3.6 |
| **P2-5** | bundle `icon.svg` + 预设卡片呈现调优 | §2.1 |
| P3 | 依赖 SVG 边（若任务间出现 blockedBy 数据）；明暗主题变量化 | §3.7 |
| P3 | Settings 页（轮询周期/打扰阈值）借 cabinet 的**原子保存 + revision 防陈旧草稿**模式 | 见 §5 |
| P2 附带 | Worker prompt 模板加**派发预算**（简单任务 ≤30 次工具调用、多文件 ≤100、同失败重试 ≤2；超限如实报 failed/unverified，禁止伪造完成） | cabinet 0.3.1 的 0.3.1 dispatch-budget policy，纯 prompt 级 |

## 5. 不采纳项（按你的约定与架构判断）

| 项 | 不采纳理由 |
|----|-----------|
| 多角色人设（首辅/四司） | 你已明确不需要；且 Sun 的 Router/Worker 分工由**预设白名单**硬保证，比 persona 语义约束强一个量级 |
| Agent Team 工具链依赖（spawn_teammate 等 9 件套） | 我们的 sun_route 已用官方 tool-subagent 通道，不引入 experimental bundle |
| 内阁成员设置页（改名/头像/模型选择） | 单人场景无成员可配；**但其"原子保存 + revision 防陈旧草稿"的交互契约**值得在 P3 设置页复用 |
| 明朝主题视觉 | 风格问题；保留其"主题自适应（light/dark 变量化）"的技术点 |
| 插件市场发布链路（npm trusted publishing 等） | 自用阶段不需要；发布时按其 market-index 模式补 |

## 6. 附带工程实践收获（与 UI 无关但值得记住）

1. **`verify.mjs` 组合自检**：断言包字段、预设声明、插件行数、`--dump-config` exit 0 且恰好一个 `preset-cabinet`——我们 P1 已手工做过同款验证，值得脚本化为 `sun-space/tests/composition.test.ts`（P2 顺手项）。
2. **"未验证事项"诚实清单**：README 把 Windows 实测 vs Linux/macOS 推断分列，明确"不得当作已验证呈现"——与我们反思笔记的证据纪律同源，延续。
3. **兼容性声明方式**：无硬版本门禁 + 明确 target 版本 + "其他版本未验证"，比 engines 断言更适合快速演进的 DSH。
4. **头像/资源策略**：128px data URL 内嵌 client.js、构建期由脚本降采样、无 CDN 无重复打包——面板资产零请求。

## 7. 结论

cabinet-mode 与 Sun Space 是**同一插件范式**（agent-preset + client 面板）的两个应用：它面向"团队派活"，我们面向"个人日程闭环"。它最值钱的两件事——**只读既有数据通道的面板哲学**与**派活树的视觉语言**——恰好补上我们 P2 面板"有骨架无血肉"的缺口；其模式选择的工程做法（icon/卡片/验收路径）让我们的双预设呈现补完最后一公里。多角色与 Agent Team 部分整体不采纳，仅取其预算策略融入 Worker prompt 模板。

**建议执行序**：P2-1/2/3（派活树 + 计数器 + 状态色）一次改完 `client.js`（纯前端、无协议变更、风险低）→ P2-4/5 → 沙箱补丁已就绪后重跑一轮真实晨报在面板上看实时效果。
