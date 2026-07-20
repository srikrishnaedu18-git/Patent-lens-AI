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
        |     backend/scraper.py
        |
        +-- AI
        |     ai/ai_agent.py
        |
        +-- Persistence
              db/db.py
              SQLite locally or PostgreSQL in deployment
```

The app is a single-page frontend served by FastAPI. The browser calls API routes in `backend/server.py`. Long-running scrape and audit work is launched as background tasks, and progress is streamed back to the browser through SSE.

## Frontend Wiring

`frontend/app.js` owns the browser state:

- Current user session.
- Active project.
- Selected source: Google Patents or Indian Patents.
- Indian search row options.
- CAPTCHA mode.
- Active SSE task ID.
- Last scraped search ID for AI audit.

Important frontend flows:

- Manual scrape submit builds the request body and calls `POST /api/scrape`.
- AI query generation calls `POST /api/ai/generate-queries`.
- Confirmed AI search calls `POST /api/ai/confirm-search`.
- Live updates connect to `GET /api/ai/stream/{task_id}`.
- CAPTCHA challenge images are shown when SSE emits `stage: "captcha"`.
- Pipeline pill state is updated in `handleSSEStageUpdate`.
- When an SSE event includes `reset_pipeline`, the frontend reinitializes the visible pipeline pills.

The Scraped History UI renders whatever is stored in the DB. It does not intentionally truncate abstracts in JavaScript.

## Backend API Layer

`backend/server.py` provides:

- Session auth.
- Project CRUD.
- Manual scrape orchestration.
- AI query generation and confirmed AI scrape.
- CAPTCHA request/answer handling.
- SSE stream generation.
- AI audit orchestration.
- Selected-patent AI audit orchestration.
- Selected-patent deep scrape orchestration.
- CSV exports.
- History deletion.
- Static frontend hosting.

Long-running operations do not block the initial HTTP request. They create a task ID, push events into an in-memory asyncio queue, and return `{"status": "processing", "task_id": ...}` to the browser.

## SSE Pipeline

Task queues live in `backend/server.py`:

- `_task_queues`
- `_captcha_futures`
- `_captcha_attempts`
- `_task_cancelled`

The frontend uses one stream endpoint:

```text
GET /api/ai/stream/{task_id}
```

Events normally include:

```json
{
  "stage": "scraping",
  "message": "..."
}
```

Supported UI stages:

- `planning`
- `scraping`
- `captcha`
- `auditing`
- `saving`
- `complete`
- `error`

Manual pipeline display stages are:

```text
Planning -> Scraping -> Saving -> Done
```

AI audit display stages are:

```text
Auditing -> Done
```

## Manual Scrape Flow

Frontend:

1. User enters manual keywords or Indian query rows.
2. `handleManualScrapeSubmit` builds `keywords`, `sources`, `india_options`, and CAPTCHA settings.
3. Browser calls `POST /api/scrape`.
4. Browser opens the SSE stream for the returned task ID.

Backend:

1. `trigger_manual_scrape` validates the request.
2. It normalizes keywords and source options.
3. It starts `_manual_pipeline`.
4. `_manual_pipeline` calls `scrape_patents`.
5. Successful results are saved with `create_search` and `save_patents`.
6. Final project data is pushed with `stage: "complete"`.

## Google Patents Scraping

Primary code:

```text
backend/scraper.py
  scrape_patents
  scrape_google_patents
  _fetch_google_patent_details_jsonld
