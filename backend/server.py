"""
server.py — PatentLens Studio API
Dual-mode: Manual keyword scrape + AI-driven prior art pipeline
SSE streaming for live progress. Scraping and AI auditing are separate steps.
"""

import sys
from pathlib import Path as _Path

# ── Path bootstrap (allow running from project root or backend/) ───────────────
_ROOT = _Path(__file__).resolve().parent.parent  # project root
sys.path.insert(0, str(_ROOT / "db"))       # db.py
sys.path.insert(0, str(_ROOT / "ai"))       # ai_agent.py
sys.path.insert(0, str(_ROOT / "backend"))  # scraper.py

import io
import csv
import json
import asyncio
import logging
import sys
import concurrent.futures
import uuid
from pathlib import Path
from datetime import datetime
from typing import AsyncGenerator

from dotenv import load_dotenv
load_dotenv(override=True)

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks, Response, Cookie, Depends
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from db import (
    init_db, get_projects, create_project, delete_project,
    create_search, save_patents, get_project_data, get_search_results,
    get_patents_by_ids, get_all_project_patents, update_patent_audit,
    update_patent_deep_scrape,
    get_db_connection,
    register_user, verify_user, create_session, get_user_id_by_session, delete_session,
    verify_project_ownership, verify_search_ownership, verify_patent_ownership
)
from scraper import fetch_patent_deep_scrape, get_india_options_from_env, normalize_india_options, normalize_sources, scrape_patents

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("server")

MAX_CAPTCHA_ATTEMPTS = 2
MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS = 3


def score_to_relevancy(score) -> str:
    """Map a confidence_score float to a colour label for exports."""
    if score is None:
        return "Unaudited"
    if score >= 0.75:
        return "Red"
    if score >= 0.4:
        return "Yellow"
    return "Green"


# ── Lifespan handler ──────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="PatentLens Studio API", lifespan=lifespan)

# ── Auth Dependency & Models ──────────────────────────────────────────────────
class UserAuth(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)

def get_current_user_id(session_token: str = Cookie(None)):
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = get_user_id_by_session(session_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return user_id

@app.post("/api/auth/register")
def auth_register(user: UserAuth, response: Response):
    username = user.username.strip()
    password = user.password
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password cannot be empty")
    try:
        user_id = register_user(username, password)
        session_token = create_session(user_id)
        response.set_cookie(
            key="session_token",
            value=session_token,
            max_age=31536000,
            httponly=True,
            samesite="lax",
            secure=False
        )
        return {"status": "success", "username": username}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("[Auth] register error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Registration failed")

@app.post("/api/auth/login")
def auth_login(user: UserAuth, response: Response):
    username = user.username.strip()
    password = user.password
    user_data = verify_user(username, password)
    if not user_data:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    try:
        session_token = create_session(user_data["id"])
        response.set_cookie(
            key="session_token",
            value=session_token,
            max_age=31536000,
            httponly=True,
            samesite="lax",
            secure=False
        )
        return {"status": "success", "username": user_data["username"]}
    except Exception as e:
        logger.error("[Auth] login error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Login failed")

@app.post("/api/auth/logout")
def auth_logout(response: Response, session_token: str = Cookie(None)):
    if session_token:
        delete_session(session_token)
    response.delete_cookie(key="session_token")
    return {"status": "success", "message": "Logged out"}


# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health_check():
    """
    Public endpoint — checks DB connectivity, table presence, and env config.
    Visit /api/health on your Render deployment to diagnose connection issues.
    """
    import os
    from db import get_db_connection, get_database_backend, get_database_url

    result = {
        "status": "ok",
        "backend": get_database_backend(),
        "database_url_set": bool(os.environ.get("DATABASE_URL")),
        "database_url_preview": None,
        "db_connect": False,
        "tables": [],
        "env": {
            "ENV": os.environ.get("ENV", "not set"),
            "HOST": os.environ.get("HOST", "not set"),
            "PORT": os.environ.get("PORT", "not set"),
            "GEMINI_API_KEY": "set" if os.environ.get("GEMINI_API_KEY") else "MISSING",
            "GEMINI_API_KEY1": "set" if os.environ.get("GEMINI_API_KEY1") else "MISSING",
            "TWO_CAPTCHA_API_KEY": "set" if os.environ.get("TWO_CAPTCHA_API_KEY") else "MISSING",
            "INDIA_PATENT_HEADLESS": os.environ.get("INDIA_PATENT_HEADLESS", "not set"),
        },
        "error": None,
    }

    # Mask the DB URL — show only the host part, not the password
    raw_url = os.environ.get("DATABASE_URL", "")
    if raw_url:
        try:
            from urllib.parse import urlparse
            parsed = urlparse(raw_url)
            result["database_url_preview"] = f"{parsed.scheme}://***@{parsed.hostname}/{parsed.path.lstrip('/')}"
        except Exception:
            result["database_url_preview"] = "(parse error)"

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        backend = get_database_backend()

        if backend == "postgres":
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
            """)
        else:
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")

        rows = cur.fetchall()
        result["tables"] = [row[0] for row in rows]
        result["db_connect"] = True
        conn.close()
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)

    return result

@app.get("/api/auth/me")
def auth_me(session_token: str = Cookie(None)):
    user_id = get_user_id_by_session(session_token)
    if not user_id:
        return {"authenticated": False}
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT username FROM users WHERE id = ?;", (user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return {"authenticated": False}
    return {"authenticated": True, "username": row["username"]}

# ── In-memory task store (task_id -> asyncio.Queue) ───────────────────────────
_task_queues: dict[str, asyncio.Queue] = {}
_captcha_futures: dict[str, asyncio.Future] = {}
_task_cancelled: dict[str, bool] = {}  # tracks if a task was terminate-requested

# ── Thread-pool executor for Playwright (Windows compat) ─────────────────────
_scraper_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)

def _run_scraper_in_thread(query: str, max_results: int, progress_callback=None) -> list[dict]:
    """
    Run scrape_patents in a fresh event loop inside a worker thread.
    On Windows, uvicorn uses SelectorEventLoop which does not support
    subprocess operations that Playwright needs. This workaround creates
    a ProactorEventLoop (or default) per-thread to avoid NotImplementedError.
    """
    if sys.platform == "win32":
        loop = asyncio.ProactorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(scrape_patents(query, max_results, progress_callback=progress_callback))
    finally:
        loop.close()

async def run_scraper(query: str, max_results: int, progress_callback=None) -> list[dict]:
    """Async wrapper: offloads the blocking scraper call to a thread."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _scraper_executor,
        _run_scraper_in_thread,
        query,
        max_results,
        progress_callback,
    )


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str

