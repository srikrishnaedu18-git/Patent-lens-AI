import sqlite3
import json
import logging
from pathlib import Path
from datetime import datetime

logger = logging.getLogger("db")

DB_PATH = Path(__file__).parent / "patent_lens.db"

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys for cascade deletes
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    """
    Initialise database schema and apply safe migrations for new columns.
    Safe to call on every startup — uses IF NOT EXISTS / ALTER TABLE guards.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # ── Core tables ──────────────────────────────────────────────────────────

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    # searches now includes ai_queries (JSON array of generated query strings)
    # and search_mode to distinguish 'manual' vs 'ai' searches
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        query TEXT NOT NULL,
        search_mode TEXT DEFAULT 'manual',
        ai_queries TEXT,
        ai_cpc_codes TEXT,
        ai_rationale TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS patents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        search_id INTEGER NOT NULL,
        patent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        abstract TEXT NOT NULL,
        url TEXT NOT NULL,
        confidence_score REAL,
        ai_reasoning TEXT,
        FOREIGN KEY (search_id) REFERENCES searches (id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()

    # ── Safe migrations for existing databases ───────────────────────────────
    # Each ALTER TABLE is wrapped in try/except — silently skipped if column exists.

    migrations = [
        ("searches", "search_mode",  "TEXT DEFAULT 'manual'"),
        ("searches", "ai_queries",   "TEXT"),
        ("searches", "ai_cpc_codes", "TEXT"),
        ("searches", "ai_rationale", "TEXT"),
        ("patents",  "confidence_score", "REAL"),
        ("patents",  "ai_reasoning",     "TEXT"),
    ]

    for table, column, col_def in migrations:
        try:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def};")
            conn.commit()
            logger.info("[DB] Migration applied: ALTER TABLE %s ADD COLUMN %s", table, column)
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                logger.debug("[DB] Column %s.%s already exists — skipping migration.", table, column)
            else:
                logger.error("[DB] Unexpected migration error for %s.%s: %s", table, column, e)
    
    conn.close()
    logger.info("[DB] Database initialised at: %s", DB_PATH)


# ── Project CRUD ──────────────────────────────────────────────────────────────

def get_projects():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects ORDER BY created_at DESC;")
    rows = cursor.fetchall()
    projects = [dict(row) for row in rows]
    conn.close()
    return projects

def create_project(name: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO projects (name) VALUES (?);", (name,))
        conn.commit()
        project_id = cursor.lastrowid
        cursor.execute("SELECT * FROM projects WHERE id = ?;", (project_id,))
        project = dict(cursor.fetchone())
        logger.info("[DB] Created project: id=%d name='%s'", project_id, name)
        return project
    except sqlite3.IntegrityError:
        # Project already exists — return it
        cursor.execute("SELECT * FROM projects WHERE name = ?;", (name,))
        row = cursor.fetchone()
        logger.warning("[DB] Project name '%s' already exists — returning existing.", name)
        return dict(row) if row else None
    except Exception as e:
        logger.error("[DB] create_project failed: %s", e, exc_info=True)
        raise
    finally:
        conn.close()

def delete_project(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM projects WHERE id = ?;", (project_id,))
    conn.commit()
    conn.close()
    logger.info("[DB] Deleted project id=%d (cascade applied)", project_id)


# ── Search & Patent CRUD ──────────────────────────────────────────────────────

def create_search(
    project_id: int,
    query: str,
    search_mode: str = "manual",
    ai_queries: list = None,
    ai_cpc_codes: list = None,
    ai_rationale: str = None,
) -> int:
    """
    Create a search record.

    Args:
        project_id:   Parent project.
        query:        Human-readable label (the requirement text for AI mode,
                      or the keyword string for manual mode).
        search_mode:  'manual' or 'ai'
        ai_queries:   List of LLM-generated query strings (AI mode only).
        ai_cpc_codes: List of LLM-suggested CPC codes (AI mode only).
        ai_rationale: LLM search rationale text (AI mode only).

    Returns:
        The new search row id.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            INSERT INTO searches
                (project_id, query, search_mode, ai_queries, ai_cpc_codes, ai_rationale)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (
                project_id,
                query,
                search_mode,
                json.dumps(ai_queries) if ai_queries else None,
                json.dumps(ai_cpc_codes) if ai_cpc_codes else None,
                ai_rationale,
            ),
        )
        conn.commit()
        search_id = cursor.lastrowid
        logger.info(
            "[DB] Created search id=%d mode='%s' for project %d",
            search_id, search_mode, project_id,
        )
        return search_id
    except Exception as e:
        logger.error("[DB] create_search failed: %s", e, exc_info=True)
        raise
    finally:
        conn.close()

