// twin reminders via EventKit (no Reminders.app launch).
// Usage:
//   swift twin-rem.swift list
//   swift twin-rem.swift add "title" ["YYYY-MM-DD HH:mm"] ["List"]
//   swift twin-rem.swift done "match substring"
//   swift twin-rem.swift edit "match substring" "new title"
//   swift twin-rem.swift delete "match substring"
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

let args = CommandLine.arguments
let action = args.count > 1 ? args[1] : "list"

func parseDate(_ s: String) -> DateComponents? {
    for fmt in ["yyyy-MM-dd HH:mm", "yyyy-MM-dd", "MMMM d, yyyy h:mm a"] {
        let df = DateFormatter(); df.dateFormat = fmt
        if let d = df.date(from: s) {
            return Calendar.current.dateComponents([.year,.month,.day,.hour,.minute], from: d)
        }
    }
    return nil
}

func incomplete() -> [EKReminder] {
    let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    let s = DispatchSemaphore(value: 0); var res: [EKReminder] = []
    store.fetchReminders(matching: pred) { r in res = r ?? []; s.signal() }; s.wait()
    return res
}

switch action {
case "list":
    let df = DateFormatter(); df.dateFormat = "MMM d"
    let rems = incomplete()
    for r in rems {
        var due = ""
        if let dc = r.dueDateComponents, let d = Calendar.current.date(from: dc) { due = "  (due \(df.string(from: d)))" }
        print("- \(r.title ?? "(untitled)")\(due)  [\(r.calendar.title)]")
    }
    if rems.isEmpty { print("(no open reminders)") }

case "add":
    guard args.count > 2 else { FileHandle.standardError.write("need a title\n".data(using:.utf8)!); exit(1) }
    let r = EKReminder(eventStore: store)
    r.title = args[2]
    if args.count > 3, !args[3].isEmpty, let dc = parseDate(args[3]) { r.dueDateComponents = dc }
    if args.count > 4, !args[4].isEmpty, let cal = store.calendars(for: .reminder).first(where: { $0.title == args[4] }) {
        r.calendar = cal
    } else { r.calendar = store.defaultCalendarForNewReminders() }
    try store.save(r, commit: true)
    print("added: \(r.title ?? "")")

case "done", "edit", "delete":
    guard args.count > 2 else { FileHandle.standardError.write("need a match string\n".data(using:.utf8)!); exit(1) }
    let needle = args[2].lowercased()
    let matches = incomplete().filter { ($0.title ?? "").lowercased().contains(needle) }
    guard let r = matches.first else { FileHandle.standardError.write("no reminder matching \"\(args[2])\"\n".data(using:.utf8)!); exit(1) }
    if matches.count > 1 { FileHandle.standardError.write("note: \(matches.count) matched, acting on first: \(r.title ?? "")\n".data(using:.utf8)!) }
    if action == "done" {
        r.isCompleted = true; try store.save(r, commit: true); print("completed: \(r.title ?? "")")
    } else if action == "edit" {
        guard args.count > 3 else { FileHandle.standardError.write("need new title\n".data(using:.utf8)!); exit(1) }
        let old = r.title ?? ""; r.title = args[3]; try store.save(r, commit: true); print("edited: \(old) -> \(args[3])")
    } else {
        let t = r.title ?? ""; try store.remove(r, commit: true); print("deleted: \(t)")
    }

default:
    FileHandle.standardError.write("unknown action: \(action)\n".data(using:.utf8)!); exit(1)
}
