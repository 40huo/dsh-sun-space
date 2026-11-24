/**
 * sun-router 预设的子插件：注册 5 个 sun_* 应用工具（读状态 / 落库 / 状态登记），并把子会话 id 回写任务笔记。
 * 派发不在代码里：sun_route 是官方 @deepseek-ai/dsh-tool-subagent 的实例（cordis.patch.yml：
 * toolName: sun_route + agentPreset: sun-worker + maxDepth: 1）——工具随宿主一起维护，子代白名单由组合保证。
 * 插件不调 startActivation 等宿主内部接口：宿主 rc.1→rc.3 把它的参数从 spec.request.* 摊平成 spec.*，
 * 手写包装在桌面版上一调即崩（0.3.8 及之前）。
 * 工具契约：ToolDefinition = { name, description, parameters, output:{schema,render}, execute }。
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, readdir, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { inlineSummary, localDate, parseFrontmatter, resolveRead, resolveSafe, setFrontmatterField, updateFrontmatter, VaultPathError } from './vault'

export const inject = ['tools']

import { cwdIsVaultCandidate, readStateSnapshot, registerVaultRootFromSession, setRouterSession, vaultPath } from './vault-path'

/** 从工具执行上下文提取本会话 id（sun_state_write {"router":true} 用）。防御式：形状未知时返回 undefined。 */
function sessionIdOf(exec: unknown): string | undefined {
  const e = exec as { agent?: { id?: unknown; session?: { id?: unknown; header?: { id?: unknown } } } } | undefined
  const id = e?.agent?.session?.header?.id ?? e?.agent?.session?.id ?? e?.agent?.id
  return typeof id === 'string' && id.startsWith('session-') ? id : undefined
}

/** 从工具执行上下文提取会话工作目录（用户在哪个工作区开会话，vault 就解析到哪）。防御式：形状未知时返回 undefined。 */
function sessionCwdOf(exec: unknown): string | undefined {
  const e = exec as { agent?: { session?: { cwd?: unknown; header?: { cwd?: unknown } } }; session?: { cwd?: unknown } } | undefined
  const c = e?.agent?.session?.cwd ?? e?.agent?.session?.header?.cwd ?? e?.session?.cwd
  return typeof c === 'string' && c.startsWith('/') ? c : undefined
}

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

function def(name: string, description: string, parameters: unknown, execute: (args: any, exec?: unknown) => Promise<unknown>) {
  return {
    name,
    description,
    parameters,
    output: { schema: ok({}), render: (args: unknown, value: unknown) => text(JSON.stringify(value)) },
    execute: async (args: unknown, exec: unknown) => lossless(await execute(args ?? {}, exec)),
  }
}

