/**
 * worker-watchdog —— 父侧盯着 sun-worker 子代理，长期无活动就停掉它，让卡死"有声音"。
 *
 * ── 解决什么问题 ─────────────────────────────────────────────────────────────
 *
 * Router 的纪律是"派发后等 Worker 结论再推进"。这条纪律成立的前提是 Router 会被
 * 唤醒：Worker 干完活，宿主发 settled 通知，Router 才有一轮可处理。可 Worker
 * **静默卡死**（陷在同一个错误构造里反复推演、不调工具、不退回、不报错）时该前提
 * 不成立——宿主没有任何子代理空闲超时，只有真正 idle 才发结算通知。于是 Router
 * 再也不会被叫醒，任务悬在半空，界面无异常。
 *
 * ── 为什么是这个形态 ────────────────────────────────────────────────────────
 *
 * 判据只能是"多久没有活动"，活动 = 该 Worker 的任何一次工具调用结束
 * （tools/post-execute）。它挂在**全局 scope**（index.ts 顶层插件）而不是 Router
 * preset scope：我们的 Worker 是独立 preset（非 composeFrom），preset scope 收不到
 * 跨 preset 的子会话事件；cordis 事件冒泡保证全局 scope 全收，归属用会话头判。
 * 停止动作选 **interrupt**（可观测的最小动作）：它触发 settled 通知——Router 被
 * 唤醒，卡死从静默变成可见；重派是 Router 的决定（它看得见报告），看门狗不越权。
 * 另加本仓库自己的观测通道：写 trigger 队列 + urgent 通知（Interrupt 通道万一失效
 * 也不至于全瞎，且钉进钉钉推送）。
 *
 * ── 判据与失败取向 ──────────────────────────────────────────────────────────
 *
 * 归属（顺序即取舍）：会话头 origin/parentSession/delegationDepth 任一成立 =
 * 委派子代理；且 agentPreset === 'sun-worker' 才在册。手工创建的 sun-worker 会话、
 * Router 会话、其他插件会话一律不管——"判错方向不对称：多盯一个是日志，误停一个
 * 别的会话是替别人做决定"。所有异常**绝不抛**：服务缺席、interrupt 拒绝、定时器
 * 起不来，一律记日志退场——最坏是卡死仍静默，抛错的代价是把正常会话弄坏。
 * 阈值默认 15 分钟（任何一次完成的工具调用都刷新计时；长命令完成后即重置），
 * 可用 SUN_WATCHDOG_STALL_MS 覆盖；SUN_WATCHDOG_DISABLED=1 整体关闭。
 *
 * @module sun-space/worker-watchdog
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'worker-watchdog'

export const inject = ['timer']

import { VAULT } from './vault-path'
export { VAULT }
const TRIGGER_DIR = `${VAULT}/90-Meta/triggers`

/** 默认停滞阈值 15 分钟：长思考/长命令完成后即重置计时，真卡死撑不到这么久。 */
export const DEFAULT_STALL_MS = 15 * 60_000
/** 巡检间隔 30 秒。 */
export const DEFAULT_TICK_MS = 30_000

