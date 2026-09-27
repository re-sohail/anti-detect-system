import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lvd_analysis.__main__ import main  # noqa: E402
from lvd_analysis.common import load_json, write_json  # noqa: E402
from lvd_analysis.scoring import cluster_bootstrap, confusion, metrics  # noqa: E402
import synthetic  # noqa: E402


class Env:
    def __init__(self, **kw):
        self.tmp = tempfile.mkdtemp(prefix="lvd-analysis-")
        col, gts = synthetic.make(**kw)
        self.collector = write_path(self.tmp, "collector.json", col)
        self.gts = [write_path(self.tmp, f"gt{i}.json", g) for i, g in enumerate(gts)]
        self.merged = f"{self.tmp}/merged.json"
        self.prereg = f"{self.tmp}/prereg.json"
        self.rel = f"{self.tmp}/release"

    def run(self, *args):
        return main(list(args))

    def prepare(self, **prereg_overrides):
        self.run("merge", "--collector", self.collector, "--ground-truth", *self.gts, "--out", self.merged)
        self.run("prereg", "--author", "test", "--out", self.prereg)
        p = load_json(self.prereg)
        p["bootstrap"]["repetitions"] = 300
        p["seed"] = 7
        p.update(prereg_overrides)
        write_json(self.prereg, p, exclusive=False)
        self.run("blind", "--merged", self.merged, "--prereg", self.prereg, "--out-dir", self.rel)


def write_path(d, name, obj):
    p = f"{d}/{name}"
    with open(p, "w") as f:
        json.dump(obj, f)
    return p


class MetricsTest(unittest.TestCase):
    def test_definitions(self):
        c = confusion([(True, True)] * 6 + [(True, False)] * 2 + [(False, True)] * 1 + [(False, False)] * 11)
        m = metrics(c)
        self.assertEqual(c, {"tp": 6, "fp": 1, "tn": 11, "fn": 2})
        self.assertAlmostEqual(m["precision"], 6 / 7)
        self.assertAlmostEqual(m["recall"], 6 / 8)
        self.assertAlmostEqual(m["fpr"], 1 / 12)
        self.assertAlmostEqual(m["fnr"], 2 / 8)

    def test_accuracy_trap_is_visible(self):
        # Labelling everything "different" looks accurate when negatives dominate; recall exposes it.
        m = metrics(confusion([(True, False)] * 5 + [(False, False)] * 95))
        self.assertAlmostEqual(m["accuracy"], 0.95)
        self.assertEqual(m["recall"], 0.0)

    def test_bootstrap_is_host_level_and_deterministic(self):
        rows = [{"hostA": f"h{i % 4}", "hostB": f"h{i % 4}", "truth": True, "pred": i % 3 != 0} for i in range(40)]
        rows += [{"hostA": "h0", "hostB": f"h{1 + i % 3}", "truth": False, "pred": i % 5 == 0} for i in range(40)]
        a = cluster_bootstrap(rows, 300, 0.95, 1)
        b = cluster_bootstrap(rows, 300, 0.95, 1)
        self.assertEqual(a, b)
        lo, hi = a["recall"]
        self.assertLessEqual(lo, hi)


