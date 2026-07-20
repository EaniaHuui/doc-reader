"""Document revision tokens from content hash + stable file stats."""

from __future__ import annotations

import hashlib
from pathlib import Path


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_revision(path: Path, data: bytes | None = None) -> str:
    """Opaque revision: sha256(content):size:mtime_ns:ino."""
    path = Path(path)
    st = path.stat()
    if data is None:
        if path.is_file():
            data = path.read_bytes()
        else:
            data = b''
    digest = content_hash(data)
    mtime_ns = getattr(st, 'st_mtime_ns', int(st.st_mtime * 1_000_000_000))
    ino = getattr(st, 'st_ino', 0)
    return f'{digest}:{st.st_size}:{mtime_ns}:{ino}'


def compute_revision_from_stat(path: Path, digest: str, size: int) -> str:
    st = path.stat()
    mtime_ns = getattr(st, 'st_mtime_ns', int(st.st_mtime * 1_000_000_000))
    ino = getattr(st, 'st_ino', 0)
    return f'{digest}:{size}:{mtime_ns}:{ino}'


def revision_matches(current: str, expected: str | None) -> bool:
    if not expected:
        return False
    return hmac_compare(current, expected)


def hmac_compare(a: str, b: str) -> bool:
    import hmac
    return hmac.compare_digest(a or '', b or '')
