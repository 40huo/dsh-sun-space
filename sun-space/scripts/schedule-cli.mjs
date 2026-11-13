#!/usr/bin/env node
/**
 * Sun 定时任务命令行——target 治理的程序化路径（架构 §5.3 三层分工的配套工具）。
 *
 * 背景：原生 UI 的"执行位置"只有 new_once（新建会话并复用）/ new（每次新建）两种，
 * 没有暴露 target=session（绑定已有会话）——而 Sun 业务任务必须绑当前 Router 会话
 * （人格与 sun_* 工具在预设会话上、state.json 轮换不变量要求 target 对齐）。
 * 本脚本补齐这个缺口：新增/改靶/查看一律自动解析"当前 Router 会话"。
 *
 * 用法：
 *   node scripts/schedule-cli.mjs list
 *   node scripts/schedule-cli.mjs add --title "标题" --cron "0 9 * * 1-5" [--tz Asia/Shanghai] --prompt "任务指令（薄引用 runbook §N）"
 *   node scripts/schedule-cli.mjs retarget <scheduleId>    # 把 UI 建的任务改靶到当前 Router 会话
 * 实例要求：3081 在线，token 在 /tmp/sun-dsh-web.log（同 verify.mjs）。
 */
import { readFileSync, existsSync } from 'node:fs'

const BASE = 'http://127.0.0.1:3081'
const LOG = process.env.SUN_DSH_LOG ?? '/tmp/sun-dsh-web.log' // 实例 launch 日志（多实例时用 SUN_DSH_LOG 指向对应日志）
// vault 解析与插件同源（vault-path.ts 六级链的脚本镜像）：
// ①SUN_VAULT ②config.json（全局显式）③state.json workspaces 分桶映射 ④桶目录自带 90-Meta 骨架 ⑤约定路径
const stateSpace = `${process.env.DSH_HOME ?? process.env.HOME}/.dsh/state/sun-space`
function readJsonSafe(p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
// 归一化 vault 登记条目（新 vaults 数组 + 旧 workspaces 读兼容，与插件/工作台同款）
function vaultEntries(st) {
  const out = Array.isArray(st?.vaults) ? st.vaults.filter(e => typeof e?.dir === 'string' && e.dir.startsWith('/')) : []
  for (const k of Object.keys(st?.workspaces ?? {})) if (k.startsWith('/') && !out.some(x => x.dir === k)) out.push({ dir: k })
  return out
}
async function resolveVault(cookie, items) {
  if (process.env.SUN_VAULT) return process.env.SUN_VAULT
  const cfg = readJsonSafe(`${stateSpace}/config.json`)
  if (typeof cfg?.vault === 'string' && cfg.vault.startsWith('/')) return cfg.vault
  const bucket = [...new Set(items.map(s => String(s.cwd || '')).filter(c => c.startsWith('/')))][0]
  if (bucket) {
    const mapped = readJsonSafe(`${stateSpace}/state.json`)?.workspaces?.[bucket]
    if (typeof mapped === 'string' && mapped.startsWith('/')) return mapped
    try { // 桶目录自带骨架（新机工作区初始化流：vault 就在桶目录里）
      await rpc(cookie, 'workspaceFiles/read', { workspaceFileScopeId: items[0].sessionId, path: `${bucket}/90-Meta/runbook.md`, range: { limit: 2 } })
      return bucket
    } catch { /* 无骨架 → 约定兜底 */ }
  }
  return `${process.env.HOME}/Workspace/sun-vault`
}

function fail(msg) { console.error('❌ ' + msg); process.exit(1) }

// ---------- 鉴权（同 verify.mjs：redirect:'manual' 才能拿到 303 的 set-cookie） ----------
function authCookie() {
  if (!existsSync(LOG)) fail(`找不到 ${LOG}（实例未启动）`)
  const token = (readFileSync(LOG, 'utf8').match(/token=([A-Za-z0-9_-]+)/) || [])[1]
  if (!token) fail('日志中无 token')
  return { token, cookie: null }
}

async function rpc(cookie, method, args) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'sun-cli-' + method.replace(/\W/g, '-'), method, payload: { args } }),
  })
  const raw = await res.text()
  let j
  try { j = JSON.parse(raw) } catch { throw new Error(`网关返回非 JSON（status ${res.status}）：${raw.slice(0, 120)}`) }
  if (j?.result?.ok !== true) throw new Error(`${method}: ${JSON.stringify(j?.result?.error ?? j).slice(0, 200)}`)
  return j.result.value
}

