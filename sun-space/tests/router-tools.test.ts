/**
 * router-tools 回归：经 apply() 注册的真实 handler 驱动（ctx 桩只捕获 tools.register 与事件监听，不提供 subagents 服务——
 * 插件已不再依赖它）。状态目录隔离到临时 DSH_HOME；回写用例只写临时目录。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/router-tools'

type Tool = { name: string; execute: (args: unknown, exec?: unknown) => Promise<{ ok: boolean; note?: string; data?: any }> }

let home = ''
let savedVault: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'sun-rt-home-'))
  savedVault = process.env.SUN_VAULT
  delete process.env.SUN_VAULT
  process.env.DSH_HOME = home
})
afterEach(async () => {
  delete process.env.DSH_HOME
  if (savedVault !== undefined) process.env.SUN_VAULT = savedVault
  await rm(home, { force: true, recursive: true })
})

function harness() {
  const tools: Record<string, Tool> = {}
  const handlers: Record<string, (...args: unknown[]) => unknown> = {}
  const ctx = {
    tools: { register: (d: Tool) => { tools[d.name] = d } },
    logger: {},
    on: (event: string, handler: (...args: unknown[]) => unknown) => { handlers[event] = handler },
  } as unknown as Context
  apply(ctx)
  // 派发不在代码里：sun_route 是官方委派工具的组合实例（cordis.patch.yml），这里不应有同名工具
  expect(Object.keys(tools).sort()).toEqual(['sun_read', 'sun_state_read', 'sun_state_write', 'sun_vault_meta', 'sun_vault_write'])
  expect(Object.keys(handlers).sort()).toEqual(['session/event'])
  return { tools, handlers }
}
/** 会话执行上下文（宿主形状：exec.agent.session.{id,cwd}）。 */
const execOf = (cwd: string, id = 'session-router') => ({ agent: { session: { id, cwd } } })
const stateOf = async () => JSON.parse(await readFile(join(home, '.dsh', 'state', 'sun-space', 'state.json'), 'utf8'))