class PipelineTest(unittest.TestCase):
    def test_merge_excludes_incomplete_and_unknown(self):
        e = Env()
        e.run("merge", "--collector", e.collector, "--ground-truth", *e.gts, "--out", e.merged)
        m = load_json(e.merged)
        reasons = [x["reason"] for x in m["excluded"]]
        self.assertTrue(any("interrupted" in r for r in reasons))
        self.assertTrue(any("not in any ground-truth" in r for r in reasons))
        self.assertEqual(m["counts"]["physicalHosts"], 6)

    def test_blind_split_labels_and_leakage(self):
        e = Env()
        e.prepare()
        key = load_json(f"{e.rel}/supervisor/key.json")
        self.assertFalse(set(key["split"]["devHosts"]) & set(key["split"]["evalHosts"]))
        dev = load_json(f"{e.rel}/blue/dev.json")
        self.assertTrue(all("sameHost" in p for p in dev["pairs"]))
        ev = load_json(f"{e.rel}/supervisor/eval-host.json")
        self.assertTrue(all("sameHost" not in p and "label" not in p for p in ev["pairs"]))
        text = json.dumps(dev)
        for bad in ("storage.testToken", "10.0.2.2", "referer", "198.51.100", "planted-"):
            self.assertNotIn(bad, text)
        self.assertEqual(e.run("leakage", "--merged", e.merged, "--blue-dir", f"{e.rel}/blue"), 0)
        # A leaked run token must be caught.
        m = load_json(e.merged)
        dev["visits"][0]["observations"]["nav.platform"] = {"status": "ok", "value": m["visits"][0]["runToken"]}
        write_json(f"{e.rel}/blue/dev.json", dev, exclusive=False)
        self.assertEqual(e.run("leakage", "--merged", e.merged, "--blue-dir", f"{e.rel}/blue"), 1)

    def test_freeze_release_score_order_is_enforced(self):
        e = Env()
        e.prepare()
        det = f"{e.tmp}/detector"
        os.makedirs(det)
        Path(det, "rules.py").write_text("THRESHOLD = 0.5\n")
        # Oracle-ish submission built from the key (for testing scoring only).
        key = load_json(f"{e.rel}/supervisor/key.json")
        sub = {"schema": "lvd-detector-submission/1", "detector": {"name": "oracle", "version": "1"}, "set": "eval-host",
               "predictions": [{"pairId": p["id"], "sameHost": p["sameHost"], "confidence": 0.9, "finerLabel": p["label"]} for p in key["sets"]["eval-host"]["pairs"]]}
        preds = write_path(e.tmp, "preds.json", sub)

        # Scoring before release is refused.
        e.run("freeze", "--detector", det, "--team", "blue", "--out", f"{e.tmp}/receipt.json")
        self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg, "--predictions", preds,
                               "--receipt", f"{e.tmp}/receipt.json", "--detector", det), 2)
        e.run("release", "--out-dir", e.rel, "--set", "eval-host")
        self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg, "--predictions", preds,
                               "--receipt", f"{e.tmp}/receipt.json", "--detector", det), 0)
        r = load_json(f"{e.rel}/scores/eval-host-oracle.json")["result"]
        self.assertEqual(r["overall"]["metrics"]["recall"], 1.0)
        self.assertEqual(r["overall"]["metrics"]["fpr"], 0.0)
        self.assertIn("finerConfusion", r)
        self.assertTrue(Path(f"{e.rel}/scores/eval-host-oracle.md").exists())

        # Changed detector code after freezing is refused.
        Path(det, "rules.py").write_text("THRESHOLD = 0.4\n")
        self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg, "--predictions", preds,
                               "--receipt", f"{e.tmp}/receipt.json", "--detector", det), 2)

        # A freeze after the release is refused.
        Path(det, "rules.py").write_text("THRESHOLD = 0.5\n")
        e.run("freeze", "--detector", det, "--team", "blue", "--out", f"{e.tmp}/late.json")
        self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg, "--predictions", preds,
                               "--receipt", f"{e.tmp}/late.json", "--detector", det), 2)

        # Changing the preregistration after blinding is refused.
        p = load_json(e.prereg)
        p["successCriteria"][0]["value"] = 0.1
        write_json(e.prereg, p, exclusive=False)
        self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg, "--predictions", preds,
                               "--receipt", f"{e.tmp}/receipt.json", "--detector", det), 2)

    def test_missing_predictions_refused(self):
        e = Env()
        e.prepare()
        e.run("release", "--out-dir", e.rel, "--set", "eval-host")
        key = load_json(f"{e.rel}/supervisor/key.json")
        sub = {"schema": "lvd-detector-submission/1", "detector": {"name": "baseline:partial", "version": "1"},
               "predictions": [{"pairId": key["sets"]["eval-host"]["pairs"][0]["id"], "sameHost": True}]}
        self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg,
                               "--predictions", write_path(e.tmp, "p.json", sub)), 2)

    def test_baselines_ablation_coverage(self):
        e = Env(n_hosts=8)
        e.prepare()
        e.run("release", "--out-dir", e.rel, "--set", "eval-host")
        self.assertEqual(e.run("baselines", "--out-dir", e.rel, "--set", "eval-host"), 0)
        for name in ("random", "shared-ip", "exact-profile", "logistic"):
            self.assertEqual(e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg,
                                   "--predictions", f"{e.rel}/baselines/eval-host-{name}.json"), 0)
        shared = load_json(f"{e.rel}/scores/eval-host-baseline-shared-ip.json")["result"]["overall"]["metrics"]
        # In the synthetic fixture every host has its own public IP, so the shared-IP baseline links perfectly.
        self.assertEqual(shared["recall"], 1.0)
        self.assertEqual(e.run("ablation", "--out-dir", e.rel, "--set", "eval-host"), 0)
        ab = load_json(f"{e.rel}/scores/eval-host-ablation.json")
        self.assertIn("network", ab["withoutFamily"])
        self.assertEqual(e.run("coverage", "--merged", e.merged, "--out", f"{e.tmp}/coverage"), 0)
        self.assertIn("disabled-by-protocol", Path(f"{e.tmp}/coverage.md").read_text())

    def test_small_samples_are_exploratory_and_subgroups_suppressed(self):
        e = Env(n_hosts=4)
        e.prepare()
        e.run("release", "--out-dir", e.rel, "--set", "eval-host")
        e.run("baselines", "--out-dir", e.rel, "--set", "eval-host")
        e.run("score", "--out-dir", e.rel, "--set", "eval-host", "--prereg", e.prereg, "--predictions", f"{e.rel}/baselines/eval-host-random.json")
        r = load_json(f"{e.rel}/scores/eval-host-baseline-random.json")["result"]
        self.assertTrue(r["overall"]["exploratory"])
        self.assertTrue(any(v.get("suppressed") for g in r["subgroups"].values() for v in g.values()))


