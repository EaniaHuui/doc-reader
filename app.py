#!/usr/bin/env python3
"""Doc Reader - 轻量级文档阅读器

Route layer: HTML pages + share links. JSON API lives under /api/v1.
"""

from __future__ import annotations

import html
import logging
import secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from flask import Flask, jsonify, render_template, request

from reader.api.v1 import api_v1_bp
from reader.auth import get_auth_payload, is_auth_enabled, login_required
from reader.constants import IMAGE_EXTENSIONS
from reader.db import init_db
from reader.documents_service import read_document
from reader.errors import ApiError, error_response, register_error_handlers
from reader.fts_index import rescan_all
from reader.markdown_utils import (
    render_image_file,
    render_markdown,
    rewrite_shared_image_urls,
    rewrite_view_image_urls,
)
from reader.fs_ops import read_text_file
from reader.paths import expand_path, is_path_in_directories, simplify_path
from reader.roots import sync_roots_from_config
from reader.share import (
    find_share_link,
    increment_share_view,
    is_share_link_active,
    public_share_data,
    serialize_datetime,
)
from reader.storage import get_config, load_share_links, save_share_links
from reader.trash_ops import cleanup_expired
from reader.pathutil import resolve_in_root
from reader.timeutil import from_mtime

logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['MAX_CONTENT_LENGTH'] = 12 * 1024 * 1024

register_error_handlers(app)
app.register_blueprint(api_v1_bp)

config = get_config()


def _bootstrap_server() -> None:
    """Initialize SQLite, import directory roots, build FTS index."""
    init_db()
    sync_roots_from_config()

    def _bg():
        try:
            count = rescan_all()
            logger.info('FTS index ready: %s documents', count)
        except Exception as exc:
            logger.warning('FTS rescan failed: %s', exc)
        try:
            cleanup_expired()
        except Exception as exc:
            logger.warning('Trash cleanup failed: %s', exc)

    threading.Thread(target=_bg, daemon=True).start()

    def _periodic():
        import time
        while True:
            time.sleep(3600)
            try:
                cleanup_expired()
            except Exception:
                pass

    threading.Thread(target=_periodic, daemon=True).start()


_bootstrap_server()


# ========================================
# HTML Routes (desktop + share)
# ========================================

@app.route('/')
def index():
    return render_template('index.html', config=config)


