"""
server.py — PatentLens Studio API
Dual-mode: Manual keyword scrape + AI-driven prior art pipeline
SSE streaming for live progress. Scraping and AI auditing are separate steps.
"""

import io
import csv
import json
import asyncio
import logging
import uuid
from pathlib import Path
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import (
    init_db, get_projects, create_project, delete_project,
    create_search, save_patents, get_project_data, get_search_results,
    get_patents_by_ids, get_all_project_patents, update_patent_audit,
)
from scraper import scrape_patents

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("server")


def score_to_relevancy(score) -> str:
    """Map a confidence_score float to a colour label for exports."""
    if score is None:
        return "Unaudited"
    if score >= 0.75:
        return "Red"
    if score >= 0.4:
        return "Yellow"
    return "Green"


# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="PatentLens Studio API")
init_db()

# ── In-memory task store (task_id → asyncio.Queue) ───────────────────────────
_task_queues: dict[str, asyncio.Queue] = {}


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str

class ManualScrapeRequest(BaseModel):
    project_id: int
    keywords: str          # comma-separated
    max_results: int = 20

class GenerateQueriesRequest(BaseModel):
    requirement: str

class ConfirmAISearchRequest(BaseModel):
    project_id: int
    requirement: str
    queries: list[str]
    cpc_codes: list[str]
    ai_rationale: str
    max_results: int = 20

class AuditRequest(BaseModel):
    requirement: str = ""  # optional override; falls back to stored query

class ExportRequest(BaseModel):
    patent_ids: list[int] = None
    relevancy_filter: list[str] = None  # e.g. ["Red", "Yellow"]


# ── Helper: push SSE event to task queue ─────────────────────────────────────

async def _push(queue: asyncio.Queue, event: dict):
    await queue.put(event)
    logger.info("[SSE] Event pushed: stage=%s | %s",
                event.get("stage"), event.get("message", event.get("current", "")))


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
    logger.info("[SSE] Stream closed for task_id=%s", task_id)


# ── Background pipeline: Scrape-only (AI mode) ───────────────────────────────

async def _ai_pipeline(
    project_id: int,
    requirement: str,
    queries: list[str],
    cpc_codes: list[str],
    ai_rationale: str,
    max_results: int,
    task_id: str,
):
    """Scrapes patents for all queries and saves ALL results to the DB immediately.
    Relevance auditing is a separate on-demand step triggered by the user."""
    queue = _task_queues[task_id]

    try:
        await _push(queue, {
            "stage": "scraping",
            "message": f"Starting Playwright browser — {len(queries)} quer{'y' if len(queries)==1 else 'ies'} to run...",
        })

        all_raw: list[dict] = []
        for i, q in enumerate(queries, 1):
            await _push(queue, {
                "stage": "scraping",
                "message": f"🔍 Searching Google Patents ({i}/{len(queries)}): {q[:80]}...",
            })
            try:
                def _progress_sync(msg: str):
                    asyncio.get_event_loop().call_soon_threadsafe(
                        lambda m=msg: asyncio.ensure_future(
                            queue.put({"stage": "scraping", "message": m})
                        )
                    )
                results = await scrape_patents(q, max_results, progress_callback=_progress_sync)
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
        )
        save_patents(search_id, unique)

        project_data = get_project_data(project_id)
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


# ── Background pipeline: On-demand AI Audit ──────────────────────────────────