class ManualScrapeRequest(BaseModel):
    project_id: int
    keywords: str          # comma-separated
    max_results: int = 20
    sources: list[str] = Field(default_factory=lambda: ["google"])
    india_options: dict = Field(default_factory=dict)
    espacenet_options: dict = Field(default_factory=dict)
    captcha_mode: str = "auto"       # "auto" | "manual"
    captcha_service: str = "2captcha" # "2captcha" (for auto)

class GenerateQueriesRequest(BaseModel):
    requirement: str

class ConfirmAISearchRequest(BaseModel):
    project_id: int
    requirement: str
    queries: list[str]
    cpc_codes: list[str] = []
    ai_rationale: str = ""
    max_results: int = 20
    audit_mode: str = "sequential"
    sources: list[str] = Field(default_factory=lambda: ["google"])
    india_options: dict = Field(default_factory=dict)
    espacenet_options: dict = Field(default_factory=dict)
    captcha_mode: str = "auto"
    captcha_service: str = "2captcha"

class AuditRequest(BaseModel):
    requirement: str = ""  # optional override; falls back to stored query

class SelectedAuditRequest(BaseModel):
    project_id: int
    patent_ids: list[int]
    requirement: str = ""

class DeepScrapeRequest(BaseModel):
    project_id: int
    patent_ids: list[int]

class ExportRequest(BaseModel):
    patent_ids: list[int] = None
    relevancy_filter: list[str] = None  # e.g. ["Red", "Yellow"]

class CaptchaAnswerRequest(BaseModel):
    answer: str


# ── Helper: push SSE event to task queue ─────────────────────────────────────

async def _push(queue: asyncio.Queue, event: dict):
    await queue.put(event)
    logger.info("[SSE] Event pushed: stage=%s | %s",
                event.get("stage"), event.get("message", event.get("current", "")))


_captcha_attempts: dict[str, int] = {}

async def _auto_solve_captcha_with_gemini(image_data_url: str, queue) -> str:
    """Uses Gemini vision models to automatically solve a CAPTCHA, falling back to other keys on failure."""
    import base64
    from PIL import Image
    from google import genai
    try:
        from ai_agent import GEMINI_MODEL
    except Exception as exc:
        logger.error("[CAPTCHA] Failed to import GEMINI_MODEL from ai_agent: %s", exc)
        GEMINI_MODEL = "gemini-3.5-flash"

    if not image_data_url.startswith("data:image/png;base64,"):
        logger.error("[CAPTCHA] Invalid image data URL format")
        return ""

    # Collect all available API keys starting with GEMINI_API_KEY
    import os
    keys = []
    main_key = os.getenv("GEMINI_API_KEY")
    if main_key:
        keys.append(main_key.strip())
    
    # Check other numbered/named keys (GEMINI_API_KEY1, GEMINI_API_KEY2, etc.)
    for k, v in os.environ.items():
        if k.startswith("GEMINI_API_KEY") and k != "GEMINI_API_KEY":
            v_clean = v.strip()
            if v_clean and v_clean not in keys:
                keys.append(v_clean)

    if not keys:
        logger.warning("[CAPTCHA] No Gemini API keys found.")
        return ""

    try:
        # Decode base64 PNG data
        base64_data = image_data_url.split(",", 1)[1]
        img_bytes = base64.b64decode(base64_data)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

        prompt = (
            "Identify the alphanumeric characters in this CAPTCHA image. "
            "Output ONLY the exact characters, with no spaces, explanations, or extra text."
        )
    except Exception as exc:
        logger.error("[CAPTCHA] Failed to decode image: %s", exc)
        return ""

    # Try each key in sequence until one succeeds
    for i, key in enumerate(keys):
        msg = f"Attempting Gemini auto-solve (key {i+1}/{len(keys)})..."
        logger.info("[CAPTCHA] %s", msg)
        await _push(queue, {
            "stage": "scraping",
            "message": msg
        })
        try:
            client = genai.Client(api_key=key)
            
            def _call_gemini():
                response = client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=[img, prompt],
                )
                return response.text

            loop = asyncio.get_running_loop()
            response_text = await loop.run_in_executor(None, _call_gemini)
            
            answer = response_text.strip() if response_text else ""
            if answer:
                logger.info("[CAPTCHA] Gemini auto-solve succeeded using key %d/%d: %s", i + 1, len(keys), answer)
                return answer
        except Exception as exc:
            logger.warning("[CAPTCHA] Gemini solve failed with key %d/%d: %s", i + 1, len(keys), exc)
            # Log failure of this key to UI
            await _push(queue, {
                "stage": "scraping",
                "message": f"Gemini key {i+1}/{len(keys)} failed (quota or API error)."
            })
            continue

    logger.error("[CAPTCHA] All available Gemini API keys failed or were exhausted.")
    return ""


async def _solve_captcha_with_twocaptcha(image_data_url: str, queue) -> str:
    """Solves a CAPTCHA using the paid 2Captcha service."""
    import os
    import httpx

    api_key = os.getenv("TWO_CAPTCHA_API_KEY")
    if not api_key:
        logger.warning("[2CAPTCHA] TWO_CAPTCHA_API_KEY is not configured.")
        return ""

    if not image_data_url.startswith("data:image/png;base64,"):
        logger.error("[2CAPTCHA] Invalid image data URL format")
        return ""

    await _push(queue, {
        "stage": "scraping",
        "message": "Attempting paid auto-solve using 2Captcha service...",
        "captcha_image": image_data_url
    })

    base64_data = image_data_url.split(",", 1)[1]

    try:
        async with httpx.AsyncClient() as client:
            # 1. Submit captcha to 2Captcha
            logger.info("[2CAPTCHA] Submitting CAPTCHA to 2Captcha...")
            submit_response = await client.post(
                "https://2captcha.com/in.php",
                data={
                    "key": api_key.strip(),
                    "method": "base64",
                    "body": base64_data,
                    "json": 1,
                    "regsense": 1,
                },
                timeout=10,
            )
            submit_data = submit_response.json()
            if submit_data.get("status") != 1:
                err_msg = submit_data.get("request", "Unknown error")
                logger.error("[2CAPTCHA] Submit failed: %s", err_msg)
                await _push(queue, {
                    "stage": "scraping",
                    "message": f"2Captcha submission failed: {err_msg}"
                })
                return ""

            captcha_id = submit_data.get("request")
            logger.info("[2CAPTCHA] CAPTCHA submitted successfully. ID: %s. Polling...", captcha_id)

            # 2. Polling for the result
            for poll in range(30): # Poll for up to 60 seconds (30 * 2s)
                await asyncio.sleep(2)
                res_response = await client.get(
                    "https://2captcha.com/res.php",
                    params={
                        "key": api_key.strip(),
                        "action": "get",
                        "id": captcha_id,
                        "json": 1,
                    },
                    timeout=10,
                )
                res_data = res_response.json()
                status = res_data.get("status")
                request_val = res_data.get("request")

                if status == 1:
                    logger.info("[2CAPTCHA] Solved successfully: %s", request_val)
                    await _push(queue, {
                        "stage": "scraping",
                        "message": f"2Captcha solved CAPTCHA code: {request_val}. Submitting..."
                    })
                    return request_val
                elif request_val == "CAPCHA_NOT_READY":
                    logger.info("[2CAPTCHA] CAPTCHA not ready yet, polling...")
                    await _push(queue, {
                        "stage": "scraping",
                        "message": "2Captcha is solving the CAPTCHA (processing)..."
                    })
                    continue
                else:
                    logger.error("[2CAPTCHA] Polling failed: %s", request_val)
                    await _push(queue, {
                        "stage": "scraping",
                        "message": f"2Captcha solving failed: {request_val}"
                    })
                    return ""

    except Exception as exc:
        logger.error("[2CAPTCHA] Failed to solve CAPTCHA: %s", exc, exc_info=True)
        await _push(queue, {
            "stage": "scraping",
            "message": f"2Captcha exception occurred: {str(exc)}"
        })
        return ""
    
    return ""


