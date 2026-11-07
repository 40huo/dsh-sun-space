import { describe, expect, it } from 'vitest'
import { inlineSummary, localDate, localStamp, parseFrontmatter, resolveRead, resolveSafe, serializeFrontmatter, updateFrontmatter, VaultPathError } from '../src/vault'
import { diff, type DwsSnapshot } from '../src/dws'

describe('updateFrontmatter', () => {
  it('patches fields and keeps body untouched', () => {
    const src = '---\ntype: task\nstatus: proposed\nconfirmations: 0\n---\n\n## 结论\nABC\n'
    const out = updateFrontmatter(src, { status: 'running', confirmations: '1' })
    expect(out).toContain('status: running')
    expect(out).toContain('confirmations: 1')
    expect(out).toContain('## 结论\nABC\n')
    expect(out).not.toContain('status: proposed')
  })
  it('stamps updated automatically', () => {
    const out = updateFrontmatter('---\ntype: daily\n---\nbody', { morning: 'confirmed' })
    expect(out).toContain('morning: confirmed')
    expect(out).toContain('updated: 2026-')
  })
  it('stamps updated as naive local time (no timezone suffix — Obsidian 显示差 8h 教训)', () => {
    const out = updateFrontmatter('---\ntype: task\n---\nbody', {})
    const m = /updated: (\S+)/.exec(out)
    expect(m).not.toBeNull()
    expect(m![1]).not.toMatch(/[+Z]/)
    expect(m![1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
  it('localDate/localStamp follow local wall clock, not UTC', () => {
    expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(localDate()).toBe(new Date().toLocaleDateString('sv-SE'))
    expect(localStamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
  it('adds frontmatter to files without one', () => {
    const out = updateFrontmatter('plain body', { type: 'capture' })
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('type: capture')
    expect(out).toContain('plain body')
  })
})

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

describe('vault resolveRead（链式召回只读白名单）', () => {
  const root = '/tmp/vault-test'
  it('放行知识区（架构 §8.5 可放行级：读一切我可见的数据）', () => {
    for (const p of ['30-Knowledge/dws.md', '20-Areas/work-dingtalk/index.md', '10-Projects/sun/p.md', '60-Archive/T-old.md']) {
      expect(resolveRead(root, p)).toContain(p.split('/')[0])
    }
  })
  it('仍拒绝越界与白名单外根', () => {
    expect(() => resolveRead(root, '../outside.md')).toThrow(VaultPathError)
    expect(() => resolveRead(root, '99-Tmp/x.md')).toThrow(VaultPathError)
  })
  it('写白名单不受影响：resolveSafe 仍拒知识区', () => {
    expect(() => resolveSafe(root, '30-Knowledge/x.md')).toThrow(VaultPathError)
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
