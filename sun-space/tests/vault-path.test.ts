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
  readStateSnapshot,
  registerVaultRootFromSession,
  vaultPath,
  vaultPathForHost,
} from '../src/vault-path'

const fresh = () => Date.now() + 120_000 // 越过 60s 微缓存防抖

describe('computeVaultPath（六级：env → config → 会话目录(骨架门控) → workspaces 分桶 → 全局 vault → 约定）', () => {
  it('① env 最高优先', () => {
    expect(computeVaultPath('/env', '{"vault":"/c"}', '{"vault":"/s"}', '/h')).toBe('/env')
  })
  it('② config.json 次之', () => {
    expect(computeVaultPath(undefined, '{"vault":"/c"}', '{"vault":"/s"}', '/h')).toBe('/c')
  })
  it('③ 会话目录（骨架门控后传入）压过分桶映射与全局登记', () => {
    expect(computeVaultPath(undefined, undefined, '{"workspaces":{"/h":"/w"},"vault":"/s"}', '/h')).toBe('/h')
  })
  it('④ workspaces 分桶映射：本桶命中，他桶不干扰', () => {
    const st = JSON.stringify({ workspaces: { '/homevault': '/homevault', '/main': '/Users/x/sun-vault' } })
    expect(computeVaultPath(undefined, undefined, st, undefined, homedir(), '/homevault')).toBe('/homevault')
    expect(computeVaultPath(undefined, undefined, st, undefined, homedir(), '/main')).toBe('/Users/x/sun-vault')
    expect(computeVaultPath(undefined, undefined, st, undefined, homedir(), '/other')).toBe(join(homedir(), 'Workspace', 'sun-vault'))
  })
  it('⑤ 全局 vault 字段（显式镜像）在无桶命中时生效', () => {
    expect(computeVaultPath(undefined, undefined, '{"vault":"/s"}', undefined)).toBe('/s')
  })
  it('⑥ 全缺 → 默认约定 ~/Workspace/sun-vault', () => {
    expect(computeVaultPath(undefined, undefined, undefined, undefined, '/Users/x')).toBe('/Users/x/Workspace/sun-vault')
  })
  it('非法 JSON/非绝对路径被跳过', () => {
    expect(computeVaultPath(undefined, 'not-json', '{"vault":"relative"}', undefined, '/h')).toBe('/h/Workspace/sun-vault')
  })
})

describe('explicitVaultValue（①②⑤ 显式来源；兜底/会话目录/分桶映射不算）', () => {
  it('全空 → undefined', () => {
    expect(explicitVaultValue(undefined, undefined, undefined)).toBeUndefined()
  })
  it('坏 JSON / 相对路径 → 视为未配置', () => {
    expect(explicitVaultValue(undefined, 'not-json', '{"vault":"relative"}')).toBeUndefined()
  })
  it('env > config > state.vault', () => {
    expect(explicitVaultValue('/env', '{"vault":"/c"}', '{"vault":"/s"}')).toBe('/env')
    expect(explicitVaultValue(undefined, '{"vault":"/c"}', '{"vault":"/s"}')).toBe('/c')
    expect(explicitVaultValue(undefined, undefined, '{"vault":"/s"}')).toBe('/s')
  })
  it('只有 workspaces 映射（无全局 vault）→ 不算显式（不触发落盘）', () => {
    expect(explicitVaultValue(undefined, undefined, '{"workspaces":{"/h":"/h"}}')).toBeUndefined()
  })
})

