import os
import sqlite3
import sys
from pathlib import Path

import psycopg2


ROOT = Path(__file__).resolve().parent
DEFAULT_SQLITE_DB = str(ROOT / "patent_lens.db")


def main():
    sqlite_path = os.environ.get("DB_PATH", DEFAULT_SQLITE_DB)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set. Export it first, for example from Render's Postgres add-on.")

    if not os.path.exists(sqlite_path):
        raise SystemExit(f"SQLite database not found at {sqlite_path}")

    from db import init_db

    init_db()

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()

    pg_conn = psycopg2.connect(database_url)
    pg_conn.autocommit = True
    pg_cur = pg_conn.cursor()

    tables = ["users", "sessions", "projects", "searches", "patents"]

    for table in tables:
        sqlite_cur.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
        if not sqlite_cur.fetchone():
            continue

        sqlite_cur.execute(f"PRAGMA table_info({table})")
        columns = [row[1] for row in sqlite_cur.fetchall()]
        sqlite_cur.execute(f"SELECT * FROM {table}")
        rows = sqlite_cur.fetchall()

        if not rows:
            continue

        placeholders = ", ".join(["%s"] * len(columns))
        column_sql = ", ".join(columns)
        insert_sql = f"INSERT INTO {table} ({column_sql}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING"
        for row in rows:
            values = [row[col] for col in columns]
            try:
                pg_cur.execute(insert_sql, values)
            except Exception as exc:
                print(f"Failed to migrate row into {table}: {exc}")
                raise

    sqlite_conn.close()
    pg_conn.close()
    print("SQLite data migration completed.")


if __name__ == "__main__":
    main()
