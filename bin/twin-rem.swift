// twin reminders reader — reads open reminders from EventKit directly (no Reminders.app launch).
// Usage: swift twin-rem.swift
import EventKit
import Foundation

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)
var granted = false
if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders { ok, _ in granted = ok; sema.signal() }
} else {
    store.requestAccess(to: .reminder) { ok, _ in granted = ok; sema.signal() }
}
sema.wait()
guard granted else {
    FileHandle.standardError.write("twin: Reminders access denied (System Settings > Privacy > Reminders)\n".data(using: .utf8)!)
    exit(1)
}

let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
let sema2 = DispatchSemaphore(value: 0)
var out: [String] = []
let df = DateFormatter(); df.dateFormat = "MMM d"
store.fetchReminders(matching: pred) { rems in
    for r in (rems ?? []) {
        var due = ""
        if let d = r.dueDateComponents, let date = Calendar.current.date(from: d) { due = "  (due \(df.string(from: date)))" }
        out.append("- \(r.title ?? "(untitled)")\(due)  [\(r.calendar.title)]")
    }
    sema2.signal()
}
sema2.wait()
for line in out { print(line) }
if out.isEmpty { print("(no open reminders)") }
