# cache-clock

Claude keeps your chat in a cache for 5 minutes or 1 hour after each request. While it is warm, the next message re-reads the chat at about a tenth of the price; once it goes cold, the whole chat is read again at full price.

- **Countdown:** after each reply, a line above the prompt shows how long the cache stays warm: green, then amber in the last minute, then red once it is cold.
- **Keep warm:** just before the cache runs out (30 seconds for a 5-minute cache, 2 minutes for a 1-hour one), the mod sends a tiny side request that re-reads the cache, so the timer starts again. It never shows in your chat. It pings at most 3 times in a row while you are away; your next message resets that.
- Turn keep warm on or off with the button next to the countdown or `/keep-warm`. Your choice is remembered.

Each ping costs about a tenth of what your next message would cost against a warm cache. Works in Claude Code in the terminal, editors and the desktop and mobile apps.
