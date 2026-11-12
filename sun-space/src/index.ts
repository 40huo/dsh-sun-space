/**
 * sun-space 插件入口。
 * 预设（sun-router / sun-worker）由 cordis.patch.yml 声明为 agent-preset；
 * 本入口负责 Source（dws 轮询 + 定时 Trigger）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { publishVaultState, registerVaultRootFromSession } from './vault-path'
import * as source from './source'
import * as workerWatchdog from './worker-watchdog'

export const name = 'sun-space'

// timer 服务由 vendor/timer（cordis-plugin-timer）在 web profile 提供
export const inject = ['timer', 'tools']

export function apply(ctx: Context) {
  publishVaultState() // vault 解析结果落盘 ~/.dsh/state/sun-space/，供浏览器端孙学空间发现
  ctx.plugin(source)
  ctx.plugin(workerWatchdog) // 全局 scope：盯 sun-worker 子代理卡死（事件冒泡到这里）
  // 首个 sun-router 会话创建时，自动登记其工作目录为 vault 根
  // （"当前目录作为 vault"语义的插件层落点；门控在 registerVaultRootFromSession——
  //  仅空目录或已含 90-Meta 骨架的工作区目录才登记，宿主 boot 桶不认；已有登记不覆盖）
  try {
    ctx.on('agent/created', (...args: unknown[]) => {
      const agent = (args[0] as { agent?: { session?: { header?: Record<string, unknown>; cwd?: unknown } } } | undefined)?.agent
      const header = agent?.session?.header as Record<string, unknown> | undefined
      if (header?.agentPreset !== 'sun-router') return
      const cwd = header.cwd ?? (agent as { cwd?: unknown } | undefined)?.cwd
      registerVaultRootFromSession(typeof cwd === 'string' ? cwd : undefined)
    })
  } catch { /* 事件通道缺席 → 退化为约定路径 */ }
}
