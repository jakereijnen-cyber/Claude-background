export type Clock = {
  /** When the cache was last written or read (a request's start), in ms; null before the first reply. */
  at: number | null
  /** How long the cache lives from `at`: 5 minutes or 1 hour. */
  ttlMs: number
  /** The latest tick, so the countdown redraws. */
  now: number
  isTurnRunning: boolean
  keepWarm: boolean
  /** Keep-warm pings since the person last sent a message. */
  pings: number
  isPinging: boolean
  /** The last ping's outcome, for the band. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { clock: Shaped<Clock> }
  }
}
