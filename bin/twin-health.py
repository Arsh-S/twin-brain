#!/usr/bin/env python3
"""twin-health: deterministic Apple Health (Health Auto Export) normalizer.

No LLM, no third-party deps. Turns daily HealthKit JSON into per-day wiki
records and regenerates wiki/personal/health.md. Metric-agnostic: keys off
each metric's name; nothing is required.
"""
import glob
import io
import json
import os
import re
import statistics
import zipfile
import xml.etree.ElementTree as ET

AVG_HINTS = ("heart_rate", "variability", "hrv", "speed", "percentage",
             "asymmetry", "double_support", "step_length", "oxygen",
             "respiratory", "audio_exposure", "blood_glucose")
LATEST_HINTS = ("weight", "body_mass", "body_fat", "height", "lean_body_mass")
SUM_EXPLICIT = ("active_energy", "basal_energy_burned", "step_count",
                "walking_running_distance", "flights_climbed",
                "apple_exercise_time", "dietary_water")
SLEEP_STAGES = ("asleep", "core", "deep", "rem", "awake", "inBed")
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def classify(name):
    n = name.lower()
    if n == "sleep_analysis":
        return "sleep"
    if any(h in n for h in LATEST_HINTS):
        return "latest"
    if any(h in n for h in AVG_HINTS):
        return "avg"
    return "sum"  # explicit sums + unknown default


def _qtys(samples):
    return [s["qty"] for s in samples if isinstance(s.get("qty"), (int, float))]


def aggregate_metric(metric):
    """Aggregate one metric's intraday samples to a single day value.
    Returns {name, kind, value, units} or None when there's nothing to report."""
    name = metric.get("name", "")
    units = metric.get("units", "")
    kind = classify(name)
    data = metric.get("data", []) or []
    if kind == "sleep":
        return None  # handled by aggregate_sleep
    qtys = _qtys(data)
    if not qtys:
        return None
    if kind == "sum":
        value = sum(qtys)
    elif kind == "avg":
        value = statistics.mean(qtys)
    else:  # latest: pick the sample with the max date string (ISO-ish sorts)
        latest = max(data, key=lambda s: s.get("date", ""))
        value = latest.get("qty")
    return {"name": name, "kind": kind, "value": value, "units": units}


def aggregate_sleep(metric):
    data = metric.get("data", []) or []
    if not data:
        return None
    out = {}
    for stage in SLEEP_STAGES:
        vals = [s[stage] for s in data
                if isinstance(s.get(stage), (int, float))]
        if vals:
            out[stage] = sum(vals)
    return out or None


def _workout_minutes(w):
    d = w.get("duration")
    if isinstance(d, (int, float)):
        # Health Auto Export durations are seconds; > 180 means seconds.
        return round(d / 60) if d > 180 else round(d)
    return None


def normalize_day(day_json):
    """Full day JSON -> {metrics: {name: agg}, sleep: {...}|None, workouts: [...]}"""
    container = day_json.get("data", {})
    metrics_out = {}
    sleep_out = None
    for m in container.get("metrics", []) or []:
        if classify(m.get("name", "")) == "sleep":
            sleep_out = aggregate_sleep(m)
            continue
        agg = aggregate_metric(m)
        if agg:
            metrics_out[agg["name"]] = agg
    workouts_out = []
    for w in container.get("workouts", []) or []:
        workouts_out.append({"name": w.get("name", "Workout"),
                             "minutes": _workout_minutes(w)})
    return {"metrics": metrics_out, "sleep": sleep_out, "workouts": workouts_out}


def _fmt_num(x):
    if isinstance(x, float):
        return f"{x:.1f}".rstrip("0").rstrip(".")
    return str(x)


