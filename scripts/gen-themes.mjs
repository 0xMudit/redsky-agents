import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

/**
 * Regenerates `renderer/src/themes.css` from the live tweakcn theme registry.
 * Run `node scripts/gen-themes.mjs` after adding/removing a base theme (keep
 * BASE_THEMES in renderer/src/ui.tsx and the inline list in renderer/index.html
 * in sync with THEMES here).
 *
 * Each base theme is a full shadcn surface token set (light + dark) plus radius
 * and type. It deliberately does NOT set the brand accent: `data-base` owns
 * surfaces/type/rounding and `data-theme` owns colour, so the two are
 * independent axes. Supabase is the default base.
 */

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer/src/themes.css')

const THEMES = [
  ['supabase', 'Supabase'],
  ['notebook', 'Notebook'],
  ['mono', 'Mono'],
  ['sage-garden', 'Sage Garden'],
  ['catppuccin', 'Catppuccin'],
  ['amber-minimal', 'Amber Minimal'],
  ['claude', 'Claude'],
  ['t3-chat', 'T3 Chat'],
]

const SURFACE = [
  ['background', 'background'],
  ['foreground', 'foreground'],
  ['card', 'card'],
  ['card-foreground', 'card-foreground'],
  ['popover', 'popover'],
  ['popover-foreground', 'popover-foreground'],
  ['secondary', 'secondary'],
  ['secondary-foreground', 'secondary-foreground'],
  ['muted', 'muted'],
  ['muted-foreground', 'muted-foreground'],
  // shadcn's subtle-hover "accent" is bridged to --sh-accent in style.css so it
  // never collides with the app's brand --accent token.
  ['sh-accent', 'accent'],
  ['sh-accent-foreground', 'accent-foreground'],
  ['destructive', 'destructive'],
  ['destructive-foreground', 'destructive-foreground'],
  ['border', 'border'],
  ['input', 'input'],
  ['chart-1', 'chart-1'],
  ['chart-2', 'chart-2'],
  ['chart-3', 'chart-3'],
  ['chart-4', 'chart-4'],
  ['chart-5', 'chart-5'],
  ['sidebar', 'sidebar'],
  ['sidebar-foreground', 'sidebar-foreground'],
  ['sidebar-accent', 'sidebar-accent'],
  ['sidebar-accent-foreground', 'sidebar-accent-foreground'],
  ['sidebar-border', 'sidebar-border'],
  ['sidebar-ring', 'sidebar-ring'],
]

const FALLBACK_SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`
const FALLBACK_MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

const get = async (name) => {
  const res = await fetch(`https://tweakcn.com/r/themes/${name}.json`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json()
}

const pick = (js, key, mode) =>
  js.cssVars?.[mode]?.[key] ?? js.cssVars?.light?.[key] ?? js.cssVars?.dark?.[key] ?? js.cssVars?.theme?.[key]

const surfaceBlock = (js, mode) =>
  SURFACE.map(([cssName, jsonKey]) => {
    const v = pick(js, jsonKey, mode)
    return v ? `  --${cssName}: ${v};` : null
  })
    .filter(Boolean)
    .join('\n')

const themeFont = (js, key) => js.cssVars?.theme?.[key] ?? js.cssVars?.light?.[key] ?? js.cssVars?.dark?.[key]
const sansFamily = (js) => {
  const f = themeFont(js, 'font-sans')
  return f ? `${f}, ${FALLBACK_SANS}` : FALLBACK_SANS
}
const monoFamily = (js) => {
  const f = themeFont(js, 'font-mono')
  return f && f !== 'monospace' ? `${f}, ${FALLBACK_MONO}` : FALLBACK_MONO
}

let out = `/* ── Base themes (tweakcn) — generated, do not edit by hand ───────────────
   Each base theme sets the full shadcn surface token set plus radius and type.
   Regenerate with \`node scripts/gen-themes.mjs\`. Default base = Supabase. */

`

for (const [name, label] of THEMES) {
  const js = await get(name)
  const radius = pick(js, 'radius', 'light') ?? pick(js, 'radius', 'theme') ?? '0.625rem'

  out += `/* ${label} — light */\n`
  out += `:root[data-base="${name}"] {\n`
  out += surfaceBlock(js, 'light')
  out += `\n  --radius: ${radius};\n`
  out += `  --font: ${sansFamily(js)};\n`
  out += `  --mono: ${monoFamily(js)};\n`
  out += `}\n\n`

  out += `/* ${label} — dark */\n`
  out += `:root[data-base="${name}"][data-mode="dark"] {\n`
  out += surfaceBlock(js, 'dark')
  out += `\n}\n\n`
}

writeFileSync(OUT, out)
console.log(`wrote ${OUT} (${out.length} bytes)`)
console.log(`themes: ${THEMES.map((t) => t[0]).join(', ')}`)
