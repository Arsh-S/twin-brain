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

// every reminder (complete + incomplete) in the given calendars
func allReminders(in cals: [EKCalendar]) -> [EKReminder] {
    let pred = store.predicateForReminders(in: cals)
    let s = DispatchSemaphore(value: 0); var res: [EKReminder] = []
    store.fetchReminders(matching: pred) { r in res = r ?? []; s.signal() }; s.wait()
    return res
}

func reminderSource() -> EKSource? {
    if let s = store.calendars(for: .reminder).first?.source { return s }
    if let s = store.sources.first(where: { $0.sourceType == .calDAV }) { return s }
    return store.defaultCalendarForNewReminders()?.source ?? store.sources.first
}

func getOrCreateList(_ name: String) throws -> EKCalendar {
    if let c = store.calendars(for: .reminder).first(where: { $0.title == name }) { return c }
    let c = EKCalendar(for: .reminder, eventStore: store)
    c.title = name
    guard let src = reminderSource() else {
        FileHandle.standardError.write("no reminder source available\n".data(using: .utf8)!); exit(1)
    }
    c.source = src
    try store.saveCalendar(c, commit: true)
    return c
}

// match by exact title first (case-insensitive), then by substring
func findReminder(_ q: String) -> EKReminder? {
    let needle = q.lowercased()
    let all = incomplete()
    return all.first(where: { ($0.title ?? "").lowercased() == needle }) ?? all.first(where: { ($0.title ?? "").lowercased().contains(needle) })
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
    if args.count > 4, !args[4].isEmpty {
        r.calendar = try getOrCreateList(args[4])
    } else { r.calendar = store.defaultCalendarForNewReminders() }
    try store.save(r, commit: true)
    print("added: \(r.title ?? "")")

case "lists":
    for c in store.calendars(for: .reminder) { print(c.title) }

case "mklist":
    guard args.count > 2 else { FileHandle.standardError.write("need a list name\n".data(using:.utf8)!); exit(1) }
    let c = try getOrCreateList(args[2]); print("list: \(c.title)")

case "move":
    guard args.count > 3 else { FileHandle.standardError.write("usage: move \"match\" \"List\"\n".data(using:.utf8)!); exit(1) }
    guard let r = findReminder(args[2]) else { FileHandle.standardError.write("no reminder matching \"\(args[2])\"\n".data(using:.utf8)!); exit(1) }
    let cal = try getOrCreateList(args[3])
    let t = r.title ?? ""
    r.calendar = cal
    try store.save(r, commit: true)
    print("moved: \(t) -> \(cal.title)")

case "renamelist":
    guard args.count > 3 else { FileHandle.standardError.write("usage: renamelist \"old\" \"new\"\n".data(using:.utf8)!); exit(1) }
    guard let cal = store.calendars(for: .reminder).first(where: { $0.title == args[2] }) else { FileHandle.standardError.write("no list \"\(args[2])\"\n".data(using:.utf8)!); exit(1) }
    if !cal.allowsContentModifications { FileHandle.standardError.write("list \"\(args[2])\" is read-only\n".data(using:.utf8)!); exit(1) }
    let old = cal.title; cal.title = args[3]
    try store.saveCalendar(cal, commit: true)
    print("renamed: \(old) -> \(args[3])")

case "dellist":
    guard args.count > 2 else { FileHandle.standardError.write("usage: dellist \"name\" [\"moveOpenTo\"]\n".data(using:.utf8)!); exit(1) }
    let reminderCals = store.calendars(for: .reminder)
    guard let cal = reminderCals.first(where: { $0.title == args[2] }) else { FileHandle.standardError.write("no list \"\(args[2])\"\n".data(using:.utf8)!); exit(1) }
    if reminderCals.count <= 1 { FileHandle.standardError.write("can't delete the only list\n".data(using:.utf8)!); exit(1) }
    // reassign open reminders in this list to a target list so they aren't lost
    let targetName = args.count > 3 && !args[3].isEmpty ? args[3] : (reminderCals.first(where: { $0.title != cal.title })?.title ?? "Reminders")
    let target = try getOrCreateList(targetName)
    if target.calendarIdentifier == cal.calendarIdentifier { FileHandle.standardError.write("target equals source\n".data(using:.utf8)!); exit(1) }
    // reassign EVERY reminder (complete + incomplete) so removeCalendar never destroys data
    var moved = 0
    for r in allReminders(in: [cal]) {
        r.calendar = target; try store.save(r, commit: false); moved += 1
    }
    if moved > 0 { try store.commit() }
    try store.removeCalendar(cal, commit: true)
    print("deleted list: \(args[2]) (moved \(moved) → \(target.title))")

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
