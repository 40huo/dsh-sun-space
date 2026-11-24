/**
 * sun-worker 预设的子插件：命令黑名单 + noWait 守卫（不挂 restrict——
 * Spike A 运行期结论：预设组合本身即排除机制，guard 在组合内直接生效）。
 * 对齐原型 noWait 哲学：结果会自己送达，结束本轮即可。
 *
 * 黑名单是纵深防御而非安全边界（真正的边界是沙箱与 dws 自身的权限模型）：这里堵的是"同一动作的
 * 纯拼写变体"——引号/转义/大小写/旗标拆合/前置包装（sudo、xargs、环境变量赋值）。0.3.7 及之前只匹配
 * 单一字面量，`rm -fr`、`dws "oa" task "approve"`、`APPROVE`、`dws api --method post` 全部放行。
 */

export const inject = ['tools']

/** 写类 HTTP 方法（dws api raw 逃生舱）：0.3.8 起 PUT/PATCH 与 POST/DELETE 同列。 */
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete'])
/** 审批动作（always-ask：通过/拒绝审批必须人工执行）。 */
const OA_WRITE_VERBS = new Set(['approve', 'reject'])
/** dws oa task 的动词位是变量或命令替换（$a、${a}、$(…)、`…`）：无法静态判定，保守拒绝。 */
const OPAQUE_VERB = /\bdws\b[^;|&]*?\boa\s+task\s+[$`]/
const OPAQUE_VERB_LABEL = 'dws oa task 的动词含变量/命令替换，无法静态判定'

/** 原文即拦的规则（不做归一化——大小写敏感的关键词，避免误伤 jq/正文里的小写同名词）。 */
export const BLOCKED: RegExp[] = [
  /dws\s+api.*\b(POST|DELETE)\b/,
]

const SLEEP = /(^|[;&|]\s*)sleep\b/
const SHELL_MAX_MS = 30_000
const JOB_WAIT_MAX_MS = 5_000

/** 归一化：还原反斜杠转义、去引号、空白压缩、转小写。 */
const normalize = (cmd: string) => cmd.replace(/\\([\s\S])/g, '$1').replace(/["']/g, '').replace(/\s+/g, ' ').toLowerCase()

/** 切成命令段再切词（入参须已归一化）：; & | ( ) ` { } 都是分隔符——子 shell、管道、命令替换里的命令各自成段。 */
const segmentsOf = (normalized: string) => normalized.split(/[;|&`(){}]+/).map(s => s.trim().split(' ').filter(Boolean)).filter(s => s.length > 0)

const basename = (token: string) => token.slice(token.lastIndexOf('/') + 1)

/** rm -rf 及其等价写法：命令名 rm（任意路径、任意前置包装之后），其后选项同时含递归与强制。 */
function rmRule(tokens: string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    if (basename(tokens[i]) !== 'rm') continue
    let recursive = false
    let force = false
    for (let j = i + 1; j < tokens.length && tokens[j].startsWith('-') && tokens[j] !== '--'; j++) {
      const flag = tokens[j]
      if (flag === '--recursive') recursive = true
      else if (flag === '--force') force = true
      else if (!flag.startsWith('--')) { // 短旗标簇：-rf / -fr / -vRf
        if (flag.includes('r')) recursive = true
        if (flag.includes('f')) force = true
      }
    }
    if (recursive && force) return 'rm 递归+强制删除（rm -rf 及其等价写法）'
  }
  return undefined
}

/** dws 写动作：oa task 的 approve/reject，与 api 的写方法。 */
function dwsRule(tokens: string[]): string | undefined {
  const start = tokens.findIndex(t => basename(t) === 'dws')
  if (start < 0) return undefined
  for (let i = start + 1; i < tokens.length; i++) {
    if (tokens[i] === 'oa' && tokens[i + 1] === 'task') {
      // 动词位是选项时（--json 等）向后找第一个非选项 token
      const verb = tokens[i + 2]
      const candidate = verb?.startsWith('-') ? tokens.slice(i + 2, i + 6).find(t => !t.startsWith('-')) : verb
      if (candidate && OA_WRITE_VERBS.has(candidate)) return 'dws oa task approve|reject'
    }
    if (tokens[i] === 'api') {
      const positional = tokens[i + 1]
      if (positional && !positional.startsWith('-') && WRITE_METHODS.has(positional)) return `dws api ${positional.toUpperCase()}`
      // 显式方法旗标：-X POST / -XPOST / --method post / --method=post
      for (let k = i + 1; k < tokens.length; k++) {
        const flag = tokens[k]
        const via = flag === '-x' || flag === '--method' ? tokens[k + 1]
          : flag.startsWith('-x') ? flag.slice(2)
            : flag.startsWith('--method=') ? flag.slice('--method='.length)
              : undefined
        if (via && WRITE_METHODS.has(via)) return `dws api ${via.toUpperCase()}`
      }
    }
  }
  return undefined
}

/** 命中即返回规则名（用于拒绝理由），未命中返回 undefined。可单测。 */
export function blockedRule(command: string): string | undefined {
  for (const re of BLOCKED) if (re.test(command)) return re.source
  const normalized = normalize(command)
  // 变量/命令替换落在动词位：必须在切段之前看——反引号本身是分隔符，切完动词位就空了
  if (OPAQUE_VERB.test(normalized)) return OPAQUE_VERB_LABEL
  for (const tokens of segmentsOf(normalized)) {
    const hit = rmRule(tokens) ?? dwsRule(tokens)
    if (hit) return hit
  }
  return undefined
}

/** 纯函数判定：返回拒绝理由或 undefined（放行）。可单测。 */
export function judge(toolName: string, args: Record<string, unknown> = {}): string | undefined {
  if (toolName === 'bash' || toolName === 'pwsh') {
    const cmd = String(args.command ?? '')
    if (SLEEP.test(cmd)) return 'NO_WAIT: 禁止 sleep——结果会自己送达，请结束本轮'
    const rule = blockedRule(cmd)
    if (rule) return `BLOCKED: 命中 always-ask 黑名单（${rule}）——需人工在确认卡执行`
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
