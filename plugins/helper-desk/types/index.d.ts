export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = { id: string; title: string; active: string; status: TaskStatus }

export type Card = {
  id: string
  title: string
  type: string
  step: string
  steps: number
  tokens: number
  startedAt: number
  endedAt: number | null
  state: 'running' | 'done' | 'failed' | 'stopped'
}

export type Desk = { cards: Card[]; now: number }

declare module 'claude-code' {
  interface PluginState {
    'helper-desk': {
      tasks: Shaped<Task[]>
      desk: Shaped<Desk>
    }
  }
}
