import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Share } from '../types'

// Only the drawing changes: the stored messages, and what Claude reads, keep the real data.

const share = atom({ plugin: 'screen-share', key: 'share' } as const, { isOn: false, names: [] } as Share, {
  shape: 'share-1',
})

const GREY = '#9ca3af'

// ---------- what gets hidden ----------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const MONEY =
  /(?:[€$£¥₹]\s?\d[\d.,]*(?:\s?(?:k|m|mln|bn|million|billion|thousand|duizend|miljoen)\b)?|\b\d[\d.,]*\s?(?:EUR|USD|GBP|euros?|dollars?|pounds?)\b)/gi
const PHONE = /(?<![\w/.:-])(?:\+|00)?\d[\d\s().-]{6,}\d(?![\w/.:-])/g
const DATE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/

const bar = (s: string) => '▇'.repeat(Math.min(10, Math.max(3, s.length)))

function isPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '').length
  return digits >= 9 && digits <= 15 && !DATE.test(s.trim())
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// One pattern for every known name and each part of it (first or last name alone).
function namePattern(names: readonly string[]): RegExp | undefined {
  const parts = new Set<string>()
  for (const n of names) {
    const whole = n.trim()
    if (whole.length >= 2) parts.add(whole)
    for (const p of whole.split(/\s+/)) if (p.length >= 3) parts.add(p)
  }
  if (parts.size === 0) return undefined
  const sorted = [...parts].sort((a, b) => b.length - a.length).map(escape)
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
}

function mask(text: string, names: RegExp | undefined): string {
  let out = text.replace(EMAIL, bar).replace(MONEY, bar).replace(PHONE, m => (isPhone(m) ? bar(m) : m))
  if (names !== undefined) out = out.replace(names, bar)
  return out
}

// Masks every string inside a tool's input or output, keeping its shape.
function maskDeep(value: unknown, names: RegExp | undefined): unknown {
  if (typeof value === 'string') return mask(value, names)
  if (Array.isArray(value)) return value.map(v => maskDeep(v, names))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskDeep(v, names)]))
  }
  return value
}

// ---------- finding names ----------

const seen = new Set<string>()
let queue: string[] = []
let isFinding = false

function note(text: string): void {
  const key = text.length > 400 ? text.slice(0, 200) + text.length + text.slice(-200) : text
  if (seen.has(key) || text.trim().length < 3) return
  seen.add(key)
  queue.push(text)
}

const FIND_SYSTEM = `List every person's name in the text: first names, last names, full names and usernames of real people. Not companies, products, places, tools or code identifiers.
Answer with one name per line, exactly as written in the text, and nothing else. If there are none, answer NONE.`

async function findNames($: EngineInterface): Promise<void> {
  if (isFinding || queue.length === 0) return
  isFinding = true
  const batch = queue.join('\n\n---\n\n').slice(0, 20_000)
  queue = []
  try {
    const r = await $.model.complete({ model: 'haiku', system: FIND_SYSTEM, prompt: batch, maxTokens: 400, effort: 'low', timeoutMs: 20_000 })
    if (!r.isAnswered) return
    const found = r.text
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(l => l !== '' && !/^none$/i.test(l) && l.length <= 60)
    if (found.length === 0) return
    await update($, share, s => {
      const all = [...new Set([...s.names, ...found])]
      return all.length === s.names.length ? s : { ...s, names: all.slice(-500) }
    })
  } finally {
    isFinding = false
  }
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'screen-share', description: 'Hide names, emails, phone numbers and amounts on screen (Claude still reads them)' })
    $.clock.every(1500, () => {
      void findNames($)
    })
    return next(e)
  })

  on('command.run', { command: 'screen-share' }, async $ => {
    const s = await update($, share, old => ({ ...old, isOn: !old.isOn }))
    return {
      text: s.isOn
        ? 'Screen-share mode on: names, emails, phone numbers and amounts show as grey bars. Claude still reads the real data. Type /screen-share again to turn it off.'
        : 'Screen-share mode off.',
    }
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn) return next(e)
    note(e.props.text)
    return next({ ...e, props: { ...e.props, text: mask(e.props.text, namePattern(s.names)) } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn) return next(e)
    note(e.props.text)
    return next({ ...e, props: { ...e.props, text: mask(e.props.text, namePattern(s.names)) } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn || e.props.command === 'screen-share') return next(e)
    return next({ ...e, props: { ...e.props, text: mask(e.props.text, namePattern(s.names)) } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn) return next(e)
    const names = namePattern(s.names)
    const output = e.props.output === undefined ? undefined : maskDeep(e.props.output, names)
    return next({ ...e, props: { ...e.props, input: maskDeep(e.props.input, names), output } })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn) return next(e)
    if (typeof e.props.output === 'string') note(e.props.output)
    return next({ ...e, props: { ...e.props, output: maskDeep(e.props.output, namePattern(s.names)) } })
  })

  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn) return next(e)
    return next({ ...e, props: { ...e.props, questions: maskDeep(e.props.questions, namePattern(s.names)) as unknown[] } })
  })

  // A reminder that the mode is on, so you know before you share.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, share)
    if (!s.isOn || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={GREY} wrap="truncate-end">
          ▇▇ Screen-share mode on · names, emails, phone numbers and amounts hidden
        </Text>
        <Button key="off" label="Turn off" onPress={() => update($, share, old => ({ ...old, isOn: false }))} />
      </Box>
    )
  })
}
