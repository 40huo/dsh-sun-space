import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { computeVaultPath, registerVaultRootFromSession, vaultPath } from '../src/vault-path'

describe('computeVaultPath（四级优先：env → config → state 登记 → 约定）', () => {
  it('① env 最高优先', () => {
    expect(computeVaultPath('/env', '{"vault":"/c"}', '{"vault":"/s"}', '/h')).toBe('/env')
  })
  it('② config.json 次之', () => {
    expect(computeVaultPath(undefined, '{"vault":"/c"}', '{"vault":"/s"}', '/h')).toBe('/c')
  })
  it('③ state.json（Router 自登记）再次之', () => {
    expect(computeVaultPath(undefined, undefined, '{"vault":"/s"}', '/h')).toBe('/s')
  })
  it('④ 全缺 → 默认约定 ~/Workspace/sun-vault', () => {
    expect(computeVaultPath(undefined, undefined, undefined, '/Users/x')).toBe('/Users/x/Workspace/sun-vault')
  })
  it('非法 JSON/非绝对路径被跳过', () => {
    expect(computeVaultPath(undefined, 'not-json', '{"vault":"relative"}', '/h')).toBe('/h/Workspace/sun-vault')
  })
})

describe('registerVaultRootFromSession（首个 sun-router 会话 cwd 登记）', () => {
  it('空状态 → 登记 cwd 并写 state.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-reg-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    process.env.DSH_HOME = home
    try {
      expect(registerVaultRootFromSession('/Users/x/homevault')).toBe(true)
      const st = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
      expect(st.vault).toBe('/Users/x/homevault')
      // 二次登记不覆盖
      expect(registerVaultRootFromSession('/Users/x/other')).toBe(false)
      expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).vault).toBe('/Users/x/homevault')
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('非绝对路径/空值 → 拒绝', () => {
    expect(registerVaultRootFromSession(undefined)).toBe(false)
    expect(registerVaultRootFromSession('relative/path')).toBe(false)
  })
})

describe('vaultPath（运行期，DSH_HOME 隔离）', () => {
  it('隔离 home 已登记 state.vault → 解析到登记路径（DSH_HOME 作用域，不串扰真实 HOME）', async () => {
    const home = join(tmpdir(), 'sun-iso-' + Date.now())
    process.env.DSH_HOME = home
    try {
      const dir = join(home, '.dsh', 'state', 'sun-space')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'state.json'), JSON.stringify({ vault: '/Users/x/homevault' }))
      expect(vaultPath(Date.now() + 120_000)).toBe('/Users/x/homevault')
      // 无登记 → 真实用户 HOME 的约定兜底
      await rm(join(dir, 'state.json'))
      expect(vaultPath(Date.now() + 180_000)).toBe(join(homedir(), 'Workspace', 'sun-vault'))
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
})
