#!/usr/bin/env python3
"""twin-today: maintain generated/today.json (the home-screen "Today" feed).

The morning briefing job and the discovery scout both write here. Centralizing the
merge / date-roll / dedupe logic keeps the two writers consistent instead of trusting
each LLM agent to hand-roll matching JSON logic.

Shape of generated/today.json:
  {
    "date": "YYYY-MM-DD",
    "generatedAt": "ISO8601",
    "briefing": { "mostImportant": str, "schedule": [...], "reminders": [...], "projectPulse": [...] } | null,
    "findings": [ { "title", "why", "when", "where", "url", "score", "pushed" }, ... ]
  }

Dedupe store (.state/scout-seen.json, machine-local, gitignored):
  { "<key>": { "title", "url", "firstSeen": "YYYY-MM-DD", "eventDate": "YYYY-MM-DD|" }, ... }

Usage:
  twin-today.py path                       print the today.json path
  twin-today.py get                        print today.json (date-rolled to today)
  twin-today.py merge-briefing             read a briefing object on stdin, store it
  twin-today.py merge-findings [--bar B] [--cap N]
                                           read a findings array on stdin; drop dupes
                                           (vs the seen-store), append the rest, and print
                                           {"new":[...], "push":[...]} where push = new
                                           items with score>=B (default 0.7), top N (default 3)
"""
import sys, os, json, re, hashlib, datetime

TWIN_DIR = os.environ.get("TWIN_DIR") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY_JSON = os.path.join(TWIN_DIR, "generated", "today.json")
SEEN_JSON = os.path.join(TWIN_DIR, ".state", "scout-seen.json")
SEEN_TTL_DAYS = 60


def today_str():
    return datetime.date.today().isoformat()


def now_iso():
    return datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def fresh_doc():
    return {"date": today_str(), "generatedAt": now_iso(), "briefing": None, "findings": []}


def load_doc():
    """Load today.json, resetting it if it is from a previous day (date roll)."""
    doc = load_json(TODAY_JSON, None)
    if not isinstance(doc, dict) or doc.get("date") != today_str():
        return fresh_doc()
    doc.setdefault("findings", [])
    doc.setdefault("briefing", None)
    return doc


def norm_key(finding):
    """Stable dedupe key: prefer the URL host+path (query stripped), else the title."""
    url = (finding.get("url") or "").strip().lower()
    if url:
        url = re.sub(r"^https?://(www\.)?", "", url)
        url = url.split("?", 1)[0].split("#", 1)[0].rstrip("/")
        basis = url
    else:
        basis = re.sub(r"\s+", " ", (finding.get("title") or "").strip().lower())
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:16]


def prune_seen(seen):
    cutoff = (datetime.date.today() - datetime.timedelta(days=SEEN_TTL_DAYS)).isoformat()
    today = today_str()
    out = {}
    for k, v in seen.items():
        # drop if first seen long ago, or its event date has passed
        if v.get("eventDate") and v["eventDate"] < today:
            continue
        if v.get("firstSeen", "9999") < cutoff:
            continue
        out[k] = v
    return out


def cmd_get():
    doc = load_doc()
    save_json(TODAY_JSON, doc)  # persist a date-roll if it happened
    print(json.dumps(doc, indent=2, ensure_ascii=False))


def cmd_merge_briefing():
    briefing = json.load(sys.stdin)
    doc = load_doc()
    doc["briefing"] = briefing
    doc["generatedAt"] = now_iso()
    save_json(TODAY_JSON, doc)
    print(json.dumps({"ok": True}))


def cmd_merge_findings(bar, cap):
    incoming = json.load(sys.stdin)
    if not isinstance(incoming, list):
        print(json.dumps({"error": "expected a JSON array of findings"}))
        sys.exit(1)
    doc = load_doc()
    seen = prune_seen(load_json(SEEN_JSON, {}))
    new = []
    for f in incoming:
        if not isinstance(f, dict) or not (f.get("title") or f.get("url")):
            continue
        k = norm_key(f)
        if k in seen:
            continue
        f.setdefault("score", 0)
        f["pushed"] = False
        seen[k] = {
            "title": f.get("title", ""),
            "url": f.get("url", ""),
            "firstSeen": today_str(),
            "eventDate": f.get("eventDate") or f.get("when") or "",
        }
        new.append(f)
    # decide what to push: new items above the bar, highest score first, capped
    pushable = sorted([f for f in new if (f.get("score") or 0) >= bar],
                      key=lambda f: f.get("score") or 0, reverse=True)[:cap]
    push_keys = {norm_key(f) for f in pushable}
    for f in new:
        if norm_key(f) in push_keys:
            f["pushed"] = True
    doc["findings"].extend(new)
    doc["generatedAt"] = now_iso()
    save_json(TODAY_JSON, doc)
    save_json(SEEN_JSON, seen)
    print(json.dumps({"new": new, "push": pushable}, ensure_ascii=False))


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    cmd = args[0]
    if cmd == "path":
        print(TODAY_JSON)
    elif cmd == "get":
        cmd_get()
    elif cmd == "merge-briefing":
        cmd_merge_briefing()
    elif cmd == "merge-findings":
        bar, cap = 0.7, 3
        i = 1
        while i < len(args):
            if args[i] == "--bar":
                bar = float(args[i + 1]); i += 2
            elif args[i] == "--cap":
                cap = int(args[i + 1]); i += 2
            else:
                i += 1
        cmd_merge_findings(bar, cap)
    else:
        print(f"twin-today: unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
