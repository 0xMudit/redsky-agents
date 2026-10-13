import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { dateLabel, renderMarkdown, timeLabel } from './format'
import type {
  AppSettings,
  Bot,
  ChatMessage,
  ComputerEvent,
  Connector,
  FileNode,
  HistoryTurn,
  JobTemplate,
  MemoryRow,
  ReviewMode,
  Room,
  Routine,
} from './types'

/* ── Themes ────────────────────────────────────────────────── */

export type ThemeName = 'coral' | 'aurora' | 'emerald' | 'amber' | 'rose' | 'ice' | 'mainline'

export const THEMES: { name: ThemeName; label: string; swatch: string }[] = [
  { name: 'mainline', label: 'Mainline', swatch: '#6f7885' },
  { name: 'coral', label: 'Coral', swatch: '#f4513f' },
  { name: 'aurora', label: 'Aurora', swatch: '#7c6aff' },
  { name: 'emerald', label: 'Emerald', swatch: '#2fbf8f' },
  { name: 'amber', label: 'Amber', swatch: '#f59e2c' },
  { name: 'rose', label: 'Rose', swatch: '#ff5c8a' },
  { name: 'ice', label: 'Ice', swatch: '#35c7e0' },
]

const THEME_KEY = 'redsky.theme'

export function getStoredTheme(): ThemeName {
  try {
    const raw = localStorage.getItem(THEME_KEY) as ThemeName | null
    if (raw && THEMES.some((t) => t.name === raw)) return raw
  } catch {
    /* ignore */
  }
  return 'coral'
}

export function applyTheme(name: ThemeName): void {
  try {
    if (name === 'coral') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = name
    localStorage.setItem(THEME_KEY, name)
  } catch {
    /* ignore */
  }
}

/* ── Light / dark mode. `data-mode` lives on <html>. ───────── */

export type Mode = 'dark' | 'light'

const MODE_KEY = 'redsky.mode'

export function getStoredMode(): Mode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    if (raw === 'dark' || raw === 'light') return raw
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function applyMode(mode: Mode): void {
  try {
    document.documentElement.dataset.mode = mode
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function ModeIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

export function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function ChevronUpIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

/* ── Brand ─────────────────────────────────────────────────── */

export function Logo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <span className="flex items-center gap-2 select-none">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo-glow">
        <circle cx="16" cy="16" r="15" fill="var(--accent-soft)" />
        <path d="M16 6.5a9.5 9.5 0 0 1 0 19Z" fill="var(--accent)" />
        <path d="M16 6.5a9.5 9.5 0 0 0 0 19Z" fill="#ff8a76" />
        <rect x="4" y="21.4" width="24" height="1.6" rx="0.8" fill="#0b0d0f" />
      </svg>
      <span className="text-[14px] font-semibold tracking-tight logo-word">Red Sky</span>
    </span>
  )
}

export function BlobAvatar({ hue, size = 32 }: { hue: string; size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0 overflow-visible" aria-hidden>
      <path fill={hue} d="M27.4 16.2c0 7.1-5.2 12.4-11.4 12.4S4.6 23.3 4.6 16.2 9.8 3.8 16 3.8s11.4 5.3 11.4 12.4Z" />
      <ellipse cx="12.3" cy="15.2" rx="2.15" ry="2.5" fill="#141719" />
      <ellipse cx="20.2" cy="15.2" rx="2.15" ry="2.5" fill="#141719" />
      <circle cx="12.9" cy="14.3" r="0.7" fill="#fff" />
      <circle cx="20.8" cy="14.3" r="0.7" fill="#fff" />
    </svg>
  )
}

export function StatusDot({ status }: { status: Bot['status'] | 'online' | 'starting' | 'offline' }): React.JSX.Element {
  const color =
    status === 'running' || status === 'online'
      ? 'var(--text-success)'
      : status === 'waiting' || status === 'starting'
        ? 'var(--text-warning)'
        : status === 'error' || status === 'offline'
          ? 'var(--text-danger)'
          : 'var(--text-tertiary)'
  const live = status === 'running' || status === 'online' || status === 'waiting' || status === 'starting'
  return (
    <span className="relative inline-flex w-[7px] h-[7px] shrink-0">
      <span className="w-full h-full rounded-full" style={{ background: color }} />
      {live ? <span className="absolute inset-0 rounded-full status-halo" style={{ background: color }} /> : null}
    </span>
  )
}

/* ── Primitives ────────────────────────────────────────────── */

