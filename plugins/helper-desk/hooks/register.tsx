import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import type { Card, Desk, Task, TaskStatus } from '../types'

const PURPLE = '#8b5cf6'
const PANE = 'helper-desk'
const MAX_CARDS = 12

// Change a tag when its value's fields change: it declines what an earlier version stored.
const tasks = atom({ plugin: 'helper-desk', key: 'tasks' } as const, [] as Task[], { shape: 'tasks-1' })
const desk = atom({ plugin: 'helper-desk', key: 'desk' } as const, { cards: [], now: 0 } as Desk, { shape: 'desk-1' })

// ---------- formatting ----------

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tokens`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tokens`
  return `${n} tokens`
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  const rest = String(s % 60).padStart(2, '0')
  return m > 0 ? `${m}m ${rest}s` : `${s}s`
}

function shorten(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// What a subagent's tool call is doing, in a few words.
function describe(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const file = pick('file_path').split(/[\\/]/).pop() ?? ''
  switch (tool) {
    case 'Read': return `Reading ${file}`
    case 'Edit': return `Editing ${file}`
    case 'Write': return `Writing ${file}`
    case 'Bash':
    case 'PowerShell': return pick('description') || `Running ${shorten(pick('command'), 40)}`
    case 'Grep': return `Searching for ${shorten(pick('pattern'), 40)}`
    case 'Glob': return `Finding ${shorten(pick('pattern'), 40)}`
    case 'WebFetch': return `Reading ${shorten(pick('url'), 50)}`
    case 'WebSearch': return `Searching the web: ${shorten(pick('query'), 40)}`
    default: return `Using ${tool}`
  }
}

// ---------- subagent cards ----------

// Per subagent, kept in the module: tool calls made and the latest one.
const steps = new Map<string, { count: number; last: string }>()

function stateOf(a: AgentInfo): Card['state'] {
  if (a.taskStatus === 'failed') return 'failed'
  if (a.taskStatus === 'killed') return 'stopped'
  if (a.taskStatus === 'completed') return 'done'
  return 'running'
}

async function refresh($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const list = (await $.agent.list()).filter(a => a.kind === 'local_agent')
  await update($, desk, old => {
    const byId = new Map(old.cards.map(c => [c.id, c]))
    for (const a of list) {
      const before = byId.get(a.id)
      const state = stateOf(a)
      const mine = steps.get(a.id)
      const summary = a.label && a.label !== a.description ? a.label : ''
      byId.set(a.id, {
        id: a.id,
        title: a.description || a.name || a.type,
        type: a.type,
        step: state === 'running' ? shorten(summary || mine?.last || 'Starting…', 90) : state === 'done' ? 'Finished' : state === 'failed' ? 'Failed' : 'Stopped',
        steps: mine?.count ?? before?.steps ?? 0,
        tokens: a.tokenCount,
        startedAt: a.startTime,
        endedAt: state === 'running' ? null : (before?.endedAt ?? now),
        state,
      })
    }
    const cards = [...byId.values()].sort((x, y) => y.startedAt - x.startedAt).slice(0, MAX_CARDS)
    const isSame = old.cards.length === cards.length && cards.every((c, i) => JSON.stringify(c) === JSON.stringify(old.cards[i]))
    const isTicking = cards.some(c => c.state === 'running')
    return isSame && !isTicking ? old : { cards, now }
  })
}

// ---------- the to-do list ----------

// The fields read off each to-do tool's call.
type Called = { agentId?: string }
type TodoWriteCall = Called & { todos: { content: string; status: TaskStatus; activeForm: string }[] }
type TaskCreateCall = Called & { subject: string; activeForm?: string }
type TaskUpdateCall = Called & { taskId: string; status?: TaskStatus | 'deleted'; subject?: string; activeForm?: string }

function setStatus(list: Task[], id: string, status: TaskStatus | 'deleted', title?: string, active?: string): Task[] {
  if (status === 'deleted') return list.filter(t => t.id !== id)
  return list.map(t => (t.id === id ? { ...t, status, title: title ?? t.title, active: active ?? t.active } : t))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'helper-desk', description: 'Open the Helper Desk panel with a live card per subagent' })
    $.clock.every(1000, () => {
      void refresh($)
    })
    return next(e)
  })

  on('command.run', { command: 'helper-desk' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Helper Desk' })
    return { text: 'Helper Desk opened.' }
  })

  // A new request with the old list all done starts a clean bar.
  on('prompt.submit', async ($, e, next) => {
    await update($, tasks, list => (list.length > 0 && list.every(t => t.status === 'completed') ? [] : list))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Older builds: the whole list in one call.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as TodoWriteCall
    if (input.agentId === undefined && ran.deny === undefined && ran.isError !== true && Array.isArray(input.todos)) {
      await update($, tasks, () =>
        input.todos.map((t, i) => ({ id: String(i), title: t.content, active: t.activeForm, status: t.status })),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Newer builds: one task at a time.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as TaskCreateCall
    if (input.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const made = (ran.result as { task?: { id: string; subject: string } } | undefined)?.task
      if (made !== undefined) {
        const task: Task = { id: made.id, title: made.subject, active: input.activeForm ?? made.subject, status: 'pending' }
        await update($, tasks, list => [...list.filter(t => t.id !== task.id), task])
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const input = e as unknown as TaskUpdateCall
    if (input.agentId === undefined && ran.deny === undefined && ran.isError !== true && (input.status || input.subject || input.activeForm)) {
      await update($, tasks, list => {
        const current = list.find(t => t.id === input.taskId)
        return current === undefined ? list : setStatus(list, input.taskId, input.status ?? current.status, input.subject, input.activeForm)
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Every tool call a subagent makes is one step on its card.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown> & { tool: string; agentId?: string }
    if (input.agentId !== undefined) {
      const mine = steps.get(input.agentId) ?? { count: 0, last: '' }
      steps.set(input.agentId, { count: mine.count + 1, last: describe(input.tool, input) })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The panel opens by itself when the first helper starts.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    void $.ui.open({ id: PANE, title: 'Helper Desk' })
    void refresh($)
    return spawned
  }).catch(($, e, next) => next(e))

  // ---------- drawing ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, tasks)
    const working = (await read($, desk)).cards.filter(c => c.state === 'running')
    if ((list.length === 0 && working.length === 0) || e.props.hasSurvey) return next(e)

    const { Box, Text, Progress } = $.ui.resolve(e)
    const done = list.filter(t => t.status === 'completed').length
    const doing = list.find(t => t.status === 'in_progress')
    const caption = done === list.length ? 'All tasks done' : doing ? doing.active || doing.title : 'Up next: ' + (list.find(t => t.status === 'pending')?.title ?? '')
    // The panel may not show on every app, so the bar names the helpers too.
    const helpers = working.length === 0 ? '' : working.length === 1 ? `1 helper working: ${working[0]?.title ?? ''}` : `${working.length} helpers working`

    return (
      <Box flexDirection="column">
        {list.length > 0 && <Progress label="Tasks" value={done} max={list.length} valueText={`${done} of ${list.length}`} color={PURPLE} />}
        {list.length > 0 && (
          <Text color={PURPLE} wrap="truncate-end">
            {done} of {list.length} tasks · {caption}
          </Text>
        )}
        {helpers !== '' && (
          <Text color={PURPLE} dimColor wrap="truncate-end">
            {helpers} · /helper-desk for details
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Progress } = $.ui.resolve(e)
    const { cards, now } = await read($, desk)
    const clock = now || (await $.clock.now())

    if (cards.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>No helpers yet. A card appears here for each subagent Claude starts.</Text>
        </Box>
      )
    }

    const running = cards.filter(c => c.state === 'running').length
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={PURPLE} bold>
          {running > 0 ? `${running} working` : 'All helpers finished'} · {cards.length} total
        </Text>
        {cards.map(card => {
          const isRunning = card.state === 'running'
          const elapsed = (card.endedAt ?? clock) - card.startedAt
          return (
            <Box key={card.id} flexDirection="column" borderStyle="round" borderColor={isRunning ? PURPLE : 'border'} paddingX={1}>
              <Text bold wrap="truncate-end" dimColor={!isRunning}>
                {card.title}
              </Text>
              <Text dimColor wrap="truncate-end">
                {card.type} · {card.step}
              </Text>
              <Progress
                label={card.title}
                value={isRunning ? undefined : 1}
                valueText={isRunning ? `${card.steps} steps so far` : `${card.steps} steps`}
                color={card.state === 'failed' ? 'fill-danger' : PURPLE}
              />
              <Text dimColor tabular>
                {card.steps} steps · {tokens(card.tokens)} · {duration(elapsed)}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
