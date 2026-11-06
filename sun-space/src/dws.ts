/**
 * dws 执行器：单次命令调用（无长连接）。供 sun_notify / Source 轮询使用。
 * 输出一律 --format json；失败抛错并带 stderr 摘要。
 */

import { execFile } from 'node:child_process'

export interface DwsTodo {
  taskId: string
  subject: string
  dueTime?: number
  priority?: number
}

export interface DwsSnapshot {
  todos: DwsTodo[]
  approvals: Array<{ id: string; name?: string }>
  events: Array<{ subject?: string; start?: string }>
}

function run(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('dws', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`dws ${args.join(' ')} failed: ${String(err).slice(0, 200)} | stderr: ${String(stderr).slice(0, 200)}`))
        return
      }
      resolve(stdout)
    })
  })
}

async function runJson<T>(args: string[]): Promise<T> {
  const out = await run([...args, '--format', 'json'])
  try {
    return JSON.parse(out) as T
  } catch (e) {
    throw new Error(`dws output is not JSON: ${out.slice(0, 200)}`)
  }
}

/** 当前登录身份的 userId（profile 形如 corpId:userId）。 */
export async function currentUserId(): Promise<string> {
  const data = await runJson<{
    success: boolean
    currentProfile?: string
  }>(['profile', 'list'])
  const p = data.currentProfile ?? ''
  const uid = p.includes(':') ? p.split(':')[1] : p
  if (!uid) throw new Error('dws has no active profile — run `dws auth login`')
  return uid
}

/** 给自己发消息（IM 主信道）。内容 ≤ 会被插件截断；真实发送。 */
export async function notifySelf(userId: string, content: string): Promise<{ openTaskId?: string }> {
  const text = content.length > 300 ? `${content.slice(0, 300)}…` : content
  const data = await runJson<{ success?: boolean; ok?: boolean; data?: { openTaskId?: string }; result?: { openTaskId?: string } }>([
    'chat', 'message', 'send', '--user', userId, '--content', text,
  ])
  return { openTaskId: data?.data?.openTaskId ?? data?.result?.openTaskId }
}

/** 三路快照（todo / oa / calendar），单次命令各一。单项失败不拖垮整体。 */
export async function snapshot(): Promise<DwsSnapshot> {
  const now = Date.now()
  const [todos, approvals, events] = await Promise.allSettled([
    runJson<{ result?: { todoCards?: Array<Record<string, unknown>> } }>(['todo', 'task', 'list']),
    runJson<{ data?: { instances?: Array<Record<string, unknown>> } }>([
      'oa', '+list-pending', '--start', String(now - 30 * 86400_000), '--end', String(now),
    ]),
    runJson<{ result?: { events?: Array<Record<string, unknown>> } }>(['calendar', 'event', 'list']),
  ])
  return {
    todos: todos.status === 'fulfilled'
      ? (todos.value.result?.todoCards ?? []).map(c => ({
        taskId: String(c.taskId ?? ''),
        subject: String(c.subject ?? ''),
        dueTime: c.dueTime as number | undefined,
        priority: c.priority as number | undefined,
      }))
      : [],
    approvals: approvals.status === 'fulfilled'
      ? (approvals.value.data?.instances ?? []).map(i => ({ id: String(i.instanceId ?? i.id ?? '') }))
      : [],
    events: events.status === 'fulfilled'
      ? (events.value.result?.events ?? []).map(e => ({
        subject: e.subject as string | undefined,
        start: (e.start ?? e.startTime) as string | undefined,
      }))
      : [],
  }
}

/** 程序层 diff：对照上次快照识别新增项。纯函数，可单测。 */
export interface DiffResult {
  newTodos: Array<{ id: string; subject: string }>
  newApprovals: string[]
}

export function diff(prev: DwsSnapshot | null, next: DwsSnapshot): DiffResult {
  const prevTodos = new Set((prev?.todos ?? []).map(t => t.taskId))
  const prevApprovals = new Set((prev?.approvals ?? []).map(a => a.id))
  return {
    newTodos: next.todos.filter(t => !prevTodos.has(t.taskId))
      .map(t => ({ id: t.taskId, subject: t.subject })),
    newApprovals: next.approvals.map(a => a.id).filter(id => !prevApprovals.has(id)),
  }
}
