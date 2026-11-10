import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STALL_MS, DEFAULT_TICK_MS,
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
