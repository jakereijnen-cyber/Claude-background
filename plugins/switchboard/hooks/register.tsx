import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Mod } from '../types'

const SELF = 'switchboard'
const PANE = 'switchboard'
const GREEN = '#22c55e'
const GREY = '#9ca3af'
const AMBER = '#f59e0b'

const board = atom({ plugin: 'switchboard', key: 'board' } as const, { mods: [], hidden: [], busy: '', note: '' } as Board, {
  shape: 'board-1',
})

// Mods this session loaded, as the engine announces them: name → where from.
const loadedHere = new Map<string, { provenance: string; version: string; root: string }>()
let isFirstScan = true

// ---------- reading what is installed ----------

async function claudeDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return `${home.replace(/[\\/]+$/, '')}/.claude`
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return (await $.fs.exists(path)) ? JSON.parse(await $.fs.read(path)) : undefined
  } catch {
    return undefined
  }
}

// A plugin is a mod when it ships a hooks module.
async function manifestOf($: EngineInterface, root: string): Promise<{ isMod: boolean; description: string; version: string }> {
  const hooks = (await readJson($, `${root}/hooks/hooks.json`)) as { modules?: unknown } | undefined
  const manifest = (await readJson($, `${root}/.claude-plugin/plugin.json`)) as { description?: string; version?: string } | undefined
  return {
    isMod: Array.isArray(hooks?.modules) && hooks.modules.length > 0,
    description: manifest?.description ?? '',
    version: manifest?.version ?? '',
  }
}

type Installed = { scope?: string; installPath?: string; version?: string }

async function scan($: EngineInterface): Promise<Mod[]> {
  const record = (await readJson($, `${await claudeDir($)}/plugins/installed_plugins.json`)) as
    | { plugins?: Record<string, Installed[]> }
    | undefined
  const enabled = ((await $.settings.read({ key: 'enabledPlugins' })) ?? {}) as Record<string, unknown>
  const mods: Mod[] = []
  const named = new Set<string>()

  for (const [key, entries] of Object.entries(record?.plugins ?? {})) {
    const entry = entries.find(x => x.scope === 'user') ?? entries[0]
    if (entry?.installPath === undefined) continue
    const info = await manifestOf($, entry.installPath)
    if (!info.isMod) continue
    const name = key.split('@')[0] ?? key
    named.add(name)
    mods.push({
      key,
      name,
      version: entry.version ?? info.version,
      description: info.description,
      scope: entry.scope ?? 'user',
      isEnabled: enabled[key] === true,
      isLoaded: loadedHere.has(name),
    })
  }

  // Mods loaded from a folder (while building one) are listed too, read-only.
  for (const [name, at] of loadedHere) {
    if (named.has(name)) continue
    const info = await manifestOf($, at.root)
    mods.push({ key: at.provenance, name, version: at.version || info.version, description: info.description, scope: 'dev', isEnabled: true, isLoaded: true })
  }
  return mods.sort((a, b) => a.name.localeCompare(b.name))
}

async function refresh($: EngineInterface): Promise<void> {
  const mods = await scan($)
  const before = await read($, board)
  const known = new Set(before.mods.map(m => m.key))
  const added = isFirstScan ? [] : mods.filter(m => !known.has(m.key))
  isFirstScan = false
  if (JSON.stringify(mods) !== JSON.stringify(before.mods)) await update($, board, b => ({ ...b, mods }))
  for (const m of added) $.ui.toast(`New mod: ${m.name}. Type /mods to manage it.`)
}

// ---------- switching ----------

async function setEnabled($: EngineInterface, mod: Mod, on: boolean): Promise<string> {
  if (mod.name === SELF) return 'Switchboard stays on, so /mods keeps working.'
  if (mod.scope === 'dev') return `${mod.name} is loaded from a folder; it cannot be switched here.`
  await update($, board, b => ({ ...b, busy: mod.key }))
  try {
    const run = await $.process.run(['claude', 'plugin', on ? 'enable' : 'disable', mod.key, '--scope', mod.scope])
    if (run.exitCode !== 0) return `Could not switch ${mod.name}: ${(run.stderr || run.stdout).trim().slice(0, 200)}`
    await refresh($)
    return `${mod.name} is ${on ? 'on' : 'off'} from your next session (or after /reload-plugins).`
  } catch (err) {
    return `Could not switch ${mod.name}: ${String(err)}`
  } finally {
    await update($, board, b => ({ ...b, busy: '' }))
  }
}

async function setHidden($: EngineInterface, name: string, hide: boolean): Promise<string> {
  const b = await update($, board, old => ({
    ...old,
    hidden: hide ? [...new Set([...old.hidden, name])] : old.hidden.filter(n => n !== name),
  }))
  await $.store.set('hidden', b.hidden)
  return hide ? `${name}'s bars and panels are hidden.` : `${name}'s bars and panels show again.`
}

async function act($: EngineInterface, mod: Mod, what: 'on' | 'off' | 'hide' | 'show'): Promise<void> {
  const text = what === 'on' || what === 'off' ? await setEnabled($, mod, what === 'on') : await setHidden($, mod.name, what === 'hide')
  await update($, board, b => ({ ...b, note: text }))
  $.ui.toast(text)
}

