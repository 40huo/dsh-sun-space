/**
 * vault 路径解析——唯一事实源，全插件共享（source/router-tools/worker-vault/worker-watchdog）。
 *
 * 解析优先级：
 *   ① 环境变量 SUN_VAULT（启动命令注入，随进程生效）
 *   ② 实例启动目录下的 sun-space.config.json 的 vault 字段（持久化配置，重启不丢）
 *   ③ 默认约定 ~/Workspace/sun-vault
 *
 * 解析结果同时写入 <实例cwd>/sun-space.json（仅 vault 字段），作为浏览器端（孙学空间）
 * 的发现通道——浏览器读不到进程环境，靠这个文件拿到真实 vault 路径（workspaceFiles
 * 的相对路径读取以会话工作区根为基准，即实例 cwd，两者同目录）。
 *
 * 注意：本文件不携带任何个人路径；个人 vault 位置只存在于①/②（均不入库）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_VAULT_DIRNAME = 'sun-vault'

/** 解析 vault 绝对路径（① env ② 实例目录配置文件 ③ 默认约定）。 */
export function resolveVaultPath(cwd = process.cwd(), home = process.env.HOME ?? ''): string {
  if (process.env.SUN_VAULT && process.env.SUN_VAULT.trim() !== '') return process.env.SUN_VAULT
  try {
    const cfg = JSON.parse(readFileSync(join(cwd, 'sun-space.config.json'), 'utf8'))
    if (typeof cfg?.vault === 'string' && cfg.vault.startsWith('/')) return cfg.vault
  } catch { /* 无配置文件 → 默认约定 */ }
  return join(home, 'Workspace', DEFAULT_VAULT_DIRNAME)
}

export const VAULT = resolveVaultPath()

/** 把解析结果落盘为客户端发现文件（apply 时调用，尽力而为）。 */
export function publishVaultForClient(cwd = process.cwd()): void {
  try {
    writeFileSync(join(cwd, 'sun-space.json'), JSON.stringify({ vault: VAULT }, null, 2), 'utf8')
  } catch { /* 写不进不阻断启动 */ }
}
