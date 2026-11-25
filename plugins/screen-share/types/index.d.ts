export type Share = {
  isOn: boolean
  /** People's names found on screen so far, hidden wherever they show. */
  names: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'screen-share': { share: Shaped<Share> }
  }
}
