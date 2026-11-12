/**
 * vault 路径解析——唯一事实源，全插件共享（source/router-tools/worker-vault/worker-watchdog）。
 *
 * 解析优先级（vaultPath() 每次调用重读，运行期变更即时生效）：
 *   ① 环境变量 SUN_VAULT（启动命令注入，随进程生效）
 *   ② ~/.dsh/state/sun-space/config.json 的 vault 字段（用户手写/补建指令写入，持久化，不入库）
 *   ③ 会话工作目录（调用方从 exec 提取传入，须过 cwdHasSkeleton 门控——目录已含 90-Meta
 *      骨架才算；"空目录"不算：DSH 默认 boot 桶 default-workspace 全新时也是空的，无法与
 *      "用户新建目录当知识库"区分，空目录意图在会话创建时由 registerVaultRootFromSession 落到 ④）
 *   ④ state.json 的 workspaces 映射（分桶登记：workspaces[<会话/实例 cwd>] = vault。
 *      DSH 会话按实例 boot cwd 分桶，一桶一 vault——多实例并存互不污染：
 *      homevault 实例登记 homevault，主实例解析不受影响）
 *   ⑤ state.json 的 vault 字段（全局兜底；只承载 ①② 显式值的镜像，见 publishVaultState）
 *   ⑥ 默认约定 ~/Workspace/sun-vault（仅全新裸环境兜底）
 *
 * 无会话上下文的调用方（source/worker-watchdog）：用 vaultPathForHost()——以实例进程
 * cwd（= 本桶 boot 目录）查 ④ 映射，与本实例会话解析一致。
 *
 * publishVaultState 纪律（v0.3.2 根因修复）：落盘值仅限显式来源（①②⑤），⑥ 兜底值不写——
 * 落了会把默认路径固化成登记值，堵死 ③④ 级（v0.3.1 及之前每次插件启动即写入，新开工作区
 * 时"识别到的知识库"永远是 ~/Workspace/sun-vault 的幽灵）。
 *
 * registerVaultRootFromSession（首个 sun-router 会话创建时调用）：仅对 vault 候选目录
 * （空目录或已含 90-Meta）登记 workspaces[cwd]=cwd，不写全局 vault 字段——全局槽一旦
 * 写入首个工作区，会遮蔽其他实例/桶的解析（多 vault 场景交叉污染）。
 *
 * 目录约定沿用 DSH 官方先例：~/.dsh/state/<插件名>/（session-superagent 同款）。
 * 本文件不携带任何个人路径；个人 vault 位置只存在于①②⑤（均不入库）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_VAULT_DIRNAME = 'sun-vault'

/** 插件自有状态目录（<DSH_HOME 或 ~/>/.dsh/state/sun-space/），沿用官方 state/<插件名> 约定。
 *  跟随 DSH_HOME：多实例（隔离 HOME 的测试环境）之间状态互不串扰。 */
export const stateDir = () => join(process.env.DSH_HOME ?? homedir(), '.dsh', 'state', 'sun-space')

type VaultState = { vault?: string; workspaces?: Record<string, string>; updatedAt?: string }

function parseState(stateJson: string | undefined): VaultState | null {
  try { return JSON.parse(stateJson ?? '') } catch { return null } // 无/坏 JSON → 视为无状态
}

/** 目录是否已含 vault 骨架（③ 级门控：已初始化的工作区目录就是 vault）。 */
export function cwdHasSkeleton(cwd: string | undefined): boolean {
  if (!cwd || !cwd.startsWith('/')) return false
  try { return existsSync(join(cwd, '90-Meta')) } catch { return false }
}

/** 目录是否为 vault 候选（登记门控）：空目录（非隐藏项为 0，git init 过的也算）
 *  或已含 90-Meta 骨架。有内容而无骨架的目录（代码仓库根等）不是候选。 */
export function cwdIsVaultCandidate(cwd: string | undefined): cwd is string {
  if (!cwd || !cwd.startsWith('/')) return false
  try {
    if (existsSync(join(cwd, '90-Meta'))) return true
    return readdirSync(cwd).every(name => name.startsWith('.'))
  } catch { return false } // 不存在/不可读 → 不当候选
}

/** 纯函数：六级优先解析（测试与 vaultPath 共用）。
 *  sessionCwd 须由调用方先过 cwdHasSkeleton 门控；bucketCwd 为分桶目录（④ 映射查询用，
 *  缺省同 sessionCwd）。 */
export function computeVaultPath(
  envValue: string | undefined,
  configJson: string | undefined,
  stateJson: string | undefined,
  sessionCwd: string | undefined,
  home = homedir(),
  bucketCwd?: string,
): string {
  if (envValue && envValue.trim() !== '') return envValue
  try {
    const cfg = JSON.parse(configJson ?? '')
    if (typeof cfg?.vault === 'string' && cfg.vault.startsWith('/')) return cfg.vault
  } catch { /* 无/坏 JSON → 下一级 */ }
  const state = parseState(stateJson)
  if (sessionCwd && sessionCwd.startsWith('/')) return sessionCwd
  const bucket = bucketCwd ?? sessionCwd
  if (bucket && bucket.startsWith('/')) {
    const mapped = state?.workspaces?.[bucket]
    if (typeof mapped === 'string' && mapped.startsWith('/')) return mapped
  }
  if (typeof state?.vault === 'string' && state.vault.startsWith('/')) return state.vault
  return join(home, 'Workspace', DEFAULT_VAULT_DIRNAME)
}