def save_patents(search_id: int, patents: list[dict]):
    """
    Persist a list of scraped (and optionally AI-audited) patents.

    Each patent dict should have keys:
      patent_id, title, abstract, url
    Optionally:
      confidence_score (float), ai_reasoning (str)
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        for p in patents:
            cursor.execute(
                """
                INSERT INTO patents
                    (search_id, patent_id, title, abstract, url, confidence_score, ai_reasoning)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    search_id,
                    p.get("patent_id", ""),
                    p.get("title", ""),
                    p.get("abstract", ""),
                    p.get("url", ""),
                    p.get("confidence_score"),
                    p.get("ai_reasoning"),
                ),
            )
        conn.commit()
        logger.info("[DB] Saved %d patents for search_id=%d", len(patents), search_id)
    except Exception as e:
        logger.error("[DB] save_patents failed for search_id=%d: %s", search_id, e, exc_info=True)
        raise
    finally:
        conn.close()

def get_project_data(project_id: int) -> list[dict]:
    """
    Returns all searches for a project, with their nested patents.
    Deserialises JSON-stored AI fields back into Python lists.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "SELECT * FROM searches WHERE project_id = ? ORDER BY created_at DESC;",
        (project_id,),
    )
    searches = [dict(row) for row in cursor.fetchall()]
    
    for s in searches:
        # Deserialise JSON columns
        for json_col in ("ai_queries", "ai_cpc_codes"):
            raw = s.get(json_col)
            s[json_col] = json.loads(raw) if raw else []

        cursor.execute(
            "SELECT * FROM patents WHERE search_id = ? ORDER BY id ASC;",
            (s["id"],),
        )
        s["patents"] = [dict(row) for row in cursor.fetchall()]
        
    conn.close()
    return searches

def get_search_results(search_id: int) -> dict:
    """Returns a single search run with its patents."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM searches WHERE id = ?;", (search_id,))
    search_row = cursor.fetchone()
    if not search_row:
        conn.close()
        return {}
    
    search = dict(search_row)
    for json_col in ("ai_queries", "ai_cpc_codes"):
        raw = search.get(json_col)
        search[json_col] = json.loads(raw) if raw else []

    cursor.execute("SELECT * FROM patents WHERE search_id = ? ORDER BY id ASC;", (search_id,))
    search["patents"] = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return search

def get_patents_by_ids(patent_ids: list[int]) -> list[dict]:
    if not patent_ids:
        return []
    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" for _ in patent_ids)
    cursor.execute(
        f"""
        SELECT p.*, s.query AS keywords, s.search_mode
        FROM patents p
        JOIN searches s ON p.search_id = s.id
        WHERE p.id IN ({placeholders})
        ORDER BY p.id ASC;
        """,
        patent_ids,
    )
    rows = cursor.fetchall()
    patents = [dict(row) for row in rows]
    conn.close()
    return patents

def get_all_project_patents(project_id: int) -> list[dict]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT p.*, s.query AS keywords, s.search_mode
        FROM patents p
        JOIN searches s ON p.search_id = s.id
        WHERE s.project_id = ?
        ORDER BY s.created_at DESC, p.id ASC;
        """,
        (project_id,),
    )
    rows = cursor.fetchall()
    patents = [dict(row) for row in rows]
    conn.close()
    return patents

def update_patent_audit(patent_id: int, confidence_score: float, reasoning: str):
    """Updates the AI audit details for a specific patent by database row ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE patents
            SET confidence_score = ?, ai_reasoning = ?
            WHERE id = ?;
            """,
            (confidence_score, reasoning, patent_id),
        )
        conn.commit()
    except Exception as e:
        logger.error("[DB] update_patent_audit failed for patent_id=%d: %s", patent_id, e, exc_info=True)
        raise
    finally:
        conn.close()
