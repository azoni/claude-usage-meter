const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const { accountEnv, accountsDir, fetchUsage, listAccounts, mergeReadings, parseUsageResponse, present, presentAccounts, runDir, usageSources } = require('../meter')

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

test('every folder with a usable name is an account, sorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-'))

  for (const name of ['work', 'side-2', '.hidden', 'bad name', 'a'.repeat(33)]) {
    fs.mkdirSync(path.join(dir, name))
  }
  fs.writeFileSync(path.join(dir, 'note.txt'), '')

  assert.deepEqual(listAccounts(dir), [
    { name: 'side-2', configDir: path.join(dir, 'side-2') },
    { name: 'work', configDir: path.join(dir, 'work') },
  ])
  assert.deepEqual(listAccounts(path.join(dir, 'missing')), [])
})

test('the accounts folder is created private to the user', () => {
  const dir = accountsDir(fs.mkdtempSync(path.join(os.tmpdir(), 'home-')))

  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
})

// A login in the environment beats the one in the folder, which would show
// the main account's numbers under every name.
test('an account signs in from its own folder, whatever the environment holds', () => {
  const env = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/old', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o' }

  assert.deepEqual(accountEnv(env, '/accounts/work'), { PATH: '/bin', CLAUDE_CONFIG_DIR: '/accounts/work' })
  assert.equal(env.CLAUDE_CONFIG_DIR, '/old')
})

test('claude is told which account to answer for', async () => {
  const env = accountEnv({ ...process.env, FAKE_CLAUDE: 'args' }, '/accounts/work')
  const { configDir } = await fetchUsage(FAKE_CLAUDE, { env })

  assert.equal(configDir, '/accounts/work')
})

test('the main login comes first and alone takes the plugin reading', () => {
  const env = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/main' }
  const [main, work, ...rest] = usageSources('/meter', [{ name: 'work', configDir: '/meter/accounts/work' }], env)

  assert.deepEqual(rest, [])
  assert.deepEqual(main, { name: 'Main', file: '/meter/usage.json', sessionFile: '/meter/reading.json', env })
  assert.deepEqual(work, { name: 'work', file: '/meter/usage-work.json', env: { PATH: '/bin', CLAUDE_CONFIG_DIR: '/meter/accounts/work' } })
})

test('with one account the status bar reads as it always has', () => {
  const limits = mergeReadings(null, parseUsageResponse(RESPONSE, AT))

  assert.equal(presentAccounts([{ name: 'Main', limits }], AT).text, '$(dashboard) 5h 24% · Wk 4% · Fable 0%')
})

test('each account shows its highest window, and the hover has a table each', () => {
  const shown = presentAccounts(
    [
      { name: 'Main', limits: [{ kind: 'five_hour', percentUsed: 48, at: AT }, { kind: 'seven_day', percentUsed: 66, at: AT }] },
      { name: 'work', limits: [{ kind: 'five_hour', percentUsed: 12, at: AT }] },
      { name: 'side', limits: [] },
    ],
    AT,
  )

  assert.equal(shown.text, '$(dashboard) Main 66% · work 12% · side —')
  assert.equal(shown.isWarning, false)
  assert.match(shown.tooltip, /\*\*Main\*\*\n\n\| Window[\s\S]*Week \(all models\)[\s\S]*\*\*work\*\*\n\n\| Window/)
  assert.match(shown.tooltip, /\*\*side\*\*\n\n_No reading yet\._/)
})

// The case this exists for: a spent week behind an idle 5-hour window.
test('an account nearly out for the week reads high and says when it resets', () => {
  const shown = presentAccounts(
    [
      { name: 'Main', limits: [{ kind: 'five_hour', percentUsed: 20, at: AT }] },
      {
        name: 'work',
        limits: [
          { kind: 'five_hour', percentUsed: 0, at: AT },
          { kind: 'seven_day', percentUsed: 96, resetsAt: new Date(AT + 2 * 86_400_000).toISOString(), at: AT },
        ],
      },
    ],
    AT,
  )

  assert.match(shown.text, /^\$\(dashboard\) Main 20% · work 96% resets [A-Z][a-z]{2} \d{1,2}:\d{2}\s?[AP]M$/)
  assert.equal(shown.isWarning, true)
})

test('a reset due within the day leaves the weekday out', () => {
  const limits = [{ kind: 'seven_day', percentUsed: 90, resetsAt: new Date(AT + 3_600_000).toISOString(), at: AT }]
  const shown = presentAccounts([{ name: 'Main', limits: [] }, { name: 'work', limits }], AT)

  assert.match(shown.text, /work 90% resets \d{1,2}:\d{2}\s?[AP]M$/)
})

test('below the warning level the bar leaves the reset to the hover', () => {
  const limits = [{ kind: 'seven_day', percentUsed: 84, resetsAt: new Date(AT + 3_600_000).toISOString(), at: AT }]
  const shown = presentAccounts([{ name: 'Main', limits: [] }, { name: 'work', limits }], AT)

  assert.equal(shown.text, '$(dashboard) Main — · work 84%')
})

// Equal numbers: the account stays stuck until the later window lets go.
test('when two windows tie, the bar shows the later reset', () => {
  const soon = new Date(AT + 3_600_000).toISOString()
  const later = new Date(AT + 2 * 86_400_000).toISOString()
  const limits = [
    { kind: 'five_hour', percentUsed: 95, resetsAt: soon, at: AT },
    { kind: 'seven_day', percentUsed: 95, resetsAt: later, at: AT },
  ]
  const shown = presentAccounts([{ name: 'Main', limits: [] }, { name: 'work', limits }], AT)

  assert.match(shown.text, /work 95% resets [A-Z][a-z]{2} /)
})

test('a high window with no reset time shows no reset', () => {
  const shown = presentAccounts([{ name: 'Main', limits: [] }, { name: 'work', limits: [{ kind: 'seven_day', percentUsed: 90, at: AT }] }], AT)

  assert.equal(shown.text, '$(dashboard) Main — · work 90%')
})

test('a reset 5-hour window reads zero, and an old reading is dated on its own account', () => {
  const shown = presentAccounts(
    [
      { name: 'Main', limits: [{ kind: 'five_hour', percentUsed: 30, at: AT + 20 * 60_000 }] },
      { name: 'work', limits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: new Date(AT + 60_000).toISOString(), at: AT }] },
    ],
    AT + 20 * 60_000,
  )
  const [main, work] = shown.tooltip.split('**work**')

  assert.equal(shown.text, '$(dashboard) Main 30% · work 0%')
  assert.doesNotMatch(main, /As of/)
  assert.match(work, /As of/)
})

test('nothing shows until some account has a reading', () => {
  assert.equal(presentAccounts([{ name: 'Main', limits: [] }, { name: 'work', limits: [] }], AT), null)
  assert.equal(presentAccounts([{ name: 'Main', limits: [] }], AT), null)
})
