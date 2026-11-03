const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const { fetchUsage, mergeReadings, parseUsageResponse, present, runDir } = require('../meter')

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js')
fs.chmodSync(FAKE_CLAUDE, 0o755)

// The shape Claude Code 2.1.317 answers get_usage with, trimmed.
const RESPONSE = {
  subscription_type: 'team',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 24, resets_at: '2026-11-03T22:09:59.719085+00:00' },
    seven_day: { utilization: 4, resets_at: '2026-11-10T16:59:59.719109+00:00' },
    limits: [
      { kind: 'session', group: 'session', percent: 24, resets_at: '2026-11-03T22:09:59.719085+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 4, resets_at: '2026-11-10T16:59:59.719109+00:00', scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 0,
        resets_at: '2026-11-10T17:00:00+00:00',
        scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      },
    ],
  },
}

const AT = Date.parse('2026-11-03T19:13:00Z')

test('reads the 5-hour, weekly and per-model windows', () => {
  assert.deepEqual(parseUsageResponse(RESPONSE, AT), {
    at: AT,
    limits: [
      { kind: 'five_hour', percentUsed: 24, resetsAt: '2026-11-03T22:09:59.719Z' },
      { kind: 'seven_day', percentUsed: 4, resetsAt: '2026-11-10T16:59:59.719Z' },
      { kind: 'seven_day_fable', label: 'Fable', percentUsed: 0, resetsAt: '2026-11-10T17:00:00.000Z' },
    ],
  })
})

test('falls back to the named windows when there is no limits list', () => {
  const { limits, ...rest } = RESPONSE.rate_limits

  assert.deepEqual(parseUsageResponse({ rate_limits: rest }, AT)?.limits, [
    { kind: 'five_hour', percentUsed: 24, resetsAt: '2026-11-03T22:09:59.719Z' },
    { kind: 'seven_day', percentUsed: 4, resetsAt: '2026-11-10T16:59:59.719Z' },
  ])
})

test('ignores answers and rows it cannot read', () => {
  for (const response of [null, undefined, {}, { rate_limits: null }, { rate_limits: { limits: [] } }]) {
    assert.equal(parseUsageResponse(response, AT), null)
  }

  const odd = { rate_limits: { limits: [null, { kind: 'session', percent: '24' }, { kind: 'weekly_scoped', percent: 5, scope: null }, { kind: 'session', percent: 9, resets_at: 'soon' }] } }
  assert.deepEqual(parseUsageResponse(odd, AT)?.limits, [{ kind: 'five_hour', percentUsed: 9 }])
})

test('the newer reading wins each window, and per-model windows are kept', () => {
  const fromSession = { at: AT + 60_000, limits: [{ kind: 'five_hour', percentUsed: 25 }, { kind: 'seven_day', percentUsed: 4 }] }
  const fromUsage = parseUsageResponse(RESPONSE, AT)

  assert.deepEqual(
    mergeReadings(fromSession, fromUsage).map(({ kind, percentUsed, at }) => [kind, percentUsed, at]),
    [
      ['five_hour', 25, AT + 60_000],
      ['seven_day', 4, AT + 60_000],
      ['seven_day_fable', 0, AT],
    ],
  )
  assert.equal(mergeReadings(fromSession, { ...fromUsage, at: AT + 120_000 })[0].percentUsed, 24)
  assert.deepEqual(mergeReadings(null, null), [])
})

test('the status bar text and hover show every window', () => {
  const limits = mergeReadings(null, parseUsageResponse(RESPONSE, AT))
  const shown = present(limits, AT)

  assert.equal(shown.text, '$(dashboard) 5h 24% · Wk 4% · Fable 0%')
  assert.equal(shown.isWarning, false)
  assert.match(shown.tooltip, /\| Week \(Fable\) \| `▱+` \| \*\*0%\*\* \|/)
  assert.doesNotMatch(shown.tooltip, /As of/)
})

test('a reset window reads zero, a high one warns, an old reading says so', () => {
  const limits = [
    { kind: 'five_hour', percentUsed: 90, resetsAt: new Date(AT - 1000).toISOString(), at: AT },
    { kind: 'seven_day', percentUsed: 88, resetsAt: new Date(AT + 86_400_000).toISOString(), at: AT },
  ]

  const shown = present(limits, AT + 20 * 60_000)

  assert.equal(shown.text, '$(dashboard) 5h 0% · Wk 88%')
  assert.equal(shown.isWarning, true)
  assert.match(shown.tooltip, /As of/)
  assert.equal(present([], AT), null)
})

test('labels from a file are plain text in the hover', () => {
  const shown = present([{ kind: 'x', label: '[x](command:quit)', percentUsed: 5, at: AT }], AT)

  assert.equal(shown.text, '$(dashboard) xcommandquit 5%')
})

test('fetches the usage answer from the claude program', async () => {
  const response = await fetchUsage(FAKE_CLAUDE, { env: { ...process.env, FAKE_CLAUDE: 'success' } })

  assert.equal(response.rate_limits.limits[0].percent, 24)
})

test('claude runs in a private folder with project settings and MCP servers off', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-'))
  const { argv, cwd: ranIn } = await fetchUsage(FAKE_CLAUDE, { cwd, env: { ...process.env, FAKE_CLAUDE: 'args' } })

  assert.equal(fs.realpathSync(ranIn), fs.realpathSync(cwd))
  assert.deepEqual(argv.slice(argv.indexOf('--setting-sources'), argv.indexOf('--setting-sources') + 2), ['--setting-sources', 'user'])
  assert.ok(argv.includes('--strict-mcp-config'))
  assert.ok(argv.includes('--no-session-persistence'))
})

test('the default folder is created private to the user', () => {
  const dir = runDir(fs.mkdtempSync(path.join(os.tmpdir(), 'home-')))

  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
})

test('a refused request, an early exit or no answer each reject', async () => {
  await assert.rejects(fetchUsage(FAKE_CLAUDE, { env: { ...process.env, FAKE_CLAUDE: 'error' } }), /not supported/)
  await assert.rejects(fetchUsage(FAKE_CLAUDE, { env: { ...process.env, FAKE_CLAUDE: 'exit' } }), /exited/)
  await assert.rejects(fetchUsage(FAKE_CLAUDE, { env: { ...process.env, FAKE_CLAUDE: 'silent' }, timeoutMs: 500 }), /timed out/)
  await assert.rejects(fetchUsage('/no/such/claude'), /ENOENT/)
})
