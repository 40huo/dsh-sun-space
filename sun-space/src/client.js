/**
 * sun-space client 插件（v3：左侧边栏入口）。
 * 模式对齐 ui-schedule：sidebar.panellist（左栏图标行）+ main（主区工作台页）。
 * 原 v2 的右侧栏两段式注册移除（git 历史保留）。
 * 自检探针：window.__sunSpaceDebug + sessionStorage。
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

      /** 太阳图标（currentColor 自适应主题；size 由侧栏下发）。 */
      function SunIcon({ size }) {
        const rays = []
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4
          const x1 = 12 + Math.cos(a) * 7.2, y1 = 12 + Math.sin(a) * 7.2
          const x2 = 12 + Math.cos(a) * 10, y2 = 12 + Math.sin(a) * 10
          rays.push(h('line', {
            key: i, x1: x1.toFixed(2), y1: y1.toFixed(2),
            x2: x2.toFixed(2), y2: y2.toFixed(2),
            stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round',
          }))
        }
        return h('svg', {
          viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
          style: { display: 'block' },
        }, [
          h('circle', { key: 'core', cx: 12, cy: 12, r: 4.4, fill: 'currentColor' }),
          ...rays,
        ])
      }

      /** 主区工作台页（P2 接真实数据；当前为骨架 + 状态自检）。 */
      function SunWorkbench() {
        const debug = window.__sunSpaceDebug || {}
        return h('div', { style: { padding: '28px 36px', maxWidth: 860 } }, [
          h('h1', { key: 'h', style: { margin: '0 0 6px', fontSize: 22 } }, '☀️ Sun 工作台'),
          h('p', { key: 'sub', style: { margin: '0 0 22px', opacity: 0.7, fontSize: 13 } },
            '个人 Super-agent · 今日 / 任务 / 待确认 / 通知 / 设置'),
          h('div', { key: 'grid', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14 } }, [
            card('今日', '晨报 · 时间线 · 日报草稿与审核状态', 'P2 接入 40-Journal'),
            card('任务', '任务看板 proposed → running → need-confirm → done', 'P2 接入 50-Tasks'),
            card('待确认', '计划确认 · 执行中确认点 · 日报审核（一键批驳）', 'P2 接入确认卡流'),
            card('通知', 'info / ask / urgent 流水镜像，不依赖当时在线', 'P2 接入通知中心'),
          ]),
          h('p', {
            key: 'status',
            style: { marginTop: 20, opacity: 0.5, fontSize: 12, fontFamily: 'monospace' },
          }, `plugin: ${debug.phase || 'n/a'} · tools: sun_read / sun_vault_write / sun_notify / sun_route / sun_artifact_write`),
        ])

        function card(title, desc, hint) {
          return h('div', {
            key: title,
            style: {
              border: '1px solid rgba(128,128,128,0.25)', borderRadius: 10,
              padding: '14px 16px',
            },
          }, [
            h('div', { key: 't', style: { fontWeight: 600, marginBottom: 4 } }, title),
            h('div', { key: 'd', style: { fontSize: 13, opacity: 0.8, lineHeight: 1.6 } }, desc),
            h('div', { key: 'h', style: { fontSize: 12, opacity: 0.5, marginTop: 6 } }, hint),
          ])
        }
      }

      return {
        inject: ['slots'],
        apply(ctx) {
          D.phase = 'apply-entered'
          try {
            ctx.slots.inject('sidebar.panellist', () => {
              D.panellistRegistered = true
              return ctx.slots.register({
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 5,
                label: () => 'Sun 工作台',
              }, SunIcon)
            })
            ctx.slots.inject('main', () => {
              D.mainRegistered = true
              return ctx.slots.register({ name: 'main', key: PANEL_ID }, SunWorkbench)
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
