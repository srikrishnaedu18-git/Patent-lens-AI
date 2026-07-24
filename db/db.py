import sqlite3
import json
import logging
import hashlib
import secrets
from pathlib import Path
from datetime import datetime

import os

import psycopg2
import psycopg2.extras

logger = logging.getLogger("db")

DEFAULT_DB_PATH = Path(__file__).parent / "patent_lens.db"


def get_database_url() -> str:
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        return database_url

    db_path = os.environ.get("DB_PATH", str(DEFAULT_DB_PATH))
    return f"sqlite:///{Path(db_path).expanduser().resolve()}"


def get_database_backend() -> str:
    return "postgres" if os.environ.get("DATABASE_URL") else "sqlite"


def get_db_connection():
    database_url = get_database_url()
    if database_url.startswith("sqlite:///"):
        db_path = database_url[len("sqlite:///"):]
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    # Render Postgres requires SSL and benefits from a connect timeout.
    # Parse the URL to inject sslmode if not already present.
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
    parsed = urlparse(database_url)
    # Build extra connection kwargs
    connect_kwargs: dict = {
        "connect_timeout": 10,
    }
    # Only add sslmode if not already in the query string
    qs = parsed.query or ""
    if "sslmode" not in qs:
        connect_kwargs["sslmode"] = "require"
    conn = psycopg2.connect(database_url, **connect_kwargs)
    conn.autocommit = False
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def get_primary_key_definition() -> str:
    return "BIGSERIAL PRIMARY KEY" if get_database_backend() == "postgres" else "INTEGER PRIMARY KEY AUTOINCREMENT"


def add_column_sql(table: str, column: str, col_def: str) -> str:
    if get_database_backend() == "postgres":
        return f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {col_def};"
    return f"ALTER TABLE {table} ADD COLUMN {column} {col_def};"


def insert_and_get_id(cursor, statement: str, params=()):
    if get_database_backend() == "postgres":
        if "RETURNING" not in statement.upper():
            statement = f"{statement} RETURNING id"
        cursor.execute(statement, params)
        row = cursor.fetchone()
        if not row:
            return None
        return row["id"] if isinstance(row, dict) else row[0]

    cursor.execute(statement, params)
    return cursor.lastrowid


def sql_placeholder() -> str:
    return "%s" if get_database_backend() == "postgres" else "?"