export function IconBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-hover)] pressable"
      style={{
        background: active ? 'var(--bg-active)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  )
}

export function NavItem({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: number
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      data-active={active}
      className="nav-item w-full text-left rounded-[10px] px-2.5 py-2 flex items-center gap-2.5 hover:bg-[var(--sidebar-hover)] pressable"
      style={{ background: active ? 'var(--sidebar-selected)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--sidebar-muted)' }}
    >
      <span className="shrink-0 flex items-center justify-center w-4" style={{ color: active ? 'var(--accent)' : 'inherit' }}>
        {icon}
      </span>
      <span className="text-[13px] font-medium flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className="text-[10px] min-w-[16px] h-[16px] px-1 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  )
}

export function PanelHeader({
  title,
  subtitle,
  action,
  onClose,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  onClose?: () => void
}): React.JSX.Element {
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-2 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold truncate">{title}</h2>
        {subtitle ? (
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action}
        {onClose ? (
          <button onClick={onClose} title="Collapse panel" className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
            <PanelIcon />
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ── Command palette ───────────────────────────────────────── */

export interface Command {
  id: string
  group: string
  label: string
  hint?: string
  keywords?: string
  icon?: React.ReactNode
  run: () => void
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean
  onClose: () => void
  commands: Command[]
}): React.JSX.Element | null {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return commands
    return commands.filter((c) => `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(query))
  }, [commands, q])

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [q])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open, filtered])

  if (!open) return null

  const grouped = filtered.reduce<Record<string, Command[]>>((acc, c) => {
    ;(acc[c.group] ??= []).push(c)
    return acc
  }, {})

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[active]?.run()
      onClose()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let idx = -1
  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmdk-input-row">
          <span style={{ color: 'var(--text-accent)' }}>
            <CommandIcon />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search agents, panels, actions…"
            className="cmdk-input"
          />
          <span className="cmdk-kbd">esc</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="cmdk-group-label">{group}</div>
              {items.map((c) => {
                idx += 1
                const i = idx
                return (
                  <button
                    key={c.id}
                    data-active={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => {
                      c.run()
                      onClose()
                    }}
                    className="cmdk-item"
                  >
                    <span className="cmdk-ic">{c.icon ?? <SparkIcon />}</span>
                    <span className="cmdk-label">{c.label}</span>
                    {c.hint ? <span className="cmdk-hint">{c.hint}</span> : null}
                  </button>
                )
              })}
            </div>
          ))}
          {!filtered.length && <div className="cmdk-empty">No matches for “{q}”.</div>}
        </div>
        <div className="cmdk-foot">
          <span>
            <span className="cmdk-kbd">↑</span>
            <span className="cmdk-kbd">↓</span>navigate
          </span>
          <span>
            <span className="cmdk-kbd">↵</span>select
          </span>
          <span>
            <span className="cmdk-kbd">esc</span>close
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Conversation ──────────────────────────────────────────── */
export function MessageBlock({
  role,
  text,
  hue,
  name,
  kind,
  editing,
  draft,
  streaming,
  onDraft,
  onSave,
  onCancel,
  onCopy,
  onEdit,
  onDelete,
  onResend,
  onBranch,
}: {
  role: ChatMessage['role']
  text: string
  hue: string
  name: string
  kind?: ChatMessage['kind']
  editing?: boolean
  draft?: string
  streaming?: boolean
  onDraft?: (v: string) => void
  onSave?: () => void
  onCancel?: () => void
  onCopy?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onResend?: () => void
  onBranch?: () => void
}): React.JSX.Element {
  const html = useMemo(() => renderMarkdown(text), [text])
  const onMarkdownClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const btn = (e.target as HTMLElement).closest('.code-copy') as HTMLElement | null
    if (!btn) return
    const code = btn.closest('.code-wrap')?.querySelector('code')
    if (!code) return
    void navigator.clipboard.writeText(code.textContent ?? '')
    const prev = btn.textContent
    btn.textContent = 'Copied'
    btn.classList.add('copied')
    window.setTimeout(() => {
      btn.textContent = prev
      btn.classList.remove('copied')
    }, 1200)
  }
  const actions = (
    <div className="msg-actions flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {onCopy && (
        <button onClick={onCopy} className="text-[10px] px-1.5 py-0.5 rounded-md hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
          Copy
        </button>
      )}
      {onEdit && (
        <button onClick={onEdit} className="text-[10px] px-1.5 py-0.5 rounded-md hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-tertiary)' }}>
          Edit
        </button>
      )}
      {onResend && (
        <button onClick={onResend} className="text-[10px] px-1.5 py-0.5 rounded-md hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-accent)' }}>
          Replay
        </button>
      )}
      {onBranch && (
        <button onClick={onBranch} className="text-[10px] px-1.5 py-0.5 rounded-md hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-accent)' }}>
          Branch
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} className="text-[10px] px-1.5 py-0.5 rounded-md hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-danger)' }}>
          Delete
        </button>
      )}
    </div>
  )
  if (editing) {
    return (
      <div className={`flex ${role === 'user' ? 'justify-end' : 'gap-2.5 items-start'}`}>
        {role !== 'user' && <BlobAvatar hue={hue} size={28} />}
        <div className="max-w-[82%] w-full">
          <textarea
            value={draft ?? text}
            onChange={(e) => onDraft?.(e.target.value)}
            className="w-full rounded-2xl px-3.5 py-2.5 text-[14px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 resize-y min-h-[72px]"
            style={{ background: 'var(--raised)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <div className="flex gap-2 mt-1.5">
            <button onClick={onSave} className="text-[12px] rounded-full px-3 py-1" style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}>
              Save
            </button>
            <button onClick={onCancel} className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'reminder') {
    return (
      <div className="flex justify-center">
        <div
          className="rounded-full px-3.5 py-1.5 text-[13px] result-pop"
          style={{ background: 'color-mix(in srgb, var(--text-warning) 16%, var(--bubble-agent))', color: 'var(--text-primary)', border: '0.5px solid color-mix(in srgb, var(--text-warning) 35%, transparent)' }}
        >
          Reminder · {text}
        </div>
      </div>
    )
  }
  if (role === 'user') {
    return (
      <div className="group flex flex-col items-end message-in">
        <div
          className="rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-[22px] whitespace-pre-wrap max-w-[72%]"
          style={{ background: 'var(--bubble-user)', color: 'var(--bubble-user-ink)', fontWeight: 450 }}
        >
          {text}
        </div>
        {actions}
      </div>
    )
  }
  return (
    <div className="group flex gap-3 items-start message-in">
      <BlobAvatar hue={hue} size={30} />
      <div className="min-w-0 flex-1">
        <div
          className="markdown-body text-[14px] leading-[22px] max-w-[84%] rounded-2xl rounded-tl-md px-4 py-3 glass"
          title={name}
          onClick={onMarkdownClick}
          style={streaming ? { borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)', boxShadow: '0 0 24px -12px var(--accent-glow)' } : undefined}
        >
          <div dangerouslySetInnerHTML={{ __html: html }} />
          {streaming ? <span className="stream-caret" /> : null}
        </div>
        {actions}
      </div>
    </div>
  )
}

export function RunningDots({ hue, label }: { hue: string; label?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 motion-fade-up">
      <div className="flex gap-2.5 items-center">
        <BlobAvatar hue={hue} size={28} />
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1" style={{ color: 'var(--text-accent)' }}>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
          {label ? <span className="text-[12px] shimmer-text">{label}</span> : <span className="text-[12px] shimmer-text">Working…</span>}
        </div>
      </div>
      <div className="ml-[38px] w-56 max-w-[60%] progress-track">
        <i />
      </div>
    </div>
  )
}

/* ── Working window (life tip while an agent runs) ─────────── */

export function WorkingWindow({ hue, name }: { hue: string; name?: string }): React.JSX.Element {
  return (
    <div className="work-window motion-fade-up" style={{ '--work-tint': hue } as React.CSSProperties}>
      <span className="work-orbit" aria-hidden="true">
        <span className="work-ring" />
        <span className="work-ring work-ring-2" />
        <span className="work-core" />
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
          {name ? `${name} is working` : 'Working'}
        </div>
      </div>
    </div>
  )
}

/* ── Activity / results ────────────────────────────────────── */

function eventIcon(kind: ComputerEvent['kind']): React.JSX.Element {
  switch (kind) {
    case 'file':
      return <FileIcon />
    case 'shell':
      return <ShellIcon />
    case 'note':
      return <NoteIcon />
    case 'handoff':
      return <HandoffIcon />
    case 'review':
      return <CheckIcon />
    default:
      return <ToolIcon />
  }
}

function eventTint(kind: ComputerEvent['kind']): string {
  switch (kind) {
    case 'file':
      return '#8bd0ff'
    case 'shell':
      return 'var(--text-warning)'
    case 'review':
      return 'var(--text-success)'
    case 'handoff':
      return 'var(--text-accent)'
    default:
      return 'var(--text-accent)'
  }
}

export function ComputerEventCard({ ev }: { ev: ComputerEvent }): React.JSX.Element {
  const tint = eventTint(ev.kind)
  return (
    <div className="ev-row activity-in">
      <span className="ev-rail">
        <span className="ev-node" style={{ color: tint }}>
          {eventIcon(ev.kind)}
        </span>
      </span>
      <div
        className="min-w-0 flex-1 rounded-xl px-3 py-2 card-hover"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px] font-medium truncate">{ev.title}</span>
          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
            {timeLabel(ev.at)}
          </span>
        </div>
        {ev.detail ? (
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: ev.kind === 'shell' ? 'var(--mono)' : undefined }}>
            {ev.detail}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DiffList({ label, files, tone }: { label: string; files: string[]; tone: 'add' | 'chg' | 'del' }): React.JSX.Element | null {
  if (!files.length) return null
  const color = tone === 'add' ? 'var(--text-success)' : tone === 'del' ? 'var(--text-danger)' : 'var(--text-warning)'
  const sign = tone === 'add' ? '+' : tone === 'del' ? '−' : '~'
  return (
    <div className="mt-1.5">
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color }}>
        {sign} {label} · {files.length}
      </div>
      <div className="space-y-0.5">
        {files.map((f) => (
          <div key={f} className="text-[11.5px] truncate" style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>
            {f}
          </div>
        ))}
      </div>
    </div>
  )
}

export function RunResultCard({
  bot,
  onOpenFile,
  onOpenActivity,
}: {
  bot: Bot
  onOpenFile: (p: string) => void
  onOpenActivity?: () => void
}): React.JSX.Element | null {
  const diff = bot.runDiff
  const artifacts = bot.artifacts ?? []
  const hasDiff = Boolean(diff && (diff.added.length || diff.changed.length || diff.removed.length))
  if (!hasDiff && !artifacts.length) return null
  const chips: { label: string; n: number; tone: string }[] = [
    { label: 'added', n: diff?.added.length ?? 0, tone: 'var(--text-success)' },
    { label: 'changed', n: diff?.changed.length ?? 0, tone: 'var(--text-warning)' },
    { label: 'removed', n: diff?.removed.length ?? 0, tone: 'var(--text-danger)' },
  ].filter((c) => c.n > 0)
  return (
    <div className="relative overflow-hidden rounded-2xl p-3.5 result-pop lift" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-strong)' }}>
      <span className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--text-success), transparent)' }} />
      <span className="complete-burst" />
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--text-success) 16%, transparent)', color: 'var(--text-success)' }}>
          <CheckIcon />
        </span>
        <span className="text-[12.5px] font-semibold">Result</span>
        <div className="flex items-center gap-1.5 ml-1">
          {chips.map((c) => (
            <span key={c.label} className="text-[10.5px] px-1.5 py-0.5 rounded-full tabular-nums" style={{ background: 'color-mix(in srgb, ' + c.tone + ' 14%, transparent)', color: c.tone }}>
              {c.n} {c.label}
            </span>
          ))}
        </div>
        <button onClick={onOpenActivity} className="ml-auto text-[10.5px] hover:underline" style={{ color: 'var(--text-accent)' }}>
          View activity
        </button>
      </div>
      {hasDiff ? (
        <>
          <DiffList label="added" files={diff!.added} tone="add" />
          <DiffList label="changed" files={diff!.changed} tone="chg" />
          <DiffList label="removed" files={diff!.removed} tone="del" />
        </>
      ) : null}
      {artifacts.length ? (
        <div className="mt-2.5">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            Artifacts · {artifacts.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {artifacts.map((a) => (
              <button
                key={a.path}
                onClick={() => onOpenFile(a.path)}
                className="text-[11.5px] rounded-lg px-2 py-1 hover:bg-[var(--bg-hover)] flex items-center gap-1.5"
                style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                title={a.path}
              >
                <FileIcon />
                {a.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ActivitySummary({
  bot,
  onOpen,
}: {
  bot: Bot
  onOpen: () => void
}): React.JSX.Element | null {
  const n = bot.computer.length
  if (!n) return null
  const changed = bot.runDiff ? bot.runDiff.added.length + bot.runDiff.changed.length + bot.runDiff.removed.length : 0
  return (
    <button
      onClick={onOpen}
      className="self-start flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-[var(--bg-hover)] activity-in pressable"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
    >
      <span style={{ color: 'var(--text-accent)' }}>
        <ActivityIcon />
      </span>
      <span className="text-[12px]">
        {n} step{n === 1 ? '' : 's'}
        {changed ? ` · ${changed} file${changed === 1 ? '' : 's'} touched` : ''}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--text-accent)' }}>
        View activity
      </span>
    </button>
  )
}

export function ApprovalCard({
  bot,
  onRespond,
}: {
  bot: Bot
  onRespond: (response: 'once' | 'always' | 'reject') => void
}): React.JSX.Element | null {
  const p = bot.pendingPermission
  if (!p) return null
  return (
    <div className="rounded-2xl p-3.5 max-w-lg result-pop" style={{ background: 'color-mix(in srgb, var(--text-warning) 10%, var(--bg-card))', border: '0.5px solid color-mix(in srgb, var(--text-warning) 34%, transparent)' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--text-warning)' }}>
          <AlertIcon />
        </span>
        <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-warning)' }}>
          Approval needed
        </span>
        <span className="ml-auto w-2 h-2 rounded-full status-halo relative" style={{ background: 'var(--text-warning)' }} />
      </div>
      <p className="text-[14px] font-semibold mt-1.5">{p.title}</p>
      <p className="text-[13px] mt-1 whitespace-pre-wrap" style={{ color: 'var(--text-tertiary)' }}>
        {p.detail}
      </p>
      <div className="flex gap-2 mt-3">
        <button onClick={() => onRespond('once')} className="text-[13px] font-medium rounded-full px-3 py-1.5" style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}>
          Allow once
        </button>
        <button onClick={() => onRespond('always')} className="text-[13px] rounded-full px-3 py-1.5" style={{ background: 'var(--fill-secondary)' }}>
          Always
        </button>
        <button onClick={() => onRespond('reject')} className="text-[13px] px-3 py-1.5" style={{ color: 'var(--text-danger)' }}>
          Reject
        </button>
      </div>
    </div>
  )
}

/* ── Right-hand panels ─────────────────────────────────────── */

export function ActivityPanel({
  bot,
  files,
  fileView,
  onOpenWorkspace,
  onOpenFile,
  onCollapse,
}: {
  bot: Bot | null
  files: FileNode[]
  fileView: { path: string; content: string } | null
  onOpenWorkspace: () => void
  onOpenFile: (p: string) => void
  onCollapse?: () => void
}): React.JSX.Element {
  const events = (bot?.computer ?? [])
    .filter((c) => c.title !== 'step-start' && c.title !== 'step-finish')
    .map((c) => (c.detail === '[object Object]' || c.detail === '{}' ? { ...c, detail: '' } : c))
    .reverse()
  const diff = bot?.runDiff
  const artifacts = bot?.artifacts ?? []
  return (
    <>
      <PanelHeader
        title={bot ? `${bot.name} · activity` : 'Activity'}
        subtitle={bot?.activity ? bot.activity : 'Live timeline of what this agent is doing.'}
        onClose={onCollapse}
        action={
          <button onClick={onOpenWorkspace} className="text-[11px]" style={{ color: 'var(--text-accent)' }}>
            Open folder
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {bot?.pendingPermission ? (
          <section>
            <SectionLabel>Approvals</SectionLabel>
            <ApprovalCard
              bot={bot}
              onRespond={(response) => void api.permission({ botId: bot.id, permissionId: bot.pendingPermission!.id, response })}
            />
          </section>
        ) : null}

        {bot?.error ? (
          <section>
            <SectionLabel>Errors</SectionLabel>
            <div className="rounded-xl px-3 py-2 text-[12.5px] flex gap-2" style={{ background: 'color-mix(in srgb, var(--text-danger) 12%, transparent)', color: 'var(--text-danger)', border: '0.5px solid color-mix(in srgb, var(--text-danger) 30%, transparent)' }}>
              <AlertIcon />
              <span className="min-w-0 break-words">{bot.error}</span>
            </div>
          </section>
        ) : null}

        <section>
          <SectionLabel>Timeline</SectionLabel>
          {bot?.status === 'running' ? (
            <RunningDots hue={bot.hue} />
          ) : (
            <div className="ev-list space-y-1.5">
              {events.map((c) => (
                <ComputerEventCard key={c.id} ev={c} />
              ))}
              {!events.length && (
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  No tool activity yet.
                </p>
              )}
            </div>
          )}
        </section>

        {diff && (diff.added.length || diff.changed.length || diff.removed.length) ? (
          <section>
            <SectionLabel>File changes</SectionLabel>
            <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
              <DiffList label="added" files={diff.added} tone="add" />
              <DiffList label="changed" files={diff.changed} tone="chg" />
              <DiffList label="removed" files={diff.removed} tone="del" />
            </div>
          </section>
        ) : null}

        {artifacts.length ? (
          <section>
            <SectionLabel>Artifacts</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {artifacts.map((a) => (
                <button
                  key={a.path}
                  onClick={() => onOpenFile(a.path)}
                  className="text-[11.5px] rounded-lg px-2 py-1 hover:bg-[var(--bg-hover)] flex items-center gap-1.5"
                  style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  title={a.path}
                >
                  <FileIcon />
                  {a.title}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <SectionLabel>Workspace</SectionLabel>
          {files.length ? (
            <div className="space-y-0.5">
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => onOpenFile(f.path)}
                  className="block w-full text-left text-[12px] py-1 px-1.5 rounded-md hover:bg-[var(--bg-hover)] hover:text-white truncate"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {f.name || f.path}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Workspace is empty.
            </p>
          )}
        </section>

        {fileView ? (
          <section>
            <div className="flex items-center justify-between mb-2">
              <SectionLabel>{fileView.path}</SectionLabel>
            </div>
            <pre className="text-[11px] whitespace-pre-wrap rounded-[10px] p-2.5 max-h-72 overflow-auto" style={{ background: 'var(--code-fill)', color: 'var(--text-secondary)', fontFamily: 'var(--mono)', border: '0.5px solid var(--border)' }}>
              {fileView.content}
            </pre>
          </section>
        ) : null}
      </div>
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
      {children}
    </h3>
  )
}

export function RoomsPanel({
  rooms,
  bots,
  onChange,
  onClose,
}: {
  rooms: Room[]
  bots: Bot[]
  onChange: (r: Room[]) => void
  onClose?: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [addMap, setAddMap] = useState<Record<string, string>>({})

  const refresh = async () => onChange(await api.listRooms())
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const create = async () => {
    if (!picked.length) return
    await api.createRoom({ title: title.trim() || 'Thread', participantIds: picked })
    setTitle('')
    setPicked([])
    await refresh()
  }
  const saveRename = async (id: string) => {
    if (draftTitle.trim()) await api.renameRoom(id, draftTitle.trim())
    setEditingId(null)
    await refresh()
  }

  return (
    <>
      <PanelHeader title="Rooms" subtitle="Bring agents together in a shared thread." onClose={onClose} />
      <div className="p-3 grid gap-2" style={{ borderBottom: '0.5px solid var(--border)' }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Room name"
          className="rounded-[10px] px-2.5 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
          style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }}
        />
        <div className="flex flex-wrap gap-1.5">
          {bots.map((b) => {
            const on = picked.includes(b.id)
            return (
              <button
                key={b.id}
                onClick={() => toggle(b.id)}
                className="flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-[11.5px]"
                style={{ background: on ? 'var(--accent-soft)' : 'var(--bg-card)', border: `0.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`, color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                <BlobAvatar hue={b.hue} size={18} />
                {b.name}
              </button>
            )
          })}
        </div>
        <button onClick={() => void create()} disabled={!picked.length} className="rounded-[10px] py-2 text-[12px] font-medium disabled:opacity-40" style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}>
          Create room
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {rooms.map((r) => {
          const members = r.participantIds.map((id) => bots.find((b) => b.id === id)).filter(Boolean) as Bot[]
          const addable = bots.filter((b) => !r.participantIds.includes(b.id))
          return (
            <div key={r.id} className="rounded-[12px] px-3 py-2.5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
              <div className="flex items-center gap-2">
                {editingId === r.id ? (
                  <>
                    <input
                      value={draftTitle}
                      autoFocus
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveRename(r.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 rounded-md px-2 py-1 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
                      style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }}
                    />
                    <button onClick={() => void saveRename(r.id)} className="text-[11px]" style={{ color: 'var(--text-accent)' }}>
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-[12.5px] font-medium flex-1 truncate">{r.title}</span>
                    <button
                      onClick={() => {
                        setEditingId(r.id)
                        setDraftTitle(r.title)
                      }}
                      className="text-[10.5px]"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      rename
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`Delete room “${r.title}”?`)) {
                          await api.deleteRoom(r.id)
                          await refresh()
                        }
                      }}
                      className="text-[10.5px]"
                      style={{ color: 'var(--text-danger)' }}
                    >
                      delete
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                {members.map((b) => (
                  <span key={b.id} title={b.name}>
                    <BlobAvatar hue={b.hue} size={20} />
                  </span>
                ))}
                {!members.length && (
                  <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    No participants
                  </span>
                )}
              </div>
              {r.preview ? (
                <p className="text-[11px] mt-1.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {r.preview}
                </p>
              ) : null}
              {addable.length ? (
                <div className="flex items-center gap-2 mt-2">
                  <select
                    value={addMap[r.id] ?? ''}
                    onChange={(e) => setAddMap((m) => ({ ...m, [r.id]: e.target.value }))}
                    className="flex-1 rounded-md px-1.5 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
                    style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    <option value="">Add agent…</option>
                    {addable.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      const id = addMap[r.id]
                      if (!id) return
                      await api.addToRoom(r.id, id)
                      setAddMap((m) => ({ ...m, [r.id]: '' }))
                      await refresh()
                    }}
                    disabled={!addMap[r.id]}
                    className="text-[11px] disabled:opacity-40"
                    style={{ color: 'var(--text-accent)' }}
                  >
                    Add
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
        {!rooms.length && (
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            No rooms yet. Pick a couple of agents above and create one.
          </p>
        )}
      </div>
    </>
  )
}

export function MemoryPanel({
  memories,
  botId,
  onChange,
  onClose,
}: {
  memories: MemoryRow[]
  botId?: string
  onChange: (m: MemoryRow[]) => void
  onClose?: () => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const add = async () => {
    if (!key.trim() || !value.trim()) return
    await api.addMemory({ key: key.trim(), value: value.trim(), botId })
    setKey('')
    setValue('')
    onChange(await api.listMemories(botId))
  }
  return (
    <>
      <PanelHeader
        title="Memory"
        subtitle="Facts agents carry between runs."
        onClose={onClose}
        action={
          <button
            onClick={async () => {
              await api.clearMemories()
              onChange([])
            }}
            className="text-[11px]"
            style={{ color: 'var(--text-danger)' }}
          >
            Clear
          </button>
        }
      />
      <div className="p-3 grid gap-2" style={{ borderBottom: '0.5px solid var(--border)' }}>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key" className="rounded-[10px] px-2.5 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1" style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }} />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="what to remember" className="rounded-[10px] px-2.5 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1" style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }} />
        <button onClick={() => void add()} disabled={!key.trim() || !value.trim()} className="rounded-[10px] py-2 text-[12px] font-medium disabled:opacity-40" style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}>
          Remember
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {memories.map((m) => (
          <div key={m.id} className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
            <div className="flex justify-between gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--text-accent)' }}>
                {m.key}
              </span>
              <button
                onClick={async () => {
                  await api.deleteMemory(m.id)
                  onChange(await api.listMemories(botId))
                }}
                className="text-[10px]"
                style={{ color: 'var(--text-tertiary)' }}
              >
                remove
              </button>
            </div>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              {m.value}
            </p>
          </div>
        ))}
        {!memories.length && (
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            Nothing remembered yet.
          </p>
        )}
      </div>
    </>
  )
}

export function HistoryPanel({
  history,
  onOpen,
  onClose,
}: {
  history: HistoryTurn[]
  onOpen: (botId: string) => void
  onClose?: () => void
}): React.JSX.Element {
  const grouped = useMemo(() => {
    const byBot = new Map<string, HistoryTurn[]>()
    for (const t of history) {
      const list = byBot.get(t.botId) ?? []
      list.push(t)
      byBot.set(t.botId, list)
    }
    return [...byBot.entries()].sort(
      (a, b) => (b[1][b[1].length - 1]?.at ?? 0) - (a[1][a[1].length - 1]?.at ?? 0),
    )
  }, [history])

  return (
    <>
      <PanelHeader
        title="History"
        subtitle="Everything you and your agents have said to each other."
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {grouped.map(([botId, turns]) => (
          <div key={botId} className="rounded-[12px] p-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--text-accent)' }}>
                {turns[0]?.botName}
              </span>
              <button onClick={() => onOpen(botId)} className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                open
              </button>
            </div>
            {turns.slice(-8).map((t) => (
              <div key={t.id} className="py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: t.role === 'user' ? 'var(--text-accent)' : 'var(--text-teal)' }}
                  >
                    {t.role}
                  </span>
                  {t.user && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {t.user}
                    </span>
                  )}
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {dateLabel(t.at)} {timeLabel(t.at)}
                  </span>
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {t.text.length > 180 ? `${t.text.slice(0, 180)}…` : t.text}
                </p>
              </div>
            ))}
          </div>
        ))}
        {!grouped.length && (
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            No conversations recorded yet. They appear here the moment you talk to an agent.
          </p>
        )}
      </div>
    </>
  )
}

export function RoutinePanel({
  routines,
  bots,
  selectedId,
  onChange,
  onClose,
}: {
  routines: Routine[]
  bots: Bot[]
  selectedId?: string
  onChange: (r: Routine[]) => void
  onClose?: () => void
}): React.JSX.Element {
  const [schedule, setSchedule] = useState('every 60 m')
  const [prompt, setPrompt] = useState('')
  const botId = selectedId ?? bots[0]?.id ?? ''
  const add = async () => {
    if (!botId || !prompt.trim()) return
    await api.addRoutine({ botId, schedule, prompt: prompt.trim() })
    setPrompt('')
    onChange(await api.listRoutines())
  }
  const teach = async () => {
    if (!botId) return
    await api.teachRoutine({ botId, schedule })
    onChange(await api.listRoutines())
  }
  return (
    <>
      <PanelHeader title="Schedules" subtitle="Teach a finished task, or schedule with `every 30 m`, `every 2 h`, or `09:00`." onClose={onClose} />
      <div className="p-3 grid gap-2" style={{ borderBottom: '0.5px solid var(--border)' }}>
        <input value={schedule} onChange={(e) => setSchedule(e.target.value)} className="rounded-[10px] px-2.5 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1" style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }} />
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="what to run" className="rounded-[10px] px-2.5 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1" style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }} />
        <button onClick={() => void add()} disabled={!prompt.trim() || !botId} className="rounded-[10px] py-2 text-[12px] font-medium disabled:opacity-40" style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}>
          Schedule
        </button>
        <button onClick={() => void teach()} disabled={!botId} className="rounded-[10px] py-2 text-[12px]" style={{ color: 'var(--text-accent)', background: 'var(--bg-card)' }}>
          Teach last task
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {routines.map((r) => {
          const bot = bots.find((b) => b.id === r.botId)
          return (
            <div key={r.id} className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
              <div className="flex justify-between text-[12px]">
                <span className="font-medium">
                  {bot?.name ?? r.botId}
                  {r.origin === 'taught' ? <span style={{ color: 'var(--text-tertiary)' }}> · taught</span> : null}
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>{r.schedule}</span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                {r.prompt}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={async () => {
                    await api.toggleRoutine(r.id, !r.enabled)
                    onChange(await api.listRoutines())
                  }}
                  className="text-[10px]"
                  style={{ color: r.enabled ? 'var(--text-warning)' : 'var(--text-accent)' }}
                >
                  {r.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={async () => {
                    await api.removeRoutine(r.id)
                    onChange(await api.listRoutines())
                  }}
                  className="text-[10px]"
                  style={{ color: 'var(--text-danger)' }}
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
        {!routines.length && (
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            No schedules yet.
          </p>
        )}
      </div>
    </>
  )
}

export function ConnectorsPanel({
  connectors,
  onChange,
  onClose,
}: {
  connectors: Connector[]
  onChange: (c: Connector[]) => void
  onClose?: () => void
}): React.JSX.Element {
  return (
    <>
      <PanelHeader
        title="Connectors"
        subtitle="Intent tracking only — live OAuth is coming soon. Marking a tool here tells agents you plan to use it; no real connection is made yet."
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {connectors.map((c) => (
          <div key={c.id} className="rounded-[12px] px-3 py-2.5" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">{c.name}</span>
                <span
                  className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--text-warning) 15%, transparent)', color: 'var(--text-warning)' }}
                >
                  Coming soon
                </span>
              </div>
              <button
                onClick={async () => {
                  await api.updateConnector({
                    id: c.id,
                    status: c.status === 'connected' ? 'disconnected' : 'connected',
                    note: c.note,
                  })
                  onChange(await api.listConnectors())
                }}
                className="text-[11px]"
                style={{ color: c.status === 'connected' ? 'var(--text-success)' : 'var(--text-accent)' }}
              >
                {c.status === 'connected' ? 'Connected' : 'Connect'}
              </button>
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              {c.description}
            </p>
          </div>
        ))}
      </div>
    </>
  )
}

export function SettingsPanel({
  settings,
  theme,
  mode,
  onChange,
  onTheme,
  onMode,
  onClose,
}: {
  settings: AppSettings
  theme: ThemeName
  mode: Mode
  onChange: (s: AppSettings) => void
  onTheme: (t: ThemeName) => void
  onMode: (m: Mode) => void
  onClose?: () => void
}): React.JSX.Element {
  const setReview = async (autoReview: ReviewMode) => onChange(await api.updateSettings({ autoReview }))
  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }): React.JSX.Element => (
    <button
      onClick={onToggle}
      className="w-9 h-5 rounded-full relative shrink-0"
      style={{ background: on ? 'var(--accent)' : 'var(--bg-active)' }}
      role="switch"
      aria-checked={on}
    >
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} />
    </button>
  )
  return (
    <>
      <PanelHeader title="Settings" onClose={onClose} />
      <div className="p-4 space-y-5 text-[12.5px]">
        <div>
          <div className="mb-2 font-medium">Your name</div>
          <input
            key={settings.userName ?? ''}
            defaultValue={settings.userName ?? ''}
            placeholder="Who's talking to your agents"
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next === settings.userName) return
              void api.updateSettings({ userName: next || undefined }).then(onChange)
            }}
            className="w-full rounded-[10px] px-2.5 py-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
            style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }}
          />
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Tags your history and personalizes every agent run for this person.
          </p>
        </div>
        <div>
          <div className="mb-2 font-medium">Appearance</div>
          <div className="flex gap-1.5">
            {(['dark', 'light'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => onMode(m)}
                className="flex-1 rounded-xl px-3 py-2 text-[12.5px] capitalize flex items-center justify-center gap-1.5"
                style={{
                  background: mode === m ? 'var(--accent-soft)' : 'transparent',
                  border: `0.5px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`,
                  color: mode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {m === 'light' ? <ModeIcon /> : <ModeIcon />}
                {m}
              </button>
            ))}
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Dark is the default. The accent swatches below tint whichever mode you pick.
          </p>
        </div>
        <div>
          <div className="mb-2 font-medium">Accent</div>
          <div className="flex items-center gap-2.5">
            {THEMES.map((t) => (
              <button
                key={t.name}
                title={t.label}
                aria-label={`${t.label} theme`}
                onClick={() => onTheme(t.name)}
                data-on={theme === t.name}
                className="theme-swatch"
                style={{ background: `linear-gradient(135deg, ${t.swatch}, color-mix(in srgb, ${t.swatch} 60%, #000))` }}
              />
            ))}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="flex-1">
            Privacy mode
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Keep runs on this machine.
            </span>
          </span>
          <Toggle on={settings.privacyMode} onToggle={() => void api.updateSettings({ privacyMode: !settings.privacyMode }).then(onChange)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="flex-1">
            Bot-to-bot handoff
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Let agents pass work to each other.
            </span>
          </span>
          <Toggle on={settings.allowBotHandoff} onToggle={() => void api.updateSettings({ allowBotHandoff: !settings.allowBotHandoff }).then(onChange)} />
        </label>
        <div>
          <div className="mb-2 font-medium">Auto Review</div>
          <div className="flex gap-1.5">
            {(['sensitive', 'always', 'off'] as ReviewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => void setReview(mode)}
                className="rounded-full px-3 py-1.5 text-[12px] capitalize"
                style={{
                  background: settings.autoReview === mode ? 'var(--accent-soft)' : 'transparent',
                  border: `0.5px solid ${settings.autoReview === mode ? 'var(--accent)' : 'var(--border)'}`,
                  color: settings.autoReview === mode ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <p style={{ color: 'var(--text-tertiary)' }}>Max parallel bots: {settings.maxParallelBots}</p>
        <button onClick={() => void api.openLogs()} className="text-[11.5px]" style={{ color: 'var(--text-accent)' }}>
          Open logs
        </button>
      </div>
    </>
  )
}

export function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }): React.JSX.Element {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 rounded-full px-4 py-2 text-[13px] flex items-center gap-3" style={{ background: 'var(--raised)', border: '0.5px solid var(--border)' }}>
      <span>{text}</span>
      <button onClick={onDismiss} className="text-[11px]" style={{ color: 'var(--text-accent)' }}>
        Dismiss
      </button>
    </div>
  )
}

/* ── Context menu ──────────────────────────────────────────── */

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  checked?: boolean
  separatorBefore?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu inside the viewport: clamp against its measured size.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} role="menu" className="rs-menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => (
        <React.Fragment key={`${it.label}-${i}`}>
          {it.separatorBefore && <div className="rs-menu-sep" />}
          <button
            role="menuitem"
            className={`rs-menu-item${it.danger ? ' rs-menu-danger' : ''}`}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon && <span className="rs-menu-icon">{it.icon}</span>}
            <span className="flex-1 text-left truncate">{it.label}</span>
            {it.checked && <span className="rs-menu-check">✓</span>}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}

/* ── Sidebar ───────────────────────────────────────────────── */

export function BotRow({
  bot,
  active,
  unread,
  index,
  onSelect,
  onContextMenu,
  onMenu,
  renaming,
  onRename,
  onRenameCancel,
  dragging,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  bot: Bot
  active: boolean
  unread?: boolean
  index?: number
  onSelect: () => void
  onContextMenu?: (pos: { x: number; y: number }) => void
  onMenu?: (pos: { x: number; y: number }) => void
  renaming?: boolean
  onRename?: (name: string) => void
  onRenameCancel?: () => void
  dragging?: boolean
  dropBefore?: boolean
  dropAfter?: boolean
  onDragStart?: () => void
  onDragOver?: (before: boolean) => void
  onDrop?: () => void
  onDragEnd?: () => void
}): React.JSX.Element {
  const archived = Boolean(bot.archived)
  const isLive = bot.status === 'running'
  const needsYou = bot.status === 'waiting'
  const rowClass = `rs-bot-row relative${dragging ? ' rs-bot-dragging' : ''}${dropBefore ? ' rs-drop-before' : ''}${dropAfter ? ' rs-drop-after' : ''}`
  const bodyClass = `w-full text-left rounded-[12px] px-2.5 py-2.5 flex items-center gap-3 pressable transition-all motion-rise ${active ? 'bot-row-active' : 'hover:bg-[var(--sidebar-hover)]'}`

  const onDragOverRow = (e: React.DragEvent): void => {
    if (!onDragOver) return
    e.preventDefault()
    const mid = e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2
    onDragOver(e.clientY < mid)
  }

  const inner = (
    <>
      <span className="relative shrink-0">
        <BlobAvatar hue={bot.hue} size={34} />
        {isLive && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 flex items-center justify-center" style={{ background: 'var(--text-success)', borderColor: 'var(--sidebar-tint)' }}>
            <span className="w-full h-full rounded-full status-halo" style={{ background: 'var(--text-success)' }} />
          </span>
        )}
        {needsYou && (
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{ background: 'var(--text-warning)', borderColor: 'var(--sidebar-tint)' }} />
        )}
        {unread && !isLive && !needsYou && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full hit-pulse" style={{ background: 'var(--accent)' }} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {bot.pinned && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} title="Pinned" />}
          <span className="text-[13px] font-semibold truncate" style={{ color: active ? 'var(--text-primary)' : 'var(--sidebar-text)' }}>
            {bot.name}
          </span>
          <span className="ml-auto text-[10px] shrink-0 tabular-nums" style={{ color: unread ? 'var(--text-accent)' : 'var(--sidebar-faint)' }}>
            {unread ? '● New' : archived ? 'Archived' : timeLabel(bot.updatedAt)}
          </span>
        </span>
        <span className="block text-[11.5px] truncate mt-0.5" style={{ color: isLive ? 'var(--text-success)' : needsYou ? 'var(--text-warning)' : 'var(--sidebar-muted)' }}>
          {isLive ? '⚡ Working…' : needsYou ? '⚠ Needs you' : bot.preview || bot.job || 'No messages yet'}
        </span>
      </span>
    </>
  )

  return (
    <div
      className={`${rowClass} mb-1`}
      draggable={!renaming && Boolean(onDragStart)}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault()
              onContextMenu({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
      onDragStart={
        onDragStart
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', bot.id)
              onDragStart()
            }
          : undefined
      }
      onDragOver={onDragOverRow}
      onDrop={
        onDrop
          ? (e) => {
              e.preventDefault()
              onDrop()
            }
          : undefined
      }
      onDragEnd={() => onDragEnd?.()}
    >
      {renaming ? (
        <input
          autoFocus
          defaultValue={bot.name}
          className="w-full rounded-[12px] px-2.5 py-2.5 text-[13px] font-semibold outline-none"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--sidebar-text)', border: '0.5px solid var(--accent)' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') onRenameCancel?.()
          }}
          onBlur={(e) => onRename?.(e.target.value)}
        />
      ) : (
        <button
          onClick={onSelect}
          title={archived ? `${bot.name} · archived` : bot.name}
          className={bodyClass}
          style={{ opacity: archived ? 0.5 : 1, animationDelay: `${Math.min(index ?? 0, 12) * 28}ms` }}
        >
          {inner}
        </button>
      )}
      {!renaming && onMenu && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Agent menu"
          title="More"
          className="rs-bot-menu-btn"
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onMenu({ x: r.right, y: r.bottom })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onMenu({ x: r.right, y: r.bottom })
          }}
        >
          ⋯
        </span>
      )}
    </div>
  )
}