async def _request_captcha(task_id: str, image_data_url: str, captcha_mode: str = "auto", captcha_service: str = "2captcha") -> str:
    """Publish a CAPTCHA challenge and wait for the answer.
    
    - auto mode:   Try the paid service (2Captcha) up to MAX_CAPTCHA_ATTEMPTS times.
                   Never ask for manual input. Return empty string on total failure.
    - manual mode: Show the CAPTCHA modal to the user every attempt, up to MAX_CAPTCHA_ATTEMPTS times.
                   Never try any paid service.
    """
    queue = _task_queues.get(task_id)
    if not queue:
        logger.error("[CAPTCHA] Queue not found for task %s", task_id)
        return ""

    attempt = _captcha_attempts.get(task_id, 0) + 1
    _captcha_attempts[task_id] = attempt

    if attempt > MAX_CAPTCHA_ATTEMPTS:
        await _push(queue, {"stage": "scraping", "message": f"CAPTCHA failed after {MAX_CAPTCHA_ATTEMPTS} attempts. Skipping."})
        return ""

    if captcha_mode == "auto":
        # Auto mode: try the configured paid service, never prompt user
        await _push(queue, {"stage": "scraping", "message": f"[Auto CAPTCHA] Attempt {attempt}/{MAX_CAPTCHA_ATTEMPTS} using {captcha_service}..."})
        answer = ""
        if captcha_service == "2captcha":
            answer = await _solve_captcha_with_twocaptcha(image_data_url, queue)
        if answer:
            return answer
        await _push(queue, {"stage": "scraping", "message": f"[Auto CAPTCHA] Attempt {attempt} failed. Will retry automatically on next CAPTCHA prompt."})
        return ""
    else:
        # Manual mode: always show the modal to the user
        await _push(queue, {"stage": "scraping", "message": f"[Manual CAPTCHA] Attempt {attempt}/{MAX_CAPTCHA_ATTEMPTS} — waiting for user input..."})
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        _captcha_futures[task_id] = future
        await _push(queue, {
            "stage": "captcha",
            "message": f"Indian Patent CAPTCHA required (attempt {attempt}/{MAX_CAPTCHA_ATTEMPTS}). Enter the code shown to continue.",
            "captcha_image": image_data_url,
        })
        try:
            return await asyncio.wait_for(future, timeout=300)
        finally:
            _captcha_futures.pop(task_id, None)


# ── SSE generator with keep-alive pings ──────────────────────────────────────

async def _sse_generator(task_id: str) -> AsyncGenerator[str, None]:
    queue = _task_queues.get(task_id)
    if queue is None:
        yield f"data: {json.dumps({'stage': 'error', 'message': 'Task not found'})}\n\n"
        return

    while True:
        try:
            # 15-second wait; on timeout send a keep-alive comment to prevent
            # proxy / browser from closing the connection mid-pipeline.
            event = await asyncio.wait_for(queue.get(), timeout=15)
        except asyncio.TimeoutError:
            yield ": ping\n\n"
            continue

        yield f"data: {json.dumps(event)}\n\n"

        if event.get("stage") in ("complete", "error"):
            break

    _task_queues.pop(task_id, None)
    _captcha_attempts.pop(task_id, None)
    _task_cancelled.pop(task_id, None)
    logger.info("[SSE] Stream closed for task_id=%s", task_id)


# ── Background pipeline: Scrape-only (AI mode) ───────────────────────────────

async def _ai_pipeline(
    project_id: int,
    requirement: str,
    queries: list[str],
    cpc_codes: list[str],
    ai_rationale: str,
    max_results: int,
    sources: list[str],
    india_options: dict,
    task_id: str,
    user_id: int,
    captcha_mode: str = "auto",
    captcha_service: str = "2captcha",
):
    """Scrapes patents for all queries and saves ALL results to the DB immediately.
    Relevance auditing is a separate on-demand step triggered by the user."""
    queue = _task_queues[task_id]

    try:
        await _push(queue, {
            "stage": "scraping",
            "message": (
                f"Starting Playwright browser — {len(queries)} quer{'y' if len(queries)==1 else 'ies'} "
                f"across {', '.join(s.title() for s in sources)} Patents..."
            ),
        })

        all_raw: list[dict] = []
        for i, q in enumerate(queries, 1):
            source_labels = " & ".join(s.title() for s in sources)
            await _push(queue, {
                "stage": "scraping",
                "message": f"🔍 Searching {source_labels} ({i}/{len(queries)}): {q[:80]}...",
            })
            try:
                def _progress_sync(msg: str):
                    asyncio.get_event_loop().call_soon_threadsafe(
                        lambda m=msg: asyncio.ensure_future(
                            queue.put({"stage": "scraping", "message": m})
                        )
                    )
                results = await scrape_patents(
                    q,
                    max_results,
                    progress_callback=_progress_sync,
                    sources=sources,
                    india_options=india_options,
                    captcha_callback=lambda image, tid=task_id, cm=captcha_mode, cs=captcha_service: _request_captcha(tid, image, cm, cs),
                )
                all_raw.extend(results)
                await _push(queue, {
                    "stage": "scraping",
                    "message": f"✅ Query {i} complete — {len(results)} patents found.",
                })
            except Exception as exc:
                logger.error("[Pipeline] Scrape failed for query '%s': %s", q, exc, exc_info=True)
                await _push(queue, {
                    "stage": "scraping",
                    "message": f"⚠️ Query {i} failed: {str(exc)[:120]}",
                })

        # Deduplicate
        seen_ids: set = set()
        unique: list[dict] = []
        for p in all_raw:
            key = p.get("patent_id") or p.get("title", "")
            if key and key not in seen_ids:
                seen_ids.add(key)
                unique.append(p)

        if not unique:
            await _push(queue, {"stage": "error", "message": "No patents were scraped. Try different queries."})
            return

        # Save ALL patents immediately
        await _push(queue, {
            "stage": "saving",
            "message": f"💾 Saving {len(unique)} patents to database...",
        })
        search_id = create_search(
            project_id=project_id,
            query=requirement[:500],
            search_mode="ai",
            ai_queries=queries,
            ai_cpc_codes=cpc_codes,
            ai_rationale=ai_rationale,
            user_id=user_id,
        )
        save_patents(search_id, unique, user_id=user_id)

        project_data = get_project_data(project_id, user_id)
        await _push(queue, {
            "stage": "complete",
            "message": f"🎉 {len(unique)} patents saved. Click 'AI Audit' on the search card to run relevance analysis.",
            "scraped_count": len(unique),
            "search_id": search_id,
            "data": project_data,
        })
        logger.info("[Pipeline] Scrape done: task_id=%s, saved=%d, search_id=%d",
                    task_id, len(unique), search_id)

    except Exception as exc:
        logger.error("[Pipeline] Unhandled error task_id=%s: %s", task_id, exc, exc_info=True)
        await _push(queue, {"stage": "error", "message": f"Pipeline crashed: {str(exc)}"})


