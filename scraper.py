"""
Google Patents Prior Art Scraper
---------------------------------
Uses Playwright (headless Chromium) to search Google Patents and extract
the top-20 results (title + abstract) for a given keyword query.

Outputs:
  • patents_results.csv  — standard CSV file
  • patents_results.pdf  — CSV-style table rendered as a PDF

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
import textwrap
import time
from pathlib import Path
from datetime import datetime
from typing import Awaitable, Callable, Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("scraper")

# ── optional PDF library (fpdf2) ──────────────────────────────────────────────
try:
    from fpdf import FPDF
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False
    print("[WARN] fpdf2 not installed — PDF output will be skipped.")
    print("       Run: pip install fpdf2")

# ─────────────────────────────────────────────────────────────────────────────
#  Core scraping logic
# ─────────────────────────────────────────────────────────────────────────────

GOOGLE_PATENTS_SEARCH = "https://patents.google.com/?q={query}&num=20"
INDIA_PATENTS_BASE = "https://iprsearch.ipindia.gov.in"
VALID_PATENT_SOURCES = {"google", "india"}

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
                )
            else:
                results = await handler(query, max_results, progress_callback=progress_callback)
            all_results.extend(results)
        except Exception as exc:
            message = f"{source.title()} Patents failed: {exc}"
            logger.error("[Scraper] %s", message, exc_info=True)
            errors.append(message)
            if progress_callback:
                progress_callback(message)

    if not all_results and errors:
        raise RuntimeError("; ".join(errors))

    seen: set[str] = set()
    unique: list[dict] = []
    for result in all_results:
        key = f"{result.get('source', '')}:{result.get('patent_id') or result.get('title', '')}"
        if key in seen:
            continue
        seen.add(key)
        result["rank"] = len(unique) + 1
        unique.append(result)

    return unique[: max(1, max_results * len(selected_sources))]


def _fetch_google_patent_details(patent_id: str) -> tuple[Optional[str], Optional[str]]:
    """Fetch the full title and abstract for a patent from Google Patents using urllib."""
    import urllib.request
    import html
    import re
    
    url = f"https://patents.google.com/patent/{patent_id}/en"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            page_content = response.read().decode('utf-8', errors='ignore')
            
            # Find DC.title meta tag
            title_match = re.search(r'<meta[^>]*name="DC\.title"[^>]*content="([^"]*)"', page_content, re.IGNORECASE)
            title = html.unescape(title_match.group(1).strip()) if title_match else None
            
            # Find DC.description meta tag (the abstract)
            desc_match = re.search(r'<meta[^>]*name="DC\.description"[^>]*content="([^"]*)"', page_content, re.IGNORECASE)
            abstract = html.unescape(desc_match.group(1).strip()) if desc_match else None
            
            return title, abstract
    except Exception as e:
        logger.warning("[Scraper] Failed to fetch full details for %s: %s", patent_id, e)
        return None, None


async def scrape_google_patents(
    query: str,
    max_results: int = 20,
    progress_callback: Optional[Callable[[str], None]] = None,
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
                title = lines[0] if lines else "—"
                abstract = " ".join(lines[1:4]) if len(lines) > 1 else "—"

            results.append({
                "rank":     idx,
                "title":    title.strip() if title else "—",
                "abstract": abstract.strip() if abstract else "—",
                "patent_id": patent_id,
                "url":      url_href,
                "source":   "Google Patents",
            })

            _log(f"  [{idx:02d}] {patent_id} — {(title or '(no title)')[:60]}")

        await browser.close()

        # Enrich with full title and abstract in parallel
        if results:
            _log(f"🔗 Enriching {len(results)} search results with full titles & abstracts...")
            async def enrich_result(res):
                pid = res.get("patent_id")
                if pid:
                    t, a = await asyncio.to_thread(_fetch_google_patent_details, pid)
                    if t:
                        res["title"] = t
                    if a:
                        res["abstract"] = a
            await asyncio.gather(*(enrich_result(res) for res in results))

    return results


async def scrape_india_patents(
    query: str,
    max_results: int = 20,
    progress_callback: Optional[Callable[[str], None]] = None,
    india_options: Optional[dict] = None,
    captcha_callback: Optional[Callable[[str], Awaitable[str]]] = None,
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
        browser = await pw.chromium.launch(
            headless=True,
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
        search_succeeded = True
        if captcha_visible:
            if not captcha_callback:
                await browser.close()
                raise RuntimeError("Indian Patent Search requires CAPTCHA, but no CAPTCHA handler is configured.")
            search_succeeded = await _solve_india_captcha(page, captcha_callback, _log, dialog_messages)
        else:
            dialog_messages.clear()
            await page.click("input[type='submit'][value='Search']")
            
            search_succeeded = None
            for poll_attempt in range(150): # Up to 30 seconds
                await asyncio.sleep(0.2)
                if dialog_messages:
                    last_msg = dialog_messages[-1].lower()
                    if "no record" in last_msg or "record not found" in last_msg:
                        _log("ℹ️ Indian Patents Search returned: No Record Found.")
                        search_succeeded = False
                        break
                    else:
                        raise RuntimeError(f"Indian Patents portal error: {dialog_messages[-1]}")
                
                if await page.locator("text=Total Document(s):").count() > 0 or await page.locator("#tableData").count() > 0:
                    search_succeeded = True
                    break
                    
                current_url = page.url.lower()
                if "searchresult" in current_url or "patentdetails" in current_url:
                    search_succeeded = True
                    break
            
            if search_succeeded is None:
                search_succeeded = True # Fallback if no error and timeout elapsed

        if not search_succeeded:
            await browser.close()
            return []

        await page.wait_for_selector("text=Total Document(s):", timeout=45_000)

        ip_value = ""
        try:
            ip_value = await page.locator("input#IP").first.input_value(timeout=1000)
        except Exception:
            pass

        rows = await _extract_india_result_rows(page, max_results)
        _log(f"Found {len(rows)} Indian patent result rows for query: {query[:60]}")

        for idx, row in enumerate(rows, start=1):
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
    await page.fill("#FromDate", options["from_date"])
    await page.fill("#ToDate", options["to_date"])
    await page.select_option("#LogicField", options["logic_field"])

    rows = options["rows"] or [{"field": "TI", "text": "", "logic": "AND"}]
    for idx, row in enumerate(rows, start=1):
        if idx > 1:
            await page.click("#btnAddRow")
            await page.wait_for_selector(f"select[name='ItemField{idx}']", timeout=5_000)

        await page.select_option(f"select[name='ItemField{idx}']", row["field"])
        await page.fill(f"input[name='TextField{idx}']", row["text"] or query)
        await page.select_option(f"select[name='LogicField{idx}']", row["logic"])


async def _wait_for_captcha_loaded(page) -> None:
    """Force refresh the captcha image and wait for it to be fully loaded with a timestamp."""
    captcha_loc = page.locator("#Captcha")
    # Use "attached" (in DOM) not "visible" — after a POST the img element
    # exists in the DOM before it finishes rendering/loading, so "visible"
    # can time out even when the element is perfectly usable.
    await captcha_loc.wait_for(state="attached", timeout=15000)
    
    refresh_loc = page.locator("img[onclick='CaptchaLoad()']") 
    await refresh_loc.wait_for(state="attached", timeout=15000)
    
    # Hide any datepicker/calendar overlays that might block clicking the refresh button
    await page.evaluate("""
        document.querySelectorAll(".datepicker-dropdown, .datepicker, #ui-datepicker-div").forEach(el => el.style.display = "none");
    """)
    
    # Click refresh to load a fresh captcha with a unique timestamp (bypassing browser cache)
    await refresh_loc.click(force=True)
    
    # Wait for the image src to contain "?" and be fully loaded
    js_code = """
        async () => {
            const img = document.getElementById("Captcha");
            if (!img) return;
            
            // Wait for src to contain "?"
            let attempts = 0;
            while (!img.getAttribute("src").includes("?") && attempts < 100) {
                await new Promise(r => setTimeout(r, 50));
                attempts++;
            }
            
            // Wait for image loading to complete
            attempts = 0;
            while ((!img.complete || img.naturalWidth === 0) && attempts < 100) {
                await new Promise(r => setTimeout(r, 50));
                attempts++;
            }
        }
    """
    await page.evaluate(js_code)


async def _solve_india_captcha(
    page,
    captcha_callback: Callable[[str], Awaitable[str]],
    log_callback: Callable[[str], None],
    dialog_messages: list[str],
) -> bool:
    """
    Send CAPTCHA image to the app, wait for the answer, and submit.
    Returns True if search succeeded, False if no records found.
    """
    for attempt in range(1, 6):
        # 1. Force refresh and wait for captcha image to be fully loaded
        await _wait_for_captcha_loaded(page)
        
        # 2. Hide any datepicker/calendar overlays that might obscure the CAPTCHA image
        await page.evaluate("""
            document.querySelectorAll(".datepicker-dropdown, .datepicker, #ui-datepicker-div").forEach(el => el.style.display = "none");
        """)
        
        captcha = page.locator("#Captcha")
        image_bytes = await captcha.screenshot(type="png")
        image_data_url = "data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii")
        log_callback(f"Indian Patent Search CAPTCHA required (attempt {attempt}/5).")
        
        answer = (await captcha_callback(image_data_url)).strip()
        if not answer:
            raise RuntimeError("Indian Patent Search CAPTCHA was not provided.")

        await page.fill("#CaptchaText", answer)
        
        # Clear dialog messages list before clicking Search to capture new alerts
        dialog_messages.clear()
        
        await page.click("input[type='submit'][value='Search']")
        
        # Wait for the postback navigation to complete
        try:
            await page.wait_for_load_state("load", timeout=15_000)
        except Exception:
            pass
            
        # Wait slightly to ensure any dialog event handler has processed the alert
        await asyncio.sleep(1.0)
        
        # Check dialog messages (portal fires these for CAPTCHA errors and no-results)
        if dialog_messages:
            last_msg = dialog_messages[-1].lower()
            if "no record" in last_msg or "record not found" in last_msg:
                log_callback("ℹ️ Indian Patents Search returned: No Records Found.")
                return False
            elif "correct captcha" in last_msg or "invalid captcha" in last_msg or "enter captcha" in last_msg:
                log_callback("CAPTCHA was not accepted. Refreshing and asking again.")
                if attempt >= 5:
                    raise RuntimeError("Indian Patent Search CAPTCHA failed after 5 attempts.")
                continue
            else:
                raise RuntimeError(f"Indian Patents portal error: {dialog_messages[-1]}")
            
        # Check if the search results have loaded
        if await page.locator("text=Total Document(s):").count() > 0:
            return True
            
        # Check if we are still on the CAPTCHA page — portal silently reloads
        # with a new CAPTCHA when the answer was wrong (no dialog fired)
        if await page.locator("#Captcha").count() > 0:
            if attempt >= 5:
                raise RuntimeError("Indian Patent Search CAPTCHA failed after 5 attempts.")
            log_callback("CAPTCHA was not accepted. Refreshing and asking again.")
            continue
            
        # Fallback: give the results table a short extra window to appear
        try:
            await page.wait_for_selector("text=Total Document(s):", timeout=5_000)
            return True
        except PlaywrightTimeoutError:
            pass
        
        # Still nothing — CAPTCHA must have been wrong and page reloaded silently
        if attempt >= 5:
            raise RuntimeError("Indian Patent Search CAPTCHA failed after 5 attempts.")
        log_callback("CAPTCHA was not accepted. Refreshing and asking again.")


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
    print(f"[OK] CSV saved → {filepath}")


# ─────────────────────────────────────────────────────────────────────────────
#  PDF export  (CSV-style table rendered with fpdf2)
# ─────────────────────────────────────────────────────────────────────────────

def _safe(text: str) -> str:
    """Strip characters outside latin-1 range so fpdf core fonts don't choke."""
    return text.encode("latin-1", errors="replace").decode("latin-1")


