/**
 * vault 访问：路径守卫 + frontmatter 解析/序列化。纯函数为主，可单测。
 * 写入纪律（架构 §3 / schemas.md）：Agent 可写目录 = 00-Inbox / 40-Journal / 50-Tasks / 90-Meta。
 */

import { join, resolve, sep } from 'node:path'

export const WRITABLE_ROOTS = ['00-Inbox', '40-Journal', '50-Tasks', '90-Meta']

export class VaultPathError extends Error {}

/** 校验并解析 vault 内相对路径；越界/不可写目录即抛错。 */
export function resolveSafe(vaultRoot: string, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0) throw new VaultPathError('empty path')
  if (rel.includes('\0')) throw new VaultPathError('nul byte')
  const abs = resolve(vaultRoot, rel)
  const root = resolve(vaultRoot) + sep
  if (!abs.startsWith(root)) throw new VaultPathError(`escapes vault root: ${rel}`)
  const first = rel.split('/')[0]
  if (!WRITABLE_ROOTS.includes(first)) throw new VaultPathError(`not a writable root: ${first}`)
  return abs
}

/** 解析 YAML frontmatter（扁平 key: value 与一行式数组）；无 frontmatter 返回 {}。 */
export function parseFrontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return {}
  const out: Record<string, string | string[]> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const [, key, raw] = kv
    const v = raw.trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1)
      out[key] = inner.length === 0 ? [] : inner.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
    } else {
      out[key] = v.replace(/^["']|["']$/g, '')
    }
  }
  return out
}

/** 序列化 frontmatter（稳定顺序：type,id,status 在前，其余按插入序）。 */
export function serializeFrontmatter(meta: Record<string, string | string[]>): string {
  const order = ['type', 'id', 'status', 'source', 'source_id']
  const keys = [
    ...order.filter(k => k in meta),
    ...Object.keys(meta).filter(k => !order.includes(k)),
  ]
  const lines = keys.map((k) => {
    const v = meta[k]
    if (Array.isArray(v)) {
      return v.length === 0 ? `${k}: []` : `${k}: [${v.map(s => `"${s}"`).join(', ')}]`
    }
    return `${k}: ${v}`
  })
  return `---\n${lines.join('\n')}\n---\n`
}

/** 从笔记文本中抽取"frontmatter + 首段"的 Inline 摘要（链式召回约定，架构 §3.5）。 */
export function inlineSummary(text: string, maxChars = 600): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const firstPara = body.split(/\r?\n\r?\n/).find(p => p.trim().length > 0) ?? ''
  const summary = firstPara.trim()
  return summary.length <= maxChars ? summary : `${summary.slice(0, maxChars)}…`
}

/** 把 frontmatter 与正文分离；无 frontmatter 时 body 为原文。 */
export function splitFrontmatter(text: string): { meta: Record<string, string | string[]>; body: string; hadMeta: boolean } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text, hadMeta: false }
  return { meta: parseFrontmatter(text), body: text.slice(m[0].length), hadMeta: true }
}

/** 局部更新 frontmatter 字段（正文不动）——消除"整写覆盖未见正文"的风险（日报实测暴露的缺口）。 */
export function updateFrontmatter(
  text: string,
  patch: Record<string, string>,
): string {
  const { meta, body, hadMeta } = splitFrontmatter(text)
  // 本地时间（非 UTC）：toISOString 会差 8 小时（T-05 实测教训）
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}+08:00`
  const merged = { ...meta, ...patch, updated: local }
  const fm = serializeFrontmatter(merged)
  return hadMeta ? `${fm}${body}` : `${fm}\n${body}`
}
