# winter-hearth

A calm winter-night background for the Claude desktop and mobile apps. It shows three numbers as parts of the scene instead of as meters:

- **Campfire (left):** how much of your usage limit is left. The flames shrink as you use more. The sign in front shows the percentage, which limit is tightest (5-hour, weekly or spend limit) and when it resets. Shows `--` until the first reply of a session, and always off a subscription plan.
- **Snow in the foreground:** how full the context window ("memory") is. It piles up from the bottom, with a wooden stake marking the level.
- **Cabin (right):** one lit window per working agent, smoke from the chimney while any run, and a sign with the count.

Snow falls only while Claude is working: in this chat, in a subagent, or in any other chat on the same computer that has the mod installed. Chats share that through a small file in the Claude Code config folder, and a chat that stops checking in for 20 seconds no longer counts.

In the terminal and editors, which draw no backgrounds, the same numbers show in the status line.

## Install

At the prompt of a Claude Code session:

```
/plugin install winter-hearth --marketplace jakereijnen-cyber/claude-background
```

Answer `y` to add the marketplace, then pick a scope (user scope puts it in every chat).
