import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { css } from './css'
import { applyTheme } from './theme'
import { api } from './api'
import type { Activity, CalEvent, Capture, DoctorGroup, RegistryEntry, Reminder, WikiPage, WikiTreeDomain } from './api'
import type { Direction, Mode, Screen } from './types'
import { Loading, MarkText, Spinner } from './ui'

const SCREENS: Screen[] = ['today', 'capture', 'ask', 'wiki', 'tasks', 'calendar', 'maintain', 'settings']
let JOB_SEQ = 1
const PREFS_KEY = 'twin.prefs.v1'
const DEFAULT_ACCENT = '#2E8C58'

interface Job { id: number; label: string; note: string }
interface AskMsg { role: 'user' | 'assistant'; text: string }

interface UiState {
  screen: Screen
  mode: Mode
  direction: Direction
  accent: string
  captureDraft: string
  askDraft: string
  reminderDraft: string
  wikiSearch: string
  currentPage: string | null
  editing: boolean
  jobs: Job[]
  ingestBusy: boolean
  ingestDone: boolean
  askBusy: boolean
  askThread: AskMsg[]
  remEditing: string | null
  remDraft: string
  addList: string
  newListDraft: string
  listEditing: string | null
  listDraft: string
  listDeleting: string | null
  calDay: string | null
  prioritiesDraft: string[]
  maintResults: Record<string, string>
}

interface Live {
  loading: boolean
  status: { inbox: number; chats: number; pages: number; tracked: number }
  captures: Capture[]
  reminders: Reminder[]
  lists: string[]
  activity: Activity[]
  wikiTree: WikiTreeDomain[]
  page: WikiPage | null
  registry: RegistryEntry[]
  config: string
  doctor: DoctorGroup[]
  calOk: boolean
  calEvents: CalEvent[]
}

const EMPTY_LIVE: Live = {
  loading: true,
  status: { inbox: 0, chats: 0, pages: 0, tracked: 0 },
  captures: [], reminders: [], lists: [], activity: [], wikiTree: [], page: null,
  registry: [], config: '{}', doctor: [], calOk: false, calEvents: [],
}

function loadPrefs(): { mode: Mode; direction: Direction; accent: string; screen: Screen } {
  const systemDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const base = { mode: (systemDark ? 'dark' : 'light') as Mode, direction: 'A' as Direction, accent: DEFAULT_ACCENT, screen: 'today' as Screen }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p.mode === 'light' || p.mode === 'dark') base.mode = p.mode
      if (typeof p.accent === 'string') base.accent = p.accent
      if (SCREENS.includes(p.screen)) base.screen = p.screen
    }
  } catch { /* ignore */ }
  return base
}

function humanSize(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
const TEXTUAL = /\.(md|markdown|txt|text|json|js|jsx|ts|tsx|csv|tsv|log|ya?ml|toml|sh|bash|zsh|py|rb|go|rs|c|h|cpp|java|html?|css|svg|xml)$/i

function useViewport(): number {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1320))
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

