export type Screen =
  | 'today' | 'capture' | 'ask' | 'wiki' | 'tasks' | 'calendar' | 'maintain' | 'settings'

export type Mode = 'light' | 'dark'
export type Direction = 'A' | 'B' // Editorial (serif) vs Console (mono)

export type ProjectStatus = 'tracked' | 'private' | 'unknown'
export type Rsvp = 'needsAction' | 'accepted' | 'declined'
export type IngestState = 'idle' | 'running' | 'done'
export type JobStatus = 'idle' | 'running' | 'done'

export interface Capture {
  id: number
  ts: string
  source: string
  project: string | null
  status: 'unprocessed' | 'processed'
  body: string
}

export interface Reminder {
  id: number
  text: string
  group: string
  due?: string
  done: boolean
}

export interface AskMessage {
  role: 'user' | 'assistant'
  text: string
  sources?: string[]
}

export interface RegistryEntry {
  path: string
  name: string
  status: ProjectStatus
}

export interface MaintEntry {
  status: JobStatus
  result: string
  last: string
}

export interface ActivityItem {
  ts: string
  kind: string
  text: string
  detail?: string
}

export interface Job {
  id: number
  label: string
  note: string
}

export interface WikiPage {
  domain: string
  tags: string[]
  pinned: boolean
  summary: string[]
  sections: { h: string; bullets: string[] }[]
  timeline: { date: string; text: string }[]
}

export interface AppState {
  screen: Screen
  mode: Mode
  direction: Direction
  accent: string
  captureDraft: string
  askDraft: string
  reminderDraft: string
  wikiSearch: string
  currentPage: string
  editing: boolean
  calendarAccess: boolean
  rsvp: Rsvp
  ingestState: IngestState
  askBusy: boolean
  jobs: Job[]
  priorities: string[]
  captures: Capture[]
  reminders: Reminder[]
  askThread: AskMessage[]
  registry: RegistryEntry[]
  maint: Record<string, MaintEntry>
  activity: ActivityItem[]
}
