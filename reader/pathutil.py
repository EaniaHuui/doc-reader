"""Root-relative POSIX path validation and resolution."""

from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath

from .constants import IMAGE_EXTENSIONS
from .errors import ApiError
from .roots import get_root_or_raise

# Allowed editable / listable types
TEXT_TYPES = {'markdown', 'txt', 'json'}
IMAGE_TYPES = {'image'}
SUPPORTED_TYPES = TEXT_TYPES | IMAGE_TYPES

EXT_TO_TYPE = {
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.txt': 'txt',
    '.json': 'json',
}
for _ext in IMAGE_EXTENSIONS:
    EXT_TO_TYPE[_ext] = 'image'

TYPE_TO_EXT = {
    'markdown': '.md',
    'txt': '.txt',
    'json': '.json',
}

_INVALID_NAME = re.compile(r'[\x00-\x1f\\]')


def normalize_rel_path(path: str | None, *, allow_empty: bool = False) -> str:
    """Normalize a root-relative POSIX path. Reject traversal and absolute forms."""
    if path is None or path == '':
        if allow_empty:
            return ''
        raise ApiError('invalid_path', '路径不能为空', 422)

    if not isinstance(path, str):
        raise ApiError('invalid_path', '路径格式无效', 422)

    raw = path.replace('\\', '/').strip()
    if raw.startswith('/'):
        raise ApiError('invalid_path', '路径必须是相对于文档根的相对路径', 422)
    if '\x00' in raw:
        raise ApiError('invalid_path', '路径包含非法字符', 422)

    pure = PurePosixPath(raw)
    parts = []
    for part in pure.parts:
        if part in ('', '.'):
            continue
        if part == '..':
            raise ApiError('invalid_path', '路径不允许包含 ..', 422)
        if part in ('.', '..') or _INVALID_NAME.search(part):
            raise ApiError('invalid_path', '路径包含非法字符', 422)
        if part.startswith('/') or ':' in part and os.name == 'nt':
            raise ApiError('invalid_path', '路径格式无效', 422)
        parts.append(part)

    normalized = '/'.join(parts)
    if not normalized and not allow_empty:
        raise ApiError('invalid_path', '路径不能为空', 422)
    return normalized


def file_type_for_path(rel_path: str) -> str | None:
    ext = Path(rel_path).suffix.lower()
    return EXT_TO_TYPE.get(ext)


def is_editable_type(doc_type: str | None) -> bool:
    return doc_type in TEXT_TYPES


def is_supported_type(doc_type: str | None) -> bool:
    return doc_type in SUPPORTED_TYPES


def resolve_in_root(root_id: str, rel_path: str | None, *, allow_empty: bool = False) -> tuple[dict, str, Path]:
    """Return (root, normalized_rel_path, absolute Path) fully contained in root.

    Rejects symlink escape: final resolved path must stay under root abs_path.
    """
    root = get_root_or_raise(root_id)
    rel = normalize_rel_path(rel_path, allow_empty=allow_empty)
    root_path: Path = root['path']

    if not root_path.exists() or not root_path.is_dir():
        raise ApiError('root_unavailable', '文档根不可用', 403)

    if rel == '':
        target = root_path
    else:
        # Build without resolving intermediate symlinks first
        target = root_path.joinpath(*rel.split('/'))

    try:
        resolved = target.resolve(strict=False)
        root_resolved = root_path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ApiError('invalid_path', f'无法解析路径: {exc}', 422) from exc

    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise ApiError('path_escape', '路径超出文档根范围', 403) from exc

    # If the path exists and is a symlink, ensure it does not escape
    if target.exists() or target.is_symlink():
        try:
            real = target.resolve(strict=True)
            real.relative_to(root_resolved)
        except (ValueError, OSError) as exc:
            raise ApiError('path_escape', '符号链接指向文档根之外', 403) from exc
        resolved = real

    return root, rel, resolved


def assert_parent_exists(abs_path: Path) -> None:
    parent = abs_path.parent
    if not parent.exists() or not parent.is_dir():
        raise ApiError('parent_missing', '父目录不存在', 422)


def validate_entry_name(name: str) -> None:
    if not name or name in ('.', '..'):
        raise ApiError('invalid_name', '无效的名称', 422)
    if '/' in name or '\\' in name or '\x00' in name:
        raise ApiError('invalid_name', '名称包含非法字符', 422)
    if re.search(r'[:*?"<>|]', name):
        raise ApiError('invalid_name', '名称包含非法字符', 422)
