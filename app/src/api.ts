// Client for the dev-server twin bridge (see app/server/twin-api.mjs).
export interface Status { inbox: number; chats: number; pages: number; tracked: number }
export interface Capture { file: string; ts: string; source: string; project: string | null; status: string; body: string }
export interface Reminder { title: string; due: string | null; list: string }
export interface Activity { ts: string; kind: string; text: string; detail: string }
export interface PageBlock { isH?: boolean; isP?: boolean; isBullet?: boolean; isTl?: boolean; text?: string; date?: string }
export interface WikiTreeDomain { key: string; label: string; pages: { name: string; pinned: boolean }[] }
export interface WikiPage { found: boolean; name: string; title: string; domain: string; tags: string[]; pinned: boolean; blocks: PageBlock[] }
export interface RegistryEntry { path: string; name: string; status: string }
export interface DoctorGroup { label: string; rows: { text: string; mark: string }[] }
export interface CalEvent { title: string; start: string; end: string; allDay: boolean; calendar: string; location?: string | null; url?: string | null }
export interface Finding { title: string; why: string; when: string; where: string; url: string; score: number; pushed?: boolean }
export interface Briefing { mostImportant?: string; schedule?: { time: string; what: string; prep?: string }[]; reminders?: { title: string; list?: string; due?: string; priority?: string }[]; projectPulse?: { project: string; status: string; next: string }[] }
export interface Today { date: string; briefing: Briefing | null; findings: Finding[] }

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch('/api/' + path)
  if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status)
  return r.json() as Promise<T>
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json() as Promise<T>
}

export const api = {
  status: () => getJSON<Status>('status'),
  reminders: () => getJSON<{ ok: boolean; reminders: Reminder[]; error?: string }>('reminders'),
  reminderLists: () => getJSON<{ ok: boolean; lists: string[] }>('reminders/lists'),
  captures: () => getJSON<{ captures: Capture[] }>('captures'),
  activity: () => getJSON<{ activity: Activity[] }>('activity'),
  wikiTree: () => getJSON<{ domains: WikiTreeDomain[] }>('wiki/tree'),
  wikiPage: (name: string) => getJSON<WikiPage>('wiki/page?name=' + encodeURIComponent(name)),
  profile: () => getJSON<{ priorities: string[] }>('profile'),
  today: () => getJSON<Today>('today'),
  registry: () => getJSON<{ registry: RegistryEntry[] }>('registry'),
  config: () => getJSON<{ config: string }>('config'),
  doctor: () => getJSON<{ groups: DoctorGroup[] }>('doctor'),
  calendar: (days = 7) => getJSON<{ ok: boolean; events: CalEvent[]; error?: string }>('calendar?days=' + days),
  search: (q: string) => getJSON<{ ok: boolean; output: string }>('search?q=' + encodeURIComponent(q)),

  capture: (text: string) => postJSON<{ ok: boolean; output: string }>('capture', { text }),
  reminderAdd: (title: string, due = '', list = '') => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'add', title, due, list }),
  reminderDone: (match: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'done', match }),
  reminderEdit: (match: string, title: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'edit', match, title }),
  reminderDelete: (match: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'delete', match }),
  reminderMove: (match: string, list: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'move', match, list }),
  listCreate: (list: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'mklist', list }),
  listRename: (list: string, title: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'renamelist', list, title }),
  listDelete: (list: string, target: string) => postJSON<{ ok: boolean; error?: string }>('reminder', { action: 'dellist', list, target }),
  setPriorities: (priorities: string[]) => postJSON<{ ok: boolean }>('priorities', { priorities }),
  setRegistry: (path: string, status: string, name?: string) => postJSON<{ ok: boolean }>('registry', { path, status, name }),
  ask: (q: string) => postJSON<{ ok: boolean; answer: string; error?: string }>('ask', { q }),
  job: (name: string) => postJSON<{ ok: boolean; output: string; error?: string }>('job?name=' + name, {}),
}