export function apply(ctx: Context) {
  ctx.tools.register(def(
    'sun_read',
    '读取工作空间状态：journal（当日日记）| tasks（任务列表与状态）| triggers（Source 触发队列，最新在前）| runbook（行为规则）| memory（关于用户）| note（vault 各区文件 Inline 摘要——含知识区 10/20/30 只读，链式召回用）。',
    {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['journal', 'tasks', 'triggers', 'runbook', 'memory', 'note'] },
        date: { type: 'string', description: 'journal 用：YYYY-MM-DD，默认今天' },
        path: { type: 'string', description: 'note/journal 用：vault 相对路径' },
        full: { type: 'boolean', description: 'note/journal 用：true 返回全文（≤8000 字）而非 Inline 摘要' },
      },
      required: ['what'],
    },
    async (args: { what: string; date?: string; path?: string; full?: boolean }, exec?: unknown) => {
      try {
        if (args.what === 'triggers') {
          const dir = resolveSafe(vaultPath(sessionCwdOf(exec)), '90-Meta/triggers')
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
          const d = args.date ?? localDate()
          const p = resolveRead(vaultPath(sessionCwdOf(exec)), `40-Journal/${d}.md`)
          const raw = await readFile(p, 'utf8')
          if (args.full) return { ok: true, data: { text: raw.slice(0, 8000) } }
          return { ok: true, data: { frontmatter: parseFrontmatter(raw), summary: inlineSummary(raw) } }
        }
        if (args.what === 'tasks') {
          const dir = resolveSafe(vaultPath(sessionCwdOf(exec)), '50-Tasks')
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
          const p = resolveSafe(vaultPath(sessionCwdOf(exec)), `90-Meta/${args.what}.md`)
          return { ok: true, data: { text: (await readFile(p, 'utf8')).slice(0, 8000) } }
        }
        if (args.what === 'note') {
          if (!args.path) return { ok: false, note: 'note 需要 path' }
          const raw = await readFile(resolveRead(vaultPath(sessionCwdOf(exec)), args.path), 'utf8')
          if (args.full) return { ok: true, data: { text: raw.slice(0, 8000) } }
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
    async (args: { path: string; content: string; mode?: string }, exec?: unknown) => {
      try {
        const root = vaultPath(sessionCwdOf(exec))
        const p = resolveSafe(root, args.path)
        await mkdir(join(p, '..'), { recursive: true })
        if (args.mode === 'append') await appendFile(p, args.content, 'utf8')
        else await writeFile(p, args.content, 'utf8')
        // vault 字段回显实际解析根：初始化指令据此核对/报告知识库根，勿凭工作目录猜测
        return { ok: true, data: { path: args.path, vault: root, bytes: Buffer.byteLength(args.content) } }
      } catch (e) {
        if (e instanceof VaultPathError) return { ok: false, note: `路径被拒绝: ${e.message}` }
        return { ok: false, note: String((e as Error).message).slice(0, 200) }
      }
    },
  ))

  // sun_notify 已于 0.3.6 移除——通知不再依赖 dws/钉钉通道：
  // 人侧提醒交给 DSH 通知类插件（监听宿主事件：完成/提问/等待批准/子任务完成，浏览器弹出）；
  // Router 需要人决策时直接用原生 ask_user_question 决策卡（即"提问"事件，通知插件会即时提醒）。

  ctx.tools.register(def(
    'sun_vault_meta',
    '局部更新笔记 frontmatter 字段（正文完全不动）。用于状态流转（proposed→running→done）、confirmations 计数等，避免整写覆盖。',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'vault 相对路径' },
        fields: {
          type: 'object',
          description: '要更新的字段键值对（值一律字符串；数组字段用逗号分隔）',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path', 'fields'],
    },
    async (args: { path: string; fields: Record<string, string> }, exec?: unknown) => {
      try {
        const p = resolveSafe(vaultPath(sessionCwdOf(exec)), args.path)
        const raw = await readFile(p, 'utf8')
        const updated = updateFrontmatter(raw, args.fields)
        await writeFile(p, updated, 'utf8')
        return { ok: true, data: { path: args.path, fields: Object.keys(args.fields) } }
      } catch (e) {
        if (e instanceof VaultPathError) return { ok: false, note: `路径被拒绝: ${e.message}` }
        return { ok: false, note: String((e as Error).message).slice(0, 200) }
      }
    },
  ))

  ctx.tools.register(def(
    'sun_state_read',
    '读取插件状态目录（~/.dsh/state/sun-space/）的登记与解析视图：config（用户手写 vault 覆盖）、state（vaults 分桶登记 {dir, router?} + 全局 vault 镜像）、resolvedVault（本会话实际生效的知识库根）。vault 解析诊断 / 晨报自检"登记 vs 生效"比对用。',
    { type: 'object', properties: {} },
    async (_args: Record<string, never>, exec?: unknown) => {
      try {
        return { ok: true, data: readStateSnapshot(sessionCwdOf(exec)) }
      } catch (e) {
        return { ok: false, note: String((e as Error).message).slice(0, 200) }
      }
    },
  ))

  ctx.tools.register(def(
    'sun_state_write',
    '插件状态登记（~/.dsh/state/sun-space/，零审批，值由系统从会话上下文派生，不接受手工传路径/id）：{"vault": true} 把当前会话工作目录登记为本工作区的 vault 根（仅空目录或已含 90-Meta 骨架的目录可登记；一桶一 vault 不影响其他工作区）；{"router": true} 把本会话登记为该知识库的当前 Router（登记落在当前生效的知识库根上，即 sun_state_read 的 resolvedVault，而非会话工作目录；轮换/自检修正的落点，v0.3.5 起替代 vault 内 90-Meta/system/state.json 自登记）。二者可各用一次。',
    {
      type: 'object',
      properties: {
        vault: { type: 'boolean', description: '登记本会话工作目录为 vault 根（唯一合法值 true）' },
        router: { type: 'boolean', description: '登记本会话为该知识库的当前 Router（唯一合法值 true）' },
      },
    },
    async (args: { vault?: boolean; router?: boolean }, exec?: unknown) => {
      const cwd = sessionCwdOf(exec)
      if (args.router === true) {
        if (!cwd) return { ok: false, note: '无法从会话上下文提取工作目录（绝对路径）' }
        const sid = sessionIdOf(exec)
        if (!sid) return { ok: false, note: '无法从会话上下文提取本会话 id' }
        try {
          // 登记落在"本会话实际生效的 vault 根"上，而不是会话工作目录。vaults[] 的 dir 同时是第 ④ 级
          // 解析的桶键——按工作目录落键，一个非 vault 的工作目录（仓库根、已有文件的 boot 桶）会凭一条
          // router 登记变成整个工作区生效的 vault 根，绕过 {"vault":true} 的候选门控（0.3.7 及之前）。
          // 落在生效根上则不改变任何会话的解析结果；config.json 把库放在工作区之外时也登记得上。
          const vault = vaultPath(cwd)
          const changed = setRouterSession(vault, sid) // false = 同会话已登记（幂等）
          const snap = readStateSnapshot(cwd)
          const entry = snap.state?.vaults?.find(e => e.dir === vault) ?? null
          return { ok: true, data: { vault, bucket: cwd, router: entry?.router ?? null, changed, resolvedVault: snap.resolvedVault } }
        } catch (e) {
          return { ok: false, note: String((e as Error).message).slice(0, 200) }
        }
      }
      if (args.vault === true) {
        if (!cwd) return { ok: false, note: '无法从会话上下文提取工作目录（绝对路径）' }
        if (process.env.SUN_VAULT?.trim()) return { ok: false, note: `SUN_VAULT 已显式钉死（${process.env.SUN_VAULT}），不登记——尊重显式覆盖` }
        if (!cwdIsVaultCandidate(cwd)) return { ok: false, note: `${cwd} 不是 vault 候选（须为空目录或已含 90-Meta 骨架）——有内容而无骨架的工作区目录不登记` }
        try {
          const changed = registerVaultRootFromSession(cwd) // false = 同桶已登记（幂等）
          const snap = readStateSnapshot(cwd)
          const entry = snap.state?.vaults?.find(e => e.dir === cwd) ?? null
          return { ok: true, data: { bucket: cwd, registered: entry !== null, changed, resolvedVault: snap.resolvedVault } }
        } catch (e) {
          return { ok: false, note: String((e as Error).message).slice(0, 200) }
        }
      }
      return { ok: false, note: '参数须为 {"vault": true} 或 {"router": true}——登记值由系统从会话上下文派生' }
    },
  ))

  // 子会话 id 回写任务笔记的 session 字段（审计用；工作台跳转不依赖它——派活树走宿主的子代理清单）。
  // 事实源是宿主事件，不调宿主内部接口：子代理创建后，宿主向 Router 会话追加
  // subagent/catalog { childId, label }，label = 派发时填的 description（Router 按人格约定填小写 task_id）。
  // 预设作用域的监听只收 Router 会话的事件；宿主对监听器做了异常隔离，这里仍兜住——回写失败至多少一个字段。
  // 同步读改写：在 catalog 提交的那一刻落盘，先于 sun_route 返回，不会与 Router 随后的 sun_vault_meta 互相覆盖。
  ctx.on('session/event', (...args: unknown[]) => {
    try {
      const session = args[0] as { cwd?: unknown; header?: { cwd?: unknown } } | undefined
      const event = args[1] as { type?: unknown; data?: { childId?: unknown; label?: unknown } } | undefined
      if (event?.type !== 'subagent/catalog') return
      const childId = event.data?.childId
      const task = typeof event.data?.label === 'string' ? /^t-(\d{8}-\d{2})$/i.exec(event.data.label.trim()) : null
      if (typeof childId !== 'string' || !childId || !task) return // label 不是 task_id 形状 → 与任务笔记无关
      const dir = session?.cwd ?? session?.header?.cwd
      if (typeof dir !== 'string' || !dir.startsWith('/')) return
      const note = resolveSafe(vaultPath(dir), `50-Tasks/T-${task[1]}.md`)
      if (!existsSync(note)) return // 笔记还没建 → 不替 Router 建文件
      writeFileSync(note, setFrontmatterField(readFileSync(note, 'utf8'), 'session', childId), 'utf8')
    } catch { /* 尽力而为：笔记读不了 / 路径被拒，都只少一个审计字段，绝不影响派发 */ }
  })

  ctx.logger?.info?.('[sun-space] router tools registered: sun_read sun_vault_write sun_vault_meta sun_state_read sun_state_write; sun_route = 官方 dsh-tool-subagent 实例（组合声明）')
}
