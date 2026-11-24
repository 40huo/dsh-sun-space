/**
 * vault 访问：路径守卫 + frontmatter 解析/序列化。纯函数为主，可单测。
 * 写入纪律（架构 §3 / schemas.md）：Agent 可写目录 = 00-Inbox / 40-Journal / 50-Tasks / 90-Meta。
 */

import { join, resolve, sep } from 'node:path'

export const WRITABLE_ROOTS = ['00-Inbox', '40-Journal', '50-Tasks', '90-Meta']

/** 可读目录 ⊇ 可写目录：链式召回需要读知识区（架构 §8.5 可放行级——读一切我可见的数据）。 */
export const READABLE_ROOTS = ['00-Inbox', '10-Projects', '20-Areas', '30-Knowledge', '40-Journal', '50-Tasks', '60-Archive', '90-Meta']

export class VaultPathError extends Error {}

function resolveWithin(vaultRoot: string, rel: string, roots: string[], kind: string): string {
  if (typeof rel !== 'string' || rel.length === 0) throw new VaultPathError('empty path')
  if (rel.includes('\0')) throw new VaultPathError('nul byte')
  const abs = resolve(vaultRoot, rel)
  const root = resolve(vaultRoot) + sep
  if (!abs.startsWith(root)) throw new VaultPathError(`escapes vault root: ${rel}`)
  const first = rel.split('/')[0]
  if (!roots.includes(first)) throw new VaultPathError(`not a ${kind} root: ${first}`)
  return abs
}

/** 校验并解析 vault 内相对路径；越界/不可写目录即抛错。 */
export function resolveSafe(vaultRoot: string, rel: string): string {
  return resolveWithin(vaultRoot, rel, WRITABLE_ROOTS, 'writable')
}

/** 只读访问（sun_read 链式召回用）：放行全部知识区，写纪律不受影响。 */
export function resolveRead(vaultRoot: string, rel: string): string {
  return resolveWithin(vaultRoot, rel, READABLE_ROOTS, 'readable')
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

/** 本地日期 YYYY-MM-DD（非 UTC）：toISOString 在北京时间 0~8 点会取到昨天（T-05 教训）。 */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本地时间戳 YYYY-MM-DDTHH:mm，无时区后缀：Obsidian/Bases 对带偏移的 datetime 会换算显示差 8 小时（2026-11-08 修复），无后缀则按原文显示。 */
export function localStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 局部更新 frontmatter 字段（正文不动）——消除"整写覆盖未见正文"的风险（日报实测暴露的缺口）。 */
export function updateFrontmatter(
  text: string,
  patch: Record<string, string>,
): string {
  const { meta, body, hadMeta } = splitFrontmatter(text)
  const merged = { ...meta, ...patch, updated: localStamp() }
  const fm = serializeFrontmatter(merged)
  return hadMeta ? `${fm}${body}` : `${fm}\n${body}`
}

/** 字段名里需要转义的正则元字符。 */
const RX_SPECIAL = /[.*+?^${}()|[\]\\]/g

/** 只改 frontmatter 里的一个字段行，其余内容逐字节保留。
 *  与 updateFrontmatter 的区别：后者把整块 frontmatter 解析后重新序列化，块式数组等它不认识的写法会丢
 * （WORKPLAN 复审 backlog ①）；"顺手补一个字段"的回写不能冒这个险。
 *  已有该字段行 → 原地替换；没有 → 插在闭合 --- 之前；整篇没有 frontmatter → 头部补一块。
 *  value 原样写入，仅用于不需要引号的简单标量（会话 id 等）。 */
export function setFrontmatterField(text: string, key: string, value: string): string {
  const line = `${key}: ${value}`
  const m = /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n|$)/.exec(text)
  if (!m) return `---\n${line}\n---\n${text}`
  const [, openNl, inner, closeNl, trailingNl] = m
  const existing = new RegExp(`^${key.replace(RX_SPECIAL, '\\$&')}:[^\\r\\n]*`, 'm')
  const nextInner = existing.test(inner) ? inner.replace(existing, () => line) : inner ? `${inner}${closeNl}${line}` : line
  return `---${openNl}${nextInner}${closeNl}---${trailingNl}${text.slice(m[0].length)}`
}
