/**
 * Source：dws 轮询快照 diff（TS 层执行，零 LLM 成本）+ 定时 Trigger。
 * 定时器：ctx.timeout 自重排（cron 语义见 cron.ts），随插件卸载自动清理。
 * 触发物：写入 90-Meta/triggers/<ts>-<label>.json（Router 经 sun_read 消费）；
 *         高优触发（watchdog/晨报）同时 info 通知。
 * 另：晨报/日报/周复盘的"驱动 Router 会话"优先用 Harness 原生自动化任务
 *    （App 内"自动化任务"面板，指向 sun-router 会话）——本 Source 只负责轮询感知。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nextFire } from './cron'
import { currentUserId, notifySelf, snapshot, diff, type DwsSnapshot } from './dws'

export const inject = ['timer']

export const VAULT = process.env.SUN_VAULT ?? `${process.env.HOME}/Workspace/sun-vault`

/** 轮询周期（毫秒）：纯程序层，可调密。 */
const POLL_MS = 30 * 60_000

const TRIGGER_DIR = `${VAULT}/90-Meta/triggers`

const SNAPSHOT_FILE = `${VAULT}/90-Meta/mock-data/last-snapshot.json`

export function apply(ctx: Context) {
  schedulePolling(ctx)
}

function schedulePolling(ctx: Context) {
  const poll = async () => {
    try {
      const snap = await snapshot()
      const prev = await readPrev()
      const fresh = diff(prev, snap)
      if (fresh.newTodos.length || fresh.newApprovals.length) {
        await writeTrigger('snapshot-diff', fresh)
        const uid = await currentUserId()
        const parts = []
        if (fresh.newTodos.length) parts.push(`新待办 ${fresh.newTodos.length} 条`)
        if (fresh.newApprovals.length) parts.push(`新审批 ${fresh.newApprovals.length} 件`)
        await notifySelf(uid, `[Sun·info] ${parts.join('、')}，已入触发队列（${new Date().toLocaleTimeString('zh-CN')}）`)
      }
      await writeFile(SNAPSHOT_FILE, JSON.stringify(snap), 'utf8')
    } catch (e) {
      ctx.logger?.warn?.(`[sun-space] poll failed: ${String((e as Error).message).slice(0, 150)}`)
    }
  }
  // 首轮延迟 5s（等 dws 环境），此后固定间隔；interval 随 fiber 清理
  let stopped = false
  const arm = (fn: () => void, ms: number) => {
    if (stopped) return
    ctx.timeout(() => { if (!stopped) fn() }, ms)
  }
  arm(poll, 5_000)
  ctx.interval(() => { void poll() }, POLL_MS)
  ctx.effect(() => () => { stopped = true })
  // 定时 Trigger（晨报/日报/巡检/周复盘）——写触发文件，驱动交给 Harness 原生自动化或人工
  for (const [label, spec] of Object.entries({
    'morning-brief': '45 8 * * 1-5',
    'watchdog': '0 14,21 * * 1-5',
    'evening-report': '30 18 * * 1-5',
    'weekly-review': '0 17 * * 5',
  } as const)) {
    const armCron = () => {
      const delay = Math.max(1000, nextFire(spec).getTime() - Date.now())
      ctx.timeout(async () => {
        await writeTrigger(label, { firedAt: new Date().toISOString() })
        armCron()
      }, delay)
    }
    armCron()
  }
  ctx.logger?.info?.('[sun-space] source armed: polling 30min + 4 cron triggers')
}

async function readPrev(): Promise<DwsSnapshot | null> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8')) as DwsSnapshot
  } catch {
    return null
  }
}

async function writeTrigger(label: string, payload: unknown) {
  await mkdir(TRIGGER_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  await writeFile(join(TRIGGER_DIR, `${ts}-${label}.json`), JSON.stringify({ label, payload }, null, 2), 'utf8')
}
