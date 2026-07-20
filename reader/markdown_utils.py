"""Markdown preprocessing, rendering, and image HTML helpers."""

from __future__ import annotations

import html
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import markdown

from .constants import IMAGE_EXTENSIONS, MARKDOWN_EXTENSIONS
from .paths import simplify_path
from .security import sanitize_rendered_html


def preprocess_markdown_content(content: str) -> str:
    """兼容单换行和行首标签。"""
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


def fix_tag_headings(html_content: str) -> str:
    """将被 Markdown 误判为标题的 #tag 恢复为普通标签文本。"""

    def replace_heading(match):
        content = match.group(2)
        if content.startswith('#'):
            rest = content[1:]
            if len(rest) <= 20 and ' ' not in rest:
                return f'<p><span class="inline-tag">#{content}</span></p>'
        return match.group(0)

    return re.sub(r'<(h[1-6])>([^<]+)</\1>', replace_heading, html_content)


def render_markdown(content: str) -> str:
    processed_content = preprocess_markdown_content(content)
    md = markdown.Markdown(extensions=MARKDOWN_EXTENSIONS)
    html_content = md.convert(processed_content)
    html_content = fix_tag_headings(html_content)
    return sanitize_rendered_html(html_content)


def rewrite_shared_image_urls(html_content: str, share_token: str) -> str:
    """Rewrite relative/remote image URLs for shared read-only pages."""

    def replace_src(match):
        prefix = match.group(1)
        quote_char = match.group(2)
        src = match.group(3)

        if src.startswith(('http://', 'https://')):
            shared_src = (
                f'/api/remote-image?url={quote(src, safe="")}'
                f'&share_token={quote(share_token, safe="")}'
            )
            return f'{prefix}{quote_char}{shared_src}{quote_char}'

        if re.match(r'^//', src) or src.startswith(('data:', 'mailto:', '#', '/')):
            return match.group(0)

        shared_src = (
            f'/api/image?share_token={quote(share_token, safe="")}'
            f'&src={quote(src, safe="")}'
        )
        return f'{prefix}{quote_char}{shared_src}{quote_char}'

    return re.sub(r'(<img\b[^>]*\bsrc=)(["\'])([^"\']+)\2', replace_src, html_content)


def rewrite_view_image_urls(html_content: str, document_path: Path) -> str:
    """Rewrite image URLs for the lightweight /view page (cookie/JWT auth)."""
    base_dir = Path(document_path).parent

    def replace_src(match):
        prefix = match.group(1)
        quote_char = match.group(2)
        src = match.group(3)

        if src.startswith(('http://', 'https://')):
            proxied = f'/api/remote-image?url={quote(src, safe="")}'
            return f'{prefix}{quote_char}{proxied}{quote_char}'

        if re.match(r'^//', src) or src.startswith(('data:', 'mailto:', '#', '/')):
            return match.group(0)

        absolute = (base_dir / src).resolve()
        image_src = f'/api/image?path={quote(simplify_path(absolute), safe="")}'
        return f'{prefix}{quote_char}{image_src}{quote_char}'

    return re.sub(r'(<img\b[^>]*\bsrc=)(["\'])([^"\']+)\2', replace_src, html_content)


def render_image_file(file_path):
    """Return a read-only image preview payload."""
    file_path = Path(file_path)
    if not file_path.exists():
        return None, '文件不存在'

    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        return None, '不支持的图片类型'

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
            'modified': modified_time,
        }, None
    except Exception as e:
        return None, str(e)


def read_markdown_file(file_path):
    file_path = Path(file_path)
    if not file_path.exists():
        return None, '文件不存在'

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_content = f.read()
        html_content = render_markdown(raw_content)
        mtime = file_path.stat().st_mtime
        modified_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M')
        return {
            'title': file_path.stem,
            'content': html_content,
            'raw': raw_content,
            'path': simplify_path(file_path),
            'size': file_path.stat().st_size,
            'modified': modified_time,
        }, None
    except Exception as e:
        return None, str(e)
