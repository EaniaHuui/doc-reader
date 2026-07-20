"""Document read/write/move operations with revision checks."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from .errors import ApiError
from .meta_store import is_pinned, rename_meta, delete_meta
from .pathutil import (
    TYPE_TO_EXT,
    assert_parent_exists,
    file_type_for_path,
    is_editable_type,
    is_supported_type,
    resolve_in_root,
    validate_entry_name,
)
from .revision import compute_revision
from .timeutil import from_mtime


def build_summary(root_id: str, rel_path: str, abs_path: Path, *, pinned: bool | None = None) -> dict:
    st = abs_path.stat()
    doc_type = file_type_for_path(rel_path) or 'markdown'
    title = abs_path.stem if abs_path.is_file() else abs_path.name
    if pinned is None:
        pinned = is_pinned(root_id, rel_path)
    return {
        'root_id': root_id,
        'path': rel_path,
        'title': title,
        'type': doc_type,
        'modified_at': from_mtime(st.st_mtime),
        'size_bytes': st.st_size if abs_path.is_file() else 0,
        'pinned': bool(pinned),
    }


def build_summary_from_disk(root_id: str, rel_path: str) -> dict | None:
    try:
        _, rel, abs_path = resolve_in_root(root_id, rel_path)
    except ApiError:
        return None
    if not abs_path.exists() or not abs_path.is_file():
        return None
    if not is_supported_type(file_type_for_path(rel)):
        return None
    return build_summary(root_id, rel, abs_path)


def read_document(root_id: str, rel_path: str) -> dict:
    root, rel, abs_path = resolve_in_root(root_id, rel_path)
    if not abs_path.exists() or not abs_path.is_file():
        raise ApiError('not_found', '文档不存在', 404)

    doc_type = file_type_for_path(rel)
    if not is_editable_type(doc_type):
        raise ApiError('unsupported_type', '该类型请使用资产接口读取', 422)

    try:
        data = abs_path.read_bytes()
        raw_content = data.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise ApiError('invalid_encoding', '文件不是有效的 UTF-8 文本', 422) from exc
    except OSError as exc:
        raise ApiError('read_failed', f'读取失败: {exc}', 500) from exc

    revision = compute_revision(abs_path, data)
    summary = build_summary(root_id, rel, abs_path)
    document = {
        **summary,
        'raw_content': raw_content,
        'revision': revision,
        'encoding': 'utf-8',
    }
    if doc_type == 'json':
        try:
            parsed = json.loads(raw_content)
            document['formatted_content'] = json.dumps(
                parsed, indent=2, ensure_ascii=False
            )
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return {'document': document}


def create_document(root_id: str, rel_path: str, doc_type: str, raw_content: str) -> dict:
    if doc_type not in TYPE_TO_EXT and doc_type not in ('markdown', 'txt', 'json'):
        # allow type from extension
        inferred = file_type_for_path(rel_path)
        if inferred and is_editable_type(inferred):
            doc_type = inferred
        else:
            raise ApiError('unsupported_type', '仅支持创建 Markdown、TXT、JSON', 422)

    if not is_editable_type(doc_type):
        raise ApiError('unsupported_type', '仅支持创建 Markdown、TXT、JSON', 422)

    # Ensure extension matches type
    expected_ext = TYPE_TO_EXT[doc_type]
    if not rel_path.lower().endswith(expected_ext) and not (
        doc_type == 'markdown' and rel_path.lower().endswith('.markdown')
    ):
        raise ApiError('type_mismatch', f'路径扩展名应与类型 {doc_type} 匹配', 422)

    root, rel, abs_path = resolve_in_root(root_id, rel_path)
    validate_entry_name(Path(rel).name)
    assert_parent_exists(abs_path)

    if abs_path.exists():
        raise ApiError('path_exists', '文件已存在', 409)

    content = raw_content if raw_content is not None else ''
    if not isinstance(content, str):
        raise ApiError('validation_error', 'raw_content 必须是字符串', 422)

    try:
        abs_path.write_text(content, encoding='utf-8')
    except OSError as exc:
        raise ApiError('write_failed', f'创建失败: {exc}', 500) from exc

    from .fts_index import index_document
    index_document(root_id, rel, abs_path)

    data = content.encode('utf-8')
    revision = compute_revision(abs_path, data)
    summary = build_summary(root_id, rel, abs_path)
    return {
        'document': {
            **summary,
            'raw_content': content,
            'revision': revision,
            'encoding': 'utf-8',
        }
    }


def update_document(
    root_id: str,
    rel_path: str,
    raw_content: str,
    if_match_revision: str | None,
    *,
    force: bool = False,
) -> dict:
    root, rel, abs_path = resolve_in_root(root_id, rel_path)
    if not abs_path.exists() or not abs_path.is_file():
        raise ApiError('not_found', '文档不存在', 404)

    doc_type = file_type_for_path(rel)
    if not is_editable_type(doc_type):
        raise ApiError('unsupported_type', '不支持写入该类型', 422)

    if not isinstance(raw_content, str):
        raise ApiError('validation_error', 'raw_content 必须是字符串', 422)

    try:
        current_data = abs_path.read_bytes()
    except OSError as exc:
        raise ApiError('read_failed', f'读取失败: {exc}', 500) from exc

    current_rev = compute_revision(abs_path, current_data)
    if not force:
        if not if_match_revision:
            raise ApiError('revision_required', '缺少 if_match_revision', 422)
        if current_rev != if_match_revision:
            current_text = current_data.decode('utf-8', errors='replace')
            summary = build_summary(root_id, rel, abs_path)
            raise ApiError(
                'revision_conflict',
                '文档已被其他客户端修改',
                409,
                document={
                    **summary,
                    'raw_content': current_text,
                    'revision': current_rev,
                    'encoding': 'utf-8',
                },
            )

    try:
        abs_path.write_text(raw_content, encoding='utf-8')
    except OSError as exc:
        raise ApiError('write_failed', f'保存失败: {exc}', 500) from exc

    from .fts_index import index_document
    index_document(root_id, rel, abs_path)

    new_data = raw_content.encode('utf-8')
    revision = compute_revision(abs_path, new_data)
    summary = build_summary(root_id, rel, abs_path)
    return {
        'document': {
            **summary,
            'raw_content': raw_content,
            'revision': revision,
            'encoding': 'utf-8',
        }
    }


def create_directory(root_id: str, rel_path: str) -> dict:
    root, rel, abs_path = resolve_in_root(root_id, rel_path)
    validate_entry_name(Path(rel).name)
    assert_parent_exists(abs_path)
    if abs_path.exists():
        raise ApiError('path_exists', '目录已存在', 409)
    try:
        abs_path.mkdir(parents=False)
    except OSError as exc:
        raise ApiError('write_failed', f'创建目录失败: {exc}', 500) from exc
    return {
        'entry': {
            'root_id': root_id,
            'path': rel,
            'name': abs_path.name,
            'kind': 'directory',
        }
    }


def move_entry(
    root_id: str,
    from_path: str,
    to_path: str,
    if_match_revision: str | None = None,
) -> dict:
    root, src_rel, src_abs = resolve_in_root(root_id, from_path)
    _, dst_rel, dst_abs = resolve_in_root(root_id, to_path)

    if not src_abs.exists():
        raise ApiError('not_found', '源路径不存在', 404)

    if src_rel == dst_rel:
        raise ApiError('validation_error', '源路径与目标路径相同', 422)

    is_dir = src_abs.is_dir()

    if is_dir:
        try:
            dst_abs.resolve().relative_to(src_abs.resolve())
            # destination is inside source — invalid
            raise ApiError('invalid_move', '不能将目录移动到其自身或子目录中', 422)
        except ValueError:
            # not a descendant — OK
            pass
        except ApiError:
            raise
    else:
        if if_match_revision:
            current_rev = compute_revision(src_abs)
            if current_rev != if_match_revision:
                raise ApiError('revision_conflict', '文件版本冲突', 409)

    if dst_abs.exists():
        raise ApiError('path_exists', '目标路径已存在', 409)

    assert_parent_exists(dst_abs)
    validate_entry_name(Path(dst_rel).name)

    try:
        src_abs.rename(dst_abs)
    except OSError:
        try:
            shutil.move(str(src_abs), str(dst_abs))
        except OSError as exc:
            raise ApiError('move_failed', f'移动失败: {exc}', 500) from exc

    rename_meta(root_id, src_rel, dst_rel, is_dir=is_dir)

    from .fts_index import index_document, remove_document, remove_under
    if is_dir:
        remove_under(root_id, src_rel)
        for pattern in ('*.md', '*.markdown', '*.txt', '*.json'):
            for fp in dst_abs.rglob(pattern):
                try:
                    child_rel = str(fp.resolve().relative_to(root['path'])).replace('\\', '/')
                    index_document(root_id, child_rel, fp)
                except ValueError:
                    continue
    else:
        remove_document(root_id, src_rel)
        index_document(root_id, dst_rel, dst_abs)

    result = {
        'root_id': root_id,
        'from_path': src_rel,
        'to_path': dst_rel,
        'kind': 'directory' if is_dir else 'file',
        'name': dst_abs.name,
    }
    if not is_dir and is_editable_type(file_type_for_path(dst_rel)):
        result['revision'] = compute_revision(dst_abs)
        result['document'] = {
            **build_summary(root_id, dst_rel, dst_abs),
            'revision': result['revision'],
        }
    return result


def list_tree_children(root_id: str, rel_path: str | None = None) -> dict:
    """Direct children only for lazy loading."""
    root, rel, abs_path = resolve_in_root(root_id, rel_path, allow_empty=True)
    if not abs_path.exists() or not abs_path.is_dir():
        raise ApiError('not_found', '目录不存在', 404)

    entries = []
    try:
        items = sorted(abs_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError as exc:
        raise ApiError('read_failed', f'无法读取目录: {exc}', 500) from exc

    for item in items:
        if item.name.startswith('.'):
            continue
        child_rel = item.name if rel == '' else f'{rel}/{item.name}'
        # Validate containment for symlinks
        try:
            resolved = item.resolve(strict=False)
            resolved.relative_to(root['path'].resolve())
        except (ValueError, OSError):
            continue

        if item.is_dir():
            entries.append({
                'name': item.name,
                'path': child_rel,
                'kind': 'directory',
                'type': None,
                'modified_at': from_mtime(item.stat().st_mtime),
                'size_bytes': None,
            })
        else:
            doc_type = file_type_for_path(child_rel)
            if not is_supported_type(doc_type):
                continue
            st = item.stat()
            entries.append({
                'name': item.name,
                'path': child_rel,
                'kind': 'file',
                'type': doc_type,
                'modified_at': from_mtime(st.st_mtime),
                'size_bytes': st.st_size,
            })

    return {
        'root_id': root_id,
        'path': rel,
        'entries': entries,
    }
