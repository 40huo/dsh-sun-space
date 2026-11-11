import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVaultPath } from '../src/vault-path'

describe('resolveVaultPath（① env ② 实例目录配置文件 ③ 默认约定）', () => {
  const REAL_ENV = process.env.SUN_VAULT

  it('① env 优先', () => {
    process.env.SUN_VAULT = '/custom/from-env'
    expect(resolveVaultPath('/anywhere', '/Users/x')).toBe('/custom/from-env')
    delete process.env.SUN_VAULT
  })
  it('② 状态目录 config.json 的 vault 字段（~/.dsh/state/sun-space/ 约定）', async () => {
    delete process.env.SUN_VAULT
    const home = await mkdtemp(join(tmpdir(), 'sun-home-'))
    const cfgDir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(cfgDir, { recursive: true })
    await writeFile(join(cfgDir, 'config.json'), JSON.stringify({ vault: '/custom/from-file' }))
    expect(resolveVaultPath(home, cfgDir)).toBe('/custom/from-file')
    await rm(home, { force: true, recursive: true })
  })
  it('② 的非法值（非绝对路径）被拒，走 ③', async () => {
    delete process.env.SUN_VAULT
    const home = await mkdtemp(join(tmpdir(), 'sun-home-'))
    const cfgDir = join(home, '.dsh', 'state', 'sun-space')
    await mkdir(cfgDir, { recursive: true })
    await writeFile(join(cfgDir, 'config.json'), JSON.stringify({ vault: 'relative/path' }))
    expect(resolveVaultPath(home, cfgDir)).toBe(join(home, 'Workspace', 'sun-vault'))
    await rm(home, { force: true, recursive: true })
  })
  it('③ 无 env 无 config → 默认约定 ~/Workspace/sun-vault', () => {
    delete process.env.SUN_VAULT
    const home = '/Users/x'
    const cfgDir = join(tmpdir(), 'sun-empty-' + Date.now())
    expect(resolveVaultPath(home, cfgDir)).toBe('/Users/x/Workspace/sun-vault')
  })
  it('恢复环境', () => { if (REAL_ENV !== undefined) process.env.SUN_VAULT = REAL_ENV })
})
