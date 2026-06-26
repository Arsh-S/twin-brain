// TwinBar — twin's menu bar companion (LSUIElement, no Dock / no taskbar).
//
// A polished SwiftUI MenuBarExtra app that puts twin one click away in the menu bar:
//   • Quick text capture (⌘↩) straight into the inbox
//   • Voice notes: record → on-device transcription → capture (audio archived to inbox)
//   • Ask twin (answer inline, with citations)
//   • One-tap jobs: ingest, sync, agenda, nightly, scout, tidy
//   • Capture the clipboard, open the dashboard, live brain status
//
// It drives the same `twin` CLI the rest of the system uses (no private API), so it
// stays correct as the CLI evolves. Built/bundled/signed by bin/build-twin-bar.sh and
// kept alive at login by ~/Library/LaunchAgents/com.twin.bar.plist.

import SwiftUI
import AppKit
import AVFoundation
import Speech
import UniformTypeIdentifiers

// MARK: - Configuration

enum Cfg {
    static let home = NSHomeDirectory()
    // Vault location: honour a TWIN_DIR override (install.sh --dir), else ~/twin.
    static let repo = ProcessInfo.processInfo.environment["TWIN_DIR"] ?? "\(home)/twin"
    static let twinBin = "\(repo)/bin/twin"
    static let inbox = "\(repo)/raw-sources/inbox"
    static let dashboard = "http://localhost:5179"
    static let version = "1.0"

    // Common bin dirs the CLI's children (claude, node, git, swift) need. We run via a
    // login shell (`zsh -lc`) which re-sources the user's profile, so version-managed
    // toolchains (nvm, etc.) are picked up on top of these defaults.
    static var childPath: String {
        let base = [
            "\(home)/.local/bin", "\(home)/.cargo/bin",
            "/opt/homebrew/bin", "/usr/local/bin",
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ].joined(separator: ":")
        let inherited = ProcessInfo.processInfo.environment["PATH"] ?? ""
        return inherited.isEmpty ? base : "\(base):\(inherited)"
    }
}

// MARK: - CLI bridge

struct CmdResult { let ok: Bool; let out: String; let err: String }

enum TwinCLI {
    /// Run the twin CLI with an argv array (no shell, so capture text needs no escaping).
    static func run(_ args: [String], timeout: TimeInterval = 180) async -> CmdResult {
        await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/zsh")
                // -lc keeps a login env; we exec twin directly via "$@" so the
                // capture body is passed as a positional arg, never re-parsed.
                p.arguments = ["-lc", "exec \"$0\" \"$@\"", Cfg.twinBin] + args
                p.currentDirectoryURL = URL(fileURLWithPath: Cfg.repo)
                var env = ProcessInfo.processInfo.environment
                env["PATH"] = Cfg.childPath
                p.environment = env

                let outPipe = Pipe(), errPipe = Pipe()
                p.standardOutput = outPipe
                p.standardError = errPipe
                var outData = Data(), errData = Data()
                outPipe.fileHandleForReading.readabilityHandler = { outData.append($0.availableData) }
                errPipe.fileHandleForReading.readabilityHandler = { errData.append($0.availableData) }

                do { try p.run() } catch {
                    cont.resume(returning: CmdResult(ok: false, out: "", err: error.localizedDescription)); return
                }

                let deadline = DispatchTime.now() + timeout
                let group = DispatchGroup(); group.enter()
                DispatchQueue.global().async { p.waitUntilExit(); group.leave() }
                if group.wait(timeout: deadline) == .timedOut { p.terminate() }
                p.waitUntilExit()
                outPipe.fileHandleForReading.readabilityHandler = nil
                errPipe.fileHandleForReading.readabilityHandler = nil
                let out = String(data: outData, encoding: .utf8) ?? ""
                let err = String(data: errData, encoding: .utf8) ?? ""
                cont.resume(returning: CmdResult(ok: p.terminationStatus == 0, out: out, err: err))
            }
        }
    }
}

// MARK: - Voice recorder + on-device transcription

