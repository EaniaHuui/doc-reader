"""Configured document roots with opaque root_id."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from .db import db_cursor, init_db
from .storage import load_directories_config, save_directories_config
from .timeutil import to_iso


def _stable_root_id(abs_path: str) -> str:
    digest = hashlib.sha256(abs_path.encode('utf-8')).hexdigest()[:16]
    return f'root_{digest}'


def expand_abs(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def sync_roots_from_config() -> list[dict]:
    """Import directories.json / config into SQLite roots table.

    Existing root_id values for the same abs_path are preserved.
    Documents are never moved.
    """
    init_db()
    directories = load_directories_config()
    now = to_iso()
    roots = []

    with db_cursor(commit=True) as cur:
        existing = {
            row['abs_path']: dict(row)
            for row in cur.execute('SELECT * FROM roots').fetchall()
        }
        seen_abs = set()

        for directory in directories:
            name = (directory.get('name') or '').strip() or '未命名'
            raw_path = directory.get('path') or ''
            if not raw_path:
                continue
            abs_path = str(expand_abs(raw_path))
            seen_abs.add(abs_path)

            if abs_path in existing:
                root_id = existing[abs_path]['root_id']
                cur.execute(
                    'UPDATE roots SET name = ? WHERE root_id = ?',
                    (name, root_id),
                )
            else:
                # Prefer configured root_id if present and free
                root_id = directory.get('root_id') or _stable_root_id(abs_path)
                clash = cur.execute(
                    'SELECT 1 FROM roots WHERE root_id = ?', (root_id,)
                ).fetchone()
                if clash:
                    root_id = f'root_{uuid.uuid4().hex[:16]}'
                cur.execute(
                    'INSERT INTO roots(root_id, name, abs_path, created_at) '
                    'VALUES(?, ?, ?, ?)',
                    (root_id, name, abs_path, now),
                )

            roots.append({
                'root_id': root_id if abs_path not in existing else existing[abs_path]['root_id'],
                'name': name,
                'path': '',  # relative display of root itself
                'abs_path': abs_path,
            })

        # Re-read after upserts for accurate ids/names
        rows = cur.execute('SELECT * FROM roots ORDER BY name COLLATE NOCASE').fetchall()
        # Drop roots no longer in config
        for row in rows:
            if row['abs_path'] not in seen_abs:
                cur.execute('DELETE FROM roots WHERE root_id = ?', (row['root_id'],))

        roots = [
            {
                'root_id': row['root_id'],
                'name': row['name'],
                'path': '',
                'abs_path': row['abs_path'],
            }
            for row in cur.execute(
                'SELECT * FROM roots ORDER BY name COLLATE NOCASE'
            ).fetchall()
            if row['abs_path'] in seen_abs
        ]

    return roots


def list_roots(include_abs: bool = False) -> list[dict]:
    init_db()
    with db_cursor() as cur:
        rows = cur.execute(
            'SELECT root_id, name, abs_path FROM roots ORDER BY name COLLATE NOCASE'
        ).fetchall()
    result = []
    for row in rows:
        item = {
            'root_id': row['root_id'],
            'name': row['name'],
            'path': '',
        }
        if include_abs:
            item['abs_path'] = row['abs_path']
            item['configured_path'] = _display_configured_path(row['abs_path'])
        result.append(item)
    return result


def _display_configured_path(abs_path: str) -> str:
    home = str(Path.home())
    if abs_path.startswith(home):
        return '~' + abs_path[len(home):]
    return abs_path


def get_root(root_id: str) -> dict | None:
    init_db()
    with db_cursor() as cur:
        row = cur.execute(
            'SELECT root_id, name, abs_path FROM roots WHERE root_id = ?',
            (root_id,),
        ).fetchone()
    if not row:
        return None
    return {
        'root_id': row['root_id'],
        'name': row['name'],
        'abs_path': row['abs_path'],
        'path': Path(row['abs_path']),
    }


def get_root_or_raise(root_id: str) -> dict:
    from .errors import ApiError
    root = get_root(root_id)
    if not root:
        raise ApiError('root_not_found', '文档根不存在', 404)
    return root


def update_directories_and_sync(directories: list[dict]) -> list[dict]:
    """Persist directory config and resync roots table."""
    cleaned = []
    for directory in directories:
        name = (directory.get('name') or '').strip()
        path = (directory.get('path') or '').strip()
        if not name or not path:
            from .errors import ApiError
            raise ApiError('validation_error', '目录名称和路径不能为空', 422)
        abs_path = expand_abs(path)
        if not abs_path.exists() or not abs_path.is_dir():
            from .errors import ApiError
            raise ApiError('path_not_found', f'路径不存在: {path}', 422)
        entry = {'name': name, 'path': path}
        if directory.get('root_id'):
            entry['root_id'] = directory['root_id']
        cleaned.append(entry)

    save_directories_config(cleaned)
    return sync_roots_from_config()
