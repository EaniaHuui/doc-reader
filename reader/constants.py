"""Shared constants for Doc Reader."""

MARKDOWN_EXTENSIONS = [
    'extra',
    'codehilite',
    'toc',
    'fenced_code',
]

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'}
REMOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
REMOTE_IMAGE_TIMEOUT_SECONDS = 8

LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SECONDS = 300

# PBKDF2 params. Format: pbkdf2_sha256$iterations$salt$hash
PBKDF2_ITERATIONS = 260000
WEAK_JWT_SECRETS = {
    'default-secret-change-this',
    'your-secret-key-change-this-in-production',
    'change-me',
    'secret',
}

# Tags/attrs typically emitted by Markdown rendering. Scripts and handlers are stripped.
SAFE_HTML_TAGS = {
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
    'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre',
    'q', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary',
    'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
}
SAFE_HTML_ATTRS = {
    'alt', 'class', 'colspan', 'href', 'id', 'rowspan', 'src', 'title',
    'width', 'height', 'align', 'start', 'type', 'open',
}
URI_ATTRS = {'href', 'src'}

SEARCH_FILE_GLOBS = ('*.md', '*.txt', '*.json')
SEARCH_MAX_RESULTS = 50
SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024
SEARCH_SNIPPET_RADIUS = 40
