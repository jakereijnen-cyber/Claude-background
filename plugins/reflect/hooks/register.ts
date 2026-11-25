import type { EngineInterface, Register } from 'claude-code'

// Words a hard rule usually carries (English and Dutch). Only prompts with one are checked.
const RULE_WORDS =
  /\b(never|always|don'?t|do not|stop|from now on|going forward|make sure|must|avoid|no more|please don'?t|nooit|altijd|niet meer|voortaan|vanaf nu|zorg dat|moet|geen|gebruik geen)\b/i

const HEADING = '## Rules saved with Reflect'
const VAULT_FILE = 'rules.md'

const SAVE_ALL = 'Save everywhere'
const SAVE_VAULT = 'Save to vault'
const SKIP = 'Skip'

const DETECT_SYSTEM = `You read one message a person sent to an AI coding assistant and find a hard rule in it: a lasting preference about how the assistant should always or never work, write or behave, in every future chat.
Examples of hard rules: "never use em dashes", "always answer in Dutch", "don't add comments to code", "stop apologizing".
Not hard rules: instructions for the current task only ("don't touch the login page in this change"), questions, or one-off requests.
If there is a hard rule, rewrite it as one short imperative sentence in the person's own language, with no quotes, e.g. Never use em dashes.
If there are several, give the most important one. If there is none, answer NONE.
Answer with the rule sentence or NONE, nothing else.`

// ---------- paths ----------

async function claudeDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/[\\/]+$/, '')}/.claude`
}

async function readOr($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
}

const join = (dir: string, file: string) => `${dir.replace(/[\\/]+$/, '')}/${file}`
const known = (text: string, rule: string) => text.toLowerCase().includes(rule.toLowerCase())

// ---------- saving ----------

// Adds the rule as a bullet under Reflect's own heading, making the heading if needed.
function withRule(text: string, rule: string): string {
  const lines = text === '' ? [] : text.replace(/\s+$/, '').split(/\r?\n/)
  const at = lines.findIndex(l => l.trim() === HEADING)
  if (at < 0) return [...lines, ...(lines.length > 0 ? [''] : []), HEADING, '', `- ${rule}`, ''].join('\n')
  let end = at + 1
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end] ?? '')) end++
  while (end > at + 1 && (lines[end - 1] ?? '').trim() === '') end--
  return [...lines.slice(0, end), `- ${rule}`, ...lines.slice(end), ''].join('\n')
}

async function saveEverywhere($: EngineInterface, rule: string): Promise<string> {
  const path = join(await claudeDir($), 'CLAUDE.md')
  const text = await readOr($, path)
  if (known(text, rule)) return 'Already in your CLAUDE.md.'
  await $.fs.write(path, withRule(text, rule))
  return 'Saved to your CLAUDE.md: every chat follows it from the next one on.'
}

async function chooseVault($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  const inClaude = join(await claudeDir($), 'rules-vault')
  const inDocs = join(home, 'Documents/Claude rules')
  try {
    const picked = await $.ui.ask('Which folder should your rules vault be? Pick one or type a folder path under Other.', {
      options: [inClaude, inDocs],
      header: 'Vault',
    })
    const folder = picked.trim().replace(/^["']|["']$/g, '')
    if (folder === '') return undefined
    await $.store.set('vault', folder)
    return folder
  } catch {
    return undefined
  }
}

async function saveToVault($: EngineInterface, rule: string): Promise<string> {
  const saved = await $.store.get('vault')
  const folder = typeof saved === 'string' && saved !== '' ? saved : await chooseVault($)
  if (folder === undefined) return 'Not saved: no vault folder chosen.'
  const path = join(folder, VAULT_FILE)
  const text = await readOr($, path)
  if (known(text, rule)) return `Already in your vault (${path}).`
  const base = text === '' ? '# My rules for Claude\n\nReflect reads this file into every chat.\n' : text
  await $.fs.write(path, withRule(base, rule))
  return `Saved to your vault: ${path}. New chats follow it.`
}

// ---------- asking ----------

const pending: string[] = []
let isTurnRunning = false
let isAsking = false

async function askAll($: EngineInterface): Promise<void> {
  if (isAsking || isTurnRunning) return
  isAsking = true
  try {
    while (pending.length > 0) {
      const rule = pending.shift() as string
      let choice = SKIP
      try {
        choice = await $.ui.ask(`Keep this rule for the future: "${rule}"?`, { options: [SAVE_ALL, SAVE_VAULT, SKIP], header: 'Reflect' })
      } catch {
        choice = SKIP
      }
      if (choice === SAVE_ALL) $.ui.toast(await saveEverywhere($, rule))
      else if (choice === SAVE_VAULT) $.ui.toast(await saveToVault($, rule))
    }
  } catch (err) {
    $.ui.log(`Reflect could not save the rule: ${String(err)}`)
  } finally {
    isAsking = false
  }
}

async function detect($: EngineInterface, text: string): Promise<void> {
  const r = await $.model.complete({
    model: 'haiku',
    system: DETECT_SYSTEM,
    prompt: `<message>\n${text.slice(0, 6000)}\n</message>`,
    maxTokens: 120,
    effort: 'low',
    timeoutMs: 20_000,
  })
  if (!r.isAnswered) return
  const rule = r.text.trim().replace(/^["'“”]+|["'“”]+$/g, '').split(/\r?\n/)[0]?.trim() ?? ''
  if (rule === '' || /^none\.?$/i.test(rule) || rule.length > 200) return

  // Already kept somewhere: no need to ask again.
  const everywhere = await readOr($, join(await claudeDir($), 'CLAUDE.md'))
  const vault = await $.store.get('vault')
  const inVault = typeof vault === 'string' ? await readOr($, join(vault, VAULT_FILE)) : ''
  if (known(everywhere, rule) || known(inVault, rule) || pending.includes(rule)) return

  pending.push(rule)
  await askAll($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'reflect-vault', description: 'Choose the folder Reflect saves vault rules in' })
    return next(e)
  })

  on('command.run', { command: 'reflect-vault' }, async $ => {
    const folder = await chooseVault($)
    return { text: folder === undefined ? 'Vault folder unchanged.' : `Reflect saves vault rules in ${join(folder, VAULT_FILE)}.` }
  })

  // The prompt goes on at once; the check runs beside it and asks once Claude has replied.
  on('prompt.submit', async ($, e, next) => {
    const isPerson = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)
    if (isPerson && e.command === undefined && !e.isMeta && RULE_WORDS.test(e.text)) {
      void detect($, e.text).catch(err => $.ui.log(`Reflect: ${String(err)}`, { to: 'debug' }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      isTurnRunning = false
      void askAll($)
    }
    return done
  })

  // Rules in the vault reach every chat through the system prompt.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const vault = await $.store.get('vault')
    if (typeof vault !== 'string' || vault === '') return composed
    const rules = (await readOr($, join(vault, VAULT_FILE))).trim()
    if (rules === '') return composed
    return {
      ...composed,
      sections: [
        ...composed.sections,
        { id: 'reflect-vault', text: `The person's saved rules (their Reflect vault). Always follow them:\n\n${rules}`, scope: 'session' as const },
      ],
    }
  }).catch(($, e, next) => next(e))
}
