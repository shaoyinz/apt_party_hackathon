#!/usr/bin/env python3
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import requests

import zillow_scraper as zillow

BROOKLYN = "https://www.zillow.com/homes/for_sale/Brooklyn,-New-York,-NY_rb/"


def card(price, address, size_items, href, classes, zpid=None, extra=""):
    items = "".join(f"<li>{item}</li>" for item in size_items)
    zpid_attr = f' data-zpid="{zpid}"' if zpid else ""
    return f"""
    <li class="{classes}"{zpid_attr}>
      <a data-test="property-card-link" href="{href}">Listing</a>
      <span data-test="property-card-price">{price or ""}</span>
      <ul class="StyledPropertyCardHomeDetailsList-c11n-9-0-1__sc-yyyy">{items}</ul>
      <address>{address or ""}</address>
      {extra}
    </li>
    """


def page(cards, wrapper=""):
    return f"<html><body><ul>{wrapper}{''.join(cards)}</ul></body></html>"


ARTICLE_CARD = """
<li class="ListItem-c11n-8-102-0__sc-13rwu5a-0">
  <a href="/homedetails/119-Rockaway-Parkway-Brooklyn-NY-11212/111_zpid/">Home</a>
  <span data-test="property-card-price">$599,900</span>
  <ul class="StyledPropertyCardHomeDetailsList-c11n-8-109-3__sc-1j0som5-0">
    <li>8 bds</li><li>4 ba</li><li>3,198 sqft</li><li>1,200 sqft lot</li>
  </ul>
  <address>119 Rockaway Parkway, Brownsville, NY 11212</address>
</li>
"""

NEWER_CARD = """
<li class="ListItem-c11n-9-4-2__sc-zzzz">
  <a href="https://www.zillow.com/homedetails/1046-E-102nd-Street-Brooklyn-NY-11236/222_zpid/">Home</a>
  <span data-test="property-card-price">$550,000</span>
  <ul class="StyledPropertyCardHomeDetailsList-c11n-9-4-2__sc-aaaa">
    <li>4 bds</li><li>2 ba</li><li>1,835 sqft</li>
  </ul>
  <address>1046 E 102nd Street, Canarsie, NY 11236</address>
</li>
"""


