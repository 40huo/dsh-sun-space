/**
 * sun-space client 插件（v9：工作台精简版）。
 * 任务派活树 + 直达子会话；定时任务跳转 DSH 原生"自动化任务"面板（零重复实现）。
 * 数据通道：workspaceFiles 既有 remote（vault 直读）——零新增宿主代码。
 */
window.__ModuleLoader__.load({
  id: 'sun-space/client',
  factory(require) {
    const D = { phase: 'factory-entered', errors: [] }
    try {
      window.__sunSpaceDebug = D
      const React = require('react')
      const h = React.createElement
      D.phase = 'react-ok'
      let hostCtx = null

      const PANEL_ID = 'sun-space'
      const VAULT = '/Users/40huo/Workspace/sun-vault'
      const ROUTER_SESSION = 'session-f9ab8ca6-40bc-40ed-acb9-c52a620f98d6'
      const SCOPE_SESSION = ROUTER_SESSION

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
        for (const line of m[1].split(/\r?\n/)) {
          const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
          if (kv) out[kv[1]] = kv[2].trim()
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

      const readVaultFile = (path, limit) => gateway('workspaceFiles/read', {
        workspaceFileScopeId: SCOPE_SESSION, path, range: { limit },
      }).then(v => v.text || '')

      // ===== 初始化检查（用户要求：①插件依赖②知识库目录+初始化③Router 会话落在知识库目录）=====
      async function runInitChecks() {
        const c = { vault: false, presets: false, routerSession: null, notes: [] }
        // ① 知识库：读 runbook 探测
        try { await readVaultFile(`${VAULT}/90-Meta/runbook.md`, 10); c.vault = true } catch {
          c.notes.push(`知识库未就绪（当前配置路径 ${VAULT}）：① 用 Obsidian 打开/创建该目录 ② 完成 90-Meta 骨架初始化（可让任意 Router 会话执行"初始化知识库"指令） ③ 重启实例后重新检查`)
        }
        // ② 依赖插件：预设 roster 健康 = 智能体协作链路可用（missing/broken → 插件面板手动开启）
        try {
          const v = await gateway('agentPresets/list', {})
          const presets = v?.presets ?? []
          const r = presets.find(p => p.id === 'sun-router')
          const w = presets.find(p => p.id === 'sun-worker')
          c.presets = !!(r && !r.broken && w && !w.broken)
          if (!c.presets) c.notes.push('Sun 预设缺失或损坏 → 打开插件面板，手动开启 sun-space / 智能体协作相关插件后重启实例')
        } catch {
          c.presets = false
          c.notes.push('预设服务不可达 → 确认 Harness 实例在线、插件已启用')
        }
        // ③ Router 会话：默认创建在知识库目录下
        try {
          const v = await gateway('session/list', { _request: {} })
          const list = v?.sessions ?? v?.items ?? v
          const arr = Array.isArray(list) ? list : Object.values(list || {})
          const mine = arr.find(s => s.projections?.values?.agentPreset === 'sun-router')
          c.routerSession = mine ? mine.sessionId : null
          if (!c.routerSession) c.notes.push('Router 会话不存在 → 点下方「创建 Router 会话」，将创建在知识库目录（cwd=' + VAULT + '，sun-router 预设）')
        } catch {
          c.notes.push('会话列表不可达 → 重试或检查实例')
        }
        return c
      }

      async function createRouterSession() {
        // Router 会话默认创建在知识库目录下
        return gateway('session/create', { request: { cwd: VAULT, agentPreset: 'sun-router' } })
      }

      function InitPanel({ checks, onRetry }) {
        const rows = [
          { ok: checks.vault, title: '① 知识库（vault）', desc: checks.notes.find(n => n.includes('知识库')) || `已就绪：${VAULT}` },
          { ok: checks.presets, title: '② 依赖插件（智能体协作 / 子智能体）', desc: checks.notes.find(n => n.includes('预设') || n.includes('插件')) || '已就绪', action: checks.presets ? null : 'plugins' },
          { ok: !!checks.routerSession, title: '③ Router 会话（知识库目录）', desc: checks.routerSession ? `已就绪：${checks.routerSession.slice(0, 28)}…` : (checks.notes.find(n => n.includes('Router 会话')) || '不存在'), action: checks.presets && !checks.routerSession ? 'create-router' : null },
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
                if (sid) hostCtx.uiWorkspace.openSession(sid)
              } catch (e) { D.errors.push(String(e)) }
            }, style: btnStyle }, '创建 Router 会话') : null,
          ])),
          h('button', { key: 'retry', onClick: onRetry, style: { ...btnStyle, marginTop: 10 } }, '↻ 重新检查'),
        ])
      }

      async function loadTasks() {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        let journalText = ''
        try { journalText = await readVaultFile(`${VAULT}/40-Journal/${today}.md`, 200) } catch {}
        const ids = [...new Set([...journalText.matchAll(/\[\[(T-\d{8}-\d{2})\]\]/g)].map(m => m[1]))]
        const tasks = []
        for (const id of ids.slice(0, 20)) {
          try {
            const fm = parseFrontmatter(await readVaultFile(`${VAULT}/50-Tasks/${id}.md`, 24))
            if (fm.id) tasks.push({
              id: fm.id, status: fm.status || 'proposed', source: fm.source || '',
              priority: fm.priority || 'medium', journal: fm.journal || '', session: fm.session || '',
              artifacts: fm.artifacts || [],
            })
          } catch {}
        }
        return tasks
      }

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

      class SunErrorBoundary extends React.Component {
        constructor(props) { super(props); this.state = { err: null } }
        static getDerivedStateFromError(e) { return { err: e } }
        render() {
          return this.state.err
            ? h('pre', { style: { color: '#e8634d', fontSize: 12, padding: 12, whiteSpace: 'pre-wrap' } }, 'WB-ERROR: ' + String(this.state.err?.stack || this.state.err).slice(0, 600))
            : this.props.children
        }
      }

      function Workbench() {
        const [init, setInit] = React.useState({ checking: true, checks: null })
        const runChecks = React.useCallback(() => {
          setInit({ checking: true, checks: null })
          runInitChecks().then(checks => setInit({ checking: false, checks }))
        }, [])
        React.useEffect(() => { runChecks() }, [runChecks])
        const allReady = !!(init.checks && init.checks.vault && init.checks.presets)
        const aliveRef = React.useRef(true)
        React.useEffect(() => () => { aliveRef.current = false }, [])
        const [state, setState] = React.useState({ loading: true, tasks: [], error: null })
        const reload = React.useCallback(() => {
          setState(s => ({ ...s, loading: true, error: null }))
          loadTasks()
            .then(tasks => setState({ loading: false, tasks, error: null }))
            .catch(e => setState({ loading: false, tasks: [], error: String(e.message || e) }))
        }, [])
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
          const target = t.session || ROUTER_SESSION
          let attempts = 0
          const tryOpen = () => {
            if (!aliveRef.current) return // 已跳走（工作台卸载），停止重试
            if (attempts >= 12) return
            attempts++
            try { hostCtx.uiWorkspace.openSession(target) } catch (e) { D.errors.push('openSession: ' + String(e)) }
            setTimeout(tryOpen, 800)
          }
          tryOpen()
        }
        const openSchedules = () => { try { hostCtx.layout.selectPanel('schedules') } catch (e) { D.errors.push('openSchedules: ' + String(e)) } }

        return h('div', { style: { padding: '20px 30px', maxWidth: 960 } }, [
          h(SunErrorBoundary, { key: 'eb' }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } }, [
            h(SunIcon, { key: 'i', size: 22 }),
            h('h1', { key: 't', style: { margin: 0, fontSize: 20 } }, 'Sun 工作台'),
            h('button', { key: 'r', onClick: reload, style: { marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' } }, state.loading ? '刷新中…' : '刷新'),
          ]),
          !allReady && h('div', { key: 'init', style: { marginBottom: 16 } }, [
            init.checking ? h('p', { key: 'w', style: { opacity: 0.6, fontSize: 13 } }, '初始化检查中…') : h(InitPanel, { key: 'ip', checks: init.checks, onRetry: runChecks }),
          ]),
          allReady && h('div', { key: 'cnt', style: { display: 'flex', gap: 18, marginBottom: 16 } },
            counters.map(([label, n, color]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' } }),
              h('span', { key: 'l', style: { fontSize: 13 } }, `${label} ${n}`),
            ]))),
          state.error && h('p', { key: 'err', style: { color: '#e8634d', fontSize: 13 } }, '加载失败：' + state.error),

          // ===== 派活树 =====
          h('div', { key: 'root', title: '点击打开 Router 会话', onClick: () => { try { hostCtx.uiWorkspace.openSession(ROUTER_SESSION) } catch (e) { D.errors.push(String(e)) } }, style: {
            display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            border: anyRunning ? '1px solid rgba(87,178,106,0.55)' : '1px solid rgba(128,128,128,0.3)',
            background: anyRunning ? 'rgba(87,178,106,0.10)' : 'transparent',
            borderRadius: 10, padding: '8px 14px',
          } }, [
            h(SunIcon, { key: 'av', size: 24 }),
            h('div', { key: 'n', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
              h('span', { key: 'a', style: { fontWeight: 600, fontSize: 14 } }, 'Sun Router'),
              h('span', { key: 'b', style: { fontSize: 11, opacity: 0.65 } }, '只分派 · sun-router 预设'),
            ]),
            h('span', { key: 'st', style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 } }, [
              h('span', { key: 'dot', style: { width: 8, height: 8, borderRadius: 4, background: anyRunning ? '#57b26a' : '#9e9e9e', display: 'inline-block' } }),
              anyRunning ? '干活中' : '待命',
            ]),
          ]),
          tasks.length > 0 && h('div', { key: 'trunk', style: { width: 2, height: 14, background: 'rgba(128,128,128,0.35)', marginLeft: 14 } }),
          ...tasks.map(t => h('div', { key: t.id, style: { position: 'relative', paddingLeft: 20, paddingBottom: 8 } }, [
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
          tasks.length === 0 && !state.loading && h('p', { key: 'empty', style: { opacity: 0.5, fontSize: 13, paddingLeft: 20 } }, '暂无任务——晨报生成后这里会长出派活树'),

          // ===== 入口卡片 =====
          h('div', { key: 'entries', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, marginTop: 18 } }, [
            h('div', { key: 'sched', onClick: openSchedules, title: '打开自动化任务面板', style: {
              border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
            } }, [
              h('div', { key: 't', style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '⏰ 定时任务'),
              h('div', { key: 'd', style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, '晨报 08:45 · 日报 18:30（工作日）——管理、启停与新增在自动化任务面板'),
            ]),
            h('div', { key: 'journal', title: 'Journal 在 Obsidian 中查看与编辑', style: {
              border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10, padding: '12px 16px',
            } }, [
              h('div', { key: 't', style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '📓 今日 Journal'),
              h('div', { key: 'd', style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, `40-Journal/${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}.md —— Obsidian 打开 vault 即见`),
            ]),
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
            ctx.slots.inject('sidebar.panellist', () => {
              D.panellistRegistered = true
              return ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => 'Sun 工作台' }, SunIcon)
            })
            ctx.slots.inject('main', () => {
              D.mainRegistered = true
              return ctx.slots.register({ name: 'main', key: PANEL_ID }, Workbench)
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
