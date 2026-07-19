# PatentLens Studio

PatentLens Studio is a multi-user FastAPI web app for running prior-art patent searches against Google Patents and Indian Patents. It features secure user authentication, isolated per-user project spaces, and an AI-powered search pipeline.

**Key capabilities:**
- 🔐 Multi-user login with session-based auth and cookie persistence
- 📁 Project-based search history stored in SQLite, scoped per user
- 🔍 Manual keyword patent scraping from Google Patents and IP India
- 🤖 AI-assisted search query generation with Gemini
- ✅ On-demand AI relevance audits (Red / Yellow / Green scoring)
- 📡 Live progress updates via Server-Sent Events (SSE)
- 📄 CSV and PDF export of patent results

---

## Requirements

- Python 3.11 or newer
- Internet access for scraping and Gemini API calls
- A Gemini API key (for AI features)

---

## Project Structure

```text
.
├── ai_agent.py          # Gemini query generation and relevance auditing
├── db.py                # SQLite schema, migrations, and database helpers
├── scraper.py           # Google Patents / IP India scraper
├── server.py            # FastAPI app, API routes, auth, exports, static hosting
├── requirements.txt     # Python dependencies
├── Dockerfile           # Container image for deployment
├── render.yaml          # Render.com deployment blueprint
├── .env.example         # Environment variable template
└── static/
    ├── index.html       # Web UI (with glassmorphic auth overlay)
    ├── app.js           # Frontend logic and auth flow
    └── style.css        # UI styles
```

---

## Local Installation

```bash
# Clone the repo and enter the project folder
git clone <your-repo-url>
cd patent-lens

# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install Python packages
pip install -r requirements.txt

# Install Playwright's Chromium browser
python -m playwright install chromium
python -m playwright install-deps chromium   # Linux only
```

---

## API Key Setup

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

The `.env` file is already in `.gitignore` — never commit it.

---

## Run Locally

```bash
source venv/bin/activate
python server.py
```

Open **http://127.0.0.1:8000** in your browser.

The first time you open the app you'll see a login screen. Register an account, and your projects will be fully isolated to that account.

The SQLite database (`patent_lens.db`) is created automatically on first startup.

---

## Deploying to Render

This project includes a `render.yaml` blueprint and `Dockerfile` for one-click deployment to [Render](https://render.com).

### Steps

1. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/your-username/patent-lens.git
   git push -u origin main
   ```

2. **Create a new Web Service on Render**
   - Go to [render.com](https://render.com) → New → Web Service
   - Connect your GitHub repository
   - Render will auto-detect the `Dockerfile`

3. **Set Environment Variables** in the Render dashboard:
   | Variable | Value |
   |---|---|
   | `GEMINI_API_KEY` | your Gemini API key |
   | `ENV` | `production` |
   | `HOST` | `0.0.0.0` |
   | `PORT` | `10000` |
   | `DB_PATH` | `/data/patent_lens.db` |
   | `INDIA_PATENT_HEADLESS` | `true` |

4. **Add a Persistent Disk** (required for SQLite):
   - In the Render service settings → Disks → Add Disk
   - Mount Path: `/data`
   - Size: 1 GB (free tier supports this)

5. **Deploy** — Render will build the Docker image and launch the service.

> ⚠️ **Important:** Without a persistent disk, the SQLite database will be wiped on every redeploy. Always configure the disk.

### Docker Local Test

```bash
docker build -t patent-lens-studio .
docker run -d \
  -p 8000:8000 \
  -e GEMINI_API_KEY="your_key_here" \
  -e ENV="production" \
  -v $(pwd)/data:/data \
  -e DB_PATH="/data/patent_lens.db" \
  --name patent-lens \
  patent-lens-studio
```

---

## Authentication

PatentLens Studio uses server-side session cookies:

- **Register** a new account from the login overlay on first visit
- **Session cookies** are valid for 1 year — you stay logged in across browser restarts
- **Logout** using the sign-out button in the sidebar footer
- Each user's **projects, searches, and patents are fully isolated**

Default accounts (pre-seeded on local install):
| Username | Password |
|---|---|
| Sri | `123456` |

---

## Using the App

1. Register or log in at the auth overlay
2. Create a project from the sidebar
3. Choose a search mode:
   - **Manual Search** — enter comma-separated keywords
   - **AI Search** — describe your invention, let Gemini generate queries
4. Review saved search runs in the project history
5. Run **AI Audit** on a search to score patents Red / Yellow / Green
6. Export results as **CSV** or **PDF**

---

## Optional CLI Scraper

```bash
python scraper.py --query "smart irrigation sensor IoT" --max 20 --source google
python scraper.py --query "blockchain supply chain" --max 20 --out results
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Address already in use` | Stop the running server or use a different port: `PORT=8001 python server.py` |
| `GEMINI_API_KEY is not set` | Copy `.env.example` → `.env` and fill in the key |
| Playwright browser errors | Run `python -m playwright install chromium && python -m playwright install-deps chromium` |
| PDF export fails | Run `pip install -r requirements.txt` and restart |
| Login loop on Render | Make sure `DB_PATH` points to the persistent disk and the disk is attached |

---

## API Overview

All API routes require authentication (session cookie). Auth endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Core endpoints (scoped to logged-in user):

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
- `POST /api/history/delete`
