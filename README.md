# PatentLens Studio

PatentLens Studio is a FastAPI web app for collecting prior-art patents, saving them into user-scoped projects, and running AI-assisted relevance audits. It supports Google Patents and Indian Patents, live scrape progress over Server-Sent Events, CAPTCHA handling for IP India, CSV exports, and persistent project history.

## Current Feature Set

- Multi-user authentication with session cookies.
- Project-based search history with user isolation.
- Manual keyword scraping for Google Patents and Indian Patents.
- Google Patents full-abstract enrichment from patent detail pages.
- Google granted-patent fallback from B publications to A publications when Google omits the abstract on the granted page.
- Indian Patents advanced query rows with field, text, and boolean logic.
- IP India CAPTCHA support in automatic 2Captcha mode and manual entry mode.
- IP India CAPTCHA attempts capped at 2 per page/session.
- Manual pipeline restart when CAPTCHA repeatedly fails, with live pipeline state reset.
- AI query generation with Gemini.
- On-demand AI relevance audit with Red, Yellow, Green, and Unaudited states.
- Toolbar AI Audit for checked patents in Scraped History.
- Toolbar Deep scrape for checked patents, saving detail-page body text through claims while excluding citation tables.
- Patent cards and detail popups show color-coded states for AI audit and deep scrape completion.
- Large patent detail popup with patent ID link, title, keyword context, abstract, AI audit details, and saved deep scrape text.
- Live pipeline log for Planning, Scraping, Auditing, Saving, and Done.
- Scrape cancellation through the Stop button.
- CSV export with relevancy labels, audit fields, and spreadsheet-safe deep scrape text chunks.
- SQLite locally, PostgreSQL when `DATABASE_URL` is configured.

## Repository Layout

```text
.
├── ai/
│   └── ai_agent.py                 # Gemini query generation and relevance auditing
├── assets/                         # Local CAPTCHA/reference images
├── backend/
│   ├── server.py                   # FastAPI routes, SSE tasks, auth, exports, static UI hosting
│   ├── scraper.py                  # Google Patents and Indian Patents scraping
│   └── migrate_sqlite_to_postgres.py
├── db/
│   └── db.py                       # SQLite/PostgreSQL schema, migrations, DB helpers
├── frontend/
│   ├── index.html                  # Single-page UI
│   ├── app.js                      # UI state, API calls, SSE handling
│   └── style.css                   # Application styling
├── tests/
│   └── test_db_config.py
├── architecture.md                 # System wiring and data flow notes
├── task.md                         # Task checklist and completion status
├── requirements.txt
├── Dockerfile
├── render.yaml
├── run_server.bat
└── .env.example
```

## Requirements

- Python 3.11 or newer.
- Playwright Chromium.
- Internet access for patent scraping, Gemini, and optional 2Captcha.
- `GEMINI_API_KEY` for AI features.
- Optional `TWO_CAPTCHA_API_KEY` for automatic IP India CAPTCHA solving.

