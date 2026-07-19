import importlib
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def test_database_url_preferred_over_db_path(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_PATH", "/tmp/test.sqlite")
    db = importlib.reload(importlib.import_module("db"))
    assert db.get_database_url() == "sqlite:////tmp/test.sqlite"


def test_database_url_uses_postgres_when_available(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@host:5432/db")
    monkeypatch.delenv("DB_PATH", raising=False)
    db = importlib.reload(importlib.import_module("db"))
    assert db.get_database_url() == "postgresql://user:pass@host:5432/db"
