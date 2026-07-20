"""Authentication helpers: password hashing, JWT, rate limit, decorator."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
from datetime import datetime, timedelta
from functools import wraps

import jwt
from flask import jsonify, request

from .constants import LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, PBKDF2_ITERATIONS, WEAK_JWT_SECRETS
from .storage import get_config

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
            users[username] = password if is_hashed else hash_password(password)
    return users


def _jwt_secret() -> str:
    secret = get_auth_config().get('jwt_secret') or 'default-secret-change-this'
    if secret in WEAK_JWT_SECRETS:
        logger.warning(
            'JWT secret is weak/default. Set auth.jwt_secret in config.yaml for production.'
        )
    return secret


def generate_token(username: str) -> str:
    auth_config = get_auth_config()
    secret = _jwt_secret()
    expiration_hours = auth_config.get('token_expiration_hours', 24)
    payload = {
        'username': username,
        'exp': datetime.utcnow() + timedelta(hours=expiration_hours),
        'iat': datetime.utcnow(),
    }
    return jwt.encode(payload, secret, algorithm='HS256')


def decode_token(token: str):
    secret = _jwt_secret()
    try:
        return jwt.decode(token, secret, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


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
