// Shows Claude plan usage in the status bar. Two sources feed it: Claude Code
// itself, asked every couple of minutes (meter.js), and the reading the
// usage-meter Claude Code plugin saves after each reply. Each window shows
// whichever is newer. Each folder in ~/.claude/usage-meter/accounts adds
// another signed-in account, asked the same way.
const fs = require('fs')
const os = require('os')
const path = require('path')
const vscode = require('vscode')

const { accountsDir, fetchUsage, listAccounts, mergeReadings, parseUsageResponse, presentAccounts, usageSources } = require('./meter')

const DIR = path.join(os.homedir(), '.claude', 'usage-meter')
const POLL_MS = 2 * 60 * 1000
// A refresh this recent, from this window or another, is fresh enough.
const FRESH_MS = 60 * 1000

const isLimit = limit =>
  typeof limit === 'object' &&
  limit !== null &&
  typeof limit.kind === 'string' &&
  Number.isFinite(limit.percentUsed) &&
  (limit.resetsAt === undefined || typeof limit.resetsAt === 'string') &&
  (limit.label === undefined || typeof limit.label === 'string')

// Keeps only well-formed windows, so a damaged file draws nothing odd.
function readReading(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))

    if (!Array.isArray(value?.limits) || !Number.isFinite(value.at)) {
      return null
    }

    return { limits: value.limits.filter(isLimit), at: value.at }
  } catch {
    return null
  }
}

function ageOf(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs
  } catch {
    return Infinity
  }
}

// The claude program the Claude extension ships, else `claude` on the PATH.
function claudeCommand() {
  const claude = vscode.extensions.getExtension('anthropic.claude-code')
  const bundled = claude && path.join(claude.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude')

  return bundled && fs.existsSync(bundled)
    ? { command: bundled, shell: false }
    : { command: 'claude', shell: process.platform === 'win32' }
}

const sources = () => usageSources(DIR, listAccounts(accountsDir()), process.env)

function render(item) {
  const accounts = sources().map(({ name, file, sessionFile }) => ({
    name,
    limits: mergeReadings(sessionFile ? readReading(sessionFile) : null, readReading(file)),
  }))
  const shown = presentAccounts(accounts, Date.now())

  if (!shown) {
    item.hide()
    return
  }

  item.text = shown.text
  item.tooltip = new vscode.MarkdownString(shown.tooltip)
  item.backgroundColor = shown.isWarning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
  item.show()
}

function activate(context) {
  const item = vscode.window.createStatusBarItem('usageMeter', vscode.StatusBarAlignment.Right, 100)
  item.name = 'Claude usage'
  item.command = 'usageMeter.refresh'
  const log = vscode.window.createOutputChannel('Claude usage meter')
  const refresh = () => render(item)
  let isPolling = false
  let lastAttempt = 0
  const lastErrors = new Map()

  // Logs a failure once until it changes, so a steady problem doesn't fill the log.
  const report = (name, message) => {
    if (message !== lastErrors.get(name)) {
      lastErrors.set(name, message)
      log.appendLine(`${new Date().toISOString()} ${name}: ${message}`)
    }
  }

  // Asks one account at a time: each is a claude process, and they add up
  // on a small machine. One failing leaves the others to answer.
  const poll = async minAge => {
    if (isPolling || Date.now() - lastAttempt < minAge) {
      return
    }

    isPolling = true
    lastAttempt = Date.now()

    try {
      const { command, shell } = claudeCommand()

      for (const { name, file, env } of sources()) {
        if (ageOf(file) < minAge) {
          continue
        }

        try {
          const reading = parseUsageResponse(await fetchUsage(command, { shell, env }), Date.now())

          if (reading) {
            fs.writeFileSync(file, JSON.stringify(reading))
            lastErrors.delete(name)
          } else {
            report(name, 'Claude Code answered with no usage windows: it is signed out, or an API key or a cloud provider has none.')
          }
        } catch (error) {
          report(name, `Could not ask Claude Code for usage: ${error.message}`)
        }
      }
    } finally {
      isPolling = false
    }
  }

  fs.mkdirSync(DIR, { recursive: true })
  // Lets the Claude plugin tell when this extension is older than the copy it
  // ships. Only that reminder depends on it, so a failed write doesn't stop the meter.
  try {
    fs.writeFileSync(path.join(DIR, 'extension.json'), JSON.stringify({ version: context.extension.packageJSON.version }))
  } catch {}
  const watcher = fs.watch(DIR, refresh)
  // If the folder goes away the watch ends; the timer below keeps drawing.
  watcher.on('error', () => watcher.close())
  // Each minute: re-draw, so a window that resets drops to zero on time, and
  // refresh from Claude Code while this window has focus.
  const timer = setInterval(() => {
    refresh()

    if (vscode.window.state.focused) {
      poll(POLL_MS)
    }
  }, 60 * 1000)

  context.subscriptions.push(
    item,
    log,
    vscode.commands.registerCommand('usageMeter.refresh', () => poll(0)),
    vscode.window.onDidChangeWindowState(state => state.focused && poll(FRESH_MS)),
    { dispose: () => (watcher.close(), clearInterval(timer)) },
  )
  refresh()
  poll(FRESH_MS)
}

module.exports = { activate, deactivate() {} }
