"""SQLite storage for server-owned metadata (FTS, pins, trash, pairing, migration)."""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .storage import BASE_DIR

DATA_DIR = BASE_DIR / 'data'
DB_PATH = DATA_DIR / 'doc_reader.db'
TRASH_DIR = DATA_DIR / 'trash'

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS migration_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roots (
    root_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    abs_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pins (
    root_id TEXT NOT NULL,
    path TEXT NOT NULL,
    pinned_at TEXT NOT NULL,
    PRIMARY KEY (root_id, path)
);

CREATE TABLE IF NOT EXISTS recent (
    root_id TEXT NOT NULL,
    path TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    PRIMARY KEY (root_id, path)
);

CREATE TABLE IF NOT EXISTS trash_entries (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL,
    original_path TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_type TEXT,
    title TEXT,
    size_bytes INTEGER,
    deleted_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_sessions (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    revoked_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents_meta (
    root_id TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    doc_type TEXT,
    modified_at TEXT,
    size_bytes INTEGER,
    content_hash TEXT,
    indexed_at TEXT,
    PRIMARY KEY (root_id, path)
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title,
    content,
    doc_type UNINDEXED,
    path UNINDEXED,
    root_id UNINDEXED,
    modified_at UNINDEXED,
    tokenize = 'unicode61'
);
"""


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TRASH_DIR.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    conn = getattr(_local, 'conn', None)
    if conn is None:
        ensure_data_dirs()
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        _local.conn = conn
    return conn


@contextmanager
def db_cursor(commit: bool = False) -> Iterator[sqlite3.Cursor]:
    conn = get_connection()
    cur = conn.cursor()
    try:
        yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def init_db() -> None:
    """Create schema once per process."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        ensure_data_dirs()
        conn = get_connection()
        conn.executescript(SCHEMA)
        conn.commit()
        _initialized = True


def get_migration_value(key: str) -> str | None:
    with db_cursor() as cur:
        row = cur.execute(
            'SELECT value FROM migration_state WHERE key = ?', (key,)
        ).fetchone()
        return row['value'] if row else None


def set_migration_value(key: str, value: str) -> None:
    with db_cursor(commit=True) as cur:
        cur.execute(
            'INSERT INTO migration_state(key, value) VALUES(?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            (key, value),
        )


def reset_db_for_tests(db_path: Path | None = None) -> None:
    """Test helper: close connection and point at a fresh db."""
    global _initialized, DB_PATH
    conn = getattr(_local, 'conn', None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None
    if db_path is not None:
        DB_PATH = Path(db_path)
    _initialized = False
    init_db()
