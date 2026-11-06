/**
 * 极简 5 段 cron → 下次触发时间（本地时区）。纯函数，可单测。
 * 支持：* 数字 列表(,) 区间(-)。不支持步进(/)——项目约定不用。
 */

const RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7],  // day of week (0/7 = 周日)
]

export function nextFire(spec: string, from: Date = new Date()): Date {
  const parts = spec.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`bad cron spec: ${spec}`)
  const fields = parts.map((f, i) => fieldValues(f, RANGES[i][0], RANGES[i][1]))
  const t = new Date(from)
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (fields[0].includes(t.getMinutes()) && fields[1].includes(t.getHours())
      && fields[2].includes(t.getDate()) && fields[3].includes(t.getMonth() + 1)
      && dowMatch(fields[4], t.getDay())) return new Date(t)
    t.setMinutes(t.getMinutes() + 1)
  }
  throw new Error(`no fire time within a year: ${spec}`)
}

function fieldValues(f: string, lo: number, hi: number): number[] {
  if (f.trim() === '*') return range(lo, hi)
  const out: number[] = []
  for (const seg of f.split(',')) {
    const [a, b] = seg.split('-')
    const lo2 = Number(a)
    if (!Number.isInteger(lo2)) throw new Error(`bad cron field: ${f}`)
    if (b === undefined) { out.push(lo2); continue }
    const hi2 = Number(b)
    if (!Number.isInteger(hi2) || hi2 < lo2) throw new Error(`bad cron range: ${f}`)
    out.push(...range(lo2, hi2))
  }
  return out
}

function dowMatch(values: number[], day: number): boolean {
  return values.includes(day) || (day === 0 && values.includes(7))
}

function range(lo: number, hi: number): number[] {
  const out: number[] = []
  for (let v = lo; v <= hi; v++) out.push(v)
  return out
}