```

Flow:

1. Playwright opens Google Patents search results.
2. Result cards are parsed for patent ID, URL, title, and a fallback snippet.
3. Each result is enriched through `_fetch_google_patent_details_jsonld`.
4. The enrichment fetches Google's detail page through HTTP.
5. The parser tries, in order:
   - `<section itemprop="abstract">`
   - `DC.description`
   - nested `<abstract>`
   - `<summary-of-invention>`
6. If a granted B publication has no abstract, candidate A publications are tried.
7. Related Google "Other versions" links are followed as fallback candidates.
8. The final list is returned to the server and saved.

Important invariant:

```text
scrape_patents must return all_results on success.
```

Without this return, the scraper may log found rows but the save layer receives no patents.

## Indian Patents Scraping

Primary code:

```text
backend/scraper.py
  scrape_india_patents
  _apply_india_search_options
  _solve_india_captcha
  _extract_india_result_rows
  _fetch_india_patent_detail
```

Flow:

1. Playwright opens `https://iprsearch.ipindia.gov.in/PublicSearch/`.
2. Search options are applied from `india_options`.
3. If CAPTCHA is visible, `_solve_india_captcha` asks the backend for a solution.
4. The backend solves through 2Captcha or asks the user manually.
5. Results table rows are extracted.
6. Each Indian application detail is fetched through the IP India detail endpoint.
7. Patent rows are normalized and returned.

Current CAPTCHA policy:

- `INDIA_CAPTCHA_MAX_ATTEMPTS = 2` in `backend/scraper.py`.
- `MAX_CAPTCHA_ATTEMPTS = 2` in `backend/server.py`.
- `MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS = 3` in `backend/server.py`.

If CAPTCHA fails twice inside a page/session, the manual pipeline restarts from the beginning. The frontend receives `reset_pipeline: true` and resets the visible pipeline state.

## Saving And Data Model

`db/db.py` owns schema creation and migrations.

Key tables:

- `users`
- `sessions`
- `projects`
- `searches`
- `patents`

Saving flow:

```text
_manual_pipeline or _ai_pipeline
  -> create_search(...)
  -> save_patents(search_id, patents, user_id)
```

Patent rows use canonical keys:

- `rank`
- `source`
- `patent_id`
- `title`
- `abstract`
- `url`
- optional `confidence_score`
- optional `ai_reasoning`

The DB layer verifies ownership when `user_id` is supplied.

## AI Flow

`ai/ai_agent.py` wraps Gemini.

AI search:

1. User enters invention requirement.
2. `generate_search_queries` produces search queries, CPC codes, and rationale.
3. User confirms or edits queries.
4. Confirmed queries are scraped and saved.

AI audit:

1. User checks patents in Scraped History.
2. User clicks the toolbar AI Audit button.
3. The frontend calls `POST /api/ai/audit-selected` with the active project ID and selected patent IDs.
4. The backend verifies project ownership and selected patent membership.
5. Each patent is scored against the requirement or saved keyword context.
6. Audit fields are written back to the `patents` table.
7. SSE events update cards live, and completion reloads project history.

## Exports

Export routes load selected patents or all project patents, enrich relevancy labels, apply optional filters, and emit:

- CSV through `POST /api/projects/{project_id}/export/csv`

Export fields are defined in `EXPORT_FIELDS` in `backend/server.py`.

## Deep Scrape Flow

1. User checks patents in Scraped History.
2. User clicks the toolbar Deep scrape button.
3. The frontend calls `POST /api/deep-scrape` with the active project ID and selected patent IDs.
4. The backend verifies project ownership and selected patent membership.
5. `fetch_patent_deep_scrape` opens each saved patent URL.
6. The extractor saves title, abstract, description, and claims text, stopping before Google's citations/footer area and removing table-like blocks.
7. Progress is streamed through the normal Live Pipeline Log.
8. Saved text is stored in `patents.deep_scrape_text` with `deep_scraped_at`.

## Operational Notes

- Use `ENV=production` locally when you want a single backend process without uvicorn reload.
- Use reload only during development.
- The `.env` file is loaded with `load_dotenv(override=True)`.
- Existing saved abstracts are not backfilled automatically when scraper logic changes. Rerun a scrape to store improved abstracts.
- The backend stores task queues in memory, so active SSE tasks do not survive a server restart.
