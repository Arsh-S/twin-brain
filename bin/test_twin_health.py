import importlib.util, os, unittest, json, tempfile, shutil, zipfile

SPEC = importlib.util.spec_from_file_location(
    "twin_health", os.path.join(os.path.dirname(__file__), "twin-health.py"))
th = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(th)


class TestClassify(unittest.TestCase):
    def test_known_sum(self):
        self.assertEqual(th.classify("step_count"), "sum")
        self.assertEqual(th.classify("active_energy"), "sum")

    def test_known_avg(self):
        self.assertEqual(th.classify("heart_rate"), "avg")
        self.assertEqual(th.classify("heart_rate_variability"), "avg")
        self.assertEqual(th.classify("walking_speed"), "avg")

    def test_known_latest(self):
        self.assertEqual(th.classify("weight_body_mass"), "latest")

    def test_sleep(self):
        self.assertEqual(th.classify("sleep_analysis"), "sleep")

    def test_unknown_defaults_sum(self):
        self.assertEqual(th.classify("some_new_metric"), "sum")


class TestAggregateMetric(unittest.TestCase):
    def test_sum(self):
        m = {"name": "step_count", "units": "count",
             "data": [{"qty": 10}, {"qty": 5}, {"qty": 2}]}
        v = th.aggregate_metric(m)
        self.assertEqual(v["value"], 17)
        self.assertEqual(v["kind"], "sum")
        self.assertEqual(v["units"], "count")

    def test_avg(self):
        m = {"name": "heart_rate", "units": "bpm",
             "data": [{"qty": 60}, {"qty": 70}, {"qty": 80}]}
        v = th.aggregate_metric(m)
        self.assertEqual(v["value"], 70)

    def test_latest_picks_last_by_date(self):
        m = {"name": "weight_body_mass", "units": "lb",
             "data": [{"qty": 150, "date": "2026-06-29 08:00:00 -0400"},
                      {"qty": 151, "date": "2026-06-30 08:00:00 -0400"}]}
        v = th.aggregate_metric(m)
        self.assertEqual(v["value"], 151)

    def test_empty_data_returns_none(self):
        m = {"name": "step_count", "units": "count", "data": []}
        self.assertIsNone(th.aggregate_metric(m))


SLEEP_DOC = {  # Health Auto Export sleep_analysis aggregated shape (hours)
    "name": "sleep_analysis", "units": "hr",
    "data": [{"date": "2026-06-30 00:00:00 -0400",
              "asleep": 6.5, "core": 3.5, "deep": 1.2, "rem": 1.8,
              "awake": 0.4, "inBed": 7.1}],
}

DAY_JSON = {"data": {"metrics": [
    {"name": "step_count", "units": "count",
     "data": [{"qty": 1000, "date": "2026-06-30 09:00:00 -0400"},
              {"qty": 800, "date": "2026-06-30 18:00:00 -0400"}]},
    {"name": "active_energy", "units": "kcal",
     "data": [{"qty": 50.5, "date": "2026-06-30 09:00:00 -0400"},
              {"qty": 49.5, "date": "2026-06-30 18:00:00 -0400"}]},
    {"name": "heart_rate", "units": "bpm",
     "data": [{"qty": 60, "date": "2026-06-30 09:00:00 -0400"},
              {"qty": 80, "date": "2026-06-30 18:00:00 -0400"}]},
    SLEEP_DOC,
], "workouts": [
    {"name": "Running", "start": "2026-06-30 07:00:00 -0400",
     "end": "2026-06-30 07:32:00 -0400", "duration": 1920},
]}}


class TestSleep(unittest.TestCase):
    def test_sleep_sums_stages(self):
        v = th.aggregate_sleep(SLEEP_DOC)
        self.assertAlmostEqual(v["asleep"], 6.5)
        self.assertAlmostEqual(v["deep"], 1.2)

    def test_sleep_empty(self):
        self.assertIsNone(th.aggregate_sleep({"name": "sleep_analysis", "data": []}))


