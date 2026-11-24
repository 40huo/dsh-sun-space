/**
 * sun_state_write 工具级回归：经 apply() 注册的真实 handler 驱动（ctx 桩只捕获 tools.register）。
 * 状态目录隔离到临时 DSH_HOME；用例不向任何 vault 写文件，只断言登记与解析结果。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  const ctx = { tools: { register: (d: Tool) => { tools[d.name] = d } }, logger: {}, subagents: {} } as unknown as Context
  apply(ctx)
  expect(Object.keys(tools).sort()).toEqual(['sun_read', 'sun_route', 'sun_state_read', 'sun_state_write', 'sun_vault_meta', 'sun_vault_write'])
  return tools
}
/** 会话执行上下文（宿主形状：exec.agent.session.{id,cwd}）。 */
const execOf = (cwd: string, id = 'session-router') => ({ agent: { session: { id, cwd } } })
const stateOf = async () => JSON.parse(await readFile(join(home, '.dsh', 'state', 'sun-space', 'state.json'), 'utf8'))

describe('sun_state_write {"router": true}：登记落在生效 vault 根上，不得让非 vault 工作目录变成 vault 根', () => {
  it('有内容无骨架的工作目录：{"vault":true} 被拒后 {"router":true} 仍成功，但 resolvedVault 不变', async () => {
    const t = harness()
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
    const t = harness()
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
    const t = harness()
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
    const t = harness()
    expect((await t.sun_state_write.execute({ router: true }, { agent: { session: { cwd: '/Users/x/ws' } } })).ok).toBe(false)
    expect((await t.sun_state_write.execute({ router: true }, { agent: { session: { id: 'session-router' } } })).ok).toBe(false)
    expect((await t.sun_state_write.execute({}, execOf('/Users/x/ws'))).ok).toBe(false)
    await expect(stateOf()).rejects.toThrow()
  })
})