def save_pdf(results: list[dict], filepath: Path, query: str) -> None:
    if not PDF_AVAILABLE:
        return

    from fpdf.enums import XPos, YPos

    pdf = FPDF(orientation="L", unit="mm", format="A4")  # Landscape for wider table
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # ── Header ──────────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_fill_color(30, 50, 100)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(
        0, 10, _safe("Google Patents - Prior Art Search Results"),
        new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C", fill=True
    )

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    meta = _safe(
        f'Query: "{query}"   |   '
        f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M")}   |   '
        f'Results: {len(results)}'
    )
    pdf.cell(0, 6, meta, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C")
    pdf.ln(4)

    # ── Column widths (landscape A4 usable ~267mm) ───────────────────────────
    col_widths = {
        "rank":      10,
        "patent_id": 30,
        "title":     80,
        "abstract":  147,   # fills remaining space
    }

    # ── Table header ────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(50, 80, 160)
    pdf.set_text_color(255, 255, 255)
    for col, width in col_widths.items():
        label = col.replace("_", " ").title()
        pdf.cell(width, 8, label, border=1, fill=True, align="C")
    pdf.ln()

    # ── Table rows ──────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "", 8)
    fill_colors = [(245, 247, 255), (255, 255, 255)]

    for i, row in enumerate(results):
        r, g, b = fill_colors[i % 2]
        pdf.set_fill_color(r, g, b)
        pdf.set_text_color(20, 20, 20)

        title_safe    = _safe(row["title"])
        abstract_safe = _safe(row["abstract"])
        pid_safe      = _safe(row["patent_id"])

        # Calculate required row height based on wrapped text
        title_lines    = _count_lines(title_safe,    col_widths["title"],    8)
        abstract_lines = _count_lines(abstract_safe, col_widths["abstract"], 8)
        row_h = max(title_lines, abstract_lines, 1) * 4 + 2

        x_start = pdf.get_x()
        y_start = pdf.get_y()

        # Rank
        pdf.multi_cell(col_widths["rank"], row_h, str(row["rank"]),
                       border=1, align="C", fill=True,
                       new_x=XPos.RIGHT, new_y=YPos.TOP, max_line_height=4)
        pdf.set_xy(x_start + col_widths["rank"], y_start)

        # Patent ID
        pdf.multi_cell(col_widths["patent_id"], row_h, pid_safe,
                       border=1, align="C", fill=True,
                       new_x=XPos.RIGHT, new_y=YPos.TOP, max_line_height=4)
        pdf.set_xy(x_start + col_widths["rank"] + col_widths["patent_id"], y_start)

        # Title
        pdf.multi_cell(col_widths["title"], row_h, title_safe,
                       border=1, fill=True,
                       new_x=XPos.RIGHT, new_y=YPos.TOP, max_line_height=4)
        pdf.set_xy(
            x_start + col_widths["rank"] + col_widths["patent_id"] + col_widths["title"],
            y_start
        )

        # Abstract
        pdf.multi_cell(col_widths["abstract"], row_h, abstract_safe,
                       border=1, fill=True,
                       new_x=XPos.RIGHT, new_y=YPos.TOP, max_line_height=4)

        pdf.ln(row_h)

    pdf.output(str(filepath))
    print(f"[OK] PDF saved -> {filepath}")


def _count_lines(text: str, col_width_mm: float, font_size: int) -> int:
    """Rough estimate of how many lines the text will occupy."""
    chars_per_line = max(1, int(col_width_mm / (font_size * 0.38)))
    wrapped = textwrap.wrap(text, width=chars_per_line) or [""]
    return len(wrapped)


# ─────────────────────────────────────────────────────────────────────────────
#  CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Scrape Google Patents and save top-N results to CSV + PDF"
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
    pdf_path = out_dir / f"{args.out}.pdf"

    print(f"\n{'='*60}")
    print(f"  Google Patents Prior Art Scraper")
    print(f"{'='*60}")
    print(f"  Query   : {args.query}")
    print(f"  Max     : {args.max} results")
    print(f"  Output  : {csv_path.name} + {pdf_path.name}")
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
    save_pdf(results, pdf_path, args.query)

    print(f"\n✓ Done! Files written to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