def render_record_md(date, rec):
    """Per-day immutable raw record written to raw-sources/health/.
    Human-readable bullets + a machine-readable twin-health-data JSON block."""
    lines = [f"# Health {date}", ""]
    if rec["sleep"]:
        s = rec["sleep"]
        parts = [f"{k} {_fmt_num(v)}h" for k, v in s.items()]
        lines.append("- **sleep:** " + ", ".join(parts))
    for name, a in sorted(rec["metrics"].items()):
        lines.append(f"- **{name}:** {_fmt_num(a['value'])} {a['units']} "
                     f"({a['kind']})")
    for w in rec["workouts"]:
        mins = f"{w['minutes']}min" if w["minutes"] is not None else "?"
        lines.append(f"- **workout:** {w['name']} {mins}")
    payload = {"date": date,
               "metrics": {k: v["value"] for k, v in rec["metrics"].items()},
               "sleep": rec["sleep"], "workouts": rec["workouts"]}
    lines += ["", "```twin-health-data",
              json.dumps(payload, separators=(",", ":")), "```", "",
              "_source: raw Health Auto Export JSON (deterministic "
              "aggregation, no LLM)_", ""]
    return "\n".join(lines)


# --- state ---------------------------------------------------------------

def _seen_path(twin_dir):
    return os.path.join(twin_dir, ".state", "health-seen.json")


def _load_seen(twin_dir):
    try:
        return json.load(open(_seen_path(twin_dir)))
    except Exception:
        return {}


def _save_seen(twin_dir, seen):
    os.makedirs(os.path.dirname(_seen_path(twin_dir)), exist_ok=True)
    json.dump(seen, open(_seen_path(twin_dir), "w"), indent=2)


def _day_from_name(path):
    m = DATE_RE.search(os.path.basename(path))
    return m.group(1) if m else None


def ingest(watch_dir, twin_dir):
    """Discover unseen daily JSON, normalize, write raw-sources/health/<day>.md.
    Idempotent via .state/health-seen.json keyed by day. Returns count ingested."""
    if not os.path.isdir(watch_dir):
        return 0
    seen = _load_seen(twin_dir)
    out_dir = os.path.join(twin_dir, "raw-sources", "health")
    os.makedirs(out_dir, exist_ok=True)
    count = 0
    for path in sorted(glob.glob(os.path.join(watch_dir, "*.json"))):
        day = _day_from_name(path)
        if not day:
            continue
        try:
            with open(path) as f:
                obj = json.load(f)
        except Exception:
            continue  # mid-sync / malformed: skip, retry next run
        sig = f"{day}:{os.path.getsize(path)}"
        if seen.get(day) == sig:
            continue
        rec = normalize_day(obj)
        with open(os.path.join(out_dir, f"{day}.md"), "w") as f:
            f.write(render_record_md(day, rec))
        seen[day] = sig
        count += 1
    _save_seen(twin_dir, seen)
    return count


# --- page generation -----------------------------------------------------

def _read_records(twin_dir):
    """Parse the embedded twin-health-data blocks from all per-day records."""
    out_dir = os.path.join(twin_dir, "raw-sources", "health")
    records = []
    for path in sorted(glob.glob(os.path.join(out_dir, "*.md"))):
        txt = open(path).read()
        m = re.search(r"```twin-health-data\n(.*?)\n```", txt, re.S)
        if m:
            try:
                records.append(json.loads(m.group(1)))
            except Exception:
                pass
    return records


def _trend(records, metric, days):
    vals = [r["metrics"].get(metric) for r in records[-days:]
            if metric in r.get("metrics", {})]
    vals = [v for v in vals if isinstance(v, (int, float))]
    return statistics.mean(vals) if vals else None


