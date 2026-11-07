/**
 * sun-space client 插件（v8：工作台 v3 多 Tab）。
 * Tab：任务（派活树）| 定时（DSH 原生 schedule 管理，代码零业务定时）| 今日（Journal）。
 * 数据通道：workspaceFiles 既有 remote（vault 直读）+ schedule 网关 API——零新增宿主代码。
 * 卡片点击直达对应子会话（task.session 裸 id，重试式）。
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
            })
          } catch {}
        }
        return tasks
      }

      async function loadSchedules() {
        const v = await gateway('schedule/list', { request: {} })
        return (v?.items ?? []).filter(it => (it.title || '').startsWith('Sun'))
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

      // ================= 任务 Tab：派活树 =================
      function TasksTab() {
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

        return h('div', null, [
          h('div', { key: 'cnt', style: { display: 'flex', gap: 18, marginBottom: 16 } },
            counters.map(([label, n, color]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' } }),
              h('span', { key: 'l', style: { fontSize: 13 } }, `${label} ${n}`),
            ]))),
          state.error && h('p', { key: 'err', style: { color: '#e8634d', fontSize: 13 } }, '加载失败：' + state.error),
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
            ]),
          ])),
          tasks.length === 0 && !state.loading && h('p', { key: 'empty', style: { opacity: 0.5, fontSize: 13 } }, '暂无任务——晨报生成后这里会长出派活树'),
        ])
      }

      // ================= 定时 Tab：DSH 原生 schedule 管理 =================
      const SCHEDULE_TEMPLATES = {
        '晨报': { title: 'Sun 晨间简报', expression: '45 8 * * 1-5', prompt: '【定时 · 晨间简报】按 runbook §5 执行晨报：sun_read(triggers/tasks/runbook/memory) → 生成今日计划追加到 40-Journal/当日.md 晨报小节 → 预建/更新任务笔记 → sun_notify(ask) 推送摘要请我确认。sys-onboarding-guide 类待办按 runbook §6 过滤。等待确认期间只做无副作用准备。' },
        '日报': { title: 'Sun 日报', expression: '30 18 * * 1-5', prompt: '【定时 · 日报】按 runbook §7 执行日报：sun_read(tasks/journal/note full) 汇总当日任务 → 日报追加到 40-Journal/当日.md（今日完成/未完成与原因/明日建议，保持 status=draft）→ sun_notify(ask) 请求审核。' },
        '周复盘': { title: 'Sun 周复盘', expression: '0 17 * * 5', prompt: '【定时 · 周复盘】汇总本周 Journal 与任务笔记：产出周报（完成了什么/模式观察/runbook 修订建议 diff）→ sun_notify(ask) 请求人审。' },
      }

      function ScheduleTab() {
        const [state, setState] = React.useState({ loading: true, items: [], error: null, busy: false })
        const reload = React.useCallback(() => {
          setState(s => ({ ...s, loading: true, error: null }))
          loadSchedules()
            .then(items => setState({ loading: false, items, error: null }))
            .catch(e => setState({ loading: false, items: [], error: String(e.message || e) }))
        }, [])
        React.useEffect(() => { reload() }, [reload])

        const createTemplate = async (key) => {
          setState(s => ({ ...s, busy: true }))
          try {
            const tpl = SCHEDULE_TEMPLATES[key]
            await gateway('schedule/create', { request: {
              title: tpl.title,
              prompt: tpl.prompt,
              timing: { kind: 'cron', cron: { expression: tpl.expression, time_zone: 'Asia/Shanghai' } },
              target: { kind: 'session', sessionId: ROUTER_SESSION },
            } })
            reload()
          } catch (e) { setState(s => ({ ...s, busy: false, error: String(e.message || e).slice(0, 160) })) }
        }
        const del = async (id) => {
          setState(s => ({ ...s, busy: true }))
          try {
            await gateway('schedule/edit', { request: { id, action: 'delete' } })
            reload()
          } catch (e) { setState(s => ({ ...s, busy: false, error: String(e.message || e).slice(0, 160) })) }
        }
        const runNow = async (id) => {
          setState(s => ({ ...s, busy: true }))
          try { await gateway('schedule/run', { request: { id } }); reload() } catch (e) { setState(s => ({ ...s, busy: false, error: String(e.message || e).slice(0, 160) })) }
        }

        const existing = new Set(state.items.map(i => i.title))
        return h('div', null, [
          h('p', { key: 'note', style: { margin: '0 0 12px', opacity: 0.65, fontSize: 12 } },
            '定时任务 = DSH 原生 schedule（自动化任务面板同步可见）· 目标会话：Sun Router · Asia/Shanghai'),
          state.error && h('p', { key: 'err', style: { color: '#e8634d', fontSize: 13 } }, state.error),
          state.loading && h('p', { key: 'ld', style: { opacity: 0.6 } }, '加载中…'),
          ...state.items.map(it => h('div', { key: it.id, style: { ...cardStyle(), justifyContent: 'space-between', marginBottom: 8 } }, [
            h('div', { key: 'l' }, [
              h('div', { key: 't', style: { fontWeight: 600, fontSize: 13 } }, it.title),
              h('div', { key: 'n', style: { fontSize: 11, opacity: 0.6 } }, `状态 ${it.status}${it.nextAt ? ' · 下次 ' + String(it.nextAt).slice(0, 16) : ''}`),
            ]),
            h('div', { key: 'ops', style: { display: 'flex', gap: 6 } }, [
              h('button', { key: 'run', onClick: () => runNow(it.id), disabled: state.busy, style: btnStyle }, '立即运行'),
              h('button', { key: 'del', onClick: () => del(it.id), disabled: state.busy, style: btnStyle }, '删除'),
            ]),
          ])),
          h('div', { key: 'tpl', style: { marginTop: 16 } }, [
            h('div', { key: 'tt', style: { fontSize: 12, opacity: 0.6, marginBottom: 8 } }, '一键创建（模板已含 prompt 与目标会话）'),
            h('div', { key: 'btns', style: { display: 'flex', gap: 8 } },
              Object.keys(SCHEDULE_TEMPLATES).map(key => h('button', {
                key, onClick: () => createTemplate(key), disabled: state.busy || existing.has(SCHEDULE_TEMPLATES[key].title),
                style: { ...btnStyle, opacity: existing.has(SCHEDULE_TEMPLATES[key].title) ? 0.4 : 1 },
              }, existing.has(SCHEDULE_TEMPLATES[key].title) ? SCHEDULE_TEMPLATES[key].title + ' ✓' : '+ ' + SCHEDULE_TEMPLATES[key].title))),
          ]),
        ])
      }

      // ================= 今日 Tab：Journal =================
      function TodayTab() {
        const [state, setState] = React.useState({ loading: true, text: '', error: null })
        React.useEffect(() => {
          const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
          readVaultFile(`${VAULT}/40-Journal/${today}.md`, 400)
            .then(text => setState({ loading: false, text, error: null }))
            .catch(e => setState({ loading: false, text: '', error: '今日尚无 Journal' }))
        }, [])
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        let fm = {}, sections = []
        if (state.text) {
          const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(state.text)
          if (fmMatch) for (const line of fmMatch[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2] }
          sections = [...state.text.matchAll(/^## (.+)$/gm)].map(m => m[1])
        }
        return h('div', null, [
          h('div', { key: 'chips', style: { display: 'flex', gap: 8, marginBottom: 14 } }, [
            h('span', { key: 'm', style: { ...btnStyle, cursor: 'default' } }, `晨报 ${fm.morning || '-'}`),
            h('span', { key: 's', style: { ...btnStyle, cursor: 'default' } }, `日报 ${fm.status || '-'}`),
            h('span', { key: 'u', style: { ...btnStyle, cursor: 'default' } }, `更新 ${String(fm.updated || '').slice(5, 16)}`),
          ]),
          h('div', { key: 'sec', style: { fontSize: 12, opacity: 0.7, marginBottom: 12 } }, '章节：' + (sections.join(' · ') || '（空）')),
          state.error && h('p', { style: { opacity: 0.5, fontSize: 13 } }, state.error),
          state.text && h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7, opacity: 0.85, maxHeight: 480, overflow: 'auto', border: '1px solid rgba(128,128,128,0.2)', borderRadius: 8, padding: 12 } }, state.text.slice(0, 4000)),
        ])
      }

      // ================= 主组件：Tab 容器 =================
      function Workbench() {
        const [tab, setTab] = React.useState('tasks')
        const TABS = [['tasks', '任务'], ['schedule', '定时'], ['today', '今日']]
        return h('div', { style: { padding: '20px 30px', maxWidth: 960 } }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } }, [
            h(SunIcon, { key: 'i', size: 22 }),
            h('h1', { key: 't', style: { margin: 0, fontSize: 20 } }, 'Sun 工作台'),
            h('span', { key: 'v', style: { fontSize: 11, opacity: 0.45 } }, 'v3'),
          ]),
          h('div', { key: 'tabs', style: { display: 'flex', gap: 4, borderBottom: '1px solid rgba(128,128,128,0.25)', marginBottom: 16 } },
            TABS.map(([key, label]) => h('button', {
              key, onClick: () => setTab(key),
              style: {
                padding: '7px 16px', fontSize: 13, cursor: 'pointer', background: 'transparent', color: 'inherit',
                border: 'none', borderBottom: tab === key ? '2px solid currentColor' : '2px solid transparent', fontWeight: tab === key ? 600 : 400,
              },
            }, label))),
          tab === 'tasks' && h(TasksTab, { key: 'tasks' }),
          tab === 'schedule' && h(ScheduleTab, { key: 'sched' }),
          tab === 'today' && h(TodayTab, { key: 'today' }),
        ])
      }

      return {
        inject: ['slots', 'uiWorkspace'],
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
