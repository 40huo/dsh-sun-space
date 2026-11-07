/**
 * Source：dws 轮询快照 diff（TS 层执行，零 LLM 成本）。
 * 业务定时（晨报/日报/周复盘）已全部迁往 DSH 原生 schedule 服务（自动化任务 UI 与
 * 工作台 Panel 均可管理）——代码里不再有业务定时（AI Native 原则 1 自查纠偏）。
 * 触发物：写入 90-Meta/triggers/<ts>-<label>.json（Router 经 sun_read 消费）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  ctx.timeout(() => { if (!stopped) void poll() }, 5_000)
  ctx.interval(() => { void poll() }, POLL_MS)
  ctx.effect(() => () => { stopped = true })
  ctx.logger?.info?.('[sun-space] source armed: dws polling every 30min')
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
