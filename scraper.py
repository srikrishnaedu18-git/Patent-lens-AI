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
import sys
import textwrap
import time
from pathlib import Path
from datetime import datetime
from typing import Callable, Optional

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

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

async def scrape_patents(
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
                title = lines[0] if lines else "-"
                abstract = " ".join(lines[1:4]) if len(lines) > 1 else "-"

            results.append({
                "rank":     idx,
                "title":    title.strip() if title else "-",
                "abstract": abstract.strip() if abstract else "-",
                "patent_id": patent_id,
                "url":      url_href,
            })

            _log(f"  [{idx:02d}] {patent_id} - {(title or '(no title)')[:60]}")

        await browser.close()

    return results


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
    results = asyncio.run(scrape_patents(args.query, args.max))
    elapsed = time.time() - start

    if not results:
        print("[ERROR] No results were extracted. Exiting.")
        sys.exit(1)

    print(f"\n[INFO] Extracted {len(results)} patents in {elapsed:.1f}s\n")

    save_csv(results, csv_path)
    save_pdf(results, pdf_path, args.query)

    print(f"\n[OK] Done! Files written to: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
