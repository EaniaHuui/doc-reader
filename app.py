#!/usr/bin/env python3
"""Doc Reader - 轻量级文档阅读器"""

import os
import re
import json
import yaml
import hashlib
import jwt
import html
import secrets
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from functools import wraps
from urllib.parse import quote
from flask import Flask, render_template, jsonify, request
import markdown

app = Flask(__name__)
app.config['TEMPLATES_AUTO_RELOAD'] = True

MARKDOWN_EXTENSIONS = [
    'extra',
    'codehilite',
    'toc',
    'fenced_code',
]

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'}

# 加载配置
def load_config():
    config_path = Path(__file__).parent / 'config.yaml'
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

config = load_config()

# 目录配置文件路径
DIRECTORIES_FILE = Path(__file__).parent / 'directories.json'
SHARE_LINKS_FILE = Path(__file__).parent / 'share_links.json'

def load_directories_config():
    """加载目录配置，优先从 directories.json，否则从 config.yaml"""
    if DIRECTORIES_FILE.exists():
        try:
            with open(DIRECTORIES_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    # 从 config.yaml 读取默认配置
    return config.get('directories', [])

def save_directories_config(directories):
    """保存目录配置到 directories.json"""
    with open(DIRECTORIES_FILE, 'w', encoding='utf-8') as f:
        json.dump(directories, f, ensure_ascii=False, indent=2)

# 展开路径中的 ~ 为用户目录
def expand_path(path):
    return Path(path).expanduser().resolve()

# 简化路径显示（将用户主目录显示为 ~）
def simplify_path(path):
    path_str = str(path)
    home = str(Path.home())
    if path_str.startswith(home):
        return path_str.replace(home, '~', 1)
    return path_str

def is_path_in_directories(target_path, directories=None):
    """检查路径是否位于允许的目录内。"""
    target_path = expand_path(target_path)
    directories = load_directories_config() if directories is None else directories

    for directory in directories:
        dir_path = expand_path(directory['path'])
        try:
            target_path.relative_to(dir_path)
            return True
        except ValueError:
            continue

    return False

def serialize_datetime(value):
    """Return an ISO timestamp string in UTC."""
    return value.replace(microsecond=0).isoformat() + 'Z'

def parse_datetime(value):
    """Parse an ISO timestamp string produced by serialize_datetime."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        return None

def load_share_links():
    """Load share-link metadata from local JSON storage."""
    if not SHARE_LINKS_FILE.exists():
        return []

    try:
        with open(SHARE_LINKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []

def save_share_links(links):
    """Persist share-link metadata to local JSON storage."""
    with open(SHARE_LINKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(links, f, ensure_ascii=False, indent=2)

def public_share_data(link):
    """Return non-sensitive share-link fields for API responses."""
    result = deepcopy(link)
    result.pop('token', None)
    result['url'] = request.host_url.rstrip('/') + f'/share/{link["token"]}'
    result['active'] = is_share_link_active(link)
    return result

def find_share_link(token):
    """Find a share link by token."""
    for link in load_share_links():
        if link.get('token') == token:
            return link
    return None

def is_share_link_active(link, enforce_view_limit=True):
    """Check whether a share link is usable."""
    if not link or link.get('revoked_at'):
        return False

    expires_at = parse_datetime(link.get('expires_at'))
    if expires_at and expires_at < datetime.utcnow():
        return False

    max_views = link.get('max_views')
    if enforce_view_limit and max_views is not None and link.get('view_count', 0) >= max_views:
        return False

    file_path = expand_path(link.get('path', ''))
    if not is_path_in_directories(file_path):
        return False

    return file_path.exists() and file_path.is_file()

def increment_share_view(token):
    """Increment view count for a share link."""
    links = load_share_links()
    for link in links:
        if link.get('token') == token:
            link['view_count'] = link.get('view_count', 0) + 1
            link['last_viewed_at'] = serialize_datetime(datetime.utcnow())
            save_share_links(links)
            return link
    return None

def preprocess_markdown_content(content):
    """预处理 Markdown 内容，兼容单换行和行首标签。"""
    lines = content.split('\n')
    processed_lines = []
    in_fenced_code = False

    for line in lines:
        if line.strip().startswith('```') or line.strip().startswith('~~~'):
            in_fenced_code = not in_fenced_code
            processed_lines.append(line)
            continue

        if in_fenced_code:
            processed_lines.append(line)
            continue

        stripped = line.lstrip()
        tag_match = re.match(r'^(#{1,6})([^#\s].*)$', stripped)
        if tag_match:
            hashes = tag_match.group(1)
            rest = tag_match.group(2)
            leading_spaces = len(line) - len(stripped)
            line = ' ' * leading_spaces + '\\' + hashes + rest

        stripped = line.rstrip()
        if stripped:
            processed_lines.append(stripped + '  ')
        else:
            processed_lines.append('')

    return '\n'.join(processed_lines)

def fix_tag_headings(html_content):
    """将被 Markdown 误判为标题的 #tag 恢复为普通标签文本。"""
    def replace_heading(match):
        content = match.group(2)

        if content.startswith('#'):
            rest = content[1:]
            if len(rest) <= 20 and ' ' not in rest:
                return f'<p><span class="inline-tag">#{content}</span></p>'

        return match.group(0)

    return re.sub(
        r'<(h[1-6])>([^<]+)</\1>',
        replace_heading,
        html_content
    )

def render_markdown(content):
    """将 Markdown 内容渲染为 HTML。"""
    processed_content = preprocess_markdown_content(content)
    md = markdown.Markdown(extensions=MARKDOWN_EXTENSIONS)
    html_content = md.convert(processed_content)
    return fix_tag_headings(html_content)

def rewrite_shared_image_urls(html_content, share_token):
    """Rewrite relative image URLs so shared pages can load them read-only."""
    def replace_src(match):
        prefix = match.group(1)
        quote_char = match.group(2)
        src = match.group(3)

        if re.match(r'^(https?:)?//', src) or src.startswith(('data:', 'mailto:', '#', '/')):
            return match.group(0)

        shared_src = f'/api/image?share_token={quote(share_token, safe="")}&src={quote(src, safe="")}'
        return f'{prefix}{quote_char}{shared_src}{quote_char}'

    return re.sub(r'(<img\b[^>]*\bsrc=)(["\'])([^"\']+)\2', replace_src, html_content)

def render_image_file(file_path):
    """Return a read-only image preview payload."""
    file_path = Path(file_path)
    if not file_path.exists():
        return None, "文件不存在"

    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        return None, "不支持的图片类型"

    try:
        mtime = file_path.stat().st_mtime
        modified_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
        image_url = '/api/image?path=' + quote(str(file_path), safe='')
        escaped_name = html.escape(file_path.name)

        return {
            'title': file_path.name,
            'content': (
                '<div class="image-file-viewer">'
                f'<img src="{image_url}" alt="{escaped_name}">'
                '</div>'
            ),
            'raw': None,
            'fileType': 'image',
            'path': simplify_path(file_path),
            'size': file_path.stat().st_size,
            'modified': modified_time
        }, None
    except Exception as e:
        return None, str(e)

# ========================================
# Authentication Functions
# ========================================

def get_auth_config():
    """Get authentication configuration."""
    return config.get('auth', {})

def is_auth_enabled():
    """Check if authentication is enabled."""
    auth_config = get_auth_config()
    return auth_config.get('enabled', False)

def hash_password(password):
    """Hash a password using SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password, hashed):
    """Verify a password against a hash."""
    return hash_password(password) == hashed

def get_users():
    """Get all users from config."""
    auth_config = get_auth_config()
    users_list = auth_config.get('users', [])
    users = {}

    for user in users_list:
        username = user.get('username')
        password = user.get('password')
        is_hashed = user.get('hashed', False)

        if username and password:
            users[username] = hash_password(password) if not is_hashed else password

    return users

def generate_token(username):
    """Generate a JWT token for the user."""
    auth_config = get_auth_config()
    secret = auth_config.get('jwt_secret', 'default-secret-change-this')
    expiration_hours = auth_config.get('token_expiration_hours', 24)

    payload = {
        'username': username,
        'exp': datetime.utcnow() + timedelta(hours=expiration_hours),
        'iat': datetime.utcnow()
    }

    return jwt.encode(payload, secret, algorithm='HS256')

def decode_token(token):
    """Decode and verify a JWT token."""
    auth_config = get_auth_config()
    secret = auth_config.get('jwt_secret', 'default-secret-change-this')

    try:
        payload = jwt.decode(token, secret, algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def login_required(f):
    """Decorator to require authentication for routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_auth_enabled():
            return f(*args, **kwargs)

        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Unauthorized'}), 401

        token = auth_header.split(' ')[1]
        payload = decode_token(token)

        if payload is None:
            return jsonify({'error': 'Invalid or expired token'}), 401

        request.user = payload
        return f(*args, **kwargs)

    return decorated_function

# 获取目录树
def get_directory_tree(path, name, file_types=None, _visited=None):
    """获取目录树

    Args:
        path: 目录路径
        name: 显示名称
        file_types: 要包含的文件类型列表，如 ['.md', '.txt', '.json']
        _visited: 已访问的路径集合（用于防止循环引用）
    """
    if file_types is None:
        file_types = ['.md']

    path = expand_path(path)
    if not path.exists():
        return None

    # 防止循环引用
    if _visited is None:
        _visited = set()

    # 将绝对路径加入已访问集合
    abs_path = str(path.resolve())
    if abs_path in _visited:
        return None
    _visited.add(abs_path)

    tree = {
        'name': name,
        'path': simplify_path(path),
        'type': 'directory',
        'children': []
    }

    try:
        items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        for item in items:
            if item.name.startswith('.'):
                continue

            if item.is_dir():
                child_tree = get_directory_tree(str(item), item.name, file_types, _visited)
                if child_tree:
                    tree['children'].append(child_tree)
            elif item.suffix.lower() in [f.lower() for f in file_types]:
                tree['children'].append({
                    'name': item.name,
                    'path': simplify_path(item),
                    'type': 'file',
                    'ext': item.suffix.lower()
                })
    except PermissionError:
        pass

    return tree

# 读取 Markdown 文件
def read_markdown_file(file_path):
    file_path = Path(file_path)
    if not file_path.exists():
        return None, "文件不存在"

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_content = f.read()
        html_content = render_markdown(raw_content)

        # 获取文件修改时间
        mtime = file_path.stat().st_mtime
        modified_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')

        return {
            'title': file_path.stem,
            'content': html_content,
            'raw': raw_content,  # 返回原始 Markdown 内容
            'path': simplify_path(file_path),
            'size': file_path.stat().st_size,
            'modified': modified_time
        }, None
    except Exception as e:
        return None, str(e)

# 搜索 Markdown 文件
def search_files(query, directories):
    results = []
    query_lower = query.lower()
    
    for directory in directories:
        path = expand_path(directory['path'])
        if not path.exists():
            continue
        
        for md_file in path.rglob('*.md'):
            try:
                with open(md_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                if query_lower in content.lower() or query_lower in md_file.name.lower():
                    results.append({
                        'name': md_file.name,
                        'path': str(md_file),
                        'directory': directory['name']
                    })
            except:
                continue
    
    return results

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
        return jsonify({'error': 'Authentication is disabled'}), 400

    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    users = get_users()
    if username not in users:
        return jsonify({'error': 'Invalid credentials'}), 401

    if not verify_password(password, users[username]):
        return jsonify({'error': 'Invalid credentials'}), 401

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
    file_types = ['.md']  # 默认只显示md文件
    show_txt = request.args.get('txt', 'false').lower() == 'true'
    show_json = request.args.get('json', 'false').lower() == 'true'
    show_images = request.args.get('images', 'false').lower() == 'true'

    if show_txt:
        file_types.append('.txt')
    if show_json:
        file_types.append('.json')
    if show_images:
        file_types.extend(sorted(IMAGE_EXTENSIONS))

    trees = []
    for directory in load_directories_config():
        tree = get_directory_tree(directory['path'], directory['name'], file_types)
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
        import shutil
        shutil.rmtree(dir_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': f'删除目录失败: {str(e)}'}), 500

# 读取文本文件（txt, json等）
def read_text_file(file_path, file_ext):
    """读取文本文件并返回格式化的HTML内容"""
    file_path = Path(file_path)
    if not file_path.exists():
        return None, "文件不存在"

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 对于JSON文件，尝试格式化并添加原始内容
        raw_json = None
        if file_ext == '.json':
            try:
                import json
                json_obj = json.loads(content)
                content = json.dumps(json_obj, ensure_ascii=False, indent=2)
                raw_json = content  # 保存格式化后的原始JSON
            except:
                pass  # 如果不是有效JSON，直接显示原始内容

        # 转义HTML字符并保持格式
        escaped_content = html.escape(content)

        # 获取文件修改时间
        mtime = file_path.stat().st_mtime
        modified_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')

        result = {
            'title': file_path.name,
            'content': f'<pre class="text-file-content">{escaped_content}</pre>',
            'path': simplify_path(file_path),
            'size': file_path.stat().st_size,
            'modified': modified_time
        }

        # 如果是有效的JSON，添加原始内容
        if raw_json:
            result['rawJson'] = raw_json

        return result, None
    except Exception as e:
        return None, str(e)

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

    from flask import send_file, abort

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

if __name__ == '__main__':
    server_config = config.get('server', {})
    app.run(
        host=server_config.get('host', '0.0.0.0'),
        port=server_config.get('port', 63518),
        debug=server_config.get('debug', False)
    )
