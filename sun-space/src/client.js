/**
 * sun-space client 插件（v4：派活树工作台）。
 * 数据通道 = 既有 workspaceFiles remote（绝对路径直读 vault，已实测验证）——零新增宿主代码。
 * 布局对齐 cabinet-mode 借鉴报告 §4：计数器行 + 状态分组任务卡 + 图例（need-confirm 琥珀为本项目新增语义）。
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

      const PANEL_ID = 'sun-space'
      let hostCtx = null // apply 时捕获，卡片点击跳转会话用
      const VAULT = '/Users/40huo/Workspace/sun-vault'
      const SCOPE_SESSION = 'session-f9ab8ca6-40bc-40ed-acb9-c52a620f98d6' // 固定 router 会话（scope 解析用）

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

      async function loadTasks() {
        // 链式召回：Journal 是当日任务索引（list 被限制在工作区内，而 read 允许绝对路径——
        // 用"读 Journal → 提取 [[T-…]] 反链 → 逐个读任务笔记"替代目录列举）
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        const journal = await gateway('workspaceFiles/read', {
          workspaceFileScopeId: SCOPE_SESSION,
          path: VAULT + '/40-Journal/' + today + '.md',
          range: { limit: 200 },
        })
        const ids = [...new Set([...(journal.text || '').matchAll(/\[\[(T-\d{8}-\d{2})\]\]/g)].map(m => m[1]))]
        const tasks = []
        for (const id of ids.slice(0, 20)) {
          try {
            const page = await gateway('workspaceFiles/read', {
              workspaceFileScopeId: SCOPE_SESSION,
              path: VAULT + '/50-Tasks/' + id + '.md',
              range: { limit: 24 },
            })
            const fm = parseFrontmatter(page.text || '')
            if (fm.id) tasks.push({
              id: fm.id, status: fm.status || 'proposed', source: fm.source || '',
              priority: fm.priority || 'medium', journal: fm.journal || '', file: id + '.md',
              session: fm.session || '',
            })
          } catch (err) { /* 单文件失败不拖垮看板 */ }
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

      function Workbench() {
        const [state, setState] = React.useState({ loading: true, tasks: [], sessions: [], error: null })
        const reload = React.useCallback(() => {
          setState(s => ({ ...s, loading: true, error: null }))
          Promise.all([
            loadTasks(),
            fetch('/api/session/list', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ type: 'client-request', rpcId: 'sun-sl', method: 'session/list', payload: { args: { _request: {} } } }),
            }).then(r => r.json()).then(j => j?.result?.value ?? null).catch(() => null),
          ])
            .then(([tasks, sessions]) => setState({ loading: false, tasks, sessions, error: null }))
            .catch(e => setState({ loading: false, tasks: [], sessions: [], error: String(e.message || e) }))
        }, [])
        React.useEffect(() => { reload() }, [reload])

        const order = { 'need-confirm': 0, running: 1, proposed: 2, blocked: 3, done: 4, dropped: 5 }
        const tasks = [...state.tasks].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
        const by = s => state.tasks.filter(t => t.status === s)
        const counters = [
          ['未派发', by('proposed').length, STATUS_META.proposed.color],
          ['进行中', by('running').length, STATUS_META.running.color],
          ['等你确认', by('need-confirm').length, STATUS_META['need-confirm'].color],
          ['已完成', by('done').length, STATUS_META.done.color],
        ]
        // 派活树运行态：router 会话（含其 Worker）是否在跑
        const routerRunning = (state.sessions?.sessions || state.sessions?.items || [])
          .some(s => (s.title || '').includes('Sun') && (s.status === 'running' || s.running === true))
        const anyRunning = by('running').length > 0 || routerRunning

        return h('div', { style: { padding: '24px 32px', maxWidth: 980 } }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 } }, [
            h(SunIcon, { key: 'i', size: 22 }),
            h('h1', { key: 't', style: { margin: 0, fontSize: 20 } }, 'Sun 工作台'),
            h('button', { key: 'r', onClick: reload, style: { marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer' } }, state.loading ? '刷新中…' : '刷新'),
          ]),
          h('p', { key: 'sub', style: { margin: '0 0 14px', opacity: 0.65, fontSize: 12 } },
            '派活树 · 数据源 vault 50-Tasks（workspaceFiles 既有通道 · 只读视图）'),
          state.error && h('p', { key: 'err', style: { color: '#e8634d', fontSize: 13 } }, '加载失败：' + state.error),
          h('div', { key: 'cnt', style: { display: 'flex', gap: 18, marginBottom: 20 } },
            counters.map(([label, n, color]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' } }),
              h('span', { key: 'l', style: { fontSize: 13 } }, `${label} ${n}`),
            ]))),

          // ===== 派活树：Router 卡 → 肘形连接线 → 任务卡 =====
          h('div', { key: 'tree', style: { position: 'relative', paddingLeft: 26 } }, [
            // Router 根卡
            h('div', { key: 'root', title: '点击打开 Router 会话', onClick: () => {
              try { hostCtx.uiWorkspace.openSession(SCOPE_SESSION) } catch (e) { D.errors.push('openSession: ' + String(e)) }
            }, style: {
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 10,
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
            // 主干
            tasks.length > 0 && h('div', { key: 'trunk', style: { width: 2, height: 14, background: 'rgba(128,128,128,0.35)', marginLeft: 14 } }),
            // 任务卡（肘形连接线：左竖线 + 底部短横）
            ...tasks.map(t => h('div', { key: t.id, style: { position: 'relative', paddingLeft: 20, paddingBottom: 8 } }, [
              h('div', { key: 'elbow', style: {
                position: 'absolute', left: 13, top: -8, width: 8, height: 22,
                borderLeft: '2px solid rgba(128,128,128,0.35)', borderBottom: '2px solid rgba(128,128,128,0.35)', borderTop: '2px solid rgba(128,128,128,0.35)',
                borderTopLeftRadius: 6,
              } }),
              h('div', { key: 'card', title: '点击打开对应会话', onClick: () => {
                // 直接跳子会话；若未跳走（组件仍挂载）自动重试，耗尽才回退主会话——避免闪主会话
          const target = t.session || SCOPE_SESSION
          window.__sunJumpLog = window.__sunJumpLog || []
          let attempts = 0
          const tryOpen = () => {
            if (attempts >= 5) {
              try { hostCtx.uiWorkspace.openSession(SCOPE_SESSION) } catch (e) { D.errors.push('fallback: ' + String(e)) }
              return
            }
            attempts++
            window.__sunJumpLog.push({ at: Date.now(), attempt: attempts, target })
            try { hostCtx.uiWorkspace.openSession(target) } catch (e) { D.errors.push('openSession: ' + String(e)) }
            setTimeout(tryOpen, 500)
          }
          tryOpen()
              }, style: {
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
                border: `1px solid ${t.status === 'need-confirm' ? STATUS_META['need-confirm'].color : 'rgba(128,128,128,0.25)'}`,
                borderLeftWidth: 3, borderLeftColor: STATUS_META[t.status]?.color || '#999',
                borderRadius: 8, padding: '8px 12px', background: t.status === 'running' ? 'rgba(77,157,232,0.08)' : 'transparent',
              } }, [
                h('span', { key: 'dot', style: { width: 8, height: 8, borderRadius: 4, background: STATUS_META[t.status]?.color || '#999', display: 'inline-block' } }),
                h('span', { key: 'id', style: { fontFamily: 'monospace', fontSize: 12 } }, t.id),
                h('span', { key: 's', style: { fontSize: 12, color: STATUS_META[t.status]?.color } }, STATUS_META[t.status]?.label || t.status),
                h('span', { key: 'src', style: { fontSize: 11, opacity: 0.55 } }, t.source),
                t.confirmations && t.confirmations !== '0' ? h('span', { key: 'cf', style: { fontSize: 11, opacity: 0.55 } }, `确认×${t.confirmations}`) : null,
                t.journal ? h('span', { key: 'j', style: { fontSize: 11, opacity: 0.45, fontFamily: 'monospace' } }, t.journal) : null,
              ]),
            ])),
            tasks.length === 0 && !state.loading && h('p', { key: 'empty', style: { opacity: 0.5, fontSize: 13, paddingTop: 6 } }, '暂无任务——晨报生成后这里会长出派活树'),
          ]),

          h('div', { key: 'legend', style: { marginTop: 12, fontSize: 11, opacity: 0.55, display: 'flex', gap: 14 } },
            Object.entries(STATUS_META).slice(0, 4).map(([k, m]) => h('span', { key: k }, '● ' + m.label))),
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
            window.__sunOpenSession = (id) => { try { hostCtx.uiWorkspace.openSession(id); return 'called' } catch (e) { return 'ERR: ' + String(e) } }
window.__sunAddr = (id) => { try { return JSON.stringify(hostCtx.sessions.subagentAddress ? (hostCtx.sessions.subagentAddress(id) ?? null) : 'no-fn') } catch (e) { return 'ERR: ' + String(e) } }
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
