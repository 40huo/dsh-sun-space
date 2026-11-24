/**
 * client.js（浏览器半）回归：用假的 window / react / fetch 加载真实 client.js，直接驱动解析链。
 * fetch 桩按宿主 workspaceFiles/read 的真实语义工作：range.limit 单位是「行」、不得超过 maxLines、
 * 返回 { offset, text, lines, eof }（dsh-api-workspace-files typert.host.js）。
 * 入口是 client.js 暴露在 window.__sunSpaceDebug 上的诊断/测试缝。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const HOME = '/Users/tester'
const WS = `${HOME}/Documents/ws`
const STATE = `${HOME}/.dsh/state/sun-space`
let D: any
let calls: Array<{ method: string; args: any }> = []

/** 与服务端 writeState 同款落盘格式（JSON.stringify(out, null, 2)）——行数是这个回归的核心。 */
const stateJson = (value: unknown) => JSON.stringify(value, null, 2)
const session = (sessionId: string, cwd: string, updatedAt: string, agentPreset = 'sun-router') => (
  { sessionId, cwd, updatedAt, projections: { values: { agentPreset } } }
)

/** 装一个假宿主：files = 绝对路径 → 文本；maxLines = 单页行数上限；items = session/list；catalog = 子代理清单。 */
function host(files: Record<string, string>, opts: { items?: unknown[]; maxLines?: number; catalog?: unknown[] } = {}) {
  calls = []
  const maxLines = opts.maxLines ?? 2000
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { method, payload } = JSON.parse(init.body)
    const args = payload.args
    calls.push({ method, args })
    const ok = (value: unknown) => ({ json: async () => ({ result: { ok: true, value } }) })
    const err = (message: string) => ({ json: async () => ({ result: { ok: false, error: { code: 'ENOENT', message } } }) })
    if (method === 'workspaceFiles/read') {
      const lines = files[args.path]?.split('\n')
      if (!lines) return err(`ENOENT: ${args.path}`)
      const offset = args.range?.offset ?? 1
      const limit = Math.min(args.range?.limit ?? maxLines, maxLines)
      const page = lines.slice(offset - 1, offset - 1 + limit)
      return ok({ offset, text: page.join('\n'), lines: page.length, eof: offset - 1 + page.length >= lines.length, absolutePath: args.path, version: 'v1' })
    }
    if (method === 'session/list') return ok({ items: opts.items ?? [] })
    if (method === 'session/projections') return ok({ values: { subagentCatalog: opts.catalog ?? [] } })
    throw new Error(`unexpected method ${method}`)
  })
}

beforeAll(async () => {
  const g = globalThis as any
  let plugin: any
  g.window = {
    __ModuleLoader__: { load: (m: any) => { plugin = m } },
    sessionStorage: { setItem: () => {} },
  }
  await import('../src/client.js')
  const react = { createElement: () => null, Component: class {}, useState: () => [null, () => {}], useCallback: (f: unknown) => f, useEffect: () => {}, useRef: () => ({ current: true }) }
  plugin.factory((name: string) => { if (name === 'react') return react; throw new Error(`unexpected require ${name}`) })
  D = g.window.__sunSpaceDebug
  expect(D.phase).toBe('react-ok') // factory 正常走完（抛错会是 factory-throw）、无异常入账
  expect(D.errors).toEqual([])
})
beforeEach(() => { D.errors.length = 0; D.routerSource = null; D.vaultSource = null })
afterAll(() => { vi.unstubAllGlobals() })

describe('resolveRouterSession：vaults[].router 裁决不得因 state.json 行数而失效', () => {
  // 登记的是较旧的会话：若裁决失效，兜底（最近活跃）会选到 session-new
  const items = [session('session-new', WS, '2026-11-24T10:00'), session('session-old', WS, '2026-11-14T14:00')]
  const registered = stateJson({ vaults: [{ dir: WS, router: 'session-old' }], updatedAt: '2026-11-14T14:00' })

  it('一条带 router 的登记（9 行）→ 选登记的会话，而非最近活跃者', async () => {
    expect(registered.split('\n').length).toBe(9) // 旧实参 limit:8 恰好读不到结尾的 }
    host({ [`${STATE}/state.json`]: registered }, { items })
    expect(await D.resolveRouterSession(WS, undefined)).toBe('session-old')
    expect(D.routerSource).toBe('state.vaults[].router')
    expect(D.errors).toEqual([])
  })

  it('宿主单页行数上限很小时（maxLines=4）按 offset 翻页拼回完整文件', async () => {
    host({ [`${STATE}/state.json`]: registered }, { items, maxLines: 4 })
    expect(await D.resolveRouterSession(WS, undefined)).toBe('session-old')
    expect(calls.filter(c => c.args.path === `${STATE}/state.json`).map(c => c.args.range.offset)).toEqual([1, 5, 9])
  })

  it('两条带 router 的登记（12 行）同样生效；未指向现存会话的 router 不算命中', async () => {
    const two = stateJson({ vaults: [{ dir: '/elsewhere', router: 'session-gone' }, { dir: WS, router: 'session-old' }] })
    expect(two.split('\n').length).toBe(12)
    host({ [`${STATE}/state.json`]: two }, { items })
    expect(await D.resolveRouterSession(WS, undefined)).toBe('session-old')
  })

  it('state.json 不是合法 JSON（如被截断）→ 退回兜底，且解析失败显式记入 D.errors', async () => {
    host({ [`${STATE}/state.json`]: registered.split('\n').slice(0, 8).join('\n') }, { items })
    expect(await D.resolveRouterSession(WS, undefined)).toBe('session-new')
    expect(D.routerSource).toBe('updatedAt 兜底')
    expect(D.errors.some((e: string) => e.includes('state.json 不是合法 JSON'))).toBe(true)
  })

  it('没有 state.json → 安静走兜底，不记错误', async () => {
    host({}, { items })
    expect(await D.resolveRouterSession(WS, undefined)).toBe('session-new')
    expect(D.errors).toEqual([])
  })
})

