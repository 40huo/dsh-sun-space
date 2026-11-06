/**
 * sun-worker 预设的子插件：命令黑名单 + noWait 守卫（不挂 restrict——
 * Spike A 运行期结论：预设组合本身即排除机制，guard 在组合内直接生效）。
 * 对齐原型 noWait 哲学：结果会自己送达，结束本轮即可。
 */

export const inject = ['tools']

export const BLOCKED: RegExp[] = [
  /dws\s+oa\s+task\s+(approve|reject)/,
  /rm\s+-rf/,
  /dws\s+api.*\b(POST|DELETE)\b/,
]

const SLEEP = /(^|[;&|]\s*)sleep\b/
const SHELL_MAX_MS = 30_000
const JOB_WAIT_MAX_MS = 5_000

/** 纯函数判定：返回拒绝理由或 undefined（放行）。可单测。 */
export function judge(toolName: string, args: Record<string, unknown> = {}): string | undefined {
  if (toolName === 'bash' || toolName === 'pwsh') {
    const cmd = String(args.command ?? '')
    if (SLEEP.test(cmd)) return 'NO_WAIT: 禁止 sleep——结果会自己送达，请结束本轮'
    for (const re of BLOCKED) {
      if (re.test(cmd)) return `BLOCKED: 命中 always-ask 黑名单（${re.source}）——需人工在确认卡执行`
    }
    const timeoutMs = Number(args.timeoutMs ?? 0)
    if (timeoutMs > SHELL_MAX_MS) return `NO_WAIT: timeoutMs ${timeoutMs} > ${SHELL_MAX_MS}，请改后台 job`
    return
  }
  if (toolName === 'job_output') {
    const waitMs = Number(args.timeout_ms ?? args.timeoutMs ?? 0)
    if (args.wait === true && waitMs > JOB_WAIT_MAX_MS) {
      return `NO_WAIT: job 等待 ${waitMs} > ${JOB_WAIT_MAX_MS}——请结束本轮`
    }
  }
  return
}

export function apply(ctx: import('@deepseek-ai/cordis').Context) {
  ctx.tools.guard((call: { name: string; arguments?: Record<string, unknown> }) => judge(call.name, call.arguments))
  ctx.logger?.info?.('[sun-space] worker guard armed: BLOCKED + noWait')
}
