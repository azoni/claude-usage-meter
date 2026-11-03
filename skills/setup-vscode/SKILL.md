---
name: setup-vscode
description: Install the usage meter's VS Code status bar item, which shows Claude plan usage (5-hour and weekly) at the bottom right of VS Code. Use when the person asks to set up, install, add, fix or remove the usage meter in VS Code (or Cursor), or wants their Claude usage or limits in the status bar.
---

# Set up the usage meter in VS Code

The usage-meter plugin saves each plan-usage reading to `~/.claude/usage-meter/reading.json`.
A small VS Code extension that ships with this plugin shows that reading in the status bar,
for example `5h 38% · Wk 91%`, with a table of reset times on hover.

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
5. Tell the person the item appears at the bottom right once a Claude session with this
   plugin has had a reply (the reading file is written then). If it does not show after
   that, they can run "Developer: Reload Window" from the command palette.

## Update

The same steps install a newer extension over an older one. Claude Code shows a note at
startup when the installed extension is older than the copy this plugin ships. After
installing, the person reloads the window ("Developer: Reload Window") so the new version
runs.

## Remove

`<cli> --uninstall-extension azoni.usage-meter-statusbar`

## When something looks wrong

- No item at all: check that `~/.claude/usage-meter/reading.json` exists. It is written only
  for Claude subscription accounts (Pro, Max, Team, Enterprise), after the first reply.
- The hover says "As of ...": no Claude session with the plugin has reported since then.
  The numbers come from Anthropic's rate-limit figures for the signed-in account.