@app.route('/view')
def view_document():
    """Lightweight read-only document page for knowledge-base deep links.

    Prefer ``?root_id=&path=``; legacy ``?file=`` absolute/~/ paths still work.
    """
    root_id = (request.args.get('root_id') or '').strip()
    rel_path = (request.args.get('path') or '').strip()
    raw_path = (request.args.get('file') or '').strip()

    if root_id and rel_path:
        full_reader_url = f'/?root_id={quote(root_id, safe="")}&path={quote(rel_path, safe="")}'
        if is_auth_enabled() and get_auth_payload() is None:
            return render_template(
                'view.html',
                need_auth=True,
                file_param=rel_path,
                full_reader_url=full_reader_url,
            )
        try:
            doc = read_document(root_id, rel_path)['document']
            html_content = render_markdown(doc['raw_content']) if doc['type'] == 'markdown' else None
            if doc['type'] == 'txt':
                html_content = f'<pre class="text-file-content">{html.escape(doc["raw_content"])}</pre>'
            elif doc['type'] == 'json':
                content = doc.get('formatted_content') or doc['raw_content']
                html_content = (
                    f'<pre class="text-file-content"><code class="language-json">'
                    f'{html.escape(content)}</code></pre>'
                )
            _, _, abs_path = resolve_in_root(root_id, rel_path)
            if html_content:
                html_content = rewrite_view_image_urls_v1(html_content, root_id, rel_path)
            return render_template(
                'view.html',
                document={
                    'title': doc['title'],
                    'content': html_content,
                    'path': f'{root_id}:{rel_path}',
                    'modified': doc.get('modified_at', ''),
                },
                display_path=rel_path,
                full_reader_url=full_reader_url,
            )
        except ApiError as exc:
            status = exc.status
            return render_template(
                'view.html',
                error=exc.message,
                full_reader_url=full_reader_url,
            ), status

    if not raw_path:
        return render_template(
            'view.html',
            error='缺少文件路径。请使用 /view?root_id=...&path=... 或 /view?file=~/project/...',
        ), 400

    full_reader_url = '/?file=' + quote(raw_path, safe='')

    if is_auth_enabled() and get_auth_payload() is None:
        return render_template(
            'view.html',
            need_auth=True,
            file_param=raw_path,
            full_reader_url=full_reader_url,
        )

    file_path = expand_path(raw_path)
    if not is_path_in_directories(file_path):
        return render_template(
            'view.html',
            error='无权限访问该文件',
            full_reader_url=full_reader_url,
        ), 403

    if not file_path.exists() or not file_path.is_file():
        return render_template(
            'view.html',
            error='文件不存在',
            full_reader_url=full_reader_url,
        ), 404

    file_ext = file_path.suffix.lower()
    if file_ext == '.md':
        from reader.markdown_utils import read_markdown_file
        data, error = read_markdown_file(file_path)
    elif file_ext in ['.txt', '.json']:
        data, error = read_text_file(file_path, file_ext)
    elif file_ext in IMAGE_EXTENSIONS:
        data, error = render_image_file(file_path)
    else:
        data, error = None, '不支持的文件类型'

    if error:
        return render_template(
            'view.html',
            error=error,
            full_reader_url=full_reader_url,
        ), 404

    if data.get('content'):
        if data.get('fileType') == 'image':
            data['content'] = rewrite_view_image_urls(
                _image_html_for_legacy(file_path), file_path
            )
        else:
            data['content'] = rewrite_view_image_urls(data['content'], file_path)

    return render_template(
        'view.html',
        document=data,
        display_path=simplify_path(file_path),
        full_reader_url=full_reader_url,
    )


def _image_html_for_legacy(file_path: Path) -> str:
    escaped_name = html.escape(file_path.name)
    # Keep using rewrite_view_image_urls path builder via a synthetic img
    return f'<img src="{html.escape(file_path.name)}" alt="{escaped_name}">'


def rewrite_view_image_urls_v1(html_content: str, root_id: str, rel_path: str) -> str:
    """Rewrite relative images to /api/v1/assets for root-relative documents."""
    import re
    from urllib.parse import quote as q

    base_dir = str(Path(rel_path).parent).replace('\\', '/')
    if base_dir == '.':
        base_dir = ''

    def replace_src(match):
        prefix = match.group(1)
        quote_char = match.group(2)
        src = match.group(3)
        if src.startswith(('http://', 'https://')):
            proxied = f'/api/v1/remote-image?url={q(src, safe="")}'
            return f'{prefix}{quote_char}{proxied}{quote_char}'
        if re.match(r'^//', src) or src.startswith(('data:', 'mailto:', '#', '/')):
            return match.group(0)
        if base_dir:
            asset_rel = f'{base_dir}/{src}'.replace('//', '/')
        else:
            asset_rel = src
        # normalize .. in relative asset path lightly
        parts = []
        for p in asset_rel.split('/'):
            if p in ('', '.'):
                continue
            if p == '..':
                if parts:
                    parts.pop()
                continue
            parts.append(p)
        asset_rel = '/'.join(parts)
        asset_src = f'/api/v1/assets?root_id={q(root_id)}&path={q(asset_rel, safe="")}'
        return f'{prefix}{quote_char}{asset_src}{quote_char}'

    return re.sub(r'(<img\b[^>]*\bsrc=)(["\'])([^"\']+)\2', replace_src, html_content)


