/**
 * sun-worker 预设的子插件：sun_artifact_write —— Worker 的受控产物落库通道。
 * 仅允许写入 <VAULT>/50-Tasks/artifacts/<task_id>/<filename>；路径守卫复用 vault.ts。
 * 依据架构 §4.2：产物统一落 artifacts 目录，与任务笔记同源可召回。
 */

import type { Context } from '@deepseek-ai/cordis'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveSafe, VaultPathError } from './vault'

export const inject = ['tools']

import { vaultPath } from './vault-path'

/** 从工具执行上下文提取会话工作目录（同 router-tools）。 */
function sessionCwdOf(exec: unknown): string | undefined {
  const e = exec as { agent?: { session?: { cwd?: unknown; header?: { cwd?: unknown } } }; session?: { cwd?: unknown } } | undefined
  const c = e?.agent?.session?.cwd ?? e?.agent?.session?.header?.cwd ?? e?.session?.cwd
  return typeof c === 'string' && c.startsWith('/') ? c : undefined
}

const TASK_ID = /^T-\d{8}-\d{2}$/

/** 纯函数：拼装受控产物路径；非法输入抛 VaultPathError。可单测。 */
export function artifactPath(taskId: string, filename: string): string {
  if (!TASK_ID.test(taskId)) throw new VaultPathError(`bad task_id: ${taskId}（应为 T-YYYYMMDD-NN）`)
  if (!filename || filename.includes('/') || filename.includes('..') || filename.startsWith('.')) {
    throw new VaultPathError(`bad filename: ${filename}`)
  }
  return `50-Tasks/artifacts/${taskId}/${filename}`
}

export function apply(ctx: Context) {
  ctx.tools.register({
    name: 'sun_artifact_write',
    description:
      '把任务产物写入知识库（唯一落库通道）。路径由 task_id + filename 决定，写入 50-Tasks/artifacts/<task_id>/<filename>。不要用 file 工具写相对路径产物。',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '任务 ID，格式 T-YYYYMMDD-NN' },
        filename: { type: 'string', description: '文件名（不含目录），如 summary.md' },
        content: { type: 'string' },
      },
      required: ['task_id', 'filename', 'content'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, path: { type: 'string' }, note: { type: 'string' } },
        required: ['ok'],
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args: unknown, exec?: unknown) => {
      const { task_id: taskId, filename, content } = (args ?? {}) as {
        task_id?: string; filename?: string; content?: string
      }
      try {
        const rel = artifactPath(String(taskId), String(filename))
        const abs = resolveSafe(vaultPath(sessionCwdOf(exec)), rel)
        await mkdir(join(abs, '..'), { recursive: true })
        await writeFile(abs, String(content ?? ''), 'utf8')
        return { ok: true, path: rel }
      } catch (e) {
        if (e instanceof VaultPathError) return { ok: false, note: `拒绝: ${e.message}` }
        return { ok: false, note: String((e as Error).message).slice(0, 200) }
      }
    },
  })
  ctx.logger?.info?.('[sun-space] worker artifact tool registered: sun_artifact_write')
}
