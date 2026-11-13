import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  computeVaultPath,
  cwdHasSkeleton,
  cwdIsVaultCandidate,
  explicitVaultValue,
  publishVaultState,
  registerVaultRootFromSession,
  setRouterSession,
  vaultEntriesOf,
  vaultPath,
  vaultPathForHost,
} from '../src/vault-path'

const fresh = () => Date.now() + 120_000 // 越过 60s 微缓存防抖

describe('computeVaultPath（六级：env → config → 会话目录(骨架门控) → vaults 登记 → 全局镜像 → 约定）', () => {
  it('① env 最高优先', () => {
    expect(computeVaultPath('/env', '{"vault":"/c"}', '{"vault":"/s"}', '/h')).toBe('/env')
  })
  it('② config.json 次之', () => {
    expect(computeVaultPath(undefined, '{"vault":"/c"}', '{"vault":"/s"}', '/h')).toBe('/c')
  })
  it('③ 会话目录（骨架门控后传入）压过登记与全局镜像', () => {
    expect(computeVaultPath(undefined, undefined, '{"vaults":[{"dir":"/h"}],"vault":"/s"}', '/h')).toBe('/h')
  })
  it('④ vaults 登记：本桶命中；旧 workspaces 自映射读兼容；他桶不干扰', () => {
    const st = JSON.stringify({ vaults: [{ dir: '/homevault' }, { dir: '/main', router: 'session-x' }] })
    expect(computeVaultPath(undefined, undefined, st, undefined, homedir(), '/homevault')).toBe('/homevault')
    expect(computeVaultPath(undefined, undefined, st, undefined, homedir(), '/other')).toBe(join(homedir(), 'Workspace', 'sun-vault'))
    const legacy = JSON.stringify({ workspaces: { '/legacy': '/legacy' } })
    expect(computeVaultPath(undefined, undefined, legacy, undefined, homedir(), '/legacy')).toBe('/legacy')
  })
  it('⑤ 全局镜像（显式）在无桶命中时生效；⑥ 全缺 → 约定', () => {
    expect(computeVaultPath(undefined, undefined, '{"vault":"/s"}', undefined)).toBe('/s')
    expect(computeVaultPath(undefined, undefined, undefined, undefined, '/Users/x')).toBe('/Users/x/Workspace/sun-vault')
  })
  it('非法 JSON/非绝对路径被跳过', () => {
    expect(computeVaultPath(undefined, 'not-json', '{"vault":"relative"}', undefined, '/h')).toBe('/h/Workspace/sun-vault')
  })
})

describe('vaultEntriesOf（新 vaults 为主 + 旧 workspaces 归并）', () => {
  it('新数组直取（router 可选）；旧 map 键归并为无 router 条目；同 dir 去重', () => {
    expect(vaultEntriesOf({ vaults: [{ dir: '/a', router: 'session-1' }, { dir: '/b' }, { dir: 'rel' }] })).toEqual([{ dir: '/a', router: 'session-1' }, { dir: '/b' }])
    expect(vaultEntriesOf({ workspaces: { '/old': '/old', rel: 'x' } })).toEqual([{ dir: '/old' }])
    expect(vaultEntriesOf({ vaults: [{ dir: '/a' }], workspaces: { '/a': '/a', '/b': '/b' } })).toEqual([{ dir: '/a' }, { dir: '/b' }])
  })
})

describe('explicitVaultValue（①②⑤ 显式来源；登记/会话目录不算）', () => {
  it('只有 vaults 登记（无全局镜像）→ 不算显式（不触发落盘）', () => {
    expect(explicitVaultValue(undefined, undefined, '{"vaults":[{"dir":"/h"}]}')).toBeUndefined()
  })
  it('env > config > state.vault；坏 JSON/相对路径跳过', () => {
    expect(explicitVaultValue('/env', '{"vault":"/c"}', '{"vault":"/s"}')).toBe('/env')
    expect(explicitVaultValue(undefined, '{"vault":"/c"}', '{"vault":"/s"}')).toBe('/c')
    expect(explicitVaultValue(undefined, undefined, '{"vault":"/s"}')).toBe('/s')
    expect(explicitVaultValue(undefined, 'not-json', '{"vault":"relative"}')).toBeUndefined()
  })
})

describe('目录门控（cwdHasSkeleton / cwdIsVaultCandidate）', () => {
  it('非绝对/未定义/不存在 → 拒绝', () => {
    expect(cwdHasSkeleton(undefined)).toBe(false)
    expect(cwdHasSkeleton('relative')).toBe(false)
    expect(cwdIsVaultCandidate(undefined)).toBe(false)
    expect(cwdIsVaultCandidate('relative/path')).toBe(false)
    const p = join(tmpdir(), 'sun-nonexistent-' + Date.now())
    expect(cwdHasSkeleton(p)).toBe(false)
    expect(cwdIsVaultCandidate(p)).toBe(false)
  })
  it('空目录：无骨架、但是登记候选（git init 过的也算）', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'sun-cand-'))
    try {
      expect(cwdHasSkeleton(empty)).toBe(false)
      expect(cwdIsVaultCandidate(empty)).toBe(true)
      await writeFile(join(empty, '.gitkeep'), '')
      expect(cwdIsVaultCandidate(empty)).toBe(true)
    } finally { await rm(empty, { force: true, recursive: true }) }
  })
  it('含 90-Meta 骨架：两者放行；有内容无骨架：都拒绝', async () => {
    const d = await mkdtemp(join(tmpdir(), 'sun-cand-'))
    const busy = await mkdtemp(join(tmpdir(), 'sun-cand-'))
    try {
      await mkdir(join(d, '90-Meta'))
      expect(cwdHasSkeleton(d)).toBe(true)
      expect(cwdIsVaultCandidate(d)).toBe(true)
      await writeFile(join(busy, 'README.md'), 'x')
      expect(cwdHasSkeleton(busy)).toBe(false)
      expect(cwdIsVaultCandidate(busy)).toBe(false)
    } finally { await rm(d, { force: true, recursive: true }); await rm(busy, { force: true, recursive: true }) }
  })
})

