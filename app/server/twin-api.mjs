// Dev-server bridge: turns the twin CLI + wiki files into a small JSON API the app fetches.
// Runs only under `npm run dev` (Node middleware). The browser never shells out itself.
import { execFile } from 'node:child_process'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WIKI = join(REPO, 'wiki')
const INBOX = join(REPO, 'raw-sources', 'inbox')
const TWIN = join(REPO, 'bin', 'twin')
const REM = join(REPO, 'bin', 'twin-rem.swift')
const CALJSON = join(REPO, 'bin', 'twin-cal-json.swift')

// Augment PATH so child tools (swift, qmd, claude, git) resolve regardless of how vite was launched.
const ENV = {
  ...process.env,
  PATH: [process.env.PATH, `${homedir()}/.cargo/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':'),
}

function run(cmd, args, timeout = 30000) {
  return new Promise((res) => {
    execFile(cmd, args, { cwd: REPO, env: ENV, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      res({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err?.code ?? 0 })
    })
  })
}
const twin = (...a) => run(TWIN, a)
const swift = (...a) => run('swift', a)

const DOMAINS = ['projects', 'learning', 'personal', 'concepts', 'people']

// ---------- parsers ----------
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return { fm: {}, body: text }
  const fm = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    else v = v.replace(/^["']|["']$/g, '')
    fm[k] = v
  }
  return { fm, body: m[2] }
}

// Markdown body -> render blocks the app understands.
function bodyToBlocks(body) {
  const out = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    let m
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { out.push({ isH: true, text: m[1] }); continue }
    if ((m = /^[-*]\s+\[(\d{4}-\d{2}-\d{2})\]\s+(.*)$/.exec(line))) { out.push({ isTl: true, date: m[1], text: m[2] }); continue }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) { out.push({ isBullet: true, text: m[1] }); continue }
    if ((m = /^>\s?(.*)$/.exec(line))) { out.push({ isP: true, text: m[1] }); continue }
    out.push({ isP: true, text: line })
  }
  return out
}

async function listMd(dir) {
  try { return (await readdir(dir)).filter(f => f.endsWith('.md')) } catch { return [] }
}

// ---------- route handlers ----------
async function getStatus() {
  const r = await twin('status')
  const num = (label) => { const m = new RegExp(label + '\\s*:\\s*(\\d+)').exec(r.stdout); return m ? parseInt(m[1], 10) : 0 }
  return { inbox: num('inbox unprocessed'), chats: num('chats unprocessed'), pages: num('wiki pages'), tracked: num('tracked projects') }
}

async function getCalendar(days) {
  const r = await swift(CALJSON, String(days || 7))
  if (!r.ok) return { ok: false, error: (r.stderr || 'calendar read failed').trim(), events: [] }
  let events = []
  try { events = JSON.parse(r.stdout || '[]') } catch { events = [] }
  // de-dupe identical (title,start) across overlapping calendars
  const seen = new Set()
  events = events.filter(e => { const k = e.title + '|' + e.start; if (seen.has(k)) return false; seen.add(k); return true })
  return { ok: true, events }
}

async function getReminders() {
  const r = await swift(REM, 'list')
  if (!r.ok) return { ok: false, error: (r.stderr || 'reminders read failed').trim(), reminders: [] }
  const reminders = []
  for (const line of r.stdout.split('\n')) {
    const m = /^- (.*?)(?:\s+\(due (.+?)\))?\s+\[(.+?)\]\s*$/.exec(line.trim())
    if (m) reminders.push({ title: m[1], due: m[2] || null, list: m[3] })
  }
  return { ok: true, reminders }
}

async function getReminderLists() {
  const r = await swift(REM, 'lists')
  const lists = r.ok ? r.stdout.split('\n').map(l => l.trim()).filter(Boolean) : []
  return { ok: r.ok, lists }
}

async function getCaptures() {
  const files = (await listMd(INBOX)).sort().reverse()
  const out = []
  for (const f of files) {
    try {
      const { fm, body } = parseFrontmatter(await readFile(join(INBOX, f), 'utf8'))
      out.push({ file: f, ts: fm.captured || '', source: fm.source || 'cli', project: fm.project || null, status: fm.status || 'unprocessed', body: body.trim() })
    } catch { /* skip unreadable */ }
  }
  return { captures: out }
}

async function getActivity() {
  let text = ''
  try { text = await readFile(join(REPO, 'log.md'), 'utf8') } catch { return { activity: [] } }
  const out = []
  for (const line of text.split('\n')) {
    const m = /^##\s*\[(.+?)\]\s*(.*)$/.exec(line)
    if (!m) continue
    const ts = (m[1].split(' ')[1] || m[1]).trim()
    const rest = m[2]
    const parts = rest.split('|')
    const head = parts[0].trim()
    const kind = head.split(/\s+/)[0]
    let text2 = parts.length > 1 ? parts.slice(1).join('|').trim() : head
    let detail = ''
    const arrow = text2.indexOf('->')
    if (arrow !== -1) { detail = text2.slice(arrow + 2).trim(); text2 = text2.slice(0, arrow).trim() }
    out.push({ ts, kind, text: text2, detail })
  }
  return { activity: out.reverse() }
}

async function getWikiTree() {
  const labelOf = { projects: 'Projects', learning: 'Learning', personal: 'Personal', concepts: 'Concepts', people: 'People' }
  const domains = []
  for (const d of DOMAINS) {
    const files = (await listMd(join(WIKI, d))).filter(f => !f.endsWith('-moc.md') && f !== 'index.md')
    const names = []
    for (const f of files) {
      const name = basename(f, '.md')
      let pinned = false
      try { pinned = /pinned:\s*true/.test(await readFile(join(WIKI, d, f), 'utf8')) } catch { /* */ }
      names.push({ name, pinned })
    }
    domains.push({ key: d, label: labelOf[d], pages: names.sort((a, b) => a.name.localeCompare(b.name)) })
  }
  return { domains }
}

async function getWikiPage(name) {
  for (const d of DOMAINS) {
    try {
      const text = await readFile(join(WIKI, d, name + '.md'), 'utf8')
      const { fm, body } = parseFrontmatter(text)
      const title = (/^#\s+(.+)$/m.exec(body)?.[1]) || name
      const bodyNoH1 = body.replace(/^#\s+.+$/m, '')
      return { found: true, name, title, domain: fm.domain || d, tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []), pinned: fm.pinned === 'true' || fm.pinned === true, blocks: bodyToBlocks(bodyNoH1) }
    } catch { /* try next domain */ }
  }
  return { found: false, name, title: name, domain: 'wiki', tags: ['missing'], pinned: false, blocks: [{ isP: true, text: 'Page not found in the wiki yet.' }] }
}

async function getProfile() {
  try {
    const text = await readFile(join(WIKI, 'personal', 'profile.md'), 'utf8')
    const sec = /##\s*Priorities now\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i.exec(text)
    const lines = sec ? sec[1].split('\n') : []
    const pris = []
    for (const l of lines) {
      const m = /^\s*\d+\.\s+(.*)$/.exec(l)
      if (m) { const v = m[1].trim(); pris.push(/^_?\(.*\)_?$/.test(v) ? '' : v) }
    }
    while (pris.length < 3) pris.push('')
    return { priorities: pris.slice(0, 3) }
  } catch { return { priorities: ['', '', ''] } }
}

async function setPriorities(p) {
  const file = join(WIKI, 'personal', 'profile.md')
  let text
  try { text = await readFile(file, 'utf8') } catch { return { ok: false, error: 'profile.md not found' } }
  const block = `## Priorities now\n1. ${p[0] || '_(fill in your #1 focus this week)_'}\n2. ${p[1] || '_(second)_'}\n3. ${p[2] || '_(third)_'}\n`
  if (/##\s*Priorities now/i.test(text)) text = text.replace(/##\s*Priorities now\s*\n(?:.*\n?)*?(?=\n##\s|$)/i, block + '\n')
  else text += '\n' + block
  await writeFile(file, text)
  return { ok: true }
}

async function getRegistry() {
  try {
    const j = JSON.parse(await readFile(join(REPO, 'config', 'projects.json'), 'utf8'))
    const reg = Object.entries(j).map(([path, v]) => ({ path, name: v.name || basename(path), status: v.status || 'unknown' }))
    return { registry: reg }
  } catch { return { registry: [] } }
}

async function getConfig() {
  try { return { config: await readFile(join(REPO, 'config', 'twin.config.json'), 'utf8') } } catch { return { config: '{}' } }
}

async function getDoctor() {
  const r = await twin('doctor')
  // strip ANSI, split into "Group:\n  mark text" structure
  const clean = r.stdout.replace(/\x1b\[[0-9;]*m/g, '')
  const groups = []
  let cur = null
  for (const raw of clean.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    const head = /^([A-Za-z].*?)(?:\s*\(.*\))?$/.exec(line)
    const row = /^\s+([✓!✗xX])\s+(.*)$/.exec(line)
    if (row) {
      const mk = row[1] === '✓' ? 'ok' : (row[1] === '!' ? 'warn' : 'fail')
      if (cur) cur.rows.push({ text: row[2], mark: mk })
    } else if (head && !line.startsWith(' ') && !/^twin @|^Pending/.test(line)) {
      cur = { label: line.trim(), rows: [] }
      groups.push(cur)
    }
  }
  return { groups: groups.filter(g => g.rows.length) }
}

async function search(q) {
  const r = await twin('search', q)
  return { ok: r.ok, output: (r.stdout || r.stderr || '').trim() }
}

// ---------- POST actions ----------
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}

async function postCapture(b) { const r = await twin('capture', String(b.text || '')); return { ok: r.ok, output: r.stdout.trim() || r.stderr.trim() } }
async function postReminder(b) {
  const a = b.action
  if (a === 'add') return finishRem(await swift(REM, 'add', String(b.title || ''), String(b.due || ''), String(b.list || '')))
  if (a === 'done') return finishRem(await swift(REM, 'done', String(b.match || '')))
  if (a === 'edit') return finishRem(await swift(REM, 'edit', String(b.match || ''), String(b.title || '')))
  if (a === 'delete') return finishRem(await swift(REM, 'delete', String(b.match || '')))
  if (a === 'move') return finishRem(await swift(REM, 'move', String(b.match || ''), String(b.list || '')))
  if (a === 'mklist') return finishRem(await swift(REM, 'mklist', String(b.list || '')))
  if (a === 'renamelist') return finishRem(await swift(REM, 'renamelist', String(b.list || ''), String(b.title || '')))
  if (a === 'dellist') return finishRem(await swift(REM, 'dellist', String(b.list || ''), String(b.target || '')))
  return { ok: false, error: 'unknown reminder action' }
}
function finishRem(r) { return { ok: r.ok, output: r.stdout.trim(), error: r.ok ? null : r.stderr.trim() } }

async function postRegistry(b) {
  // write straight to config/projects.json (twin track/private assume cwd)
  const file = join(REPO, 'config', 'projects.json')
  let j = {}
  try { j = JSON.parse(await readFile(file, 'utf8')) } catch { /* */ }
  j[b.path] = { status: b.status, name: b.name || basename(b.path), updated: b.updated || '' }
  await writeFile(file, JSON.stringify(j, null, 2))
  return { ok: true }
}

const JOB_TIMEOUT = 300000 // 5 min for heavy headless-claude jobs
async function postAsk(b) { const r = await twin('ask', String(b.q || '')); return { ok: r.ok, answer: (r.stdout || '').trim(), error: r.ok ? null : r.stderr.trim() } }
async function postJob(name) {
  const ok = ['ingest', 'tidy', 'lint', 'research', 'sync', 'agenda'].includes(name)
  if (!ok) return { ok: false, error: 'unknown job' }
  const r = await run(TWIN, [name], JOB_TIMEOUT)
  return { ok: r.ok, output: (r.stdout || '').trim(), error: r.ok ? null : (r.stderr || '').trim() }
}

// ---------- dispatcher ----------
export async function handle(req, res) {
  const url = new URL(req.url || '', 'http://localhost')
  const p = url.pathname.replace(/^\/+(api\/)?/, '')
  const q = (k, d) => url.searchParams.get(k) ?? d
  const json = (obj, code = 200) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
  try {
    if (req.method === 'GET') {
      switch (p) {
        case 'status': return json(await getStatus())
        case 'calendar': return json(await getCalendar(parseInt(q('days', '7'), 10)))
        case 'reminders': return json(await getReminders())
        case 'reminders/lists': return json(await getReminderLists())
        case 'captures': return json(await getCaptures())
        case 'activity': return json(await getActivity())
        case 'wiki/tree': return json(await getWikiTree())
        case 'wiki/page': return json(await getWikiPage(q('name', '')))
        case 'profile': return json(await getProfile())
        case 'registry': return json(await getRegistry())
        case 'config': return json(await getConfig())
        case 'doctor': return json(await getDoctor())
        case 'search': return json(await search(q('q', '')))
      }
    } else if (req.method === 'POST') {
      const b = await readBody(req)
      switch (p) {
        case 'capture': return json(await postCapture(b))
        case 'reminder': return json(await postReminder(b))
        case 'priorities': return json(await setPriorities(b.priorities || ['', '', '']))
        case 'registry': return json(await postRegistry(b))
        case 'ask': return json(await postAsk(b))
        case 'job': return json(await postJob(q('name', '')))
      }
    }
    json({ ok: false, error: 'not found: ' + p }, 404)
  } catch (e) {
    json({ ok: false, error: String(e?.message || e) }, 500)
  }
}
