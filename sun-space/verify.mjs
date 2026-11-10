#!/usr/bin/env node
/**
 * sun-space composition 自检（借鉴 cabinet-mode verify.mjs）。
 * 用法：node verify.mjs [--smoke]
 *   默认：①dump-config 组合断言 ②tsc 严格检查 ③vitest 单测 ④构建新鲜度（src vs lib mtime）
 *   --smoke：⑤运行实例烟雾（roster + 会话解析 + schedule 漂移断言；需 3081 实例在线）
 * 任一断言失败 → exit 1。
 */
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PATCH = join(ROOT, 'cordis.patch.yml')
const SMOKE = process.argv.includes('--smoke')

let failures = 0
const ok = (name) => console.log(`  ✅ ${name}`)
const fail = (name, detail) => { failures++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
const section = (name) => console.log(`\n▸ ${name}`)

// ---------- 解析参数 ----------
const DSH_BIN = process.env.DSH_BIN
  || (existsSync(process.env.HOME + '/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh')
    ? process.env.HOME + '/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh'
    : 'dsh')

console.log('Sun Space composition 自检\n=========================')

// ---------- ① dump-config 组合断言 ----------
section('① 组合断言（dump-config）')
let composed = ''
try {
  composed = execFileSync(DSH_BIN, [
    '--profile', 'web',
    '--patch', PATCH,
    '--dump-config',
  ], { encoding: 'utf8', timeout: 60_000 })
  ok('dump-config exit 0')
} catch (e) {
  fail('dump-config 执行失败', String(e.message).slice(0, 120))
}

if (composed) {
  const count = (s) => (composed.match(new RegExp(s, 'g')) || []).length
  count('id: sun-space') === 1 ? ok('sun-space 插件行恰好 1 条') : fail('sun-space 插件行', `出现 ${count('id: sun-space')} 次`)
  count("id: sun-router-preset") === 1 ? ok('sun-router 预设声明恰好 1 条') : fail('sun-router 预设声明', `出现 ${count('id: sun-router-preset')} 次`)
  count("id: sun-worker-preset") === 1 ? ok('sun-worker 预设声明恰好 1 条') : fail('sun-worker 预设声明', `出现 ${count('id: sun-worker-preset')} 次`)
  readFileSync(join(ROOT, 'src/router-tools.ts'), 'utf8').includes("agentPreset: 'sun-worker'")
    ? ok('sun_route 子会话挂 sun-worker 预设（代码级，spec.request）')
    : fail('sun_route 未挂 sun-worker 预设')
  readFileSync(join(ROOT, 'lib/index.mjs'), 'utf8').includes('worker-watchdog')
    ? ok('worker-watchdog 已构建进入口（实时盯 worker 卡死）')
    : fail('worker-watchdog 未构建进 lib/index.mjs')
  composed.includes('additionalWritableRoots') ? ok('沙箱白名单（dws 锁文件）在位') : fail('沙箱白名单缺失')
  composed.includes('tool-ask-user') ? ok('ask_user_question 决策卡已挂载') : fail('ask_user_question 未挂载')
} else {
  fail('组合断言跳过（dump-config 无输出）')
}

// ---------- ② tsc 严格检查（抓补丁链丢声明，aliveRef 教训） ----------
section('② TypeScript 严格检查')
try {
  const files = ['index', 'source', 'router-tools', 'worker-guard', 'worker-vault', 'vault', 'dws', 'ambient']
    .map(n => `src/${n}.ts`).join(' ').replace('src/ambient.ts', 'src/ambient.d.ts')
  execFileSync('npx', ['tsc', '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler',
    '--target', 'es2022', '--skipLibCheck', ...files.split(' ')],
    { encoding: 'utf8', timeout: 120_000, cwd: ROOT })
  ok('tsc --strict 通过（无未定义引用/类型错误）')
} catch (e) {
  fail('tsc 严格检查', String(e.stdout || e.message).slice(0, 300))
}

// ---------- ③ 单元测试 ----------
section('③ 单元测试（vitest）')
try {
  const out = execFileSync('npx', ['vitest', 'run', '--reporter=dot'], { encoding: 'utf8', timeout: 120_000, cwd: ROOT })
  const m = out.match(/Tests\s+(\d+) passed/)
  m ? ok(`vitest ${m[1]} 用例全绿`) : ok('vitest 通过')
} catch (e) {
  fail('vitest', String(e.stdout || e.message).slice(0, 300))
}

// ---------- ④ 构建新鲜度（src → lib：HANDOFF 踩坑 4"以运行时 lib 为契约源"——verify 全绿不能描述旧代码） ----------
// tsdown 会把被 import 的模块（source/vault/dws 等）打进入口 bundle，lib 只有入口产物——
// 故用保守规则：任一 src/*.ts 新于任一 lib/*.mjs 即判可能过期（client.js 由 src 直供、刷新即生效，不参与）。
section('④ 构建新鲜度（src/*.ts vs lib/*.mjs）')
try {
  const srcFiles = readdirSync(join(ROOT, 'src')).filter(f => f.endsWith('.ts'))
  const srcMax = Math.max(...srcFiles.map(f => statSync(join(ROOT, `src/${f}`)).mtimeMs))
  const libs = readdirSync(join(ROOT, 'lib')).filter(f => f.endsWith('.mjs'))
  if (libs.length === 0) throw new Error('lib/ 为空——从未构建')
  const stale = libs.filter(f => statSync(join(ROOT, `lib/${f}`)).mtimeMs < srcMax)
  stale.length === 0 ? ok('lib 全部新于 src（运行代码未过期）')
    : fail('lib 可能过期——先 pnpm build 再重启实例', stale.join('；'))
} catch (e) {
  fail('构建新鲜度检查', String(e.message).slice(0, 200))
}

// ---------- ⑤ 运行实例烟雾（可选）：roster + 会话解析 + schedule 漂移断言 ----------
const VAULT_PATH = process.env.SUN_VAULT ?? `${process.env.HOME}/Workspace/sun-vault`
const PROD_SCHEDULES = ['Sun 晨间简报（生产）', 'Sun 日报（生产）', 'Sun Watchdog 巡检（生产）', 'Sun 周复盘（生产）']

async function rpc(cookie, method, args) {
  const res = await fetch(`http://127.0.0.1:3081/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-' + method.replace(/\W/g, '-'), method, payload: { args } }),
  })
  const raw = await res.text()
  let j
  try { j = JSON.parse(raw) } catch { throw new Error(`网关返回非 JSON（status ${res.status}）：${raw.slice(0, 80)}`) }
  if (j?.result?.ok !== true) throw new Error(`${method}: ${JSON.stringify(j?.result?.error ?? j).slice(0, 160)}`)
  return j.result.value
}

if (SMOKE) {
  section('⑤ 运行实例烟雾（roster + 会话解析 + schedule 漂移）')
  try {
    const logFile = '/tmp/sun-dsh-web.log'
    if (!existsSync(logFile)) throw new Error('找不到 /tmp/sun-dsh-web.log（实例未启动或日志位置不同）')
    const log = readFileSync(logFile, 'utf8')
    const token = (log.match(/token=([A-Za-z0-9_-]+)/) || [])[1]
    if (!token) throw new Error('日志中无 token')
    // 两步鉴权：GET 页面拿 303 的 set-cookie。redirect:'manual' 是关键——默认跟随会把
    // set-cookie 丢在被跟随的最终响应里（此前烟雾 401 的根因）。
    const page = await fetch(`http://127.0.0.1:3081/?token=${token}`, { redirect: 'manual' })
    const cookie = page.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    if (!cookie.includes('dsh-auth')) throw new Error('token 交换未获得会话 cookie')

    const presets = (await rpc(cookie, 'agentPresets/list', {}))?.presets ?? []
    const router = presets.find(p => p.id === 'sun-router')
    const worker = presets.find(p => p.id === 'sun-worker')
    router && !router.broken ? ok('sun-router 在 roster 且未损坏') : fail('sun-router roster 状态', JSON.stringify(router))
    worker && !worker.broken ? ok('sun-worker 在 roster 且未损坏') : fail('sun-worker roster 状态', JSON.stringify(worker))

    // 会话解析（与 client.js resolveRouterSession 同链：sun-router 预设 → state.json 见 vault → updatedAt 最新）
    const items = (await rpc(cookie, 'session/list', { _request: {} }))?.items ?? []
    const candidates = items.filter(s => s?.projections?.values?.agentPreset === 'sun-router')
    candidates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    const routerSession = candidates[0]?.sessionId ?? null
    routerSession ? ok(`Router 会话可解析：${routerSession.slice(0, 28)}…（候选 ${candidates.length} 个）`)
      : fail('Router 会话解析为空（sun-router 预设会话不存在）')

    // schedule 漂移断言（轮换/删改守护：生产定时必须在册、active、target 指向当前 Router 会话）
    const scheds = (await rpc(cookie, 'schedule/list', { request: {} }))?.items ?? []
    for (const title of PROD_SCHEDULES) {
      const s = scheds.find(x => x.title === title)
      if (!s) { fail(`生产 schedule 缺失：${title}`); continue }
      if (s.status !== 'active') { fail(`生产 schedule 非 active：${title}（${s.status}）`); continue }
      if (routerSession && s.target?.sessionId !== routerSession) {
        fail(`schedule target 漂移：${title} 指向 ${s.target?.sessionId?.slice(0, 24)}…，当前 Router 会话是 ${routerSession.slice(0, 24)}…（轮换后未切换 target）`)
      } else {
        ok(`${title} active · target 对齐当前会话`)
      }
    }
  } catch (e) {
    // 非致命：烟雾层需要实例在线。组合完整性已由 ①-④ 覆盖。
    console.warn(`  ⚠️ 实例烟雾跳过 — ${String(e.message || e).slice(0, 140)}`)
  }
} else {
  console.log('\n（跳过 ⑤ 实例烟雾——加 --smoke 并启动实例后启用）')
}

// ---------- 汇总 ----------
console.log(failures === 0 ? '\n✅ 自检全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
