# PatentLens Studio Task Ledger

Status key:

- `[x]` Completed
- `[ ]` Pending
- `[~]` Partially complete or needs follow-up

## Completed

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
  - This fixes patents like `EP3563596B1`, where the B page omits the abstract and the search card only shows a claim/snippet.

- [x] Confirm frontend does not intentionally truncate abstracts.
  - `renderHistory` renders `p.abstract`.
  - CSS for `.patent-abstract` uses normal wrapping, not a line clamp.

- [x] Add regression tests for locked fixes.
  - `tests/test_scraper_regressions.py` covers `scrape_patents` returning accumulated results.
  - It also covers granted Google B publication fallback to an A publication full abstract.

- [x] Remove PDF export completely.
  - Removed the PDF button from Scraped History toolbar.
  - Removed the web PDF export endpoint.
  - Removed the old CLI PDF writer and `fpdf2` dependency.
  - Updated docs to describe CSV-only export.

- [x] Move AI Audit to the Scraped History toolbar.
  - Added global AI Audit button after the relevancy filter.
  - Removed per-keyword/search-card AI Audit buttons.
  - Removed the live-log AI Audit shortcut.
  - Selected checked patents are audited through `POST /api/ai/audit-selected`.
  - Audit results still update saved patent rows, recolor cards, and export as CSV relevancy labels.

- [x] Add selected-patent Deep scrape action.
  - Added Deep scrape button after AI Audit in the Scraped History toolbar.
  - Replaced the per-card source badge with a per-patent Deep scrape button.
  - Added `POST /api/deep-scrape`.
  - Added live log progress for deep scrape tasks.
  - Added `deep_scrape_text` and `deep_scraped_at` patent columns.
  - Deep scrape stores detail-page text through claims while excluding citation/footer tables.
  - Patent card click opens a large modal with ID, title, abstract, AI audit info, and deep scraped details.

- [x] Improve patent detail popup styling and link affordance.
  - Added body padding inside the large patent detail modal.
  - Added an external-link icon to the patent ID badge.
  - Styled the modal patent ID badge with stronger spacing and border treatment.
  - Verified with `node --check frontend/app.js`.

- [x] Color-code deep scrape state.
  - Amber `Deep scrape` means no deep scrape text has been saved yet.
  - Green `Deep scraped` means detail text exists for that patent.
  - Applied the same state styling in patent cards and the detail popup.
  - Verified with `node --check frontend/app.js`.

- [x] Color-code AI audit pending state.
  - Amber `Unaudited` now clearly means AI audit is pending.
  - Red, Yellow, and Green remain the completed AI audit result categories.
  - Added subtle amber card highlighting for unaudited patents.
  - Verified with `node --check frontend/app.js`.

- [x] Fix LibreOffice CSV cell-limit warning for deep scrape exports.
  - Deep scrape text is no longer exported as one oversized cell.
  - Added `CSV_CELL_SAFE_LIMIT = 30000` in `backend/server.py`.
  - CSV exports now split long detail text into `deep_scrape_text_part_1`, `deep_scrape_text_part_2`, and further numbered columns as needed.
  - Verified server syntax with `python3 -m py_compile backend/server.py`.
  - Verified chunk behavior with the project virtualenv.

- [x] Restart backend after fixes.
  - Restarted with `venv/bin/python backend/server.py`.
  - Confirmed the server is listening on `127.0.0.1:8000`.
  - Confirmed `GET /api/auth/me` responds.

- [x] Update project documentation.
  - Rewrote `README.md` for current repo structure and behavior.
  - Added `architecture.md`.
  - Added this `task.md`.
  - Updated docs again for deep scrape modal behavior, visual status colors, and CSV chunked export.

## Verification Used

- [x] `python3 -m py_compile backend/server.py backend/scraper.py`
- [x] `python3 -m py_compile backend/server.py`
- [x] `node --check frontend/app.js`
- [x] `curl -sS -I http://127.0.0.1:8000/`
- [x] `curl -sS http://127.0.0.1:8000/api/auth/me`
- [x] Direct virtualenv check for CSV deep scrape chunk sizing.
- [x] Direct mocked regression check for `scrape_patents` return behavior.
- [x] Direct mocked regression check for Google B-to-A abstract fallback.
- [~] `venv/bin/python -m pytest`
  - Could not run before adding `pytest` because the existing virtualenv did not have pytest installed.

## Pending / Recommended

- [ ] Run `pip install -r requirements.txt` and then `venv/bin/python -m pytest`.
- [ ] Add a DB backfill command to refresh old saved snippet abstracts from Google detail pages.
- [ ] Add a small integration test for manual pipeline CAPTCHA restart events.
- [ ] Add a user-facing "Refresh abstract" action for an individual patent.
- [ ] Add structured logging around detail-page enrichment success/fallback source.

## Current Known Behavior

- Old patent rows already saved with snippet abstracts are not automatically updated.
- Rerunning a scrape stores the improved abstract for newly saved rows.
- In-memory SSE task queues are lost if the backend restarts.
- CAPTCHA restart logic is intentionally capped to avoid endless retries.
- Deep scrape CSV export may create multiple `deep_scrape_text_part_*` columns for very long patents so spreadsheet apps can load the file safely.