def build_page(twin_dir):
    """Regenerate wiki/personal/health.md (summary baselines + trends + timeline)."""
    records = _read_records(twin_dir)
    page = os.path.join(twin_dir, "wiki", "personal", "health.md")
    os.makedirs(os.path.dirname(page), exist_ok=True)
    all_metrics = sorted({k for r in records for k in r.get("metrics", {})})
    lines = ["---", "domain: personal", "tags: [health, body]",
             f"updated: {records[-1]['date'] if records else 'n/a'}", "---",
             "", "# Health", "",
             "Compiled physical-state page for [[profile]]. Numbers are "
             "deterministically aggregated from Apple Health exports (no LLM). "
             "Coverage depends on which metrics the export contains.", "",
             "## Baselines (7-day / 30-day average)", ""]
    if not records:
        lines.append("_No health data ingested yet._")
    else:
        for metric in all_metrics:
            w = _trend(records, metric, 7)
            mo = _trend(records, metric, 30)
            if w is None:
                continue
            lines.append(f"- **{metric}:** 7d {_fmt_num(w)} / "
                         f"30d {_fmt_num(mo)}")
        lines += ["", "## Timeline", ""]
        for r in records[-30:]:
            bits = [f"{k} {_fmt_num(v)}" for k, v in
                    sorted(r.get("metrics", {}).items())]
            if r.get("sleep") and r["sleep"].get("asleep") is not None:
                bits.insert(0, f"sleep {_fmt_num(r['sleep']['asleep'])}h")
            for wkt in r.get("workouts", []):
                bits.append(f"workout {wkt['name']}")
            lines.append(f"- [{r['date']}] " + ", ".join(bits) +
                         f" (source: raw-sources/health/{r['date']}.md)")
        patterns = detect_patterns(twin_dir)
        if patterns:
            lines += ["", "## Patterns", ""]
            lines += [f"- {p}" for p in patterns]
    lines.append("")
    with open(page, "w") as f:
        f.write("\n".join(lines))
    return page


# --- native export.zip backfill -----------------------------------------

HK_MAP = {
    "HKQuantityTypeIdentifierStepCount": ("step_count", "count"),
    "HKQuantityTypeIdentifierHeartRate": ("heart_rate", "bpm"),
    "HKQuantityTypeIdentifierActiveEnergyBurned": ("active_energy", "kcal"),
    "HKQuantityTypeIdentifierBasalEnergyBurned": ("basal_energy_burned", "kcal"),
    "HKQuantityTypeIdentifierDistanceWalkingRunning":
        ("walking_running_distance", "mi"),
    "HKQuantityTypeIdentifierRestingHeartRate": ("resting_heart_rate", "bpm"),
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN":
        ("heart_rate_variability", "ms"),
    "HKQuantityTypeIdentifierBodyMass": ("weight_body_mass", "lb"),
    "HKQuantityTypeIdentifierFlightsClimbed": ("flights_climbed", "count"),
}


def import_zip(zip_path, twin_dir):
    """Parse a native Health export.zip into per-day records. Returns day count."""
    with zipfile.ZipFile(zip_path) as z:
        xml_name = next((n for n in z.namelist()
                         if n.endswith("export.xml")), None)
        if not xml_name:
            return 0
        raw = z.read(xml_name)
    days = {}  # day -> metric_name -> {units, samples[]}
    for _, el in ET.iterparse(io.BytesIO(raw), events=("end",)):
        if el.tag != "Record":
            el.clear()
            continue
        mapped = HK_MAP.get(el.get("type"))
        if mapped:
            name, units = mapped
            day = (el.get("startDate") or "")[:10]
            try:
                qty = float(el.get("value"))
            except (TypeError, ValueError):
                el.clear()
                continue
            d = days.setdefault(day, {})
            m = d.setdefault(name, {"units": units, "samples": []})
            m["samples"].append({"qty": qty, "date": el.get("startDate")})
        el.clear()
    out_dir = os.path.join(twin_dir, "raw-sources", "health")
    os.makedirs(out_dir, exist_ok=True)
    count = 0
    for day, metrics in sorted(days.items()):
        if not DATE_RE.match(day):
            continue
        day_json = {"data": {"metrics": [
            {"name": n, "units": v["units"], "data": v["samples"]}
            for n, v in metrics.items()], "workouts": []}}
        rec = normalize_day(day_json)
        with open(os.path.join(out_dir, f"{day}.md"), "w") as f:
            f.write(render_record_md(day, rec))
        count += 1
    return count


# --- Phase 2: deterministic coaching signals ----------------------------
# Signals are computed here (no LLM) so numbers are never fabricated. The
# agenda skill only phrases the chosen signal into natural language.