function statusOf(m: Mod, hidden: readonly string[]): { text: string; color: string } {
  if (m.isEnabled && m.isLoaded) return { text: hidden.includes(m.name) ? 'On · hidden' : 'On', color: GREEN }
  if (m.isEnabled && !m.isLoaded) return { text: 'On from next session', color: AMBER }
  if (!m.isEnabled && m.isLoaded) return { text: 'Off from next session', color: AMBER }
  return { text: 'Off', color: GREY }
}

// The same list as text, for apps that draw no panel.
function asText(b: Board): string {
  if (b.mods.length === 0) return 'No mods found yet.'
  const lines = b.mods.map(m => `- **${m.name}** ${m.version ? `v${m.version} ` : ''}· ${statusOf(m, b.hidden).text}`)
  return [
    `**Your mods (${b.mods.length})**`,
    '',
    ...lines,
    '',
    'Switch from here with `/mods on <name>`, `/mods off <name>`, `/mods hide <name>` or `/mods show <name>`.',
  ].join('\n')
}

// ---------- hooks ----------

export const register: Register = on => {
  // Every mod that loads is announced here, including ones added later in the session.
  on('plugin.register', async ($, e, next) => {
    loadedHere.set(e.name, { provenance: e.provenance, version: e.version ?? '', root: e.root })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const hidden = await $.store.get('hidden')
    if (Array.isArray(hidden)) await update($, board, b => ({ ...b, hidden: hidden.filter((n): n is string => typeof n === 'string') }))
    await $.command.register({ name: 'mods', description: 'Open Switchboard: every mod you run, to switch on or off or hide' })
    await refresh($)
    // New installs show up by themselves.
    $.clock.every(5000, () => {
      void refresh($)
    })
    return next(e)
  })

  on('command.run', { command: 'mods' }, async ($, e) => {
    await refresh($)
    const [verb, ...rest] = (e.args ?? '').trim().split(/\s+/)
    const what = (verb ?? '').toLowerCase()
    if (what === 'on' || what === 'off' || what === 'hide' || what === 'show') {
      const name = rest.join(' ').toLowerCase()
      const mod = (await read($, board)).mods.find(m => m.name.toLowerCase() === name || m.key.toLowerCase() === name)
      if (mod === undefined) return { text: `No mod named "${rest.join(' ')}". Type /mods to see the list.` }
      await act($, mod, what)
      return { text: (await read($, board)).note }
    }
    void $.ui.open({ id: PANE, title: 'Switchboard' })
    return { text: asText(await read($, board)) }
  })

  // Hidden mods: their rows above the prompt, cells beside it and backdrops go.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    const { hidden } = await read($, board)
    if (hidden.length === 0) return next(e)
    return next({ ...e, props: { ...e.props, rows: e.props.rows.filter(r => !hidden.includes(r.plugin)) } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'BesidePromptList' }, async ($, e, next) => {
    const { hidden } = await read($, board)
    if (hidden.length === 0) return next(e)
    return next({ ...e, props: { ...e.props, plugins: e.props.plugins.filter(p => !hidden.includes(p)) } })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UnderlayList' }, async ($, e, next) => {
    const { hidden } = await read($, board)
    if (hidden.length === 0) return next(e)
    return next({ ...e, props: { ...e.props, plugins: e.props.plugins.filter(p => !hidden.includes(p)) } })
  }).catch(($, e, next) => next(e))

  // ...and their panels stay shut.
  on('ui.open', async ($, e, next) => {
    const { hidden } = await read($, board)
    const who = next.origin.plugin
    if (who !== SELF && hidden.includes(who)) {
      return { value: { isPlaced: false as const, reason: `${who}'s panel is hidden in Switchboard (/mods show ${who})` } }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = await read($, board)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {b.mods.length} {b.mods.length === 1 ? 'mod' : 'mods'}
        </Text>
        {b.mods.length === 0 && <Text dimColor>No mods found yet. New ones show up here by themselves.</Text>}
        {b.mods.map(m => {
          const status = statusOf(m, b.hidden)
          const isHidden = b.hidden.includes(m.name)
          const isSelf = m.name === SELF
          const isBusy = b.busy === m.key
          return (
            <Box key={m.key} flexDirection="column" borderStyle="round" borderColor={m.isEnabled ? 'border-strong' : 'border'} paddingX={1}>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text bold wrap="truncate-end">
                  {m.name} {m.version !== '' && <Text dimColor>v{m.version}</Text>}
                </Text>
                <Text color={status.color}>{isBusy ? 'Switching…' : status.text}</Text>
              </Box>
              {m.description !== '' && (
                <Text dimColor maxLines={2}>
                  {m.description}
                </Text>
              )}
              <Box flexDirection="row" gap={1}>
                {!isSelf && m.scope !== 'dev' && (
                  <Button key="power" label={m.isEnabled ? 'Turn off' : 'Turn on'} onPress={() => act($, m, m.isEnabled ? 'off' : 'on')} />
                )}
                {!isSelf && <Button key="hide" label={isHidden ? 'Show panel' : 'Hide panel'} onPress={() => act($, m, isHidden ? 'show' : 'hide')} />}
                {isSelf && <Text dimColor>Always on, so /mods keeps working</Text>}
                {m.scope === 'dev' && !isSelf && <Text dimColor>Loaded from a folder</Text>}
              </Box>
            </Box>
          )
        })}
        {b.note !== '' && <Text dimColor>{b.note}</Text>}
      </Box>
    )
  })
}