@app.route('/share/<token>')
def share_page(token):
    """Render a public, read-only document from a share token."""
    link = find_share_link(token)
    if not is_share_link_active(link):
        return render_template(
            'share.html',
            error='这个分享链接不存在、已过期或已被撤销。'
        ), 404

    file_path = expand_path(link['path'])
    file_ext = file_path.suffix.lower()

    if file_ext == '.md':
        from reader.markdown_utils import read_markdown_file
        data, error = read_markdown_file(file_path)
    elif file_ext in ['.txt', '.json']:
        data, error = read_text_file(file_path, file_ext)
    elif file_ext in IMAGE_EXTENSIONS:
        data, error = render_image_file(file_path)
    else:
        data, error = None, '不支持的文件类型'

    if error:
        return render_template('share.html', error=error), 404

    increment_share_view(token)

    if data.get('content'):
        if data.get('fileType') == 'image':
            escaped_name = html.escape(file_path.name)
            image_url = f'/api/share/image?share_token={quote(token, safe="")}&src={quote(file_path.name, safe="")}'
            data['content'] = (
                '<div class="image-file-viewer">'
                f'<img src="{image_url}" alt="{escaped_name}">'
                '</div>'
            )
        else:
            data['content'] = rewrite_shared_image_urls_v1(data['content'], token)

    return render_template(
        'share.html',
        document=data,
        expires_at=link.get('expires_at')
    )


def rewrite_shared_image_urls_v1(html_content: str, share_token: str) -> str:
    import re
    from urllib.parse import quote as q

    def replace_src(match):
        prefix = match.group(1)
        quote_char = match.group(2)
        src = match.group(3)
        if src.startswith(('http://', 'https://')):
            shared_src = (
                f'/api/share/remote-image?url={q(src, safe="")}'
                f'&share_token={q(share_token, safe="")}'
            )
            return f'{prefix}{quote_char}{shared_src}{quote_char}'
        if re.match(r'^//', src) or src.startswith(('data:', 'mailto:', '#', '/')):
            return match.group(0)
        shared_src = (
            f'/api/share/image?share_token={q(share_token, safe="")}'
            f'&src={q(src, safe="")}'
        )
        return f'{prefix}{quote_char}{shared_src}{quote_char}'

    return re.sub(r'(<img\b[^>]*\bsrc=)(["\'])([^"\']+)\2', replace_src, html_content)


# ========================================
# Share-link management (desktop-only, not /api/v1 mobile contract)
# ========================================

@app.route('/api/share-links', methods=['GET', 'POST'])
@login_required
def api_share_links():
    if request.method == 'GET':
        file_path = request.args.get('path')
        root_id = request.args.get('root_id')
        links = load_share_links()

        if root_id and file_path:
            try:
                _, _, abs_p = resolve_in_root(root_id, file_path)
                file_path = str(abs_p)
            except ApiError:
                file_path = str(expand_path(file_path))
            links = [link for link in links if str(expand_path(link.get('path', ''))) == file_path]
        elif file_path:
            file_path = str(expand_path(file_path))
            links = [link for link in links if str(expand_path(link.get('path', ''))) == file_path]

        return jsonify([public_share_data(link) for link in links])

    data = request.get_json(silent=True) or {}
    file_path = data.get('path')
    root_id = data.get('root_id')
    expires_in_hours = data.get('expires_in_hours', 24)
    max_views = data.get('max_views')

    if root_id and file_path:
        try:
            _, _, abs_path = resolve_in_root(root_id, file_path)
            file_path = abs_path
        except ApiError as exc:
            return error_response(exc.code, exc.message, exc.status)
    elif file_path:
        file_path = expand_path(file_path)
    else:
        return error_response('validation_error', '缺少文件路径', 422)

    try:
        expires_in_hours = int(expires_in_hours)
    except (TypeError, ValueError):
        return error_response('validation_error', '有效期必须是数字', 422)

    if expires_in_hours <= 0 or expires_in_hours > 24 * 365:
        return error_response('validation_error', '有效期必须在 1 小时到 365 天之间', 422)

    if max_views in ('', None):
        max_views = None
    else:
        try:
            max_views = int(max_views)
        except (TypeError, ValueError):
            return error_response('validation_error', '访问次数必须是数字', 422)
        if max_views <= 0 or max_views > 100000:
            return error_response('validation_error', '访问次数必须在 1 到 100000 之间', 422)

    if not is_path_in_directories(file_path):
        return error_response('forbidden', '无权限分享该文件', 403)

    if not file_path.exists() or not file_path.is_file():
        return error_response('not_found', '文件不存在', 404)

    if file_path.suffix.lower() not in ['.md', '.txt', '.json', *IMAGE_EXTENSIONS]:
        return error_response('unsupported_type', '不支持分享该文件类型', 422)

    now = datetime.utcnow()
    link = {
        'id': secrets.token_urlsafe(12),
        'token': secrets.token_urlsafe(32),
        'path': str(file_path),
        'display_path': simplify_path(file_path),
        'title': file_path.name,
        'permission': 'read',
        'expires_at': serialize_datetime(now + timedelta(hours=expires_in_hours)),
        'created_at': serialize_datetime(now),
        'created_by': (getattr(request, 'user', None) or {}).get('username', 'local'),
        'revoked_at': None,
        'max_views': max_views,
        'view_count': 0,
        'last_viewed_at': None,
    }

    links = load_share_links()
    links.append(link)
    save_share_links(links)
    return jsonify(public_share_data(link)), 201


