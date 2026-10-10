#!/usr/bin/env python3
import csv
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

import redfin_scraper

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "redfin"


def read_csv(path):
    with open(path, encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


class RedfinScraperTest(unittest.TestCase):
    def run_mode(self, mode, html_name, output, extra=None):
        args = [mode, "--html", str(FIXTURES / html_name), "--output", str(output), "--limit", "10"]
        if extra:
            args.extend(extra)
        return redfin_scraper.main(args)

    def test_search_cards_spacing_dedupe_and_distinct_units(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "search.csv"
            self.assertEqual(self.run_mode("search", "search.html", output), 0)
            rows = read_csv(output)
        self.assertEqual([row["property_url"] for row in rows if row["property_url"]], [
            "https://www.redfin.com/NY/New-York/112-E-35th-St-10016/home/45333496",
            "https://www.redfin.com/NY/New-York/114-E-35th-St-10016/unit/2A/home/999",
        ])
        self.assertEqual(rows[0]["price"], "$1,250,000")
        self.assertEqual(rows[0]["configuration"], "3 beds 2 baths 1,200 sq ft")
        self.assertEqual(rows[0]["address"], "112 E 35th St, New York, NY 10016")
        self.assertEqual(rows[0]["broker"], "Listing by Compass")
        self.assertEqual(rows[0]["availability"], "true")
        self.assertEqual(rows[0]["listing_status"], "Active")
        self.assertEqual(rows[0]["source_name"], "Redfin")
        self.assertEqual(rows[0]["collected_at"], "")
        self.assertTrue(rows[0]["source_page_url"].endswith("search.html"))
        self.assertEqual(rows[1]["address"], rows[0]["address"])
        self.assertNotEqual(rows[1]["property_url"], rows[0]["property_url"])
        self.assertEqual(rows[1]["configuration"], "")
        self.assertEqual(rows[2]["property_url"], "")
        self.assertEqual(rows[2]["broker"], "")
        self.assertNotIn("rent", redfin_scraper.COLUMNS)

    def test_embedded_json_is_parsed_not_executed(self):
        sentinel = Path("/tmp/redfin-should-not-execute")
        if sentinel.exists():
            sentinel.unlink()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "json.csv"
            self.assertEqual(self.run_mode("search", "search.json.html", output), 0)
            rows = read_csv(output)
        self.assertFalse(sentinel.exists())
        self.assertEqual(rows[0]["price"], "$2,000,000")
        self.assertEqual(rows[0]["configuration"], "2 beds 1 baths 900 sq ft")
        self.assertEqual(rows[0]["address"], "200 Park Ave, New York, NY 10017")
        self.assertEqual(rows[0]["broker"], "Elliman")
        self.assertEqual(rows[0]["availability"], "true")
        self.assertEqual(rows[1]["price"], "$2,100,000")
        self.assertEqual(rows[1]["listing_status"], "Pending")
        self.assertEqual(rows[1]["availability"], "")

    def test_empty_results_are_header_only(self):
        for name in ("search-empty.html", "search-empty.json.html"):
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "empty.csv"
                self.assertEqual(self.run_mode("search", name, output), 0)
                text = output.read_text(encoding="utf-8")
            self.assertEqual(text.strip(), ",".join(redfin_scraper.COLUMNS))

    def test_unrecognized_markup_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "keep.csv"
            output.write_text("previous,success\n", encoding="utf-8")
            code = self.run_mode("search", "unrecognized.html", output)
            self.assertEqual(code, 1)
            self.assertEqual(output.read_text(encoding="utf-8"), "previous,success\n")

    def test_property_status_evidence(self):
        expectations = {
            "property-pending.html": ("Pending", "", "A bright home, \"corner\" unit.\nHas a comma, and a quote."),
            "property-sold.html": ("Sold", "false", ""),
            "property-active.html": ("For sale", "true", "Still listed."),
            "property-unknown.html": ("Under Contract", "", ""),
            "property-missing-status.html": ("", "", "No status badge."),
        }
        for name, (status, availability, description) in expectations.items():
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "property.csv"
                self.assertEqual(self.run_mode("property", name, output), 0, name)
                rows = read_csv(output)
            self.assertEqual(len(rows), 1, name)
            self.assertEqual(rows[0]["listing_status"], status, name)
            self.assertEqual(rows[0]["availability"], availability, name)
            self.assertEqual(rows[0]["description"], description, name)
            self.assertNotEqual(rows[0]["availability"], "false", name) if availability != "false" else None
            self.assertTrue(rows[0]["price"].startswith("$"), name)
            self.assertIn("New York", rows[0]["address"], name)

    def test_property_json_and_quoting(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "property.csv"
            self.assertEqual(self.run_mode("property", "property.json.html", output), 0)
            raw = output.read_text(encoding="utf-8")
            rows = read_csv(output)
        self.assertEqual(rows[0]["description"], "About this home.")
        self.assertEqual(rows[0]["property_url"], "https://www.redfin.com/NY/New-York/300-Fifth-Ave-10001/home/300")
        self.assertIn('"corner"', Path(FIXTURES / "property-pending.html").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "quoted.csv"
            self.assertEqual(self.run_mode("property", "property-pending.html", output), 0)
            raw = output.read_text(encoding="utf-8")
        self.assertIn('"A bright home, ""corner"" unit.\nHas a comma, and a quote."', raw)

    def test_limit_and_saved_html_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "limited.csv"
            with mock.patch.object(redfin_scraper.requests, "get", side_effect=AssertionError("network")):
                code = redfin_scraper.main([
                    "search",
                    "--html",
                    str(FIXTURES / "search.html"),
                    "--output",
                    str(output),
                    "--limit",
                    "1",
                ])
            rows = read_csv(output)
        self.assertEqual(code, 0)
        self.assertEqual(len(rows), 1)

    def test_fetch_failures_keep_existing_csv(self):
        cases = [
            mock.Mock(status_code=403, text="no", url="https://www.redfin.com/city/30749/NY/New-York"),
            mock.Mock(status_code=429, text="no", url="https://www.redfin.com/city/30749/NY/New-York"),
            mock.Mock(status_code=200, text=FIXTURES.joinpath("challenge.html").read_text(encoding="utf-8"), url="https://www.redfin.com/city/30749/NY/New-York"),
        ]
        for response in cases:
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / "keep.csv"
                output.write_text("kept\n", encoding="utf-8")
                with mock.patch.object(redfin_scraper.requests, "get", return_value=response) as get:
                    code = redfin_scraper.main([
                        "search",
                        "--url",
                        redfin_scraper.DEFAULT_SEARCH_URL,
                        "--output",
                        str(output),
                        "--timeout",
                        "5",
                    ])
                self.assertEqual(code, 1)
                self.assertEqual(output.read_text(encoding="utf-8"), "kept\n")
                self.assertTrue(get.call_args.kwargs["verify"])
                self.assertEqual(get.call_args.kwargs["timeout"], 5)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "keep.csv"
            output.write_text("kept\n", encoding="utf-8")
            with mock.patch.object(redfin_scraper.requests, "get", side_effect=requests.exceptions.Timeout("slow")):
                code = redfin_scraper.main([
                    "property",
                    "--url",
                    redfin_scraper.DEFAULT_PROPERTY_URL,
                    "--output",
                    str(output),
                ])
            self.assertEqual(code, 1)
            self.assertEqual(output.read_text(encoding="utf-8"), "kept\n")

    def test_network_success_records_timestamp_and_keeps_verification(self):
        html = FIXTURES.joinpath("search.html").read_text(encoding="utf-8")
        response = mock.Mock(status_code=200, text=html, url=redfin_scraper.DEFAULT_SEARCH_URL)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "live-shaped.csv"
            with mock.patch.object(redfin_scraper.requests, "get", return_value=response):
                with mock.patch.object(redfin_scraper, "utc_now", return_value="2026-10-10T21:30:00Z"):
                    code = redfin_scraper.main([
                        "search",
                        "--url",
                        redfin_scraper.DEFAULT_SEARCH_URL,
                        "--output",
                        str(output),
                    ])
            rows = read_csv(output)
        self.assertEqual(code, 0)
        self.assertEqual(rows[0]["collected_at"], "2026-10-10T21:30:00Z")
        self.assertEqual(rows[0]["source_page_url"], redfin_scraper.DEFAULT_SEARCH_URL)
        self.assertNotIn("verify=False", Path(redfin_scraper.__file__).read_text(encoding="utf-8"))

    def test_live_json_shape_ignores_non_listings(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "shape.csv"
            self.assertEqual(self.run_mode("search", "search-live-shape.json.html", output), 0)
            rows = read_csv(output)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["price"], "$900,000")
        self.assertEqual(rows[0]["configuration"], "5 beds 3 baths 2,100 sq ft")
        self.assertEqual(rows[0]["address"], "8244 263rd St, Glen Oaks, NY 11004")
        self.assertEqual(rows[0]["broker"], "Fave Realty Inc.")
        self.assertEqual(rows[0]["availability"], "true")
        self.assertNotIn("Nearby business", rows[0]["description"])

    def test_property_status_ignores_summary_blob(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "off.csv"
            self.assertEqual(self.run_mode("property", "property-off-market.html", output), 0)
            rows = read_csv(output)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["listing_status"], "Off Market")
        self.assertEqual(rows[0]["availability"], "false")
        self.assertEqual(rows[0]["price"], "$8,789,002")
        self.assertEqual(rows[0]["address"], "112 E 35th St, New York, NY 10016")
        self.assertEqual(rows[0]["description"], "Last sold remarks.")

    def test_robot_page_is_a_challenge(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "keep.csv"
            output.write_text("kept\n", encoding="utf-8")
            code = self.run_mode("search", "challenge-robot.html", output)
            self.assertEqual(code, 1)
            self.assertEqual(output.read_text(encoding="utf-8"), "kept\n")

    def test_non_redfin_url_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "no.csv"
            code = redfin_scraper.main([
                "search",
                "--url",
                "http://example.com/homes",
                "--output",
                str(output),
            ])
            self.assertEqual(code, 1)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