async def _audit_pipeline(search_id: int, requirement: str, task_id: str):
    """Audits all patents in a search run using Gemini and updates each row live."""
    queue = _task_queues[task_id]

    try:
        from ai_agent import analyze_relevance
    except Exception as exc:
        logger.error("[Audit] Failed to import ai_agent: %s", exc, exc_info=True)
        await _push(queue, {"stage": "error", "message": f"AI agent unavailable: {exc}"})
        return

    try:
        search = get_search_results(search_id)
        patents = search.get("patents", [])
        if not patents:
            await _push(queue, {"stage": "error", "message": "No patents found for this search run."})
            return

        req_text = requirement.strip() or search.get("query", "")
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
                update_patent_audit(db_id, assessment.confidence_score, assessment.reasoning)
                cat = assessment.relevance_category
                emoji = "🔴" if cat == "closely_relevant" else ("🟡" if cat == "mildly_relevant" else "🟢")
                label = score_to_relevancy(assessment.confidence_score)
                await _push(queue, {
                    "stage": "auditing",
                    "current": idx,
                    "total": total,
                    "patent_id": db_id,
                    "confidence_score": assessment.confidence_score,
                    "relevance_category": cat,
                    "relevancy_label": label,
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

        project_id = search.get("project_id")
        project_data = get_project_data(project_id) if project_id else []
        await _push(queue, {
            "stage": "complete",
            "message": f"✅ Audit complete — {total} patents assessed.",
            "data": project_data,
        })
        logger.info("[Audit] Done: search_id=%d, total=%d, task_id=%s", search_id, total, task_id)

    except Exception as exc:
        logger.error("[Audit] Unhandled error task_id=%s: %s", task_id, exc, exc_info=True)
        await _push(queue, {"stage": "error", "message": f"Audit crashed: {str(exc)}"})


# ── API Endpoints — Projects ──────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    try:
        return get_projects()
    except Exception as e:
        logger.error("[API] list_projects: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/projects")
def add_project(project: ProjectCreate):
    name = project.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name cannot be empty")
    try:
        created = create_project(name)
        if not created:
            raise HTTPException(status_code=500, detail="Could not create project")
        return created
    except Exception as e:
        logger.error("[API] add_project: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int):
    try:
        delete_project(project_id)
        return {"status": "success", "message": f"Project {project_id} deleted."}
    except Exception as e:
        logger.error("[API] remove_project %d: %s", project_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects/{project_id}/data")
def fetch_project_data(project_id: int):
    try:
        return get_project_data(project_id)
    except Exception as e:
        logger.error("[API] fetch_project_data %d: %s", project_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── API Endpoints — Manual Scrape ─────────────────────────────────────────────

@app.post("/api/scrape")
async def trigger_manual_scrape(req: ManualScrapeRequest):
    """Legacy keyword scrape — returns result synchronously."""
    project_id = req.project_id
    raw_keywords = req.keywords.strip()
    max_results = req.max_results

    if not raw_keywords:
        raise HTTPException(status_code=400, detail="Keywords cannot be empty")

    keywords_list = [k.strip() for k in raw_keywords.split(",") if k.strip()]
    if not keywords_list:
        raise HTTPException(status_code=400, detail="No valid keywords found")

    scraped_runs = []
    for kw in keywords_list:
        try:
            logger.info("[API] Manual scrape for keyword: %s", kw)
            patents = await scrape_patents(kw, max_results)
            if patents:
                search_id = create_search(project_id, kw, search_mode="manual")
                save_patents(search_id, patents)
                scraped_runs.append({"keyword": kw, "count": len(patents), "search_id": search_id})
            else:
                scraped_runs.append({"keyword": kw, "count": 0, "error": "No results found"})
        except Exception as e:
            logger.error("[API] Manual scrape error for '%s': %s", kw, e, exc_info=True)
            scraped_runs.append({"keyword": kw, "count": 0, "error": str(e)})

    return {
        "status": "success",
        "scraped": scraped_runs,
        "data": get_project_data(project_id),
    }


# ── API Endpoints — AI Pipeline ───────────────────────────────────────────────

@app.post("/api/ai/generate-queries")
async def generate_queries(req: GenerateQueriesRequest):
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
async def confirm_ai_search(req: ConfirmAISearchRequest, background_tasks: BackgroundTasks):
    """Step 2: confirms queries, starts scrape-only background pipeline."""
    if not req.queries:
        raise HTTPException(status_code=400, detail="No queries provided")

    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue

    logger.info("[API] AI search confirmed — task_id=%s, queries=%d", task_id, len(req.queries))

    background_tasks.add_task(
        _ai_pipeline,
        project_id=req.project_id,
        requirement=req.requirement,
        queries=req.queries,
        cpc_codes=req.cpc_codes,
        ai_rationale=req.ai_rationale,
        max_results=req.max_results,
        task_id=task_id,
    )
    return {"status": "processing", "task_id": task_id}


@app.post("/api/ai/audit/{search_id}")
async def trigger_audit(search_id: int, req: AuditRequest, background_tasks: BackgroundTasks):
    """On-demand: start the AI relevance audit for a specific search run."""
    task_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _task_queues[task_id] = queue

    logger.info("[API] Audit triggered — search_id=%d, task_id=%s", search_id, task_id)

    background_tasks.add_task(
        _audit_pipeline,
        search_id=search_id,
        requirement=req.requirement,
        task_id=task_id,
    )
    return {"status": "processing", "task_id": task_id}


@app.get("/api/ai/stream/{task_id}")
async def stream_task(task_id: str):
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

EXPORT_FIELDS = ["patent_id", "keywords", "title", "relevancy", "abstract", "url",
                 "confidence_score", "ai_reasoning"]

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


# ── Export Endpoints ──────────────────────────────────────────────────────────

@app.post("/api/projects/{project_id}/export/csv")
def export_project_csv(project_id: int, req: ExportRequest = None):
    req = req or ExportRequest()
    patents = get_patents_by_ids(req.patent_ids) if req.patent_ids else get_all_project_patents(project_id)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents found to export")

    patents = _enrich_relevancy(patents)
    patents = _apply_relevancy_filter(patents, req.relevancy_filter)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents match the selected relevancy filter")

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for p in patents:
        row = {f: p.get(f, "") for f in EXPORT_FIELDS}
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


@app.post("/api/projects/{project_id}/export/pdf")
def export_project_pdf(project_id: int, req: ExportRequest = None):
    req = req or ExportRequest()
    patents = get_patents_by_ids(req.patent_ids) if req.patent_ids else get_all_project_patents(project_id)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents found to export")

    patents = _enrich_relevancy(patents)
    patents = _apply_relevancy_filter(patents, req.relevancy_filter)
    if not patents:
        raise HTTPException(status_code=404, detail="No patents match the selected relevancy filter")

    try:
        from fpdf import FPDF
        from fpdf.enums import XPos, YPos
        import textwrap

        def _safe(text) -> str:
            return str(text or "").encode("latin-1", errors="replace").decode("latin-1")

        def _count_lines(text: str, col_w: float, fs: int) -> int:
            chars = max(1, int(col_w / (fs * 0.38)))
            return len(textwrap.wrap(text, width=chars) or [""])

        RELEVANCY_COLORS = {
            "Red":      (220, 50, 50),
            "Yellow":   (200, 160, 0),
            "Green":    (40, 160, 80),
            "Unaudited":(120, 120, 120),
        }

        pdf = FPDF(orientation="L", unit="mm", format="A4")
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()

        # Header
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_fill_color(30, 50, 100)
        pdf.set_text_color(255, 255, 255)
        pdf.cell(0, 10, _safe("PatentLens Studio — Prior Art Report"),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C", fill=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 6, _safe(
            f"Project: {project_id}  |  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  Count: {len(patents)}"
        ), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C")
        pdf.ln(4)

        col_w = {"patent_id": 26, "keywords": 28, "title": 52,
                 "relevancy": 22, "abstract": 92, "score": 14, "reasoning": 42}

        def _header_row():
            pdf.set_font("Helvetica", "B", 8)
            pdf.set_fill_color(50, 80, 160)
            pdf.set_text_color(255, 255, 255)
            for col, w in col_w.items():
                pdf.cell(w, 8, col.replace("_", " ").title(),
                         border=1, fill=True, align="C")
            pdf.ln()

        _header_row()
        pdf.set_font("Helvetica", "", 7)
        fills = [(245, 247, 255), (255, 255, 255)]

        for i, row in enumerate(patents):
            r, g, b = fills[i % 2]
            pdf.set_fill_color(r, g, b)
            pdf.set_text_color(20, 20, 20)
            relevancy_label = row.get("relevancy", "Unaudited")
            vals = {
                "patent_id": _safe(row.get("patent_id", "")),
                "keywords":  _safe(row.get("keywords", "")),
                "title":     _safe(row.get("title", "")),
                "relevancy": _safe(relevancy_label),
                "abstract":  _safe(row.get("abstract", "")),
                "score":     _safe(f"{row['confidence_score']:.2f}" if row.get("confidence_score") is not None else "—"),
                "reasoning": _safe(row.get("ai_reasoning", "")),
            }
            row_h = max(
                _count_lines(vals["title"], col_w["title"], 7),
                _count_lines(vals["abstract"], col_w["abstract"], 7),
                _count_lines(vals["reasoning"], col_w["reasoning"], 7),
                1,
            ) * 3.5 + 2

            x0, y0 = pdf.get_x(), pdf.get_y()
            if y0 + row_h > 190:
                pdf.add_page()
                _header_row()
                pdf.set_font("Helvetica", "", 7)
                pdf.set_fill_color(r, g, b)
                pdf.set_text_color(20, 20, 20)
                x0, y0 = pdf.get_x(), pdf.get_y()

            offset = 0
            for col, w in col_w.items():
                if col == "relevancy":
                    rc = RELEVANCY_COLORS.get(relevancy_label, (120, 120, 120))
                    pdf.set_text_color(*rc)
                    pdf.set_font("Helvetica", "B", 7)
                else:
                    pdf.set_text_color(20, 20, 20)
                    pdf.set_font("Helvetica", "", 7)
                pdf.multi_cell(w, row_h, vals[col], border=1, fill=(col != "relevancy"),
                               align="C" if col in ("score", "relevancy") else "L",
                               new_x=XPos.RIGHT, new_y=YPos.TOP, max_line_height=3.5)
                offset += w
                pdf.set_xy(x0 + offset, y0)
            pdf.ln(row_h)

        pdf_bytes = pdf.output()
        filename = f"patentlens_project{project_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except Exception as e:
        logger.error("[API] PDF export failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


# ── Static UI ─────────────────────────────────────────────────────────────────
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