@MainActor
final class Recorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var isRecording = false
    @Published var elapsed: TimeInterval = 0
    @Published var level: CGFloat = 0          // 0…1 smoothed mic level for the waveform
    @Published var transcribing = false

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var fileURL: URL?

    static func micAuthorized() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    func start() {
        let stamp = Self.stamp()
        let url = URL(fileURLWithPath: "\(Cfg.inbox)/voice-\(stamp).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.delegate = self
            r.isMeteringEnabled = true
            r.record()
            recorder = r; fileURL = url; isRecording = true; elapsed = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.tick() }
            }
        } catch {
            isRecording = false
        }
    }

    private func tick() {
        guard let r = recorder, r.isRecording else { return }
        r.updateMeters()
        elapsed = r.currentTime
        let db = r.averagePower(forChannel: 0)               // -160…0
        let norm = max(0, CGFloat((db + 55) / 55))           // emphasise speech range
        level = level * 0.7 + min(1, norm) * 0.3             // smooth
    }

    /// Stop and return the recorded file URL (nil if nothing usable was captured).
    func stop() -> URL? {
        timer?.invalidate(); timer = nil
        recorder?.stop()
        isRecording = false; level = 0
        let url = fileURL
        recorder = nil
        if let u = url, (try? u.checkResourceIsReachable()) == true { return u }
        return nil
    }

    func cancel() {
        _ = stop()
        if let u = fileURL { try? FileManager.default.removeItem(at: u) }
        fileURL = nil; elapsed = 0
    }

    /// Transcribe an audio file on-device (falls back to server recognition if needed).
    func transcribe(_ url: URL) async -> String? {
        transcribing = true
        defer { transcribing = false }
        let status: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { c in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
        }
        guard status == .authorized,
              let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), rec.isAvailable
        else { return nil }
        let req = SFSpeechURLRecognitionRequest(url: url)
        req.requiresOnDeviceRecognition = rec.supportsOnDeviceRecognition
        req.addsPunctuation = true
        return await withCheckedContinuation { cont in
            var done = false
            rec.recognitionTask(with: req) { result, error in
                if let result, result.isFinal, !done {
                    done = true; cont.resume(returning: result.bestTranscription.formattedString)
                } else if error != nil, !done {
                    done = true
                    cont.resume(returning: result?.bestTranscription.formattedString)
                }
            }
        }
    }

    static func stamp() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmmss"; return f.string(from: Date())
    }
}

// MARK: - App state

@MainActor
final class AppState: ObservableObject {
    @Published var inbox = 0
    @Published var chats = 0
    @Published var pages = 0
    @Published var tracked = 0
    @Published var statusLoaded = false

    @Published var busy = false
    @Published var busyLabel = ""
    @Published var toast: String?
    @Published var toastOK = true

    @Published var answer: String?            // last "ask" answer or job output
    @Published var answerTitle = ""

    let recorder = Recorder()

    func refresh() async {
        let r = await TwinCLI.run(["status"], timeout: 25)
        func num(_ label: String) -> Int {
            guard let m = try? NSRegularExpression(pattern: label + "\\s*:?\\s*(\\d+)"),
                  let hit = m.firstMatch(in: r.out, range: NSRange(r.out.startIndex..., in: r.out)),
                  let rng = Range(hit.range(at: 1), in: r.out) else { return 0 }
            return Int(r.out[rng]) ?? 0
        }
        inbox = num("inbox unprocessed"); chats = num("chats unprocessed")
        pages = num("wiki pages"); tracked = num("tracked projects")
        statusLoaded = true
    }

    private func flash(_ msg: String, ok: Bool) {
        toast = msg; toastOK = ok
        Task { try? await Task.sleep(nanoseconds: 4_000_000_000); if toast == msg { toast = nil } }
    }

    // MARK: text capture
    func capture(_ text: String, source: String = "menubar") async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        busy = true; busyLabel = "Capturing…"
        let r = await TwinCLI.run(["capture", body, "--source", source], timeout: 30)
        busy = false
        flash(r.ok ? "Captured to inbox" : "Capture failed", ok: r.ok)
        await refresh()
    }

    func captureClipboard() async {
        let s = NSPasteboard.general.string(forType: .string) ?? ""
        if s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { flash("Clipboard is empty", ok: false); return }
        await capture(s, source: "clipboard")
    }

    // MARK: voice
    func recordToggle() async {
        if recorder.isRecording {
            guard let url = recorder.stop() else { flash("No audio captured", ok: false); return }
            busy = true; busyLabel = "Transcribing…"
            let text = await recorder.transcribe(url)
            busy = false
            let stamp = url.deletingPathExtension().lastPathComponent
            if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let note = "\(text)\n\n_(voice note — audio: raw-sources/inbox/\(url.lastPathComponent))_"
                let r = await TwinCLI.run(["capture", note, "--source", "voice"], timeout: 30)
                answerTitle = "Voice note"; answer = text
                flash(r.ok ? "Voice note captured" : "Capture failed", ok: r.ok)
            } else {
                // Keep the audio in the inbox even if transcription was empty.
                let r = await TwinCLI.run(["capture", "Voice note (transcription unavailable) — audio: raw-sources/inbox/\(url.lastPathComponent)", "--source", "voice"], timeout: 30)
                flash(r.ok ? "Voice note saved (no transcript)" : "Save failed", ok: r.ok)
                _ = stamp
            }
            await refresh()
        } else {
            guard await Recorder.micAuthorized() else {
                flash("Microphone access denied — System Settings ▸ Privacy", ok: false); return
            }
            recorder.start()
            if !recorder.isRecording { flash("Couldn't start recording", ok: false) }
        }
    }

    // MARK: ask
    func ask(_ q: String) async {
        let query = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        busy = true; busyLabel = "Asking twin…"; answer = nil; answerTitle = "Asking…"
        let r = await TwinCLI.run(["ask", query], timeout: 300)
        busy = false
        answerTitle = "twin: \(query)"
        answer = (r.ok ? r.out : r.err).trimmingCharacters(in: .whitespacesAndNewlines)
        if answer?.isEmpty != false { answer = r.ok ? "(no answer)" : "ask failed" }
    }

    // MARK: jobs
    func job(_ name: String, label: String, timeout: TimeInterval = 600) async {
        busy = true; busyLabel = "\(label)…"; answerTitle = label; answer = nil
        let r = await TwinCLI.run([name], timeout: timeout)
        busy = false
        let body = (r.ok ? r.out : r.err).trimmingCharacters(in: .whitespacesAndNewlines)
        answer = body.isEmpty ? (r.ok ? "Done." : "Failed.") : body
        flash(r.ok ? "\(label) done" : "\(label) failed", ok: r.ok)
        await refresh()
    }

    func openDashboard() {
        if let url = URL(string: Cfg.dashboard) { NSWorkspace.shared.open(url) }
    }
    func revealInbox() {
        NSWorkspace.shared.open(URL(fileURLWithPath: Cfg.inbox))
    }
}

