#!/usr/bin/env python3
"""Doc Reader - 轻量级文档阅读器

Route layer only. Business logic lives under the `reader` package.
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote, unquote
from urllib.request import Request, build_opener

from flask import Flask, Response, jsonify, render_template, request, send_file, abort
import html

from reader.auth import (
    clear_login_failures,
    decode_token,
    generate_token,
    get_users,
    is_auth_enabled,
    is_login_rate_limited,
    login_required,
    record_login_failure,
    verify_password,
)
from reader.constants import (
    IMAGE_EXTENSIONS,
    REMOTE_IMAGE_MAX_BYTES,
    REMOTE_IMAGE_TIMEOUT_SECONDS,
)
from reader.fs_ops import (
    get_directory_listing,
    read_text_file,
    search_files,
)
from reader.markdown_utils import (
    read_markdown_file,
    render_image_file,
    render_markdown,
    rewrite_shared_image_urls,
)
from reader.paths import expand_path, is_path_in_directories, simplify_path, validate_move_paths
from reader.security import SafeRedirectHandler, is_public_remote_url
from reader.share import (
    find_share_link,
    increment_share_view,
    is_share_link_active,
    public_share_data,
    serialize_datetime,
    update_share_links_for_move,
)
from reader.storage import (
    get_config,
    load_directories_config,
    load_share_links,
    save_directories_config,
    save_share_links,
)

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True

config = get_config()


def request_has_valid_auth_or_share():
    """Allow remote assets for logged-in users or active share pages."""
    share_token = request.args.get('share_token', '')
    if share_token:
        return is_share_link_active(find_share_link(share_token), enforce_view_limit=False)

    if not is_auth_enabled():
        return True

    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token:
        token = request.args.get('token', '')

    return decode_token(token) is not None if token else False


# ========================================
# Authentication Routes
# ========================================

@app.route('/api/auth/status', methods=['GET'])
def api_auth_status():
    """Check authentication status."""
    if not is_auth_enabled():
        return jsonify({'enabled': False, 'authenticated': True})

    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        payload = decode_token(token)
        if payload:
            return jsonify({
                'enabled': True,
                'authenticated': True,
                'username': payload.get('username')
            })

    return jsonify({'enabled': True, 'authenticated': False})

@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    """Handle user login."""
    if not is_auth_enabled():
        return jsonify({'error': '认证未启用'}), 400

    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown')
    if client_ip and ',' in client_ip:
        client_ip = client_ip.split(',', 1)[0].strip()

    if is_login_rate_limited(client_ip):
        return jsonify({
            'error': '登录尝试过于频繁，请稍后再试'
        }), 429

    data = request.get_json(silent=True) or {}
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'error': '请输入用户名和密码'}), 400

    users = get_users()
    if username not in users or not verify_password(password, users[username]):
        record_login_failure(client_ip)
        return jsonify({'error': '用户名或密码错误'}), 401

    clear_login_failures(client_ip)
    token = generate_token(username)
    return jsonify({
        'token': token,
        'username': username
    })

@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    """Handle user logout (client-side token removal)."""
    return jsonify({'success': True})

# ========================================
# Content Routes
# ========================================

@app.route('/')
def index():
    return render_template('index.html', config=config)

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
            image_url = f'/api/image?share_token={quote(token, safe="")}&src={quote(file_path.name, safe="")}'
            data['content'] = (
                '<div class="image-file-viewer">'
                f'<img src="{image_url}" alt="{escaped_name}">'
                '</div>'
            )
        else:
            data['content'] = rewrite_shared_image_urls(data['content'], token)

    return render_template(
        'share.html',
        document=data,
        expires_at=link.get('expires_at')
    )

@app.route('/api/share-links', methods=['GET', 'POST'])
@login_required
def api_share_links():
    """List or create share links for one file."""
    if request.method == 'GET':
        file_path = request.args.get('path')
        links = load_share_links()

        if file_path:
            file_path = str(expand_path(file_path))
            links = [link for link in links if str(expand_path(link.get('path', ''))) == file_path]

        return jsonify([public_share_data(link) for link in links])

    data = request.get_json() or {}
    file_path = data.get('path')
    expires_in_hours = data.get('expires_in_hours', 24)
    max_views = data.get('max_views')

    if not file_path:
        return jsonify({'error': '缺少文件路径'}), 400

    try:
        expires_in_hours = int(expires_in_hours)
    except (TypeError, ValueError):
        return jsonify({'error': '有效期必须是数字'}), 400

    if expires_in_hours <= 0 or expires_in_hours > 24 * 365:
        return jsonify({'error': '有效期必须在 1 小时到 365 天之间'}), 400

    if max_views in ('', None):
        max_views = None
    else:
        try:
            max_views = int(max_views)
        except (TypeError, ValueError):
            return jsonify({'error': '访问次数必须是数字'}), 400
        if max_views <= 0 or max_views > 100000:
            return jsonify({'error': '访问次数必须在 1 到 100000 之间'}), 400

    file_path = expand_path(file_path)

    if not is_path_in_directories(file_path):
        return jsonify({'error': '无权限分享该文件'}), 403

    if not file_path.exists() or not file_path.is_file():
        return jsonify({'error': '文件不存在'}), 404

    if file_path.suffix.lower() not in ['.md', '.txt', '.json', *IMAGE_EXTENSIONS]:
        return jsonify({'error': '不支持分享该文件类型'}), 400

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
        'created_by': getattr(request, 'user', {}).get('username', 'local'),
        'revoked_at': None,
        'max_views': max_views,
        'view_count': 0,
        'last_viewed_at': None
    }

    links = load_share_links()
    links.append(link)
    save_share_links(links)

    return jsonify(public_share_data(link)), 201

@app.route('/api/share-links/<link_id>', methods=['DELETE'])
@login_required
def api_revoke_share_link(link_id):
    """Revoke a share link."""
    links = load_share_links()

    for link in links:
        if link.get('id') == link_id:
            if not link.get('revoked_at'):
                link['revoked_at'] = serialize_datetime(datetime.utcnow())
                save_share_links(links)
            return jsonify({'success': True, 'link': public_share_data(link)})

    return jsonify({'error': '分享链接不存在'}), 404

@app.route('/api/directories')
@login_required
def api_directories():
    # 获取文件类型参数
    file_types = ['.md']
    show_txt = request.args.get('txt', 'false').lower() == 'true'
    show_json = request.args.get('json', 'false').lower() == 'true'
    show_images = request.args.get('images', 'true').lower() == 'true'
    target_path = request.args.get('path')

    if show_txt:
        file_types.append('.txt')
    if show_json:
        file_types.append('.json')
    if show_images:
        file_types.extend(sorted(IMAGE_EXTENSIONS))

    if target_path:
        target_dir = expand_path(target_path)
        if not is_path_in_directories(target_dir):
            return jsonify({'error': '无权限访问该目录'}), 403
        if not target_dir.exists():
            return jsonify({'error': '目录不存在'}), 404
        if not target_dir.is_dir():
            return jsonify({'error': '目标路径不是目录'}), 400

        tree = get_directory_listing(target_dir, file_types=file_types)
        if tree is None:
            return jsonify({'error': '目录不存在'}), 404
        return jsonify(tree.get('children', []))

    trees = []
    for directory in load_directories_config():
        tree = get_directory_listing(directory['path'], directory['name'], file_types)
        if tree:
            trees.append(tree)
    return jsonify(trees)

@app.route('/api/render', methods=['POST'])
@login_required
def api_render():
    """Render markdown content to HTML for live preview"""
    data = request.get_json()
    content = data.get('content', '')
    file_path = data.get('path', '')

    # Determine file type
    ext = file_path.split('.')[-1].lower() if file_path else 'md'

    if ext == 'json':
        # For JSON files, render as formatted code
        try:
            parsed = json.loads(content)
            formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
            html_content = f'<pre class="text-file-content"><code class="language-json">{html.escape(formatted)}</code></pre>'
        except json.JSONDecodeError:
            html_content = f'<pre class="text-file-content"><code>{html.escape(content)}</code></pre>'
    elif ext == 'txt':
        # For TXT files, render as plain text
        html_content = f'<pre class="text-file-content">{html.escape(content)}</pre>'
    else:
        # For Markdown files, render with marked
        html_content = render_markdown(content)

    return jsonify({'content': html_content})


@app.route('/api/file', methods=['GET', 'POST', 'DELETE', 'PUT'])
@login_required
def api_file():
    # POST method - create file
    if request.method == 'POST':
        data = request.get_json()
        file_path = data.get('path') if data else None
        content = data.get('content', '')  # 默认空白内容

        if not file_path:
            return jsonify({'error': '缺少文件路径'}), 400

        # 展开路径（支持 ~ 符号）
        file_path = expand_path(file_path)

        # 验证文件名合法性
        import re
        filename = file_path.name
        if not filename or filename in ['.', '..']:
            return jsonify({'error': '无效的文件名'}), 400
        if re.search(r'[/\\:*?"<>|]', filename):
            return jsonify({'error': '文件名包含非法字符'}), 400

        # 验证文件路径在允许的目录内（使用动态配置）
        if not is_path_in_directories(file_path):
            return jsonify({'error': '无权限在该目录创建文件'}), 403

        # 检查父目录是否存在
        if not file_path.parent.exists():
            return jsonify({'error': '父目录不存在'}), 400

        # 检查文件是否已存在
        if file_path.exists():
            return jsonify({'error': '文件已存在'}), 409

        try:
            # 创建空白文件
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)

            return jsonify({
                'success': True,
                'path': simplify_path(file_path),
                'name': file_path.name
            })
        except Exception as e:
            return jsonify({'error': f'创建文件失败: {str(e)}'}), 500

    # PUT method - save file
    if request.method == 'PUT':
        data = request.get_json()
        file_path = data.get('path') if data else None
        content = data.get('content') if data else None

        if not file_path:
            return jsonify({'error': '缺少文件路径'}), 400
        if content is None:
            return jsonify({'error': '缺少文件内容'}), 400

        # 展开路径（支持 ~ 符号）
        file_path = expand_path(file_path)

        # 验证文件路径在允许的目录内
        if not is_path_in_directories(file_path):
            return jsonify({'error': '无权限访问该文件'}), 403

        if not file_path.exists():
            return jsonify({'error': '文件不存在'}), 404

        try:
            # 写入文件
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)

            # 返回更新后的文件信息
            mtime = file_path.stat().st_mtime
            modified_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')

            return jsonify({
                'success': True,
                'modified': modified_time
            })
        except Exception as e:
            return jsonify({'error': f'保存文件失败: {str(e)}'}), 500

    # DELETE method - delete file
    if request.method == 'DELETE':
        data = request.get_json()
        file_path = data.get('path') if data else None
        if not file_path:
            return jsonify({'error': '缺少文件路径'}), 400

        # 展开路径（支持 ~ 符号）
        file_path = expand_path(file_path)

        # 验证文件路径在允许的目录内
        if not is_path_in_directories(file_path):
            return jsonify({'error': '无权限访问该文件'}), 403

        if not file_path.exists():
            return jsonify({'error': '文件不存在'}), 404

        try:
            file_path.unlink()
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': f'删除文件失败: {str(e)}'}), 500

    # GET method - read file
    file_path = request.args.get('path')
    if not file_path:
        return jsonify({'error': '缺少文件路径'}), 400

    # 展开路径（支持 ~ 符号）
    file_path = expand_path(file_path)

    # 验证文件路径在允许的目录内
    if not is_path_in_directories(file_path):
        return jsonify({'error': '无权限访问该文件'}), 403

    # 判断文件类型
    file_ext = Path(file_path).suffix.lower()

    if file_ext == '.md':
        data, error = read_markdown_file(file_path)
    elif file_ext in ['.txt', '.json']:
        data, error = read_text_file(file_path, file_ext)
    elif file_ext in IMAGE_EXTENSIONS:
        data, error = render_image_file(file_path)
    else:
        data, error = None, "不支持的文件类型"

    if error:
        return jsonify({'error': error}), 404

    return jsonify(data)


@app.route('/api/directory', methods=['POST', 'DELETE'])
@login_required
def api_directory():
    """创建或删除目录"""
    # POST method - create directory
    if request.method == 'POST':
        data = request.get_json()
        dir_path = data.get('path') if data else None

        if not dir_path:
            return jsonify({'error': '缺少目录路径'}), 400

        # 展开路径（支持 ~ 符号）
        dir_path = expand_path(dir_path)

        # 验证目录名合法性
        import re
        dirname = dir_path.name
        if not dirname or dirname in ['.', '..']:
            return jsonify({'error': '无效的目录名'}), 400
        if re.search(r'[/\\:*?"<>|]', dirname):
            return jsonify({'error': '目录名包含非法字符'}), 400

        # 验证目录路径在允许的目录内（使用动态配置）
        if not is_path_in_directories(dir_path):
            return jsonify({'error': '无权限在该目录创建子目录'}), 403

        # 检查父目录是否存在
        if not dir_path.parent.exists():
            return jsonify({'error': '父目录不存在'}), 400

        # 检查目录是否已存在
        if dir_path.exists():
            return jsonify({'error': '目录已存在'}), 409

        try:
            dir_path.mkdir(parents=False)
            return jsonify({
                'success': True,
                'path': simplify_path(dir_path),
                'name': dir_path.name
            })
        except Exception as e:
            return jsonify({'error': f'创建目录失败: {str(e)}'}), 500

    # DELETE method - delete directory
    data = request.get_json()
    dir_path = data.get('path') if data else None
    if not dir_path:
        return jsonify({'error': '缺少目录路径'}), 400

    # 展开路径（支持 ~ 符号）
    dir_path = expand_path(dir_path)

    # 验证目录路径在允许的目录内
    if not is_path_in_directories(dir_path):
        return jsonify({'error': '无权限访问该目录'}), 403

    if not dir_path.exists():
        return jsonify({'error': '目录不存在'}), 404

    if not dir_path.is_dir():
        return jsonify({'error': '路径不是目录'}), 400

    try:
        shutil.rmtree(dir_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'删除目录失败: {str(e)}'}), 500

@app.route('/api/move', methods=['POST'])
@login_required
def api_move():
    """Move a file or directory into an existing directory."""
    data = request.get_json() or {}
    source_path = data.get('source_path')
    target_directory = data.get('target_directory')

    if not source_path:
        return jsonify({'error': '缺少源路径'}), 400

    if not target_directory:
        return jsonify({'error': '缺少目标目录'}), 400

    destination_path, error = validate_move_paths(source_path, target_directory)
    if error:
        message, status = error
        return jsonify({'error': message}), status

    source_path = expand_path(source_path)

    try:
        source_type = 'directory' if source_path.is_dir() else 'file'
        source_path.rename(destination_path)
        update_share_links_for_move(source_path, destination_path)
        return jsonify({
            'success': True,
            'type': source_type,
            'source_path': simplify_path(source_path),
            'target_directory': simplify_path(expand_path(target_directory)),
            'destination_path': simplify_path(destination_path),
            'name': destination_path.name
        })
    except Exception as e:
        return jsonify({'error': f'移动失败: {str(e)}'}), 500


@app.route('/api/search')
@login_required
def api_search():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify([])

    results = search_files(query, load_directories_config())
    return jsonify(results)

@app.route('/api/preview', methods=['POST'])
@login_required
def api_preview():
    """Preview markdown content (for real-time editing)"""
    data = request.get_json()
    content = data.get('content', '') if data else ''
    html_content = render_markdown(content)
    return jsonify({'content': html_content})

# ========================================
# Directory Configuration Routes
# ========================================

@app.route('/api/directories/config', methods=['GET'])
@login_required
def api_get_directories_config():
    """获取目录配置列表"""
    directories = load_directories_config()
    return jsonify(directories)

@app.route('/api/directories/config', methods=['POST'])
@login_required
def api_update_directories_config():
    """更新目录配置列表"""
    try:
        data = request.get_json()
        directories = data.get('directories', [])

        # 验证每个目录
        for directory in directories:
            if not directory.get('name') or not directory.get('path'):
                return jsonify({'error': '目录名称和路径不能为空'}), 400

            # 验证路径是否存在
            path = expand_path(directory['path'])
            if not path.exists():
                return jsonify({'error': f'路径不存在: {directory["path"]}'}), 400

        # 保存配置
        save_directories_config(directories)
        return jsonify({'success': True, 'directories': directories})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/image')
def api_image():
    """Serve image files from the configured directories."""
    share_token = request.args.get('share_token', '')
    share_src = request.args.get('src', '')

    if share_token:
        link = find_share_link(share_token)
        if not is_share_link_active(link, enforce_view_limit=False):
            return jsonify({'error': 'Invalid or expired share token'}), 401

        base_path = expand_path(link['path']).parent
        image_path = (base_path / share_src).resolve()

        try:
            image_path.relative_to(base_path)
        except ValueError:
            return jsonify({'error': 'Invalid image path'}), 403
    elif is_auth_enabled():
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.args.get('token', '')

        if not token:
            return jsonify({'error': 'Unauthorized'}), 401

        payload = decode_token(token)
        if payload is None:
            return jsonify({'error': 'Invalid or expired token'}), 401

        image_path = request.args.get('path')
        if not image_path:
            return jsonify({'error': '缺少文件路径'}), 400

        image_path = expand_path(image_path)
    else:
        image_path = request.args.get('path')
        if not image_path:
            return jsonify({'error': '缺少文件路径'}), 400

        image_path = expand_path(image_path)

        # 验证路径是否在配置的目录内
    if not is_path_in_directories(image_path):
        abort(403)

    if not image_path.exists():
        abort(404)

    # 检查文件扩展名
    if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        abort(403)

    try:
        return send_file(str(image_path))
    except Exception as e:
        abort(500)

@app.route('/api/remote-image')
def api_remote_image():
    """Proxy remote images through this server to avoid browser-side cross-origin failures."""
    if not request_has_valid_auth_or_share():
        return jsonify({'error': 'Unauthorized'}), 401

    remote_url = request.args.get('url', '')
    if not remote_url:
        return jsonify({'error': '缺少图片 URL'}), 400

    remote_url = unquote(remote_url)
    if not is_public_remote_url(remote_url):
        return jsonify({'error': '不允许代理该 URL'}), 400

    req = Request(
        remote_url,
        headers={
            'User-Agent': 'Mozilla/5.0 DocReader/1.0',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }
    )

    try:
        opener = build_opener(SafeRedirectHandler)
        with opener.open(req, timeout=REMOTE_IMAGE_TIMEOUT_SECONDS) as remote:
            content_type = remote.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if not content_type.startswith('image/'):
                return jsonify({'error': '远程资源不是图片'}), 415

            data = remote.read(REMOTE_IMAGE_MAX_BYTES + 1)
            if len(data) > REMOTE_IMAGE_MAX_BYTES:
                return jsonify({'error': '远程图片过大'}), 413

        response = Response(data, mimetype=content_type)
        response.headers['Cache-Control'] = 'public, max-age=86400'
        return response
    except Exception:
        return jsonify({'error': '远程图片加载失败'}), 502

if __name__ == '__main__':
    server_config = config.get('server', {})
    app.run(
        host=server_config.get('host', '0.0.0.0'),
        port=server_config.get('port', 63518),
        debug=server_config.get('debug', False)
    )
