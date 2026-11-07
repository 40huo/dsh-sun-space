/**
 * sun-router 预设的子插件：注册 4 个 sun_* 应用工具。
 * sun_route 由官方 @deepseek-ai/dsh-tool-subagent 实例提供（cordis.patch.yml：
 * toolName: sun_route + agentPreset: sun-worker）——子代白名单由组合机制保证。
 * 工具契约：ToolDefinition = { name, description, parameters, output:{schema,render}, execute }。
 */
import type { Context } from '@deepseek-ai/cordis'
import { readFile, readdir, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { inlineSummary, parseFrontmatter, resolveSafe, VaultPathError } from './vault'
import { currentUserId, dingSelf, notifySelf } from './dws'

export const inject = ['tools']

export const VAULT = process.env.SUN_VAULT ?? `${process.env.HOME}/Workspace/sun-vault`

const text = (s: string) => [{ type: 'text', text: s }]
const ok = (value: unknown) => ({
  type: 'object',
  properties: { ok: { type: 'boolean' }, note: { type: 'string' }, data: { type: 'object' } },
  required: ['ok'],
})

/** 深度剔除 undefined 字段/数组项——DSH 工具契约要求无损 JSON（E2E 发现：undefined 导致输出序列化失败）。 */
export function lossless<T>(value: T): T {
  if (value === undefined) return null as T
  if (Array.isArray(value)) return value.map(v => lossless(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[k] = lossless(v)
    }
    return out as T
  }
  return value
}

function def(name: string, description: string, parameters: unknown, execute: (args: any) => Promise<unknown>) {
  return {
    name,
    description,
    parameters,
    output: { schema: ok({}), render: (args: unknown, value: unknown) => text(JSON.stringify(value)) },
    execute: async (args: unknown) => lossless(await execute(args ?? {})),
  }
}

/** info 级打扰预算：每日 ≤5 条（ask/urgent 不受限）。进程内计数。 */
const infoBudget = { date: '', sent: 0 }

/** DING 强推级别（自发自收消息不触发客户端推送，E2E 用户反馈）。可用 env 覆盖，如 "urgent"。 */
const DING_LEVELS = new Set((process.env.SUN_DING_LEVELS ?? 'ask,urgent').split(','))

export function apply(ctx: Context) {
  ctx.tools.register(def(
    'sun_read',
    '读取工作空间状态：journal（当日日记）| tasks（任务列表与状态）| triggers（Source 触发队列，最新在前）| runbook（行为规则）| memory（关于用户）| note（任意 vault 文件的 Inline 摘要）。',
    {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['journal', 'tasks', 'triggers', 'runbook', 'memory', 'note'] },
        date: { type: 'string', description: 'journal 用：YYYY-MM-DD，默认今天' },
        path: { type: 'string', description: 'note 用：vault 相对路径' },
      },
      required: ['what'],
    },
    async (args: { what: string; date?: string; path?: string }) => {
      try {
        if (args.what === 'triggers') {
          const dir = resolveSafe(VAULT, '90-Meta/triggers')
          try {
            const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10)
            const triggers = []
            for (const f of files) {
              const raw = await readFile(join(dir, f), 'utf8')
              const parsed = JSON.parse(raw) as { label?: string; payload?: unknown }
              triggers.push({ file: f, label: parsed.label, payload: parsed.payload })
            }
            return { ok: true, data: { count: triggers.length, triggers } }
          } catch {
            return { ok: true, data: { count: 0, triggers: [] } }
          }
        }
        if (args.what === 'journal') {
          const d = args.date ?? new Date().toISOString().slice(0, 10)
          const p = resolveSafe(VAULT, `40-Journal/${d}.md`)
          const raw = await readFile(p, 'utf8')
          return { ok: true, data: { frontmatter: parseFrontmatter(raw), summary: inlineSummary(raw) } }
        }
        if (args.what === 'tasks') {
          const dir = resolveSafe(VAULT, '50-Tasks')
          const files = (await readdir(dir)).filter(f => f.endsWith('.md'))
          const tasks = []
          for (const f of files) {
            const raw = await readFile(join(dir, f), 'utf8')
            const fm = parseFrontmatter(raw)
            tasks.push({ id: fm.id, status: fm.status, source: fm.source, source_id: fm.source_id, priority: fm.priority, journal: fm.journal })
          }
          return { ok: true, data: { count: tasks.length, tasks } }
        }
        if (args.what === 'runbook' || args.what === 'memory') {
          const p = resolveSafe(VAULT, `90-Meta/${args.what}.md`)
          return { ok: true, data: { text: (await readFile(p, 'utf8')).slice(0, 8000) } }
        }
        if (args.what === 'note') {
          if (!args.path) return { ok: false, note: 'note 需要 path' }
          const raw = await readFile(resolveSafe(VAULT, args.path), 'utf8')
          return { ok: true, data: { frontmatter: parseFrontmatter(raw), summary: inlineSummary(raw) } }
        }
        return { ok: false, note: `unknown what: ${args.what}` }
      } catch (e) {
        if (e instanceof VaultPathError) return { ok: false, note: `路径被拒绝: ${e.message}` }
        return { ok: false, note: String((e as Error).message).slice(0, 200) }
      }
    },
  ))

  ctx.tools.register(def(
    'sun_vault_write',
    '受限写入 vault：仅 00-Inbox / 40-Journal / 50-Tasks / 90-Meta 四个根；mode=append 追加或 overwrite 整写。',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault 相对路径，如 50-Tasks/T-20261107-01.md' },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['overwrite', 'append'] },
      },
      required: ['path', 'content'],
    },
    async (args: { path: string; content: string; mode?: string }) => {
      try {
        const p = resolveSafe(VAULT, args.path)
        await mkdir(join(p, '..'), { recursive: true })
        if (args.mode === 'append') await appendFile(p, args.content, 'utf8')
        else await writeFile(p, args.content, 'utf8')
        return { ok: true, data: { path: args.path, bytes: Buffer.byteLength(args.content) } }
      } catch (e) {
        if (e instanceof VaultPathError) return { ok: false, note: `路径被拒绝: ${e.message}` }
        return { ok: false, note: String((e as Error).message).slice(0, 200) }
      }
    },
  ))

  ctx.tools.register(def(
    'sun_notify',
    '推送钉钉通知给用户（插件代发，不经 LLM）。level=info 攒批（每日≤5，无推送）/ ask 立即+DING 强推 / urgent 立即+DING。文本 ≤100 字，结论先行。',
    {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['info', 'ask', 'urgent'] },
        text: { type: 'string' },
      },
      required: ['level', 'text'],
    },
    async (args: { level: string; text: string }) => {
      const today = new Date().toISOString().slice(0, 10)
      if (infoBudget.date !== today) { infoBudget.date = today; infoBudget.sent = 0 }
      if (args.level === 'info' && infoBudget.sent >= 5) {
        return { ok: false, note: 'info 打扰预算已用尽（5/日）——改为写入 Journal 通知流水' }
      }
      const uid = await currentUserId()
      const res = await notifySelf(uid, `[Sun·${args.level}] ${args.text}`)
      if (args.level === 'info') infoBudget.sent++
      // ask/urgent 补 DING 强推（自发自收消息无客户端推送）
      let ding: { ok: boolean } | undefined
      if (DING_LEVELS.has(args.level)) {
        try {
          ding = await dingSelf(uid, `[Sun·${args.level}] ${args.text}`)
        } catch (e) {
          ding = { ok: false }
          ctx.logger?.warn?.(`[sun-space] ding failed: ${String((e as Error).message).slice(0, 120)}`)
        }
      }
      return { ok: true, data: { message: res, ding } }
    },
  ))

  ctx.logger?.info?.('[sun-space] router tools registered: sun_read sun_vault_write sun_notify (+sun_route via tool-subagent)')
}
