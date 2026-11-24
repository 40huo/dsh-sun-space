import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply as applyWatchdog, DEFAULT_STALL_MS, DEFAULT_TICK_MS,
  isDelegatedChildHeader, parsePositiveMs, shouldWatchHeader, stalledKeys,
} from '../src/worker-watchdog'

describe('parsePositiveMs', () => {
  it('合法值透传', () => {
    expect(parsePositiveMs('60000', 1)).toBe(60000)
    expect(parsePositiveMs(undefined, 7)).toBe(7)
  })
  it('非法值退回默认（0/负数/非数字）', () => {
    for (const v of ['', 'abc', '0', '-5']) expect(parsePositiveMs(v, 7)).toBe(7)
  })
})

describe('isDelegatedChildHeader（三信号任一成立）', () => {
  it('origin=subagent / parentSession / delegationDepth>0 都算', () => {
    expect(isDelegatedChildHeader({ origin: 'subagent' })).toBe(true)
    expect(isDelegatedChildHeader({ parentSession: 'session-x' })).toBe(true)
    expect(isDelegatedChildHeader({ delegationDepth: 1 })).toBe(true)
  })
  it('普通会话与非对象输入不算', () => {
    expect(isDelegatedChildHeader({})).toBe(false)
    expect(isDelegatedChildHeader({ origin: 'user', parentSession: '', delegationDepth: 0 })).toBe(false)
    expect(isDelegatedChildHeader(null)).toBe(false)
    expect(isDelegatedChildHeader(undefined)).toBe(false)
    expect(isDelegatedChildHeader('x' as never)).toBe(false)
  })
})

describe('shouldWatchHeader（归属判定：委派子代理 且 sun-worker 预设）', () => {
  it('sun-worker 的委派子代理 → 盯', () => {
    expect(shouldWatchHeader({ origin: 'subagent', agentPreset: 'sun-worker' })).toBe(true)
  })
  it('手工创建的 sun-worker 会话（非委派）→ 不盯', () => {
    expect(shouldWatchHeader({ agentPreset: 'sun-worker' })).toBe(false)
  })
  it('Router 会话 / 其他预设 / 无预设 → 不盯', () => {
    expect(shouldWatchHeader({ origin: 'subagent', agentPreset: 'sun-router' })).toBe(false)
    expect(shouldWatchHeader({ origin: 'subagent', agentPreset: 'standard' })).toBe(false)
    expect(shouldWatchHeader({ origin: 'subagent' })).toBe(false)
  })
})

describe('stalledKeys（停滞扫描）', () => {
  const NOW = 1_000_000
  it('只返回 idle > 阈值的 key', () => {
    const entries = new Map<string, { at: number }>([
      ['stuck', { at: NOW - DEFAULT_STALL_MS - 1 }],
      ['fresh', { at: NOW - 1000 }],
      ['edge', { at: NOW - DEFAULT_STALL_MS }], // 恰好等于阈值不算停（严格大于）
    ])
    expect(stalledKeys(entries, NOW, DEFAULT_STALL_MS)).toEqual(['stuck'])
  })
  it('空表返回空', () => {
    expect(stalledKeys(new Map(), NOW, DEFAULT_STALL_MS)).toEqual([])
  })
})

