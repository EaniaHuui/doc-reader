"""Server-side trash: soft-delete, restore, permanent delete, expiry cleanup."""

from __future__ import annotations

import shutil
import uuid
from datetime import timedelta
from pathlib import Path

from .db import TRASH_DIR, db_cursor, ensure_data_dirs, init_db
from .errors import ApiError
from .meta_store import delete_meta
from .pathutil import file_type_for_path, resolve_in_root
from .timeutil import from_iso, to_iso, utc_now

TRASH_RETENTION_DAYS = 30


def _entry_dict(row) -> dict:
    return {
        'id': row['id'],
        'root_id': row['root_id'],
        'original_path': row['original_path'],
        'kind': row['kind'],
        'type': row['file_type'],
        'title': row['title'],
        'size_bytes': row['size_bytes'],
        'deleted_at': row['deleted_at'],
        'expires_at': row['expires_at'],
    }


def move_to_trash(root_id: str, rel_path: str) -> dict:
    """Move file or directory into trash. Never unlinks permanently here."""
    init_db()
    ensure_data_dirs()
    root, rel, abs_path = resolve_in_root(root_id, rel_path)

    if not abs_path.exists():
        raise ApiError('not_found', '资源不存在', 404)

    # Disallow trashing the root itself
    if rel == '':
        raise ApiError('invalid_path', '不能删除文档根', 422)

    kind = 'directory' if abs_path.is_dir() else 'file'
    file_type = None if kind == 'directory' else file_type_for_path(rel)
    title = abs_path.name
    size_bytes = 0
    if kind == 'file':
        try:
            size_bytes = abs_path.stat().st_size
        except OSError:
            size_bytes = 0
    else:
        try:
            size_bytes = sum(f.stat().st_size for f in abs_path.rglob('*') if f.is_file())
        except OSError:
            size_bytes = 0

    trash_id = uuid.uuid4().hex
    storage_name = trash_id
    dest = TRASH_DIR / storage_name
    # Avoid name collision (uuid is unique; still handle safely)
    if dest.exists():
        storage_name = f'{trash_id}_{uuid.uuid4().hex[:8]}'
        dest = TRASH_DIR / storage_name

    deleted_at = utc_now()
    expires_at = deleted_at + timedelta(days=TRASH_RETENTION_DAYS)

    try:
        shutil.move(str(abs_path), str(dest))
    except OSError as exc:
        raise ApiError('trash_failed', f'移入回收站失败: {exc}', 500) from exc

    with db_cursor(commit=True) as cur:
        cur.execute(
            'INSERT INTO trash_entries('
            'id, root_id, original_path, storage_name, kind, file_type, title, '
            'size_bytes, deleted_at, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
            (
                trash_id, root_id, rel, storage_name, kind, file_type, title,
                size_bytes, to_iso(deleted_at), to_iso(expires_at),
            ),
        )

    delete_meta(root_id, rel, is_dir=(kind == 'directory'))

    from .fts_index import remove_document, remove_under
    if kind == 'directory':
        remove_under(root_id, rel)
    else:
        remove_document(root_id, rel)

    return {
        'id': trash_id,
        'root_id': root_id,
        'original_path': rel,
        'kind': kind,
        'type': file_type,
        'title': title,
        'size_bytes': size_bytes,
        'deleted_at': to_iso(deleted_at),
        'expires_at': to_iso(expires_at),
    }


def list_trash() -> list[dict]:
    init_db()
    cleanup_expired(force=False)
    with db_cursor() as cur:
        rows = cur.execute(
            'SELECT * FROM trash_entries ORDER BY deleted_at DESC'
        ).fetchall()
    return [_entry_dict(r) for r in rows]


def get_trash(trash_id: str):
    init_db()
    with db_cursor() as cur:
        row = cur.execute(
            'SELECT * FROM trash_entries WHERE id = ?', (trash_id,)
        ).fetchone()
    return row


def restore_trash(trash_id: str, target_path: str | None = None) -> dict:
    init_db()
    row = get_trash(trash_id)
    if not row:
        raise ApiError('not_found', '回收站条目不存在', 404)

    root_id = row['root_id']
    dest_rel = target_path if target_path is not None else row['original_path']
    root, rel, abs_dest = resolve_in_root(root_id, dest_rel)

    if abs_dest.exists():
        raise ApiError(
            'path_exists',
            '目标路径已存在，请指定其他路径',
            409,
            conflict={'original_path': row['original_path'], 'target_path': rel},
        )

    src = TRASH_DIR / row['storage_name']
    if not src.exists():
        # Orphaned DB row — remove metadata
        with db_cursor(commit=True) as cur:
            cur.execute('DELETE FROM trash_entries WHERE id = ?', (trash_id,))
        raise ApiError('not_found', '回收站文件已丢失', 404)

    abs_dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(src), str(abs_dest))
    except OSError as exc:
        raise ApiError('restore_failed', f'恢复失败: {exc}', 500) from exc

    with db_cursor(commit=True) as cur:
        cur.execute('DELETE FROM trash_entries WHERE id = ?', (trash_id,))

    # Re-index
    from .fts_index import index_document, rescan_all
    if abs_dest.is_file():
        index_document(root_id, rel, abs_dest)
    else:
        # directory: index children
        for pattern in ('*.md', '*.markdown', '*.txt', '*.json'):
            for fp in abs_dest.rglob(pattern):
                if any(p.startswith('.') for p in fp.relative_to(root['path']).parts):
                    continue
                try:
                    child_rel = str(fp.resolve().relative_to(root['path'])).replace('\\', '/')
                    index_document(root_id, child_rel, fp)
                except ValueError:
                    continue

    return {
        'id': trash_id,
        'root_id': root_id,
        'path': rel,
        'restored': True,
    }


def permanent_delete(trash_id: str, *, confirm: bool) -> None:
    if not confirm:
        raise ApiError('confirmation_required', '需要 confirm=true 才能永久删除', 422)

    init_db()
    row = get_trash(trash_id)
    if not row:
        raise ApiError('not_found', '回收站条目不存在', 404)

    src = TRASH_DIR / row['storage_name']
    if src.exists():
        try:
            if src.is_dir():
                shutil.rmtree(src)
            else:
                src.unlink()
        except OSError as exc:
            raise ApiError('delete_failed', f'永久删除失败: {exc}', 500) from exc

    with db_cursor(commit=True) as cur:
        cur.execute('DELETE FROM trash_entries WHERE id = ?', (trash_id,))


def cleanup_expired(*, force: bool = True) -> int:
    """Idempotent cleanup of expired trash. Returns number removed.

    ``force`` is reserved for callers that always want a sweep; cleanup
    only removes entries whose expires_at is in the past.
    """
    init_db()
    now = utc_now()
    removed = 0
    with db_cursor() as cur:
        rows = cur.execute('SELECT * FROM trash_entries').fetchall()

    for row in rows:
        exp = from_iso(row['expires_at'])
        if exp is None or exp > now:
            continue
        src = TRASH_DIR / row['storage_name']
        try:
            if src.exists():
                if src.is_dir():
                    shutil.rmtree(src, ignore_errors=True)
                else:
                    src.unlink(missing_ok=True)
        except OSError:
            pass
        with db_cursor(commit=True) as cur:
            cur.execute('DELETE FROM trash_entries WHERE id = ?', (row['id'],))
        removed += 1
    return removed
