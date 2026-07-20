import asyncio
import os
import sys
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend import scraper


def test_scrape_patents_returns_accumulated_results(monkeypatch):
    async def fake_google(*args, **kwargs):
        return [
            {
                "rank": 1,
                "patent_id": "US123A1",
                "title": "Saved result",
                "abstract": "Complete abstract",
                "url": "https://patents.google.com/patent/US123A1/en",
                "source": "Google Patents",
            }
        ]

    monkeypatch.setattr(scraper, "scrape_google_patents", fake_google)

    results = asyncio.run(scraper.scrape_patents("blockchain", sources=["google"]))

    assert len(results) == 1
    assert results[0]["patent_id"] == "US123A1"
    assert results[0]["abstract"] == "Complete abstract"


def test_google_detail_fetch_falls_back_from_granted_b_page_to_a_publication(monkeypatch):
    requested_urls = []

    b_page = """
    <html>
      <head>
        <meta name="DC.title" content="Granted title">
        <meta name="DC.description" content="">
      </head>
      <body>
        <dd itemprop="directAssociations" itemscope repeat>
          <a href="/patent/EP3563596A1/en">
            <span itemprop="publicationNumber">EP3563596A1</span>
          </a>
        </dd>
      </body>
    </html>
    """

    a_page = """
    <html>
      <head>
        <meta name="DC.title" content="Published title">
      </head>
      <body>
        <section itemprop="abstract" itemscope>
          <h2>Abstract</h2>
          <div itemprop="content" html>
            <abstract>
              <div class="abstract">
                An Internet of Things network composite object includes a device owner,
                sub-objects, and a blockchain recording the sub-objects.
              </div>
            </abstract>
          </div>
        </section>
      </body>
    </html>
    """

    class FakeResponse:
        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self.body.encode("utf-8")

    def fake_urlopen(req, timeout=15):
        requested_urls.append(req.full_url)
        if req.full_url.endswith("/EP3563596B1/en"):
            return FakeResponse(b_page)
        if req.full_url.endswith("/EP3563596A1/en"):
            return FakeResponse(a_page)
        raise AssertionError(f"Unexpected URL: {req.full_url}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    title, abstract = scraper._fetch_google_patent_details_jsonld("EP3563596B1")

    assert title == "Granted title"
    assert abstract.startswith("An Internet of Things network composite object")
    assert abstract.endswith("recording the sub-objects.")
    assert requested_urls[:2] == [
        "https://patents.google.com/patent/EP3563596B1/en",
        "https://patents.google.com/patent/EP3563596A1/en",
    ]