// apply() 全链路：驱动三个事件 handler（agent/created · tools/post-execute · agent/disposed）+ interval 巡检。
// 事件载荷取宿主真实形状：created/disposed 带 { agent }；tools/post-execute 第一个参数是 ToolExecution
// （agent 在 exec.agent 上，dsh-tools pipeline.js：tool.execute(exec.arguments, exec)）。
describe('apply()：纳管 · 活动刷新 · 停滞善后', () => {
  const MIN = 60_000
  let clock = 1_700_000_000_000 // 单调前进的虚拟时钟
  let home = ''
  let vault = ''

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sun-wd-home-'))
    vault = await mkdtemp(join(tmpdir(), 'sun-wd-vault-'))
    process.env.DSH_HOME = home
    process.env.SUN_VAULT = vault // trigger 落盘重定向到临时目录（否则写到真实的 ~/Workspace/sun-vault）
    delete process.env.SUN_WATCHDOG_DISABLED
    vi.useFakeTimers({ toFake: ['Date'] }) // 只接管 Date：fs 的真实异步照常
    clock += 10 * MIN // 越过 vaultPath 的 60s 微缓存（缓存键不含 SUN_VAULT）
    vi.setSystemTime(clock)
  })
  afterEach(async () => {
    vi.useRealTimers()
    delete process.env.DSH_HOME
    delete process.env.SUN_VAULT
    delete process.env.SUN_WATCHDOG_DISABLED
    await rm(home, { force: true, recursive: true })
    await rm(vault, { force: true, recursive: true })
  })

  /** 最小 ctx 桩：捕获事件 handler 与巡检回调，记录 interrupt 调用。 */
  function harness() {
    const handlers: Record<string, (...args: unknown[]) => unknown> = {}
    const interrupted: Array<{ id: string; authority: unknown }> = []
    const parent = { id: 'session-parent' }
    let tick: (() => void) | undefined
    let tickMs = 0
    const ctx = {
      on: (event: string, handler: (...args: unknown[]) => unknown) => { handlers[event] = handler },
      interval: (cb: () => void, ms: number) => { tick = cb; tickMs = ms },
      effect: () => () => {},
      logger: { info: () => {}, warn: () => {} },
      get: (service: string) => (service === 'subagents'
        ? { interrupt: (id: string, authority: unknown) => interrupted.push({ id, authority }) }
        : service === 'agents' ? { get: (id: string) => (id === 'session-parent' ? parent : undefined) } : undefined),
    } as unknown as Context
    applyWatchdog(ctx)
    expect(tickMs).toBe(DEFAULT_TICK_MS)
    return { handlers, interrupted, parent, tick: () => tick?.() }
  }
  const workerOf = (id: string) => ({
    id, session: { id, header: { origin: 'subagent', agentPreset: 'sun-worker', parentSession: 'session-parent' } },
  })
  /** 一次工具调用结束（宿主形状）。返回 handler 的返回值以校验瀑布透传。 */
  const toolCallDone = (h: ReturnType<typeof harness>, agent: unknown) => {
    const decision = { kind: 'accept' }
    const returned = h.handlers['tools/post-execute']({ agent, name: 'bash', arguments: { command: 'date' } }, { content: [] }, () => decision)
    expect(returned).toBe(decision) // 必须 return next()，否则全部工具结果变 undefined
  }
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise<void>(r => setImmediate(r)) }
  const triggerFiles = async () => {
    try { return (await readdir(join(vault, '90-Meta', 'triggers'))).sort() } catch { return [] }
  }

  it('活跃 Worker（持续有工具调用）超过阈值也不被误停', async () => {
    const h = harness()
    const worker = workerOf('session-active')
    h.handlers['agent/created']({ agent: worker, source: 'fresh' })
    for (let minute = 1; minute <= Math.ceil(DEFAULT_STALL_MS / MIN) + 1; minute++) { // 共 16 分钟
      vi.setSystemTime(clock + minute * MIN)
      toolCallDone(h, worker)
      h.tick()
    }
    await settle()
    expect(h.interrupted).toEqual([])
    expect(await triggerFiles()).toEqual([])
  })

  it('静默 Worker 超过阈值 → trigger 落盘 + interrupt 父侧，且只处理一次', async () => {
    const h = harness()
    h.handlers['agent/created']({ agent: workerOf('session-stuck'), source: 'fresh' })
    vi.setSystemTime(clock + DEFAULT_STALL_MS + 1_000)
    h.tick()
    h.tick()
    await settle()
    expect(h.interrupted).toEqual([{ id: 'session-stuck', authority: { kind: 'ancestor', agent: h.parent } }])
    const files = await triggerFiles()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/-watchdog-stall\.json$/)
    expect(JSON.parse(await readFile(join(vault, '90-Meta', 'triggers', files[0]), 'utf8')))
      .toMatchObject({ label: 'watchdog-stall', payload: { childId: 'session-stuck' } })
  })

  it('别的会话的工具调用不会替 Worker 刷新计时', async () => {
    const h = harness()
    h.handlers['agent/created']({ agent: workerOf('session-quiet'), source: 'fresh' })
    for (let minute = 1; minute <= 16; minute++) {
      vi.setSystemTime(clock + minute * MIN)
      toolCallDone(h, { id: 'session-sibling', session: { id: 'session-sibling' } }) // 另一个 agent 在干活
    }
    h.tick()
    await settle()
    expect(h.interrupted.map(x => x.id)).toEqual(['session-quiet'])
  })

  it('Worker 已 disposed → 出册，不再 interrupt', async () => {
    const h = harness()
    const worker = workerOf('session-gone')
    h.handlers['agent/created']({ agent: worker, source: 'fresh' })
    toolCallDone(h, worker)
    h.handlers['agent/disposed']({ agent: worker })
    vi.setSystemTime(clock + DEFAULT_STALL_MS + 1_000)
    h.tick()
    await settle()
    expect(h.interrupted).toEqual([])
    expect(await triggerFiles()).toEqual([])
  })

  it('取不到会话 id 的 agent 不入册（无从 interrupt）', async () => {
    const h = harness()
    h.handlers['agent/created']({ agent: { session: { header: { origin: 'subagent', agentPreset: 'sun-worker' } } }, source: 'fresh' })
    toolCallDone(h, {})
    vi.setSystemTime(clock + DEFAULT_STALL_MS + 1_000)
    h.tick()
    await settle()
    expect(h.interrupted).toEqual([])
  })
})
