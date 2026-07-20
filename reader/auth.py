"""Authentication helpers: password hashing, JWT, rate limit, decorator."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta
from functools import wraps

import jwt
from flask import g, request

from .constants import LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, PBKDF2_ITERATIONS, WEAK_JWT_SECRETS
from .db import db_cursor, init_db
from .errors import ApiError
from .storage import get_config
from .timeutil import to_iso, utc_now

logger = logging.getLogger(__name__)

_login_attempts: dict[str, tuple[int, float]] = {}


def get_auth_config() -> dict:
    return get_config().get('auth', {}) or {}


def is_auth_enabled() -> bool:
    return bool(get_auth_config().get('enabled', False))


def hash_password(password: str) -> str:
    """Hash a password with PBKDF2-HMAC-SHA256 (salted)."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        PBKDF2_ITERATIONS,
    )
    return f'pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}'


def _legacy_sha256(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def verify_password(password: str, stored: str) -> bool:
    """Verify password against PBKDF2, legacy SHA-256, or plaintext."""
    if not password or not stored:
        return False

    if stored.startswith('pbkdf2_sha256$'):
        try:
            _, iterations_s, salt, hash_hex = stored.split('$', 3)
            iterations = int(iterations_s)
        except (ValueError, TypeError):
            return False
        digest = hashlib.pbkdf2_hmac(
            'sha256',
            password.encode('utf-8'),
            salt.encode('utf-8'),
            iterations,
        )
        return hmac.compare_digest(digest.hex(), hash_hex)

    if re.fullmatch(r'[0-9a-fA-F]{64}', stored):
        return hmac.compare_digest(_legacy_sha256(password), stored.lower())

    return hmac.compare_digest(password, stored)


def get_users() -> dict:
    """Load users from config.

    - hashed: false → hash plaintext with PBKDF2 at process start
    - hashed: true  → use password field as-is
    """
    users_list = get_auth_config().get('users', []) or []
    users = {}
    for user in users_list:
        username = user.get('username')
        password = user.get('password')
        is_hashed = user.get('hashed', False)
        if username and password:
            users[username] = {
                'password': password if is_hashed else hash_password(password),
                'id': user.get('id') or f'user_{username}',
                'name': user.get('name') or username,
            }
    return users


def _jwt_secret() -> str:
    secret = get_auth_config().get('jwt_secret') or 'default-secret-change-this'
    if secret in WEAK_JWT_SECRETS:
        logger.warning(
            'JWT secret is weak/default. Set auth.jwt_secret in config.yaml for production.'
        )
    return secret


def token_expiration_hours() -> int:
    return int(get_auth_config().get('token_expiration_hours', 24))


def generate_token(username: str) -> tuple[str, str, datetime]:
    """Return (access_token, jti, expires_at_utc_naive)."""
    secret = _jwt_secret()
    hours = token_expiration_hours()
    now = datetime.utcnow()
    expires = now + timedelta(hours=hours)
    jti = uuid.uuid4().hex
    users = get_users()
    user = users.get(username) or {'id': f'user_{username}', 'name': username}
    payload = {
        'sub': user.get('id') or f'user_{username}',
        'username': username,
        'name': user.get('name') or username,
        'exp': expires,
        'iat': now,
        'jti': jti,
    }
    token = jwt.encode(payload, secret, algorithm='HS256')
    return token, jti, expires


def decode_token(token: str):
    secret = _jwt_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

    jti = payload.get('jti')
    if jti and is_token_revoked(jti):
        return None
    return payload


def is_token_revoked(jti: str) -> bool:
    init_db()
    with db_cursor() as cur:
        row = cur.execute(
            'SELECT 1 FROM revoked_tokens WHERE jti = ?', (jti,)
        ).fetchone()
        return row is not None


def revoke_token(jti: str, expires_at: datetime | None = None) -> None:
    if not jti:
        return
    init_db()
    with db_cursor(commit=True) as cur:
        cur.execute(
            'INSERT OR IGNORE INTO revoked_tokens(jti, revoked_at, expires_at) VALUES(?, ?, ?)',
            (jti, to_iso(), to_iso(expires_at or (utc_now() + timedelta(days=30)))),
        )


def extract_auth_token() -> str | None:
    """Read JWT from Authorization header, cookie, or query string."""
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:].strip()
        if token:
            return token

    cookie_token = (request.cookies.get('authToken') or '').strip()
    if cookie_token:
        return cookie_token

    query_token = (request.args.get('token') or '').strip()
    if query_token:
        return query_token

    return None


def get_auth_payload():
    """Return decoded JWT payload when the request is authenticated."""
    if not is_auth_enabled():
        return {
            'username': 'local',
            'sub': 'user_local',
            'name': 'local',
            'jti': None,
        }

    token = extract_auth_token()
    if not token:
        return None
    return decode_token(token)


def current_user_dict(payload=None) -> dict:
    payload = payload or get_auth_payload() or {}
    username = payload.get('username') or 'local'
    return {
        'id': payload.get('sub') or f'user_{username}',
        'name': payload.get('name') or username,
        'username': username,
    }


def issue_login_response(username: str) -> dict:
    token, jti, expires = generate_token(username)
    users = get_users()
    user = users.get(username) or {'id': f'user_{username}', 'name': username}
    return {
        'access_token': token,
        'expires_at': to_iso(expires),
        'user': {
            'id': user.get('id') or f'user_{username}',
            'name': user.get('name') or username,
        },
    }


def is_login_rate_limited(client_ip: str) -> bool:
    now = time.time()
    count, window_start = _login_attempts.get(client_ip, (0, now))
    if now - window_start > LOGIN_WINDOW_SECONDS:
        _login_attempts[client_ip] = (0, now)
        return False
    return count >= LOGIN_MAX_ATTEMPTS


def record_login_failure(client_ip: str) -> None:
    now = time.time()
    count, window_start = _login_attempts.get(client_ip, (0, now))
    if now - window_start > LOGIN_WINDOW_SECONDS:
        _login_attempts[client_ip] = (1, now)
    else:
        _login_attempts[client_ip] = (count + 1, window_start)


def clear_login_failures(client_ip: str) -> None:
    _login_attempts.pop(client_ip, None)


def login_required(f):
    """Decorator to require authentication for routes (structured errors)."""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_auth_enabled():
            g.user = current_user_dict()
            request.user = g.user
            return f(*args, **kwargs)

        payload = get_auth_payload()
        if payload is None:
            raise ApiError('unauthorized', '未认证或令牌已过期', 401)

        g.user = current_user_dict(payload)
        g.auth_payload = payload
        request.user = g.user
        return f(*args, **kwargs)

    return decorated_function