class ParserTests(unittest.TestCase):
    def test_article_and_newer_classes_stay_independent(self):
        html = page([ARTICLE_CARD, NEWER_CARD, ARTICLE_CARD])
        listings, status, truncated = zillow.parse_html(html, None, 40)
        self.assertEqual(status, "ok")
        self.assertFalse(truncated)
        self.assertEqual(len(listings), 2)
        self.assertEqual(listings[0]["pricing"], "$599,900")
        self.assertEqual(listings[0]["size"], "8 bds, 4 ba, 3,198 sqft, 1,200 sqft lot")
        self.assertEqual(listings[0]["living_area"], "3,198 sqft")
        self.assertEqual(listings[0]["address"], "119 Rockaway Parkway, Brownsville, NY 11212")
        self.assertEqual(
            listings[0]["listing_url"],
            "https://www.zillow.com/homedetails/119-Rockaway-Parkway-Brooklyn-NY-11212/111_zpid/",
        )
        self.assertEqual(listings[0]["price_type"], "asking_price")
        self.assertIsNone(listings[0]["fetched_at"])
        self.assertNotEqual(listings[0]["address"], listings[1]["address"])
        self.assertNotIn("rent", listings[0])

    def test_same_address_different_units_are_not_merged(self):
        first = card(
            "$400,000",
            "10 Main Street, Brooklyn, NY 11201",
            ["1 bd", "1 ba", "700 sqft"],
            "/homedetails/10-Main-Street-Brooklyn-NY-11201/1_zpid/",
            "ListItem-c11n-1-0-0__sc-aa",
        )
        second = card(
            "$900,000",
            "10 Main Street, Brooklyn, NY 11201",
            ["4 bds", "3 ba", "2,100 sqft"],
            "/homedetails/10-Main-Street-Brooklyn-NY-11201/2_zpid/",
            "ListItem-c11n-1-0-0__sc-aa",
        )
        listings, _, _ = zillow.parse_html(page([first, second]), None, 40)
        self.assertEqual(len(listings), 2)
        self.assertNotEqual(listings[0]["listing_url"], listings[1]["listing_url"])
        no_url = page(
            [
                card("$400,000", "10 Main Street, Brooklyn, NY 11201", ["1 bd"], "", "ListItem-c11n-1-0-0__sc-aa"),
                card("$900,000", "10 Main Street, Brooklyn, NY 11201", ["4 bds"], "", "ListItem-c11n-1-0-0__sc-aa"),
            ]
        )
        separate, _, _ = zillow.parse_html(no_url, None, 40)
        self.assertEqual(len(separate), 2)
        self.assertEqual(separate[0]["address"], separate[1]["address"])
        self.assertNotEqual(separate[0]["pricing"], separate[1]["pricing"])

    def test_missing_fields_are_null_and_glued_size_is_readable(self):
        html = """
        <html><body>
          <article data-test="property-card">
            <span data-test="property-card-price">$1,250,000</span>
            <ul class="StyledPropertyCardHomeDetailsList-c11n-3-1-0__sc-q">
              <li>8 bds4 ba3,198 sqft</li>
            </ul>
          </article>
        </body></html>
        """
        listings, _, _ = zillow.parse_html(html, None, 10)
        self.assertEqual(listings[0]["pricing"], "$1,250,000")
        self.assertEqual(listings[0]["size"], "8 bds, 4 ba, 3,198 sqft")
        self.assertEqual(listings[0]["living_area"], "3,198 sqft")
        self.assertIsNone(listings[0]["address"])
        self.assertIsNone(listings[0]["listing_url"])

    def test_semantic_cards_survive_class_rename(self):
        html = """
        <html><body>
          <article data-test="property-card" class="totally-new">
            <a data-test="property-card-link" href="/homedetails/1-Park-Brooklyn-NY/9_zpid/">x</a>
            <span data-test="property-card-price">$10</span>
            <ul data-test="property-card-details"><li>2 bds</li><li>800 sqft</li></ul>
            <address data-test="property-card-addr">1 Park, Brooklyn, NY</address>
          </article>
        </body></html>
        """
        listings, status, _ = zillow.parse_html(html, None, 5)
        self.assertEqual(status, "ok")
        self.assertEqual(listings[0]["address"], "1 Park, Brooklyn, NY")
        self.assertEqual(listings[0]["size"], "2 bds, 800 sqft")

    def test_empty_results_are_not_unrecognized(self):
        html = '<html><body><div data-test="search-results-empty">No matching results</div></body></html>'
        listings, status, truncated = zillow.parse_html(html, None, 5)
        self.assertEqual(listings, [])
        self.assertEqual(status, "empty")
        self.assertFalse(truncated)

    def test_unrecognized_markup_is_distinct(self):
        with self.assertRaises(zillow.ScrapeError) as caught:
            zillow.parse_html("<html><body><h1>Welcome</h1></body></html>", None, 5)
        self.assertEqual(caught.exception.code, "unrecognized_markup")

    def test_http_200_challenge_is_not_success(self):
        html = "<html><title>Access Denied</title><body>Please verify you are a human</body></html>"
        with self.assertRaises(zillow.ScrapeError) as caught:
            zillow.parse_html(html, None, 5)
        self.assertEqual(caught.exception.code, "challenge")

    def test_malformed_html_is_unrecognized(self):
        with self.assertRaises(zillow.ScrapeError) as caught:
            zillow.parse_html("not html {{{{", None, 5)
        self.assertEqual(caught.exception.code, "unrecognized_markup")


class Response:
    def __init__(self, status_code, text, url):
        self.status_code = status_code
        self.text = text
        self.url = url


