import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTriggerTs, pruneTriggers, shouldAlertCredential, TRIGGER_TTL_MS } from '../src/source'

describe('parseTriggerTs（trigger 文件名 → 创建时刻）', () => {
  it('解析 ISO mangled 文件名', () => {
    expect(parseTriggerTs('2026-11-06T18-41-01-077Z-snapshot-diff.json'))
      .toBe(Date.parse('2026-11-06T18:41:01.077Z'))
  })
  it('不可解析返回 null（保守不删）', () => {
    expect(parseTriggerTs('manual-trigger.json')).toBeNull()
    expect(parseTriggerTs('not-a-trigger.txt')).toBeNull()
  })
})

describe('shouldAlertCredential（探活告警节流）', () => {
  const NOW = 1_000_000_000_000
  it('未达连续失败阈值不告警', () => {
    expect(shouldAlertCredential(1, 0, NOW)).toBe(false)
  })
  it('达阈值但冷却期内不重复告警', () => {
    expect(shouldAlertCredential(2, NOW - 10 * 60_000, NOW)).toBe(false)
  })
  it('达阈值且过冷却期 → 告警', () => {
    expect(shouldAlertCredential(2, NOW - 61 * 60_000, NOW)).toBe(true)
  })
})

describe('pruneTriggers（TTL 清理）', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'sun-trigger-')), 'triggers')
  await mkdir(dir, { recursive: true })
  const NOW = Date.parse('2026-11-08T12:00:00.000Z')
  const oldF = '2026-10-25T00-00-00-000Z-snapshot-diff.json' // 14 天前 → 删
  const freshF = '2026-11-07T00-00-00-000Z-snapshot-diff.json' // 1 天前 → 留
  const oddF = 'manual-note.json' // 不可解析 → 留
  const nonJson = '2026-10-25T00-00-00-000Z-snapshot-diff.txt' // 非 json → 留
  for (const f of [oldF, freshF, oddF, nonJson]) await writeFile(join(dir, f), '{}', 'utf8')

  it('只删 TTL 过期的 json', async () => {
    const removed = await pruneTriggers(dir, NOW)
    expect(removed).toEqual([oldF])
    const rest = (await readdir(dir)).sort()
    expect(rest).toEqual([freshF, nonJson, oddF].sort())
  })
  it('目录不存在时静默返回空', async () => {
    expect(await pruneTriggers('/tmp/sun-nonexistent-dir-xyz')).toEqual([])
  })
  it('TTL 常量为 7 天', () => {
    expect(TRIGGER_TTL_MS).toBe(7 * 24 * 60 * 60_000)
  })
})
