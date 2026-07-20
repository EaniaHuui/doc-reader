"""One-time mobile pairing sessions (60s QR)."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from datetime import timedelta

from .db import db_cursor, init_db
from .errors import ApiError
from .timeutil import from_iso, to_iso, utc_now

PAIRING_TTL_SECONDS = 60
PROTOCOL_VERSION = 1


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode('utf-8')).hexdigest()


def create_pairing_session(created_by: str, server_url: str) -> dict:
    """Create a one-time 60s pairing session. Returns QR payload fields."""
    init_db()
    session_id = uuid.uuid4().hex
    secret = secrets.token_urlsafe(24)
    now = utc_now()
    expires = now + timedelta(seconds=PAIRING_TTL_SECONDS)

    with db_cursor(commit=True) as cur:
        cur.execute(
            'INSERT INTO pairing_sessions(id, secret_hash, created_at, expires_at, '
            'consumed_at, created_by) VALUES(?, ?, ?, ?, NULL, ?)',
            (session_id, _hash_secret(secret), to_iso(now), to_iso(expires), created_by),
        )

    payload = {
        'v': PROTOCOL_VERSION,
        'server_url': server_url.rstrip('/'),
        'pairing_session_id': session_id,
        'secret': secret,
    }
    # QR data is JSON text of the payload (no password / long-lived token)
    return {
        'pairing_session_id': session_id,
        'expires_at': to_iso(expires),
        'expires_in_seconds': PAIRING_TTL_SECONDS,
        'qr_payload': payload,
        'qr_data': json.dumps(payload, separators=(',', ':'), ensure_ascii=False),
        'protocol_version': PROTOCOL_VERSION,
    }


def exchange_pairing(payload: dict) -> dict:
    """Atomically validate and consume a pairing payload. Returns auth token info via caller."""
    init_db()
    if not isinstance(payload, dict):
        raise ApiError('invalid_pairing', '配对数据无效', 422)

    session_id = payload.get('pairing_session_id') or payload.get('session_id')
    secret = payload.get('secret')
    version = payload.get('v') or payload.get('protocol_version')

    if not session_id or not secret:
        raise ApiError('invalid_pairing', '配对数据不完整', 422)

    if version is not None and int(version) != PROTOCOL_VERSION:
        raise ApiError('unsupported_protocol', '不支持的协议版本', 422)

    now = utc_now()

    with db_cursor(commit=True) as cur:
        row = cur.execute(
            'SELECT * FROM pairing_sessions WHERE id = ?', (session_id,)
        ).fetchone()
        if not row:
            raise ApiError('invalid_pairing', '配对会话不存在或已失效', 401)

        if row['consumed_at']:
            raise ApiError('pairing_consumed', '配对码已被使用', 401)

        exp = from_iso(row['expires_at'])
        if exp is None or exp < now:
            raise ApiError('pairing_expired', '配对码已过期', 401)

        if not hmac.compare_digest(row['secret_hash'], _hash_secret(secret)):
            raise ApiError('invalid_pairing', '配对密钥错误', 401)

        cur.execute(
            'UPDATE pairing_sessions SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
            (to_iso(now), session_id),
        )
        if cur.rowcount != 1:
            raise ApiError('pairing_consumed', '配对码已被使用', 401)

        username = row['created_by'] or 'user'

    return {'username': username, 'pairing_session_id': session_id}


def list_active_pairing_sessions() -> list[dict]:
    """Non-sensitive status for desktop UI (no secrets)."""
    init_db()
    now = utc_now()
    with db_cursor() as cur:
        rows = cur.execute(
            'SELECT id, created_at, expires_at, consumed_at, created_by '
            'FROM pairing_sessions ORDER BY created_at DESC LIMIT 20'
        ).fetchall()
    result = []
    for row in rows:
        exp = from_iso(row['expires_at'])
        status = 'active'
        if row['consumed_at']:
            status = 'consumed'
        elif exp is None or exp < now:
            status = 'expired'
        result.append({
            'pairing_session_id': row['id'],
            'created_at': row['created_at'],
            'expires_at': row['expires_at'],
            'status': status,
            'created_by': row['created_by'],
        })
    return result
