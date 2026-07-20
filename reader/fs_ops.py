"""Directory tree listing, search, and text file reading."""

from __future__ import annotations

import html
import json
from datetime import datetime
from pathlib import Path

from .constants import SEARCH_FILE_GLOBS, SEARCH_MAX_FILE_BYTES, SEARCH_MAX_RESULTS
from .paths import expand_path, simplify_path


def build_directory_node(
    path,
    name=None,
    children=None,
    is_loaded=False,
    has_children=False,
    is_empty=False,
):
    path = expand_path(path)
    return {
        'name': name or path.name,
        'path': simplify_path(path),
        'type': 'directory',
        'children': children or [],
        'children_loaded': is_loaded,
        'has_children': has_children,
        'is_empty': is_empty,
    }


def directory_has_visible_children(path, file_types=None) -> bool:
    if file_types is None:
        file_types = ['.md']

    path = expand_path(path)
    if not path.exists() or not path.is_dir():
        return False

    normalized_file_types = {file_type.lower() for file_type in file_types}

    try:
        for item in path.iterdir():
            if item.name.startswith('.'):
                continue
            if item.is_dir():
                return True
            if item.suffix.lower() in normalized_file_types:
                return True
    except (PermissionError, OSError):
        return False

    return False


def get_directory_listing(path, name=None, file_types=None):
    if file_types is None:
        file_types = ['.md']

    path = expand_path(path)
    if not path.exists() or not path.is_dir():
        return None

    try:
        items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    except (PermissionError, OSError):
        items = []

    normalized_file_types = {file_type.lower() for file_type in file_types}
    children = []

    for item in items:
        if item.name.startswith('.'):
            continue

        if item.is_dir():
            child_has_children = directory_has_visible_children(item, file_types)
            children.append(
                build_directory_node(
                    item,
                    name=item.name,
                    children=[],
                    is_loaded=False,
                    has_children=child_has_children,
                    is_empty=not child_has_children,
                )
            )
        elif item.suffix.lower() in normalized_file_types:
            children.append(
                {
                    'name': item.name,
                    'path': simplify_path(item),
                    'type': 'file',
                    'ext': item.suffix.lower(),
                }
            )

    has_children = len(children) > 0
    return build_directory_node(
        path,
        name=name or path.name,
        children=children,
        is_loaded=True,
        has_children=has_children,
        is_empty=not has_children,
    )


def _make_snippet(content: str, query_lower: str, radius: int = 40) -> str:
    """Return a short plain-text excerpt around the first case-insensitive hit."""
    if not content or not query_lower:
        return ''
    lower = content.lower()
    idx = lower.find(query_lower)
    if idx < 0:
        # fallback: first non-empty line
        for line in content.splitlines():
            line = line.strip()
            if line:
                return (line[: radius * 2] + '…') if len(line) > radius * 2 else line
        return ''

    start = max(0, idx - radius)
    end = min(len(content), idx + len(query_lower) + radius)
    snippet = content[start:end].replace('\n', ' ').replace('\r', ' ')
    snippet = ' '.join(snippet.split())
    if start > 0:
        snippet = '…' + snippet
    if end < len(content):
        snippet = snippet + '…'
    return snippet


def _search_hit(doc_file, directory_name: str, query_lower: str, content: str | None = None):
    """Build one search hit. Prefer simplified (~) paths for UI consistency."""
    name_match = query_lower in doc_file.name.lower()
    snippet = ''
    match_in = 'name' if name_match else 'content'

    if content is not None and query_lower in content.lower():
        if not name_match:
            match_in = 'content'
        snippet = _make_snippet(content, query_lower)
    elif name_match:
        match_in = 'name'
        if content:
            snippet = _make_snippet(content, query_lower) or ''

    # score: name hits first, then content
    score = 0 if name_match else 1

    return {
        'name': doc_file.name,
        'path': simplify_path(doc_file),
        'directory': directory_name,
        'snippet': snippet,
        'match': match_in,
        'score': score,
    }


def search_files(query, directories):
    """Full-text + filename search across configured roots.

    Returns up to SEARCH_MAX_RESULTS hits, name matches ranked first.
    Paths use simplified ~/ form so they match the file tree.
    """
    from .constants import SEARCH_SNIPPET_RADIUS

    query_lower = (query or '').strip().lower()
    if not query_lower:
        return []

    name_hits = []
    content_hits = []

    for directory in directories:
        root = expand_path(directory['path'])
        if not root.exists():
            continue

        dir_name = directory.get('name') or root.name

        for pattern in SEARCH_FILE_GLOBS:
            if len(name_hits) + len(content_hits) >= SEARCH_MAX_RESULTS * 3:
                # gather a bit more than needed then rank/cut
                break

            for doc_file in root.rglob(pattern):
                try:
                    if doc_file.name.startswith('.'):
                        continue

                    size = doc_file.stat().st_size
                    name_match = query_lower in doc_file.name.lower()

                    if size > SEARCH_MAX_FILE_BYTES:
                        if name_match:
                            name_hits.append(
                                _search_hit(doc_file, dir_name, query_lower, content=None)
                            )
                        continue

                    # Always check name cheaply; only read file if needed or for snippet
                    if name_match:
                        try:
                            with open(doc_file, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read(SEARCH_MAX_FILE_BYTES)
                        except (OSError, UnicodeError):
                            content = None
                        name_hits.append(_search_hit(doc_file, dir_name, query_lower, content))
                        continue

                    with open(doc_file, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read(SEARCH_MAX_FILE_BYTES)

                    if query_lower in content.lower():
                        content_hits.append(
                            _search_hit(doc_file, dir_name, query_lower, content)
                        )
                except (OSError, UnicodeError):
                    continue

    # name matches first, stable order within group
    combined = name_hits + content_hits
    # de-dupe by path
    seen = set()
    unique = []
    for hit in combined:
        key = hit['path']
        if key in seen:
            continue
        seen.add(key)
        unique.append(hit)

    unique.sort(key=lambda h: (h.get('score', 1), h.get('name', '').lower()))
    # strip internal score before return
    results = []
    for hit in unique[:SEARCH_MAX_RESULTS]:
        hit = dict(hit)
        hit.pop('score', None)
        results.append(hit)
    return results


def read_text_file(file_path, file_ext):
    file_path = Path(file_path)
    if not file_path.exists():
        return None, '文件不存在'

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        raw_json = None
        if file_ext == '.json':
            try:
                json_obj = json.loads(content)
                content = json.dumps(json_obj, ensure_ascii=False, indent=2)
                raw_json = content
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

        escaped_content = html.escape(content)
        mtime = file_path.stat().st_mtime
        modified_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')

        result = {
            'title': file_path.name,
            'content': f'<pre class="text-file-content">{escaped_content}</pre>',
            'path': simplify_path(file_path),
            'size': file_path.stat().st_size,
            'modified': modified_time,
        }
        if raw_json:
            result['rawJson'] = raw_json
        return result, None
    except Exception as e:
        return None, str(e)
