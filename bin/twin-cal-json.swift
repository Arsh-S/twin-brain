// twin calendar reader (JSON) — reads events from EventKit, emits JSON for the twin app.
// Usage: swift twin-cal-json.swift [spanDays=7]
import EventKit
import Foundation

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)
var granted = false
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, _ in granted = ok; sema.signal() }
} else {
    store.requestAccess(to: .event) { ok, _ in granted = ok; sema.signal() }
}
sema.wait()
guard granted else {
    FileHandle.standardError.write("twin: Calendar access denied (System Settings > Privacy > Calendars)\n".data(using: .utf8)!)
    exit(1)
}

let span = CommandLine.arguments.count > 1 ? (Int(CommandLine.arguments[1]) ?? 7) : 7
let cal = Calendar.current
let start = cal.startOfDay(for: Date())
let end = cal.date(byAdding: .day, value: max(1, span), to: start)!

let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }

let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime]

struct Ev: Encodable {
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let calendar: String
    let location: String?
    let url: String?
}

func clip(_ s: String?, _ n: Int) -> String? {
    guard let s = s, !s.isEmpty else { return nil }
    return s.count > n ? String(s.prefix(n)) : s
}

let out = events.map { e in
    Ev(title: e.title ?? "(untitled)",
       start: iso.string(from: e.startDate),
       end: iso.string(from: e.endDate),
       allDay: e.isAllDay,
       calendar: e.calendar.title,
       location: clip(e.location, 200),
       url: e.url?.absoluteString)
}

let enc = JSONEncoder()
let data = (try? enc.encode(out)) ?? "[]".data(using: .utf8)!
FileHandle.standardOutput.write(data)
