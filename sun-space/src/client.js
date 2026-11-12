/**
 * sun-space client 插件（v11：工作台 = Router 会话上的 tab）。
 * 载体：conversation.view 槽（原生"对话/轨迹/上下文/编队"同款挂点，主理鱼同款模式）——
 * 侧栏入口已删（用户决策 2026-11-08：唯一引导方式是 README 说明"打开 Router 会话 → 工作台 tab"）。
 * 三态渲染：当前会话 = state.json 解析的 Router 会话 → 完整工作台（含新增定时任务表单，
 * target 自动绑当前会话）；非 Router 会话 → 跳转引导卡；无 Router 会话 → 初始化面板。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sun-space/client',
  factory(require) {
    const D = { phase: 'factory-entered', errors: [], currentSessionId: null }
    try {
      window.__sunSpaceDebug = D
      const React = require('react')
      const h = React.createElement
      D.phase = 'react-ok'
      let hostCtx = null

      const PANEL_ID = 'sun-space'
      const VAULT_DIRNAME = 'sun-vault' // vault 目录名约定；绝对路径动态发现，见 resolveVault
      // 架构 §4.1 不变量：呈现层不得持有会话 id / vault 绝对路径常量（Router 会话会轮换，机器会换）。
      // 会话解析链：session/list（sun-router 会话）→ 90-Meta/system/state.json 裁决 → updatedAt 最新兜底。
      // vault 解析链（server 端 vault-path.ts 为唯一事实源）：config/分桶映射（workspaces[本工作区]）→
      // 约定布局发现；当前工作区无骨架时引导以工作区为根初始化（服务端登记仅放行空目录/已含骨架）。
      // 写回：① 创建会话后经 session/prompt 引导自登记（含 vault 字段）；② 晨报自检发现缺失/不一致自动修正。
      const WB_REV = 'v20' // 根节点 data-wb-rev 版本标记：判别浏览器是否吃到旧 client.js（immutable 缓存坑，HANDOFF 踩坑 1）

      const STATUS_META = {
        proposed: { label: '待确认派发', color: '#9e9e9e' },
        running: { label: '进行中', color: '#4d9de8' },
        'need-confirm': { label: '等你确认', color: '#e8a24d' },
        done: { label: '已完成', color: '#57b26a' },
        blocked: { label: '受阻', color: '#e8634d' },
        dropped: { label: '已放弃', color: '#777' },
      }

      function parseFrontmatter(text) {
        const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
        if (!m) return {}
        const out = {}
        const lines = m[1].split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(lines[i])
          if (!kv) continue
          const key = kv[1]
          const v = kv[2].trim()
          if (v === '') {
            // 块式数组：跟随的缩进 "- item" 行（与 server 版解析器对齐，📦 chip 依赖 artifacts）
            const items = []
            let j = i + 1
            while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
              items.push(lines[j].replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''))
              j++
            }
            if (items.length) { out[key] = items; i = j - 1; continue }
            out[key] = ''
            continue
          }
          if (v.startsWith('[') && v.endsWith(']')) {
            const inner = v.slice(1, -1)
            out[key] = inner ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')) : []
            continue
          }
          out[key] = v.replace(/^["']|["']$/g, '')
        }
        return out
      }

      async function gateway(method, args) {
        const res = await fetch('/api/' + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: 'sun-' + Math.random().toString(36).slice(2, 8), method, payload: { args } }),
        })
        const j = await res.json()
        if (j?.result?.ok !== true) throw new Error(JSON.stringify(j?.result?.error ?? j).slice(0, 160))
        return j.result.value
      }

      // 网关参数形状适配表（HANDOFF 踩坑 3：各 remote 方法 args 形状不一——空对象/_request/request 包装并存，
      // 以运行时探测为准；新增方法在此登记，勿在调用点内联包装）
      const GW_SHAPE = {
        'agentPresets/list': a => a,
        'workspaceFiles/read': a => a,
        'session/list': a => ({ _request: a ?? {} }),
        'session/create': a => ({ request: a }),
        'session/prompt': a => ({ request: a }),
        'schedule/list': a => ({ request: a ?? {} }),
        'schedule/create': a => ({ request: a }),
        'schedule/edit': a => ({ request: a }),
      }
      const gw = (method, args) => gateway(method, (GW_SHAPE[method] ?? (x => x))(args))

      // vault 读取通道：scope 是任一同工作区会话 id（workspaceFileScopeId 类型即 SessionId）
      const readVaultFile = (sessionId, path, limit) => gw('workspaceFiles/read', {
        workspaceFileScopeId: sessionId, path, range: { limit },
      }).then(v => v.text || '')

      // ===== vault 绝对路径发现（跨机器；呈现层不持常量，架构 §4.1 同款不变量）=====
      // 链：会话 cwd 推 HOME → 约定布局 <HOME>/Workspace/sun-vault 探测 state.json → state.json.vault 字段裁决。
      // state.json 由 Router 自登记/晨报自检维护（server 端解析链是唯一事实源）；
      // workspaces 分桶映射优先（一桶一 vault，多实例互不污染，与 server ④ 级一致）。
      // items 可选：调用方已取过 session/list 时复用（免重复 RPC）。
      async function resolveVault(itemsIn, currentSessionId) {
        let items = itemsIn
        if (!items) {
          const v = await gw('session/list', {})
          items = Array.isArray(v?.items) ? v.items : Object.values(v?.items ?? v ?? {})
        }
        const scope = items.find(s => s?.projections?.values?.agentPreset === 'sun-router')?.sessionId ?? items[0]?.sessionId
        if (!scope) return null
        const myCwd = currentSessionId ? String((items.find(s => s.sessionId === currentSessionId) ?? {}).cwd ?? '') : ''
        // ① 插件状态目录（HOME 从会话 cwd 推导，绝对路径读取）：
        //    config.json 优先（运行期事实源——引导初始化/用户手写即时生效），state.json 兜底（启动期快照）
        const homes = [...new Set(items.map(s => String(s.cwd || '')).filter(c => c.startsWith('/')).map(c => c.split('/').slice(0, 3).join('/')))]
        for (const home of homes) {
          for (const file of ['config.json', 'state.json']) {
            try {
              const raw = await readVaultFile(scope, `${home}/.dsh/state/sun-space/${file}`, 8)
              const st = JSON.parse(raw)
              const mapped = myCwd.startsWith('/') ? st?.workspaces?.[myCwd] : undefined // 分桶登记（本工作区）
              if (typeof mapped === 'string' && mapped.startsWith('/')) return mapped
              if (st?.vault && st.vault.startsWith('/')) return st.vault
            } catch { /* 该文件不存在 → 下一个 */ }
          }
        }
        // ② 会话 cwd 即 vault（用户"新建目录作为工作区并开会话"流：cwd 下有 90-Meta 即认定）
        try {
          const cwd = String((items.find(s => s.sessionId === scope) ?? {}).cwd ?? '')
          if (cwd && cwd.startsWith('/')) {
            await readVaultFile(scope, `${cwd}/90-Meta/runbook.md`, 2)
            D.vaultFoundNoField = cwd
            return cwd
          }
        } catch { /* 该 cwd 无 90-Meta → 约定兜底 */ }
        // ③ 约定布局探测（默认 ~/Workspace/sun-vault；自定义 vault 路径由①覆盖）
        const candidates = [...new Set(homes.map(h => `${h}/Workspace/${VAULT_DIRNAME}`))]
        for (const cand of candidates) {
          try {
            const raw = await readVaultFile(scope, `${cand}/90-Meta/system/state.json`, 8)
            const st = JSON.parse(raw)
            if (st?.vault && st.vault.startsWith('/')) return st.vault // state.json 裁决（可能与约定布局不同盘/路径）
            D.vaultFoundNoField = cand
            return cand // 布局命中但 state.json 尚无 vault 字段（旧种子）——先按布局用，晨报自检会补字段
          } catch { /* 该候选不存在 → 下一个 */ }
        }
        return null
      }

      // ===== Router 会话解析（架构 §4.1 不变量：会话会轮换，呈现层只认 vault state.json + 动态发现）=====
      async function resolveRouterSession(vault, items) {
        if (!items) {
          const v = await gw('session/list', {})
          items = Array.isArray(v?.items) ? v.items : Object.values(v?.items ?? v ?? {})
        }
        // 注意：cwd 是"工作区分桶路径"（实例 boot cwd），不是 vault——过滤只看预设（踩坑 5 延伸）
        const candidates = items.filter(s => s?.projections?.values?.agentPreset === 'sun-router')
        if (!candidates.length) return null
        // state.json 裁决：指向列表内现存会话者胜（轮换后旧会话仍在列表里，state 是唯一事实源）
        for (const s of candidates) {
          try {
            const raw = await readVaultFile(s.sessionId, `${vault}/90-Meta/system/state.json`, 8)
            const st = JSON.parse(raw)
            if (st?.routerSession && candidates.some(c => c.sessionId === st.routerSession)) return st.routerSession
          } catch { /* 无 state.json 或不可读 → 走兜底 */ }
        }
        // 兜底：最近活跃者（多 sun-router 并存时，列表顺序不可依赖）
        candidates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        return candidates[0].sessionId
      }

      // ===== 初始化检查（在任何会话的 tab 上都能跑；① 用当前会话作 workspaceFiles scope）=====
      async function runInitChecks(currentSessionId) {
        const c = { vault: false, presets: false, routerSession: null, vaultPath: null, currentCwd: null, notes: [] }
        // 会话列表只取一次：currentCwd 供 ① 跨工作区提示与一键初始化，router 解析复用
        let items = null
        try {
          const sl = await gw('session/list', {})
          items = Array.isArray(sl?.items) ? sl.items : Object.values(sl?.items ?? {})
          c.currentCwd = (items.find(s => s.sessionId === currentSessionId) ?? {}).cwd ?? null
        } catch { c.notes.push('会话列表不可达 → 重试或检查实例') }
        // ① 知识库：vault 路径动态发现 + runbook 探测
        const vault = await resolveVault(items, currentSessionId)
        c.vaultPath = vault
        if (vault && currentSessionId) {
          try { await readVaultFile(currentSessionId, `${vault}/90-Meta/runbook.md`, 10); c.vault = true } catch {
            c.notes.push(`知识库未就绪（已定位 ${vault}，缺 90-Meta 骨架）：① 用 Obsidian 打开该目录 ② 可让任意 Router 会话执行"初始化知识库"指令 ③ 重新检查`)
          }
          // 跨工作区提示：识别到的 vault 在别处、当前工作区无骨架——一键初始化将以当前工作区为根
          //（服务端门控：仅空目录或已含 90-Meta 的工作区目录会被当 vault 登记/解析，见 vault-path.ts）
          if (c.currentCwd && c.currentCwd !== vault) {
            try { await readVaultFile(currentSessionId, `${c.currentCwd}/90-Meta/runbook.md`, 2) } catch {
              c.notes.push(`知识库识别在 ${vault}；当前工作区 ${c.currentCwd} 尚无骨架——【创建 Router 会话】将以当前工作区为知识库根初始化；若要沿用 ${vault}，请到它所在的工作区开会话`)
            }
          }
        } else if (!vault) {
          c.notes.push(c.currentCwd
            ? `未找到既有知识库——当前工作区 ${c.currentCwd} 将作为知识库根（待初始化）：完成下方初始化引导即可`
            : `未找到知识库目录：按约定应在 <用户目录>/Workspace/${VAULT_DIRNAME}（含 90-Meta/system/state.json）；自定义位置需由 Router 把绝对路径写进 state.json 的 vault 字段`)
        } else {
          c.notes.push('知识库检查需要会话作读取通道 → 先创建会话')
        }
        // ② 依赖插件：预设 roster 健康 = 智能体协作链路可用（missing/broken → 插件面板手动开启）
        try {
          const v = await gw('agentPresets/list', {})
          const presets = v?.presets ?? []
          const r = presets.find(p => p.id === 'sun-router')
          const w = presets.find(p => p.id === 'sun-worker')
          c.presets = !!(r && !r.broken && w && !w.broken)
          if (!c.presets) c.notes.push('Sun 预设缺失或损坏 → 打开插件面板，手动开启 sun-space / 智能体协作相关插件后重启实例')
        } catch {
          c.presets = false
          c.notes.push('预设服务不可达 → 确认 Harness 实例在线、插件已启用')
        }
        // ③ Router 会话：动态解析 + 首个 sun-router 会话创建时自动登记其 cwd 为 vault 根
        //   （"当前目录作为 vault"语义的插件层落点；门控在服务端——空目录/已含骨架才登记）
        try {
          if (!items) { // 顶部取失败时兜底重取
            const sl = await gw('session/list', {})
            items = Array.isArray(sl?.items) ? sl.items : Object.values(sl?.items ?? {})
          }
          // vault 根登记由宿主插件在 sun-router 会话创建时自动完成（index.ts agent/created 钩子）
          c.routerSession = vault ? await resolveRouterSession(vault, items) : null
          if (!c.routerSession) c.notes.push('Router 会话不存在 → 点下方「创建 Router 会话」（sun-router 预设，随当前工作区），创建后自动登记 state.json')
        } catch {
          c.notes.push('会话列表不可达 → 重试或检查实例')
        }
        return c
      }

      async function createRouterSession(cwd) {
        // cwd 可选：一键初始化时传当前会话的工作区目录——Router 会话落在用户选的工作区
        //（session/create 带 cwd 还会自动注册该工作区）；不传则随宿主项目目录（踩坑 5）
        return gw('session/create', cwd ? { cwd, agentPreset: 'sun-router' } : { agentPreset: 'sun-router' })
      }


      async function loadTasks(routerSession, vault) {
        if (!routerSession || !vault) return []
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        let journalText = ''
        try { journalText = await readVaultFile(routerSession, `${vault}/40-Journal/${today}.md`, 200) } catch {}
        const ids = [...new Set([...journalText.matchAll(/\[\[(T-\d{8}-\d{2})\]\]/g)].map(m => m[1]))]
        const tasks = []
        for (const id of ids.slice(0, 20)) {
          try {
            const fm = parseFrontmatter(await readVaultFile(routerSession, `${vault}/50-Tasks/${id}.md`, 24))
            if (fm.id) tasks.push({
              id: fm.id, status: fm.status || 'proposed', source: fm.source || '',
              priority: fm.priority || 'medium', journal: fm.journal || '', session: fm.session || '',
              artifacts: fm.artifacts || [],
            })
          } catch {}
        }
        return tasks
      }

      // ===== SunIcon =====
      function SunIcon({ size }) {
        const rays = []
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4
          rays.push(h('line', {
            key: i,
            x1: (12 + Math.cos(a) * 7.2).toFixed(2), y1: (12 + Math.sin(a) * 7.2).toFixed(2),
            x2: (12 + Math.cos(a) * 10).toFixed(2), y2: (12 + Math.sin(a) * 10).toFixed(2),
            stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round',
          }))
        }
        return h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } }, [
          h('circle', { key: 'c', cx: 12, cy: 12, r: 4.4, fill: 'currentColor' }), ...rays,
        ])
      }

      const btnStyle = { fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' }
      const cardStyle = (borderColor) => ({
        display: 'flex', alignItems: 'center', gap: 10,
        border: `1px solid ${borderColor || 'rgba(128,128,128,0.25)'}`,
        borderLeftWidth: 3, borderRadius: 8, padding: '8px 12px', marginBottom: 6,
      })
      const inputStyle = { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' }

      class SunErrorBoundary extends React.Component {
        constructor(props) { super(props); this.state = { err: null } }
        static getDerivedStateFromError(e) { return { err: e } }
        render() {
          return this.state.err
            ? h('pre', { style: { color: '#e8634d', fontSize: 12, padding: 12, whiteSpace: 'pre-wrap' } }, 'WB-ERROR: ' + String(this.state.err?.stack || this.state.err).slice(0, 600))
            : this.props.children
        }
      }

      // 一键初始化：创建 Router 会话 → 下发合并指令（90-Meta 骨架 + 自登记 state.json）。
      // 全程走 sun_vault_write（vault 白名单内，零审批弹窗）——Router 是 sun-router 预设，
      // 插件运行期动态解析（vaultPath()）保证它写入"当前生效"的知识库路径。
      async function createRouterAndInit(checks, onRetry) {
        try {
          const cwd = checks.currentCwd
          const v = await createRouterSession(cwd)
          const sid = typeof v === 'string' ? v : (v?.sessionId ?? v)
          if (!sid) return
          await gw('session/prompt', {
            requestId: 'sun-init-' + Date.now(),
            sessionId: sid,
            mode: 'queue',
            content: [{ type: 'text', text: `【孙学空间初始化】你是新环境的 Sun Router（你的会话 id：${sid}）。按顺序完成：
1) 用 sun_state_write 确认/补全本工作区的 vault 根登记（参数 {"vault": true}——会话创建时已自动登记，此步幂等自愈；若 ok:false 按注记处理）
2) 用 sun_vault_write 创建知识库骨架（实际根以工具返回的 vault 字段为准，勿凭工作目录猜测）：
   - 90-Meta/schemas.md：frontmatter 契约最小集（通用字段 type/id/status/created/updated；task 的 status 枚举 proposed|running|need-confirm|done|blocked|dropped；写入纪律：Journal 由 Router 独占、日期一律本地时间 YYYY-MM-DDTHH:mm 不带时区后缀、结论必注出处）
   - 90-Meta/runbook.md：初始版（# Sun 行为手册 + v0.1 版本行 + §1 角色：Router 只分派不执行 + §2 沟通规范：IM ≤100 字结论先行 + §3 打扰分级：info 攒批/ask 立即/urgent 加 DING）
   - 90-Meta/memory.md：初始版（# 关于用户，待填充）
3) 用 sun_vault_write 写 90-Meta/system/state.json：{"routerSession": "${sid}", "vault": "<知识库根绝对路径——填第 2 步 sun_vault_write 返回的 vault 值>", "updatedAt": "<本地时间 YYYY-MM-DDTHH:mm>"}（自登记，供孙学空间发现与轮换机制使用）
4) 完成后列出生成的文件清单与知识库路径。` }],
            clientTimeZone: 'Asia/Shanghai',
          })
          try { hostCtx.uiWorkspace.openSession(sid) } catch (e) { D.errors.push('openSession: ' + String(e)) }
          onRetry()
        } catch (e) { D.errors.push(String(e)) }
      }

      // Router 已在、知识库缺失时的骨架补建指令（发给现有 Router 会话）
      async function initSkeletonOnRouter(routerSession, onRetry) {
        try {
          await gw('session/prompt', {
            requestId: 'sun-skel-' + Date.now(),
            sessionId: routerSession,
            mode: 'queue',
            content: [{ type: 'text', text: `【知识库骨架补建 + vault 根登记】按顺序完成：
1) 用 sun_state_write 登记本工作区为 vault 根（参数 {"vault": true}——分桶登记，零审批，不影响其他工作区；值由系统从你的会话上下文派生。若 ok:false 按注记处理，禁止用 shell 手写状态目录）
2) 用 sun_vault_write 创建/补全知识库骨架（实际根以工具返回的 vault 字段为准，勿凭工作目录猜测）：
   - 90-Meta/schemas.md：frontmatter 契约最小集（通用字段 type/id/status/created/updated；task 的 status 枚举 proposed|running|need-confirm|done|blocked|dropped；写入纪律同 runbook）
   - 90-Meta/runbook.md：若缺失则写初始版（# Sun 行为手册 + v0.1）
   - 90-Meta/memory.md：若缺失则写初始版（# 关于用户）
   - 90-Meta/system/state.json：{"routerSession": "${routerSession}", "vault": "<第 2 步 sun_vault_write 返回的 vault 值>", "updatedAt": "<本地时间 YYYY-MM-DDTHH:mm 无时区后缀>"}（已有的话合并更新 routerSession/vault 字段）
完成后报告清单与知识库路径。` }],
            clientTimeZone: 'Asia/Shanghai',
          })
          onRetry()
        } catch (e) { D.errors.push(String(e)) }
      }

      function InitPanel({ checks, currentSessionId, onRetry }) {
        const rows = [
          { ok: checks.vault, title: '① 知识库（vault）', desc: checks.notes.find(n => n.includes('知识库')) || `已就绪：${checks.vaultPath}` },
          { ok: checks.presets, title: '② 依赖插件（智能体协作 / 子智能体）', desc: checks.notes.find(n => n.includes('预设') || n.includes('插件')) || '已就绪', action: checks.presets ? null : 'plugins' },
          { ok: !!checks.routerSession, title: '③ Router 会话（sun-router 预设）', desc: checks.routerSession ? `已就绪：${checks.routerSession.slice(0, 28)}…` : (checks.notes.find(n => n.includes('Router 会话')) || '不存在'), action: checks.presets && !checks.routerSession ? 'create-router' : null },
        ]
        return h('div', null, [
          h('p', { key: 'h', style: { fontWeight: 600, fontSize: 14, margin: '0 0 12px' } }, '初始化检查'),
          ...rows.map(r => h('div', { key: r.title, style: { ...cardStyle(r.ok ? '#57b26a' : '#e8a24d'), alignItems: 'flex-start', marginBottom: 8 } }, [
            h('span', { key: 'dot', style: { width: 10, height: 10, borderRadius: 5, background: r.ok ? '#57b26a' : '#e8a24d', display: 'inline-block', marginTop: 4 } }),
            h('div', { key: 'b', style: { flex: 1 } }, [
              h('div', { key: 't', style: { fontWeight: 600, fontSize: 13 } }, (r.ok ? '✓ ' : '✗ ') + r.title),
              h('div', { key: 'd', style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, r.desc),
            ]),
            r.action === 'plugins' ? h('button', { key: 'a', onClick: () => { try { hostCtx.layout.selectPanel('plugins') } catch (e) { D.errors.push(String(e)) } }, style: btnStyle }, '打开插件面板') : null,
            r.action === 'create-router' ? h('button', { key: 'a', onClick: () => createRouterAndInit(checks, onRetry), style: btnStyle }, '创建 Router 会话') : null,
          ])),
          h('button', { key: 'retry', onClick: onRetry, style: { ...btnStyle, marginTop: 10 } }, '↻ 重新检查'),
        ])
      }

      // 四条生产预设：一键预填表单（新机器启用的最后一公里）
      const SCHEDULE_TEMPLATES = [
        { label: '晨报 08:45', title: 'Sun 晨间简报', cron: '45 8 * * 1-5', prompt: '【定时 · 晨间简报】按 runbook §5 执行晨报：sun_read(triggers/tasks/runbook/memory) → 生成今日计划追加到 40-Journal/当日.md 晨报小节 → 预建/更新任务笔记（sun_vault_meta 流转状态）→ sun_notify(ask) 推送摘要请我确认。触发队列里 sys-onboarding-guide 类待办按 runbook §6 过滤。自检兜底：若 90-Meta/system/state.json 的 routerSession/vault 字段与本会话环境不符 → sun_vault_write(overwrite) 修正。' },
        { label: '日报 18:30', title: 'Sun 日报', cron: '30 18 * * 1-5', prompt: '【定时 · 日报】按 runbook §7 执行日报：sun_read(tasks/journal/note full) 汇总当日任务 → 日报追加到 40-Journal/当日.md（今日完成/未完成与原因/明日建议，保持 status=draft）→ sun_notify(ask) 请求审核。' },
        { label: 'Watchdog 14/21 点', title: 'Sun Watchdog 巡检', cron: '0 14,21 * * 1-5', prompt: '【定时 · Watchdog 巡检】按 runbook §3 分级巡检，quiet by default——一切正常则不发任何通知。检查：①running 超 2h → urgent+重派建议 ②need-confirm 超 2h → urgent 重推 ③工作日缺晨报/日报小节 → 按 §5/§7 补跑 ④核对 90-Meta/system/state.json 的 routerSession/vault 字段，不符则修正。' },
        { label: '周复盘 周五 17:00', title: 'Sun 周复盘', cron: '0 17 * * 5', prompt: '【定时 · 周复盘】生成 90-Meta/reflections/当周.md（frontmatter: type reflection/status draft/week/本地时间戳）：§本周概览含派发预算执行 §做得好/不好各≤3 §runbook 修订建议 diff §下周关注含轮换触发线检视 → 周报以「## 周复盘」追加 Journal（status=draft）→ sun_notify(ask) 请求审核，人审后 diff 生效。' },
      ]

      // ===== 定时任务区：列表 + 新建表单（target 自动绑当前 Router 会话，补 UI 无 session 选项的缺口）=====
      function ScheduleSection({ routerSession }) {
        const [sched, setSched] = React.useState({ loading: true, items: [], error: null })
        const [form, setForm] = React.useState({ title: '', cron: '0 9 * * 1-5', prompt: '', busy: false, msg: null })
        const loadSched = React.useCallback(() => {
          setSched(s => ({ ...s, loading: true, error: null }))
          gw('schedule/list', {}).then(v => setSched({ loading: false, items: v?.items ?? [], error: null }))
            .catch(e => setSched(s => ({ ...s, loading: false, error: String(e.message || e) })))
        }, [])
        React.useEffect(() => { loadSched() }, [loadSched])

        const submit = async () => {
          if (!form.title.trim() || !form.cron.trim() || !form.prompt.trim()) {
            setForm(f => ({ ...f, msg: '标题 / cron / 指令都不能为空' })); return
          }
          if (form.cron.trim().split(/\s+/).length !== 5) {
            setForm(f => ({ ...f, msg: 'cron 须为 5 段 Vixie 格式（分 时 日 月 周），如 0 9 * * 1-5' })); return
          }
          setForm(f => ({ ...f, busy: true, msg: null }))
          try {
            const v = await gw('schedule/create', {
              title: form.title.trim(), prompt: form.prompt.trim(),
              timing: { kind: 'cron', cron: { expression: form.cron.trim(), time_zone: 'Asia/Shanghai' } },
              target: { kind: 'session', sessionId: routerSession },
            })
            const sid = v?.id ?? '?'
            setForm({ title: '', cron: '0 9 * * 1-5', prompt: '', busy: false, msg: `✅ 已创建并绑定当前 Router 会话：${sid.slice(0, 24)}…` })
            loadSched()
          } catch (e) {
            setForm(f => ({ ...f, busy: false, msg: '创建失败：' + String(e.message || e).slice(0, 140) }))
          }
        }
        const rm = async (id) => {
          try { await gw('schedule/edit', { id, action: 'delete' }); loadSched() } catch (e) { D.errors.push('rm: ' + String(e)) }
        }

        const active = sched.items.filter(s => s.status === 'active' && s.kind === 'cron')
        const others = sched.items.filter(s => !(s.status === 'active' && s.kind === 'cron'))
        return h('div', { key: 'sched', style: { marginTop: 22 } }, [
          h('div', { key: 'h', style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 } }, [
            h('h2', { key: 't', style: { margin: 0, fontSize: 16 } }, '⏰ 定时任务'),
            h('span', { key: 'd', style: { fontSize: 11, opacity: 0.6 } }, 'target 自动绑定当前 Router 会话 · 改时间/启停去自动化任务面板'),
          ]),
          sched.loading ? h('p', { key: 'l', style: { opacity: 0.6, fontSize: 12 } }, '加载中…') : null,
          sched.error ? h('p', { key: 'e', style: { color: '#e8634d', fontSize: 12 } }, '加载失败：' + sched.error) : null,
          ...active.map(s => h('div', { key: s.id, style: cardStyle() }, [
            h('span', { key: 'dot', style: { width: 8, height: 8, borderRadius: 4, background: '#57b26a', display: 'inline-block' } }),
            h('span', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, s.title),
            h('span', { key: 'c', style: { fontSize: 11, opacity: 0.6, fontFamily: 'monospace' } }, s.expression ?? ''),
            s.target?.sessionId !== routerSession ? h('span', { key: 'drift', style: { fontSize: 11, color: '#e8a24d' }, title: `target=${s.target?.sessionId ?? '?'}` }, '✗ target 漂移') : null,
            h('button', { key: 'rm', onClick: () => rm(s.id), style: { ...btnStyle, marginLeft: 'auto', color: '#e8634d' } }, '删除'),
          ])),
          others.length > 0 ? h('details', { key: 'oth', style: { marginBottom: 6 } }, [
            h('summary', { style: { fontSize: 12, opacity: 0.6, cursor: 'pointer' } }, `历史/一次性（${others.length}）`),
            ...others.map(s => h('div', { key: s.id, style: { ...cardStyle(), opacity: 0.6 } }, [
              h('span', { key: 't', style: { fontSize: 12 } }, s.title),
              h('span', { key: 's', style: { fontSize: 11, opacity: 0.7 } }, s.status),
            ])),
          ]) : null,
          // 新建表单
          h('div', { key: 'form', style: { border: '1px dashed rgba(128,128,128,0.4)', borderRadius: 8, padding: '10px 12px', marginTop: 8 } }, [
            h('div', { key: 'ft', style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, '＋ 新增定时任务（cron，工作日建议 1-5）'),
            h('div', { key: 'tpl', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 } }, [
              h('span', { key: 'lbl', style: { fontSize: 11, opacity: 0.6 } }, '快速填入：'),
              ...SCHEDULE_TEMPLATES.map(t => h('button', { key: t.label, onClick: () => setForm(f => ({ ...f, title: t.title, cron: t.cron, prompt: t.prompt, msg: null })), style: btnStyle }, t.label)),
            ]),
            active.length === 0 ? h('p', { key: 'emptyhint', style: { fontSize: 11, opacity: 0.55, margin: '0 0 6px' } }, '还没有生效的定时任务——选一个模板填入，点「创建」即绑定本会话。') : null,
            h('input', { key: 'title', placeholder: '标题，如：Sun 生活提醒', value: form.title, onChange: e => setForm(f => ({ ...f, title: e.target.value })), style: { ...inputStyle, marginBottom: 6 } }),
            h('input', { key: 'cron', placeholder: 'cron：分 时 日 月 周（五段），时区固定 Asia/Shanghai', value: form.cron, onChange: e => setForm(f => ({ ...f, cron: e.target.value })), style: { ...inputStyle, marginBottom: 6, fontFamily: 'monospace' } }),
            h('textarea', { key: 'prompt', placeholder: '任务指令（薄引用写法：按 runbook §N 执行……）', value: form.prompt, onChange: e => setForm(f => ({ ...f, prompt: e.target.value })), rows: 3, style: { ...inputStyle, marginBottom: 6, resize: 'vertical' } }),
            h('div', { key: 'act', style: { display: 'flex', alignItems: 'center', gap: 10 } }, [
              h('button', { key: 'go', onClick: submit, disabled: form.busy, style: { ...btnStyle, opacity: form.busy ? 0.5 : 1 } }, form.busy ? '创建中…' : '创建'),
              form.msg ? h('span', { key: 'msg', style: { fontSize: 12, opacity: 0.8 } }, form.msg) : null,
            ]),
          ]),
        ])
      }

      // 新用户三步启用引导（主理鱼同款编号步骤卡；替代旧的一锅炖检查面板）
      function OnboardPanel({ checks, currentSessionId, onRetry }) {
        const steps = [
          { n: 1, ok: checks.presets, title: '确认依赖插件', desc: checks.presets ? '智能体协作 / 子智能体插件已启用' : '打开插件面板，启用 sun-space / 智能体协作相关插件后重启实例', action: checks.presets ? null : 'plugins' },
          { n: 2, ok: !!checks.routerSession, title: '一键初始化（Router 会话 + 知识库）', desc: checks.routerSession ? `已就绪：${checks.routerSession.slice(0, 28)}…` : `一键完成：以当前工作区目录${checks.currentCwd ? `（${checks.currentCwd}）` : ''}为知识库根 → 创建 Router 会话 → 写入 90-Meta 骨架 → 分桶自登记（全程零审批）`, action: checks.presets && !checks.routerSession ? 'create-router' : null },
          { n: 3, ok: checks.vault, title: '知识库就绪', desc: checks.vault ? `已就绪：${checks.vaultPath}` : (checks.routerSession ? '知识库骨架缺失 → 点下方按钮让 Router 补建' : '完成第②步后自动创建'), action: checks.presets && checks.routerSession && !checks.vault ? 'init-skeleton' : null },
        ]
        const allOk = steps.every(x => x.ok)
        return h('div', null, [
          h('h2', { key: 'h', style: { margin: '0 0 4px', fontSize: 18 } }, '三步启用 Sun'),
          h('p', { key: 'sub', style: { margin: '0 0 14px', fontSize: 12, opacity: 0.6 } }, '孙学空间与定时任务都挂在 Router 会话上——三步完成后，本页即变为日常入口。'),
          ...steps.map(st => h('div', { key: st.n, style: { ...cardStyle(st.ok ? '#57b26a' : 'rgba(128,128,128,0.35)'), alignItems: 'flex-start', marginBottom: 10, padding: '10px 14px' } }, [
            h('span', { key: 'n', style: { width: 22, height: 22, borderRadius: 11, flexShrink: 0, marginTop: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: st.ok ? '#57b26a' : 'rgba(128,128,128,0.25)', color: st.ok ? '#fff' : 'inherit' } }, st.ok ? '✓' : String(st.n)),
            h('div', { key: 'b', style: { flex: 1 } }, [
              h('div', { key: 't', style: { fontWeight: 600, fontSize: 13 } }, st.title),
              h('div', { key: 'd', style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6, marginTop: 2 } }, st.desc),
            ]),
            st.action === 'plugins' ? h('button', { key: 'a', onClick: () => { try { hostCtx.layout.selectPanel('plugins') } catch (e) { D.errors.push(String(e)) } }, style: btnStyle }, '打开插件面板') : null,
            st.action === 'create-router' ? h('button', { key: 'a', onClick: () => createRouterAndInit(checks, onRetry), style: btnStyle }, '一键初始化') : null,
            st.action === 'init-skeleton' ? h('button', { key: 'a', onClick: () => initSkeletonOnRouter(checks.routerSession, onRetry), style: btnStyle }, '补建知识库骨架') : null,

          ])),
          allOk ? h('p', { key: 'done', style: { color: '#57b26a', fontSize: 13 } }, '✓ 全部就绪——到「定时任务」用模板创建晨报等四条生产任务，即可开始使用。') : null,
          h('button', { key: 'retry', onClick: onRetry, style: { ...btnStyle, marginTop: 10 } }, '↻ 重新检查'),
        ])
      }

      function Workbench(props) {
        // conversation.view 的 inject(sessionId) 捕获当前会话；props 兜底
        const sessionId = props?.sessionId ?? D.currentSessionId ?? null
        const [init, setInit] = React.useState({ checking: true, checks: null })
        const [tab, setTab] = React.useState('overview')
        const runChecks = React.useCallback(() => {
          setInit({ checking: true, checks: null })
          runInitChecks(sessionId).then(checks => setInit({ checking: false, checks }))
        }, [sessionId])
        React.useEffect(() => { runChecks() }, [runChecks])
        const routerSession = init.checks?.routerSession ?? null
        const vault = init.checks?.vaultPath ?? null
        const isRouterView = !!(routerSession && sessionId && routerSession === sessionId)
        const allReady = !!(init.checks && init.checks.vault && init.checks.presets && routerSession)
        const aliveRef = React.useRef(true)
        React.useEffect(() => () => { aliveRef.current = false }, [])
        const [state, setState] = React.useState({ loading: true, tasks: [], error: null })
        const reload = React.useCallback(() => {
          setState(s => ({ ...s, loading: true, error: null }))
          loadTasks(routerSession, vault)
            .then(tasks => setState({ loading: false, tasks, error: null }))
            .catch(e => setState({ loading: false, tasks: [], error: String(e.message || e) }))
        }, [routerSession, vault])
        React.useEffect(() => { reload() }, [reload])

        const by = s => state.tasks.filter(t => t.status === s)
        const counters = [
          ['未派发', by('proposed').length, STATUS_META.proposed.color],
          ['进行中', by('running').length, STATUS_META.running.color],
          ['等你确认', by('need-confirm').length, STATUS_META['need-confirm'].color],
          ['已完成', by('done').length, STATUS_META.done.color],
        ]
        const order = { 'need-confirm': 0, running: 1, proposed: 2, blocked: 3, done: 4, dropped: 5 }
        const tasks = [...state.tasks].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
        const anyRunning = by('running').length > 0

        const openTaskSession = (t) => {
          const target = t.session || routerSession
          if (!target) { D.errors.push('openTaskSession: 无目标会话'); return }
          // 隐式契约（勿破坏）：跳转会卸载会话视图 → aliveRef 置 false → 重试自停；
          // 若未来挂载结构改为"跳转不卸载"，这里的 12×800ms 重试会变成劫持导航十秒。
          let attempts = 0
          const tryOpen = () => {
            if (!aliveRef.current) return
            if (attempts >= 12) return
            attempts++
            try { hostCtx.uiWorkspace.openSession(target) } catch (e) { D.errors.push('openSession: ' + String(e)) }
            setTimeout(tryOpen, 800)
          }
          tryOpen()
        }
        const openSchedules = () => { try { hostCtx.layout.selectPanel('schedules') } catch (e) { D.errors.push('openSchedules: ' + String(e)) } }

        // ===== 降级态：非 Router 会话 =====
        if (init.checks && routerSession && !isRouterView) {
          return h('div', { style: { padding: '20px 30px', maxWidth: 960 }, 'data-wb-rev': WB_REV }, [
            h(SunErrorBoundary, { key: 'eb' }, [
              h('div', { key: 'g', style: cardStyle('#e8a24d') }, [
                h(SunIcon, { key: 'i', size: 20 }),
                h('div', { key: 'b', style: { flex: 1, fontSize: 13, lineHeight: 1.7 } }, [
                  h('div', { key: 't', style: { fontWeight: 600 } }, '本会话不是当前 Router 会话'),
                  h('div', { key: 'd', style: { opacity: 0.7, fontSize: 12 } }, `孙学空间在 Router 会话上（当前：${routerSession.slice(0, 28)}…）。派活树、定时任务与初始化检查都在那边。`),
                ]),
                h('button', { key: 'go', onClick: () => { try { hostCtx.uiWorkspace.openSession(routerSession) } catch (e) { D.errors.push(String(e)) } }, style: btnStyle }, '打开 Router 会话'),
              ]),
            ]),
          ])
        }

        // 未就绪 → 三步启用引导；检查中 → 占位
        if (init.checking) {
          return h('div', { style: { padding: '20px 30px', maxWidth: 960 }, 'data-wb-rev': WB_REV }, [
            h('p', { key: 'w', style: { opacity: 0.6, fontSize: 13 } }, '初始化检查中…'),
          ])
        }
        if (init.checks && !allReady) {
          return h('div', { style: { padding: '20px 30px', maxWidth: 960 }, 'data-wb-rev': WB_REV }, [
            h(SunErrorBoundary, { key: 'eb' }, h(OnboardPanel, { checks: init.checks, currentSessionId: sessionId, onRetry: runChecks })),
          ])
        }
        return h('div', { style: { padding: '20px 30px', maxWidth: 960 }, 'data-wb-rev': WB_REV }, [
          h(SunErrorBoundary, { key: 'eb' }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } }, [
            h(SunIcon, { key: 'i', size: 22 }),
            h('h1', { key: 't', style: { margin: 0, fontSize: 20 } }, '孙学空间'),
            h('button', { key: 'r', onClick: () => { reload(); runChecks() }, style: { marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' } }, state.loading ? '刷新中…' : '刷新'),
          ]),
          // 初始化面板：三项检查任一未就绪时出现（含无 Router 会话的场景）
          h('div', { key: 'tabs', style: { display: 'flex', gap: 3, marginBottom: 16, background: 'rgba(128,128,128,0.12)', borderRadius: 8, padding: 3 } }, [
            ['overview', '总览'], ['schedules', '定时任务'], ['setup', '设置'],
          ].map(([id, label]) => h('button', { key: id, onClick: () => setTab(id), style: { flex: 1, border: 'none', cursor: 'pointer', fontSize: 13, padding: '6px 0', borderRadius: 6, color: 'inherit', background: tab === id ? 'rgba(128,128,128,0.28)' : 'transparent', opacity: tab === id ? 1 : 0.6, transition: 'background 0.15s' } }, label))),
          h('div', { key: 'vp', style: { fontSize: 12, opacity: 0.65, marginBottom: 12 } }, `📚 识别到的知识库：${vault ?? '（未定位——完成下方引导后自动登记）'}`),
          h('div', { key: 'cnt', style: { display: 'flex', gap: 18, marginBottom: 16 } },
            counters.map(([label, n, color]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' } }),
              h('span', { key: 'l', style: { fontSize: 13 } }, `${label} ${n}`),
            ]))),
          state.error && h('p', { key: 'err', style: { color: '#e8634d', fontSize: 13 } }, '加载失败：' + state.error),

          // ===== 派活树（仅 Router 视图）=====
          tab === 'overview' && h('div', { key: 'root', title: '点击打开 Router 会话', onClick: () => { try { hostCtx.uiWorkspace.openSession(routerSession) } catch (e) { D.errors.push(String(e)) } }, style: {
            display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            border: anyRunning ? '1px solid rgba(87,178,106,0.55)' : '1px solid rgba(128,128,128,0.3)',
            background: anyRunning ? 'rgba(87,178,106,0.10)' : 'transparent',
            borderRadius: 10, padding: '8px 14px',
          } }, [
            h(SunIcon, { key: 'av', size: 24 }),
            h('div', { key: 'n', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
              h('span', { key: 'a', style: { fontWeight: 600, fontSize: 14 } }, 'Sun Router'),
              h('span', { key: 'b', style: { fontSize: 11, opacity: 0.65 } }, '只分派 · sun-router 预设 · 本会话'),
            ]),
            h('span', { key: 'st', style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 } }, [
              h('span', { key: 'dot', style: { width: 8, height: 8, borderRadius: 4, background: anyRunning ? '#57b26a' : '#9e9e9e', display: 'inline-block' } }),
              anyRunning ? '干活中' : '待命',
            ]),
          ]),
          tab === 'overview' && tasks.length > 0 && h('div', { key: 'trunk', style: { width: 2, height: 14, background: 'rgba(128,128,128,0.35)', marginLeft: 14 } }),
          tab === 'overview' && tasks.map(t => h('div', { key: t.id, style: { position: 'relative', paddingLeft: 20, paddingBottom: 8 } }, [
            h('div', { key: 'elbow', style: { position: 'absolute', left: 13, top: -8, width: 8, height: 30, borderLeft: '2px solid rgba(128,128,128,0.35)', borderBottom: '2px solid rgba(128,128,128,0.35)', borderTop: '2px solid rgba(128,128,128,0.35)', borderTopLeftRadius: 6 } }),
            h('div', { key: 'card', title: '点击打开对应会话', onClick: () => openTaskSession(t), style: {
              cursor: 'pointer', ...cardStyle(t.status === 'need-confirm' ? STATUS_META['need-confirm'].color : undefined),
              borderLeftColor: STATUS_META[t.status]?.color || '#999',
              background: t.status === 'running' ? 'rgba(77,157,232,0.08)' : 'transparent',
            } }, [
              h('span', { key: 'dot', style: { width: 8, height: 8, borderRadius: 4, background: STATUS_META[t.status]?.color || '#999', display: 'inline-block' } }),
              h('span', { key: 'id', style: { fontFamily: 'monospace', fontSize: 12 } }, t.id),
              h('span', { key: 's', style: { fontSize: 12, color: STATUS_META[t.status]?.color } }, STATUS_META[t.status]?.label || t.status),
              h('span', { key: 'src', style: { fontSize: 11, opacity: 0.55 } }, t.source),
              t.journal ? h('span', { key: 'j', style: { fontSize: 11, opacity: 0.45, fontFamily: 'monospace' } }, t.journal) : null,
              (t.artifacts && t.artifacts !== '[]' && t.artifacts !== '') ? h('span', { key: 'ar', title: String(t.artifacts), style: { fontSize: 11, opacity: 0.55 } }, '📦') : null,
              t.status === 'need-confirm' ? h('span', { key: 'wait', style: { fontSize: 12, color: STATUS_META['need-confirm'].color, marginLeft: 'auto' } }, '等你决策 →') : null,
            ]),
          ])),
          tab === 'overview' && tasks.length === 0 && !state.loading && h('p', { key: 'empty', style: { opacity: 0.5, fontSize: 13, paddingLeft: 20 } }, '暂无任务——晨报生成后这里会长出派活树'),

          // ===== 定时任务（列表 + 新建表单，仅 Router 视图）=====
          tab === 'schedules' && routerSession ? h(ScheduleSection, { key: 'schedsec', routerSession }) : null,

          // ===== Journal 入口卡（仅 Router 视图）=====
          tab === 'overview' && h('div', { key: 'journal', title: 'Journal 在 Obsidian 中查看与编辑', style: {
            border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '12px 16px', marginTop: 18,
          } }, [
            h('div', { key: 't', style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '📓 今日 Journal'),
            h('div', { key: 'd', style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, `40-Journal/${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}.md —— Obsidian 打开 vault 即见`),
          ]),
          tab === 'setup' && h('div', { key: 'setup' }, h(InitPanel, { checks: init.checks, currentSessionId: sessionId, onRetry: runChecks })),
          ]),
        ])
      }

      return {
        inject: ['slots', 'uiWorkspace', 'layout'],
        apply(ctx) {
          D.phase = 'apply-entered'
          hostCtx = ctx
          try {
            // 工作台唯一载体：Router 会话上的 tab（原生"对话/轨迹"同款 conversation.view 槽）。
            // 侧栏入口已删（用户决策 2026-11-08）：引导方式 = README"打开 Router 会话 → 工作台 tab"。
            // 非 Router 会话上 tab 显示跳转引导卡；无 Router 会话时显示初始化面板。
            ctx.slots.inject('conversation.view', () => {
              D.tabRegistered = true
              return ctx.slots.register({
                name: 'conversation.view',
                id: PANEL_ID,
                order: 40,
                label: () => '孙学空间',
                inject: (sessionId) => { D.currentSessionId = sessionId; return {} },
              }, Workbench)
            })
            D.phase = 'apply-done'
          } catch (e) {
            D.errors.push('apply: ' + String(e && e.stack || e))
            D.phase = 'apply-throw'
            throw e
          } finally {
            try { sessionStorage.setItem('sunSpaceDebug', JSON.stringify(D)) } catch {}
          }
        },
      }
    } catch (e) {
      D.phase = 'factory-throw'
      D.errors.push('factory: ' + String(e && e.stack || e))
      try { sessionStorage.setItem('sunSpaceDebug', JSON.stringify(D)) } catch {}
      throw e
    }
  },
})
