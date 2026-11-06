import { describe, expect, it } from 'vitest'
import { lossless } from '../src/router-tools'

describe('lossless sanitizer', () => {
  it('drops undefined object fields', () => {
    expect(lossless({ a: 1, openTaskId: undefined, b: 'x' })).toEqual({ a: 1, b: 'x' })
  })
  it('maps undefined array items to null', () => {
    expect(lossless([undefined, 1])).toEqual([null, 1])
  })
  it('handles nested structures', () => {
    expect(lossless({ data: { openTaskId: undefined, deep: { n: undefined, v: 2 } } }))
      .toEqual({ data: { deep: { v: 2 } } })
  })
  it('top-level undefined becomes null', () => {
    expect(lossless(undefined)).toBeNull()
  })
  it('keeps null values (distinct from undefined)', () => {
    expect(lossless({ n: null })).toEqual({ n: null })
  })
})
