/**
 * sun-space 插件入口。
 * 预设（sun-router / sun-worker）由 cordis.patch.yml 声明为 agent-preset；
 * 本入口负责 Source（dws 轮询 + 定时 Trigger）。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as source from './source'

export const name = 'sun-space'

// timer 服务由 vendor/timer（cordis-plugin-timer）在 web profile 提供
export const inject = ['timer', 'tools']

export function apply(ctx: Context) {
  ctx.plugin(source)
}
