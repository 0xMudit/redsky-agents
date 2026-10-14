import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { scheduleLabel, stripThinking, timeLabel } from './format'
import type { AppNotice, Bot, Connector, EventEnvelope, FileNode, HistoryTurn, JobTemplate, MemoryRow, ModelOption, Note, NoteHit, Room, Routine, SearchHit, SetupCheck } from './types'
import {
  ActivityIcon,
ActivityPanel,
  ActivitySummary,
  applyBase,
  applyMode,
  applyScale,
  applyTheme,
  ApprovalCard,
  BellIcon,
  BlobAvatar,
  BotRow,
  CommandIcon,
  CommandPalette,
  ConnectorsPanel,
  EmptyState,
  FileIcon,
  GearIcon,
  getStoredBase,
  getStoredMode,
  getStoredScale,
  getStoredTheme,
  HistoryIcon,
  HistoryPanel,
  IconBtn,
  IonIcon,
  Logo,
  MemoryIcon,
  MemoryPanel,
  MessageBlock,
  ModeIcon,
  NavItem,
  NotesIcon,
  NotesPanel,
  PaletteIcon,
  PanelHeader,
  PlugIcon,
  PlusIcon,
  RoomsIcon,
  RoomsPanel,
  RoutineIcon,
  RoutinePanel,
  SearchIcon,
  SearchPalette,
  SendIcon,
  SettingsPanel,
  SparkIcon,
  StatusDot,
  StopIcon,
  THEMES,
  TrafficLights,
  WorkingWindow,
} from './ui'
import type { BaseThemeName, Command, MenuItem, Mode, SearchResult, ThemeName } from './ui'
import type { AppSettings } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmHost, alertDialog, confirmDialog } from '@/components/ui/confirm'
import { Toaster, toast } from '@/components/ui/toast'
import { playReminderSound, preloadReminderSound } from './lib/sound'

type Boot = 'starting' | 'online' | 'offline'
type Panel = 'none' | 'activity' | 'notices' | 'rooms' | 'memory' | 'notes' | 'history' | 'routines' | 'connectors' | 'settings'

// Composer attachments: reject anything over 10MB, label chips with a short name.
const MAX_ATTACH_BYTES = 10 * 1024 * 1024
const ATTACH_NAME_LIMIT = 12
const shortAttachName = (name: string): string => (name.length > ATTACH_NAME_LIMIT ? `${name.slice(0, ATTACH_NAME_LIMIT - 1)}…` : name)

const STREAK_KEY = 'redsky.streak'
const QUICK = [
  { label: 'Keep going', text: 'Keep going from that result. Make it sharper.' },
  { label: 'Shorter', text: 'Give me a tighter version of that result.' },
  { label: 'Another angle', text: 'Same goal, different angle. Surprise me.' },
]

function SetupCheckRow({
  label,
  resolved,
  ok = true,
  delay,
  hint,
}: {
  label: React.ReactNode
  resolved: boolean
  ok?: boolean
  delay: number
  hint?: React.ReactNode
}): React.JSX.Element {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 520 + delay * 260)
    return () => clearTimeout(timer)
  }, [delay])

  const state: 'pending' | 'ok' | 'fail' = resolved && settled ? (ok ? 'ok' : 'fail') : 'pending'

  return (
    <div className="setup-item flex items-center gap-2.5" style={{ animationDelay: `${delay * 90}ms` }}>
      <span className="setup-bullet" data-state={state} aria-hidden="true">
        {state === 'ok' ? (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="setup-check-path" d="M4.5 12.5 9.5 17.5 19.5 6.5" />
          </svg>
        ) : state === 'fail' ? (
          <span className="text-[10px] font-bold leading-none">✗</span>
        ) : null}
      </span>
      <span
        className="flex-1 transition-colors duration-200"
        style={{ color: state === 'pending' ? 'var(--text-secondary)' : 'var(--text-primary)' }}
      >
        {label}
      </span>
      {hint}
    </div>
  )
}

function Step({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <span
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5"
        style={{
          background: done ? 'var(--text-success)' : 'var(--fill-secondary)',
          color: done ? '#fff' : 'var(--text-secondary)',
        }}
      >
        {done ? '✓' : n}
      </span>
      <div className="text-[13px]">{children}</div>
    </div>
  )
}

function SidebarSection({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center px-2.5 pt-3 pb-1">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--sidebar-faint)' }}>
        {label}
      </span>
    </div>
  )
}

function loadStreak(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') as { day?: string; n?: number } | null
    if (!raw?.day || !raw.n) return 1
    const today = new Date().toDateString()
    const yest = new Date(Date.now() - 86400000).toDateString()
    if (raw.day === today) return raw.n
    if (raw.day === yest) return raw.n
    return 1
  } catch {
    return 1
  }
}

function bumpStreak(): number {
  const today = new Date().toDateString()
  try {
    const raw = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') as { day?: string; n?: number } | null
    if (raw?.day === today) return raw.n ?? 1
    const yest = new Date(Date.now() - 86400000).toDateString()
    const n = raw?.day === yest ? (raw.n ?? 0) + 1 : 1
    localStorage.setItem(STREAK_KEY, JSON.stringify({ day: today, n }))
    return n
  } catch {
    return 1
  }
}