# ── Background pipeline: Manual scrape ───────────────────────────────────────

async def _manual_pipeline(
    project_id: int,
    keywords: list[str],
    max_results: int,
    sources: list[str],
    india_options: dict,
    task_id: str,
    user_id: int,
    espacenet_options: dict | None = None,
    captcha_mode: str = "auto",
    captcha_service: str = "2captcha",
):
    queue = _task_queues[task_id]
    _task_cancelled[task_id] = False
    try:
        for pipeline_attempt in range(1, MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS + 2):
            if pipeline_attempt > 1:
                await _push(queue, {
                    "stage": "planning",
                    "reset_pipeline": True,
                    "message": (
                        f"Restarting full manual pipeline after CAPTCHA failure "
                        f"({pipeline_attempt - 1}/{MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS})..."
                    ),
                })

            await _push(queue, {
                "stage": "scraping",
                "message": (
                    f"Starting manual scrape for {len(keywords)} keyword"
                    f"{'' if len(keywords) == 1 else 's'} across {', '.join(s.title() for s in sources)} Patents..."
                ),
            })

            scraped_runs = []
            failed_keywords = []
            remaining_keywords = []
            restart_for_captcha = False

            for idx, kw in enumerate(keywords, 1):
                # Check if user requested termination
                if _task_cancelled.get(task_id):
                    remaining_keywords = keywords[idx - 1:]  # include current unstarted
                    await _push(queue, {
                        "stage": "scraping",
                        "message": f"⛔ Scrape terminated by user. {len(remaining_keywords)} keywords remaining.",
                    })
                    break

                await _push(queue, {
                    "stage": "scraping",
                    "message": f"Searching keyword {idx}/{len(keywords)}: {kw[:80]}",
                })

                # Reset per-keyword CAPTCHA attempt counter
                _captcha_attempts[task_id] = 0

                def _progress_sync(msg: str):
                    asyncio.get_event_loop().call_soon_threadsafe(
                        lambda m=msg: asyncio.ensure_future(
                            queue.put({"stage": "scraping", "message": m})
                        )
                    )

                try:
                    curr_india_options = india_options
                    if isinstance(india_options, list):
                        if idx - 1 < len(india_options):
                            curr_india_options = india_options[idx - 1]
                        else:
                            curr_india_options = india_options[-1] if india_options else None

                    patents = await scrape_patents(
                        kw,
                        max_results,
                        progress_callback=_progress_sync,
                        sources=sources,
                        india_options=curr_india_options,
                        espacenet_options=espacenet_options,
                        captcha_callback=lambda image, tid=task_id, cm=captcha_mode, cs=captcha_service: _request_captcha(tid, image, cm, cs),
                        is_cancelled_callback=lambda: _task_cancelled.get(task_id, False),
                    )
                    if patents:
                        source_label = ", ".join(sorted({p.get("source", "Google Patents") for p in patents}))
                        search_id = create_search(project_id, f"{kw} [{source_label}]", search_mode="manual", user_id=user_id)
                        save_patents(search_id, patents, user_id=user_id)
                        scraped_runs.append({"keyword": kw, "count": len(patents), "search_id": search_id})
                        await _push(queue, {
                            "stage": "saving",
                            "message": f"✅ Saved {len(patents)} patents for keyword: {kw[:80]}",
                        })
                    else:
                        failed_keywords.append(kw)
                        scraped_runs.append({"keyword": kw, "count": 0, "error": "No results found"})
                        await _push(queue, {
                            "stage": "scraping",
                            "message": f"⚠️ No results found for: {kw[:80]}",
                        })
                except Exception as exc:
                    message = str(exc)
                    if "CAPTCHA" in message and ("failed after" in message or "was not provided" in message):
                        logger.warning("[Manual] CAPTCHA failure triggered full restart for '%s': %s", kw, exc)
                        restart_for_captcha = True
                        _captcha_attempts[task_id] = 0
                        break

                    logger.error("[Manual] Scrape failed for '%s': %s", kw, exc, exc_info=True)
                    failed_keywords.append(kw)
                    scraped_runs.append({"keyword": kw, "count": 0, "error": message})
                    await _push(queue, {
                        "stage": "scraping",
                        "message": f"❌ Keyword failed: {kw[:60]} — {message[:120]}",
                    })

            if restart_for_captcha and pipeline_attempt <= MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS:
                await _push(queue, {
                    "stage": "planning",
                    "reset_pipeline": True,
                    "message": "CAPTCHA was not accepted. Restarting the whole manual pipeline from the start...",
                })
                continue

            if restart_for_captcha:
                await _push(queue, {
                    "stage": "error",
                    "message": (
                        "Manual scrape stopped because CAPTCHA kept failing after "
                        f"{MAX_MANUAL_PIPELINE_CAPTCHA_RESTARTS} full pipeline restart attempts."
                    ),
                })
                return

            if failed_keywords:
                create_search(project_id, ",".join(failed_keywords), search_mode="failed", user_id=user_id)
            if remaining_keywords:
                create_search(project_id, ",".join(remaining_keywords), search_mode="failed", user_id=user_id)

            await _push(queue, {
                "stage": "complete",
                "message": "Manual scrape complete.",
                "scraped": scraped_runs,
                "failed_keywords": failed_keywords,
                "remaining_keywords": remaining_keywords,
                "terminated": _task_cancelled.get(task_id, False),
                "data": get_project_data(project_id, user_id),
            })
            return

    except Exception as exc:
        logger.error("[Manual] Pipeline crashed task_id=%s: %s", task_id, exc, exc_info=True)
        await _push(queue, {"stage": "error", "message": f"Manual scrape crashed: {str(exc)}"})