if __name__ == "__main__":
    unittest.main()


class ProtocolToolsTest(unittest.TestCase):
    def test_schedule_is_reproducible_and_randomised(self):
        from lvd_analysis.schedule import make_schedule
        envs = [{"id": f"e{i}", "treatment": "T2-vms-one-host", "host": "h1"} for i in range(4)]
        a = make_schedule(envs, 3, 2, "2026-10-05", 42)
        b = make_schedule(envs, 3, 2, "2026-10-05", 42)
        self.assertEqual(a["rows"], b["rows"])
        self.assertEqual(len(a["rows"]), 4 * 2 * 3)
        firsts = {tuple(r["environment"] for r in a["rows"] if r["date"] == d)[:4] for d in ("2026-10-05", "2026-10-06", "2026-10-07")}
        self.assertGreater(len(firsts), 1, "order should differ between days")

    def test_matrix_reports_not_measured_instead_of_guessing(self):
        e = Env()
        e.run("merge", "--collector", e.collector, "--ground-truth", *e.gts, "--out", e.merged)
        self.assertEqual(e.run("matrix", "--merged", e.merged, "--out", f"{e.tmp}/matrix"), 0)
        m = load_json(f"{e.tmp}/matrix.json")
        row = m["rows"]["managed-guest"]
        self.assertIn("not measured", row["storageSeparation"])
        self.assertIn("virtual", row["hardwareProvenance"])
        self.assertTrue(row["evidenceRuns"])


class RealDataRegressionTest(unittest.TestCase):
    """Bugs found when the toolkit first ran on real pilot data (2026-09-27)."""

    def _merged(self):
        base = {"instrumentVersion": "1.1.0", "clockOffsetMs": 0, "peerIp": "127.0.0.1", "headers": {}, "guestReport": None}
        t = {"host": "h1", "runId": "r", "treatment": "T4-restarts", "environmentKind": "managed-guest", "environmentLabel": "A",
             "product": None, "routeId": "default-nat", "exitKind": "default-nat", "guestOs": "linux", "hostOs": "darwin"}
        def v(i, guest, dur, tok):
            return {**base, "visitId": f"v{i}", "runToken": f"t{i}", "receivedAt": f"2026-09-27T10:0{i}:00Z",
                    "observations": {"intl.timeZone": {"status": "ok", "value": "Europe/London", "durationMs": dur},
                                     "storage.testToken": {"status": "ok", "value": tok}},
                    "truth": {**t, "guest": guest}}
        return {"visits": [
            v(1, "A", 3, {"existingToken": None, "placedToken": "tokA"}),
            v(2, "A", 9, {"existingToken": None, "placedToken": None}),
            v(3, "B", 4, {"existingToken": None, "placedToken": None}),
        ]}

    def test_stability_ignores_collection_timing(self):
        from lvd_analysis.coverage import stability
        self.assertEqual(stability(self._merged())["fields"]["intl.timeZone"]["unchangedRate"], 1.0)

    def test_matrix_reports_lost_token_as_measured(self):
        from lvd_analysis.matrix import build
        row = build(self._merged())["rows"]["managed-guest"]["storageSeparation"]
        self.assertIn("1 planted: 0 retained, 1 lost", row)
        self.assertIn("0 cross-unit", row)

    def test_exact_profile_ignores_collection_timing(self):
        from lvd_analysis.baselines import _profile
        a = {"observations": {"intl.timeZone": {"status": "ok", "value": "X", "durationMs": 1}}, "headers": {}}
        b = {"observations": {"intl.timeZone": {"status": "ok", "value": "X", "durationMs": 7}}, "headers": {}}
        self.assertEqual(_profile(a), _profile(b))
