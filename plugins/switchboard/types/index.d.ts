export type Mod = {
  /** `name@marketplace` for an installed mod, `name@dev` for one loaded from a folder. */
  key: string
  name: string
  version: string
  description: string
  /** `user`, `project`, `local`, or `dev` for a folder mod that cannot be switched here. */
  scope: string
  /** What the settings say: it loads in the next session. */
  isEnabled: boolean
  /** Whether it runs in this session. */
  isLoaded: boolean
}

export type Board = {
  mods: Mod[]
  /** Names of mods whose bars and panels are hidden. */
  hidden: string[]
  /** A key being switched right now. */
  busy: string
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    switchboard: { board: Shaped<Board> }
  }
}
