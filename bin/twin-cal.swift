// twin calendar reader — reads events from EventKit directly (no Calendar.app launch).
// Usage: swift twin-cal.swift [spanDays=1]
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

let span = CommandLine.arguments.count > 1 ? (Int(CommandLine.arguments[1]) ?? 1) : 1
let cal = Calendar.current
let start = cal.startOfDay(for: Date())
let end = cal.date(byAdding: .day, value: max(1, span), to: start)!

let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }

let df = DateFormatter()
df.dateFormat = "EEE MMM d HH:mm"
for e in events {
    let when = e.isAllDay ? "all-day    " : df.string(from: e.startDate)
    print("\(when)  |  \(e.title ?? "(untitled)")  [\(e.calendar.title)]")
}
if events.isEmpty { print("(no events in range)") }
