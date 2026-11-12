/**
 * vault 路径解析——唯一事实源，全插件共享（source/router-tools/worker-vault/worker-watchdog）。
 *
 * 解析优先级（vaultPath() 每次调用重读，运行期变更即时生效）：
 *   ① 环境变量 SUN_VAULT（启动命令注入，随进程生效）
 *   ② ~/.dsh/state/sun-space/config.json 的 vault 字段（用户手写，持久化，不入库）
 *   ③ ~/.dsh/state/sun-space/state.json 的 vault 字段（Router 会话创建时插件自动登记 = 用户选定的工作区目录）
 *   ④ 默认约定 ~/Workspace/sun-vault
 *
 * ③ 的设计动机：用户的 vault 就是他在 DSH 里选定的那个目录——Router 会话创建时
 * 插件自动把该会话 cwd 登记为 vault 根（registerVaultRootFromSession），无需任何
 * 手工配置。①② 供自定义/覆盖；④ 仅在全新裸环境兜底。
 *
 * 解析结果写回 state.json，作为浏览器端（孙学空间）的发现通道——浏览器经
 * workspaceFiles/read 以绝对路径读取该文件（工作区外绝对路径读取被宿主允许）。
 *
 * 目录约定沿用 DSH 官方先例：~/.dsh/state/<插件名>/（session-superagent 同款）。
 * 本文件不携带任何个人路径；个人 vault 位置只存在于①②③（均不入库）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_VAULT_DIRNAME = 'sun-vault'

/** 插件自有状态目录（<DSH_HOME 或 ~/>/.dsh/state/sun-space/），沿用官方 state/<插件名> 约定。
 *  跟随 DSH_HOME：多实例（隔离 HOME 的测试环境）之间状态互不串扰。 */
export const stateDir = () => join(process.env.DSH_HOME ?? homedir(), '.dsh', 'state', 'sun-space')

/** 纯函数：四级优先解析（测试与 vaultPath 共用）。 */
export function computeVaultPath(
  envValue: string | undefined,
  configJson: string | undefined,
  stateJson: string | undefined,
  home = homedir(),
): string {
  if (envValue && envValue.trim() !== '') return envValue
  for (const raw of [configJson, stateJson]) {
    try {
      const parsed = JSON.parse(raw ?? '')
      if (typeof parsed?.vault === 'string' && parsed.vault.startsWith('/')) return parsed.vault
    } catch { /* 无/坏配置 → 下一级 */ }
  }
  return join(home, 'Workspace', DEFAULT_VAULT_DIRNAME)
}

let cached: { at: number; key: string; value: string } = { at: 0, key: '', value: '' }

/** 运行期解析：每次调用重读状态目录（60s 微缓存防抖），登记/手改后即时生效。 */
export function vaultPath(now = Date.now()): string {
  const dir = stateDir()
  let configJson: string | undefined
  let stateJson: string | undefined
  try { configJson = readFileSync(join(dir, 'config.json'), 'utf8') } catch { /* 无配置 */ }
  try { stateJson = readFileSync(join(dir, 'state.json'), 'utf8') } catch { /* 无状态 */ }
  const key = `${configJson ?? ''}|${stateJson ?? ''}`
  if (now - cached.at < 60_000 && cached.key === key) return cached.value
  const value = computeVaultPath(process.env.SUN_VAULT, configJson, stateJson)
  cached = { at: now, key, value }
  return value
}

/** 启动期快照（兼容保留：运行期动态解析请用 vaultPath()）。 */
export const VAULT = vaultPath()

/**
 * Router 会话创建时登记 vault 根（"当前目录作为 vault"语义的落点）。
 * 仅在更高优先级来源（env/config/state）均未设置时才登记首个值——
 * 多 Router 并存或重复创建时第一个登记者生效。
 * 尽力而为：任何失败静默退场（最坏是回退到约定路径）。
 */
export function registerVaultRootFromSession(cwd: string | undefined, now = new Date()): boolean {
  if (!cwd || !cwd.startsWith('/')) return false
  if (process.env.SUN_VAULT?.trim()) return false
  try {
    const dir = stateDir()
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'state.json')
    let state: { vault?: string; [k: string]: unknown } = {}
    try { state = JSON.parse(readFileSync(p, 'utf8')) } catch { /* 首次 */ }
    if (state.vault && state.vault.startsWith('/')) return false // 已有登记，不覆盖
    state.vault = cwd
    state.updatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
    return true
  } catch { return false }
}

/** 把解析结果写回状态目录的 state.json（apply 时调用，尽力而为），供客户端发现。 */
export function publishVaultState(now = new Date()): void {
  try {
    const dir = stateDir()
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'state.json')
    let state: { vault?: string; [k: string]: unknown } = {}
    try { state = JSON.parse(readFileSync(p, 'utf8')) } catch { /* 首次 */ }
    state.vault = vaultPath(now.getTime())
    state.updatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
  } catch { /* 写不进不阻断启动 */ }
}