describe('目录门控（cwdHasSkeleton / cwdIsVaultCandidate）', () => {
  it('非绝对/未定义 → 都拒绝', () => {
    expect(cwdHasSkeleton(undefined)).toBe(false)
    expect(cwdHasSkeleton('relative')).toBe(false)
    expect(cwdIsVaultCandidate(undefined)).toBe(false)
    expect(cwdIsVaultCandidate('relative/path')).toBe(false)
  })
  it('不存在的目录 → 都拒绝', () => {
    const p = join(tmpdir(), 'sun-nonexistent-' + Date.now())
    expect(cwdHasSkeleton(p)).toBe(false)
    expect(cwdIsVaultCandidate(p)).toBe(false)
  })
  it('空目录：无骨架、但是登记候选（新建工作区流）', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'sun-cand-'))
    try {
      expect(cwdHasSkeleton(empty)).toBe(false)
      expect(cwdIsVaultCandidate(empty)).toBe(true)
      await writeFile(join(empty, '.gitkeep'), '')
      expect(cwdIsVaultCandidate(empty)).toBe(true) // git init 过的空仓库也算
    } finally { await rm(empty, { force: true, recursive: true }) }
  })
  it('已含 90-Meta 骨架：两者都放行', async () => {
    const skel = await mkdtemp(join(tmpdir(), 'sun-cand-'))
    try {
      await mkdir(join(skel, '90-Meta'))
      expect(cwdHasSkeleton(skel)).toBe(true)
      expect(cwdIsVaultCandidate(skel)).toBe(true)
    } finally { await rm(skel, { force: true, recursive: true }) }
  })
  it('有内容而无骨架（代码仓库根/宿主 boot 桶）：都拒绝', async () => {
    const busy = await mkdtemp(join(tmpdir(), 'sun-cand-'))
    try {
      await writeFile(join(busy, 'README.md'), 'x')
      expect(cwdHasSkeleton(busy)).toBe(false)
      expect(cwdIsVaultCandidate(busy)).toBe(false)
    } finally { await rm(busy, { force: true, recursive: true }) }
  })
})

