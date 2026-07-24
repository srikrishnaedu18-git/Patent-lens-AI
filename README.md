# PatentLens Studio

PatentLens Studio is a FastAPI web app for collecting prior-art patents, saving them into user-scoped projects, and running AI-assisted relevance audits. It supports Google Patents, Indian Patents, and Espacenet (EPO OPS API), live multi-platform sequential scraping over Server-Sent Events, CAPTCHA handling for IP India, CSV exports, and persistent project history.

## Current Feature Set

- **Multi-Platform Scraping**:
  - Google Patents (keyword search & Playwright rendering).
  - Indian Patents (Advanced Search query rows & field mapping for `CSP` Complete Specification).
  - Espacenet (EPO Open Patent Services / OPS API driver with bibliographic enrichment).
  - **🌐 All Platforms** mode: Runs automated sequential scraping across Google Patents, Indian Patents, and Espacenet with live SSE log streaming and stage progress tracking.
- **Invention Description Modal**:
  - Dedicated modal for storing detailed invention descriptions in `localStorage` for AI audit reference.
  - Live status indicator badge on the search bar trigger ("Saved" vs "Add Description").
- **Scraped History Search & Multi-Facet Filter Bar**:
  - Collapsible real-time search bar (`#btn-toggle-search`) filtering patents by ID, title, abstract, search terms, audit reasoning, and deep scrape text with highlight marks and live match count.
  - Multi-facet filter modal (`#modal-filter`) supporting 4 filter categories: Relevancy Category, AI Audit Status, Deep Scrape Status, and Source Platform.
- **Redesigned Delete Confirmation**:
  - Visual itemized list in `#modal-delete-confirm` with color-coded classification badges for "Search Run" vs "Patent".
- **Multi-user Authentication**:
  - User registration, login, logout, and session persistence.
- **Google Patents Abstract Extraction**:
  - Full-abstract enrichment from `<section itemprop="abstract">`, `DC.description`, nested `<abstract>`, and granted B publication fallback to A publications.
- **IP India CAPTCHA Handling**:
  - Automatic 2Captcha mode and manual entry mode. CAPTCHA attempts capped at 2 per page/session, with automatic full manual pipeline restarts on repeated failures.
- **AI Audit & Deep Scrape**:
  - On-demand AI relevance auditing with Gemini (Red, Yellow, Green, and Unaudited states).
  - Toolbar Deep Scrape for checked patents, extracting detailed body text through claims while excluding citation tables.
  - Color-coded badges for audit and deep scrape completion state.
- **CSV Export**:
  - Spreadsheet-safe CSV export with chunked columns (`deep_scrape_text_part_1`, `part_2`, etc.) to prevent LibreOffice/Excel cell character overflow.

## Repository Layout

```text
.
├── ai/
│   └── ai_agent.py                 # Gemini query generation and relevance auditing
├── assets/                         # Local CAPTCHA/reference images
├── backend/
│   ├── server.py                   # FastAPI routes, SSE tasks, auth, exports, static UI hosting
│   ├── scraper.py                  # Google Patents, Indian Patents, and Espacenet scraping
│   └── migrate_sqlite_to_postgres.py
├── db/
│   └── db.py                       # SQLite/PostgreSQL schema, migrations, DB helpers
├── frontend/
│   ├── index.html                  # Single-page UI with modals and toolbars
│   ├── app.js                      # UI state, multi-platform sequential scrape, SSE handling
│   └── style.css                   # Glassmorphic application styling
├── tests/
│   └── test_db_config.py
├── architecture.md                 # System wiring and data flow notes
├── task.md                         # Task checklist and completion status
├── requirements.txt
├── Dockerfile
├── render.yaml
└── .env.example
```

## Requirements

- Python 3.11 or newer.
- Playwright Chromium.
- Internet access for patent scraping, Gemini, and EPO OPS / 2Captcha.
- `GEMINI_API_KEY` for AI features.
- Optional `EPO_OPS_CONSUMER_KEY` & `EPO_OPS_CONSUMER_SECRET` for Espacenet rate-limit relaxation.
- Optional `TWO_CAPTCHA_API_KEY` for automatic IP India CAPTCHA solving.

## Local Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
```

Copy the environment template:

```bash
cp .env.example .env
```

Set environment variables:

```env
GEMINI_API_KEY=your_gemini_api_key_here
INDIA_PATENT_HEADLESS=true
```

## Run Locally

```bash
source venv/bin/activate
python backend/server.py
```

Open in browser:

```text
http://127.0.0.1:8000/
```

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes for AI | Primary Gemini key for query generation and auditing. |
| `EPO_OPS_CONSUMER_KEY` | Optional | Consumer key for EPO Espacenet OPS API. |
| `EPO_OPS_CONSUMER_SECRET` | Optional | Consumer secret for EPO Espacenet OPS API. |
| `TWO_CAPTCHA_API_KEY` | Optional | Enables paid automatic CAPTCHA solving for IP India. |
| `INDIA_PATENT_HEADLESS` | Optional | `true` for headless IP India browser. |
| `DATABASE_URL` | Optional | PostgreSQL connection string. If absent, SQLite is used. |
| `HOST` | Optional | Bind host for FastAPI (default `127.0.0.1`). |
| `PORT` | Optional | Bind port for FastAPI (default `8000`). |

## Multi-Platform Sequential Scraping ("All Platforms")

When selecting **🌐 All Platforms** in the search bar:
1. PatentLens launches a sequential pipeline that queries **Google Patents**, **Indian Patents**, and **Espacenet** in order.
2. The Live Pipeline Log displays step-by-step progress for each source.
3. The stage progress pills (`Planning → Scraping → Saving → Complete`) reset dynamically at the start of each platform segment.
4. Results are saved as distinct search runs grouped by source badge in Scraped History.

## Deep Scrape & CSV Export

Deep scrape pulls detail-page text (including descriptions and claims). To keep CSV exports compatible with spreadsheet tools:
- `deep_scrape_text` is split into safe columns: `deep_scrape_text_part_1`, `deep_scrape_text_part_2`, etc.
- The chunk limit is governed by `CSV_CELL_SAFE_LIMIT` (30,000 chars) in `backend/server.py`.

## Verification Commands

```bash
python3 -m py_compile backend/server.py backend/scraper.py ai/ai_agent.py db/db.py
node -c frontend/app.js
```
