"""Doc Reader API v1 — single-user personal document server contract."""

from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from flask import Blueprint, Response, current_app, g, jsonify, request, send_file

from reader.auth import (
    clear_login_failures,
    current_user_dict,
    get_auth_payload,
    get_users,
    is_auth_enabled,
    is_login_rate_limited,
    issue_login_response,
    login_required,
    record_login_failure,
    revoke_token,
    verify_password,
)
from reader.constants import IMAGE_EXTENSIONS, REMOTE_IMAGE_MAX_BYTES, REMOTE_IMAGE_TIMEOUT_SECONDS
from reader.documents_service import (
    create_directory,
    create_document,
    list_tree_children,
    move_entry,
    read_document,
    update_document,
    build_summary_from_disk,
)
from reader.errors import ApiError, error_response, register_error_handlers
from reader.fts_index import search as fts_search
from reader.markdown_utils import render_markdown
from reader.meta_store import list_pins, list_recent, record_opened, set_pin
from reader.pairing import create_pairing_session, exchange_pairing, list_active_pairing_sessions
from reader.pathutil import file_type_for_path, is_supported_type, resolve_in_root
from reader.roots import list_roots, sync_roots_from_config, update_directories_and_sync
from reader.security import SafeRedirectHandler, is_public_remote_url
from reader.share import get_public_base_url
from reader.storage import get_config
from reader.trash_ops import (
    list_trash,
    move_to_trash,
    permanent_delete,
    restore_trash,
)

api_v1_bp = Blueprint('api_v1', __name__, url_prefix='/api/v1')
register_error_handlers(api_v1_bp)

NO_STORE = {'Cache-Control': 'no-store'}
MAX_JSON_BODY = 8 * 1024 * 1024  # 8 MiB


def _json_body() -> dict:
    if request.content_length and request.content_length > MAX_JSON_BODY:
        raise ApiError('payload_too_large', '请求体过大', 413)
    data = request.get_json(silent=True)
    if data is None:
        # Distinguish empty vs malformed
        raw = request.get_data(cache=True, as_text=True)
        if raw and raw.strip():
            raise ApiError('malformed_json', 'JSON 格式错误', 400)
        return {}
    if not isinstance(data, dict):
        raise ApiError('malformed_json', '请求体必须是 JSON 对象', 400)
    return data


def _client_ip() -> str:
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown')
    if client_ip and ',' in client_ip:
        client_ip = client_ip.split(',', 1)[0].strip()
    return client_ip


def _version() -> str:
    try:
        version_file = Path(current_app.root_path) / 'VERSION'
        if version_file.exists():
            for line in version_file.read_text(encoding='utf-8').splitlines():
                if line.lower().startswith('version:'):
                    return line.split(':', 1)[1].strip()
    except Exception:
        pass
    return '2.0.0'


def _server_name() -> str:
    cfg = get_config()
    return (cfg.get('server') or {}).get('name') or 'Doc Reader'


# ---------------------------------------------------------------------------
# Health / Auth / Pairing
# ---------------------------------------------------------------------------

@api_v1_bp.get('/health')
def health():
    return jsonify({
        'status': 'ok',
        'version': _version(),
        'https_required': True,
    })


@api_v1_bp.post('/auth/login')
def auth_login():
    if not is_auth_enabled():
        # Single-user local mode: issue a local token for API consistency
        return jsonify(issue_login_response('local'))

    if is_login_rate_limited(_client_ip()):
        raise ApiError('rate_limited', '登录尝试过于频繁，请稍后再试', 429)

    data = _json_body()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        raise ApiError('validation_error', '请输入用户名和密码', 422)

    users = get_users()
    user = users.get(username)
    if not user or not verify_password(password, user['password']):
        record_login_failure(_client_ip())
        raise ApiError('invalid_credentials', '用户名或密码错误', 401)

    clear_login_failures(_client_ip())
    return jsonify(issue_login_response(username))


@api_v1_bp.get('/auth/me')
@login_required
def auth_me():
    cfg = get_config()
    return jsonify({
        'user': current_user_dict(),
        'server': {
            'name': _server_name(),
            'version': _version(),
            'https_required': True,
            'public_base_url': get_public_base_url(),
        },
        'auth_enabled': is_auth_enabled(),
        'features': cfg.get('features') or {},
    })


