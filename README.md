<img src="assets/icon.png" alt="" width="96" align="right">

# Claude usage meter

A live usage-limit tracker for Claude Code. See how much of your Claude plan (Pro, Max,
Team or Enterprise) you've used without opening `/usage`. The plugin shows your 5-hour
and weekly rate-limit windows, and when each resets, right above the prompt:

```
5h ▰▰▰▱▱▱▱▱ 38% resets 3:40pm    Week ▰▰▰▰▰▰▰▱ 91% resets Fri 9am
```

In VS Code it moves to the status bar at the bottom right (`5h 38% · Wk 91%`), with a
table of reset times on hover.

The numbers are Anthropic's own rate-limit figures for your account, so they include
usage from claude.ai and your other machines. They update after every reply.

## Install

**Ask Claude.** Paste this into Claude Code:

> Install the usage-meter plugin from github.com/azoni/claude-usage-meter, then set it up in VS Code.

**Or by hand**, at the Claude Code prompt in a terminal:

```
/plugin install usage-meter --marketplace azoni/claude-usage-meter
```

Answer `y` to add the marketplace and pick the user scope. The meter shows up after the
next reply.

**VS Code status bar** (optional): in a Claude Code session, run `/usage-meter:setup-vscode`
or say "set up the usage meter in VS Code". Claude installs the small extension that ships
in this repo. To install it yourself instead:

```
code --install-extension vscode/usage-meter-statusbar.vsix
```

### For AI assistants installing this

Run these from a shell. Neither asks a question.

```
claude plugin marketplace add azoni/claude-usage-meter
claude plugin install usage-meter@claude-usage-meter
```

Then, if the person uses VS Code or Cursor, follow
[skills/setup-vscode/SKILL.md](skills/setup-vscode/SKILL.md) to install
`vscode/usage-meter-statusbar.vsix`. New sessions load the plugin by themselves; if the
current one doesn't show the meter, run `/reload-plugins` or start a new session. Offer to
turn on auto-update (below); don't change their settings without asking.

## Updates

Claude Code doesn't auto-update plugins from community marketplaces unless you turn it on.
Either switch on auto-update for `claude-usage-meter` in `/plugin` (Marketplaces), or add
`"autoUpdate": true` to its entry in `~/.claude/settings.json`:

```json
"extraKnownMarketplaces": {
  "claude-usage-meter": {
    "source": { "source": "github", "repo": "azoni/claude-usage-meter" },
    "autoUpdate": true
  }
}
```

To update by hand instead, then restart Claude Code:

```
claude plugin marketplace update claude-usage-meter
claude plugin update usage-meter@claude-usage-meter
```

The VS Code extension can't update itself, because it's installed from a file. When the
plugin updates and ships a newer one, Claude Code shows a one-line note at startup. Run
`/usage-meter:setup-vscode` to install the new one.

## Good to know

- **Subscriptions only.** Pro, Max, Team and Enterprise accounts report these windows. An
  API key or a cloud provider has none, so the meter stays hidden.
- **Per-model weekly limits** (such as a Fable-only week) aren't shown yet. Claude Code
  doesn't pass them to plugins.
- **Early-access API.** This uses Claude Code's plugin function hooks, which are early
  access and may change between releases. Tested on Claude Code 2.1.314.
- **Nothing leaves your machine.** The plugin reads the figures Claude Code already has and
  writes them to `~/.claude/usage-meter/reading.json` for the VS Code extension. It sends
  nothing anywhere and never touches your login.
- **Colors.** Green under 60%, yellow from 60%, red from 85%. The VS Code item turns the
  warning color at 85%.

## Remove

```
claude plugin uninstall usage-meter
code --uninstall-extension azoni.usage-meter-statusbar
rm -rf ~/.claude/usage-meter        # the saved reading and version files
```

## Develop

```
claude plugin validate .
claude plugin test .
bash vscode/build.sh        # rebuilds vscode/usage-meter-statusbar.vsix
```

## License

MIT