class TestNormalizeDay(unittest.TestCase):
    def setUp(self):
        self.rec = th.normalize_day(DAY_JSON)

    def test_metrics_aggregated(self):
        self.assertEqual(self.rec["metrics"]["step_count"]["value"], 1800)
        self.assertEqual(self.rec["metrics"]["heart_rate"]["value"], 70)

    def test_sleep_present(self):
        self.assertAlmostEqual(self.rec["sleep"]["asleep"], 6.5)

    def test_workouts(self):
        self.assertEqual(self.rec["workouts"][0]["name"], "Running")
        self.assertEqual(self.rec["workouts"][0]["minutes"], 32)


class TestRecordMd(unittest.TestCase):
    def test_renders_date_and_source(self):
        md = th.render_record_md("2026-06-30", th.normalize_day(DAY_JSON))
        self.assertIn("# Health 2026-06-30", md)
        self.assertIn("step_count", md)
        self.assertIn("Running", md)
        self.assertIn("source: raw Health Auto Export", md)


class TestIngest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.watch = os.path.join(self.root, "watch")
        self.twin = os.path.join(self.root, "twin")
        os.makedirs(self.watch)
        os.makedirs(self.twin)
        self._write("twin-health-2026-06-30.json", DAY_JSON)

    def tearDown(self):
        shutil.rmtree(self.root)

    def _write(self, name, obj):
        with open(os.path.join(self.watch, name), "w") as f:
            json.dump(obj, f)

    def test_ingest_writes_record_and_marks_seen(self):
        n = th.ingest(self.watch, self.twin)
        self.assertEqual(n, 1)
        rec = os.path.join(self.twin, "raw-sources", "health", "2026-06-30.md")
        self.assertTrue(os.path.exists(rec))
        self.assertIn("step_count", open(rec).read())

    def test_ingest_is_idempotent(self):
        self.assertEqual(th.ingest(self.watch, self.twin), 1)
        self.assertEqual(th.ingest(self.watch, self.twin), 0)

    def test_malformed_json_skipped_not_fatal(self):
        with open(os.path.join(self.watch, "twin-health-2026-06-29.json"),
                  "w") as f:
            f.write("{ broken")
        n = th.ingest(self.watch, self.twin)
        self.assertEqual(n, 1)