def init_db():
    """
    Initialise database schema and apply safe migrations for new columns.
    Safe to call on every startup — uses IF NOT EXISTS / ALTER TABLE guards.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    pk_def = get_primary_key_definition()
    
    # ── Core tables ──────────────────────────────────────────────────────────

    # Users table
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS users (
        id {pk_def},
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Sessions table for user persistent login
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS projects (
        id {pk_def},
        user_id BIGINT,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    
    # searches now includes ai_queries (JSON array of generated query strings)
    # and search_mode to distinguish 'manual' vs 'ai' searches
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS searches (
        id {pk_def},
        project_id BIGINT NOT NULL,
        query TEXT NOT NULL,
        search_mode TEXT DEFAULT 'manual',
        ai_queries TEXT,
        ai_cpc_codes TEXT,
        ai_rationale TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
    );
    """)
    
    cursor.execute(f"""
    CREATE TABLE IF NOT EXISTS patents (
        id {pk_def},
        search_id BIGINT NOT NULL,
        source TEXT DEFAULT 'Google Patents',
        patent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        abstract TEXT NOT NULL,
        url TEXT NOT NULL,
        deep_scrape_text TEXT,
        deep_scraped_at TIMESTAMP,
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
        ("patents",  "deep_scrape_text", "TEXT"),
        ("patents",  "deep_scraped_at",  "TIMESTAMP"),
        ("patents",  "confidence_score", "REAL"),
        ("patents",  "ai_reasoning",     "TEXT"),
        ("patents",  "overlap_reasons",   "TEXT"),
        ("patents",  "difference_reasons", "TEXT"),
    ]

    for table, column, col_def in migrations:
        try:
            cursor.execute(add_column_sql(table, column, col_def))
            conn.commit()
            logger.info("[DB] Migration applied: ALTER TABLE %s ADD COLUMN %s", table, column)
        except (sqlite3.OperationalError, psycopg2.errors.DuplicateColumn, Exception) as e:
            err_str = str(e).lower()
            if "duplicate column" in err_str or "already exists" in err_str:
                logger.debug("[DB] Column %s.%s already exists — skipping migration.", table, column)
                conn.rollback()  # required for psycopg2 after an error
            else:
                logger.error("[DB] Unexpected migration error for %s.%s: %s", table, column, e)
                conn.rollback()
    
    conn.close()
    logger.info("[DB] Database initialised at: %s", get_database_url())


# ── User Authentication Helpers ──────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def register_user(username: str, password: str) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Check for case-sensitive username collision
        chk_query = (
            "SELECT id FROM users WHERE username = %s;"
            if get_database_backend() == "postgres"
            else "SELECT id FROM users WHERE username = ? COLLATE BINARY;"
        )
        cursor.execute(chk_query, (username,))
        if cursor.fetchone():
            raise ValueError("Username already exists")

        pwd_hash = hash_password(password)
        user_id = insert_and_get_id(
            cursor,
            "INSERT INTO users (username, password_hash) VALUES (%s, %s);" if get_database_backend() == "postgres" else "INSERT INTO users (username, password_hash) VALUES (?, ?);",
            (username, pwd_hash),
        )
        conn.commit()
        logger.info("[DB] Registered user: id=%s username='%s'", str(user_id), username)
        return user_id
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        conn.rollback()
        raise ValueError("Username already exists")
    except Exception as e:
        conn.rollback()
        logger.error("[DB] Exception in register_user: %s", e, exc_info=True)
        raise
    finally:
        conn.close()

def verify_user(username: str, password: str) -> dict:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        pwd_hash = hash_password(password)
        # Strictly case-sensitive username and password matching
        query = (
            "SELECT id, username FROM users WHERE username = %s AND password_hash = %s;"
            if get_database_backend() == "postgres"
            else "SELECT id, username FROM users WHERE username = ? COLLATE BINARY AND password_hash = ?;"
        )
        cursor.execute(query, (username, pwd_hash))
        row = cursor.fetchone()
        if row:
            user_dict = dict(row)
            if user_dict["username"] == username:
                return user_dict
        return None
    finally:
        conn.close()

def create_session(user_id: int) -> str:
    session_id = secrets.token_hex(32)
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO sessions (id, user_id) VALUES (%s, %s);" if get_database_backend() == "postgres" else "INSERT INTO sessions (id, user_id) VALUES (?, ?);",
            (session_id, user_id),
        )
        conn.commit()
        return session_id
    except Exception as e:
        conn.rollback()
        logger.error("[DB] Exception in create_session: %s", e, exc_info=True)
        raise
    finally:
        conn.close()

def get_user_id_by_session(session_id: str) -> int:
    if not session_id:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT user_id FROM sessions WHERE id = %s;" if get_database_backend() == "postgres" else "SELECT user_id FROM sessions WHERE id = ?;",
        (session_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return row["user_id"] if row else None

def delete_session(session_id: str):
    if not session_id:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM sessions WHERE id = %s;" if get_database_backend() == "postgres" else "DELETE FROM sessions WHERE id = ?;",
        (session_id,),
    )
    conn.commit()
    conn.close()


# ── Ownership Verifications ──────────────────────────────────────────────────

def verify_project_ownership(project_id: int, user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT 1 FROM projects WHERE id = %s AND user_id = %s;" if get_database_backend() == "postgres" else "SELECT 1 FROM projects WHERE id = ? AND user_id = ?;",
        (project_id, user_id),
    )
    row = cursor.fetchone()
    conn.close()
    return row is not None

def verify_search_ownership(search_id: int, user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    ph = sql_placeholder()
    cursor.execute(
        f"""
        SELECT 1 FROM searches s
        JOIN projects p ON s.project_id = p.id
        WHERE s.id = {ph} AND p.user_id = {ph};
        """,
        (search_id, user_id),
    )
    row = cursor.fetchone()
    conn.close()
    return row is not None

def verify_patent_ownership(patent_id: int, user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    ph = sql_placeholder()
    cursor.execute(
        f"""
        SELECT 1 FROM patents p
        JOIN searches s ON p.search_id = s.id
        JOIN projects pr ON s.project_id = pr.id
        WHERE p.id = {ph} AND pr.user_id = {ph};
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
    cursor.execute(
        "SELECT * FROM projects WHERE user_id = %s ORDER BY created_at DESC;" if get_database_backend() == "postgres" else "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC;",
        (user_id,),
    )
    rows = cursor.fetchall()
    projects = [dict(row) for row in rows]
    conn.close()
    return projects

def create_project(name: str, user_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        project_id = insert_and_get_id(
            cursor,
            "INSERT INTO projects (name, user_id) VALUES (%s, %s);" if get_database_backend() == "postgres" else "INSERT INTO projects (name, user_id) VALUES (?, ?);",
            (name, user_id),
        )
        conn.commit()
        cursor.execute(
            "SELECT * FROM projects WHERE id = %s;" if get_database_backend() == "postgres" else "SELECT * FROM projects WHERE id = ?;",
            (project_id,),
        )
        project = dict(cursor.fetchone())
        logger.info("[DB] Created project: id=%d name='%s' for user_id=%d", project_id, name, user_id)
        return project
    except (sqlite3.IntegrityError, psycopg2.IntegrityError):
        # Check if this user owns a project with this name
        cursor.execute(
            "SELECT * FROM projects WHERE name = %s AND user_id = %s;" if get_database_backend() == "postgres" else "SELECT * FROM projects WHERE name = ? AND user_id = ?;",
            (name, user_id),
        )
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
    cursor.execute(
        "DELETE FROM projects WHERE id = %s;" if get_database_backend() == "postgres" else "DELETE FROM projects WHERE id = ?;",
        (project_id,),
    )
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
    ph = sql_placeholder()
    try:
        query_clean = query.strip()
        base_kw = query_clean.split(" [")[0].strip().lower()

        if search_mode != "failed":
            # 1. Delete any old failed search entries for this query in this project
            cursor.execute(
                f"SELECT id, query FROM searches WHERE project_id = {ph} AND search_mode = 'failed';",
                (project_id,),
            )
            failed_rows = cursor.fetchall()
            for f_row in failed_rows:
                f_query = (f_row["query"] if isinstance(f_row, dict) else f_row[1]).strip().lower()
                f_base = f_query.split(" [")[0].strip().lower()
                if f_base == base_kw or f_query == query_clean.lower():
                    f_id = f_row["id"] if isinstance(f_row, dict) else f_row[0]
                    cursor.execute(f"DELETE FROM searches WHERE id = {ph};", (f_id,))

            # 2. Check if a search row for this query already exists
            cursor.execute(
                f"SELECT id FROM searches WHERE project_id = {ph} AND LOWER(query) = LOWER({ph});",
                (project_id, query_clean),
            )
            existing = cursor.fetchone()
            if existing:
                existing_id = existing["id"] if isinstance(existing, dict) else existing[0]
                cursor.execute(
                    f"""
                    UPDATE searches
                    SET created_at = CURRENT_TIMESTAMP, search_mode = {ph},
                        ai_queries = {ph}, ai_cpc_codes = {ph}, ai_rationale = {ph}
                    WHERE id = {ph};
                    """,
                    (
                        search_mode,
                        json.dumps(ai_queries) if ai_queries else None,
                        json.dumps(ai_cpc_codes) if ai_cpc_codes else None,
                        ai_rationale,
                        existing_id,
                    ),
                )
                conn.commit()
                logger.info("[DB] Updated search timestamp id=%d for query '%s'", existing_id, query_clean)
                return existing_id

        else:
            # If search_mode == 'failed', check if a successful search already exists
            cursor.execute(
                f"SELECT id FROM searches WHERE project_id = {ph} AND LOWER(query) = LOWER({ph}) AND search_mode != 'failed';",
                (project_id, query_clean),
            )
            existing_succ = cursor.fetchone()
            if existing_succ:
                conn.close()
                return existing_succ["id"] if isinstance(existing_succ, dict) else existing_succ[0]

            cursor.execute(
                f"SELECT id FROM searches WHERE project_id = {ph} AND LOWER(query) = LOWER({ph}) AND search_mode = 'failed';",
                (project_id, query_clean),
            )
            existing_fail = cursor.fetchone()
            if existing_fail:
                existing_id = existing_fail["id"] if isinstance(existing_fail, dict) else existing_fail[0]
                cursor.execute(
                    f"UPDATE searches SET created_at = CURRENT_TIMESTAMP WHERE id = {ph};",
                    (existing_id,),
                )
                conn.commit()
                return existing_id

        search_id = insert_and_get_id(
            cursor,
            """
            INSERT INTO searches
                (project_id, query, search_mode, ai_queries, ai_cpc_codes, ai_rationale)
            VALUES (%s, %s, %s, %s, %s, %s)
            """ if get_database_backend() == "postgres" else """
            INSERT INTO searches
                (project_id, query, search_mode, ai_queries, ai_cpc_codes, ai_rationale)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (
                project_id,
                query_clean,
                search_mode,
                json.dumps(ai_queries) if ai_queries else None,
                json.dumps(ai_cpc_codes) if ai_cpc_codes else None,
                ai_rationale,
            ),
        )
        conn.commit()
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
        ph = sql_placeholder()
        for p in patents:
            cursor.execute(
                f"""
                INSERT INTO patents
                    (search_id, source, patent_id, title, abstract, url, confidence_score, ai_reasoning)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
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
        f"SELECT * FROM searches WHERE project_id = {sql_placeholder()} ORDER BY created_at DESC;",
        (project_id,),
    )
    searches = [dict(row) for row in cursor.fetchall()]
    
    for s in searches:
        # Deserialise JSON columns
        for json_col in ("ai_queries", "ai_cpc_codes"):
            raw = s.get(json_col)
            s[json_col] = json.loads(raw) if raw else []

        cursor.execute(
            f"SELECT * FROM patents WHERE search_id = {sql_placeholder()} ORDER BY id ASC;",
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
    cursor.execute(f"SELECT * FROM searches WHERE id = {sql_placeholder()};", (search_id,))
    search_row = cursor.fetchone()
    if not search_row:
        conn.close()
        return {}
    
    search = dict(search_row)
    for json_col in ("ai_queries", "ai_cpc_codes"):
        raw = search.get(json_col)
        search[json_col] = json.loads(raw) if raw else []

    cursor.execute(f"SELECT * FROM patents WHERE search_id = {sql_placeholder()} ORDER BY id ASC;", (search_id,))
    search["patents"] = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return search

def get_patents_by_ids(patent_ids: list[int], user_id: int) -> list[dict]:
    if not patent_ids:
        return []
    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ",".join(sql_placeholder() for _ in patent_ids)
    cursor.execute(
        f"""
        SELECT p.*, s.query AS keywords, s.search_mode
        FROM patents p
        JOIN searches s ON p.search_id = s.id
        JOIN projects pr ON s.project_id = pr.id
        WHERE p.id IN ({placeholders}) AND pr.user_id = {sql_placeholder()}
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
        f"""
        SELECT p.*, s.query AS keywords, s.search_mode
        FROM patents p
        JOIN searches s ON p.search_id = s.id
        WHERE s.project_id = {sql_placeholder()}
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
        ph = sql_placeholder()
        cursor.execute(
            f"""
            UPDATE patents
            SET confidence_score = {ph}, ai_reasoning = {ph},
                overlap_reasons = {ph}, difference_reasons = {ph}
            WHERE id = {ph};
            """,
            (confidence_score, reasoning, overlap_reasons, difference_reasons, patent_id),
        )
        conn.commit()
    except Exception as e:
        logger.error("[DB] update_patent_audit failed for patent_id=%d: %s", patent_id, e, exc_info=True)
        raise
    finally:
        conn.close()


def update_patent_deep_scrape(
    patent_id: int,
    deep_scrape_text: str,
    user_id: int = None,
):
    if user_id is not None and not verify_patent_ownership(patent_id, user_id):
        raise PermissionError("Access denied")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        ph = sql_placeholder()
        cursor.execute(
            f"""
            UPDATE patents
            SET deep_scrape_text = {ph}, deep_scraped_at = CURRENT_TIMESTAMP
            WHERE id = {ph};
            """,
            (deep_scrape_text, patent_id),
        )
        conn.commit()
    except Exception as e:
        logger.error("[DB] update_patent_deep_scrape failed for patent_id=%d: %s", patent_id, e, exc_info=True)
        raise
    finally:
        conn.close()
