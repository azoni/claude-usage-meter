// Shows the plan usage the usage-meter Claude Code plugin writes to
// ~/.claude/usage-meter/reading.json in the status bar.
const fs = require('fs')
const os = require('os')
const path = require('path')
const vscode = require('vscode')

const DIR = path.join(os.homedir(), '.claude', 'usage-meter')
const FILE = path.join(DIR, 'reading.json')
const SHORT = { five_hour: '5h', seven_day: 'Wk', spend_limit: 'Spend' }
const LONG = { five_hour: '5-hour window', seven_day: 'Week', spend_limit: 'Spend limit' }
const BAR_CELLS = 10
const STALE_MS = 15 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WARN_PCT = 85

const isLimit = limit =>
  typeof limit === 'object' &&
  limit !== null &&
  typeof limit.kind === 'string' &&
  Number.isFinite(limit.percentUsed) &&
  (limit.resetsAt === undefined || typeof limit.resetsAt === 'string')

// Keeps only well-formed windows, so a damaged file draws nothing odd.
function readReading() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'))

    if (!Array.isArray(value?.limits) || !Number.isFinite(value.at)) {
      return null
    }

    return { limits: value.limits.filter(isLimit), at: value.at }
  } catch {
    return null
  }
}

// A known window's name, or the kind itself stripped to plain word characters,
// since the hover renders Markdown.
const label = (names, kind) =>
  Object.hasOwn(names, kind) ? names[kind] : kind.replace(/[^\w-]/g, '').slice(0, 32)

const time = at => at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function resetLabel(resetAt, now) {
  const at = new Date(resetAt)
  const day = resetAt - now > DAY_MS * 0.8 ? `${at.toLocaleDateString(undefined, { weekday: 'short' })} ` : ''

  return `${day}${time(at)}`
}

function render(item) {
  const reading = readReading()

  if (!reading || reading.limits.length === 0) {
    item.hide()
    return
  }

  const now = Date.now()
  const limits = reading.limits.map(limit => {
    const resetAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
    // A window that reset since the reading starts again from zero.
    const hasReset = resetAt <= now

    const pct = hasReset ? 0 : Math.max(0, Math.round(limit.percentUsed))

    return { kind: limit.kind, pct, resetAt: hasReset ? NaN : resetAt }
  })
  const worst = Math.max(...limits.map(limit => limit.pct))

  item.text = `$(dashboard) ${limits.map(limit => `${label(SHORT, limit.kind)} ${limit.pct}%`).join(' · ')}`
  item.backgroundColor = worst >= WARN_PCT ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined

  const rows = limits.map(limit => {
    const filled = Math.min(BAR_CELLS, Math.round((limit.pct / 100) * BAR_CELLS))
    const bar = '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
    const reset = Number.isNaN(limit.resetAt) ? '' : resetLabel(limit.resetAt, now)

    return `| ${label(LONG, limit.kind)} | \`${bar}\` | **${limit.pct}%** | ${reset} |`
  })
  const age = now - reading.at > STALE_MS ? `\n\n_As of ${time(new Date(reading.at))}: no Claude session has reported since._` : ''
  const tooltip = new vscode.MarkdownString(`**Claude usage**\n\n| Window | | Used | Resets |\n|---|---|--:|---|\n${rows.join('\n')}${age}`)

  item.tooltip = tooltip
  item.show()
}

function activate(context) {
  const item = vscode.window.createStatusBarItem('usageMeter', vscode.StatusBarAlignment.Right, 100)
  item.name = 'Claude usage'
  const refresh = () => render(item)

  fs.mkdirSync(DIR, { recursive: true })
  // Lets the Claude plugin tell when this extension is older than the copy it
  // ships. Only that reminder depends on it, so a failed write doesn't stop the meter.
  try {
    fs.writeFileSync(path.join(DIR, 'extension.json'), JSON.stringify({ version: context.extension.packageJSON.version }))
  } catch {}
  const watcher = fs.watch(DIR, refresh)
  // If the folder goes away the watch ends; the timer below keeps drawing.
  watcher.on('error', () => watcher.close())
  // Re-draw each minute too, so a window that resets drops to zero on time.
  const timer = setInterval(refresh, 60 * 1000)

  context.subscriptions.push(item, { dispose: () => (watcher.close(), clearInterval(timer)) })
  refresh()
}

module.exports = { activate, deactivate() {} }