@api_v1_bp.post('/auth/pairing-sessions')
@login_required
def auth_create_pairing():
    user = current_user_dict()
    server_url = get_public_base_url()
    if not server_url.startswith('https://') and not current_app.debug:
        # Still allow in debug; production should be HTTPS
        pass
    session = create_pairing_session(user.get('username') or user.get('name') or 'user', server_url)
    return jsonify(session), 201


@api_v1_bp.get('/auth/pairing-sessions')
@login_required
def auth_list_pairing():
    return jsonify({'sessions': list_active_pairing_sessions()})


@api_v1_bp.post('/auth/pairing/exchange')
def auth_pairing_exchange():
    data = _json_body()
    # Accept either nested payload or flat fields
    payload = data.get('payload') if isinstance(data.get('payload'), dict) else data
    result = exchange_pairing(payload)
    username = result['username']
    # Ensure user exists; if auth disabled, still issue token
    if is_auth_enabled() and username not in get_users() and username != 'local':
        # Pairing was created by a real user name
        pass
    return jsonify(issue_login_response(username))


@api_v1_bp.post('/auth/logout')
@login_required
def auth_logout():
    payload = getattr(g, 'auth_payload', None) or get_auth_payload() or {}
    jti = payload.get('jti')
    if jti:
        revoke_token(jti)
    return jsonify({'success': True, 'revoked': bool(jti)})


# ---------------------------------------------------------------------------
# Bootstrap / Home / Pin / Recent
# ---------------------------------------------------------------------------

@api_v1_bp.get('/bootstrap')
@login_required
def bootstrap():
    cfg = get_config()
    features = cfg.get('features') or {}
    return jsonify({
        'user': current_user_dict(),
        'server_name': _server_name(),
        'version': _version(),
        'roots': list_roots(include_abs=False),
        'supported_file_types': {
            'editable': ['markdown', 'txt', 'json'],
            'readable': ['markdown', 'txt', 'json', 'image'],
            'image_extensions': sorted(IMAGE_EXTENSIONS),
        },
        'features': {
            'search': bool(features.get('search', True)),
            'dark_mode': bool(features.get('dark_mode', True)),
            'trash': True,
            'pairing': True,
            'pins': True,
            'fts': True,
            **{k: v for k, v in features.items() if k not in ('search', 'dark_mode')},
        },
    })


@api_v1_bp.get('/home')
@login_required
def home():
    pinned = []
    for root_id, path in list_pins():
        summary = build_summary_from_disk(root_id, path)
        if summary:
            summary['pinned'] = True
            pinned.append(summary)

    recent = []
    for root_id, path in list_recent(20):
        summary = build_summary_from_disk(root_id, path)
        if summary:
            recent.append(summary)

    return jsonify({'pinned': pinned, 'recent': recent})


@api_v1_bp.put('/documents/pin')
@login_required
def documents_pin():
    data = _json_body()
    root_id = data.get('root_id')
    path = data.get('path')
    pinned = data.get('pinned')
    if not root_id or path is None or pinned is None:
        raise ApiError('validation_error', '需要 root_id、path 与 pinned', 422)
    # Ensure path is valid & exists for pin=true
    resolve_in_root(root_id, path)
    set_pin(root_id, path, bool(pinned))
    summary = build_summary_from_disk(root_id, path)
    if summary:
        summary['pinned'] = bool(pinned)
    return jsonify({'success': True, 'document': summary, 'pinned': bool(pinned)})


@api_v1_bp.post('/documents/opened')
@login_required
def documents_opened():
    data = _json_body()
    root_id = data.get('root_id')
    path = data.get('path')
    if not root_id or path is None:
        raise ApiError('validation_error', '需要 root_id 与 path', 422)
    resolve_in_root(root_id, path)
    record_opened(root_id, path)
    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# Search / Tree
# ---------------------------------------------------------------------------

@api_v1_bp.get('/search')
@login_required
def search():
    q = request.args.get('q', '')
    cursor = request.args.get('cursor')
    limit = request.args.get('limit', 20)
    try:
        limit_i = int(limit)
    except (TypeError, ValueError):
        limit_i = 20
    return jsonify(fts_search(q, limit=limit_i, cursor=cursor))


