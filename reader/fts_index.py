"""SQLite FTS5 full-text index for Markdown, TXT, and JSON."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from .constants import SEARCH_MAX_RESULTS, SEARCH_SNIPPET_RADIUS
from .db import db_cursor, init_db
from .pathutil import EXT_TO_TYPE, file_type_for_path, is_editable_type
from .roots import list_roots
from .timeutil import from_mtime, to_iso

logger = logging.getLogger(__name__)

_index_lock = threading.Lock()
INDEXABLE_EXTS = {'.md', '.markdown', '.txt', '.json'}


def _title_from_path(rel_path: str, content: str | None = None) -> str:
    name = Path(rel_path).name
    stem = Path(name).stem
    if content and Path(name).suffix.lower() in {'.md', '.markdown'}:
        for line in content.splitlines()[:20]:
            line = line.strip()
            if line.startswith('# '):
                return line[2:].strip() or stem
    return stem or name


def index_document(root_id: str, rel_path: str, abs_path: Path | None = None) -> None:
    """Idempotent index update for one file. Never mutates the source file."""
    init_db()
    if abs_path is None:
        from .pathutil import resolve_in_root
        try:
            _, rel_path, abs_path = resolve_in_root(root_id, rel_path)
        except Exception:
            remove_document(root_id, rel_path)
            return

    doc_type = file_type_for_path(rel_path)
    if not is_editable_type(doc_type):
        remove_document(root_id, rel_path)
        return

    if not abs_path.exists() or not abs_path.is_file():
        remove_document(root_id, rel_path)
        return

    try:
        data = abs_path.read_bytes()
        content = data.decode('utf-8', errors='replace')
        st = abs_path.stat()
        title = _title_from_path(rel_path, content)
        modified_at = from_mtime(st.st_mtime)
        size_bytes = st.st_size
        content_hash = __import__('hashlib').sha256(data).hexdigest()
    except OSError as exc:
        logger.warning('index read failed %s: %s', abs_path, exc)
        return

    with _index_lock:
        with db_cursor(commit=True) as cur:
            cur.execute(
                'DELETE FROM documents_fts WHERE root_id = ? AND path = ?',
                (root_id, rel_path),
            )
            cur.execute(
                'INSERT INTO documents_fts(title, content, doc_type, path, root_id, modified_at) '
                'VALUES(?, ?, ?, ?, ?, ?)',
                (title, content, doc_type, rel_path, root_id, modified_at),
            )
            cur.execute(
                'INSERT INTO documents_meta(root_id, path, title, doc_type, modified_at, '
                'size_bytes, content_hash, indexed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?) '
                'ON CONFLICT(root_id, path) DO UPDATE SET '
                'title=excluded.title, doc_type=excluded.doc_type, '
                'modified_at=excluded.modified_at, size_bytes=excluded.size_bytes, '
                'content_hash=excluded.content_hash, indexed_at=excluded.indexed_at',
                (root_id, rel_path, title, doc_type, modified_at, size_bytes,
                 content_hash, to_iso()),
            )


def remove_document(root_id: str, rel_path: str) -> None:
    init_db()
    with _index_lock:
        with db_cursor(commit=True) as cur:
            cur.execute(
                'DELETE FROM documents_fts WHERE root_id = ? AND path = ?',
                (root_id, rel_path),
            )
            cur.execute(
                'DELETE FROM documents_meta WHERE root_id = ? AND path = ?',
                (root_id, rel_path),
            )


def rename_document(root_id: str, from_path: str, to_path: str, is_dir: bool) -> None:
    from .roots import get_root

    if is_dir:
        remove_under(root_id, from_path)
        root = get_root(root_id)
        if not root:
            return
        abs_to = root['path'] / Path(to_path)
        if not abs_to.is_dir():
            return
        for pattern in ('*.md', '*.markdown', '*.txt', '*.json'):
            for fp in abs_to.rglob(pattern):
                if any(part.startswith('.') for part in fp.parts):
                    continue
                try:
                    rel = str(fp.resolve().relative_to(root['path'])).replace('\\', '/')
                except ValueError:
                    continue
                index_document(root_id, rel, fp)
        return

    remove_document(root_id, from_path)
    index_document(root_id, to_path)


def remove_under(root_id: str, prefix: str) -> None:
    init_db()
    like = prefix.rstrip('/') + '/%'
    with _index_lock:
        with db_cursor(commit=True) as cur:
            cur.execute(
                'DELETE FROM documents_fts WHERE root_id = ? AND (path = ? OR path LIKE ?)',
                (root_id, prefix, like),
            )
            cur.execute(
                'DELETE FROM documents_meta WHERE root_id = ? AND (path = ? OR path LIKE ?)',
                (root_id, prefix, like),
            )


def rescan_all() -> int:
    """Safe full rescan of all configured roots. Returns indexed file count."""
    init_db()
    count = 0
    roots = list_roots(include_abs=True)
    # Clear and rebuild
    with _index_lock:
        with db_cursor(commit=True) as cur:
            cur.execute('DELETE FROM documents_fts')
            cur.execute('DELETE FROM documents_meta')

    for root in roots:
        root_id = root['root_id']
        root_path = Path(root['abs_path'])
        if not root_path.exists():
            continue
        for ext in INDEXABLE_EXTS:
            try:
                for fp in root_path.rglob(f'*{ext}'):
                    if any(part.startswith('.') for part in fp.parts):
                        continue
                    if not fp.is_file():
                        continue
                    try:
                        rel = str(fp.resolve().relative_to(root_path.resolve())).replace('\\', '/')
                    except ValueError:
                        continue
                    index_document(root_id, rel, fp)
                    count += 1
            except OSError as exc:
                logger.warning('rescan error under %s: %s', root_path, exc)
    return count


def search(query: str, *, limit: int = 20, cursor: str | None = None) -> dict:
    """FTS search. Returns {results, next_cursor} without full content."""
    init_db()
    q = (query or '').strip()
    if not q:
        return {'results': [], 'next_cursor': None}

    limit = max(1, min(int(limit or 20), SEARCH_MAX_RESULTS))
    offset = 0
    if cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            offset = 0

    # Escape FTS special chars simply: quote tokens
    tokens = [t for t in q.replace('"', ' ').split() if t]
    if not tokens:
        return {'results': [], 'next_cursor': None}
    fts_query = ' '.join(f'"{t}"' for t in tokens)

    with db_cursor() as cur:
        try:
            rows = cur.execute(
                'SELECT root_id, path, title, doc_type, modified_at, '
                'snippet(documents_fts, 1, \'«\', \'»\', \'…\', 12) AS snip, '
                'bm25(documents_fts) AS rank '
                'FROM documents_fts WHERE documents_fts MATCH ? '
                'ORDER BY rank LIMIT ? OFFSET ?',
                (fts_query, limit + 1, offset),
            ).fetchall()
        except Exception:
            # Fallback: LIKE scan on meta+content via fts
            like = f'%{q}%'
            rows = cur.execute(
                'SELECT root_id, path, title, doc_type, modified_at, '
                'substr(content, 1, 80) AS snip, 0 AS rank '
                'FROM documents_fts WHERE title LIKE ? OR content LIKE ? '
                'ORDER BY CASE WHEN title LIKE ? THEN 0 ELSE 1 END, title '
                'LIMIT ? OFFSET ?',
                (like, like, like, limit + 1, offset),
            ).fetchall()

    from .meta_store import is_pinned
    from .documents_service import build_summary_from_disk

    results = []
    for row in rows[:limit]:
        root_id = row['root_id']
        path = row['path']
        title = row['title'] or Path(path).stem
        title_match = q.lower() in title.lower() or q.lower() in Path(path).name.lower()
        summary = build_summary_from_disk(root_id, path) or {
            'root_id': root_id,
            'path': path,
            'title': title,
            'type': row['doc_type'] or file_type_for_path(path) or 'markdown',
            'modified_at': row['modified_at'],
            'size_bytes': 0,
            'pinned': is_pinned(root_id, path),
        }
        snippet = (row['snip'] or '').replace('\n', ' ').strip()
        if not snippet:
            snippet = _make_snippet_from_title(title, q)
        results.append({
            'document': summary,
            'snippet': snippet,
            'title_match': title_match,
        })

    # Prefer title matches first among same page
    results.sort(key=lambda r: (0 if r['title_match'] else 1))

    next_cursor = str(offset + limit) if len(rows) > limit else None
    return {'results': results, 'next_cursor': next_cursor}


def _make_snippet_from_title(title: str, query: str) -> str:
    return title[: SEARCH_SNIPPET_RADIUS * 2]


def schedule_index_update(root_id: str, rel_path: str, action: str = 'upsert') -> None:
    """Fire-and-forget index update; failures never touch source files."""
    def _run():
        try:
            if action == 'delete':
                remove_document(root_id, rel_path)
            else:
                index_document(root_id, rel_path)
        except Exception as exc:
            logger.warning('index update failed %s %s: %s', action, rel_path, exc)

    threading.Thread(target=_run, daemon=True).start()
