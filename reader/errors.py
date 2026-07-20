"""Structured API errors for /api/v1."""

from __future__ import annotations

from flask import jsonify


class ApiError(Exception):
    """Raised to produce a standard error response."""

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        extra: dict | None = None,
        **kwargs,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = {**(extra or {}), **kwargs}


def error_body(code: str, message: str, **extra):
    body = {'error': {'code': code, 'message': message}}
    if extra:
        body.update(extra)
    return body


def error_response(code: str, message: str, status: int = 400, **extra):
    return jsonify(error_body(code, message, **extra)), status


def register_error_handlers(app_or_bp) -> None:
    @app_or_bp.errorhandler(ApiError)
    def _handle_api_error(exc: ApiError):
        body = error_body(exc.code, exc.message)
        body.update(exc.extra)
        return jsonify(body), exc.status

    @app_or_bp.errorhandler(404)
    def _handle_404(_exc):
        return error_response('not_found', '资源不存在', 404)

    @app_or_bp.errorhandler(405)
    def _handle_405(_exc):
        return error_response('method_not_allowed', '不支持的请求方法', 405)

    @app_or_bp.errorhandler(413)
    def _handle_413(_exc):
        return error_response('payload_too_large', '请求体过大', 413)