@api_v1_bp.get('/tree')
@login_required
def tree():
    root_id = request.args.get('root_id')
    if not root_id:
        raise ApiError('validation_error', '需要 root_id', 422)
    path = request.args.get('path')  # optional
    return jsonify(list_tree_children(root_id, path))


# ---------------------------------------------------------------------------
# Documents / directories / Move / Delete
# ---------------------------------------------------------------------------

@api_v1_bp.get('/documents')
@login_required
def get_document():
    root_id = request.args.get('root_id')
    path = request.args.get('path')
    if not root_id or path is None:
        raise ApiError('validation_error', '需要 root_id 与 path', 422)
    result = read_document(root_id, path)
    resp = jsonify(result)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@api_v1_bp.post('/documents')
@login_required
def post_document():
    data = _json_body()
    root_id = data.get('root_id')
    path = data.get('path')
    doc_type = data.get('type')
    raw_content = data.get('raw_content', '')
    if not root_id or not path or not doc_type:
        raise ApiError('validation_error', '需要 root_id、path 与 type', 422)
    result = create_document(root_id, path, doc_type, raw_content)
    return jsonify(result), 201


@api_v1_bp.put('/documents')
@login_required
def put_document():
    data = _json_body()
    root_id = data.get('root_id')
    path = data.get('path')
    raw_content = data.get('raw_content')
    if_match = data.get('if_match_revision')
    force = bool(data.get('force', False))
    if not root_id or not path or raw_content is None:
        raise ApiError('validation_error', '需要 root_id、path 与 raw_content', 422)
    result = update_document(root_id, path, raw_content, if_match, force=force)
    return jsonify(result)


@api_v1_bp.post('/directories')
@login_required
def post_directory():
    data = _json_body()
    root_id = data.get('root_id')
    path = data.get('path')
    if not root_id or not path:
        raise ApiError('validation_error', '需要 root_id 与 path', 422)
    return jsonify(create_directory(root_id, path)), 201


@api_v1_bp.patch('/entries/move')
@login_required
def patch_move():
    data = _json_body()
    root_id = data.get('root_id')
    from_path = data.get('from_path')
    to_path = data.get('to_path')
    if_match = data.get('if_match_revision')
    if not root_id or not from_path or not to_path:
        raise ApiError('validation_error', '需要 root_id、from_path 与 to_path', 422)
    return jsonify(move_entry(root_id, from_path, to_path, if_match))


@api_v1_bp.delete('/entries')
@login_required
def delete_entry():
    data = _json_body()
    root_id = data.get('root_id')
    path = data.get('path')
    if_match = data.get('if_match_revision')
    if not root_id or path is None:
        raise ApiError('validation_error', '需要 root_id 与 path', 422)

    # Optional revision check for files
    if if_match:
        from reader.revision import compute_revision
        _, _, abs_path = resolve_in_root(root_id, path)
        if abs_path.is_file() and compute_revision(abs_path) != if_match:
            raise ApiError('revision_conflict', '文件版本冲突', 409)

    trash = move_to_trash(root_id, path)
    return jsonify({'trash': trash})


# ---------------------------------------------------------------------------
# Trash / Assets
# ---------------------------------------------------------------------------

@api_v1_bp.get('/trash')
@login_required
def get_trash():
    return jsonify({'entries': list_trash()})


@api_v1_bp.post('/trash/<trash_id>/restore')
@login_required
def post_trash_restore(trash_id: str):
    data = _json_body()
    target = data.get('path') or data.get('target_path')
    result = restore_trash(trash_id, target)
    return jsonify(result)


@api_v1_bp.delete('/trash/<trash_id>')
@login_required
def delete_trash(trash_id: str):
    data = _json_body()
    confirm = bool(data.get('confirm', False))
    permanent_delete(trash_id, confirm=confirm)
    return jsonify({'success': True, 'id': trash_id})


@api_v1_bp.get('/assets')
@login_required
def get_asset():
    root_id = request.args.get('root_id')
    path = request.args.get('path')
    if not root_id or path is None:
        raise ApiError('validation_error', '需要 root_id 与 path', 422)

    _, rel, abs_path = resolve_in_root(root_id, path)
    if not abs_path.exists() or not abs_path.is_file():
        raise ApiError('not_found', '资源不存在', 404)

    doc_type = file_type_for_path(rel)
    if doc_type != 'image':
        raise ApiError('unsupported_type', '仅支持图片资源', 422)

    mime, _ = mimetypes.guess_type(str(abs_path))
    if not mime:
        mime = 'application/octet-stream'

    resp = send_file(str(abs_path), mimetype=mime, conditional=False)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


