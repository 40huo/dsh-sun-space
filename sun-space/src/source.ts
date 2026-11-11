/**
 * Source：dws 轮询快照 diff（TS 层执行，零 LLM 成本）。
 * 业务定时（晨报/日报/Watchdog/周复盘）全部由 DSH 原生 schedule 承载（代码零 cron，
 * AI Native 原则 1 自查纠偏）——本文件只做轮询与机械治理。
 * 触发物：写入 90-Meta/triggers/<ts>-<label>.json（Router 经 sun_read 消费）。
 * 附带两件机械职责（Watchdog 的 TS 层）：
 *   ① 轮询连续失败 ≥2 次 → 探活告警 trigger + urgent 通知（1h 节流）——dws 凭证失效的第一发现者；
 *   ② 清理 >7 天的 trigger json（TTL 治理，防队列积压）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { currentUserId, notifySelf, snapshot, diff, type DwsSnapshot } from './dws'

export const inject = ['timer']

import { vaultPath } from './vault-path'

/** 轮询周期（毫秒）：纯程序层，可调密。 */
const POLL_MS = 30 * 60_000

const triggerDir = () => `${vaultPath()}/90-Meta/triggers`

const snapshotFile = () => `${vaultPath()}/90-Meta/mock-data/last-snapshot.json`

/** trigger 文件 TTL：超过即视为已消费/过期，轮询成功路径顺带清理。 */
export const TRIGGER_TTL_MS = 7 * 24 * 60 * 60_000

/** 探活告警参数：连续失败次数阈值 / 两次告警最小间隔（节流）。 */
export const CREDENTIAL_ALERT_STREAK = 2
export const CREDENTIAL_ALERT_COOLDOWN_MS = 60 * 60_000

export function apply(ctx: Context) {
  schedulePolling(ctx)
}

/** 从 trigger 文件名（ISO mangled：冒号/点被替换为 '-'）解析创建时刻；不可解析返回 null（保守不删）。 */
export function parseTriggerTs(fileName: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(fileName)
  if (!m) return null
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
}

/** 连续失败 ≥阈值 且 距上次告警 ≥冷却期 → 发探活告警。 */
export function shouldAlertCredential(streak: number, lastAlertAt: number, now: number): boolean {
  return streak >= CREDENTIAL_ALERT_STREAK && now - lastAlertAt >= CREDENTIAL_ALERT_COOLDOWN_MS
}

/** 删除 TTL 过期的 trigger 文件；文件名不可解析的一律保留。 */
export async function pruneTriggers(dir: string, now = Date.now()): Promise<string[]> {
  const removed: string[] = []
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return removed
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const ts = parseTriggerTs(f)
    if (ts !== null && now - ts > TRIGGER_TTL_MS) {
      try {
        await rm(join(dir, f))
        removed.push(f)
      } catch { /* 已被并发清理等，忽略 */ }
    }
  }
  return removed
}

function schedulePolling(ctx: Context) {
  const health = { fails: 0, lastAlertAt: 0 }
  const poll = async () => {
    try {
      const snap = await snapshot()
      const prev = await readPrev()
      if (!prev) {
        // 首跑建基线：全量快照静默落盘、不入触发队列——否则装满历史当"新增"会洪泛通知（复审 R1 遗留项）
        await writeFile(snapshotFile(), JSON.stringify(snap), 'utf8')
        return
      }
      const fresh = diff(prev, snap)
      if (fresh.newTodos.length || fresh.newApprovals.length) {
        await writeTrigger('snapshot-diff', fresh)
        const uid = await currentUserId()
        const parts = []
        if (fresh.newTodos.length) parts.push(`新待办 ${fresh.newTodos.length} 条`)
        if (fresh.newApprovals.length) parts.push(`新审批 ${fresh.newApprovals.length} 件`)
        await notifySelf(uid, `[Sun·info] ${parts.join('、')}，已入触发队列（${new Date().toLocaleTimeString('zh-CN')}）`)
      }
      await writeFile(snapshotFile(), JSON.stringify(snap), 'utf8')
      health.fails = 0
      await pruneTriggers(triggerDir()).catch(() => {})
    } catch (e) {
      ctx.logger?.warn?.(`[sun-space] poll failed: ${String((e as Error).message).slice(0, 150)}`)
      health.fails++
      if (shouldAlertCredential(health.fails, health.lastAlertAt, Date.now())) {
        health.lastAlertAt = Date.now()
        const note = '[Sun·urgent] dws 轮询连续失败，凭证可能失效——请执行 dws auth login 重新登录'
        // 通知通道本身可能已失效（凭证挂了 chat 也发不出）——trigger 落盘兜底，晨报 sun_read(triggers) 可见
        await writeTrigger('poll-failed', { note, fails: health.fails }).catch(() => {})
        try {
          const uid = await currentUserId()
          await notifySelf(uid, note)
        } catch { /* 通知失败不掩盖根因 */ }
      }
    }
  }
  // 首轮延迟 5s（等 dws 环境），此后固定间隔；interval 随 fiber 清理
  let stopped = false
  ctx.timeout(() => { if (!stopped) void poll() }, 5_000)
  ctx.interval(() => { void poll() }, POLL_MS)
  ctx.effect(() => () => { stopped = true })
  ctx.logger?.info?.('[sun-space] source armed: dws polling every 30min (+credential watchdog, trigger TTL prune)')
}

async function readPrev(): Promise<DwsSnapshot | null> {
  try {
    return JSON.parse(await readFile(snapshotFile(), 'utf8')) as DwsSnapshot
  } catch {
    return null
  }
}

async function writeTrigger(label: string, payload: unknown) {
  await mkdir(triggerDir(), { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  await writeFile(join(triggerDir(), `${ts}-${label}.json`), JSON.stringify({ label, payload }, null, 2), 'utf8')
}
