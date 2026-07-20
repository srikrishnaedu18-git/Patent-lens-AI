"""
Google Patents Prior Art Scraper
---------------------------------
Uses Playwright (headless Chromium) to search Google Patents and extract
the top-20 results (title + abstract) for a given keyword query.

Outputs:
  • patents_results.csv  — standard CSV file

Usage:
  python scraper.py --query "smart irrigation sensor IoT"
  python scraper.py --query "blockchain supply chain" --max 20
"""

import asyncio
import csv
import argparse
import logging
import os
import base64
import sys
import time
from pathlib import Path
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger("scraper")


def _strip_html_to_text(content: str) -> str:
    import html as html_module
    import re

    content = re.sub(
        r'<span[^>]*class="google-src-text"[^>]*>.*?</span>',
        " ",
        content,
        flags=re.DOTALL | re.IGNORECASE,
    )
    content = re.sub(r"<(br|/p|/div|/h[1-6]|/li)\b[^>]*>", "\n", content, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", content)
    text = html_module.unescape(text)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def fetch_patent_deep_scrape(url: str, patent_id: str = "") -> str:
    """Fetch a patent detail page and extract title, abstract, description, and claims.

    The extractor intentionally stops before Google Patents citation/footer sections
    and removes table-like blocks so exports/audits do not ingest citation tables.
    """
    import re
    import urllib.request

    if not url:
        raise ValueError("Patent URL is empty")

    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://patents.google.com" + (url if url.startswith("/") else f"/patent/{patent_id}/en")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        page_content = response.read().decode("utf-8", errors="ignore")

    cutoff_patterns = [
        r'<div[^>]*class=["\'][^"\']*\bfooter\b[^"\']*["\'][^>]*>',
        r'<h3[^>]*id=["\']patentCitations["\'][^>]*>',
        r'<h3[^>]*id=["\']citedBy["\'][^>]*>',
    ]
    cutoff_indexes = [
        m.start()
        for pattern in cutoff_patterns
        for m in [re.search(pattern, page_content, re.IGNORECASE)]
        if m
    ]
    if cutoff_indexes:
        page_content = page_content[: min(cutoff_indexes)]

    page_content = re.sub(r"<script\b.*?</script>", " ", page_content, flags=re.DOTALL | re.IGNORECASE)
    page_content = re.sub(r"<style\b.*?</style>", " ", page_content, flags=re.DOTALL | re.IGNORECASE)
    page_content = re.sub(r"<table\b.*?</table>", " ", page_content, flags=re.DOTALL | re.IGNORECASE)
    page_content = re.sub(
        r'<div[^>]*class=["\'][^"\']*(responsive-table|table)[^"\']*["\'][^>]*>.*?</div>',
        " ",
        page_content,
        flags=re.DOTALL | re.IGNORECASE,
    )

    def meta_value(name: str) -> str:
        m = re.search(
            rf'<meta[^>]*name=["\']{re.escape(name)}["\'][^>]*content=["\']([^"\']*)',
            page_content,
            re.IGNORECASE,
        )
        return _strip_html_to_text(m.group(1)) if m else ""

    title = meta_value("DC.title")
    if not title:
        m = re.search(r'<span[^>]*itemprop=["\']title["\'][^>]*>(.*?)</span>', page_content, re.DOTALL | re.IGNORECASE)
        title = _strip_html_to_text(m.group(1)) if m else patent_id

    sections: list[tuple[str, str]] = []
    if title:
        sections.append(("Title", title))

    section_labels = {
        "abstract": "Abstract",
        "description": "Description",
        "claims": "Claims",
    }
    for itemprop, label in section_labels.items():
        m = re.search(
            rf'<section[^>]*itemprop=["\']{itemprop}["\'][^>]*>(.*?)</section>',
            page_content,
            re.DOTALL | re.IGNORECASE,
        )
        if not m:
            continue
        section_html = re.sub(r"<h2\b.*?</h2>", " ", m.group(1), flags=re.DOTALL | re.IGNORECASE)
        text = _strip_html_to_text(section_html)
        if text:
            sections.append((label, text))

    if len(sections) <= 1:
        article = re.search(r"<article\b[^>]*>(.*?)</article>", page_content, re.DOTALL | re.IGNORECASE)
        if article:
            text = _strip_html_to_text(article.group(1))
            if text:
                sections.append(("Patent Body", text))

    if not sections:
        raise RuntimeError("No deep scrape content found")

    return "\n\n".join(f"{label}\n{text}" for label, text in sections).strip()

# ─────────────────────────────────────────────────────────────────────────────
#  Core scraping logic
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_PATENTS_SEARCH = "https://patents.google.com/?q={query}&num=20"
INDIA_PATENTS_BASE = "https://iprsearch.ipindia.gov.in"
VALID_PATENT_SOURCES = {"google", "india"}
INDIA_CAPTCHA_MAX_ATTEMPTS = 2

INDIA_SEARCH_FIELDS = {
    "TI", "ABS", "CSP", "AP", "PN", "patent-number", "PA", "ANC", "ANA",
    "IN", "INC", "INA", "FO", "IC", "PAP", "PPN",
}
INDIA_DATE_FIELDS = {"APD", "PD", "PDG", "PRD"}
INDIA_LOGIC_FIELDS = {"AND", "OR", "NOT"}


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _clean_choice(value: str, allowed: set[str], fallback: str) -> str:
    value = str(value or "").strip()
    return value if value in allowed else fallback


def get_india_options_from_env() -> dict:
    """Read safe Indian Patent Search defaults from environment variables."""
    rows = []
    raw_rows = os.getenv("INDIA_PATENTS_SEARCH_ROWS", "").strip()
    if raw_rows:
        try:
            import json
            parsed = json.loads(raw_rows)
            if isinstance(parsed, list):
                rows = parsed
        except Exception:
            logger.warning("[India Scraper] Invalid INDIA_PATENTS_SEARCH_ROWS JSON; using row env defaults.")

    if not rows:
        rows = [{
            "field": os.getenv("INDIA_PATENTS_SEARCH_FIELD", "TI"),
            "text": os.getenv("INDIA_PATENTS_SEARCH_TEXT", ""),
            "logic": os.getenv("INDIA_PATENTS_ROW_LOGIC", "AND"),
        }]

    return normalize_india_options({
        "published": _env_bool("INDIA_PATENTS_PUBLISHED", True),
        "granted": _env_bool("INDIA_PATENTS_GRANTED", False),
        "date_field": os.getenv("INDIA_PATENTS_DATE_FIELD", "APD"),
        "from_date": os.getenv("INDIA_PATENTS_FROM_DATE", ""),
        "to_date": os.getenv("INDIA_PATENTS_TO_DATE", ""),
        "logic_field": os.getenv("INDIA_PATENTS_LOGIC_FIELD", "AND"),
        "rows": rows,
    })


def normalize_india_options(options: Optional[dict] = None) -> dict:
    """Normalize India Patent Search options from env or UI overrides."""
    options = options or {}
    published = bool(options.get("published", True))
    granted = bool(options.get("granted", False))
    if not published and not granted:
        published = True

    rows_in = options.get("rows") or []
    rows: list[dict] = []
    for row in rows_in:
        if not isinstance(row, dict):
            continue
        rows.append({
            "field": _clean_choice(row.get("field", "TI"), INDIA_SEARCH_FIELDS, "TI"),
            "text": str(row.get("text", "") or "").strip(),
            "logic": _clean_choice(row.get("logic", "AND"), INDIA_LOGIC_FIELDS, "AND"),
        })
    if not rows:
        rows = [{"field": "TI", "text": "", "logic": "AND"}]

    return {
        "published": published,
        "granted": granted,
        "date_field": _clean_choice(options.get("date_field", "APD"), INDIA_DATE_FIELDS, "APD"),
        "from_date": str(options.get("from_date", "") or "").strip(),
        "to_date": str(options.get("to_date", "") or "").strip(),
        "logic_field": _clean_choice(options.get("logic_field", "AND"), INDIA_LOGIC_FIELDS, "AND"),
        "rows": rows[:5],
    }

def normalize_sources(sources: Optional[list[str]] = None) -> list[str]:
    """Return a de-duplicated, validated patent source list."""
    if not sources:
        return ["google"]

    normalized: list[str] = []
    for source in sources:
        value = str(source or "").strip().lower()
        if value == "both":
            value = ""
            for expanded in ("google", "india"):
                if expanded not in normalized:
                    normalized.append(expanded)
            continue
        if value not in VALID_PATENT_SOURCES:
            raise ValueError(f"Unsupported patent source: {source}")
        if value not in normalized:
            normalized.append(value)

    return normalized or ["google"]


async def scrape_patents(
    query: str,
    max_results: int = 20,
    progress_callback: Optional[Callable[[str], None]] = None,
    sources: Optional[list[str]] = None,
    india_options: Optional[dict] = None,
    captcha_callback: Optional[Callable[[str], Awaitable[str]]] = None,
    is_cancelled_callback: Optional[Callable[[], bool]] = None,
) -> list[dict]:
    """
    Scrape patents from one or more configured sources and normalize the output.

    Returns dicts with the app's canonical keys:
      rank, patent_id, title, abstract, url, source
    """
    selected_sources = normalize_sources(sources)
    all_results: list[dict] = []
    errors: list[str] = []

    source_handlers = {
        "google": scrape_google_patents,
        "india": scrape_india_patents,
    }

    for source in selected_sources:
        handler = source_handlers[source]
        try:
            if progress_callback:
                progress_callback(f"Starting {source.title()} Patents search for: {query[:80]}")
            if source == "india":
                results = await handler(
                    query,
                    max_results,
                    progress_callback=progress_callback,
                    india_options=india_options,
                    captcha_callback=captcha_callback,
                    is_cancelled_callback=is_cancelled_callback,
                )
            else:
                results = await handler(
                    query,
                    max_results,
                    progress_callback=progress_callback,
                    is_cancelled_callback=is_cancelled_callback,
                )
            all_results.extend(results)
        except Exception as exc:
            message = f"{source.title()} Patents failed: {exc}"
            logger.error("[Scraper] %s", message, exc_info=True)
            errors.append(message)
            if progress_callback:
                progress_callback(message)

    if not all_results and errors:
        raise RuntimeError("; ".join(errors))

    return all_results


def _fetch_google_patent_details_jsonld(patent_id: str) -> tuple[Optional[str], Optional[str]]:
    """
    Fetch the full title and abstract for a Google Patents page from raw HTML.

    Discovery (from probing actual patent page HTML):
    ─────────────────────────────────────────────────
    • US patents: contain <section itemprop="abstract"> in the raw HTML with
      the full abstract text in <p> / <div itemprop="content"> elements.
    • JP/other translated patents: the abstract section is only created by JS,
      but the raw HTML contains <summary-of-invention> inside <description>.
    • DC.description meta tag: available for US patents as a clean, untruncated
      summary; empty for JP patents.
    • JSON-LD: not present in Google Patents pages.

    Strategy (in order):
      1. <section itemprop="abstract"> in raw HTML  → US patents ✓
      2. DC.description meta tag                     → US patents ✓ (shorter abstracts)
      3. <summary-of-invention> in description       → JP/translated patents ✓
      4. DC.title for the title in all cases
    """
    import urllib.request
    import html as html_module
    import re

    from urllib.parse import urljoin

    base_url = "https://patents.google.com"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def _strip_html(content: str) -> str:
        """Strip HTML tags and collapse whitespace to plain text."""
        # Remove <span class="google-src-text"> blocks (untranslated source language)
        content = re.sub(
            r'<span[^>]*class="google-src-text"[^>]*>.*?</span>',
            '', content, flags=re.DOTALL
        )
        text = re.sub(r'<[^>]+>', ' ', content)
        return re.sub(r'\s+', ' ', html_module.unescape(text)).strip()

    def _extract_details_from_html(page_content: str) -> tuple[Optional[str], Optional[str], list[str]]:
        title: Optional[str] = None
        abstract: Optional[str] = None
        related_urls: list[str] = []

        # ── 1. DC.title ──────────────────────────────────────────────────────
        m = re.search(
            r'<meta[^>]*name="DC\.title"[^>]*content="([^"]*)"',
            page_content, re.IGNORECASE,
        )
        if m:
            title = html_module.unescape(m.group(1)).strip() or None

        # ── 2. section itemprop="abstract" from the patent detail page ───────
        abs_sec = re.search(
            r'<section[^>]*itemprop=["\']abstract["\'][^>]*>(.*?)</section>',
            page_content, re.DOTALL | re.IGNORECASE,
        )
        if abs_sec:
            section_html = re.sub(
                r'<h2[^>]*>.*?</h2>',
                ' ',
                abs_sec.group(1),
                flags=re.DOTALL | re.IGNORECASE,
            )
            text = _strip_html(section_html)
            if text and len(text) > 30:
                abstract = text

        # ── 3. DC.description meta (clean for US patents) ────────────────────
        if not abstract:
            m = re.search(
                r'<meta[^>]*name="DC\.description"[^>]*content="([^"]*)"',
                page_content, re.IGNORECASE,
            )
            if m:
                val = html_module.unescape(m.group(1)).strip()
                if val and len(val) > 30 and not val.endswith("…"):
                    abstract = val

        # ── 4. <abstract> tag nested inside Google's detail HTML ─────────────
        if not abstract:
            abs_tag = re.search(
                r'<abstract\b[^>]*>(.*?)</abstract>',
                page_content, re.DOTALL | re.IGNORECASE,
            )
            if abs_tag:
                text = _strip_html(abs_tag.group(1))
                if text and len(text) > 30:
                    abstract = text

        # ── 5. <summary-of-invention> (JP/translated patents) ────────────────
        if not abstract:
            sum_sec = re.search(
                r'<summary-of-invention>(.*?)</summary-of-invention>',
                page_content, re.DOTALL | re.IGNORECASE,
            )
            if sum_sec:
                text = _strip_html(sum_sec.group(1))
                # Keep only English sentences (exclude CJK-heavy lines)
                lines = text.split('.')
                english_lines = [
                    l.strip() for l in lines
                    if l.strip() and not re.search(r'[\u3000-\u9fff]', l)
                ]
                combined = '. '.join(english_lines).strip()
                if combined and len(combined) > 30:
                    abstract = combined[:3000]  # cap at 3000 chars

        # Granted patent pages can omit abstracts. Google usually links the
        # published A document under "Other versions", which does contain one.
        for href in re.findall(r'<a[^>]+href=["\']([^"\']*/patent/[^"\']+/en)["\']', page_content, re.IGNORECASE):
            related_urls.append(urljoin(base_url, href))

        return title or None, abstract or None, related_urls

    def _candidate_urls(pid: str) -> list[str]:
        urls = [f"{base_url}/patent/{pid}/en"]
        match = re.match(r"^([A-Z]{2}\d+)([A-Z]\d?)$", pid)
        if match and match.group(2).startswith("B"):
            prefix = match.group(1)
            urls.extend([
                f"{base_url}/patent/{prefix}A1/en",
                f"{base_url}/patent/{prefix}A2/en",
            ])
        return urls

    try:
        urls_to_try = _candidate_urls(patent_id)
        seen_urls: set[str] = set()
        best_title: Optional[str] = None

        while urls_to_try:
            url = urls_to_try.pop(0)
            if url in seen_urls:
                continue
            seen_urls.add(url)

            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as response:
                page_content = response.read().decode("utf-8", errors="ignore")

            title, abstract, related_urls = _extract_details_from_html(page_content)
            if title and not best_title:
                best_title = title
            if abstract:
                return best_title or title or None, abstract

            for related_url in related_urls:
                if related_url not in seen_urls:
                    urls_to_try.append(related_url)

        return best_title, None

    except Exception as e:
        logger.warning("[Scraper] Failed to fetch patent details for %s: %s", patent_id, e)
        return None, None


async def scrape_google_patents(
    query: str,
    max_results: int = 20,
    progress_callback: Optional[Callable[[str], None]] = None,
    is_cancelled_callback: Optional[Callable[[], bool]] = None,
) -> list[dict]:
    """
    Launch a headless Chromium browser, search Google Patents for *query*,
    and return a list of dicts with keys: rank, title, abstract, patent_id, url.

    Args:
        query:             The search query string.
        max_results:       Max number of results to extract.
        progress_callback: Optional sync callable(msg: str) for live progress
                           updates (used for SSE streaming in the server).
    """
    def _log(msg: str):
        logger.info(msg)
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception as cb_err:
                logger.debug("progress_callback error: %s", cb_err)
    encoded_query = query.replace(" ", "+")
    url = GOOGLE_PATENTS_SEARCH.format(query=encoded_query)

    results: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )

        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )

        page = await context.new_page()

        _log(f"🌐 Navigating to Google Patents: {url[:100]}")
        logger.info("[Scraper] Full URL: %s", url)
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)

        # Google Patents is a Polymer/Web Components app — wait for custom elements
        try:
            await page.wait_for_selector("search-result-item", timeout=20_000)
        except PlaywrightTimeoutError:
            _log("⚠️ Timed out waiting for search-result-item — page may be rate-limiting. Attempting fallback...")
            logger.warning("[Scraper] Timeout on selector for query: %s", query)

        # Brief settle time for Web Components to render
        await asyncio.sleep(2)

        # ── Extract items ────────────────────────────────────────────────────
        items = await page.query_selector_all("search-result-item")
        _log(f"📋 Found {len(items)} result items on page for query: {query[:60]}")

        for idx, item in enumerate(items[:max_results], start=1):
            if is_cancelled_callback and is_cancelled_callback():
                _log("⛔ Scrape cancellation detected. Terminating early...")
                break
            # 1. Patent number / ID and URL
            patent_id = ""
            url_href = ""
            
            result_title_node = await item.query_selector("state-modifier.result-title")
            if result_title_node:
                data_result = await result_title_node.get_attribute("data-result") or ""
                if data_result.startswith("patent/"):
                    parts = data_result.split("/")
                    if len(parts) > 1:
                        patent_id = parts[1]
                    url_href = f"https://patents.google.com/{data_result}"

            # Fallback to the link search if state-modifier isn't found/configured
            if not patent_id:
                link = await item.query_selector("a[href*='/patent/']")
                if link:
                    url_href = await link.get_attribute("href") or ""
                    parts = url_href.split("/patent/")
                    if len(parts) > 1:
                        patent_id = parts[1].split("/")[0]
                    if url_href.startswith("/"):
                        url_href = "https://patents.google.com" + url_href

            # 2. Title
            title = await _extract_text(item, [
                "state-modifier.result-title h3",
                "h3",
                "[data-proto='RESULT_TITLE']",
                ".search-result-title",
            ])

            # 3. Abstract snippet
            abstract = ""
            # Try finding the raw-html sibling of h4.dates first
            abstract_node = await item.query_selector("h4.dates ~ raw-html")
            if abstract_node:
                text = await abstract_node.inner_text()
                if text and text.strip():
                    abstract = text.strip()

            # Browser-side JS fallback for abstract (filtering out raw-html inside h4)
            if not abstract:
                abstract = await item.evaluate("""
                    (element) => {
                        const abstractContainer = element.querySelector('.abstract');
                        if (!abstractContainer) return '';
                        const rawHtmls = abstractContainer.querySelectorAll('raw-html');
                        for (const el of rawHtmls) {
                            if (!el.closest('h4')) {
                                return el.innerText;
                            }
                        }
                        return '';
                    }
                """)

            # General abstract selector fallback
            if not abstract:
                abstract = await _extract_text(item, [
                    "span[data-proto='ABSTRACT_SNIPPET']",
                    ".result-abstract",
                    "abstract-text",
                    "span.style-scope.search-result-item",
                ])

            # 4. Total fallback if both are empty
            if not title and not abstract:
                raw = await item.inner_text()
                lines = [l.strip() for l in raw.splitlines() if l.strip()]
                title = lines[0] if lines else "-"
                abstract = " ".join(lines[1:4]) if len(lines) > 1 else "-"

            results.append({
                "rank":     idx,
                "title":    title.strip() if title else "-",
                "abstract": abstract.strip() if abstract else "-",
                "patent_id": patent_id,
                "url":      url_href,
                "source":   "Google Patents",
            })

            _log(f"  [{idx:02d}] {patent_id} - {(title or '(no title)')[:60]}")

        # Close browser — enrichment now uses fast urllib, no browser needed
        await browser.close()

        # Enrich with full title and abstract via JSON-LD (full, untruncated)
        if results:
            _log(f"🔗 Enriching {len(results)} results with full abstracts via JSON-LD...")
            semaphore = asyncio.Semaphore(5)  # max 5 concurrent HTTP requests

            async def enrich_result(res):
                if is_cancelled_callback and is_cancelled_callback():
                    return
                pid = res.get("patent_id")
                if pid:
                    async with semaphore:
                        t, a = await asyncio.to_thread(_fetch_google_patent_details_jsonld, pid)
                    if t:
                        res["title"] = t
                    if a and not a.endswith("…") and not a.endswith("..."):
                        res["abstract"] = a
                        _log(f"  ✅ {pid} — {len(a)} chars")
                    elif a:
                        res["abstract"] = a  # take even if ends with … (better than nothing)
                        _log(f"  ⚠️ {pid} — still truncated ({len(a)} chars)")

            await asyncio.gather(*(enrich_result(res) for res in results))

    return results


