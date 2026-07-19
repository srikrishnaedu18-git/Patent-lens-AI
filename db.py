import sqlite3
import json
import logging
import hashlib
import secrets
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

    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Sessions table for user persistent login
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        source TEXT DEFAULT 'Google Patents',
        patent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        abstract TEXT NOT NULL,
        url TEXT NOT NULL,
        confidence_score REAL,
        ai_reasoning TEXT,
        overlap_reasons TEXT,
        difference_reasons TEXT,
        FOREIGN KEY (search_id) REFERENCES searches (id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()

    # ── Safe migrations for existing databases ───────────────────────────────
    # Each ALTER TABLE is wrapped in try/except — silently skipped if column exists.

    migrations = [
        ("projects", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
        ("searches", "search_mode",  "TEXT DEFAULT 'manual'"),
        ("searches", "ai_queries",   "TEXT"),
        ("searches", "ai_cpc_codes", "TEXT"),
        ("searches", "ai_rationale", "TEXT"),
        ("patents",  "source",           "TEXT DEFAULT 'Google Patents'"),
        ("patents",  "confidence_score", "REAL"),
        ("patents",  "ai_reasoning",     "TEXT"),
        ("patents",  "overlap_reasons",   "TEXT"),
        ("patents",  "difference_reasons", "TEXT"),
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


# ── User Authentication Helpers ──────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def register_user(username: str, password: str) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        pwd_hash = hash_password(password)
        cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?);", (username, pwd_hash))
        conn.commit()
        user_id = cursor.lastrowid
        logger.info("[DB] Registered user: id=%d username='%s'", user_id, username)
        return user_id
    except sqlite3.IntegrityError:
        raise ValueError("Username already exists")
    finally:
        conn.close()

def verify_user(username: str, password: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    pwd_hash = hash_password(password)
    cursor.execute("SELECT id, username FROM users WHERE username = ? AND password_hash = ?;", (username, pwd_hash))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def create_session(user_id: int) -> str:
    session_id = secrets.token_hex(32)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO sessions (id, user_id) VALUES (?, ?);", (session_id, user_id))
        conn.commit()
        return session_id
    finally:
        conn.close()

def get_user_id_by_session(session_id: str) -> int:
    if not session_id:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM sessions WHERE id = ?;", (session_id,))
    row = cursor.fetchone()
    conn.close()
    return row["user_id"] if row else None

def delete_session(session_id: str):
    if not session_id:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions WHERE id = ?;", (session_id,))
    conn.commit()
    conn.close()


# ── Ownership Verifications ──────────────────────────────────────────────────

def verify_project_ownership(project_id: int, user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM projects WHERE id = ? AND user_id = ?;", (project_id, user_id))
    row = cursor.fetchone()
    conn.close()
    return row is not None

def verify_search_ownership(search_id: int, user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT 1 FROM searches s
        JOIN projects p ON s.project_id = p.id
        WHERE s.id = ? AND p.user_id = ?;
        """,
        (search_id, user_id),
    )
    row = cursor.fetchone()
    conn.close()
    return row is not None

def verify_patent_ownership(patent_id: int, user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT 1 FROM patents p
        JOIN searches s ON p.search_id = s.id
        JOIN projects pr ON s.project_id = pr.id
        WHERE p.id = ? AND pr.user_id = ?;
        """,
        (patent_id, user_id),
    )
    row = cursor.fetchone()
    conn.close()
    return row is not None


# ── Project CRUD ──────────────────────────────────────────────────────────────

def get_projects(user_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC;", (user_id,))
    rows = cursor.fetchall()
    projects = [dict(row) for row in rows]
    conn.close()
    return projects

def create_project(name: str, user_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO projects (name, user_id) VALUES (?, ?);", (name, user_id))
        conn.commit()
        project_id = cursor.lastrowid
        cursor.execute("SELECT * FROM projects WHERE id = ?;", (project_id,))
        project = dict(cursor.fetchone())
        logger.info("[DB] Created project: id=%d name='%s' for user_id=%d", project_id, name, user_id)
        return project
    except sqlite3.IntegrityError:
        # Check if this user owns a project with this name
        cursor.execute("SELECT * FROM projects WHERE name = ? AND user_id = ?;", (name, user_id))
        row = cursor.fetchone()
        if row:
            logger.warning("[DB] Project name '%s' already exists for user=%d — returning existing.", name, user_id)
            return dict(row)
        else:
            logger.warning("[DB] Project name '%s' is already taken by another user.", name)
            raise ValueError("Project name is already taken by another user.")
    except Exception as e:
        logger.error("[DB] create_project failed: %s", e, exc_info=True)
        raise
    finally:
        conn.close()

def delete_project(project_id: int, user_id: int):
    if not verify_project_ownership(project_id, user_id):
        raise PermissionError("Access denied")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM projects WHERE id = ?;", (project_id,))
    conn.commit()
    conn.close()
    logger.info("[DB] Deleted project id=%d for user_id=%d (cascade applied)", project_id, user_id)


# ── Search & Patent CRUD ──────────────────────────────────────────────────────

def create_search(
    project_id: int,
    query: str,
    search_mode: str = "manual",
    ai_queries: list = None,
    ai_cpc_codes: list = None,
    ai_rationale: str = None,
    user_id: int = None,
) -> int:
    if user_id is not None and not verify_project_ownership(project_id, user_id):
        raise PermissionError("Access denied")
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

def save_patents(search_id: int, patents: list[dict], user_id: int = None):
    if user_id is not None and not verify_search_ownership(search_id, user_id):
        raise PermissionError("Access denied")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        for p in patents:
            cursor.execute(
                """
                INSERT INTO patents
                    (search_id, source, patent_id, title, abstract, url, confidence_score, ai_reasoning)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    search_id,
                    p.get("source", "Google Patents"),
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

def get_project_data(project_id: int, user_id: int) -> list[dict]:
    if not verify_project_ownership(project_id, user_id):
        raise PermissionError("Access denied")
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

def get_search_results(search_id: int, user_id: int) -> dict:
    if not verify_search_ownership(search_id, user_id):
        raise PermissionError("Access denied")
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

def get_patents_by_ids(patent_ids: list[int], user_id: int) -> list[dict]:
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
        JOIN projects pr ON s.project_id = pr.id
        WHERE p.id IN ({placeholders}) AND pr.user_id = ?
        ORDER BY p.id ASC;
        """,
        (*patent_ids, user_id),
    )
    rows = cursor.fetchall()
    patents = [dict(row) for row in rows]
    conn.close()
    return patents

def get_all_project_patents(project_id: int, user_id: int) -> list[dict]:
    if not verify_project_ownership(project_id, user_id):
        raise PermissionError("Access denied")
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

def update_patent_audit(
    patent_id: int,
    confidence_score: float,
    reasoning: str,
    overlap_reasons: str = "",
    difference_reasons: str = "",
    user_id: int = None,
):
    if user_id is not None and not verify_patent_ownership(patent_id, user_id):
        raise PermissionError("Access denied")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE patents
            SET confidence_score = ?, ai_reasoning = ?,
                overlap_reasons = ?, difference_reasons = ?
            WHERE id = ?;
            """,
            (confidence_score, reasoning, overlap_reasons, difference_reasons, patent_id),
        )
        conn.commit()
    except Exception as e:
        logger.error("[DB] update_patent_audit failed for patent_id=%d: %s", patent_id, e, exc_info=True)
        raise
    finally:
        conn.close()