const HERO_LINES = [
  'books the offsite venue while you sleep.',
  'triages the bug before standup.',
  'drafts your outbound overnight.',
  'reconciles spend every Monday.',
  'reproduces the flaky test on its own.',
]

function useTypewriter(phrases: string[], speed = 42, hold = 1700): string {
  const [text, setText] = useState('')
  const [i, setI] = useState(0)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    const full = phrases[i % phrases.length]
    if (!deleting && text === full) {
      const t = window.setTimeout(() => setDeleting(true), hold)
      return () => window.clearTimeout(t)
    }
    if (deleting && text === '') {
      setDeleting(false)
      setI((v) => v + 1)
      return
    }
    const t = window.setTimeout(() => {
      setText(deleting ? full.slice(0, text.length - 1) : full.slice(0, text.length + 1))
    }, deleting ? speed / 2 : speed)
    return () => window.clearTimeout(t)
  }, [text, deleting, i, phrases, speed, hold])
  return text
}

export function EmptyState({
  templates,
  bots,
  onPick,
  onNew,
  onOpen,
}: {
  templates: JobTemplate[]
  bots: Bot[]
  onPick: (t: JobTemplate) => void
  onNew: () => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  const typed = useTypewriter(HERO_LINES)
  const ICONS: Record<string, string> = {
    'Sales Outbound': '📤',
    'Talent Scout': '🔍',
    'Paid Media': '📊',
    'Expense Manager': '🧾',
    'Product Performance': '📈',
    'Bug Reproduction': '🐛',
    'Account Health': '💼',
    'Chief of Staff': '🎯',
  }
  const firstRun = bots.length === 0
  return (
    <div className="h-full min-h-[420px] flex flex-col items-center justify-center text-center px-8 py-10 motion-fade-up select-none">
      {bots.length > 0 && (
        <div className="mb-9 w-full max-w-md motion-rise">
          <p className="text-[10.5px] uppercase tracking-widest mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Your team
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {bots.slice(0, 8).map((b, i) => (
              <button
                key={b.id}
                onClick={() => onOpen(b.id)}
                title={b.job || b.name}
                className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 lift pressable motion-pop"
                style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', animationDelay: `${i * 40}ms` }}
              >
                <BlobAvatar hue={b.hue} size={22} />
                <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {b.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="motion-scale" style={{ animationDelay: '60ms' }}>
        <div className="relative inline-flex presence-orbit">
          <span className="orbit-ring" />
          <div className="absolute inset-0 rounded-full blur-2xl opacity-40" style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
          <Logo size={52} />
        </div>
      </div>

      <h2 className="mt-6 text-[32px] font-bold tracking-tight leading-tight motion-rise" style={{ animationDelay: '80ms' }}>
        Your AI team,{' '}
        <span className="logo-word">on your machine</span>
      </h2>
      <p className="mt-3 min-h-[24px] text-[15px] max-w-md leading-relaxed motion-rise" style={{ color: 'var(--text-secondary)', animationDelay: '120ms' }}>
        <span className="type-caret">{typed}</span>
      </p>

      <div className="motion-scale" style={{ animationDelay: '160ms' }}>
        <button
          onClick={onNew}
          className={`mt-7 rounded-full text-[14px] font-semibold px-6 py-3 btn-sheen pressable glow-accent${firstRun ? ' spotlight' : ''}`}
          style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}
        >
          + New agent
        </button>
      </div>

      {templates.length > 0 && (
        <div className="mt-10 w-full max-w-xl motion-rise" style={{ animationDelay: '200ms' }}>
          <p className="text-[11px] uppercase tracking-widest mb-4" style={{ color: 'var(--text-tertiary)' }}>
            Start with a template
          </p>
          <div className="grid grid-cols-2 gap-2">
            {templates.slice(0, 8).map((t, i) => (
              <button
                key={t.name}
                onClick={() => onPick(t)}
                className="group text-left rounded-[14px] px-3.5 py-3 lift pressable glass motion-rise"
                style={{ animationDelay: `${220 + i * 35}ms` }}
              >
                <div className="text-[18px] mb-1.5 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 inline-block">{ICONS[t.name] ?? '🤖'}</div>
                <div className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {t.name}
                </div>
                <div className="text-[11px] mt-0.5 line-clamp-2 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                  {t.job}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function TrafficLights(): React.JSX.Element {
  return (
    <div className="window-no-drag flex items-center gap-[7px] pr-1">
      <button aria-label="Close" onClick={() => api.windowClose()} className="w-3 h-3 rounded-full bg-[#ff5f57]" />
      <button aria-label="Minimize" onClick={() => api.windowMinimize()} className="w-3 h-3 rounded-full bg-[#febc2e]" />
      <button aria-label="Zoom" onClick={() => api.windowMaximize()} className="w-3 h-3 rounded-full bg-[#28c840]" />
    </div>
  )
}

export function StreakPill({ days }: { days: number }): React.JSX.Element {
  return (
    <span
      className="text-[11px] px-2.5 py-1 rounded-full font-semibold flex items-center gap-1"
      style={{ background: 'color-mix(in srgb, var(--text-warning) 14%, transparent)', border: '0.5px solid color-mix(in srgb, var(--text-warning) 35%, transparent)' }}
    >
      <span>🔥</span>
      <span className="streak-shine">{days}d</span>
    </span>
  )
}

/* ── Icons ─────────────────────────────────────────────────── */

export function PlusIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function CommandIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 6h4v4H6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 6H4.3a1.8 1.8 0 1 1 1.7-1.8V6Zm4 0h1.7a1.8 1.8 0 1 0-1.7-1.8V6Zm0 4h1.7a1.8 1.8 0 1 1-1.7 1.8V10Zm-4 0H4.3A1.8 1.8 0 1 0 6 11.8V10Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function SparkIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 1.8l1.5 4.2L13.7 7.5 9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6 8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function PaletteIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2a6 6 0 0 0 0 12c1 0 1.6-.8 1.4-1.6-.2-.9.4-1.4 1.2-1.4H12A2 2 0 0 0 14 9 6 6 0 0 0 8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="5.2" cy="7" r="0.9" fill="currentColor" />
      <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
      <circle cx="10.8" cy="7" r="0.9" fill="currentColor" />
    </svg>
  )
}

export function SearchIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function ActivityIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8h3l2-4.5L8 12l2-6 1.5 2h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RoomsIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.8 13c.4-2 2.1-3.2 4.2-3.2S9.8 11 10.2 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10.5 4.2a2.4 2.4 0 0 1 0 4.6M11.6 13c-.2-1.3-.8-2.3-1.7-2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function MemoryIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.5 13.5 5.5v5L8 13.5 2.5 10.5v-5L8 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.6 5.6 8 8.5l5.4-2.9M8 8.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function RoutineIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5v3.2l2 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PlugIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 3v4M10 3v4M5 7h6v2.5A3.5 3.5 0 0 1 7.5 13h-0V15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function GearIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2.5v1.5M8 12v1.5M2.5 8h1.5M12 8h1.5M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1l-1.1 1.1M5.2 10.8l-1.1 1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function SendIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function HistoryIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.8 5.2A5.6 5.6 0 1 1 2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.5 3.5 2.8 5.2 4.5 7.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5v3l2 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function StopIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.4" fill="currentColor" />
    </svg>
  )
}

export function BellIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.5a3.5 3.5 0 0 1 3.5 3.5c0 2.4.7 3.4 1.2 4H3.3c.5-.6 1.2-1.6 1.2-4A3.5 3.5 0 0 1 8 2.5Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.5 13.2a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function PanelIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 3v10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

export function ToolIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10.4 2.6a3.2 3.2 0 0 0-3.9 4L2.6 10.5a1.4 1.4 0 0 0 2 2l3.9-3.9a3.2 3.2 0 0 0 4-3.9L10.7 6.5 9.5 5.3l1.8-1.8-.9-.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function FileIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 2h5l3 3v9H4V2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export function ShellIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7l1.8 1.6L5 10.2M8.5 10.4h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function NoteIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 3h10v7l-3 3H3V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 13v-3h3M5.5 6.5h5M5.5 9h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function HandoffIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 8h9M8.5 5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12.5" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function CheckIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AlertIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 mt-0.5">
      <path d="M8 2.5 14 13H2L8 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.5v3.2M8 11.6h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