/** 解析正数毫秒配置；非法退回默认。 */
export function parsePositiveMs(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

interface SessionHeaderLike {
  origin?: unknown
  parentSession?: unknown
  delegationDepth?: unknown
  agentPreset?: unknown
}

/** 会话头是否表明这是被委派出来的子代理（三信号任一成立）。 */
export function isDelegatedChildHeader(header: SessionHeaderLike | undefined | null): boolean {
  if (header === undefined || header === null || typeof header !== 'object') return false
  if (header.origin === 'subagent') return true
  if (typeof header.parentSession === 'string' && header.parentSession !== '') return true
  if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
  return false
}

/** 归属判定：委派子代理 且 sun-worker 预设（手工创建的 sun-worker 会话被 origin 判据排除）。 */
export function shouldWatchHeader(header: SessionHeaderLike | undefined | null): boolean {
  return isDelegatedChildHeader(header)
    && (header as SessionHeaderLike).agentPreset === 'sun-worker'
}

/** 纯扫描：返回停滞条目的 key（idle > timeout）。调用方负责出册与善后。 */
export function stalledKeys<K, E extends { at: number }>(
  entries: Map<K, E>, now: number, stallMs: number,
): K[] {
  const out: K[] = []
  for (const [key, entry] of entries) if (now - entry.at > stallMs) out.push(key)
  return out
}

/** 从会话头取父会话 id（可能 undefined）。 */
function parentSessionOf(agent: unknown): string | undefined {
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  const p = header?.parentSession
  return typeof p === 'string' && p !== '' ? p : undefined
}

function sessionIdOf(agent: unknown): string | undefined {
  const session = (agent as { session?: { id?: unknown } } | undefined)?.session
  const id = session?.id ?? (agent as { id?: unknown })?.id
  return typeof id === 'string' ? id : undefined
}

export function apply(ctx: Context) {
  if (process.env.SUN_WATCHDOG_DISABLED === '1') {
    ctx.logger?.info?.('[sun-space] worker-watchdog disabled by env')
    return
  }
  const stallMs = parsePositiveMs(process.env.SUN_WATCHDOG_STALL_MS, DEFAULT_STALL_MS)
  const tickMs = parsePositiveMs(process.env.SUN_WATCHDOG_TICK_MS, DEFAULT_TICK_MS)

  /** 在册表：agent 对象 → { key(id), parentId, at(最后活动时刻) }。Map 以便遍历；disposed 即删，不累积。 */
  const watched = new Map<object, { id: string; parentId: string | undefined; at: number }>()
  let engagedNoted = false

  const log = (level: 'info' | 'warn', msg: string) => {
    try { (ctx.logger?.[level] ?? ctx.logger?.info)?.call(ctx.logger, `[sun-space/watchdog] ${msg}`) } catch { /* 日志失败不反炸 */ }
  }

  /** 停滞善后：先 trigger 落盘（本仓库观测通道），再 urgent 通知，再 interrupt 唤醒 Router。 */
  const handleStall = async (entry: { id: string; parentId: string | undefined; at: number }) => {
    const idleMin = Math.round((Date.now() - entry.at) / 60_000)
    log('warn', `stalled: child=${entry.id} idle=${idleMin}min — interrupting & notifying`)
    try {
      await mkdir(TRIGGER_DIR, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      await writeFile(
        join(TRIGGER_DIR, `${ts}-watchdog-stall.json`),
        JSON.stringify({ label: 'watchdog-stall', payload: { childId: entry.id, idleMinutes: idleMin } }, null, 2),
        'utf8',
      )
    } catch { /* trigger 落盘失败不阻断后续 */ }
    try {
      const { currentUserId, notifySelf } = await import('./dws')
      const uid = await currentUserId()
      await notifySelf(uid, `[Sun·urgent] Watchdog 停止了卡死 Worker：${entry.id}（无活动 ${idleMin} 分钟），请复查或重派`)
    } catch { /* 通知失败不掩盖 interrupt */ }
    try {
      const subagents = ctx.get<{ interrupt?: Function }>('subagents')
      if (!subagents || typeof subagents.interrupt !== 'function') {
        log('info', 'subagents.interrupt unavailable — stall stays silent. [reason=no-interrupt-api]')
        return
      }
      const parentAgent = entry.parentId ? (ctx.get<{ get?: Function }>('agents') as { get?: Function } | undefined)?.get?.(entry.parentId) : undefined
      if (!parentAgent) {
        log('warn', `parent agent unresolvable for ${entry.id} — not interrupting (no guess). [reason=no-parent]`)
        return
      }
      subagents.interrupt(entry.id, { kind: 'ancestor', agent: parentAgent })
    } catch (e) {
      log('info', `interrupt declined: ${String((e as Error).message).slice(0, 120)} [reason=interrupt-threw]`)
    }
  }

  ctx.interval(() => {
    for (const key of stalledKeys(watched, Date.now(), stallMs)) {
      const entry = watched.get(key)
      if (!entry) continue
      watched.delete(key) // 先出册：停滞只处理一次
      void handleStall(entry)
    }
  }, tickMs)
  ctx.effect(() => () => { /* interval 随 fiber 清理（timer 服务负责） */ })

  // 纳入口：新 agent 出现即判定归属（事件随 cordis 冒泡到达全局 scope）
  ctx.on('agent/created', (...args: unknown[]) => {
    try {
      const payload = args[0] as { agent?: unknown } | undefined
      const agent = payload?.agent
      if (agent === undefined || agent === null) return
      const header = (agent as { session?: { header?: Record<string, unknown> } })?.session?.header
      if (!shouldWatchHeader(header)) return
      const id = sessionIdOf(agent)
      if (watched.has(agent)) { const e = watched.get(agent)!; e.at = Date.now(); return }
      watched.set(agent, { id: id ?? '?', parentId: parentSessionOf(agent), at: Date.now() })
      if (!engagedNoted) {
        engagedNoted = true
        log('info', `engaged: watching sun-worker children (stall=${stallMs / 1000}s, tick=${tickMs / 1000}s)`)
      }
    } catch (e) {
      log('info', `agent/created handling failed: ${String((e as Error).message).slice(0, 120)}`)
    }
  })

  // 活动信号：任何一次工具调用结束都刷新计时。⚠️ 这是瀑布——必须 return next()，
  // 否则全部工具调用的结果变 undefined（dsh-multitask 实测教训：七种工具全炸）。
  ctx.on('tools/post-execute', (...args: unknown[]) => {
    const [exec, , next] = args as unknown as [unknown, unknown, () => unknown]
    try {
      const entry = exec !== undefined && exec !== null ? watched.get(exec) : undefined
      if (entry) entry.at = Date.now()
    } catch { /* 刷新失败最多误停一个活跃 worker，不拦调用 */ }
    return next()
  })

  // 释放：worker 走了就出册
  ctx.on('agent/disposed', (...args: unknown[]) => {
    try {
      const payload = args[0] as { agent?: unknown } | undefined
      if (payload?.agent !== undefined && payload.agent !== null) watched.delete(payload.agent)
    } catch { /* 内存里多一条记录，下次 tick 自然忽略 */ }
  })
}
