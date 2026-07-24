# PatentLens Studio Architecture

This document explains how the repo is wired today. It is meant for future maintainers who need to change scraping, saving, auditing, or the live pipeline UI without rediscovering the whole flow.

## High-Level Shape

```text
Browser UI
  frontend/index.html
  frontend/app.js
  frontend/style.css
        |
        | HTTP JSON + Server-Sent Events
        v
FastAPI backend
  backend/server.py
        |
        +-- Scraping
        |     backend/scraper.py (Google, Indian, Espacenet/EPO OPS)
        |
        +-- AI
        |     ai/ai_agent.py (Gemini API)
        |
        +-- Persistence
              db/db.py (SQLite locally or PostgreSQL)
```

The app is a single-page frontend served by FastAPI. Long-running scrape and audit tasks are executed in background threads, and live updates are streamed back to the browser via SSE (`/api/ai/stream/{task_id}`).

## Frontend Wiring

`frontend/app.js` manages application state:

- Active user session and current project ID.
- Selected search mode: Manual Keywords vs AI Auto-Generate.
- Selected search platform: Google Patents, Indian Patents, Espacenet, or **All Platforms** (Multi-Platform Sequential Mode).
- Invention description state (persisted in `localStorage` as `patentlens_invention_description`).
- Active SSE stream task ID and event source instance.
- Real-time collapsible search bar filter query and multi-facet modal filter state.

### Key Frontend UI Components:

1. **Multi-Platform Sequential Scraper**:
   - `handleManualScrapeSubmit` detects `activeSource === "all"`.
   - Executes a loop over `["google", "india", "espacenet"]`.
   - Sends a dedicated `POST /api/scrape` for each platform segment.
   - Listens to the SSE stream via `startSSEStream`, invoking `initStagePillsForFlow("manual_scrape")` at each step to reset stage progress pills cleanly.
2. **Invention Description Modal (`#modal-invention`)**:
   - Triggered by "Describe Invention" in the search mode toggle bar.
   - Persists text to `localStorage` and updates button badge status.
3. **Multi-Facet Relevancy & Metadata Filter (`#modal-filter`)**:
   - Offers 4 filter categories: Relevancy Category, AI Audit Status, Deep Scrape Status, and Source Platform.
4. **Collapsible Real-Time Search Bar**:
   - Filters history cards live across patent ID, title, abstract, search terms, audit reasoning, and deep scrape text.
5. **Redesigned Delete Confirmation (`#modal-delete-confirm`)**:
   - Renders individual cards with color-coded badges for "Search Run" vs "Patent".

## Scraper Drivers (`backend/scraper.py`)

1. **Google Patents**:
   - Playwright Chromium driver navigates search result pages.
   - Enriched via `_fetch_google_patent_details_jsonld` reading `<section itemprop="abstract">`, `DC.description`, and falling back from B to A publications.
2. **Indian Patents**:
   - Playwright Chromium driver targeting `https://iprsearch.ipindia.gov.in/PublicSearch/`.
   - Applies search rows for `CSP` (Complete Specification), `TI` (Title), `ABS` (Abstract), etc.
   - Handles CAPTCHA challenges with up to 2 attempts per session and full pipeline restarts.
3. **Espacenet (EPO OPS API)**:
   - Asynchronous HTTP driver (`httpx`) using EPO Open Patent Services (OPS) REST API (`https://ops.epo.org`).
   - Obtains OAuth 2.0 access tokens using `EPO_OPS_CONSUMER_KEY` and `EPO_OPS_CONSUMER_SECRET`.
   - Executes CQL queries (`TA` Title/Abstract, `TXT` Text) and enriches results via the EPO biblio endpoint.

## SSE Pipeline & Backend Orchestration

Task queues in `backend/server.py`:
- `_task_queues`: Map of `task_id` to `asyncio.Queue` emitting SSE JSON events.
- `_captcha_futures` & `_captcha_attempts`: State trackers for Indian Patent CAPTCHA solving.
- `_task_cancelled`: Cancellation flags for user-terminated scrape tasks.

Stream events follow the canonical format:
```json
{
  "stage": "scraping",
  "message": "Searching keyword 1/1: solar...",
  "reset_pipeline": false
}
```

UI display stage progression: `Planning → Scraping → Saving → Complete`.

## Persistence & Exports

- Database abstraction in `db/db.py` supports SQLite (default) and PostgreSQL (`DATABASE_URL`).
- Cascading deletion for user project data.
- CSV export (`POST /api/projects/{project_id}/export/csv`) splits long deep scrape body text into spreadsheet-safe columns (`deep_scrape_text_part_1`, `part_2`, etc.) governed by `CSV_CELL_SAFE_LIMIT`.
