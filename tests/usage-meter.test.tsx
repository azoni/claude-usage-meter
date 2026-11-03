import type { On, SessionRateLimit } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Noon PST on Tue 2026-11-03.
const NOW = Date.parse('2026-11-03T20:00:00Z')
const HOUR = 60 * 60 * 1000
const BAND_SURFACES = ['terminal', 'desktop', 'mobile'] as const

const BAND = {
  plugin: 'usage-meter',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const LIMITS: SessionRateLimit[] = [
  // 3:40pm PST today, and Fri 9am PST.
  { kind: 'five_hour', percentUsed: 38.4, resetsAt: '2026-11-03T23:40:00.000Z' },
  { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-06T17:00:00.000Z' },
]

const EXTENSION_FILE = '/home/me/.claude/usage-meter/extension.json'

// Stands in for the engine. `extension` is the installed VS Code extension's
// version (none: not installed); the plugin ships `bundled`. Returns the files
// the mod wrote, by path, and the toasts it raised.
function engine(
  on: On,
  rateLimits: SessionRateLimit[],
  { extension, bundled = '0.1.1' }: { extension?: string; bundled?: string } = {},
) {
  const files = new Map<string, string>()
  const toasts: string[] = []

  mock.env(on, { HOME: '/home/me' })
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('fs.write', (_, e) => (files.set(e.path, e.text), { value: undefined }))
  on('fs.read', (_, e) => {
    if (e.path === EXTENSION_FILE && extension) {
      return { value: JSON.stringify({ version: extension }) }
    }
    if (e.path.endsWith('/vscode/package.json')) {
      return { value: JSON.stringify({ name: 'usage-meter-statusbar', version: bundled }) }
    }
    throw new Error(`ENOENT: no such file, ${e.path}`)
  })
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return { files, toasts }
}

const start = { cwd: '/', surface: 'vscode', isInteractive: true } as const

test('the band shows both windows and when they reset', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on, LIMITS)
  await $.session.start(start)

  for (const surface of BAND_SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: /^38%$/ }))?.text).toBe('38%')
    expect((await ui.find({ type: 'Text', text: /^91%$/ }))?.text).toBe('91%')
    expect((await ui.find({ type: 'Text', text: /resets 3:40pm/ }))?.text).toBe('resets 3:40pm')
    expect((await ui.find({ type: 'Text', text: /resets Fri/ }))?.text).toBe('resets Fri 9am')
    expect(await ui.find({ type: 'Text', text: /as of/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('VS Code leaves the band to the engine and gets the file', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const { files } = engine(on, LIMITS)
  await $.session.start(start)

  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()

  const written = JSON.parse(files.get('/home/me/.claude/usage-meter/reading.json') ?? 'null')
  expect(written).toEqual({ limits: LIMITS, at: NOW })
})

test('a reading that arrives mid-session redraws the band and the file', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const { files } = engine(on, [])
  await $.session.start(start)
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ ...LIMITS[0]!, percentUsed: 72 }],
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /%$/ }))?.text).toBe('72%')
  await ui.unmount()
  expect(files.get('/home/me/.claude/usage-meter/reading.json')).toContain('"percentUsed":72')
})

test('a new session shows the last reading, marked with its time', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { 'last-reading': { limits: LIMITS, at: NOW - HOUR } })
  engine(on, [])
  await $.session.start(start)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^38%$/ }))?.text).toBe('38%')
  expect((await ui.find({ type: 'Text', text: /as of/ }))?.text).toBe('as of 11am')
  await ui.unmount()
})

test('a window that reset since the reading reads zero', async ($, on) => {
  mock.clock(on, { now: NOW + 4 * HOUR })
  mock.store(on, { 'last-reading': { limits: LIMITS, at: NOW } })
  engine(on, [])
  await $.session.start(start)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^0%$/ }))?.text).toBe('0%')
  expect(await ui.find({ type: 'Text', text: /3:40pm/ })).toBeUndefined()
  await ui.unmount()
})

test('with no reading yet the band is left to the engine', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on, [])
  await $.session.start(start)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('an older VS Code extension gets one note to update it', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  const { toasts } = engine(on, LIMITS, { extension: '0.1.0', bundled: '0.1.1' })
  await $.session.start(start)

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('0.1.0, now 0.1.1')
  expect(toasts[0]).toContain('/usage-meter:setup-vscode')
})

for (const extension of ['0.1.1', '0.2.0', '1.0.0', undefined]) {
  test(`no note when the extension is ${extension ?? 'not installed'}`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    const { toasts } = engine(on, LIMITS, { extension, bundled: '0.1.1' })
    await $.session.start(start)

    expect(toasts).toEqual([])
  })
}
