import { describe, expect, it } from 'vitest'
import { judge, BLOCKED, blockedRule } from '../src/worker-guard'

const bash = (command: string) => judge('bash', { command })

describe('worker guard judge', () => {
  it('blocks approval actions', () => {
    expect(bash('dws oa task approve --id 123')).toMatch(/BLOCKED/)
    expect(bash('dws oa task reject --id 123 --comment no')).toMatch(/BLOCKED/)
  })

  it('blocks rm -rf and dws api writes', () => {
    expect(bash('rm -rf /tmp/x')).toMatch(/BLOCKED/)
    expect(bash('dws api POST /v1.0/foo')).toMatch(/BLOCKED/)
    expect(bash('dws api DELETE /v1.0/foo')).toMatch(/BLOCKED/)
  })

  it('allows read-only dws commands', () => {
    expect(bash('dws todo task list --format json')).toBeUndefined()
    expect(bash('dws oa +list-pending --start 1 --end 2')).toBeUndefined()
  })

  it('blocks sleep and long shell waits (noWait)', () => {
    expect(bash('sleep 30')).toMatch(/NO_WAIT/)
    expect(bash('echo hi && sleep 2')).toMatch(/NO_WAIT/)
    expect(judge('bash', { command: 'npm test', timeoutMs: 60_000 })).toMatch(/NO_WAIT/)
    expect(judge('bash', { command: 'npm test', timeoutMs: 30_000 })).toBeUndefined()
  })

  it('blocks long job waits', () => {
    expect(judge('job_output', { wait: true, timeout_ms: 8000 })).toMatch(/NO_WAIT/)
    expect(judge('job_output', { wait: true, timeout_ms: 5000 })).toBeUndefined()
    expect(judge('job_output', { timeout_ms: 8000 })).toBeUndefined()
  })

  it('passes through non-shell tools', () => {
    expect(judge('read', { path: '/x' })).toBeUndefined()
    expect(judge('grep', { pattern: 'y' })).toBeUndefined()
  })

  it('BLOCKED regexes are anchored enough to avoid false positives on reads', () => {
    // 读列表不应被误伤
    expect(BLOCKED[0].test('dws oa +list-pending --start 1')).toBe(false)
  })
})

// 0.3.7 及之前只匹配单一字面量，下面每一条"应拦"都曾放行。守卫是纵深防御：目标是堵住同一动作的
// 纯拼写变体（引号/转义/大小写/旗标拆合/前置包装），不宣称穷尽。
describe('blockedRule：拼写变体', () => {
  it.each([
    'rm -fr /tmp/x',
    'rm -r -f /tmp/x',
    'rm --recursive --force /tmp/x',
    'rm -vRf /tmp/x',
    'rm -rf -- /tmp/x',
    '"rm" -rf /tmp/x',
    '/bin/rm -rf /tmp/x',
    'sudo rm -rf /tmp/x',
    'xargs rm -rf',
    'sh -c "rm -rf /tmp/x"',
    'cd /tmp && rm\t-rf ./build',
    'echo done; rm  -rf /tmp/x',
  ])('拦：%s', (command) => {
    expect(blockedRule(command)).toMatch(/^rm 递归\+强制删除/)
  })

  it.each([
    'rm -r build/',
    'rm -f a.txt',
    'rm a.txt',
    'rm -- /tmp/-rf',
    'git rm -r --cached .',
    'docker rm -f c1',
  ])('放（只递归或只强制，或根本不是 rm 的旗标）：%s', (command) => {
    expect(blockedRule(command)).toBeUndefined()
  })

  it.each([
    'dws "oa" task approve --id 1',
    'dws oa task "approve" --id 1',
    'dws oa task APPROVE --id 1',
    'dws oa task ReJeCt --id 1',
    'dws --profile x oa task reject --id 1',
    'dws oa task --json approve --id 1',
    'DWS_CONFIG_DIR=/tmp/x dws oa task approve --id 1',
    '/usr/local/bin/dws oa task approve --id 1',
  ])('拦：%s', (command) => {
    expect(blockedRule(command)).toBe('dws oa task approve|reject')
  })

  it.each([
    'a=approve; dws oa task $a --id 1',
    'dws oa task $(echo approve) --id 1',
    'dws oa task `echo approve` --id 1',
  ])('拦（动词位是变量/命令替换，无法静态判定）：%s', (command) => {
    expect(blockedRule(command)).toMatch(/无法静态判定/)
  })

  it.each([
    'dws api post /v1.0/foo',
    'dws api --method post /v1.0/foo',
    'dws api --method=PUT /v1.0/foo',
    'dws api -X PATCH /v1.0/foo',
    'dws api -XPOST /v1.0/foo',
    'dws api /v1.0/foo -x delete',
  ])('拦（写方法的小写/旗标写法；PUT/PATCH 与 POST/DELETE 同列）：%s', (command) => {
    expect(blockedRule(command)).toMatch(/^dws api (POST|PUT|PATCH|DELETE)$/)
  })

  it.each([
    'dws oa task list -f json',
    'dws oa task show --id 1',
    'dws todo task create --subject "approve the release"',
    'dws api get /v1.0/x',
    'dws api GET /v1.0/x --jq \'.items[] | {id, subject}\'',
    'dws api GET /v1.0/x --jq \'{deleted: true}\'',
    'grep -rn "POST" src',
    'git commit -m "approve the release"',
    'curl -X POST https://example.com',
  ])('放（读命令，或不含 dws 的同名关键词）：%s', (command) => {
    expect(blockedRule(command)).toBeUndefined()
    expect(bash(command)).toBeUndefined()
  })
})