/** ①②⑤ 显式来源（env/config/全局镜像）的取值；全空返回 undefined——
 *  ⑥ 兜底、③ 会话目录、④ 分桶映射都不算"显式"（publishVaultState 据此决定是否落盘）。 */
export function explicitVaultValue(
  envValue: string | undefined,
  configJson: string | undefined,
  stateJson: string | undefined,
): string | undefined {
  if (envValue && envValue.trim() !== '') return envValue
  for (const raw of [configJson, stateJson]) {
    const parsed = parseState(raw)
    if (parsed && typeof parsed.vault === 'string' && parsed.vault.startsWith('/')) return parsed.vault
  }
  return undefined
}

let cached: { at: number; key: string; value: string } = { at: 0, key: '', value: '' }

function resolve(sessionCwd: string | undefined, now: number): string {
  const dir = stateDir()
  let configJson: string | undefined
  let stateJson: string | undefined
  try { configJson = readFileSync(join(dir, 'config.json'), 'utf8') } catch { /* 无配置 */ }
  try { stateJson = readFileSync(join(dir, 'state.json'), 'utf8') } catch { /* 无状态 */ }
  const cwdSkeleton = cwdHasSkeleton(sessionCwd) ? sessionCwd : undefined
  const bucket = sessionCwd && sessionCwd.startsWith('/') ? sessionCwd : undefined
  const key = `${cwdSkeleton ?? ''}|${bucket ?? ''}|${configJson ?? ''}|${stateJson ?? ''}`
  if (now - cached.at < 60_000 && cached.key === key) return cached.value
  const value = computeVaultPath(process.env.SUN_VAULT, configJson, stateJson, cwdSkeleton, homedir(), bucket)
  cached = { at: now, key, value }
  return value
}

/** 运行期解析：每次调用重读状态目录（60s 微缓存防抖），登记/手改后即时生效。
 *  sessionCwd：调用方从 exec 提取的会话工作目录（可选）——本桶已初始化（含 90-Meta）
 *  或已在 workspaces 映射登记时，vault 就解析到哪。 */
export function vaultPath(sessionCwd?: string, now = Date.now()): string {
  return resolve(sessionCwd, now)
}

/** 无会话上下文的调用方（source/watchdog 等）：以实例进程 cwd（= 本桶 boot 目录）解析，
 *  与本实例会话一致（④ 映射按桶命中）。 */
export function vaultPathForHost(now = Date.now()): string {
  return resolve(process.cwd(), now)
}

/** 启动期快照（兼容保留：运行期动态解析请用 vaultPath()/vaultPathForHost()）。 */
export const VAULT = vaultPath()

/** 状态目录诊断快照（sun_state_read 用）：config/state 解析值 + 调用方视角的实际解析结果。
 *  "登记了什么 vs 实际生效什么"一眼可比（晨报自检/vault 解析诊断）。只读，不触发写回。 */
export function readStateSnapshot(sessionCwd?: string, now = Date.now()): {
  config: { vault?: string } | null
  state: VaultState | null
  resolvedVault: string
} {
  const dir = stateDir()
  let config: { vault?: string } | null = null
  let state: VaultState | null = null
  try { config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) } catch { /* 无配置 */ }
  try { state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) } catch { /* 无状态 */ }
  return { config, state, resolvedVault: vaultPath(sessionCwd, now) }
}

/**
 * Router 会话创建时登记 vault 根（"当前目录作为 vault"语义的落点）。
 * 仅对候选目录（空目录或已含 90-Meta 骨架）登记 workspaces[cwd]=cwd——分桶登记，
 * 不写全局 vault 字段（防多实例交叉污染）；env 钉死时不登记（尊重显式覆盖）。
 * 同桶幂等；尽力而为：任何失败静默退场（最坏是回退到约定路径）。
 */
export function registerVaultRootFromSession(cwd: string | undefined, now = new Date()): boolean {
  if (!cwdIsVaultCandidate(cwd)) return false
  if (process.env.SUN_VAULT?.trim()) return false
  try {
    const dir = stateDir()
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'state.json')
    let raw: string | undefined
    try { raw = readFileSync(p, 'utf8') } catch { /* 首次登记 */ }
    const state = parseState(raw) ?? {}
    if (state.workspaces?.[cwd]) return false // 同桶已登记，幂等
    state.workspaces = { ...(state.workspaces ?? {}), [cwd]: cwd }
    state.updatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
    return true
  } catch { return false }
}

/** 把显式解析结果写回状态目录的 state.json（apply 时调用，尽力而为），供客户端发现。
 *  纪律：仅显式来源（①env/②config/⑤全局镜像）才落盘；⑥ 兜底值不写——
 *  否则默认路径被固化成登记值，堵死 ③④ 级（v0.3.2 修复的根因）。
 *  workspaces 分桶映射由 registerVaultRootFromSession 维护，此处原样保留。 */
export function publishVaultState(now = new Date()): void {
  try {
    const dir = stateDir()
    let configJson: string | undefined
    let stateJson: string | undefined
    try { configJson = readFileSync(join(dir, 'config.json'), 'utf8') } catch { /* 无配置 */ }
    try { stateJson = readFileSync(join(dir, 'state.json'), 'utf8') } catch { /* 无状态 */ }
    if (!explicitVaultValue(process.env.SUN_VAULT, configJson, stateJson)) return // 无显式来源 → 不落盘（防幽灵登记）
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'state.json')
    const state = parseState(stateJson) ?? {}
    state.vault = vaultPath(undefined, now.getTime())
    state.updatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
  } catch { /* 写不进不阻断启动 */ }
}