# ---------------------------------------------------------------------------
# Desktop helpers: render + roots config (not required by mobile contract)
# ---------------------------------------------------------------------------

@api_v1_bp.post('/render')
@login_required
def render():
    """Desktop-only: render markdown/txt/json to HTML for reading view."""
    data = _json_body()
    content = data.get('content', '') or data.get('raw_content', '')
    path = data.get('path') or ''
    ext = path.rsplit('.', 1)[-1].lower() if path else 'md'

    if ext == 'json':
        try:
            parsed = json.loads(content)
            formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
            import html as html_mod
            html_content = (
                f'<pre class="text-file-content"><code class="language-json">'
                f'{html_mod.escape(formatted)}</code></pre>'
            )
        except json.JSONDecodeError:
            import html as html_mod
            html_content = (
                f'<pre class="text-file-content"><code>'
                f'{html_mod.escape(content)}</code></pre>'
            )
    elif ext == 'txt':
        import html as html_mod
        html_content = f'<pre class="text-file-content">{html_mod.escape(content)}</pre>'
    else:
        html_content = render_markdown(content)

    return jsonify({'content': html_content})


@api_v1_bp.get('/admin/directories')
@login_required
def admin_get_directories():
    """Desktop config: list configured roots with display paths."""
    from reader.storage import load_directories_config
    roots = list_roots(include_abs=True)
    # Merge with configured path strings for editing
    configured = load_directories_config()
    by_abs = {}
    for d in configured:
        try:
            from reader.roots import expand_abs
            by_abs[str(expand_abs(d['path']))] = d
        except Exception:
            continue
    result = []
    for r in roots:
        conf = by_abs.get(r.get('abs_path'), {})
        result.append({
            'root_id': r['root_id'],
            'name': r['name'],
            'path': conf.get('path') or r.get('configured_path') or r.get('abs_path'),
        })
    return jsonify({'directories': result})


@api_v1_bp.put('/admin/directories')
@login_required
def admin_put_directories():
    data = _json_body()
    directories = data.get('directories')
    if not isinstance(directories, list):
        raise ApiError('validation_error', 'directories 必须是数组', 422)
    roots = update_directories_and_sync(directories)
    # Trigger rescan in background
    from reader.fts_index import rescan_all
    import threading
    threading.Thread(target=rescan_all, daemon=True).start()
    return jsonify({
        'success': True,
        'directories': [
            {
                'root_id': r['root_id'],
                'name': r['name'],
                'path': next(
                    (d['path'] for d in directories
                     if d.get('name') == r['name']),
                    r.get('abs_path'),
                ),
            }
            for r in roots
        ],
    })


@api_v1_bp.get('/remote-image')
@login_required
def remote_image():
    """Optional proxy for remote images in desktop markdown (no document cache)."""
    from urllib.parse import unquote
    from urllib.request import Request, build_opener

    remote_url = request.args.get('url', '')
    if not remote_url:
        raise ApiError('validation_error', '缺少图片 URL', 422)
    remote_url = unquote(remote_url)
    if not is_public_remote_url(remote_url):
        raise ApiError('invalid_url', '不允许代理该 URL', 422)

    req = Request(
        remote_url,
        headers={
            'User-Agent': 'Mozilla/5.0 DocReader/2.0',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
    )
    try:
        opener = build_opener(SafeRedirectHandler)
        with opener.open(req, timeout=REMOTE_IMAGE_TIMEOUT_SECONDS) as remote:
            content_type = remote.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if not content_type.startswith('image/'):
                raise ApiError('unsupported_type', '远程资源不是图片', 415)
            data = remote.read(REMOTE_IMAGE_MAX_BYTES + 1)
            if len(data) > REMOTE_IMAGE_MAX_BYTES:
                raise ApiError('payload_too_large', '远程图片过大', 413)
        response = Response(data, mimetype=content_type)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError('proxy_failed', '远程图片加载失败', 502) from exc
