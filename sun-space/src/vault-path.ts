/**
 * vault 路径解析——唯一事实源，全插件共享（source/router-tools/worker-vault/worker-watchdog）。
 *
 * 解析优先级：
 *   ① 环境变量 SUN_VAULT（启动命令注入，随进程生效）
 *   ② ~/.dsh/state/sun-space/config.json 的 vault 字段（用户手写，持久化，不入库）
 *   ③ 默认约定 ~/Workspace/sun-vault
 *
 * 解析结果写回 ~/.dsh/state/sun-space/state.json，作为浏览器端（孙学空间）的发现
 * 通道——浏览器读不到进程环境与插件 config，经 workspaceFiles/read 以绝对路径读取
 * 该文件（工作区外绝对路径读取被宿主允许，与 vault 本体读取同机制）。
 *
 * 目录约定沿用 DSH 官方先例：~/.dsh/state/<插件名>/（社区插件 session-superagent 同款）。
 * 本文件不携带任何个人路径；个人 vault 位置只存在于①/②（均不入库）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_VAULT_DIRNAME = 'sun-vault'

/** 插件自有状态目录（~/.dsh/state/sun-space/），沿用官方 state/<插件名> 约定。 */
export const STATE_DIR = join(homedir(), '.dsh', 'state', 'sun-space')

/** 纯函数：给定 env 与 config 内容时的解析结果（测试与 vaultPath 共用）。 */
export function computeVaultPath(envValue: string | undefined, configJson: string | undefined, home = homedir()): string {
  if (envValue && envValue.trim() !== '') return envValue
  try {
    const cfg = JSON.parse(configJson ?? '')
    if (typeof cfg?.vault === 'string' && cfg.vault.startsWith('/')) return cfg.vault
  } catch { /* 无/坏配置 → 默认约定 */ }
  return join(home, 'Workspace', DEFAULT_VAULT_DIRNAME)
}

let cached: { at: number; key: string; value: string } = { at: 0, key: '', value: '' }

/** 运行期解析：每次调用重读 config.json（60s 微缓存防抖），"以当前目录初始化"写入后即时生效。 */
export function vaultPath(now = Date.now()): string {
  let configJson: string | undefined
  try {
    configJson = readFileSync(join(STATE_DIR, 'config.json'), 'utf8')
  } catch { /* 无配置文件 */ }
  if (now - cached.at < 60_000 && cached.key === (configJson ?? '')) return cached.value
  const value = computeVaultPath(process.env.SUN_VAULT, configJson)
  cached = { at: now, key: configJson ?? '', value }
  return value
}

/** 解析 vault 绝对路径（① env ② 状态目录 config.json ③ 默认约定）。stateDir 参数化以便测试隔离。 */
export function resolveVaultPath(home = homedir(), stateDir = STATE_DIR): string {
  if (process.env.SUN_VAULT && process.env.SUN_VAULT.trim() !== '') return process.env.SUN_VAULT
  try {
    const cfg = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8'))
    if (typeof cfg?.vault === 'string' && cfg.vault.startsWith('/')) return cfg.vault
  } catch { /* 无配置文件 → 默认约定 */ }
  return join(home, 'Workspace', DEFAULT_VAULT_DIRNAME)
}

/** 启动期快照（兼容保留：运行期动态解析请用 vaultPath()）。 */
export const VAULT = vaultPath()

/** 把解析结果写回状态目录的 state.json（apply 时调用，尽力而为），供客户端发现。 */
export function publishVaultState(now = new Date()): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(
      join(STATE_DIR, 'state.json'),
      JSON.stringify({ vault: vaultPath(now.getTime()), updatedAt: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` }, null, 2),
      'utf8',
    )
  } catch { /* 写不进不阻断启动 */ }
}