def _baseline(records, metric):
    vals = [r["metrics"].get(metric) for r in records
            if isinstance(r.get("metrics", {}).get(metric), (int, float))]
    return statistics.mean(vals) if vals else None


def coach_signals(twin_dir, today=None):
    """Compare the last COMPLETE day to its prior baseline and emit coaching
    signals (dicts: kind, severity 1-3, text). Morning-safe: today's partial
    data is excluded so an 8am briefing reasons off yesterday, not a blank day.
    Returns [] when there isn't enough data to say anything honest."""
    import datetime
    if today is None:
        today = datetime.date.today().isoformat()
    records = _read_records(twin_dir)
    complete = [r for r in records if r.get("date", "") < today]
    if len(complete) < 2:
        return []
    ref = complete[-1]
    base = complete[:-1][-7:]
    sig = []
    rm = ref.get("metrics", {})

    def base_of(metric):
        return _baseline(base, metric)

    # Activity vs baseline (steps preferred, else active_energy).
    for metric, noun in (("step_count", "steps"),
                         ("active_energy", "active energy")):
        cur = rm.get(metric)
        b = base_of(metric)
        if isinstance(cur, (int, float)) and b and b > 0:
            ratio = cur / b
            if ratio < 0.6:
                sig.append({"kind": "low_activity", "severity": 2,
                            "text": f"Yesterday was low-movement "
                            f"({_fmt_num(cur)} {noun} vs ~{_fmt_num(b)} "
                            f"typical). Build a walk or a short workout into "
                            f"today."})
            elif ratio > 1.4:
                sig.append({"kind": "strong_activity", "severity": 1,
                            "text": f"Yesterday was active ({_fmt_num(cur)} "
                            f"{noun}, well above your ~{_fmt_num(b)} baseline) "
                            f"— good momentum to keep."})
            break  # one activity signal is enough

    # Multi-day declining trend (>=3 complete days, strictly falling steps).
    steps = [r.get("metrics", {}).get("step_count") for r in complete[-3:]]
    if len(steps) == 3 and all(isinstance(s, (int, float)) for s in steps) \
            and steps[0] > steps[1] > steps[2]:
        sig.append({"kind": "declining", "severity": 2,
                    "text": "Activity has slipped three days running; a "
                    "deliberate walk today breaks the slide."})

    # Sleep (only when the data exists — no Watch => silently skipped).
    sl = ref.get("sleep") or {}
    asleep = sl.get("asleep")
    if isinstance(asleep, (int, float)):
        if asleep < 6.5:
            sig.append({"kind": "short_sleep", "severity": 3,
                        "text": f"You slept {_fmt_num(asleep)}h last night — "
                        f"front-load the hard, focused work early and keep the "
                        f"afternoon lighter."})
        elif asleep >= 7.5:
            sig.append({"kind": "good_sleep", "severity": 1,
                        "text": f"Well rested ({_fmt_num(asleep)}h sleep) — a "
                        f"good day to take on the most demanding task."})

    # HRV / resting HR recovery (only when present).
    hrv, hrv_b = rm.get("heart_rate_variability"), base_of("heart_rate_variability")
    if isinstance(hrv, (int, float)) and hrv_b and hrv < 0.85 * hrv_b:
        sig.append({"kind": "under_recovered", "severity": 3,
                    "text": f"HRV is down (~{_fmt_num(hrv)} vs {_fmt_num(hrv_b)} "
                    f"baseline) — you're under-recovered; go easier on training "
                    f"today."})

    sig.sort(key=lambda s: -s["severity"])
    return sig


def coach_line(signals):
    """Single plain-English line (Telegram / fallback). '' when no signals."""
    return signals[0]["text"] if signals else ""


# --- Phase 3: deterministic pattern detection ----------------------------

