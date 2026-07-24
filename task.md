# PatentLens Studio Task Ledger

Status key:

- `[x]` Completed
- `[ ]` Pending
- `[~]` Partially complete or needs follow-up

## Completed

- [x] Multi-Platform Sequential Scraping ("All Platforms" Mode).
  - Added `🌐 All Platforms` mode option to run sequential search across Google Patents, Indian Patents, and Espacenet.
  - Formatted payloads cleanly: Google (keyword search), Indian Patents (`CSP` Complete Specification field), Espacenet (`TA` Title or Abstract field).
  - Ensured progress stage pills (`Planning → Scraping → Saving → Complete`) reset cleanly at the start of each platform step in the sequence.
  - Fixed `startSSEStream` stream disconnect logic and prevented `setPipelineLoading(false)` from hiding the `#live-feed` log console, keeping the live streaming log active and readable throughout all steps.
  - Fixed `ReferenceError: renderProject is not defined` by substituting `loadProjectHistory(projectId)`.

- [x] Dedicated Invention Description Modal.
  - Relocated the "Invention Description" `textarea` out of the manual scrape form into a dedicated popup modal (`#modal-invention`).
  - Added a "Describe Invention" button with status badge indicator in the mode toggle bar.
  - Saved description to `localStorage` (`patentlens_invention_description`) for persistence across sessions and AI audit context reuse.

- [x] Redesigned Delete Confirmation Modal.
  - Overhauled `#modal-delete-confirm` to display itemized row cards with visual classification badges for "Search Run" vs "Patent".
  - Increased scrollable container list height and improved text contrast for bulk item deletion.

- [x] Multi-Facet Filter Modal & Collapsible Search Bar.
  - Transformed relevancy filter into a 4-category multi-facet filter modal: Relevancy Category, AI Audit Status, Deep Scrape Status, and Source Platform.
  - Added collapsible real-time search bar (`#btn-toggle-search`) filtering patents by ID, title, abstract, query, audit rationale, and deep scrape text.
  - Added search term highlighting (`<mark class="term-highlight">`) and live match count badges.

- [x] Fix manual Indian Patents scrape crash: `rows is not defined`.
  - Moved Indian query rows into function-level `indiaRows`.
  - Updated manual scrape logging and payload construction to use the same scoped rows.
  - Verified with `node --check frontend/app.js`.

- [x] Change CAPTCHA attempts from 5 to 2.
  - Added `INDIA_CAPTCHA_MAX_ATTEMPTS = 2` in `backend/scraper.py`.
  - Added `MAX_CAPTCHA_ATTEMPTS = 2` in `backend/server.py`.
  - Updated visible logs to show `attempt 1/2` and `attempt 2/2`.

- [x] Restart the manual pipeline after repeated CAPTCHA failure.
  - Added `MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS = 3`.
  - CAPTCHA failure after 2 attempts triggers a full manual pipeline restart.
  - Added `reset_pipeline` SSE flag.
  - Frontend resets pipeline pills when `reset_pipeline` is received.

- [x] Fix scraped patents not saving after successful scrape.
  - Restored missing `return all_results` in `scrape_patents`.
  - This fixes the case where logs show found patents but the server saves zero rows.
  - Verified Python syntax with `python3 -m py_compile backend/server.py backend/scraper.py`.

- [x] Permanently improve Google Patents full abstract extraction.
  - Detail-page parser now reads `<section itemprop="abstract">`.
  - Keeps `DC.description`, nested `<abstract>`, and summary extraction as fallbacks.
  - Granted B publications now try A publication candidates such as `A1` and `A2`.
  - Google "Other versions" links are followed as additional fallback detail pages.

- [x] Add selected-patent Deep scrape action.
  - Added Deep scrape button after AI Audit in the Scraped History toolbar.
  - Replaced per-card source badge with per-patent Deep scrape button.
  - Added `POST /api/deep-scrape`.
  - Deep scrape stores detail-page text through claims while excluding citation/footer tables.

- [x] Color-code deep scrape and AI audit states.
  - Amber `Deep scrape` / `Unaudited` for pending items.
  - Green `Deep scraped` / Red-Yellow-Green for completed audits.

- [x] Fix LibreOffice CSV cell-limit warning for deep scrape exports.
  - Split long detail text into safe columns (`deep_scrape_text_part_1`, `deep_scrape_text_part_2`, etc.).

## Verification Used

- [x] `python3 -m py_compile backend/server.py backend/scraper.py ai/ai_agent.py db/db.py`
- [x] `node -c frontend/app.js`
- [x] Direct scratch test verification for Espacenet and Indian Patents scraper drivers.
- [x] Live end-to-end multi-platform sequential scrape verification.

## Current Known Behavior

- Old patent rows saved before scraper fixes keep their original stored abstracts until re-scraped or deep scraped.
- In-memory SSE task queues are tied to the active server instance.
- CAPTCHA restart logic is capped to 3 full attempts to avoid infinite retries.
- Deep scrape CSV export creates multiple `deep_scrape_text_part_*` columns for long patents so spreadsheet applications open the file safely.