describe('resolveVault：与服务端六级链同序', () => {
  it('本工作区分桶登记（多条登记）→ vault = 本工作区', async () => {
    host({ [`${STATE}/state.json`]: stateJson({ vaults: [{ dir: '/Users/tester/Workspace/other' }, { dir: WS }] }) },
      { items: [session('session-new', WS, '2026-11-24T10:00')] })
    expect(await D.resolveVault(undefined, 'session-new')).toBe(WS)
    expect(D.vaultSource).toBe('state.vaults[本工作区分桶登记]')
  })

  it('config.json 的 vault 压过约定布局；全局镜像次之', async () => {
    const items = [session('session-new', WS, '2026-11-24T10:00')]
    host({ [`${STATE}/config.json`]: '{\n  "vault": "/Users/tester/Vaults/real"\n}\n' }, { items })
    expect(await D.resolveVault(undefined, 'session-new')).toBe('/Users/tester/Vaults/real')
    host({ [`${STATE}/state.json`]: stateJson({ vault: '/Users/tester/Vaults/mirror', vaults: [] }) }, { items })
    expect(await D.resolveVault(undefined, 'session-new')).toBe('/Users/tester/Vaults/mirror')
  })

  it('无登记 → 会话目录骨架 → 约定布局', async () => {
    const items = [session('session-new', WS, '2026-11-24T10:00')]
    host({ [`${WS}/90-Meta/runbook.md`]: '# runbook\n' }, { items })
    expect(await D.resolveVault(undefined, 'session-new')).toBe(WS)
    host({ [`${HOME}/Workspace/sun-vault/90-Meta/runbook.md`]: '# runbook\n' }, { items })
    expect(await D.resolveVault(undefined, 'session-new')).toBe(`${HOME}/Workspace/sun-vault`)
    expect(D.vaultSource).toBe('约定布局 ~/Workspace/sun-vault')
  })
})

describe('loadTasks：任务注解不受笔记 frontmatter 行数影响', () => {
  it('frontmatter 超过单页行数（块式 artifacts 在 30 行之后）→ 翻页读到闭合，注解完整', async () => {
    const filler = Array.from({ length: 30 }, (_, i) => `note_${i}: x`)
    const note = ['---', 'type: task', 'id: T-20261124-01', 'status: need-confirm', ...filler, 'artifacts:', '  - "a.md"', '---', '', '## 结论', '正文很长……'.repeat(500)].join('\n')
    const items = [session('session-old', WS, '2026-11-24T10:00')]
    const catalog = [{ id: 'child-1', createdAt: 0, mode: 'one-shot', label: 't-20261124-01' }]
    host({ [`${WS}/50-Tasks/T-20261124-01.md`]: note }, { items, maxLines: 12, catalog })
    const r = await D.loadTasks('session-old', WS)
    expect(r.rows[0].task).toEqual({ id: 'T-20261124-01', status: 'need-confirm', source: '', artifacts: ['a.md'] })
    const noteReads = calls.filter(c => String(c.args?.path ?? '').endsWith('T-20261124-01.md'))
    expect(noteReads.length).toBeGreaterThan(1) // 确实翻了页
    expect(noteReads.length).toBeLessThan(10) // 且在 frontmatter 闭合处止步，没有读完正文
  })

  it('没有 frontmatter 的长笔记：第一页即止，不通读全文，也不产生注解', async () => {
    const body = Array.from({ length: 500 }, (_, i) => `正文第 ${i} 行`).join('\n')
    const note = `# 没有 frontmatter 的笔记\n\n---\n\n${body}\n` // 正文里有分隔线，不能误判成 frontmatter 闭合
    const items = [session('session-old', WS, '2026-11-24T10:00')]
    const catalog = [{ id: 'child-1', createdAt: 0, mode: 'one-shot', label: 't-20261124-01' }]
    host({ [`${WS}/50-Tasks/T-20261124-01.md`]: note }, { items, maxLines: 40, catalog })
    const r = await D.loadTasks('session-old', WS)
    expect(r.rows[0].task).toBeNull()
    expect(calls.filter(c => String(c.args?.path ?? '').endsWith('T-20261124-01.md')).length).toBe(1)
  })
})
