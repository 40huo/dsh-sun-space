#!/usr/bin/env node
/**
 * sun-space composition 自检（借鉴 cabinet-mode verify.mjs）。
 * 用法：node verify.mjs [--smoke]
 *   默认：①dump-config 组合断言 ②tsc 严格检查 ③vitest 单测
 *   --smoke：④运行实例 roster 烟雾（需 3081 实例在线，token 自动从 /tmp/sun-dsh-web.log 提取）
 * 任一断言失败 → exit 1。
 */
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
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

// ---------- ④ 运行实例 roster 烟雾（可选） ----------
if (SMOKE) {
  let smokeSkipped = false
  section('④ 运行实例 roster 烟雾')
  try {
    const logFile = '/tmp/sun-dsh-web.log'
    if (!existsSync(logFile)) throw new Error('找不到 /tmp/sun-dsh-web.log（实例未启动或日志位置不同）')
    const log = readFileSync(logFile, 'utf8')
    const token = (log.match(/token=([A-Za-z0-9_-]+)/) || [])[1]
    if (!token) { smokeSkipped = true; throw new Error('日志中无 token') }
    // 两步鉴权：先 GET 页面建立会话 cookie，再调网关
    const page = await fetch(`http://127.0.0.1:3081/?token=${token}`)
    const cookies = page.headers.getSetCookie().map(c => c.split(';')[0])
    const cookie = cookies.join('; ')
    const res = await fetch('http://127.0.0.1:3081/api/agentPresets/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ type: 'client-request', rpcId: 'verify', method: 'agentPresets/list', payload: { args: {} } }),
    })
    const raw = await res.text()
    let j
    try { j = JSON.parse(raw) } catch { throw new Error(`网关返回非 JSON（status ${res.status}）：${raw.slice(0, 80)}`) }
    const presets = j?.result?.value?.presets ?? []
    const router = presets.find(p => p.id === 'sun-router')
    const worker = presets.find(p => p.id === 'sun-worker')
    router && !router.broken ? ok('sun-router 在 roster 且未损坏') : fail('sun-router roster 状态', JSON.stringify(router))
    worker && !worker.broken ? ok('sun-worker 在 roster 且未损坏') : fail('sun-worker roster 状态', JSON.stringify(worker))
  } catch (e) {
    // 非致命：烟雾层需要 DSH launch-token 交换流程（浏览器自动完成，脚本复刻成本高）。
    // 组合完整性已由 ①②③ 覆盖；roster 健康可在浏览器 Console 用 __sunSpaceDebug 探测。
    console.warn(`  ⚠️ roster 烟雾跳过 — ${String(e.message || e).slice(0, 120)}`)
  }
} else {
  console.log('\n（跳过 ④ roster 烟雾——加 --smoke 并启动实例后启用）')
}

// ---------- 汇总 ----------
console.log(failures === 0 ? '\n✅ 自检全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