def detect_patterns(twin_dir, today=None):
    """Honest, deterministic patterns from the health timeline. Returns a list
    of strings. Degrades gracefully: says nothing it can't support with data."""
    import datetime
    if today is None:
        today = datetime.date.today().isoformat()
    records = [r for r in _read_records(twin_dir) if r.get("date", "") < today]
    out = []
    if len(records) < 4:
        return out  # too little history to claim a pattern
    # Trend direction for the primary activity metric over the window.
    steps = [(r["date"], r["metrics"].get("step_count")) for r in records
             if isinstance(r.get("metrics", {}).get("step_count"), (int, float))]
    if len(steps) >= 4:
        first_half = [v for _, v in steps[:len(steps) // 2]]
        second_half = [v for _, v in steps[len(steps) // 2:]]
        a, b = statistics.mean(first_half), statistics.mean(second_half)
        if b > a * 1.15:
            out.append(f"Activity is trending **up** ({_fmt_num(a)} → "
                       f"{_fmt_num(b)} avg steps across the window).")
        elif b < a * 0.85:
            out.append(f"Activity is trending **down** ({_fmt_num(a)} → "
                       f"{_fmt_num(b)} avg steps) — worth a deliberate reset.")
        # Best / worst day.
        best = max(steps, key=lambda x: x[1])
        worst = min(steps, key=lambda x: x[1])
        out.append(f"Most active day so far: {best[0]} "
                   f"({_fmt_num(best[1])} steps); least: {worst[0]} "
                   f"({_fmt_num(worst[1])}).")
    # Day-of-week tendency needs a couple of weeks to be meaningful.
    if len(steps) >= 14:
        import datetime as _dt
        by_dow = {}
        for d, v in steps:
            dow = _dt.date.fromisoformat(d).strftime("%A")
            by_dow.setdefault(dow, []).append(v)
        avg_dow = {k: statistics.mean(v) for k, v in by_dow.items()
                   if len(v) >= 2}
        if avg_dow:
            top = max(avg_dow, key=avg_dow.get)
            out.append(f"{top}s tend to be your most active day "
                       f"(~{_fmt_num(avg_dow[top])} steps).")
    return out


# --- status + CLI --------------------------------------------------------

def status(watch_dir, twin_dir):
    lines = []
    if not os.path.isdir(watch_dir):
        lines.append("watch folder not found: " + watch_dir)
    else:
        n_json = len(glob.glob(os.path.join(watch_dir, "*.json")))
        lines.append(f"watch folder: {n_json} export file(s)")
    recs = _read_records(twin_dir)
    out_dir = os.path.join(twin_dir, "raw-sources", "health")
    n_days = len(glob.glob(os.path.join(out_dir, "*.md")))
    lines.append(f"{n_days} day(s) stored")
    if recs:
        last = recs[-1]
        snap = ", ".join(f"{k} {_fmt_num(v)}"
                         for k, v in sorted(last["metrics"].items()))
        lines.append(f"latest ({last['date']}): {snap or 'no metrics'}")
    return "\n".join(lines)


DEFAULT_WATCH = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~com~ifunography~HealthExport/"
    "Documents/twin-health")


def _main(argv):
    twin = os.environ.get("TWIN_DIR", os.path.expanduser("~/twin"))
    watch = os.environ.get("TWIN_HEALTH_DIR", DEFAULT_WATCH)
    cmd = argv[1] if len(argv) > 1 else "status"
    if cmd == "ingest":
        n = ingest(watch, twin)
        build_page(twin)
        print(f"health: ingested {n} new day(s); page rebuilt")
    elif cmd == "import":
        if len(argv) < 3:
            print("usage: twin-health.py import <export.zip>")
            return 2
        n = import_zip(argv[2], twin)
        build_page(twin)
        print(f"health: imported {n} day(s) from {argv[2]}; page rebuilt")
    elif cmd == "status":
        print(status(watch, twin))
    elif cmd == "coach":
        signals = coach_signals(twin)
        print(json.dumps({"line": coach_line(signals),
                          "signals": signals}, indent=2))
    else:
        print(f"unknown: {cmd}")
        return 2
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(_main(sys.argv))