describe('registerVaultRootFromSession / setRouterSession（分桶登记，新 schema 落盘）', () => {
  it('空工作区 → 登记 vaults 条目（无 router），不写全局 vault；写时迁移旧 workspaces', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-reg-'))
    process.env.DSH_HOME = home
    try {
      const ws = await mkdtemp(join(tmpdir(), 'sun-ws-'))
      const p = join(home, '.dsh', 'state', 'sun-space', 'state.json')
      await mkdir(join(home, '.dsh', 'state', 'sun-space'), { recursive: true })
      await writeFile(p, JSON.stringify({ workspaces: { '/legacy': '/legacy' } })) // 预置旧格式
      expect(registerVaultRootFromSession(ws)).toBe(true)
      const st = JSON.parse(await readFile(p, 'utf8'))
      expect(st.vaults).toEqual([{ dir: '/legacy' }, { dir: ws }])
      expect(st.workspaces).toBeUndefined() // 旧字段写时迁移掉
      expect(st.vault).toBeUndefined()
      expect(registerVaultRootFromSession(ws)).toBe(false) // 同桶幂等
      await rm(ws, { force: true, recursive: true })
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('setRouterSession：新建条目/同会话幂等/换会话改绑；非法会话 id 拒绝', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-reg-'))
    process.env.DSH_HOME = home
    try {
      const ws = '/Users/x/homevault'
      expect(setRouterSession(ws, 'not-a-session')).toBe(false)
      expect(setRouterSession(undefined, 'session-a')).toBe(false)
      expect(setRouterSession(ws, 'session-a')).toBe(true) // 无条目 → 新建 {dir, router}
      expect(setRouterSession(ws, 'session-a')).toBe(false) // 同会话幂等
      expect(setRouterSession(ws, 'session-b')).toBe(true) // 换会话改绑（轮换落点）
      const st = JSON.parse(await readFile(join(home, '.dsh', 'state', 'sun-space', 'state.json'), 'utf8'))
      expect(st.vaults).toEqual([{ dir: ws, router: 'session-b' }])
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('有内容而无骨架（宿主 boot 桶/仓库根）→ 拒绝登记且不写文件', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-reg-'))
    process.env.DSH_HOME = home
    try {
      const busy = await mkdtemp(join(tmpdir(), 'sun-ws-'))
      await writeFile(join(busy, 'package.json'), '{}')
      expect(registerVaultRootFromSession(busy)).toBe(false)
      expect(existsSync(join(home, '.dsh', 'state', 'sun-space', 'state.json'))).toBe(false)
      await rm(busy, { force: true, recursive: true })
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
})

describe('publishVaultState（显式来源才落盘；vaults 登记原样保留）', () => {
  it('无 env/config/镜像 → 不写（防幽灵登记回归）', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-pub-'))
    process.env.DSH_HOME = home
    const savedEnv = process.env.SUN_VAULT
    delete process.env.SUN_VAULT
    try {
      publishVaultState()
      expect(existsSync(join(home, '.dsh', 'state', 'sun-space', 'state.json'))).toBe(false)
    } finally {
      if (savedEnv !== undefined) process.env.SUN_VAULT = savedEnv
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('config.json 有 vault → 落盘镜像并保留 vaults', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-pub-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'config.json'), JSON.stringify({ vault: '/Users/x/my-vault' }))
    await writeFile(join(dir, 'state.json'), JSON.stringify({ vaults: [{ dir: '/w', router: 'session-1' }] }))
    process.env.DSH_HOME = home
    const savedEnv = process.env.SUN_VAULT
    delete process.env.SUN_VAULT
    try {
      publishVaultState()
      const st = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
      expect(st.vault).toBe('/Users/x/my-vault')
      expect(st.vaults).toEqual([{ dir: '/w', router: 'session-1' }])
      expect(st.updatedAt).toBeTruthy()
    } finally {
      if (savedEnv !== undefined) process.env.SUN_VAULT = savedEnv
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
})

describe('vaultPath / vaultPathForHost（运行期：门控 + 分桶 + 多实例隔离）', () => {
  it('多桶并存互不污染：homevault 桶登记后，主桶解析不受影响', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-iso-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'state.json'), JSON.stringify({ vaults: [{ dir: '/Users/x/homevault', router: 'session-1' }] }))
    process.env.DSH_HOME = home
    try {
      expect(vaultPath('/Users/x/homevault', fresh())).toBe('/Users/x/homevault') // ④ 登记命中
      expect(vaultPath('/Users/x/default-workspace', fresh())).toBe(join(homedir(), 'Workspace', 'sun-vault')) // 他桶 → ⑥ 约定
      expect(vaultPathForHost(fresh())).toBe(join(homedir(), 'Workspace', 'sun-vault')) // 本进程桶未登记
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('骨架工作区压过登记——目录本身即事实', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-iso-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    const ws = await mkdtemp(join(tmpdir(), 'sun-ws-'))
    await mkdir(join(ws, '90-Meta'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'state.json'), JSON.stringify({ vaults: [{ dir: ws }] }))
    process.env.DSH_HOME = home
    try {
      expect(vaultPath(ws, fresh())).toBe(ws)
    } finally {
      delete process.env.DSH_HOME
      await rm(ws, { force: true, recursive: true }); await rm(home, { force: true, recursive: true })
    }
  })
})