export default function App(): React.JSX.Element {
  const [boot, setBoot] = useState<Boot>('starting')
  const [detail, setDetail] = useState('')
  const [setup, setSetup] = useState<SetupCheck | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState('')
  const [bots, setBots] = useState<Bot[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [panel, setPanel] = useState<Panel>('none')
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [history, setHistory] = useState<HistoryTurn[]>([])
  const [routines, setRoutines] = useState<Routine[]>([])
  const [routineFocus, setRoutineFocus] = useState<{ id: string; nonce: number } | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [noteFocus, setNoteFocus] = useState<{ id: string; nonce: number } | null>(null)
  const [capture, setCapture] = useState<string | null>(null)
  const [captureQuery, setCaptureQuery] = useState('')
  const [captureHits, setCaptureHits] = useState<NoteHit[]>([])
  const [templates, setTemplates] = useState<JobTemplate[]>([])
  const [files, setFiles] = useState<FileNode[]>([])
  const [fileView, setFileView] = useState<{ path: string; content: string } | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [notices, setNotices] = useState<AppNotice[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [editor, setEditor] = useState<{ name: string; job: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [streak, setStreak] = useState(loadStreak)
  const [showJump, setShowJump] = useState(false)
  const [palette, setPalette] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [attachments, setAttachments] = useState<{ path: string; name: string; isImage: boolean }[]>([])
  const [theme, setTheme] = useState<ThemeName>(getStoredTheme)
  const [base, setBase] = useState<BaseThemeName>(getStoredBase)
  const [mode, setMode] = useState<Mode>(getStoredMode)
  const [scale, setScale] = useState<number>(getStoredScale)
  // Whether the Rooms/Schedules/Memory/… app tools drawer is open in the sidebar.
  const [sectionsOpen, setSectionsOpen] = useState(() => {
    try {
      return localStorage.getItem('redsky.sections') !== '0'
    } catch {
      return true
    }
  })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stickRef = useRef(true)
  const selectedIdRef = useRef<string | null>(null)
  const lastPanelRef = useRef<Exclude<Panel, 'none'>>('activity')
  const openSchedulesRef = useRef<() => void>(() => {})

  const upsertBot = useCallback((bot: Bot) => {
    setBots((prev) => {
      const i = prev.findIndex((b) => b.id === bot.id)
      const next = i >= 0 ? prev.map((b) => (b.id === bot.id ? bot : b)) : [bot, ...prev]
      return [...next].sort((a, b) => b.updatedAt - a.updatedAt)
    })
  }, [])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    preloadReminderSound()
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    applyBase(base)
  }, [base])

  useEffect(() => {
    applyMode(mode)
  }, [mode])

  useEffect(() => {
    applyScale(scale)
  }, [scale])

  useEffect(() => {
    void api
      .init()
      .then((p) => {
        setBoot(p.status)
        setDetail(p.baseUrl ?? '')
        setModels(p.models)
        setModel(p.models.find((o) => o.isDefault)?.id ?? p.models[0]?.id ?? '')
        setBots(p.bots)
        setMemories(p.memories)
        setRoutines(p.routines)
        setRooms(p.rooms ?? [])
        setNotes(p.notes ?? [])
        setTemplates(p.templates)
        setSettings(p.settings)
        setConnectors(p.connectors ?? [])
        setNotices(p.notices ?? [])
        if (p.bots.length) setSelectedId(p.bots[0].id)
      })
      .catch((err) => {
        setBoot('offline')
        setDetail((err as Error).message)
      })
    api
      .setupCheck()
      .then(setSetup)
      .catch(() => setSetup(null))
  }, [])

  useEffect(() => {
    const off = api.onEvent((evt: EventEnvelope) => {
      if (evt.source === 'status') {
        setBoot(evt.state)
        if (evt.detail) setDetail(evt.detail)
        if (evt.state === 'online') void api.models().then(setModels)
        return
      }
      if (evt.source === 'bot') {
        const watching = selectedIdRef.current
        if (watching !== evt.bot.id && (evt.bot.status === 'idle' || evt.bot.status === 'waiting')) {
          setUnread((u) => ({ ...u, [evt.bot.id]: (u[evt.bot.id] ?? 0) + 1 }))
        }
        upsertBot(evt.bot)
      }
      if (evt.source === 'deleted') {
        setBots((prev) => prev.filter((b) => b.id !== evt.botId))
        setSelectedId((id) => (id === evt.botId ? null : id))
        setUnread((u) => {
          const next = { ...u }
          delete next[evt.botId]
          return next
        })
      }
      if (evt.source === 'notice') {
        setNotices((prev) => [evt.notice, ...prev.filter((n) => n.id !== evt.notice.id)].slice(0, 80))
        if (evt.notice.kind === 'reminder') {
          playReminderSound()
          toast({
            id: `reminder-${evt.notice.id}`,
            variant: 'reminder',
            title: evt.notice.title,
            description: evt.notice.body,
            action: { label: 'View schedules', onClick: () => openSchedulesRef.current() },
          })
        }
      }
      if (evt.source === 'notices') setNotices(evt.notices)
      if (evt.source === 'connectors') setConnectors(evt.connectors)
      if (evt.source === 'rooms') setRooms(evt.rooms)
      if (evt.source === 'notes') setNotes(evt.notes)
      if (evt.source === 'settings') setSettings(evt.settings)
    })
    return off
  }, [upsertBot])

  const selected = useMemo(() => bots.find((b) => b.id === selectedId) ?? null, [bots, selectedId])

  const cliMissing = boot === 'offline' && detail === 'opencode-missing'
  const setupReady = boot === 'online' && models.length > 0 && (setup?.opencode.found ?? true)

  const visibleThread = useMemo(() => {
    return (selected?.thread ?? []).filter((m) => {
      if (m.role === 'system') return false
      if (m.role === 'assistant' && !stripThinking(m.text)) return false
      return Boolean(m.text?.trim())
    })
  }, [selected?.thread])

  const unreadCount = useMemo(() => Object.values(unread).reduce((a, b) => a + b, 0), [unread])
  const unreadNotices = notices.filter((n) => !n.read).length
  const nextHit = useMemo(() => bots.find((b) => unread[b.id] && b.id !== selectedId) ?? null, [bots, unread, selectedId])

  useEffect(() => {
    if (!model && models.length) setModel(models.find((m) => m.isDefault)?.id ?? models[0].id)
  }, [models, model])

  useEffect(() => {
    if (setupReady) return
    const tick = (): void => {
      void api.setupCheck().then(setSetup).catch(() => undefined)
      void api.models().then(setModels).catch(() => undefined)
    }
    const timer = setInterval(tick, 3000)
    return () => clearInterval(timer)
  }, [setupReady])

  useEffect(() => {
    if (panel === 'activity') void api.files('.').then(setFiles).catch(() => setFiles([]))
    if (panel === 'memory') void api.listMemories(selected?.id).then(setMemories)
    if (panel === 'history') void api.listHistory().then(setHistory).catch(() => setHistory([]))
    if (panel === 'routines') void api.listRoutines().then(setRoutines)
    if (panel === 'connectors') void api.listConnectors().then(setConnectors)
    if (panel === 'rooms') void api.listRooms().then(setRooms)
    if (panel === 'notes') void api.listNotes().then(setNotes)
  }, [panel, selected?.id, selected?.computer.length])

  const scrollToEnd = useCallback((smooth = false) => {
    const el = threadRef.current
    if (!el || !stickRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    scrollToEnd(selected?.status !== 'running')
  }, [selected?.id, visibleThread.length, selected?.status, visibleThread.at(-1)?.text, scrollToEnd])

  const openBot = useCallback((id: string) => {
    setSelectedId(id)
    setUnread((u) => {
      if (!u[id]) return u
      const next = { ...u }
      delete next[id]
      return next
    })
    stickRef.current = true
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!setupReady) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setPanel((p) => (p === 'activity' ? 'none' : 'activity'))
        return
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        const hit = bots.find((b) => unread[b.id])
        if (hit) openBot(hit.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bots, unread, openBot, setupReady])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = q ? bots.filter((b) => `${b.name} ${b.job} ${b.preview}`.toLowerCase().includes(q)) : bots
    const rank = (b: Bot) => (b.archived ? 2 : 0) + (b.pinned ? 0 : 1)
    // Within a group, honour a manual drag order when present, otherwise fall back
    // to most-recently-updated first.
    return [...matched].sort((a, b) => {
      const byRank = rank(a) - rank(b)
      if (byRank) return byRank
      const ao = a.order ?? Number.POSITIVE_INFINITY
      const bo = b.order ?? Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
      return b.updatedAt - a.updatedAt
    })
  }, [bots, search])

  const groups = useMemo(() => {
    const pinned: Bot[] = []
    const recent: Bot[] = []
    const archived: Bot[] = []
    for (const b of visible) {
      if (b.archived) archived.push(b)
      else if (b.pinned) pinned.push(b)
      else recent.push(b)
    }
    return { pinned, recent, archived }
  }, [visible])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      void api
        .search(q)
        .then(setHits)
        .catch(() => setHits([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  const openHit = useCallback((hit: SearchHit) => {
    if (!hit.path) return
    const rel = hit.path
    void api
      .fileContent(rel)
      .then((content) => {
        setFileView({ path: rel, content })
        setPanel('activity')
      })
      .catch(() => undefined)
  }, [])

  // Global search across agents, conversations, workspace files and notes.
  const runGlobalSearch = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      const q = query.trim().toLowerCase()
      if (!q) return []
      const out: SearchResult[] = []
      for (const b of bots) {
        if (b.archived) continue
        if (`${b.name} ${b.job}`.toLowerCase().includes(q)) {
          out.push({
            id: `agent-${b.id}`,
            group: 'Agents',
            title: b.name,
            subtitle: b.job || b.preview,
            icon: <BlobAvatar hue={b.hue} size={16} />,
            run: () => openBot(b.id),
          })
        }
      }
      try {
        const hits = await api.search(q)
        for (const h of hits) {
          if (h.kind === 'message') {
            const botId = h.botId
            out.push({
              id: h.id,
              group: 'Chats',
              title: h.title,
              subtitle: h.snippet,
              icon: <IonIcon name="chatbubble-outline" size={15} />,
              run: () => {
                if (botId) openBot(botId)
              },
            })
          } else if (h.kind === 'file') {
            out.push({ id: h.id, group: 'Files', title: h.title, subtitle: h.snippet, icon: <FileIcon />, run: () => openHit(h) })
          } else if (h.kind === 'memory') {
            out.push({ id: h.id, group: 'Memory', title: h.title, subtitle: h.snippet, icon: <MemoryIcon />, run: () => setPanel('memory') })
          } else if (h.kind === 'agent' && h.botId) {
            const botId = h.botId
            out.push({
              id: h.id,
              group: 'Agents',
              title: h.title,
              subtitle: h.snippet,
              icon: <BlobAvatar hue={botId} size={16} />,
              run: () => openBot(botId),
            })
          }
        }
      } catch {
        /* search is best-effort */
      }
      try {
        const noteHits = await api.searchNotes(q, { limit: 8 })
        for (const n of noteHits) {
          out.push({
            id: `note-${n.id}`,
            group: 'Notes',
            title: n.title || 'Untitled note',
            subtitle: n.snippet,
            icon: <NotesIcon />,
            run: () => setPanel('notes'),
          })
        }
      } catch {
        /* notes are best-effort */
      }
      return out.slice(0, 40)
    },
    [bots, openBot, openHit, setPanel],
  )

  const newAgent = useCallback(
    async (tpl?: JobTemplate) => {
      try {
        const bot = await api.createBot(tpl ? { name: tpl.name, job: tpl.job } : undefined)
        upsertBot(bot)
        openBot(bot.id)
        setComposer('')
        setEditor({ name: bot.name, job: bot.job })
        requestAnimationFrame(() => document.getElementById('composer')?.focus())
      } catch (err) {
        void alertDialog({ title: 'Something went wrong', body: (err as Error).message })
      }
    },
    [upsertBot, openBot],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!setupReady) return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'n') return
      e.preventDefault()
      void newAgent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newAgent, setupReady])

  const send = useCallback(
    async (preset?: string) => {
      const text = (preset ?? composer).trim()
      const files = preset ? [] : attachments.map((a) => a.path)
      if (!setupReady || (!text && files.length === 0) || sending) return
      setSending(true)
      stickRef.current = true
      try {
        let bot = selected
        if (!bot) {
          bot = await api.createBot()
          upsertBot(bot)
          openBot(bot.id)
        }
        if (bot.status === 'running') return
        const next = await api.send(bot.id, { text, model: model || undefined, ...(files.length ? { attachments: files } : {}) })
        upsertBot(next)
        if (!preset) {
          setComposer('')
          setAttachments([])
        }
        setStreak(bumpStreak())
        requestAnimationFrame(() => scrollToEnd(true))
      } catch (err) {
        void alertDialog({ title: 'Something went wrong', body: (err as Error).message })
      } finally {
        setSending(false)
      }
    },
    [composer, sending, selected, model, attachments, upsertBot, openBot, scrollToEnd, setupReady],
  )

  const pickFiles = useCallback(() => fileInputRef.current?.click(), [])

  const removeAttachment = useCallback((path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path))
  }, [])

  const onFilesPicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    const tooBig = picked.filter((f) => f.size > MAX_ATTACH_BYTES)
    const ok = picked.filter((f) => f.size <= MAX_ATTACH_BYTES)
    if (tooBig.length) {
      void alertDialog({
        title: 'File too large',
        body: `Attachments must be 10MB or smaller. Skipped: ${tooBig.map((f) => f.name).join(', ')}.`,
      })
    }
    if (!ok.length) return
    try {
      const payload = await Promise.all(
        ok.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
      )
      const paths = await api.importFiles(payload)
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        const next = [...prev]
        ok.forEach((f, i) => {
          const p = paths[i]
          if (!p || seen.has(p)) return
          seen.add(p)
          next.push({ path: p, name: f.name, isImage: f.type.startsWith('image/') })
        })
        return next
      })
    } catch (err) {
      void alertDialog({ title: 'Could not attach files', body: (err as Error).message })
    }
  }, [])

  const saveEditor = useCallback(async () => {
    if (!selected || !editor) return
    const next = await api.renameBot(selected.id, { name: editor.name.trim() || selected.name, job: editor.job })
    upsertBot(next)
    setEditor(null)
  }, [selected, editor, upsertBot])

  const commitRename = useCallback(
    async (bot: Bot, name: string) => {
      setRenamingId(null)
      const trimmed = name.trim()
      if (!trimmed || trimmed === bot.name) return
      try {
        upsertBot(await api.renameBot(bot.id, { name: trimmed }))
      } catch (err) {
        void alertDialog({ title: 'Something went wrong', body: (err as Error).message })
      }
    },
    [upsertBot],
  )

  // Reorder optimistically, then persist. The ids mirror the visible (grouped) order;
  // the rank re-sort keeps pinned/archived grouping intact afterwards.
  const moveBot = useCallback(
    (draggedId: string, targetId: string, before: boolean) => {
      if (!draggedId || draggedId === targetId) return
      const ids = visible.map((b) => b.id)
      const from = ids.indexOf(draggedId)
      if (from < 0) return
      ids.splice(from, 1)
      let to = ids.indexOf(targetId)
      if (to < 0) return
      if (!before) to += 1
      ids.splice(to, 0, draggedId)
      setBots((prev) =>
        prev.map((b) => {
          const i = ids.indexOf(b.id)
          return i >= 0 && b.order !== i ? { ...b, order: i } : b
        }),
      )
      void api.reorderBots(ids).catch(() => undefined)
    },
    [visible],
  )

  const menuItemsFor = (bot: Bot): MenuItem[] => [
    { label: 'Open', onClick: () => openBot(bot.id) },
    {
      label: 'Rename',
      onClick: () => {
        openBot(bot.id)
        setRenamingId(bot.id)
      },
    },
    {
      label: 'Edit agent…',
      onClick: () => {
        openBot(bot.id)
        setEditor({ name: bot.name, job: bot.job })
      },
    },
    {
      label: 'Duplicate',
      onClick: () =>
        void api.duplicateBot(bot.id).then((b) => {
          upsertBot(b)
          openBot(b.id)
        }),
    },
    {
      label: bot.pinned ? 'Unpin' : 'Pin to top',
      checked: Boolean(bot.pinned),
      separatorBefore: true,
      onClick: () => void api.setBotFlags(bot.id, { pinned: !bot.pinned }).then(upsertBot),
    },
    {
      label: bot.watchMode ? 'Stop watching' : 'Watch workspace',
      checked: Boolean(bot.watchMode),
      onClick: () => void api.setWatchMode(bot.id, !bot.watchMode).then(upsertBot),
    },
    {
      label: bot.archived ? 'Unarchive' : 'Archive',
      checked: Boolean(bot.archived),
      onClick: () => void api.setBotFlags(bot.id, { archived: !bot.archived }).then(upsertBot),
    },
    {
      label: 'Clear chat',
      separatorBefore: true,
      onClick: () => {
        void confirmDialog({
          title: `Clear chat with ${bot.name}?`,
          body: 'This permanently removes the conversation history for this agent.',
          confirmLabel: 'Clear chat',
        }).then((ok) => {
          if (ok) void api.clearThread(bot.id).then(upsertBot)
        })
      },
    },
    {
      label: 'Delete agent',
      danger: true,
      separatorBefore: true,
      onClick: () => {
        void confirmDialog({
          title: `Delete ${bot.name}?`,
          body: 'This agent and its history will be removed. This cannot be undone.',
          confirmLabel: 'Delete',
          danger: true,
        }).then((ok) => {
          if (ok) void api.deleteBot(bot.id)
        })
      },
    },
  ]

  const statusLabel = boot === 'online' ? 'Live' : boot === 'starting' ? 'Starting…' : 'Offline'
  const lastWasResult = selected?.status === 'idle' && visibleThread.at(-1)?.role === 'assistant'
  const hasResult = Boolean(
    selected && ((selected.runDiff && (selected.runDiff.added.length || selected.runDiff.changed.length || selected.runDiff.removed.length)) || selected.artifacts?.length),
  )
  const openPanel = useCallback((p: Panel) => setPanel((cur) => (cur === p ? 'none' : p)), [])
  openSchedulesRef.current = () => setPanel('routines')

  const openNoteCapture = useCallback((text: string) => {
    setCapture(text.trim())
    setCaptureQuery('')
    setCaptureHits([])
  }, [])

  // Keep the capture dialog's search list fresh, and search as the user types.
  useEffect(() => {
    if (capture === null) return
    const q = captureQuery.trim()
    if (!q) {
      setCaptureHits([])
      return
    }
    let cancelled = false
    void api
      .searchNotes(q, { limit: 20 })
      .then((rows) => {
        if (!cancelled) setCaptureHits(rows)
      })
      .catch(() => {
        if (!cancelled) setCaptureHits([])
      })
    return () => {
      cancelled = true
    }
  }, [capture, captureQuery, notes])

  const panelOpen = panel !== 'none'
  useEffect(() => {
    if (panel !== 'none') lastPanelRef.current = panel
  }, [panel])
  const activePanel: Exclude<Panel, 'none'> = panelOpen ? (panel as Exclude<Panel, 'none'>) : lastPanelRef.current

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  const modKey = isMac ? '⌘' : 'Ctrl'

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'new', group: 'Actions', label: 'New agent', hint: `${modKey} N`, keywords: 'create bot spawn', icon: <PlusIcon size={14} />, run: () => void newAgent() },
      { id: 'activity', group: 'Actions', label: 'Toggle activity panel', hint: `${modKey} B`, keywords: 'events log run', icon: <ActivityIcon />, run: () => openPanel('activity') },
      { id: 'settings', group: 'Actions', label: 'Open settings', keywords: 'preferences config accent', icon: <GearIcon />, run: () => openPanel('settings') },
      { id: 'rooms', group: 'Actions', label: 'Open rooms', keywords: 'multi agent', icon: <RoomsIcon />, run: () => openPanel('rooms') },
      { id: 'routines', group: 'Actions', label: 'Open schedules', keywords: 'routine cron recurring', icon: <RoutineIcon />, run: () => openPanel('routines') },
      { id: 'memory', group: 'Actions', label: 'Open memory', keywords: 'notes context', icon: <MemoryIcon />, run: () => openPanel('memory') },
      { id: 'notes', group: 'Actions', label: 'Open notes', keywords: 'notebook scratchpad jot', icon: <NotesIcon />, run: () => openPanel('notes') },
      { id: 'connectors', group: 'Actions', label: 'Open connectors', keywords: 'integrations tools', icon: <PlugIcon />, run: () => openPanel('connectors') },
    ]
    if (selected) {
      list.push({ id: 'focus', group: 'Current agent', label: `Open ${selected.name}`, keywords: selected.job, icon: <BlobAvatar hue={selected.hue} size={16} />, run: () => openBot(selected.id) })
      QUICK.forEach((q, i) =>
        list.push({ id: `quick-${i}`, group: 'Current agent', label: q.label, hint: 'send', keywords: q.text, icon: <SendIcon />, run: () => void send(q.text) }),
      )
    }
    visible.forEach((b) =>
      list.push({ id: `bot-${b.id}`, group: 'Agents', label: b.name, keywords: `${b.job} ${b.preview ?? ''}`, icon: <BlobAvatar hue={b.hue} size={16} />, run: () => openBot(b.id) }),
    )
    templates.forEach((t) =>
      list.push({ id: `tpl-${t.name}`, group: 'Templates', label: t.name, keywords: t.job, icon: <SparkIcon />, run: () => void newAgent(t) }),
    )
    routines.forEach((r) => {
      const bot = bots.find((b) => b.id === r.botId)
      list.push({
        id: `routine-${r.id}`,
        group: 'Schedules',
        label: r.prompt,
        hint: `${scheduleLabel(r.schedule)}${r.enabled ? '' : ' · paused'}`,
        keywords: `reminder routine schedule ${r.schedule} recurring cron ${r.origin ?? ''} ${bot?.name ?? ''}`,
        icon: <RoutineIcon />,
        run: () => {
          setRoutineFocus({ id: r.id, nonce: Date.now() })
          setPanel('routines')
        },
      })
    })
    THEMES.forEach((t) =>
      list.push({ id: `theme-${t.name}`, group: 'Accent', label: `${t.label}`, hint: theme === t.name ? 'active' : undefined, keywords: 'theme color palette vibe', icon: <PaletteIcon />, run: () => setTheme(t.name) }),
    )
    ;(['dark', 'light'] as Mode[]).forEach((m) =>
      list.push({ id: `mode-${m}`, group: 'Appearance', label: `${m === 'dark' ? 'Dark' : 'Light'} mode`, hint: mode === m ? 'active' : undefined, keywords: 'theme dark light appearance mode', icon: <ModeIcon />, run: () => setMode(m) }),
    )
    return list
  }, [modKey, newAgent, openPanel, selected, openBot, send, visible, templates, theme, mode, routines, bots])

  // ── First-run blocking screen ──────────────────────────────────────────────
  if (cliMissing) {
    return (
      <div className="app-shell flex h-full flex-col items-center justify-center gap-6 px-10" style={{ color: 'var(--text-primary)' }}>
        <div className="window-drag absolute top-0 left-0 right-0 h-11 flex items-center px-4" style={{ background: 'var(--sidebar-tint)' }}>
          <TrafficLights />
        </div>
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <Logo size={44} />
          <h1 className="text-[22px] font-semibold tracking-tight">Welcome to Red Sky</h1>
          <p className="text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Red Sky needs the <strong>OpenCode CLI</strong> to run agents on your machine. It was not found on your{' '}
            <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)', fontSize: '12px' }}>
              PATH
            </code>
            .
          </p>
        </div>

        <div className="w-full max-w-sm rounded-2xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
          <Step n={1} done={false}>
            Install the OpenCode CLI
            <a href="https://opencode.ai" target="_blank" rel="noreferrer" className="ml-2 underline font-medium" style={{ color: 'var(--text-accent)' }}>
              opencode.ai →
            </a>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Run <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>npm i -g opencode@latest</code> or download from the site. This is not Ollama.
            </p>
          </Step>
          <Step n={2} done={false}>
            Configure a model provider
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Run <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>opencode</code> in a terminal and pick Anthropic, OpenAI, or another provider.
            </p>
          </Step>
          <Step n={3} done={false}>
            Relaunch Red Sky
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Once <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>opencode --version</code> works in a terminal, restart this app.
            </p>
          </Step>
        </div>

        <p className="text-[11px] max-w-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
          Stuck? Set <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>OPENCODE_BIN</code> to the full path of your <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>opencode</code> binary and relaunch.
        </p>
      </div>
    )
  }

  const renderBotRow = (b: Bot, i: number): React.JSX.Element => (
    <BotRow
      key={b.id}
      bot={b}
      index={i}
      active={b.id === selected?.id}
      unread={Boolean(unread[b.id])}
              onSelect={() => openBot(b.id)}
              menuItems={menuItemsFor(b)}
              renaming={renamingId === b.id}
      onRename={(name) => void commitRename(b, name)}
      onRenameCancel={() => setRenamingId(null)}
      dragging={dragId === b.id}
      dropBefore={dropTarget?.id === b.id && dropTarget.before}
      dropAfter={dropTarget?.id === b.id && !dropTarget.before}
      onDragStart={() => setDragId(b.id)}
      onDragOver={(before) => {
        if (dragId && dragId !== b.id) setDropTarget({ id: b.id, before })
      }}
      onDrop={() => {
        if (dragId && dropTarget?.id === b.id) moveBot(dragId, b.id, dropTarget.before)
        setDragId(null)
        setDropTarget(null)
      }}
      onDragEnd={() => {
        setDragId(null)
        setDropTarget(null)
      }}
    />
  )

  return (
    <div className="app-shell flex h-full text-[var(--text-primary)]">
      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside className="w-[276px] shrink-0 flex flex-col relative" style={{ background: 'var(--sidebar-tint)' }}>
        <div className="absolute top-0 right-0 bottom-0 w-px" style={{ background: 'var(--border)' }} />

        <div className="window-drag h-11 px-4 flex items-center shrink-0">
          <TrafficLights />
          <span className="window-no-drag ml-3">
            <Logo />
          </span>
        </div>

        <div className="window-no-drag px-2.5 mb-2">
          <Button
            onClick={() => void newAgent()}
            disabled={boot !== 'online'}
            className="w-full h-9 rounded-[10px] gap-2 text-[13px] font-medium btn-sheen pressable"
            style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}
          >
            <PlusIcon size={15} />
            New chat
          </Button>
        </div>

        <label
          className="window-no-drag mx-2.5 mb-1.5 h-9 rounded-[10px] flex items-center gap-2 px-2.5"
          style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)', color: 'var(--sidebar-faint)' }}
        >
          <IonIcon name="search-outline" size={16} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents"
            className="min-w-0 flex-1 h-auto bg-transparent border-0 shadow-none px-0 text-[13px] leading-[18px] text-[var(--sidebar-text)] placeholder:text-[var(--sidebar-faint)] focus-visible:ring-0"
          />
        </label>

        <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
          {search.trim() && visible.length > 0 ? <SidebarSection label="Agents" /> : null}
          {!search.trim() && groups.pinned.length > 0 ? <SidebarSection label="Pinned" /> : null}
          {groups.pinned.map((b, i) => renderBotRow(b, i))}
          {!search.trim() && groups.pinned.length > 0 && groups.recent.length > 0 ? <SidebarSection label="Recents" /> : null}
          {groups.recent.map((b, i) => renderBotRow(b, groups.pinned.length + i))}
          {groups.archived.length > 0 ? <SidebarSection label="Archived" /> : null}
          {groups.archived.map((b, i) => renderBotRow(b, groups.pinned.length + groups.recent.length + i))}
          {!search.trim() && rooms.length > 0 ? <SidebarSection label="Rooms" /> : null}
          {!search.trim() &&
            rooms.map((r) => {
              const members = r.participantIds.map((id) => bots.find((b) => b.id === id)).filter(Boolean) as Bot[]
              return (
                <button
                  key={r.id}
                  onClick={() => openPanel('rooms')}
                  title={members.map((m) => m.name).join(', ') || 'No agents'}
                  className="w-full text-left rounded-[8px] px-2.5 py-1.5 mb-0.5 hover:bg-[var(--sidebar-hover)] pressable"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex -space-x-1.5 shrink-0">
                      {members.slice(0, 3).map((m) => (
                        <BlobAvatar key={m.id} hue={m.hue} size={16} />
                      ))}
                      {!members.length ? <IonIcon name="people-outline" size={15} style={{ color: 'var(--sidebar-muted)' }} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] truncate" style={{ color: 'var(--sidebar-text)' }}>
                        {r.title}
                      </span>
                      <span className="block text-[10.5px] truncate" style={{ color: 'var(--sidebar-muted)' }}>
                        {members.length ? members.map((m) => m.name).join(', ') : 'No agents'}
                        {members.length > 3 ? ` +${members.length - 3}` : ''}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          {!bots.length && (
            <p className="px-3 py-6 text-[12px] leading-relaxed" style={{ color: 'var(--sidebar-faint)' }}>
              Create an agent, give it a job, get a hit of finished work.
            </p>
          )}
          {bots.length > 0 && !visible.length && (
            <p className="px-3 py-6 text-[12px] leading-relaxed" style={{ color: 'var(--sidebar-faint)' }}>
              No agents match “{search.trim()}”.
            </p>
          )}
          {hits.length > 0 && (
            <div>
              <SidebarSection label="Workspace" />
              {hits.map((h) => (
                <button key={h.id} onClick={() => openHit(h)} title={h.path} className="w-full text-left rounded-[8px] px-2.5 py-1.5 mb-0.5 hover:bg-[var(--sidebar-hover)]">
                  <span className="block text-[12px] truncate" style={{ color: 'var(--sidebar-text)' }}>
                    {h.title}
                  </span>
                  <span className="block text-[11px] truncate mt-0.5" style={{ color: 'var(--sidebar-muted)' }}>
                    {h.snippet}
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {sectionsOpen ? (
          <div className="px-1.5 py-2 shrink-0" style={{ borderTop: '0.5px solid var(--border)' }}>
            <button
              onClick={() => {
                setSectionsOpen(false)
                try {
                  localStorage.setItem('redsky.sections', '0')
                } catch {
                  /* ignore */
                }
              }}
              title="Collapse app tools"
              className="w-full flex items-center justify-between rounded-[8px] pl-2.5 pr-1.5 py-1 hover:bg-[var(--sidebar-hover)] pressable"
            >
              <span className="text-[10.5px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--sidebar-faint)' }}>
                App
              </span>
              <span className="w-5 h-5 flex items-center justify-center" style={{ color: 'var(--sidebar-faint)' }}>
                <IonIcon name="chevron-down-outline" size={14} />
              </span>
            </button>
            <NavItem active={panel === 'rooms'} onClick={() => openPanel('rooms')} icon={<IonIcon name="people-outline" size={16} />} label="Rooms" />
            <NavItem active={panel === 'routines'} onClick={() => openPanel('routines')} icon={<IonIcon name="calendar-outline" size={16} />} label="Schedules" />
            <NavItem active={panel === 'memory'} onClick={() => openPanel('memory')} icon={<IonIcon name="library-outline" size={16} />} label="Memory" />
            <NavItem active={panel === 'notes'} onClick={() => openPanel('notes')} icon={<IonIcon name="document-text-outline" size={16} />} label="Notes" />
            <NavItem active={panel === 'history'} onClick={() => openPanel('history')} icon={<IonIcon name="time-outline" size={16} />} label="History" />
            <NavItem active={panel === 'connectors'} onClick={() => openPanel('connectors')} icon={<IonIcon name="git-network-outline" size={16} />} label="Connectors" />
            <NavItem active={panel === 'settings'} onClick={() => openPanel('settings')} icon={<IonIcon name="settings-outline" size={16} />} label="Settings" />
          </div>
        ) : (
          <div className="px-1.5 py-1.5 shrink-0 flex justify-center" style={{ borderTop: '0.5px solid var(--border)' }}>
            <IconBtn
              active={panel !== 'none'}
              onClick={() => {
                setSectionsOpen(true)
                try {
                  localStorage.setItem('redsky.sections', '1')
                } catch {
                  /* ignore */
                }
              }}
              title="App tools: rooms, schedules, memory, connectors, settings"
            >
              <IonIcon name="chevron-up-outline" size={14} />
            </IconBtn>
          </div>
        )}

        <div className="px-3.5 pb-3.5 pt-2 flex items-center gap-2 shrink-0" style={{ borderTop: '0.5px solid var(--border)' }}>
          <StatusDot status={boot} />
          <span className="text-[12px] truncate" style={{ color: 'var(--sidebar-muted)' }}>
            {statusLabel}
          </span>
          {streak > 1 && (
            <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--text-warning)' }}>
              {streak}d streak
            </span>
          )}
        </div>
      </aside>

      {/* ── Center ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--chat-fill)' }}>
        <header className="window-drag h-11 flex items-center gap-2 px-3 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
          {selected ? (
            <button className="window-no-drag flex items-center gap-2.5 min-w-0 rounded-lg px-1.5 py-1 hover:bg-[var(--bg-hover)]" onClick={() => setEditor({ name: selected.name, job: selected.job })}>
              <BlobAvatar hue={selected.hue} size={24} />
              <span className="text-[13.5px] font-semibold truncate">{selected.name}</span>
              <StatusDot status={selected.status} />
              <span className="text-[11.5px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                {selected.status === 'running'
                  ? selected.activity || 'Working…'
                  : selected.status === 'waiting'
                    ? 'Needs you'
                    : selected.status === 'error'
                      ? 'Error'
                      : 'Ready'}
              </span>
            </button>
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
              Meet your first agent
            </span>
          )}
          <div className="window-no-drag ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="window-no-drag flex h-auto items-center gap-1.5 text-[11.5px] pl-2.5 pr-2 py-1.5 rounded-lg pressable hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
              title="Search everything"
            >
              <SearchIcon />
              <span className="hidden md:inline">Search</span>
            </button>
            <IconBtn active={false} onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <ModeIcon />
            </IconBtn>
            <Button
              variant="outline"
              onClick={() => setPalette(true)}
              className="window-no-drag flex h-auto items-center gap-1.5 text-[11.5px] pl-2.5 pr-1.5 py-1.5 rounded-lg pressable"
              style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
              title="Command palette"
            >
              <CommandIcon />
              <span className="hidden lg:inline">Commands</span>
              <span className="cmdk-kbd">{modKey} K</span>
            </Button>
            <IconBtn active={panel === 'activity'} onClick={() => openPanel('activity')} title="Activity panel">
              <ActivityIcon />
            </IconBtn>
            <IconBtn active={panel === 'notices'} onClick={() => openPanel('notices')} title="Notifications">
              <span className="relative">
                <BellIcon />
                {unreadNotices > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700 }}>
                    {unreadNotices > 9 ? '9+' : unreadNotices}
                  </span>
                )}
              </span>
            </IconBtn>
            <Button
              variant="outline"
              onClick={() => void api.openFeedback()}
              className="window-no-drag h-auto text-[11px] px-2.5 py-1.5 rounded-lg"
              style={{ color: 'var(--text-accent)', border: '0.5px solid color-mix(in srgb, var(--text-accent) 40%, transparent)' }}
              title="Report a beta bug or request a feature — opens a prefilled GitHub issue"
            >
              Beta
            </Button>
          </div>
        </header>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div
              ref={threadRef}
              className="flex-1 overflow-y-auto px-6 py-6"
              onScroll={(e) => {
                const el = e.currentTarget
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96
                setShowJump(!stickRef.current)
              }}
            >
              {selected ? (
                <div className="mx-auto w-full max-w-3xl space-y-4">
                  {selected.job && !visibleThread.length && (
                    <p className="text-[13px] max-w-lg" style={{ color: 'var(--text-tertiary)' }}>
                      {selected.job}
                    </p>
                  )}
                  {visibleThread.map((m, i) => (
                    <MessageBlock
                      key={m.id ?? `${selected.id}-${i}`}
                      role={m.role}
                      text={m.role === 'assistant' ? stripThinking(m.text) : m.text}
                      kind={m.kind}
                      hue={selected.hue}
                      name={selected.name}
                      streaming={selected.status === 'running' && i === visibleThread.length - 1 && m.role === 'assistant'}
                      editing={editingId === m.id}
                      draft={editingId === m.id ? draft : undefined}
                      onDraft={setDraft}
                      onSave={() => {
                        if (!m.id) return
                        void api.patchMessage(selected.id, m.id, draft).then(upsertBot)
                        setEditingId(null)
                      }}
                      onCancel={() => setEditingId(null)}
                      onCopy={() => void navigator.clipboard.writeText(m.text)}
                      onEdit={() => {
                        if (!m.id) return
                        setEditingId(m.id)
                        setDraft(m.text)
                      }}
                      onDelete={() => {
                        if (!m.id) return
                        void api.deleteMessage(selected.id, m.id).then(upsertBot)
                      }}
                      onResend={
                        m.role === 'user' && m.id
                          ? () => {
                              stickRef.current = true
                              void api.resendFrom(selected.id, m.id!, model || undefined).then(upsertBot)
                            }
                          : undefined
                      }
                      onBranch={
                        m.role === 'assistant' && m.id
                          ? () => {
                              stickRef.current = true
                              void api.branchFrom(selected.id, m.id!, model || undefined).then((b) => {
                                upsertBot(b)
                                openBot(b.id)
                              })
                            }
                          : undefined
                      }
                      onAddToNote={(text) => openNoteCapture(text)}
                    />
                  ))}

                  {selected.status === 'running' && <WorkingWindow hue={selected.hue} name={selected.name} />}

                  {lastWasResult && !hasResult && <ActivitySummary bot={selected} onOpen={() => setPanel('activity')} />}

                  {lastWasResult && (
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK.map((q, i) => (
                        <Button
                          key={q.label}
                          variant="outline"
                          onClick={() => void send(q.text)}
                          className="h-auto rounded-full px-3 py-1.5 text-[12px] pressable motion-rise"
                          style={{ border: '0.5px solid var(--border)', color: 'var(--text-secondary)', animationDelay: `${i * 45}ms` }}
                        >
                          {q.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {selected.pendingPermission && (
                    <ApprovalCard bot={selected} onRespond={(response) => void api.permission({ botId: selected.id, permissionId: selected.pendingPermission!.id, response })} />
                  )}
                  {selected.error && (
                    <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: 'color-mix(in srgb, var(--text-danger) 12%, transparent)', color: 'var(--text-danger)', border: '0.5px solid color-mix(in srgb, var(--text-danger) 30%, transparent)' }}>
                      {selected.error}
                    </div>
                  )}
                  <div className="h-2" />
                </div>
              ) : (
                <EmptyState templates={templates} bots={bots} onOpen={openBot} onPick={(t) => void newAgent(t)} onNew={() => void newAgent()} />
              )}
            </div>

            {showJump && (
              <Button
                variant="outline"
                onClick={() => {
                  stickRef.current = true
                  scrollToEnd(true)
                  setShowJump(false)
                }}
                className="absolute bottom-28 right-8 h-auto rounded-full px-3 py-1.5 text-[12px]"
                style={{ background: 'var(--raised)', border: '0.5px solid var(--border)' }}
              >
                Jump to latest
              </Button>
            )}

            {nextHit && (
              <Button
                onClick={() => openBot(nextHit.id)}
                className="absolute bottom-28 left-8 h-auto rounded-full px-3 py-1.5 text-[12px] gap-2"
                style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}
              >
                Next hit · {nextHit.name}
              </Button>
            )}

            <footer className="px-6 pb-5 pt-2">
              <div className="mx-auto w-full max-w-3xl">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void onFilesPicked(e)}
                />
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {attachments.map((a) => (
                      <span
                        key={a.path}
                        className="flex items-center gap-1.5 rounded-full pl-2 pr-1 py-1 text-[11.5px]"
                        style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                        title={a.name}
                      >
                        {a.isImage ? <IonIcon name="image-outline" size={13} /> : <FileIcon />}
                        <span className="max-w-[160px] truncate">{shortAttachName(a.name)}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.path)}
                          title="Remove attachment"
                          className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-[var(--bg-hover)] pressable"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          <IonIcon name="close-outline" size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className={`flex items-end gap-2 rounded-2xl px-2.5 py-2${selected?.status === 'running' ? ' composer-running' : ''}`} style={{ background: 'var(--raised)', border: '0.5px solid var(--border)' }}>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="w-8 h-8 shrink-0 rounded-full pressable"
                    style={{ background: 'var(--fill-secondary)', color: 'var(--text-secondary)' }}
                    title="Attach files or images"
                    onClick={pickFiles}
                  >
                    <PlusIcon size={15} />
                  </Button>
                  <Textarea
                    id="composer"
                    rows={1}
                    value={composer}
                    onChange={(e) => {
                      setComposer(e.target.value)
                      e.currentTarget.style.height = 'auto'
                      e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 140)}px`
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    placeholder={selected?.status === 'running' ? 'Working on it…' : selected ? `Message ${selected.name} — try “remind me to drink water each min”` : 'Drop a task. Get a hit.'}
                    disabled={selected?.status === 'running'}
                    className="flex-1 min-h-0 resize-none bg-transparent border-0 shadow-none px-1.5 py-1.5 text-[14px] leading-5 max-h-[140px] focus-visible:ring-0"
                    style={{ color: 'var(--text-primary)' }}
                  />
                  {selected?.status === 'running' ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => void api.abortBot(selected.id)}
                      className="w-8 h-8 shrink-0 rounded-full pressable"
                      style={{ background: 'var(--fill-secondary)', color: 'var(--text-warning)' }}
                      title="Stop"
                    >
                      <StopIcon />
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      onClick={() => void send()}
                      disabled={sending || (!composer.trim() && !attachments.length) || boot !== 'online'}
                      className="w-8 h-8 shrink-0 rounded-full pressable"
                      style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}
                      title="Send"
                    >
                      <SendIcon />
                    </Button>
                  )}
                </div>
              </div>
            </footer>
          </div>

          {/* ── Right panel ──────────────────────────────────────── */}
          <aside
            className="shrink-0 overflow-hidden panel-collapse flex flex-col"
            style={{
              width: panelOpen ? 368 : 0,
              borderLeft: panelOpen ? '0.5px solid var(--border)' : '0.5px solid transparent',
              background: 'var(--panel-fill)',
            }}
            aria-hidden={!panelOpen}
          >
            <div
              className="w-[368px] flex-1 flex flex-col min-h-0"
              style={{
                opacity: panelOpen ? 1 : 0,
                transform: panelOpen ? 'none' : 'translateX(18px)',
                transition: 'opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out)',
                pointerEvents: panelOpen ? 'auto' : 'none',
              }}
            >
              {activePanel === 'activity' && (
                <ActivityPanel
                  bot={selected}
                  files={files}
                  fileView={fileView}
                  onOpenWorkspace={() => void api.openWorkspace()}
                  onOpenFile={async (p) => {
                    const content = await api.fileContent(p)
                    setFileView({ path: p, content })
                  }}
                  onCollapse={() => setPanel('none')}
                />
              )}
              {activePanel === 'notices' && (
                <>
                  <PanelHeader
                    title="Notifications"
                    subtitle="When an agent finishes, it lands here."
                    onClose={() => setPanel('none')}
                    action={
                      <div className="flex gap-2">
                        <Button variant="link" onClick={() => void api.markAllNoticesRead().then(setNotices)} className="h-auto p-0 text-[11px]" style={{ color: 'var(--text-accent)' }}>
                          Read all
                        </Button>
                        <Button variant="link" onClick={() => void api.clearNotices().then(() => setNotices([]))} className="h-auto p-0 text-[11px]" style={{ color: 'var(--text-danger)' }}>
                          Clear
                        </Button>
                      </div>
                    }
                  />
                  <div className="flex-1 overflow-y-auto p-2">
                    {notices.map((n, i) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          openBot(n.botId)
                          void api.markNoticeRead(n.id).then(setNotices)
                        }}
                        className="w-full text-left rounded-[12px] px-3 py-2 mb-1 motion-rise card-hover"
                        style={{ background: n.read ? 'transparent' : 'var(--bg-card)', animationDelay: `${i * 30}ms` }}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="text-[12px] font-medium">{n.title}</span>
                          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            {timeLabel(n.at)}
                          </span>
                        </div>
                        <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          {n.body}
                        </p>
                      </button>
                    ))}
                    {!notices.length && (
                      <p className="px-3 py-8 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                        When an agent finishes, it lands here. Check back for the next hit.
                      </p>
                    )}
                  </div>
                </>
              )}
              {activePanel === 'rooms' && <RoomsPanel rooms={rooms} bots={bots} onChange={setRooms} onClose={() => setPanel('none')} />}
              {activePanel === 'memory' && <MemoryPanel memories={memories} botId={selected?.id} onChange={setMemories} onClose={() => setPanel('none')} />}
              {activePanel === 'notes' && <NotesPanel notes={notes} onChange={setNotes} openNote={noteFocus} onClose={() => setPanel('none')} />}
              {activePanel === 'history' && <HistoryPanel history={history} onOpen={(id) => { void openBot(id); setPanel('none') }} onClose={() => setPanel('none')} />}
              {activePanel === 'routines' && <RoutinePanel routines={routines} bots={bots} selectedId={selected?.id} focusId={routineFocus?.id} focusNonce={routineFocus?.nonce} onChange={setRoutines} onClose={() => setPanel('none')} />}
              {activePanel === 'connectors' && <ConnectorsPanel connectors={connectors} onChange={setConnectors} onClose={() => setPanel('none')} />}
              {activePanel === 'settings' && settings && <SettingsPanel settings={settings} theme={theme} base={base} mode={mode} scale={scale} models={models} model={model} onChange={setSettings} onTheme={setTheme} onBase={setBase} onMode={setMode} onScale={setScale} onModel={setModel} onClose={() => setPanel('none')} />}
            </div>
          </aside>
        </div>
      </main>

      {/* ── Agent editor ───────────────────────────────────────── */}
      <Dialog open={Boolean(editor && selected)} onOpenChange={(open) => { if (!open) setEditor(null) }}>
        {editor && selected && (
          <DialogContent className="w-[440px] max-w-[calc(100%-2rem)] gap-3">
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <BlobAvatar hue={selected.hue} size={28} />
                <DialogTitle>Edit agent</DialogTitle>
              </div>
            </DialogHeader>
            <Input
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              className="w-full h-auto rounded-[10px] px-3 py-2 text-[13px]"
              style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }}
              placeholder="Name"
            />
            <Textarea
              value={editor.job}
              onChange={(e) => setEditor({ ...editor, job: e.target.value })}
              className="w-full rounded-[10px] px-3 py-2 text-[13px] min-h-[88px]"
              style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }}
              placeholder="Job"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveEditor()} className="h-auto rounded-full px-3.5 py-1.5 text-[13px] font-medium" style={{ background: 'var(--fill-emphasis)', color: 'var(--accent-ink)' }}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => void api.setBotFlags(selected.id, { pinned: !selected.pinned }).then(upsertBot)} className="h-auto rounded-full px-3.5 py-1.5 text-[13px]" style={{ background: 'var(--fill-secondary)' }}>
                {selected.pinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button variant="ghost" onClick={() => void api.setBotFlags(selected.id, { archived: !selected.archived }).then(upsertBot)} className="h-auto rounded-full px-3.5 py-1.5 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                {selected.archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void api.duplicateBot(selected.id).then((b) => {
                    upsertBot(b)
                    openBot(b.id)
                    setEditor(null)
                  })
                }}
                className="h-auto rounded-full px-3.5 py-1.5 text-[13px]"
                style={{ background: 'var(--fill-secondary)' }}
              >
                Duplicate
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void confirmDialog({
                    title: `Clear chat with ${selected.name}?`,
                    body: 'This permanently removes the conversation history for this agent.',
                    confirmLabel: 'Clear chat',
                  }).then((ok) => {
                    if (ok) void api.clearThread(selected.id).then(upsertBot)
                  })
                }}
                className="h-auto rounded-full px-3.5 py-1.5 text-[13px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                Clear chat
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  void confirmDialog({
                    title: `Delete ${selected.name}?`,
                    body: 'This agent and its history will be removed. This cannot be undone.',
                    confirmLabel: 'Delete',
                    danger: true,
                  }).then((ok) => {
                    if (ok) {
                      void api.deleteBot(selected.id)
                      setEditor(null)
                    }
                  })
                }}
                className="ml-auto h-auto rounded-full px-3.5 py-1.5 text-[13px]"
                style={{ color: 'var(--text-danger)' }}
              >
                Delete agent
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* ── Add-to-note capture ─────────────────────────────────── */}
      <Dialog open={capture !== null} onOpenChange={(open) => { if (!open) setCapture(null) }}>
        <DialogContent className="w-[460px] max-w-[calc(100%-2rem)] gap-3">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <IonIcon name="document-text-outline" size={18} style={{ color: 'var(--text-accent)' }} />
              <DialogTitle>Add to note</DialogTitle>
            </div>
          </DialogHeader>
          <p
            className="text-[12.5px] leading-[20px] rounded-[10px] px-3 py-2 max-h-[110px] overflow-y-auto border-l-2"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderColor: 'var(--text-accent)' }}
          >
            {capture}
          </p>
          <Input
            autoFocus
            value={captureQuery}
            onChange={(e) => setCaptureQuery(e.target.value)}
            placeholder="Search notes, or leave blank to pick one…"
            className="w-full h-auto rounded-[10px] px-3 py-2 text-[13px]"
            style={{ background: 'var(--bg-tertiary)', border: '0.5px solid var(--border)' }}
          />
          <div className="max-h-[260px] overflow-y-auto space-y-1">
            <button
              onClick={() => {
                void api
                  .createNote({ title: '', body: capture ?? '', source: 'selection', botId: selected?.id })
                  .then(async (note) => {
                    setNotes(await api.listNotes())
                    setPanel('notes')
                    setNoteFocus((prev) => ({ id: note.id, nonce: (prev?.nonce ?? 0) + 1 }))
                    setCapture(null)
                  })
              }}
              className="w-full text-left rounded-[10px] px-3 py-2 text-[13px] font-medium pressable hover:bg-[var(--bg-hover)]"
              style={{ background: 'var(--bg-card)', color: 'var(--text-accent)', border: '0.5px solid var(--border)' }}
            >
              + Create a new note
            </button>
            {(captureQuery.trim() ? captureHits : notes.slice(0, 12)).map((row) => {
              const id = 'id' in row ? row.id : ''
              const title = 'title' in row ? row.title : ''
              const snippet = 'snippet' in row ? row.snippet : row.body.replace(/\s+/g, ' ').slice(0, 120)
              return (
                <button
                  key={id}
                  onClick={() => {
                    void api
                      .appendToNote(id, capture ?? '')
                      .then(async () => {
                        setNotes(await api.listNotes())
                        setPanel('notes')
                        setNoteFocus((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
                        setCapture(null)
                      })
                  }}
                  className="w-full text-left rounded-[10px] px-3 py-2 pressable hover:bg-[var(--bg-hover)]"
                  style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
                >
                  <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {title || 'Untitled note'}
                  </div>
                  {snippet ? (
                    <p className="text-[11px] mt-0.5 line-clamp-1" style={{ color: 'var(--text-tertiary)' }}>
                      {snippet}
                    </p>
                  ) : null}
                </button>
              )
            })}
            {captureQuery.trim() && !captureHits.length && (
              <p className="text-[12px] px-1 py-1" style={{ color: 'var(--text-tertiary)' }}>
                No matches — create a new note instead.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {!setupReady && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 px-10 modal-overlay"
          style={{ background: 'color-mix(in srgb, var(--substrate) 74%, transparent)' }}
        >
          <div className="window-drag absolute top-0 left-0 right-0 h-11 flex items-center px-4" style={{ background: 'var(--sidebar-tint)' }}>
            <TrafficLights />
          </div>

          <div className="relative w-16 h-16 flex items-center justify-center">
            <span className="setup-ring" />
            <span className="setup-ring setup-ring-2" />
            <Logo size={26} />
          </div>

          <div className="text-center max-w-sm">
            <h1 className="text-[20px] font-semibold tracking-tight">Setting up Red Sky</h1>
            <p className="text-[13px] leading-relaxed mt-1.5" style={{ color: 'var(--text-secondary)' }}>
              Getting your OpenCode runtime ready. This only takes a moment.
            </p>
          </div>

          <div
            className="w-full max-w-sm rounded-2xl p-5 text-[12.5px] motion-scale"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div className="setup-list">
              <SetupCheckRow
                label="Local database ready"
                resolved={setup !== null}
                delay={0}
              />
              <SetupCheckRow
                label="OpenCode CLI found"
                resolved={setup !== null}
                ok={Boolean(setup?.opencode.found)}
                delay={1}
              />
              <SetupCheckRow
                label="Model provider configured"
                resolved={models.length > 0}
                delay={2}
              />
              <SetupCheckRow
                label={`OpenCode server ${boot === 'online' ? 'connected' : boot === 'starting' ? 'starting' : 'offline'}`}
                resolved={boot !== 'starting'}
                ok={boot === 'online'}
                delay={3}
              />
            </div>

            {setup !== null && !setup.opencode.found ? (
              <p className="mt-3.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Install the OpenCode CLI, then run{' '}
                <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>opencode</code> once to pick a provider.{' '}
                <a className="underline" style={{ color: 'var(--text-accent)' }} href="https://opencode.ai/docs" target="_blank" rel="noreferrer">
                  Setup guide
                </a>
              </p>
            ) : setup !== null && models.length === 0 ? (
              <p className="mt-3.5 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Run{' '}
                <code className="rounded px-1" style={{ background: 'var(--bg-tertiary)' }}>opencode</code> once in a terminal and choose a provider.{' '}
                <a className="underline" style={{ color: 'var(--text-accent)' }} href="https://opencode.ai/docs" target="_blank" rel="noreferrer">
                  Setup guide
                </a>
              </p>
            ) : null}
          </div>

          <p className="text-[11px] text-center" style={{ color: 'var(--text-tertiary)' }}>
            Actions are paused until setup completes.
          </p>
        </div>
      )}

      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />

      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} search={runGlobalSearch} />

      <ConfirmHost />
      <Toaster />
    </div>
  )
}
