import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  it('② 实例目录 sun-space.config.json 的 vault 字段', async () => {
    delete process.env.SUN_VAULT
    const dir = await mkdtemp(join(tmpdir(), 'sun-vp-'))
    await writeFile(join(dir, 'sun-space.config.json'), JSON.stringify({ vault: '/custom/from-file' }))
    expect(resolveVaultPath(dir, '/Users/x')).toBe('/custom/from-file')
    await rm(dir, { force: true, recursive: true })
  })
  it('② 的非法值（非绝对路径）被拒，走 ③', async () => {
    delete process.env.SUN_VAULT
    const dir = await mkdtemp(join(tmpdir(), 'sun-vp-'))
    await writeFile(join(dir, 'sun-space.config.json'), JSON.stringify({ vault: 'relative/path' }))
    expect(resolveVaultPath(dir, '/Users/x')).toBe('/Users/x/Workspace/sun-vault')
    await rm(dir, { force: true, recursive: true })
  })
  it('③ 无 env 无配置文件 → 默认约定 ~/Workspace/sun-vault', () => {
    delete process.env.SUN_VAULT
    expect(resolveVaultPath('/nonexistent-dir-xyz', '/Users/x')).toBe('/Users/x/Workspace/sun-vault')
  })
  it('恢复环境', () => { if (REAL_ENV !== undefined) process.env.SUN_VAULT = REAL_ENV })
})