class TestPage(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.twin = os.path.join(self.root, "twin")
        self.health = os.path.join(self.twin, "raw-sources", "health")
        os.makedirs(self.health)
        for day, steps in [("2026-06-28", 8000), ("2026-06-29", 9000),
                           ("2026-06-30", 10000)]:
            rec = {"metrics": {"step_count": {"name": "step_count",
                   "kind": "sum", "value": steps, "units": "count"}},
                   "sleep": None, "workouts": []}
            with open(os.path.join(self.health, f"{day}.md"), "w") as f:
                f.write(th.render_record_md(day, rec))

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_build_page_writes_file(self):
        path = th.build_page(self.twin)
        self.assertTrue(os.path.exists(path))
        body = open(path).read()
        self.assertIn("# Health", body)
        self.assertIn("## Timeline", body)
        self.assertIn("2026-06-30", body)
        self.assertIn("[[profile]]", body)


EXPORT_XML = """<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count"
   startDate="2026-06-30 09:00:00 -0400" value="1000"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count"
   startDate="2026-06-30 18:00:00 -0400" value="800"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min"
   startDate="2026-06-30 09:00:00 -0400" value="60"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min"
   startDate="2026-06-30 18:00:00 -0400" value="80"/>
</HealthData>"""


class TestImport(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.twin = os.path.join(self.root, "twin")
        os.makedirs(self.twin)
        self.zip = os.path.join(self.root, "export.zip")
        with zipfile.ZipFile(self.zip, "w") as z:
            z.writestr("apple_health_export/export.xml", EXPORT_XML)

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_import_creates_day_records(self):
        n = th.import_zip(self.zip, self.twin)
        self.assertEqual(n, 1)
        rec = os.path.join(self.twin, "raw-sources", "health", "2026-06-30.md")
        body = open(rec).read()
        self.assertIn("step_count", body)
        self.assertIn("1800", body)
        self.assertIn("heart_rate", body)
        self.assertIn("70", body)


class TestStatus(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.twin = os.path.join(self.root, "twin")
        os.makedirs(os.path.join(self.twin, "raw-sources", "health"))

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_status_no_data(self):
        s = th.status(os.path.join(self.root, "missing-watch"), self.twin)
        self.assertIn("watch folder not found", s)

    def test_status_reports_days(self):
        with open(os.path.join(self.twin, "raw-sources", "health",
                  "2026-06-30.md"), "w") as f:
            f.write(th.render_record_md("2026-06-30", {"metrics": {},
                    "sleep": None, "workouts": []}))
        s = th.status(self.root, self.twin)
        self.assertIn("1 day", s)


def _mk_records(tmp_twin, days):
    """days: list of (date, {metric: value}, sleep_or_none). Writes records."""
    hd = os.path.join(tmp_twin, "raw-sources", "health")
    os.makedirs(hd, exist_ok=True)
    for date, metrics, sleep in days:
        rec = {"metrics": {k: {"name": k, "kind": "sum", "value": v,
               "units": ""} for k, v in metrics.items()},
               "sleep": sleep, "workouts": []}
        with open(os.path.join(hd, f"{date}.md"), "w") as f:
            f.write(th.render_record_md(date, rec))


class TestCoach(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.twin = os.path.join(self.root, "twin")

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_insufficient_data_no_signals(self):
        _mk_records(self.twin, [("2026-06-20", {"step_count": 5000}, None)])
        self.assertEqual(th.coach_signals(self.twin, today="2026-06-30"), [])

    def test_low_activity_signal(self):
        _mk_records(self.twin, [
            ("2026-06-25", {"step_count": 5000}, None),
            ("2026-06-26", {"step_count": 5200}, None),
            ("2026-06-27", {"step_count": 4800}, None),
            ("2026-06-28", {"step_count": 1000}, None)])  # ref day, low
        sigs = th.coach_signals(self.twin, today="2026-06-30")
        kinds = [s["kind"] for s in sigs]
        self.assertIn("low_activity", kinds)
        self.assertTrue(th.coach_line(sigs))

    def test_short_sleep_ranks_top(self):
        _mk_records(self.twin, [
            ("2026-06-26", {"step_count": 5000}, None),
            ("2026-06-27", {"step_count": 5000}, None),
            ("2026-06-28", {"step_count": 5000}, {"asleep": 5.5})])
        sigs = th.coach_signals(self.twin, today="2026-06-30")
        self.assertEqual(sigs[0]["kind"], "short_sleep")  # severity 3 wins

    def test_today_partial_excluded(self):
        # A blank "today" record must not drive coaching.
        _mk_records(self.twin, [
            ("2026-06-29", {"step_count": 5000}, None),
            ("2026-06-30", {"step_count": 10}, None)])  # today, partial
        sigs = th.coach_signals(self.twin, today="2026-06-30")
        # Only 1 complete day -> not enough -> no signals from the blank today.
        self.assertEqual(sigs, [])


class TestPatterns(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.twin = os.path.join(self.root, "twin")

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_too_little_history(self):
        _mk_records(self.twin, [("2026-06-28", {"step_count": 5000}, None),
                                ("2026-06-29", {"step_count": 5000}, None)])
        self.assertEqual(th.detect_patterns(self.twin, today="2026-06-30"), [])

    def test_downtrend_and_bestworst(self):
        _mk_records(self.twin, [
            ("2026-06-24", {"step_count": 9000}, None),
            ("2026-06-25", {"step_count": 8500}, None),
            ("2026-06-26", {"step_count": 3000}, None),
            ("2026-06-27", {"step_count": 2500}, None)])
        pats = th.detect_patterns(self.twin, today="2026-06-30")
        joined = " ".join(pats)
        self.assertIn("down", joined)
        self.assertIn("2026-06-24", joined)  # best day


if __name__ == "__main__":
    unittest.main()
