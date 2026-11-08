/**
 * sun-space client 插件（v11：工作台 = Router 会话上的 tab）。
 * 载体：conversation.view 槽（原生"对话/轨迹/上下文/编队"同款挂点，主理鱼同款模式）——
 * 侧栏入口已删（用户决策 2026-11-08：唯一引导方式是 README 说明"打开 Router 会话 → 工作台 tab"）。
 * 三态渲染：当前会话 = state.json 解析的 Router 会话 → 完整工作台（含新增定时任务表单，
 * target 自动绑当前会话）；非 Router 会话 → 跳转引导卡；无 Router 会话 → 初始化面板。
 */
window.__ModuleLoader__.load({
  id: 'sun-space/client',
  factory(require) {
    const D = { phase: 'factory-entered', errors: [], currentSessionId: null }
    try {
      window.__sunSpaceDebug = D
      const React = require('react')
      const h = React.createElement
      D.phase = 'react-ok'
      let hostCtx = null

      const PANEL_ID = 'sun-space'
      const VAULT = '/Users/40huo/Workspace/sun-vault'
      // 架构 §4.1 不变量：呈现层不得持有会话 id 常量（Router 会话会周期轮换）。
      // 当前会话解析链：session/list（sun-router 会话）→ 90-Meta/system/state.json 裁决 → updatedAt 最新兜底。
      // state.json 写回：① 创建会话后经 session/prompt 引导自登记；② 晨报自检发现不一致自动修正（轮换自愈）。
      const WB_REV = 'v11' // 根节点 data-wb-rev 版本标记：判别浏览器是否吃到旧 client.js（immutable 缓存坑，HANDOFF 踩坑 1）

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

      // ===== Router 会话解析（架构 §4.1 不变量：会话会轮换，呈现层只认 vault state.json + 动态发现）=====
      async function resolveRouterSession() {
        const v = await gw('session/list', {})
        const items = Array.isArray(v?.items) ? v.items : Object.values(v?.items ?? v ?? {})
        // 注意：cwd 是"工作区分桶路径"（实例 boot cwd），不是 vault——过滤只看预设（踩坑 5 延伸）
        const candidates = items.filter(s => s?.projections?.values?.agentPreset === 'sun-router')
        if (!candidates.length) return null
        // state.json 裁决：指向列表内现存会话者胜（轮换后旧会话仍在列表里，state 是唯一事实源）
        for (const s of candidates) {
          try {
            const raw = await readVaultFile(s.sessionId, `${VAULT}/90-Meta/system/state.json`, 4)
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
        const c = { vault: false, presets: false, routerSession: null, notes: [] }
        // ① 知识库：读 runbook 探测
        if (currentSessionId) {
          try { await readVaultFile(currentSessionId, `${VAULT}/90-Meta/runbook.md`, 10); c.vault = true } catch {
            c.notes.push(`知识库未就绪（当前配置路径 ${VAULT}）：① 用 Obsidian 打开/创建该目录 ② 完成 90-Meta 骨架初始化（可让任意 Router 会话执行"初始化知识库"指令） ③ 重启实例后重新检查`)
          }
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
        // ③ Router 会话：动态解析（state.json → 最近活跃）
        try {
          c.routerSession = await resolveRouterSession()
          if (!c.routerSession) c.notes.push('Router 会话不存在 → 点下方「创建 Router 会话」（sun-router 预设，随当前工作区），创建后自动登记 state.json')
        } catch {
          c.notes.push('会话列表不可达 → 重试或检查实例')
        }
        return c
      }

      async function createRouterSession() {
        // 不传 cwd：会话随当前工作区分桶（与生产会话同桶）；cwd=vault 反而会分裂出独立桶（踩坑 5）
        return gw('session/create', { agentPreset: 'sun-router' })
      }

      // 创建后引导新会话自登记 state.json（workspaceFiles 无写通道，sun_vault_write 是唯一写路径）
      async function bootstrapRouterSession(sid) {
        const text = '初始化自登记：用 sun_vault_write（mode=overwrite）写 90-Meta/system/state.json，内容 ' +
          JSON.stringify({ routerSession: sid, updatedAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) }) +
          '；完成后一句话报告。'
        try {
          await gw('session/prompt', {
            requestId: 'sun-boot-' + Date.now(),
            sessionId: sid,
            mode: 'queue',
            content: [{ type: 'text', text }],
            clientTimeZone: 'Asia/Shanghai',
          })
          return true
        } catch (e) { D.errors.push('bootstrapRouterSession: ' + String(e)); return false }
      }

      async function loadTasks(routerSession) {
        if (!routerSession) return []
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        let journalText = ''
        try { journalText = await readVaultFile(routerSession, `${VAULT}/40-Journal/${today}.md`, 200) } catch {}
        const ids = [...new Set([...journalText.matchAll(/\[\[(T-\d{8}-\d{2})\]\]/g)].map(m => m[1]))]
        const tasks = []
        for (const id of ids.slice(0, 20)) {
          try {
            const fm = parseFrontmatter(await readVaultFile(routerSession, `${VAULT}/50-Tasks/${id}.md`, 24))
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

      function InitPanel({ checks, currentSessionId, onRetry }) {
        const rows = [
          { ok: checks.vault, title: '① 知识库（vault）', desc: checks.notes.find(n => n.includes('知识库')) || `已就绪：${VAULT}` },
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
            r.action === 'create-router' ? h('button', { key: 'a', onClick: async () => {
              try {
                const v = await createRouterSession()
                const sid = typeof v === 'string' ? v : (v?.sessionId ?? v)
                if (sid) {
                  await bootstrapRouterSession(sid) // 自登记 state.json（失败不阻断——下次检查由最近活跃兜底）
                  try { hostCtx.uiWorkspace.openSession(sid) } catch (e) { D.errors.push('openSession: ' + String(e)) }
                  onRetry() // 新会话的 tab 即完整工作台（state.json 已指向它）
                }
              } catch (e) { D.errors.push(String(e)) }
            }, style: btnStyle }, '创建 Router 会话') : null,
          ])),
          h('button', { key: 'retry', onClick: onRetry, style: { ...btnStyle, marginTop: 10 } }, '↻ 重新检查'),
        ])
      }

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

      function Workbench(props) {
        // conversation.view 的 inject(sessionId) 捕获当前会话；props 兜底
        const sessionId = props?.sessionId ?? D.currentSessionId ?? null
        const [init, setInit] = React.useState({ checking: true, checks: null })
        const runChecks = React.useCallback(() => {
          setInit({ checking: true, checks: null })
          runInitChecks(sessionId).then(checks => setInit({ checking: false, checks }))
        }, [sessionId])
        React.useEffect(() => { runChecks() }, [runChecks])
        const routerSession = init.checks?.routerSession ?? null
        const isRouterView = !!(routerSession && sessionId && routerSession === sessionId)
        const aliveRef = React.useRef(true)
        React.useEffect(() => () => { aliveRef.current = false }, [])
        const [state, setState] = React.useState({ loading: true, tasks: [], error: null })
        const reload = React.useCallback(() => {
          setState(s => ({ ...s, loading: true, error: null }))
          loadTasks(routerSession)
            .then(tasks => setState({ loading: false, tasks, error: null }))
            .catch(e => setState({ loading: false, tasks: [], error: String(e.message || e) }))
        }, [routerSession])
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
                  h('div', { key: 'd', style: { opacity: 0.7, fontSize: 12 } }, `Sun 工作台在 Router 会话上（当前：${routerSession.slice(0, 28)}…）。派活树、定时任务与初始化检查都在那边。`),
                ]),
                h('button', { key: 'go', onClick: () => { try { hostCtx.uiWorkspace.openSession(routerSession) } catch (e) { D.errors.push(String(e)) } }, style: btnStyle }, '打开 Router 会话'),
              ]),
            ]),
          ])
        }

        return h('div', { style: { padding: '20px 30px', maxWidth: 960 }, 'data-wb-rev': WB_REV }, [
          h(SunErrorBoundary, { key: 'eb' }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } }, [
            h(SunIcon, { key: 'i', size: 22 }),
            h('h1', { key: 't', style: { margin: 0, fontSize: 20 } }, 'Sun 工作台'),
            h('button', { key: 'r', onClick: () => { reload(); runChecks() }, style: { marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' } }, state.loading ? '刷新中…' : '刷新'),
          ]),
          // 初始化面板：三项检查任一未就绪时出现（含无 Router 会话的场景）
          init.checking ? h('p', { key: 'w', style: { opacity: 0.6, fontSize: 13 } }, '初始化检查中…') : null,
          !init.checking && init.checks && !(init.checks.vault && init.checks.presets && routerSession)
            ? h('div', { key: 'init', style: { marginBottom: 16 } }, h(InitPanel, { key: 'ip', checks: init.checks, currentSessionId: sessionId, onRetry: runChecks }))
            : null,
          !isRouterView && h('p', { key: 'wait', style: { opacity: 0.6, fontSize: 13 } }, '初始化完成后，这里会展示派活树与定时任务。'),
          isRouterView && h('div', { key: 'cnt', style: { display: 'flex', gap: 18, marginBottom: 16 } },
            counters.map(([label, n, color]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' } }),
              h('span', { key: 'l', style: { fontSize: 13 } }, `${label} ${n}`),
            ]))),
          state.error && h('p', { key: 'err', style: { color: '#e8634d', fontSize: 13 } }, '加载失败：' + state.error),

          // ===== 派活树（仅 Router 视图）=====
          isRouterView && h('div', { key: 'root', title: '点击打开 Router 会话', onClick: () => { try { hostCtx.uiWorkspace.openSession(routerSession) } catch (e) { D.errors.push(String(e)) } }, style: {
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
          isRouterView && tasks.length > 0 && h('div', { key: 'trunk', style: { width: 2, height: 14, background: 'rgba(128,128,128,0.35)', marginLeft: 14 } }),
          isRouterView && tasks.map(t => h('div', { key: t.id, style: { position: 'relative', paddingLeft: 20, paddingBottom: 8 } }, [
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
          isRouterView && tasks.length === 0 && !state.loading && h('p', { key: 'empty', style: { opacity: 0.5, fontSize: 13, paddingLeft: 20 } }, '暂无任务——晨报生成后这里会长出派活树'),

          // ===== 定时任务（列表 + 新建表单，仅 Router 视图）=====
          isRouterView && routerSession ? h(ScheduleSection, { key: 'schedsec', routerSession }) : null,

          // ===== Journal 入口卡（仅 Router 视图）=====
          isRouterView && h('div', { key: 'journal', title: 'Journal 在 Obsidian 中查看与编辑', style: {
            border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '12px 16px', marginTop: 18,
          } }, [
            h('div', { key: 't', style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '📓 今日 Journal'),
            h('div', { key: 'd', style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, `40-Journal/${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}.md —— Obsidian 打开 vault 即见`),
          ]),
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
                label: () => '工作台',
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
