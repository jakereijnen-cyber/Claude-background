import type { Register } from 'claude-code'

// A prompt this long (or longer) is looked at; shorter ones pass straight through.
const MIN_CHARS = 500
const MIN_WORDS = 90

// Start a prompt with this to send it as typed, with no questions.
const SKIP_PREFIX = 'raw:'

// The finished prompt carries these headings, so it is never caught twice.
const HEADINGS = ['## The job', '## Why', '## Guardrails', '## Done means']

// Only prompts a person typed: the terminal, the desktop or phone apps, an SDK host.
const PEOPLE = new Set(['composer', 'bridge', 'sdk'])

type Question = { q: string; header: string; options: string[] }
type Triage = { messy: boolean; questions: Question[] }

const TRIAGE_SYSTEM = `You review a prompt someone is about to send to an AI coding assistant.
Decide whether it is a messy brain dump: rambling, mixing several thoughts, or missing what the job is, why it matters, what must not be touched, or how to tell it is done.
If it is already clear and well-structured, answer messy false.
If it is messy, write 2 or 3 questions about the most important gaps only. Each question:
- ends with a question mark and is under 120 characters,
- has a header of at most 12 characters,
- has 2 to 4 short, concrete answer options (each under 60 characters) that fit this prompt.
Answer with JSON only, no prose and no code fence:
{"messy": true, "questions": [{"q": "...?", "header": "...", "options": ["...", "..."]}]}`

const REWRITE_SYSTEM = `You turn a messy prompt into a clear prompt for an AI coding assistant.
Keep every fact, file name, name, number and requirement from the original. Use the person's answers to fill the gaps. Do not invent requirements they did not give.
Write in the same language as the original prompt, in the person's voice ("I want...", "Please...").
Output exactly these four sections and nothing else, with no preamble:

## The job
What to do, concretely.

## Why
The goal behind it and who it is for.

## Guardrails
What to keep, avoid or not touch; constraints and preferences. Bullet points.

## Done means
How to tell it is finished: checks, outputs, acceptance criteria. Bullet points.`

function parseTriage(text: string): Triage | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { messy?: unknown; questions?: unknown }
    const questions = (Array.isArray(raw.questions) ? raw.questions : [])
      .map((x: { q?: unknown; header?: unknown; options?: unknown }) => ({
        q: String(x.q ?? '').trim(),
        header: String(x.header ?? 'Detail').trim().slice(0, 12),
        options: (Array.isArray(x.options) ? x.options : []).map(o => String(o).trim()).filter(o => o !== '').slice(0, 4),
      }))
      .filter(x => x.q !== '' && x.options.length >= 2)
      .slice(0, 3)
    return { messy: raw.messy === true, questions }
  } catch {
    return undefined
  }
}

function isLong(text: string): boolean {
  return text.length >= MIN_CHARS || text.trim().split(/\s+/).length >= MIN_WORDS
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta || e.turnId !== undefined) return next(e)
    if (!PEOPLE.has(e.origin.kind)) return next(e)

    const typed = e.text.trimStart()
    if (typed.toLowerCase().startsWith(SKIP_PREFIX)) {
      return next({ ...e, text: typed.slice(SKIP_PREFIX.length).trimStart() })
    }
    if (!isLong(e.text) || HEADINGS.every(h => e.text.includes(h))) return next(e)

    $.ui.toast('Brain-Dump is reading your prompt...')
    const triage = await $.model.complete({
      model: 'sonnet',
      system: TRIAGE_SYSTEM,
      prompt: `The prompt:\n<prompt>\n${e.text}\n</prompt>`,
      effort: 'low',
      maxTokens: 1200,
      timeoutMs: 45_000,
    })
    if (!triage.isAnswered) {
      $.ui.log(`Brain-Dump: could not review the prompt (${triage.reason}), so it was sent as typed.`)
      return next(e)
    }
    const plan = parseTriage(triage.text)
    if (plan === undefined || !plan.messy || plan.questions.length === 0) return next(e)

    const answers: string[] = []
    for (const item of plan.questions) {
      try {
        const answer = await $.ui.ask(item.q, { options: item.options, header: item.header })
        answers.push(`Q: ${item.q}\nA: ${answer}`)
      } catch {
        // Dismissed: put the prompt back as typed so nothing is lost.
        await $.prompt.fill({ text: e.text, mode: 'replace' })
        return { drop: 'Brain-Dump stopped. Your prompt is back in the box as you typed it.' }
      }
    }

    $.ui.toast('Brain-Dump is writing the clear version...')
    const rewrite = await $.model.complete({
      model: 'sonnet',
      system: REWRITE_SYSTEM,
      prompt: `The original prompt:\n<prompt>\n${e.text}\n</prompt>\n\nThe person's answers:\n${answers.join('\n\n')}`,
      maxTokens: 3000,
      timeoutMs: 90_000,
    })
    if (!rewrite.isAnswered || rewrite.text.trim() === '') {
      await $.prompt.fill({ text: e.text, mode: 'replace' })
      return { drop: 'Brain-Dump could not write the new prompt. Your prompt is back in the box as you typed it.' }
    }

    await $.prompt.fill({ text: rewrite.text.trim(), mode: 'replace' })
    return { drop: 'Brain-Dump rewrote your prompt. Check it in the box, edit if you like, and press Enter to send.' }
  })
}