class TransportTests(unittest.TestCase):
    def write_previous(self):
        handle = tempfile.NamedTemporaryFile("w", delete=False, suffix=".json")
        handle.write('{"marker":"PREVIOUS_EXPORT"}\n')
        handle.close()
        self.addCleanup(lambda: os.path.exists(handle.name) and os.unlink(handle.name))
        return handle.name

    def run_cli(self, argv, env=None, response=None, error=None):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch.object(zillow.requests, "get", return_value=response, side_effect=error) as request:
            code = zillow.run(argv, env=env or {}, stdout=stdout, stderr=stderr)
        return code, stdout.getvalue(), stderr.getvalue(), request

    def test_offline_cli_writes_json_and_is_not_live(self):
        html_file = tempfile.NamedTemporaryFile("w", delete=False, suffix=".html")
        html_file.write(page([ARTICLE_CARD]))
        html_file.close()
        self.addCleanup(lambda: os.unlink(html_file.name))
        out = self.write_previous()
        code = zillow.run(["--html", html_file.name, "--output", out, "--url", BROOKLYN])
        self.assertEqual(code, 0)
        payload = json.loads(open(out, encoding="utf-8").read())
        self.assertEqual(payload["count"], 1)
        self.assertFalse(payload["live"])
        self.assertEqual(payload["data_origin"], "saved_html")
        self.assertIsNone(payload["fetched_at"])
        self.assertIsNone(payload["monthly_rent"])
        self.assertEqual(payload["price_meaning"], "for_sale_asking_price")
        self.assertNotIn("PREVIOUS_EXPORT", json.dumps(payload))

    def test_http_errors_preserve_previous_output(self):
        for status in (403, 429, 500):
            out = self.write_previous()
            code, _, stderr, _ = self.run_cli(
                ["--output", out, "--timeout", "5", "--url", BROOKLYN],
                response=Response(status, "nope", BROOKLYN),
            )
            self.assertEqual(code, 1, stderr)
            self.assertIn("http_error", stderr)
            self.assertIn(str(status), stderr)
            self.assertEqual(open(out, encoding="utf-8").read(), '{"marker":"PREVIOUS_EXPORT"}\n')

    def test_timeout_and_challenge_do_not_replace_output(self):
        out = self.write_previous()
        code, _, stderr, _ = self.run_cli(
            ["--output", out, "--timeout", "5", "--url", BROOKLYN],
            error=requests.Timeout("timed out https://www.zillow.com"),
        )
        self.assertEqual(code, 1)
        self.assertIn("timeout", stderr)
        self.assertEqual(open(out, encoding="utf-8").read(), '{"marker":"PREVIOUS_EXPORT"}\n')

        challenge = "<html><body>Please verify you are a human</body></html>"
        code, stdout, stderr, _ = self.run_cli(
            ["--output", out, "--url", BROOKLYN],
            response=Response(200, challenge, BROOKLYN),
        )
        self.assertEqual(code, 1)
        self.assertIn("challenge", stderr)
        self.assertEqual(stdout, "")
        self.assertEqual(open(out, encoding="utf-8").read(), '{"marker":"PREVIOUS_EXPORT"}\n')

    def test_scrapingdog_mock_redacts_key_and_missing_key_fails(self):
        out = self.write_previous()
        code, _, stderr, request = self.run_cli(
            ["--provider", "scrapingdog", "--output", out, "--url", BROOKLYN],
            env={},
        )
        self.assertEqual(code, 1)
        self.assertIn("missing_credential", stderr)
        self.assertFalse(request.called)
        self.assertEqual(open(out, encoding="utf-8").read(), '{"marker":"PREVIOUS_EXPORT"}\n')

        secret = "super-secret-scrapingdog-key"
        code, _, stderr, request = self.run_cli(
            ["--provider", "scrapingdog", "--output", out, "--timeout", "9", "--url", BROOKLYN],
            env={zillow.API_KEY_ENV: secret},
            error=requests.Timeout(f"https://api.scrapingdog.com/scrape?api_key={secret}&url={BROOKLYN}"),
        )
        self.assertEqual(code, 1)
        self.assertNotIn(secret, stderr)
        self.assertNotIn(secret, open(out, encoding="utf-8").read())
        self.assertEqual(request.call_args.kwargs["timeout"], 9)
        self.assertEqual(request.call_args.kwargs["params"]["dynamic"], "false")

        code, _, stderr, request = self.run_cli(
            ["--provider", "scrapingdog", "--output", out, "--timeout", "9", "--url", BROOKLYN],
            env={zillow.API_KEY_ENV: secret},
            response=Response(200, page([ARTICLE_CARD]), zillow.SCRAPINGDOG_ENDPOINT),
        )
        self.assertEqual(code, 0, stderr)
        called = request.call_args
        self.assertEqual(called.args[0], zillow.SCRAPINGDOG_ENDPOINT)
        self.assertEqual(called.kwargs["params"]["api_key"], secret)
        self.assertEqual(called.kwargs["params"]["url"], BROOKLYN)
        self.assertEqual(called.kwargs["params"]["dynamic"], "false")
        self.assertEqual(called.kwargs["timeout"], 9)
        payload = json.loads(open(out, encoding="utf-8").read())
        self.assertNotIn(secret, json.dumps(payload))
        self.assertEqual(payload["data_origin"], "scrapingdog")
        self.assertTrue(payload["live"])
        self.assertIsNotNone(payload["fetched_at"])
        self.assertEqual(payload["listings"][0]["pricing"], "$599,900")

    def test_redirect_off_zillow_preserves_output(self):
        out = self.write_previous()
        code, _, stderr, _ = self.run_cli(
            ["--output", out, "--url", BROOKLYN],
            response=Response(200, page([ARTICLE_CARD]), "https://example.test/blocked"),
        )
        self.assertEqual(code, 1)
        self.assertIn("http_error", stderr)
        self.assertEqual(open(out, encoding="utf-8").read(), '{"marker":"PREVIOUS_EXPORT"}\n')

    def test_usage_bounds(self):
        code, _, stderr, _ = self.run_cli(["--timeout", "0", "--html", "missing.html"])
        self.assertEqual(code, 2)
        self.assertIn("usage", stderr)


if __name__ == "__main__":
    unittest.main()
