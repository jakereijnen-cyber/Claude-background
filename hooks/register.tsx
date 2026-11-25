import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, ThemeSetArgs } from 'claude-code'

import type { Gauges } from '../types'
import { makeColors } from './make-colors.js'

const SCENE = 'winter-hearth'

const gauges = atom({ plugin: 'winter-hearth', key: 'gauges' } as const, {
  usageLeft: null,
  usageWindow: null,
  resetsAt: null,
  memory: null,
  agents: 0,
  isTurnRunning: false,
  othersWorking: 0,
  minute: 0,
}, { shape: 'gauges-3' })

// Night sky blues, warmed by the fire.
const { theme, problems } = makeColors({
  label: 'Winter hearth',
  only: 'dark',
  roles: { accent: '#e0a458', danger: '#e0675a', success: '#7fb58a', warning: '#e8b04a', pro: '#9d8fd9' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#10152c',
        'surface-1': '#161c38',
        'surface-2': '#1b2241',
        'surface-3': '#1f2647',
        'text-primary': '#eef0f8',
        'text-secondary': '#c3c9de',
        'text-muted': '#9ea6c0',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE, glass: { blur: 8, tint: '#10152c', opacity: 0.4 } },
}

// ---------- numbers ----------

const WORKING = new Set(['pending', 'running', 'waiting'])

function tightest(limits: readonly SessionRateLimit[]): SessionRateLimit | undefined {
  return [...limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
}

function windowName(kind: string | null): string {
  if (kind === 'five_hour') return '5h window'
  if (kind === 'seven_day') return 'weekly'
  if (kind === 'spend_limit') return 'spend limit'
  return ''
}

function resetText(resetsAt: string | null, now: number): string {
  if (resetsAt === null) return ''
  const mins = Math.round((Date.parse(resetsAt) - now) / 60000)
  if (!Number.isFinite(mins) || mins <= 0) return ''
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `resets in ${d}d ${h}h`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// ---------- scene ----------
//
// One horizon for the whole picture. Each side is its own column, 360 by 1000
// units, pinned to its edge; the ground sits at y 720 in both, so the fire and
// the cabin stand on the same snow. The fresh snow in front (the memory gauge)
// piles up from y 960 to y 840 and never reaches either of them.

const GROUND = 720
const DRIFT_EMPTY = 960
const DRIFT_FULL = 840

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const rnd = seeded(7)
const FLAKES = Array.from({ length: 46 }, (_, i) => ({
  x: Math.round(rnd() * 1600),
  y: Math.round(rnd() * 1000),
  r: (1.2 + rnd() * 2.2).toFixed(1),
  o: (0.45 + rnd() * 0.45).toFixed(2),
  dur: Math.round(24 + rnd() * 20),
  delay: -Math.round(rnd() * 40),
  kind: i % 2,
}))
const STARS = Array.from({ length: 34 }, (_, i) => ({
  x: Math.round(rnd() * 1600),
  y: Math.round(rnd() * 480),
  r: (0.6 + rnd() * 1.1).toFixed(1),
  twinkle: i % 4 === 0,
  delay: -Math.round(rnd() * 8),
}))

function flame(w: number, h: number): string {
  const f = (n: number) => n.toFixed(1)
  return `M0 ${f(-h)} C ${f(w * 0.35)} ${f(-h * 0.6)} ${f(w)} ${f(-h * 0.35)} ${f(w * 0.8)} ${f(-h * 0.08)} C ${f(w * 0.6)} ${f(h * 0.06)} ${f(-w * 0.6)} ${f(h * 0.06)} ${f(-w * 0.8)} ${f(-h * 0.08)} C ${f(-w)} ${f(-h * 0.35)} ${f(-w * 0.35)} ${f(-h * 0.6)} 0 ${f(-h)} Z`
}

// A pine standing on the ground line, with snow on its tiers.
function pine(x: number, h: number, shade = '#1d2b47'): string {
  const base = GROUND + 4
  const w = h * 0.38
  const tier = (top: number, bottom: number, half: number) =>
    `<polygon points="${x},${top} ${x - half},${bottom} ${x + half},${bottom}" fill="${shade}"/>
     <polygon points="${x},${top} ${x - half * 0.32},${top + (bottom - top) * 0.32} ${x + half * 0.32},${top + (bottom - top) * 0.32}" fill="#dfe6f6" opacity="0.8"/>`
  return `<g>
    <rect x="${x - 5}" y="${base - 18}" width="10" height="20" fill="#1a1410"/>
    ${tier(base - h * 0.55, base - 12, w)}
    ${tier(base - h * 0.8, base - h * 0.38, w * 0.78)}
    ${tier(base - h, base - h * 0.62, w * 0.55)}
  </g>`
}

// Ground and fresh snow for one column, wide enough to fill its half of the screen.
function groundAndDrift(snowY: number, mirror: boolean): { ground: string; drift: string } {
  const bump = (x: number) => (mirror ? 360 - x : x)
  return {
    ground: `<path d="M-1400 ${GROUND} L1800 ${GROUND} L1800 3000 L-1400 3000 Z" fill="url(#ground)"/>
      <ellipse cx="${bump(180)}" cy="${GROUND + 2}" rx="230" ry="14" fill="#e9eef9"/>`,
    drift: `<path d="M-1400 3000 L-1400 ${snowY} L${bump(-40)} ${snowY} C ${bump(60)} ${snowY - 14} ${bump(170)} ${snowY + 10} ${bump(260)} ${snowY - 4} S ${bump(340)} ${snowY - 6} ${bump(420)} ${snowY} L1800 ${snowY} L1800 3000 Z" fill="url(#drift)"/>`,
  }
}

function scene(g: Gauges, now: number): string {
  const left = g.usageLeft
  const fire = left === null ? 0.8 : 0.3 + 0.7 * clamp(left, 0, 100) / 100
  const fireLabel = left === null ? '--' : `${Math.round(left)}%`
  const sub = left === null ? 'usage left' : `usage left${g.usageWindow ? ' · ' + windowName(g.usageWindow) : ''}`
  const reset = resetText(g.resetsAt, now)

  const memory = clamp(g.memory ?? 0, 0, 100)
  const snowY = DRIFT_EMPTY - (memory / 100) * (DRIFT_EMPTY - DRIFT_FULL)
  const memLabel = g.memory === null ? '--' : `${Math.round(g.memory)}%`

  const isSnowing = g.isTurnRunning || g.agents > 0 || g.othersWorking > 0
  const lit = clamp(g.agents, 0, 4)
  const agentText = g.agents === 0 ? 'no agents' : g.agents === 1 ? '1 agent' : `${g.agents} agents`

  const fx = 196
  const fy = GROUND - 6
  const fh = 110 * fire
  const fw = 42 * fire

  const L = groundAndDrift(snowY, false)
  const R = groundAndDrift(snowY, true)

  // The cabin, drawn with its floor at y 0, and four windows lit one by one.
  const windows = [
    { x: 22, y: -74, w: 34, h: 36 },
    { x: 114, y: -74, w: 34, h: 36 },
    { x: 70, y: -162, w: 30, h: 30 },
    { x: 75, y: -40, w: 20, h: 16 },
  ]
  const stakeX = 30
  const ticks = [0, 25, 50, 75, 100]
    .map(p => {
      const y = DRIFT_EMPTY - (p / 100) * (DRIFT_EMPTY - DRIFT_FULL)
      return `<line x1="${stakeX - 7}" x2="${stakeX + 7}" y1="${y}" y2="${y}" stroke="#3e2615" stroke-width="2"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<style>
  .flake { animation: fall0 30s linear infinite; }
  .k1 { animation-name: fall1; }
  @keyframes fall0 { from { transform: translate(0px, -1060px); } to { transform: translate(40px, 0px); } }
  @keyframes fall1 { from { transform: translate(0px, -1060px); } to { transform: translate(-36px, 0px); } }
  .tw { animation: twinkle 8s ease-in-out infinite; }
  @keyframes twinkle { 0%, 100% { opacity: 0.9; } 50% { opacity: 0.35; } }
  .flame { transform-box: fill-box; transform-origin: 50% 100%; animation: sway 3.4s ease-in-out infinite; }
  .f2 { animation-duration: 2.8s; animation-delay: -1.1s; }
  .f3 { animation-duration: 2.3s; animation-delay: -0.6s; }
  @keyframes sway { 0%, 100% { transform: scale(1, 1) skewX(0deg); } 35% { transform: scale(0.97, 1.05) skewX(2deg); } 70% { transform: scale(1.02, 0.96) skewX(-2deg); } }
  .glow { animation: breathe 6s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.78; } }
  .smoke { animation: rise 12s linear infinite; opacity: 0; }
  .s2 { animation-delay: -4s; }
  .s3 { animation-delay: -8s; }
  @keyframes rise { 0% { transform: translate(0px, 0px); opacity: 0; } 15% { opacity: 0.35; } 100% { transform: translate(-40px, -170px); opacity: 0; } }
</style>
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0b1028"/>
    <stop offset="0.6" stop-color="#1a2150"/>
    <stop offset="1" stop-color="#2b3263"/>
  </linearGradient>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9aa6cc"/>
    <stop offset="0.12" stop-color="#6c78a6"/>
    <stop offset="0.3" stop-color="#4b5683"/>
  </linearGradient>
  <linearGradient id="drift" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d6ddef"/>
    <stop offset="0.1" stop-color="#a3aed2"/>
    <stop offset="0.3" stop-color="#7d89b4"/>
  </linearGradient>
  <radialGradient id="fireglow">
    <stop offset="0" stop-color="#f6a54a" stop-opacity="0.55"/>
    <stop offset="0.5" stop-color="#d9733a" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#d9733a" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="moonglow">
    <stop offset="0" stop-color="#f1ead2" stop-opacity="0.28"/>
    <stop offset="1" stop-color="#f1ead2" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="winglow">
    <stop offset="0" stop-color="#ffcf7a" stop-opacity="0.45"/>
    <stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/>
  </radialGradient>
</defs>

<!-- sky and stars -->
<svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <rect x="-2000" y="-2000" width="5600" height="5000" fill="url(#sky)"/>
  ${STARS.map(s => `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="#e8ecff" opacity="0.8"${s.twinkle ? ` class="tw" style="animation-delay:${s.delay}s"` : ''}/>`).join('')}
</svg>

<!-- far hills, stretched to the width so they meet the ground on any screen -->
<svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none">
  <path d="M0 1000 L0 610 L130 570 L260 600 L400 545 L540 615 L660 570 L790 625 L900 560 L1000 600 L1000 1000 Z" fill="#232b57" opacity="0.85"/>
  <path d="M0 1000 L0 660 L160 635 L330 670 L500 645 L680 680 L850 645 L1000 670 L1000 1000 Z" fill="#1c2349"/>
</svg>

<!-- left: the campfire, its sign in the snow in front of it.
     The backdrop runs under the sidebar too, so the viewBox starts 230 units
     left of the art to keep the fire clear of the window edge. -->
<svg width="50%" height="100%" viewBox="-230 0 590 1000" preserveAspectRatio="xMinYMax meet">
  ${L.ground}
  ${pine(52, 230)}
  ${pine(330, 170, '#1a2742')}
  <circle class="glow" cx="${fx}" cy="${fy - fh * 0.3}" r="${(140 * fire + 50).toFixed(0)}" fill="url(#fireglow)"/>
  <ellipse cx="${fx}" cy="${GROUND + 6}" rx="${(90 * fire + 30).toFixed(0)}" ry="10" fill="#f4b06a" opacity="0.18"/>
  <g transform="translate(${fx} ${fy})">
    <g class="flame"><path d="${flame(fw, fh)}" fill="#e2673a"/></g>
    <g class="flame f2"><path d="${flame(fw * 0.7, fh * 0.75)}" fill="#f39a3e"/></g>
    <g class="flame f3"><path d="${flame(fw * 0.42, fh * 0.48)}" fill="#ffd98a"/></g>
    <rect x="-48" y="-4" width="96" height="13" rx="6" fill="#4a2e1c" transform="rotate(-11)"/>
    <rect x="-48" y="-4" width="96" height="13" rx="6" fill="#5a3822" transform="rotate(11)"/>
    <ellipse cx="-56" cy="10" rx="15" ry="8" fill="#3b4466"/>
    <ellipse cx="-27" cy="14" rx="15" ry="8" fill="#46507a"/>
    <ellipse cx="4" cy="15" rx="15" ry="8" fill="#3b4466"/>
    <ellipse cx="34" cy="14" rx="15" ry="8" fill="#46507a"/>
    <ellipse cx="60" cy="10" rx="14" ry="8" fill="#3b4466"/>
  </g>
  <rect x="146" y="742" width="6" height="110" fill="#3e2615"/>
  <rect x="240" y="742" width="6" height="110" fill="#3e2615"/>
  <rect x="118" y="738" width="156" height="${reset ? 92 : 74}" rx="8" fill="#5b3a24" stroke="#3e2615" stroke-width="2"/>
  <text x="196" y="776" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#f6e7cc">${fireLabel}</text>
  <text x="196" y="798" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#e6d3b0">${sub}</text>
  ${reset ? `<text x="196" y="818" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#d8c29c">${reset}</text>` : ''}
  ${L.drift}
</svg>

<!-- right: the moon, the cabin, the snow stake -->
<svg x="50%" width="50%" height="100%" viewBox="0 0 360 1000" preserveAspectRatio="xMaxYMax meet">
  <circle cx="250" cy="130" r="110" fill="url(#moonglow)"/>
  <circle cx="250" cy="130" r="44" fill="#f1ead2"/>
  <circle cx="236" cy="118" r="7" fill="#ddd4b8" opacity="0.6"/>
  <circle cx="262" cy="146" r="5" fill="#ddd4b8" opacity="0.5"/>
  ${R.ground}
  ${pine(326, 200, '#1a2742')}
  <g transform="translate(120 ${GROUND})">
    ${g.agents > 0 ? `<g fill="#c9cfe6">
      <circle class="smoke" cx="146" cy="-188" r="9"/>
      <circle class="smoke s2" cx="146" cy="-188" r="11"/>
      <circle class="smoke s3" cx="146" cy="-188" r="8"/>
    </g>` : ''}
    <rect x="135" y="-188" width="22" height="60" fill="#3a2a22"/>
    <rect x="131" y="-194" width="30" height="8" fill="#dfe6f6"/>
    <rect x="0" y="-100" width="170" height="100" fill="#5e3923"/>
    <g stroke="#4a2c1a" stroke-width="2" opacity="0.7">
      <line x1="0" x2="170" y1="-80" y2="-80"/><line x1="0" x2="170" y1="-60" y2="-60"/>
      <line x1="0" x2="170" y1="-40" y2="-40"/><line x1="0" x2="170" y1="-20" y2="-20"/>
    </g>
    <polygon points="-23,-90 85,-215 193,-90" fill="#3a2418"/>
    <polygon points="-23,-90 85,-215 193,-90 177,-90 85,-196 -7,-90" fill="#e6ecf8"/>
    <polygon points="55,-160 85,-192 115,-160 115,-120 55,-120" fill="#4a2e1d"/>
    ${windows.map((w, i) => {
      const on = i < lit
      return `${on ? `<circle cx="${w.x + w.w / 2}" cy="${w.y + w.h / 2}" r="${w.w * 1.3}" fill="url(#winglow)"/>` : ''}
      <rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="2" fill="${on ? '#ffcf7a' : '#232a4a'}" stroke="#2e1c12" stroke-width="3"/>
      <line x1="${w.x + w.w / 2}" x2="${w.x + w.w / 2}" y1="${w.y}" y2="${w.y + w.h}" stroke="#2e1c12" stroke-width="2"/>`
    }).join('')}
    <rect x="71" y="-22" width="28" height="22" fill="#3a2418"/>
    <rect x="-6" y="-2" width="182" height="6" rx="3" fill="#e9eef9"/>
  </g>
  <rect x="148" y="738" width="6" height="110" fill="#3e2615"/>
  <rect x="242" y="738" width="6" height="110" fill="#3e2615"/>
  <rect x="124" y="734" width="148" height="40" rx="7" fill="#5b3a24" stroke="#3e2615" stroke-width="2"/>
  <text x="198" y="760" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="700" fill="#f6e7cc">${agentText}</text>
  <rect x="${stakeX - 2}" y="${DRIFT_FULL - 40}" width="4" height="260" fill="#b58e5e"/>
  ${ticks}
  ${R.drift}
  <rect x="${stakeX + 12}" y="${snowY - 44}" width="78" height="34" rx="6" fill="#5b3a24" stroke="#3e2615" stroke-width="2"/>
  <line x1="${stakeX + 2}" x2="${stakeX + 12}" y1="${snowY - 27}" y2="${snowY - 27}" stroke="#3e2615" stroke-width="2"/>
  <text x="${stakeX + 51}" y="${snowY - 29}" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="700" fill="#f6e7cc">${memLabel}</text>
  <text x="${stakeX + 51}" y="${snowY - 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#e6d3b0">memory</text>
</svg>

${isSnowing ? `<!-- snowfall, only while Claude works here, in another chat, or an agent runs -->
<svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  ${FLAKES.map(f => `<circle class="flake${f.kind ? ' k1' : ''}" style="animation-duration:${f.dur}s;animation-delay:${f.delay}s" cx="${f.x}" cy="${f.y}" r="${f.r}" fill="#f4f7ff" opacity="${f.o}"/>`).join('')}
</svg>` : ''}
</svg>`
}

// ---------- hooks ----------

let isDrawn = false

// Terminal and editors draw no backdrop, so they get the same numbers as a status line.
async function status($: EngineInterface) {
  if (isDrawn) return
  const g = await read($, gauges)
  const fire = g.usageLeft === null ? '--' : `${Math.round(g.usageLeft)}%`
  const mem = g.memory === null ? '--' : `${Math.round(g.memory)}%`
  $.ui.status(`fire ${fire} left · snow ${mem} memory · ${g.agents} agents`)
}

async function countAgents($: EngineInterface): Promise<number> {
  return (await $.agent.list()).filter(a => WORKING.has(a.status)).length
}

// Other chats: every session running this mod on the same computer shares
// $.store, a file in the Claude Code config folder. A working session writes
// a heartbeat under its own key; one that stops writing for 20 seconds (a
// closed window, a crash) no longer counts.
const BUSY = 'busy:'
const FRESH_MS = 20_000
let mySessionId = ''

async function heartbeat($: EngineInterface, isWorking: boolean) {
  if (mySessionId === '') return
  if (isWorking) await $.store.set(BUSY + mySessionId, await $.clock.now())
  else await $.store.delete(BUSY + mySessionId)
}

async function countOthers($: EngineInterface): Promise<number> {
  const now = await $.clock.now()
  let count = 0
  for (const key of await $.store.keys()) {
    if (!key.startsWith(BUSY) || key === BUSY + mySessionId) continue
    const at = Number(await $.store.get(key))
    if (now - at < FRESH_MS) count += 1
    else if (now - at > 3_600_000) await $.store.delete(key)
  }
  return count
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.log(unpainted)

    const set = await $.theme.set(LOOK)
    isDrawn = set.isDrawn
    mySessionId = await $.session.id()

    const usage = await $.session.usage()
    const top = tightest(usage.rateLimits)
    const agents = await countAgents($)
    const now = await $.clock.now()
    await update($, gauges, g => ({
      ...g,
      usageLeft: top ? clamp(100 - top.percentUsed, 0, 100) : null,
      usageWindow: top?.kind ?? null,
      resetsAt: top?.resetsAt ?? null,
      memory: usage.context.percent ?? null,
      agents,
      isTurnRunning: false,
      othersWorking: 0,
      minute: Math.floor(now / 60000),
    }))
    await status($)

    // Every 5 seconds: count working agents here and busy chats elsewhere,
    // renew this chat's heartbeat, and move the reset clock once a minute.
    $.clock.every(5000, () => {
      void (async () => {
        const count = await countAgents($)
        const others = await countOthers($)
        const minute = Math.floor((await $.clock.now()) / 60000)
        const g = await read($, gauges)
        await heartbeat($, g.isTurnRunning || count > 0)
        if (g.agents !== count || g.othersWorking !== others || g.minute !== minute) {
          await update($, gauges, old => ({ ...old, agents: count, othersWorking: others, minute }))
          await status($)
        }
      })()
    })

    return next(e)
  })

  // The snow falls while the main turn runs.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, gauges, g => (g.isTurnRunning ? g : { ...g, isTurnRunning: true }))
      await heartbeat($, true)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const agents = await countAgents($)
      await update($, gauges, g => ({ ...g, isTurnRunning: false, agents }))
      await heartbeat($, agents > 0)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await heartbeat($, false)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const top = tightest(e.rateLimits)
    await update($, gauges, g => ({
      ...g,
      usageLeft: top ? clamp(100 - top.percentUsed, 0, 100) : g.usageLeft,
      usageWindow: top?.kind ?? g.usageWindow,
      resetsAt: top?.resetsAt ?? g.resetsAt,
      memory: e.context.percent ?? g.memory,
    }))
    await status($)
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const g = await read($, gauges)
    const now = g.minute * 60000 || (await $.clock.now())
    const alt = `A winter night. Campfire: ${g.usageLeft === null ? 'no reading' : Math.round(g.usageLeft) + '%'} usage left. Snow: ${g.memory === null ? 'no reading' : Math.round(g.memory) + '%'} memory. ${g.agents} agents working.`

    return <Svg source={scene(g, now)} alt={alt} isInteractive />
  })
}