// ---------- 会话解析（与 client.js resolveRouterSession 同链） ----------
async function resolveRouterSession(cookie) {
  const items = (await rpc(cookie, 'session/list', { _request: {} }))?.items ?? []
  const candidates = items.filter(s => s?.projections?.values?.agentPreset === 'sun-router')
  if (!candidates.length) throw new Error('没有 sun-router 预设会话（先在工作台创建）')
  const VAULT = await resolveVault(cookie, items)
  // ① 插件状态 vaults[].router 裁决（v0.3.5 唯一登记点）
  const hit = vaultEntries(readJsonSafe(`${stateSpace}/state.json`)).find(e => typeof e.router === 'string' && candidates.some(c => c.sessionId === e.router))
  if (hit) return { sessionId: hit.router, source: '插件状态 vaults.router' }
  // ② 过渡期兜底：旧 vault 内 90-Meta/system/state.json（v0.3.5 前自登记）
  for (const s of candidates) {
    try {
      const v = await rpc(cookie, 'workspaceFiles/read', {
        workspaceFileScopeId: s.sessionId, path: `${VAULT}/90-Meta/system/state.json`, range: { limit: 4 },
      })
      const st = JSON.parse(v?.text || '{}')
      if (st?.routerSession && candidates.some(c => c.sessionId === st.routerSession)) {
        return { sessionId: st.routerSession, source: 'vault 内 state.json（旧）' }
      }
    } catch { /* 无 state.json → 兜底 */ }
  }
  // ③ updatedAt 最新
  candidates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return { sessionId: candidates[0].sessionId, source: 'updatedAt 兜底' }
}

// ---------- 子命令 ----------
async function main() {
  const auth = authCookie()
  const page = await fetch(`${BASE}/?token=${auth.token}`, { redirect: 'manual' })
  const cookie = page.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  if (!cookie.includes('dsh-auth')) fail('token 交换未获得会话 cookie')

  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'list') {
    const items = (await rpc(cookie, 'schedule/list', { request: {} }))?.items ?? []
    const { sessionId, source } = await resolveRouterSession(cookie)
    console.log(`当前 Router 会话：${sessionId}（解析依据：${source}）\n`)
    for (const s of items) {
      const aligned = s.target?.sessionId === sessionId ? '✓对齐' : (s.kind === 'cron' && s.status === 'active' ? '✗漂移' : ' ')
      const when = s.expression ? `cron ${s.expression} ${s.timeZone ?? ''}` : (s.kind === 'after' ? `一次性 ${s.scheduledAt}` : s.kind)
      console.log(`${aligned} [${s.status}] ${s.title}  |  ${when}`)
      console.log(`         id=${s.id}  target=${s.target?.sessionId ?? s.target?.kind}`)
    }
    return
  }
  if (cmd === 'add') {
    const get = (k) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : undefined }
    const title = get('title'); const cron = get('cron'); const prompt = get('prompt'); const tz = get('tz') ?? 'Asia/Shanghai'
    if (!title || !cron || !prompt) fail('用法：add --title "..." --cron "0 9 * * 1-5" --prompt "..." [--tz Asia/Shanghai]')
    const { sessionId, source } = await resolveRouterSession(cookie)
    const v = await rpc(cookie, 'schedule/create', { request: {
      title, prompt,
      timing: { kind: 'cron', cron: { expression: cron, time_zone: tz } },
      target: { kind: 'session', sessionId },
    } })
    console.log(`✅ 已创建：${v.id}`)
    console.log(`   title=${title}\n   cron=${cron} ${tz}\n   target=${sessionId}（解析依据：${source}）`)
    return
  }
  if (cmd === 'retarget') {
    const id = rest[0]
    if (!id) fail('用法：retarget <scheduleId>（UI 建的任务改靶到当前 Router 会话）')
    const { sessionId, source } = await resolveRouterSession(cookie)
    await rpc(cookie, 'schedule/edit', { request: { id, action: 'update', patch: { target: { kind: 'session', sessionId } } } })
    console.log(`✅ 已改靶：${id} → ${sessionId}（解析依据：${source}）`)
    return
  }
  if (cmd === 'rm') {
    const id = rest[0]
    if (!id) fail('用法：rm <scheduleId>')
    await rpc(cookie, 'schedule/edit', { request: { id, action: 'delete' } })
    console.log(`✅ 已删除：${id}`)
    return
  }
  fail('用法：schedule-cli.mjs list | add --title ... --cron ... --prompt ... | retarget <id> | rm <id>')
}

main().catch(e => fail(String(e.message || e)))
