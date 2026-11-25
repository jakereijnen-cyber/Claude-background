# reflect

You decide what Claude remembers. When you give Claude a hard rule, such as "never use em dashes" or "always answer in Dutch", Reflect notices it and, once Claude has replied, asks whether to keep it:

- **Save everywhere:** adds the rule to your own CLAUDE.md (`~/.claude/CLAUDE.md`), which every Claude Code chat reads.
- **Save to vault:** adds it to `rules.md` in a rules folder you choose the first time. Reflect reads that file into every new chat. Change the folder with `/reflect-vault`.
- **Skip:** nothing is saved.

Rules go under a "Rules saved with Reflect" heading, so they are easy to find and edit by hand. A rule that is already saved is not asked about again. Only your own messages that sound like a rule are checked, with one small, cheap model call. Instructions for the current task only are left alone.

Works in Claude Code in the terminal, editors and the desktop and mobile apps.