# ── Background pipeline: On-demand AI Audit ──────────────────────────────────

async def _audit_patents_pipeline(
    patents: list[dict],
    requirement: str,
    task_id: str,
    user_id: int,
    project_id: int | None = None,
):
    """Audit a concrete patent list using Gemini and update each row live."""
    queue = _task_queues[task_id]

    try:
        from ai_agent import analyze_relevance
    except Exception as exc:
        logger.error("[Audit] Failed to import ai_agent: %s", exc, exc_info=True)
        await _push(queue, {"stage": "error", "message": f"AI agent unavailable: {exc}"})
        return

    try:
        if not patents:
            await _push(queue, {"stage": "error", "message": "No selected patents found to audit."})
            return

        req_text = requirement.strip() or ", ".join(
            sorted({p.get("keywords", "") for p in patents if p.get("keywords")})
        )
        total = len(patents)

        await _push(queue, {
            "stage": "auditing",
            "message": f"🤖 Starting AI relevance audit on {total} patents...",
            "total": total,
            "current": 0,
        })

        for idx, patent in enumerate(patents, 1):
            title = patent.get("title", "")
            abstract = patent.get("abstract", "")
            db_id = patent.get("id")
            try:
                assessment = await asyncio.to_thread(analyze_relevance, req_text, title, abstract)
                update_patent_audit(
                    db_id,
                    assessment.confidence_score,
                    assessment.reasoning,
                    overlap_reasons=getattr(assessment, 'overlap_reasons', ''),
                    difference_reasons=getattr(assessment, 'difference_reasons', ''),
                    user_id=user_id,
                )
                cat = assessment.relevance_category
                emoji = "🔴" if cat == "closely_relevant" else ("🟡" if cat == "mildly_relevant" else "🟢")
                label = score_to_relevancy(assessment.confidence_score)
                await _push(queue, {
                    "stage": "auditing",
                    "current": idx,
                    "total": total,
                    "patent_id": db_id,
                    "patent_code": patent.get("patent_id", ""),
                    "patent_url": patent.get("url", ""),
                    "title": title,
                    "reasoning": assessment.reasoning,
                    "overlap_reasons": getattr(assessment, 'overlap_reasons', ''),
                    "difference_reasons": getattr(assessment, 'difference_reasons', ''),
                    "confidence_score": assessment.confidence_score,
                    "relevance_category": cat,
                    "relevancy_label": label,
                    "comparison_query": req_text,
                    "message": (
                        f"{emoji} [{idx}/{total}] {cat.replace('_', ' ').title()} "
                        f"(score={assessment.confidence_score:.2f}) — {title[:55]}"
                    ),
                })
            except Exception as exc:
                logger.error("[Audit] Failed for patent id=%s '%s': %s",
                             db_id, title[:50], exc, exc_info=True)
                await _push(queue, {
                    "stage": "auditing",
                    "current": idx,
                    "total": total,
                    "message": f"⚠️ Audit error [{idx}/{total}]: {str(exc)[:80]}",
                })

        project_data = get_project_data(project_id, user_id) if project_id else []
        await _push(queue, {
            "stage": "complete",
            "message": f"✅ Audit complete — {total} patents assessed.",
            "data": project_data,
        })
        logger.info("[Audit] Done: total=%d, task_id=%s", total, task_id)

    except Exception as exc:
        logger.error("[Audit] Unhandled error task_id=%s: %s", task_id, exc, exc_info=True)
        await _push(queue, {"stage": "error", "message": f"Audit crashed: {str(exc)}"})


async def _audit_pipeline(search_id: int, requirement: str, task_id: str, user_id: int):
    """Audits all patents in a search run using Gemini and updates each row live."""
    try:
        search = get_search_results(search_id, user_id)
        patents = search.get("patents", [])
        for patent in patents:
            patent["keywords"] = search.get("query", "")
        await _audit_patents_pipeline(
            patents=patents,
            requirement=requirement.strip() or search.get("query", ""),
            task_id=task_id,
            user_id=user_id,
            project_id=search.get("project_id"),
        )
    except Exception as exc:
        logger.error("[Audit] Unhandled search audit error task_id=%s: %s", task_id, exc, exc_info=True)
        queue = _task_queues.get(task_id)
        if queue:
            await _push(queue, {"stage": "error", "message": f"Audit crashed: {str(exc)}"})


async def _deep_scrape_pipeline(
    patents: list[dict],
    task_id: str,
    user_id: int,
    project_id: int,
):
    """Deep scrape selected patent detail pages and save extracted body text."""
    queue = _task_queues[task_id]
    total = len(patents)

    await _push(queue, {
        "stage": "scraping",
        "message": f"Starting deep scrape for {total} selected patent{'' if total == 1 else 's'}...",
        "total": total,
        "current": 0,
    })

    saved = 0
    failed = []
    for idx, patent in enumerate(patents, 1):
        if _task_cancelled.get(task_id):
            await _push(queue, {
                "stage": "scraping",
                "message": f"⛔ Deep scrape cancelled after {idx - 1}/{total} patents.",
            })
            break

        patent_code = patent.get("patent_id", "")
        url = patent.get("url", "")
        await _push(queue, {
            "stage": "scraping",
            "current": idx,
            "total": total,
            "message": f"Opening patent detail page [{idx}/{total}]: {patent_code}",
        })

        try:
            deep_text = await asyncio.to_thread(fetch_patent_deep_scrape, url, patent_code)
            update_patent_deep_scrape(patent["id"], deep_text, user_id=user_id)
            saved += 1
            await _push(queue, {
                "stage": "saving",
                "current": idx,
                "total": total,
                "patent_id": patent["id"],
                "message": f"✅ Deep scraped {patent_code} — saved {len(deep_text):,} characters.",
            })
        except Exception as exc:
            failed.append(patent_code or str(patent.get("id", "")))
            logger.error("[DeepScrape] Failed for patent id=%s code=%s: %s", patent.get("id"), patent_code, exc, exc_info=True)
            await _push(queue, {
                "stage": "scraping",
                "current": idx,
                "total": total,
                "message": f"⚠️ Deep scrape failed for {patent_code or patent.get('id')}: {str(exc)[:100]}",
            })

    await _push(queue, {
        "stage": "complete",
        "message": f"Deep scrape complete — saved {saved}/{total} patent detail bodies.",
        "failed_patents": failed,
        "data": get_project_data(project_id, user_id),
    })


# ── API Endpoints — Projects ──────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects(user_id: int = Depends(get_current_user_id)):
    try:
        return get_projects(user_id)
    except Exception as e:
        logger.error("[API] list_projects: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects")
