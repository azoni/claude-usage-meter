// The meter's logic, kept free of the VS Code API so it can be tested:
// asking Claude Code for the plan usage, reading its answer, combining it
// with the readings Claude sessions save, and what the status bar shows.
const { spawn } = require('child_process')
const os = require('os')

// The same request the Claude VS Code panel sends for its usage view, with
// the local transcript scan skipped. It spends no model tokens.
const ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']
const REQUEST_ID = 'usage-meter'
const TIMEOUT_MS = 20 * 1000

const KINDS = { session: 'five_hour', weekly_all: 'seven_day' }
const SHORT = { five_hour: '5h', seven_day: 'Wk', spend_limit: 'Spend' }
const LONG = { five_hour: '5-hour window', seven_day: 'Week (all models)', spend_limit: 'Spend limit' }
const BAR_CELLS = 10
const STALE_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WARN_PCT = 85

// Resolves the get_usage answer from the claude program at `command`.
function fetchUsage(command, { shell = false, env = process.env, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ARGS, { cwd: os.tmpdir(), env, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let buffer = ''
    let isSettled = false

    const finish = (error, response) => {
      if (isSettled) {
        return
      }

      isSettled = true
      clearTimeout(timer)
      child.stdin.end()
      child.kill()
      error ? reject(error) : resolve(response)
    }
    const timer = setTimeout(() => finish(new Error(`claude timed out after ${timeoutMs}ms`)), timeoutMs)

    child.on('error', finish)
    child.on('exit', code => finish(new Error(`claude exited (${code}) before answering`)))
    // A child that dies first closes the pipe; 'exit' reports that.
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk

      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        let message

        try {
          message = JSON.parse(line)
        } catch {
          continue
        }

        const answer = message?.type === 'control_response' ? message.response : undefined

        if (answer?.request_id === REQUEST_ID) {
          answer.subtype === 'success' ? finish(null, answer.response) : finish(new Error(answer.error ?? 'get_usage failed'))
        }
      }
    })
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: REQUEST_ID, request: { subtype: 'get_usage', skip_behaviors: true } })}\n`)
  })
}

const isoOrUndefined = value => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN

  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

function toLimit(kind, percentUsed, resetsAt, label) {
  const iso = isoOrUndefined(resetsAt)

  return { kind, ...(label && { label }), percentUsed, ...(iso && { resetsAt: iso }) }
}

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

// A reading ({ limits, at }) from a get_usage answer, or null when it holds
// no window this can read. The answer is marked experimental, so each field is
// checked rather than trusted.
function parseUsageResponse(response, at) {
  const rateLimits = response?.rate_limits

  if (typeof rateLimits !== 'object' || rateLimits === null) {
    return null
  }

  const limits = []

  if (Array.isArray(rateLimits.limits)) {
    for (const row of rateLimits.limits) {
      if (!Number.isFinite(row?.percent)) {
        continue
      }

      const name = row.scope?.model?.display_name

      if (Object.hasOwn(KINDS, row.kind)) {
        limits.push(toLimit(KINDS[row.kind], row.percent, row.resets_at))
      } else if (row.kind === 'weekly_scoped' && typeof name === 'string' && slug(name)) {
        limits.push(toLimit(`seven_day_${slug(name)}`, row.percent, row.resets_at, name))
      }
    }
  } else {
    for (const kind of ['five_hour', 'seven_day']) {
      const window = rateLimits[kind]

      if (Number.isFinite(window?.utilization)) {
        limits.push(toLimit(kind, window.utilization, window.resets_at))
      }
    }
  }

  return limits.length > 0 ? { limits, at } : null
}

// Every window from the two readings, each from whichever reading is newer,
// stamped with that reading's time.
function mergeReadings(...readings) {
  const byKind = new Map()

  for (const reading of readings) {
    for (const limit of reading?.limits ?? []) {
      const current = byKind.get(limit.kind)

      if (!current || reading.at > current.at) {
        byKind.set(limit.kind, { ...limit, at: reading.at })
      }
    }
  }

  return [...byKind.values()]
}

// A known window's name, or the label or kind stripped to plain word
// characters, since the hover renders Markdown.
const nameOf = (names, limit) =>
  Object.hasOwn(names, limit.kind) ? names[limit.kind] : String(limit.label ?? limit.kind).replace(/[^\w-]/g, '').slice(0, 32)

const time = at => at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function resetLabel(resetAt, now) {
  const at = new Date(resetAt)
  const day = resetAt - now > DAY_MS * 0.8 ? `${at.toLocaleDateString(undefined, { weekday: 'short' })} ` : ''

  return `${day}${time(at)}`
}

// What the status bar shows for these windows at `now`: { text, tooltip,
// isWarning }, or null when there is nothing to show.
function present(limits, now) {
  if (limits.length === 0) {
    return null
  }

  const shown = limits.map(limit => {
    const resetAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
    // A window that reset since the reading starts again from zero.
    const hasReset = resetAt <= now
    const pct = hasReset ? 0 : Math.max(0, Math.round(limit.percentUsed))

    return { ...limit, pct, resetAt: hasReset ? NaN : resetAt }
  })
  const worst = Math.max(...shown.map(limit => limit.pct))
  const newest = Math.max(...shown.map(limit => limit.at))

  const rows = shown.map(limit => {
    const filled = Math.min(BAR_CELLS, Math.round((limit.pct / 100) * BAR_CELLS))
    const bar = '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
    const reset = Number.isNaN(limit.resetAt) ? '' : resetLabel(limit.resetAt, now)
    // A per-model window carries its model's name as its label.
    const name = limit.label && !Object.hasOwn(LONG, limit.kind) ? `Week (${nameOf(LONG, limit)})` : nameOf(LONG, limit)

    return `| ${name} | \`${bar}\` | **${limit.pct}%** | ${reset} |`
  })
  const age = now - newest > STALE_MS ? `\n\n_As of ${time(new Date(newest))}._` : ''

  return {
    text: `$(dashboard) ${shown.map(limit => `${nameOf(SHORT, limit)} ${limit.pct}%`).join(' · ')}`,
    tooltip: `**Claude usage**\n\n| Window | | Used | Resets |\n|---|---|--:|---|\n${rows.join('\n')}${age}`,
    isWarning: worst >= WARN_PCT,
  }
}

module.exports = { fetchUsage, mergeReadings, parseUsageResponse, present }
