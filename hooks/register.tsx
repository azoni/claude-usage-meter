import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limit, Reading } from '../types'

// Change the tag when Reading's fields change: it declines what an earlier
// version stored, which outlives a reload.
const reading = atom({ plugin: 'usage-meter', key: 'reading' } as const, null, {
  shape: 'reading-1',
})

// The last reading, kept across sessions so a new one shows numbers before
// its first response comes back.
const STORE_KEY = 'last-reading'
// Where the VS Code status bar item reads the reading from.
const READING_FILE = '.claude/usage-meter/reading.json'
// Where the VS Code extension records its version when it starts.
const EXTENSION_FILE = '.claude/usage-meter/extension.json'
const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'Week',
  spend_limit: 'Spend',
}
const BAR_CELLS = 8
const STALE_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const toLimit = ({ kind, percentUsed, resetsAt }: SessionRateLimit): Limit =>
  resetsAt ? { kind, percentUsed, resetsAt } : { kind, percentUsed }

const isReading = (value: unknown): value is Reading =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Reading).limits) &&
  typeof (value as Reading).at === 'number'

// USERPROFILE for Windows, where HOME is usually unset.
const homeDir = async ($: EngineInterface) =>
  (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))

async function save($: EngineInterface, limits: readonly SessionRateLimit[]) {
  if (limits.length === 0) {
    return
  }

  const latest: Reading = { limits: limits.map(toLimit), at: await $.clock.now() }
  await update($, reading, () => latest)
  await $.store.set(STORE_KEY, latest)

  const home = await homeDir($)

  if (home) {
    await $.fs.write(`${home}/${READING_FILE}`, JSON.stringify(latest))
  }
}

// A version field from a JSON file, or undefined when the file is missing or
// not that shape.
async function readVersion($: EngineInterface, path: string) {
  try {
    const { version } = JSON.parse(await $.fs.read(path))

    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

function isOlder(version: string, than: string) {
  const a = version.split('.').map(Number)
  const b = than.split('.').map(Number)

  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)

    if (diff) {
      return diff < 0
    }
  }

  return false
}

// The plugin ships the extension; once the plugin updates, say so if the
// installed extension is behind the copy it ships. No extension file means the
// person does not use the status bar, and says nothing.
async function nudgeOutdatedExtension($: EngineInterface) {
  const home = await homeDir($)
  const installed = home && (await readVersion($, `${home}/${EXTENSION_FILE}`))
  const bundled = await readVersion($, `${$.plugin.root}/vscode/package.json`)

  if (installed && bundled && isOlder(installed, bundled)) {
    $.ui.toast(
      `Usage meter: the VS Code status bar is out of date (${installed}, now ${bundled}). Run /usage-meter:setup-vscode to update it.`,
    )
  }
}

const tone = (pct: number) => (pct >= 85 ? 'error' : pct >= 60 ? 'warning' : 'success')

function clock(at: Date) {
  const hours = at.getHours()
  const minutes = at.getMinutes()
  const mm = minutes ? `:${String(minutes).padStart(2, '0')}` : ''

  return `${hours % 12 || 12}${mm}${hours < 12 ? 'am' : 'pm'}`
}

function resetLabel(resetAt: number, now: number) {
  const at = new Date(resetAt)
  const day = resetAt - now > DAY_MS * 0.8 ? `${DAYS[at.getDay()]} ` : ''

  return `resets ${day}${clock(at)}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { rateLimits } = await $.session.usage()

    if (rateLimits.length > 0) {
      await save($, rateLimits)
    } else {
      const stored = await $.store.get(STORE_KEY)

      if (isReading(stored)) {
        await update($, reading, current => current ?? stored)
      }
    }

    await nudgeOutdatedExtension($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await save($, e.rateLimits)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // VS Code shows the meter in its status bar instead.
    if (e.surface === 'vscode') {
      return next(e)
    }

    const last = await read($, reading)

    if (e.props.hasSurvey || last === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {last.limits.map(limit => {
          const resetAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
          // A window that reset since the reading starts again from zero.
          const hasReset = resetAt <= now
          const pct = hasReset ? 0 : limit.percentUsed
          const filled = Math.min(BAR_CELLS, Math.round((pct / 100) * BAR_CELLS))

          return (
            <Box key={limit.kind} flexDirection="row" columnGap={1}>
              <Text dimColor>{LABELS[limit.kind] ?? limit.kind}</Text>
              <Box flexDirection="row">
                {filled > 0 && <Text color={tone(pct)}>{'▰'.repeat(filled)}</Text>}
                {filled < BAR_CELLS && <Text dimColor>{'▱'.repeat(BAR_CELLS - filled)}</Text>}
              </Box>
              <Text color={tone(pct)} tabular>{`${Math.round(pct)}%`}</Text>
              {resetAt > now && <Text dimColor>{resetLabel(resetAt, now)}</Text>}
            </Box>
          )
        })}
        {now - last.at > STALE_MS && <Text dimColor>{`as of ${clock(new Date(last.at))}`}</Text>}
      </Box>
    )
  })
}