// ---- date helpers (calendar) ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtTime(d: Date): string {
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12; if (h === 0) h = 12
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, '0')} ${ap}`
}
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function fmtClock(d: Date): string {
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12; if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// Order list names to match a reference order (Apple Reminders' sidebar order);
// names not in the reference keep their relative order and fall to the end.
// Array.sort is stable, so ties preserve input order.
function sortByOrder(names: string[], order: string[]): string[] {
  const pos = new Map(order.map((n, i) => [n, i]))
  const rank = (n: string) => (pos.has(n) ? (pos.get(n) as number) : Number.POSITIVE_INFINITY)
  return [...names].sort((a, b) => rank(a) - rank(b))
}

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const prefs = useRef(loadPrefs())
  const [s, setS] = useState<UiState>(() => ({
    screen: prefs.current.screen, mode: prefs.current.mode, direction: prefs.current.direction, accent: prefs.current.accent,
    captureDraft: '', askDraft: '', reminderDraft: '', wikiSearch: '',
    currentPage: null, editing: false, jobs: [], ingestBusy: false, ingestDone: false,
    askBusy: false, askThread: [], remEditing: null, remDraft: '', addList: '',
    newListDraft: '', listEditing: null, listDraft: '', listDeleting: null, calDay: null,
    prioritiesDraft: ['', '', ''], maintResults: {},
  }))
  const [live, setLive] = useState<Live>(EMPTY_LIVE)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const patch = useCallback((p: Partial<UiState>) => setS(prev => ({ ...prev, ...p })), [])
  const update = useCallback((fn: (prev: UiState) => Partial<UiState>) => setS(prev => ({ ...prev, ...fn(prev) })), [])
  const mergeLive = useCallback((p: Partial<Live>) => setLive(prev => ({ ...prev, ...p })), [])

  // ---- theme + persist prefs (incl. current screen, so refresh stays put) ----
  useEffect(() => {
    if (rootRef.current) applyTheme(rootRef.current, s.mode, s.direction, s.accent)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: s.mode, direction: s.direction, accent: s.accent, screen: s.screen })) } catch { /* */ }
  }, [s.mode, s.direction, s.accent, s.screen])

  // ---- live clock (drives "now"-aware schedule + header time) ----
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // ---- keyboard ⌥ 1–8 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      const m = /^Digit([1-8])$/.exec(e.code)
      if (m) { e.preventDefault(); patch({ screen: SCREENS[parseInt(m[1], 10) - 1] }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [patch])

  // ---- data loaders ----
  const reloadStatus = useCallback(async () => { try { mergeLive({ status: await api.status() }) } catch { /* */ } }, [mergeLive])
  const reloadCaptures = useCallback(async () => { try { mergeLive({ captures: (await api.captures()).captures }) } catch { /* */ } }, [mergeLive])
  const reloadReminders = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([api.reminders(), api.reminderLists()])
      mergeLive({ reminders: r.reminders || [], lists: l.lists || [] })
    } catch { /* */ }
  }, [mergeLive])
  const reloadActivity = useCallback(async () => { try { mergeLive({ activity: (await api.activity()).activity }) } catch { /* */ } }, [mergeLive])
  const reloadRegistry = useCallback(async () => { try { mergeLive({ registry: (await api.registry()).registry }) } catch { /* */ } }, [mergeLive])
  const reloadDoctor = useCallback(async () => { try { mergeLive({ doctor: (await api.doctor()).groups }) } catch { /* */ } }, [mergeLive])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [status, caps, rems, lst, act, tree, prof, reg, cfg, doc, cal] = await Promise.all([
        api.status().catch(() => EMPTY_LIVE.status),
        api.captures().catch(() => ({ captures: [] })),
        api.reminders().catch(() => ({ ok: false, reminders: [] as Reminder[] })),
        api.reminderLists().catch(() => ({ ok: false, lists: [] as string[] })),
        api.activity().catch(() => ({ activity: [] })),
        api.wikiTree().catch(() => ({ domains: [] })),
        api.profile().catch(() => ({ priorities: ['', '', ''] })),
        api.registry().catch(() => ({ registry: [] })),
        api.config().catch(() => ({ config: '{}' })),
        api.doctor().catch(() => ({ groups: [] })),
        api.calendar(7).catch(() => ({ ok: false, events: [] as CalEvent[] })),
      ])
      if (!alive) return
      // pick a sensible default wiki page
      let first: string | null = null
      for (const d of tree.domains) { for (const p of d.pages) { if (p.pinned) { first = p.name; break } } if (first) break }
      if (!first) first = tree.domains.flatMap(d => d.pages)[0]?.name ?? null
      setLive({
        loading: false, status, captures: caps.captures, reminders: rems.reminders || [], lists: lst.lists || [], activity: act.activity,
        wikiTree: tree.domains, page: null, registry: reg.registry, config: cfg.config, doctor: doc.groups,
        calOk: cal.ok, calEvents: cal.events || [],
      })
      const defaultList = (lst.lists || []).find(l => l !== 'Reminders') || (lst.lists || [])[0] || ''
      setS(prev => ({ ...prev, prioritiesDraft: prof.priorities, currentPage: prev.currentPage ?? first, addList: prev.addList || defaultList }))
    })()
    return () => { alive = false }
  }, [])

  // ---- load wiki page when selection changes ----
  useEffect(() => {
    if (!s.currentPage) return
    let alive = true
    mergeLive({ page: null }) // show spinner while the new page loads
    api.wikiPage(s.currentPage).then(p => { if (alive) mergeLive({ page: p }) }).catch(() => { /* */ })
    return () => { alive = false }
  }, [s.currentPage, mergeLive])

  // ---- async job wrapper (heavy CLI ops) ----
  const runJob = useCallback(async (label: string, note: string, fn: () => Promise<void>) => {
    const id = JOB_SEQ++
    update(p => ({ jobs: [...p.jobs, { id, label, note }] }))
    try { await fn() } finally { update(p => ({ jobs: p.jobs.filter(j => j.id !== id) })) }
  }, [update])

  // ---- capture ----
  const submitCapture = useCallback(async (text: string) => {
    const t = text.trim(); if (!t) return
    patch({ captureDraft: '', ingestDone: false })
    await api.capture(t)
    await Promise.all([reloadCaptures(), reloadStatus(), reloadActivity()])
  }, [patch, reloadCaptures, reloadStatus, reloadActivity])
  const addCapture = useCallback(() => { submitCapture(s.captureDraft) }, [s.captureDraft, submitCapture])

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files); if (!arr.length) return
    patch({ screen: 'capture' })
    arr.forEach(file => {
      const send = (body: string) => api.capture(body).then(() => Promise.all([reloadCaptures(), reloadStatus(), reloadActivity()]))
      if (TEXTUAL.test(file.name) || /^text\//.test(file.type)) {
        const reader = new FileReader()
        reader.onload = () => { const text = String(reader.result || '').trim(); send(`${file.name} (${humanSize(file.size)})\n\n${text.slice(0, 4000)}`) }
        reader.onerror = () => send(`Attached file: ${file.name} · ${humanSize(file.size)}`)
        reader.readAsText(file)
      } else { send(`Attached file: ${file.name} · ${humanSize(file.size)}`) }
    })
  }, [patch, reloadCaptures, reloadStatus, reloadActivity])

  const onFilePick = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files)
    e.target.value = ''
  }, [addFiles])

  const runIngest = useCallback(() => {
    if (s.ingestBusy || live.status.inbox === 0) return
    patch({ ingestBusy: true, ingestDone: false })
    runJob('ingest', 'folding inbox → wiki on the local Max engine…', async () => {
      const r = await api.job('ingest')
      update(p => ({ ingestBusy: false, ingestDone: true, maintResults: { ...p.maintResults, ingest: (r.output || '').split('\n').slice(-1)[0] || 'done' } }))
      await Promise.all([reloadCaptures(), reloadStatus(), reloadActivity()])
    }).catch(() => patch({ ingestBusy: false }))
  }, [s.ingestBusy, live.status.inbox, patch, runJob, update, reloadCaptures, reloadStatus, reloadActivity])

  // ---- ask ----
  const ask = useCallback((override?: string) => {
    const q = (override ?? s.askDraft).trim()
    if (!q || s.askBusy) return
    update(p => ({ askThread: [...p.askThread, { role: 'user', text: q }], askDraft: '', askBusy: true }))
    runJob('ask', 'reading your wiki on the local Max engine…', async () => {
      const r = await api.ask(q)
      const text = (r.ok && r.answer) ? r.answer : ('Could not answer: ' + (r.error || 'no output'))
      update(p => ({ askBusy: false, askThread: [...p.askThread, { role: 'assistant', text }] }))
    }).catch(() => update(p => ({ askBusy: false, askThread: [...p.askThread, { role: 'assistant', text: 'Ask failed (engine error).' }] })))
  }, [s.askDraft, s.askBusy, update, runJob])

  // ---- reminders (real Apple Reminders) ----
  const addReminder = useCallback(async () => {
    const t = s.reminderDraft.trim(); if (!t) return
    patch({ reminderDraft: '' })
    await api.reminderAdd(t, '', s.addList)
    await Promise.all([reloadReminders(), reloadActivity()])
  }, [s.reminderDraft, s.addList, patch, reloadReminders, reloadActivity])

  const moveReminder = useCallback(async (title: string, list: string) => {
    await api.reminderMove(title, list)
    await reloadReminders()
  }, [reloadReminders])

  // ---- category (list) management ----
  const createList = useCallback(async () => {
    const name = s.newListDraft.trim(); if (!name) return
    patch({ newListDraft: '', addList: name })
    await api.listCreate(name)
    await reloadReminders()
  }, [s.newListDraft, patch, reloadReminders])

  const startRenameList = useCallback((name: string) => patch({ listEditing: name, listDraft: name, listDeleting: null }), [patch])
  const saveRenameList = useCallback(async () => {
    const oldN = s.listEditing, t = s.listDraft.trim()
    patch({ listEditing: null, listDraft: '' })
    if (!oldN || !t || t === oldN) return
    await api.listRename(oldN, t)
    update(p => ({ addList: p.addList === oldN ? t : p.addList }))
    await reloadReminders()
  }, [s.listEditing, s.listDraft, patch, update, reloadReminders])

  const confirmDeleteList = useCallback(async (name: string) => {
    const target = live.lists.find(l => l !== name) || 'Reminders'
    patch({ listDeleting: null })
    await api.listDelete(name, target)
    update(p => ({ addList: p.addList === name ? target : p.addList }))
    await reloadReminders()
  }, [live.lists, patch, update, reloadReminders])

  const completeReminder = useCallback(async (title: string) => {
    await api.reminderDone(title)
    await Promise.all([reloadReminders(), reloadActivity()])
  }, [reloadReminders, reloadActivity])

  const startEdit = useCallback((title: string) => patch({ remEditing: title, remDraft: title }), [patch])
  const saveEdit = useCallback(async () => {
    const oldT = s.remEditing, t = s.remDraft.trim()
    patch({ remEditing: null, remDraft: '' })
    if (!oldT || !t || t === oldT) return
    await api.reminderEdit(oldT, t)
    await Promise.all([reloadReminders(), reloadActivity()])
  }, [s.remEditing, s.remDraft, patch, reloadReminders, reloadActivity])

  const deleteReminder = useCallback(async (title: string) => {
    await api.reminderDelete(title)
    await Promise.all([reloadReminders(), reloadActivity()])
  }, [reloadReminders, reloadActivity])

  // ---- priorities ----
  const setPriority = useCallback((i: number, v: string) => update(p => { const arr = [...p.prioritiesDraft]; arr[i] = v; return { prioritiesDraft: arr } }), [update])
  const savePriorities = useCallback(async () => { await api.setPriorities(s.prioritiesDraft) }, [s.prioritiesDraft])

  // ---- registry ----
  const setProjStatus = useCallback(async (path: string, status: string, name?: string) => {
    await api.setRegistry(path, status, name)
    await Promise.all([reloadRegistry(), reloadStatus()])
  }, [reloadRegistry, reloadStatus])

  // ---- maintenance jobs ----
  const runMaint = useCallback((key: string) => {
    if (s.jobs.some(j => j.label === key)) return
    runJob(key, 'running on the local Max engine…', async () => {
      const r = await api.job(key)
      update(p => ({ maintResults: { ...p.maintResults, [key]: (r.output || '').split('\n').filter(Boolean).slice(-1)[0] || (r.ok ? 'done' : (r.error || 'failed')) } }))
      await Promise.all([reloadActivity(), reloadStatus(), key === 'tidy' || key === 'lint' ? reloadDoctor() : Promise.resolve()])
    }).catch(() => { /* */ })
  }, [s.jobs, runJob, update, reloadActivity, reloadStatus, reloadDoctor])

  const selectPage = useCallback((name: string) => patch({ screen: 'wiki', currentPage: name, editing: false }), [patch])

  // ---- responsive ----
  const vw = useViewport()
  const mobile = vw < 700
  const showRail = vw >= 1000
  const narrow = vw < 820
  const compactBar = vw < 900
  const sidebarW = vw < 860 ? 188 : 212
  useEffect(() => { if (!mobile && drawerOpen) setDrawerOpen(false) }, [mobile, drawerOpen])
  const todayCols = narrow ? '1fr' : '1.12fr .88fr'
  const wikiCols = narrow ? '1fr' : '236px 1fr'
  const halfCols = narrow ? '1fr' : '1fr 1fr'
  const maintCols = vw < 680 ? '1fr' : vw < 1000 ? 'repeat(2,1fr)' : 'repeat(3,1fr)'
  const sideZone = compactBar ? 'flex:0 1 auto;min-width:0' : 'width:200px;flex:0 0 auto'

  // ---- drag & drop ----
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files')
  const onDragEnter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragActive(true) }
  const onDragOver = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  const onDragLeave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragActive(false) }
  const onDrop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragActive(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files) }

  const vm = useMemo(() => buildVM(s, live, nowMs), [s, live, nowMs])
  const today = new Date(nowMs)

  return (
    <div ref={rootRef} className="tw-themed" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} style={css('--bg:#EFEBE0;--panel:#E7E2D5;--surface:#FCFBF6;--surface-2:#F1EDE2;--text:#2A2823;--text-2:#6A655A;--text-3:#938E80;--border:#DCD6C7;--warn:#B0703A;--accent:#2E8C58;--accent-fg:#FBFAF5;--accent-weak:color-mix(in oklab,#2E8C58 16%,#FCFBF6);--radius:12px;--radius-sm:8px;--shadow:0 1px 2px rgba(42,40,35,.05),0 8px 24px -12px rgba(42,40,35,.18);--row-pad:11px;--font-display:\'Newsreader\',Georgia,serif;--font-ui:\'Hanken Grotesk\',system-ui,sans-serif;--font-mono:\'JetBrains Mono\',ui-monospace,monospace;background:#EFEBE0;color:#2A2823;font-family:var(--font-ui);height:100vh;display:flex;flex-direction:column;overflow:hidden;font-size:14px;-webkit-font-smoothing:antialiased')}>

      <input ref={fileInputRef} type="file" multiple onChange={onFilePick} style={{ display: 'none' }} aria-hidden="true" />

      {dragActive && (
        <div style={css('position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:color-mix(in oklab,var(--bg) 78%,transparent);backdrop-filter:blur(2px);pointer-events:none')}>
          <div style={css('display:flex;flex-direction:column;align-items:center;gap:10px;border:2px dashed var(--accent);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow);padding:34px 46px')}>
            <span style={css('font-family:var(--font-mono);font-size:24px;color:var(--accent)')}>+</span>
            <div style={css('font-family:var(--font-display);font-size:20px;font-weight:600')}>Drop to capture</div>
            <div style={css('font-size:12.5px;color:var(--text-2);font-family:var(--font-mono)')}>files land in raw-sources/inbox/</div>
          </div>
        </div>
      )}

      {/* TOPBAR */}
      <div style={css(`display:flex;align-items:center;gap:${compactBar ? 9 : 16}px;height:52px;flex:0 0 52px;padding:0 ${compactBar ? 10 : 16}px;background:var(--panel);border-bottom:1px solid var(--border);z-index:5`)}>
        <div style={css(`display:flex;align-items:center;gap:9px;${sideZone}`)}>
          {mobile && (
            <button className="hov-surface2" onClick={() => setDrawerOpen(o => !o)} title="Menu" aria-label="Open navigation" aria-expanded={drawerOpen} style={css('width:32px;height:32px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:transparent;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer')}>
              <span style={css('width:14px;height:1.5px;background:var(--text-2);border-radius:2px')} />
              <span style={css('width:14px;height:1.5px;background:var(--text-2);border-radius:2px')} />
              <span style={css('width:14px;height:1.5px;background:var(--text-2);border-radius:2px')} />
            </button>
          )}
          <span style={css('width:9px;height:9px;border-radius:50%;background:var(--accent);flex:0 0 auto')} />
          <span style={css("font-family:var(--font-display);font-size:19px;font-weight:600;letter-spacing:-.01em")}>twin</span>
          {!mobile && (
            <button className="hov-surface2" onClick={() => runMaint('sync')} title="Sync" aria-label="Sync now" style={css('margin-left:6px;display:flex;align-items:center;gap:5px;background:transparent;border:1px solid var(--border);border-radius:100px;padding:3px 9px;font-size:11px;color:var(--text-2);cursor:pointer;font-family:var(--font-mono)')}>
              <span style={css(`width:7px;height:7px;border-radius:50%;background:var(--accent);${vm.syncing ? 'animation:tw-pulse 1s ease-in-out infinite' : ''}`)} />{vm.syncLabel}
            </button>
          )}
        </div>

        <div style={css('flex:1;min-width:0;display:flex;justify-content:center')}>
          <div style={css('display:flex;align-items:center;gap:8px;width:100%;max-width:560px;min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:100px;padding:7px 8px 7px 16px;box-shadow:var(--shadow)')}>
            <span style={css('font-family:var(--font-mono);font-size:12px;color:var(--accent)')}>+</span>
            <input value={s.captureDraft} onChange={e => patch({ captureDraft: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCapture() } }}
              placeholder="Capture a thought, paste a link, attach a file…"
              style={css('flex:1;min-width:0;border:none;background:transparent;font-size:13.5px')} />
            <button onClick={addCapture} style={css('background:var(--accent);color:var(--accent-fg);border:none;border-radius:100px;padding:5px 14px;font-size:12.5px;font-weight:600;cursor:pointer')}>Capture ↵</button>
          </div>
        </div>

        <div style={css('flex:0 0 auto;display:flex;align-items:center;justify-content:flex-end;gap:10px')}>
          {vm.jobsActive && (
            <div style={css('display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-2);font-family:var(--font-mono)')}>
              <Spinner /> {vm.jobCount}
            </div>
          )}
          <button className="hov-surface" onClick={() => patch({ mode: s.mode === 'light' ? 'dark' : 'light' })} title="Toggle theme" aria-label={s.mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} aria-pressed={s.mode === 'dark'} style={css('width:30px;height:30px;flex:0 0 auto;border-radius:50%;border:1px solid var(--border);background:var(--surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center')}>
            <span style={css(`width:13px;height:13px;border-radius:50%;background:${s.mode === 'dark' ? 'var(--text)' : 'transparent'};border:2px solid var(--text);box-shadow:${s.mode === 'dark' ? 'none' : 'inset -3px -3px 0 0 var(--text)'}`)} />
          </button>
        </div>
      </div>

      {/* BODY */}
      <div style={css('flex:1;display:flex;min-height:0')}>

        {/* SIDEBAR */}
        {mobile && drawerOpen && (<div onClick={() => setDrawerOpen(false)} style={css('position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.42)')} />)}
        <div style={css(
          mobile
            ? `position:fixed;top:0;left:0;bottom:0;z-index:41;width:250px;max-width:84vw;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 10px;overflow-y:auto;box-shadow:0 0 40px -8px rgba(0,0,0,.4);transition:transform .22s ease;transform:translateX(${drawerOpen ? '0' : '-110%'})`
            : `width:${sidebarW}px;flex:0 0 ${sidebarW}px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:12px 10px`
        )}>
          <div style={css('display:flex;flex-direction:column;gap:2px')}>
            {vm.nav.map(n => (
              <button key={n.key} className="hov-surface2" onClick={() => { patch({ screen: n.key }); setDrawerOpen(false) }} style={css(n.style)}>
                <span>{n.label}</span>
                <span style={css('display:flex;align-items:center;gap:8px')}>
                  {n.badge ? <span style={css('background:var(--accent);color:var(--accent-fg);font-size:10px;font-weight:700;border-radius:100px;min-width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;font-family:var(--font-mono)')}>{n.badge}</span> : null}
                  <span style={css('font-family:var(--font-mono);font-size:10px;color:var(--text-3);opacity:.8')}>{n.kbd}</span>
                </span>
              </button>
            ))}
          </div>

          <div style={css('margin-top:18px;padding:0 6px')}>
            <div style={css('font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:9px')}>Status</div>
            <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:7px')}>
              {([[live.status.inbox, 'inbox'], [live.status.chats, 'chats'], [live.status.pages, 'pages'], [live.status.tracked, 'tracked']] as const).map(([v, label]) => (
                <div key={label} style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 9px')}>
                  <div style={css('font-family:var(--font-display);font-size:19px;font-weight:600;line-height:1;color:' + (live.loading ? 'var(--text-3)' : 'var(--text)'))}>{live.loading ? '·' : v}</div>
                  <div style={css('font-size:10.5px;color:var(--text-3)')}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={css('margin-top:auto;display:flex;align-items:center;gap:9px;padding:9px 6px;border-top:1px solid var(--border)')}>
            <div style={css('width:28px;height:28px;border-radius:50%;background:var(--accent-weak);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:600;color:var(--accent);font-size:13px')}>Y</div>
            <div style={css('line-height:1.2')}>
              <div style={css('font-size:12.5px;font-weight:600')}>You</div>
              <div style={css('font-size:10.5px;color:var(--text-3);font-family:var(--font-mono)')}>claude-code-max</div>
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div style={css('flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;background:var(--bg)')}>
          <div key={s.screen} className="tw-fade" style={css(`max-width:1080px;margin:0 auto;min-width:0;padding:26px ${narrow ? 18 : 32}px 60px`)}>

            {/* ===== TODAY ===== */}
            {s.screen === 'today' && (
              <div>
                <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px')}>
                  <div>
                    <div style={css('font-family:var(--font-mono);font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-2)')}>{DOW[today.getDay()]}, {MON[today.getMonth()]} {today.getDate()}, {today.getFullYear()}</div>
                    <div style={css('display:flex;align-items:baseline;gap:14px;margin-top:8px;flex-wrap:wrap')}>
                      <div style={css('font-family:var(--font-display);font-size:34px;font-weight:600;letter-spacing:-.02em')}>Today</div>
                      <div style={css('font-family:var(--font-mono);font-size:17px;font-weight:500;color:var(--accent)')}>{fmtClock(today)}</div>
                    </div>
                  </div>
                  <button className="hov-surface2" onClick={() => runMaint('agenda')} style={css('display:inline-flex;align-items:center;gap:7px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:var(--shadow)')}>↻ Regenerate briefing</button>
                </div>

                {/* Priorities */}
                <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px;margin-bottom:16px')}>
                  <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:10px')}>
                    <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3)')}>Priorities now</div>
                    <div style={css('font-size:11px;color:var(--text-3)')}>Saved to profile.md · ranks every briefing</div>
                  </div>
                  <div style={css('display:flex;flex-direction:column;gap:8px')}>
                    {s.prioritiesDraft.map((v, i) => (
                      <div key={i} style={css('display:flex;align-items:center;gap:11px')}>
                        <span style={css('font-family:var(--font-display);font-size:15px;font-weight:600;color:var(--accent);width:14px')}>{i + 1}</span>
                        <input className="foc-accent" value={v} onChange={e => setPriority(i, e.target.value)} onBlur={savePriorities}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          placeholder={i === 0 ? 'Your #1 focus this week…' : i === 1 ? 'Second priority…' : 'Third priority…'}
                          style={css('flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 11px;font-size:13.5px')} />
                      </div>
                    ))}
                  </div>
                </div>

                <div style={css(`display:grid;grid-template-columns:${todayCols};gap:16px;align-items:start`)}>
                  <div style={css('display:flex;flex-direction:column;gap:16px')}>
                    <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px;border-left:3px solid var(--accent)')}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:9px')}>Most important today</div>
                      {live.loading
                        ? <Loading label="Building briefing…" pad={8} />
                        : <div style={css('font-size:15.5px;line-height:1.5;color:var(--text)')}>{vm.mostImportant}</div>}
                    </div>

                    <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px')}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:12px')}>Schedule · today</div>
                      {live.loading ? <Loading label="Loading schedule…" pad={10} /> : vm.todayEvents.length === 0 ? (
                        <div style={css('font-size:13.5px;color:var(--text-3)')}>No events on the calendar today.</div>
                      ) : (
                        <div style={css('display:flex;flex-direction:column;gap:14px')}>
                          {vm.todayEvents.map((e, i) => (
                            <div key={i} style={css(`display:flex;gap:14px;opacity:${e.ended ? '.5' : '1'}`)}>
                              <div style={css('text-align:right;flex:0 0 auto;width:74px')}>
                                <div style={css(`font-family:var(--font-display);font-size:17px;font-weight:600;${e.ended ? 'text-decoration:line-through' : ''}`)}>{e.timeLabel}</div>
                                <div style={css('font-size:11px;color:var(--text-3);font-family:var(--font-mono)')}>{e.endLabel}</div>
                              </div>
                              <div style={css(`width:2px;background:${e.ongoing ? 'var(--accent)' : e.ended ? 'var(--text-3)' : 'var(--accent)'};border-radius:2px;flex:0 0 auto`)} />
                              <div style={css('flex:1;min-width:0')}>
                                <div style={css('font-size:14.5px;font-weight:600')}>{e.title}
                                  {e.ongoing ? <span style={css('margin-left:8px;font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent-fg);background:var(--accent);border-radius:100px;padding:1px 7px')}>now</span> : null}
                                  {e.ended ? <span style={css('margin-left:8px;font-family:var(--font-mono);font-size:10px;color:var(--text-3)')}>ended</span> : null}
                                </div>
                                <div style={css('font-size:12.5px;color:var(--text-2);margin-top:3px;overflow-wrap:anywhere')}>{e.calendar}{e.location ? ' · ' + e.location : ''}</div>
                                {e.url ? <div style={css('font-family:var(--font-mono);font-size:11.5px;color:var(--accent);margin-top:3px;overflow-wrap:anywhere')}>{e.url}</div> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={css('display:flex;flex-direction:column;gap:16px')}>
                    <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                      <div style={css('display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px')}>
                        <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3)')}>Open reminders</div>
                        <div style={css('font-size:11.5px;color:var(--text-3)')}>{vm.openCount} open</div>
                      </div>
                      <div style={css('display:flex;flex-direction:column;gap:13px;max-height:300px;overflow-y:auto')}>
                        {live.loading && <Loading label="Loading reminders…" pad={10} />}
                        {!live.loading && vm.reminderGroups.length === 0 && <div style={css('font-size:13px;color:var(--text-3)')}>No open reminders.</div>}
                        {vm.reminderGroups.map(g => (
                          <div key={g.label}>
                            <div style={css('font-size:11px;font-weight:600;color:var(--text-3);margin-bottom:5px')}>{g.label}</div>
                            <div style={css('display:flex;flex-direction:column;gap:1px')}>
                              {g.items.map(r => (
                                <div key={r.title} className="hov-surface2" onClick={() => completeReminder(r.title)} style={css('display:flex;align-items:center;gap:9px;padding:4px 4px;border-radius:6px;cursor:pointer')}>
                                  <span style={css(r.boxStyle)} />
                                  <span style={css(r.textStyle)}>{r.title}</span>
                                  {r.due ? <span style={css(r.dueStyle)}>{r.due}</span> : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:11px')}>Project pulse</div>
                      <div style={css('display:flex;flex-direction:column;gap:9px')}>
                        {live.loading && <Loading label="Loading…" pad={8} />}
                        {!live.loading && vm.pulse.length === 0 && <div style={css('font-size:12.5px;color:var(--text-3)')}>No project pages yet.</div>}
                        {vm.pulse.map(p => (
                          <div key={p.name} style={css('display:flex;align-items:flex-start;gap:9px;cursor:pointer')} onClick={() => selectPage(p.name)}>
                            <span style={css(`width:7px;height:7px;border-radius:50%;margin-top:5px;flex:0 0 auto;background:${p.color}`)} />
                            <div style={css('flex:1')}><span style={css('font-weight:600;font-size:13px')}>{p.name}</span> <span style={css('font-size:12.5px;color:var(--text-2)')}>— {p.note}</span></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ===== CAPTURE ===== */}
            {s.screen === 'capture' && (
              <div>
                <div style={css('font-family:var(--font-display);font-size:30px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px')}>Capture</div>
                <div style={css('font-size:13.5px;color:var(--text-2);margin-bottom:20px')}>Zero-friction input. Sorts into the wiki later when you process the inbox.</div>

                <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px;margin-bottom:24px')}>
                  <div style={css('display:flex;gap:6px;margin-bottom:11px')}>
                    <span style={css('font-family:var(--font-mono);font-size:11px;padding:4px 11px;border-radius:100px;background:var(--accent-weak);color:var(--accent);border:1px solid color-mix(in oklab,var(--accent) 30%,var(--border))')}>Text</span>
                    <span style={css('font-family:var(--font-mono);font-size:11px;padding:4px 11px;border-radius:100px;background:var(--surface-2);color:var(--text-3);border:1px solid var(--border)')}>Link</span>
                    <button onClick={() => fileInputRef.current?.click()} className="hov-accent" style={css('font-family:var(--font-mono);font-size:11px;padding:4px 11px;border-radius:100px;background:var(--surface-2);color:var(--text-3);border:1px solid var(--border);cursor:pointer')}>File ↑</button>
                  </div>
                  <textarea className="foc-accent" value={s.captureDraft} onChange={e => patch({ captureDraft: e.target.value })} rows={3}
                    placeholder="Type a thought, or paste a URL to clip it…"
                    style={css('width:100%;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px;font-size:14px;line-height:1.5')} />
                  <div style={css('display:flex;align-items:center;justify-content:space-between;margin-top:11px')}>
                    <span style={css('font-family:var(--font-mono);font-size:11px;color:var(--text-3)')}>source auto-detected · drag a file anywhere · lands in raw-sources/inbox/</span>
                    <button onClick={addCapture} style={css('background:var(--accent);color:var(--accent-fg);border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer')}>Capture</button>
                  </div>
                </div>

                <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:13px')}>
                  <div style={css('display:flex;align-items:baseline;gap:10px')}>
                    <span style={css('font-family:var(--font-display);font-size:20px;font-weight:600')}>Inbox</span>
                    <span style={css('font-family:var(--font-mono);font-size:12px;color:var(--text-3)')}>{live.status.inbox} unprocessed · {live.status.chats} chats</span>
                  </div>
                  <button onClick={runIngest} style={css(vm.ingestBtnStyle)}>{vm.ingestBtnLabel}</button>
                </div>

                {s.ingestDone && (
                  <div style={css('background:var(--accent-weak);border:1px solid color-mix(in oklab,var(--accent) 30%,var(--border));border-radius:var(--radius);padding:14px 16px;margin-bottom:16px')}>
                    <div style={css('display:flex;align-items:center;gap:8px')}><span style={css('color:var(--accent);font-weight:700')}>✓</span><span style={css('font-weight:600;font-size:13.5px')}>Ingest finished{s.maintResults.ingest ? ' — ' + s.maintResults.ingest : ''}</span></div>
                  </div>
                )}

                <div style={css('display:flex;flex-direction:column;gap:11px')}>
                  {live.loading && <Loading label="Loading inbox…" />}
                  {!live.loading && vm.capturesAll.length === 0 && <div style={css('font-size:13px;color:var(--text-3)')}>Inbox is empty.</div>}
                  {vm.capturesAll.map(c => (
                    <div key={c.file} style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px')}>
                      <div style={css('display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px;font-family:var(--font-mono);font-size:11px')}>
                        <span style={css('color:var(--text-3)')}>{c.ts}</span>
                        <span style={css('color:var(--text-2);background:var(--surface-2);border-radius:100px;padding:1px 8px')}>{c.source}</span>
                        {c.project ? <span style={css('color:var(--accent);background:var(--accent-weak);border-radius:100px;padding:1px 8px')}>{c.project}</span> : null}
                        <span style={css(c.statusStyle)}>{c.status}</span>
                      </div>
                      <div style={css('font-size:13.5px;line-height:1.5;color:var(--text);white-space:pre-wrap')}>{c.body}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== ASK ===== */}
            {s.screen === 'ask' && (
              <div style={css('max-width:760px;margin:0 auto')}>
                <div style={css('font-family:var(--font-display);font-size:30px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px')}>Ask your brain</div>
                <div style={css('font-size:13.5px;color:var(--text-2);margin-bottom:22px')}>Answers are grounded in your own notes via the local twin engine. Links jump to wiki pages.</div>

                <div style={css('display:flex;flex-direction:column;gap:16px;margin-bottom:24px')}>
                  {s.askThread.length === 0 && !s.askBusy && <div style={css('font-size:13px;color:var(--text-3)')}>Ask a question to search your wiki. Heavy: runs the local Max engine (seconds).</div>}
                  {s.askThread.map((m, i) => (
                    <div key={i} style={css(`display:flex;justify-content:${m.role === 'user' ? 'flex-end' : 'flex-start'}`)}>
                      {m.role === 'user' ? (
                        <div style={css('background:var(--accent);color:var(--accent-fg);border-radius:var(--radius) var(--radius) 4px var(--radius);padding:11px 16px;font-size:14px;max-width:78%;line-height:1.45')}>{m.text}</div>
                      ) : (
                        <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px;max-width:88%')}>
                          <div style={css('font-size:14.5px;line-height:1.55;color:var(--text);white-space:pre-wrap')}><MarkText text={m.text} onLink={selectPage} /></div>
                        </div>
                      )}
                    </div>
                  ))}
                  {s.askBusy && (
                    <div style={css('display:flex;align-items:center;gap:9px;color:var(--text-2);font-size:13px;padding:4px 2px')}>
                      <Spinner size={13} />
                      <span style={css('font-family:var(--font-mono);font-size:12px')}>reading your wiki on the local Max engine…</span>
                    </div>
                  )}
                </div>

                <div style={css('position:sticky;bottom:0;padding-bottom:6px;background:linear-gradient(to top,var(--bg) 70%,transparent)')}>
                  <div style={css('display:flex;gap:9px;align-items:flex-end;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:9px 9px 9px 15px')}>
                    <input value={s.askDraft} onChange={e => patch({ askDraft: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ask() } }}
                      placeholder="Ask anything about your notes…" style={css('flex:1;border:none;background:transparent;font-size:14px;padding:5px 0')} />
                    <button onClick={() => ask()} style={css('background:var(--accent);color:var(--accent-fg);border:none;border-radius:var(--radius-sm);padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer')}>Ask</button>
                  </div>
                </div>
              </div>
            )}

            {/* ===== WIKI ===== */}
            {s.screen === 'wiki' && (
              <div style={css(`display:grid;grid-template-columns:${wikiCols};gap:22px;align-items:start`)}>
                <div style={css(narrow ? '' : 'position:sticky;top:0')}>
                  <input className="foc-accent" value={s.wikiSearch} onChange={e => patch({ wikiSearch: e.target.value })}
                    placeholder={`Search ${live.status.pages} pages…`} style={css('width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 12px;font-size:13px;margin-bottom:14px')} />
                  {vm.wikiDomains.map(d => (
                    <div key={d.label} style={css('margin-bottom:13px')}>
                      <div style={css('font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);margin-bottom:5px;display:flex;justify-content:space-between')}><span>{d.label}</span><span style={css('opacity:.7')}>{d.count}</span></div>
                      {d.empty && <div style={css('font-size:12px;color:var(--text-3);font-style:italic;padding:3px 8px')}>no pages yet</div>}
                      <div style={css('display:flex;flex-direction:column;gap:1px')}>
                        {d.pages.map(pg => (
                          <button key={pg.name} className="hov-surface2" onClick={() => selectPage(pg.name)} style={css(pg.style)}>
                            <span>{pg.label}</span>
                            {pg.pinned && <span style={css('font-size:10px;color:var(--accent)')}>●</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:30px 36px;min-height:480px')}>
                  {!live.page ? <Loading label="Loading page…" pad={60} /> : (<>
                    <div style={css('font-family:var(--font-mono);font-size:11px;color:var(--text-3);margin-bottom:6px')}>{live.page.domain} /</div>
                    <div style={css('font-family:var(--font-display);font-size:32px;font-weight:600;letter-spacing:-.02em;margin-bottom:9px')}>{live.page.title}</div>
                    <div style={css('display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px')}>
                      {live.page.tags.map(t => <span key={t} style={css('font-family:var(--font-mono);font-size:11px;color:var(--text-2);background:var(--surface-2);border:1px solid var(--border);border-radius:100px;padding:2px 9px')}>#{t}</span>)}
                    </div>
                    <div style={css('display:flex;flex-direction:column;gap:13px;font-size:15px;line-height:1.62;color:var(--text)')}>
                      {live.page.blocks.map((b, i) => {
                        if (b.isH) return <div key={i} style={css('font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);margin-top:10px')}>{b.text}</div>
                        if (b.isBullet) return <div key={i} style={css('display:flex;gap:10px;font-size:14px')}><span style={css('color:var(--accent);flex:0 0 auto')}>—</span><span><MarkText text={b.text!} onLink={selectPage} /></span></div>
                        if (b.isTl) return <div key={i} style={css('display:flex;gap:12px;font-size:13.5px;color:var(--text-2)')}><span style={css('font-family:var(--font-mono);font-size:11.5px;color:var(--accent);flex:0 0 auto')}>{b.date}</span><span><MarkText text={b.text!} onLink={selectPage} /></span></div>
                        return <p key={i} style={css('margin:0')}><MarkText text={b.text!} onLink={selectPage} /></p>
                      })}
                    </div>
                  </>)}
                </div>
              </div>
            )}

            {/* ===== TASKS ===== */}
            {s.screen === 'tasks' && (
              <div style={css('max-width:760px')}>
                <div style={css('display:flex;align-items:baseline;gap:12px;margin-bottom:18px')}>
                  <div style={css('font-family:var(--font-display);font-size:30px;font-weight:600;letter-spacing:-.02em')}>Reminders</div>
                  <div style={css('font-family:var(--font-mono);font-size:12px;color:var(--text-3)')}>{vm.openCount} open · Apple Reminders</div>
                </div>

                {/* Category (list) manager */}
                <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:13px 15px;margin-bottom:16px')}>
                  <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px')}>Categories</div>
                  <div style={css('display:flex;flex-wrap:wrap;gap:8px;align-items:center')}>
                    {live.lists.map(l => {
                      const count = live.reminders.filter(r => r.list === l).length
                      if (s.listEditing === l) return (
                        <input key={l} autoFocus value={s.listDraft} onChange={e => patch({ listDraft: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') saveRenameList(); if (e.key === 'Escape') patch({ listEditing: null }) }} onBlur={saveRenameList}
                          style={css('background:var(--surface-2);border:1px solid var(--accent);border-radius:100px;padding:5px 12px;font-size:12.5px;font-family:var(--font-mono);width:140px')} />
                      )
                      return (
                        <span key={l} style={css('display:inline-flex;align-items:center;gap:7px;background:var(--surface-2);border:1px solid var(--border);border-radius:100px;padding:4px 6px 4px 12px;font-size:12.5px;font-family:var(--font-mono)')}>
                          <span>{l}</span>
                          <span style={css('color:var(--text-3);font-size:11px')}>{count}</span>
                          <button onClick={() => startRenameList(l)} title="Rename" aria-label={'Rename ' + l} className="hov-surface" style={css('width:20px;height:20px;border:none;background:transparent;color:var(--text-3);cursor:pointer;border-radius:50%;font-size:11px')}>✎</button>
                          {live.lists.length > 1 && (s.listDeleting === l ? (
                            <>
                              <button onClick={() => confirmDeleteList(l)} title="Confirm delete" style={css('border:none;background:#c0392b;color:#fff;cursor:pointer;border-radius:100px;font-size:10px;padding:2px 7px;font-weight:700')}>delete</button>
                              <button onClick={() => patch({ listDeleting: null })} title="Cancel" className="hov-surface" style={css('width:20px;height:20px;border:none;background:transparent;color:var(--text-3);cursor:pointer;border-radius:50%;font-size:12px')}>✕</button>
                            </>
                          ) : (
                            <button onClick={() => patch({ listDeleting: l })} title="Delete list" aria-label={'Delete ' + l} className="hov-surface" style={css('width:20px;height:20px;border:none;background:transparent;color:var(--warn);cursor:pointer;border-radius:50%;font-size:13px')}>×</button>
                          ))}
                        </span>
                      )
                    })}
                    <span style={css('display:inline-flex;align-items:center;gap:6px;border:1px dashed var(--border);border-radius:100px;padding:3px 6px 3px 12px')}>
                      <input value={s.newListDraft} onChange={e => patch({ newListDraft: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createList() } }}
                        placeholder="New category…" style={css('border:none;background:transparent;font-size:12.5px;font-family:var(--font-mono);width:120px')} />
                      <button onClick={createList} title="Create list" style={css('width:22px;height:22px;border:none;background:var(--accent);color:var(--accent-fg);cursor:pointer;border-radius:50%;font-size:14px;font-weight:700;flex:0 0 auto')}>+</button>
                    </span>
                  </div>
                  {s.listDeleting && <div style={css('font-size:11.5px;color:var(--text-3);margin-top:9px')}>Deleting <b>{s.listDeleting}</b> moves its reminders to <b>{live.lists.find(l => l !== s.listDeleting) || 'Reminders'}</b> — nothing is lost.</div>}
                </div>
                <div style={css('display:flex;gap:9px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:9px 9px 9px 15px;margin-bottom:20px')}>
                  <input value={s.reminderDraft} onChange={e => patch({ reminderDraft: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addReminder() } }}
                    placeholder="Add a reminder…" style={css('flex:1;min-width:0;border:none;background:transparent;font-size:14px')} />
                  {live.lists.length > 0 && (
                    <select value={s.addList} onChange={e => patch({ addList: e.target.value })} title="List" style={css('flex:0 0 auto;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px 9px;font-size:12.5px;color:var(--text-2);font-family:var(--font-mono);cursor:pointer')}>
                      {live.lists.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  )}
                  <button onClick={addReminder} style={css('flex:0 0 auto;background:var(--accent);color:var(--accent-fg);border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer')}>Add</button>
                </div>
                <div style={css('display:flex;flex-direction:column;gap:18px')}>
                  {live.loading && <Loading label="Loading reminders…" />}
                  {!live.loading && vm.reminderGroups.length === 0 && <div style={css('font-size:13px;color:var(--text-3)')}>No open reminders.</div>}
                  {vm.reminderGroups.map(g => (
                    <div key={g.label}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3);margin-bottom:7px')}>{g.label}</div>
                      <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden')}>
                        {g.items.map(r => (
                          <div key={r.title} className="hov-surface2 tw-rem-row" style={css('display:flex;align-items:center;gap:11px;padding:11px 15px;border-bottom:1px solid var(--border)')}>
                            <span onClick={() => completeReminder(r.title)} style={css(r.boxStyle + ';cursor:pointer')} title="Complete" />
                            {s.remEditing === r.title ? (
                              <input autoFocus value={s.remDraft} onChange={e => patch({ remDraft: e.target.value })}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') patch({ remEditing: null }) }}
                                onBlur={saveEdit}
                                style={css('flex:1;background:var(--surface-2);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:6px 9px;font-size:13.5px')} />
                            ) : (
                              <span onClick={() => startEdit(r.title)} style={css(r.textStyle + ';flex:1;cursor:text')} title="Click to edit">{r.title}</span>
                            )}
                            {r.due ? <span style={css(r.dueStyle)}>{r.due}</span> : null}
                            {live.lists.length > 1 && (
                              <select value={g.label} onChange={e => moveReminder(r.title, e.target.value)} title="Move to list" style={css('flex:0 0 auto;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:11px;color:var(--text-3);font-family:var(--font-mono);cursor:pointer;max-width:110px')}>
                                {live.lists.map(l => <option key={l} value={l}>{l}</option>)}
                              </select>
                            )}
                            <button onClick={() => startEdit(r.title)} title="Edit" aria-label="Edit reminder" style={css('flex:0 0 auto;width:26px;height:26px;border:none;background:transparent;color:var(--text-3);cursor:pointer;border-radius:6px;font-size:13px')} className="hov-surface2">✎</button>
                            <button onClick={() => deleteReminder(r.title)} title="Delete" aria-label="Delete reminder" style={css('flex:0 0 auto;width:26px;height:26px;border:none;background:transparent;color:var(--warn);cursor:pointer;border-radius:6px;font-size:14px')} className="hov-surface2">🗑</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== CALENDAR ===== */}
            {s.screen === 'calendar' && (
              <div>
                <div style={css('font-family:var(--font-display);font-size:30px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px')}>Calendar</div>
                <div style={css('font-size:13.5px;color:var(--text-2);margin-bottom:20px')}>All Apple accounts via EventKit{live.calOk ? '' : ' — access denied'} · next 7 days</div>
                <div style={css('display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:14px')}>
                  {vm.week.map(d => (
                    <div key={d.key} onClick={() => patch({ calDay: s.calDay === d.dayKey ? null : d.dayKey })} title="Show this day" style={css(d.style)}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3)')}>{d.dow}</div>
                      <div style={css('font-family:var(--font-display);font-size:20px;font-weight:600;margin-top:2px')}>{d.num}</div>
                      {d.chips.map((c, i) => <div key={i} style={css('margin-top:6px;font-size:10.5px;background:var(--accent-weak);color:var(--accent);border:1px solid color-mix(in oklab,var(--accent) 30%,var(--border));border-radius:5px;padding:2px 5px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c}</div>)}
                    </div>
                  ))}
                </div>
                {vm.calSelLabel && (
                  <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:12px')}>
                    <span style={css('font-size:13px;color:var(--text-2)')}>Showing <b style={css('font-weight:600;color:var(--text)')}>{vm.calSelLabel}</b></span>
                    <button onClick={() => patch({ calDay: null })} className="hov-surface2" style={css('font-size:11.5px;border:1px solid var(--border);background:var(--surface-2);border-radius:100px;padding:3px 11px;cursor:pointer;color:var(--text-2);font-family:var(--font-mono)')}>show all 7 days ✕</button>
                  </div>
                )}
                <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:6px 0')}>
                  {live.loading && <Loading label="Loading calendar…" />}
                  {!live.loading && vm.calList.length === 0 && <div style={css('padding:16px;font-size:13px;color:var(--text-3)')}>{vm.calSelLabel ? 'No events on ' + vm.calSelLabel + '.' : 'No events in the next 7 days.'}</div>}
                  {vm.calList.map((grp, gi) => (
                    <div key={gi}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);padding:10px 16px 4px')}>{grp.label}</div>
                      {grp.events.map((e, i) => (
                        <div key={i} style={css('display:flex;gap:14px;padding:9px 16px;border-top:1px solid var(--border)')}>
                          <div style={css('width:76px;flex:0 0 auto;font-family:var(--font-mono);font-size:11.5px;color:var(--text-2);padding-top:2px')}>{e.timeLabel}</div>
                          <div style={css('flex:1;min-width:0;border-left:3px solid var(--accent);padding-left:12px')}>
                            <div style={css('font-weight:600;font-size:13.5px')}>{e.title}</div>
                            <div style={css('font-size:12px;color:var(--text-2);margin-top:2px;overflow-wrap:anywhere')}>{e.calendar}{e.location ? ' · ' + e.location : ''}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== MAINTAIN ===== */}
            {s.screen === 'maintain' && (
              <div>
                <div style={css('font-family:var(--font-display);font-size:30px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px')}>Maintain</div>
                <div style={css('font-size:13.5px;color:var(--text-2);margin-bottom:20px')}>Real twin agents. Heavy jobs spawn the local Max engine (seconds to minutes) and cost quota.</div>
                <div style={css(`display:grid;grid-template-columns:${maintCols};gap:13px;margin-bottom:24px`)}>
                  {vm.maintCards.map(m => (
                    <div key={m.key} style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:15px 16px;display:flex;flex-direction:column;gap:9px')}>
                      <div style={css('display:flex;align-items:center;justify-content:space-between')}>
                        <span style={css('font-family:var(--font-display);font-size:17px;font-weight:600')}>{m.label}</span>
                        <span style={css(m.costStyle)}>{m.cost}</span>
                      </div>
                      <div style={css('font-size:12.5px;color:var(--text-2);line-height:1.4;min-height:34px')}>{m.desc}</div>
                      {m.result && <div style={css('font-size:12px;color:var(--accent);border-top:1px solid var(--border);padding-top:8px;word-break:break-word')}>✓ {m.result}</div>}
                      <button onClick={() => m.runKey === 'ingest' ? runIngest() : runMaint(m.runKey)} style={css(m.btnStyle)}>{m.btnLabel}</button>
                    </div>
                  ))}
                </div>

                <div style={css(`display:grid;grid-template-columns:${halfCols};gap:16px;align-items:start`)}>
                  <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                    <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:11px')}>Recent activity</div>
                    <div style={css('display:flex;flex-direction:column;gap:9px')}>
                      {live.activity.slice(0, 8).map((a, i) => (
                        <div key={i} style={css('display:flex;gap:9px;font-size:13px')}><span style={css('font-family:var(--font-mono);font-size:11px;color:var(--text-3);flex:0 0 auto;width:58px')}>{a.ts}</span><span style={css('color:var(--text)')}><b style={css('font-weight:600')}>{a.kind}</b> {a.text}</span></div>
                      ))}
                    </div>
                  </div>
                  <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                    <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:11px')}>Automations</div>
                    <div style={css('display:flex;flex-direction:column;gap:13px')}>
                      <div>
                        <div style={css('display:flex;align-items:center;gap:8px')}><span style={css('width:7px;height:7px;border-radius:50%;background:var(--accent)')} /><span style={css('font-weight:600;font-size:13.5px')}>Nightly</span><span style={css('font-family:var(--font-mono);font-size:11px;color:var(--text-3)')}>00:00</span></div>
                        <div style={css('font-size:12.5px;color:var(--text-2);margin-left:15px')}>ingest + conditional tidy + sync (launchd)</div>
                      </div>
                      <div>
                        <div style={css('display:flex;align-items:center;gap:8px')}><span style={css('width:7px;height:7px;border-radius:50%;background:var(--accent)')} /><span style={css('font-weight:600;font-size:13.5px')}>Weekly</span><span style={css('font-family:var(--font-mono);font-size:11px;color:var(--text-3)')}>Sun 03:00</span></div>
                        <div style={css('font-size:12.5px;color:var(--text-2);margin-left:15px')}>ingest + lint + research + tidy + sync</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ===== SETTINGS ===== */}
            {s.screen === 'settings' && (
              <div>
                <div style={css('font-family:var(--font-display);font-size:30px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px')}>Settings &amp; Health</div>
                <div style={css('font-size:13.5px;color:var(--text-2);margin-bottom:22px')}>Live twin doctor, project capture policy, and system config.</div>

                <div style={css(`display:grid;grid-template-columns:${halfCols};gap:16px;align-items:start;margin-bottom:16px`)}>
                  <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                    <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:13px')}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3)')}>Doctor</div>
                      <button onClick={reloadDoctor} className="hov-surface2" style={css('font-size:11px;border:1px solid var(--border);background:var(--surface-2);border-radius:100px;padding:3px 10px;cursor:pointer;color:var(--text-2);font-family:var(--font-mono)')}>re-run</button>
                    </div>
                    {vm.doctorGroups.length === 0 && <Loading label="Running doctor…" pad={14} />}
                    {vm.doctorGroups.map(g => (
                      <div key={g.label} style={css('margin-bottom:13px')}>
                        <div style={css('font-size:11px;font-weight:600;color:var(--text-3);margin-bottom:5px')}>{g.label}</div>
                        <div style={css('display:flex;flex-direction:column;gap:4px')}>
                          {g.rows.map((r, i) => (
                            <div key={i} style={css('display:flex;align-items:center;gap:10px;font-size:13px')}>
                              <span style={css(r.markStyle)}>{r.glyph}</span>
                              <span style={css('flex:1;color:var(--text)')}>{r.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={css('display:flex;flex-direction:column;gap:16px')}>
                    <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                      <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:11px')}>
                        <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3)')}>Project registry</div>
                        <span style={css('font-size:11px;color:var(--text-3)')}>{live.status.tracked} tracked</span>
                      </div>
                      <div style={css('font-size:12px;color:var(--text-3);margin-bottom:11px')}>{live.loading ? 'Loading…' : vm.registry.length === 0 ? 'No projects registered yet (config/projects.json is empty).' : 'Capture policy per project.'}</div>
                      <div style={css('display:flex;flex-direction:column;gap:9px')}>
                        {vm.registry.map(p => (
                          <div key={p.path} style={css('display:flex;align-items:center;gap:10px')}>
                            <div style={css('flex:1;min-width:0')}><div style={css('font-size:13px;font-weight:600')}>{p.name}</div><div style={css('font-family:var(--font-mono);font-size:10.5px;color:var(--text-3);overflow-wrap:anywhere')}>{p.path}</div></div>
                            <div style={css('display:flex;background:var(--surface-2);border:1px solid var(--border);border-radius:100px;padding:2px')}>
                              <button onClick={() => setProjStatus(p.path, 'tracked', p.name)} style={css(miniSeg(p.status === 'tracked'))}>tracked</button>
                              <button onClick={() => setProjStatus(p.path, 'private', p.name)} style={css(miniSeg(p.status === 'private'))}>private</button>
                              <button onClick={() => setProjStatus(p.path, 'unknown', p.name)} style={css(miniSeg(p.status === 'unknown'))}>ask</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={css('background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px 18px')}>
                      <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:10px')}>config/twin.config.json</div>
                      {live.loading ? <Loading label="Loading config…" pad={14} /> : <pre style={css('margin:0;font-family:var(--font-mono);font-size:11.5px;line-height:1.55;color:var(--text-2);white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px')}>{live.config}</pre>}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* RIGHT RAIL */}
        {showRail && (
        <div style={css('width:286px;flex:0 0 286px;background:var(--panel);border-left:1px solid var(--border);overflow-y:auto;padding:16px 16px 30px')}>
          <div style={css('font-family:var(--font-mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-3);margin-bottom:12px')}>Jobs &amp; activity</div>

          {vm.jobsActive && (
            <div style={css('display:flex;flex-direction:column;gap:8px;margin-bottom:16px')}>
              {s.jobs.map(j => (
                <div key={j.id} style={css('background:var(--surface);border:1px solid color-mix(in oklab,var(--accent) 30%,var(--border));border-radius:var(--radius-sm);padding:10px 12px')}>
                  <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:3px')}><Spinner /><span style={css('font-weight:600;font-size:12.5px;font-family:var(--font-mono)')}>{j.label}</span></div>
                  <div style={css('font-size:11.5px;color:var(--text-2);margin-left:19px')}>{j.note}</div>
                </div>
              ))}
            </div>
          )}

          <div style={css('display:flex;flex-direction:column;gap:1px')}>
            {live.loading && vm.activity.length === 0 && <Loading label="Loading activity…" pad={14} />}
            {vm.activity.map((a, i) => (
              <div key={i} style={css('display:flex;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border)')}>
                <span style={css('font-family:var(--font-mono);font-size:10.5px;color:var(--text-3);flex:0 0 auto;width:54px;padding-top:1px')}>{a.ts}</span>
                <div style={css('flex:1;min-width:0')}>
                  <div style={css('display:flex;align-items:center;gap:6px')}><span style={css(`width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:${a.color}`)} /><span style={css('font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--text)')}>{a.kind}</span></div>
                  <div style={css('font-size:12px;color:var(--text-2);margin-top:1px;line-height:1.35')}>{a.text}</div>
                  {a.detail ? <div style={css('font-family:var(--font-mono);font-size:10.5px;color:var(--text-3);margin-top:1px;word-break:break-all')}>{a.detail}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

      </div>
    </div>
  )
}

// ================= style helpers =================
function miniSeg(active: boolean) {
  return `border:none;border-radius:100px;padding:3px 9px;font-size:10.5px;font-weight:600;cursor:pointer;font-family:var(--font-mono);background:${active ? 'var(--accent)' : 'transparent'};color:${active ? 'var(--accent-fg)' : 'var(--text-3)'}`
}
function navStyle(active: boolean) {
  return `display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;padding:8px 11px;border-radius:var(--radius-sm);border:1px solid ${active ? 'var(--border)' : 'transparent'};background:${active ? 'var(--accent-weak)' : 'transparent'};cursor:pointer;color:${active ? 'var(--text)' : 'var(--text-2)'};font-size:13.5px;font-weight:${active ? 600 : 500};font-family:var(--font-ui)`
}

// ================= view-model =================
function buildVM(s: UiState, live: Live, nowMs: number) {
  const inbox = live.status.inbox
  const nav = ([
    { key: 'today', label: 'Today', kbd: '⌥1' },
    { key: 'capture', label: 'Capture', kbd: '⌥2', badge: inbox },
    { key: 'ask', label: 'Ask', kbd: '⌥3' },
    { key: 'wiki', label: 'Wiki', kbd: '⌥4' },
    { key: 'tasks', label: 'Tasks', kbd: '⌥5' },
    { key: 'calendar', label: 'Calendar', kbd: '⌥6' },
    { key: 'maintain', label: 'Maintain', kbd: '⌥7' },
    { key: 'settings', label: 'Settings', kbd: '⌥8' },
  ] as { key: Screen; label: string; kbd: string; badge?: number }[])
    .map(n => ({ ...n, badge: n.badge || null, style: navStyle(s.screen === n.key) }))

  // reminders grouped by Apple list
  const box = () => `width:16px;height:16px;border-radius:5px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border:1.5px solid var(--text-3);background:transparent`
  const lists: string[] = []
  for (const r of live.reminders) if (!lists.includes(r.list)) lists.push(r.list)
  // follow Apple Reminders' list order (live.lists), so Today + Tasks groups match
  const reminderGroups = sortByOrder(lists, live.lists).map(label => ({
    label,
    items: live.reminders.filter(r => r.list === label).map(r => ({
      title: r.title, due: r.due, boxStyle: box(),
      textStyle: 'font-size:13.5px;color:var(--text)',
      dueStyle: `font-family:var(--font-mono);font-size:10.5px;padding:1px 8px;border-radius:100px;flex:0 0 auto;color:var(--text-3);background:var(--surface-2)`,
    })),
  })).filter(g => g.items.length)
  const openCount = live.reminders.length

  // captures
  const capturesAll = live.captures.map(c => ({
    ...c,
    statusStyle: `border-radius:100px;padding:1px 8px;color:${c.status === 'processed' ? 'var(--text-3)' : 'var(--accent)'};background:${c.status === 'processed' ? 'var(--surface-2)' : 'var(--accent-weak)'}`,
  }))

  // wiki tree (client-side filter)
  const q = s.wikiSearch.toLowerCase()
  const wikiDomains = live.wikiTree.map(d => {
    const pages = d.pages.filter(p => !q || p.name.toLowerCase().includes(q))
    return {
      label: d.label, count: d.pages.length, empty: d.pages.length === 0,
      pages: pages.map(p => ({
        name: p.name, label: p.name, pinned: p.pinned,
        style: `display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;padding:5px 9px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-family:var(--font-ui);background:${p.name === s.currentPage ? 'var(--accent-weak)' : 'transparent'};color:${p.name === s.currentPage ? 'var(--text)' : 'var(--text-2)'};font-weight:${p.name === s.currentPage ? 600 : 400}`,
      })),
    }
  }).filter(d => d.pages.length || (!q && d.empty))

  // calendar
  const now = new Date(nowMs)
  const evs = live.calEvents.map(e => ({ ...e, sd: new Date(e.start), ed: new Date(e.end) })).filter(e => !isNaN(e.sd.getTime()))
  const todayD = now
  const selDay = s.calDay
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayD); d.setDate(todayD.getDate() + i); d.setHours(0, 0, 0, 0)
    const dayEvents = evs.filter(e => sameDay(e.sd, d))
    const isToday = i === 0
    const dayKey = d.toDateString()
    const selected = dayKey === selDay
    const bg = (selected || isToday) ? 'var(--accent-weak)' : 'var(--surface)'
    const border = selected ? 'var(--accent)' : isToday ? 'color-mix(in oklab,var(--accent) 30%,var(--border))' : 'var(--border)'
    return {
      key: i, dayKey, dow: DOW[d.getDay()], num: d.getDate(),
      chips: dayEvents.slice(0, 2).map(e => (e.allDay ? '' : fmtTime(e.sd) + ' ') + e.title),
      style: `background:${bg};border:1px solid ${border};border-radius:var(--radius-sm);padding:11px 12px;min-height:84px;box-shadow:var(--shadow);overflow:hidden;cursor:pointer`,
    }
  })
  // grouped list by day (filtered to the selected day if one is picked)
  const byDay = new Map<string, typeof evs>()
  for (const e of evs) { const k = e.sd.toDateString(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(e) }
  let calEntries = Array.from(byDay.entries())
  if (selDay) calEntries = calEntries.filter(([k]) => k === selDay)
  const calList = calEntries.map(([k, list]) => {
    const d = new Date(k)
    return {
      label: (sameDay(d, todayD) ? 'Today · ' : '') + DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(),
      events: list.map(e => ({ title: e.title, calendar: e.calendar, location: e.location || '', timeLabel: e.allDay ? 'all-day' : fmtTime(e.sd) })),
    }
  })
  const calSelLabel = selDay ? (() => { const d = new Date(selDay); return (sameDay(d, todayD) ? 'Today' : DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate()) })() : null
  const todayEvents = evs.filter(e => sameDay(e.sd, todayD)).map(e => ({
    title: e.title, calendar: e.calendar, location: e.location || '', url: e.url || '',
    timeLabel: e.allDay ? 'all-day' : fmtTime(e.sd), endLabel: e.allDay ? '' : '→ ' + fmtTime(e.ed),
    ended: !e.allDay && e.ed.getTime() <= nowMs,
    ongoing: !e.allDay && e.sd.getTime() <= nowMs && e.ed.getTime() > nowMs,
  }))

  // most important — a spoken plan for the day, time-aware (skip events that already ended)
  const dot = (t: string) => /[.!?]$/.test(t.trim()) ? t.trim() : t.trim() + '.'
  const list = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
  const pris = s.prioritiesDraft.map(p => p.trim()).filter(Boolean)
  const topPri = pris[0]
  const ongoing = todayEvents.find(e => e.ongoing)
  const upcoming = todayEvents.filter(e => e.timeLabel !== 'all-day' && !e.ended && !e.ongoing)
  const dueNow = live.reminders.filter(r => r.due && /today|overdue|due/i.test(r.due)).map(r => r.title)

  const hour = new Date(nowMs).getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const parts: string[] = []

  // opener: what's on right now / what's next
  if (ongoing) {
    parts.push(`${greeting}. Right now you're in ${dot(ongoing.title)} It runs until ${ongoing.endLabel.replace('→ ', '')}`)
    if (upcoming.length) parts.push(`After that, ${upcoming[0].timeLabel} brings ${dot(upcoming[0].title)}`)
  } else if (upcoming.length) {
    const first = upcoming[0]
    parts.push(`${greeting}. Your next commitment is at ${first.timeLabel} — ${dot(first.title)}`)
    if (upcoming.length > 1) {
      const rest = upcoming.slice(1).map(e => `${e.title} at ${e.timeLabel}`)
      parts.push(`Later you've also got ${dot(list(rest))}`)
    }
  } else {
    parts.push(`${greeting}. You've no more commitments on the calendar today, so the day is yours to drive`)
  }

  // priorities: what actually matters
  if (topPri) {
    parts.push(`The thing that matters most is ${dot(topPri)}`)
    if (pris.length > 1) parts.push(`Keep ${dot(list(pris.slice(1)))} in view behind it`)
  }

  // reminders due
  if (dueNow.length) parts.push(`Don't let the day end without ${dot(list(dueNow))}`)

  if (!topPri && !upcoming.length && !ongoing && !dueNow.length) {
    parts.push('Nothing scheduled and no priorities set — add your top 3 above so briefings can rank against them')
  }

  const mostImportant = parts.join(' ')

  // project pulse from wiki projects
  const projDom = live.wikiTree.find(d => d.key === 'projects')
  const regByName = new Map(live.registry.map(r => [r.name, r.status]))
  const pulse = (projDom?.pages || []).slice(0, 6).map(p => ({
    name: p.name, color: 'var(--accent)',
    note: regByName.get(p.name) ? `capture: ${regByName.get(p.name)}` : 'wiki page',
  }))

  // maint cards
  const mdefs = [
    { key: 'ingest', label: 'Ingest', cost: 'heavy', desc: 'Fold pending captures into the wiki; create & link pages.' },
    { key: 'tidy', label: 'Tidy', cost: 'light', desc: 'Cheap mechanical cleanup + sort pages into MOCs.' },
    { key: 'lint', label: 'Lint', cost: 'heavy', desc: 'Deep health-check + reconcile broken links and orphans.' },
    { key: 'research', label: 'Research', cost: 'heavy', desc: 'Soft-budgeted web-research to fill knowledge gaps (~3 / week).' },
    { key: 'sync', label: 'Sync', cost: 'light', desc: 'Secret-scan, then git commit + push to your git remote.' },
    { key: 'agenda', label: 'Agenda', cost: 'heavy', desc: 'Rebuild today’s briefing from calendar + reminders.' },
  ]
  const costStyle = (c: string) => `font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:2px 8px;border-radius:100px;color:${c === 'heavy' ? 'var(--warn)' : 'var(--text-3)'};background:${c === 'heavy' ? 'color-mix(in oklab,var(--warn) 13%,var(--surface))' : 'var(--surface-2)'}`
  const maintCards = mdefs.map(m => {
    const running = m.key === 'ingest' ? s.ingestBusy : s.jobs.some(j => j.label === m.key)
    return {
      ...m, runKey: m.key, costStyle: costStyle(m.cost),
      result: s.maintResults[m.key] || '',
      btnLabel: running ? 'Running…' : 'Run',
      btnStyle: `margin-top:auto;border:none;border-radius:var(--radius-sm);padding:8px 0;font-size:12.5px;font-weight:600;cursor:${running ? 'default' : 'pointer'};font-family:var(--font-ui);background:${running ? 'var(--surface-2)' : 'var(--accent)'};color:${running ? 'var(--text-3)' : 'var(--accent-fg)'}`,
    }
  })

  // doctor
  const markStyle = (mk: string) => `width:18px;height:18px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:0 0 auto;color:${mk === 'ok' ? 'var(--accent)' : mk === 'warn' ? 'var(--warn)' : '#c0392b'};background:${mk === 'ok' ? 'var(--accent-weak)' : mk === 'warn' ? 'color-mix(in oklab,var(--warn) 14%,var(--surface))' : 'color-mix(in oklab,#c0392b 12%,var(--surface))'}`
  const doctorGroups = live.doctor.map(g => ({ label: g.label, rows: g.rows.map(r => ({ text: r.text, glyph: r.mark === 'ok' ? '✓' : r.mark === 'warn' ? '!' : '✗', markStyle: markStyle(r.mark) })) }))

  // activity colors
  const acolor = (k: string) => k === 'nightly' || k === 'chat' ? 'var(--text-3)' : (k === 'remind' || k === 'agenda') ? 'var(--warn)' : 'var(--accent)'
  const activity = live.activity.slice(0, 40).map(a => ({ ...a, color: acolor(a.kind) }))

  const syncing = s.jobs.some(j => j.label === 'sync')

  return {
    nav, reminderGroups, openCount, capturesAll, wikiDomains,
    week, calList, calSelLabel, todayEvents, mostImportant, pulse, maintCards, doctorGroups,
    registry: live.registry, activity, jobsActive: s.jobs.length > 0, jobCount: s.jobs.length + ' running',
    syncing, syncLabel: syncing ? 'syncing…' : 'sync',
    ingestBtnLabel: s.ingestBusy ? 'Processing…' : (inbox === 0 ? 'Inbox clear' : 'Process inbox'),
    ingestBtnStyle: `display:inline-flex;align-items:center;gap:8px;border:none;border-radius:var(--radius-sm);padding:8px 16px;font-size:13px;font-weight:600;font-family:var(--font-ui);cursor:${(s.ingestBusy || inbox === 0) ? 'default' : 'pointer'};background:${(s.ingestBusy || inbox === 0) ? 'var(--surface-2)' : 'var(--accent)'};color:${(s.ingestBusy || inbox === 0) ? 'var(--text-3)' : 'var(--accent-fg)'}`,
  }
}
