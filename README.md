# PatentLens Studio

PatentLens Studio is a local FastAPI web app for running prior-art patent searches against Google Patents. It supports:

- Project-based search history stored in SQLite
- Manual keyword patent scraping from selectable sources
- AI-assisted search query generation with Gemini
- On-demand AI relevance audits for scraped patents
- Live progress updates with Server-Sent Events
- CSV and PDF export of patent results

## Requirements

- Python 3.10 or newer
- `pip`
- Internet access for Google Patents scraping and Gemini API calls
- A Gemini API key for AI query generation and AI audits

The app uses Playwright for browser automation, so Chromium must be installed through Playwright after the Python packages are installed.

## Project Structure

```text
.
├── ai_agent.py          # Gemini query generation and relevance auditing
├── db.py                # SQLite schema, migrations, and database helpers
├── scraper.py           # Google Patents scraper and optional CLI exporter
├── server.py            # FastAPI app, API routes, exports, and static hosting
├── requirements.txt     # Python dependencies
├── .env.example         # Environment variable template
└── static/
    ├── index.html       # Web UI
    ├── app.js           # Frontend behavior and API calls
    └── style.css        # UI styles
```

Runtime files such as `.env`, `venv/`, `__pycache__/`, and `patent_lens.db` are ignored by Git.

## Installation

From the project root:

```bash
cd "/home/krishna/Desktop/Code/Mini projects/patent lens 2 "
```

Create and activate a virtual environment:

```bash
python3 -m venv venv
source venv/bin/activate
```

Install the Python packages:

```bash
pip install -r requirements.txt
```

Install Playwright's Chromium browser:

```bash
python -m playwright install chromium
```

On some Linux systems, Playwright may also need system browser dependencies:

```bash
python -m playwright install-deps chromium
```

If `install-deps` asks for administrator access, run it with the permissions your machine requires.

## API Key Setup

AI features require a Gemini API key. Manual keyword scraping can work without the key, but AI query generation and AI audits will fail until `GEMINI_API_KEY` is configured.

1. Create a Gemini API key from Google AI Studio:

   ```text
   https://aistudio.google.com/app/apikey
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` and replace the placeholder:

   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   INDIA_PATENTS_HEADFUL=0
   ```

4. Keep `.env` private. It is already listed in `.gitignore`, so it should not be committed.

The backend loads this key in `ai_agent.py` with `python-dotenv`.

`INDIA_PATENTS_HEADFUL` is optional. Set it to `1` if you want to use Indian Patent Search from IP India's public portal. That site requires CAPTCHA, so the scraper opens a visible browser and waits while you solve the CAPTCHA and submit the search.

## Run the Web App

Activate the virtual environment if it is not already active:

```bash
source venv/bin/activate
```

Start the FastAPI server:

```bash
python server.py
```

Open the app in your browser:

```text
http://127.0.0.1:8000
```

You can also run it with Uvicorn directly:

```bash
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

The SQLite database is created automatically at startup as `patent_lens.db`.

## Using the App

1. Create a project from the sidebar.
2. Choose a search mode:
   - Manual Search: enter comma-separated keywords and scrape Google Patents directly.
   - AI Search: enter a product or invention requirement, let Gemini generate search queries and CPC codes, then confirm the search.
3. Open Settings and choose search sources:
   - Google Patents
   - Indian Patents
   - Both
4. Review saved search runs in the project history.
5. Run AI Audit on a saved search to score patents as Red, Yellow, Green, or Unaudited.
6. Export all, selected, or filtered results as CSV or PDF.

## Optional CLI Scraper

`scraper.py` can be used without the web UI to scrape Google Patents and write local CSV/PDF files:

```bash
source venv/bin/activate
python scraper.py --query "smart irrigation sensor IoT" --max 20
```

Choose a source:

```bash
python scraper.py --query "smart irrigation sensor IoT" --max 20 --source google
python scraper.py --query "smart irrigation sensor IoT" --max 20 --source india
python scraper.py --query "smart irrigation sensor IoT" --max 20 --source both
```

Custom output file base name:

```bash
python scraper.py --query "blockchain supply chain" --max 20 --out supply_chain_patents
```

This creates:

```text
supply_chain_patents.csv
supply_chain_patents.pdf
```

## Important Files and Data

- `.env`: local environment variables, including `GEMINI_API_KEY`
- `.env.example`: safe template for environment setup
- `patent_lens.db`: local SQLite database created by the app
- `requirements.txt`: Python package list
- `static/`: frontend files served by FastAPI

To reset local app data, stop the server and delete `patent_lens.db`. A fresh database will be created the next time the server starts.

## Troubleshooting

### `GEMINI_API_KEY is not set`

Create `.env` from `.env.example` and add your real Gemini key:

```bash
cp .env.example .env
```

Then edit:

```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

Restart the server after changing `.env`.

### Playwright browser errors

Install Chromium for Playwright:

```bash
python -m playwright install chromium
```

If the browser launches but system libraries are missing, run:

```bash
python -m playwright install-deps chromium
```

### Port 8000 is already in use

Run the app on a different port:

```bash
uvicorn server:app --host 127.0.0.1 --port 8001 --reload
```

Then open:

```text
http://127.0.0.1:8001
```

### Google Patents returns no results

Try a smaller `max_results` value, simpler keywords, or more specific technical terms. Google Patents can also rate-limit or change page markup, which may temporarily affect scraping.

### Indian Patent Search requires CAPTCHA

Set this in `.env`:

```env
INDIA_PATENTS_HEADFUL=1
```

Restart the server. When an Indian Patents scrape starts, a visible browser opens. Solve the CAPTCHA in that browser and click Search; the scraper will continue after the results table loads.

### PDF export fails

Make sure `fpdf2` is installed:

```bash
pip install -r requirements.txt
```

Then restart the server.

## API Overview

The frontend uses these main endpoints:

- `GET /api/projects`
- `POST /api/projects`
- `DELETE /api/projects/{project_id}`
- `GET /api/projects/{project_id}/data`
- `POST /api/scrape`
- `POST /api/ai/generate-queries`
- `POST /api/ai/confirm-search`
- `POST /api/ai/audit/{search_id}`
- `GET /api/ai/stream/{task_id}`
- `POST /api/projects/{project_id}/export/csv`
- `POST /api/projects/{project_id}/export/pdf`

## Development Notes

- The app is intentionally local-first. It stores data in SQLite beside the source files.
- `server.py` mounts `static/` at `/`, so the web UI and API are served by the same FastAPI process.
- Database schema creation and simple migrations run automatically through `init_db()` when the server starts.
- Patent records are normalized to `source`, `patent_id`, `title`, `abstract`, and `url` regardless of source.
- AI calls use Gemini structured output through the `google-genai` package.