describe('sun_state_write {"router": true}：登记落在生效 vault 根上，不得让非 vault 工作目录变成 vault 根', () => {
  it('有内容无骨架的工作目录：{"vault":true} 被拒后 {"router":true} 仍成功，但 resolvedVault 不变', async () => {
    const t = harness().tools
    const busy = await mkdtemp(join(tmpdir(), 'sun-rt-busy-'))
    await writeFile(join(busy, 'README.md'), 'a real project\n')
    try {
      const exec = execOf(busy)
      const before = (await t.sun_state_read.execute({}, exec)).data.resolvedVault
      expect(before).toBe(join(homedir(), 'Workspace', 'sun-vault')) // 未登记、无骨架 → ⑥ 约定路径

      const refused = await t.sun_state_write.execute({ vault: true }, exec)
      expect(refused.ok).toBe(false) // 候选门控：有内容而无骨架的目录不是 vault

      const registered = await t.sun_state_write.execute({ router: true }, exec)
      expect(registered.ok).toBe(true)
      expect((await stateOf()).vaults).toEqual([{ dir: before, router: 'session-router' }]) // 登记落在生效 vault 根，工作目录不进 vaults
      const after = (await t.sun_state_read.execute({}, exec)).data.resolvedVault
      expect(after).toBe(before) // 回归点：0.3.7 及之前这里会翻成 busy（工作目录凭 router 登记成了 vault 根）
      expect(registered.data).toMatchObject({ vault: before, bucket: busy, router: 'session-router', changed: true })
      expect(await t.sun_state_write.execute({ router: true }, exec)).toMatchObject({ ok: true, data: { changed: false } }) // 幂等
    } finally {
      await rm(busy, { force: true, recursive: true })
    }
  })

  it('vault 即工作目录（空目录已登记）：router 落在该目录的条目上，解析结果与登记前一致', async () => {
    const t = harness().tools
    const vault = await mkdtemp(join(tmpdir(), 'sun-rt-vault-'))
    try {
      const exec = execOf(vault)
      expect(await t.sun_state_write.execute({ vault: true }, exec)).toMatchObject({ ok: true, data: { registered: true } })
      const registered = await t.sun_state_write.execute({ router: true }, exec)
      expect(registered.ok).toBe(true)
      expect((await stateOf()).vaults).toEqual([{ dir: vault, router: 'session-router' }]) // 与 0.3.5 起的行为一致：库即工作目录时落在同一条目上
      expect((await t.sun_state_read.execute({}, exec)).data.resolvedVault).toBe(vault)
      expect(registered.data).toMatchObject({ vault, bucket: vault, router: 'session-router', resolvedVault: vault })
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('config.json 外置库：router 登记在外置库根上，有内容的工作目录不进 vaults', async () => {
    const t = harness().tools
    const busy = await mkdtemp(join(tmpdir(), 'sun-rt-busy-'))
    const external = await mkdtemp(join(tmpdir(), 'sun-rt-external-'))
    await writeFile(join(busy, 'package.json'), '{}')
    const stateDir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(stateDir, { recursive: true })
    await writeFile(join(stateDir, 'config.json'), JSON.stringify({ vault: external })) // 用户手写的外置库映射
    try {
      const registered = await t.sun_state_write.execute({ router: true }, execOf(busy))
      expect(registered.ok).toBe(true)
      expect((await stateOf()).vaults).toEqual([{ dir: external, router: 'session-router' }]) // 登记在外置库根上，有内容的工作目录不进 vaults
      expect((await t.sun_state_read.execute({}, execOf(busy))).data.resolvedVault).toBe(external)
      expect(registered.data).toMatchObject({ vault: external, bucket: busy, router: 'session-router', resolvedVault: external })
    } finally {
      await rm(busy, { force: true, recursive: true })
      await rm(external, { force: true, recursive: true })
    }
  })

  it('拿不到会话 id / 工作目录 → ok:false，且不落盘', async () => {
    const t = harness().tools
    expect((await t.sun_state_write.execute({ router: true }, { agent: { session: { cwd: '/Users/x/ws' } } })).ok).toBe(false)
    expect((await t.sun_state_write.execute({ router: true }, { agent: { session: { id: 'session-router' } } })).ok).toBe(false)
    expect((await t.sun_state_write.execute({}, execOf('/Users/x/ws'))).ok).toBe(false)
    await expect(stateOf()).rejects.toThrow()
  })
})

// 派发改走官方委派工具后，子会话 id 不再由 sun_route 顺手回写，改由宿主事件驱动：
// 子代理创建后宿主向 Router 会话追加 subagent/catalog { childId, label }，label = 派发时填的 description。
describe('session/event → 任务笔记 session 字段回写', () => {
  const NOTE = [
    '---', 'type: task', 'id: T-20261124-01', 'status: proposed', 'tags:', '  - "work"', '  - "e2e"', 'artifacts:', '  - "a.md"',
    '---', '', '## 结论', '还没有结论。',
  ].join('\n')

  /** 一个带骨架的工作区（即 vault），可选预置任务笔记。 */
  async function workspace(note?: string) {
    const ws = await mkdtemp(join(tmpdir(), 'sun-rt-ws-'))
    await mkdir(join(ws, '90-Meta'))
    await mkdir(join(ws, '50-Tasks'))
    if (note !== undefined) await writeFile(join(ws, '50-Tasks', 'T-20261124-01.md'), note)
    return { ws, notePath: join(ws, '50-Tasks', 'T-20261124-01.md') }
  }
  const catalog = (label: unknown, childId: unknown = 'child-session-1') => ({ type: 'subagent/catalog', data: { childId, label } })
  const fire = (h: ReturnType<typeof harness>['handlers'], session: unknown, event: unknown) => { h['session/event'](session, event) }

  it('label 是 task_id 形状 → 写入 session；其余 frontmatter（含块式数组）与正文逐字节不动', async () => {
    const { handlers } = harness()
    const { ws, notePath } = await workspace(NOTE)
    try {
      fire(handlers, { header: { cwd: ws } }, catalog('t-20261124-01'))
      expect(await readFile(notePath, 'utf8')).toBe(NOTE.replace('  - "a.md"\n---', '  - "a.md"\nsession: child-session-1\n---')) // 插在闭合线之前
    } finally {
      await rm(ws, { force: true, recursive: true })
    }
  })

  it('已有 session（重派）→ 换成最新的子会话；大小写与首尾空白都认', async () => {
    const { handlers } = harness()
    const { ws, notePath } = await workspace(NOTE.replace('status: proposed', 'session: child-old'))
    try {
      fire(handlers, { header: { cwd: ws } }, catalog('  T-20261124-01 ', 'child-new'))
      expect(await readFile(notePath, 'utf8')).toBe(NOTE.replace('status: proposed', 'session: child-new'))
    } finally {
      await rm(ws, { force: true, recursive: true })
    }
  })

  it('label 不是 task_id 形状（如模型写了任务描述）→ 不碰任何文件', async () => {
    const { handlers } = harness()
    const { ws, notePath } = await workspace(NOTE)
    try {
      for (const label of ['调研 Obsidian skills', 't-2026', 't-20261124-1', '', undefined, 42]) fire(handlers, { header: { cwd: ws } }, catalog(label))
      expect(await readFile(notePath, 'utf8')).toBe(NOTE)
    } finally {
      await rm(ws, { force: true, recursive: true })
    }
  })

  it('任务笔记还没建 → 不替 Router 建文件', async () => {
    const { handlers } = harness()
    const { ws } = await workspace()
    try {
      fire(handlers, { header: { cwd: ws } }, catalog('t-20261124-01'))
      expect(await readdir(join(ws, '50-Tasks'))).toEqual([])
    } finally {
      await rm(ws, { force: true, recursive: true })
    }
  })

  it('笔记没有 frontmatter → 头部补一块', async () => {
    const { handlers } = harness()
    const body = '# 没有 frontmatter 的笔记\n\n正文\n'
    const { ws, notePath } = await workspace(body)
    try {
      fire(handlers, { header: { cwd: ws } }, catalog('t-20261124-01'))
      expect(await readFile(notePath, 'utf8')).toBe(`---\nsession: child-session-1\n---\n${body}`)
    } finally {
      await rm(ws, { force: true, recursive: true })
    }
  })

  it('载荷残缺 / 拿不到工作目录 → 不抛、不写', async () => {
    const { handlers } = harness()
    const { ws, notePath } = await workspace(NOTE)
    try {
      expect(() => {
        fire(handlers, undefined, undefined)
        fire(handlers, { header: {} }, catalog('t-20261124-01'))
        fire(handlers, { header: { cwd: 'relative/path' } }, catalog('t-20261124-01'))
        fire(handlers, { header: { cwd: ws } }, { type: 'subagent/catalog', data: { label: 't-20261124-01' } }) // 无 childId
        fire(handlers, { header: { cwd: ws } }, { type: 'tool/call', data: { childId: 'x', label: 't-20261124-01' } }) // 别的事件类型
        fire(handlers, { header: { cwd: join(ws, '50-Tasks') } }, { type: 'subagent/catalog', data: null })
      }).not.toThrow()
      expect(await readFile(notePath, 'utf8')).toBe(NOTE)
    } finally {
      await rm(ws, { force: true, recursive: true })
    }
  })
})