// MARK: - Views

struct Pill: View {
    let value: Int; let label: String; let tint: Color
    var body: some View {
        VStack(spacing: 1) {
            Text("\(value)").font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(tint)
            Text(label).font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct ActionButton: View {
    let title: String; let icon: String; var tint: Color = .accentColor; let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 15, weight: .medium)).foregroundStyle(tint)
                Text(title).font(.system(size: 10, weight: .medium)).foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, minHeight: 46)
            .background((hover ? tint.opacity(0.16) : Color.secondary.opacity(0.07)),
                        in: RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct Waveform: View {
    let level: CGFloat
    @State private var phase = 0.0
    let bars = 13
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<bars, id: \.self) { i in
                let d = abs(Double(i) - Double(bars) / 2) / Double(bars)
                let h = 4 + level * 22 * CGFloat(0.5 + 0.5 * cos(phase + Double(i)) * (1 - d))
                Capsule().fill(Color.red.opacity(0.85)).frame(width: 3, height: max(3, h))
            }
        }
        .frame(height: 26)
        .onAppear {
            withAnimation(.linear(duration: 0.6).repeatForever(autoreverses: false)) { phase = .pi * 2 }
        }
    }
}

struct PanelView: View {
    @EnvironmentObject var st: AppState
    @ObservedObject var rec: Recorder
    @State private var captureText = ""
    @State private var askText = ""
    @FocusState private var captureFocused: Bool