def add_project(project: ProjectCreate, user_id: int = Depends(get_current_user_id)):
    name = project.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    try:
        created = create_project(name, user_id)
        if not created:
            raise HTTPException(status_code=500, detail="Could not create project")
        return created
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("[API] add_project: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int, user_id: int = Depends(get_current_user_id)):
    try:
        delete_project(project_id, user_id)
        return {"status": "success", "message": f"Project {project_id} deleted."}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied")
    except Exception as e:
        logger.error("[API] remove_project %d: %s", project_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects/{project_id}/data")
def fetch_project_data(project_id: int, user_id: int = Depends(get_current_user_id)):
    try:
        return get_project_data(project_id, user_id)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied")
    except Exception as e:
        logger.error("[API] fetch_project_data %d: %s", project_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/settings/defaults")
def get_settings_defaults():
    return {
        "sources": ["google"],
        "india_options": get_india_options_from_env(),
    }


# ── API Endpoints — Manual Scrape ─────────────────────────────────────────────

@app.post("/api/scrape")
async def trigger_manual_scrape(req: ManualScrapeRequest, background_tasks: BackgroundTasks, user_id: int = Depends(get_current_user_id)):
    """Keyword scrape — starts a background task so CAPTCHA can be handled via SSE."""
    project_id = req.project_id
    if not verify_project_ownership(project_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    raw_keywords = req.keywords.strip()
    max_results = req.max_results
    sources = normalize_sources(req.sources)
    india_options = normalize_india_options(req.india_options or get_india_options_from_env())

    if not raw_keywords:
        raise HTTPException(status_code=400, detail="Keywords cannot be empty")

    is_india_active = "india" in sources
    has_india_commas = False
    if is_india_active and india_options and "rows" in india_options:
        for row in india_options["rows"]:
            text_val = (row.get("text") or "").strip()
            if "," in text_val:
                has_india_commas = True
                break

    espacenet_options = req.espacenet_options or {}
    is_espacenet_active = "espacenet" in sources
    has_espacenet_commas = False
    if is_espacenet_active and espacenet_options and "rows" in espacenet_options:
        for row in espacenet_options["rows"]:
            text_val = (row.get("text") or "").strip()
            if "," in text_val:
                has_espacenet_commas = True
                break

    if is_india_active and has_india_commas:
        # Split by India query rows
        split_rows = []
        for row in india_options["rows"]:
            text_val = (row.get("text") or "").strip()
            terms = [t.strip() for t in text_val.split(",") if t.strip()]
            split_rows.append(terms)
        
        max_terms = max(len(terms) for terms in split_rows) if split_rows else 0
        keywords_list = []
        india_options_list = []
        for i in range(max_terms):
            new_rows = []
            for idx, row in enumerate(india_options["rows"]):
                terms = split_rows[idx]
                term = terms[i] if i < len(terms) else (terms[-1] if terms else "")
                new_rows.append({
                    "field": row.get("field", "TI"),
                    "text": term,
                    "logic": row.get("logic", "AND")
                })
            
            parts = []
            for idx, row in enumerate(new_rows):
                if not row["text"]:
                    continue
                text_val = row["text"]
                if " " in text_val or " AND " in text_val.upper() or " OR " in text_val.upper():
                    text_val = f"({text_val})"
                part = f"{row['field']}: {text_val}"
                if idx > 0:
                    parts.append(f"{new_rows[idx-1]['logic']} {part}")
                else:
                    parts.append(part)
            combined_kw = " ".join(parts)
            
            keywords_list.append(combined_kw)
            run_opt = india_options.copy()
            run_opt["rows"] = new_rows
            india_options_list.append(run_opt)
        
        india_options = india_options_list

    elif is_espacenet_active and has_espacenet_commas:
        # Split by Espacenet query rows
        split_rows = []
        for row in espacenet_options["rows"]:
            text_val = (row.get("text") or "").strip()
            terms = [t.strip() for t in text_val.split(",") if t.strip()]
            split_rows.append(terms)
        
        max_terms = max(len(terms) for terms in split_rows) if split_rows else 0
        keywords_list = []
        espacenet_options_list = []
        for i in range(max_terms):
            new_rows = []
            for idx, row in enumerate(espacenet_options["rows"]):
                terms = split_rows[idx]
                term = terms[i] if i < len(terms) else (terms[-1] if terms else "")
                new_rows.append({
                    "field": row.get("field", "TA"),
                    "operator": row.get("operator", "all"),
                    "text": term,
                    "logic": row.get("logic", "AND")
                })
            
            parts = []
            for idx, row in enumerate(new_rows):
                if not row["text"]:
                    continue
                text_val = row["text"]
                if " " in text_val or " AND " in text_val.upper() or " OR " in text_val.upper():
                    text_val = f"({text_val})"
                part = f"{row['field']}: {text_val}"
                if idx > 0:
                    parts.append(f"{new_rows[idx-1]['logic']} {part}")
                else:
                    parts.append(part)
            combined_kw = " ".join(parts)
            
            keywords_list.append(combined_kw)
            run_opt = espacenet_options.copy()
            run_opt["rows"] = new_rows
            espacenet_options_list.append(run_opt)
        
        espacenet_options = espacenet_options_list
    else:
        # Standard splitting by comma in the raw_keywords input
        keywords_list = [k.strip() for k in raw_keywords.split(",") if k.strip()]

    if not keywords_list:
        raise HTTPException(status_code=400, detail="No valid keywords found")

    task_id = str(uuid.uuid4())
    _task_queues[task_id] = asyncio.Queue()
    background_tasks.add_task(
        _manual_pipeline,
        project_id=project_id,
        keywords=keywords_list,
        max_results=max_results,
        sources=sources,
        india_options=india_options,
        espacenet_options=espacenet_options,
        task_id=task_id,
        user_id=user_id,
        captcha_mode=req.captcha_mode,
        captcha_service=req.captcha_service,
    )
    return {"status": "processing", "task_id": task_id}


# ── API Endpoints — AI Pipeline ───────────────────────────────────────────────

@app.post("/api/ai/generate-queries")
async def generate_queries(req: GenerateQueriesRequest, user_id: int = Depends(get_current_user_id)):
    """Step 1 of AI flow: generate search queries from requirement."""
    requirement = req.requirement.strip()
    if not requirement:
        raise HTTPException(status_code=400, detail="Requirement cannot be empty")
    if len(requirement) < 30:
        raise HTTPException(status_code=400,
            detail="Requirement too short — please describe in more detail (min 30 chars)")
    try:
        from ai_agent import generate_search_strategy
        logger.info("[API] Generating AI queries for requirement (%d chars)", len(requirement))
        strategy = await asyncio.to_thread(generate_search_strategy, requirement)
        return {
            "keyword_queries": strategy.keyword_queries,
            "suggested_cpc_codes": strategy.suggested_cpc_codes,
            "search_rationale": strategy.search_rationale,
        }
    except EnvironmentError as e:
        logger.error("[API] AI env error: %s", e)
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("[API] generate_queries failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI query generation failed: {str(e)}")


@app.post("/api/ai/confirm-search")
async def confirm_ai_search(req: ConfirmAISearchRequest, background_tasks: BackgroundTasks, user_id: int = Depends(get_current_user_id)):
    """Step 2: confirms queries, starts scrape-only background pipeline."""
    if not verify_project_ownership(req.project_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    if not req.queries:
        raise HTTPException(status_code=400, detail="No queries provided")
    sources = normalize_sources(req.sources)
    india_options = normalize_india_options(req.india_options or get_india_options_from_env())

    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue

    logger.info("[API] AI search confirmed — task_id=%s, queries=%d sources=%s", task_id, len(req.queries), sources)

    background_tasks.add_task(
        _ai_pipeline,
        project_id=req.project_id,
        requirement=req.requirement,
        queries=req.queries,
        cpc_codes=req.cpc_codes,
        ai_rationale=req.ai_rationale,
        max_results=req.max_results,
        sources=sources,
        india_options=india_options,
        task_id=task_id,
        user_id=user_id,
        captcha_mode=req.captcha_mode,
        captcha_service=req.captcha_service,
    )
    return {"status": "processing", "task_id": task_id}


@app.post("/api/captcha/{task_id}")
async def submit_captcha(task_id: str, req: CaptchaAnswerRequest, user_id: int = Depends(get_current_user_id)):
    future = _captcha_futures.get(task_id)
    if not future or future.done():
        raise HTTPException(status_code=404, detail="No active CAPTCHA challenge for this task")
    answer = req.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="CAPTCHA answer cannot be empty")
    future.set_result(answer)
    return {"status": "accepted"}


@app.post("/api/scrape/cancel/{task_id}")
async def cancel_scrape(task_id: str, user_id: int = Depends(get_current_user_id)):
    """Signal the manual pipeline to stop after the current keyword finishes."""
    if task_id not in _task_queues:
        raise HTTPException(status_code=404, detail="Task not found or already finished")
    _task_cancelled[task_id] = True
    logger.info("[API] Cancellation requested for task_id=%s", task_id)
    return {"status": "cancelling"}


@app.post("/api/ai/audit/{search_id}")
async def trigger_audit(search_id: int, req: AuditRequest, background_tasks: BackgroundTasks, user_id: int = Depends(get_current_user_id)):
    """On-demand: start the AI relevance audit for a specific search run."""
    if not verify_search_ownership(search_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue

    logger.info("[API] Audit triggered — search_id=%d, task_id=%s", search_id, task_id)

    background_tasks.add_task(
        _audit_pipeline,
        search_id=search_id,
        requirement=req.requirement,
        task_id=task_id,
        user_id=user_id,
    )
    return {"status": "processing", "task_id": task_id}


@app.post("/api/ai/audit-selected")
async def trigger_selected_audit(req: SelectedAuditRequest, background_tasks: BackgroundTasks, user_id: int = Depends(get_current_user_id)):
    """On-demand: audit only the selected patent rows."""
    if not verify_project_ownership(req.project_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    patent_ids = sorted({int(pid) for pid in (req.patent_ids or []) if int(pid) > 0})
    if not patent_ids:
        raise HTTPException(status_code=400, detail="Select at least one patent to audit")

    patents = get_patents_by_ids(patent_ids, user_id)
    if len(patents) != len(patent_ids):
        raise HTTPException(status_code=403, detail="One or more selected patents are not accessible")
    project_patent_ids = {
        int(p["id"]) for p in get_all_project_patents(req.project_id, user_id)
    }
    if any(pid not in project_patent_ids for pid in patent_ids):
        raise HTTPException(status_code=403, detail="One or more selected patents are outside this project")

    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue

    logger.info("[API] Selected audit triggered — patents=%d, task_id=%s", len(patents), task_id)

    background_tasks.add_task(
        _audit_patents_pipeline,
        patents=patents,
        requirement=req.requirement,
        task_id=task_id,
        user_id=user_id,
        project_id=req.project_id,
    )
    return {"status": "processing", "task_id": task_id}


@app.post("/api/deep-scrape")
async def trigger_deep_scrape(req: DeepScrapeRequest, background_tasks: BackgroundTasks, user_id: int = Depends(get_current_user_id)):
    """Deep scrape only the selected patent rows."""
    if not verify_project_ownership(req.project_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    patent_ids = sorted({int(pid) for pid in (req.patent_ids or []) if int(pid) > 0})
    if not patent_ids:
        raise HTTPException(status_code=400, detail="Select at least one patent to deep scrape")

    patents = get_patents_by_ids(patent_ids, user_id)
    if len(patents) != len(patent_ids):
        raise HTTPException(status_code=403, detail="One or more selected patents are not accessible")
    project_patent_ids = {
        int(p["id"]) for p in get_all_project_patents(req.project_id, user_id)
    }
    if any(pid not in project_patent_ids for pid in patent_ids):
        raise HTTPException(status_code=403, detail="One or more selected patents are outside this project")

    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue
    _task_cancelled[task_id] = False

    logger.info("[API] Deep scrape triggered — patents=%d, task_id=%s", len(patents), task_id)

    background_tasks.add_task(
        _deep_scrape_pipeline,
        patents=patents,
        task_id=task_id,
        user_id=user_id,
        project_id=req.project_id,
    )
    return {"status": "processing", "task_id": task_id}


@app.get("/api/ai/stream/{task_id}")
async def stream_task(task_id: str, user_id: int = Depends(get_current_user_id)):
    """SSE endpoint — client connects here to receive live pipeline progress."""
    if task_id not in _task_queues:
        raise HTTPException(status_code=404, detail="Task not found or already completed")

    return StreamingResponse(
        _sse_generator(task_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Export Helpers ────────────────────────────────────────────────────────────

CSV_CELL_SAFE_LIMIT = 30000
DEEP_SCRAPE_FIELD_PREFIX = "deep_scrape_text_part_"

EXPORT_FIELDS = ["serial_number", "source", "patent_id", "keywords", "title", "relevancy", "abstract", "url",
                 "deep_scraped_at", "confidence_score", "ai_reasoning",
                 "overlap_reasons", "difference_reasons"]


def _chunk_csv_cell(value, limit: int = CSV_CELL_SAFE_LIMIT) -> list[str]:
    """Split large values so spreadsheet apps do not drop text after their cell limit."""
    text = "" if value is None else str(value)
    if not text:
        return [""]
    return [text[i:i + limit] for i in range(0, len(text), limit)]


def _csv_fieldnames_for_export(patents: list[dict]) -> list[str]:
    max_deep_chunks = max(
        (len(_chunk_csv_cell(p.get("deep_scrape_text", ""))) for p in patents),
        default=1,
    )
    deep_fields = [
        f"{DEEP_SCRAPE_FIELD_PREFIX}{i}"
        for i in range(1, max_deep_chunks + 1)
    ]
    insert_at = EXPORT_FIELDS.index("deep_scraped_at")
    return EXPORT_FIELDS[:insert_at] + deep_fields + EXPORT_FIELDS[insert_at:]

def _apply_relevancy_filter(patents: list[dict], relevancy_filter: list[str] | None) -> list[dict]:
    """Filter patents by relevancy labels if a filter is active."""
    if not relevancy_filter:
        return patents
    labels = {r.lower() for r in relevancy_filter}
    return [p for p in patents if score_to_relevancy(p.get("confidence_score")).lower() in labels]

def _enrich_relevancy(patents: list[dict]) -> list[dict]:
    """Add a 'relevancy' string field to each patent dict."""
    for p in patents:
        p["relevancy"] = score_to_relevancy(p.get("confidence_score"))
    return patents


class DeleteHistoryRequest(BaseModel):
    search_ids: list[int] = []
    patent_ids: list[int] = []

@app.post("/api/history/delete")
def delete_history(req: DeleteHistoryRequest, user_id: int = Depends(get_current_user_id)):
    try:
        # Verify ownership of all patent_ids
        for pid in req.patent_ids:
            if not verify_patent_ownership(pid, user_id):
                raise HTTPException(status_code=403, detail="Access denied")
        # Verify ownership of all search_ids
        for sid in req.search_ids:
            if not verify_search_ownership(sid, user_id):
                raise HTTPException(status_code=403, detail="Access denied")

        conn = get_db_connection()
        cursor = conn.cursor()
        # Delete individual patents if any
        if req.patent_ids:
            placeholders = ",".join("?" for _ in req.patent_ids)
            cursor.execute(f"DELETE FROM patents WHERE id IN ({placeholders});", req.patent_ids)
        # Delete search runs if any (ON DELETE CASCADE will automatically delete their patents)
        if req.search_ids:
            placeholders = ",".join("?" for _ in req.search_ids)
            cursor.execute(f"DELETE FROM searches WHERE id IN ({placeholders});", req.search_ids)
        conn.commit()
        conn.close()
        return {"status": "success", "message": "Selected items deleted successfully."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[API] Failed to delete history: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Export Endpoints ──────────────────────────────────────────────────────────

@app.post("/api/projects/{project_id}/export/csv")
def export_project_csv(project_id: int, req: ExportRequest = None, user_id: int = Depends(get_current_user_id)):
    if not verify_project_ownership(project_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    req = req or ExportRequest()
    patents = get_patents_by_ids(req.patent_ids, user_id) if req.patent_ids else get_all_project_patents(project_id, user_id)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents found to export")

    patents = _enrich_relevancy(patents)
    patents = _apply_relevancy_filter(patents, req.relevancy_filter)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents match the selected relevancy filter")

    fieldnames = _csv_fieldnames_for_export(patents)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for serial, p in enumerate(patents, start=1):
        p["serial_number"] = serial
        row = {f: p.get(f, "") for f in EXPORT_FIELDS}
        for index, chunk in enumerate(_chunk_csv_cell(p.get("deep_scrape_text", "")), start=1):
            row[f"{DEEP_SCRAPE_FIELD_PREFIX}{index}"] = chunk
        row["confidence_score"] = (
            f"{p['confidence_score']:.2f}" if p.get("confidence_score") is not None else ""
        )
        writer.writerow(row)

    output.seek(0)
    filename = f"patentlens_project{project_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

@app.post("/api/projects/{project_id}/export/markdown")
def export_project_markdown(project_id: int, req: ExportRequest = None, user_id: int = Depends(get_current_user_id)):
    if not verify_project_ownership(project_id, user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    req = req or ExportRequest()
    patents = get_patents_by_ids(req.patent_ids, user_id) if req.patent_ids else get_all_project_patents(project_id, user_id)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents found to export")

    patents = _enrich_relevancy(patents)
    patents = _apply_relevancy_filter(patents, req.relevancy_filter)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents match the selected relevancy filter")

    md_lines = []
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    md_lines.append("# PatentLens Intelligence Dossier")
    md_lines.append(f"*Generated on: {timestamp}*")
    md_lines.append(f"*Total Patents Included: {len(patents)}*\n")
    md_lines.append("---")

    for serial, p in enumerate(patents, start=1):
        patent_id = p.get("patent_id") or str(p.get("id")) or f"Item_{serial}"
        title = (p.get("title") or "Untitled Patent").strip()
        abstract = (p.get("abstract") or "No abstract available.").strip()
        url = p.get("url", "")
        source = p.get("source", "Unknown")
        scraped_at = p.get("scraped_at", "")
        confidence = f"{p['confidence_score']:.2f}" if p.get("confidence_score") is not None else "N/A"
        relevancy_label = score_to_relevancy(p.get("confidence_score")).upper()
        ai_reasoning = (p.get("ai_reasoning") or "").strip()
        deep_scrape_text = (p.get("deep_scrape_text") or "").strip()

        md_lines.append(f"\n## {serial}. [{patent_id}] {title}")
        md_lines.append(f"- **Patent ID / App No**: `{patent_id}`")
        md_lines.append(f"- **Source**: {source}")
        if url:
            md_lines.append(f"- **URL**: [{url}]({url})")
        if scraped_at:
            md_lines.append(f"- **Scraped Date**: {scraped_at}")
        md_lines.append(f"- **AI Relevancy Score**: {confidence} ({relevancy_label})")

        md_lines.append("\n### 📋 Abstract")
        md_lines.append(f"> {abstract}")

        if ai_reasoning:
            md_lines.append("\n### 🤖 AI Audit Reasoning")
            md_lines.append(ai_reasoning)

        if deep_scrape_text:
            md_lines.append("\n### 📜 Full Specification & Deep Scrape Text")
            md_lines.append(deep_scrape_text)
        else:
            md_lines.append("\n*Note: Deep scrape text not fetched for this patent.*")

        md_lines.append("\n---\n")

    content = "\n".join(md_lines)
    filename = f"patentlens_dossier_project{project_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


# ── Static UI ─────────────────────────────────────────────────────────────────
static_dir = Path(__file__).resolve().parent.parent / "frontend"
static_dir.mkdir(exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    import os
    
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    reload = os.environ.get("ENV", "development").lower() == "development"
    
    logger.info("[Server] Starting server on %s:%d (reload=%s)", host, port, reload)
    uvicorn.run("backend.server:app", host=host, port=port, reload=reload, app_dir=str(_ROOT))
