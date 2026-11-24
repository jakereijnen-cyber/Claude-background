export type Gauges = {
  /** Percent of the tightest rate-limit window still left, null before a reading. */
  usageLeft: number | null
  /** Which window that is: five_hour, seven_day, spend_limit. */
  usageWindow: string | null
  /** When that window resets, ISO 8601. */
  resetsAt: string | null
  /** Percent of the context window in use, null before a reading. */
  memory: number | null
  /** Agents working now. */
  agents: number
  /** Whether the main turn runs now, so the snow falls. */
  isTurnRunning: boolean
  /** Other chats on this computer that are working now. */
  othersWorking: number
  /** Minute clock, so the reset countdown redraws. */
  minute: number
}

declare module 'claude-code' {
  interface PluginState {
    'winter-hearth': { gauges: Shaped<Gauges> }
  }
}
