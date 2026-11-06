import { describe, expect, it } from 'vitest'
import { inlineSummary, parseFrontmatter, resolveSafe, serializeFrontmatter, VaultPathError } from '../src/vault'
import { diff, type DwsSnapshot } from '../src/dws'

describe('vault resolveSafe', () => {
  const root = '/tmp/vault-test'
  it('admits writable roots', () => {
    expect(resolveSafe(root, '50-Tasks/T-20261107-01.md')).toContain('50-Tasks')
    expect(resolveSafe(root, '90-Meta/triggers/x.json')).toContain('triggers')
  })
  it('rejects non-writable roots', () => {
    for (const p of ['10-Projects/x.md', '20-Areas/work/x.md', '30-Knowledge/x.md', '60-Archive/x.md', 'README.md']) {
      expect(() => resolveSafe(root, p)).toThrow(VaultPathError)
    }
  })
  it('rejects traversal', () => {
    expect(() => resolveSafe(root, '50-Tasks/../../etc/passwd')).toThrow(VaultPathError)
    expect(() => resolveSafe(root, '../outside.md')).toThrow(VaultPathError)
  })
})

describe('frontmatter', () => {
  it('parses flat keys and inline arrays', () => {
    const fm = parseFrontmatter('---\ntype: task\nid: T-20261107-01\nstatus: proposed\ntags: [work, onboarding]\nartifacts: []\n---\n\n## 结论\n')
    expect(fm.type).toBe('task')
    expect(fm.tags).toEqual(['work', 'onboarding'])
    expect(fm.artifacts).toEqual([])
  })
  it('serializes with stable order', () => {
    const y = serializeFrontmatter({ status: 'done', type: 'task', id: 'T-1', tags: ['a'] })
    expect(y.indexOf('type:')).toBeLessThan(y.indexOf('status:'))
    expect(y).toContain('tags: ["a"]')
  })
  it('returns empty object without frontmatter', () => {
    expect(parseFrontmatter('just text')).toEqual({})
  })
  it('inlineSummary strips frontmatter and caps length', () => {
    const s = inlineSummary('---\ntype: task\n---\n\n第一段结论。\n\n第二段。', 3)
    expect(s.startsWith('第一段')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    const full = inlineSummary('---\ntype: task\n---\n\n第一段结论。\n\n第二段。')
    expect(full).toBe('第一段结论。')
  })
})

describe('snapshot diff', () => {
  const prev: DwsSnapshot = {
    todos: [{ taskId: '1', subject: 'old' }],
    approvals: [{ id: 'oa-9' }],
    events: [],
  }
  it('detects new todos and approvals', () => {
    const d = diff(prev, {
      todos: [{ taskId: '1', subject: 'old' }, { taskId: '2', subject: 'new' }],
      approvals: [{ id: 'oa-9' }, { id: 'oa-10' }],
      events: [],
    })
    expect(d.newTodos).toEqual([{ id: '2', subject: 'new' }])
    expect(d.newApprovals).toEqual(['oa-10'])
  })
  it('handles absent previous snapshot', () => {
    const d = diff(null, { todos: [{ taskId: 'x', subject: 's' }], approvals: [], events: [] })
    expect(d.newTodos).toHaveLength(1)
  })
})