async def scrape_india_patents(
    query: str,
    max_results: int = 20,
    progress_callback: Optional[Callable[[str], None]] = None,
    india_options: Optional[dict] = None,
    captcha_callback: Optional[Callable[[str], Awaitable[str]]] = None,
    is_cancelled_callback: Optional[Callable[[], bool]] = None,
) -> list[dict]:
    """
    Search the Indian Patent Advanced Search portal and normalize results.

    IP India's public search currently presents a CAPTCHA. This scraper supports
    a compliant manual-CAPTCHA flow when INDIA_PATENTS_HEADFUL=1 is set:
    Playwright opens a visible browser, fills the query, then waits for the user
    to solve the CAPTCHA and submit the search.
    """
    def _log(msg: str):
        logger.info(msg)
        if progress_callback:
            try:
                progress_callback(msg)
            except Exception as cb_err:
                logger.debug("progress_callback error: %s", cb_err)

    options = normalize_india_options(india_options or get_india_options_from_env())
    url = f"{INDIA_PATENTS_BASE}/PublicSearch/"
    results: list[dict] = []

    async with async_playwright() as pw:
        _india_headless = os.getenv("INDIA_PATENT_HEADLESS", "true").strip().lower() != "false"
        browser = await pw.chromium.launch(
            headless=_india_headless,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = await browser.new_context(
            viewport={"width": 1366, "height": 950},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        # Capture alert dialogs (e.g. "No Record Found", "Enter Correct Captcha")
        dialog_messages = []
        async def handle_dialog(dialog):
            msg = dialog.message
            dialog_messages.append(msg)
            logger.info("[IP India Dialog] Message: %s", msg)
            await dialog.dismiss()

        page.on("dialog", lambda d: asyncio.create_task(handle_dialog(d)))

        _log(f"Navigating to Indian Patent Search: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        await page.wait_for_selector("select[name='ItemField1']", timeout=20_000)

        await _apply_india_search_options(page, query, options)

        captcha_visible = await page.locator("#CaptchaText").count() > 0
        if captcha_visible:
            if not captcha_callback:
                await browser.close()
                raise RuntimeError("Indian Patent Search requires CAPTCHA, but no CAPTCHA handler is configured.")
            rows = await _solve_india_captcha(page, captcha_callback, _log, dialog_messages, query, options, max_results, is_cancelled_callback)
            if rows is None: # None indicates "No Records Found"
                await browser.close()
                return []
        else:
            await page.click("input[type='submit'][value='Search']")
            try:
                await page.wait_for_selector("#tableData tbody tr", timeout=45_000)
                rows = await _extract_india_result_rows(page, max_results)
            except PlaywrightTimeoutError:
                # Check if portal showed a "No Record Found" dialog
                if dialog_messages:
                    last_msg = dialog_messages[-1].lower()
                    if "no record" in last_msg or "record not found" in last_msg:
                        _log("ℹ️ Indian Patents Search returned: No Record Found.")
                        await browser.close()
                        return []
                raise
        
        _log(f"Found {len(rows)} Indian patent result rows for query: {query[:60]}")
        
        ip_value = ""
        try:
            ip_value = await page.locator("input#IP").first.input_value(timeout=1000)
        except Exception:
            pass

        for idx, row in enumerate(rows, start=1):
            if is_cancelled_callback and is_cancelled_callback():
                _log("⛔ Scrape cancellation detected during detail extraction. Terminating early and saving scraped results...")
                break
            app_no = row.get("application_number", "").strip()
            title = row.get("title", "").strip() or "—"
            abstract = ""
            detail_title = ""
            if app_no:
                try:
                    detail = await _fetch_india_patent_detail(context, app_no, ip_value)
                    abstract = detail.get("abstract", "")
                    detail_title = detail.get("title", "")
                except Exception as exc:
                    _log(f"Could not fetch Indian patent detail for {app_no}: {str(exc)[:100]}")

            results.append({
                "rank": idx,
                "title": detail_title or title,
                "abstract": abstract or "—",
                "patent_id": app_no,
                "url": f"{INDIA_PATENTS_BASE}/PublicSearch/PublicationSearch/PatentDetails",
                "source": "Indian Patents",
            })
            _log(f"  [{idx:02d}] IN {app_no} — {(detail_title or title)[:60]}")

        await browser.close()

    return results


async def _apply_india_search_options(page, query: str, options: dict) -> None:
    """Fill the IP India search form using normalized options."""
    if await page.locator("#Published").count():
        await page.locator("#Published").set_checked(bool(options["published"]))
    if await page.locator("#Granted").count():
        await page.locator("#Granted").set_checked(bool(options["granted"]))

    await page.select_option("#DateField", options["date_field"])
    
    # Set FromDate and ToDate directly via JS property and dispatch change event to bypass datepicker overlays
    if options["from_date"]:
        await page.evaluate(f"document.getElementById('FromDate').value = '{options['from_date']}'")
        await page.locator("#FromDate").evaluate("el => el.dispatchEvent(new Event('change', { bubbles: true }))")
    if options["to_date"]:
        await page.evaluate(f"document.getElementById('ToDate').value = '{options['to_date']}'")
        await page.locator("#ToDate").evaluate("el => el.dispatchEvent(new Event('change', { bubbles: true }))")
        
    await page.select_option("#LogicField", options["logic_field"])

    rows = options["rows"] or [{"field": "TI", "text": "", "logic": "AND"}]
    
    # Compile multiple query rows into a single prefix-based query for TextField1.
    # The IP India portal's backend crashes with a 500 error on multi-row forms filled with complex queries,
    # but handles the combined prefixes (TI:, ABS:, CSP:) in TextField1 perfectly.
    if len(rows) > 1:
        parts = []
        for idx, row in enumerate(rows):
            text_val = (row["text"] or "").strip()
            if not text_val:
                continue
            # Wrap text in parentheses if it contains logical operators to preserve correct precedence
            if " " in text_val or " AND " in text_val.upper() or " OR " in text_val.upper():
                text_val = f"({text_val})"
            
            part = f"{row['field']}: {text_val}"
            if idx > 0:
                prev_logic = rows[idx - 1]["logic"]
                parts.append(f"{prev_logic} {part}")
            else:
                parts.append(part)
        combined_query = " ".join(parts)
        rows = [{"field": rows[0]["field"], "text": combined_query, "logic": "AND"}]

    for idx, row in enumerate(rows, start=1):
        if idx > 1:
            await page.click("#btnAddRow")
            await page.wait_for_selector(f"select[name='ItemField{idx}']", timeout=5_000)

        await page.select_option(f"select[name='ItemField{idx}']", row["field"])
        await page.fill(f"input[name='TextField{idx}']", row["text"] or query)
        await page.select_option(f"select[name='LogicField{idx}']", row["logic"])


async def _solve_india_captcha(
    page,
    captcha_callback: Callable[[str], Awaitable[str]],
    log_callback: Callable[[str], None],
    dialog_messages: list[str],
    query: str,
    options: dict,
    max_results: int,
    is_cancelled_callback: Optional[Callable[[], bool]] = None,
) -> Optional[list[dict]]:
    """
    Send CAPTCHA image to the app, wait for the answer, and submit.
    Returns a list of rows on success, None if "No Records Found", or raises an error.
    Raises RuntimeError if CAPTCHA fails after all attempts.
    """
    for attempt in range(1, INDIA_CAPTCHA_MAX_ATTEMPTS + 1):
        if is_cancelled_callback and is_cancelled_callback():
            log_callback("⛔ Scrape cancellation detected during CAPTCHA solving. Terminating...")
            return []
        # Check if the search terms are missing (e.g. due to form reset on failed captcha)
        need_refill = False
        try:
            current_val = await page.locator("input[name='TextField1']").first.input_value(timeout=1000)
            rows = options["rows"] or []
            if len(rows) > 1:
                parts = []
                for idx, row in enumerate(rows):
                    text_val = (row["text"] or "").strip()
                    if not text_val:
                        continue
                    if " " in text_val or " AND " in text_val.upper() or " OR " in text_val.upper():
                        text_val = f"({text_val})"
                    part = f"{row['field']}: {text_val}"
                    if idx > 0:
                        prev_logic = rows[idx - 1]["logic"]
                        parts.append(f"{prev_logic} {part}")
                    else:
                        parts.append(part)
                expected_val = " ".join(parts)
            else:
                expected_val = (rows[0]["text"] if rows else query) or query
                
            if current_val != expected_val:
                need_refill = True
        except Exception:
            need_refill = True

        if need_refill:
            log_callback("Form was reset/cleared. Re-applying search options...")
            await _apply_india_search_options(page, query, options)

        # Hide any calendar popup divs to prevent them from obscuring the CAPTCHA image
        await page.evaluate("""
            document.querySelectorAll("div.datepicker, .datepicker-dropdown, #ui-datepicker-div").forEach(el => el.style.display = "none");
        """)
        
        captcha = page.locator("#Captcha")
        image_bytes = await captcha.screenshot(type="png")
        image_data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")
        log_callback(f"Indian Patent Search CAPTCHA required (attempt {attempt}/{INDIA_CAPTCHA_MAX_ATTEMPTS}).")

        answer = (await captcha_callback(image_data_url)).strip()
        if not answer:
            raise RuntimeError("Indian Patent Search CAPTCHA was not provided.")

        await page.fill("#CaptchaText", answer)
        dialog_messages.clear()
        await page.click("input[type='submit'][value='Search']")

        try:
            await page.wait_for_selector("#tableData tbody tr", timeout=15_000)
            return await _extract_india_result_rows(page, max_results)
        except PlaywrightTimeoutError:
            # Check if portal responded with No Record Found dialog
            if dialog_messages:
                last_msg = dialog_messages[-1].lower()
                if "no record" in last_msg or "record not found" in last_msg:
                    log_callback("ℹ️ Indian Patents Search returned: No Records Found.")
                    return None

            if attempt >= INDIA_CAPTCHA_MAX_ATTEMPTS:
                raise RuntimeError(f"Indian Patent Search CAPTCHA failed after {INDIA_CAPTCHA_MAX_ATTEMPTS} attempts.")
            log_callback("CAPTCHA was not accepted. Restarting the search process from scratch...")
            try:
                await page.goto(f"{INDIA_PATENTS_BASE}/PublicSearch/", wait_until="domcontentloaded", timeout=45_000)
                await page.wait_for_selector("select[name='ItemField1']", timeout=20_000)
                await _apply_india_search_options(page, query, options)
            except Exception as reload_err:
                log_callback(f"⚠️ Warning: Failed to reload page after incorrect CAPTCHA: {reload_err}")
                # Fallback: try to refresh CAPTCHA if reload failed
                if await page.locator("img[onclick='CaptchaLoad()']").count():
                    await page.locator("img[onclick='CaptchaLoad()']").click()
                    await page.wait_for_timeout(1500)


async def _extract_india_result_rows(page, max_results: int) -> list[dict]:
    """Extract application number/title rows from the IP India result table."""
    return await page.evaluate(
        """
        (maxResults) => {
          const rows = Array.from(document.querySelectorAll("#tableData tbody tr"));
          return rows.slice(0, maxResults).map((row) => {
            const cells = Array.from(row.querySelectorAll("td"));
            const appButton = row.querySelector("button[name='ApplicationNumber']");
            return {
              application_number: (appButton?.value || cells[0]?.innerText || "").trim(),
              title: (row.querySelector("td.title")?.innerText || cells[1]?.innerText || "").trim(),
              application_date: (cells[2]?.innerText || "").trim(),
              status: (cells[3]?.innerText || "").trim()
            };
          }).filter((item) => item.application_number || item.title);
        }
        """,
        max_results,
    )


async def _fetch_india_patent_detail(context, application_number: str, ip_value: str = "") -> dict:
    """POST to the IP India detail endpoint and parse title + abstract."""
    response = await context.request.post(
        f"{INDIA_PATENTS_BASE}/PublicSearch/PublicationSearch/PatentDetails",
        form={
            "ApplicationNumber": application_number,
            "IP": ip_value,
            "ConnectionName": "PublicationConnection",
        },
        timeout=45_000,
    )
    if not response.ok:
        raise RuntimeError(f"detail request returned HTTP {response.status}")

    html = await response.text()
    detail_page = await context.new_page()
    try:
        await detail_page.set_content(html, wait_until="domcontentloaded")
        return await detail_page.evaluate(
            """
            () => {
              const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
              let title = "";
              let abstract = "";
              const rows = Array.from(document.querySelectorAll("tr"));
              for (const row of rows) {
                const cells = Array.from(row.querySelectorAll("td"));
                if (cells.length < 2) continue;
                const label = clean(cells[0].innerText).replace(/:$/, "").toLowerCase();
                if (label === "invention title") {
                  title = clean(cells[1].innerText);
                }
                if (cells[0].innerText.toLowerCase().includes("abstract")) {
                  abstract = clean(row.innerText.replace(/^\\s*Abstract:\\s*/i, ""));
                }
              }
              if (!abstract) {
                const abstractCell = Array.from(document.querySelectorAll("td"))
                  .find((td) => td.innerText.toLowerCase().includes("abstract:"));
                if (abstractCell) {
                  abstract = clean(abstractCell.innerText.replace(/^\\s*Abstract:\\s*/i, ""));
                }
              }
              return { title, abstract };
            }
            """
        )
    finally:
        await detail_page.close()


async def _extract_text(element, selectors: list[str]) -> str:
    """Try multiple CSS selectors and return the first non-empty text found."""
    for sel in selectors:
        try:
            node = await element.query_selector(sel)
            if node:
                text = await node.inner_text()
                if text and text.strip():
                    return text.strip()
        except Exception:
            continue
    return ""


# ─────────────────────────────────────────────────────────────────────────────
#  CSV export
# ─────────────────────────────────────────────────────────────────────────────

def save_csv(results: list[dict], filepath: Path) -> None:
    fieldnames = ["rank", "patent_id", "title", "abstract", "url"]
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)
    print(f"[OK] CSV saved -> {filepath}")


# ─────────────────────────────────────────────────────────────────────────────
#  CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scrape patents and save top-N results to CSV"
    )
    parser.add_argument(
        "--query", "-q",
        required=True,
        help='Search keywords, e.g. "smart irrigation IoT sensor"'
    )
    parser.add_argument(
        "--max", "-n",
        type=int,
        default=20,
        help="Maximum number of results to extract (default: 20)"
    )
    parser.add_argument(
        "--out", "-o",
        default="patents_results",
        help='Output file base name (default: patents_results)'
    )
    parser.add_argument(
        "--source", "-s",
        choices=["google", "india", "both"],
        default="google",
        help="Patent source to scrape: google, india, or both (default: google)"
    )
    args = parser.parse_args()

    out_dir  = Path(__file__).parent
    csv_path = out_dir / f"{args.out}.csv"

    print(f"\n{'='*60}")
    print(f"  Google Patents Prior Art Scraper")
    print(f"{'='*60}")
    print(f"  Query   : {args.query}")
    print(f"  Max     : {args.max} results")
    print(f"  Output  : {csv_path.name}")
    print(f"{'='*60}\n")

    start = time.time()
    sources = ["google", "india"] if args.source == "both" else [args.source]
    results = asyncio.run(scrape_patents(args.query, args.max, sources=sources))
    elapsed = time.time() - start

    if not results:
        print("[ERROR] No results were extracted. Exiting.")
        sys.exit(1)

    print(f"\n[INFO] Extracted {len(results)} patents in {elapsed:.1f}s\n")

    save_csv(results, csv_path)

    print(f"\n[OK] Done! Files written to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
