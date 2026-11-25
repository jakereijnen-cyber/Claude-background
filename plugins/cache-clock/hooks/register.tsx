import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Clock } from '../types'

const FIVE_MIN = 300_000
const ONE_HOUR = 3_600_000

// Keep warm pings this long before the cache would go cold.
const MARGIN = { [FIVE_MIN]: 30_000, [ONE_HOUR]: 120_000 } as Record<number, number>
// At most this many pings in a row while you are away; your next message resets it.
const MAX_PINGS = 3

const GREEN = '#22c55e'
const AMBER = '#f59e0b'
const RED = '#ef4444'

const PING_PROMPT =
  'Automatic cache keep-alive from the Cache Clock mod, not a request from the person. ' +
  'Reply with only the word OK, straight away, without thinking it over. You have no tools.'

const clock = atom({ plugin: 'cache-clock', key: 'clock' } as const, {
  at: null,
  ttlMs: FIVE_MIN,
  now: 0,
  isTurnRunning: false,
  keepWarm: true,
  pings: 0,
  isPinging: false,
  note: '',
} as Clock, { shape: 'clock-1' })

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

async function ping($: EngineInterface): Promise<void> {
  const startedAt = await $.clock.now()
  await update($, clock, c => ({ ...c, isPinging: true, pings: c.pings + 1 }))
  const reply = await $.model.fork({ prompt: PING_PROMPT })
  await update($, clock, c => {
    if (!reply.isAnswered) {
      return { ...c, isPinging: false, note: reply.reason === 'nothing-to-fork' ? '' : 'Keep warm failed' }
    }
    // A big write means the cache had already gone: this ping paid to rebuild it.
    const wasCold = reply.usage.cache_creation_input_tokens > reply.usage.cache_read_input_tokens
    return { ...c, at: startedAt, isPinging: false, note: wasCold ? 'Cache was already cold; rebuilt' : `Kept warm ${c.pings}×` }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('keepWarm')
    if (typeof saved === 'boolean') await update($, clock, c => ({ ...c, keepWarm: saved }))

    await $.command.register({ name: 'keep-warm', description: 'Turn Cache Clock keep warm on or off' })

    $.clock.every(1000, () => {
      void (async () => {
        const now = await $.clock.now()
        const c = await read($, clock)
        if (c.at === null || c.isTurnRunning) return
        await update($, clock, old => ({ ...old, now }))
        const left = c.at + c.ttlMs - now
        const margin = MARGIN[c.ttlMs] ?? 30_000
        if (c.keepWarm && !c.isPinging && c.pings < MAX_PINGS && left > 0 && left <= margin) {
          await ping($)
        }
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'keep-warm' }, async $ => {
    const c = await update($, clock, old => ({ ...old, keepWarm: !old.keepWarm }))
    await $.store.set('keepWarm', c.keepWarm)
    return { text: `Keep warm is ${c.keepWarm ? 'on' : 'off'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, clock, c => (c.pings === 0 && c.note === '' ? c : { ...c, pings: 0, note: '' }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, clock, c => ({ ...c, isTurnRunning: true }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, clock, c => ({ ...c, isTurnRunning: false, now }))
    }
    return done
  })

  // Every request of the main chat renews the cache from the moment it is sent.
  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const result = yield* next(e)
    if (e.agentId === undefined && result.usage !== null) {
      const u = result.usage
      const touched = u.cache_read_input_tokens > 0 || u.cache_creation_input_tokens > 0
      if (touched) {
        const ttlMs =
          (u.ephemeral_1h_input_tokens ?? 0) > 0 ? ONE_HOUR : (u.ephemeral_5m_input_tokens ?? 0) > 0 ? FIVE_MIN : undefined
        await update($, clock, c => ({ ...c, at: sentAt, ttlMs: ttlMs ?? c.ttlMs }))
      }
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, clock)
    if (c.at === null || c.isTurnRunning || e.props.hasSurvey) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const now = c.now || (await $.clock.now())
    const left = c.at + c.ttlMs - now
    const isCold = left <= 0
    const color = isCold ? RED : left <= 60_000 ? AMBER : GREEN
    const kind = c.ttlMs === ONE_HOUR ? '1-hour cache' : '5-minute cache'
    const words = c.isPinging
      ? 'Keeping the cache warm…'
      : isCold
        ? 'Cache cold: your next message re-reads the whole chat at full price'
        : `Cache warm · ${mmss(left)} left (${kind})`
    const extra = c.note !== '' ? ` · ${c.note}` : c.keepWarm && c.pings >= MAX_PINGS && !isCold ? ' · keep warm paused until you write' : ''

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={color} tabular wrap="truncate-end">
          {words}
          {extra}
        </Text>
        <Button
          key="keep-warm"
          label={c.keepWarm ? 'Keep warm: on' : 'Keep warm: off'}
          onPress={async () => {
            const flipped = await update($, clock, old => ({ ...old, keepWarm: !old.keepWarm }))
            await $.store.set('keepWarm', flipped.keepWarm)
          }}
        />
      </Box>
    )
  })
}
