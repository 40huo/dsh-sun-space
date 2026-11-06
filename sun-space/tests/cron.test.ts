import { describe, expect, it } from 'vitest'
import { nextFire } from '../src/cron'

describe('cron nextFire', () => {
  const base = new Date('2026-11-07T02:00:00') // 周六 02:00

  it(' fires same day when time is ahead', () => {
    const t = nextFire('30 18 * * *', base)
    expect(t.getHours()).toBe(18)
    expect(t.getMinutes()).toBe(30)
    expect(t.getDate()).toBe(7)
  })

  it('skips weekend for weekday-only spec (1-5)', () => {
    // 周六 02:00 → 下一触发应为周一 08:45
    const t = nextFire('45 8 * * 1-5', base)
    expect(t.getDay()).toBe(1)
    expect(t.getHours()).toBe(8)
    expect(t.getMinutes()).toBe(45)
    expect(t.getDate()).toBe(9)
  })

  it('supports list and range fields', () => {
    const t = nextFire('0 14,21 * * 1-5', base)
    expect(t.getHours()).toBe(14) // 周一 14:00
    const t2 = nextFire('0 9-11 * * *', base)
    expect(t2.getHours()).toBe(9)
  })

  it('treats 7 as Sunday', () => {
    const t = nextFire('0 12 * * 7', base)
    expect(t.getDay()).toBe(0)
  })

  it('throws on bad spec', () => {
    expect(() => nextFire('45 8 * *')).toThrow()
    expect(() => nextFire('a b c d e')).toThrow()
  })
})
