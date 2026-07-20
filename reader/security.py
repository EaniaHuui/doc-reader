"""HTML sanitization and remote URL safety (SSRF guards)."""

from __future__ import annotations

import html
import ipaddress
import socket
from html.parser import HTMLParser
from urllib.error import URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler

from .constants import SAFE_HTML_ATTRS, SAFE_HTML_TAGS, URI_ATTRS


def is_public_remote_url(url: str) -> bool:
    """Reject non-http(s), localhost, and private-network targets."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return False

    hostname = parsed.hostname.strip().lower()
    if hostname in {'localhost'} or hostname.endswith('.localhost'):
        return False

    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False

    return True


class SafeRedirectHandler(HTTPRedirectHandler):
    """Follow redirects only when the new URL is still a public remote target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        absolute_url = urljoin(req.full_url, newurl)
        if not is_public_remote_url(absolute_url):
            raise URLError(f'Redirect to non-public URL blocked: {absolute_url}')
        return super().redirect_request(req, fp, code, msg, headers, absolute_url)


def _is_safe_uri(value) -> bool:
    """Allow relative paths and http(s)/mailto/data image URIs; block javascript: etc."""
    if value is None:
        return False
    value = value.strip()
    if not value or value.startswith('#'):
        return True
    lowered = value.lower()
    if lowered.startswith(('javascript:', 'vbscript:', 'data:text/html')):
        return False
    if lowered.startswith('data:image/'):
        return True
    if lowered.startswith(('http://', 'https://', 'mailto:', '/', './', '../')):
        return True
    if '://' not in value and not lowered.startswith('data:'):
        return True
    return False


class _HTMLSanitizer(HTMLParser):
    """Allowlist-based HTML sanitizer for Markdown output."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._parts = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in {'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag not in SAFE_HTML_TAGS:
            return
        safe_attrs = []
        for name, value in attrs:
            if not name or name.lower().startswith('on'):
                continue
            name = name.lower()
            if name not in SAFE_HTML_ATTRS:
                continue
            if name in URI_ATTRS and not _is_safe_uri(value or ''):
                continue
            if value is None:
                safe_attrs.append(name)
            else:
                safe_attrs.append(f'{name}="{html.escape(value, quote=True)}"')
        attr_str = (' ' + ' '.join(safe_attrs)) if safe_attrs else ''
        self._parts.append(f'<{tag}{attr_str}>')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in {'script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'}:
            if self._skip_depth:
                self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag not in SAFE_HTML_TAGS or tag in {'br', 'hr', 'img', 'col'}:
            return
        self._parts.append(f'</{tag}>')

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if self._skip_depth or tag in {'script', 'style', 'iframe', 'object', 'embed'}:
            return
        if tag not in SAFE_HTML_TAGS:
            return
        safe_attrs = []
        for name, value in attrs:
            if not name or name.lower().startswith('on'):
                continue
            name = name.lower()
            if name not in SAFE_HTML_ATTRS:
                continue
            if name in URI_ATTRS and not _is_safe_uri(value or ''):
                continue
            if value is None:
                safe_attrs.append(name)
            else:
                safe_attrs.append(f'{name}="{html.escape(value, quote=True)}"')
        attr_str = (' ' + ' '.join(safe_attrs)) if safe_attrs else ''
        self._parts.append(f'<{tag}{attr_str}>')

    def handle_data(self, data):
        if not self._skip_depth:
            self._parts.append(html.escape(data))

    def handle_entityref(self, name):
        if not self._skip_depth:
            self._parts.append(f'&{name};')

    def handle_charref(self, name):
        if not self._skip_depth:
            self._parts.append(f'&#{name};')

    def get_html(self) -> str:
        return ''.join(self._parts)


def sanitize_rendered_html(html_content: str) -> str:
    """Strip scripts, handlers, and disallowed tags from Markdown HTML."""
    if not html_content:
        return html_content
    sanitizer = _HTMLSanitizer()
    try:
        sanitizer.feed(html_content)
        sanitizer.close()
        return sanitizer.get_html()
    except Exception:
        return html.escape(html_content)
