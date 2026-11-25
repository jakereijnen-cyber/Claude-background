# switchboard

All your mods in one place. Type `/mods` to open one list of every mod you run, with its version, what it does and whether it is on.

- **Turn off / Turn on:** switches the mod in your Claude Code settings (as `claude plugin disable` / `enable` does). It takes effect in your next session, or straight away after `/reload-plugins`.
- **Hide panel / Show panel:** keeps the mod running but hides its bars above the prompt, its cells beside the prompt, its backdrop and its panels, at once. Remembered across sessions.
- **New mods show up by themselves:** the list checks for new installs every few seconds and tells you when one arrives.

On an app that draws no panels, `/mods` also prints the list, and `/mods on <name>`, `/mods off <name>`, `/mods hide <name>` and `/mods show <name>` do the same as the buttons. Switchboard itself always stays on, so `/mods` keeps working.

Works in Claude Code in the terminal, editors and the desktop and mobile apps.
