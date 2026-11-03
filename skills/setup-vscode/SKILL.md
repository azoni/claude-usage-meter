---
name: setup-vscode
description: Install the usage meter's VS Code status bar item, which shows Claude plan usage (5-hour, weekly and per-model weekly windows such as Fable) at the bottom right of VS Code. Use when the person asks to set up, install, add, fix or remove the usage meter in VS Code (or Cursor), or wants their Claude usage or limits in the status bar.
---

# Set up the usage meter in VS Code

A small VS Code extension that ships with this plugin shows Claude plan usage in the status
bar, for example `5h 38% · Wk 91% · Fable 2%`, with a table of reset times on hover. It asks
Claude Code for the numbers (the request behind `/usage`) every 2 minutes while VS Code is
focused, and also picks up the reading the plugin saves after each reply in
`~/.claude/usage-meter/reading.json`. Clicking the item refreshes it.

## Install

1. The extension file is `../../vscode/usage-meter-statusbar.vsix` relative to this skill's
   base directory. Resolve it to an absolute path and check it exists.
2. Find the editor's command-line tool. Try `code` on the PATH first. If it is missing:
   - macOS: `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`
   - Windows: `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`
   - Linux: usually `/usr/bin/code` or `/snap/bin/code`
   - Cursor: `cursor`, the same way
   If the person uses more than one of these editors, ask which one.
3. Install: `<cli> --install-extension "<absolute path to the .vsix>" --force`
4. Confirm: `<cli> --list-extensions --show-versions` lists `azoni.usage-meter-statusbar`.
5. Tell the person the item appears at the bottom right within a few seconds of VS Code
   loading the extension. If it does not show, they can run "Developer: Reload Window" from
   the command palette.

## Update

The same steps install a newer extension over an older one. Claude Code shows a note at
startup when the installed extension is older than the copy this plugin ships. After
installing, the person reloads the window ("Developer: Reload Window") so the new version
runs.

## Remove

`<cli> --uninstall-extension azoni.usage-meter-statusbar`

## When something looks wrong

- Check the Output panel's "Claude usage meter" channel first: it says why a refresh failed.
- No item at all: the numbers exist only for Claude subscription accounts (Pro, Max, Team,
  Enterprise) signed in to Claude Code. The extension runs the `claude` program bundled with
  the Claude VS Code extension, or `claude` on the PATH when that extension is missing.
- The hover says "As of ...": the extension couldn't refresh since then, and no Claude
  session with the plugin has had a reply since then either.
