import { describe, expect, it } from 'vitest'
import { judge, BLOCKED } from '../src/worker-guard'

describe('worker guard judge', () => {
  it('blocks approval actions', () => {
    expect(judge('bash', { command: 'dws oa task approve --id 123' })).toMatch(/BLOCKED/)
    expect(judge('bash', { command: 'dws oa task reject --id 123 --comment no' })).toMatch(/BLOCKED/)
  })

  it('blocks rm -rf and dws api writes', () => {
    expect(judge('bash', { command: 'rm -rf /tmp/x' })).toMatch(/BLOCKED/)
    expect(judge('bash', { command: 'dws api POST /v1.0/foo' })).toMatch(/BLOCKED/)
    expect(judge('bash', { command: 'dws api DELETE /v1.0/foo' })).toMatch(/BLOCKED/)
  })

  it('allows read-only dws commands', () => {
    expect(judge('bash', { command: 'dws todo task list --format json' })).toBeUndefined()
    expect(judge('bash', { command: 'dws oa +list-pending --start 1 --end 2' })).toBeUndefined()
  })

  it('blocks sleep and long shell waits (noWait)', () => {
    expect(judge('bash', { command: 'sleep 30' })).toMatch(/NO_WAIT/)
    expect(judge('bash', { command: 'echo hi && sleep 2' })).toMatch(/NO_WAIT/)
    expect(judge('bash', { command: 'npm test', timeoutMs: 60_000 })).toMatch(/NO_WAIT/)
    expect(judge('bash', { command: 'npm test', timeoutMs: 30_000 })).toBeUndefined()
  })

  it('blocks long job waits', () => {
    expect(judge('job_output', { wait: true, timeout_ms: 8000 })).toMatch(/NO_WAIT/)
    expect(judge('job_output', { wait: true, timeout_ms: 5000 })).toBeUndefined()
    expect(judge('job_output', { timeout_ms: 8000 })).toBeUndefined()
  })

  it('passes through non-shell tools', () => {
    expect(judge('read', { path: '/x' })).toBeUndefined()
    expect(judge('grep', { pattern: 'y' })).toBeUndefined()
  })

  it('BLOCKED regexes are anchored enough to avoid false positives on reads', () => {
    // 读列表不应被误伤
    expect(BLOCKED[0].test('dws oa +list-pending --start 1')).toBe(false)
  })
})
