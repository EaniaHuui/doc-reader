"""Pins and recent documents (server-side)."""

from __future__ import annotations

from .db import db_cursor, init_db
from .timeutil import to_iso

RECENT_LIMIT = 50


def set_pin(root_id: str, path: str, pinned: bool) -> None:
    init_db()
    with db_cursor(commit=True) as cur:
        if pinned:
            cur.execute(
                'INSERT INTO pins(root_id, path, pinned_at) VALUES(?, ?, ?) '
                'ON CONFLICT(root_id, path) DO UPDATE SET pinned_at = excluded.pinned_at',
                (root_id, path, to_iso()),
            )
        else:
            cur.execute(
                'DELETE FROM pins WHERE root_id = ? AND path = ?',
                (root_id, path),
            )


def is_pinned(root_id: str, path: str) -> bool:
    init_db()
    with db_cursor() as cur:
        row = cur.execute(
            'SELECT 1 FROM pins WHERE root_id = ? AND path = ?',
            (root_id, path),
        ).fetchone()
        return row is not None


def list_pins() -> list[tuple[str, str]]:
    init_db()
    with db_cursor() as cur:
        rows = cur.execute(
            'SELECT root_id, path FROM pins ORDER BY pinned_at DESC'
        ).fetchall()
    return [(r['root_id'], r['path']) for r in rows]


def record_opened(root_id: str, path: str) -> None:
    init_db()
    with db_cursor(commit=True) as cur:
        cur.execute(
            'INSERT INTO recent(root_id, path, opened_at) VALUES(?, ?, ?) '
            'ON CONFLICT(root_id, path) DO UPDATE SET opened_at = excluded.opened_at',
            (root_id, path, to_iso()),
        )
        # Trim old entries
        cur.execute(
            'DELETE FROM recent WHERE rowid NOT IN ('
            '  SELECT rowid FROM recent ORDER BY opened_at DESC LIMIT ?'
            ')',
            (RECENT_LIMIT,),
        )


def list_recent(limit: int = 20) -> list[tuple[str, str]]:
    init_db()
    with db_cursor() as cur:
        rows = cur.execute(
            'SELECT root_id, path FROM recent ORDER BY opened_at DESC LIMIT ?',
            (limit,),
        ).fetchall()
    return [(r['root_id'], r['path']) for r in rows]


def rename_meta(root_id: str, from_path: str, to_path: str, is_dir: bool) -> None:
    """Update pins/recent paths after move/rename."""
    init_db()
    with db_cursor(commit=True) as cur:
        if is_dir:
            prefix = from_path.rstrip('/') + '/'
            for table in ('pins', 'recent'):
                rows = cur.execute(
                    f'SELECT path FROM {table} WHERE root_id = ? AND '
                    f'(path = ? OR path LIKE ?)',
                    (root_id, from_path, prefix + '%'),
                ).fetchall()
                for row in rows:
                    old = row['path']
                    if old == from_path:
                        new = to_path
                    else:
                        new = to_path + old[len(from_path):]
                    cur.execute(
                        f'UPDATE {table} SET path = ? WHERE root_id = ? AND path = ?',
                        (new, root_id, old),
                    )
        else:
            for table in ('pins', 'recent'):
                cur.execute(
                    f'UPDATE {table} SET path = ? WHERE root_id = ? AND path = ?',
                    (to_path, root_id, from_path),
                )


def delete_meta(root_id: str, path: str, is_dir: bool) -> None:
    init_db()
    with db_cursor(commit=True) as cur:
        if is_dir:
            prefix = path.rstrip('/') + '/'
            for table in ('pins', 'recent'):
                cur.execute(
                    f'DELETE FROM {table} WHERE root_id = ? AND (path = ? OR path LIKE ?)',
                    (root_id, path, prefix + '%'),
                )
        else:
            for table in ('pins', 'recent'):
                cur.execute(
                    f'DELETE FROM {table} WHERE root_id = ? AND path = ?',
                    (root_id, path),
                )
