import { describe, expect, it } from 'vitest'
import { setFrontmatterField } from '../src/vault'

// 只改一行：其余内容逐字节保留（对照 updateFrontmatter——它会把整块重新序列化，块式数组会丢）
describe('setFrontmatterField', () => {
  const note = ['---', 'type: task', 'tags:', '  - "work"', 'artifacts:', '  - "a.md"', '  - "b.md"', 'priority: "high: yes"', '---', '', '正文', '---', '也是正文'].join('\n')

  it('没有该字段 → 插在闭合 --- 之前，其余逐字节不动', () => {
    expect(setFrontmatterField(note, 'session', 's1')).toBe(note.replace('priority: "high: yes"\n---', 'priority: "high: yes"\nsession: s1\n---'))
  })
  it('已有该字段 → 只替换那一行', () => {
    const withSession = note.replace('type: task\n', 'type: task\nsession: old-id  # 注释\n')
    expect(setFrontmatterField(withSession, 'session', 's2')).toBe(note.replace('type: task\n', 'type: task\nsession: s2\n'))
  })
  it('不会误伤同前缀的字段', () => {
    const prefixed = note.replace('type: task\n', 'type: task\nsession_id: keep\n')
    expect(setFrontmatterField(prefixed, 'session', 's3')).toBe(prefixed.replace('priority: "high: yes"\n---', 'priority: "high: yes"\nsession: s3\n---'))
  })
  it('整篇没有 frontmatter → 头部补一块；正文里的 --- 不被当成 frontmatter', () => {
    expect(setFrontmatterField('# 标题\n\n---\n正文', 'session', 's4')).toBe('---\nsession: s4\n---\n# 标题\n\n---\n正文')
  })
  it('闭合 --- 在文件末尾（无尾随换行）也认', () => {
    expect(setFrontmatterField('---\ntype: task\n---', 'session', 's5')).toBe('---\ntype: task\nsession: s5\n---')
  })
  it('CRLF 行尾保持原样', () => {
    expect(setFrontmatterField('---\r\ntype: task\r\n---\r\n正文', 'session', 's6')).toBe('---\r\ntype: task\r\nsession: s6\r\n---\r\n正文')
  })
  it('字段名里的正则元字符被转义', () => {
    expect(setFrontmatterField('---\na.b: 1\n---\n', 'a.b', '2')).toBe('---\na.b: 2\n---\n')
    expect(setFrontmatterField('---\naxb: 1\n---\n', 'a.b', '2')).toBe('---\naxb: 1\na.b: 2\n---\n')
  })
})