    init(rec: Recorder) { self.rec = rec }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Divider()
            captureSection
            voiceSection
            askSection
            Divider()
            actionGrid
            if let answer = st.answer { answerView(answer) }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 384)
        .task { await st.refresh() }
    }

    private var header: some View {
      VStack(spacing: 9) {
        HStack(spacing: 8) {
            Image(systemName: "brain")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(LinearGradient(colors: [.purple, .pink], startPoint: .top, endPoint: .bottom))
            VStack(alignment: .leading, spacing: 0) {
                Text("twin").font(.system(size: 15, weight: .bold, design: .rounded))
                Text("arsh-twin").font(.system(size: 9)).foregroundStyle(.secondary)
            }
            Spacer()
            if st.busy {
                HStack(spacing: 5) {
                    ProgressView().controlSize(.small)
                    Text(st.busyLabel).font(.system(size: 10)).foregroundStyle(.secondary)
                }
            } else {
                Button { Task { await st.refresh() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
                }.buttonStyle(.plain).foregroundStyle(.secondary).help("Refresh status")
            }
        }
        HStack(spacing: 7) {
            Pill(value: st.inbox, label: "inbox", tint: .orange)
            Pill(value: st.chats, label: "chats", tint: .blue)
            Pill(value: st.pages, label: "pages", tint: .green)
            Pill(value: st.tracked, label: "tracked", tint: .purple)
        }
      }
    }

    private var captureSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Quick capture", systemImage: "square.and.pencil")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            ZStack(alignment: .topLeading) {
                if captureText.isEmpty {
                    Text("A thought, link, or fact…")
                        .font(.system(size: 12)).foregroundStyle(.tertiary)
                        .padding(.horizontal, 6).padding(.vertical, 7).allowsHitTesting(false)
                }
                TextEditor(text: $captureText)
                    .font(.system(size: 12)).scrollContentBackground(.hidden)
                    .frame(height: 54).padding(2).focused($captureFocused)
            }
            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.15)))
            HStack {
                Button { Task { await st.captureClipboard() } } label: {
                    Label("Clipboard", systemImage: "doc.on.clipboard").font(.system(size: 11))
                }.buttonStyle(.plain).foregroundStyle(.secondary)
                Spacer()
                Text("⌘↩").font(.system(size: 10)).foregroundStyle(.tertiary)
                Button {
                    let t = captureText; captureText = ""
                    Task { await st.capture(t) }
                } label: {
                    Label("Capture", systemImage: "tray.and.arrow.down.fill").font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.borderedProminent).controlSize(.small)
                .disabled(captureText.trimmingCharacters(in: .whitespaces).isEmpty)
                .keyboardShortcut(.return, modifiers: .command)
            }
        }
    }

    private var voiceSection: some View {
        HStack(spacing: 10) {
            Button { Task { await st.recordToggle() } } label: {
                ZStack {
                    Circle().fill(rec.isRecording ? Color.red : Color.red.opacity(0.12))
                        .frame(width: 40, height: 40)
                    Image(systemName: rec.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(rec.isRecording ? .white : .red)
                }
            }.buttonStyle(.plain)
            if rec.isRecording {
                Waveform(level: rec.level)
                Spacer()
                Text(timeStr(rec.elapsed)).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(.red)
            } else if rec.transcribing {
                ProgressView().controlSize(.small)
                Text("Transcribing voice note…").font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Voice note").font(.system(size: 12, weight: .semibold))
                    Text("Record · transcribe on-device · capture").font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .padding(8)
        .background(Color.red.opacity(rec.isRecording ? 0.07 : 0.04), in: RoundedRectangle(cornerRadius: 9))
    }

    private var askSection: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkle.magnifyingglass").font(.system(size: 12)).foregroundStyle(.purple)
            TextField("Ask twin anything…", text: $askText)
                .textFieldStyle(.plain).font(.system(size: 12))
                .onSubmit { let q = askText; askText = ""; Task { await st.ask(q) } }
            if !askText.isEmpty {
                Button { let q = askText; askText = ""; Task { await st.ask(q) } } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 16)).foregroundStyle(.purple)
                }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 9).padding(.vertical, 7)
        .background(Color.purple.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    private var actionGrid: some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 7), count: 4)
        return LazyVGrid(columns: cols, spacing: 7) {
            ActionButton(title: "Dashboard", icon: "rectangle.on.rectangle", tint: .blue) { st.openDashboard() }
            ActionButton(title: "Agenda", icon: "calendar", tint: .red) { Task { await st.job("agenda", label: "Agenda", timeout: 120) } }
            ActionButton(title: "Ingest", icon: "tray.and.arrow.down", tint: .orange) { Task { await st.job("ingest", label: "Ingest") } }
            ActionButton(title: "Sync", icon: "arrow.triangle.2.circlepath", tint: .green) { Task { await st.job("sync", label: "Sync", timeout: 180) } }
            ActionButton(title: "Scout", icon: "binoculars", tint: .teal) { Task { await st.job("scout", label: "Scout") } }
            ActionButton(title: "Tidy", icon: "wand.and.sparkles", tint: .indigo) { Task { await st.job("tidy", label: "Tidy") } }
            ActionButton(title: "Nightly", icon: "moon.stars", tint: .purple) { Task { await st.job("nightly", label: "Nightly", timeout: 900) } }
            ActionButton(title: "Inbox", icon: "folder", tint: .gray) { st.revealInbox() }
        }
    }

    private func answerView(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(st.answerTitle).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string) } label: {
                    Image(systemName: "doc.on.doc").font(.system(size: 10))
                }.buttonStyle(.plain).foregroundStyle(.secondary).help("Copy")
                Button { st.answer = nil } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 11))
                }.buttonStyle(.plain).foregroundStyle(.tertiary)
            }
            ScrollView {
                Text(LocalizedStringKey(text)).font(.system(size: 11)).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 150)
        }
        .padding(9)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if let toast = st.toast {
                Image(systemName: st.toastOK ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(st.toastOK ? .green : .orange).font(.system(size: 11))
                Text(toast).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
            } else {
                Text("twin menu bar v\(Cfg.version)").font(.system(size: 10)).foregroundStyle(.tertiary)
            }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
                .buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(.secondary)
                .keyboardShortcut("q")
        }
    }

    private func timeStr(_ t: TimeInterval) -> String {
        String(format: "%d:%02d", Int(t) / 60, Int(t) % 60)
    }
}

// MARK: - App

@main
struct TwinBarApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        MenuBarExtra {
            PanelView(rec: state.recorder).environmentObject(state)
        } label: {
            Image(systemName: "brain")
        }
        .menuBarExtraStyle(.window)
    }
}
