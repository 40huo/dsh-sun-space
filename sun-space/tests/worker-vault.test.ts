import { describe, expect, it } from 'vitest'
import { artifactPath } from '../src/worker-vault'
import { VaultPathError } from '../src/vault'

describe('sun_artifact_write path', () => {
  it('builds controlled artifact path', () => {
    expect(artifactPath('T-20261107-99', 'summary.md')).toBe('50-Tasks/artifacts/T-20261107-99/summary.md')
  })
  it('rejects bad task ids', () => {
    expect(() => artifactPath('t-1', 'a.md')).toThrow(VaultPathError)
    expect(() => artifactPath('../../etc', 'passwd')).toThrow(VaultPathError)
    expect(() => artifactPath('', 'a.md')).toThrow(VaultPathError)
  })
  it('rejects traversal filenames', () => {
    expect(() => artifactPath('T-20261107-99', '../x.md')).toThrow(VaultPathError)
    expect(() => artifactPath('T-20261107-99', 'a/b.md')).toThrow(VaultPathError)
    expect(() => artifactPath('T-20261107-99', '.env')).toThrow(VaultPathError)
  })
})