@app.route('/api/share-links/<link_id>', methods=['DELETE'])
@login_required
def api_revoke_share_link(link_id):
    links = load_share_links()
    for link in links:
        if link.get('id') == link_id:
            if not link.get('revoked_at'):
                link['revoked_at'] = serialize_datetime(datetime.utcnow())
                save_share_links(links)
            return jsonify({'success': True, 'link': public_share_data(link)})
    return error_response('not_found', '分享链接不存在', 404)


@app.route('/api/share/image')
def api_share_image():
    """Public image serving for active share pages only."""
    from flask import abort, send_file

    share_token = request.args.get('share_token', '')
    share_src = request.args.get('src', '')
    link = find_share_link(share_token)
    if not is_share_link_active(link, enforce_view_limit=False):
        return error_response('unauthorized', '无效或过期的分享令牌', 401)

    base_path = expand_path(link['path']).parent
    image_path = (base_path / share_src).resolve()
    try:
        image_path.relative_to(base_path.resolve())
    except ValueError:
        return error_response('forbidden', '无效的图片路径', 403)

    if not image_path.exists() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        abort(404)

    resp = send_file(str(image_path))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/api/share/remote-image')
def api_share_remote_image():
    from urllib.parse import unquote
    from urllib.request import Request, build_opener
    from flask import Response
    from reader.constants import REMOTE_IMAGE_MAX_BYTES, REMOTE_IMAGE_TIMEOUT_SECONDS
    from reader.security import SafeRedirectHandler, is_public_remote_url

    share_token = request.args.get('share_token', '')
    link = find_share_link(share_token)
    if not is_share_link_active(link, enforce_view_limit=False):
        return error_response('unauthorized', '无效或过期的分享令牌', 401)

    remote_url = unquote(request.args.get('url', ''))
    if not remote_url or not is_public_remote_url(remote_url):
        return error_response('invalid_url', '不允许代理该 URL', 400)

    req = Request(remote_url, headers={'User-Agent': 'Mozilla/5.0 DocReader/2.0', 'Accept': 'image/*'})
    try:
        opener = build_opener(SafeRedirectHandler)
        with opener.open(req, timeout=REMOTE_IMAGE_TIMEOUT_SECONDS) as remote:
            content_type = remote.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if not content_type.startswith('image/'):
                return error_response('unsupported_type', '远程资源不是图片', 415)
            data = remote.read(REMOTE_IMAGE_MAX_BYTES + 1)
            if len(data) > REMOTE_IMAGE_MAX_BYTES:
                return error_response('payload_too_large', '远程图片过大', 413)
        response = Response(data, mimetype=content_type)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception:
        return error_response('proxy_failed', '远程图片加载失败', 502)


@app.errorhandler(ApiError)
def handle_api_error(exc: ApiError):
    body = {'error': {'code': exc.code, 'message': exc.message}}
    body.update(exc.extra)
    return jsonify(body), exc.status


if __name__ == '__main__':
    server_config = config.get('server', {})
    app.run(
        host=server_config.get('host', '0.0.0.0'),
        port=server_config.get('port', 63518),
        debug=server_config.get('debug', False),
    )