## Local Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
```

On Linux, install Playwright system dependencies if needed:

```bash
python -m playwright install-deps chromium
```

Copy the environment template:

```bash
cp .env.example .env
```

Set at least:

```env
GEMINI_API_KEY=your_gemini_api_key_here
INDIA_PATENT_HEADLESS=true
```

For automatic CAPTCHA solving:

```env
TWO_CAPTCHA_API_KEY=your_2captcha_api_key_here
```

## Run Locally

```bash
source venv/bin/activate
python backend/server.py
```

Open:

```text
http://127.0.0.1:8000/
```

The server reads:

- `HOST`, default `127.0.0.1`
- `PORT`, default `8000`
- `ENV`, default `development`

When `ENV=development`, uvicorn reload is enabled. For a single stable process:

```bash
ENV=production venv/bin/python backend/server.py
```

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes for AI | Primary Gemini key for query generation and auditing. |
| `GEMINI_API_KEY1`, `GEMINI_API_KEY2`, ... | Optional | Additional keys used by CAPTCHA auto-solve fallback logic. |
| `TWO_CAPTCHA_API_KEY` | Optional | Enables paid automatic CAPTCHA solving. |
| `INDIA_PATENT_HEADLESS` | Optional | `true` for headless IP India browser, `false` for debugging. |
| `DATABASE_URL` | Optional | PostgreSQL connection string. If absent, SQLite is used. |
| `DB_PATH` | Optional | SQLite database path. Defaults to `db/patent_lens.db`. |
| `HOST` | Optional | Bind host for FastAPI. |
| `PORT` | Optional | Bind port for FastAPI. |
| `ENV` | Optional | `development` enables reload; `production` disables reload. |

## How To Use

1. Register or log in.
2. Create or select a project.
3. Choose Google Patents or Indian Patents.
4. Run a manual scrape or generate AI queries.
5. Watch progress in the Live Pipeline Log.
6. Review saved patents in Scraped History.
7. Select patents in Scraped History and run AI Audit or Deep scrape from the toolbar.
8. Export selected or project-wide results as CSV.

## Google Patents Abstract Handling

Google search results often show snippets, not complete abstracts. PatentLens does not rely on that snippet as the final stored abstract.

For each Google result, `backend/scraper.py`:

1. Scrapes the result card for the patent ID, title, URL, and fallback snippet.
2. Fetches the patent detail page.
3. Extracts the full `<section itemprop="abstract">` content when available.
4. Falls back to `DC.description`, nested `<abstract>`, or summary sections.
5. If a granted publication such as `EP3563596B1` has no abstract on its B page, tries A-publication candidates such as `EP3563596A1` and `EP3563596A2`.
6. Follows Google "Other versions" detail links as an additional fallback.

This is intentional: saved Google records should contain complete abstracts when Google exposes them on any related detail page.

## Indian Patents CAPTCHA Handling

IP India's public search requires CAPTCHA. PatentLens supports:

- Auto mode through 2Captcha.
- Manual mode through an in-app CAPTCHA modal.
- Two CAPTCHA attempts per page/session.
- Full manual pipeline restart when CAPTCHA keeps failing.
- A maximum of three full pipeline restarts to avoid infinite loops.

The frontend listens for SSE events and resets the pipeline pills when the backend sends `reset_pipeline`.

## Deep Scrape Handling

Deep scrape is for opening saved patent URLs and pulling the larger detail-page body, including description and claims content, while excluding citation/footer tables.

How it works:

1. Select patents in Scraped History.
2. Click `Deep scrape` in the toolbar, or use a patent card's own Deep scrape button.
3. The backend fetches each patent URL and stores the extracted text in `patents.deep_scrape_text`.
4. `patents.deep_scraped_at` records when the detail content was last refreshed.
5. Clicking a patent card opens the detail popup, where the saved deep scrape text is shown below the normal abstract.

Deep scrape state is color-coded:

- Amber `Deep scrape` means the patent has not been deep scraped yet.
- Green `Deep scraped` means detail text has been saved and can be refreshed.

AI audit state is also color-coded:

- Amber `Unaudited` means AI audit has not been run.
- Red, Yellow, and Green show audited relevance levels.

## API Overview

Authentication:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Projects and history:

- `GET /api/projects`
- `POST /api/projects`
- `DELETE /api/projects/{project_id}`
- `GET /api/projects/{project_id}/data`
- `POST /api/history/delete`

Scraping and CAPTCHA:

- `POST /api/scrape`
- `POST /api/scrape/cancel/{task_id}`
- `POST /api/captcha/{task_id}`
- `POST /api/deep-scrape`
- `GET /api/ai/stream/{task_id}`

AI:

- `POST /api/ai/generate-queries`
- `POST /api/ai/confirm-search`
- `POST /api/ai/audit/{search_id}`
- `POST /api/ai/audit-selected`

Export:

- `POST /api/projects/{project_id}/export/csv`

## CSV Export Behavior

Spreadsheet apps such as LibreOffice and Excel have a maximum character limit per cell. Deep-scraped patent bodies can exceed that limit, especially when claims are included.

To keep exports loadable without losing content, PatentLens splits deep scrape text into safe columns:

```text
deep_scrape_text_part_1
deep_scrape_text_part_2
deep_scrape_text_part_3
...
```

Most patents only need `deep_scrape_text_part_1`. Longer patents continue into additional numbered columns in the same CSV row.

Settings:

- `GET /api/settings/defaults`

## Persistence

The database layer lives in `db/db.py`.

- SQLite is used when `DATABASE_URL` is absent.
- PostgreSQL is used when `DATABASE_URL` is present.
- Searches are stored in `searches`.
- Patent rows are stored in `patents`.
- Deleting a project deletes its searches and patents through cascading relationships.
- User ownership is checked before protected project, search, patent, export, and delete operations.

## Deployment

The repository includes `Dockerfile` and `render.yaml` for Render deployment.

Recommended Render environment:

```env
ENV=production
HOST=0.0.0.0
PORT=10000
GEMINI_API_KEY=your_key
TWO_CAPTCHA_API_KEY=your_key_if_using_auto_captcha
INDIA_PATENT_HEADLESS=true
DATABASE_URL=provided_by_render_postgres
```

## Verification Commands

```bash
python3 -m py_compile backend/server.py backend/scraper.py ai/ai_agent.py db/db.py
node --check frontend/app.js
pytest
```

## Troubleshooting

| Problem | Likely Fix |
| --- | --- |
| `Address already in use` | Stop the existing process on `8000` or run with another `PORT`. |
| `ModuleNotFoundError: dotenv` | Activate `venv` or install `requirements.txt`. |
| Playwright browser launch fails | Run `python -m playwright install chromium` and, on Linux, `python -m playwright install-deps chromium`. |
| Gemini features fail | Confirm `GEMINI_API_KEY` is present in `.env`. |
| 2Captcha never solves | Confirm `TWO_CAPTCHA_API_KEY`, account balance, and network access. |
| Indian Patents repeatedly fails CAPTCHA | Try manual CAPTCHA mode or rerun later; the pipeline will restart automatically up to its configured limit. |
| Google abstract looks like a claim snippet | Rerun the scrape after the full-abstract extractor fix; old saved records keep their old stored text. |
| LibreOffice says maximum characters per cell exceeded | Re-export with the current backend. Deep scrape text is now split into `deep_scrape_text_part_*` columns. |

## Related Docs

- [architecture.md](architecture.md) explains how frontend, backend, scraper, DB, AI, and SSE are wired.
- [task.md](task.md) tracks the completed feature/fix checklist.