describe('registerVaultRootFromSession（分桶登记：候选目录 → workspaces[cwd]=cwd）', () => {
  it('空工作区 → 登记 workspaces 映射，不写全局 vault 字段（防多实例污染）', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-reg-'))
    process.env.DSH_HOME = home
    try {
      const ws = await mkdtemp(join(tmpdir(), 'sun-ws-'))
      expect(registerVaultRootFromSession(ws)).toBe(true)
      const st = JSON.parse(await readFile(join(home, '.dsh', 'state', 'sun-space', 'state.json'), 'utf8'))
      expect(st.workspaces).toEqual({ [ws]: ws })
      expect(st.vault).toBeUndefined() // 全局槽不承载桶登记
      // 同桶幂等；他桶另登记，互不覆盖
      expect(registerVaultRootFromSession(ws)).toBe(false)
      const ws2 = await mkdtemp(join(tmpdir(), 'sun-ws-'))
      expect(registerVaultRootFromSession(ws2)).toBe(true)
      const st2 = JSON.parse(await readFile(join(home, '.dsh', 'state', 'sun-space', 'state.json'), 'utf8'))
      expect(st2.workspaces).toEqual({ [ws]: ws, [ws2]: ws2 })
      await rm(ws, { force: true, recursive: true }); await rm(ws2, { force: true, recursive: true })
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('有内容而无骨架（宿主 boot 桶/仓库根）→ 拒绝且不写 state.json', async () => {
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
  it('非绝对路径/不存在的目录 → 拒绝', () => {
    expect(registerVaultRootFromSession(undefined)).toBe(false)
    expect(registerVaultRootFromSession('relative/path')).toBe(false)
    expect(registerVaultRootFromSession(join(tmpdir(), 'sun-nonexistent-' + Date.now()))).toBe(false)
  })
})

describe('publishVaultState（显式来源才落盘——防幽灵登记）', () => {
  it('无 env/config/全局登记 → 不写 state.json（v0.3.2 根因回归：兜底值不得固化成登记值）', async () => {
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
  it('config.json 有 vault → 落盘解析结果，且保留已有 workspaces 映射', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-pub-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'config.json'), JSON.stringify({ vault: '/Users/x/my-vault' }))
    await writeFile(join(dir, 'state.json'), JSON.stringify({ workspaces: { '/w': '/w' } }))
    process.env.DSH_HOME = home
    const savedEnv = process.env.SUN_VAULT
    delete process.env.SUN_VAULT
    try {
      publishVaultState()
      const st = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
      expect(st.vault).toBe('/Users/x/my-vault')
      expect(st.workspaces).toEqual({ '/w': '/w' }) // 分桶映射原样保留
      expect(st.updatedAt).toBeTruthy()
    } finally {
      if (savedEnv !== undefined) process.env.SUN_VAULT = savedEnv
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
})

describe('readStateSnapshot（sun_state_read 的诊断视图：登记了什么 vs 实际生效什么）', () => {
  it('无 config/state → 双 null，resolvedVault 走约定路径', async () => {
    const home = await mkdtemp(join(tmpdir(), 'snap-'))
    process.env.DSH_HOME = home
    try {
      const snap = readStateSnapshot(undefined, fresh())
      expect(snap.config).toBeNull()
      expect(snap.state).toBeNull()
      expect(snap.resolvedVault).toBe(join(homedir(), 'Workspace', 'sun-vault'))
    } finally { delete process.env.DSH_HOME; await rm(home, { force: true, recursive: true }) }
  })
  it('登记后快照可见分桶映射，且本桶会话解析命中登记值', async () => {
    const home = await mkdtemp(join(tmpdir(), 'snap-'))
    process.env.DSH_HOME = home
    const savedEnv = process.env.SUN_VAULT
    delete process.env.SUN_VAULT
    try {
      const ws = await mkdtemp(join(tmpdir(), 'snap-ws-')) // 空目录 = 候选
      expect(registerVaultRootFromSession(ws)).toBe(true)
      const snap = readStateSnapshot(ws, fresh())
      expect(snap.state?.workspaces?.[ws]).toBe(ws)
      expect(snap.resolvedVault).toBe(ws) // ④ 分桶命中
      await rm(ws, { force: true, recursive: true })
    } finally {
      if (savedEnv !== undefined) process.env.SUN_VAULT = savedEnv
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('config 覆盖时：登记（bucket）与生效（config）在快照里可比对——正是诊断场景', async () => {
    const home = await mkdtemp(join(tmpdir(), 'snap-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'config.json'), JSON.stringify({ vault: '/Users/x/my-vault' }))
    await writeFile(join(dir, 'state.json'), JSON.stringify({ workspaces: { '/Users/x/homevault': '/Users/x/homevault' } }))
    process.env.DSH_HOME = home
    try {
      const snap = readStateSnapshot('/Users/x/homevault', fresh())
      expect(snap.config).toEqual({ vault: '/Users/x/my-vault' })
      expect(snap.state?.workspaces?.['/Users/x/homevault']).toBe('/Users/x/homevault')
      expect(snap.resolvedVault).toBe('/Users/x/my-vault') // ② config 压过 ④ 分桶——快照让这层覆盖关系可见
    } finally { delete process.env.DSH_HOME; await rm(home, { force: true, recursive: true }) }
  })
})

describe('vaultPath / vaultPathForHost（运行期：门控 + 分桶 + 多实例隔离）', () => {
  it('多桶并存互不污染：homevault 桶登记后，主桶解析不受影响', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-iso-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'state.json'), JSON.stringify({ workspaces: { '/Users/x/homevault': '/Users/x/homevault' } }))
    process.env.DSH_HOME = home
    try {
      // homevault 桶（空目录、未登记骨架）→ ④ 映射命中
      expect(vaultPath('/Users/x/homevault', fresh())).toBe('/Users/x/homevault')
      // 主桶（有内容无骨架、未登记）→ 落到 ⑥ 约定
      expect(vaultPath('/Users/x/default-workspace', fresh())).toBe(join(homedir(), 'Workspace', 'sun-vault'))
      // 无 cwd：跟实例进程 cwd（本测试进程在仓库目录，未登记）→ ⑥ 约定
      expect(vaultPathForHost(fresh())).toBe(join(homedir(), 'Workspace', 'sun-vault'))
    } finally {
      delete process.env.DSH_HOME
      await rm(home, { force: true, recursive: true })
    }
  })
  it('骨架工作区（已初始化）压过分桶映射——目录本身即事实', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sun-iso-'))
    const dir = join(home, '.dsh', 'state', 'sun-space')
    const ws = await mkdtemp(join(tmpdir(), 'sun-ws-'))
    await mkdir(join(ws, '90-Meta'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'state.json'), JSON.stringify({ workspaces: { [ws]: '/elsewhere' } }))
    process.env.DSH_HOME = home
    try {
      expect(vaultPath(ws, fresh())).toBe(ws) // 骨架在，目录说了算
    } finally {
      delete process.env.DSH_HOME
      await rm(ws, { force: true, recursive: true }); await rm(home, { force: true, recursive: true })
    }
  })
})
