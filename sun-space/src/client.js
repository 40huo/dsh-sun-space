/**
 * sun-space client 插件（Spike B，v2 两段式注册）：
 * 1. ctx.sidebarRightTabs.register(definition) —— 页面型 Tab 类型 + guide 入口
 * 2. ctx.slots.inject('sidebar.right.pane.tab' / '...title') —— 同 id 的实体
 * 模式对齐 ui-sidebar-documentpreview（外来包注册的官方样板）与 ui-plan。
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

      const SUN_ID = 'sun-space/client'
      const SUN_KIND = 'sun'

      function SunTitle() {
        return h('span', null, 'Sun')
      }

      function SunPanel() {
        return h('div', { style: { padding: 12, fontSize: 13, lineHeight: 1.7 } },
          h('h3', { style: { margin: '0 0 8px' } }, '☀️ Sun Space'),
          h('p', { style: { opacity: 0.75 } }, '个人 Super-agent 工作台（Panel v0）'),
          h('ul', { style: { paddingLeft: 18 } },
            h('li', null, '今日：晨报 / 时间线 / 日报（P2 接入）'),
            h('li', null, '任务：50-Tasks 看板（P2 接入）'),
            h('li', null, '待确认：确认卡流（P2 接入）'),
          ),
        )
      }

      return {
        inject: ['slots', 'sidebarRightTabs'],
        apply(ctx) {
          D.phase = 'apply-entered'
          try {
            // Stage 1：页面型 Tab 类型（无 patterns，按 kind 打开）+ guide 入口
            ctx.sidebarRightTabs.register({
              id: SUN_ID,
              kind: SUN_KIND,
              title: () => 'Sun',
              guide: [{
                id: 'sun-workbench',
                order: 50,
                title: () => '☀️ Sun 工作台',
                description: () => '今日计划、任务看板、待确认与通知中心',
              }],
            })
            D.registered = true

            // Stage 2：实体（body + title），key = 定义 id
            ctx.slots.inject('sidebar.right.pane.tab', () => {
              D.tabRegistered = true
              return ctx.slots.register(
                { name: 'sidebar.right.pane.tab', key: SUN_ID }, SunPanel)
            })
            ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: SUN_ID }, SunTitle))
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
